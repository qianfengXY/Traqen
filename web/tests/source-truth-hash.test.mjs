import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { SourceSha256 } from "../app/source-truth/stream-hash.ts";

test("browser streaming SHA-256 agrees with native crypto at padding and arbitrary chunk boundaries", () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 8192, 1000000]) {
    const bytes = randomBytes(length);
    for (const size of [1, 63, 64, 131, 65536]) {
      const hash = new SourceSha256();
      for (let offset = 0; offset < bytes.length; offset += size) hash.update(bytes.subarray(offset, offset + size));
      assert.equal(hash.hex(), createHash("sha256").update(bytes).digest("hex"), `length=${length}, chunk=${size}`);
      assert.equal(hash.hex(), hash.hex(), "finalization is repeatable without appending more padding");
      assert.throws(() => hash.update(new Uint8Array([1])), /final/i);
    }
  }
});

test("browser streaming SHA-256 preserves raw bytes and published SHA-256 vectors", () => {
  assert.equal(new SourceSha256().hex(), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(new SourceSha256().update(new TextEncoder().encode("abc")).hex(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const hash = new SourceSha256();
  for (let i = 0; i < 1000; i++) hash.update(new Uint8Array(1000).fill(97));
  assert.equal(hash.hex(), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
});
