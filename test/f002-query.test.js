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

test("F002 coverage exposes the sealed material × capability denominator and dispositions", async (t) => {
  const { repository, sealed, verified } = await publishedFixture(t);
  const queries = new F002QueryService(repository, { cursorSecret: "query-test-secret" });
  const coverage = await queries.coverage(owner, "workspace", sealed.graphVersionId);
  assert.deepEqual(coverage, {
    scopeId: sealed.scopeId,
    declaredCapabilities: ["javascript"],
    counts: { DONE: 1, NOT_APPLICABLE: 0, UNSUPPORTED: 0, PARSE_FAILED: 0, PENDING: 0, RUNNING: 0 },
    items: [{ materialId: verified.materialId, capabilityId: "javascript", status: "DONE", recordIds: [], gapIds: [], diagnostic: null }],
  });
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
