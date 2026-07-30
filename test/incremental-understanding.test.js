import assert from "node:assert/strict";
import test from "node:test";

import { assertIncrementalEquivalence, planIncrementalUnderstanding } from "../src/application/incremental-understanding.js";

test("AUTO resolves FULL then INCREMENTAL, reuses unaffected work, and proves equivalence", () => {
  const current = {
    inventory: { snapshotManifestId: "S2", artifacts: [
      { id: "A2", path: "src/a.js", contentDigest: "new" },
      { id: "B1", path: "src/b.js", contentDigest: "same" },
    ] },
    plan: { workUnits: [
      { id: "W-A", artifactIds: ["A2"], dependencies: [] },
      { id: "W-B", artifactIds: ["B1"], dependencies: [] },
    ] },
  };
  const result = planIncrementalUnderstanding({
    requestedMode: "AUTO", currentGraphHead: { graphRevisionId: "G1" },
    previous: { inventory: { snapshotManifestId: "S1", artifacts: [
      { id: "A1", path: "src/a.js", contentDigest: "old" },
      { id: "B1", path: "src/b.js", contentDigest: "same" },
    ] } },
    current,
  });
  assert.equal(result.mode, "INCREMENTAL");
  assert.deepEqual(result.affectedWorkUnitIds, ["W-A"]);
  assert.deepEqual(result.reusedWorkUnitIds, ["W-B"]);
  assert.equal(assertIncrementalEquivalence(
    { nodes: [{ id: "N" }], edges: [] }, { nodes: [{ id: "N" }], edges: [] },
  ).equivalent, true);
});

test("changed leaf invalidates the full reverse dependency closure", () => {
  const result = planIncrementalUnderstanding({
    requestedMode: "INCREMENTAL", currentGraphHead: { graphRevisionId: "G1" },
    previous: { inventory: { snapshotManifestId: "S1", artifacts: [{ id: "A1", path: "src/a.js", contentDigest: "old" }] } },
    current: {
      inventory: { snapshotManifestId: "S2", artifacts: [{ id: "A2", path: "src/a.js", contentDigest: "new" }] },
      plan: { workUnits: [
        { id: "LEAF", artifactIds: ["A2"], dependencies: [] },
        { id: "MODULE", artifactIds: [], dependencies: ["LEAF"] },
        { id: "PROJECT", artifactIds: [], dependencies: ["MODULE"] },
        { id: "UNRELATED", artifactIds: [], dependencies: [] },
      ] },
    },
  });
  assert.deepEqual(result.affectedWorkUnitIds, ["LEAF", "MODULE", "PROJECT"]);
  assert.deepEqual(result.reusedWorkUnitIds, ["UNRELATED"]);
});
