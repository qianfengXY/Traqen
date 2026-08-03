import { canonicalJson, contentId, deepFreeze } from "../domain/index.js";

function truthRelationKey(relation) {
  if (Array.isArray(relation) && relation.length === 3) return canonicalJson(relation);
  if (relation && typeof relation === "object") {
    return canonicalJson([relation.subject, relation.predicate, relation.object]);
  }
  throw new TypeError("Truth Set relationships must be triples");
}

function truthRelationParts(relation) {
  const [sourceAnchorId, predicate, targetAnchorId] = JSON.parse(truthRelationKey(relation));
  return { sourceAnchorId, predicate, targetAnchorId };
}

export function validateReviewedTruthSet(truthSet) {
  if (!truthSet || truthSet.status !== "SEALED") throw new TypeError("a sealed reviewed TruthSetVersion is required");
  if (!Array.isArray(truthSet.assessedRelationPredicates)
    || truthSet.assessedRelationPredicates.length === 0
    || truthSet.assessedRelationPredicates.some((predicate) => typeof predicate !== "string" || predicate.trim() === "")
    || new Set(truthSet.assessedRelationPredicates).size !== truthSet.assessedRelationPredicates.length) {
    throw new TypeError("Truth Set assessedRelationPredicates must be a non-empty unique string array");
  }
  const assessedPredicates = new Set(truthSet.assessedRelationPredicates);
  const requiredKeys = new Set();
  const forbiddenKeys = new Set();
  for (const [label, relationships, keys] of [
    ["required", truthSet.requiredRelationships, requiredKeys],
    ["forbidden", truthSet.forbiddenRelationships, forbiddenKeys],
  ]) {
    if (!Array.isArray(relationships)) throw new TypeError(`Truth Set ${label}Relationships must be an array`);
    for (const relationship of relationships) {
      const key = truthRelationKey(relationship);
      const { predicate } = truthRelationParts(relationship);
      if (!assessedPredicates.has(predicate)) {
        throw new TypeError(`Truth Set ${label} predicate ${predicate} is outside the assessed producer vocabulary`);
      }
      if (keys.has(key)) throw new TypeError(`Truth Set ${label}Relationships must be unique`);
      keys.add(key);
    }
  }
  if ([...forbiddenKeys].some((key) => requiredKeys.has(key))) {
    throw new TypeError("Truth Set cannot require and forbid the same relationship");
  }
  return truthSet;
}

function requireUniqueReviews(reviews, keyOf, label) {
  if (!Array.isArray(reviews)) throw new TypeError(`${label} must be an array`);
  const keys = reviews.map(keyOf);
  if (new Set(keys).size !== keys.length) throw new TypeError(`${label} must not contain duplicate subjects`);
  return reviews;
}

function deriveReviewedMeasurements({ truthSet, measurements, inventory, candidateBundle, semanticSurface }) {
  if (measurements.outputDigest !== semanticSurface.digest) {
    throw new TypeError("reviewed measurements are not bound to the exact persisted understanding output");
  }
  const artifactsById = new Map(inventory.artifacts.map((artifact) => [artifact.id, artifact]));
  const anchorsById = new Map(truthSet.anchors.map((anchor) => [anchor.id, anchor]));
  const anchorReviews = requireUniqueReviews(
    measurements.anchorReviews,
    (review) => review.anchorId,
    "anchorReviews",
  );
  if (anchorReviews.length !== anchorsById.size
    || anchorReviews.some(({ anchorId }) => !anchorsById.has(anchorId))) {
    throw new TypeError("anchorReviews must cover the exact reviewed Truth Set anchors");
  }
  const artifactIdByAnchorId = new Map();
  const observedAnchorIds = [];
  for (const review of anchorReviews) {
    if (!["OBSERVED", "MISSING"].includes(review.verdict)) throw new TypeError("anchor review verdict is invalid");
    if (review.verdict === "MISSING") continue;
    const artifact = artifactsById.get(review.artifactId);
    if (!artifact || artifact.relativePath !== anchorsById.get(review.anchorId).path) {
      throw new TypeError(`anchor review ${review.anchorId} does not resolve to the reviewed output artifact`);
    }
    artifactIdByAnchorId.set(review.anchorId, artifact.id);
    observedAnchorIds.push(review.anchorId);
  }

  const candidatesById = new Map(candidateBundle.candidates.map((candidate) => [candidate.id, candidate]));
  const candidateReviews = requireUniqueReviews(
    measurements.candidateReviews,
    (review) => review.candidateId,
    "candidateReviews",
  );
  let correctCandidates = 0;
  let validAttributions = 0;
  for (const review of candidateReviews) {
    const candidate = candidatesById.get(review.candidateId);
    if (!candidate) throw new TypeError(`reviewed Candidate ${review.candidateId} is absent from the persisted output`);
    if (!["CORRECT", "INCORRECT"].includes(review.verdict)) throw new TypeError("Candidate review verdict is invalid");
    const allowedEvidence = new Set([...(candidate.evidenceFactIds ?? []), ...(candidate.sourceSliceIds ?? [])]);
    const evidenceRefIds = review.evidenceRefIds ?? [];
    if (!Array.isArray(evidenceRefIds) || evidenceRefIds.length === 0
      || evidenceRefIds.some((id) => !allowedEvidence.has(id))) {
      throw new TypeError(`reviewed Candidate ${review.candidateId} has no valid persisted evidence reference`);
    }
    if (review.verdict === "CORRECT") correctCandidates += 1;
    validAttributions += 1;
  }

  const relationsById = new Map((semanticSurface.relations ?? []).map((relation) => [relation.id, relation]));
  const relationReviews = requireUniqueReviews(
    measurements.relationReviews,
    (review) => truthRelationKey(review.relationship),
    "relationReviews",
  );
  const requiredKeys = new Set((truthSet.requiredRelationships ?? []).map(truthRelationKey));
  const forbiddenKeys = new Set((truthSet.forbiddenRelationships ?? []).map(truthRelationKey));
  const expectedRelationKeys = new Set([...requiredKeys, ...forbiddenKeys]);
  if (relationReviews.length !== expectedRelationKeys.size
    || relationReviews.some((review) => !expectedRelationKeys.has(truthRelationKey(review.relationship)))) {
    throw new TypeError("relationReviews must cover every required and forbidden Truth Set relationship exactly once");
  }
  const observedRelationships = [];
  for (const review of relationReviews) {
    const key = truthRelationKey(review.relationship);
    const { sourceAnchorId, predicate, targetAnchorId } = truthRelationParts(review.relationship);
    const matching = [...relationsById.values()].find((relation) =>
      relation.sourceId === artifactIdByAnchorId.get(sourceAnchorId)
      && relation.predicate === predicate
      && relation.targetId === artifactIdByAnchorId.get(targetAnchorId));
    if (requiredKeys.has(key)) {
      if (!["OBSERVED", "MISSING"].includes(review.verdict)) throw new TypeError("required relation verdict is invalid");
      if (review.verdict === "OBSERVED") {
        if (!matching || review.relationId !== matching.id) {
          throw new TypeError(`reviewed relationship ${key} is absent from the persisted output`);
        }
        observedRelationships.push(review.relationship);
      }
    } else {
      if (!["ABSENT", "VIOLATION"].includes(review.verdict)) throw new TypeError("forbidden relation verdict is invalid");
      if (review.verdict === "ABSENT" && matching) {
        throw new TypeError(`forbidden relationship ${key} exists in the persisted output`);
      }
      if (review.verdict === "VIOLATION") {
        if (!matching || review.relationId !== matching.id) {
          throw new TypeError(`forbidden relationship violation ${key} is not output-bound`);
        }
        observedRelationships.push(review.relationship);
      }
    }
  }

  const gapsById = new Map(candidateBundle.gaps.map((gap) => [gap.id, gap]));
  const gapReviews = requireUniqueReviews(measurements.gapReviews, (review) => review.gapId, "gapReviews");
  let honestGaps = 0;
  for (const review of gapReviews) {
    if (!gapsById.has(review.gapId)) throw new TypeError(`reviewed Gap ${review.gapId} is absent from the persisted output`);
    if (!["HONEST", "DISHONEST"].includes(review.verdict)) throw new TypeError("Gap review verdict is invalid");
    if (review.verdict === "HONEST") honestGaps += 1;
  }
  return {
    observedAnchorIds,
    observedRelationships,
    candidateSample: { total: candidateReviews.length, correct: correctCandidates },
    sourceAttribution: { total: candidateReviews.length, valid: validAttributions },
    gaps: { total: gapReviews.length, honest: honestGaps },
  };
}

export function createReviewedUnderstandingEvaluationResolver({
  truthSet,
  reviewerId,
  implementationAuthorId = "TRAQEN-RUNTIME",
  measurementResolver,
}) {
  validateReviewedTruthSet(truthSet);
  if (typeof reviewerId !== "string" || reviewerId.trim() === "") throw new TypeError("reviewerId is required");
  if (reviewerId === implementationAuthorId) throw new TypeError("reviewer must be independent from the implementation author");
  if (typeof measurementResolver !== "function") {
    throw new TypeError("an independently controlled reviewed measurement resolver is required");
  }
  return async ({ job, inventory, candidateBundle, reconciliation, semanticSurface, equivalenceReport }) => {
    const measurements = await measurementResolver({
      job: structuredClone(job),
      inventory: structuredClone(inventory),
      candidateBundle: structuredClone(candidateBundle),
      reconciliation: structuredClone(reconciliation),
      semanticSurface: structuredClone(semanticSurface),
    });
    if (!measurements || measurements.truthSetVersionId !== truthSet.id) {
      throw new TypeError("reviewed measurements must identify the exact TruthSetVersion");
    }
    if (measurements.analysisRunId !== job.id || measurements.snapshotManifestId !== job.snapshotManifestId) {
      throw new TypeError("reviewed measurements must identify the exact AnalysisRun and Snapshot");
    }
    if (measurements.reviewerId !== reviewerId || measurements.independent !== true) {
      throw new TypeError("reviewed measurements must be approved by the configured independent reviewer");
    }
    if (typeof measurements.reviewedAt !== "string" || !Number.isFinite(Date.parse(measurements.reviewedAt))) {
      throw new TypeError("reviewed measurements require a valid reviewedAt timestamp");
    }
    if (measurements.productionInputDigest !== `production:${inventory.inventoryDigest}`) {
      throw new TypeError("reviewed measurements are not bound to the current production input");
    }
    if (!equivalenceReport || equivalenceReport.analysisRunId !== job.id) {
      throw new TypeError("server-measured equivalence report is required");
    }
    const derived = deriveReviewedMeasurements({
      truthSet,
      measurements,
      inventory,
      candidateBundle,
      semanticSurface,
    });
    const reviewedMeasurement = deepFreeze({
      id: contentId("REVIEWED-UNDERSTANDING-MEASUREMENT", {
        analysisRunId: job.id,
        reviewerId,
        outputDigest: semanticSurface.digest,
        measurements,
      }),
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      truthSetVersionId: truthSet.id,
      reviewerId,
      independent: true,
      productionInputDigest: measurements.productionInputDigest,
      outputDigest: semanticSurface.digest,
      anchorReviews: structuredClone(measurements.anchorReviews),
      candidateReviews: structuredClone(measurements.candidateReviews),
      relationReviews: structuredClone(measurements.relationReviews),
      gapReviews: structuredClone(measurements.gapReviews),
      reviewedAt: measurements.reviewedAt,
      createdAt: measurements.reviewedAt,
    });
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
          requiredRelationshipRate: 1,
          forbiddenRelationshipViolations: 0,
          sourceAttributionRate: 0.9,
          gapHonestyRate: 1,
          replayEquivalenceRate: 1,
          incrementalEquivalenceRate: 1,
        },
      },
      reviewer: { id: reviewerId, independent: true },
      implementationAuthorId,
      ...derived,
      replay: { total: 1, equivalent: equivalenceReport.replay.equivalent ? 1 : 0 },
      incrementalComparison: { total: 1, equivalent: equivalenceReport.full.equivalent ? 1 : 0 },
      reviewedMeasurement,
    };
  };
}
