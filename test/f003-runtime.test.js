import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { createF003HttpHandler } from "../src/business-knowledge/http-handler.js";
import { F003ExecutionService, createF003Runtime } from "../src/business-knowledge/runtime.js";

test("F003 HTTP derives identity on the server, persists admission and rejects forged or foreign access", async t => {
  const f = await investigationFixture(t), enqueued = [], stopped = [];
  const handler = createF003HttpHandler({ services: { investigations: f.service, executor: { enqueue: r => enqueued.push(r.id) },
    worker: { stop: (w, id) => stopped.push([w, id]) } }, allowedOrigins: ["https://allowed.test"],
    authenticate: req => req.headers.authorization === "Bearer owner" ? owner : reader });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/business-knowledge`;
  const headers = { authorization: "Bearer owner", "content-type": "application/json", origin: "https://allowed.test" };
  const created = await fetch(`${root}/investigations`, { method: "POST", headers, body: JSON.stringify(f.request) });
  assert.equal(created.status, 202);
  const run = (await created.json()).investigation;
  assert.deepEqual(enqueued, [run.id]);
  assert.equal((await (await fetch(`${root}/investigations/${run.id}`, { headers })).json()).investigation.actorId, owner.actorId);
  assert.equal((await fetch(`${root}/investigations/${run.id}`, { headers: { authorization: "Bearer reader" } })).status, 403);
  const forged = await fetch(`${root}/investigations`, { method: "POST", headers, body: JSON.stringify({ ...f.request, actorId: owner.actorId }) });
  assert.equal(forged.status, 422);
  assert.equal((await fetch(root, { headers: { ...headers, origin: "https://wrong.test" } })).status, 403);
  assert.equal((await fetch(`${root}/investigations/${run.id}/graph?includeUncertain=yes`, { headers })).status, 422);
  const cancelled = await fetch(`${root}/investigations/${run.id}/cancel`, { method: "POST", headers, body: JSON.stringify({ expectedRevision: run.revision }) });
  assert.equal(cancelled.status, 200); assert.deepEqual(stopped, [["workspace", run.id]]);
});

test("F003 scheduler recovers persisted queue identities and re-resolves the current actor", async () => {
  const completed = [], resolved = [];
  const executor = new F003ExecutionService({ investigations: { findRunnable: async () => [{ workspaceId: "w", id: "i", actorId: "a" }] },
    worker: { run: async (actor, w, id) => completed.push([actor.actorId, w, id]), stop() {} },
    resolveActor: async (id, w) => { resolved.push([id, w]); return { actorId: id, tenantId: "t" }; }, maxConcurrent: 1 });
  await executor.dispatch(); await executor.drain(); await executor.close();
  assert.deepEqual(resolved, [["a", "w"]]); assert.deepEqual(completed, [["a", "w", "i"]]);
});

test("F003 runtime requires the actual F001 authority and application F006 model port", async t => {
  const f = await investigationFixture(t);
  await assert.rejects(createF003Runtime({}), TypeError);
  const runtime = await createF003Runtime({ sourceRuntime: { pool: f.db, services: { repository: f.repository, admission: f.sourceAdmission },
    configuration: { members: [{ ...owner, tokenDigest: "a".repeat(64) }], origins: [] } },
    application: { createBusinessKnowledgeModelExecutor: () => async () => { throw new Error("must not execute in this construction test"); } } });
  assert.ok(runtime.services.investigations.resolve);
  assert.ok(runtime.services.investigations.authorizeRead);
  await runtime.close();
});
