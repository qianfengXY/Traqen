import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceDatabase, owner } from "./support/source-truth-database.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { SourceUploadService } from "../src/source-truth/upload-service.js";
import { pathBytes } from "../src/source-truth/identity.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = Buffer.from("abcdef");
async function fixture(t) {
  const { repository, db } = await sourceDatabase(t);
  const materials = new SourceMaterialRepository(repository);
  const root = await mkdtemp(path.join(tmpdir(), "traqen-source-upload-test-"));
  const blobConfig = { root, keyVersion: "test-key", keys: { "test-key": Buffer.alloc(32, 21) }, maxChunkBytes: 4 };
  const blobs = await SourceTruthBlobStore.open(blobConfig);
  const source = { sourceId: "D", kind: "DIRECTORY_UPLOAD", scope: { kind: "UPLOADED_DIRECTORY" } };
  await repository.saveDraft(owner, "workspace", { expectedRevision: 0, input: { sources: [source] } });
  const run = await repository.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "v1" });
  const lease = await repository.claimRun("workspace", run.id, { workerId: "w", leaseMs: 60000 });
  const context = { workspaceId: "workspace", runId: run.id, generation: lease.generation, sourceId: "D" };
  const advance = (from, to) => repository.transition("workspace", run.id, { generation: lease.generation, expectedStatus: from, status: to });
  await advance("PREFLIGHTING", "ENUMERATING");
  await materials.addSource(context, source);
  const entry = { pathBytes: pathBytes("docs/a.txt"), kind: "FILE", sizeBytes: String(bytes.length), expectedContent: { algorithm: "sha256", digest: hash(bytes) }, gitMode: null };
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
