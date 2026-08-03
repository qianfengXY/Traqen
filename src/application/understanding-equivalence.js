import { canonicalJson, contentId, deepFreeze } from "../domain/index.js";

function semanticFact(fact, artifactPathById) {
  const {
    id: _id,
    sourceSpan: _sourceSpan,
    artifactId,
    ...content
  } = fact;
  return { ...content, artifactPath: artifactPathById.get(artifactId) ?? null };
}

export function createUnderstandingSemanticSurface({ inventory, factBundle, candidateBundle, reconciliation }) {
  const artifactPathById = new Map(inventory.artifacts.map(({ id, relativePath }) => [id, relativePath]));
  const content = {
    artifacts: inventory.artifacts.map(({ relativePath, contentDigest, disposition, artifactKinds }) => ({
      relativePath,
      contentDigest,
      disposition,
      artifactKinds: [...artifactKinds].sort(),
    })).sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    facts: factBundle.facts.map((fact) => semanticFact(fact, artifactPathById))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    candidates: candidateBundle.candidates.map((candidate) => ({
      subjectKey: candidate.subjectKey,
      kind: candidate.kind,
      proposal: candidate.proposal,
      confidence: candidate.confidence,
      evidenceFactIds: [...candidate.evidenceFactIds].sort(),
      sourceSliceEvidence: candidate.sourceSliceIds.length > 0,
    })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    conflicts: (reconciliation.conflicts ?? []).map(({ type, candidateIds = [], reason = null }) => ({
      type,
      candidateIds: [...candidateIds].sort(),
      reason,
    })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    gaps: candidateBundle.gaps.map(({ code, workUnitId, details = null }) => ({ code, workUnitId, details }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    relations: (reconciliation.relations ?? []).map((relation) => ({
      id: relation.id,
      sourceId: relation.sourceId,
      predicate: relation.predicate,
      targetId: relation.targetId,
      evidenceFactIds: [...(relation.evidenceFactIds ?? [])].sort(),
      sourceSliceIds: [...(relation.sourceSliceIds ?? [])].sort(),
    })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  };
  return deepFreeze({
    digest: contentId("UNDERSTANDING-SEMANTIC-SURFACE", canonicalJson(content)),
    ...content,
  });
}

async function verifiedComparison(label, currentSurface, runId, job, store) {
  if (typeof runId !== "string" || runId === "" || runId === job.id) {
    throw new TypeError(`${label} equivalence evidence must identify an independent analysis run`);
  }
  const run = await store.getUnderstandingRecord(job.projectId, "INDEPENDENT_ANALYSIS_RUN", runId);
  if (!run || run.status !== "COMPLETED" || run.id !== runId) {
    throw new TypeError(`${label} equivalence evidence must resolve to a persisted terminal independent run`);
  }
  if (run.snapshotManifestId !== job.snapshotManifestId || run.policyDigest !== job.policyDigest
    || run.workspaceExecutionProfileRevisionId !== job.workspaceExecutionProfileRevisionId) {
    throw new TypeError(`${label} equivalence run is not bound to the current Snapshot, policy, and profile`);
  }
  if (run.authorId === job.implementationAuthorId || run.runnerId === job.runnerId) {
    throw new TypeError(`${label} equivalence run is not author and runner independent`);
  }
  if (label === "full" && run.mode !== "FULL") {
    throw new TypeError("incremental equivalence evidence must be produced by an independent FULL run");
  }
  if (label === "replay" && run.mode !== job.resolvedMode) {
    throw new TypeError("replay equivalence evidence must use the current analysis mode");
  }
  const storedSurface = await store.getUnderstandingRecord(
    job.projectId,
    "UNDERSTANDING_SEMANTIC_SURFACE",
    run.surfaceRecordId,
  );
  if (!storedSurface || storedSurface.analysisRunId !== run.id || storedSurface.digest !== run.surfaceDigest) {
    throw new TypeError(`${label} equivalence run does not resolve to its immutable stored surface`);
  }
  const {
    id: _id,
    projectId: _projectId,
    snapshotManifestId: _snapshotManifestId,
    analysisRunId: _analysisRunId,
    createdAt: _createdAt,
    digest,
    ...surfaceContent
  } = storedSurface;
  if (digest !== contentId("UNDERSTANDING-SEMANTIC-SURFACE", canonicalJson(surfaceContent))) {
    throw new TypeError(`${label} stored equivalence surface digest is invalid`);
  }
  const equivalent = canonicalJson(currentSurface) === canonicalJson({ digest, ...surfaceContent });
  return {
    analysisRunId: run.id,
    mode: run.mode,
    producer: { authorId: run.authorId, runnerId: run.runnerId },
    surfaceDigest: storedSurface.digest,
    equivalent,
  };
}

export function createStoredUnderstandingSurface({ job, surface }, clock = () => new Date()) {
  return deepFreeze({
    id: contentId("UNDERSTANDING-SEMANTIC-SURFACE-RECORD", {
      projectId: job.projectId,
      analysisRunId: job.id,
      digest: surface.digest,
    }),
    projectId: job.projectId,
    snapshotManifestId: job.snapshotManifestId,
    analysisRunId: job.id,
    ...structuredClone(surface),
    createdAt: clock().toISOString(),
  });
}

export function createIndependentAnalysisRun(input, clock = () => new Date()) {
  if (input.status !== "COMPLETED") throw new TypeError("independent analysis run must be terminal COMPLETED");
  for (const field of ["id", "projectId", "snapshotManifestId", "policyDigest", "workspaceExecutionProfileRevisionId", "surfaceRecordId", "surfaceDigest", "authorId", "runnerId"]) {
    if (typeof input[field] !== "string" || input[field] === "") throw new TypeError(`${field} is required`);
  }
  if (!["FULL", "INCREMENTAL"].includes(input.mode)) throw new TypeError("independent analysis run mode is invalid");
  return deepFreeze({
    id: input.id,
    projectId: input.projectId,
    snapshotManifestId: input.snapshotManifestId,
    policyDigest: input.policyDigest,
    workspaceExecutionProfileRevisionId: input.workspaceExecutionProfileRevisionId,
    mode: input.mode,
    status: "COMPLETED",
    surfaceRecordId: input.surfaceRecordId,
    surfaceDigest: input.surfaceDigest,
    authorId: input.authorId,
    runnerId: input.runnerId,
    completedAt: input.completedAt ?? clock().toISOString(),
    createdAt: input.createdAt ?? clock().toISOString(),
  });
}

export async function measureUnderstandingEquivalence({ job, surface, resolver, store, clock = () => new Date() }) {
  if (!store) throw new TypeError("equivalence measurement store is required");
  if (typeof resolver !== "function") {
    throw new TypeError("Publication requires independent replay and FULL equivalence evidence");
  }
  const evidence = await resolver({ job: deepFreeze(structuredClone(job)), surface, store });
  const replay = await verifiedComparison("replay", surface, evidence?.replayAnalysisRunId, job, store);
  const full = await verifiedComparison("full", surface, evidence?.fullAnalysisRunId, job, store);
  const report = {
    id: contentId("UNDERSTANDING-EQUIVALENCE-REPORT", {
      projectId: job.projectId,
      analysisRunId: job.id,
      surfaceDigest: surface.digest,
      replay,
      full,
    }),
    projectId: job.projectId,
    snapshotManifestId: job.snapshotManifestId,
    analysisRunId: job.id,
    mode: job.resolvedMode,
    policyDigest: job.policyDigest,
    surfaceDigest: surface.digest,
    replay,
    full,
    status: replay.equivalent && full.equivalent ? "PASSED" : "FAILED",
    completedAt: clock().toISOString(),
  };
  return deepFreeze(report);
}
