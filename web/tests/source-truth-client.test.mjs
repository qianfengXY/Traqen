import assert from "node:assert/strict";
import test from "node:test";
import { SourceTruthClient } from "../app/source-truth/client.ts";

test("source client keeps principal claims out of requests, does not retry writes or follow redirects, and aborts stale work", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return Response.json({ error: { code: "SOURCE_REVISION_CONFLICT", message: "草稿已更新", requestId: "request-1" } }, { status: 409 }); });
  const controller = new AbortController();
  const client = new SourceTruthClient("https://api.example.test/", "memory-token", "workspace/one", controller.signal);
  await assert.rejects(client.request("/draft", "PUT", { expectedRevision: 1, input: {} }), { code: "SOURCE_REVISION_CONFLICT", requestId: "request-1" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /workspaces\/workspace%2Fone\/source-truth\/draft$/);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.headers.authorization, "Bearer memory-token");
  assert.deepEqual(JSON.parse(calls[0].options.body), { expectedRevision: 1, input: {} });
  controller.abort();
  await assert.rejects(client.request(), { name: "AbortError" });
  assert.equal(calls.length, 1);
});

test("source client never calls an HTML success page or a malformed JSON body a confirmed mutation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("not json", { headers: { "content-type": "application/json" } }));
  await assert.rejects(new SourceTruthClient("https://api", "token", "w").request("/runs", "POST", {}), { code: "SOURCE_NETWORK_UNCONFIRMED" });
});

test("historical raw files stream to an explicitly selected destination without loading a whole file or executing it", async (t) => {
  const chunks = [], events = [];
  const client = new SourceTruthClient("https://api", "token", "w");
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, "Bearer token");
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close(); } }), { headers: { "content-type": "application/octet-stream" } });
  });
  const sink = { async write(chunk) { chunks.push(...chunk); events.push("write"); }, async close() { events.push("close"); }, async abort() { events.push("abort"); } };
  await client.download("/bundles/a/file-history", sink);
  assert.deepEqual(chunks, [1, 2, 3]); assert.deepEqual(events, ["write", "write", "close"]);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "SOURCE_FORBIDDEN", message: "撤权" } }, { status: 403 }));
  await assert.rejects(client.download("/bundles/a/file-history", sink), { code: "SOURCE_FORBIDDEN" });
  assert.equal(events.at(-1), "abort");
});
