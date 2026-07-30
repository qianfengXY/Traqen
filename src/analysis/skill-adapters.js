import { createCandidateEvidenceAllowset, validateCandidateAgainstEvidenceAllowset } from "./candidate-reconciliation.js";

export function createReverseSkillAnalysisAdapter(adapter) {
  if (!adapter || typeof adapter.execute !== "function") throw new TypeError("reverse Skill adapter.execute is required");
  if (typeof adapter.id !== "string" || typeof adapter.version !== "string") throw new TypeError("reverse Skill adapter id and version are required");
  return Object.freeze({
    id: adapter.id,
    version: adapter.version,
    async analyze(input, { signal = null } = {}) {
      const allowedFactIds = [
        ...input.evidence.nodes.map((node) => node.factId),
        ...input.evidence.edges.map((edge) => edge.id),
      ];
      const raw = await adapter.execute({
        digest: input.workContext.inputDigest,
        allowedFactIds,
        facts: input.evidence,
        factBundles: [],
        projectSnapshot: {
          projectId: input.request.projectId,
          snapshotManifestId: input.request.snapshotManifestId,
          sourceComponentId: input.request.sourceComponentId,
        },
        taskScope: { workUnitId: input.workUnit.id, scopeKey: input.workContext.scopeKey },
      }, { signal });
      const nodeByFactId = new Map(input.evidence.nodes.map((node) => [node.factId, node]));
      return {
        candidateFeatures: (raw.candidateFeatures ?? []).map((candidate) => {
          const evidenceFactIds = [...new Set((candidate.evidence ?? []).map((item) => item.factId))];
          const endpoint = String(candidate.externalKey ?? "").startsWith("endpoint:");
          const endpointIdentity = endpoint ? String(candidate.externalKey).slice("endpoint:".length).trim().split(/\s+/, 2) : [];
          return {
            candidateKey: endpoint
              ? `api:${endpointIdentity[0] ?? "http"}:${endpointIdentity[1] ?? candidate.localId}`.toLowerCase()
              : candidate.externalKey ?? `business:${candidate.localId}`,
            mode: endpoint ? "API" : "BUSINESS",
            name: candidate.name,
            description: candidate.description,
            confidence: "LOW",
            evidenceFactIds,
            stableEvidenceNodeIds: evidenceFactIds.map((factId) => nodeByFactId.get(factId)?.id).filter(Boolean),
            design: {},
            uncertainties: (raw.openQuestions ?? [])
              .filter((question) => question.relatedLocalIds?.includes(candidate.localId))
              .map((question) => question.question),
          };
        }),
      };
    },
  });
}

export function createDirectSourceAnalysisAdapter(adapter, sourceSliceBroker) {
  if (!adapter || typeof adapter.execute !== "function") throw new TypeError("direct-source Skill adapter.execute is required");
  if (!sourceSliceBroker || typeof sourceSliceBroker.read !== "function") throw new TypeError("sourceSliceBroker is required");
  return Object.freeze({
    id: adapter.id,
    version: adapter.version,
    inputMode: "DIRECT_SOURCE",
    async analyze(input, { signal = null } = {}) {
      if (input.factBundleRequired) throw new TypeError("Direct-source adapter cannot require a FactBundle");
      const slices = [];
      for (const request of input.sourceSliceRequests ?? []) {
        if (signal?.aborted) throw new DOMException("Analysis aborted", "AbortError");
        const slice = await sourceSliceBroker.read(request, input.authorization);
        if (slice.status === "REJECTED") continue;
        slices.push(slice);
      }
      if (slices.length === 0) {
        return { candidateFeatures: [], gaps: [{ code: "NO_AUTHORIZED_SOURCE_SLICE" }] };
      }
      const raw = await adapter.execute({
        projectSnapshot: {
          projectId: input.projectId,
          snapshotManifestId: input.snapshotManifestId,
        },
        workUnitId: input.workUnitId,
        sourceSlices: slices.flatMap(({ id, artifactSlices }) => artifactSlices.map((slice) => ({
          id,
          artifactId: slice.artifactId,
          content: slice.redactedText,
          contentDigest: slice.contentDigest,
          range: slice.range,
        }))),
        optionalFacts: input.optionalFacts ?? null,
      }, { signal });
      const sourceSliceIds = slices.map(({ id }) => id);
      const allowset = createCandidateEvidenceAllowset({
        projectId: input.projectId,
        snapshotManifestId: input.snapshotManifestId,
        analysisRunId: input.analysisRunId,
        workUnitId: input.workUnitId,
        factIds: input.optionalFacts?.ids ?? [],
        sourceSliceIds,
        confidenceCap: input.confidenceCap ?? "LOW",
        routeDecision: input.routeDecision,
      });
      const candidateFeatures = [];
      const gaps = [...(raw.gaps ?? [])];
      for (const candidate of raw.candidateFeatures ?? []) {
        const bounded = {
          ...candidate,
          projectId: input.projectId,
          snapshotManifestId: input.snapshotManifestId,
          analysisRunId: input.analysisRunId,
          workUnitId: input.workUnitId,
          evidenceFactIds: candidate.evidenceFactIds ?? [],
          sourceSliceIds: candidate.sourceSliceIds ?? [],
          confidence: candidate.confidence ?? "LOW",
          producer: candidate.producer ?? input.routeDecision?.selected?.[0] ?? null,
        };
        try {
          validateCandidateAgainstEvidenceAllowset(bounded, allowset);
          candidateFeatures.push(bounded);
        } catch (error) {
          gaps.push({
            code: "CANDIDATE_EVIDENCE_SCOPE_VIOLATION",
            candidateId: candidate.id ?? null,
            message: error.message,
          });
        }
      }
      return {
        candidateFeatures,
        gaps,
        evidenceAllowset: allowset,
      };
    },
  });
}
