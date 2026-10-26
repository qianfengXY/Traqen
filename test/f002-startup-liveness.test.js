import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { F002ExecutionService, createF002Runtime } from "../src/deterministic-facts/runtime.js";
import { F002ReplayExecutionService } from "../src/deterministic-facts/replay-service.js";
import { F002RequestExecutionService } from "../src/deterministic-facts/request-service.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { sourceDatabase, owner } from "./support/source-truth-database.js";

const actor = { actorId: "owner", tenantId: "tenant" };
const ref = { workspaceId: "workspace", runId: "run", scopeId: "scope", replayId: "replay", requestId: "request", actorId: "owner", status: "QUEUED" };
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
function fixture(kind, scan, execute, options = {}) {
  const settings = { members: [actor], pollIntervalMs: 60000, maxConcurrent: 1, ...options };
  if (kind === "scope") return new F002ExecutionService({ ...settings, repository: { findRunnableScopes: scan }, worker: { run: execute } });
  if (kind === "replay") return new F002ReplayExecutionService({ ...settings, replays: { findRunnable: scan, execute } });
  return new F002RequestExecutionService({ ...settings, repository: { findRunnableRequests: scan }, requests: { execute } });
}

test("F002 runtime drains the analysis scheduler even when another owned scheduler close rejects", async t => {
  const { db, repository } = await sourceDatabase(t);
  const runtime = await createF002Runtime({ sourceRuntime: { pool: db,
    services: { repository, admission: new SourceAdmissionService(repository, {}) },
    configuration: { members: [{ ...owner, tokenDigest: "a".repeat(64) }], origins: [] } }, cursorSecret: "owned-close-fault" });
  const fault = new Error("owned replay close fault");
  runtime.services.replayExecutor.close = async () => { throw fault; };
  await assert.rejects(runtime.close(), error => error === fault);
  assert.equal(runtime.services.executor.closed, true);
  assert.equal(runtime.services.executor.timer, null);
});
async function within(promise, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 1000); })]); }
  finally { clearTimeout(timer); }
}

for (const kind of ["scope", "replay", "request"]) {
  test(`F002 ${kind} startup admits native HTTP while an existing worker is held, then drains only owned work`, async () => {
    const held = gate(), entered = gate(); let calls = 0;
    const executor = fixture(kind, async () => [ref], async () => { calls++; entered.release(); await held.promise; });
    const server = createServer((request, response) => response.end("current persisted progress"));
    const boot = (async () => { await executor.start(); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); })();
    try {
      await entered.promise;
      await within(boot, "entry is still waiting for the existing worker, not startup readiness");
      assert.equal(server.listening, true);
      assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}`)).text(), "current persisted progress");
      const duplicate = executor.dispatch();
      await new Promise(setImmediate); assert.equal(calls, 1, "startup and polling share concurrency/duplicate fences");
      let drained = false; const closing = executor.close().then(() => { drained = true; });
      await new Promise(setImmediate); assert.equal(drained, false, "close must await its active worker");
      held.release(); await Promise.all([closing, duplicate]);
      await executor.dispatch(); assert.equal(calls, 1, "closed scheduler cannot claim more work");
    } finally {
      held.release(); await boot; await executor.close();
      if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    }
  });

  test(`F002 ${kind} initial queue failure rejects readiness, unlike a retryable timer scan`, async () => {
    const failure = new Error("owned initial scan failed");
    const executor = fixture(kind, async () => { throw failure; }, async () => assert.fail("failed scan cannot claim"));
    try { await assert.rejects(executor.start(), error => error === failure); assert.equal(executor.timer, null); }
    finally { await executor.close(); }
  });

  test(`F002 ${kind} close fences a pending startup scan and a pending current-actor lookup`, async () => {
    for (const phase of ["scan", "actor"]) {
      const held = gate(), entered = gate(); let calls = 0;
      const executor = fixture(kind, async () => {
        if (phase === "scan") { entered.release(); await held.promise; }
        return [ref];
      }, async () => { calls++; }, { resolveActor: async () => {
        if (phase === "actor") { entered.release(); await held.promise; }
        return actor;
      } });
      const starting = executor.start();
      try {
        await entered.promise; const closing = executor.close(); held.release();
        await Promise.all([starting, closing]); assert.equal(calls, 0, phase);
        assert.equal(executor.timer, null);
      } finally { held.release(); await starting.catch(() => {}); await executor.close(); }
    }
  });
}
