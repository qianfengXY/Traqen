import { createHmac, timingSafeEqual } from "node:crypto";

import { F002Error, requireF002 } from "./errors.js";
import { canonicalDigest } from "./identity.js";
import { vocabularyFor } from "./vocabulary.js";

const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const coverageStates = ["DONE", "NOT_APPLICABLE", "UNSUPPORTED", "PARSE_FAILED", "PENDING", "RUNNING"];
const collections = new Map([
  ["materials", { kind: "MATERIAL" }], ["objects", { kind: "OBJECT" }], ["facts", { kind: "FACT" }],
  ["relations", { kind: "FACT", predicate: (record) => record.payload.kind === "RELATION" }], ["gaps", { kind: "GAP" }],
]);

function requireVersionId(graphVersionId) {
  requireF002(typeof graphVersionId === "string" && /^[a-f0-9]{64}$/.test(graphVersionId), "F002_VERSION_INVALID", "事实集版本定位符无效", { status: 422 });
}

function boundedLimit(limit = 100) {
  requireF002(Number.isInteger(limit) && limit >= 1 && limit <= 500, "F002_PAGE_INVALID", "分页大小必须在1到500之间", { status: 422 });
  return limit;
}

function recordOrder(left, right) { return compareUtf8(left.kind, right.kind) || compareUtf8(left.id, right.id); }

function collectionName(value) {
  requireF002(typeof value === "string" && collections.has(value), "F002_COLLECTION_INVALID", "记录清单类型无效", { status: 422 });
  return value;
}

function recordKind(value) {
  requireF002(typeof value === "string" && /^[A-Z_]{1,64}$/.test(value), "F002_RECORD_KIND_INVALID", "记录类型筛选无效", { status: 422 });
  return value;
}

function recordId(value) {
  requireF002(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "F002_RECORD_INVALID", "记录定位符无效", { status: 422 });
  return value;
}

function referencesFor(record, byKey) {
  const refs = [];
  const add = (role, kind, id) => {
    if (!id) return;
    const target = byKey.get(`${kind}\u0000${id}`);
    if (target) refs.push({ role, kind, id, payload: target.payload });
  };
  if (record.kind === "OBJECT") {
    add("material", "MATERIAL", record.payload.materialId);
    add("parent", "OBJECT", record.payload.parentId);
  }
  if (record.kind === "EVIDENCE") add("material", "MATERIAL", record.payload.materialId);
  if (record.kind === "FACT") {
    add("subject", "OBJECT", record.payload.subjectId);
    if (record.payload.kind === "RELATION") add("target", "OBJECT", record.payload.targetId);
    for (const id of record.payload.evidenceIds ?? []) add("evidence", "EVIDENCE", id);
    for (const id of record.payload.premiseFactIds ?? []) add("premise", "FACT", id);
  }
  if (record.kind === "GAP") {
    add("material", "MATERIAL", record.payload.materialId);
    add("object", "OBJECT", record.payload.objectId);
  }
  return refs;
}

export class F002QueryService {
  constructor(repository, { cursorSecret } = {}) {
    if (!repository?.withAuthorizedWorkspace) throw new TypeError("F002 queries require an authorized repository");
    if (typeof cursorSecret !== "string" || Buffer.byteLength(cursorSecret, "utf8") < 16) throw new TypeError("F002 queries require a cursor secret of at least 16 bytes");
    this.repository = repository;
    this.cursorSecret = Buffer.from(cursorSecret, "utf8");
  }

  async profiles(actor, workspaceId) {
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => (await tx.query("SELECT payload,startable FROM f002_profile ORDER BY id")).rows
      .map((row) => ({ ...row.payload, startable: row.startable })));
  }

  async versions(actor, workspaceId) {
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => (await tx.query(`SELECT graph_version_id,run_id,scope_id,profile_id,bundle_id,record_digest,published_at
      FROM f002_fact_set WHERE workspace_id=$1 ORDER BY published_at,graph_version_id`, [workspaceId])).rows.map((row) => ({
      graphVersionId: row.graph_version_id, runId: row.run_id, scopeId: row.scope_id, profileId: row.profile_id,
      bundleId: row.bundle_id, recordDigest: row.record_digest, publishedAt: new Date(row.published_at).toISOString(),
    })));
  }

  async activeRuns(actor, workspaceId) {
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const runs = (await tx.query(`SELECT r.id,r.profile_id,r.source_input,r.created_at
        FROM f002_run r WHERE r.workspace_id=$1 AND EXISTS (
          SELECT 1 FROM f002_scope s WHERE s.workspace_id=r.workspace_id AND s.run_id=r.id
          AND s.status IN ('QUEUED','RUNNING','READY_TO_SEAL','FAILED_RETRYABLE','BLOCKED'))
        ORDER BY r.created_at DESC,r.id LIMIT 100`, [workspaceId])).rows;
      const result = [];
      for (const run of runs) {
        const scopes = (await tx.query(`SELECT s.scope_id,s.label,s.status,s.revision,s.graph_version_id,s.diagnostic,
          EXISTS (SELECT 1 FROM f002_request q WHERE q.workspace_id=s.workspace_id AND q.derived_run_id=s.run_id AND q.derived_scope_id=s.scope_id) AS request_owned
          FROM f002_scope s WHERE s.workspace_id=$1 AND s.run_id=$2 ORDER BY s.scope_id`, [workspaceId, run.id])).rows;
        result.push({ id: run.id, profileId: run.profile_id, sourceInput: run.source_input, createdAt: new Date(run.created_at).toISOString(),
          scopes: scopes.map(scope => ({ scopeId: scope.scope_id, label: scope.label, status: scope.status, revision: scope.revision,
            graphVersionId: scope.graph_version_id, diagnostic: scope.diagnostic, requestOwned: scope.request_owned })) });
      }
      return result;
    });
  }

  async manifest(actor, workspaceId, graphVersionId) {
    requireVersionId(graphVersionId);
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const factSet = (await tx.query(`SELECT f.*,s.selections,s.status AS scope_status FROM f002_fact_set f
        JOIN f002_scope s ON s.workspace_id=f.workspace_id AND s.run_id=f.run_id AND s.scope_id=f.scope_id
        WHERE f.workspace_id=$1 AND f.graph_version_id=$2`, [workspaceId, graphVersionId])).rows[0];
      requireF002(factSet, "F002_VERSION_NOT_FOUND", "事实集版本不存在", { status: 404 });
      const recordRows = (await tx.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 ORDER BY kind,id", [workspaceId, graphVersionId])).rows;
      const counts = Object.fromEntries(recordRows.reduce((result, row) => result.set(row.kind, (result.get(row.kind) ?? 0) + 1), new Map()));
      const shards = Object.fromEntries([...new Set(recordRows.map((row) => row.kind))].sort(compareUtf8).map((kind) => {
        const ids = recordRows.filter((row) => row.kind === kind).map((row) => row.id).sort(compareUtf8);
        return [kind, { count: ids.length, digest: canonicalDigest("FACT_SET_SHARD", { kind, ids }) }];
      }));
      const profile = (await tx.query("SELECT payload FROM f002_profile WHERE id=$1", [factSet.profile_id])).rows[0]?.payload;
      requireF002(profile, "F002_PROFILE_UNAVAILABLE", "事实集能力配置不存在", { status: 409 });
      const vocabulary = vocabularyFor({ profile, records: recordRows });
      return { graphVersionId, runId: factSet.run_id, scopeId: factSet.scope_id, profileId: factSet.profile_id, bundleId: factSet.bundle_id,
        recordDigest: factSet.record_digest, scope: { selections: factSet.selections, status: factSet.scope_status },
        publicationBindingId: canonicalDigest("PUBLICATION_BINDING", { workspaceId, runId: factSet.run_id, scopeId: factSet.scope_id, bundleId: factSet.bundle_id }),
        publishedAt: new Date(factSet.published_at).toISOString(), schemaVersion: profile.schemaVersion, rules: { profileId: profile.id, ruleVersions: profile.ruleVersions, configDigest: profile.configDigest },
        counts, shards, vocabulary, verification: { status: "CLOSURE_VERIFIED", recordDigest: factSet.record_digest } };
    });
  }

  async coverage(actor, workspaceId, graphVersionId) {
    requireVersionId(graphVersionId);
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const factSet = (await tx.query(`SELECT f.run_id,f.scope_id,profile.payload AS profile_payload
        FROM f002_fact_set f JOIN f002_profile profile ON profile.id=f.profile_id
        WHERE f.workspace_id=$1 AND f.graph_version_id=$2`, [workspaceId, graphVersionId])).rows[0];
      requireF002(factSet, "F002_VERSION_NOT_FOUND", "事实集版本不存在", { status: 404 });
      const rows = (await tx.query(`SELECT material_id,capability_id,status,record_ids,gap_ids,diagnostic
        FROM f002_scope_item WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3`, [workspaceId, factSet.run_id, factSet.scope_id])).rows
        .map((row) => ({ materialId: row.material_id, capabilityId: row.capability_id, status: row.status,
          recordIds: row.record_ids, gapIds: row.gap_ids, diagnostic: row.diagnostic ?? null }))
        .sort((left, right) => compareUtf8(left.materialId, right.materialId) || compareUtf8(left.capabilityId, right.capabilityId));
      const counts = Object.fromEntries(coverageStates.map((status) => [status, 0]));
      for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
      return { scopeId: factSet.scope_id, declaredCapabilities: [...factSet.profile_payload.capabilityIds], counts, items: rows };
    });
  }

  async records(actor, workspaceId, graphVersionId, { kind = null, limit = 100, cursor = null } = {}) {
    requireVersionId(graphVersionId); boundedLimit(limit);
    requireF002(kind === null || (typeof kind === "string" && /^[A-Z_]{1,64}$/.test(kind)), "F002_RECORD_KIND_INVALID", "记录类型筛选无效", { status: 422 });
    return this.#page(actor, workspaceId, graphVersionId, { route: "records", kind, limit, cursor });
  }

  async collection(actor, workspaceId, graphVersionId, name, { limit = 100, cursor = null } = {}) {
    requireVersionId(graphVersionId); boundedLimit(limit);
    const definition = collections.get(collectionName(name));
    return this.#page(actor, workspaceId, graphVersionId, { route: name, kind: definition.kind, limit, cursor, predicate: definition.predicate ?? null });
  }

  async vocabulary(actor, workspaceId, graphVersionId) {
    requireVersionId(graphVersionId);
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const version = (await tx.query(`SELECT profile.payload AS profile FROM f002_fact_set fact_set
        JOIN f002_profile profile ON profile.id=fact_set.profile_id
        WHERE fact_set.workspace_id=$1 AND fact_set.graph_version_id=$2`, [workspaceId, graphVersionId])).rows[0];
      requireF002(version, "F002_VERSION_NOT_FOUND", "事实集版本不存在", { status: 404 });
      const records = (await tx.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 ORDER BY kind,id", [workspaceId, graphVersionId])).rows;
      return vocabularyFor({ profile: version.profile, records });
    });
  }

  async record(actor, workspaceId, graphVersionId, kind, id) {
    requireVersionId(graphVersionId); recordKind(kind); recordId(id);
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const row = (await tx.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind=$3 AND id=$4", [workspaceId, graphVersionId, kind, id])).rows[0];
      requireF002(row, "F002_RECORD_NOT_FOUND", "记录不存在于当前事实集", { status: 404 });
      const records = (await tx.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2", [workspaceId, graphVersionId])).rows;
      const byKey = new Map(records.map((record) => [`${record.kind}\u0000${record.id}`, record]));
      return { record: row, references: referencesFor(row, byKey) };
    });
  }

  async graph(actor, workspaceId, graphVersionId, { rootId, depth = 1, limit = 100 } = {}) {
    requireVersionId(graphVersionId); recordId(rootId);
    requireF002(Number.isInteger(depth) && depth >= 0 && depth <= 2 && Number.isInteger(limit) && limit >= 1 && limit <= 200,
      "F002_GRAPH_INVALID", "局部图参数无效", { status: 422 });
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const root = (await tx.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND id=$3", [workspaceId, graphVersionId, rootId])).rows[0];
      requireF002(root, "F002_RECORD_NOT_FOUND", "局部图根节点不存在", { status: 404 });
      const relationRows = (await tx.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='FACT'", [workspaceId, graphVersionId])).rows
        .filter((record) => record.payload.kind === "RELATION").sort(recordOrder);
      const records = (await tx.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2", [workspaceId, graphVersionId])).rows;
      const byKey = new Map(records.map((record) => [`${record.kind}\u0000${record.id}`, record]));
      const nodes = new Map([[`${root.kind}\u0000${root.id}`, root]]);
      const edges = new Map();
      const objectFrontier = new Set();
      let truncated = false;
      const addNode = (record) => {
        const key = `${record.kind}\u0000${record.id}`;
        if (nodes.has(key)) return true;
        if (nodes.size >= limit) { truncated = true; return false; }
        nodes.set(key, record);
        return true;
      };
      if (root.kind === "OBJECT") objectFrontier.add(root.id);
      if (root.kind === "FACT" && root.payload.kind === "RELATION") {
        for (const objectId of [root.payload.subjectId, root.payload.targetId]) {
          const object = byKey.get(`OBJECT\u0000${objectId}`);
          if (object && addNode(object)) objectFrontier.add(objectId);
        }
      }
      if (root.kind === "MATERIAL" && depth > 0) for (const record of records.filter((record) => record.kind === "OBJECT" && record.payload.materialId === root.id).sort(recordOrder)) {
        if (addNode(record)) objectFrontier.add(record.id);
      }
      for (const objectId of objectFrontier) {
        const object = byKey.get(`OBJECT\u0000${objectId}`);
        if (object) addNode(object);
      }
      let frontier = objectFrontier;
      for (let level = 0; level < depth && frontier.size; level += 1) {
        const next = new Set();
        for (const relation of relationRows) {
          const subject = relation.payload.subjectId, target = relation.payload.targetId;
          if (!frontier.has(subject) && !frontier.has(target)) continue;
          if (nodes.size >= limit && !nodes.has(`FACT\u0000${relation.id}`)) { truncated = true; continue; }
          edges.set(relation.id, { factId: relation.id, subjectId: subject, predicate: relation.payload.predicate, targetId: target, evidenceIds: relation.payload.evidenceIds });
          nodes.set(`FACT\u0000${relation.id}`, relation);
          for (const objectId of [subject, target]) {
            const object = byKey.get(`OBJECT\u0000${objectId}`);
            if (object && !nodes.has(`OBJECT\u0000${objectId}`) && nodes.size >= limit) { truncated = true; continue; }
            if (object) nodes.set(`OBJECT\u0000${objectId}`, object);
            if (!frontier.has(objectId)) next.add(objectId);
          }
        }
        frontier = next;
      }
      return { root: { kind: root.kind, id: root.id }, depth, limit, truncated, nodes: [...nodes.values()].sort(recordOrder), edges: [...edges.values()].sort((left, right) => compareUtf8(left.factId, right.factId)) };
    });
  }

  async #page(actor, workspaceId, graphVersionId, { route, kind, limit, cursor, predicate = null }) {
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      // Authenticate the requested Workspace before interpreting caller-supplied
      // cursor state, so a foreign cursor cannot distinguish its version/filter.
      const marker = cursor === null ? null : this.#cursor(cursor, { route, workspaceId, graphVersionId, kind });
      const version = (await tx.query("SELECT 1 FROM f002_fact_set WHERE workspace_id=$1 AND graph_version_id=$2", [workspaceId, graphVersionId])).rows[0];
      requireF002(version, "F002_VERSION_NOT_FOUND", "事实集版本不存在", { status: 404 });
      const rows = (await tx.query(`SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2
        ${kind === null ? "" : "AND kind=$3"}`, kind === null ? [workspaceId, graphVersionId] : [workspaceId, graphVersionId, kind])).rows
        .filter((record) => !predicate || predicate(record)).sort(recordOrder).filter((record) => !marker || recordOrder(record, marker) > 0);
      const items = rows.slice(0, limit).map((record) => ({ kind: record.kind, id: record.id, payload: record.payload }));
      const last = items.at(-1);
      return { items, nextCursor: rows.length > items.length ? this.#sign({ route, workspaceId, graphVersionId, kind, last: { kind: last.kind, id: last.id } }) : null };
    });
  }

  #sign(payload) {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.cursorSecret).update(encoded, "ascii").digest("base64url");
    return `${encoded}.${signature}`;
  }

  #cursor(cursor, expected) {
    requireF002(typeof cursor === "string" && cursor.length <= 4096, "F002_CURSOR_INVALID", "分页游标无效", { status: 422 });
    const [encoded, signature, extra] = cursor.split(".");
    requireF002(Boolean(encoded) && Boolean(signature) && !extra, "F002_CURSOR_INVALID", "分页游标无效", { status: 422 });
    const expectedSignature = createHmac("sha256", this.cursorSecret).update(encoded, "ascii").digest();
    let actual, payload;
    try { actual = Buffer.from(signature, "base64url"); payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new F002Error("F002_CURSOR_INVALID", "分页游标无效", { status: 422 }); }
    requireF002(actual.length === expectedSignature.length && timingSafeEqual(actual, expectedSignature), "F002_CURSOR_INVALID", "分页游标签名无效", { status: 422 });
    requireF002(payload && typeof payload === "object" && payload.route === expected.route && payload.workspaceId === expected.workspaceId
      && payload.graphVersionId === expected.graphVersionId && payload.kind === expected.kind && payload.last
      && typeof payload.last.kind === "string" && typeof payload.last.id === "string", "F002_CURSOR_INVALID", "分页游标不属于当前查询", { status: 422 });
    return payload.last;
  }
}

export { F002Error };
