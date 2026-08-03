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
      id: candidate.id,
      subjectKey: candidate.subjectKey,
      kind: candidate.kind,
      proposal: candidate.proposal,
      confidence: candidate.confidence,
      evidenceFactIds: [...candidate.evidenceFactIds].sort(),
      sourceSliceEvidence: candidate.sourceSliceIds.length > 0,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    conflicts: (reconciliation.conflicts ?? []).map(({ type, candidateIds = [], reason = null }) => ({
      type,
      candidateIds: [...candidateIds].sort(),
      reason,
    })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    gaps: candidateBundle.gaps.map(({ code, workUnitId, details = null }) => ({ code, workUnitId, details }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  };
  return deepFreeze({
    digest: contentId("UNDERSTANDING-SEMANTIC-SURFACE", canonicalJson(content)),
    ...content,
  });
}

function verifiedComparison(label, currentSurface, evidence, job) {
  if (!evidence || evidence.independent !== true || evidence.analysisRunId === job.id) {
    throw new TypeError(`${label} equivalence evidence must come from an independent analysis run`);
  }
  if (evidence.snapshotManifestId !== job.snapshotManifestId || evidence.policyDigest !== job.policyDigest) {
    throw new TypeError(`${label} equivalence evidence is not bound to the current Snapshot and policy`);
  }
  if (label === "full" && evidence.mode !== "FULL") {
    throw new TypeError("incremental equivalence evidence must be produced by an independent FULL run");
  }
  if (label === "replay" && evidence.mode !== job.resolvedMode) {
    throw new TypeError("replay equivalence evidence must use the current analysis mode");
  }
  if (!evidence.surface || typeof evidence.surface.digest !== "string") {
    throw new TypeError(`${label} equivalence evidence surface is required`);
  }
  const { digest, ...surfaceContent } = evidence.surface;
  if (digest !== contentId("UNDERSTANDING-SEMANTIC-SURFACE", canonicalJson(surfaceContent))) {
    throw new TypeError(`${label} equivalence evidence surface digest is invalid`);
  }
  const equivalent = canonicalJson(currentSurface) === canonicalJson(evidence.surface);
  return {
    analysisRunId: evidence.analysisRunId,
    mode: evidence.mode,
    producer: structuredClone(evidence.producer ?? null),
    surfaceDigest: evidence.surface.digest,
    equivalent,
  };
}

export async function measureUnderstandingEquivalence({ job, surface, resolver, clock = () => new Date() }) {
  if (typeof resolver !== "function") {
    throw new TypeError("Publication requires independent replay and FULL equivalence evidence");
  }
  const evidence = await resolver({ job: deepFreeze(structuredClone(job)), surface });
  const replay = verifiedComparison("replay", surface, evidence?.replay, job);
  const full = verifiedComparison("full", surface, evidence?.full, job);
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
