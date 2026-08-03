export async function deterministicFixtureChildProducer({ candidate }) {
  return {
    candidates: [{
      name: candidate.proposal.name,
      statement: candidate.proposal.statement,
      confidence: candidate.confidence,
    }],
  };
}

export function fixtureReviewedEvaluationResolver(expectedPath) {
  const truthSet = {
    id: `FIXTURE-TRUTH-${expectedPath}`,
    status: "SEALED",
    anchors: [{ id: "EXPECTED-ANCHOR", path: expectedPath }],
    requiredRelationships: [["EXPECTED-ANCHOR", "IMPLEMENTED_BY", "EXPECTED-ANCHOR"]],
    forbiddenRelationships: [["FORBIDDEN-A", "IMPLEMENTS", "FORBIDDEN-B"]],
  };
  return async ({ inventory, candidateBundle }) => {
    const observed = inventory.artifacts.some(({ relativePath }) => relativePath === expectedPath);
    const attributed = candidateBundle.candidates.some((candidate) =>
      candidate.evidenceFactIds.length + candidate.sourceSliceIds.length > 0);
    return {
      productionInputDigest: `production:${inventory.inventoryDigest}`,
      truthSetDigest: `reviewed:${truthSet.id}`,
      truthSet,
      policy: {
        id: "fixture-reviewed-policy",
        version: "1",
        reviewerRequired: true,
        minimumDenominators: {
          inventory: 1,
          anchors: 1,
          candidateSample: 1,
          requiredRelationships: 1,
          forbiddenRelationships: 1,
          sourceAttributions: 1,
          gaps: 1,
          replaySamples: 1,
          incrementalComparisons: 1,
        },
        thresholds: {
          inventoryDispositionRate: 1,
          anchorRecall: 1,
          candidatePrecision: 1,
          requiredRelationshipRate: 1,
          forbiddenRelationshipViolations: 0,
          sourceAttributionRate: 1,
          gapHonestyRate: 1,
          replayEquivalenceRate: 1,
          incrementalEquivalenceRate: 1,
        },
      },
      reviewer: { id: "FIXTURE-INDEPENDENT-REVIEWER", independent: true },
      implementationAuthorId: "TRAQEN-RUNTIME",
      observedAnchorIds: observed ? ["EXPECTED-ANCHOR"] : [],
      observedRelationships: observed ? truthSet.requiredRelationships : [],
      candidateSample: { total: 1, correct: attributed ? 1 : 0 },
      sourceAttribution: { total: 1, valid: attributed ? 1 : 0 },
      gaps: { total: 1, honest: 1 },
      replay: { total: 1, equivalent: 1 },
      incrementalComparison: { total: 1, equivalent: 1 },
    };
  };
}
