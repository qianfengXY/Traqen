export function createReviewedUnderstandingEvaluationResolver({
  truthSet,
  reviewerId,
  implementationAuthorId = "TRAQEN-RUNTIME",
  measurementResolver,
}) {
  if (!truthSet || truthSet.status !== "SEALED") throw new TypeError("a sealed reviewed TruthSetVersion is required");
  if (typeof reviewerId !== "string" || reviewerId.trim() === "") throw new TypeError("reviewerId is required");
  if (reviewerId === implementationAuthorId) throw new TypeError("reviewer must be independent from the implementation author");
  if (typeof measurementResolver !== "function") {
    throw new TypeError("an independently controlled reviewed measurement resolver is required");
  }
  return async ({ job, inventory, candidateBundle, reconciliation, equivalenceReport }) => {
    const measurements = await measurementResolver({
      job: structuredClone(job),
      inventory: structuredClone(inventory),
      candidateBundle: structuredClone(candidateBundle),
      reconciliation: structuredClone(reconciliation),
    });
    if (!measurements || measurements.truthSetVersionId !== truthSet.id) {
      throw new TypeError("reviewed measurements must identify the exact TruthSetVersion");
    }
    if (measurements.reviewerId !== reviewerId || measurements.independent !== true) {
      throw new TypeError("reviewed measurements must be approved by the configured independent reviewer");
    }
    if (measurements.productionInputDigest !== `production:${inventory.inventoryDigest}`) {
      throw new TypeError("reviewed measurements are not bound to the current production input");
    }
    if (!equivalenceReport || equivalenceReport.analysisRunId !== job.id) {
      throw new TypeError("server-measured equivalence report is required");
    }
    return {
      productionInputDigest: `production:${inventory.inventoryDigest}`,
      truthSetDigest: `reviewed:${truthSet.id}`,
      truthSet,
      policy: {
        id: "traqen-reviewed-understanding-release-gate",
        version: "1",
        reviewerRequired: true,
        minimumDenominators: {
          inventory: 1,
          anchors: 30,
          candidateSample: 30,
          requiredRelationships: 60,
          forbiddenRelationships: 30,
          sourceAttributions: 30,
          gaps: 1,
          replaySamples: 1,
          incrementalComparisons: 1,
        },
        thresholds: {
          inventoryDispositionRate: 1,
          anchorRecall: 0.9,
          candidatePrecision: 0.9,
          requiredRelationshipRate: 0.9,
          forbiddenRelationshipViolations: 0,
          sourceAttributionRate: 0.9,
          gapHonestyRate: 1,
          replayEquivalenceRate: 1,
          incrementalEquivalenceRate: 1,
        },
      },
      reviewer: { id: reviewerId, independent: true },
      implementationAuthorId,
      observedAnchorIds: structuredClone(measurements.observedAnchorIds ?? []),
      observedRelationships: structuredClone(measurements.observedRelationships ?? []),
      candidateSample: structuredClone(measurements.candidateSample ?? {}),
      sourceAttribution: structuredClone(measurements.sourceAttribution ?? {}),
      gaps: structuredClone(measurements.gaps ?? {}),
      replay: { total: 1, equivalent: equivalenceReport.replay.equivalent ? 1 : 0 },
      incrementalComparison: { total: 1, equivalent: equivalenceReport.full.equivalent ? 1 : 0 },
    };
  };
}
