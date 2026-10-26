import { randomUUID } from "node:crypto";
import { authorityFromDecision, createDecision, canonicalJson } from "../domain/index.js";
import { PostgresTraceabilityStore } from "../storage/postgres/postgres-traceability-store.js";
import { publicationDigest as digest } from "./publication-authority.js";
import { requireF003 } from "./errors.js";

const text = (v, max = 256) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const positive = v => Number.isSafeInteger(v) && v > 0;
const iso = v => v ? new Date(v).toISOString() : null;
function exact(value, keys) {
  requireF003(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k)),
    "F003_BINDING_INPUT_INVALID", "映射包含未定义字段", { status: 422 });
}
function object(graph, key) {
  const value = [...graph.candidates, ...graph.relations].find(p => p.key === key);
  requireF003(value && value.state !== "QUARANTINED", "F003_BINDING_OBJECT_INVALID", "映射须选择此精确图谱的非隔离命题或关系", { status: 422 });
  return value;
}
function readStore(tx) {
  // Read methods only. Authorization and the transaction belong to the outer
  // F001 Workspace fence, not a nested Store/identity transaction.
  return new PostgresTraceabilityStore({ query: (sql, args) => tx.query(sql, args), exec: sql => tx.query(sql) });
}

export class F003AuthorityService {
  constructor({ sources, publications, verifyExecution = null, clock = () => new Date() }) {
    if (!sources?.audit || !publications?.withPublishedVersion) throw new TypeError("F003 authority requires governed publication and Workspace fences");
    Object.assign(this, { sources, publications, verifyExecution, clock });
  }
  async #claim(tx, workspaceId, target, { current = false } = {}) {
    const row = (await tx.query(`SELECT c.*,s.scope,s.effective_from,s.effective_to,
      (SELECT max(version) FROM claim WHERE project_id=c.project_id AND id=c.id) AS current_claim_version,
      (SELECT max(version) FROM feature_version WHERE project_id=c.project_id AND feature_id=c.feature_id) AS current_feature_version
      FROM claim c JOIN claim_scope s ON s.project_id=c.project_id AND s.id=c.scope_id AND s.version=c.scope_version
      JOIN feature_version f ON f.project_id=c.project_id AND f.feature_id=c.feature_id AND f.version=$4
      WHERE c.project_id=$1 AND c.id=$2 AND c.version=$3`, [workspaceId, target.claimId, target.claimVersion, target.featureVersion])).rows[0];
    requireF003(row && row.feature_id === target.featureId && row.scope_id === target.scopeId && row.scope_version === target.scopeVersion,
      "F003_AUTHORITY_REFERENCE_MISMATCH", "Feature、Claim版本与范围不属于同一权威绑定", { status: 422 });
    if (current) requireF003(row.current_claim_version === target.claimVersion && row.current_feature_version === target.featureVersion,
      "F003_AUTHORITY_VERSION_CONFLICT", "权威版本已变化，请刷新并明确选择当前版本");
    return row;
  }
  async #executionTarget(tx, workspaceId, target, ref) {
    exact(ref, ["testSpecId", "testSpecVersion", "snapshotManifestId", "deploymentId"]);
    requireF003(["testSpecId", "snapshotManifestId", "deploymentId"].every(k => text(ref[k])) && positive(ref.testSpecVersion),
      "F003_BINDING_INPUT_INVALID", "执行目标须固定TestSpec版本和真实环境", { status: 422 });
    const store = readStore(tx), spec = await store.getTestSpec(workspaceId, ref.testSpecId, ref.testSpecVersion);
    const snapshot = await store.getSnapshotManifest(workspaceId, ref.snapshotManifestId);
    requireF003(spec?.approved && spec.featureId === target.featureId
      && spec.verifiesClaims.some(c => c.id === target.claimId && c.version === target.claimVersion)
      && snapshot?.components.deployment?.id === ref.deploymentId,
    "F003_EXECUTION_TARGET_MISMATCH", "TestSpec、Claim版本与环境不匹配", { status: 422 });
    return { spec, snapshot };
  }
  async bind(actor, workspaceId, revisionId, input) {
    exact(input, ["operationId", "expectedGraphDigest", "objectKey", "expectedVersion", "rationale", "targets"]);
    requireF003(text(input.operationId, 128) && text(input.objectKey, 128) && /^[a-f0-9]{64}$/.test(input.expectedGraphDigest ?? "")
      && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0 && text(input.rationale, 16384)
      && Array.isArray(input.targets) && input.targets.length <= 50,
    "F003_BINDING_INPUT_INVALID", "请明确图谱、对象、比较版本、范围与映射理由", { status: 422 });
    return this.publications.withPublishedVersion(actor, workspaceId, revisionId, true, async (tx, { graph }) => {
      requireF003(graph.digest === input.expectedGraphDigest, "F003_GRAPH_CONFLICT", "图谱摘要与选定发布版本不一致");
      object(graph, input.objectKey);
      const requestDigest = digest({ revisionId, input }), prior = (await tx.query(`SELECT payload,request_digest FROM f003_authority_binding_set
        WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3`, [workspaceId, actor.actorId, input.operationId])).rows[0];
      if (prior) {
        requireF003(prior.request_digest === requestDigest, "F003_OPERATION_CONFLICT", "此操作键已绑定不同映射");
        return { bindingSet: prior.payload, replayed: true };
      }
      const last = await this.#latest(tx, workspaceId, revisionId, input.objectKey);
      requireF003((last?.version ?? 0) === input.expectedVersion, "F003_BINDING_CONFLICT", "对象映射集合已经变化");
      const targets = [], seen = new Set(); let executionTargetCount = 0;
      for (const target of input.targets) {
        exact(target, ["featureId", "featureVersion", "claimId", "claimVersion", "scopeId", "scopeVersion", "verificationTargets"]);
        requireF003(["featureId", "claimId", "scopeId"].every(k => text(target[k]))
          && ["featureVersion", "claimVersion", "scopeVersion"].every(k => positive(target[k]))
          && Array.isArray(target.verificationTargets) && target.verificationTargets.length <= 20,
        "F003_BINDING_INPUT_INVALID", "权威命题必须固定身份、版本、范围和执行目标", { status: 422 });
        executionTargetCount += target.verificationTargets.length;
        requireF003(executionTargetCount <= 20, "F003_BINDING_INPUT_INVALID", "每个映射集合最多20个精确执行目标", { status: 422 });
        const row = await this.#claim(tx, workspaceId, target, { current: true });
        const key = canonicalJson([target.claimId, target.claimVersion]);
        requireF003(!seen.has(key), "F003_BINDING_INPUT_INVALID", "同一命题版本不可在集合中重复", { status: 422 }); seen.add(key);
        const contexts = new Set();
        for (const ref of target.verificationTargets) {
          requireF003(!contexts.has(canonicalJson(ref)), "F003_BINDING_INPUT_INVALID", "执行目标不可重复", { status: 422 });
          await this.#executionTarget(tx, workspaceId, target, ref); contexts.add(canonicalJson(ref));
        }
        targets.push({ ...structuredClone(target), scope: { id: row.scope_id, version: row.scope_version,
          scope: row.scope, effectiveFrom: iso(row.effective_from), effectiveTo: iso(row.effective_to) } });
      }
      const bindingSet = { id: randomUUID(), workspaceId, graphRevisionId: revisionId, graphDigest: graph.digest,
        sourceBundleId: graph.sourceBundleId, objectKey: input.objectKey, version: input.expectedVersion + 1,
        actorId: actor.actorId, rationale: input.rationale, targets, createdAt: this.clock().toISOString() };
      await tx.query(`INSERT INTO f003_authority_binding_set
        (workspace_id,graph_revision_id,object_key,version,id,actor_id,operation_id,request_digest,graph_digest,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [workspaceId, revisionId, input.objectKey, bindingSet.version, bindingSet.id,
        actor.actorId, input.operationId, requestDigest, graph.digest, JSON.stringify(bindingSet)]);
      await this.sources.audit(tx, workspaceId, null, actor.actorId, "F003_AUTHORITY_BOUND", {
        bindingId: bindingSet.id, graphRevisionId: revisionId, graphDigest: graph.digest, objectKey: input.objectKey, version: bindingSet.version });
      return { bindingSet, replayed: false };
    });
  }
  async #latest(tx, workspaceId, revisionId, objectKey) {
    return (await tx.query(`SELECT payload FROM f003_authority_binding_set WHERE workspace_id=$1 AND graph_revision_id=$2 AND object_key=$3
      ORDER BY version DESC LIMIT 1`, [workspaceId, revisionId, objectKey])).rows[0]?.payload ?? null;
  }
  async #executions(tx, workspaceId, target, ref) {
    const { spec, snapshot } = await this.#executionTarget(tx, workspaceId, target, ref), store = readStore(tx);
    const rows = (await tx.query(`SELECT id,created_at,status FROM test_execution WHERE project_id=$1 AND test_spec_id=$2 AND test_spec_version=$3
      AND snapshot_manifest_id=$4 AND deployment_component_id=$5 ORDER BY created_at DESC,id DESC LIMIT 21`,
    [workspaceId, ref.testSpecId, ref.testSpecVersion, ref.snapshotManifestId, ref.deploymentId])).rows;
    const history = [];
    for (const row of rows.slice(0, 20)) {
      const bundle = await store.getExecutionEvidence(workspaceId, row.id);
      let trusted = false;
      try {
        const expected = Object.fromEntries(["source", "build", "deployment", "runtime"].map(k => [k, { id: snapshot.components[k]?.id, digest: snapshot.components[k]?.digest }]));
        trusted = typeof this.verifyExecution === "function" && await this.verifyExecution(workspaceId, bundle)
          && bundle.evidence.length > 0 && bundle.evidence.every(e => canonicalJson(e.manifest.snapshotComponents) === canonicalJson(expected));
      } catch { /* Corrupt/unknown execution is never promoted. */ }
      history.push({ id: row.id, receivedAt: iso(row.created_at), status: trusted ? row.status : "UNKNOWN", trusted,
        evidenceRefs: trusted ? bundle.evidence.map(e => e.id) : [] });
    }
    const tied = history.length > 1 && history[0].receivedAt === history[1].receivedAt;
    return { ...ref, status: tied ? "UNKNOWN" : history[0]?.status ?? "NOT_RUN", history, truncated: rows.length > 20,
      ordering: tied ? "UNDETERMINED_RECEIPT_ORDER" : "SERVER_RECEIPT_TIME", testSpecApproved: spec.approved };
  }
  project(actor, workspaceId, revisionId, objectKey, { bindingVersion = null } = {}) {
    requireF003(text(objectKey, 128), "F003_BINDING_INPUT_INVALID", "请选择精确图谱对象", { status: 422 });
    requireF003(bindingVersion === null || positive(bindingVersion), "F003_BINDING_INPUT_INVALID", "映射版本必须为正整数", { status: 422 });
    return this.publications.withPublishedVersion(actor, workspaceId, revisionId, false, (tx, version) =>
      this.projectInVersion(tx, workspaceId, revisionId, version, objectKey, { bindingVersion }));
  }

  // Internal read primitive. The caller owns the current Workspace READ fence
  // and exact published version; never call project() recursively per node.
  async projectInVersion(tx, workspaceId, revisionId, { graph }, objectKey, { bindingVersion = null, latestBinding = undefined, now = this.clock(), readCache = new Map() } = {}) {
      const analysis = object(graph, objectKey);
      if (latestBinding === undefined) latestBinding = await this.#latest(tx, workspaceId, revisionId, objectKey);
      const bindingSet = bindingVersion === null ? latestBinding : (await tx.query(`SELECT payload FROM f003_authority_binding_set
        WHERE workspace_id=$1 AND graph_revision_id=$2 AND object_key=$3 AND version=$4`, [workspaceId, revisionId, objectKey, bindingVersion])).rows[0]?.payload;
      requireF003(bindingVersion === null || bindingSet, "F003_BINDING_VERSION_NOT_FOUND", "未找到此对象的映射修订", { status: 404 });
      const targets = [];
      const once = async (key, work) => {
        if (!readCache.has(key)) readCache.set(key, Promise.resolve().then(work));
        return readCache.get(key);
      };
      requireF003(!bindingSet || (bindingSet.graphRevisionId === revisionId && bindingSet.graphDigest === graph.digest
        && bindingSet.workspaceId === workspaceId && bindingSet.objectKey === objectKey),
      "F003_VERSION_CORRUPT", "权威映射不属于此精确发布修订");
      for (const target of bindingSet?.targets ?? []) {
        const targetKey=canonicalJson([target.featureId,target.featureVersion,target.claimId,target.claimVersion,target.scopeId,target.scopeVersion]);
        const row = await once(`claim:${targetKey}`,()=>this.#claim(tx, workspaceId, target));
        const decisionRows = await once(`decisions:${targetKey}`,async()=>(await tx.query(`SELECT * FROM human_decision WHERE project_id=$1 AND claim_id=$2 AND claim_version=$3
          AND scope_id=$4 AND scope_version=$5 ORDER BY append_sequence DESC LIMIT 101`, [workspaceId, target.claimId, target.claimVersion, target.scopeId, target.scopeVersion])).rows);
        const history = decisionRows.slice(0, 100).reverse().map(d => createDecision({
          id: d.id, claimId: d.claim_id, claimVersion: d.claim_version, scopeId: d.scope_id, scopeVersion: d.scope_version, type: d.decision_type,
          content: d.content, actorId: d.actor_id, actorRole: d.actor_role, evidenceRefs: d.evidence_refs, validUntil: iso(d.valid_until), createdAt: iso(d.created_at) }));
        const latest = history.at(-1) ?? null, scopeActive = (!row.effective_from || new Date(row.effective_from) <= now) && (!row.effective_to || new Date(row.effective_to) > now);
        const versionCurrent = row.current_claim_version === target.claimVersion && row.current_feature_version === target.featureVersion;
        const verification = [];
        for (const ref of target.verificationTargets) verification.push(await once(`execution:${targetKey}:${canonicalJson(ref)}`,
          ()=>this.#executions(tx, workspaceId, target, ref)));
        targets.push({ ...target, authority: { status: authorityFromDecision(latest, now), latestDecision: latest, history, historyTruncated: decisionRows.length > 100,
          scopeActive, versionCurrent, applies: scopeActive && versionCurrent && ["CONFIRMED", "EXCEPTION_RECORDED"].includes(authorityFromDecision(latest, now)) }, verification });
      }
      return { bindingSet: bindingSet ?? null, currentBindingVersion: latestBinding?.version ?? 0,
        projection: { kind: "DERIVED_AUTHORITY_AND_EXECUTION", workspaceId, graphRevisionId: revisionId, graphDigest: graph.digest,
        objectKey, analysisState: analysis.state, targets, evaluatedAt: now.toISOString() } };
  }

  async projectManyInVersion(tx, workspaceId, revisionId, version, keys) {
    requireF003(Array.isArray(keys) && keys.length <= 2048 && new Set(keys).size === keys.length,
      "F003_PROJECTION_LIMIT", "请缩小当前权威投影范围", { status: 422 });
    const rows = (await tx.query(`SELECT DISTINCT ON (object_key) object_key,payload FROM f003_authority_binding_set
      WHERE workspace_id=$1 AND graph_revision_id=$2 AND object_key=ANY($3::text[]) ORDER BY object_key,version DESC`,
    [workspaceId, revisionId, keys])).rows;
    // Explicit, fail-closed work bound, not partial green results from silently
    // truncated mappings. No write or new analysis is involved.
    requireF003(rows.reduce((n,r)=>n+r.payload.targets.length,0) <= 200
      && rows.reduce((n,r)=>n+r.payload.targets.reduce((m,t)=>m+t.verificationTargets.length,0),0) <= 80,
    "F003_PROJECTION_LIMIT", "映射目标超过有界查询，请明确更小对象范围", { status: 422 });
    const latest = new Map(rows.map(r=>[r.object_key,r.payload])), result = {}, now = this.clock(), readCache = new Map();
    for (const key of keys) {
      const p = await this.projectInVersion(tx, workspaceId, revisionId, version, key, { latestBinding: latest.get(key) ?? null, now, readCache });
      result[key] = p;
    }
    requireF003(Buffer.byteLength(JSON.stringify(result)) <= 4*1024*1024,
      "F003_PROJECTION_LIMIT", "权威历史超过有界查询，请明确更小对象范围", { status: 422 });
    return result;
  }
}
