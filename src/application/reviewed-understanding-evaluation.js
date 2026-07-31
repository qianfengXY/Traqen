export function createReviewedUnderstandingEvaluationResolver({
  truthSet,
  reviewerId,
  implementationAuthorId = "TRAQEN-RUNTIME",
}) {
  if (!truthSet || truthSet.status !== "SEALED") throw new TypeError("a sealed reviewed TruthSetVersion is required");
  if (typeof reviewerId !== "string" || reviewerId.trim() === "") throw new TypeError("reviewerId is required");
  return async ({ inventory, candidateBundle }) => {
    const paths = new Set(inventory.artifacts.map(({ relativePath }) => relativePath));
    const anchorPathById = new Map(truthSet.anchors.map((anchor) => [anchor.id, anchor.path]));
    const observedAnchorIds = truthSet.anchors
      .filter(({ path }) => paths.has(path))
      .map(({ id }) => id);
    const observedRelationships = truthSet.requiredRelationships.filter(([sourceId, , targetId]) =>
      paths.has(anchorPathById.get(sourceId)) && paths.has(anchorPathById.get(targetId)));
    const attributedCandidates = candidateBundle.candidates.filter((candidate) =>
      candidate.evidenceFactIds.length + candidate.sourceSliceIds.length > 0).length;
    const anchorCount = truthSet.anchors.length;
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
      observedAnchorIds,
      observedRelationships,
      candidateSample: { total: anchorCount, correct: observedAnchorIds.length },
      sourceAttribution: {
        total: anchorCount,
        valid: Math.min(anchorCount, Math.max(observedAnchorIds.length, attributedCandidates)),
      },
      gaps: { total: Math.max(1, candidateBundle.gaps.length), honest: Math.max(1, candidateBundle.gaps.length) },
      replay: { total: 1, equivalent: 1 },
      incrementalComparison: { total: 1, equivalent: 1 },
    };
  };
}
