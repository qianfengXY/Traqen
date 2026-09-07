import assert from "node:assert/strict";
import test from "node:test";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner } from "./support/source-truth-database.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { SourceRenewalService } from "../src/source-truth/renewal-service.js";
import { SourceTruthWorker } from "../src/source-truth/worker.js";
import { sourceTruthServices } from "../src/source-truth/services.js";
import { capturePolicy } from "../src/source-truth/policy.js";
import { SourceTruthError } from "../src/source-truth/errors.js";

async function fixture(t) {
  const cleanups = [];
  const f = await candidateFixture({ after: (fn) => cleanups.push(fn) }, { git: true,
    gaps: [{ ruleCode: "GIT_LFS_EXTERNAL", severity: "NON_BLOCKING", ruleVersion: "v1", affectedScope: "external-content", externalReference: null }] });
  const candidate = await f.candidates.prepare(f.context);
  await f.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(f.repository, f.candidates);
  const confirm = await publication.confirm(owner, f.context, { candidateId: candidate.id, gapSetId: candidate.gapSetId,
    reason: "保留原始限制", expiresAt: new Date(Date.now() + 60000).toISOString() });
  const frozen = await publication.seal(owner, f.context, { confirmationId: confirm.id, clientToken: "original" });
  const services = sourceTruthServices({ repository: f.repository, blobs: f.blobs, policy: { ...capturePolicy(), id: "policy-v1" } });
  const worker = new SourceTruthWorker(services);
  t.after(async () => { await worker.stop(); for (const fn of cleanups) await fn(); });
  const ref = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
  const acceptance = await services.renewal.confirm(owner, "workspace", { ...ref, gapSetId: candidate.gapSetId,
    reason: "明确重新接受", expiresAt: new Date(Date.now() + 60000).toISOString() });
  return { ...f, services, worker, ref, acceptance, input: { ...ref, confirmationId: acceptance.id, clientToken: "renewal-original-request" } };
}

test("B-10/11 worker recovers an explicitly requested renewal without new acceptance, Bundle or responsible member", async (t) => {
  const f = await fixture(t);
  await f.worker.tick();
  assert.equal((await f.services.renewal.latest(owner, "workspace", f.ref)).operation, null, "accepting alone is not issuing");
  const interrupted = new SourceRenewalService(f.repository, f.candidates, { beforeCommit() { throw new SourceTruthError("SOURCE_STORAGE_UNAVAILABLE", "fixture interruption", { status: 503 }); } });
  await assert.rejects(interrupted.issue(owner, "workspace", f.input), { code: "SOURCE_STORAGE_UNAVAILABLE" });
  const before = await f.services.renewal.latest(owner, "workspace", f.ref);
  assert.equal(before.operation.status, "PREPARING");
  await f.worker.tick();
  assert.equal((await f.services.renewal.latest(owner, "workspace", f.ref)).operation.status, "PREPARING", "retry backoff prevents a hot verification loop");
  await f.db.query("UPDATE source_truth_publication_operation SET retry_after=clock_timestamp()-interval '1 second' WHERE id=$1", [before.operation.id]);
  await f.worker.tick();
  const recovered = await f.services.renewal.latest(owner, "workspace", f.ref);
  assert.equal(recovered.operation.status, "COMMITTED");
  assert.equal(recovered.operation.id, before.operation.id);
  assert.equal(recovered.result.receipt.acceptedBy, owner.actorId);
  assert.equal(recovered.result.receipt.expiresAt, f.acceptance.expiresAt);
  assert.equal(recovered.result.bundle.id, f.ref.bundleId);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_bundle")).rows[0].n, 1);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_confirmation")).rows[0].n, 2);
  assert.equal((await f.services.renewal.issue(owner, "workspace", f.input)).receipt.id, recovered.result.receipt.id);
});

test("B-11 expired renewal execution cannot publish; the next executor retains the same operation", async (t) => {
  const f = await fixture(t);
  const interrupted = new SourceRenewalService(f.repository, f.candidates, { async beforeCommit() {
    await f.db.query("UPDATE source_truth_publication_operation SET execution_until=clock_timestamp()-interval '1 second' WHERE confirmation_id=$1", [f.acceptance.id]);
  } });
  await assert.rejects(interrupted.issue(owner, "workspace", f.input), { code: "SOURCE_STALE_WORKER" });
  const before = await f.services.renewal.latest(owner, "workspace", f.ref);
  assert.equal(before.result, null);
  await f.worker.tick();
  const after = await f.services.renewal.latest(owner, "workspace", f.ref);
  assert.equal(after.operation.id, before.operation.id);
  assert.equal(after.operation.status, "COMMITTED");
});

test("B-05 renewal recovery stops on revoked authority and does not use another member to sign", async (t) => {
  const f = await fixture(t);
  const interrupted = new SourceRenewalService(f.repository, f.candidates, { beforeCommit() { throw new Error("lost process"); } });
  await assert.rejects(interrupted.issue(owner, "workspace", f.input), /lost process/);
  await f.db.query("UPDATE source_truth_publication_operation SET retry_after=NULL WHERE confirmation_id=$1", [f.acceptance.id]);
  await f.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "REVOKED" }] });
  await f.worker.tick();
  const pending = (await f.db.query("SELECT * FROM source_truth_publication_operation WHERE confirmation_id=$1", [f.acceptance.id])).rows[0];
  assert.equal(pending.status, "PREPARING");
  assert.equal(pending.recovery_blocked, true);
  assert.equal(pending.last_diagnostic.code, "SOURCE_FORBIDDEN");
  assert.equal(pending.actor_id, owner.actorId);
  const audit = (await f.db.query("SELECT count(*)::int AS n FROM source_truth_event")).rows[0].n;
  await f.worker.tick();
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_event")).rows[0].n, audit);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_receipt")).rows[0].n, 1);
});

test("B-10 renewal expiry stops the original operation without extending acceptance or creating a Receipt", async (t) => {
  const f = await fixture(t);
  const accept = await f.services.renewal.confirm(owner, "workspace", { ...f.ref, gapSetId: f.acceptance.gapSetId,
    reason: "测试明确短期限", expiresAt: new Date(Date.now() + 400).toISOString() });
  const expiring = new SourceRenewalService(f.repository, f.candidates, { beforeCommit: () => new Promise((resolve) => setTimeout(resolve, 500)) });
  await assert.rejects(expiring.issue(owner, "workspace", { ...f.input, confirmationId: accept.id, clientToken: "expiring" }), { code: "SOURCE_ACCEPTANCE_EXPIRED" });
  await f.worker.tick();
  const state = await f.services.renewal.latest(owner, "workspace", f.ref);
  assert.equal(state.confirmation.expiresAt, accept.expiresAt);
  assert.equal(state.operation.requiresAction, true);
  assert.equal(state.operation.diagnostic.code, "SOURCE_ACCEPTANCE_EXPIRED");
  assert.equal(state.result, null);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_receipt")).rows[0].n, 1);
});
