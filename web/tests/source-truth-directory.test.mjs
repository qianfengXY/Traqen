import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { scanDirectory, directoryManifest } from "../app/source-truth/directory.ts";
import { manifestIdentity } from "../../src/source-truth/identity.js";

const file = (text) => ({ kind: "file", getFile: async () => new File([text], "ignored", { lastModified: 10 }) });
const directory = (children) => ({ kind: "directory", async *entries() { yield* children; } });
const hashFile = async (blob) => createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");
const policy = { maxEntries: 200000, maxFileBytes: "1048576", maxTotalBytes: "10000000", maxBatchEntries: 2 };
function store() {
  const rows = [];
  return { rows, async putBatch(batch) { rows.push(...batch); }, async *ordered() {
    yield* [...rows].sort((a, b) => Buffer.compare(Buffer.from(a.entry.pathBytes, "base64url"), Buffer.from(b.entry.pathBytes, "base64url")));
  } };
}

test("directory selection hashes every file, preserves empty children and matches server canonical byte order", async () => {
  const cache = store();
  const root = directory([["中文", directory([["z.txt", file("\r\n")]])], ["empty", directory([])], ["a.txt", file("")], ["é", file("内容")], ["é", file("same spelling, different bytes")]]);
  const result = await scanDirectory(root, cache, policy, { hashFile });
  const manifestId = await directoryManifest(cache.ordered());
  assert.equal(result.fileCount, "4");
  assert.equal(result.directoryCount, "2");
  assert.equal(manifestId, manifestIdentity("DIRECTORY_UPLOAD", cache.rows.map((r) => r.entry)).id);
  assert.equal(cache.rows.find((row) => row.path === "empty").entry.sizeBytes, null);
  assert.notEqual(cache.rows.find((row) => row.path === "é").entry.pathBytes, cache.rows.find((row) => row.path === "é").entry.pathBytes);
});

test("directory selection never turns unreadable entries, unsafe names, zero files or quota overflow into complete coverage", async () => {
  await assert.rejects(scanDirectory(directory([["empty", directory([])]]), store(), policy, { hashFile }), /至少一个文件/);
  await assert.rejects(scanDirectory(directory([["..", file("bad")]]), store(), policy, { hashFile }), /路径/);
  await assert.rejects(scanDirectory(directory([["unreadable", { kind: "file", getFile: async () => { throw new Error("permission denied"); } }]]), store(), policy, { hashFile }), /permission denied/);
  await assert.rejects(scanDirectory(directory([["a", file("a")], ["b", file("b")]]), store(), { ...policy, maxEntries: 1 }, { hashFile }), /数量/);
  await assert.rejects(scanDirectory(directory([["a", file("abcdef")]]), store(), { ...policy, maxFileBytes: "5" }, { hashFile }), /文件大小/);
  const signal = AbortSignal.abort();
  await assert.rejects(scanDirectory(directory([["a", file("a")]]), store(), policy, { hashFile, signal }), { name: "AbortError" });
});

test("same path/size/mtime is rehashed for each selection, and interrupted local enumeration cannot close a manifest", async () => {
  let reads = 0;
  const hash = async (blob) => { reads++; return hashFile(blob); };
  const a = store(), b = store();
  await scanDirectory(directory([["same", file("a")]]), a, policy, { hashFile: hash });
  await scanDirectory(directory([["same", file("b")]]), b, policy, { hashFile: hash });
  assert.equal(reads, 2);
  assert.notEqual(await directoryManifest(a.ordered()), await directoryManifest(b.ordered()));
  await assert.rejects(scanDirectory(directory([["a", file("a")]]), { putBatch: async () => { throw new Error("local quota"); } }, policy, { hashFile }), /local quota/);
});
