import assert from "node:assert/strict";
import test from "node:test";

import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";

test("GraphRevision publication is evaluation-gated, first-FULL, and head-CAS atomic", async () => {
  const store = new MemoryTraceabilityStore();
  const minimumDenominators = { inventory: 1, anchors: 1, candidateSample: 1, requiredRelationships: 1, forbiddenRelationships: 1, sourceAttributions: 1, gaps: 1, replaySamples: 1, incrementalComparisons: 1 };
  await store.appendUnderstandingRecord("P", "EVALUATION_RUN", { id: "E1", status: "PASSED", policyVersion: "v1", minimumDenominators, denominators: minimumDenominators, completedAt: "2026-07-29T00:00:00.000Z" });
  await store.appendUnderstandingRecord("P", "GRAPH_ARTIFACT", { id: "A1", projectId: "P", snapshotManifestId: "S1", analysisRunId: "R1", graphArtifactDigest: "D1", createdAt: "2026-07-29T00:00:00.000Z" });
  await store.appendUnderstandingRecord("P", "GRAPH_REVISION", {
    id: "G1", projectId: "P", evaluationRunId: "E1", mode: "FULL", baseRevisionId: null,
    snapshotManifestId: "S1", analysisRunId: "R1", graphArtifactId: "A1", graphArtifactDigest: "D1",
    status: "EVALUATING", createdAt: "2026-07-29T00:00:00.000Z",
  });
  const first = await store.publishGraphRevision("P", "G1", 0);
  assert.equal(first.version, 1);
  assert.equal((await store.getUnderstandingRecord("P", "GRAPH_REVISION", "G1")).status, "PUBLISHED");
  await assert.rejects(store.publishGraphRevision("P", "G1", 0), /version 1 does not match 0/);
  await store.appendUnderstandingRecord("P", "EVALUATION_RUN", { id: "E2", status: "FAILED", policyVersion: "v1", minimumDenominators, denominators: minimumDenominators, completedAt: "2026-07-29T00:01:00.000Z" });
  await store.appendUnderstandingRecord("P", "GRAPH_ARTIFACT", { id: "A2", projectId: "P", snapshotManifestId: "S2", analysisRunId: "R2", graphArtifactDigest: "D2", createdAt: "2026-07-29T00:01:00.000Z" });
  await store.appendUnderstandingRecord("P", "GRAPH_REVISION", {
    id: "G2", projectId: "P", evaluationRunId: "E2", mode: "INCREMENTAL", baseRevisionId: "G1",
    snapshotManifestId: "S2", analysisRunId: "R2", graphArtifactId: "A2", graphArtifactDigest: "D2",
    status: "EVALUATING", createdAt: "2026-07-29T00:01:00.000Z",
  });
  await assert.rejects(store.publishGraphRevision("P", "G2", 1), /must be PASSED/);
  assert.equal((await store.getCurrentGraphHead("P")).graphRevisionId, "G1");
});
