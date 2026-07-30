import { contentId, deepFreeze } from "../domain/index.js";

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function evaluateUnderstanding(input, clock = () => new Date()) {
  if (input.productionInputDigest === input.truthSetDigest) {
    throw new TypeError("Truth Set leakage detected in production input");
  }
  const truth = input.truthSet;
  if (!truth || truth.status !== "SEALED") throw new TypeError("a sealed TruthSetVersion is required");
  if (input.policy.reviewerRequired && (!input.reviewer || input.reviewer.id === input.implementationAuthorId)) {
    throw new TypeError("an independent reviewer is required");
  }
  const observedAnchorIds = new Set(input.observedAnchorIds ?? []);
  const observedRelationships = new Set((input.observedRelationships ?? []).map((edge) => JSON.stringify(edge)));
  const required = truth.requiredRelationships ?? [];
  const forbidden = truth.forbiddenRelationships ?? [];
  const metrics = {
    inventoryDispositionRate: ratio(input.inventory.disposedCount, input.inventory.totalCount),
    anchorRecall: ratio((truth.anchors ?? []).filter(({ id }) => observedAnchorIds.has(id)).length, (truth.anchors ?? []).length),
    candidatePrecision: ratio(input.candidateSample?.correct ?? 0, input.candidateSample?.total ?? 0),
    requiredRelationshipRate: ratio(required.filter((edge) => observedRelationships.has(JSON.stringify(edge))).length, required.length),
    forbiddenRelationshipViolations: ratio(
      forbidden.filter((edge) => observedRelationships.has(JSON.stringify(edge))).length,
      Math.max(forbidden.length, 1),
    ),
    sourceAttributionRate: ratio(input.sourceAttribution?.valid ?? 0, input.sourceAttribution?.total ?? 0),
    gapHonestyRate: ratio(input.gaps?.honest ?? 0, input.gaps?.total ?? 0),
    replayEquivalenceRate: input.replayEquivalenceRate ?? 1,
    incrementalEquivalenceRate: input.incrementalEquivalenceRate ?? 1,
  };
  const failures = [];
  for (const [dimension, threshold] of Object.entries(input.policy.thresholds)) {
    const value = metrics[dimension];
    if (dimension === "forbiddenRelationshipViolations" ? value > threshold : value < threshold) {
      failures.push({ dimension, value, threshold });
    }
  }
  if ((truth.anchors?.length ?? 0) < input.policy.minimumAnchors) {
    failures.push({ dimension: "anchorDenominator", value: truth.anchors?.length ?? 0, threshold: input.policy.minimumAnchors });
  }
  if (required.length < input.policy.minimumRequiredRelationships) {
    failures.push({ dimension: "requiredRelationshipDenominator", value: required.length, threshold: input.policy.minimumRequiredRelationships });
  }
  const identity = {
    projectId: input.projectId,
    analysisRunId: input.analysisRunId,
    truthSetVersionId: truth.id,
    policyId: input.policy.id,
    metrics,
    failures,
  };
  return deepFreeze({
    id: contentId("EVALUATION-RUN", identity),
    ...identity,
    denominators: {
      inventory: input.inventory.totalCount,
      anchors: truth.anchors?.length ?? 0,
      candidateSample: input.candidateSample?.total ?? 0,
      requiredRelationships: required.length,
      forbiddenRelationships: forbidden.length,
      sourceAttributions: input.sourceAttribution?.total ?? 0,
      gaps: input.gaps?.total ?? 0,
    },
    status: failures.length === 0 ? "PASSED" : "FAILED",
    reviewer: structuredClone(input.reviewer),
    completedAt: clock().toISOString(),
  });
}
