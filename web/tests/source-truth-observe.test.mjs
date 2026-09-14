import assert from "node:assert/strict";
import test from "node:test";
import { observeSourceReads } from "../app/source-truth/observe.ts";

test("source progress polling is independent of commands, bounded to one read and stops on abort", async (t) => {
  let tick, reads = 0, release, cleared = 0;
  t.mock.method(globalThis, "setInterval", (callback) => { tick = callback; return 17; });
  t.mock.method(globalThis, "clearInterval", (timer) => { assert.equal(timer, 17); cleared++; });
  const controller = new AbortController();
  const errors = [];
  const stop = observeSourceReads(async () => { reads++; await new Promise((resolve) => { release = resolve; }); }, { signal: controller.signal, onError: (error) => errors.push(error) });
  assert.equal(reads, 1);
  tick(); tick(); assert.equal(reads, 1, "a stalled observer never stacks reads");
  release(); await new Promise(setImmediate);
  tick(); assert.equal(reads, 2, "the next read needs no completed write/command");
  controller.abort(); tick(); assert.equal(reads, 2);
  release(); await new Promise(setImmediate);
  tick(); assert.equal(reads, 2);
  stop(); assert.ok(cleared >= 1); assert.deepEqual(errors, []);
});

test("observer errors remain visible, retry only a read, and cannot escape a stopped session", async (t) => {
  let tick, reads = 0, reject;
  t.mock.method(globalThis, "setInterval", (callback) => { tick = callback; return 7; });
  t.mock.method(globalThis, "clearInterval", () => {});
  const errors = [];
  const stop = observeSourceReads(async () => { reads++; await new Promise((_, fail) => { reject = fail; }); }, { onError: (error) => errors.push(error.message) });
  reject(new Error("offline")); await new Promise(setImmediate);
  assert.deepEqual(errors, ["offline"]);
  tick(); assert.equal(reads, 2);
  stop(); reject(new Error("stale")); await new Promise(setImmediate);
  assert.deepEqual(errors, ["offline"]); tick(); assert.equal(reads, 2);
});
