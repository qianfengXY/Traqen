import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceDatabase, owner, reader } from "./support/source-truth-database.js";
import { sourceTruthServices } from "../src/source-truth/services.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { capturePolicy } from "../src/source-truth/policy.js";
import { manifestIdentity, pathBytes } from "../src/source-truth/identity.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const scope = { workspaceId: "workspace", tenantId: "tenant" };
async function fixture(t) {
  const { repository, db } = await sourceDatabase(t);
  const blobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "tq-f001-staging-")), keyVersion: "test", keys: { test: Buffer.alloc(32, 35) } });
  const services = sourceTruthServices({ repository, blobs, policy: capturePolicy() });
  await services.capture.save(owner, "workspace", { expectedRevision: 0, input: { sources: [{ sourceId: "docs", kind: "DIRECTORY_UPLOAD", mode: "UPDATE" }] } });
  const run = await services.capture.start(owner, "workspace", { draftRevision: 1 });
  const bytes = Buffer.from("abcd"), entry = { pathBytes: pathBytes("file"), kind: "FILE", sizeBytes: "4", expectedContent: { algorithm: "sha256", digest: hash(bytes) }, gitMode: null };
  await services.capture.advance(owner, "workspace", run.id);
  await services.capture.enumerateDirectory(owner, "workspace", run.id, "docs", { batchId: "0", entries: [entry] });
  await services.capture.closeDirectory(owner, "workspace", run.id, "docs", { fileCount: "1", directoryCount: "0", manifestId: manifestIdentity("DIRECTORY_UPLOAD", [entry]).id });
  await services.capture.advance(owner, "workspace", run.id);
  await services.capture.uploadChunk(owner, "workspace", run.id, "docs", { pathBytes: entry.pathBytes, offset: "0", sizeBytes: "4", digest: hash(bytes) }, [bytes]);
  const chunk = (await db.query("SELECT * FROM source_truth_upload_checkpoint")).rows[0];
  const filename = await blobs.location(scope, "chunks", chunk.chunk_id);
  return { ...services, db, run, entry, chunk, filename };
}

test("B-08/09 cancellation retains bytes; explicit abandonment releases only private chunks and keeps audit/history", async (t) => {
  const f = await fixture(t);
  assert.ok(f.staging, "the source service must expose explicit staging disposition");
  await assert.rejects(f.staging.release(owner, "workspace", f.run.id, { confirmRelease: true }), { code: "SOURCE_RUN_ACTIVE" });
  await f.capture.finishFile(owner, "workspace", f.run.id, "docs", f.entry.pathBytes);
  await f.repository.cancel(owner, "workspace", f.run.id);
  assert.ok((await lstat(f.filename)).isFile());
  await assert.rejects(f.staging.release(owner, "workspace", f.run.id, {}), { code: "SOURCE_RELEASE_CONFIRMATION_REQUIRED" });
  await assert.rejects(f.staging.release(reader, "workspace", f.run.id, { confirmRelease: true }), { code: "SOURCE_FORBIDDEN" });
  const result = await f.staging.release(owner, "workspace", f.run.id, { confirmRelease: true });
  assert.equal(result.abandoned, true); assert.equal(result.releasedBytes, "4"); assert.equal(result.remainingChunks, "0");
  await assert.rejects(lstat(f.filename), { code: "ENOENT" });
  assert.equal(await f.blobs.verifyBlob(scope, { digest: f.entry.expectedContent.digest, sizeBytes: "4" }), true, "full verified content is not temporary chunk storage");
  assert.equal((await f.repository.getRun(owner, "workspace", f.run.id)).status, "CANCELLED");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_upload_checkpoint")).rows[0].n, 1, "original acknowledgement remains auditable, but is not a live resumable prefix");
  assert.equal((await f.upload.checkpoint(owner, { workspaceId: "workspace", runId: f.run.id, sourceId: "docs" }, f.entry.pathBytes)).abandoned, true);
  assert.equal((await f.staging.release(owner, "workspace", f.run.id, { confirmRelease: true })).releasedBytes, "4");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_event WHERE event_type='STAGING_RELEASE_REQUESTED'")).rows[0].n, 1);
});

test("B-05/08 abandonment rejects pending retries and prevents later retry resurrection", async (t) => {
  const f = await fixture(t);
  assert.ok(f.staging, "the source service must expose explicit staging disposition");
  const current = await f.repository.getRun(owner, "workspace", f.run.id);
  await f.repository.transition("workspace", f.run.id, { generation: current.generation, expectedStatus: current.status, status: "FAILED_RETRYABLE" });
  const retry = await f.capture.start(owner, "workspace", { retryOf: f.run.id });
  await assert.rejects(f.staging.release(owner, "workspace", f.run.id, { confirmRelease: true }), { code: "SOURCE_STAGING_REFERENCED" });
  await f.repository.cancel(owner, "workspace", retry.id);
  await f.staging.release(owner, "workspace", retry.id, { confirmRelease: true });
  await f.staging.release(owner, "workspace", f.run.id, { confirmRelease: true });
  await assert.rejects(f.capture.start(owner, "workspace", { retryOf: f.run.id }), { code: "SOURCE_RETRY_ABANDONED" });
});

test("B-09/12 backup protection and a response lost after unlink cannot cause unsafe or ambiguous release", async (t) => {
  const f = await fixture(t);
  assert.ok(f.staging, "the source service must expose explicit staging disposition");
  await f.repository.cancel(owner, "workspace", f.run.id);
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=true");
  await assert.rejects(f.staging.release(owner, "workspace", f.run.id, { confirmRelease: true }), { code: "SOURCE_BACKUP_BUSY" });
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=false");
  const original = f.blobs.releaseChunk.bind(f.blobs); let dropped = false;
  f.blobs.releaseChunk = async (...args) => { const result = await original(...args); if (!dropped) { dropped = true; throw new Error("simulated post-unlink loss"); } return result; };
  await assert.rejects(f.staging.release(owner, "workspace", f.run.id, { confirmRelease: true }), /simulated post-unlink loss/);
  assert.equal((await f.staging.inspect(owner, "workspace", f.run.id)).remainingChunks, "1");
  const reopened = sourceTruthServices({ repository: f.repository, blobs: f.blobs, policy: f.policy });
  assert.equal((await reopened.staging.release(owner, "workspace", f.run.id, { confirmRelease: true })).releasedBytes, "4");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_chunk_release")).rows[0].n, 1);
});

test("B-12 exact backup references remain protected, and uncertain target completion fails closed", async (t) => {
  for (const mode of ["indexed", "uncertain", "failed-before-seal"]) {
    const f = await fixture(t);
    await f.repository.cancel(owner, "workspace", f.run.id);
    await f.db.query("INSERT INTO source_truth_backup_attempt(id,target_id,requested_by,status,finished_at,target_seal_attempted) VALUES ('backup','fixture','admin','FAILED',clock_timestamp(),$1)", [mode !== "failed-before-seal"]);
    if (mode === "indexed") {
      await f.db.query("INSERT INTO source_truth_backup_set VALUES ('backup','fixture','{}',clock_timestamp())");
      await f.db.query("INSERT INTO source_truth_backup_object VALUES ('backup','workspace','chunks',$1)", [f.chunk.chunk_id]);
      await f.db.query("INSERT INTO source_truth_backup_index_complete (backup_id) VALUES ('backup')");
    }
    const result = await f.staging.release(owner, "workspace", f.run.id, { confirmRelease: true });
    assert.equal(result.retainedBytes, mode === "failed-before-seal" ? "0" : "4");
    assert.equal(result.unverifiedBackupChunks, mode === "uncertain" ? "1" : "0");
    assert.equal(result.remainingChunks, "0");
    if (mode !== "failed-before-seal") assert.ok((await lstat(f.filename)).isFile());
  }
});

test("B-08/09 cancellation and release fence a duplicate upload before its bytes can reappear", async (t) => {
  const f = await fixture(t);
  let entered, proceed;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const resume = new Promise((resolve) => { proceed = resolve; });
  const upload = f.capture.uploadChunk(owner, "workspace", f.run.id, "docs",
    { pathBytes: f.entry.pathBytes, offset: "0", sizeBytes: "4", digest: hash(Buffer.from("abcd")) },
    (async function* () { entered(); await resume; yield Buffer.from("abcd"); })());
  const outcome = upload.then(() => null, (error) => error);
  await waiting;
  await f.repository.cancel(owner, "workspace", f.run.id);
  await f.staging.release(owner, "workspace", f.run.id, { confirmRelease: true });
  proceed();
  assert.ok(await outcome, "the cancelled upload must not acknowledge late bytes");
  await assert.rejects(lstat(f.filename), { code: "ENOENT" }, "a late publication must not resurrect a released chunk");
});
