import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluationPolicy } from "../src/domain/index.js";
import { evaluateUnderstanding } from "../src/application/understanding-evaluator.js";

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
