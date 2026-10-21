import assert from "node:assert/strict";
import test from "node:test";

import { createF002Runtime, F002ExecutionService, standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { owner, sourceDatabase } from "./support/source-truth-database.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";

test("F002 leaves failed scopes stopped until an explicit retry while recovering interrupted leases", async t => {
  const { db, repository: source } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspace, tx, maintain) => source.authorize(actor, workspace, maintain, tx) });
  const profile = standardF002Profile(); await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "failed-scope-recovery", profile,
    sourceInput: { bundleId: "a".repeat(64), receiptId: "owned-receipt" }, scopes: [{ selections: [{ kind: "COMPONENT", componentId: "b".repeat(64) }] }] });
  const scopeId = run.scopes[0].scopeId;
  const claimed = await repository.claimScope(owner, "workspace", run.id, scopeId, { workerId: "failed-worker", leaseMs: 60_000 });
  const failed = await repository.failScope(owner, { workspaceId: "workspace", runId: run.id, scopeId, generation: claimed.generation, diagnostic: { code: "F002_PARSE_TIMEOUT" } });
  const calls = [];
  const executor = new F002ExecutionService({ repository, worker: { run: async (...args) => calls.push(args) }, members: [owner] });
  t.after(() => executor.close());
  await executor.dispatch();
  await executor.enqueue(await repository.getRun(owner, "workspace", run.id));
  const runnable = await repository.findRunnableScopes();
  assert.deepEqual({ automaticallyRunnable: runnable.some(scope => scope.runId === run.id), calls: calls.length }, { automaticallyRunnable: false, calls: 0 });
  await repository.retryScope(owner, "workspace", run.id, scopeId, { revision: failed.revision, operationId: "explicit-retry" });
  await executor.dispatch(); assert.equal(calls.length, 1);
  await repository.claimScope(owner, "workspace", run.id, scopeId, { workerId: "interrupted-worker", leaseMs: 60_000 });
  await db.query("UPDATE f002_scope SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1", [run.id]);
  await executor.dispatch(); assert.equal(calls.length, 2, "an interrupted worker remains automatically recoverable");
});

test("F002 runtime reuses the configured F001 authority and installs an immutable standard profile", async (t) => {
  const { db, repository: sourceRepository } = await sourceDatabase(t);
  const sourceRuntime = {
    pool: db,
    services: { repository: sourceRepository, admission: new SourceAdmissionService(sourceRepository, {}) },
    configuration: { members: [{ actorId: owner.actorId, tenantId: owner.tenantId, tokenDigest: "a".repeat(64) }], origins: ["https://evidence.example.test"] },
  };
  const runtime = await createF002Runtime({ sourceRuntime, cursorSecret: "f002-runtime-cursor-secret" });
  assert.equal(typeof runtime.deterministicFactsHandler, "function");
  assert.equal(typeof runtime.start, "function");
  assert.equal(typeof runtime.close, "function");
  const profile = await runtime.services.repository.getProfile(owner, "workspace", standardF002Profile().id);
  assert.deepEqual(profile, standardF002Profile());
  assert.deepEqual(await runtime.services.repository.getProfile(owner, "workspace", structuredF002Profile().id), structuredF002Profile());
  assert.deepEqual(runtime.services.structuredProfile, structuredF002Profile());
  assert.equal(profile.redactionPolicyRevision, "policy-v1", "historic extraction profile stays immutable");
  assert.equal(runtime.services.materials.policyRevision, "policy-v4-private-key-boundaries", "current READ policy is not an old extraction revision");
  await assert.rejects(runtime.services.requests.submit(owner, "workspace", {
    operationId: "no-consumer", investigationId: "investigation", baseVersionId: "a".repeat(64), requestKind: "LOOKUP", question: "Where?", factRefs: ["f"], materialRefs: [], requestedCapabilities: [],
  }), { code: "F002_CONSUMER_UNAVAILABLE" });
  await runtime.start();
  await runtime.close();
});

test("F002 execution service dispatches persisted runnable scopes with a configured member and skips unknown actors", async () => {
  const calls = [];
  const repository = {
    async findRunnableScopes() {
      return [{ workspaceId: "workspace", runId: "recovered", scopeId: "scope-recovered", actorId: owner.actorId, status: "RUNNING" }];
    },
  };
  const worker = {
    async run(actor, workspaceId, runId, scopeId, options) {
      calls.push({ actor, workspaceId, runId, scopeId, options });
    },
  };
  const executor = new F002ExecutionService({ repository, worker, members: [owner], workerId: "runtime-test-worker", leaseMs: 1_000, pollIntervalMs: 60_000 });
  await executor.enqueue({ workspaceId: "workspace", id: "new-run", actorId: owner.actorId, scopes: [
    { scopeId: "scope-queued", status: "QUEUED" },
    { scopeId: "scope-sealed", status: "SEALED" },
  ] });
  await executor.enqueue({ workspaceId: "workspace", id: "unknown-run", actorId: "no-longer-a-member", scopes: [{ scopeId: "unknown", status: "QUEUED" }] });
  await executor.dispatch();
  assert.deepEqual(calls.map((call) => [call.workspaceId, call.runId, call.scopeId]), [
    ["workspace", "new-run", "scope-queued"],
    ["workspace", "recovered", "scope-recovered"],
  ]);
  assert.equal(calls.every((call) => call.actor.actorId === owner.actorId && call.actor.tenantId === owner.tenantId), true);
  await executor.close();
});
