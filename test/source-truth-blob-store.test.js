import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, readdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";

const scope = { tenantId: "tenant", workspaceId: "workspace" };
const digest = (data) => createHash("sha256").update(data).digest("hex");
const key = Buffer.alloc(32, 19);
async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-bytes-"));
  const config = { root, keyVersion: "test-v1", keys: { "test-v1": key }, maxFileBytes: "1048576", maxChunkBytes: 4096, ...options };
  return { root, config, store: await SourceTruthBlobStore.open(config) };
}
async function bytes(iterable) { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return Buffer.concat(chunks); }
async function allFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const location = path.join(root, entry.name);
    result.push(...(entry.isDirectory() ? await allFiles(location) : [location]));
  }
  return result;
}

test("B-07 verified blob survives reopening and is encrypted at rest", async () => {
  const { store, root, config } = await fixture();
  const content = Buffer.from("sensitive-fixture-不应以明文落盘");
  const ref = { digest: digest(content), sizeBytes: String(content.length) };
  const stored = await store.putBlob(scope, ref, Readable.from([content.subarray(0, 9), content.subarray(9)]));
  assert.equal(stored?.digest, ref.digest);
  assert.equal(await store.verifyBlob(scope, ref), true);
  const reopened = await SourceTruthBlobStore.open(config);
  assert.deepEqual(await bytes(reopened.readBlob(scope, ref)), content);
  const files = await allFiles(root);
  assert.ok(files.length > 0);
  for (const file of files) assert.equal((await readFile(file)).includes(content), false);
  assert.equal((await store.putBlob(scope, ref, Readable.from([content]))).reused, true);
});

test("B-05 missing key, unsafe volume, wrong digest/size and cross-Workspace content cannot pass", async () => {
  await assert.rejects(SourceTruthBlobStore.open({ root: os.tmpdir(), keys: {}, keyVersion: "missing" }), { code: "SOURCE_STORAGE_NOT_READY" });
  const { store } = await fixture();
  const data = Buffer.from("private");
  const ref = { digest: digest(data), sizeBytes: String(data.length) };
  await store.putBlob(scope, ref, Readable.from([data]));
  assert.equal(await store.verifyBlob({ ...scope, workspaceId: "another" }, ref), false);
  await assert.rejects(store.putBlob(scope, { digest: "0".repeat(64), sizeBytes: String(data.length) }, Readable.from([data])), { code: "SOURCE_CONTENT_MISMATCH" });
  await assert.rejects(store.putBlob(scope, { digest: digest("long"), sizeBytes: "2" }, Readable.from([Buffer.from("long")])), { code: "SOURCE_CONTENT_MISMATCH" });
});

test("B-08 immutable encrypted chunks prove exact offset/prefix and reject changed replay", async () => {
  const { store } = await fixture();
  const data = Buffer.from("first verified prefix");
  const request = { runId: "run", fileKey: "file", offset: "0", digest: digest(data), sizeBytes: String(data.length) };
  const chunk = await store.putChunk(scope, request, Readable.from([data]));
  assert.equal(chunk?.digest, request.digest);
  assert.equal(chunk.offset, "0");
  assert.deepEqual(await bytes(store.readChunk(scope, chunk)), data);
  await assert.rejects(store.putChunk(scope, request, Readable.from([Buffer.from("changed")])), { code: "SOURCE_CONTENT_MISMATCH" });
});

test("B-09 resource policy rejects oversize without creating verified objects", async () => {
  const { store } = await fixture({ maxFileBytes: "3" });
  const ref = { digest: digest("large"), sizeBytes: "5" };
  await assert.rejects(store.putBlob(scope, ref, Readable.from([Buffer.from("large")])), { code: "SOURCE_FILE_TOO_LARGE" });
  assert.equal(await store.verifyBlob(scope, ref), false);
});

test("B-05 a symlinked storage root cannot redirect writes outside the managed volume", async () => {
  const outer = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-symlink-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-target-"));
  const link = path.join(outer, "linked");
  await symlink(target, link);
  await assert.rejects(SourceTruthBlobStore.open({ root: link, keys: { v1: key }, keyVersion: "v1" }), { code: "SOURCE_STORAGE_NOT_READY" });
  assert.deepEqual(await readdir(target), []);
});

test("B-05 authenticated blob reads release no bytes from a corrupted ciphertext", async () => {
  const { store, root } = await fixture();
  const content = Buffer.from("never-release-corrupted-bytes");
  const ref = { digest: digest(content), sizeBytes: String(content.length) };
  await store.putBlob(scope, ref, Readable.from([content]));
  const [file] = await allFiles(root);
  const handle = await open(file, "r+");
  const stat = await handle.stat();
  await handle.write(Buffer.from([0, 0, 0]), 0, 3, stat.size - 19);
  await handle.close();
  let released = 0;
  await assert.rejects(async () => { for await (const chunk of store.readBlob(scope, ref)) released += chunk.length; }, { code: "SOURCE_CONTENT_CORRUPT" });
  assert.equal(released, 0);
});

test("B-05 a project reached through a symlinked ancestor is still a forbidden storage destination", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-forbidden-project-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-outside-"));
  await symlink(project, path.join(outside, "alias"));
  await assert.rejects(SourceTruthBlobStore.open({ root: path.join(outside, "alias", "bytes"), forbiddenRoots: [project], keyVersion: "v1", keys: { v1: key } }), { code: "SOURCE_STORAGE_NOT_READY" });
  assert.deepEqual(await readdir(project), [], "reject before creating anything inside the forbidden repository");
});

test("B-05 protected deployment rejects unencrypted or permission-ignoring volumes despite encrypted blobs", async () => {
  for (const [encrypted, permissionsEnforced] of [[false, true], [true, false]]) {
    await assert.rejects(fixture({ requireProtectedVolume: true, volumeProbe: async () => ({ encrypted, permissionsEnforced, persistent: true, filesystemId: "fixture-volume", physicalStores: ["fixture-disk"] }) }), { code: "SOURCE_VOLUME_PROTECTION_REQUIRED" });
  }
});
