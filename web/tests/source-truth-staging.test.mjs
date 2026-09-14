import assert from "node:assert/strict";
import test from "node:test";
import { continueStagingRelease } from "../app/source-truth/staging.ts";

test("one explicit release action drains bounded batches without repeated confirmations", async () => {
  const pending = ["201", "101", "1", "0"], progress = [];
  let calls = 0;
  const result = await continueStagingRelease({ async request(route, method, body) {
    assert.equal(route, "/runs/original/staging-release"); assert.equal(method, "POST"); assert.equal(body.confirmRelease, true);
    calls++; return { remainingChunks: pending.shift() };
  } }, "original", () => true, (state) => progress.push(state.remainingChunks));
  assert.equal(result.remainingChunks, "0"); assert.equal(calls, 4); assert.deepEqual(progress, ["201", "101", "1", "0"]);
});

test("release stops after lost response or page departure; neither condition creates a new disposition", async () => {
  let calls = 0;
  await assert.rejects(continueStagingRelease({ async request() { calls++; throw new Error("lost response"); } }, "original", () => true, () => {}), /lost response/);
  assert.equal(calls, 1);
  let active = true;
  calls = 0;
  assert.equal(await continueStagingRelease({ async request() { calls++; active = false; return { remainingChunks: "100" }; } }, "original", () => active, () => assert.fail("stale view updated")), null);
  assert.equal(calls, 1);
});

test("non-progressing release response cannot cause an unbounded write loop", async () => {
  let calls = 0;
  await assert.rejects(continueStagingRelease({ async request() { calls++; return { remainingChunks: "100" }; } }, "original", () => true, () => {}), /未减少/);
  assert.equal(calls, 2);
});
