import assert from "node:assert/strict";
import test from "node:test";
import { verifyProtectedVolume } from "../src/source-truth/volume-protection.js";

for (const [encrypted, permissionsEnforced, persistent] of [
  [false, true, true], [true, false, true], [true, true, false], [false, false, false],
]) {
  test(`MVP storage accepts observed volume attributes ${encrypted}/${permissionsEnforced}/${persistent} without inventing protection`, async () => {
    const observed = { encrypted, permissionsEnforced, persistent, filesystemId: "synthetic-volume", physicalStores: ["synthetic-disk"] };
    const result = await verifyProtectedVolume("/synthetic-only", { probe: async (root) => {
      assert.equal(root, "/synthetic-only");
      return observed;
    } });
    for (const key of Object.keys(observed)) assert.deepEqual(result[key], observed[key]);
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  });
}

test("volume identity remains required independently of optional protection attributes", async () => {
  for (const filesystemId of [undefined, null, ""]) {
    await assert.rejects(verifyProtectedVolume("/synthetic-only", {
      probe: async () => ({ encrypted: true, permissionsEnforced: true, persistent: true, filesystemId }),
    }), { code: "SOURCE_VOLUME_PROBE_UNAVAILABLE" });
  }
});

test("unavailable volume evidence is not replaced with fabricated protection", async () => {
  const failure = new Error("synthetic probe unavailable");
  await assert.rejects(verifyProtectedVolume("/synthetic-only", { probe: async () => { throw failure; } }), (error) => {
    assert.equal(error.code, "SOURCE_VOLUME_PROBE_UNAVAILABLE");
    assert.equal(error.cause, failure);
    return true;
  });
});
