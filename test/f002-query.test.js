import assert from "node:assert/strict";
import test from "node:test";

import { createProfileId } from "../src/deterministic-facts/identity.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { F002QueryService } from "../src/deterministic-facts/queries.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { owner, sourceDatabase } from "./support/source-truth-database.js";
import { verifiedF002Records } from "./support/f002-records.js";

const componentId = "a".repeat(64);
const bundleId = "b".repeat(64);
const profileInput = { version: "1", schemaVersion: 1, capabilityIds: ["javascript"], ruleVersions: ["javascript@1"], canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024, maxRecords: 10 }, redactionPolicyRevision: "policy-v1" };
const profile = { ...profileInput, id: createProfileId(profileInput), name: "javascript", startable: true };
const sourceInput = { workspaceId: "workspace", bundleId, sourceBundleSnapshotId: bundleId, receiptId: "receipt-1", receiptStatus: "READY", confirmationId: "confirmation-1", acceptanceRecordIds: [], receiptValidUntil: null, qualifiedAt: "2026-09-17T00:00:00.000Z", inventoryId: "inventory-1", inventoryDigest: "inventory-1", policyRevisionId: "policy-v1", inheritedGapSet: { id: "gaps-1", count: "0", consumption: "ALL_PAGES_REQUIRED" } };

async function publishedFixture(t) {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "query-run", sourceInput, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scope = run.scopes[0];
  const claimed = await repository.claimScope(owner, "workspace", run.id, scope.scopeId, { workerId: "query-worker", leaseMs: 60_000 });
  const publisher = new F002PublicationService(repository);
  const verified = verifiedF002Records({ workspaceId: "workspace", bundleId, componentId, profile });
  await publisher.prepare(owner, "workspace", run.id, scope.scopeId, { generation: claimed.generation, records: verified.records });
  await repository.recordScopeItems(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation,
    items: [{ materialId: verified.materialId, capabilityId: "javascript", status: "DONE" }] });
  const ready = await repository.readyToSeal(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation });
  const sealed = await publisher.publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.revision, operationId: "seal-query" });
  return { repository, sealed, verified };
}

test("F002 version queries expose only sealed records with a Workspace/version-bound signed cursor", async (t) => {
  const { repository, sealed, verified } = await publishedFixture(t);
  const queries = new F002QueryService(repository, { cursorSecret: "query-test-secret" });
  assert.deepEqual((await queries.profiles(owner, "workspace")).map((item) => item.id), [profile.id]);
  assert.deepEqual(await queries.activeRuns(owner, "workspace"), [], "sealed-only runs are history, not active work");
  const pendingRun = await repository.createAdmittedRun(owner, "workspace", { operationId: "query-active-run", sourceInput, profile,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const active = await queries.activeRuns(owner, "workspace");
  assert.deepEqual(active.map(run => run.id), [pendingRun.id]);
  assert.equal(active[0].scopes[0].status, "QUEUED");
  assert.equal(active[0].scopes[0].requestOwned, false);
  await assert.rejects(queries.activeRuns(owner, "workspace2"), { code: "SOURCE_FORBIDDEN" });
  const first = await queries.records(owner, "workspace", sealed.graphVersionId, { limit: 1 });
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second = await queries.records(owner, "workspace", sealed.graphVersionId, { limit: 10, cursor: first.nextCursor });
  const expected = verified.records.slice().sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)).map((item) => `${item.kind}:${item.id}`);
  assert.deepEqual([...first.items, ...second.items].map((item) => `${item.kind}:${item.id}`), expected);
  await assert.rejects(queries.records(owner, "workspace", sealed.graphVersionId, { limit: 10, cursor: `${first.nextCursor.slice(0, -1)}x` }), { code: "F002_CURSOR_INVALID" });
  await assert.rejects(queries.records(owner, "workspace2", sealed.graphVersionId, { limit: 10, cursor: first.nextCursor }), { code: "SOURCE_FORBIDDEN" });
  await assert.rejects(queries.records(owner, "workspace", sealed.graphVersionId, { limit: 501 }), { code: "F002_PAGE_INVALID" });
});

test("F002 page queries push the cursor, relation filter and row bound into PostgreSQL", async () => {
  const queries = new F002QueryService({ withAuthorizedWorkspace: async (_actor, _workspace, callback) => callback({ query: async (sql, values) => {
    if (sql.includes("FROM f002_fact_set")) return { rows: [{}] };
    assert.match(sql, /ORDER BY.*kind.*id/s);
    assert.match(sql, /LIMIT \$\d+/);
    assert.equal(values.at(-1), 3, "limit + one lookahead, never the whole FactSet");
    assert.match(sql, /payload\s*->>\s*'kind'\s*=\s*'RELATION'/);
    return { rows: [] };
  } }) }, { cursorSecret: "query-bounded-materialization" });
  assert.deepEqual(await queries.collection(owner, "workspace", "e".repeat(64), "relations", { limit: 2 }), { items: [], nextCursor: null });
});

test("F002 material paths search the entire fixed version and exact material lookup never silently ignores its filter", async t => {
  const { repository, sealed, verified } = await publishedFixture(t);
  const queries = new F002QueryService(repository, { cursorSecret: "whole-material-query-test" });
  const absent = await queries.collection(owner, "workspace", sealed.graphVersionId, "materials", { query: "a-file-that-is-not-here" });
  assert.deepEqual(absent.items, []);
  assert.deepEqual((await queries.collection(owner, "workspace", sealed.graphVersionId, "materials", { materialIds: ["0".repeat(64)] })).items, []);
  assert.deepEqual((await queries.collection(owner, "workspace", sealed.graphVersionId, "materials", { materialIds: [verified.materialId] })).items.map(item => item.id), [verified.materialId]);
  assert.equal((await queries.collection(owner, "workspace", sealed.graphVersionId, "materials", { query: "%" })).items.length, 0, "percent is literal text, not a SQL wildcard");
  await assert.rejects(queries.collection(owner, "workspace", sealed.graphVersionId, "materials", { query: "x".repeat(513) }), { code: "F002_QUERY_INVALID" });
});

test("F002 material path and exact-ID pagination keeps SQL bounds and signs the complete filter", async () => {
  const ids = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
  const queries = new F002QueryService({ withAuthorizedWorkspace: async (_actor, _workspace, work) => work({ query: async (sql, values) => {
    if (sql.includes("FROM f002_fact_set")) return { rows: [{}] };
    assert.match(sql, /strpos\(lower\(COALESCE\(payload->>'displayPath'/);
    assert.match(sql, /id=ANY\(\$\d+::text\[\]\)/);
    assert.match(sql, /ORDER BY kind,id LIMIT \$\d+/);
    assert.ok(values.includes("scripts/%_"), "query is a bound literal value, never interpolated SQL");
    assert.ok(values.some(value => Array.isArray(value) && JSON.stringify(value) === JSON.stringify(ids)));
    assert.equal(values.at(-1), 3);
    const marker = sql.includes("(kind,id)>") ? values.at(-2) : "";
    return { rows: ids.filter(id => id > marker).slice(0, 3).map(id => ({ kind: "MATERIAL", id, payload: { displayPath: "scripts/%_file.mjs" } })) };
  } }) }, { cursorSecret: "material-query-bound-pagination" });
  const options = { limit: 2, query: "scripts/%_", materialIds: ids };
  const first = await queries.collection(owner, "workspace", "a".repeat(64), "materials", options);
  assert.equal(first.items.length, 2); assert.ok(first.nextCursor);
  const second = await queries.collection(owner, "workspace", "a".repeat(64), "materials", { ...options, materialIds: [...ids].reverse(), cursor: first.nextCursor });
  assert.deepEqual(second.items.map(item => item.id), [ids[2]]);
  assert.equal(second.nextCursor, null);
  for (const changed of [{ query: "scripts/" }, { materialIds: ids.slice(1) }]) {
    await assert.rejects(queries.collection(owner, "workspace", "a".repeat(64), "materials", { ...options, ...changed, cursor: first.nextCursor }), { code: "F002_CURSOR_INVALID" });
  }
});

test("F002 record detail fetches only its exact direct references, not every full record in a large version", async () => {
  const fact = { kind: "FACT", id: "a".repeat(64), payload: { kind: "PROPERTY", subjectId: "b".repeat(64), evidenceIds: ["c".repeat(64)], premiseFactIds: [] } };
  const references = [{ kind: "OBJECT", id: fact.payload.subjectId, payload: {} }, { kind: "EVIDENCE", id: fact.payload.evidenceIds[0], payload: {} }];
  let reads = 0;
  const queries = new F002QueryService({ withAuthorizedWorkspace: async (_actor, _workspace, work) => work({ query: async (sql, values) => {
    if (++reads === 1) return { rows: [fact] };
    assert.match(sql, /id=ANY\(/, "detail must not materialize the whole fixed version");
    assert.deepEqual(values.slice(0, 2), ["workspace", "e".repeat(64)]);
    return { rows: references };
  } }) }, { cursorSecret: "bounded-record-reference-test" });
  const detail = await queries.record(owner, "workspace", "e".repeat(64), "FACT", fact.id);
  assert.deepEqual(detail.references.map(ref => ref.role), ["subject", "evidence"]);
});

test("F002 coverage exposes the sealed material × capability denominator and dispositions", async (t) => {
  const { repository, sealed, verified } = await publishedFixture(t);
  const queries = new F002QueryService(repository, { cursorSecret: "query-test-secret" });
  const coverage = await queries.coverage(owner, "workspace", sealed.graphVersionId);
  assert.deepEqual(coverage, {
    totalItems: 1, nextCursor: null,
    scopeId: sealed.scopeId,
    declaredCapabilities: ["javascript"],
    counts: { DONE: 1, NOT_APPLICABLE: 0, UNSUPPORTED: 0, PARSE_FAILED: 0, PENDING: 0, RUNNING: 0 },
    items: [{ materialId: verified.materialId, capabilityId: "javascript", status: "DONE", recordIds: [], gapIds: [], diagnostic: null }],
  });
});

test("F002 coverage pages keep global counts, exact material filters and cursor identity without materializing the denominator", async t => {
  const { repository, sealed, verified } = await publishedFixture(t);
  const queries = new F002QueryService(repository, { cursorSecret: "query-test-secret" });
  await assert.rejects(queries.coverage(owner, "workspace", sealed.graphVersionId, { limit: 501 }), { code: "F002_PAGE_INVALID" });
  const filtered = await queries.coverage(owner, "workspace", sealed.graphVersionId, { materialIds: ["0".repeat(64)], limit: 1 });
  assert.equal(filtered.items.length, 0);
  assert.equal(filtered.counts.DONE, 1, "global denominator is independent of this material page");
  const page = await queries.coverage(owner, "workspace", sealed.graphVersionId, { materialIds: [verified.materialId], limit: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, null);
});

test("F002 coverage keyset pagination is SQL-bounded and signed totals cannot cross a material filter", async () => {
  const ids = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
  let aggregations = 0;
  const queries = new F002QueryService({ withAuthorizedWorkspace: async (_actor, _workspace, work) => work({ query: async (sql, values) => {
    if (sql.includes("FROM f002_fact_set")) return { rows: [{ run_id: "run", scope_id: "scope", profile_payload: { capabilityIds: ["inventory"] } }] };
    if (sql.includes("GROUP BY status")) { aggregations++; return { rows: [{ status: "DONE", count: 718572 }] }; }
    assert.match(sql, /ORDER BY material_id,capability_id LIMIT \$\d+/);
    assert.ok(values.at(-1) <= 501);
    const marker = sql.includes("(material_id,capability_id)>") ? values.at(-3) : "";
    return { rows: ids.filter(id => id > marker).slice(0, values.at(-1)).map(material_id => ({ material_id, capability_id: "inventory", status: "DONE", record_ids: [], gap_ids: [] })) };
  } }) }, { cursorSecret: "coverage-pagination-test" });
  const first = await queries.coverage(owner, "workspace", "a".repeat(64), { limit: 2 });
  assert.equal(first.items.length, 2); assert.ok(first.nextCursor); assert.equal(first.totalItems, 718572);
  const next = await queries.coverage(owner, "workspace", "a".repeat(64), { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(next.items.map(item => item.materialId), [ids[2]]);
  assert.equal(next.nextCursor, null); assert.equal(aggregations, 1);
  await assert.rejects(queries.coverage(owner, "workspace", "a".repeat(64), { cursor: first.nextCursor, materialIds: [ids[0]] }), { code: "F002_CURSOR_INVALID" });
});

test("F002 exports typed five-part records, vocabulary, evidence detail, and a bounded local graph", async (t) => {
  const { repository, sealed, verified } = await publishedFixture(t);
  const queries = new F002QueryService(repository, { cursorSecret: "query-test-secret" });
  const manifest = await queries.manifest(owner, "workspace", sealed.graphVersionId);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.verification.status, "CLOSURE_VERIFIED");
  assert.ok(manifest.shards.MATERIAL.digest);
  assert.ok(manifest.vocabulary.prohibitions.some((item) => item.includes("实际执行")));

  const materials = await queries.collection(owner, "workspace", sealed.graphVersionId, "materials", { limit: 10 });
  assert.deepEqual(materials.items.map((item) => item.kind), ["MATERIAL"]);
  const facts = await queries.collection(owner, "workspace", sealed.graphVersionId, "facts", { limit: 10 });
  assert.ok(facts.items.every((item) => item.kind === "FACT"));
  const relations = await queries.collection(owner, "workspace", sealed.graphVersionId, "relations", { limit: 10 });
  assert.ok(relations.items.every((item) => item.payload.kind === "RELATION"));
  const vocabulary = await queries.vocabulary(owner, "workspace", sealed.graphVersionId);
  assert.equal(vocabulary.schemaVersion, 1);
  assert.deepEqual(vocabulary.predicates.find((item) => item.predicate === "name"), {
    predicate: "name", form: "PROPERTY", domain: null, valueDatatypes: ["string"],
    meaning: "对象声明的字面名称；不推断业务含义或运行身份。",
  });

  const detail = await queries.record(owner, "workspace", sealed.graphVersionId, "FACT", verified.factIds[0]);
  assert.equal(detail.record.id, verified.factIds[0]);
  assert.ok(detail.references.some((item) => item.role === "subject" && item.kind === "OBJECT"));
  assert.ok(detail.references.some((item) => item.role === "evidence" && item.kind === "EVIDENCE"));

  const graph = await queries.graph(owner, "workspace", sealed.graphVersionId, { rootId: detail.record.payload.subjectId, depth: 2, limit: 20 });
  assert.ok(graph.nodes.some((item) => item.id === detail.record.payload.subjectId));
  assert.equal(graph.truncated, false);
  await assert.rejects(queries.graph(owner, "workspace", sealed.graphVersionId, { rootId: detail.record.payload.subjectId, depth: 3, limit: 20 }), { code: "F002_GRAPH_INVALID" });

  const materialRoot = await queries.graph(owner, "workspace", sealed.graphVersionId, { rootId: verified.materialId, depth: 0, limit: 1 });
  assert.deepEqual(materialRoot.nodes.map((item) => item.id), [verified.materialId]);
  assert.equal(materialRoot.truncated, false, "depth zero does not expand material children past the caller bound");
});
