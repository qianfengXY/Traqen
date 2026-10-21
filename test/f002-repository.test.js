import assert from "node:assert/strict";
import test from "node:test";

import { createProfileId } from "../src/deterministic-facts/identity.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { owner, reader, sourceDatabase } from "./support/source-truth-database.js";

const componentA = "a".repeat(64);
const componentB = "b".repeat(64);
const bundleId = "c".repeat(64);

test("F002 refuses every shared transaction when restore is unverified and fences maintenance at the paired backup waterline", async t => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx, maintain) => sources.authorize(actor, workspaceId, maintain, tx) });
  await db.query("UPDATE source_truth_workspace SET restore_ready=false WHERE workspace_id='workspace'");
  let callbacks = 0;
  for (const method of ["withAuthorizedWorkspace", "withMaintainedWorkspace"]) {
    await assert.rejects(repository[method](owner, "workspace", () => { callbacks++; }), { code: "F002_RESTORE_UNVERIFIED", status: 503 });
  }
  assert.equal(callbacks, 0);
  await assert.rejects(repository.withAuthorizedWorkspace(reader, "workspace2", () => {}), { code: "SOURCE_FORBIDDEN" });
  await db.query("UPDATE source_truth_workspace SET restore_ready=true,backup_barrier=true WHERE workspace_id='workspace'");
  assert.equal(await repository.withAuthorizedWorkspace(reader, "workspace", () => "historical-read"), "historical-read");
  await assert.rejects(repository.withMaintainedWorkspace(owner, "workspace", () => { callbacks++; }), { code: "F002_BACKUP_BUSY", status: 503 });
  assert.equal(callbacks, 0);
  await db.query("UPDATE source_truth_workspace SET backup_barrier=false WHERE workspace_id='workspace'");
  assert.equal(await repository.withMaintainedWorkspace(owner, "workspace", () => "restored-maintenance"), "restored-maintenance");
});

function profile() {
  const input = {
    version: "1", schemaVersion: 1, capabilityIds: ["inventory", "javascript"], ruleVersions: ["inventory@1", "javascript@1"],
    canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024, maxRecords: 10 }, redactionPolicyRevision: "policy-v1",
  };
  return { ...input, id: createProfileId(input), name: "standard", startable: true };
}

function runInput(overrides = {}) {
  return {
    operationId: "create-facts", sourceInput: {
      workspaceId: "workspace", bundleId, sourceBundleSnapshotId: bundleId, receiptId: "receipt-1", receiptStatus: "READY",
      confirmationId: "confirmation-1", acceptanceRecordIds: [], receiptValidUntil: null, qualifiedAt: "2026-09-17T00:00:00.000Z",
      inventoryId: "inventory-1", inventoryDigest: "inventory-1", policyRevisionId: "policy-v1", inheritedGapSet: { id: "gaps-1", count: "0", consumption: "ALL_PAGES_REQUIRED" },
    },
    profile: profile(), scopes: [
      { label: "A", selections: [{ kind: "DIRECTORY", componentId: componentA, pathBytes: "c3Jj" }] },
      { label: "B", selections: [{ kind: "ENTRY", componentId: componentB, pathBytes: "c3JjL2FwcC5qcw" }] },
    ], ...overrides,
  };
}

test("F002 direct claims cannot bypass explicit retry of FAILED_RETRYABLE scopes", async t => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx, maintain) => sources.authorize(actor, workspaceId, maintain, tx) });
  await repository.registerProfile(profile());
  const run = await repository.createAdmittedRun(owner, "workspace", runInput());
  const scopeId = run.scopes[0].scopeId, claim = { workerId: "retry-worker", leaseMs: 60_000 };
  const claimed = await repository.claimScope(owner, "workspace", run.id, scopeId, claim);
  await repository.failScope(owner, { workspaceId: "workspace", runId: run.id, scopeId, generation: claimed.generation, diagnostic: { code: "SYNTHETIC_FAILURE" } });
  await assert.rejects(repository.claimScope(owner, "workspace", run.id, scopeId, claim), { code: "F002_SCOPE_LEASE_BUSY" });
  const failed = await repository.getScope(owner, "workspace", run.id, scopeId);
  await repository.retryScope(owner, "workspace", run.id, scopeId, { revision: failed.revision, operationId: "explicit-retry" });
  assert.equal((await repository.claimScope(owner, "workspace", run.id, scopeId, claim)).generation, claimed.generation + 1);
});

test("F002 derived scope ownership has a leading Workspace/run/scope database index", async t => {
  const { db } = await sourceDatabase(t);
  const indexes = (await db.query("SELECT indexdef FROM pg_indexes WHERE tablename='f002_request'")).rows;
  assert.ok(indexes.some(row => /\(workspace_id, derived_run_id, derived_scope_id\)/.test(row.indexdef)), JSON.stringify(indexes));
});

test("F002 scope lease renewal cannot resurrect expired, cancelled, replaced or unauthorized workers", async t => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx, maintain) => sources.authorize(actor, workspaceId, maintain, tx) });
  await repository.registerProfile(profile());
  const run = await repository.createAdmittedRun(owner, "workspace", runInput());
  const scopeId = run.scopes[0].scopeId;
  const claimed = await repository.claimScope(owner, "workspace", run.id, scopeId, { workerId: "lease-worker", leaseMs: 60_000 });
  const input = { workspaceId: "workspace", runId: run.id, scopeId, generation: claimed.generation, workerId: "lease-worker", leaseMs: 60_000 };
  await db.query("UPDATE f002_scope SET lease_until=clock_timestamp()+interval '10 seconds' WHERE run_id=$1 AND scope_id=$2", [run.id, scopeId]);
  const renewed = await repository.renewScopeLease(owner, input);
  assert.ok(Date.parse(renewed.leaseUntil) > Date.now() + 30_000);
  assert.equal(renewed.generation, claimed.generation);
  assert.equal(renewed.revision, claimed.revision);
  await assert.rejects(repository.renewScopeLease(owner, { ...input, workerId: "impostor" }), { code: "F002_STALE_SCOPE_WORKER" });
  await assert.rejects(repository.renewScopeLease(owner, { ...input, generation: claimed.generation + 1 }), { code: "F002_STALE_SCOPE_WORKER" });
  await db.query("UPDATE f002_scope SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1 AND scope_id=$2", [run.id, scopeId]);
  await assert.rejects(repository.renewScopeLease(owner, input), { code: "F002_STALE_SCOPE_WORKER" });
  const recovered = await repository.claimScope(owner, "workspace", run.id, scopeId, { workerId: "recovered-worker", leaseMs: 60_000 });
  const next = { ...input, workerId: "recovered-worker", generation: recovered.generation };
  await assert.rejects(repository.renewScopeLease(owner, input), { code: "F002_STALE_SCOPE_WORKER" });
  await db.query("UPDATE source_truth_workspace SET restore_ready=false WHERE workspace_id='workspace'");
  await assert.rejects(repository.renewScopeLease(owner, next), { code: "F002_RESTORE_UNVERIFIED" });
  await db.query("UPDATE source_truth_workspace SET restore_ready=true WHERE workspace_id='workspace'");
  await sources.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "REVOKED" }] });
  await assert.rejects(repository.renewScopeLease(owner, next), { code: "SOURCE_FORBIDDEN" });
  await sources.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "MAINTAIN" }] });
  await repository.cancelScope(owner, "workspace", run.id, scopeId, { revision: recovered.revision, operationId: "cancel-renewal" });
  await assert.rejects(repository.renewScopeLease(owner, next), { code: "F002_STALE_SCOPE_WORKER" });
});

test("F002 persists a canonical scope lifecycle: A can seal while B continues and stale workers stay fenced", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile());
  const run = await repository.createAdmittedRun(owner, "workspace", runInput());
  assert.equal(run.status, "PROCESSING");
  assert.equal(run.scopes.length, 2);

  const [scopeA, scopeB] = run.scopes;
  const claimedA = await repository.claimScope(owner, "workspace", run.id, scopeA.scopeId, { workerId: "worker-a", leaseMs: 60_000 });
  const claimedB = await repository.claimScope(owner, "workspace", run.id, scopeB.scopeId, { workerId: "worker-b", leaseMs: 60_000 });
  const readyA = await repository.readyToSeal(owner, { workspaceId: "workspace", runId: run.id, scopeId: scopeA.scopeId, generation: claimedA.generation });
  const sealedA = await repository.sealScope(owner, "workspace", run.id, scopeA.scopeId, { revision: readyA.revision, operationId: "seal-a", graphVersionId: "d".repeat(64) });
  assert.equal(sealedA.status, "SEALED");
  assert.equal((await repository.getRun(owner, "workspace", run.id)).status, "PROCESSING");
  assert.equal((await repository.getScope(owner, "workspace", run.id, scopeB.scopeId)).status, "RUNNING");

  await assert.rejects(
    repository.readyToSeal(owner, { workspaceId: "workspace", runId: run.id, scopeId: scopeA.scopeId, generation: claimedA.generation }),
    { code: "F002_STALE_SCOPE_WORKER" },
  );
  await assert.rejects(
    repository.sealScope(owner, "workspace", run.id, scopeA.scopeId, { revision: readyA.revision, operationId: "other-seal", graphVersionId: "d".repeat(64) }),
    { code: "F002_SCOPE_REVISION_CONFLICT" },
  );
  assert.equal((await repository.getScope(owner, "workspace", run.id, scopeB.scopeId)).generation, claimedB.generation);
});

test("F002 operation idempotency compares canonical requests and does not create a second admitted run", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile());
  const first = await repository.createAdmittedRun(owner, "workspace", runInput());
  const same = await repository.createAdmittedRun(owner, "workspace", runInput({ scopes: [...runInput().scopes].reverse() }));
  assert.equal(same.id, first.id);
  await assert.rejects(
    repository.createAdmittedRun(owner, "workspace", runInput({ scopes: [{ ...runInput().scopes[0], label: "Changed" }, runInput().scopes[1]] })),
    { code: "F002_OPERATION_CONFLICT" },
  );
});

test("F002 recovers a scope operation from its durable receipt, not a later scope state", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx, maintain) => sources.authorize(actor, workspaceId, maintain, tx) });
  await repository.registerProfile(profile());
  const run = await repository.createAdmittedRun(owner, "workspace", runInput());
  const scope = run.scopes[0];
  const claimed = await repository.claimScope(owner, "workspace", run.id, scope.scopeId, { workerId: "receipt-worker", leaseMs: 60_000 });
  const failed = await repository.failScope(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId,
    generation: claimed.generation, diagnostic: { code: "RETRYABLE_TEST_FAILURE" } });
  await repository.retryScope(owner, "workspace", run.id, scope.scopeId, { revision: failed.revision, operationId: "lost-retry-response" });
  const second = await repository.claimScope(owner, "workspace", run.id, scope.scopeId, { workerId: "receipt-worker-2", leaseMs: 60_000 });
  await repository.failScope(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId,
    generation: second.generation, diagnostic: { code: "A_LATER_FAILURE" } });
  // The current diagnostic has already changed. Only the immutable event can
  // prove that the original retry was accepted without issuing another POST.
  assert.equal(typeof repository.findScopeOperation, "function", "scope writes need durable operation reconciliation");
  const receipt = await repository.findScopeOperation(owner, "workspace", "lost-retry-response");
  assert.deepEqual({ operationId: receipt.operationId, runId: receipt.runId, scopeId: receipt.scopeId, eventType: receipt.eventType },
    { operationId: "lost-retry-response", runId: run.id, scopeId: scope.scopeId, eventType: "SCOPE_RETRY_QUEUED" });
  assert.equal(await repository.findScopeOperation(owner, "workspace", "never-accepted"), null);
  await assert.rejects(repository.findScopeOperation(owner, "other-workspace", "lost-retry-response"), { code: "SOURCE_FORBIDDEN" });
  await assert.rejects(repository.findScopeOperation(reader, "workspace", "lost-retry-response"), { code: "SOURCE_FORBIDDEN" });
  assert.equal((await db.query("SELECT count(*)::int AS count FROM f002_event WHERE payload->>'operationId'='lost-retry-response'")).rows[0].count, 1);
});
