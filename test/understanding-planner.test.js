import assert from "node:assert/strict";
import test from "node:test";

import { createArtifactInventory } from "../src/domain/index.js";
import { appendFollowUpWorkUnit, createUnderstandingPlan } from "../src/analysis/understanding-planner.js";

const digest = (letter) => `sha256:${letter.repeat(64)}`;
const inventory = createArtifactInventory({
  projectId: "PROJECT-1", snapshotManifestId: "SNAPSHOT-1", sourceDigest: digest("a"),
  scannerVersion: "1", sealed: true,
  artifacts: [
    { id: "A-1", path: "src/missed-entry.js", kind: "SOURCE", language: "javascript", byteSize: 20, contentDigest: digest("b"), disposition: "INCLUDED" },
    { id: "A-2", path: "docs/api.md", kind: "DOCUMENT", language: "markdown", byteSize: 30, contentDigest: digest("c"), disposition: "INCLUDED" },
    { id: "A-3", path: ".env", kind: "CONFIG", byteSize: 12, contentDigest: digest("d"), disposition: "SECRET_REDACTED", reason: "secret policy" },
  ],
});

function plan(overrides = {}) {
  return createUnderstandingPlan({
    inventory, plannerVersion: "1", conventionVersion: "1", executionPolicyDigest: "POLICY-1",
    maxArtifactsPerPartition: 1, ...overrides,
  });
}

test("planner derives stable complete partitions from Inventory without scanner Facts", () => {
  const first = plan();
  const second = plan();
  assert.equal(first.id, second.id);
  assert.equal(first.unassignedCount, 0);
  assert.equal(first.assignedCount, inventory.totalCount);
  assert.deepEqual(first.partitions.flatMap(({ artifactIds }) => artifactIds).sort(), ["A-1", "A-2", "A-3"]);
  assert.equal(first.partitions.find(({ artifactIds }) => artifactIds.includes("A-1")).disposition, "DIRECT_SOURCE");
  assert.equal(first.partitions.find(({ artifactIds }) => artifactIds.includes("A-3")).disposition, "EXPLICIT_GAP");
  assert.notEqual(plan({ executionPolicyDigest: "POLICY-2" }).id, first.id);
  assert.throws(() => plan({ truthSetDigest: "LEAK" }), /Truth Set/);
});

test("dynamic DAG is not limited to UI child slots and bounded follow-up records gaps", () => {
  const result = plan();
  assert.ok(result.workUnits.some(({ kind }) => kind === "PROJECT_SYNTHESIS"));
  const parent = result.workUnits.find(({ kind }) => kind === "LEAF");
  const followed = appendFollowUpWorkUnit(result, { parentWorkUnitId: parent.id, question: "resolve call", depth: 1 });
  assert.equal(followed.gap, null);
  const exhausted = appendFollowUpWorkUnit(result, { parentWorkUnitId: parent.id, question: "too deep", depth: 4, maxDepth: 3 });
  assert.equal(exhausted.gap.code, "UNEXPLORED_BUDGET_LIMIT");
});
