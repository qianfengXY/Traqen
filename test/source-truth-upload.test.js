import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceDatabase, owner, reader } from "./support/source-truth-database.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { SourceUploadService } from "../src/source-truth/upload-service.js";
import { pathBytes } from "../src/source-truth/identity.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = Buffer.from("abcdef");
async function fixture(t, { maxChunkBytes = 4, content = bytes } = {}) {
  const { repository, db } = await sourceDatabase(t);
  const materials = new SourceMaterialRepository(repository);
  const root = await mkdtemp(path.join(tmpdir(), "traqen-source-upload-test-"));
  const blobConfig = { root, keyVersion: "test-key", keys: { "test-key": Buffer.alloc(32, 21) }, maxChunkBytes };
  const blobs = await SourceTruthBlobStore.open(blobConfig);
  const source = { sourceId: "D", kind: "DIRECTORY_UPLOAD", scope: { kind: "UPLOADED_DIRECTORY" } };
  await repository.saveDraft(owner, "workspace", { expectedRevision: 0, input: { sources: [source] } });
  const run = await repository.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "v1" });
  const lease = await repository.claimRun("workspace", run.id, { workerId: "w", leaseMs: 60000 });
  const context = { workspaceId: "workspace", runId: run.id, generation: lease.generation, sourceId: "D" };
  const advance = (from, to) => repository.transition("workspace", run.id, { generation: lease.generation, expectedStatus: from, status: to });
  await advance("PREFLIGHTING", "ENUMERATING");
  await materials.addSource(context, source);
  const entry = { pathBytes: pathBytes("docs/a.txt"), kind: "FILE", sizeBytes: String(content.length), expectedContent: { algorithm: "sha256", digest: hash(content) }, gitMode: null };
  await materials.appendEntries(context, [{ pathBytes: pathBytes("docs"), kind: "DIRECTORY", sizeBytes: null, expectedContent: null, gitMode: null }, entry]);
  await materials.closeEnumeration(context, { fileCount: "1", directoryCount: "1" });
  await materials.freezeManifest(context);
  await materials.dispose(context, { pathBytes: pathBytes("docs"), disposition: "METADATA", reasonCode: "DIRECTORY_RECORDED" });
  await advance("ENUMERATING", "MANIFEST_FROZEN");
  await advance("MANIFEST_FROZEN", "CAPTURING");
  return { repository, db, materials, blobs, blobConfig, context, entry, upload: new SourceUploadService(repository, materials, blobs) };
}

test("B-07/08 directory verified prefixes survive service restart and finalize only at exact content", async (t) => {
  const f = await fixture(t);
  const first = bytes.subarray(0, 3);
  const chunk = { pathBytes: f.entry.pathBytes, offset: "0", sizeBytes: "3", digest: hash(first) };
  assert.equal((await f.upload.uploadChunk(owner, f.context, chunk, [first]))?.verifiedPrefixBytes, "3");
  const reopened = new SourceUploadService(f.repository, f.materials, await SourceTruthBlobStore.open(f.blobConfig));
  assert.equal((await reopened.checkpoint(owner, f.context, f.entry.pathBytes)).verifiedPrefixBytes, "3");
  await assert.rejects(reopened.finishFile(owner, f.context, f.entry.pathBytes), { code: "SOURCE_UPLOAD_INCOMPLETE" });
  const last = bytes.subarray(3);
  await reopened.uploadChunk(owner, f.context, { pathBytes: f.entry.pathBytes, offset: "3", sizeBytes: "3", digest: hash(last) }, [last]);
  const completed = await reopened.finishFile(owner, f.context, f.entry.pathBytes);
  assert.equal(completed.digest, hash(bytes));
  assert.equal((await f.materials.summary(f.context)).pendingCount, "0");
  assert.equal(await f.blobs.verifyBlob({ tenantId: "tenant", workspaceId: "workspace" }, completed), true);
});

test("B-05 upload rejects gaps, mismatched duplicate chunks and a revoked writer", async (t) => {
  const f = await fixture(t);
  const chunk = { pathBytes: f.entry.pathBytes, offset: "3", sizeBytes: "3", digest: hash(bytes.subarray(3)) };
  await assert.rejects(f.upload.uploadChunk(owner, f.context, chunk, [bytes.subarray(3)]), { code: "SOURCE_UPLOAD_OFFSET_MISMATCH" });
  chunk.offset = "0";
  await f.upload.uploadChunk(owner, f.context, chunk, [bytes.subarray(3)]);
  await assert.rejects(f.upload.uploadChunk(owner, f.context, { ...chunk, digest: hash(bytes.subarray(0, 3)) }, [bytes.subarray(0, 3)]), { code: "SOURCE_UPLOAD_CHECKPOINT_CONFLICT" });
  await f.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "REVOKED" }] });
  await assert.rejects(f.upload.uploadChunk(owner, f.context, { ...chunk, offset: "3" }, [bytes.subarray(3)]), { code: "SOURCE_FORBIDDEN" });
});

test("B-05 corrupt final content never gains a VERIFIED inventory disposition", async (t) => {
  const f = await fixture(t);
  for (const offset of ["0", "3"]) await f.upload.uploadChunk(owner, f.context, { pathBytes: f.entry.pathBytes, offset, sizeBytes: "3", digest: hash(Buffer.from("xxx")) }, [Buffer.from("xxx")]);
  await assert.rejects(f.upload.finishFile(owner, f.context, f.entry.pathBytes), { code: "SOURCE_CONTENT_MISMATCH" });
  assert.equal((await f.materials.summary(f.context)).pendingCount, "1");
});

test("B-07/09 complete small files use one durable content write, no chunk copy, and survive a lost response", async (t) => {
  const f = await fixture(t, { maxChunkBytes: 8 });
  assert.equal(typeof f.upload.uploadFile, "function", "complete-file fast path must exist");
  const before = f.blobs.metrics.streamedBytes;
  const result = await f.upload.uploadFile(owner, f.context, f.entry.pathBytes, [bytes]);
  assert.equal(result.completed, true);
  assert.equal(result.verifiedPrefixBytes, "6");
  assert.equal(f.blobs.metrics.streamedBytes - before, 6n, "do not write an intermediate chunk and then a second full copy");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_upload_checkpoint")).rows[0].n, 0);
  const reopened = new SourceUploadService(f.repository, f.materials, await SourceTruthBlobStore.open(f.blobConfig));
  const recovered = await reopened.checkpoint(owner, f.context, f.entry.pathBytes);
  assert.equal(recovered.completed, true); assert.equal(recovered.verifiedPrefixBytes, "6");
  assert.equal((await reopened.uploadFile(owner, f.context, f.entry.pathBytes, [bytes])).completed, true);
  assert.equal((await f.materials.summary(f.context)).pendingCount, "0");
});

test("B-05 complete-file fast path rejects changed bytes, oversize files and revoked/read-only writers", async (t) => {
  const f = await fixture(t);
  assert.equal(typeof f.upload.uploadFile, "function");
  await assert.rejects(f.upload.uploadFile(owner, f.context, f.entry.pathBytes, [bytes]), { code: "SOURCE_FILE_TOO_LARGE" });
  f.blobs.maxChunkBytes = 8;
  await assert.rejects(f.upload.uploadFile(reader, f.context, f.entry.pathBytes, [bytes]), { code: "SOURCE_FORBIDDEN" });
  for (const changed of [Buffer.from("xxxxxx"), bytes.subarray(1), Buffer.concat([bytes, bytes])])
    await assert.rejects(f.upload.uploadFile(owner, f.context, f.entry.pathBytes, [changed]), { code: "SOURCE_CONTENT_MISMATCH" });
  assert.equal((await f.materials.summary(f.context)).pendingCount, "1");
  assert.equal(await f.blobs.verifyBlob({ tenantId: "tenant", workspaceId: "workspace" }, { digest: hash(bytes), sizeBytes: "6" }), false);
});

test("B-05/08 cancellation and revocation during a complete-file stream fence physical publication and acknowledgement", async (t) => {
  for (const boundary of ["cancel", "revoke"]) {
    const f = await fixture(t, { maxChunkBytes: 8 });
    assert.equal(typeof f.upload.uploadFile, "function");
    let entered, proceed;
    const waiting = new Promise((resolve) => { entered = resolve; }), resume = new Promise((resolve) => { proceed = resolve; });
    const outcome = f.upload.uploadFile(owner, f.context, f.entry.pathBytes, (async function* () { entered(); await resume; yield bytes; })()).then(() => null, (error) => error);
    await waiting;
    if (boundary === "cancel") await f.repository.cancel(owner, "workspace", f.context.runId);
    else await f.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "REVOKED" }] });
    proceed();
    assert.ok(["SOURCE_STALE_WORKER", "SOURCE_FORBIDDEN"].includes((await outcome)?.code));
    assert.equal((await f.materials.summary(f.context)).pendingCount, "1");
    assert.equal(await f.blobs.verifyBlob({ tenantId: "tenant", workspaceId: "workspace" }, { digest: hash(bytes), sizeBytes: "6" }), false);
  }
});

test("B-07 complete-file publication retains empty files and cannot acknowledge a failed database commit", async (t) => {
  const f = await fixture(t, { content: Buffer.alloc(0) });
  const original = f.materials.disposeInTransaction.bind(f.materials);
  f.materials.disposeInTransaction = async (...args) => { await original(...args); throw new Error("simulated disposition transaction failure"); };
  await assert.rejects(f.upload.uploadFile(owner, f.context, f.entry.pathBytes, []));
  assert.equal((await f.materials.summary(f.context)).pendingCount, "1");
  const hint = await f.upload.checkpoint(owner, f.context, f.entry.pathBytes);
  assert.equal(hint.completed, false, "durable bytes alone are not a confirmed disposition");
  assert.equal(hint.reusable, true, "the safely published but unacknowledged bytes can be verified again");
  f.materials.disposeInTransaction = original;
  assert.equal((await f.upload.uploadFile(owner, f.context, f.entry.pathBytes, [])).completed, true);
  assert.equal((await f.materials.summary(f.context)).fileCount, "1");
});
