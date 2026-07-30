import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

export const GraphRevisionStatus = Object.freeze({
  BUILDING: "BUILDING",
  EVALUATING: "EVALUATING",
  PUBLISHED: "PUBLISHED",
  REJECTED: "REJECTED",
});

export function resolveUnderstandingMode(requestedMode, currentGraphHead) {
  if (!["AUTO", "FULL", "INCREMENTAL"].includes(requestedMode)) throw new TypeError("mode must be AUTO, FULL, or INCREMENTAL");
  if (!currentGraphHead && requestedMode === "INCREMENTAL") {
    throw new RangeError("INCREMENTAL requires an existing CurrentGraphHead");
  }
  return requestedMode === "AUTO" ? (currentGraphHead ? "INCREMENTAL" : "FULL") : requestedMode;
}

export function createGraphRevision(input, clock = () => new Date()) {
  const mode = requireNonEmptyString(input.mode, "mode");
  if (!["FULL", "INCREMENTAL"].includes(mode)) throw new TypeError("mode must be FULL or INCREMENTAL");
  if (mode === "FULL" && input.baseRevisionId) throw new TypeError("FULL revision cannot have a baseRevisionId");
  if (mode === "INCREMENTAL" && !input.baseRevisionId) throw new TypeError("INCREMENTAL revision requires baseRevisionId");
  const identity = {
    projectId: requireNonEmptyString(input.projectId, "projectId"),
    snapshotManifestId: requireNonEmptyString(input.snapshotManifestId, "snapshotManifestId"),
    analysisRunId: requireNonEmptyString(input.analysisRunId, "analysisRunId"),
    mode,
    baseRevisionId: input.baseRevisionId ?? null,
    changeSetId: input.changeSetId ?? null,
    impactAssessmentId: input.impactAssessmentId ?? null,
    evaluationRunId: requireNonEmptyString(input.evaluationRunId, "evaluationRunId"),
    graphArtifactId: requireNonEmptyString(input.graphArtifactId, "graphArtifactId"),
    graphArtifactDigest: requireNonEmptyString(input.graphArtifactDigest, "graphArtifactDigest"),
    semanticDigest: requireNonEmptyString(input.semanticDigest, "semanticDigest"),
  };
  return deepFreeze({
    id: input.id ?? contentId("GRAPH-REVISION", identity),
    ...identity,
    status: GraphRevisionStatus.BUILDING,
    createdAt: clock().toISOString(),
    publishedAt: null,
  });
}

export function createImmutableGraphArtifact(input, clock = () => new Date()) {
  const nodes = structuredClone(input.nodes ?? []).sort((left, right) => left.id.localeCompare(right.id));
  const edges = structuredClone(input.edges ?? []).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(nodes.map(({ id }) => id)).size !== nodes.length) throw new TypeError("graph nodes must have unique ids");
  if (new Set(edges.map(({ id }) => id)).size !== edges.length) throw new TypeError("graph edges must have unique ids");
  const nodeIds = new Set(nodes.map(({ id }) => id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new TypeError(`graph edge ${edge.id} must reference graph nodes`);
    }
  }
  const content = {
    projectId: requireNonEmptyString(input.projectId, "projectId"),
    snapshotManifestId: requireNonEmptyString(input.snapshotManifestId, "snapshotManifestId"),
    analysisRunId: requireNonEmptyString(input.analysisRunId, "analysisRunId"),
    nodes,
    edges,
    traceChains: structuredClone(input.traceChains ?? []),
    gaps: structuredClone(input.gaps ?? []),
    changeSet: structuredClone(input.changeSet ?? null),
    impactAssessment: structuredClone(input.impactAssessment ?? null),
    revalidationPlan: structuredClone(input.revalidationPlan ?? null),
  };
  const graphArtifactDigest = contentId("IMMUTABLE-GRAPH-CONTENT", canonicalJson(content));
  return deepFreeze({
    id: input.id ?? contentId("IMMUTABLE-GRAPH-ARTIFACT", { ...content, graphArtifactDigest }),
    ...content,
    graphArtifactDigest,
    createdAt: clock().toISOString(),
  });
}

export function transitionGraphRevision(revision, status, clock = () => new Date()) {
  const allowed = revision.status === "BUILDING" && status === "EVALUATING"
    || revision.status === "EVALUATING" && ["PUBLISHED", "REJECTED"].includes(status);
  if (!allowed) throw new TypeError(`GraphRevision cannot transition from ${revision.status} to ${status}`);
  return deepFreeze({ ...structuredClone(revision), status, publishedAt: status === "PUBLISHED" ? clock().toISOString() : null });
}
