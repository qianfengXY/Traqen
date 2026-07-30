import { contentId, deepFreeze } from "./canonical-json.js";
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

export function transitionGraphRevision(revision, status, clock = () => new Date()) {
  const allowed = revision.status === "BUILDING" && status === "EVALUATING"
    || revision.status === "EVALUATING" && ["PUBLISHED", "REJECTED"].includes(status);
  if (!allowed) throw new TypeError(`GraphRevision cannot transition from ${revision.status} to ${status}`);
  return deepFreeze({ ...structuredClone(revision), status, publishedAt: status === "PUBLISHED" ? clock().toISOString() : null });
}
