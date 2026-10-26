import assert from "node:assert/strict";
import test from "node:test";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { owner } from "./support/source-truth-database.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { InvestigationService } from "../src/business-knowledge/investigation-service.js";
import { InvestigationWorker } from "../src/business-knowledge/worker.js";
import { F003ExecutionService } from "../src/business-knowledge/runtime.js";

const deferred = () => Promise.withResolvers();

async function interruptChild(f, action = null, ignoreAbort = false) {
  const entered = deferred(), run = await f.service.start(owner, "workspace", f.request);
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: async context => {
    const reservation = await f.service.reserveModelCall(owner, "workspace", run.id, context);
    if (context.input.phase === "PLAN") return { reservationId: reservation.id, result: { assignments: [{ slotId: "child-1", obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "read frozen rule", materialKeys: context.input.inventory.map(m => m.key) }] } };
    entered.resolve();
    if (ignoreAbort) return new Promise(() => {});
    return new Promise((_resolve, reject) => context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true }));
  } });
  const executor = new F003ExecutionService({ investigations: f.service, worker, resolveActor: async () => owner, workerId: "before-close" });
  await executor.dispatch(); await entered.promise;
  const before = await f.service.get(owner, "workspace", run.id);
  if (action) await f.service.control(owner, "workspace", run.id, { action, expectedRevision: before.revision });
  await executor.close();
  return { run, before, after: await f.service.get(owner, "workspace", run.id) };
}

test("F003 graceful close releases the active generation even if a model ignores abort, without failing or refunding its budget", { timeout: 15000 }, async t => {
  const f = await investigationFixture(t), { run, before, after } = await interruptChild(f, null, true);
  assert.equal(after.state, "QUEUED", "host shutdown is not a semantic/model failure");
  assert.ok(after.generation > before.generation);
  assert.equal(after.workerId, null); assert.equal(after.leaseUntil, null);
  assert.deepEqual(after.usage, before.usage); assert.equal(after.usage.modelCalls, 2);
  await assert.rejects(f.service.checkpoint(owner, "workspace", run.id, { generation: before.generation, key: "late-output", payload: {} }), { code: "F003_STALE_WORKER" });
  await assert.rejects(f.service.releaseForShutdown(owner, "workspace", run.id, { generation: before.generation, workerId: "before-close" }), { code: "F003_STALE_WORKER" });
  const events = await f.service.events(owner, "workspace", run.id);
  assert.equal(events.filter(e => e.event_type === "INVESTIGATION_HOST_INTERRUPTED").length, 1);
  assert.equal(events.filter(e => e.event_type === "INVESTIGATION_FAILED").length, 0);
  const checkpoints = await f.service.checkpoints(owner, "workspace", run.id);
  assert.ok(checkpoints.some(p => p.key === "plan")); assert.equal(checkpoints.some(p => p.key.startsWith('child-')), false);
  assert.ok((await f.service.findRunnable()).some(r => r.id === run.id));
  const phases = [];
  const recovered = new InvestigationWorker({ investigations: f.service, invokeModel: async context => {
    phases.push(context.input.phase);
    const reservation = await f.service.reserveModelCall(owner, "workspace", run.id, context);
    return { reservationId: reservation.id, result: context.input.phase === "INVESTIGATE" ? { candidates: [], relations: [] } : { reviews: [] } };
  } });
  await recovered.run(owner, "workspace", run.id, { workerId: "after-close" });
  assert.deepEqual(phases, ["INVESTIGATE", "VERIFY"], "completed Main planning is not replayed");
  assert.equal((await f.service.get(owner, "workspace", run.id)).usage.modelCalls, 4);
  assert.equal((await f.service.graph(owner, "workspace", run.id)).published, false);
});

test("F003 close cannot start a queued worker after its asynchronous actor lookup completes", async () => {
  const resolving = deferred(), actor = deferred(); let calls = 0;
  const executor = new F003ExecutionService({ investigations: { findRunnable: async () => [{ workspaceId: "w", id: "i", actorId: "a" }] },
    worker: { run: async () => { calls++; }, stop() {} }, resolveActor: async () => { resolving.resolve(); return actor.promise; } });
  await executor.dispatch(); await resolving.promise;
  const closing = executor.close(); actor.resolve(owner); await closing;
  assert.equal(calls, 0);
});

test("F003 graceful close never requeues a concurrently paused or cancelled investigation", async t => {
  const f = await investigationFixture(t);
  for (const action of ["PAUSE", "CANCEL"]) {
    f.request = { ...f.request, operationId: `close-${action}` };
    const { after } = await interruptChild(f, action);
    assert.equal(after.state, action === "PAUSE" ? "PAUSED" : "CANCELLED");
    assert.equal((await f.service.findRunnable()).some(r => r.id === after.id), false);
  }
});

test("F003 native PostgreSQL restart resumes a gracefully interrupted investigation with its original source and consumed budget", { skip: !process.env.F001_TEST_PG_BIN, timeout: 60000 }, async t => {
  const cluster = await isolatedPostgres(t); let databaseName;
  const f = await investigationFixture(t, { database: async () => { const result = await cluster.createDatabase(); databaseName = result.name; return result; } });
  const { run, before, after } = await interruptChild(f);
  assert.equal(after.state, "QUEUED");
  const checkpoints = await f.service.checkpoints(owner, "workspace", run.id);
  await cluster.restart();
  const sources = new SourceTruthRepository(cluster.pool(databaseName));
  const candidates = new SourceCandidateService(sources, new SourceMaterialRepository(sources), f.blobs);
  const service = new InvestigationService({ sources, sourceAdmission: new SourceAdmissionService(sources, candidates), profiles: f.profiles });
  const restored = await service.get(owner, "workspace", run.id);
  assert.deepEqual(restored.sourceInput, before.sourceInput); assert.deepEqual(restored.usage, before.usage);
  assert.deepEqual(await service.checkpoints(owner, "workspace", run.id), checkpoints);
  const executor = new F003ExecutionService({ investigations: service, resolveActor: async () => owner, workerId: "restarted",
    worker: new InvestigationWorker({ investigations: service, invokeModel: async context => {
      const reservation = await service.reserveModelCall(owner, "workspace", run.id, context);
      assert.notEqual(context.input.phase, "PLAN");
      return { reservationId: reservation.id, result: context.input.phase === "INVESTIGATE" ? { candidates: [], relations: [] } : { reviews: [] } };
    } }) });
  await executor.dispatch(); await executor.drain(); await executor.close();
  assert.equal((await service.get(owner, "workspace", run.id)).state, "COMPLETED");
  assert.equal((await service.get(owner, "workspace", run.id)).usage.modelCalls, 4);
  assert.equal((await service.events(owner, "workspace", run.id)).filter(e => e.event_type === "ANALYSIS_COLLECTED").length, 1);
});
