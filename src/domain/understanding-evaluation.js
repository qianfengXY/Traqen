import { contentId, deepFreeze } from "./canonical-json.js";

export const EvaluationStatus = Object.freeze({
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  NOT_EVALUATED: "NOT_EVALUATED",
  PASSED: "PASSED",
  FAILED: "FAILED",
});

export const EvaluationDenominator = Object.freeze({
  inventory: "inventory",
  anchors: "anchors",
  candidateSample: "candidateSample",
  requiredRelationships: "requiredRelationships",
  forbiddenRelationships: "forbiddenRelationships",
  sourceAttributions: "sourceAttributions",
  gaps: "gaps",
  replaySamples: "replaySamples",
  incrementalComparisons: "incrementalComparisons",
});

export function createEvaluationPolicy(input) {
  const dimensions = [
    "inventoryDispositionRate",
    "anchorRecall",
    "candidatePrecision",
    "requiredRelationshipRate",
    "forbiddenRelationshipViolations",
    "sourceAttributionRate",
    "gapHonestyRate",
    "replayEquivalenceRate",
    "incrementalEquivalenceRate",
  ];
  const thresholds = {};
  for (const dimension of dimensions) {
    const value = input.thresholds?.[dimension];
    if (typeof value !== "number" || value < 0 || value > 1) throw new TypeError(`thresholds.${dimension} must be between 0 and 1`);
    thresholds[dimension] = value;
  }
  const minimumDenominators = {};
  for (const denominator of Object.values(EvaluationDenominator)) {
    const value = input.minimumDenominators?.[denominator];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`minimumDenominators.${denominator} must be a positive integer`);
    }
    minimumDenominators[denominator] = value;
  }
  return deepFreeze({
    id: input.id ?? contentId("EVALUATION-POLICY", { version: input.version, thresholds, minimumDenominators }),
    version: input.version,
    thresholds,
    minimumDenominators,
    reviewerRequired: input.reviewerRequired !== false,
  });
}

export function assertEvaluationPublicationReady(evaluation) {
  if (!evaluation || evaluation.status !== EvaluationStatus.PASSED) {
    throw new TypeError("GraphRevision evaluation must be PASSED");
  }
  if (typeof evaluation.policyVersion !== "string" || evaluation.policyVersion.length === 0) {
    throw new TypeError("GraphRevision evaluation policyVersion is required");
  }
  const required = evaluation.minimumDenominators;
  const actual = evaluation.denominators;
  for (const denominator of Object.values(EvaluationDenominator)) {
    if (!Number.isSafeInteger(required?.[denominator]) || required[denominator] < 1) {
      throw new TypeError(`GraphRevision evaluation minimumDenominators.${denominator} is incomplete`);
    }
    if (!Number.isSafeInteger(actual?.[denominator]) || actual[denominator] < required[denominator]) {
      throw new TypeError(`GraphRevision evaluation denominator ${denominator} is incomplete`);
    }
  }
  return true;
}
