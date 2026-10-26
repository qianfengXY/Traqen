import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { F006ExecutionConfiguration } from "../src/business-knowledge/execution-configuration.js";
import { InvestigationService } from "../src/business-knowledge/investigation-service.js";
import { InvestigationWorker } from "../src/business-knowledge/worker.js";
import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { AnalysisModelRegistry } from "../src/analysis/index.js";
import { PostgresTraceabilityStore } from "../src/storage/index.js";
import { F003HostShutdown } from "../src/business-knowledge/errors.js";
import { createF003HttpHandler } from "../src/business-knowledge/http-handler.js";

const privateCanary = "stderr-private-source-and-credential-canary";
async function fixture(t, failure) {
  const f = await investigationFixture(t);
  const entered = Promise.withResolvers();
  const registry = new AnalysisModelRegistry({ cliSpawn: () => {
    const child = new EventEmitter(); child.pid = 99999999;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => queueMicrotask(() => child.emit("close", 1));
    let prompt = "";
    child.stdin = new Writable({ write(b, _e, cb) { prompt += b; cb(); }, final(cb) {
      const task = JSON.parse(prompt), input = task.input;
      queueMicrotask(() => {
        if (input.phase === "INVESTIGATE") {
          entered.resolve();
          child.stderr.write(privateCanary);
          if (["TIMEOUT", "WAIT"].includes(failure)) return;
          if (failure === "OUTPUT_LIMIT") { child.stdout.write("x".repeat(1024)); return; }
          if (failure === "INVALID_JSON") { child.stdout.end(privateCanary); child.emit("close", 0); return; }
          child.emit("close", 17); return;
        }
        const result = task.task === "connection-verification" ? { ready: true, challenge: input.challenge }
          : { assignments: [{ slotId: input.childSlots[0].id, obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "read source", materialKeys: [input.inventory[0].key] }] };
        child.stdout.end(JSON.stringify(result)); child.stderr.end(); child.emit("close", 0);
      }); cb();
    } });
    return child;
  } });
  const application = new TraceabilityApplication({ store: new PostgresTraceabilityStore(f.db), analysisModelRegistry: registry,
    secretReferenceResolver: async () => "selected-private-test-key" });
  await application.saveGlobalAccount({ accountId: "account", displayName: "isolated account", authMethod: "API_KEY", secretRefId: "vault://isolated", expectedVersion: 0 });
  await application.configureGlobalCliModel({ profileId: "model", accountId: "account", cliAdapter: "CODEX", model: "test-only", timeoutMs: failure === "WAIT" ? 30000 : 30, maximumOutputBytes: 512 });
  await application.verifyGlobalCliModel("model", { taskPolicy: "BUSINESS_KNOWLEDGE" });
  await application.saveWorkspaceCapabilityDraft("workspace", { expectedVersion: 0, mainAgentSlot: { modelProfileId: "model" },
    childAgentSlots: [{ id: "child", modelProfileId: "model", independenceGroup: "child" }], projectCapabilityRevisionIds: [], disabledKeys: [] });
  const profile = await application.activateWorkspaceCapabilityDraft("workspace");
  const service = new InvestigationService({ sources: f.repository, sourceAdmission: f.sourceAdmission, profiles: new F006ExecutionConfiguration() });
  const run = await service.start(owner, "workspace", { ...f.request, expectedProfileId: profile.id });
  return { ...f, service, run, entered: entered.promise, worker: new InvestigationWorker({ investigations: service, invokeModel: application.createBusinessKnowledgeModelExecutor(service) }) };
}

for (const [failure, code] of [["TIMEOUT", "F003_MODEL_TIMEOUT"], ["OUTPUT_LIMIT", "F003_MODEL_OUTPUT_LIMIT"],
  ["EXIT", "F003_MODEL_PROCESS_EXIT"], ["INVALID_JSON", "F003_MODEL_OUTPUT_INVALID"]]) {
  test(`F003 persists safe ${failure} cause and exact model task outcome through the actual F006 port`, async t => {
    const f = await fixture(t, failure);
    await assert.rejects(f.worker.run(owner, "workspace", f.run.id, { workerId: "diagnostic" }), error => {
      assert.equal(error.code, code); assert.equal(error.message.includes(privateCanary), false); return true;
    });
    const run = await f.service.get(owner, "workspace", f.run.id), events = await f.service.events(owner, "workspace", f.run.id);
    assert.equal(run.state, "FAILED"); assert.equal(run.usage.modelCalls, 2); assert.ok(run.usage.readBytes > 0);
    assert.equal(run.lastFailure.code, code); assert.equal(run.lastFailure.phase, "INVESTIGATE");
    assert.match(run.lastFailure.taskKey,/^child-[a-f0-9]{64}$/); assert.equal(run.lastFailure.slotId, run.profile.childAgentSlots[0].id);
    const finished = events.filter(e => e.event_type === "MODEL_CALL_FINISHED").map(e => e.payload);
    assert.deepEqual(finished.map(e => e.outcome), ["SUCCEEDED", "FAILED"]);
    assert.equal(finished[1].code, code); assert.equal(finished[1].phase, "INVESTIGATE"); assert.equal(finished[1].taskKey,run.lastFailure.taskKey);
    assert.equal(finished[1].slotId, run.lastFailure.slotId); assert.equal(finished[1].generation, run.generation);
    const failed = events.find(e => e.event_type === "INVESTIGATION_FAILED").payload;
    assert.deepEqual(failed, run.lastFailure);
    assert.equal(JSON.stringify({ run, events }).includes(privateCanary), false);
    assert.equal(JSON.stringify({ run, events }).includes("selected-private-test-key"), false);
    if (failure === "TIMEOUT") {
      const handler = createF003HttpHandler({ services: { investigations: f.service }, authenticate: () => owner });
      const server = createServer((req, res) => handler(req, res));
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
      const url = `http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/business-knowledge/investigations/${run.id}`;
      assert.deepEqual((await (await fetch(url)).json()).investigation.lastFailure, run.lastFailure);
      assert.deepEqual((await (await fetch(`${url}/events`)).json()).events, JSON.parse(JSON.stringify(events)));
    }
  });
}

test("F003 late model outcomes retain the original reservation identity without reviving a cancelled generation", async t => {
  const f = await investigationFixture(t), admitted = await f.service.start(owner, "workspace", f.request);
  const run = await f.service.claim(owner, "workspace", admitted.id, { workerId: "old" });
  const reservation = await f.service.reserveModelCall(owner, "workspace", run.id, { generation: run.generation, slotId: "main", taskKey: "plan", phase: "PLAN" });
  await f.service.beginModelCall(owner, "workspace", run.id, { generation: run.generation, reservationId: reservation.id });
  const cancelled = await f.service.control(owner, "workspace", run.id, { action: "CANCEL", expectedRevision: (await f.service.get(owner, "workspace", run.id)).revision });
  await assert.rejects(f.service.finishModelCall(reader, "workspace", run.id, { generation: run.generation, reservationId: reservation.id, outcome: "FAILED" }), { status: 403 });
  await assert.rejects(f.service.finishModelCall(owner, "workspace", run.id, { generation: cancelled.generation, reservationId: reservation.id, outcome: "FAILED" }), { code: "F003_MODEL_CALL_UNAVAILABLE" });
  const outcome = await f.service.finishModelCall(owner, "workspace", run.id, { generation: run.generation, reservationId: reservation.id, outcome: "SUCCEEDED" });
  assert.equal(outcome.outcome, "DISCARDED"); assert.equal(outcome.taskKey, "plan"); assert.equal(outcome.phase, "PLAN");
  assert.equal(outcome.generation, run.generation);
  assert.deepEqual(await f.service.finishModelCall(owner, "workspace", run.id, { generation: run.generation, reservationId: reservation.id, outcome: "SUCCEEDED" }), outcome);
  assert.deepEqual(await f.service.get(owner, "workspace", run.id), cancelled);
  const events = await f.service.events(owner, "workspace", run.id);
  assert.equal(events.filter(e => e.event_type === "MODEL_CALL_FINISHED").length, 1);
  await assert.rejects(f.service.finishModelCall(owner, "workspace", run.id, { generation: run.generation, reservationId: "foreign", outcome: "FAILED" }), { code: "F003_MODEL_CALL_UNAVAILABLE" });
});

test("F003 terminal audit cannot authorize expired results or revive an already finished reservation", async t => {
  const f = await investigationFixture(t), admitted = await f.service.start(owner, "workspace", f.request);
  const run = await f.service.claim(owner, "workspace", admitted.id, { workerId: "expiring" });
  const unused = await f.service.reserveModelCall(owner, "workspace", run.id, { generation: run.generation, slotId: "main", taskKey: "preflight", phase: "PLAN" });
  const failed = await f.service.finishModelCall(owner, "workspace", run.id, { generation: run.generation, reservationId: unused.id, outcome: "FAILED", code: privateCanary });
  assert.equal(failed.started, false); assert.equal(failed.code, undefined);
  await assert.rejects(f.service.beginModelCall(owner, "workspace", run.id, { generation: run.generation, reservationId: unused.id }), { code: "F003_MODEL_CALL_UNAVAILABLE" });
  const reservation = await f.service.reserveModelCall(owner, "workspace", run.id, { generation: run.generation, slotId: "main", taskKey: "plan", phase: "PLAN" });
  await assert.rejects(f.service.finishModelCall(owner, "workspace", run.id, { generation: run.generation, reservationId: reservation.id, outcome: "SUCCEEDED" }), { code: "F003_MODEL_CALL_UNAVAILABLE" });
  await f.service.beginModelCall(owner, "workspace", run.id, { generation: run.generation, reservationId: reservation.id });
  await f.db.query("UPDATE f003_investigation SET payload=jsonb_set(payload,'{budget,deadline}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1", [run.id]);
  const expired = await f.service.expire(owner, "workspace", run.id);
  const result = await f.service.finishModelCall(owner, "workspace", run.id, { generation: run.generation, reservationId: reservation.id, outcome: "SUCCEEDED" });
  assert.equal(result.outcome, "DISCARDED"); assert.deepEqual(await f.service.get(owner, "workspace", run.id), expired);
  await f.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: owner.actorId, role: "REVOKED" }] });
  await assert.rejects(f.service.finishModelCall(owner, "workspace", run.id, { generation: run.generation, reservationId: reservation.id, outcome: "FAILED" }), { status: 403 });
});

test("F003 actual model terminal diagnostics preserve cancellation and exact trusted host-shutdown identity", async t => {
  const f = await fixture(t, "WAIT");
  for (const host of [false, true]) {
    const run = host ? await f.service.start(owner, "workspace", { ...f.request, expectedProfileId: f.run.profile.id, operationId: "host-stop" }) : f.run;
    const controller = new AbortController(), rejection = assert.rejects(f.worker.run(owner, "workspace", run.id,
      { workerId: "interrupted", signal: controller.signal }), error => error === controller.signal.reason);
    if (!host) await f.entered;
    // Poll the persisted production event, not elapsed model time.
    let before;
    for (let i = 0; i < 100; i++) {
      const events = await f.service.events(owner, "workspace", run.id);
      if (events.filter(e => e.event_type === "MODEL_CALL_STARTED").length === 2) { before = await f.service.get(owner, "workspace", run.id); break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(before, "actual Child call began");
    if (!host) await f.service.control(owner, "workspace", run.id, { action: "CANCEL", expectedRevision: before.revision });
    controller.abort(host ? new F003HostShutdown() : new Error("private abort message must not be persisted"));
    await rejection;
    let terminal;
    for (let i = 0; i < 100; i++) {
      terminal = (await f.service.events(owner, "workspace", run.id)).filter(e => e.event_type === "MODEL_CALL_FINISHED");
      if (terminal.length === 2) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(terminal.map(e => e.payload.outcome), ["SUCCEEDED", "ABORTED"]);
    assert.equal(terminal[1].payload.phase, "INVESTIGATE");
    const after = await f.service.get(owner, "workspace", run.id);
    assert.equal(after.state, host ? "QUEUED" : "CANCELLED");
    assert.deepEqual(after.usage, before.usage); assert.equal(after.lastFailure, undefined);
    assert.equal(JSON.stringify(terminal).includes("private abort message"), false);
  }
});
