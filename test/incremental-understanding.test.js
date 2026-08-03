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

test("removed artifacts retire prior work and invalidate current project synthesis", () => {
  const result = planIncrementalUnderstanding({
    requestedMode: "INCREMENTAL",
    currentGraphHead: { graphRevisionId: "G1" },
    previous: {
      inventory: { snapshotManifestId: "S1", artifacts: [
        { id: "REMOVED", path: "lib/old.js", contentDigest: "old" },
        { id: "CURRENT", path: "src/current.js", contentDigest: "same" },
      ] },
      plan: {
        partitions: [{ id: "PART-OLD", locality: "lib" }, { id: "PART-CURRENT", locality: "src" }],
        workUnits: [
          { id: "LEAF-OLD", partitionId: "PART-OLD", kind: "LEAF", artifactIds: ["REMOVED"], dependencies: [] },
          { id: "LEAF-CURRENT", partitionId: "PART-CURRENT", kind: "LEAF", artifactIds: ["CURRENT"], dependencies: [] },
          { id: "MODULE-OLD", partitionId: null, kind: "MODULE_SYNTHESIS", artifactIds: [], dependencies: ["LEAF-OLD"] },
          { id: "MODULE-CURRENT", partitionId: null, kind: "MODULE_SYNTHESIS", artifactIds: [], dependencies: ["LEAF-CURRENT"] },
          { id: "PROJECT-OLD", partitionId: null, kind: "PROJECT_SYNTHESIS", artifactIds: [], dependencies: ["MODULE-OLD", "MODULE-CURRENT"] },
        ],
      },
    },
    current: {
      inventory: { snapshotManifestId: "S2", artifacts: [{ id: "CURRENT", path: "src/current.js", contentDigest: "same" }] },
      plan: {
        partitions: [{ id: "PART-CURRENT", locality: "src" }],
        workUnits: [
          { id: "LEAF-CURRENT", partitionId: "PART-CURRENT", kind: "LEAF", artifactIds: ["CURRENT"], dependencies: [] },
          { id: "MODULE-CURRENT", partitionId: null, kind: "MODULE_SYNTHESIS", artifactIds: [], dependencies: ["LEAF-CURRENT"] },
          { id: "PROJECT-CURRENT", partitionId: null, kind: "PROJECT_SYNTHESIS", artifactIds: [], dependencies: ["MODULE-CURRENT"] },
        ],
      },
    },
  });
  assert.deepEqual(result.retiredWorkUnitIds, ["LEAF-OLD", "MODULE-OLD"]);
  assert.deepEqual(result.affectedWorkUnitIds, ["PROJECT-CURRENT"]);
  assert.deepEqual(result.reusedWorkUnitIds, ["LEAF-CURRENT", "MODULE-CURRENT"]);
});
