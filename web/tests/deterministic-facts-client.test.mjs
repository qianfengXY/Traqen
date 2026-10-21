import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DeterministicFactsClient } from "../app/deterministic-facts/client.ts";
import { EvidenceTransport } from "../app/deterministic-facts/transport.ts";

const version = "a".repeat(64), material = "b".repeat(64);

test("F002 export only offers a complete version-bound response and rejects stream failure or member abort", async t => {
  const headers = { "content-type": "application/json", "x-f002-export-version": version };
  const client = new DeterministicFactsClient("https://api", "ignored", "w");
  t.mock.method(globalThis, "fetch", async () => new Response("complete", { headers }));
  assert.equal(await (await client.exportVersion(version)).text(), "complete");
  t.mock.method(globalThis, "fetch", async () => new Response("wrong", { headers: { ...headers, "x-f002-export-version": material } }));
  await assert.rejects(client.exportVersion(version), { code: "F002_EXPORT_INCOMPLETE" });
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("stream interrupted")); } }), { headers }));
  await assert.rejects(client.exportVersion(version), /stream interrupted/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(client.withSignal(aborted.signal).exportVersion(version), { name: "AbortError" });
});

test("F002 client binds Workspace/member identity and does not automatically retry mutations", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); throw new TypeError("lost connection"); });
  const client = new DeterministicFactsClient("https://api.example.test/", "memory-member-token", "workspace/one");
  await assert.rejects(client.request("/runs", "POST", { operationId: "same-id" }), { code: "F002_NETWORK_UNCONFIRMED" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /workspaces\/workspace%2Fone\/deterministic-facts\/runs$/);
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(new Headers(calls[0].options.headers).has("authorization"), false, "the prior member credential cannot override the current login");
  assert.deepEqual(JSON.parse(calls[0].options.body), { operationId: "same-id" });
});

test("F002 client keeps an HTML or malformed success response unconfirmed", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }));
  await assert.rejects(new DeterministicFactsClient("https://api", "token", "w").request("/runs", "POST", {}), { code: "F002_NETWORK_UNCONFIRMED" });
});

test("F002 material reader verifies actual display bytes and carries refusal metadata", async (t) => {
  const text = "[展示受限]", digest = createHash("sha256").update(text).digest("hex");
  t.mock.method(globalThis, "fetch", async () => new Response(text, { headers: {
    "content-type": "text/plain; charset=utf-8", "x-f002-original-digest": "c".repeat(64), "x-f002-display-digest": digest,
    "x-f002-readable-ref": "d".repeat(64), "x-f002-redacted": "true", "x-f002-transform": "CONFIG_SECRET_PRESENTATION_REFUSAL",
  } }));
  const result = await new DeterministicFactsClient("https://api", "token", "w").material(version, material);
  assert.equal(new TextDecoder().decode(result.bytes), text);
  assert.equal(result.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
  assert.equal(result.displayDigest, digest);
  t.mock.method(globalThis, "fetch", async () => new Response("altered", { headers: {
    "content-type": "text/plain", "x-f002-original-digest": "c".repeat(64), "x-f002-display-digest": digest,
    "x-f002-readable-ref": "d".repeat(64), "x-f002-redacted": "false",
  } }));
  await assert.rejects(new DeterministicFactsClient("https://api", "token", "w").material(version, material), { code: "F002_DISPLAY_DIGEST_MISMATCH" });
});

test("F002 material reader cannot release a response after its access session has been aborted", async (t) => {
  const controller = new AbortController();
  const digest = createHash("sha256").update("late bytes").digest("hex");
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return new Response("late bytes", { headers: { "content-type": "text/plain", "x-f002-original-digest": digest,
      "x-f002-display-digest": digest, "x-f002-readable-ref": "d".repeat(64), "x-f002-redacted": "false" } });
  });
  await assert.rejects(new DeterministicFactsClient("https://api", "token", "w", controller.signal).material(version, material), { name: "AbortError" });
});

test("F002 transport resubscription creates a fresh signal and a refusal cannot reopen the old session", () => {
  const transport = new EvidenceTransport("https://api", "memory-token", "w");
  assert.equal(transport.getServerSnapshot(), null);
  const stopFirst = transport.subscribe(() => {});
  const first = transport.getSnapshot();
  stopFirst();
  assert.equal(first.facts.signal.aborted, true);
  const stopSecond = transport.subscribe(() => {});
  const second = transport.getSnapshot();
  assert.notEqual(first, second);
  assert.equal(second.facts.signal.aborted, false);
  transport.close();
  assert.equal(second.facts.signal.aborted, true);
  assert.equal(transport.getSnapshot(), null);
  stopSecond();
  const stopThird = transport.subscribe(() => {});
  assert.equal(transport.getSnapshot(), null, "reconnecting a refused identity requires a new verified session, not a resubscribe");
  stopThird();
});
