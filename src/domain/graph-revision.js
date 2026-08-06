import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

export const GraphRevisionStatus = Object.freeze({
  BUILDING: "BUILDING",
  EVALUATING: "EVALUATING",
  PUBLISHED: "PUBLISHED",
  REJECTED: "REJECTED",
});

export const GraphArtifactSchemaVersion = Object.freeze({
  LEGACY_WITHOUT_FEATURE_TRACEABILITY: 1,
  FEATURE_TRACEABILITY_SNAPSHOT: 2,
});

function publicationMetadata(input) {
  const present = [input.dataClassification, input.productionEligible, input.evaluationEvidenceType]
    .some((value) => value !== undefined && value !== null);
  if (!present) return {};
  const dataClassification = requireNonEmptyString(input.dataClassification, "dataClassification");
  const evaluationEvidenceType = requireNonEmptyString(input.evaluationEvidenceType, "evaluationEvidenceType");
  if (typeof input.productionEligible !== "boolean") {
    throw new TypeError("productionEligible must be a boolean");
  }
  return { dataClassification, productionEligible: input.productionEligible, evaluationEvidenceType };
}

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
    ...(input.reanalysisOfGraphRevisionId
      ? { reanalysisOfGraphRevisionId: requireNonEmptyString(input.reanalysisOfGraphRevisionId, "reanalysisOfGraphRevisionId") }
      : {}),
    ...publicationMetadata(input),
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
  const featureTraceability = structuredClone(input.featureTraceability ?? [])
    .sort((left, right) => left.featureId.localeCompare(right.featureId));
  if (new Set(nodes.map(({ id }) => id)).size !== nodes.length) throw new TypeError("graph nodes must have unique ids");
  if (new Set(edges.map(({ id }) => id)).size !== edges.length) throw new TypeError("graph edges must have unique ids");
  if (new Set(featureTraceability.map(({ featureId }) => featureId)).size !== featureTraceability.length) {
    throw new TypeError("graph feature traceability snapshots must have unique Feature ids");
  }
  const projectId = requireNonEmptyString(input.projectId, "projectId");
  const snapshotManifestId = requireNonEmptyString(input.snapshotManifestId, "snapshotManifestId");
  for (const snapshot of featureTraceability) {
    const featureId = requireNonEmptyString(snapshot.featureId, "featureTraceability.featureId");
    if (snapshot.traceability?.feature?.id !== featureId) {
      throw new TypeError(`Feature traceability snapshot ${featureId} must own the same Feature id`);
    }
    if (snapshot.traceability?.snapshotManifest?.id !== snapshotManifestId) {
      throw new TypeError(`Feature traceability snapshot ${featureId} must own SnapshotManifest ${snapshotManifestId}`);
    }
    if (!Array.isArray(snapshot.featureVersions) || snapshot.featureVersions.length < 1) {
      throw new TypeError(`Feature traceability snapshot ${featureId} requires FeatureVersion history`);
    }
  }
  const nodeIds = new Set(nodes.map(({ id }) => id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new TypeError(`graph edge ${edge.id} must reference graph nodes`);
    }
  }
  const content = {
    artifactSchemaVersion: GraphArtifactSchemaVersion.FEATURE_TRACEABILITY_SNAPSHOT,
    projectId,
    snapshotManifestId,
    analysisRunId: requireNonEmptyString(input.analysisRunId, "analysisRunId"),
    ...publicationMetadata(input),
    nodes,
    edges,
    featureTraceability,
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
