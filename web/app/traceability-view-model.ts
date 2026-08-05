import type {
  FeatureGraphEdge,
  FeatureGraphNode,
  FeatureGraphPathResult,
  FeatureGraphProjection,
  FeatureTraceability,
  FeatureUnderstandingHistory,
} from "./understanding-graph-client";

export const featureDetailTabs = ["overview", "evidence", "relations", "gaps", "history"] as const;
export type FeatureDetailTab = typeof featureDetailTabs[number];
export type EvidenceStatus = "VERIFIED" | "MISSING" | "STALE" | "CONFLICTED" | "INVALID" | "NOT_APPLICABLE";

export type ImmutableContext = {
  workspaceId: string;
  featureId: string;
  selectedObjectId?: string;
  snapshotManifestId: string;
  graphRevisionId: string;
  historical: boolean;
};

export type EvidenceItem = {
  id: string;
  objectType: string;
  title: string;
  status: EvidenceStatus;
  authority: string;
  resolver: string;
  workspaceId: string;
  snapshotManifestId: string;
  graphRevisionId: string;
  sourceLocation: string | null;
  digest: string | null;
  details: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function identity(value: Record<string, unknown>, fallback: string) {
  return text(value.id, fallback);
}

function immutableResolver(context: ImmutableContext, objectType: string, id: string, executionId?: string) {
  const base = `/v1/projects/${encodeURIComponent(context.workspaceId)}/graph/revisions/${encodeURIComponent(context.graphRevisionId)}/evidence/objects/${encodeURIComponent(id)}`;
  const query = new URLSearchParams({
    snapshotManifestId: context.snapshotManifestId,
    featureId: context.featureId,
    rootNodeId: context.selectedObjectId ?? context.featureId,
    objectType,
  });
  if (objectType === "EVIDENCE" && executionId) {
    query.set("executionId", executionId);
  }
  return `${base}?${query}`;
}

function sourceLocation(value: Record<string, unknown>) {
  const source = record(value.source);
  const nestedSource = record(record(value.details).source);
  const candidate = Object.keys(source).length ? source : nestedSource;
  const path = text(candidate.path, text(candidate.file, text(value.path)));
  if (!path) return null;
  const start = candidate.startLine ?? candidate.line ?? value.startLine;
  const end = candidate.endLine ?? value.endLine;
  return `${path}${start ? `:${start}${end && end !== start ? `-${end}` : ""}` : ""}`;
}

function digest(value: Record<string, unknown>) {
  const details = record(value.details);
  return text(value.contentHash, text(value.sourceDigest, text(value.digest, text(details.contentHash, text(details.sourceDigest))))) || null;
}

export function evidenceStatus(...values: unknown[]): EvidenceStatus {
  const state = values.map((value) => String(value ?? "")).join(" ").toUpperCase();
  if (/NOT_APPLICABLE|NOT APPLICABLE/.test(state)) return "NOT_APPLICABLE";
  if (/CONFLICT|UNRESOLVED/.test(state)) return "CONFLICTED";
  if (/INVALID|ERROR|FAIL|REJECTED|DEVIATES/.test(state)) return "INVALID";
  if (/STALE|EXPIRING/.test(state)) return "STALE";
  if (/MISSING|UNMAPPED|UNKNOWN|NOT_RUN|INCOMPLETE|UNVERIFIED|PENDING|UNREVIEWED|SKIPPED|CANCELLED|GAP/.test(state) || !state.trim()) return "MISSING";
  if (/VERIFIED|ACTIVE|PASS|CONFIRMED|CONFORMS|FRESH|APPROVED|NONE/.test(state)) return "VERIFIED";
  return "MISSING";
}

function authority(value: Record<string, unknown>, fallback = "SERVER_DERIVED") {
  return text(value.authorityStatus, text(value.authority, text(value.provenance, fallback)));
}

function item(
  context: ImmutableContext,
  objectType: string,
  value: Record<string, unknown>,
  options: { fallbackId?: string; title?: string; status?: EvidenceStatus; executionId?: string; authority?: string } = {},
): EvidenceItem {
  const id = identity(value, options.fallbackId ?? `${objectType}-MISSING`);
  return {
    id,
    objectType,
    title: options.title ?? text(value.name, text(value.title, text(value.statement, text(value.type, id)))),
    status: options.status ?? evidenceStatus(value.freshness, value.integrity, value.status, value.authorityStatus, value.approved),
    authority: options.authority ?? authority(value),
    resolver: immutableResolver(context, objectType, id, options.executionId ?? text(value.executionId)),
    workspaceId: context.workspaceId,
    snapshotManifestId: text(value.snapshotManifestId, text(record(value.manifest).snapshotManifestId, context.snapshotManifestId)),
    graphRevisionId: context.graphRevisionId,
    sourceLocation: sourceLocation(value),
    digest: digest(value),
    details: value,
  };
}

const requiredTypes = [
  "REQUIREMENT",
  "DESIGN",
  "IMPLEMENTATION_MAPPING",
  "IMPLEMENTATION",
  "DATA",
  "CONFIGURATION",
  "TEST_FILE",
  "TEST_SPEC",
  "TEST_EXECUTION",
  "VERIFICATION_RESULT",
  "DECISION",
  "EVIDENCE",
] as const;

function factObjectType(value: Record<string, unknown>) {
  const type = text(value.type).toUpperCase();
  const path = text(record(value.source).path, text(value.path)).toUpperCase();
  if (/TEST_FILE|TEST_SOURCE|TEST_FIXTURE/.test(type) || /(^|\/)TESTS?\//.test(path)) return "TEST_FILE";
  if (/DATA|TABLE|SCHEMA|COLUMN|DATABASE/.test(type)) return "DATA";
  if (/CONFIG|ENVIRONMENT|PROPERTY/.test(type)) return "CONFIGURATION";
  return "IMPLEMENTATION";
}

function buildEvidenceItems(traceability: FeatureTraceability, context: ImmutableContext) {
  const items: EvidenceItem[] = [];
  const selectedObjectId = traceability.selection?.id ?? context.selectedObjectId ?? context.featureId;
  const selectedClaims = selectedObjectId === traceability.feature.id
    ? records(traceability.claims)
    : records(traceability.claims).filter((claimValue) => {
        const factNodes = records(record(claimValue.facts).nodes);
        const chainNodes = records(record(claimValue.traceChain).segments)
          .flatMap((segment) => [record(segment.from), record(segment.to)]);
        return [...factNodes, ...chainNodes].some((candidate) =>
          identity(candidate, text(candidate.factId)) === selectedObjectId || text(candidate.factId) === selectedObjectId);
      });
  for (const claimValue of selectedClaims) {
    const claim = record(claimValue.claim);
    items.push(item(context, "REQUIREMENT", claim, {
      status: evidenceStatus(claimValue.authorityStatus),
      authority: text(claimValue.authorityStatus, "UNREVIEWED"),
    }));
    const decision = record(claimValue.latestDecision);
    if (Object.keys(decision).length) items.push(item(context, "DECISION", decision, { status: evidenceStatus(decision.status, claimValue.authorityStatus), authority: "AUTHORIZED_HUMAN_DECISION" }));
    for (const mapping of records(claimValue.implementationMappings)) items.push(item(context, "IMPLEMENTATION_MAPPING", mapping));
    for (const fact of records(record(claimValue.facts).nodes)) items.push(item(context, factObjectType(fact), fact, { authority: "DETERMINISTIC_FACT" }));
    for (const spec of records(claimValue.testSpecs)) items.push(item(context, "TEST_SPEC", spec, { status: evidenceStatus(spec.approved ? "APPROVED" : "PENDING") }));
    const execution = record(claimValue.execution);
    if (Object.keys(execution).length) {
      items.push(item(context, "TEST_EXECUTION", execution, { authority: "ATTESTED_RUNNER" }));
      const attempts = records(execution.attempts);
      const results = attempts.flatMap((attempt) => records(attempt.assertionResults));
      for (const result of results) items.push(item(context, "VERIFICATION_RESULT", result, { fallbackId: `${identity(execution, "EXECUTION")}:RESULT`, authority: "ATTESTED_RUNNER" }));
    }
    for (const evidence of records(claimValue.evidence)) items.push(item(context, "EVIDENCE", evidence, { authority: text(evidence.integrity, "UNVERIFIED_EVIDENCE") }));
  }
  for (const design of records(traceability.processModel?.designElements)) items.push(item(context, "DESIGN", design, { authority: "AUTHORIZED_HUMAN_DECISION" }));
  for (const factGraph of traceability.processImplementationFacts ?? []) {
    for (const fact of records(factGraph.nodes)) items.push(item(context, factObjectType(fact), fact, { authority: "DETERMINISTIC_FACT" }));
  }
  for (const objectType of requiredTypes) {
    if (!items.some((candidate) => candidate.objectType === objectType)) {
      items.push(item(context, objectType, {}, {
        fallbackId: `${objectType}-MISSING`,
        title: `${objectType.replaceAll("_", " ")} unavailable in this immutable context`,
        status: "MISSING",
        authority: "UNAVAILABLE",
      }));
    }
  }
  return items;
}

function graphAuthority(provenance: string, type = "") {
  if (/GAP/.test(type)) return "GAP";
  if (/CONFLICT/.test(type)) return "CONFLICT";
  if (/CANDIDATE/.test(provenance)) return "CANDIDATE";
  if (/DETERMINISTIC/.test(provenance)) return "DETERMINISTIC_FACT";
  if (/GOVERNED|AUTHORIZED_HUMAN/.test(provenance)) return "GOVERNED";
  return "SERVER_DERIVED";
}

function graphResolver(context: ImmutableContext, kind: "node" | "edge", id: string) {
  const query = new URLSearchParams({
    snapshotManifestId: context.snapshotManifestId,
    depth: "8",
    limit: "100",
    featureId: context.featureId,
    rootNodeId: context.selectedObjectId ?? context.featureId,
  });
  return `/v1/projects/${encodeURIComponent(context.workspaceId)}/graph/revisions/${encodeURIComponent(context.graphRevisionId)}/evidence/${kind}s/${encodeURIComponent(id)}?${query}`;
}

function graphNode(node: FeatureGraphNode, context: ImmutableContext) {
  return {
    ...node,
    authority: graphAuthority(node.provenance, node.type),
    evidenceStatus: evidenceStatus(node.status),
    snapshotManifestId: context.snapshotManifestId,
    graphRevisionId: context.graphRevisionId,
    resolver: node.evidenceResolver ?? graphResolver(context, "node", node.id),
    sourceLocation: sourceLocation(node as unknown as Record<string, unknown>),
    digest: digest(node.details),
  };
}

function graphEdge(edge: FeatureGraphEdge, context: ImmutableContext) {
  return {
    ...edge,
    authority: graphAuthority(edge.provenance),
    evidenceStatus: evidenceStatus(edge.status),
    graphRevisionId: context.graphRevisionId,
    resolver: edge.evidenceResolver ?? graphResolver(context, "edge", edge.id),
  };
}

export function buildGraphInspector(
  graph: FeatureGraphProjection,
  path: FeatureGraphPathResult | null,
  context: ImmutableContext,
) {
  const nodes = graph.nodes.map((node) => graphNode(node, context));
  const edges = graph.edges.map((edge) => ({ ...graphEdge(edge, context), status: edge.status }));
  const pathNodes = new Map((path?.nodes ?? []).map((node) => [node.id, node]));
  const hops = (path?.edges ?? []).map((edge, index) => ({
    ...graphEdge(edge, context),
    status: edge.status,
    hop: index + 1,
    sourceNode: pathNodes.get(edge.source) ?? null,
    targetNode: pathNodes.get(edge.target) ?? null,
  }));
  return {
    nodes,
    edges,
    hops,
    found: path?.found ?? null,
    coverage: graph.truncated ? "BOUNDED_LIMIT_REACHED" : "COMPLETE_WITHIN_BOUND",
    availableExpansions: graph.availableExpansions,
  };
}

export function buildFeatureDetail(
  traceability: FeatureTraceability,
  graph: FeatureGraphProjection | null,
  context: ImmutableContext,
  history: FeatureUnderstandingHistory | null = null,
) {
  const evidenceItems = buildEvidenceItems(traceability, context);
  const relationItems = graph
    ? buildGraphInspector(graph, null, context).edges
    : records(traceability.claims).flatMap((claim) => records(record(claim.traceChain).segments)).map((segment) => ({
      id: identity(segment, "RELATION-MISSING-ID"),
      source: text(record(segment.from).id),
      target: text(record(segment.to).id),
      type: text(segment.relation, "RELATION"),
      provenance: text(segment.provenance, "SERVER_DERIVED"),
      status: text(segment.status, "PENDING"),
      snapshotManifestId: context.snapshotManifestId,
      graphRevisionId: context.graphRevisionId,
      resolver: graphResolver(context, "edge", identity(segment, "RELATION-MISSING-ID")),
    }));
  const gaps = [
    ...records(traceability.gaps).map((gap) => ({ ...gap, id: identity(gap, `${text(gap.chainId, "CHAIN")}:${text(gap.type, "GAP")}`), status: evidenceStatus(gap.type, gap.status) })),
    ...records(traceability.claims).flatMap((claim) => records(record(claim.traceChain).conflicts)).map((conflict) => ({ ...conflict, id: identity(conflict, "CONFLICT"), status: "CONFLICTED" as EvidenceStatus })),
  ];
  const featureVersions = history?.featureVersions ?? [traceability.feature as FeatureUnderstandingHistory["feature"]];
  return {
    readOnly: context.historical,
    context,
    overview: {
      feature: traceability.feature,
      selectedObject: traceability.selection ?? traceability.feature,
      snapshotManifest: traceability.snapshotManifest,
      computedAt: traceability.computedAt,
      traceChains: records(traceability.claims).map((claim) => record(claim.traceChain)),
      statusCounts: evidenceItems.reduce<Record<EvidenceStatus, number>>((counts, current) => {
        counts[current.status] += 1;
        return counts;
      }, { VERIFIED: 0, MISSING: 0, STALE: 0, CONFLICTED: 0, INVALID: 0, NOT_APPLICABLE: 0 }),
    },
    evidence: { items: evidenceItems },
    relations: { items: relationItems },
    gaps: { items: gaps },
    history: {
      featureVersions: traceability.selection?.id !== traceability.feature.id && history?.selectionHistory
        ? history.selectionHistory
        : featureVersions,
      decisions: history?.decisions ?? [],
      implementationMappings: history?.implementationMappings ?? [],
      graphRevisions: history?.graphRevisions ?? [],
      testSpecs: history?.testSpecs ?? [],
      testExecutions: history?.testExecutions ?? [],
      mode: context.historical ? "HISTORICAL_READ_ONLY" : "CURRENT_PUBLISHED",
    },
  };
}
