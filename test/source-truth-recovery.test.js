import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceDatabase, owner } from "./support/source-truth-database.js";
import { sourceTruthServices } from "../src/source-truth/services.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { capturePolicy } from "../src/source-truth/policy.js";
import { manifestIdentity, pathBytes } from "../src/source-truth/identity.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const entryFor = (content) => ({ pathBytes: pathBytes("document"), kind: "FILE", sizeBytes: String(content.length),
  expectedContent: { algorithm: "sha256", digest: hash(content) }, gitMode: null });
async function fixture(t) {
  const { repository, db } = await sourceDatabase(t);
  const blobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "tq-f001-prefix-retry-")), keyVersion: "test", keys: { test: Buffer.alloc(32, 14) } });
  const services = sourceTruthServices({ repository, blobs, policy: capturePolicy() });
  await services.capture.save(owner, "workspace", { expectedRevision: 0, input: { sources: [{ sourceId: "docs", kind: "DIRECTORY_UPLOAD", mode: "UPDATE" }] } });
  const run = await services.capture.start(owner, "workspace", { draftRevision: 1 });
  const content = Buffer.from("abcd"), entry = entryFor(content);
  const enumerate = async (runId, selected) => {
    await services.capture.advance(owner, "workspace", runId);
    await services.capture.enumerateDirectory(owner, "workspace", runId, "docs", { batchId: "0", entries: [selected] });
    await services.capture.closeDirectory(owner, "workspace", runId, "docs", { fileCount: "1", directoryCount: "0", manifestId: manifestIdentity("DIRECTORY_UPLOAD", [selected]).id });
    return services.capture.advance(owner, "workspace", runId);
  };
  await enumerate(run.id, entry);
  await services.capture.uploadChunk(owner, "workspace", run.id, "docs", { pathBytes: entry.pathBytes, offset: "0", sizeBytes: "2", digest: hash(content.subarray(0, 2)) }, [content.subarray(0, 2)]);
  const current = await repository.getRun(owner, "workspace", run.id);
  await repository.transition("workspace", run.id, { generation: current.generation, expectedStatus: current.status, status: "FAILED_RETRYABLE", diagnostic: { code: "SOURCE_STORAGE_UNAVAILABLE" } });
  const retry = await services.capture.start(owner, "workspace", { retryOf: run.id });
  return { ...services, db, run, retry, content, entry, enumerate };
}

test("B-08 terminal retry revalidates and references the saved prefix without copying or re-uploading it", async (t) => {
  const f = await fixture(t);
  assert.notEqual(f.retry.id, f.run.id);
  assert.equal(f.retry.retryOf, f.run.id);
  const before = f.blobs.metrics.streamedBytes;
  assert.equal((await f.enumerate(f.retry.id, f.entry)).status, "WAITING_FOR_CLIENT");
  const context = { workspaceId: "workspace", runId: f.retry.id, sourceId: "docs" };
  assert.equal((await f.upload.checkpoint(owner, context, f.entry.pathBytes)).verifiedPrefixBytes, "2");
  assert.equal(f.blobs.metrics.streamedBytes, before, "reference reuse is not a second copy");
  const refs = (await f.db.query("SELECT chunk_id FROM source_truth_upload_checkpoint ORDER BY run_id")).rows;
  assert.equal(refs.length, 2); assert.equal(refs[0].chunk_id, refs[1].chunk_id);
  await f.capture.uploadChunk(owner, "workspace", f.retry.id, "docs", { pathBytes: f.entry.pathBytes, offset: "2", sizeBytes: "2", digest: hash(f.content.subarray(2)) }, [f.content.subarray(2)]);
  await f.capture.finishFile(owner, "workspace", f.retry.id, "docs", f.entry.pathBytes);
  assert.equal((await f.capture.advance(owner, "workspace", f.retry.id)).status, "REVIEW_REQUIRED");
  assert.equal((await f.repository.getRun(owner, "workspace", f.run.id)).status, "FAILED_RETRYABLE");
});

test("B-08 changed reselected directory cannot use retry to replace an already frozen expected manifest", async (t) => {
  const f = await fixture(t);
  const changed = await f.enumerate(f.retry.id, entryFor(Buffer.from("efgh")));
  assert.equal(changed.status, "BLOCKED");
  assert.equal(changed.diagnostic.code, "SOURCE_DIRECTORY_CHANGED");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_upload_checkpoint WHERE run_id=$1", [f.retry.id])).rows[0].n, 0);
});

test("B-08 a damaged prior checkpoint is not trusted by a new retry", async (t) => {
  const f = await fixture(t);
  const row = (await f.db.query("SELECT chunk_id FROM source_truth_upload_checkpoint WHERE run_id=$1", [f.run.id])).rows[0];
  const filename = await f.blobs.location({ tenantId: "tenant", workspaceId: "workspace" }, "chunks", row.chunk_id);
  const handle = await open(filename, "r+");
  try { await handle.write(Buffer.from("broken"), 0, 6, 0); } finally { await handle.close(); }
  const result = await f.enumerate(f.retry.id, f.entry);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.diagnostic.code, "SOURCE_CONTENT_CORRUPT");
});
