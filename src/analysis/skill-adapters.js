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
        digest: input.workUnit.inputDigest,
        allowedFactIds,
        facts: input.evidence,
        factBundles: [],
        projectSnapshot: {
          projectId: input.request.projectId,
          snapshotManifestId: input.request.snapshotManifestId,
          sourceComponentId: input.request.sourceComponentId,
        },
        taskScope: { workUnitId: input.workUnit.id, scopeKey: input.workUnit.scopeKey },
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
            confidence: "HIGH",
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
