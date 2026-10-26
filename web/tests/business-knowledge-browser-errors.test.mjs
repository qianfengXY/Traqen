import assert from "node:assert/strict";
import test from "node:test";
import { BusinessKnowledgeClient } from "../app/business-knowledge/client.ts";

function browser(t) {
  const previous = globalThis.window, events = [];
  globalThis.window = { dispatchEvent(event) { events.push(event); } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  return events;
}

for (const status of [401, 403]) test(`business browser denial ${status} has a bound at its first body consumer`, async t => {
  browser(t); let produced = 0, cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    pull(stream) { if (produced === 512*1024) return stream.close(); produced += 16*1024; stream.enqueue(new Uint8Array(16*1024).fill(32)); },
    cancel() { cancelled = true; },
  }), { status, headers: { "content-type": "application/json" } }));
  await assert.rejects(new BusinessKnowledgeClient("https://synthetic.test", "workspace").get("run"), { status });
  assert.ok(produced <= 128*1024, `unbounded denial consumed ${produced} bytes`);
  assert.equal(cancelled, true);
});

test("business bounded refusal still notifies each real session-loss code once", async t => {
  const events = browser(t);
  for (const code of ["AUTH_REQUIRED", "AUTH_SESSION_EXPIRED", "AUTH_SESSION_REVOKED", "AUTH_ACCOUNT_DISABLED"]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code, message: "session refused" } }, { status:401 }));
    await assert.rejects(new BusinessKnowledgeClient("https://synthetic.test", "workspace").get("run"), { status:401, code });
    assert.equal(events.at(-1).type, "traqen:session-lost"); assert.equal(events.at(-1).detail.code, code);
  }
  assert.equal(events.length, 4);
});

test("malformed 401 remains a refusal without inventing a session-loss cause", async t => {
  const events = browser(t);
  t.mock.method(globalThis, "fetch", async () => new Response("{broken", { status:401, headers:{ "content-type":"application/json" } }));
  await assert.rejects(new BusinessKnowledgeClient("https://synthetic.test", "workspace").get("run"), { status:401 });
  assert.equal(events.length, 0);
});

for (const kind of ["cancel", "timeout"]) test(`received 401 stays a refusal when its body ${kind}s`, { timeout:1500 }, async t => {
  browser(t); let cancelled = false;
  const controller = new AbortController(), nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
  if (kind === "timeout") t.mock.method(AbortSignal, "timeout", ms => { assert.equal(ms, 30000); return nativeTimeout(20); });
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status:401 }));
  const pending = new BusinessKnowledgeClient("https://synthetic.test", "workspace", controller.signal).get("run");
  if (kind === "cancel") setTimeout(() => controller.abort(), 20);
  let timer;
  try { await assert.rejects(Promise.race([pending, new Promise((_,reject) => { timer=setTimeout(()=>reject(Error("received refusal body never released")),800); })]), { status:401 }); }
  finally { clearTimeout(timer); }
  assert.equal(cancelled, true);
});

test("seven questions binds the returned object as well as graph identity", async t => {
  const client = new BusinessKnowledgeClient("https://synthetic.test", "workspace");
  const expected = { graphDigest:"a".repeat(64), sourceBundleId:"b".repeat(64), profileId:"p" };
  for (const key of ["other", undefined]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ schemaVersion:1, workspaceId:"workspace", answer:{ investigationId:"run", ...expected, key } }));
    await assert.rejects(client.sevenQuestions("run", "selected", expected), { code:"F003_RESPONSE_INVALID" });
  }
});
