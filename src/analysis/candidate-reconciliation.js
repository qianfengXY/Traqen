import { contentId, deepFreeze } from "../domain/index.js";

function evidenceKey(candidate) {
  return [...(candidate.evidenceFactIds ?? []), ...(candidate.sourceSliceIds ?? [])].sort().join("\u0000");
}

export function reconcileCandidates(input, clock = () => new Date()) {
  const candidates = (input.candidates ?? []).map((candidate) => structuredClone(candidate));
  for (const candidate of candidates) {
    if ((candidate.evidenceFactIds?.length ?? 0) + (candidate.sourceSliceIds?.length ?? 0) === 0) {
      throw new TypeError(`Candidate ${candidate.id} requires original Fact or SourceSlice evidence`);
    }
    if (candidate.summaryEvidence && !candidate.evidenceFactIds?.length && !candidate.sourceSliceIds?.length) {
      throw new TypeError(`Candidate ${candidate.id} cannot use summary-only evidence`);
    }
  }
  const groups = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.kind}\u0000${candidate.proposal?.statement ?? candidate.proposal?.name ?? candidate.id}\u0000${evidenceKey(candidate)}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const reconciled = [...groups.values()].map((group) => ({
    id: contentId("RECONCILED-CANDIDATE", group.map(({ id }) => id).sort()),
    disposition: group.length > 1 ? "DUPLICATE" : "DISTINCT",
    candidateIds: group.map(({ id }) => id).sort(),
    evidenceFactIds: [...new Set(group.flatMap(({ evidenceFactIds = [] }) => evidenceFactIds))].sort(),
    sourceSliceIds: [...new Set(group.flatMap(({ sourceSliceIds = [] }) => sourceSliceIds))].sort(),
  }));
  const conflicts = [];
  const bySubject = new Map();
  for (const candidate of candidates) {
    const subject = candidate.subjectKey ?? candidate.proposal?.name ?? null;
    if (!subject) continue;
    const values = bySubject.get(subject) ?? [];
    values.push(candidate);
    bySubject.set(subject, values);
  }
  for (const [subject, values] of bySubject) {
    const statements = new Set(values.map(({ proposal }) => proposal?.statement ?? proposal?.constraint?.value).filter(Boolean));
    if (statements.size > 1) {
      conflicts.push({
        id: contentId("CANDIDATE-CONFLICT", { subject, candidateIds: values.map(({ id }) => id).sort() }),
        subject,
        candidateIds: values.map(({ id }) => id).sort(),
        status: "UNRESOLVED",
        evidence: values.map(({ id, evidenceFactIds = [], sourceSliceIds = [] }) => ({ id, evidenceFactIds, sourceSliceIds })),
      });
    }
  }
  return deepFreeze({
    id: contentId("RECONCILIATION", { analysisRunId: input.analysisRunId, reconciled, conflicts }),
    projectId: input.projectId,
    snapshotManifestId: input.snapshotManifestId,
    analysisRunId: input.analysisRunId,
    candidates: reconciled,
    conflicts,
    candidateAbsences: structuredClone(input.candidateAbsences ?? []),
    createdAt: clock().toISOString(),
  });
}

export function recordCandidateAbsence(previousCandidateId, snapshotManifestId) {
  return deepFreeze({
    previousCandidateId,
    snapshotManifestId,
    status: "NO_CURRENT_OBSERVATION",
    retiresGovernedFeature: false,
  });
}
