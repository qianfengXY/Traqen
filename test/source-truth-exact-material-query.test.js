import assert from "node:assert/strict";
import test from "node:test";
import { inventoryOptions, inventoryResult } from "../src/source-truth/inventory-query.js";
import { pathBytes } from "../src/source-truth/identity.js";

const binding = { workspaceId: "w", bundleId: "a".repeat(64), receiptId: "r" };
test("exact material location is a canonical byte filter bound into every cursor, not a substring search", () => {
  const encoded = pathBytes(Buffer.from([120, 255, 46, 116, 120, 116]));
  const selected = inventoryOptions({ pathBytes: encoded, limit: 1 }, binding);
  assert.deepEqual(selected.exactPath, Buffer.from([120, 255, 46, 116, 120, 116]));
  const result = inventoryResult([1, 2].map(() => ({ component_id: "b".repeat(64), entry: { pathBytes: encoded } })), selected, "2");
  assert.throws(() => inventoryOptions({ pathBytes: pathBytes("different"), cursor: result.nextCursor }, binding), { code: "SOURCE_INVALID_INPUT" });
  for (const invalid of ["bad=", pathBytes("safe") + "A", "A".repeat(12000)])
    assert.throws(() => inventoryOptions({ pathBytes: invalid }, binding), { code: "SOURCE_INVALID_INPUT" });
});
