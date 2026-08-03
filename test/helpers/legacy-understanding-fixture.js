export async function deterministicFixtureChildProducer({ candidate }) {
  return {
    candidates: [{
      name: candidate.proposal.name,
      statement: candidate.proposal.statement,
      confidence: candidate.confidence,
    }],
  };
}

export async function fixtureEquivalenceResolver({ job, surface }) {
  const producer = { id: "FIXTURE-INDEPENDENT-ANALYZER", version: "1" };
  return {
    replay: {
      analysisRunId: `${job.id}:INDEPENDENT-REPLAY`,
      snapshotManifestId: job.snapshotManifestId,
      policyDigest: job.policyDigest,
      mode: job.resolvedMode,
      independent: true,
      producer,
      surface: structuredClone(surface),
    },
    full: {
      analysisRunId: `${job.id}:INDEPENDENT-FULL`,
      snapshotManifestId: job.snapshotManifestId,
      policyDigest: job.policyDigest,
      mode: "FULL",
      independent: true,
      producer,
      surface: structuredClone(surface),
    },
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
  return async ({ inventory, candidateBundle, equivalenceReport }) => {
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
      replay: { total: 1, equivalent: equivalenceReport.replay.equivalent ? 1 : 0 },
      incrementalComparison: { total: 1, equivalent: equivalenceReport.full.equivalent ? 1 : 0 },
    };
  };
}

export function fixtureReviewedMeasurementResolver(reviewerId, truthSet) {
  return async ({ inventory, candidateBundle }) => {
    const paths = new Set(inventory.artifacts.map(({ relativePath }) => relativePath));
    const observedAnchorIds = truthSet.anchors.filter(({ path }) => paths.has(path)).map(({ id }) => id);
    return {
      truthSetVersionId: truthSet.id,
      reviewerId,
      independent: true,
      productionInputDigest: `production:${inventory.inventoryDigest}`,
      observedAnchorIds,
      observedRelationships: truthSet.requiredRelationships.filter(([sourceId, , targetId]) =>
        observedAnchorIds.includes(sourceId) && observedAnchorIds.includes(targetId)),
      candidateSample: { total: truthSet.anchors.length, correct: observedAnchorIds.length },
      sourceAttribution: { total: truthSet.anchors.length, valid: observedAnchorIds.length },
      gaps: { total: Math.max(1, candidateBundle.gaps.length), honest: Math.max(1, candidateBundle.gaps.length) },
    };
  };
}
