import { randomUUID } from "node:crypto";
import { fail, requireValue } from "./errors.js";

export const terminalRunStates = new Set(["CANCELLED", "BLOCKED", "FAILED_RETRYABLE", "SUCCEEDED"]);
const allowed = {
  PREFLIGHTING: ["ENUMERATING"], ENUMERATING: ["MANIFEST_FROZEN", "WAITING_FOR_CLIENT"],
  MANIFEST_FROZEN: ["CAPTURING"], CAPTURING: ["RECONCILING", "WAITING_FOR_CLIENT"],
  WAITING_FOR_CLIENT: ["ENUMERATING", "CAPTURING"], RECONCILING: ["REVIEW_REQUIRED"],
  REVIEW_REQUIRED: ["PREPARING_SEAL"], PREPARING_SEAL: ["REVIEW_REQUIRED"], CANCELLING: ["CANCELLED"],
};
const stationFor = { PREFLIGHTING: 3, ENUMERATING: 4, MANIFEST_FROZEN: 5, CAPTURING: 6, RECONCILING: 6, REVIEW_REQUIRED: 7, PREPARING_SEAL: 8, FINALIZING: 8, SUCCEEDED: 8 };
const iso = (value) => value ? new Date(value).toISOString() : null;

export function runRecord(row) {
  if (!row) return null;
  return {
    id: row.id, workspaceId: row.workspace_id, actorId: row.actor_id, draftRevision: row.draft_revision,
    input: row.input, policyRevisionId: row.policy_revision_id, status: row.status, station: row.station,
    generation: row.generation, workerId: row.worker_id, leaseUntil: iso(row.lease_until), retryOf: row.retry_of,
    progress: row.progress, diagnostic: row.diagnostic, publicationOperationId: row.publication_operation_id,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

// pg.Pool: one checked-out client per transaction. PGlite: its native exclusive
// transaction API. Never issue overlapping BEGIN/COMMIT on a shared connection.
export async function transaction(database, work) {
  if (typeof database.transaction === "function") return database.transaction(work);
  if (typeof database.connect !== "function") throw new TypeError("SourceTruth requires a transaction-capable database or pg.Pool");
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

export class SourceTruthRepository {
  constructor(database) {
    if (typeof database?.query !== "function") throw new TypeError("database is required");
    this.database = database;
  }

  // Deployment/admin boundary, deliberately not exposed as a user HTTP action.
  async provision(workspaceId, { tenantId, grants }) {
    return transaction(this.database, async (tx) => {
      const { rows } = await tx.query("SELECT tenant_id FROM project WHERE id=$1", [workspaceId]);
      requireValue(rows[0]?.tenant_id === tenantId, "SOURCE_FORBIDDEN", "Workspace 租户边界不匹配", { status: 403 });
      await tx.query("INSERT INTO source_truth_workspace (workspace_id,tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [workspaceId, tenantId]);
      await tx.query("SELECT workspace_id FROM source_truth_workspace WHERE workspace_id=$1 FOR UPDATE", [workspaceId]);
      for (const grant of grants) {
        requireValue(["READ", "MAINTAIN", "REVOKED"].includes(grant.role), "SOURCE_INVALID_GRANT", "成员权限无效", { status: 400 });
        const member = await tx.query("SELECT id FROM principal WHERE id=$1 AND tenant_id=$2", [grant.actorId, tenantId]);
        requireValue(member.rows.length === 1, "SOURCE_FORBIDDEN", "成员不属于此租户", { status: 403 });
        await tx.query(`INSERT INTO source_truth_access (workspace_id,actor_id,role) VALUES ($1,$2,$3)
          ON CONFLICT (workspace_id,actor_id) DO UPDATE SET role=EXCLUDED.role,revision=source_truth_access.revision+1`, [workspaceId, grant.actorId, grant.role]);
      }
    });
  }

  async authorize(actor, workspaceId, maintain = false, tx = this.database) {
    requireValue(actor?.actorId && actor?.tenantId, "SOURCE_AUTHENTICATION_REQUIRED", "请先认证身份", { status: 401 });
    const { rows } = await tx.query(`SELECT a.role,w.tenant_id,w.draft_revision,w.backup_barrier,w.restore_ready
      FROM source_truth_workspace w JOIN source_truth_access a USING(workspace_id)
      JOIN project p ON p.id=w.workspace_id AND p.tenant_id=w.tenant_id
      JOIN principal u ON u.id=a.actor_id AND u.tenant_id=w.tenant_id
      WHERE w.workspace_id=$1 AND w.tenant_id=$2 AND a.actor_id=$3 AND p.status='ACTIVE'`, [workspaceId, actor.tenantId, actor.actorId]);
    const state = rows[0];
    requireValue(state && (maintain ? state.role === "MAINTAIN" : ["READ", "MAINTAIN"].includes(state.role)), "SOURCE_FORBIDDEN", "无权访问或维护该 Workspace 来源", { status: 403 });
    return { role: state.role, tenantId: state.tenant_id, draftRevision: state.draft_revision, backupBarrier: state.backup_barrier, restoreReady: state.restore_ready };
  }

  async withWorkspace(actor, workspaceId, maintain, work) {
    return transaction(this.database, async (tx) => {
      // Grants, inputs and publication all take this same lock, establishing a
      // clear order against concurrent revocation instead of trusting a preflight.
      await tx.query("SELECT workspace_id FROM source_truth_workspace WHERE workspace_id=$1 FOR UPDATE", [workspaceId]);
      const state = await this.authorize(actor, workspaceId, maintain, tx);
      return work(tx, state);
    });
  }

  async audit(tx, workspaceId, runId, actorId, type, payload) {
    await tx.query("INSERT INTO source_truth_event (workspace_id,run_id,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)", [workspaceId, runId, actorId, type, JSON.stringify(payload)]);
  }

  async withLease({ workspaceId, runId, generation }, work) {
    return transaction(this.database, async (tx) => {
      const workspace = await tx.query("SELECT tenant_id FROM source_truth_workspace WHERE workspace_id=$1 FOR UPDATE", [workspaceId]);
      const { rows } = await tx.query(`SELECT *,lease_until>clock_timestamp() AS lease_valid FROM source_truth_run
        WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, runId]);
      const run = rows[0];
      requireValue(run && run.generation === generation && run.lease_valid && !terminalRunStates.has(run.status)
        && run.status !== "CANCELLING", "SOURCE_STALE_WORKER", "执行权或任务状态已变化");
      await this.authorize({ actorId: run.actor_id, tenantId: workspace.rows[0]?.tenant_id }, workspaceId, true, tx);
      const result = await work(tx, runRecord(run));
      return result;
    });
  }

  async saveDraft(actor, workspaceId, { expectedRevision, input }) {
    requireValue(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, "SOURCE_INVALID_INPUT", "缺少草稿修订号", { status: 400 });
    return this.withWorkspace(actor, workspaceId, true, async (tx, state) => {
      requireValue(state.draftRevision === expectedRevision, "SOURCE_REVISION_CONFLICT", "来源草稿已被其他操作更新");
      const active = await this.activeRun(tx, workspaceId);
      requireValue(!active, "SOURCE_RUN_ACTIVE", "请先查看或取消当前任务后编辑来源", { details: { runId: active?.id } });
      const revision = expectedRevision + 1;
      const { rows } = await tx.query("INSERT INTO source_truth_draft (workspace_id,revision,actor_id,input) VALUES ($1,$2,$3,$4) RETURNING *", [workspaceId, revision, actor.actorId, JSON.stringify(input)]);
      await tx.query("UPDATE source_truth_workspace SET draft_revision=$2 WHERE workspace_id=$1", [workspaceId, revision]);
      await this.audit(tx, workspaceId, null, actor.actorId, "DRAFT_SAVED", { revision });
      return { revision, input: rows[0].input, savedAt: iso(rows[0].created_at) };
    });
  }

  async getDraft(actor, workspaceId) {
    return this.withWorkspace(actor, workspaceId, false, async (tx, state) => {
      const { rows } = await tx.query("SELECT revision,input,created_at FROM source_truth_draft WHERE workspace_id=$1 AND revision=$2", [workspaceId, state.draftRevision]);
      return rows[0] ? { revision: rows[0].revision, input: rows[0].input, savedAt: iso(rows[0].created_at) } : null;
    });
  }

  async activeRun(tx, workspaceId) {
    const { rows } = await tx.query("SELECT * FROM source_truth_run WHERE workspace_id=$1 AND status NOT IN ('CANCELLED','BLOCKED','FAILED_RETRYABLE','SUCCEEDED')", [workspaceId]);
    return runRecord(rows[0]);
  }

  async startRun(actor, workspaceId, { draftRevision, policyRevisionId, retryOf = null }) {
    return this.withWorkspace(actor, workspaceId, true, async (tx, state) => {
      const active = await this.activeRun(tx, workspaceId);
      if (active) return active;
      let input;
      if (retryOf) {
        const prior = await tx.query("SELECT * FROM source_truth_run WHERE workspace_id=$1 AND id=$2", [workspaceId, retryOf]);
        requireValue(prior.rows[0]?.status === "FAILED_RETRYABLE", "SOURCE_RETRY_NOT_ALLOWED", "只有可重试失败才能恢复为新尝试");
        ({ input, draft_revision: draftRevision, policy_revision_id: policyRevisionId } = prior.rows[0]);
      } else {
        requireValue(draftRevision === state.draftRevision && draftRevision > 0, "SOURCE_REVISION_CONFLICT", "请确认当前来源和范围修订");
        const result = await tx.query("SELECT input FROM source_truth_draft WHERE workspace_id=$1 AND revision=$2", [workspaceId, draftRevision]);
        input = result.rows[0]?.input;
      }
      requireValue(typeof policyRevisionId === "string" && policyRevisionId.length > 0, "SOURCE_INVALID_INPUT", "缺少平台策略版本", { status: 400 });
      const id = randomUUID();
      const { rows } = await tx.query(`INSERT INTO source_truth_run (workspace_id,id,actor_id,draft_revision,input,policy_revision_id,status,station,retry_of)
        VALUES ($1,$2,$3,$4,$5,$6,'PREFLIGHTING',3,$7) RETURNING *`, [workspaceId, id, actor.actorId, draftRevision, JSON.stringify(input), policyRevisionId, retryOf]);
      await this.audit(tx, workspaceId, id, actor.actorId, "RUN_STARTED", { retryOf, draftRevision, policyRevisionId });
      return runRecord(rows[0]);
    });
  }

  async getRun(actor, workspaceId, runId) {
    return this.withWorkspace(actor, workspaceId, false, async (tx) => {
      const { rows } = await tx.query("SELECT * FROM source_truth_run WHERE workspace_id=$1 AND id=$2", [workspaceId, runId]);
      return runRecord(rows[0]);
    });
  }

  async claimRun(workspaceId, runId, { workerId, leaseMs }) {
    requireValue(typeof workerId === "string" && workerId && Number.isInteger(leaseMs) && leaseMs > 0 && leaseMs <= 60000, "SOURCE_INVALID_LEASE", "执行租约参数无效", { status: 400 });
    return transaction(this.database, async (tx) => {
      const { rows } = await tx.query(`UPDATE source_truth_run SET generation=generation+1,worker_id=$3,
        lease_until=clock_timestamp()+($4::integer * interval '1 millisecond'),updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND id=$2 AND (lease_until IS NULL OR lease_until<=clock_timestamp())
        AND status NOT IN ('CANCELLED','BLOCKED','FAILED_RETRYABLE','SUCCEEDED') RETURNING *`, [workspaceId, runId, workerId, leaseMs]);
      requireValue(rows.length === 1, "SOURCE_LEASE_BUSY", "任务已有有效执行者或已经终止");
      await this.audit(tx, workspaceId, runId, workerId, "WORKER_CLAIMED", { generation: rows[0].generation });
      return runRecord(rows[0]);
    });
  }

  async transition(workspaceId, runId, { generation, expectedStatus, status, progress, diagnostic = null }) {
    const normal = allowed[expectedStatus]?.includes(status);
    const failure = !terminalRunStates.has(expectedStatus) && expectedStatus !== "FINALIZING"
      && ["FAILED_RETRYABLE", "BLOCKED", "CANCELLING"].includes(status);
    requireValue(normal || failure, "SOURCE_INVALID_TRANSITION", "该任务状态不能执行此动作");
    return transaction(this.database, async (tx) => {
      const { rows } = await tx.query(`UPDATE source_truth_run SET status=$5,station=COALESCE($6,station),
        progress=COALESCE($7::jsonb,progress),diagnostic=$8,updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND id=$2 AND generation=$3 AND status=$4 AND lease_until>clock_timestamp() RETURNING *`,
      [workspaceId, runId, generation, expectedStatus, status, stationFor[status] ?? null, progress ? JSON.stringify(progress) : null, diagnostic ? JSON.stringify(diagnostic) : null]);
      if (!rows.length) fail("SOURCE_STALE_WORKER", "执行权或任务状态已变化，请读取最新任务");
      await this.audit(tx, workspaceId, runId, rows[0].worker_id, "RUN_TRANSITION", { from: expectedStatus, to: status, generation });
      return runRecord(rows[0]);
    });
  }

  async listBundles(actor, workspaceId) {
    return this.withWorkspace(actor, workspaceId, false, async (tx) => {
      const { rows } = await tx.query("SELECT id,payload,published_at FROM source_truth_bundle WHERE workspace_id=$1 ORDER BY published_at DESC,id LIMIT 50", [workspaceId]);
      return rows.map((row) => ({ id: row.id, ...row.payload, publishedAt: iso(row.published_at) }));
    });
  }
}
