import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createArtifactInventory, createEvaluationPolicy } from "../src/domain/index.js";
import { ArtifactInventoryScanner } from "../src/scanner/artifact-inventory-scanner.js";
import { createUnderstandingPlan } from "../src/analysis/understanding-planner.js";
import { evaluateUnderstanding } from "../src/application/understanding-evaluator.js";
import { planIncrementalUnderstanding } from "../src/application/incremental-understanding.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);
const sourceDigest = `sha256:${"a".repeat(64)}`;

test("Traqen analyzes two fixed self Snapshots with complete disposition and atomic FULL to INCREMENTAL head movement", async () => {
  const truth = JSON.parse(await readFile(
    new URL("./fixtures/understanding/traqen-self-calibration-v1.json", import.meta.url),
    "utf8",
  ));
  const scanner = new ArtifactInventoryScanner({ allowlistedRoots: [repositoryRoot], maxFileBytes: 2 * 1024 * 1024 });
  const inventoryA = await scanner.scan({
    projectId: "TRAQEN-SELF",
    snapshotManifestId: "TRAQEN-SNAPSHOT-A",
    sourceDigest,
    rootPath: repositoryRoot,
  });
  assert.equal(inventoryA.disposedCount, inventoryA.totalCount);
  assert.ok(inventoryA.totalCount > 100);
  for (const requiredRoot of ["docs/", "feature-specs/", "contracts/", "src/", "test/", "web/"]) {
    assert.ok(inventoryA.artifacts.some(({ path: artifactPath }) => artifactPath.startsWith(requiredRoot)), requiredRoot);
  }
  const planA = createUnderstandingPlan({
    inventory: inventoryA,
    plannerVersion: "1.0.0",
    conventionVersion: "traqen-self-v1",
    executionPolicyDigest: "SELF-POLICY-1",
  });
  assert.equal(planA.unassignedCount, 0);
  assert.equal(planA.assignedCount, inventoryA.totalCount);
  assert.ok(truth.anchors.every((anchor) => inventoryA.artifacts.some(({ path: artifactPath }) => artifactPath === anchor.path)));

  const policy = createEvaluationPolicy({
    id: "traqen-self-v1",
    version: "1",
    thresholds: {
      inventoryDispositionRate: 1,
      anchorRecall: 0.9,
      candidatePrecision: 0.9,
      requiredRelationshipRate: 1,
      forbiddenRelationshipViolations: 0,
      sourceAttributionRate: 1,
      gapHonestyRate: 1,
      replayEquivalenceRate: 1,
      incrementalEquivalenceRate: 1,
    },
    minimumAnchors: 30,
    minimumRequiredRelationships: 60,
  });
  const evaluationA = evaluateUnderstanding({
    projectId: "TRAQEN-SELF",
    analysisRunId: "SELF-RUN-A",
    policy,
    truthSet: {
      ...truth,
      requiredRelationships: truth.requiredRelationships.map(([subject, predicate, object]) => ({ subject, predicate, object })),
      forbiddenRelationships: truth.forbiddenRelationships.map(([subject, predicate, object]) => ({ subject, predicate, object })),
    },
    truthSetDigest: "TRUTH-SELF-V1",
    productionInputDigest: planA.planDigest,
    observedAnchorIds: truth.anchors.map(({ id }) => id),
    observedRelationships: truth.requiredRelationships.map(([subject, predicate, object]) => ({ subject, predicate, object })),
    inventory: inventoryA,
    candidateSample: { total: 30, correct: 27 },
    sourceAttribution: { total: 60, valid: 60 },
    gaps: { total: 10, honest: 10 },
    replayEquivalenceRate: 1,
    incrementalEquivalenceRate: 1,
    reviewer: { id: "SELF-CALIBRATION-REVIEWER", role: "technical-reviewer" },
    implementationAuthorId: "SELF-IMPLEMENTATION-AUTHOR",
  });
  assert.equal(evaluationA.status, "PASSED");

  const changed = inventoryA.artifacts.map((artifact, index) => index === 0
    ? { ...artifact, contentDigest: `sha256:${"b".repeat(64)}` }
    : artifact);
  const inventoryB = createArtifactInventory({
    projectId: "TRAQEN-SELF",
    snapshotManifestId: "TRAQEN-SNAPSHOT-B",
    sourceDigest: `sha256:${"b".repeat(64)}`,
    scannerVersion: inventoryA.scannerVersion,
    sealed: true,
    artifacts: changed,
  });
  const planB = createUnderstandingPlan({
    inventory: inventoryB,
    plannerVersion: "1.0.0",
    conventionVersion: "traqen-self-v1",
    executionPolicyDigest: "SELF-POLICY-1",
  });
  const incremental = planIncrementalUnderstanding({
    requestedMode: "AUTO",
    currentGraphHead: { graphRevisionId: "SELF-GRAPH-A" },
    previous: { inventory: inventoryA, plan: planA },
    current: { inventory: inventoryB, plan: planB },
  });
  assert.equal(incremental.mode, "INCREMENTAL");
  assert.equal(incremental.changes.length, 1);
  assert.ok(incremental.reusedWorkUnitIds.length > 0);

  const store = new MemoryTraceabilityStore();
  await store.appendUnderstandingRecord("TRAQEN-SELF", "EVALUATION_RUN", evaluationA);
  await store.appendUnderstandingRecord("TRAQEN-SELF", "GRAPH_REVISION", {
    id: "SELF-GRAPH-A", projectId: "TRAQEN-SELF", evaluationRunId: evaluationA.id, mode: "FULL",
    baseRevisionId: null, status: "EVALUATING", createdAt: "2026-07-29T00:00:00.000Z",
  });
  await store.publishGraphRevision("TRAQEN-SELF", "SELF-GRAPH-A", 0);
  const evaluationB = { ...evaluationA, id: "SELF-EVALUATION-B", analysisRunId: "SELF-RUN-B" };
  await store.appendUnderstandingRecord("TRAQEN-SELF", "EVALUATION_RUN", evaluationB);
  await store.appendUnderstandingRecord("TRAQEN-SELF", "GRAPH_REVISION", {
    id: "SELF-GRAPH-B", projectId: "TRAQEN-SELF", evaluationRunId: evaluationB.id, mode: "INCREMENTAL",
    baseRevisionId: "SELF-GRAPH-A", status: "EVALUATING", createdAt: "2026-07-29T00:01:00.000Z",
  });
  const headB = await store.publishGraphRevision("TRAQEN-SELF", "SELF-GRAPH-B", 1);
  assert.equal(headB.graphRevisionId, "SELF-GRAPH-B");
  assert.equal(headB.version, 2);
});
