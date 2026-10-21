import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";

import { createMaterialId, createProfileId } from "../src/deterministic-facts/identity.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { F002ReplayService } from "../src/deterministic-facts/replay-service.js";
import { F002Worker } from "../src/deterministic-facts/worker.js";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { F002AdmissionService } from "../src/deterministic-facts/admission.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { owner, sourceDatabase } from "./support/source-truth-database.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";

const componentId = "a".repeat(64);
const bundleId = "b".repeat(64);
const sourceInput = { workspaceId: "workspace", bundleId, sourceBundleSnapshotId: bundleId, receiptId: "receipt-1", receiptStatus: "READY", confirmationId: "confirmation-1", acceptanceRecordIds: [], receiptValidUntil: null, qualifiedAt: "2026-09-17T00:00:00.000Z", inventoryId: "inventory-1", inventoryDigest: "inventory-1", policyRevisionId: "policy-v1", inheritedGapSet: { id: "gaps-1", count: "0", consumption: "ALL_PAGES_REQUIRED" } };
const profileInput = { version: "1", schemaVersion: 1, capabilityIds: ["javascript"], ruleVersions: ["javascript@1"], canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024, maxRecords: 10 }, redactionPolicyRevision: "policy-v1" };
const profile = { ...profileInput, id: createProfileId(profileInput), startable: true };

test("F002 large preparation releases workspace locks between bounded batches so its live lease can renew", async t => {
  const { db, repository: sources } = await sourceDatabase(t);
  const insertsPerTransaction = [];
  const observed = { query: db.query.bind(db), transaction: work => db.transaction(async tx => {
    let inserts = 0;
    const result = await work({ query: (sql, values) => {
      if (/INSERT INTO f002_prepared_record\b/.test(sql)) {
        inserts++;
        assert.ok(JSON.parse(values.at(-1)).length <= 500);
      }
      return tx.query(sql, values);
    } });
    if (inserts) insertsPerTransaction.push(inserts);
    return result;
  }) };
  const repository = new F002Repository(observed, { authorize: (actor, workspaceId, tx, maintain) => sources.authorize(actor, workspaceId, maintain, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "large-preparation-lease", sourceInput, profile,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const ready = await new F002Worker(repository).run(owner, "workspace", run.id, run.scopes[0].scopeId, {
    workerId: "bounded-preparation", leaseMs: 60000, materials: Array.from({ length: 200 }, (_, index) => ({ componentId,
      pathBytes: Buffer.from(`file-${index}.unknown`).toString("base64url"), bytes: Buffer.from("fixed"), mediaType: "application/octet-stream" })),
  });
  assert.equal(ready.status, "READY_TO_SEAL");
  assert.equal(ready.generation, 1);
  assert.deepEqual(insertsPerTransaction, [1, 1], "a single long transaction must not retain the renewal locks across batches");
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM f002_prepared_record WHERE run_id=$1", [run.id])).rows[0].n, 600);
});

function profileWithCapabilities(capabilityIds) {
  const input = {
    ...profileInput,
    capabilityIds,
    ruleVersions: capabilityIds.map((capabilityId) => `${capabilityId}@1`),
  };
  return { ...input, id: createProfileId(input), startable: true };
}

test("F002 keeps an active slow worker leased through parsing without changing its generation or revision", async t => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx, maintain) => sources.authorize(actor, workspaceId, maintain, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "slow-worker", sourceInput, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const bytes = Buffer.from("export function slowEvidence() {}\n");
  const worker = new F002Worker(repository, { parse: async input => { await pause(2500); return compileDeterministicFacts(input); } });
  const ready = await worker.run(owner, "workspace", run.id, run.scopes[0].scopeId, { workerId: "slow-worker", leaseMs: 2000, timeoutMs: 10_000,
    materials: [{ componentId, pathBytes: Buffer.from("slow.js").toString("base64url"), bytes,
      contentDigest: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/javascript" }] });
  assert.equal(ready.status, "READY_TO_SEAL");
  assert.equal(ready.generation, 1, "renewal is not a new claim");
  assert.equal(ready.revision, 3, "only claim and readiness change the command revision");
  assert.equal(ready.leaseUntil, null);
});

test("F002 a transient lease transport failure can recover before expiry without reviving a stale worker", async t => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx, maintain) => sources.authorize(actor, workspaceId, maintain, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "transient-worker", sourceInput, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const renew = repository.renewScopeLease.bind(repository); let calls = 0;
  t.mock.method(repository, "renewScopeLease", async (...args) => {
    if (++calls === 1) throw Object.assign(new Error("synthetic connection reset"), { code: "ECONNRESET" });
    return renew(...args);
  });
  const worker = new F002Worker(repository, { parse: async input => { await pause(2500); return compileDeterministicFacts(input); } });
  const ready = await worker.run(owner, "workspace", run.id, run.scopes[0].scopeId, { workerId: "transient-worker", leaseMs: 2000, timeoutMs: 10_000,
    materials: [{ componentId, pathBytes: Buffer.from("slow.js").toString("base64url"), bytes: Buffer.from("export function slowEvidence() {}\n"), mediaType: "text/javascript" }] });
  assert.equal(ready.status, "READY_TO_SEAL");
  assert.ok(calls >= 2);
  assert.equal(ready.generation, 1);
});

test("F002 parser timeout leaves declared scope work pending and fails retryably without manufacturing a Gap", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "timeout-run", sourceInput, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scope = run.scopes[0];
  const worker = new F002Worker(repository, { parse: () => new Promise(() => {}) });
  const result = await worker.run(owner, "workspace", run.id, scope.scopeId, {
    workerId: "timeout-worker", leaseMs: 60_000, timeoutMs: 5,
    materials: [{ componentId, pathBytes: Buffer.from("src/orders.js").toString("base64url"), bytes: Buffer.from("export function order() {}"), contentDigest: "1".repeat(64), mediaType: "text/javascript" }],
  });
  assert.equal(result.status, "FAILED_RETRYABLE");
  const items = await db.query("SELECT status,gap_ids FROM f002_scope_item WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3", ["workspace", run.id, scope.scopeId]);
  assert.deepEqual(items.rows, [{ status: "PENDING", gap_ids: [] }]);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM f002_prepared_record WHERE workspace_id=$1 AND run_id=$2", ["workspace", run.id])).rows[0].count, 0);
});

test("F002 declares more than one repository batch before a retryable parser failure", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "large-scope", sourceInput, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scope = run.scopes[0];
  const materials = Array.from({ length: 501 }, (_, index) => {
    const bytes = Buffer.from(`export function item${index}() {}`, "utf8");
    return { componentId, pathBytes: Buffer.from(`src/item-${index}.js`).toString("base64url"), bytes,
      contentDigest: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/javascript" };
  });
  const worker = new F002Worker(repository, { parse: () => new Promise(() => {}) });
  const result = await worker.run(owner, "workspace", run.id, scope.scopeId, {
    workerId: "large-scope-worker", leaseMs: 60_000, timeoutMs: 5, materials,
  });
  assert.equal(result.status, "FAILED_RETRYABLE");
  assert.equal((await db.query("SELECT count(*)::int AS count FROM f002_scope_item WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3", ["workspace", run.id, scope.scopeId])).rows[0].count, 501);
  assert.equal((await repository.getScope(owner, "workspace", run.id, scope.scopeId)).status, "FAILED_RETRYABLE");
});

test("F002 declares and completes a material × declared-capability denominator", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  const coverageProfile = profileWithCapabilities(["javascript", "json"]);
  await repository.registerProfile(coverageProfile);
  const run = await repository.createAdmittedRun(owner, "workspace", {
    operationId: "per-capability-coverage", sourceInput, profile: coverageProfile,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }],
  });
  const bytes = [
    ["src/orders.js", "export function order() {}\n", "text/javascript"],
    ["openapi.json", '{"openapi":"3.0.0","paths":{}}\n', "application/json"],
  ].map(([path, source, mediaType]) => {
    const bytes = Buffer.from(source, "utf8");
    return { componentId, pathBytes: Buffer.from(path, "utf8").toString("base64url"), bytes,
      contentDigest: createHash("sha256").update(bytes).digest("hex"), mediaType };
  });
  const ready = await new F002Worker(repository).run(owner, "workspace", run.id, run.scopes[0].scopeId, {
    workerId: "per-capability-worker", leaseMs: 60_000, timeoutMs: 10_000, materials: bytes,
  });
  assert.equal(ready.status, "READY_TO_SEAL");
  const rows = (await db.query(`SELECT capability_id,status,count(*)::int AS count
    FROM f002_scope_item WHERE workspace_id=$1 AND run_id=$2
    GROUP BY capability_id,status ORDER BY capability_id,status`, ["workspace", run.id])).rows;
  assert.deepEqual(rows, [
    { capability_id: "javascript", status: "DONE", count: 1 },
    { capability_id: "javascript", status: "NOT_APPLICABLE", count: 1 },
    { capability_id: "json", status: "DONE", count: 1 },
    { capability_id: "json", status: "NOT_APPLICABLE", count: 1 },
  ]);
});

test("F002 records completed cross-cutting work instead of hiding it as not applicable", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  const coverageProfile = profileWithCapabilities(["inventory", "javascript", "evidence", "gaps", "policy"]);
  await repository.registerProfile(coverageProfile);
  const run = await repository.createAdmittedRun(owner, "workspace", {
    operationId: "cross-cutting-coverage", sourceInput, profile: coverageProfile,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }],
  });
  const bytes = Buffer.from("export function order() {}\n", "utf8");
  const ready = await new F002Worker(repository).run(owner, "workspace", run.id, run.scopes[0].scopeId, {
    workerId: "cross-cutting-worker", leaseMs: 60_000, timeoutMs: 10_000,
    materials: [{ componentId, pathBytes: Buffer.from("src/orders.js", "utf8").toString("base64url"), bytes,
      contentDigest: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/javascript" }],
  });
  assert.equal(ready.status, "READY_TO_SEAL");
  const rows = (await db.query(`SELECT capability_id,status,diagnostic FROM f002_scope_item
    WHERE workspace_id=$1 AND run_id=$2 ORDER BY capability_id`, ["workspace", run.id])).rows;
  assert.deepEqual(rows, [
    { capability_id: "evidence", status: "DONE", diagnostic: null },
    { capability_id: "gaps", status: "DONE", diagnostic: null },
    { capability_id: "inventory", status: "DONE", diagnostic: null },
    { capability_id: "javascript", status: "DONE", diagnostic: null },
    { capability_id: "policy", status: "NOT_APPLICABLE", diagnostic: { code: "F002_POLICY_READ_TIME" } },
  ]);
});

test("F002 retains a consumed F001 Gap with its F001 origin instead of relabeling it", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", {
    operationId: "inherited-gap-run", sourceInput: { ...sourceInput, inheritedGapSet: { ...sourceInput.inheritedGapSet, count: "1" } }, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }],
  });
  const pathBytes = Buffer.from("src/external.js", "utf8").toString("base64url");
  const bytes = Buffer.from("export function external() {}\n", "utf8");
  const materialId = createMaterialId({ workspaceId: "workspace", bundleId, componentId, pathBytes });
  const admission = {
    inventory: async () => ({ items: [{ componentId, entry: { pathBytes, sizeBytes: String(bytes.length) },
      disposition: { disposition: "VERIFIED", digest: createHash("sha256").update(bytes).digest("hex") } }], nextCursor: null }),
    async *readFile() { yield bytes; },
    inheritedGaps: async () => ({ items: [{ gapId: "f1".repeat(32), componentId, pathBytes, reasonCode: "GIT_LFS_EXTERNAL", ruleVersion: "v1", affectedScope: "external-content", externalReference: { oid: "c".repeat(64) } }], nextCursor: null }),
  };
  const ready = await new F002Worker(repository, { admission }).run(owner, "workspace", run.id, run.scopes[0].scopeId, {
    workerId: "inherited-gap-worker", leaseMs: 60_000, timeoutMs: 10_000,
  });
  assert.equal(ready.status, "READY_TO_SEAL");
  const gaps = (await db.query("SELECT payload FROM f002_prepared_record WHERE workspace_id=$1 AND run_id=$2 AND kind='GAP' ORDER BY id", ["workspace", run.id])).rows.map((row) => row.payload);
  assert.deepEqual(gaps.filter((gap) => gap.origin === "F001"), [{
    gapId: gaps.find((gap) => gap.origin === "F001").gapId,
    origin: "F001", materialId, objectId: null, capability: "source", code: "GIT_LFS_EXTERNAL", anchor: null,
    reason: { category: "INHERITED_SOURCE_GAP", sourceGapId: "f1".repeat(32), ruleVersion: "v1", affectedScope: "external-content", externalReference: { oid: "c".repeat(64) }, componentId },
  }]);
});

test("F002 recovery preserves terminal work after a ready-to-seal failure and awaits the retry", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "recover-ready", sourceInput, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scope = run.scopes[0];
  const bytes = Buffer.from("export function recover() { return true; }\n", "utf8");
  const materials = [{ componentId, pathBytes: Buffer.from("src/recover.js").toString("base64url"), bytes,
    contentDigest: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/javascript" }];
  const originalReady = repository.readyToSeal.bind(repository);
  let failReadyOnce = true;
  repository.readyToSeal = async (...args) => {
    if (failReadyOnce) {
      failReadyOnce = false;
      throw new Error("synthetic ready failure");
    }
    return originalReady(...args);
  };
  const worker = new F002Worker(repository);
  const failed = await worker.run(owner, "workspace", run.id, scope.scopeId, {
    workerId: "recover-worker", leaseMs: 60_000, timeoutMs: 10_000, materials,
  });
  assert.equal(failed.status, "FAILED_RETRYABLE");
  assert.equal((await db.query("SELECT status FROM f002_scope_item WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3", ["workspace", run.id, scope.scopeId])).rows[0].status, "DONE");
  const failedScope = await repository.getScope(owner, "workspace", run.id, scope.scopeId);
  await repository.retryScope(owner, "workspace", run.id, scope.scopeId, { revision: failedScope.revision, operationId: "retry-recovery" });
  const recovered = await worker.run(owner, "workspace", run.id, scope.scopeId, {
    workerId: "recover-worker", leaseMs: 60_000, timeoutMs: 10_000, materials,
  });
  assert.equal(recovered.status, "READY_TO_SEAL");
});

test("F002 cancellation fences a late worker before it can alter a pending item", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "cancel-run", sourceInput, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scope = run.scopes[0];
  const claimed = await repository.claimScope(owner, "workspace", run.id, scope.scopeId, { workerId: "late-worker", leaseMs: 60_000 });
  const cancelled = await repository.cancelScope(owner, "workspace", run.id, scope.scopeId, { revision: claimed.revision, operationId: "cancel-a" });
  assert.equal(cancelled.status, "CANCELLED");
  await assert.rejects(repository.recordScopeItems(owner, {
    workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation,
    items: [{ materialId: "material-1", capabilityId: "javascript", status: "DONE" }],
  }), { code: "F002_STALE_SCOPE_WORKER" });
  assert.equal((await db.query("SELECT count(*)::int AS count FROM f002_scope_item WHERE workspace_id=$1 AND run_id=$2", ["workspace", run.id])).rows[0].count, 0);
});

test("F002 parses frozen bytes in a worker, persists invisible prepared records, then seals the exact ready scope", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "worker-success", sourceInput, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scope = run.scopes[0];
  const bytes = Buffer.from("export function order() { return true; }\n", "utf8");
  const worker = new F002Worker(repository);
  const ready = await worker.run(owner, "workspace", run.id, scope.scopeId, {
    workerId: "parser-worker", leaseMs: 60_000, timeoutMs: 10_000,
    materials: [{ componentId, pathBytes: Buffer.from("src/orders.js").toString("base64url"), bytes, contentDigest: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/javascript" }],
  });
  assert.equal(ready.status, "READY_TO_SEAL");
  assert.ok((await db.query("SELECT count(*)::int AS count FROM f002_prepared_record WHERE workspace_id=$1 AND run_id=$2", ["workspace", run.id])).rows[0].count > 0);
  const sealed = await new F002PublicationService(repository).publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.revision, operationId: "seal-worker" });
  assert.equal(sealed.status, "SEALED");
});

test("F002 production worker and replay reassemble inherited F001 Gaps through their durable binding", async (t) => {
  const source = await candidateFixture(t, { git: true, gaps: [{ ruleCode: "GIT_LFS_EXTERNAL", severity: "NON_BLOCKING", ruleVersion: "v1", affectedScope: "external-content" }] });
  const prepared = await new SourceCandidateService(source.repository, source.materials, source.blobs).prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const frozen = await new SourcePublicationService(source.repository, new SourceCandidateService(source.repository, source.materials, source.blobs)).seal(owner, source.context, {
    confirmationId: (await new SourcePublicationService(source.repository, new SourceCandidateService(source.repository, source.materials, source.blobs)).confirm(owner, source.context, {
      candidateId: prepared.id, gapSetId: prepared.gapSetId, reason: "F002 inherited gap regression fixture", expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })).id,
    clientToken: "f002-worker-source",
  });
  const configured = new F002Repository(source.db, {
    authorize: (actor, workspaceId, tx, maintain) => source.repository.authorize(actor, workspaceId, maintain, tx),
  });
  const sourceProfile = { ...profile, id: profile.id };
  await configured.registerProfile(sourceProfile);
  const admission = new F002AdmissionService(configured, new SourceAdmissionService(source.repository, new SourceCandidateService(source.repository, source.materials, source.blobs)));
  const run = await admission.start(owner, "workspace", { operationId: "source-backed-worker", reference: { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id }, profile: sourceProfile,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId: frozen.bundle.components[0].id }] }] });
  const ready = await new F002Worker(configured, { admission }).run(owner, "workspace", run.id, run.scopes[0].scopeId, {
    workerId: "source-backed-worker", leaseMs: 60_000, timeoutMs: 10_000,
  });
  assert.equal(ready.status, "READY_TO_SEAL");
  const stored = await source.db.query("SELECT payload FROM f002_prepared_record WHERE workspace_id=$1 AND run_id=$2 AND kind='MATERIAL'", ["workspace", run.id]);
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].payload.contentDigest, source.digest);
  const inherited = await source.db.query("SELECT payload FROM f002_prepared_record WHERE workspace_id=$1 AND run_id=$2 AND kind='GAP'", ["workspace", run.id]);
  assert.deepEqual(inherited.rows.filter((row) => row.payload.origin === "F001").map((row) => ({ origin: row.payload.origin, code: row.payload.code })), [{ origin: "F001", code: "GIT_LFS_EXTERNAL" }]);
  const sealed = await new F002PublicationService(configured).publish(owner, "workspace", run.id, run.scopes[0].scopeId, { revision: ready.revision, operationId: "seal-source-backed" });
  assert.equal((await new F002ReplayService(configured, { admission }).replay(owner, "workspace", sealed.graphVersionId)).status, "MATCH");
});
