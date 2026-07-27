import {
  localWorkspaceDerivedId,
  localWorkspaceFactId,
  type LocalWorkspaceAnalysis,
} from "./local-workspace-analysis.ts";

export type LocalWorkspaceGraphView = "traceability" | "business" | "implementation" | "coverage";

export type LocalWorkspaceGraphNode = {
  id: string;
  type: string;
  label: string;
  version: string | number | null;
  status: "ACTIVE" | "PENDING" | "STALE" | "CONFLICTED" | "GAP";
  risk: string | null;
  provenance: string;
  source: Record<string, unknown> | null;
  details: Record<string, unknown>;
};

export type LocalWorkspaceGraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  provenance: string;
  status: "ACTIVE" | "PENDING" | "STALE";
  snapshotManifestId: string;
};

export type LocalWorkspaceCandidateGraph = {
  center: string;
  snapshotManifestId: string;
  view: LocalWorkspaceGraphView;
  depth: number;
  nodes: LocalWorkspaceGraphNode[];
  edges: LocalWorkspaceGraphEdge[];
  truncated: boolean;
  availableExpansions: Array<{ relation: string; nodeType: string; count: number }>;
};

export function createLocalWorkspaceCandidateGraph(
  analysis: LocalWorkspaceAnalysis,
  candidateId: string,
  view: LocalWorkspaceGraphView,
): LocalWorkspaceCandidateGraph {
  const candidate = analysis.features.find((item) => item.id === candidateId) ?? analysis.features[0];
  if (!candidate) {
    return {
      center: "",
      snapshotManifestId: analysis.snapshotManifestId,
      view,
      depth: 8,
      nodes: [],
      edges: [],
      truncated: false,
      availableExpansions: [],
    };
  }
  const snapshotManifestId = analysis.snapshotManifestId;
  const claimId = localWorkspaceDerivedId("CANDIDATE-CLAIM", `${snapshotManifestId}\u0000${candidate.id}`);
  const implementationFactId = localWorkspaceFactId(snapshotManifestId, candidate.kind, candidate.id);
  const nodes: LocalWorkspaceGraphNode[] = [
    {
      id: candidate.id,
      type: "CANDIDATE_FEATURE",
      label: candidate.displayName ?? candidate.name,
      version: null,
      status: "PENDING",
      risk: null,
      provenance: "LOCAL_WORKSPACE_CANDIDATE_BUNDLE",
      source: { path: candidate.sourcePath, line: candidate.startLine },
      details: {
        workspace: analysis.workspaceName,
        module: candidate.modulePath,
        governanceStatus: "PENDING_REVIEW",
        governedFeatureId: null,
      },
    },
    {
      id: claimId,
      type: "CANDIDATE_CLAIM",
      label: "Candidate behavior description",
      version: null,
      status: "PENDING",
      risk: null,
      provenance: "LOCAL_WORKSPACE_CANDIDATE_BUNDLE",
      source: { path: candidate.sourcePath, line: candidate.startLine },
      details: { description: candidate.description, authority: "NONE" },
    },
    {
      id: implementationFactId,
      type: candidate.kind,
      label: `${candidate.sourcePath}:${candidate.startLine}`,
      version: null,
      status: "ACTIVE",
      risk: null,
      provenance: "LOCAL_WORKSPACE_SNAPSHOT_FACT",
      source: { path: candidate.sourcePath, line: candidate.startLine },
      details: { module: candidate.modulePath, snapshotManifestId },
    },
    ...candidate.configurations.slice(0, 6).map((configuration) => ({
      id: configuration.factId,
      type: "CONFIGURATION",
      label: configuration.key,
      version: null,
      status: "ACTIVE" as const,
      risk: null,
      provenance: "LOCAL_WORKSPACE_SNAPSHOT_FACT",
      source: { path: configuration.path },
      details: { clueOnly: true },
    })),
    ...candidate.tests.slice(0, 8).map((test) => ({
      id: test.factId,
      type: "TEST_ASSET",
      label: test.title,
      version: null,
      status: "ACTIVE" as const,
      risk: null,
      provenance: "LOCAL_WORKSPACE_SNAPSHOT_FACT",
      source: { path: test.path },
      details: { clueOnly: true, governedTestSpecId: null },
    })),
    ...candidate.gaps.map((gap) => ({
      id: localWorkspaceDerivedId("TRACE-GAP", `${candidate.id}\u0000${gap.type}\u0000${gap.ownerRole}`),
      type: "TRACE_GAP",
      label: gap.type,
      version: null,
      status: "GAP" as const,
      risk: gap.severity,
      provenance: "LOCAL_WORKSPACE_TRACE_EVALUATION",
      source: null,
      details: { ownerRole: gap.ownerRole },
    })),
  ];
  const edges: LocalWorkspaceGraphEdge[] = [];
  const addEdge = (source: string, target: string, type: string) => edges.push({
    id: localWorkspaceDerivedId("TRACE-EDGE", `${source}\u0000${type}\u0000${target}`),
    source,
    target,
    type,
    provenance: "LOCAL_WORKSPACE_CANONICAL_PROJECTION",
    status: "PENDING",
    snapshotManifestId,
  });
  addEdge(candidate.id, claimId, "PROPOSES");
  addEdge(candidate.id, implementationFactId, "SUPPORTED_BY");
  addEdge(claimId, implementationFactId, "SUPPORTED_BY");
  for (const configuration of candidate.configurations.slice(0, 6)) {
    addEdge(candidate.id, configuration.factId, "SUPPORTED_BY");
  }
  for (const test of candidate.tests.slice(0, 8)) {
    addEdge(candidate.id, test.factId, "OBSERVED_WITH");
  }
  for (const gap of nodes.filter((node) => node.type === "TRACE_GAP")) {
    addEdge(candidate.id, gap.id, "HAS_GAP");
  }

  const allowedTypes: Record<LocalWorkspaceGraphView, Set<string> | null> = {
    traceability: null,
    business: new Set(["CANDIDATE_FEATURE", "CANDIDATE_CLAIM", "TRACE_GAP"]),
    implementation: new Set(["CANDIDATE_FEATURE", candidate.kind, "CONFIGURATION", "TRACE_GAP"]),
    coverage: new Set(["CANDIDATE_FEATURE", "TEST_ASSET", "TRACE_GAP"]),
  };
  const allowed = allowedTypes[view];
  const visibleNodes = allowed ? nodes.filter((node) => allowed.has(node.type)) : nodes;
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  for (const node of visibleNodes.filter((item) => item.id !== candidate.id && !visibleEdges.some((edge) => edge.target === item.id))) {
    addEdge(candidate.id, node.id, "PROJECTS");
    visibleEdges.push(edges.at(-1) as LocalWorkspaceGraphEdge);
  }
  return {
    center: candidate.id,
    snapshotManifestId,
    view,
    depth: 8,
    nodes: visibleNodes,
    edges: visibleEdges,
    truncated: candidate.configurations.length > 6 || candidate.tests.length > 8,
    availableExpansions: [],
  };
}
