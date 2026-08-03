import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluationPolicy } from "../src/domain/index.js";
import { evaluateUnderstanding } from "../src/application/understanding-evaluator.js";
import {
  createReviewedUnderstandingEvaluationResolver,
  validateReviewedTruthSet,
} from "../src/application/reviewed-understanding-evaluation.js";
import {
  createIndependentAnalysisRun,
  createStoredUnderstandingSurface,
  measureUnderstandingEquivalence,
} from "../src/application/understanding-equivalence.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";

const policy = createEvaluationPolicy({
  version: "traqen-self-v1",
  thresholds: {
    inventoryDispositionRate: 1, anchorRecall: 0.9, candidatePrecision: 0.9,
    requiredRelationshipRate: 1, forbiddenRelationshipViolations: 0,
    sourceAttributionRate: 1, gapHonestyRate: 1, replayEquivalenceRate: 1, incrementalEquivalenceRate: 1,
  },
  minimumDenominators: {
    inventory: 1, anchors: 2, candidateSample: 1, requiredRelationships: 1,
    forbiddenRelationships: 1, sourceAttributions: 1, gaps: 1,
    replaySamples: 1, incrementalComparisons: 1,
  },
});

test("reviewed Truth Sets use the assessed producer predicate vocabulary and disjoint controls", () => {
  const valid = {
    id: "TRUTH-CONTROLS", status: "SEALED", assessedRelationPredicates: ["REFERENCES"], anchors: [],
    requiredRelationships: [["A", "REFERENCES", "B"]],
    forbiddenRelationships: [["B", "REFERENCES", "A"]],
  };
  assert.equal(validateReviewedTruthSet(valid), valid);
  assert.throws(
    () => validateReviewedTruthSet({
      ...valid,
      forbiddenRelationships: [["B", "MUST_NOT_REFERENCE", "A"]],
    }),
    /outside the assessed producer vocabulary/,
  );
  assert.throws(
    () => validateReviewedTruthSet({
      ...valid,
      forbiddenRelationships: [["A", "REFERENCES", "B"]],
    }),
    /cannot require and forbid the same relationship/,
  );
});

test("equivalence rejects cloned surfaces backed by nonexistent independent run IDs", async () => {
  const store = new MemoryTraceabilityStore();
  const surface = {
    digest: "UNDERSTANDING-SEMANTIC-SURFACE:fixture",
    artifacts: [], facts: [], candidates: [], conflicts: [], gaps: [], relations: [],
  };
  await assert.rejects(() => measureUnderstandingEquivalence({
    job: {
      id: "CURRENT",
      projectId: "P",
      snapshotManifestId: "S",
      policyDigest: "POLICY",
      workspaceExecutionProfileRevisionId: "PROFILE",
      resolvedMode: "FULL",
      implementationAuthorId: "AUTHOR",
      runnerId: "RUNNER",
    },
    surface,
    store,
    resolver: async () => ({
      replayAnalysisRunId: "NONEXISTENT-REPLAY",
      fullAnalysisRunId: "NONEXISTENT-FULL",
    }),
  }), /actual terminal server verification AnalysisRun/);
});

test("equivalence rejects self-declared surfaces and legacy run records without a completed server job", async () => {
  const store = new MemoryTraceabilityStore();
  const surface = {
    digest: "UNDERSTANDING-SEMANTIC-SURFACE:fixture",
    artifacts: [], facts: [], candidates: [], conflicts: [], gaps: [], relations: [],
  };
  const job = {
    id: "CURRENT", projectId: "P", snapshotManifestId: "S", policyDigest: "POLICY",
    workspaceExecutionProfileRevisionId: "PROFILE", resolvedMode: "FULL",
    implementationAuthorId: "AUTHOR", runnerId: "RUNNER",
  };
  for (const id of ["DECLARED-REPLAY", "DECLARED-FULL"]) {
    const declaredJob = { ...job, id, implementationAuthorId: "OTHER-AUTHOR", runnerId: "OTHER-RUNNER" };
    const storedSurface = createStoredUnderstandingSurface({ job: declaredJob, surface });
    await store.appendUnderstandingRecord("P", "UNDERSTANDING_SEMANTIC_SURFACE", storedSurface);
    await store.appendUnderstandingRecord("P", "INDEPENDENT_ANALYSIS_RUN", createIndependentAnalysisRun({
      id, projectId: "P", snapshotManifestId: "S", policyDigest: "POLICY",
      workspaceExecutionProfileRevisionId: "PROFILE", surfaceRecordId: storedSurface.id,
      surfaceDigest: surface.digest, mode: "FULL", status: "COMPLETED",
      authorId: "OTHER-AUTHOR", runnerId: "OTHER-RUNNER",
    }));
  }
  await assert.rejects(() => measureUnderstandingEquivalence({
    job, surface, store,
    resolver: async () => ({ replayAnalysisRunId: "DECLARED-REPLAY", fullAnalysisRunId: "DECLARED-FULL" }),
  }), /actual terminal server verification AnalysisRun/);
});

test("multi-dimensional evaluation uses explicit denominators and an independent reviewer", () => {
  const result = evaluateUnderstanding({
    projectId: "P", analysisRunId: "R", policy,
    truthSet: {
      id: "TRUTH-1", status: "SEALED", anchors: [{ id: "A1" }, { id: "A2" }],
      requiredRelationships: [{ subject: "A1", predicate: "USES", object: "A2" }],
      forbiddenRelationships: [{ subject: "A2", predicate: "OWNS", object: "A1" }],
    },
    truthSetDigest: "TRUTH", productionInputDigest: "PRODUCTION",
    observedAnchorIds: ["A1", "A2"],
    observedRelationships: [{ subject: "A1", predicate: "USES", object: "A2" }],
    inventory: { totalCount: 3, disposedCount: 3 },
    candidateSample: { total: 10, correct: 9 },
    sourceAttribution: { total: 4, valid: 4 }, gaps: { total: 2, honest: 2 },
    replay: { total: 1, equivalent: 1 }, incrementalComparison: { total: 1, equivalent: 1 },
    reviewer: { id: "reviewer" }, implementationAuthorId: "author",
  });
  assert.equal(result.status, "PASSED");
  assert.equal(result.denominators.anchors, 2);
  assert.throws(() => evaluateUnderstanding({
    ...structuredClone({
      projectId: "P", analysisRunId: "R", policy, truthSet: { id: "T", status: "SEALED", anchors: [], requiredRelationships: [], forbiddenRelationships: [] },
      inventory: { totalCount: 0, disposedCount: 0 }, candidateSample: {}, sourceAttribution: {}, gaps: {}, reviewer: { id: "r" },
    }),
    truthSetDigest: "SAME", productionInputDigest: "SAME",
  }), /leakage/);
});

test("evaluation never treats missing denominators as a perfect score", () => {
  const result = evaluateUnderstanding({
    projectId: "P", analysisRunId: "R-ZERO", policy,
    truthSet: {
      id: "TRUTH-ZERO", status: "SEALED", anchors: [{ id: "A1" }, { id: "A2" }],
      requiredRelationships: [{ subject: "A1", predicate: "USES", object: "A2" }],
      forbiddenRelationships: [],
    },
    truthSetDigest: "TRUTH", productionInputDigest: "PRODUCTION",
    observedAnchorIds: ["A1", "A2"],
    observedRelationships: [{ subject: "A1", predicate: "USES", object: "A2" }],
    inventory: { totalCount: 1, disposedCount: 1 },
    candidateSample: {}, sourceAttribution: {}, gaps: {},
    reviewer: { id: "reviewer" }, implementationAuthorId: "author",
  });
  assert.equal(result.status, "NOT_EVALUATED");
  assert.ok(result.missingDenominators.length > 0);
});

test("production reviewed evaluation cannot derive observations or equivalence from the Truth Set", async () => {
  const truthSet = {
    id: "TRUTH-REVIEWED",
    status: "SEALED",
    assessedRelationPredicates: ["USES", "OWNS"],
    anchors: [{ id: "A1", path: "src/a.js" }],
    requiredRelationships: [["A1", "USES", "A1"]],
    forbiddenRelationships: [["A1", "OWNS", "A1"]],
  };
  assert.throws(() => createReviewedUnderstandingEvaluationResolver({
    truthSet,
    reviewerId: "REVIEWER",
  }), /measurement resolver/);
  const resolver = createReviewedUnderstandingEvaluationResolver({
    truthSet,
    reviewerId: "REVIEWER",
    measurementResolver: async () => ({
      analysisRunId: "RUN",
      snapshotManifestId: "SNAPSHOT",
      truthSetVersionId: truthSet.id,
      reviewerId: "REVIEWER",
      independent: true,
      productionInputDigest: "production:WRONG",
      outputDigest: "OUTPUT",
      anchorReviews: [{ anchorId: "A1", artifactId: null, verdict: "MISSING" }],
      candidateReviews: [],
      relationReviews: [
        { relationship: truthSet.requiredRelationships[0], relationId: null, verdict: "MISSING" },
        { relationship: truthSet.forbiddenRelationships[0], relationId: null, verdict: "ABSENT" },
      ],
      gapReviews: [],
      reviewedAt: "2026-08-03T00:00:00.000Z",
    }),
  });
  await assert.rejects(() => resolver({
    job: { id: "RUN", projectId: "P", snapshotManifestId: "SNAPSHOT" },
    inventory: { inventoryDigest: "ACTUAL", artifacts: [] },
    candidateBundle: { candidates: [], gaps: [] },
    reconciliation: { conflicts: [] },
    semanticSurface: { digest: "OUTPUT", relations: [] },
    equivalenceReport: { analysisRunId: "RUN", replay: { equivalent: true }, full: { equivalent: true } },
  }), /not bound to the current production input/);

  const fabricated = createReviewedUnderstandingEvaluationResolver({
    truthSet,
    reviewerId: "REVIEWER",
    measurementResolver: async () => ({
      analysisRunId: "RUN",
      snapshotManifestId: "SNAPSHOT",
      truthSetVersionId: truthSet.id,
      reviewerId: "REVIEWER",
      independent: true,
      productionInputDigest: "production:ACTUAL",
      outputDigest: "OUTPUT",
      anchorReviews: [{ anchorId: "A1", artifactId: "ARTIFACT-A", verdict: "OBSERVED" }],
      candidateReviews: [{ candidateId: "NONEXISTENT", verdict: "CORRECT", evidenceRefIds: ["FACT-X"] }],
      relationReviews: [
        { relationship: truthSet.requiredRelationships[0], relationId: null, verdict: "MISSING" },
        { relationship: truthSet.forbiddenRelationships[0], relationId: null, verdict: "ABSENT" },
      ],
      gapReviews: [],
      reviewedAt: "2026-08-03T00:00:00.000Z",
    }),
  });
  await assert.rejects(() => fabricated({
    job: { id: "RUN", projectId: "P", snapshotManifestId: "SNAPSHOT" },
    inventory: { inventoryDigest: "ACTUAL", artifacts: [{ id: "ARTIFACT-A", relativePath: "src/a.js" }] },
    candidateBundle: { candidates: [], gaps: [] },
    reconciliation: { conflicts: [], relations: [] },
    semanticSurface: { digest: "OUTPUT", relations: [] },
    equivalenceReport: { analysisRunId: "RUN", replay: { equivalent: true }, full: { equivalent: true } },
  }), /NONEXISTENT.*absent from the persisted output/);
});
