import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as copyChecks from "../../test/support/f002-reference-copy-checks.mjs";

test("reference-copy browser verification is opt-in and follows real connection and owned runtime checks", () => {
  const entry = readFileSync(new URL("../../test/support/f002-interface-browser.mjs", import.meta.url), "utf8");
  assert.ok(entry.includes('"--reference-copy"'), "the dedicated copy boundary lane must be an explicit supported mode");
  assert.match(entry, /import \{ verifyReferenceCopy \} from "\.\/f002-reference-copy-checks\.mjs"/);
  assert.match(entry, /OWNED_SYNTHETIC_F001_F002_REFERENCE_COPY_BROWSER/);
  const preflight = entry.indexOf("report.runtimePreflight =");
  const connected = entry.indexOf("await page.goto(`${web}${evidence(meta)}`); await connect();");
  const invoked = entry.indexOf("await verifyReferenceCopy(");
  assert.ok(preflight >= 0 && connected > preflight && invoked > connected,
    "actual copy checks must execute only after the owned listener and real authenticated reader");
  const guardedModes = entry.slice(entry.indexOf('if (!mode || mode === "--native-accessibility"'), preflight);
  assert.ok(guardedModes.includes('mode === "--reference-copy"'), "copy evidence requires the same live runtime ownership proof");
});

test("copy fetch observation preserves the native Promise, receiver and arguments while recording the actual signal", async () => {
  assert.equal(typeof copyChecks.installReferenceFetchObserver, "function");
  const controller = new AbortController(), response = { status: 200 };
  let complete;
  const original = new Promise(resolve => { complete = resolve; });
  const input = "http://127.0.0.1:6225/fixed-record", options = { signal: controller.signal };
  const invocations = [], state = { fetches: [], markNext: { pathname: "/fixed-record", name: "held-copy" } };
  const target = { location: { href: "http://127.0.0.1:6226/" }, __f002ReferenceCopy: state,
    fetch(...args) { invocations.push({ receiver: this, args }); return original; } };
  copyChecks.installReferenceFetchObserver(target);
  const observed = target.fetch(input, options);
  assert.equal(observed, original, "the observer must not replace or await the native Promise");
  assert.equal(invocations[0].receiver, target); assert.equal(invocations[0].args[0], input); assert.equal(invocations[0].args[1], options);
  assert.equal(state.markNext, null); assert.equal(state.fetches.length, 1);
  assert.equal(state.fetches[0].signalInitiallyAborted, false);
  controller.abort(); complete(response);
  assert.equal(await observed, response);
  assert.deepEqual(state.fetches[0].abort, { aborted: true, name: "AbortError", message: controller.signal.reason.message });
  assert.deepEqual(state.fetches[0].settlement, { outcome: "fulfilled", status: 200, signalAborted: true });
});

test("copy fetch observation does not consume another route or replace original rejection and synchronous errors", async () => {
  assert.equal(typeof copyChecks.installReferenceFetchObserver, "function");
  const error = new DOMException("Original native abort", "AbortError"), controller = new AbortController();
  const original = Promise.reject(error), state = { fetches: [], markNext: { pathname: "/fixed-record", name: "held-copy" } };
  const target = { location: { href: "http://127.0.0.1:6226/" }, __f002ReferenceCopy: state, fetch() { return original; } };
  copyChecks.installReferenceFetchObserver(target);
  assert.equal(target.fetch("/other"), original); assert.equal(state.fetches.length, 0); assert.ok(state.markNext);
  assert.equal(target.fetch("/fixed-record", { signal: controller.signal }), original);
  await assert.rejects(original, actual => actual === error);
  assert.deepEqual(state.fetches[0].settlement, { outcome: "rejected", name: "AbortError", message: error.message, signalAborted: false });
  const thrown = new Error("Original synchronous failure");
  const throws = { location: target.location, __f002ReferenceCopy: { fetches: [], markNext: null }, fetch() { throw thrown; } };
  copyChecks.installReferenceFetchObserver(throws);
  assert.throws(() => throws.fetch("/fixed-record"), actual => actual === thrown);
});
