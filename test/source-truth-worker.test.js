import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { owner, sourceDatabase } from "./support/source-truth-database.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { sourceTruthServices } from "../src/source-truth/services.js";
import { SourceTruthWorker } from "../src/source-truth/worker.js";
import { capturePolicy } from "../src/source-truth/policy.js";
import { manifestIdentity, pathBytes } from "../src/source-truth/identity.js";

async function fixture(t) {
  const cleanup = [];
  const { repository, db } = await sourceDatabase({ after: (action) => cleanup.push(action) });
  const blobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "traqen-source-worker-test-")), keyVersion: "fixture", keys: { fixture: Buffer.alloc(32, 22) } });
  const services = sourceTruthServices({ repository, blobs, policy: capturePolicy() });
  const worker = new SourceTruthWorker(services, { maxConcurrent: 2 });
  t.after(async () => { await worker.stop(); for (const action of cleanup) await action(); });
  await services.capture.save(owner, "workspace", { expectedRevision: 0, input: { sources: [{ sourceId: "docs", kind: "DIRECTORY_UPLOAD", mode: "UPDATE" }], baselineBundleId: null } });
  const run = await services.capture.start(owner, "workspace", { draftRevision: 1 });
  return { ...services, worker, run, db };
}

test("persistent worker resumes eligible runs, waits for the browser and never confirms or seals on its own", async (t) => {
  const f = await fixture(t);
  await f.worker.tick();
  assert.equal((await f.repository.getRun(owner, "workspace", f.run.id)).status, "WAITING_FOR_CLIENT");
  const bytes = Buffer.from("worker material");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const entry = { pathBytes: pathBytes("file"), kind: "FILE", sizeBytes: String(bytes.length), expectedContent: { algorithm: "sha256", digest }, gitMode: null };
  await f.blobs.putBlob({ tenantId: "tenant", workspaceId: "workspace" }, { digest, sizeBytes: entry.sizeBytes }, [bytes]);
  await f.capture.enumerateDirectory(owner, "workspace", f.run.id, "docs", { batchId: "0", entries: [entry] });
  await f.capture.closeDirectory(owner, "workspace", f.run.id, "docs", { fileCount: "1", directoryCount: "0", manifestId: manifestIdentity("DIRECTORY_UPLOAD", [entry]).id });
  await f.worker.tick();
  const reviewed = await f.repository.getRun(owner, "workspace", f.run.id);
  assert.equal(reviewed.status, "REVIEW_REQUIRED");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_confirmation")).rows[0].n, 0);
  const confirmation = await f.publication.confirm(owner, { workspaceId: "workspace", runId: f.run.id }, { candidateId: reviewed.progress.candidate.id, gapSetId: reviewed.progress.candidate.gapSetId });
  await f.worker.tick();
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_receipt")).rows[0].n, 0, "confirmation does not authorize the separate freeze action");
  const { context } = await f.capture.context(owner, "workspace", f.run.id);
  await f.publication.begin(owner, context, { confirmationId: confirmation.id, clientToken: "lost-before-commit" });
  await f.repository.releaseLease(context);
  await f.worker.tick();
  assert.equal((await f.repository.getRun(owner, "workspace", f.run.id)).status, "SUCCEEDED");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_confirmation")).rows[0].n, 1);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_receipt")).rows[0].n, 1);
});

test("persistent worker fences a live predecessor and reclaims the original run only after its lease expires", async (t) => {
  const f = await fixture(t);
  await f.repository.claimRun("workspace", f.run.id, { workerId: "predecessor", leaseMs: 60000 });
  await f.worker.tick();
  assert.equal((await f.repository.getRun(owner, "workspace", f.run.id)).generation, 1);
  await f.db.query("UPDATE source_truth_run SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [f.run.id]);
  await f.worker.tick();
  const resumed = await f.repository.getRun(owner, "workspace", f.run.id);
  assert.equal(resumed.generation, 2);
  assert.equal(resumed.status, "WAITING_FOR_CLIENT");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_run")).rows[0].n, 1);
});

test("concurrent advance requests share one in-flight execution instead of racing the same lease", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => f.capture.advance(owner, "workspace", f.run.id)));
  assert.ok(results.every((result) => result.status === "fulfilled" && result.value.status === "WAITING_FOR_CLIENT"), results.map((result) => result.status === "rejected" ? result.reason.code : result.value.status).join(","));
  assert.equal((await f.repository.getRun(owner, "workspace", f.run.id)).generation, 1);
});
