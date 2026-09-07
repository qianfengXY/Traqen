import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifiedGitBatch } from "../src/source-truth/git-batch.js";
import { pathBytes } from "../src/source-truth/identity.js";

function frame(bytes, objectFormat = "sha1", name = "file") {
  const oid = createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  const entry = { pathBytes: pathBytes(name), kind: "FILE", sizeBytes: String(bytes.length), expectedContent: { objectFormat, oid }, gitMode: "100644" };
  return { entry, wire: Buffer.concat([Buffer.from(`${oid} blob ${bytes.length}\n`), bytes, Buffer.from("\n")]) };
}
async function* chunks(bytes, size = 7) { for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size); }
async function drain(stream) { const values = []; for await (const item of stream) { let size = 0; for await (const part of item.content) size += part.length; values.push(size); } return values; }

test("batch framing verifies empty and multi-chunk objects in both native Git formats", async () => {
  for (const format of ["sha1", "sha256"]) {
    const frames = [frame(Buffer.alloc(0), format, "zero"), frame(Buffer.alloc(128 * 1024, 31), format, "large")];
    assert.deepEqual(await drain(verifiedGitBatch(chunks(Buffer.concat(frames.map((item) => item.wire)), 32767), frames.map((item) => item.entry), format)), [0, 128 * 1024]);
  }
});

test("batch framing rejects truncated, reordered, corrupted and trailing bytes instead of false green", async () => {
  const a = frame(Buffer.from("content"));
  const b = frame(Buffer.from("second"));
  const corrupted = Buffer.from(a.wire); corrupted[corrupted.length - 3] ^= 1;
  for (const wire of [a.wire.subarray(0, -1), b.wire, corrupted, Buffer.concat([a.wire, Buffer.from("extra")]), Buffer.from(`${a.entry.expectedContent.oid} missing\n`)]) {
    await assert.rejects(drain(verifiedGitBatch(chunks(wire), [a.entry], "sha1")), { code: "SOURCE_GIT_INTEGRITY_FAILED" });
  }
});

test("batch cannot advance an unread object and closes the native stream on early exit", async () => {
  const a = frame(Buffer.from("content")); let closed = false;
  const stream = (async function* () { try { yield a.wire; } finally { closed = true; } })();
  const batch = verifiedGitBatch(stream, [a.entry], "sha1");
  assert.equal((await batch.next()).done, false);
  await assert.rejects(batch.next(), { code: "SOURCE_GIT_BATCH_NOT_CONSUMED" });
  assert.equal(closed, true);
});
