import { createHmac, timingSafeEqual } from "node:crypto";

import { F002Error, requireF002 } from "./errors.js";
import { canonicalDigest } from "./identity.js";
import { vocabularyFor } from "./vocabulary.js";

const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const coverageStates = ["DONE", "NOT_APPLICABLE", "UNSUPPORTED", "PARSE_FAILED", "PENDING", "RUNNING"];
const collections = new Map([
  ["materials", { kind: "MATERIAL" }], ["objects", { kind: "OBJECT" }], ["facts", { kind: "FACT" }],
  ["relations", { kind: "FACT", relationsOnly: true }], ["gaps", { kind: "GAP" }],
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

function referenceKeys(record) {
  const refs = [];
  const add = (role, kind, id) => {
    if (!id) return;
    refs.push({ role, kind, id });
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

function referencesFor(record, byKey) {
  return referenceKeys(record).flatMap(ref => {
    const target = byKey.get(`${ref.kind}\u0000${ref.id}`);
    return target ? [{ ...ref, payload: target.payload }] : [];
  });
}

async function versionVocabulary(tx, workspaceId, graphVersionId, profile) {
  const predicates = (await tx.query(`SELECT DISTINCT payload->>'predicate' AS predicate FROM f002_record
    WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='FACT'`, [workspaceId, graphVersionId])).rows;
  return vocabularyFor({ profile, records: predicates.map(row => ({ kind: "FACT", payload: { predicate: row.predicate } })) });
}

export class F002QueryService {
  constructor(repository, { cursorSecret, preferredProfileId = null } = {}) {
    if (!repository?.withAuthorizedWorkspace) throw new TypeError("F002 queries require an authorized repository");
    if (typeof cursorSecret !== "string" || Buffer.byteLength(cursorSecret, "utf8") < 16) throw new TypeError("F002 queries require a cursor secret of at least 16 bytes");
    this.repository = repository;
    this.cursorSecret = Buffer.from(cursorSecret, "utf8");
    this.preferredProfileId = preferredProfileId;
  }

  async preview(actor, workspaceId, binding, read) {
    requireF002(binding && /^[A-Za-z0-9_-]{1,128}$/.test(binding.runId ?? "") && /^[a-f0-9]{64}$/.test(binding.scopeId ?? "")
      && Number.isSafeInteger(binding.revision) && binding.revision > 0 && typeof read === "function",
      "F002_PREVIEW_INVALID", "未封存成果需要精确运行、范围和修订", { status: 422 });
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async tx => {
      const row = (await tx.query(`SELECT s.*,r.source_input,r.profile_id,p.payload AS profile_payload
        FROM f002_scope s JOIN f002_run r ON r.workspace_id=s.workspace_id AND r.id=s.run_id
        JOIN f002_profile p ON p.id=r.profile_id
        WHERE s.workspace_id=$1 AND s.run_id=$2 AND s.scope_id=$3 FOR UPDATE OF s`, [workspaceId, binding.runId, binding.scopeId])).rows[0];
      requireF002(row, "F002_SCOPE_NOT_FOUND", "范围不存在", { status: 404 });
      requireF002(row.status === "READY_TO_SEAL", "F002_PREVIEW_NOT_READY", "成果尚未就绪或已封存；请读取真实任务状态", { status: 409 });
      requireF002(row.revision === binding.revision, "F002_PREVIEW_REVISION_CONFLICT", "成果修订已变化；不能混合读取", { status: 409 });
      const key = canonicalDigest("UNSEALED_RESULT", { workspaceId, ...binding });
      const prepared = { tx, binding: { ...binding, source: row.source_input }, row };
      return read({
        binding: prepared.binding,
        manifest: () => this.manifest(actor, workspaceId, key, prepared),
        collection: (name, options) => this.collection(actor, workspaceId, key, name, options, prepared),
        records: options => this.records(actor, workspaceId, key, options, prepared),
        record: (kind, id) => this.record(actor, workspaceId, key, kind, id, prepared),
        graph: options => this.graph(actor, workspaceId, key, options, prepared),
        coverage: options => this.coverage(actor, workspaceId, key, options, prepared),
        vocabulary: () => this.vocabulary(actor, workspaceId, key, prepared),
      });
    });
  }

  #authorized(actor, workspaceId, callback, prepared) {
    return prepared ? callback(prepared.tx) : this.repository.withAuthorizedWorkspace(actor, workspaceId, callback);
  }

  #dataset(workspaceId, graphVersionId, prepared) {
    return prepared ? { table: "f002_prepared_record", where: "workspace_id=$1 AND run_id=$2 AND scope_id=$3 AND generation=$4",
      values: [workspaceId, prepared.binding.runId, prepared.binding.scopeId, prepared.row.generation] }
      : { table: "f002_record", where: "workspace_id=$1 AND graph_version_id=$2", values: [workspaceId, graphVersionId] };
  }

  async #resultRows(tx, workspaceId, graphVersionId, prepared, select = "kind,id,payload") {
    const data = this.#dataset(workspaceId, graphVersionId, prepared);
    return (await tx.query(`SELECT ${select} FROM ${data.table} WHERE ${data.where} ORDER BY kind,id`, data.values)).rows;
  }

  async profiles(actor, workspaceId) {
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => (await tx.query("SELECT payload,startable FROM f002_profile ORDER BY id")).rows
      .map((row) => {
        const profile = { ...row.payload };
        // Recommendation is a current navigation projection, not a rewrite of
        // the immutable historical execution profile or its start permission.
        // Stored payload metadata cannot supply this server-owned projection.
        delete profile.recommended;
        return { ...profile, startable: row.startable,
          ...(this.preferredProfileId
            ? { recommended: row.payload.id === this.preferredProfileId } : {}) };
      }));
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

  async manifest(actor, workspaceId, graphVersionId, prepared = null) {
    requireVersionId(graphVersionId);
    return this.#authorized(actor, workspaceId, async (tx) => {
      const factSet = prepared ? { ...prepared.row, bundle_id: prepared.row.source_input.bundleId, scope_status: prepared.row.status } : (await tx.query(`SELECT f.*,s.selections,s.status AS scope_status FROM f002_fact_set f
        JOIN f002_scope s ON s.workspace_id=f.workspace_id AND s.run_id=f.run_id AND s.scope_id=f.scope_id
        WHERE f.workspace_id=$1 AND f.graph_version_id=$2`, [workspaceId, graphVersionId])).rows[0];
      requireF002(factSet, "F002_VERSION_NOT_FOUND", "事实集版本不存在", { status: 404 });
      const recordRows = await this.#resultRows(tx, workspaceId, graphVersionId, prepared, "kind,id");
      const counts = Object.fromEntries(recordRows.reduce((result, row) => result.set(row.kind, (result.get(row.kind) ?? 0) + 1), new Map()));
      const shards = Object.fromEntries([...new Set(recordRows.map((row) => row.kind))].sort(compareUtf8).map((kind) => {
        const ids = recordRows.filter((row) => row.kind === kind).map((row) => row.id).sort(compareUtf8);
        return [kind, { count: ids.length, digest: canonicalDigest("FACT_SET_SHARD", { kind, ids }) }];
      }));
      const profile = (await tx.query("SELECT payload FROM f002_profile WHERE id=$1", [factSet.profile_id])).rows[0]?.payload;
      requireF002(profile, "F002_PROFILE_UNAVAILABLE", "事实集能力配置不存在", { status: 409 });
      const vocabulary = prepared ? vocabularyFor({ profile, records: await this.#resultRows(tx, workspaceId, graphVersionId, prepared) }) : await versionVocabulary(tx, workspaceId, graphVersionId, profile);
      return { ...(prepared ? { preview: prepared.binding, status: "UNSEALED" } : { graphVersionId }), runId: factSet.run_id, scopeId: factSet.scope_id, profileId: factSet.profile_id, bundleId: factSet.bundle_id,
        recordDigest: factSet.record_digest, scope: { selections: factSet.selections, status: factSet.scope_status },
        ...(prepared ? {} : { publicationBindingId: canonicalDigest("PUBLICATION_BINDING", { workspaceId, runId: factSet.run_id, scopeId: factSet.scope_id, bundleId: factSet.bundle_id }) }),
        publishedAt: prepared ? null : new Date(factSet.published_at).toISOString(), schemaVersion: profile.schemaVersion, rules: { profileId: profile.id, ruleVersions: profile.ruleVersions, configDigest: profile.configDigest },
        counts, shards, vocabulary, verification: { status: prepared ? "AWAITING_SEAL_CHECK" : "CLOSURE_VERIFIED", recordDigest: factSet.record_digest } };
    }, prepared);
  }

  async coverage(actor, workspaceId, graphVersionId, { limit = 100, cursor = null, materialIds = [] } = {}, prepared = null) {
    requireVersionId(graphVersionId); boundedLimit(limit);
    requireF002(Array.isArray(materialIds) && materialIds.length <= 100 && materialIds.every(id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)),
      "F002_RECORD_INVALID", "覆盖材料筛选必须是至多100个精确材料身份", { status: 422 });
    const selected = [...new Set(materialIds)].sort();
    const binding = { route: "coverage", workspaceId, graphVersionId, kind: canonicalDigest("COVERAGE_FILTER", { materialIds: selected }) };
    return this.#authorized(actor, workspaceId, async (tx) => {
      const marker = cursor === null ? null : this.#cursor(cursor, binding);
      const factSet = prepared ? prepared.row : (await tx.query(`SELECT f.run_id,f.scope_id,profile.payload AS profile_payload
        FROM f002_fact_set f JOIN f002_profile profile ON profile.id=f.profile_id
        WHERE f.workspace_id=$1 AND f.graph_version_id=$2`, [workspaceId, graphVersionId])).rows[0];
      requireF002(factSet, "F002_VERSION_NOT_FOUND", "事实集版本不存在", { status: 404 });
      // Sealed dispositions are immutable. Carry server-signed totals with the
      // cursor rather than re-counting the entire denominator on every page.
      const counts = marker?.counts ?? Object.fromEntries(coverageStates.map(status => [status, 0]));
      if (!marker?.counts) for (const row of (await tx.query(`SELECT status,count(*)::integer AS count FROM f002_scope_item
        WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3 GROUP BY status`, [workspaceId, factSet.run_id, factSet.scope_id])).rows) counts[row.status] = row.count;
      const values = [workspaceId, factSet.run_id, factSet.scope_id], conditions = ["workspace_id=$1", "run_id=$2", "scope_id=$3"];
      if (selected.length) { values.push(selected); conditions.push(`material_id=ANY($${values.length}::text[])`); }
      if (marker) { values.push(marker.kind, marker.id); conditions.push(`(material_id,capability_id)>($${values.length - 1},$${values.length})`); }
      values.push(limit + 1);
      const rows = (await tx.query(`SELECT material_id,capability_id,status,record_ids,gap_ids,diagnostic
        FROM f002_scope_item WHERE ${conditions.join(" AND ")} ORDER BY material_id,capability_id LIMIT $${values.length}`, values)).rows
        .map((row) => ({ materialId: row.material_id, capabilityId: row.capability_id, status: row.status,
          recordIds: row.record_ids, gapIds: row.gap_ids, diagnostic: row.diagnostic ?? null }));
      const items = rows.slice(0, limit), last = items.at(-1);
      return { scopeId: factSet.scope_id, declaredCapabilities: [...factSet.profile_payload.capabilityIds], counts,
        totalItems: Object.values(counts).reduce((sum, count) => sum + count, 0), items,
        nextCursor: rows.length > limit ? this.#sign({ ...binding, last: { kind: last.materialId, id: last.capabilityId, counts } }) : null };
    }, prepared);
  }

  async records(actor, workspaceId, graphVersionId, { kind = null, limit = 100, cursor = null } = {}, prepared = null) {
    requireVersionId(graphVersionId); boundedLimit(limit);
    requireF002(kind === null || (typeof kind === "string" && /^[A-Z_]{1,64}$/.test(kind)), "F002_RECORD_KIND_INVALID", "记录类型筛选无效", { status: 422 });
    return this.#page(actor, workspaceId, graphVersionId, { route: "records", kind, limit, cursor }, prepared);
  }

  async collection(actor, workspaceId, graphVersionId, name, { limit = 100, cursor = null, query = "", materialIds = [] } = {}, prepared = null) {
    requireVersionId(graphVersionId); boundedLimit(limit);
    const definition = collections.get(collectionName(name));
    requireF002(typeof query === "string" && query.length <= 512 && !/[\u0000-\u001f\u007f]/.test(query)
      && Array.isArray(materialIds) && materialIds.length <= 100 && materialIds.every(id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id))
      && (name === "materials" || (!query && materialIds.length === 0)), "F002_QUERY_INVALID", "材料路径或精确身份筛选无效", { status: 422 });
    return this.#page(actor, workspaceId, graphVersionId, { route: name, kind: definition.kind, limit, cursor, query,
      materialIds: [...new Set(materialIds)].sort(), relationsOnly: definition.relationsOnly ?? false }, prepared);
  }

  async vocabulary(actor, workspaceId, graphVersionId, prepared = null) {
    requireVersionId(graphVersionId);
    return this.#authorized(actor, workspaceId, async (tx) => {
      const version = prepared ? { profile: prepared.row.profile_payload } : (await tx.query(`SELECT profile.payload AS profile FROM f002_fact_set fact_set
        JOIN f002_profile profile ON profile.id=fact_set.profile_id
        WHERE fact_set.workspace_id=$1 AND fact_set.graph_version_id=$2`, [workspaceId, graphVersionId])).rows[0];
      requireF002(version, "F002_VERSION_NOT_FOUND", "事实集版本不存在", { status: 404 });
      return prepared ? vocabularyFor({ profile: version.profile, records: await this.#resultRows(tx, workspaceId, graphVersionId, prepared) }) : versionVocabulary(tx, workspaceId, graphVersionId, version.profile);
    }, prepared);
  }

  async record(actor, workspaceId, graphVersionId, kind, id, prepared = null) {
    requireVersionId(graphVersionId); recordKind(kind); recordId(id);
    return this.#authorized(actor, workspaceId, async (tx) => {
      const data = this.#dataset(workspaceId, graphVersionId, prepared), offset = data.values.length;
      const row = (await tx.query(`SELECT kind,id,payload FROM ${data.table} WHERE ${data.where} AND kind=$${offset + 1} AND id=$${offset + 2}`, [...data.values, kind, id])).rows[0];
      requireF002(row, "F002_RECORD_NOT_FOUND", "记录不存在于当前事实集", { status: 404 });
      const keys = referenceKeys(row);
      const records = keys.length ? (await tx.query(`SELECT kind,id,payload FROM ${data.table}
        WHERE ${data.where} AND kind=ANY($${offset + 1}::text[]) AND id=ANY($${offset + 2}::text[])`,
      [...data.values, [...new Set(keys.map(ref => ref.kind))], [...new Set(keys.map(ref => ref.id))]])).rows : [];
      const byKey = new Map(records.map((record) => [`${record.kind}\u0000${record.id}`, record]));
      return { record: row, references: referencesFor(row, byKey) };
    }, prepared);
  }

  async graph(actor, workspaceId, graphVersionId, { rootId, depth = 1, limit = 100 } = {}, prepared = null) {
    requireVersionId(graphVersionId); recordId(rootId);
    requireF002(Number.isInteger(depth) && depth >= 0 && depth <= 2 && Number.isInteger(limit) && limit >= 1 && limit <= 200,
      "F002_GRAPH_INVALID", "局部图参数无效", { status: 422 });
    return this.#authorized(actor, workspaceId, async (tx) => {
      const records = await this.#resultRows(tx, workspaceId, graphVersionId, prepared);
      const root = records.find(record => record.id === rootId);
      requireF002(root, "F002_RECORD_NOT_FOUND", "局部图根节点不存在", { status: 404 });
      const relationRows = records.filter(record => record.kind === "FACT" && record.payload.kind === "RELATION").sort(recordOrder);
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
    }, prepared);
  }

  async #page(actor, workspaceId, graphVersionId, { route, kind, limit, cursor, relationsOnly = false, query = "", materialIds = [] }, prepared = null) {
    const cursorRoute = query || materialIds.length ? `${route}:${canonicalDigest("MATERIAL_QUERY", { query, materialIds })}` : route;
    return this.#authorized(actor, workspaceId, async (tx) => {
      // Authenticate the requested Workspace before interpreting caller-supplied
      // cursor state, so a foreign cursor cannot distinguish its version/filter.
      const marker = cursor === null ? null : this.#cursor(cursor, { route: cursorRoute, workspaceId, graphVersionId, kind });
      const version = prepared ?? (await tx.query("SELECT 1 FROM f002_fact_set WHERE workspace_id=$1 AND graph_version_id=$2", [workspaceId, graphVersionId])).rows[0];
      requireF002(version, "F002_VERSION_NOT_FOUND", "事实集版本不存在", { status: 404 });
      const data = this.#dataset(workspaceId, graphVersionId, prepared);
      const values = [...data.values], conditions = [data.where];
      if (kind !== null) { values.push(kind); conditions.push(`kind=$${values.length}`); }
      if (relationsOnly) conditions.push("payload->>'kind'='RELATION'");
      if (query) { values.push(query); conditions.push(`strpos(lower(COALESCE(payload->>'displayPath','')),lower($${values.length}))>0`); }
      if (materialIds.length) { values.push(materialIds); conditions.push(`id=ANY($${values.length}::text[])`); }
      if (marker) { values.push(marker.kind, marker.id); conditions.push(`(kind,id)>($${values.length - 1},$${values.length})`); }
      values.push(limit + 1);
      const rows = (await tx.query(`SELECT kind,id,payload FROM ${data.table} WHERE ${conditions.join(" AND ")}
        ORDER BY kind,id LIMIT $${values.length}`, values)).rows;
      const items = rows.slice(0, limit).map((record) => ({ kind: record.kind, id: record.id, payload: record.payload }));
      const last = items.at(-1);
      return { items, nextCursor: rows.length > items.length ? this.#sign({ route: cursorRoute, workspaceId, graphVersionId, kind, last: { kind: last.kind, id: last.id } }) : null };
    }, prepared);
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
