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
