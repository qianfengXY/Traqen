import assert from "node:assert/strict";
import test from "node:test";
import { boundedF002Profile, technicalF002Profile, F002ExecutionService } from "../src/deterministic-facts/runtime.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { F002Worker } from "../src/deterministic-facts/worker.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { owner, sourceDatabase } from "./support/source-truth-database.js";

async function fixture(t, profile) {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspace, tx, maintain) => sources.authorize(actor, workspace, maintain, tx) });
  await repository.registerProfile(profile);
  const componentId = "a".repeat(64);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "automatic-test", profile,
    sourceInput: { bundleId: "b".repeat(64), receiptId: "receipt", inheritedGapSet: { count: "0" } },
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const worker = new F002Worker(repository), publication = new F002PublicationService(repository);
  const materials = [{ componentId, pathBytes: Buffer.from("source.unknown").toString("base64url"), bytes: Buffer.from("fixed source"), mediaType: "text/plain" }];
  const ready = await worker.run(owner, "workspace", run.id, run.scopes[0].scopeId, { workerId: "prepare-auto", leaseMs: 60_000, materials });
  return { db, sources, repository, worker, publication, run, ready };
}

test("F002 automatically publishes a closed scope with explicit limitations after restart, once under concurrent dispatch", async t => {
  const f = await fixture(t, technicalF002Profile());
  const executors = [1, 2].map(index => new F002ExecutionService({ repository: f.repository, publication: f.publication,
    worker: { run: async () => assert.fail("ready scope must not parse again") }, members: [owner], workerId: `restart-${index}` }));
  t.after(() => Promise.all(executors.map(executor => executor.close())));
  assert.equal((await f.repository.findRunnableScopes()).some(scope => scope.runId === f.run.id), true, "ready automatic results must survive a process crash");
  await Promise.all(executors.map(executor => executor.dispatch()));
  const scope = await f.repository.getScope(owner, "workspace", f.run.id, f.ready.scopeId);
  assert.equal(scope.status, "SEALED", "no user check/seal action is required");
  assert.match(scope.graphVersionId, /^[a-f0-9]{64}$/);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM f002_fact_set")).rows[0].n, 1);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM f002_record WHERE kind='GAP'")).rows[0].n, 1, "FORMAT_UNSUPPORTED remains visible, not a reason for a manual gate");
});

test("F002 keeps historical profiles manual", async t => {
  const f = await fixture(t, boundedF002Profile());
  assert.equal((await f.repository.findRunnableScopes()).some(scope => scope.runId === f.run.id), false);
  const executor = new F002ExecutionService({ repository: f.repository, worker: f.worker, publication: f.publication, members: [owner] });
  t.after(() => executor.close());
  await executor.enqueue(await f.repository.getRun(owner, "workspace", f.run.id));
  assert.equal((await f.repository.getScope(owner, "workspace", f.run.id, f.ready.scopeId)).status, "READY_TO_SEAL");
});

test("F002 automatic publication refuses pending work and an unresolved initiating actor", async t => {
  const f = await fixture(t, technicalF002Profile());
  await f.db.query("UPDATE f002_scope_item SET status='PENDING' WHERE run_id=$1", [f.run.id]);
  const executor = new F002ExecutionService({ repository: f.repository, worker: f.worker, publication: f.publication, members: [owner] });
  t.after(() => executor.close());
  await executor.dispatch();
  assert.equal((await f.repository.getScope(owner, "workspace", f.run.id, f.ready.scopeId)).status, "BLOCKED", "a failed automatic closure check is visible, not a perpetual publishing spinner");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM f002_fact_set")).rows[0].n, 0);
  const denied = new F002ExecutionService({ repository: f.repository, worker: f.worker, publication: f.publication, resolveActor: async () => null });
  t.after(() => denied.close());
  await denied.dispatch();
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM f002_fact_set")).rows[0].n, 0);
});

test("F002 automatic publication rechecks a ready scope's real current source ACL", async t => {
  const f = await fixture(t, technicalF002Profile());
  await f.sources.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "REVOKED" }] });
  const executor = new F002ExecutionService({ repository: f.repository, worker: { run: async () => assert.fail("ready scope cannot parse again") },
    publication: f.publication, members: [owner] });
  t.after(() => executor.close());
  await executor.dispatch();
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM f002_fact_set")).rows[0].n, 0);
  assert.equal((await f.db.query("SELECT status FROM f002_scope WHERE run_id=$1", [f.run.id])).rows[0].status, "READY_TO_SEAL");
});
