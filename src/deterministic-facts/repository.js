import { randomUUID } from "node:crypto";

import { transaction } from "../source-truth/repository.js";
import { canonicalDigest, createProfileConfigDigest, createProfileId, createScopeId, normalizeScope } from "./identity.js";
import { F002Error, requireF002 } from "./errors.js";
import { installedF002Rules } from "./rules.js";

const scopeStates = new Set(["QUEUED", "RUNNING", "READY_TO_SEAL", "SEALED", "FAILED_RETRYABLE", "BLOCKED", "CANCELLED"]);
const scopeItemStates = new Set(["PENDING", "RUNNING", "DONE", "NOT_APPLICABLE", "UNSUPPORTED", "PARSE_FAILED"]);
const terminalScopeItemStates = new Set(["DONE", "NOT_APPLICABLE", "UNSUPPORTED", "PARSE_FAILED"]);
const iso = (value) => value ? new Date(value).toISOString() : null;

function profilePayload(profile) {
  const { id, name = null, startable = true, ...identity } = profile ?? {};
  const expected = createProfileId(identity);
  requireF002(id === expected, "F002_PROFILE_ID_INVALID", "能力配置身份与规范内容不匹配", { status: 422 });
  installedF002Rules.assertProfile(identity);
  return { id, name, startable: startable === true, ...identity, configDigest: createProfileConfigDigest(identity) };
}

function scopeRow(row) {
  if (!row) return null;
  return { scopeId: row.scope_id, label: row.label, selections: row.selections, status: row.status, generation: row.generation,
    revision: row.revision, workerId: row.worker_id, leaseUntil: iso(row.lease_until), sealOperationId: row.seal_operation_id,
    graphVersionId: row.graph_version_id, diagnostic: row.diagnostic };
}

function aggregate(scopes) {
  if (scopes.length && scopes.every((scope) => scope.status === "SEALED")) return "COMPLETED";
  if (scopes.some((scope) => ["QUEUED", "RUNNING"].includes(scope.status))) return "PROCESSING";
  if (scopes.some((scope) => scope.status === "READY_TO_SEAL")) return "AWAITING_SEAL";
  if (scopes.some((scope) => scope.status === "SEALED") && scopes.some((scope) => ["FAILED_RETRYABLE", "BLOCKED", "CANCELLED"].includes(scope.status))) return "PARTIAL_TERMINAL";
  return "STOPPED";
}

function runRow(run, scopes) {
  return { id: run.id, workspaceId: run.workspace_id, actorId: run.actor_id, operationId: run.operation_id, sourceInput: run.source_input,
    profileId: run.profile_id, createdAt: iso(run.created_at), scopes, status: aggregate(scopes) };
}

function assertOperationId(operationId) {
  requireF002(typeof operationId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(operationId), "F002_OPERATION_INVALID", "操作键格式无效", { status: 422 });
}

function assertSourceInput(sourceInput) {
  requireF002(sourceInput && typeof sourceInput === "object" && /^[a-f0-9]{64}$/.test(sourceInput.bundleId ?? "") && typeof sourceInput.receiptId === "string" && sourceInput.receiptId.length > 0,
    "F002_ADMISSION_REQUIRED", "需要可信的服务器准入绑定", { status: 422 });
}

export class F002Repository {
  constructor(database, { authorize = null } = {}) {
    if (typeof database?.query !== "function") throw new TypeError("F002 repository requires a queryable database");
    if (authorize !== null && typeof authorize !== "function") throw new TypeError("F002 repository authorize must be a function");
    this.database = database;
    this.authorize = authorize;
  }

  async registerProfile(profile) {
    const payload = profilePayload(profile);
    const encoded = JSON.stringify(payload);
    return transaction(this.database, async (tx) => {
      const existing = (await tx.query("SELECT payload,startable FROM f002_profile WHERE id=$1 FOR UPDATE", [payload.id])).rows[0];
      if (existing) {
        requireF002(canonicalDigest("PROFILE_ROW", existing.payload) === canonicalDigest("PROFILE_ROW", payload)
          && existing.startable === payload.startable, "F002_PROFILE_CONFLICT", "能力配置身份已绑定不同内容");
        return payload;
      }
      await tx.query("INSERT INTO f002_profile (id,payload,startable) VALUES ($1,$2,$3)", [payload.id, encoded, payload.startable]);
      return payload;
    });
  }

  async createAdmittedRun(actor, workspaceId, { operationId, sourceInput, profile, scopes, afterCreate = null }) {
    requireF002(actor?.actorId && actor?.tenantId, "F002_AUTHENTICATION_REQUIRED", "需要服务端身份", { status: 401 });
    assertOperationId(operationId); assertSourceInput(sourceInput);
    requireF002(afterCreate === null || typeof afterCreate === "function", "F002_RUN_INPUT_INVALID", "运行创建回调无效", { status: 422 });
    const registeredProfile = profilePayload(profile);
    requireF002(Array.isArray(scopes) && scopes.length >= 1 && scopes.length <= 32, "F002_SCOPE_INVALID", "范围必须包含1到32个条目", { status: 422 });
    const normalizedScopes = scopes.map((scope, index) => {
      requireF002(scope && typeof scope === "object", "F002_SCOPE_INVALID", `范围${index + 1}无效`, { status: 422 });
      const label = scope.label ?? null;
      requireF002(label === null || (typeof label === "string" && [...label].length >= 1 && [...label].length <= 80), "F002_SCOPE_LABEL_INVALID", "范围名称无效", { status: 422 });
      const selections = normalizeScope(scope.selections);
      return { label, selections, scopeId: createScopeId({ workspaceId, bundleId: sourceInput.bundleId, profileId: registeredProfile.id, selections }) };
    });
    requireF002(new Set(normalizedScopes.map((scope) => scope.scopeId)).size === normalizedScopes.length, "F002_SCOPE_DUPLICATE", "同一运行不能重复提交规范化后相同的范围", { status: 422 });
    const requestDigest = canonicalDigest("RUN_REQUEST", { source: { bundleId: sourceInput.bundleId, receiptId: sourceInput.receiptId }, profileId: registeredProfile.id,
      scopes: normalizedScopes.slice().sort((left, right) => Buffer.compare(Buffer.from(left.scopeId, "ascii"), Buffer.from(right.scopeId, "ascii"))).map(({ label, selections, scopeId }) => ({ label, selections, scopeId })) });
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      const profileRow = (await tx.query("SELECT id,startable FROM f002_profile WHERE id=$1", [registeredProfile.id])).rows[0];
      requireF002(profileRow && profileRow.startable, "F002_PROFILE_UNAVAILABLE", "能力配置不存在或不可启动", { status: 422 });
      const existing = (await tx.query("SELECT * FROM f002_run WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3 FOR UPDATE", [workspaceId, actor.actorId, operationId])).rows[0];
      if (existing) {
        requireF002(existing.request_digest === requestDigest, "F002_OPERATION_CONFLICT", "操作键已绑定不同请求");
        return this.#run(tx, workspaceId, existing.id);
      }
      const id = randomUUID();
      await tx.query("INSERT INTO f002_run (workspace_id,id,actor_id,operation_id,request_digest,source_input,profile_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [workspaceId, id, actor.actorId, operationId, requestDigest, JSON.stringify(sourceInput), registeredProfile.id]);
      for (const scope of normalizedScopes) await tx.query("INSERT INTO f002_scope (workspace_id,run_id,scope_id,label,selections,status) VALUES ($1,$2,$3,$4,$5,'QUEUED')",
        [workspaceId, id, scope.scopeId, scope.label, JSON.stringify(scope.selections)]);
      // A caller may atomically attach a newly-created run to another durable
      // F002 lifecycle object. This prevents a queued derived scope from ever
      // becoming visible to an executor without its owning request fence.
      if (afterCreate) await afterCreate(tx, { runId: id, scopes: normalizedScopes.map(({ scopeId, selections }) => ({ scopeId, selections })) });
      await this.#event(tx, workspaceId, id, null, actor.actorId, "RUN_CREATED", { operationId, profileId: registeredProfile.id, scopeIds: normalizedScopes.map((scope) => scope.scopeId) });
      return this.#run(tx, workspaceId, id);
    }, { maintain: true });
  }

  async getRun(actor, workspaceId, runId) { return this.#withWorkspace(actor, workspaceId, (tx) => this.#run(tx, workspaceId, runId)); }

  async findRunByOperation(actor, workspaceId, operationId) {
    assertOperationId(operationId);
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      const row = (await tx.query("SELECT id FROM f002_run WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3", [workspaceId, actor.actorId, operationId])).rows[0];
      return row ? this.#run(tx, workspaceId, row.id) : null;
    }, { maintain: true });
  }

  async findScopeOperation(actor, workspaceId, operationId) {
    assertOperationId(operationId);
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      // A later worker may overwrite the diagnostic. Reconcile against the
      // committed command event, never infer acceptance from today's state.
      const { rows } = await tx.query(`SELECT run_id,scope_id,event_type,payload,occurred_at FROM f002_event
        WHERE workspace_id=$1 AND actor_id=$2 AND payload->>'operationId'=$3
          AND event_type IN ('SCOPE_RETRY_QUEUED','SCOPE_CANCELLED','SCOPE_SEALED')
        ORDER BY sequence LIMIT 2`, [workspaceId, actor.actorId, operationId]);
      requireF002(rows.length <= 1, "F002_OPERATION_CONFLICT", "操作键对应多个范围回执，不能猜测提交结果", { status: 409 });
      if (!rows.length) return null;
      const row = rows[0];
      return { operationId, runId: row.run_id, scopeId: row.scope_id, eventType: row.event_type,
        graphVersionId: row.payload.graphVersionId ?? null, acceptedAt: iso(row.occurred_at) };
    }, { maintain: true });
  }

  async getProfile(actor, workspaceId, profileId) {
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      const row = (await tx.query("SELECT payload,startable FROM f002_profile WHERE id=$1", [profileId])).rows[0];
      requireF002(row, "F002_PROFILE_UNAVAILABLE", "能力配置不存在", { status: 404 });
      return { ...row.payload, startable: row.startable };
    });
  }

  async getScope(actor, workspaceId, runId, scopeId) {
    return this.#withWorkspace(actor, workspaceId, async (tx) => scopeRow((await tx.query("SELECT * FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3", [workspaceId, runId, scopeId])).rows[0]));
  }

  // The executor is a configured server component, not an HTTP read path. It
  // receives only durable identifiers; F002Worker re-enters the normal
  // Workspace authorization gate with the recorded human member before it
  // reads or changes a scope.
  async findRunnableScopes({ limit = 32 } = {}) {
    requireF002(Number.isInteger(limit) && limit >= 1 && limit <= 128, "F002_EXECUTOR_LIMIT_INVALID", "执行器批量大小无效", { status: 422 });
    const { rows } = await this.database.query(`SELECT scope.workspace_id,scope.run_id,scope.scope_id,scope.status,run.actor_id
      FROM f002_scope scope JOIN f002_run run ON run.workspace_id=scope.workspace_id AND run.id=scope.run_id
      WHERE NOT EXISTS (SELECT 1 FROM f002_request request
          WHERE request.workspace_id=scope.workspace_id AND request.derived_run_id=scope.run_id AND request.derived_scope_id=scope.scope_id)
        AND (scope.status='QUEUED'
         OR (scope.status='RUNNING' AND scope.lease_until<=clock_timestamp())
        )
      ORDER BY scope.updated_at,scope.workspace_id,scope.run_id,scope.scope_id LIMIT $1`, [limit]);
    return rows.map((row) => ({ workspaceId: row.workspace_id, runId: row.run_id, scopeId: row.scope_id, actorId: row.actor_id, status: row.status }));
  }

  async findRunnableRequests({ limit = 32 } = {}) {
    requireF002(Number.isInteger(limit) && limit >= 1 && limit <= 500, "F002_PAGE_INVALID", "请求执行分页无效", { status: 422 });
    return (await this.database.query(`SELECT workspace_id,id,actor_id,state FROM f002_request
      WHERE state='QUEUED' OR (state='RUNNING' AND lease_until<=clock_timestamp()) ORDER BY created_at,id LIMIT $1`, [limit])).rows.map((row) => ({
      workspaceId: row.workspace_id, requestId: row.id, actorId: row.actor_id, status: row.state,
    }));
  }

  async withAuthorizedWorkspace(actor, workspaceId, callback) {
    requireF002(typeof callback === "function", "F002_CALLBACK_INVALID", "需要受控事务回调", { status: 422 });
    return this.#withWorkspace(actor, workspaceId, callback);
  }

  async withMaintainedWorkspace(actor, workspaceId, callback) {
    requireF002(typeof callback === "function", "F002_CALLBACK_INVALID", "需要受控事务回调", { status: 422 });
    return this.#withWorkspace(actor, workspaceId, callback, { maintain: true });
  }

  async claimScope(actor, workspaceId, runId, scopeId, { workerId, leaseMs, requestId = null, requestGeneration = null }) {
    requireF002(typeof workerId === "string" && workerId.length > 0 && Number.isInteger(leaseMs) && leaseMs > 0 && leaseMs <= 60_000
      && ((requestId === null && requestGeneration === null) || (typeof requestId === "string" && /^[A-Za-z0-9-]{1,128}$/.test(requestId) && Number.isInteger(requestGeneration) && requestGeneration > 0)),
    "F002_LEASE_INVALID", "范围租约参数无效", { status: 422 });
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      const request = await this.#requestScopeOwner(tx, workspaceId, runId, scopeId);
      if (request) {
        requireF002(requestId === request.id && requestGeneration === request.generation && request.state === "RUNNING"
          && request.lease_live,
        "F002_REQUEST_SCOPE_OWNED", "派生范围只能由其当前取证请求执行", { status: 409 });
      } else {
        requireF002(requestId === null && requestGeneration === null, "F002_REQUEST_SCOPE_OWNED", "普通范围不能携带取证请求执行凭据", { status: 409 });
      }
      const { rows } = await tx.query(`UPDATE f002_scope SET status='RUNNING',generation=generation+1,revision=revision+1,worker_id=$4,
          lease_until=clock_timestamp()+($5::integer * interval '1 millisecond'),updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3
          AND (status='QUEUED' OR (status='RUNNING' AND lease_until<=clock_timestamp())) RETURNING *`, [workspaceId, runId, scopeId, workerId, leaseMs]);
      requireF002(rows.length === 1, "F002_SCOPE_LEASE_BUSY", "范围已有有效执行者或不可执行");
      await this.#event(tx, workspaceId, runId, scopeId, workerId, "SCOPE_CLAIMED", { generation: rows[0].generation });
      return scopeRow(rows[0]);
    }, { maintain: true });
  }

  async renewScopeLease(actor, { workspaceId, runId, scopeId, generation, workerId, leaseMs, requestId = null, requestGeneration = null }) {
    requireF002(Number.isInteger(generation) && generation > 0 && typeof workerId === "string" && workerId.length > 0
      && Number.isInteger(leaseMs) && leaseMs > 0 && leaseMs <= 60_000,
    "F002_LEASE_INVALID", "范围租约参数无效", { status: 422 });
    return this.#withWorkspace(actor, workspaceId, async tx => {
      const request = await this.#requestScopeOwner(tx, workspaceId, runId, scopeId);
      requireF002(request ? requestId === request.id && requestGeneration === request.generation && request.state === "RUNNING"
        && request.lease_live : requestId === null && requestGeneration === null,
      "F002_REQUEST_SCOPE_OWNED", "范围续期不能越过其取证请求执行边界", { status: 409 });
      const { rows } = await tx.query(`UPDATE f002_scope
        SET lease_until=clock_timestamp()+($6::integer * interval '1 millisecond'),updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 AND generation=$4 AND worker_id=$5
          AND status='RUNNING' AND lease_until>clock_timestamp() RETURNING *`,
      [workspaceId, runId, scopeId, generation, workerId, leaseMs]);
      requireF002(rows.length === 1, "F002_STALE_SCOPE_WORKER", "执行权或任务状态已变化", { status: 409 });
      return scopeRow(rows[0]);
    }, { maintain: true });
  }

  async readyToSeal(actor, { workspaceId, runId, scopeId, generation }) {
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      const pending = await tx.query(`SELECT 1 FROM f002_scope_item WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3
        AND status NOT IN ('DONE','NOT_APPLICABLE','UNSUPPORTED','PARSE_FAILED') LIMIT 1`, [workspaceId, runId, scopeId]);
      requireF002(pending.rows.length === 0, "F002_SCOPE_PENDING", "范围仍有待处理材料或能力", { status: 409 });
      const { rows } = await tx.query(`UPDATE f002_scope SET status='READY_TO_SEAL',revision=revision+1,lease_until=NULL,updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 AND status='RUNNING' AND generation=$4 AND lease_until>clock_timestamp() RETURNING *`, [workspaceId, runId, scopeId, generation]);
      requireF002(rows.length === 1, "F002_STALE_SCOPE_WORKER", "范围执行权或状态已变化");
      await this.#event(tx, workspaceId, runId, scopeId, rows[0].worker_id, "SCOPE_READY_TO_SEAL", { generation });
      return scopeRow(rows[0]);
    }, { maintain: true });
  }

  async recordScopeItems(actor, { workspaceId, runId, scopeId, generation, items }) {
    requireF002(Number.isInteger(generation) && generation > 0 && Array.isArray(items) && items.length <= 500,
      "F002_SCOPE_ITEM_INVALID", "范围工作项参数无效", { status: 422 });
    const normalized = items.map((item) => {
      requireF002(item && typeof item === "object" && typeof item.materialId === "string" && item.materialId.length > 0
        && typeof item.capabilityId === "string" && item.capabilityId.length > 0 && scopeItemStates.has(item.status),
      "F002_SCOPE_ITEM_INVALID", "范围工作项无效", { status: 422 });
      const recordIds = item.recordIds ?? [], gapIds = item.gapIds ?? [];
      requireF002(Array.isArray(recordIds) && Array.isArray(gapIds) && recordIds.every((id) => typeof id === "string") && gapIds.every((id) => typeof id === "string"),
        "F002_SCOPE_ITEM_INVALID", "范围工作项引用无效", { status: 422 });
      const normalizedItem = { materialId: item.materialId, capabilityId: item.capabilityId, status: item.status,
        recordIds: [...new Set(recordIds)].sort(), gapIds: [...new Set(gapIds)].sort(), diagnostic: item.diagnostic ?? null };
      canonicalDigest("SCOPE_ITEM", normalizedItem);
      return normalizedItem;
    });
    requireF002(new Set(normalized.map((item) => `${item.materialId}\u0000${item.capabilityId}`)).size === normalized.length,
      "F002_SCOPE_ITEM_DUPLICATE", "同一批工作项身份重复", { status: 422 });
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      const scope = (await tx.query("SELECT *,lease_until>clock_timestamp() AS lease_live FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE", [workspaceId, runId, scopeId])).rows[0];
      requireF002(scope && scope.status === "RUNNING" && scope.generation === generation && scope.lease_live,
        "F002_STALE_SCOPE_WORKER", "执行权或任务状态已变化");
      for (const item of normalized) {
        const existing = (await tx.query(`SELECT * FROM f002_scope_item WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3
          AND material_id=$4 AND capability_id=$5 FOR UPDATE`, [workspaceId, runId, scopeId, item.materialId, item.capabilityId])).rows[0];
        if (existing && terminalScopeItemStates.has(existing.status)) {
          // A recovered worker re-declares the fixed work denominator before it
          // knows which crash window it is resuming from. That declaration must
          // never turn a durable terminal result back into PENDING.
          if (item.status === "PENDING") continue;
          const current = { materialId: existing.material_id, capabilityId: existing.capability_id, status: existing.status,
            recordIds: existing.record_ids, gapIds: existing.gap_ids, diagnostic: existing.diagnostic };
          requireF002(canonicalDigest("SCOPE_ITEM", current) === canonicalDigest("SCOPE_ITEM", item),
            "F002_SCOPE_ITEM_CONFLICT", "终态工作项不能被不同输出覆盖");
          continue;
        }
        await tx.query(`INSERT INTO f002_scope_item (workspace_id,run_id,scope_id,material_id,capability_id,generation,status,record_ids,gap_ids,diagnostic)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (workspace_id,run_id,scope_id,material_id,capability_id) DO UPDATE SET
            generation=EXCLUDED.generation,status=EXCLUDED.status,record_ids=EXCLUDED.record_ids,gap_ids=EXCLUDED.gap_ids,
            diagnostic=EXCLUDED.diagnostic,updated_at=clock_timestamp()`,
        [workspaceId, runId, scopeId, item.materialId, item.capabilityId, generation, item.status, JSON.stringify(item.recordIds), JSON.stringify(item.gapIds), JSON.stringify(item.diagnostic)]);
      }
      await this.#event(tx, workspaceId, runId, scopeId, actor.actorId, "SCOPE_ITEMS_RECORDED", { generation, count: normalized.length });
      return normalized;
    }, { maintain: true });
  }

  async failScope(actor, { workspaceId, runId, scopeId, generation, diagnostic }) {
    requireF002(Number.isInteger(generation) && generation > 0 && diagnostic && typeof diagnostic === "object" && !Array.isArray(diagnostic),
      "F002_FAILURE_INVALID", "范围失败信息无效", { status: 422 });
    canonicalDigest("SCOPE_FAILURE", diagnostic);
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      const { rows } = await tx.query(`UPDATE f002_scope SET status='FAILED_RETRYABLE',revision=revision+1,lease_until=NULL,
          diagnostic=$5,updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 AND status='RUNNING' AND generation=$4 AND lease_until>clock_timestamp()
        RETURNING *`, [workspaceId, runId, scopeId, generation, JSON.stringify(diagnostic)]);
      requireF002(rows.length === 1, "F002_STALE_SCOPE_WORKER", "执行权或任务状态已变化");
      await this.#event(tx, workspaceId, runId, scopeId, actor.actorId, "SCOPE_FAILED_RETRYABLE", diagnostic);
      return scopeRow(rows[0]);
    }, { maintain: true });
  }

  async cancelScope(actor, workspaceId, runId, scopeId, { revision, operationId }) {
    assertOperationId(operationId);
    requireF002(Number.isInteger(revision) && revision > 0, "F002_SCOPE_REVISION_CONFLICT", "缺少当前范围修订", { status: 409 });
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      await this.#assertScopeNotRequestOwned(tx, workspaceId, runId, scopeId);
      const scope = (await tx.query("SELECT * FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE", [workspaceId, runId, scopeId])).rows[0];
      requireF002(scope, "F002_SCOPE_NOT_FOUND", "范围不存在", { status: 404 });
      requireF002(scope.status !== "SEALED" && scope.revision === revision, "F002_SCOPE_REVISION_CONFLICT", "范围修订或状态已变化");
      const { rows } = await tx.query(`UPDATE f002_scope SET status='CANCELLED',revision=revision+1,lease_until=NULL,
          diagnostic=$4,updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 RETURNING *`,
      [workspaceId, runId, scopeId, JSON.stringify({ code: "CANCELLED", operationId })]);
      await this.#event(tx, workspaceId, runId, scopeId, actor.actorId, "SCOPE_CANCELLED", { operationId });
      return scopeRow(rows[0]);
    }, { maintain: true });
  }

  async retryScope(actor, workspaceId, runId, scopeId, { revision, operationId }) {
    assertOperationId(operationId);
    requireF002(Number.isInteger(revision) && revision > 0, "F002_SCOPE_REVISION_CONFLICT", "缺少当前范围修订", { status: 409 });
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      await this.#assertScopeNotRequestOwned(tx, workspaceId, runId, scopeId);
      const scope = (await tx.query("SELECT * FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE", [workspaceId, runId, scopeId])).rows[0];
      requireF002(scope, "F002_SCOPE_NOT_FOUND", "范围不存在", { status: 404 });
      requireF002(scope.status === "FAILED_RETRYABLE" && scope.revision === revision, "F002_SCOPE_REVISION_CONFLICT", "范围修订或状态已变化", { status: 409 });
      const { rows } = await tx.query(`UPDATE f002_scope SET status='QUEUED',revision=revision+1,worker_id=NULL,lease_until=NULL,
          diagnostic=$4,updated_at=clock_timestamp() WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 RETURNING *`,
      [workspaceId, runId, scopeId, JSON.stringify({ code: "RETRY_QUEUED", operationId })]);
      await this.#event(tx, workspaceId, runId, scopeId, actor.actorId, "SCOPE_RETRY_QUEUED", { operationId });
      return scopeRow(rows[0]);
    }, { maintain: true });
  }

  async sealScope(actor, workspaceId, runId, scopeId, { revision, operationId, graphVersionId }) {
    assertOperationId(operationId);
    requireF002(Number.isInteger(revision) && revision > 0 && /^[a-f0-9]{64}$/.test(graphVersionId ?? ""), "F002_SEAL_INVALID", "封存参数无效", { status: 422 });
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      await this.#assertScopeNotRequestOwned(tx, workspaceId, runId, scopeId);
      const row = (await tx.query("SELECT * FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE", [workspaceId, runId, scopeId])).rows[0];
      requireF002(row, "F002_SCOPE_NOT_FOUND", "范围不存在", { status: 404 });
      if (row.status === "SEALED") {
        requireF002(row.seal_operation_id === operationId && row.graph_version_id === graphVersionId, "F002_SCOPE_REVISION_CONFLICT", "范围已经由其他封存操作发布");
        return scopeRow(row);
      }
      requireF002(row.status === "READY_TO_SEAL" && row.revision === revision, "F002_SCOPE_REVISION_CONFLICT", "范围修订或状态已变化");
      const { rows } = await tx.query("UPDATE f002_scope SET status='SEALED',revision=revision+1,seal_operation_id=$4,graph_version_id=$5,updated_at=clock_timestamp() WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 RETURNING *",
        [workspaceId, runId, scopeId, operationId, graphVersionId]);
      await this.#event(tx, workspaceId, runId, scopeId, actor.actorId, "SCOPE_SEALED", { operationId, graphVersionId });
      return scopeRow(rows[0]);
    }, { maintain: true });
  }

  async cancelRequestScope(actor, workspaceId, runId, scopeId, { requestId, requestGeneration, revision, operationId, reason }) {
    assertOperationId(operationId);
    requireF002(typeof requestId === "string" && /^[A-Za-z0-9-]{1,128}$/.test(requestId)
      && Number.isInteger(requestGeneration) && requestGeneration > 0 && Number.isInteger(revision) && revision > 0
      && typeof reason === "string" && reason.length > 0 && reason.length <= 128,
    "F002_REQUEST_GUARD_INVALID", "派生范围取消围栏无效", { status: 422 });
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      const owner = await this.#requestScopeOwner(tx, workspaceId, runId, scopeId);
      requireF002(owner && owner.id === requestId && owner.generation === requestGeneration && owner.state === "RUNNING"
        && owner.lease_live,
      "F002_STALE_REQUEST_WORKER", "取证请求已停止，不能修改派生范围", { status: 409 });
      const scope = (await tx.query("SELECT * FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE", [workspaceId, runId, scopeId])).rows[0];
      requireF002(scope && scope.status !== "SEALED" && scope.revision === revision, "F002_SCOPE_REVISION_CONFLICT", "范围修订或状态已变化", { status: 409 });
      if (scope.status === "CANCELLED") return scopeRow(scope);
      const { rows } = await tx.query(`UPDATE f002_scope SET status='CANCELLED',revision=revision+1,lease_until=NULL,
          diagnostic=$4,updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 RETURNING *`,
      [workspaceId, runId, scopeId, JSON.stringify({ code: "CANCELLED_BY_REQUEST", requestId, operationId, reason })]);
      await this.#event(tx, workspaceId, runId, scopeId, actor.actorId, "SCOPE_CANCELLED_BY_REQUEST", { requestId, operationId, reason });
      return scopeRow(rows[0]);
    }, { maintain: true });
  }

  async #run(tx, workspaceId, runId) {
    const run = (await tx.query("SELECT * FROM f002_run WHERE workspace_id=$1 AND id=$2", [workspaceId, runId])).rows[0];
    requireF002(run, "F002_RUN_NOT_FOUND", "运行不存在", { status: 404 });
    const scopes = (await tx.query(`SELECT scope.*,EXISTS (SELECT 1 FROM f002_request request
        WHERE request.workspace_id=scope.workspace_id AND request.derived_run_id=scope.run_id AND request.derived_scope_id=scope.scope_id) AS request_owned
      FROM f002_scope scope WHERE scope.workspace_id=$1 AND scope.run_id=$2 ORDER BY scope.scope_id`, [workspaceId, runId]))
      .rows.map(row => ({ ...scopeRow(row), requestOwned: row.request_owned }));
    return runRow(run, scopes);
  }

  async #requestScopeOwner(tx, workspaceId, runId, scopeId) {
    return (await tx.query(`SELECT *,lease_until>clock_timestamp() AS lease_live FROM f002_request WHERE workspace_id=$1 AND derived_run_id=$2 AND derived_scope_id=$3 FOR UPDATE`,
      [workspaceId, runId, scopeId])).rows[0] ?? null;
  }

  async #assertScopeNotRequestOwned(tx, workspaceId, runId, scopeId) {
    const owner = await this.#requestScopeOwner(tx, workspaceId, runId, scopeId);
    requireF002(!owner, "F002_REQUEST_SCOPE_OWNED", "派生范围只能由其取证请求生命周期操作", { status: 409 });
  }

  async sourceBinding(workspaceId, analysisRunId, tx = null) {
    const load = async (queryable) => {
      const row = (await queryable.query("SELECT source_input FROM f002_run WHERE workspace_id=$1 AND id=$2", [workspaceId, analysisRunId])).rows[0];
      return row ? { analysisRunId, sourceInput: row.source_input } : null;
    };
    return tx ? load(tx) : transaction(this.database, load);
  }

  async appendEvent(actor, workspaceId, runId, scopeId, eventType, payload) {
    requireF002(typeof runId === "string" && typeof eventType === "string" && eventType.length > 0 && payload && typeof payload === "object" && !Array.isArray(payload),
      "F002_AUDIT_INVALID", "审计事件无效", { status: 422 });
    canonicalDigest("AUDIT_EVENT", payload);
    return this.#withWorkspace(actor, workspaceId, async (tx) => {
      const run = (await tx.query("SELECT 1 FROM f002_run WHERE workspace_id=$1 AND id=$2", [workspaceId, runId])).rows[0];
      requireF002(run, "F002_RUN_NOT_FOUND", "运行不存在", { status: 404 });
      await this.#event(tx, workspaceId, runId, scopeId, actor.actorId, eventType, payload);
    });
  }

  async #withWorkspace(actor, workspaceId, callback, { maintain = false } = {}) {
    requireF002(actor?.actorId && actor?.tenantId, "F002_AUTHENTICATION_REQUIRED", "需要服务端身份", { status: 401 });
    requireF002(typeof this.authorize === "function", "F002_AUTHORIZATION_UNAVAILABLE", "F002 尚未配置 Workspace 授权器", { status: 503 });
    return transaction(this.database, async (tx) => {
      // Share F001's project-first lock order. Revocation, restore readiness and
      // the paired-backup waterline must linearize with F002 consumption too.
      await tx.query("SELECT id FROM project WHERE id=$1 FOR UPDATE", [workspaceId]);
      await tx.query("SELECT workspace_id FROM source_truth_workspace WHERE workspace_id=$1 FOR UPDATE", [workspaceId]);
      const access = await this.authorize(actor, workspaceId, tx, maintain);
      requireF002(access?.restoreReady === true, "F002_RESTORE_UNVERIFIED", "来源与事实集恢复尚未完整校验，暂缓消费", { status: 503 });
      requireF002(!maintain || access.backupBarrier === false, "F002_BACKUP_BUSY", "正在建立配套备份水位，暂缓事实写入", { status: 503 });
      return callback(tx);
    });
  }

  async #event(tx, workspaceId, runId, scopeId, actorId, eventType, payload) {
    await tx.query("INSERT INTO f002_event (workspace_id,run_id,scope_id,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5,$6)", [workspaceId, runId, scopeId, actorId, eventType, JSON.stringify(payload)]);
  }
}

export { F002Error, scopeStates, scopeItemStates, terminalScopeItemStates };
