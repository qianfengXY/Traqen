import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { DeterministicFactsClient } from "../app/deterministic-facts/client.ts";

const catalogModule = await import("../app/deterministic-facts/request-catalog.ts").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const binding = { workspaceId: "workspace", investigationId: "investigation-1", baseVersionId: "a".repeat(64), cursor: null };
const budget = { maxMaterials: 3, maxBytes: 4096, maxRuleApplications: 12, maximumAttempts: 2, deadline: "2099-01-01T00:00:00Z" };
const context = { ...binding, workspaceId: "workspace", state: "RUNNING", budget, usage: { materials: 1, bytes: 100, ruleApplications: 1, attempts: 1 }, allowedCapabilities: ["properties"] };
const item = { id: "request-1", operationId: "op-1", ...binding, questionSummary: "Where is the evidence?", scope: { factRefs: [], materialRefs: ["b".repeat(64)] },
  revision: 2, status: "COMPLETED", outcome: "LIMITATION", result: {}, createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:01:00Z" };
const json = (body, status = 200) => new Response(JSON.stringify({ schemaVersion: 1, workspaceId: "workspace", ...body }), { status, headers: { "content-type": "application/json" } });
const failure = status => json({ error: { code: "F002_CONSUMER_REJECTED", message: "current permission denied" } }, status);

test("catalog browser mode seeds only owned persistent requests and invokes actual connected read checks", async () => {
  const runner = await readFile(new URL("../../test/support/f002-interface-browser.mjs", import.meta.url), "utf8");
  const checks = await readFile(new URL("../../test/support/f002-request-catalog-checks.mjs", import.meta.url), "utf8").catch(() => "");
  assert.ok(runner.includes('"--request-catalog"'));
  assert.ok(runner.includes('requestCatalog: mode === "--request-catalog"'));
  assert.ok(runner.includes("await verifyRequestCatalog("));
  assert.ok(checks.includes("assert.deepEqual(mutations, [])"));
  assert.ok(checks.includes('"revoke-catalog-row"'));
});

function setup(t, respond = url => url.includes("/investigations/") ? json({ investigation: context }) : json({ items: [item], nextCursor: null })) {
  assert.equal(typeof catalogModule.observeRequestCatalog, "function", "real request catalog needs an independently disposable current authorization observation");
  t.mock.timers.enable({ apis: ["setInterval"] });
  const controller = new AbortController(), focus = new EventTarget(), calls = [], values = [], errors = [];
  t.mock.method(globalThis, "fetch", (url, options) => { calls.push({ url, options }); return respond(url, options); });
  const observer = catalogModule.observeRequestCatalog(new DeterministicFactsClient("http://localhost:6225", "owned-fixture", "workspace", controller.signal), binding,
    value => values.push(value), error => errors.push(error), focus);
  t.after(() => observer.close());
  return { controller, focus, calls, values, errors, observer };
}

test("catalog uses only current bound GETs on cadence and focus, never requests an execution or a latest baseline", async t => {
  const s = setup(t); await setImmediate();
  assert.equal(s.values.length, 1); assert.deepEqual(s.values[0].investigation.budget, budget);
  t.mock.timers.tick(5000); await setImmediate(); s.focus.dispatchEvent(new Event("focus")); await setImmediate();
  assert.equal(s.calls.length, 6); assert.equal(s.values.length, 3); assert.deepEqual(s.errors, []);
  for (const { url, options } of s.calls) {
    assert.equal(new URL(url).searchParams.get("baseVersionId"), binding.baseVersionId);
    assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.cache, "no-store");
  }
});

test("catalog disposal aborts both reads and refuses a late old investigation value", async t => {
  const pending = [];
  const s = setup(t, url => new Promise(resolve => pending.push(() => resolve(url.includes("/investigations/") ? json({ investigation: context }) : json({ items: [item], nextCursor: null })))));
  t.mock.timers.tick(10000); s.focus.dispatchEvent(new Event("focus")); assert.equal(s.calls.length, 2);
  s.observer.close(); assert.ok(s.calls.every(call => call.options.signal.aborted));
  pending.forEach(resolve => resolve()); await setImmediate();
  assert.deepEqual(s.values, []); assert.deepEqual(s.errors, []);
});

test("stopped or unauthorized new-request budget does not hide individually readable historical results or invent limits", async t => {
  const s = setup(t, url => url.includes("/investigations/") ? failure(403) : json({ items: [item], nextCursor: null }));
  await setImmediate();
  assert.equal(s.values[0].investigation, null); assert.equal(s.values[0].investigationError.status, 403);
  assert.deepEqual(s.values[0].page.items, [item]); assert.deepEqual(s.errors, []);
});

test("catalog rejects mismatched baselines duplicate rows foreign cursors and malformed scope instead of replacing current metadata", async t => {
  for (const page of [{ items: [{ ...item, baseVersionId: "c".repeat(64) }], nextCursor: null }, { items: [item, item], nextCursor: null },
    { items: [item], nextCursor: "undisclosed-request" }, { items: [{ ...item, scope: { factRefs: [], materialRefs: ["/user/path"] } }], nextCursor: null }]) await t.test(JSON.stringify(page), async t => {
    const s = setup(t, url => url.includes("/investigations/") ? json({ investigation: context }) : json(page));
    await setImmediate(); assert.deepEqual(s.values, []); assert.equal(s.errors[0].code, "F002_REQUEST_REFERENCE_MISMATCH");
  });
});

test("catalog revalidation replaces revoked rows and permission failure retires observation without a follow-up write", async t => {
  let state = 0;
  const s = setup(t, url => url.includes("/investigations/") ? json({ investigation: context }) : state === 2 ? failure(403) : json({ items: state ? [] : [item], nextCursor: null }));
  await setImmediate(); state = 1; t.mock.timers.tick(5000); await setImmediate();
  assert.deepEqual(s.values.map(value => value.page.items.length), [1, 0]);
  state = 2; t.mock.timers.tick(5000); await setImmediate(); assert.equal(s.errors[0].status, 403);
  t.mock.timers.tick(10000); await setImmediate(); assert.equal(s.calls.length, 6);
});

test("catalog credential abort suppresses a late error and malformed budget never becomes an authorized allowance", async t => {
  const bad = { ...context, budget: { ...budget, maximumAttempts: -1 } };
  const s = setup(t, url => url.includes("/investigations/") ? json({ investigation: bad }) : json({ items: [item], nextCursor: null }));
  await setImmediate(); assert.equal(s.values[0].investigation, null); assert.equal(s.values[0].investigationError.code, "F002_REQUEST_REFERENCE_MISMATCH");
  s.controller.abort(); t.mock.timers.tick(5000); await setImmediate(); assert.equal(s.calls.length, 2);
});
