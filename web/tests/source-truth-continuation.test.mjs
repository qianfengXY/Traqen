import assert from "node:assert/strict";
import test from "node:test";
import { productHref } from "../app/product-navigation.ts";
import { SourceTruthClient } from "../app/source-truth/client.ts";
import { sourceContextError, sourceEntryFromSearch, safeSourceReturn, confirmedSourceAssociation } from "../app/source-truth/context.ts";
import * as sourceContext from "../app/source-truth/context.ts";

const bundleId = "a".repeat(64), componentId = "b".repeat(64);

test("shareable source route carries exact identities but not a material path, credential or return URL", () => {
  const context = { mode: "REFERENCE", workspaceId: "w", bundleId, receiptId: "old & receipt", componentId,
    pathBytes: "c2VjcmV0LnR4dA", token: "never-in-url", returnHref: "https://evil.test" };
  const url = new URL(productHref("workspace", "w", context), "https://traqen.test");
  assert.equal(url.searchParams.get("sourceBundle"), bundleId);
  assert.equal(url.searchParams.get("sourceReceipt"), "old & receipt");
  assert.equal(url.searchParams.get("sourceComponent"), componentId);
  assert.doesNotMatch(url.href, /never-in-url|secret|c2VjcmV0|evil/);
});

test("material preview is bounded, plain text, and uses current source authentication", async (t) => {
  const client = new SourceTruthClient("https://api.test", "current-token", "w");
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.match(url, /file-history/);
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.redirect, "error");
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("<script>never execute</script>")); }, cancel() { cancelled = true; } }),
      { headers: { "content-type": "application/octet-stream" } });
  });
  const result = await client.preview("/bundles/a/file-history", 8);
  assert.equal(result.text, "<script>");
  assert.equal(result.truncated, true);
  assert.equal(cancelled, true);
});

test("preview refuses binary/HTML responses and never caches a denied original", async (t) => {
  const client = new SourceTruthClient("https://api.test", "t", "w");
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([0xff, 0x00]), { headers: { "content-type": "application/octet-stream" } }));
  assert.equal((await client.preview("/file", 16)).text, null);
  t.mock.method(globalThis, "fetch", async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }));
  await assert.rejects(client.preview("/file", 16), /原始来源/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "SOURCE_FORBIDDEN", message: "Denied" } }, { status: 403 }));
  await assert.rejects(client.preview("/file", 16), { code: "SOURCE_FORBIDDEN" });
});

test("fixed identities reject ambiguous URL values, cross-Workspace and unauthorized return coordinates", () => {
  const parsed = sourceEntryFromSearch(`?workspace=w&sourceBundle=${bundleId}&sourceReceipt=old&sourceReceipt=new`);
  assert.ok(sourceContextError(parsed, "w"), "duplicate identities cannot choose the first value as authority");
  assert.ok(sourceContextError({ mode: "REFERENCE", workspaceId: "other", bundleId, receiptId: "r" }, "w"));
  assert.equal(safeSourceReturn({ workspaceId: "w", returnHref: "/?page=graph&workspace=other" }), null);
  assert.equal(safeSourceReturn({ workspaceId: "w", returnHref: "/?page=graph&workspace=w&token=secret" }), null);
  assert.equal(safeSourceReturn({ workspaceId: "w", returnHref: "https://evil.test/?page=graph&workspace=w" }), null);
  assert.equal(confirmedSourceAssociation({ status: "CONFIRMED", reference: { workspaceId: "w", bundleId, receiptId: "latest" } }, { workspaceId: "w", bundleId, receiptId: "old" }), false);
});

test("associating an exact reference revalidates the original work and current admission; querying never writes", async () => {
  const reference = { workspaceId: "w", bundleId, receiptId: "r" }, calls = [];
  const context = { mode: "ADD_MATERIAL", workspaceId: "w", workSessionId: "session", returnHref: "/?page=graph&workspace=w&session=session" };
  const client = { request: async (route, method, binding) => { calls.push([route, method]); assert.deepEqual(binding, { bundleId, receiptId: "r" }); } };
  const service = { validate: async () => { calls.push("validate"); return { valid: true }; }, associate: async () => { calls.push("associate"); return { status: "CONFIRMED", reference }; }, query: async () => { calls.push("query"); return { status: "NOT_SAVED" }; } };
  assert.equal((await sourceContext.performSourceAssociation(service, client, context, reference, false, new AbortController().signal)).status, "CONFIRMED");
  assert.deepEqual(calls, ["validate", ["/admission", "POST"], "associate"]);
  calls.length = 0;
  await sourceContext.performSourceAssociation(service, client, context, reference, true, new AbortController().signal);
  assert.deepEqual(calls, ["validate", "query"]);
  service.validate = async () => ({ valid: false, reason: "原工作已删除" });
  calls.length = 0;
  assert.equal((await sourceContext.performSourceAssociation(service, client, context, reference, false, new AbortController().signal)).status, "INVALID");
  assert.deepEqual(calls, []);
});
