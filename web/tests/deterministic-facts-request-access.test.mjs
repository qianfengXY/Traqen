import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { DeterministicFactsClient } from "../app/deterministic-facts/client.ts";

const access = await import("../app/deterministic-facts/request-access.ts").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const receipt = { id: "request-1", operationId: "operation-1", investigationId: "investigation-1", baseVersionId: "a".repeat(64), revision: 2,
  status: "COMPLETED", outcome: "LIMITATION", result: {}, createdAt: "2026-10-14T00:00:00Z" };
const reply = (value = receipt, status = 200) => new Response(JSON.stringify(status === 200 ? { schemaVersion: 1, request: value }
  : { schemaVersion: 1, error: { code: "F002_CONSUMER_REJECTED", message: "current read denied" } }), { status, headers: { "content-type": "application/json" } });
function setup(t, respond = () => reply(), binding = receipt) {
  assert.equal(typeof access.observeRequestAccess, "function", "displayed requests need a disposable independent READ observation");
  t.mock.timers.enable({ apis: ["setInterval"] });
  const controller = new AbortController(), focus = new EventTarget(), calls = [], values = [], errors = [];
  t.mock.method(globalThis, "fetch", (url, options) => { calls.push({ url, options }); return respond(url, options); });
  const observer = access.observeRequestAccess(new DeterministicFactsClient("http://localhost:6225", "fixture-only", "w", controller.signal),
    binding, value => values.push(value), error => errors.push(error), focus);
  t.after(() => observer.close());
  return { controller, focus, calls, values, errors, observer };
}

test("request access re-reads only its exact GET on the five-second cadence and focus", async t => {
  const state = setup(t);
  await setImmediate();
  assert.equal(state.calls.length, 1);
  t.mock.timers.tick(5000); await setImmediate();
  state.focus.dispatchEvent(new Event("focus")); await setImmediate();
  assert.equal(state.calls.length, 3); assert.equal(state.values.length, 3); assert.deepEqual(state.errors, []);
  for (const { url, options } of state.calls) {
    assert.equal(url, "http://localhost:6225/v1/workspaces/w/deterministic-facts/requests/request-1");
    assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.cache, "no-store");
  }
});

test("timer and focus do not overlap an in-flight request read", async t => {
  let resolve;
  const state = setup(t, () => new Promise(done => { resolve = done; }));
  t.mock.timers.tick(10000); state.focus.dispatchEvent(new Event("focus")); await setImmediate();
  assert.equal(state.calls.length, 1);
  resolve(reply()); await setImmediate();
  state.focus.dispatchEvent(new Event("focus")); assert.equal(state.calls.length, 2);
  resolve(reply()); await setImmediate();
});

test("selection disposal aborts the read and suppresses a late value", async t => {
  let resolve;
  const state = setup(t, () => new Promise(done => { resolve = done; }));
  state.observer.close(); state.observer.close();
  assert.equal(state.calls[0].options.signal.aborted, true);
  resolve(reply()); await setImmediate();
  t.mock.timers.tick(10000); state.focus.dispatchEvent(new Event("focus")); await setImmediate();
  assert.deepEqual(state.values, []); assert.deepEqual(state.errors, []); assert.equal(state.calls.length, 1);
});

test("member transport abort removes observation and ignores a late denial", async t => {
  let resolve;
  const state = setup(t, () => new Promise(done => { resolve = done; }));
  state.controller.abort(); resolve(reply(null, 403)); await setImmediate();
  t.mock.timers.tick(10000); state.focus.dispatchEvent(new Event("focus")); await setImmediate();
  assert.deepEqual(state.values, []); assert.deepEqual(state.errors, []); assert.equal(state.calls.length, 1);
});

test("401 and independent 403 report access loss once and stop future GETs", async t => {
  for (const status of [401, 403]) await t.test(String(status), async t => {
    const state = setup(t, () => reply(null, status));
    await setImmediate();
    assert.equal(state.errors.length, 1); assert.equal(state.errors[0].status, status); assert.deepEqual(state.values, []);
    t.mock.timers.tick(10000); state.focus.dispatchEvent(new Event("focus")); await setImmediate();
    assert.equal(state.calls.length, 1);
  });
});

test("temporary unavailability is not a new result or permission and the next read remains the same request", async t => {
  let unavailable = true;
  const state = setup(t, () => unavailable ? reply(null, 503) : reply());
  await setImmediate(); assert.equal(state.errors[0].status, 503); assert.deepEqual(state.values, []);
  unavailable = false; t.mock.timers.tick(5000); await setImmediate();
  assert.equal(state.values.length, 1); assert.equal(state.calls.length, 2);
});

test("a different request investigation or baseline cannot replace the selected receipt", async t => {
  for (const patch of [{ id: "other-request" }, { investigationId: "other-investigation" }, { baseVersionId: "b".repeat(64) }]) await t.test(JSON.stringify(patch), async t => {
    const state = setup(t, () => reply({ ...receipt, ...patch }));
    await setImmediate(); assert.deepEqual(state.values, []); assert.equal(state.errors.length, 1);
    assert.equal(state.errors[0].code, "F002_REQUEST_REFERENCE_MISMATCH");
  });
});

test("older revisions cannot roll the displayed request backwards", async t => {
  let revision = 3;
  const state = setup(t, () => reply({ ...receipt, revision }));
  await setImmediate(); revision = 2; t.mock.timers.tick(5000); await setImmediate();
  assert.deepEqual(state.values.map(value => value.revision), [3]);
  assert.equal(state.errors[0].code, "F002_REQUEST_REFERENCE_MISMATCH");
});
