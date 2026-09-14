import assert from "node:assert/strict";
import test from "node:test";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";

async function fixture(t, input = {}, options = {}) {
  const f = await candidateFixture(t, input);
  const candidate = await f.candidates.prepare(f.context);
  await f.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(f.repository, f.candidates, options);
  return { ...f, candidate, publication };
}
const nonBlockingGap = { ruleCode: "GIT_LFS_EXTERNAL", severity: "NON_BLOCKING", ruleVersion: "v1", affectedScope: "external-content", externalReference: { kind: "GIT_LFS", oid: "a".repeat(64), sizeBytes: "100" } };

test("B-11 explicit confirmation and atomic publication have one result across client tokens", async (t) => {
  const f = await fixture(t);
  const confirmation = await f.publication.confirm(owner, f.context, { candidateId: f.candidate.id, gapSetId: f.candidate.gapSetId });
  assert.match(confirmation?.id ?? "", /^[a-f0-9-]{36}$/);
  assert.deepEqual(await f.repository.listBundles(reader, "workspace"), []);
  const one = await f.publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "click-1" });
  assert.equal(one.receipt.status, "READY");
  assert.equal(one.bundle.id, f.candidate.id);
  const two = await f.publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "click-2" });
  assert.equal(two.receipt.id, one.receipt.id);
  assert.equal((await f.repository.listBundles(owner, "workspace")).length, 1);
  assert.equal((await f.repository.getRun(owner, "workspace", f.context.runId)).status, "SUCCEEDED");
  await assert.rejects(f.publication.seal(owner, f.context, { confirmationId: "different", clientToken: "click-1" }), { code: "SOURCE_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(f.publication.seal(owner, f.context, { confirmationId: "different", clientToken: "click-2" }), { code: "SOURCE_IDEMPOTENCY_CONFLICT" });
});

test("B-11 concurrent finalization returns one Receipt to both callers", async (t) => {
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const f = await fixture(t, {}, { beforeCommit: async () => { if (++arrivals === 2) release(); await barrier; } });
  const confirmation = await f.publication.confirm(owner, f.context, { candidateId: f.candidate.id, gapSetId: f.candidate.gapSetId });
  const results = await Promise.all(["left", "right"].map((clientToken) => f.publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken })));
  assert.equal(results[0].receipt.id, results[1].receipt.id);
  assert.equal((await f.repository.listBundles(reader, "workspace")).length, 1);
});

test("B-11 a duplicate whose verification loses its lease to the committed result still returns that exact operation", async (t) => {
  const f = await fixture(t);
  const confirmation = await f.publication.confirm(owner, f.context, { candidateId: f.candidate.id, gapSetId: f.candidate.gapSetId });
  let enter, release, arrivals = 0;
  const entered = new Promise((resolve) => { enter = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const verify = f.candidates.verifyPrepared.bind(f.candidates);
  t.mock.method(f.candidates, "verifyPrepared", async (...args) => { if (++arrivals === 1) { enter(); await blocked; } return verify(...args); });
  const first = f.publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "slower" });
  await entered;
  const second = await f.publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "faster" });
  release();
  assert.equal((await first).receipt.id, second.receipt.id);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_receipt")).rows[0].n, 1);
});

test("B-10 accepted gap stays visible in the receipt and expires by server time before seal", async (t) => {
  const f = await fixture(t, { git: true, gaps: [nonBlockingGap] });
  const serverTime = (await f.db.query("SELECT clock_timestamp() AS now")).rows[0].now;
  const confirmation = await f.publication.confirm(owner, f.context, { candidateId: f.candidate.id, gapSetId: f.candidate.gapSetId,
    reason: "外部内容尚未提供，明确接受此版本的限制", expiresAt: new Date(new Date(serverTime).getTime() + 1000).toISOString() });
  assert.equal(confirmation?.gapCount, "1");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await assert.rejects(f.publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "expired" }), { code: "SOURCE_ACCEPTANCE_EXPIRED" });
  assert.deepEqual(await f.repository.listBundles(owner, "workspace"), []);
  const renewed = await f.publication.confirm(owner, f.context, { candidateId: f.candidate.id, gapSetId: f.candidate.gapSetId,
    reason: "重新核对已知限制", expiresAt: new Date(Date.now() + 60000).toISOString() });
  const result = await f.publication.seal(owner, f.context, { confirmationId: renewed.id, clientToken: "valid" });
  assert.equal(result.receipt.status, "READY_WITH_ACCEPTED_GAPS");
  assert.equal(result.receipt.gapCount, "1");
  assert.equal(result.receipt.gapSetId, f.candidate.gapSetId);
});

test("B-11 response loss after commit recovers the original Receipt, not a second publication", async (t) => {
  let loseResponse = true;
  const f = await fixture(t, {}, { afterCommit: () => { if (loseResponse) { loseResponse = false; throw new Error("injected response loss"); } } });
  const confirmation = await f.publication.confirm(owner, f.context, { candidateId: f.candidate.id, gapSetId: f.candidate.gapSetId });
  assert.ok(confirmation?.id);
  await assert.rejects(f.publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "first" }), /response loss/);
  const restored = await f.publication.result(reader, "workspace", f.context.runId);
  assert.equal(restored.receipt.status, "READY");
  const repeated = await f.publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "new" });
  assert.equal(restored.receipt.id, repeated.receipt.id);
});

test("B-05/11 revocation or cancellation during preparation prevents any public bundle", async (t) => {
  const f = await fixture(t, {}, { beforeCommit: () => f.repository.cancel(owner, "workspace", f.context.runId) });
  const confirmation = await f.publication.confirm(owner, f.context, { candidateId: f.candidate.id, gapSetId: f.candidate.gapSetId });
  assert.ok(confirmation?.id);
  await assert.rejects(f.publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "cancel-race" }), { code: "SOURCE_STALE_WORKER" });
  assert.deepEqual(await f.repository.listBundles(owner, "workspace"), []);
  assert.equal(await f.publication.result(reader, "workspace", f.context.runId), null);
});
