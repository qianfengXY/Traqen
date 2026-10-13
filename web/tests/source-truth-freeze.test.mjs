import assert from "node:assert/strict";
import test from "node:test";
import { freezeReviewedCandidate } from "../app/source-truth/freeze.ts";

const candidate = { id: "candidate", gapSetId: "gaps", gapCount: "2" };

test("one explicit review intent confirms the exact candidate then seals with that returned confirmation", async () => {
  const calls = [];
  const client = { request: async (...args) => { calls.push(args); return { id: "confirmation" }; } };
  await freezeReviewedCandidate(client, "run", candidate, "single-intent");
  assert.deepEqual(calls, [
    ["/runs/run/confirm", "POST", { candidateId: "candidate", gapSetId: "gaps", useGapAcceptances: true }],
    ["/runs/run/seal", "POST", { confirmationId: "confirmation", clientToken: "single-intent" }],
  ]);
});

test("a gap-free review still requires explicit confirmation before sealing", async () => {
  const calls = [];
  const client = { request: async (...args) => { calls.push(args); return { id: "no-gap-confirmation" }; } };
  await freezeReviewedCandidate(client, "run", { ...candidate, gapCount: "0" }, "no-gap-intent");
  assert.deepEqual(calls, [
    ["/runs/run/confirm", "POST", { candidateId: "candidate", gapSetId: "gaps" }],
    ["/runs/run/seal", "POST", { confirmationId: "no-gap-confirmation", clientToken: "no-gap-intent" }],
  ]);
});

test("denied or expired confirmation never starts finalization", async () => {
  const denied = Object.assign(new Error("expired"), { status: 409 }), calls = [];
  const client = { request: async (...args) => { calls.push(args); throw denied; } };
  await assert.rejects(freezeReviewedCandidate(client, "run", candidate, "intent"), denied);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/runs/run/confirm");
});

test("an unconfirmed seal result propagates once and never silently retries or creates another run", async () => {
  const unknown = new Error("result unconfirmed"), calls = [];
  const client = { request: async (...args) => { calls.push(args); if (args[0].endsWith("/seal")) throw unknown; return { id: "confirmation" }; } };
  await assert.rejects(freezeReviewedCandidate(client, "run", candidate, "intent"), unknown);
  assert.equal(calls.length, 2);
});
