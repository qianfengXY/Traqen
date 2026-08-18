import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStoredUnderstandingSurface } from "../application/understanding-equivalence.js";
import { MemoryTraceabilityStore } from "../storage/index.js";
import { createConfiguredApplication } from "./application-bootstrap.js";

const DEVELOPMENT_MODEL = "traqen-local-reference-analyzer";

async function developmentChildProducer({ candidate }) {
  return {
    candidates: [{
      name: candidate.proposal.name,
      statement: candidate.proposal.statement,
      confidence: candidate.confidence,
      evidenceFactIds: [...candidate.evidenceFactIds],
      sourceSliceIds: [...candidate.sourceSliceIds],
    }],
  };
}

async function developmentMainProducer({ candidateOptions }) {
  return {
    candidateDecisions: candidateOptions.map(({ ref }) => ({
      candidateRef: ref,
      disposition: "ACCEPT",
      rationale: "Local reference analysis retains evidence-bounded candidates for review.",
    })),
    relations: [],
    gaps: [],
  };
}

async function persistIndependentDevelopmentRun({ store, job, surface, id, mode }) {
  const independentJob = {
    ...structuredClone(job),
    id,
    resolvedMode: mode,
    implementationAuthorId: "TRAQEN-LOCAL-REFERENCE-AUTHOR",
    runnerId: "TRAQEN-LOCAL-REFERENCE-RUNNER",
  };
  const surfaceRecord = createStoredUnderstandingSurface({ job: independentJob, surface });
  await store.appendUnderstandingRecord(job.projectId, "UNDERSTANDING_SEMANTIC_SURFACE", surfaceRecord);
  const completedAt = new Date().toISOString();
  const run = {
    id,
    projectId: job.projectId,
    sourceRegistrationId: job.sourceRegistrationId,
    snapshotManifestId: job.snapshotManifestId,
    policyDigest: job.policyDigest,
    workspaceExecutionProfileRevisionId: job.workspaceExecutionProfileRevisionId,
    requestedMode: mode,
    resolvedMode: mode,
    purpose: "EQUIVALENCE_VERIFICATION",
    status: "COMPLETED",
    phase: "COMPLETED",
    desiredState: "RUNNING",
    version: 9,
    completedPhases: ["SOURCE_SCAN", "FACT_COMMIT", "ANALYSIS", "RECONCILIATION", "EVALUATION", "PROJECTION", "PUBLISHING"],
    outputs: {
      EVALUATION: { status: "VERIFIED", semanticSurfaceRecordId: surfaceRecord.id, surfaceDigest: surface.digest },
      PROJECTION: { verificationOnly: true, semanticSurfaceRecordId: surfaceRecord.id, surfaceDigest: surface.digest },
      PUBLISHING: { verificationOnly: true, published: false, semanticSurfaceRecordId: surfaceRecord.id },
    },
    implementationAuthorId: independentJob.implementationAuthorId,
    runnerId: independentJob.runnerId,
    createdAt: completedAt,
    updatedAt: completedAt,
    completedAt,
  };
  await store.appendUnderstandingRecord(job.projectId, "WORKSPACE_ANALYSIS_JOB", {
    id: `LOCAL-REFERENCE-CHECKPOINT-${id}`,
    jobId: id,
    checkpointSequence: 1,
    projectId: job.projectId,
    snapshotManifestId: job.snapshotManifestId,
    analysisRunId: id,
    artifactIds: [],
    state: run,
    createdAt: completedAt,
  });
  return run;
}

async function developmentEquivalenceResolver({ job, surface, store }) {
  const replay = await persistIndependentDevelopmentRun({
    store,
    job,
    surface,
    id: `${job.id}:LOCAL-REFERENCE-REPLAY`,
    mode: job.resolvedMode,
  });
  const full = await persistIndependentDevelopmentRun({
    store,
    job,
    surface,
    id: `${job.id}:LOCAL-REFERENCE-FULL`,
    mode: "FULL",
  });
  return { replayAnalysisRunId: replay.id, fullAnalysisRunId: full.id };
}

async function developmentReviewedEvaluationResolver({ job, inventory, candidateBundle, semanticSurface, equivalenceReport }) {
  const firstArtifact = inventory.artifacts[0];
  if (!firstArtifact) throw new TypeError("Local reference analysis requires at least one source artifact");
  const truthSet = {
    id: `LOCAL-REFERENCE-TRUTH-${job.snapshotManifestId}`,
    status: "SEALED",
    anchors: [{ id: "LOCAL-REFERENCE-ANCHOR", path: firstArtifact.relativePath }],
    requiredRelationships: [["LOCAL-REFERENCE-ANCHOR", "OBSERVED_AS", "LOCAL-REFERENCE-ANCHOR"]],
    forbiddenRelationships: [["LOCAL-REFERENCE-FORBIDDEN-A", "IMPLEMENTS", "LOCAL-REFERENCE-FORBIDDEN-B"]],
  };
  const attributed = candidateBundle.candidates.some((candidate) =>
    candidate.evidenceFactIds.length + candidate.sourceSliceIds.length > 0);
  const createdAt = new Date().toISOString();
  return {
    productionInputDigest: `local-reference:${inventory.inventoryDigest}`,
    truthSetDigest: `local-reference:${truthSet.id}`,
    truthSet,
    policy: {
      id: "traqen-local-reference-policy",
      version: "1",
      reviewerRequired: false,
      minimumDenominators: {
        inventory: 1, anchors: 1, candidateSample: 1, requiredRelationships: 1,
        forbiddenRelationships: 1, sourceAttributions: 1, gaps: 1,
        replaySamples: 1, incrementalComparisons: 1,
      },
      thresholds: {
        inventoryDispositionRate: 1, anchorRecall: 1, candidatePrecision: 1,
        requiredRelationshipRate: 1, forbiddenRelationshipViolations: 0,
        sourceAttributionRate: 1, gapHonestyRate: 1,
        replayEquivalenceRate: 1, incrementalEquivalenceRate: 1,
      },
    },
    reviewer: {
      id: "TRAQEN-LOCAL-REFERENCE-REVIEWER",
      independent: false,
      evidenceType: "LOCAL_REFERENCE_SYNTHETIC",
    },
    implementationAuthorId: "TRAQEN-LOCAL-DEVELOPMENT-RUNTIME",
    observedAnchorIds: ["LOCAL-REFERENCE-ANCHOR"],
    observedRelationships: truthSet.requiredRelationships,
    candidateSample: { total: 1, correct: attributed ? 1 : 0 },
    sourceAttribution: { total: 1, valid: attributed ? 1 : 0 },
    gaps: { total: 1, honest: 1 },
    replay: { total: 1, equivalent: equivalenceReport.replay.equivalent ? 1 : 0 },
    incrementalComparison: { total: 1, equivalent: equivalenceReport.full.equivalent ? 1 : 0 },
    reviewedMeasurement: {
      id: `LOCAL-REFERENCE-MEASUREMENT-${job.id}`,
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      truthSetVersionId: truthSet.id,
      reviewerId: "TRAQEN-LOCAL-REFERENCE-REVIEWER",
      independent: false,
      evaluationEvidenceType: "LOCAL_REFERENCE_SYNTHETIC",
      productionInputDigest: `local-reference:${inventory.inventoryDigest}`,
      outputDigest: semanticSurface.digest,
      anchorReviews: [], candidateReviews: [], relationReviews: [], gapReviews: [],
      reviewedAt: createdAt,
      createdAt,
    },
  };
}

export async function createIsolatedDevelopmentApplication({
  sourceRoot,
  snapshotRoot = null,
  store = new MemoryTraceabilityStore(),
  env = {},
} = {}) {
  if (typeof sourceRoot !== "string" || sourceRoot.trim() === "") {
    throw new TypeError("sourceRoot is required for isolated development");
  }
  const isolatedSnapshotRoot = snapshotRoot ?? await mkdtemp(path.join(os.tmpdir(), "traqen-development-snapshots-"));
  const developmentUnderstanding = {
    childProducer: developmentChildProducer,
    mainProducer: developmentMainProducer,
    equivalenceResolver: developmentEquivalenceResolver,
    reviewedEvaluationResolver: developmentReviewedEvaluationResolver,
    implementationAuthorId: "TRAQEN-LOCAL-DEVELOPMENT-RUNTIME",
    runnerId: "TRAQEN-LOCAL-DEVELOPMENT-SERVER",
    publicationMetadata: {
      dataClassification: "LOCAL_DEVELOPMENT_REFERENCE_ONLY",
      productionEligible: false,
      evaluationEvidenceType: "LOCAL_REFERENCE_SYNTHETIC",
    },
  };
  const configured = createConfiguredApplication({
    store,
    env: {
      ...env,
      SOURCE_SNAPSHOT_ROOT: isolatedSnapshotRoot,
      TRAQEN_ALLOWED_WORKSPACE_ROOTS: sourceRoot,
      DATA_CLASSIFICATION: "LOCAL_DEVELOPMENT_REFERENCE_ONLY",
    },
    developmentUnderstanding,
  });
  await configured.ready;
  await configured.application.registerCapabilityTemplate({
    kind: "MODEL",
    logicalName: DEVELOPMENT_MODEL,
    revision: 1,
    manifest: {
      provider: "TRAQEN_LOCAL_REFERENCE",
      model: "deterministic-evidence-bounded",
      dataBoundary: "LOCAL_DEVELOPMENT_ONLY",
    },
    credentialHandleIds: [],
  });
  return {
    ...configured,
    development: {
      mode: "ISOLATED_REFERENCE",
      modelName: DEVELOPMENT_MODEL,
      sourceRoot,
      snapshotRoot: isolatedSnapshotRoot,
      productionEligible: false,
    },
  };
}
