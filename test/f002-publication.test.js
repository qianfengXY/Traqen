import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";

import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { F002ReplayService } from "../src/deterministic-facts/replay-service.js";
import { F002RuleRegistry } from "../src/deterministic-facts/rules.js";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalDigest, createProfileId } from "../src/deterministic-facts/identity.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { loadFrozenMaterials } from "../src/deterministic-facts/source-materials.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { owner, reader, sourceDatabase } from "./support/source-truth-database.js";
import { verifiedF002Records } from "./support/f002-records.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";

const componentId = "a".repeat(64);
const bundleId = "b".repeat(64);

function profile() {
  const input = { version: "1", schemaVersion: 1, capabilityIds: ["javascript"], ruleVersions: ["javascript@1"], canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024, maxRecords: 10 }, redactionPolicyRevision: "policy-v1" };
  return { ...input, id: createProfileId(input), name: "javascript", startable: true };
}

function sourceInput() {
  return { workspaceId: "workspace", bundleId, sourceBundleSnapshotId: bundleId, receiptId: "receipt-1", receiptStatus: "READY", confirmationId: "confirmation-1",
    acceptanceRecordIds: [], receiptValidUntil: null, qualifiedAt: "2026-09-17T00:00:00.000Z", inventoryId: "inventory-1", inventoryDigest: "inventory-1", policyRevisionId: "policy-v1", inheritedGapSet: { id: "gaps-1", count: "0", consumption: "ALL_PAGES_REQUIRED" } };
}

async function fixture(t) {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx, maintain) => sources.authorize(actor, workspaceId, maintain, tx) });
  await repository.registerProfile(profile());
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "publish-run", sourceInput: sourceInput(), profile: profile(), scopes: [
    { label: "A", selections: [{ kind: "COMPONENT", componentId }] }, { label: "B", selections: [{ kind: "ENTRY", componentId, pathBytes: "c3JjL2IuanM" }] },
  ] });
  return { repository, publisher: new F002PublicationService(repository), run };
}

async function prepareScope(repository, run, scope, items, existingRecords = null) {
  const claimed = await repository.claimScope(owner, "workspace", run.id, scope.scopeId, { workerId: `worker-${scope.label}`, leaseMs: 60_000 });
  const verified = existingRecords ?? verifiedF002Records({ workspaceId: "workspace", bundleId, componentId, profile: profile(), path: `src/${scope.label}.js`, mediaType: "application/octet-stream" });
  await new F002PublicationService(repository).prepare(owner, "workspace", run.id, scope.scopeId, {
    generation: claimed.generation, records: verified.records,
  });
  await repository.recordScopeItems(owner, {
    workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation,
    items: items.map((item) => ({ ...item, materialId: verified.materialId })),
  });
  if (items.some((item) => item.status === "PENDING" || item.status === "RUNNING")) return { scope: claimed, records: verified.records };
  return { scope: await repository.readyToSeal(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation }), records: verified.records };
}

function replayAdmission({ path, source = "export function evidence() {}\n" }) {
  const bytes = Buffer.from(source, "utf8");
  return {
    inventory: async () => ({ items: [{ componentId, entry: { pathBytes: Buffer.from(path).toString("base64url"), sizeBytes: String(bytes.length) },
      disposition: { disposition: "VERIFIED", digest: createHash("sha256").update(bytes).digest("hex") } }], nextCursor: null }),
    async *readFile() { yield bytes; },
  };
}

test("F002 preparation and sealing use bounded record batches without weakening immutable retry conflicts", async t => {
  const { db, repository: sources } = await sourceDatabase(t);
  let preparationQueries = 0, sealedInserts = 0;
  const observed = { query: db.query.bind(db), transaction: work => db.transaction(tx => work({ query: (sql, values) => {
    if (/\bf002_prepared_record\b/.test(sql)) preparationQueries++;
    if (/INSERT INTO f002_record\b/.test(sql)) sealedInserts++;
    return tx.query(sql, values);
  } })) };
  const repository = new F002Repository(observed, { authorize: (actor, workspaceId, tx, maintain) => sources.authorize(actor, workspaceId, maintain, tx) });
  const configured = profile(); await repository.registerProfile(configured);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "bounded-publication", sourceInput: sourceInput(), profile: configured,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scopeId = run.scopes[0].scopeId;
  const claim = await repository.claimScope(owner, "workspace", run.id, scopeId, { workerId: "batch-publication", leaseMs: 60_000 });
  const result = compileDeterministicFacts({ workspaceId: "workspace", bundleId, profile: configured, materials: Array.from({ length: 200 }, (_, i) => ({
    componentId, pathBytes: Buffer.from(`file-${i}.unknown`).toString("base64url"), bytes: Buffer.from("fixed source"), mediaType: "application/octet-stream" })) });
  const records = canonicalRecords(result); assert.equal(records.length, 600);
  const publisher = new F002PublicationService(repository);
  await publisher.prepare(owner, "workspace", run.id, scopeId, { generation: claim.generation, records });
  assert.ok(preparationQueries <= 4, `600 records issued ${preparationQueries} prepared SQL statements`);
  preparationQueries = 0;
  await publisher.prepare(owner, "workspace", run.id, scopeId, { generation: claim.generation, records });
  assert.ok(preparationQueries <= 2, "same records retry reads each batch without rewriting immutable payloads");
  // An extra payload field preserves a valid content identity but differs from
  // the prior immutable payload; the entire preparation must reject it.
  const changed = records.map((record, index) => index ? record : { ...record, payload: { ...record.payload, extraObservation: "different" } });
  await assert.rejects(publisher.prepare(owner, "workspace", run.id, scopeId, { generation: claim.generation, records: changed }), { code: "F002_PREPARED_RECORD_CONFLICT" });
  await repository.recordScopeItems(owner, { workspaceId: "workspace", runId: run.id, scopeId, generation: claim.generation,
    items: result.materials.map(material => ({ materialId: material.materialId, capabilityId: "javascript", status: "UNSUPPORTED" })) });
  const ready = await repository.readyToSeal(owner, { workspaceId: "workspace", runId: run.id, scopeId, generation: claim.generation });
  const sealed = await publisher.publish(owner, "workspace", run.id, scopeId, { revision: ready.revision, operationId: "bounded-seal" });
  assert.ok(sealedInserts <= 2, `600 records issued ${sealedInserts} sealed INSERTs`);
  assert.equal((await db.query("SELECT count(*)::integer AS total FROM f002_record WHERE graph_version_id=$1", [sealed.graphVersionId])).rows[0].total, records.length);
  assert.equal((await publisher.publish(owner, "workspace", run.id, scopeId, { revision: ready.revision, operationId: "bounded-seal" })).graphVersionId, sealed.graphVersionId);
});

test("F002 does not publish a scope while any declared work item is pending", async (t) => {
  const { publisher, run } = await fixture(t);
  const [scope] = run.scopes;
  const ready = await prepareScope(publisher.repository, run, scope, [{ materialId: "material-1", capabilityId: "javascript", status: "PENDING" }]);
  await assert.rejects(publisher.publish(owner, "workspace", run.id, scope.scopeId, {
    revision: ready.scope.revision, operationId: "publish-a",
  }), { code: "F002_SCOPE_PENDING" });
});

test("F002 exposes a read-only scope check and retries only the exact failed scope revision", async (t) => {
  const { repository, publisher, run } = await fixture(t);
  const [scopeA, scopeB] = run.scopes;
  const initial = await publisher.check(owner, "workspace", run.id, scopeA.scopeId);
  assert.equal(initial.ready, false);
  assert.deepEqual(initial.blockers, [{ code: "F002_SCOPE_COVERAGE_INCOMPLETE", count: 0 }, { code: "F002_SCOPE_NOT_READY", status: "QUEUED" }]);

  const claimed = await repository.claimScope(owner, "workspace", run.id, scopeB.scopeId, { workerId: "retry-worker", leaseMs: 60_000 });
  const failed = await repository.failScope(owner, { workspaceId: "workspace", runId: run.id, scopeId: scopeB.scopeId, generation: claimed.generation,
    diagnostic: { code: "F002_PARSE_RUNTIME_FAILURE", category: "RUNTIME_FAILURE" } });
  const retried = await repository.retryScope(owner, "workspace", run.id, scopeB.scopeId, { revision: failed.revision, operationId: "retry-b" });
  assert.equal(retried.status, "QUEUED");
  await assert.rejects(repository.retryScope(owner, "workspace", run.id, scopeB.scopeId, { revision: failed.revision, operationId: "retry-b-stale" }), { code: "F002_SCOPE_REVISION_CONFLICT" });
  assert.equal((await repository.getScope(owner, "workspace", run.id, scopeA.scopeId)).status, "QUEUED", "a scoped retry cannot mutate sibling lifecycle state");
});

test("F002 rejects a ready scope that has no material-capability coverage declaration", async (t) => {
  const { repository, publisher, run } = await fixture(t);
  const [scope] = run.scopes;
  const claimed = await repository.claimScope(owner, "workspace", run.id, scope.scopeId, { workerId: "coverage-worker", leaseMs: 60_000 });
  const verified = verifiedF002Records({ workspaceId: "workspace", bundleId, componentId, profile: profile() });
  await publisher.prepare(owner, "workspace", run.id, scope.scopeId, { generation: claimed.generation, records: verified.records });
  const ready = await repository.readyToSeal(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation });
  await assert.rejects(publisher.publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.revision, operationId: "empty-coverage" }),
    { code: "F002_SCOPE_COVERAGE_INCOMPLETE" });
});

test("F002 publishes one exact scope immutably without stopping a sibling scope", async (t) => {
  const { repository, publisher, run } = await fixture(t);
  const [scopeA, scopeB] = run.scopes;
  const ready = await prepareScope(repository, run, scopeA, [{ materialId: "material-1", capabilityId: "javascript", status: "DONE" }]);
  const published = await publisher.publish(owner, "workspace", run.id, scopeA.scopeId, {
    revision: ready.scope.revision, operationId: "publish-a",
  });
  assert.equal(published.status, "SEALED");
  assert.equal((await repository.getScope(owner, "workspace", run.id, scopeB.scopeId)).status, "QUEUED");
  const recovered = await publisher.publish(owner, "workspace", run.id, scopeA.scopeId, { revision: ready.scope.revision, operationId: "publish-a" });
  assert.equal(recovered.graphVersionId, published.graphVersionId, "a lost seal response replays the fixed publication rather than making another version");
  await assert.rejects(publisher.publish(owner, "workspace", run.id, scopeA.scopeId, {
    revision: ready.scope.revision, operationId: "rewrite-a",
  }), { code: "F002_SCOPE_REVISION_CONFLICT" });
  await assert.rejects(repository.database.query("UPDATE f002_record SET payload='{}'::jsonb WHERE workspace_id=$1 AND graph_version_id=$2", ["workspace", published.graphVersionId]),
    /append-only|forbidden/i);
});

test("F002 replay recompiles the fixed source rather than accepting client records", async (t) => {
  const { repository, publisher, run } = await fixture(t);
  const scope = run.scopes.find((candidate) => candidate.label === "A");
  assert.ok(scope);
  const ready = await prepareScope(repository, run, scope, [{ materialId: "material-1", capabilityId: "javascript", status: "DONE" }]);
  const published = await publisher.publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.scope.revision, operationId: "publish-replay" });
  const path = `src/${scope.label}.js`;
  const replays = new F002ReplayService(repository, { admission: replayAdmission({ path }) });
  const replayBytes = Buffer.from("export function evidence() {}\n", "utf8");
  const direct = compileDeterministicFacts({ workspaceId: "workspace", bundleId, profile: profile(), materials: [{ componentId, pathBytes: Buffer.from(path).toString("base64url"), bytes: replayBytes, contentDigest: createHash("sha256").update(replayBytes).digest("hex"), mediaType: "application/octet-stream" }] });
  assert.deepEqual(direct.materials[0], ready.records.find((record) => record.kind === "MATERIAL").payload);
  assert.deepEqual({ objects: direct.objects, evidence: direct.evidence, facts: direct.facts, gaps: direct.gaps }, {
    objects: ready.records.filter((record) => record.kind === "OBJECT").map((record) => record.payload), evidence: ready.records.filter((record) => record.kind === "EVIDENCE").map((record) => record.payload),
    facts: ready.records.filter((record) => record.kind === "FACT").map((record) => record.payload), gaps: ready.records.filter((record) => record.kind === "GAP").map((record) => record.payload),
  });
  const directRecords = normalizeCanonicalRecords([
    ...direct.materials.map((payload) => ({ kind: "MATERIAL", id: payload.materialId, payload })), ...direct.objects.map((payload) => ({ kind: "OBJECT", id: payload.objectId, payload })),
    ...direct.evidence.map((payload) => ({ kind: "EVIDENCE", id: payload.evidenceId, payload })), ...direct.facts.map((payload) => ({ kind: "FACT", id: payload.factId, payload })), ...direct.gaps.map((payload) => ({ kind: "GAP", id: payload.gapId, payload })),
  ], { workspaceId: "workspace", bundleId });
  assert.equal(canonicalDigest("FACT_SET_RECORDS", { records: directRecords }), (await repository.database.query("SELECT record_digest FROM f002_fact_set WHERE workspace_id=$1 AND graph_version_id=$2", ["workspace", published.graphVersionId])).rows[0].record_digest);
  const loaded = await loadFrozenMaterials(replayAdmission({ path }), owner, "workspace", { id: run.id }, scope, profile());
  assert.deepEqual(loaded, [{ componentId, pathBytes: Buffer.from(path).toString("base64url"), bytes: replayBytes, contentDigest: createHash("sha256").update(replayBytes).digest("hex"), mediaType: "application/octet-stream" }]);
  const replayed = await replays.replay(owner, "workspace", published.graphVersionId);
  assert.equal(replayed.status, "MATCH", JSON.stringify(replayed));
  const changed = new F002ReplayService(repository, { admission: replayAdmission({ path, source: "export function changed() {}\n" }) });
  assert.equal((await changed.replay(owner, "workspace", published.graphVersionId)).status, "DIFFERENT");
  await repository.database.query("UPDATE f002_profile SET startable=false WHERE id=$1", [profile().id]);
  const historical = await replays.replay(owner, "workspace", published.graphVersionId);
  assert.equal(historical.status, "MATCH", "stopping new starts must not remove an installed historical rule implementation");
  const unavailable = await new F002ReplayService(repository, { admission: replayAdmission({ path }), ruleRegistry: new F002RuleRegistry({ ruleVersions: [] }) })
    .replay(owner, "workspace", published.graphVersionId);
  assert.equal(unavailable.status, "FAILED");
  assert.equal(unavailable.diagnostic.code, "RULE_VERSION_UNAVAILABLE");
  await assert.rejects(
    replays.replay(reader, "workspace", published.graphVersionId),
    { code: "SOURCE_FORBIDDEN" },
    "replay writes an audit record and therefore requires maintenance permission",
  );
});

test("F002 accepts a durable ReplayRun before any frozen source bytes are read", async (t) => {
  const { repository, publisher, run } = await fixture(t);
  const scope = run.scopes.find((candidate) => candidate.label === "A");
  assert.ok(scope);
  const ready = await prepareScope(repository, run, scope, [{ materialId: "material-1", capabilityId: "javascript", status: "DONE" }]);
  const published = await publisher.publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.scope.revision, operationId: "seal-replay-intent" });
  let startedRead;
  let releaseRead;
  const reading = new Promise((resolve) => { startedRead = resolve; });
  const released = new Promise((resolve) => { releaseRead = resolve; });
  const bytes = Buffer.from("export function evidence() {}\n", "utf8");
  const admission = {
    inventory: async () => ({ items: [{ componentId, entry: { pathBytes: Buffer.from(`src/${scope.label}.js`).toString("base64url"), sizeBytes: String(bytes.length) },
      disposition: { disposition: "VERIFIED", digest: createHash("sha256").update(bytes).digest("hex") } }], nextCursor: null }),
    async *readFile() { startedRead(); await released; yield bytes; },
  };
  const replay = new F002ReplayService(repository, { admission });
  const pending = replay.replay(owner, "workspace", published.graphVersionId);
  await reading;
  const persisted = await repository.database.query("SELECT status,generation FROM f002_replay WHERE workspace_id=$1 AND graph_version_id=$2", ["workspace", published.graphVersionId]);
  assert.deepEqual(persisted.rows, [{ status: "RUNNING", generation: 1 }]);
  releaseRead();
  assert.equal((await pending).status, "MATCH");
});

test("F002 replay renews its live generation through slow source reads without changing the fixed digest", async t => {
  const { repository, publisher, run } = await fixture(t);
  const scope = run.scopes.find(candidate => candidate.label === "A");
  const ready = await prepareScope(repository, run, scope, [{ materialId: "material-1", capabilityId: "javascript", status: "DONE" }]);
  const published = await publisher.publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.scope.revision, operationId: "seal-slow-replay" });
  const admission = replayAdmission({ path: `src/${scope.label}.js` });
  const read = admission.readFile;
  admission.readFile = async function*(...args) { await pause(2500); yield* read(...args); };
  const replays = new F002ReplayService(repository, { admission });
  const accepted = await replays.submit(owner, "workspace", published.graphVersionId, { operationId: "slow-replay" });
  const result = await replays.execute(owner, "workspace", accepted.id, { workerId: "slow-replay", leaseMs: 2000 });
  assert.equal(result.status, "MATCH");
  assert.equal(result.generation, 1);
});

test("F002 replay cancellation fences a late source worker and an expired claim recovers", async (t) => {
  const { repository, publisher, run } = await fixture(t);
  const scope = run.scopes.find((candidate) => candidate.label === "A");
  assert.ok(scope);
  const ready = await prepareScope(repository, run, scope, [{ materialId: "material-1", capabilityId: "javascript", status: "DONE" }]);
  const published = await publisher.publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.scope.revision, operationId: "seal-replay-cancel" });
  let startedRead;
  let releaseRead;
  const reading = new Promise((resolve) => { startedRead = resolve; });
  const released = new Promise((resolve) => { releaseRead = resolve; });
  const bytes = Buffer.from("export function evidence() {}\n", "utf8");
  const admission = {
    inventory: async () => ({ items: [{ componentId, entry: { pathBytes: Buffer.from(`src/${scope.label}.js`).toString("base64url"), sizeBytes: String(bytes.length) },
      disposition: { disposition: "VERIFIED", digest: createHash("sha256").update(bytes).digest("hex") } }], nextCursor: null }),
    async *readFile() { startedRead(); await released; yield bytes; },
  };
  const replays = new F002ReplayService(repository, { admission });
  const accepted = await replays.submit(owner, "workspace", published.graphVersionId, { operationId: "replay-cancel" });
  const executing = replays.execute(owner, "workspace", accepted.id, { workerId: "late-replay-worker", leaseMs: 60_000 });
  await reading;
  const running = await replays.get(owner, "workspace", accepted.id);
  const cancelled = await replays.cancel(owner, "workspace", accepted.id, { revision: running.revision, operationId: "cancel-replay" });
  assert.equal(cancelled.status, "CANCELLED");
  releaseRead();
  await assert.rejects(executing, { code: "F002_STALE_REPLAY_WORKER" });
  assert.equal((await replays.get(owner, "workspace", accepted.id)).status, "CANCELLED");
  assert.equal((await replays.findByOperation(owner, "workspace", "cancel-replay"))?.id, accepted.id,
    "a lost cancellation response must reconcile its original operation without resubmitting");

  const recoverable = await replays.submit(owner, "workspace", published.graphVersionId, { operationId: "replay-recover" });
  await repository.database.query("UPDATE f002_replay SET status='RUNNING',generation=1,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [recoverable.id]);
  const recovered = await replays.execute(owner, "workspace", recoverable.id, { workerId: "recovered-replay-worker", leaseMs: 60_000 });
  assert.equal(recovered.status, "MATCH");
  assert.equal(recovered.generation, 2);
});

test("F002 reuses the first immutable FactSet when an equivalent later run seals", async (t) => {
  const { repository, publisher, run } = await fixture(t);
  const firstScope = run.scopes.find((scope) => scope.label === "A");
  assert.ok(firstScope);
  const firstReady = await prepareScope(repository, run, firstScope, [{ capabilityId: "javascript", status: "DONE" }]);
  const first = await publisher.publish(owner, "workspace", run.id, firstScope.scopeId, { revision: firstReady.scope.revision, operationId: "seal-first" });
  const firstRecords = (await repository.database.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 ORDER BY kind,id", ["workspace", first.graphVersionId])).rows;

  const later = await repository.createAdmittedRun(owner, "workspace", { operationId: "publish-equivalent-later", sourceInput: sourceInput(), profile: profile(),
    scopes: [{ label: "Equivalent", selections: [{ kind: "COMPONENT", componentId }] }] });
  const laterScope = later.scopes[0];
  assert.equal(laterScope.scopeId, firstScope.scopeId, "equivalent inputs retain their scope identity regardless of display label or run");
  const laterReady = await prepareScope(repository, later, laterScope, [{ capabilityId: "javascript", status: "DONE" }], { records: firstRecords, materialId: firstRecords.find((record) => record.kind === "MATERIAL").id });
  const reused = await publisher.publish(owner, "workspace", later.id, laterScope.scopeId, { revision: laterReady.scope.revision, operationId: "seal-later" });
  assert.equal(reused.graphVersionId, first.graphVersionId);
  const stored = await repository.database.query("SELECT run_id FROM f002_fact_set WHERE workspace_id=$1 AND graph_version_id=$2", ["workspace", first.graphVersionId]);
  assert.equal(stored.rows[0].run_id, run.id, "the canonical FactSet preserves its first publication binding");
});
