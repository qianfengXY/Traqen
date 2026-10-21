import { randomUUID } from "node:crypto";

import { canonicalDigest } from "./identity.js";
import { F002Error, requireF002 } from "./errors.js";

function operationId(value) {
  requireF002(typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value), "F002_OPERATION_INVALID", "操作键格式无效", { status: 422 });
  return value;
}

function strings(value, field, { max = 200 } = {}) {
  requireF002(Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 512),
    "F002_REQUEST_INVALID", `${field}无效`, { status: 422 });
  return [...new Set(value)].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
}

function normalizedRequest(input) {
  requireF002(input && typeof input === "object" && !Array.isArray(input), "F002_REQUEST_INVALID", "取证请求无效", { status: 422 });
  const normalized = {
    operationId: operationId(input.operationId),
    investigationId: typeof input.investigationId === "string" && input.investigationId.length > 0 && input.investigationId.length <= 256 ? input.investigationId : null,
    baseVersionId: typeof input.baseVersionId === "string" && /^[a-f0-9]{64}$/.test(input.baseVersionId) ? input.baseVersionId : null,
    requestKind: typeof input.requestKind === "string" && /^[A-Z_]{1,64}$/.test(input.requestKind) ? input.requestKind : null,
    question: typeof input.question === "string" && input.question.length > 0 && input.question.length <= 16_384 ? input.question : null,
    materialRefs: strings(input.materialRefs ?? [], "materialRefs"), factRefs: strings(input.factRefs ?? [], "factRefs"),
    requestedCapabilities: strings(input.requestedCapabilities ?? [], "requestedCapabilities", { max: 64 }),
  };
  requireF002(normalized.investigationId && normalized.baseVersionId && normalized.requestKind && normalized.question,
    "F002_REQUEST_INVALID", "取证请求缺少调查、版本、类型或问题", { status: 422 });
  requireF002(normalized.materialRefs.length + normalized.factRefs.length > 0,
    "F002_REQUEST_INVALID", "取证请求至少须定位一个材料或事实", { status: 422 });
  normalized.digest = canonicalDigest("REQUEST", { investigationId: normalized.investigationId, baseVersionId: normalized.baseVersionId,
    requestKind: normalized.requestKind, questionDigest: canonicalDigest("REQUEST_QUESTION", { question: normalized.question }),
    materialRefs: normalized.materialRefs, factRefs: normalized.factRefs, requestedCapabilities: normalized.requestedCapabilities });
  return normalized;
}

function normalizedBinding(binding, request, workspaceId) {
  requireF002(binding && typeof binding === "object" && binding.workspaceId === workspaceId && binding.investigationId === request.investigationId
    && binding.baseVersionId === request.baseVersionId && binding.state === "RUNNING", "F002_CONSUMER_REJECTED", "调查上下文无法证明当前请求获准", { status: 403 });
  const allowedFactIds = strings(binding.allowedFactIds ?? [], "binding.allowedFactIds", { max: 200_000 });
  const allowedMaterialIds = strings(binding.allowedMaterialIds ?? [], "binding.allowedMaterialIds", { max: 200_000 });
  const allowedCapabilities = strings(binding.allowedCapabilities ?? [], "binding.allowedCapabilities", { max: 512 });
  requireF002(request.factRefs.every((value) => allowedFactIds.includes(value)) && request.materialRefs.every((value) => allowedMaterialIds.includes(value))
    && request.requestedCapabilities.every((value) => allowedCapabilities.includes(value)), "F002_CONSUMER_REJECTED", "调查范围不允许此取证请求", { status: 403 });
  requireF002(binding.budget && Number.isInteger(binding.budget.maxMaterials) && binding.budget.maxMaterials >= request.materialRefs.length
    && Number.isInteger(binding.budget.maxBytes) && binding.budget.maxBytes >= 0
    && Number.isInteger(binding.budget.maxRuleApplications) && binding.budget.maxRuleApplications >= 0
    && Number.isInteger(binding.budget.maximumAttempts) && binding.budget.maximumAttempts >= 1
    && typeof binding.budget.deadline === "string" && Number.isFinite(Date.parse(binding.budget.deadline)),
  "F002_CONSUMER_REJECTED", "调查预算无效或不足", { status: 403 });
  return { investigationId: binding.investigationId, workspaceId: binding.workspaceId, baseVersionId: binding.baseVersionId,
    allowedFactIds, allowedMaterialIds, allowedCapabilities,
    budget: { maxMaterials: binding.budget.maxMaterials, maxBytes: binding.budget.maxBytes,
      maxRuleApplications: binding.budget.maxRuleApplications, maximumAttempts: binding.budget.maximumAttempts,
      deadline: new Date(binding.budget.deadline).toISOString() } };
}

function emptyUsage() { return { materials: 0, bytes: 0, ruleApplications: 0, attempts: 1 }; }

function assertBudgetDeadline(binding) {
  requireF002(Date.parse(binding.budget.deadline) > Date.now(), "F002_REQUEST_BUDGET_DEADLINE_EXCEEDED",
    "调查预算截止已过，不能继续取证", { status: 409 });
}

// A consumer binding is intentionally volatile: it carries the current
// authorization scope.  An investigation budget is not.  Keeping these
// identities separate prevents a harmless scope expansion from minting a
// second budget account for the same frozen investigation baseline.
function budgetAccountDigest(row) {
  return canonicalDigest("INVESTIGATION_BUDGET_ACCOUNT", {
    workspaceId: row.workspace_id,
    investigationId: row.investigation_id,
    baseVersionId: row.base_version_id,
  });
}

function budgetExceeded(account, usage, budget) {
  return Number(account.reserved_materials) + Number(account.settled_materials) + usage.materials > budget.maxMaterials
    || Number(account.reserved_bytes) + Number(account.settled_bytes) + usage.bytes > budget.maxBytes
    || Number(account.reserved_rule_applications) + Number(account.settled_rule_applications) + usage.ruleApplications > budget.maxRuleApplications
    || Number(account.reserved_attempts) + Number(account.settled_attempts) + usage.attempts > budget.maximumAttempts;
}

function normalizedReadBinding(binding, row, workspaceId) {
  requireF002(binding && typeof binding === "object" && binding.workspaceId === workspaceId
    && binding.investigationId === row.investigation_id && binding.baseVersionId === row.base_version_id,
  "F002_CONSUMER_REJECTED", "调查上下文无法证明当前结果仍可读取", { status: 403 });
  const allowedRequestIds = strings(binding.allowedRequestIds ?? [], "binding.allowedRequestIds", { max: 200_000 });
  requireF002(allowedRequestIds.includes(row.id), "F002_CONSUMER_REJECTED", "调查范围不允许读取此取证结果", { status: 403 });
}

function publicRequest(row) {
  return { id: row.id, operationId: row.operation_id, investigationId: row.investigation_id, baseVersionId: row.base_version_id,
    cancelOperationId: row.cancel_operation_id ?? null,
    requestKind: row.request_kind, status: row.state, outcome: row.outcome, result: row.result,
    revision: row.revision, derivedRunId: row.derived_run_id ?? null, derivedScopeId: row.derived_scope_id ?? null, diagnostic: row.diagnostic ?? null,
    createdAt: new Date(row.created_at).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null };
}

function investigationReference(investigationId, baseVersionId) {
  requireF002(typeof investigationId === "string" && investigationId.length > 0 && investigationId.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(investigationId) && typeof baseVersionId === "string" && /^[a-f0-9]{64}$/.test(baseVersionId),
  "F002_REQUEST_INVALID", "缺少精确调查与基准事实集", { status: 422 });
}

function requestSummary(row) {
  const { id, investigationId, baseVersionId, revision, status, outcome, createdAt } = publicRequest(row);
  return { id, investigationId, baseVersionId, revision, status, outcome, createdAt,
    questionSummary: row.request_input ? Array.from(row.request_input.question).slice(0, 240).join("") : null,
    scope: row.request_input ? { factRefs: row.request_input.factRefs, materialRefs: row.request_input.materialRefs } : null,
    updatedAt: new Date(row.updated_at).toISOString() };
}

function storedInput(request) {
  return { operationId: request.operationId, investigationId: request.investigationId, baseVersionId: request.baseVersionId,
    requestKind: request.requestKind, question: request.question, materialRefs: request.materialRefs, factRefs: request.factRefs,
    requestedCapabilities: request.requestedCapabilities };
}

function includesAll(values, required) {
  const available = new Set(values);
  return required.every((value) => available.has(value));
}

function comparableRecords(records) {
  return canonicalDigest("FACT_SET_RECORDS", { records: records.map((record) => ({ kind: record.kind, id: record.id, payload: record.payload }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.kind, "utf8"), Buffer.from(right.kind, "utf8")) || Buffer.compare(Buffer.from(left.id, "utf8"), Buffer.from(right.id, "utf8"))) });
}

// This is an F002-owned expansion service, not a consumer callback. It uses
// the same durable source binding, worker and publication path as ordinary
// analysis; a request can only nominate already-authorized material IDs and
// installed capabilities. It never accepts caller supplied facts or bytes.
export class F002RequestDerivationService {
  constructor({ repository, admission, worker, publication } = {}) {
    if (!repository?.withAuthorizedWorkspace || !repository?.createAdmittedRun || !repository?.getScope || !repository?.cancelRequestScope
      || !admission || typeof admission.inventory !== "function" || !worker || typeof worker.run !== "function"
      || !publication || typeof publication.publish !== "function") {
      throw new TypeError("F002 request derivation requires F001 admission and F002 execution services");
    }
    this.repository = repository;
    this.admission = admission;
    this.worker = worker;
    this.publication = publication;
  }

  async plan(actor, workspaceId, request) {
    const plan = await this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const context = (await tx.query(`SELECT fact_set.run_id, fact_set.scope_id, run.source_input, profile.payload AS base_profile
        FROM f002_fact_set fact_set
        JOIN f002_run run ON run.workspace_id=fact_set.workspace_id AND run.id=fact_set.run_id
        JOIN f002_profile profile ON profile.id=fact_set.profile_id
        WHERE fact_set.workspace_id=$1 AND fact_set.graph_version_id=$2`, [workspaceId, request.baseVersionId])).rows[0];
      requireF002(context, "F002_VERSION_NOT_FOUND", "调查绑定的事实集版本不存在", { status: 404 });
      const records = (await tx.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2", [workspaceId, request.baseVersionId])).rows;
      const materials = new Map(records.filter((record) => record.kind === "MATERIAL").map((record) => [record.id, record.payload]));
      const objects = new Map(records.filter((record) => record.kind === "OBJECT").map((record) => [record.id, record.payload]));
      const facts = new Map(records.filter((record) => record.kind === "FACT").map((record) => [record.id, record.payload]));
      const materialIds = new Set(request.materialRefs);
      for (const factId of request.factRefs) {
        const fact = facts.get(factId);
        if (!fact) continue;
        for (const objectId of [fact.subjectId, fact.targetId].filter(Boolean)) {
          const object = objects.get(objectId);
          if (object?.materialId) materialIds.add(object.materialId);
        }
      }
      const selected = [...materialIds].map((materialId) => ({ materialId, payload: materials.get(materialId) }));
      if (selected.some((item) => !item.payload)) {
        return { kind: "LIMITATION", result: { code: "F002_REQUEST_TARGET_UNPROVEN", checkedFactRefs: request.factRefs, checkedMaterialRefs: request.materialRefs, baseVersionId: request.baseVersionId } };
      }
      if (selected.length === 0) {
        return { kind: "LIMITATION", result: { code: "F002_REQUEST_TARGET_UNPROVEN", checkedFactRefs: request.factRefs, checkedMaterialRefs: request.materialRefs, baseVersionId: request.baseVersionId } };
      }
      const requiredCapabilities = [...new Set([...context.base_profile.capabilityIds, ...request.requestedCapabilities])];
      const profiles = (await tx.query("SELECT id,payload,startable FROM f002_profile WHERE startable=true ORDER BY id")).rows
        .map((row) => ({ ...row.payload, startable: row.startable }))
        .filter((profile) => includesAll(profile.capabilityIds, requiredCapabilities))
        .sort((left, right) => left.capabilityIds.length - right.capabilityIds.length || Buffer.compare(Buffer.from(left.id, "ascii"), Buffer.from(right.id, "ascii")));
      const profile = profiles[0] ?? null;
      if (!profile || profile.id === context.base_profile.id) {
        return { kind: "LIMITATION", result: { code: "F002_REQUEST_CAPABILITY_UNSUPPORTED", requestedCapabilities: request.requestedCapabilities, baseVersionId: request.baseVersionId } };
      }
      return {
        kind: "DERIVE", baseRunId: context.run_id, sourceInput: context.source_input, profile, baseRecords: records,
        selections: selected.map(({ payload }) => ({ kind: "ENTRY", componentId: payload.componentId, pathBytes: payload.pathBytes })),
        materials: selected,
      };
    });
    if (plan.kind !== "DERIVE") return { ...plan, usage: emptyUsage() };
    const inventory = new Map();
    let cursor = null;
    const seenCursors = new Set();
    do {
      const page = await this.admission.inventory(actor, workspaceId, plan.baseRunId, { limit: 1000, cursor });
      requireF002(page && Array.isArray(page.items), "F002_REQUEST_SOURCE_INVALID", "冻结材料清单无效", { status: 409 });
      for (const item of page.items) inventory.set(`${item.componentId}\u0000${item.entry.pathBytes}`, item);
      cursor = page.nextCursor ?? null;
      requireF002(!cursor || !seenCursors.has(cursor), "F002_REQUEST_SOURCE_INVALID", "冻结材料清单分页循环", { status: 409 });
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    let bytes = 0;
    for (const { payload } of plan.materials) {
      const item = inventory.get(`${payload.componentId}\u0000${payload.pathBytes}`);
      requireF002(item, "F002_REQUEST_TARGET_UNPROVEN", "请求材料不属于冻结来源", { status: 409 });
      if (item.disposition?.disposition === "VERIFIED" && /^\d+$/.test(item.entry?.sizeBytes ?? "")) {
        const size = Number(item.entry.sizeBytes);
        requireF002(Number.isSafeInteger(size), "F002_REQUEST_SOURCE_INVALID", "请求材料字节数超出安全范围", { status: 409 });
        bytes += size;
      }
    }
    return { ...plan, usage: { materials: plan.materials.length, bytes, ruleApplications: plan.materials.length * request.requestedCapabilities.length, attempts: 1 } };
  }

  async derive(actor, workspaceId, requestId, request, plan, { workerId, leaseMs, requestGeneration, assertRequestActive }) {
    if (plan.kind !== "DERIVE") return plan;
    requireF002(Number.isInteger(requestGeneration) && requestGeneration > 0, "F002_STALE_REQUEST_WORKER", "取证请求执行代次无效", { status: 409 });
    requireF002(typeof assertRequestActive === "function", "F002_REQUEST_GUARD_INVALID", "取证请求缺少调查状态围栏", { status: 409 });
    await assertRequestActive();
    const operation = `request-${requestId}`;
    const run = await this.repository.createAdmittedRun(actor, workspaceId, {
      operationId: operation, sourceInput: plan.sourceInput, profile: plan.profile,
      scopes: [{ label: `request:${requestId}`, selections: plan.selections }],
      afterCreate: async (tx, created) => {
        const scope = created.scopes[0];
        const requestRow = (await tx.query("SELECT * FROM f002_request WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, requestId])).rows[0];
        requireF002(requestRow && requestRow.state === "RUNNING" && requestRow.generation === requestGeneration
          && new Date(requestRow.lease_until).getTime() > Date.now(),
        "F002_STALE_REQUEST_WORKER", "取证请求已停止，不能创建补提范围", { status: 409 });
        await tx.query(`UPDATE f002_request SET derived_run_id=$3,derived_scope_id=$4
          WHERE workspace_id=$1 AND id=$2 AND state='RUNNING' AND generation=$5`,
        [workspaceId, requestId, created.runId, scope.scopeId, requestGeneration]);
        await tx.query("INSERT INTO f002_request_event (request_id,event_type,payload) VALUES ($1,$2,$3)",
          [requestId, "REQUEST_DERIVATION_LINKED", JSON.stringify({ runId: created.runId, scopeId: scope.scopeId, generation: requestGeneration })]);
      },
    });
    let scope = run.scopes[0];
    requireF002(scope, "F002_REQUEST_DERIVATION_INVALID", "取证补提没有持久范围", { status: 409 });
    if (scope.status === "SEALED") return this.#resultFromSealed(actor, workspaceId, request, plan, run.id, scope.graphVersionId);
    if (scope.status === "CANCELLED") return { kind: "LIMITATION", result: { code: "F002_REQUEST_NO_NEW_OUTPUT", baseVersionId: request.baseVersionId } };
    if (scope.status !== "READY_TO_SEAL") {
      await assertRequestActive();
      scope = await this.worker.run(actor, workspaceId, run.id, scope.scopeId, {
        workerId: `${workerId}-derive`, leaseMs, requestId, requestGeneration,
      });
    }
    requireF002(scope.status === "READY_TO_SEAL", "F002_REQUEST_DERIVATION_PENDING", "取证补提尚未完成", { status: 503 });
    const newRecords = await this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) =>
      (await tx.query("SELECT kind,id,payload FROM f002_prepared_record WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 ORDER BY kind,id", [workspaceId, run.id, scope.scopeId])).rows);
    if (comparableRecords(newRecords) === comparableRecords(plan.baseRecords)) {
      await assertRequestActive();
      await this.repository.cancelRequestScope(actor, workspaceId, run.id, scope.scopeId, {
        requestId, requestGeneration, revision: scope.revision, operationId: `nochange-${requestId}`, reason: "F002_REQUEST_NO_NEW_OUTPUT",
      });
      return { kind: "LIMITATION", result: { code: "F002_REQUEST_NO_NEW_OUTPUT", baseVersionId: request.baseVersionId } };
    }
    const sealed = await this.publication.publish(actor, workspaceId, run.id, scope.scopeId, {
      revision: scope.revision, operationId: `seal-${requestId}`, requestGuard: { requestId, generation: requestGeneration, revalidate: assertRequestActive },
    });
    return this.#resultFromSealed(actor, workspaceId, request, plan, run.id, sealed.graphVersionId);
  }

  async #resultFromSealed(actor, workspaceId, request, plan, runId, graphVersionId) {
    const records = await this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) =>
      (await tx.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2", [workspaceId, graphVersionId])).rows);
    const before = new Set(plan.baseRecords.map((record) => `${record.kind}\u0000${record.id}`));
    return { kind: "NEW_VERSION", result: {
      baseVersionId: request.baseVersionId, graphVersionId, derivedRunId: runId,
      addedRefs: records.filter((record) => !before.has(`${record.kind}\u0000${record.id}`)).map((record) => ({ kind: record.kind, id: record.id })),
      correctedRefs: [],
    } };
  }
}

export class F002RequestService {
  constructor(repository, { resolver = null, expansion = null, fulfill = null } = {}) {
    if (!repository?.withAuthorizedWorkspace || !repository?.withMaintainedWorkspace) throw new TypeError("F002 request service requires an authorized repository");
    if (resolver !== null && typeof resolver?.resolve !== "function") throw new TypeError("F002 consumer resolver must resolve trusted investigations");
    if (expansion !== null && (typeof expansion?.plan !== "function" || typeof expansion?.derive !== "function")) throw new TypeError("F002 request expansion must use the F002 derivation contract");
    if (fulfill !== null) throw new TypeError("F002 request service does not accept an injected fulfiller");
    this.repository = repository;
    this.resolver = resolver;
    this.expansion = expansion;
  }

  // Read the existing resolver contract; this neither grants authority nor
  // reserves budget. Submission/execution still independently revalidate it.
  async investigation(actor, workspaceId, investigationId, baseVersionId) {
    investigationReference(investigationId, baseVersionId);
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async tx => {
      requireF002(this.resolver, "F002_CONSUMER_UNAVAILABLE", "调查消费方尚未接通，不能核对调查边界", { status: 503 });
      const binding = normalizedBinding(await this.resolver.resolve(actor, workspaceId, investigationId),
        { investigationId, baseVersionId, factRefs: [], materialRefs: [], requestedCapabilities: [] }, workspaceId);
      requireF002([binding.budget.maxMaterials, binding.budget.maxBytes, binding.budget.maxRuleApplications, binding.budget.maximumAttempts].every(Number.isSafeInteger),
        "F002_CONSUMER_REJECTED", "调查允许边界超出准确计量范围", { status: 403 });
      const version = (await tx.query("SELECT 1 FROM f002_fact_set WHERE workspace_id=$1 AND graph_version_id=$2", [workspaceId, baseVersionId])).rows[0];
      requireF002(version, "F002_VERSION_NOT_FOUND", "调查绑定的事实集版本不存在", { status: 404 });
      const account = (await tx.query(`SELECT * FROM f002_request_budget_account
        WHERE workspace_id=$1 AND investigation_id=$2 AND binding_digest=$3`,
      [workspaceId, investigationId, budgetAccountDigest({ workspace_id: workspaceId, investigation_id: investigationId, base_version_id: baseVersionId })])).rows[0];
      requireF002(!account || canonicalDigest("REQUEST_BUDGET", account.budget) === canonicalDigest("REQUEST_BUDGET", binding.budget),
        "F002_CONSUMER_REJECTED", "调查预算已变化，不能把旧账户当成当前允许边界", { status: 403 });
      const usage = Object.fromEntries([["materials", "materials"], ["bytes", "bytes"], ["ruleApplications", "rule_applications"], ["attempts", "attempts"]]
        .map(([key, column]) => [key, account ? Number(account[`reserved_${column}`]) + Number(account[`settled_${column}`]) : 0]));
      requireF002(Object.values(usage).every(value => Number.isSafeInteger(value) && value >= 0),
        "F002_REQUEST_BUDGET_INVALID", "调查累计用量无法准确读取", { status: 409 });
      return { workspaceId, investigationId, baseVersionId, state: "RUNNING", budget: binding.budget, usage,
        allowedCapabilities: binding.allowedCapabilities };
    });
  }

  // Every candidate uses the same current READ check as GET /requests/:id.
  // A cursor names only a previously disclosed, currently authorized request;
  // denied IDs/counts never escape through a cursor or a total count.
  async list(actor, workspaceId, { investigationId, baseVersionId, limit = 20, cursor = null } = {}) {
    investigationReference(investigationId, baseVersionId);
    requireF002(Number.isInteger(limit) && limit >= 1 && limit <= 100
      && (cursor === null || (typeof cursor === "string" && /^[A-Za-z0-9-]{1,128}$/.test(cursor))),
    "F002_PAGE_INVALID", "请求分页定位或大小无效", { status: 422 });
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async tx => {
      requireF002(typeof this.resolver?.authorizeRead === "function", "F002_CONSUMER_UNAVAILABLE",
        "调查消费方尚未接通，不能读取请求清单", { status: 503 });
      if (cursor) {
        const row = (await tx.query("SELECT * FROM f002_request WHERE workspace_id=$1 AND id=$2", [workspaceId, cursor])).rows[0];
        requireF002(row && row.investigation_id === investigationId && row.base_version_id === baseVersionId,
          "F002_PAGE_INVALID", "分页定位不属于原调查与基准", { status: 422 });
        await this.#authorizeRead(actor, workspaceId, row);
      }
      const permitted = [];
      let after = cursor ?? "";
      // Bounded internal scanning is not a partial successful listing. If the
      // authorization density is too low, refuse and disclose no prefix.
      for (let scanned = 0; scanned < 1000; scanned += 100) {
        const rows = (await tx.query(`SELECT r.*,GREATEST(r.created_at,r.completed_at,
          (SELECT max(e.occurred_at) FROM f002_request_event e WHERE e.request_id=r.id)) AS updated_at
          FROM f002_request r WHERE r.workspace_id=$1 AND r.investigation_id=$2 AND r.base_version_id=$3
          AND r.id COLLATE "C" > $4 COLLATE "C" ORDER BY r.id COLLATE "C" LIMIT 100`,
        [workspaceId, investigationId, baseVersionId, after])).rows;
        for (const row of rows) {
          after = row.id;
          try { await this.#authorizeRead(actor, workspaceId, row); }
          catch (error) { if (error instanceof F002Error && error.code === "F002_CONSUMER_REJECTED") continue; throw error; }
          permitted.push(requestSummary(row));
          if (permitted.length > limit) return { items: permitted.slice(0, limit), nextCursor: permitted[limit - 1].id };
        }
        if (rows.length < 100) return { items: permitted, nextCursor: null };
      }
      throw new F002Error("F002_REQUEST_LIST_LIMIT", "请求清单超过单次授权复验界限；未返回部分成功结果", { status: 409 });
    });
  }

  async submit(actor, workspaceId, input) {
    const request = normalizedRequest(input);
    const existing = await this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) =>
      (await tx.query("SELECT * FROM f002_request WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3", [workspaceId, actor.actorId, request.operationId])).rows[0]);
    if (existing) {
      requireF002(existing.request_digest === request.digest, "F002_OPERATION_CONFLICT", "操作键已绑定不同取证请求");
      await this.#authorizeRead(actor, workspaceId, existing);
      return publicRequest(existing);
    }
    requireF002(this.resolver, "F002_CONSUMER_UNAVAILABLE", "调查消费方尚未接通，不能创建无主取证请求", { status: 503 });
    const { binding, bindingDigest } = await this.#resolveBinding(actor, workspaceId, request);
    return this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
      const raced = (await tx.query("SELECT * FROM f002_request WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3 FOR UPDATE", [workspaceId, actor.actorId, request.operationId])).rows[0];
      if (raced) {
        requireF002(raced.request_digest === request.digest, "F002_OPERATION_CONFLICT", "操作键已绑定不同取证请求");
        return publicRequest(raced);
      }
      const version = (await tx.query("SELECT 1 FROM f002_fact_set WHERE workspace_id=$1 AND graph_version_id=$2", [workspaceId, request.baseVersionId])).rows[0];
      requireF002(version, "F002_VERSION_NOT_FOUND", "调查绑定的事实集版本不存在", { status: 404 });
      const id = randomUUID();
      const row = (await tx.query(`INSERT INTO f002_request (id,workspace_id,actor_id,operation_id,request_digest,binding_digest,investigation_id,base_version_id,request_kind,state,request_input,budget)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'QUEUED',$10,$11) RETURNING *`,
      [id, workspaceId, actor.actorId, request.operationId, request.digest, bindingDigest, binding.investigationId, request.baseVersionId,
        request.requestKind, JSON.stringify(storedInput(request)), JSON.stringify(binding.budget)])).rows[0];
      await tx.query("INSERT INTO f002_request_event (request_id,event_type,payload) VALUES ($1,$2,$3)",
        [id, "REQUEST_QUEUED", JSON.stringify({ baseVersionId: request.baseVersionId, bindingDigest })]);
      return publicRequest(row);
    });
  }

  async execute(actor, workspaceId, requestId, { workerId, leaseMs = 60_000 } = {}) {
    requireF002(typeof requestId === "string" && /^[A-Za-z0-9-]{1,128}$/.test(requestId)
      && typeof workerId === "string" && workerId.length > 0 && Number.isInteger(leaseMs) && leaseMs >= 1_000 && leaseMs <= 60_000,
    "F002_REQUEST_EXECUTION_INVALID", "取证执行参数无效", { status: 422 });
    requireF002(this.resolver, "F002_CONSUMER_UNAVAILABLE", "调查消费方尚未接通，不能执行无主取证请求", { status: 503 });
    const claimed = await this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
      const { rows } = await tx.query(`UPDATE f002_request SET state='RUNNING',generation=generation+1,revision=revision+1,worker_id=$3,
          lease_until=clock_timestamp()+($4::integer * interval '1 millisecond')
        WHERE workspace_id=$1 AND id=$2 AND (state='QUEUED' OR (state='RUNNING' AND lease_until<=clock_timestamp())) RETURNING *`,
      [workspaceId, requestId, workerId, leaseMs]);
      requireF002(rows.length === 1, "F002_REQUEST_LEASE_BUSY", "取证请求已有有效执行者或不可执行", { status: 409 });
      await tx.query("INSERT INTO f002_request_event (request_id,event_type,payload) VALUES ($1,$2,$3)", [requestId, "REQUEST_CLAIMED", JSON.stringify({ generation: rows[0].generation, workerId })]);
      return rows[0];
    });
    let binding = null;
    try {
      const request = normalizedRequest(claimed.request_input);
      ({ binding } = await this.#resolveBinding(actor, workspaceId, request, claimed.binding_digest));
      const assertRequestActive = async () => {
        const current = await this.#resolveBinding(actor, workspaceId, request, claimed.binding_digest);
        assertBudgetDeadline(current.binding);
        return current.binding;
      };
      const availability = await this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
        const facts = new Set((await tx.query("SELECT id FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='FACT'", [workspaceId, request.baseVersionId])).rows.map((value) => value.id));
        const materials = new Set((await tx.query("SELECT id FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='MATERIAL'", [workspaceId, request.baseVersionId])).rows.map((value) => value.id));
        const profile = (await tx.query(`SELECT profile.payload FROM f002_fact_set fact_set
          JOIN f002_profile profile ON profile.id=fact_set.profile_id WHERE fact_set.workspace_id=$1 AND fact_set.graph_version_id=$2`, [workspaceId, request.baseVersionId])).rows[0]?.payload;
        requireF002(profile, "F002_VERSION_NOT_FOUND", "调查绑定的事实集版本不存在", { status: 404 });
        return { facts, materials, profile };
      });
      const existing = request.factRefs.length > 0 && request.factRefs.every((id) => availability.facts.has(id))
        && request.materialRefs.every((id) => availability.materials.has(id))
        && includesAll(availability.profile.capabilityIds, request.requestedCapabilities);
      const plan = existing ? null : this.expansion ? await this.expansion.plan(actor, workspaceId, request) : {
        kind: "LIMITATION", result: { code: "F002_REQUEST_TARGET_UNPROVEN", checkedFactRefs: request.factRefs, checkedMaterialRefs: request.materialRefs, baseVersionId: request.baseVersionId }, usage: emptyUsage(),
      };
      binding = await assertRequestActive();
      const reserved = await this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
        const row = (await tx.query("SELECT * FROM f002_request WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, requestId])).rows[0];
        requireF002(row && row.state === "RUNNING" && row.generation === claimed.generation && new Date(row.lease_until).getTime() > Date.now(),
          "F002_STALE_REQUEST_WORKER", "取证执行权或状态已变化", { status: 409 });
        const reservation = await this.#reserve(tx, row, binding, plan?.usage ?? emptyUsage());
        if (reservation !== true) {
          const code = reservation?.code ?? "F002_REQUEST_BUDGET_EXHAUSTED";
          const completed = (await tx.query(`UPDATE f002_request SET state='COMPLETED',revision=revision+1,outcome='LIMITATION',result=$4,completed_at=clock_timestamp(),lease_until=NULL
            WHERE workspace_id=$1 AND id=$2 AND state='RUNNING' AND generation=$3 RETURNING *`, [workspaceId, requestId, claimed.generation,
            JSON.stringify({ code, baseVersionId: request.baseVersionId })])).rows[0];
          requireF002(completed, "F002_STALE_REQUEST_WORKER", "取证执行权或状态已变化", { status: 409 });
          await tx.query("INSERT INTO f002_request_event (request_id,event_type,payload) VALUES ($1,$2,$3)", [requestId, "REQUEST_LIMITED", JSON.stringify({ code })]);
          return publicRequest(completed);
        }
        return row;
      });
      if (reserved.status) return reserved;
      const result = existing
        ? { outcome: "EXISTING_EVIDENCE", result: { factRefs: request.factRefs, materialRefs: request.materialRefs, baseVersionId: request.baseVersionId, bindingDigest: canonicalDigest("CONSUMER_BINDING", binding) } }
        : await this.#deriveResult(actor, workspaceId, requestId, request, plan, { workerId, leaseMs, requestGeneration: claimed.generation, assertRequestActive });
      binding = await assertRequestActive();
      return this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
        const row = (await tx.query("SELECT * FROM f002_request WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, requestId])).rows[0];
        requireF002(row && row.state === "RUNNING" && row.generation === claimed.generation && new Date(row.lease_until).getTime() > Date.now(),
          "F002_STALE_REQUEST_WORKER", "取证执行权或状态已变化", { status: 409 });
        const completed = (await tx.query(`UPDATE f002_request SET state='COMPLETED',revision=revision+1,outcome=$4,result=$5,completed_at=clock_timestamp(),lease_until=NULL
          WHERE workspace_id=$1 AND id=$2 AND state='RUNNING' AND generation=$3 RETURNING *`, [workspaceId, requestId, claimed.generation, result.outcome, JSON.stringify(result.result)])).rows[0];
        requireF002(completed, "F002_STALE_REQUEST_WORKER", "取证执行权或状态已变化", { status: 409 });
        await this.#settle(tx, row);
        await tx.query("INSERT INTO f002_request_event (request_id,event_type,payload) VALUES ($1,$2,$3)", [requestId, "REQUEST_COMPLETED", JSON.stringify({ outcome: result.outcome, bindingDigest: canonicalDigest("CONSUMER_BINDING", binding) })]);
        return publicRequest(completed);
      });
    } catch (error) {
      const rejection = error instanceof F002Error && error.code === "F002_CONSUMER_REJECTED";
      const limitation = error instanceof F002Error && error.code === "F002_REQUEST_BUDGET_DEADLINE_EXCEEDED";
      return this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
        const row = (await tx.query(`UPDATE f002_request SET state=$4,revision=revision+1,outcome=$5,result=$6,diagnostic=$7,completed_at=clock_timestamp(),lease_until=NULL
          WHERE workspace_id=$1 AND id=$2 AND state='RUNNING' AND generation=$3 RETURNING *`, [workspaceId, requestId, claimed.generation,
          rejection || limitation ? "COMPLETED" : "FAILED", rejection ? "REJECTED" : limitation ? "LIMITATION" : null,
          rejection ? JSON.stringify({ code: error.code }) : limitation ? JSON.stringify({ code: error.code, baseVersionId: claimed.base_version_id }) : null,
          JSON.stringify({ code: error instanceof F002Error ? error.code : "F002_REQUEST_RUNTIME_FAILURE" })])).rows[0];
        if (!row) throw error;
        const reservation = await this.#reservation(tx, row);
        if (reservation?.status === "RESERVED") await this.#settle(tx, row, reservation);
        if ((rejection || limitation) && row.derived_run_id && row.derived_scope_id) await this.#cancelDerivedScope(tx, actor, row, error.code);
        await tx.query("INSERT INTO f002_request_event (request_id,event_type,payload) VALUES ($1,$2,$3)", [requestId, rejection ? "REQUEST_REJECTED" : limitation ? "REQUEST_LIMITED" : "REQUEST_FAILED", JSON.stringify(row.diagnostic)]);
        return publicRequest(row);
      });
    }
  }

  async #deriveResult(actor, workspaceId, requestId, request, plan, execution) {
    if (plan.kind !== "DERIVE") return { outcome: "LIMITATION", result: plan.result };
    const derived = await this.expansion.derive(actor, workspaceId, requestId, request, plan, execution);
    return derived.kind === "NEW_VERSION" ? { outcome: "NEW_VERSION", result: derived.result } : { outcome: "LIMITATION", result: derived.result };
  }

  async get(actor, workspaceId, requestId) {
    requireF002(typeof requestId === "string" && /^[A-Za-z0-9-]{1,128}$/.test(requestId), "F002_REQUEST_INVALID", "取证请求定位符无效", { status: 422 });
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const row = (await tx.query("SELECT * FROM f002_request WHERE workspace_id=$1 AND id=$2", [workspaceId, requestId])).rows[0];
      requireF002(row, "F002_REQUEST_NOT_FOUND", "取证请求不存在", { status: 404 });
      await this.#authorizeRead(actor, workspaceId, row);
      return publicRequest(row);
    });
  }

  async findByOperation(actor, workspaceId, suppliedOperationId) {
    const stableOperationId = operationId(suppliedOperationId);
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const { rows } = await tx.query(`SELECT * FROM f002_request WHERE workspace_id=$1
        AND ((actor_id=$2 AND operation_id=$3) OR cancel_operation_id=$3) LIMIT 2`, [workspaceId, actor.actorId, stableOperationId]);
      requireF002(rows.length <= 1, "F002_OPERATION_CONFLICT", "操作键对应多个取证请求回执", { status: 409 });
      const row = rows[0];
      if (!row) return null;
      await this.#authorizeRead(actor, workspaceId, row);
      return publicRequest(row);
    });
  }

  async cancel(actor, workspaceId, requestId, { revision, operationId: cancelOperationId } = {}) {
    requireF002(typeof requestId === "string" && /^[A-Za-z0-9-]{1,128}$/.test(requestId), "F002_REQUEST_INVALID", "取证请求定位符无效", { status: 422 });
    operationId(cancelOperationId);
    requireF002(Number.isInteger(revision) && revision > 0, "F002_REQUEST_REVISION_CONFLICT", "缺少当前取证请求修订", { status: 409 });
    const current = await this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) =>
      (await tx.query("SELECT * FROM f002_request WHERE workspace_id=$1 AND id=$2", [workspaceId, requestId])).rows[0]);
    requireF002(current, "F002_REQUEST_NOT_FOUND", "取证请求不存在", { status: 404 });
    await this.#resolveBinding(actor, workspaceId, normalizedRequest(current.request_input));
    return this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
      const row = (await tx.query("SELECT * FROM f002_request WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, requestId])).rows[0];
      requireF002(row, "F002_REQUEST_NOT_FOUND", "取证请求不存在", { status: 404 });
      if (row.state === "CANCELLED") {
        requireF002(row.cancel_operation_id === cancelOperationId, "F002_REQUEST_REVISION_CONFLICT", "取证请求已由其他取消操作终止", { status: 409 });
        return publicRequest(row);
      }
      requireF002(!["COMPLETED", "FAILED"].includes(row.state) && row.revision === revision,
        "F002_REQUEST_REVISION_CONFLICT", "取证请求修订或状态已变化", { status: 409 });
      const cancelled = (await tx.query(`UPDATE f002_request SET state='CANCELLED',revision=revision+1,cancel_operation_id=$3,
          diagnostic=$4,completed_at=clock_timestamp(),lease_until=NULL WHERE workspace_id=$1 AND id=$2 RETURNING *`,
      [workspaceId, requestId, cancelOperationId, JSON.stringify({ code: "CANCELLED", operationId: cancelOperationId })])).rows[0];
      if (row.derived_run_id && row.derived_scope_id) {
        const scope = (await tx.query(`SELECT * FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE`,
          [workspaceId, row.derived_run_id, row.derived_scope_id])).rows[0];
        if (scope && !["SEALED", "CANCELLED"].includes(scope.status)) {
          await tx.query(`UPDATE f002_scope SET status='CANCELLED',revision=revision+1,lease_until=NULL,
              diagnostic=$4,updated_at=clock_timestamp() WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3`,
          [workspaceId, row.derived_run_id, row.derived_scope_id, JSON.stringify({ code: "CANCELLED_BY_REQUEST", requestId, operationId: cancelOperationId })]);
          await tx.query("INSERT INTO f002_event (workspace_id,run_id,scope_id,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5,$6)",
            [workspaceId, row.derived_run_id, row.derived_scope_id, actor.actorId, "SCOPE_CANCELLED_BY_REQUEST", JSON.stringify({ requestId, operationId: cancelOperationId })]);
        }
      }
      await this.#release(tx, row);
      await tx.query("INSERT INTO f002_request_event (request_id,event_type,payload) VALUES ($1,$2,$3)", [requestId, "REQUEST_CANCELLED", JSON.stringify({ operationId: cancelOperationId })]);
      return publicRequest(cancelled);
    });
  }

  async #reserve(tx, row, binding, usage) {
    if (Date.parse(binding.budget.deadline) <= Date.now()) return { code: "F002_REQUEST_BUDGET_DEADLINE_EXCEEDED" };
    const budget = binding.budget;
    const accountDigest = budgetAccountDigest(row);
    await tx.query(`INSERT INTO f002_request_budget_account
      (workspace_id,investigation_id,binding_digest,budget)
      VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,investigation_id,binding_digest) DO NOTHING`,
    [row.workspace_id, row.investigation_id, accountDigest, JSON.stringify(budget)]);
    const account = (await tx.query(`SELECT * FROM f002_request_budget_account WHERE workspace_id=$1 AND investigation_id=$2 AND binding_digest=$3 FOR UPDATE`,
      [row.workspace_id, row.investigation_id, accountDigest])).rows[0];
    requireF002(canonicalDigest("REQUEST_BUDGET", account.budget) === canonicalDigest("REQUEST_BUDGET", budget),
      "F002_CONSUMER_REJECTED", "调查预算身份已绑定不同内容", { status: 403 });
    const existing = (await tx.query("SELECT * FROM f002_request_budget_reservation WHERE request_id=$1 FOR UPDATE", [row.id])).rows[0];
    if (existing) return existing.status !== "RELEASED";
    if (budgetExceeded(account, usage, budget)) return false;
    await tx.query(`UPDATE f002_request_budget_account SET reserved_materials=reserved_materials+$4,reserved_bytes=reserved_bytes+$5,
        reserved_rule_applications=reserved_rule_applications+$6,reserved_attempts=reserved_attempts+$7,updated_at=clock_timestamp()
      WHERE workspace_id=$1 AND investigation_id=$2 AND binding_digest=$3`,
    [row.workspace_id, row.investigation_id, accountDigest, usage.materials, usage.bytes, usage.ruleApplications, usage.attempts]);
    await tx.query(`INSERT INTO f002_request_budget_reservation
      (request_id,workspace_id,investigation_id,binding_digest,materials,bytes,rule_applications,attempts,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RESERVED')`,
    [row.id, row.workspace_id, row.investigation_id, accountDigest, usage.materials, usage.bytes, usage.ruleApplications, usage.attempts]);
    return true;
  }

  async #cancelDerivedScope(tx, actor, row, code) {
    const scope = (await tx.query(`SELECT * FROM f002_scope WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 FOR UPDATE`,
      [row.workspace_id, row.derived_run_id, row.derived_scope_id])).rows[0];
    if (!scope || ["SEALED", "CANCELLED"].includes(scope.status)) return;
    await tx.query(`UPDATE f002_scope SET status='CANCELLED',revision=revision+1,lease_until=NULL,
        diagnostic=$4,updated_at=clock_timestamp() WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3`,
    [row.workspace_id, row.derived_run_id, row.derived_scope_id, JSON.stringify({ code: "CANCELLED_BY_REQUEST", requestId: row.id, reason: code })]);
    await tx.query("INSERT INTO f002_event (workspace_id,run_id,scope_id,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5,$6)",
      [row.workspace_id, row.derived_run_id, row.derived_scope_id, actor.actorId, "SCOPE_CANCELLED_BY_REQUEST", JSON.stringify({ requestId: row.id, reason: code })]);
  }

  async #settle(tx, row, reservation = null) {
    const held = reservation ?? await this.#reservation(tx, row);
    requireF002(held && held.status === "RESERVED" && held.binding_digest === budgetAccountDigest(row),
    "F002_REQUEST_BUDGET_CONFLICT", "取证预算预留状态无效", { status: 409 });
    await tx.query(`UPDATE f002_request_budget_account SET reserved_materials=reserved_materials-$4,reserved_bytes=reserved_bytes-$5,
        reserved_rule_applications=reserved_rule_applications-$6,reserved_attempts=reserved_attempts-$7,
        settled_materials=settled_materials+$4,settled_bytes=settled_bytes+$5,
        settled_rule_applications=settled_rule_applications+$6,settled_attempts=settled_attempts+$7,updated_at=clock_timestamp()
      WHERE workspace_id=$1 AND investigation_id=$2 AND binding_digest=$3`,
    [row.workspace_id, row.investigation_id, budgetAccountDigest(row), held.materials, held.bytes, held.rule_applications, held.attempts]);
    await tx.query("UPDATE f002_request_budget_reservation SET status='SETTLED',settled_at=clock_timestamp() WHERE request_id=$1", [row.id]);
  }

  async #release(tx, row) {
    const reservation = await this.#reservation(tx, row);
    if (!reservation || reservation.status !== "RESERVED") return;
    await tx.query(`UPDATE f002_request_budget_account SET reserved_materials=reserved_materials-$4,reserved_bytes=reserved_bytes-$5,
        reserved_rule_applications=reserved_rule_applications-$6,reserved_attempts=reserved_attempts-$7,updated_at=clock_timestamp()
      WHERE workspace_id=$1 AND investigation_id=$2 AND binding_digest=$3`,
    [row.workspace_id, row.investigation_id, budgetAccountDigest(row), reservation.materials, reservation.bytes, reservation.rule_applications, reservation.attempts]);
    await tx.query("UPDATE f002_request_budget_reservation SET status='RELEASED' WHERE request_id=$1", [row.id]);
  }

  async #authorizeRead(actor, workspaceId, row) {
    requireF002(this.resolver && typeof this.resolver.authorizeRead === "function", "F002_CONSUMER_UNAVAILABLE",
      "调查消费方尚未接通，不能读取无主取证结果", { status: 503 });
    normalizedReadBinding(await this.resolver.authorizeRead(actor, workspaceId, row.investigation_id, row.id), row, workspaceId);
  }

  async #resolveBinding(actor, workspaceId, request, expectedDigest = null) {
    const binding = normalizedBinding(await this.resolver.resolve(actor, workspaceId, request.investigationId), request, workspaceId);
    const bindingDigest = canonicalDigest("CONSUMER_BINDING", binding);
    if (expectedDigest !== null) requireF002(bindingDigest === expectedDigest, "F002_CONSUMER_REJECTED", "调查授权或预算已变化，不能复用旧请求", { status: 403 });
    return { binding, bindingDigest };
  }

  async #reservation(tx, row) {
    return (await tx.query("SELECT * FROM f002_request_budget_reservation WHERE request_id=$1 FOR UPDATE", [row.id])).rows[0] ?? null;
  }
}

export class F002RequestExecutionService {
  constructor({ repository, requests, members = [], resolveActor = null, workerId = `f002-request-${process.pid}`, leaseMs = 60_000, pollIntervalMs = 5_000, maxConcurrent = 2 } = {}) {
    if (typeof repository?.findRunnableRequests !== "function" || typeof requests?.execute !== "function" || !Array.isArray(members)
      || !members.every((member) => member?.actorId && member?.tenantId) || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) {
      throw new TypeError("F002 request execution service configuration is invalid");
    }
    this.repository = repository; this.requests = requests; this.members = new Map(members.map((member) => [member.actorId, { actorId: member.actorId, tenantId: member.tenantId }]));
    if (resolveActor !== null && typeof resolveActor !== "function") throw new TypeError("Invalid execution actor resolver");
    this.resolveActor = resolveActor ?? (actorId => this.members.get(actorId));
    this.workerId = workerId; this.leaseMs = leaseMs; this.pollIntervalMs = pollIntervalMs; this.maxConcurrent = maxConcurrent; this.timer = null; this.running = new Map();
  }

  async start() { if (!this.timer) { this.timer = setInterval(() => { void this.dispatch(); }, this.pollIntervalMs); this.timer.unref(); } await this.dispatch(); }
  async close() { if (this.timer) clearInterval(this.timer); this.timer = null; await Promise.allSettled(this.running.values()); }
  async enqueue(request) { return this.#schedule({ workspaceId: request.workspaceId, requestId: request.id, actorId: request.actorId, status: request.status }); }
  async dispatch() { await Promise.all((await this.repository.findRunnableRequests({ limit: this.maxConcurrent * 4 })).map((request) => this.#schedule(request))); }
  #schedule(request) {
    if (!request?.workspaceId || !request?.requestId || !["QUEUED", "RUNNING"].includes(request.status)) return Promise.resolve();
    const key = `${request.workspaceId}\u0000${request.requestId}`;
    if (this.running.has(key) || this.running.size >= this.maxConcurrent) return this.running.get(key) ?? Promise.resolve();
    const task = Promise.resolve().then(async () => {
      const actor = await this.resolveActor(request.actorId, request.workspaceId);
      if (actor) await this.requests.execute(actor, request.workspaceId, request.requestId, { workerId: this.workerId, leaseMs: this.leaseMs });
    })
      .catch(() => {}).finally(() => this.running.delete(key));
    this.running.set(key, task); return task;
  }
}

export { F002Error };
