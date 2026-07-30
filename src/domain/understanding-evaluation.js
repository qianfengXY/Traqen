import { contentId, deepFreeze } from "./canonical-json.js";

export const EvaluationStatus = Object.freeze({
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  PASSED: "PASSED",
  FAILED: "FAILED",
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
  return deepFreeze({
    id: input.id ?? contentId("EVALUATION-POLICY", { version: input.version, thresholds }),
    version: input.version,
    thresholds,
    minimumAnchors: input.minimumAnchors ?? 0,
    minimumRequiredRelationships: input.minimumRequiredRelationships ?? 0,
    reviewerRequired: input.reviewerRequired !== false,
  });
}
