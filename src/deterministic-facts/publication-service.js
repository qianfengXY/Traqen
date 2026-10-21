import { canonicalDigest } from "./identity.js";
import { F002Error, requireF002 } from "./errors.js";
import { normalizeCanonicalRecords, verifyPublication } from "./verification.js";

const terminalItemStates = new Set(["DONE", "NOT_APPLICABLE", "UNSUPPORTED", "PARSE_FAILED"]);

function assertOperationId(operationId) {
  requireF002(typeof operationId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(operationId), "F002_OPERATION_INVALID", "操作键格式无效", { status: 422 });
}

function scopeResult(row) {
  return { scopeId: row.scope_id, status: row.status, revision: row.revision, graphVersionId: row.graph_version_id, sealOperationId: row.seal_operation_id };
}

function requestGuard(value) {
  if (value === null || value === undefined) return null;
  requireF002(value && typeof value === "object" && typeof value.requestId === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value.requestId)
    && Number.isInteger(value.generation) && value.generation > 0 && typeof value.revalidate === "function",
  "F002_REQUEST_GUARD_INVALID", "取证请求封存围栏无效", { status: 422 });
  return value;
}

function assertRequestDeadline(request) {
  const deadline = Date.parse(request.budget?.deadline ?? "");
  requireF002(Number.isFinite(deadline), "F002_REQUEST_BUDGET_INVALID", "取证请求缺少可信预算截止", { status: 409 });
  requireF002(deadline > Date.now(), "F002_REQUEST_BUDGET_DEADLINE_EXCEEDED", "调查预算截止已过，不能发布补提事实集", { status: 409 });
}

async function assertRequestOwnerActive(tx, workspaceId, owner, guard) {
  const live = (await tx.query("SELECT lease_until>clock_timestamp() AS lease_live FROM f002_request WHERE workspace_id=$1 AND id=$2", [workspaceId, owner.id])).rows[0];
  requireF002(owner.state === "RUNNING" && live?.lease_live,
    "F002_STALE_REQUEST_WORKER", "取证请求已停止，不能发布补提事实集", { status: 409 });
  assertRequestDeadline(owner);
  await guard.revalidate();
  assertRequestDeadline(owner);
}

export class F002PublicationService {
  constructor(repository) {
    if (!repository?.withMaintainedWorkspace || !repository?.withAuthorizedWorkspace) throw new TypeError("F002 publication requires an authorized repository");
    this.repository = repository;
  }

  async prepare(actor, workspaceId, runId, scopeId, { generation, records }) {
    requireF002(Number.isInteger(generation) && generation > 0, "F002_STALE_SCOPE_WORKER", "缺少当前范围执行代次", { status: 409 });
    const run = await this.repository.withMaintainedWorkspace(actor, workspaceId, async tx => {
      const row = (await tx.query("SELECT source_input FROM f002_run WHERE workspace_id=$1 AND id=$2", [workspaceId, runId])).rows[0];
      requireF002(row, "F002_RUN_NOT_FOUND", "运行不存在", { status: 404 });
      return row;
    });
    // Validate the complete closure before writing, but never hold the shared
    // Workspace/scope locks for the entire large preparation. Prepared rows
    // remain invisible; every batch rechecks current ACL, generation and lease.
    const canonicalRecords = normalizeCanonicalRecords(records, { workspaceId, bundleId: run.source_input.bundleId });
    const withLiveScope = callback => this.repository.withMaintainedWorkspace(actor, workspaceId, async tx => {
      const scope = (await tx.query("SELECT *,lease_until>clock_timestamp() AS lease_live FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE", [workspaceId, runId, scopeId])).rows[0];
      requireF002(scope && scope.status === "RUNNING" && scope.generation === generation && scope.lease_live,
        "F002_STALE_SCOPE_WORKER", "执行权或任务状态已变化");
      return callback(tx);
    });
    for (let offset = 0; offset < canonicalRecords.length; offset += 500) {
      await withLiveScope(async tx => {
        const batch = canonicalRecords.slice(offset, offset + 500);
        const stored = (await tx.query(`SELECT prepared.kind,prepared.id,prepared.payload FROM f002_prepared_record prepared
          JOIN jsonb_array_elements($4::jsonb) input ON prepared.kind=(input->>'kind') AND prepared.id=(input->>'id')
          WHERE prepared.workspace_id=$1 AND prepared.run_id=$2 AND prepared.scope_id=$3
          ORDER BY prepared.kind,prepared.id FOR UPDATE OF prepared`, [workspaceId, runId, scopeId, JSON.stringify(batch)])).rows;
        const byKey = new Map(stored.map(record => [JSON.stringify([record.kind, record.id]), record]));
        const writable = [];
        for (const record of batch) {
          const existing = byKey.get(JSON.stringify([record.kind, record.id]));
          if (existing) {
            requireF002(canonicalDigest("RECORD", { kind: record.kind, id: record.id, payload: existing.payload })
              === canonicalDigest("RECORD", record), "F002_PREPARED_RECORD_CONFLICT", "准备记录身份已绑定不同内容");
            continue;
          }
          writable.push(record);
        }
        if (writable.length) await tx.query(`INSERT INTO f002_prepared_record (workspace_id,run_id,scope_id,generation,kind,id,payload)
          SELECT $1,$2,$3,$4,input->>'kind',input->>'id',input->'payload'
          FROM jsonb_array_elements($5::jsonb) input`, [workspaceId, runId, scopeId, generation, JSON.stringify(writable)]);
      });
    }
    return withLiveScope(async tx => {
      await tx.query("INSERT INTO f002_event (workspace_id,run_id,scope_id,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5,$6)",
        [workspaceId, runId, scopeId, actor.actorId, "RECORDS_PREPARED", JSON.stringify({ generation, recordCount: canonicalRecords.length })]);
      return { generation, recordCount: canonicalRecords.length };
    });
  }

  async check(actor, workspaceId, runId, scopeId) {
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const scope = (await tx.query("SELECT * FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3", [workspaceId, runId, scopeId])).rows[0];
      requireF002(scope, "F002_SCOPE_NOT_FOUND", "范围不存在", { status: 404 });
      const items = (await tx.query(`SELECT status FROM f002_scope_item WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3`, [workspaceId, runId, scopeId])).rows;
      const blockers = [];
      if (!items.length) blockers.push({ code: "F002_SCOPE_COVERAGE_INCOMPLETE", count: 0 });
      const nonterminal = items.filter((item) => !terminalItemStates.has(item.status));
      if (nonterminal.length) blockers.push({ code: "F002_SCOPE_PENDING", count: nonterminal.length });
      if (scope.status !== "READY_TO_SEAL" && scope.status !== "SEALED" && !blockers.some((item) => item.code === "F002_SCOPE_PENDING")) {
        blockers.push({ code: "F002_SCOPE_NOT_READY", status: scope.status });
      }
      return { scope: scopeResult(scope), ready: scope.status === "READY_TO_SEAL" && blockers.length === 0, blockers };
    });
  }

  async publish(actor, workspaceId, runId, scopeId, { revision, operationId, requestGuard: suppliedRequestGuard = null }) {
    assertOperationId(operationId);
    requireF002(Number.isInteger(revision) && revision > 0, "F002_SCOPE_REVISION_CONFLICT", "缺少当前范围修订", { status: 409 });
    const guard = requestGuard(suppliedRequestGuard);
    return this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
      const owners = (await tx.query(`SELECT id,state,generation,lease_until,budget FROM f002_request
        WHERE workspace_id=$1 AND derived_run_id=$2 AND derived_scope_id=$3 FOR UPDATE`, [workspaceId, runId, scopeId])).rows;
      requireF002(owners.length <= 1, "F002_REQUEST_GUARD_INVALID", "补提范围关联了多个取证请求", { status: 409 });
      const owner = owners[0] ?? null;
      if (owner) {
        requireF002(guard && guard.requestId === owner.id && guard.generation === owner.generation,
          "F002_REQUEST_GUARD_REQUIRED", "补提范围只能由其当前取证请求封存", { status: 409 });
        await assertRequestOwnerActive(tx, workspaceId, owner, guard);
      } else {
        requireF002(!guard, "F002_REQUEST_GUARD_INVALID", "普通范围不能附带取证请求围栏", { status: 409 });
      }
      const scope = (await tx.query("SELECT * FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE", [workspaceId, runId, scopeId])).rows[0];
      requireF002(scope, "F002_SCOPE_NOT_FOUND", "范围不存在", { status: 404 });
      if (owner) await assertRequestOwnerActive(tx, workspaceId, owner, guard);
      const run = (await tx.query("SELECT * FROM f002_run WHERE workspace_id=$1 AND id=$2", [workspaceId, runId])).rows[0];
      requireF002(run, "F002_RUN_NOT_FOUND", "运行不存在", { status: 404 });
      const profile = (await tx.query("SELECT payload FROM f002_profile WHERE id=$1", [run.profile_id])).rows[0]?.payload;
      requireF002(profile, "F002_PROFILE_UNAVAILABLE", "能力配置不存在", { status: 422 });
      const itemRows = (await tx.query("SELECT material_id,capability_id,status FROM f002_scope_item WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE", [workspaceId, runId, scopeId])).rows;
      requireF002(itemRows.length > 0, "F002_SCOPE_COVERAGE_INCOMPLETE", "范围没有声明材料与能力工作项", { status: 409 });
      requireF002(itemRows.every((item) => terminalItemStates.has(item.status)), "F002_SCOPE_PENDING", "范围仍有待处理材料或能力", { status: 409 });
      const preparedRecords = (await tx.query(`SELECT kind,id,payload FROM f002_prepared_record
        WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 ORDER BY kind,id`, [workspaceId, runId, scopeId])).rows;
      const publication = verifyPublication({ workspaceId, bundleId: run.source_input.bundleId, scopeId, profile, records: preparedRecords });
      const publishedMaterials = new Set(publication.records.filter((record) => record.kind === "MATERIAL").map((record) => record.id));
      requireF002(itemRows.every((item) => publishedMaterials.has(item.material_id)), "F002_SCOPE_COVERAGE_INCOMPLETE", "范围工作项缺少同一材料的封存记录", { status: 409 });
      if (scope.status === "SEALED") {
        requireF002(scope.seal_operation_id === operationId && scope.graph_version_id === publication.graphVersionId,
          "F002_SCOPE_REVISION_CONFLICT", "范围已经由其他封存操作发布");
        return scopeResult(scope);
      }
      requireF002(scope.status === "READY_TO_SEAL" && scope.revision === revision, "F002_SCOPE_REVISION_CONFLICT", "范围修订或状态已变化");
      const existing = (await tx.query("SELECT * FROM f002_fact_set WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE", [workspaceId, runId, scopeId])).rows[0];
      requireF002(!existing, "F002_SCOPE_REVISION_CONFLICT", "范围已经发布事实集");
      if (owner) await assertRequestOwnerActive(tx, workspaceId, owner, guard);
      const inserted = (await tx.query(`INSERT INTO f002_fact_set (workspace_id,graph_version_id,run_id,scope_id,profile_id,bundle_id,scope_revision,record_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (workspace_id,graph_version_id) DO NOTHING
        RETURNING run_id,scope_id,profile_id,bundle_id,record_digest`, [workspaceId, publication.graphVersionId, runId, scopeId, run.profile_id, run.source_input.bundleId, revision, publication.recordDigest])).rows[0];
      if (inserted) {
        for (let offset = 0; offset < publication.records.length; offset += 500) await tx.query(`INSERT INTO f002_record (workspace_id,graph_version_id,kind,id,payload)
          SELECT $1,$2,input->>'kind',input->>'id',input->'payload' FROM jsonb_array_elements($3::jsonb) input`,
          [workspaceId, publication.graphVersionId, JSON.stringify(publication.records.slice(offset, offset + 500))]);
      } else {
        const canonical = (await tx.query(`SELECT profile_id,bundle_id,record_digest FROM f002_fact_set
          WHERE workspace_id=$1 AND graph_version_id=$2 FOR UPDATE`, [workspaceId, publication.graphVersionId])).rows[0];
        requireF002(canonical && canonical.profile_id === run.profile_id && canonical.bundle_id === run.source_input.bundleId
          && canonical.record_digest === publication.recordDigest, "F002_FACT_SET_CONFLICT", "规范事实集身份与已封存内容不一致", { status: 409 });
      }
      if (owner) await assertRequestOwnerActive(tx, workspaceId, owner, guard);
      const sealed = owner
        ? (await tx.query(`UPDATE f002_scope AS scope SET status='SEALED',revision=scope.revision+1,seal_operation_id=$4,graph_version_id=$5,updated_at=clock_timestamp()
            FROM f002_request AS request
            WHERE scope.workspace_id=$1 AND scope.run_id=$2 AND scope.scope_id=$3 AND scope.status='READY_TO_SEAL' AND scope.revision=$6
              AND request.workspace_id=scope.workspace_id AND request.id=$7 AND request.derived_run_id=scope.run_id AND request.derived_scope_id=scope.scope_id
              AND request.state='RUNNING' AND request.generation=$8 AND request.lease_until>clock_timestamp()
              AND (request.budget->>'deadline')::timestamptz>clock_timestamp()
            RETURNING scope.*`, [workspaceId, runId, scopeId, operationId, publication.graphVersionId, revision, owner.id, owner.generation])).rows[0]
        : (await tx.query(`UPDATE f002_scope SET status='SEALED',revision=revision+1,seal_operation_id=$4,graph_version_id=$5,updated_at=clock_timestamp()
            WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 AND status='READY_TO_SEAL' AND revision=$6 RETURNING *`,
          [workspaceId, runId, scopeId, operationId, publication.graphVersionId, revision])).rows[0];
      if (!sealed && owner) {
        // The conditional UPDATE is the final database-time fence. If only its
        // deadline predicate changed, preserve the budget terminal outcome
        // rather than treating the worker as stale. Any owner, generation,
        // lease, scope-state, or revision change remains a stale worker.
        const finalState = (await tx.query(`SELECT request.state,request.generation,
            request.lease_until>clock_timestamp() AS lease_live,
            (request.budget->>'deadline')::timestamptz<=clock_timestamp() AS deadline_exhausted,
            scope.status AS scope_status,scope.revision AS scope_revision
          FROM f002_request AS request
          JOIN f002_scope AS scope ON scope.workspace_id=request.workspace_id
            AND scope.run_id=request.derived_run_id AND scope.scope_id=request.derived_scope_id
          WHERE request.workspace_id=$1 AND request.id=$2`, [workspaceId, owner.id])).rows[0];
        if (finalState?.state === "RUNNING" && finalState.generation === owner.generation && finalState.lease_live
          && finalState.deadline_exhausted && finalState.scope_status === "READY_TO_SEAL" && finalState.scope_revision === revision) {
          throw new F002Error("F002_REQUEST_BUDGET_DEADLINE_EXCEEDED", "调查预算截止已过，不能发布补提事实集", { status: 409 });
        }
      }
      requireF002(sealed, "F002_STALE_REQUEST_WORKER", "取证请求或派生范围在最终封存前已变化", { status: 409 });
      await tx.query("INSERT INTO f002_event (workspace_id,run_id,scope_id,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5,$6)",
        [workspaceId, runId, scopeId, actor.actorId, "SCOPE_SEALED", JSON.stringify({ operationId, graphVersionId: publication.graphVersionId, recordDigest: publication.recordDigest })]);
      return scopeResult(sealed);
    });
  }

}

export { F002Error };
