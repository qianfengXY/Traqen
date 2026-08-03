export async function deterministicFixtureChildProducer({ candidate }) {
  return {
    candidates: [{
      name: candidate.proposal.name,
      statement: candidate.proposal.statement,
      confidence: candidate.confidence,
    }],
  };
}

export async function persistFixtureExecutionProfile(
  store,
  projectId,
  id = "LOCAL-DETERMINISTIC-PROFILE",
) {
  const profile = {
    id,
    workspaceId: projectId,
    configId: `${id}-CONFIG`,
    configVersion: 1,
    profileDigest: `${id}-DIGEST`,
    mainAgent: { model: id, skillNames: [], mcpNames: [] },
    childSlots: [
      { id: "CHILD-1", model: id, skillNames: [], mcpNames: [], independenceGroup: "FIXTURE-1" },
      { id: "CHILD-2", model: id, skillNames: [], mcpNames: [], independenceGroup: "FIXTURE-2" },
    ],
    entries: [{ logicalName: id, kind: "MODEL", manifest: { provider: "FIXTURE" }, sourceTemplateId: null, credentialHandleIds: [] }],
    dependencies: {},
    conventions: {},
    policies: { dataBoundary: "TEST_ONLY" },
    createdAt: new Date().toISOString(),
  };
  await store.appendUnderstandingRecord(projectId, "WORKSPACE_EXECUTION_PROFILE", profile);
  return profile;
}

export function fixtureReviewedSeedChildProducer(seedGraph) {
  const anchorPaths = new Set(seedGraph.anchors.map(({ path }) => path));
  return async (input) => {
    const candidates = input.scopedArtifacts
      .filter(({ relativePath }) => anchorPaths.has(relativePath))
      .filter((artifact) => input.facts.some(({ artifactId }) => artifactId === artifact.id))
      .map((artifact) => ({
        name: artifact.relativePath,
        subjectKey: artifact.relativePath,
        statement: `Observed reviewed capability anchor in ${artifact.relativePath}`,
        confidence: "LOW",
      }));
    return candidates.length > 0 ? { candidates } : deterministicFixtureChildProducer(input);
  };
}

export async function deterministicFixtureMainProducer({ candidateOptions }) {
  return {
    candidateDecisions: candidateOptions.map(({ ref }) => ({
      candidateRef: ref,
      disposition: "ACCEPT",
      rationale: "The Child Candidate remains evidence-bounded and is retained for human review.",
    })),
    relations: [],
    gaps: [],
  };
}

export function fixtureReviewedSeedMainProducer(seedGraph) {
  return async (input) => {
    const base = await deterministicFixtureMainProducer(input);
    if (input.workUnit.kind !== "PROJECT_SYNTHESIS") return base;
    const artifactByPath = new Map(input.scopedArtifacts.map((artifact) => [artifact.relativePath, artifact]));
    const pathByAnchorId = new Map(seedGraph.anchors.map((anchor) => [anchor.id, anchor.path]));
    const relations = [];
    for (const [sourceAnchorId, predicate, targetAnchorId] of seedGraph.relations) {
      const source = artifactByPath.get(pathByAnchorId.get(sourceAnchorId));
      const target = artifactByPath.get(pathByAnchorId.get(targetAnchorId));
      if (!source || !target) continue;
      const evidence = input.facts.find(({ artifactId }) => artifactId === source.id)
        ?? input.facts.find(({ artifactId }) => artifactId === target.id)
        ?? input.facts[0];
      if (!evidence) continue;
      relations.push({
        sourceArtifactId: source.id,
        predicate,
        targetArtifactId: target.id,
        evidenceFactIds: [evidence.id],
        sourceSliceIds: [],
      });
    }
    return { ...base, relations };
  };
}

export async function persistFixtureIndependentRun({
  store,
  job,
  surface,
  id,
  mode,
  authorId = "FIXTURE-INDEPENDENT-AUTHOR",
  runnerId = "FIXTURE-INDEPENDENT-RUNNER",
}) {
  const independentJob = {
    ...structuredClone(job),
    id,
    resolvedMode: mode,
    implementationAuthorId: authorId,
    runnerId,
  };
  const surfaceRecord = createStoredUnderstandingSurface({ job: independentJob, surface });
  await store.appendUnderstandingRecord(job.projectId, "UNDERSTANDING_SEMANTIC_SURFACE", surfaceRecord);
  const run = createIndependentAnalysisRun({
    id,
    projectId: job.projectId,
    snapshotManifestId: job.snapshotManifestId,
    policyDigest: job.policyDigest,
    workspaceExecutionProfileRevisionId: job.workspaceExecutionProfileRevisionId,
    mode,
    status: "COMPLETED",
    surfaceRecordId: surfaceRecord.id,
    surfaceDigest: surface.digest,
    authorId: independentJob.implementationAuthorId,
    runnerId: independentJob.runnerId,
  });
  await store.appendUnderstandingRecord(job.projectId, "INDEPENDENT_ANALYSIS_RUN", run);
  return run;
}

export async function fixtureEquivalenceResolver({ job, surface, store }) {
  const replay = await persistFixtureIndependentRun({
    store, job, surface, id: `${job.id}:INDEPENDENT-REPLAY`, mode: job.resolvedMode,
  });
  const full = await persistFixtureIndependentRun({
    store, job, surface, id: `${job.id}:INDEPENDENT-FULL`, mode: "FULL",
  });
  return { replayAnalysisRunId: replay.id, fullAnalysisRunId: full.id };
}

export function fixtureReviewedEvaluationResolver(expectedPath) {
  const truthSet = {
    id: `FIXTURE-TRUTH-${expectedPath}`,
    status: "SEALED",
    anchors: [{ id: "EXPECTED-ANCHOR", path: expectedPath }],
    requiredRelationships: [["EXPECTED-ANCHOR", "IMPLEMENTED_BY", "EXPECTED-ANCHOR"]],
    forbiddenRelationships: [["FORBIDDEN-A", "IMPLEMENTS", "FORBIDDEN-B"]],
  };
  return async ({ job, inventory, candidateBundle, semanticSurface, equivalenceReport }) => {
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
      reviewedMeasurement: {
        id: `FIXTURE-REVIEWED-MEASUREMENT-${job.id}`,
        projectId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        analysisRunId: job.id,
        truthSetVersionId: truthSet.id,
        reviewerId: "FIXTURE-INDEPENDENT-REVIEWER",
        independent: true,
        productionInputDigest: `production:${inventory.inventoryDigest}`,
        outputDigest: semanticSurface.digest,
        anchorReviews: [],
        candidateReviews: [],
        relationReviews: [],
        gapReviews: [],
        reviewedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    };
  };
}

export function fixtureReviewedMeasurementResolver(reviewerId, truthSet) {
  return async ({ inventory, candidateBundle, semanticSurface, job }) => {
    const artifactByPath = new Map(inventory.artifacts.map((artifact) => [artifact.relativePath, artifact]));
    const anchorReviews = truthSet.anchors.map((anchor) => {
      const artifact = artifactByPath.get(anchor.path);
      return { anchorId: anchor.id, artifactId: artifact?.id ?? null, verdict: artifact ? "OBSERVED" : "MISSING" };
    });
    const anchorPaths = new Set(truthSet.anchors.map(({ path }) => path));
    const preferredCandidates = candidateBundle.candidates.filter(({ subjectKey }) => anchorPaths.has(subjectKey));
    const remainingCandidates = candidateBundle.candidates.filter(({ id }) =>
      !preferredCandidates.some((candidate) => candidate.id === id));
    const sampledCandidates = [...preferredCandidates, ...remainingCandidates].slice(0, 30);
    const relationsByTriple = new Map((semanticSurface.relations ?? []).map((relation) => {
      const source = inventory.artifacts.find(({ id }) => id === relation.sourceId);
      const target = inventory.artifacts.find(({ id }) => id === relation.targetId);
      return [`${source?.relativePath}\u0000${relation.predicate}\u0000${target?.relativePath}`, relation];
    }));
    const pathByAnchorId = new Map(truthSet.anchors.map(({ id, path }) => [id, path]));
    const requiredKeys = new Set(truthSet.requiredRelationships.map((edge) => JSON.stringify(edge)));
    const relationReviews = [...truthSet.requiredRelationships, ...truthSet.forbiddenRelationships].map((relationship) => {
      const [sourceId, predicate, targetId] = relationship;
      const relation = relationsByTriple.get(`${pathByAnchorId.get(sourceId)}\u0000${predicate}\u0000${pathByAnchorId.get(targetId)}`);
      const required = requiredKeys.has(JSON.stringify(relationship));
      return {
        relationship,
        relationId: relation?.id ?? null,
        verdict: required ? (relation ? "OBSERVED" : "MISSING") : (relation ? "VIOLATION" : "ABSENT"),
      };
    });
    return {
      analysisRunId: job.id,
      snapshotManifestId: job.snapshotManifestId,
      truthSetVersionId: truthSet.id,
      reviewerId,
      independent: true,
      productionInputDigest: `production:${inventory.inventoryDigest}`,
      outputDigest: semanticSurface.digest,
      anchorReviews,
      candidateReviews: sampledCandidates.map((candidate) => ({
        candidateId: candidate.id,
        verdict: anchorPaths.has(candidate.subjectKey) ? "CORRECT" : "INCORRECT",
        evidenceRefIds: [...candidate.evidenceFactIds, ...candidate.sourceSliceIds].slice(0, 1),
      })),
      relationReviews,
      gapReviews: candidateBundle.gaps.map((gap) => ({ gapId: gap.id, verdict: "HONEST" })),
      reviewedAt: new Date().toISOString(),
    };
  };
}
import {
  createIndependentAnalysisRun,
  createStoredUnderstandingSurface,
} from "../../src/application/understanding-equivalence.js";
