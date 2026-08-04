import { contentId, deepFreeze } from "../domain/index.js";

function evidenceKey(candidate) {
  return [...(candidate.evidenceFactIds ?? []), ...(candidate.sourceSliceIds ?? [])].sort().join("\u0000");
}

const confidenceRank = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3 });

export function createCandidateEvidenceAllowset(input) {
  const routeDecision = structuredClone(input.routeDecision ?? null);
  const reuseDecision = structuredClone(input.reuseDecision ?? null);
  if (!routeDecision && !reuseDecision) {
    throw new TypeError("an evidence allowset requires a RouteDecision or ReuseDecision");
  }
  return deepFreeze({
    projectId: input.projectId,
    snapshotManifestId: input.snapshotManifestId,
    analysisRunId: input.analysisRunId,
    workUnitId: input.workUnitId,
    factIds: [...new Set(input.factIds ?? [])].sort(),
    sourceSliceIds: [...new Set(input.sourceSliceIds ?? [])].sort(),
    confidenceCap: input.confidenceCap ?? "LOW",
    routeDecision,
    reuseDecision,
  });
}

export function validateCandidateAgainstEvidenceAllowset(candidate, allowset) {
  for (const field of ["projectId", "snapshotManifestId", "analysisRunId", "workUnitId"]) {
    if (candidate[field] !== allowset[field]) throw new TypeError(`Candidate ${candidate.id} ${field} is outside the evidence allowset`);
  }
  for (const [field, allowedValues] of [
    ["evidenceFactIds", allowset.factIds],
    ["sourceSliceIds", allowset.sourceSliceIds],
  ]) {
    const values = candidate[field] ?? [];
    if (new Set(values).size !== values.length) throw new TypeError(`Candidate ${candidate.id} has duplicate ${field}`);
    const allowed = new Set(allowedValues);
    for (const value of values) {
      if (!allowed.has(value)) throw new TypeError(`Candidate ${candidate.id} cites unauthorized ${field} ${value}`);
    }
  }
  if ((confidenceRank[candidate.confidence] ?? Number.POSITIVE_INFINITY)
    > (confidenceRank[allowset.confidenceCap] ?? 0)) {
    throw new TypeError(`Candidate ${candidate.id} confidence exceeds its evidence cap`);
  }
  const selectedRoutes = allowset.routeDecision?.selected
    ?? allowset.reuseDecision?.authorizedProducers
    ?? [];
  const routeMatches = selectedRoutes.some((route) =>
    route.modelCapabilityProfileId === candidate.producer?.modelCapabilityProfileId
    && route.skillId === candidate.producer?.skillId
    && route.skillVersion === candidate.producer?.skillVersion);
  if (!routeMatches) {
    const authority = allowset.reuseDecision ? "ReuseDecision" : "RouteDecision";
    throw new TypeError(`Candidate ${candidate.id} producer is not selected by ${authority}`);
  }
  return true;
}

export function reconcileCandidates(input, clock = () => new Date()) {
  const candidates = (input.candidates ?? []).map((candidate) => structuredClone(candidate));
  if (new Set(candidates.map(({ id }) => id)).size !== candidates.length) {
    throw new TypeError("Candidate ids must be unique within a reconciliation");
  }
  for (const candidate of candidates) {
    if ((candidate.evidenceFactIds?.length ?? 0) + (candidate.sourceSliceIds?.length ?? 0) === 0) {
      throw new TypeError(`Candidate ${candidate.id} requires original Fact or SourceSlice evidence`);
    }
    const allowset = input.evidenceAllowsets?.[candidate.workUnitId];
    if (!allowset) throw new TypeError(`Candidate ${candidate.id} has no immutable evidence allowset`);
    validateCandidateAgainstEvidenceAllowset(candidate, allowset);
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
  const conflicts = structuredClone(input.conflicts ?? []);
  for (const conflict of conflicts) {
    if (!conflict?.id || conflict.status !== "UNRESOLVED"
      || !Array.isArray(conflict.candidateIds)
      || conflict.candidateIds.some((id) => !candidates.some((candidate) => candidate.id === id))) {
      throw new TypeError("Main reconciliation conflicts must reference admitted Candidates");
    }
  }
  const relations = structuredClone(input.relations ?? []);
  for (const relation of relations) {
    if (!relation?.id || typeof relation.predicate !== "string") {
      throw new TypeError("reconciled relations require id and predicate");
    }
  }
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
        id: contentId("CANDIDATE-CONFLICT", {
          analysisRunId: input.analysisRunId,
          subject,
          candidateIds: values.map(({ id }) => id).sort(),
        }),
        subject,
        candidateIds: values.map(({ id }) => id).sort(),
        status: "UNRESOLVED",
        evidence: values.map(({ id, evidenceFactIds = [], sourceSliceIds = [] }) => ({ id, evidenceFactIds, sourceSliceIds })),
      });
    }
  }
  return deepFreeze({
    id: contentId("RECONCILIATION", { analysisRunId: input.analysisRunId, reconciled, conflicts, relations }),
    projectId: input.projectId,
    snapshotManifestId: input.snapshotManifestId,
    analysisRunId: input.analysisRunId,
    candidates: reconciled,
    conflicts,
    relations,
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
