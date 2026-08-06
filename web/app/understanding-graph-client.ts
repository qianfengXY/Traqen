export type GraphRevision = {
  id: string;
  projectId: string;
  snapshotManifestId: string;
  analysisRunId: string;
  mode: "FULL" | "INCREMENTAL";
  baseRevisionId: string | null;
  changeSetId: string | null;
  impactAssessmentId: string | null;
  evaluationRunId: string;
  graphArtifactId: string;
  graphArtifactDigest: string;
  semanticDigest: string;
  status: "BUILDING" | "EVALUATING" | "PUBLISHED" | "REJECTED";
  createdAt: string;
  publishedAt: string | null;
  dataClassification?: string;
  productionEligible?: boolean;
  evaluationEvidenceType?: string;
  reanalysisOfGraphRevisionId?: string;
};

export type HistoricalAvailability = {
  status: "UNAVAILABLE_REQUIRES_REANALYSIS";
  reasonCode:
    | "IMMUTABLE_TRACEABILITY_SNAPSHOT_NOT_CAPTURED"
    | "REQUESTED_FEATURE_NOT_PRESENT_IN_IMMUTABLE_ARTIFACT"
    | "SELECTED_OBJECT_NOT_PRESENT_IN_IMMUTABLE_ARTIFACT"
    | "SELECTED_OBJECT_FEATURE_OWNERSHIP_NOT_PROVABLE";
  message: string;
  artifactSchemaVersion: 1;
  featureId: string;
  selectedObjectId: string;
  snapshotManifestId: string;
  graphRevisionId: string;
  graphArtifactId: string;
  graphArtifactDigest: string;
  recovery: {
    action: "REANALYZE_FROM_REVISION_SNAPSHOT";
    method: "POST";
    snapshotManifestId: string;
    graphRevisionId: string;
    endpoint: string;
  };
  currentContext: { action: "VIEW_CURRENT_PUBLISHED_HEAD"; method: "GET"; endpoint: string };
};

export type CurrentUnderstandingGraph = {
  head: {
    projectId: string; graphRevisionId: string; version: number; updatedAt: string;
    dataClassification?: string; productionEligible?: boolean; evaluationEvidenceType?: string;
  };
  revision: GraphRevision;
  graphArtifact: {
    id: string;
    artifactSchemaVersion?: 1 | 2;
    graphArtifactDigest: string;
    dataClassification?: string;
    productionEligible?: boolean;
    evaluationEvidenceType?: string;
    nodes: Array<{ id: string; type: string; authority: "CANDIDATE" | "GOVERNED" | "GOVERNED_BASELINE" | "DETERMINISTIC_FACT" | "GAP" | "OBSERVED_CANDIDATE_ONLY"; label: string }>;
    edges: Array<{ id: string; source: string; target: string; type: string }>;
    traceChains: Array<{ id: string; status: string; nodeIds: string[]; complete: boolean }>;
    gaps: Array<{ id?: string; code?: string }>;
    changeSet: { id: string; changedNodeIds: string[] } | null;
    impactAssessment: { id: string; affectedNodeIds: string[] } | null;
    revalidationPlan: { required: boolean; actions: string[] } | null;
    featureTraceability?: Array<{
      featureId: string;
      featureVersions: Array<Record<string, unknown>>;
      traceability: FeatureTraceability;
    }>;
  };
};

export type FeatureUnderstandingHistory = {
  feature: { id: string; version: number; name: string; [key: string]: unknown };
  featureVersions: Array<{ id: string; version: number; name: string; [key: string]: unknown }>;
  decisions: Array<{ id: string; [key: string]: unknown }>;
  implementationMappings: Array<{
    id: string;
    featureId: string;
    snapshotManifestId: string;
    [key: string]: unknown;
  }>;
  graphRevisions: GraphRevision[];
  testSpecs: Array<{ id: string; version: number; [key: string]: unknown }>;
  testExecutions: Array<{
    id: string;
    testSpecId: string;
    testSpecVersion: number;
    snapshotManifestId: string;
    status: string;
    [key: string]: unknown;
  }>;
  selection?: { id: string; type: string; label: string; authority: string; ownerFeatureId: string };
  selectionHistory?: Array<Record<string, unknown>>;
  historicalAvailability?: HistoricalAvailability;
  snapshotManifestId?: string;
  graphRevisionId?: string;
};

export type FeatureTraceability = {
  feature: Record<string, unknown> & { id: string; version?: number; name?: string };
  selection?: { id: string; type: string; label: string; authority: string; ownerFeatureId: string };
  processModel: (Record<string, unknown> & { designElements?: Array<Record<string, unknown>> }) | null;
  processImplementationFacts: Array<{
    snapshotManifestId: string;
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    missingFactRefs: string[];
  }>;
  snapshotManifest: Record<string, unknown> & { id: string };
  claims: Array<Record<string, unknown>>;
  dimensions: Record<string, Array<{ claimId: string; status: string }>>;
  traceChains: Array<Record<string, unknown>>;
  gaps: Array<Record<string, unknown>>;
  persisted: Array<Record<string, unknown>>;
  computedAt: string;
  historicalAvailability?: HistoricalAvailability;
  graphRevisionId?: string | null;
};

export type FeatureGraphNode = {
  id: string;
  type: string;
  label: string;
  version: number | string | null;
  status: "ACTIVE" | "PENDING" | "STALE" | "CONFLICTED" | "GAP";
  risk?: string | null;
  provenance: string;
  source: Record<string, unknown> | null;
  details: Record<string, unknown>;
  evidenceResolver?: string;
};

export type FeatureGraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  provenance: string;
  status: "ACTIVE" | "PENDING" | "STALE";
  snapshotManifestId: string;
  evidenceResolver?: string;
};

export type FeatureGraphProjection = {
  center: string;
  snapshotManifestId: string;
  graphRevisionId?: string;
  ownerFeatureId?: string;
  view: "traceability" | "business" | "implementation" | "coverage";
  depth: number;
  nodes: FeatureGraphNode[];
  edges: FeatureGraphEdge[];
  truncated: boolean;
  availableExpansions: Array<{ relation: string; nodeType: string; count: number }>;
  historicalAvailability?: HistoricalAvailability;
};

export type FeatureGraphPathResult = Omit<FeatureGraphProjection, "depth" | "truncated" | "availableExpansions"> & {
  query: {
    fromNodeId: string;
    toNodeId: string;
    direction: "ANY" | "FORWARD" | "REVERSE";
    maxDepth: number;
  };
  found: boolean;
  hopCount: number | null;
};

export type FeatureGraphOptions = {
  view?: FeatureGraphProjection["view"];
  depth?: number;
  limit?: number;
  nodeTypes?: string[];
  relations?: string[];
  rootNodeId?: string;
  graphRevisionId?: string;
};

export type FeatureGraphPathQuery = {
  snapshotManifestId: string;
  fromNodeId: string;
  toNodeId: string;
  direction?: "ANY" | "FORWARD" | "REVERSE";
  maxDepth?: number;
  view?: FeatureGraphProjection["view"];
  graphRevisionId?: string;
};

export type GovernedSelectionOptions = {
  selectedObjectId?: string;
  graphRevisionId?: string;
};

export type ResolvedGraphEvidence = {
  resolved: boolean;
  status: "RESOLVED" | "MISSING" | "UNAVAILABLE_REQUIRES_REANALYSIS";
  kind: "node" | "edge" | "object";
  id: string;
  object: Record<string, unknown> | null;
  historicalAvailability?: HistoricalAvailability;
  context: {
    projectId: string;
    featureId: string;
    rootNodeId: string;
    snapshotManifestId: string;
    graphRevisionId: string;
    graphArtifactId: string;
    graphArtifactDigest: string;
  };
};

function headers(apiToken: string) {
  return apiToken.trim() ? { "x-traqen-api-token": apiToken.trim() } : {};
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `API returned ${response.status}`);
  return body;
}

export async function getCurrentUnderstandingGraph(apiBase: string, apiToken: string, projectId: string) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/graph/current`, {
    method: "GET",
    headers: headers(apiToken),
  });
  if (response.status === 404) return null;
  return json<CurrentUnderstandingGraph>(response);
}

export async function listGraphRevisions(apiBase: string, apiToken: string, projectId: string) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/graph/revisions`, {
    method: "GET",
    headers: headers(apiToken),
  });
  return (await json<{ revisions: GraphRevision[] }>(response)).revisions;
}

export async function getGraphRevision(
  apiBase: string,
  apiToken: string,
  projectId: string,
  revisionId: string,
) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/graph/revisions/${encodeURIComponent(revisionId)}`, {
    method: "GET",
    headers: headers(apiToken),
  });
  return json<{ revision: GraphRevision; graphArtifact: CurrentUnderstandingGraph["graphArtifact"] }>(response);
}

export async function getUnderstandingChangeImpact(
  apiBase: string,
  apiToken: string,
  projectId: string,
  changeSetId: string,
) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/changes/${encodeURIComponent(changeSetId)}/impact`, {
    method: "GET",
    headers: headers(apiToken),
  });
  if (response.status === 404) return null;
  return json<Record<string, unknown>>(response);
}

export async function getUnderstandingTraceChain(
  apiBase: string,
  apiToken: string,
  projectId: string,
  traceChainId: string,
) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/graph/traces/${encodeURIComponent(traceChainId)}`, {
    method: "GET",
    headers: headers(apiToken),
  });
  if (response.status === 404) return null;
  return json<CurrentUnderstandingGraph["graphArtifact"]["traceChains"][number]>(response);
}

export async function getFeatureUnderstandingHistory(
  apiBase: string,
  apiToken: string,
  projectId: string,
  featureId: string,
  options: GovernedSelectionOptions = {},
): Promise<FeatureUnderstandingHistory | null> {
  const query = new URLSearchParams();
  if (options.selectedObjectId) query.set("selectedObjectId", options.selectedObjectId);
  if (options.graphRevisionId) query.set("graphRevisionId", options.graphRevisionId);
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/history${query.size ? `?${query}` : ""}`,
    { method: "GET", headers: headers(apiToken) },
  );
  if (response.status === 404) return null;
  return json<FeatureUnderstandingHistory>(response);
}

export async function getFeatureTraceability(
  apiBase: string,
  apiToken: string,
  projectId: string,
  featureId: string,
  snapshotManifestId: string,
  options: GovernedSelectionOptions = {},
): Promise<FeatureTraceability | null> {
  const query = new URLSearchParams({ snapshotManifestId });
  if (options.selectedObjectId) query.set("selectedObjectId", options.selectedObjectId);
  if (options.graphRevisionId) query.set("graphRevisionId", options.graphRevisionId);
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/traceability?${query}`,
    { method: "GET", headers: headers(apiToken) },
  );
  if (response.status === 404) return null;
  return json<FeatureTraceability>(response);
}

export async function getFeatureGraph(
  apiBase: string,
  apiToken: string,
  projectId: string,
  featureId: string,
  snapshotManifestId: string,
  options: FeatureGraphOptions = {},
): Promise<FeatureGraphProjection | null> {
  const query = new URLSearchParams({ snapshotManifestId });
  if (options.view) query.set("view", options.view);
  if (options.depth) query.set("depth", String(options.depth));
  if (options.limit) query.set("limit", String(options.limit));
  if (options.rootNodeId) query.set("rootNodeId", options.rootNodeId);
  if (options.graphRevisionId) query.set("graphRevisionId", options.graphRevisionId);
  for (const nodeType of options.nodeTypes ?? []) query.append("nodeType", nodeType);
  for (const relation of options.relations ?? []) query.append("relation", relation);
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/graph?${query}`,
    { method: "GET", headers: headers(apiToken) },
  );
  if (response.status === 404) return null;
  return json<FeatureGraphProjection>(response);
}

export async function queryFeatureGraphPath(
  apiBase: string,
  apiToken: string,
  projectId: string,
  featureId: string,
  input: FeatureGraphPathQuery,
): Promise<FeatureGraphPathResult | null> {
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/graph/paths/query`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers(apiToken) },
      body: JSON.stringify(input),
    },
  );
  if (response.status === 404) return null;
  return json<FeatureGraphPathResult>(response);
}

export async function resolveGraphEvidence(
  apiBase: string,
  apiToken: string,
  resolver: string,
): Promise<ResolvedGraphEvidence> {
  if (!resolver.startsWith("/v1/")) throw new Error("Evidence resolver must be a server-owned /v1 path");
  const response = await fetch(`${apiBase.replace(/\/$/, "")}${resolver}`, {
    method: "GET",
    headers: headers(apiToken),
  });
  return json<ResolvedGraphEvidence>(response);
}
