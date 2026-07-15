import { contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

const graphViews = Object.freeze({
  traceability: null,
  business: new Set([
    "FEATURE",
    "CLAIM",
    "CLAIM_SCOPE",
    "DECISION",
    "ACTOR_ROLE",
    "BUSINESS_STATE",
    "STATE_TRANSITION",
    "DESIGN_ELEMENT",
    "CONFLICT",
    "TRACE_GAP",
  ]),
  implementation: new Set([
    "FEATURE",
    "CLAIM",
    "IMPLEMENTATION_CONFORMANCE",
    "ENDPOINT",
    "CODE_SYMBOL",
    "DATA_OBJECT",
    "CONFIGURATION",
    "EXTERNAL_DEPENDENCY",
    "CONFLICT",
    "TRACE_GAP",
  ]),
  coverage: new Set([
    "FEATURE",
    "CLAIM",
    "TEST_SPEC",
    "TEST_ASSERTION",
    "TEST_EXECUTION",
    "EVIDENCE",
    "CONFLICT",
    "TRACE_GAP",
  ]),
});

const statusRank = Object.freeze({ ACTIVE: 0, PENDING: 1, STALE: 2, CONFLICTED: 3, GAP: 4 });

function positiveInteger(value, fallback, fieldName, maximum) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${fieldName} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function requireStringArray(value, fieldName) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new TypeError(`${fieldName} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))].sort();
}

function compactDetails(value) {
  if (value === null || value === undefined) return {};
  return structuredClone(value);
}

function mergeStatus(current = "ACTIVE", candidate = "ACTIVE") {
  return (statusRank[candidate] ?? 0) > (statusRank[current] ?? 0) ? candidate : current;
}

function nodeLabel(type, value, fallback) {
  if (type === "FEATURE") return value?.name ?? fallback;
  if (type === "CLAIM") return value?.statement ?? fallback;
  if (type === "CLAIM_SCOPE") return value?.scope ? JSON.stringify(value.scope) : fallback;
  if (type === "DECISION") return value?.type ?? fallback;
  if (type === "IMPLEMENTATION_CONFORMANCE") return value?.status ?? fallback;
  if (type === "TEST_SPEC") return value?.name ?? fallback;
  if (type === "TEST_ASSERTION") return value?.type ?? value?.id ?? fallback;
  if (type === "TEST_EXECUTION") return value?.status ?? fallback;
  if (type === "EVIDENCE") return value?.type ? `${value.type} · ${value.id}` : fallback;
  if (type === "ACTOR_ROLE") return `${value?.name ?? fallback} · ${value?.role ?? "role"}`;
  if (type === "BUSINESS_STATE") return `${value?.name ?? fallback} · ${value?.kind ?? "state"}`;
  if (type === "STATE_TRANSITION") return value?.name ?? value?.trigger ?? fallback;
  if (type === "DESIGN_ELEMENT") return `${value?.name ?? fallback} · ${value?.type ?? "design"}`;
  return value?.name ?? value?.naturalKey ?? fallback;
}

function metadataIndex(traceability) {
  const index = new Map();
  const put = (type, value, options = {}) => {
    const id = value?.id ?? value?.factId;
    if (!id) return;
    index.set(id, {
      type,
      label: nodeLabel(type, value, id),
      version: value?.version ?? null,
      status: options.status ?? "ACTIVE",
      provenance: options.provenance ?? "SERVER_DERIVED",
      risk: options.risk ?? null,
      source: options.source ?? value?.source ?? null,
      details: compactDetails(value),
    });
  };

  put("FEATURE", traceability.feature, { provenance: "GOVERNED_BASELINE" });
  const processModel = traceability.processModel;
  for (const actor of processModel?.actors ?? []) put("ACTOR_ROLE", actor, { provenance: "AUTHORIZED_HUMAN_DECISION" });
  for (const state of processModel?.states ?? []) put("BUSINESS_STATE", state, { provenance: "AUTHORIZED_HUMAN_DECISION" });
  for (const transition of processModel?.transitions ?? []) {
    put("STATE_TRANSITION", transition, { provenance: "AUTHORIZED_HUMAN_DECISION" });
  }
  for (const designElement of processModel?.designElements ?? []) {
    put("DESIGN_ELEMENT", designElement, { provenance: "AUTHORIZED_HUMAN_DECISION" });
  }
  for (const factGraph of traceability.processImplementationFacts ?? []) {
    for (const fact of factGraph.nodes ?? []) {
      put(fact.type, fact, {
        provenance: "DETERMINISTIC_FACT",
        status: factGraph.snapshotManifestId === traceability.snapshotManifest?.id ? "ACTIVE" : "STALE",
      });
    }
  }
  for (const claimView of traceability.claims ?? []) {
    put("CLAIM", claimView.claim, { provenance: claimView.claim?.sourceType ?? "GOVERNED_BASELINE" });
    put("CLAIM_SCOPE", claimView.scope, { provenance: "GOVERNED_BASELINE" });
    put("DECISION", claimView.latestDecision, { provenance: "AUTHORIZED_HUMAN_DECISION" });
    put("IMPLEMENTATION_CONFORMANCE", claimView.conformance, {
      status: claimView.conformance?.status === "STALE" ? "STALE" : "ACTIVE",
      provenance: claimView.conformance?.analysisMethod?.type ?? "CONFORMANCE_ASSESSMENT",
    });
    for (const fact of claimView.facts?.nodes ?? []) put(fact.type, fact, { provenance: "DETERMINISTIC_FACT" });
    for (const testSpec of claimView.testSpecs ?? []) {
      put("TEST_SPEC", testSpec, {
        status: testSpec.approved ? "ACTIVE" : "PENDING",
        provenance: testSpec.origin?.type ?? "GOVERNED_TEST_SPEC",
      });
      for (const [indexValue, assertion] of (testSpec.assertions ?? []).entries()) {
        const normalized = typeof assertion === "object" && assertion !== null
          ? assertion
          : { id: `${testSpec.id}:ASSERTION:${indexValue + 1}`, type: String(assertion) };
        put("TEST_ASSERTION", normalized, { provenance: "DETERMINISTIC_ASSERTION" });
      }
    }
    put("TEST_EXECUTION", claimView.execution, {
      status: claimView.execution?.status === "PASS" ? "ACTIVE" : claimView.execution ? "PENDING" : "ACTIVE",
      provenance: "ATTESTED_RUNNER",
    });
    for (const evidence of claimView.evidence ?? []) {
      put("EVIDENCE", evidence, {
        status: evidence.freshness === "STALE" ? "STALE" : "ACTIVE",
        provenance: evidence.integrity === "VERIFIED" ? "VERIFIED_EVIDENCE" : "UNVERIFIED_EVIDENCE",
      });
    }
  }
  return index;
}

function addGraphNode(nodes, metadata, reference, segment) {
  const id = requireNonEmptyString(reference?.id, "graph node reference id");
  const type = requireNonEmptyString(reference?.type, "graph node reference type");
  const known = metadata.get(id);
  const status = mergeStatus(known?.status, segment?.status);
  const next = {
    id,
    type,
    label: known?.label ?? id,
    version: known?.version ?? reference.version ?? null,
    status,
    risk: known?.risk ?? null,
    provenance: known?.provenance ?? segment?.provenance ?? "SERVER_DERIVED",
    source: known?.source ?? null,
    details: known?.details ?? {},
  };
  const existing = nodes.get(id);
  if (existing && existing.type !== type) {
    throw new TypeError(`graph node ${id} has conflicting types ${existing.type} and ${type}`);
  }
  nodes.set(id, existing ? { ...existing, status: mergeStatus(existing.status, next.status) } : next);
}

function buildCompleteGraph(traceability) {
  const metadata = metadataIndex(traceability);
  const nodes = new Map();
  const edges = new Map();
  const snapshotManifestId = requireNonEmptyString(traceability.snapshotManifest?.id, "snapshotManifest.id");

  for (const chain of traceability.traceChains ?? []) {
    for (const segment of chain.segments ?? []) {
      addGraphNode(nodes, metadata, segment.from, segment);
      addGraphNode(nodes, metadata, segment.to, segment);
      edges.set(segment.id, {
        id: segment.id,
        source: segment.from.id,
        target: segment.to.id,
        type: segment.relation,
        provenance: segment.provenance,
        status: segment.status,
        snapshotManifestId,
      });
    }
    for (const conflict of chain.conflicts ?? []) {
      const conflictId = conflict.id;
      nodes.set(conflictId, {
        id: conflictId,
        type: "CONFLICT",
        label: conflict.reason ?? conflict.type,
        version: null,
        status: "CONFLICTED",
        risk: "BLOCKING",
        provenance: "CONFLICT_ANALYSIS",
        source: null,
        details: compactDetails(conflict),
      });
      const edgeId = contentId("GRAPH-EDGE", { source: chain.claimId, type: "CONFLICTS_WITH", target: conflictId });
      edges.set(edgeId, {
        id: edgeId,
        source: chain.claimId,
        target: conflictId,
        type: "CONFLICTS_WITH",
        provenance: "CONFLICT_ANALYSIS",
        status: "ACTIVE",
        snapshotManifestId,
      });
    }
    for (const gap of chain.gaps ?? []) {
      const gapId = `TRACE-GAP:${chain.id}:${gap.type}`;
      nodes.set(gapId, {
        id: gapId,
        type: "TRACE_GAP",
        label: gap.type,
        version: null,
        status: "GAP",
        risk: gap.severity,
        provenance: "TRACE_CHAIN_EVALUATION",
        source: null,
        details: compactDetails(gap),
      });
      const edgeId = contentId("GRAPH-EDGE", { source: chain.claimId, type: "HAS_GAP", target: gapId });
      edges.set(edgeId, {
        id: edgeId,
        source: chain.claimId,
        target: gapId,
        type: "HAS_GAP",
        provenance: "TRACE_CHAIN_EVALUATION",
        status: "ACTIVE",
        snapshotManifestId,
      });
    }
  }
  const featureId = requireNonEmptyString(traceability.feature?.id, "feature.id");
  if (!nodes.has(featureId)) addGraphNode(nodes, metadata, { id: featureId, type: "FEATURE", version: null });
  const addProcessEdge = (source, type, target, status = "ACTIVE") => {
    const id = contentId("GRAPH-EDGE", { source, type, target });
    edges.set(id, {
      id,
      source,
      target,
      type,
      provenance: "AUTHORIZED_HUMAN_DECISION",
      status,
      snapshotManifestId,
    });
  };
  const processModel = traceability.processModel;
  if (processModel) {
    for (const actor of processModel.actors) {
      addGraphNode(nodes, metadata, { id: actor.id, type: "ACTOR_ROLE" });
      addProcessEdge(featureId, "HAS_ROLE", actor.id);
    }
    for (const state of processModel.states) {
      addGraphNode(nodes, metadata, { id: state.id, type: "BUSINESS_STATE" });
      addProcessEdge(featureId, "HAS_STATE", state.id);
    }
    for (const transition of processModel.transitions) {
      addGraphNode(nodes, metadata, { id: transition.id, type: "STATE_TRANSITION" });
      addProcessEdge(transition.fromStateId, "HAS_TRANSITION", transition.id);
      addProcessEdge(transition.id, "TRANSITIONS_TO", transition.toStateId);
      for (const actorId of transition.actorIds) addProcessEdge(actorId, "PERFORMS", transition.id);
      for (const reference of transition.implementationFactRefs) {
        const known = metadata.get(reference.factId);
        if (!known) continue;
        addGraphNode(nodes, metadata, { id: reference.factId, type: known.type });
        addProcessEdge(
          transition.id,
          "IMPLEMENTED_BY",
          reference.factId,
          reference.snapshotManifestId === snapshotManifestId ? "ACTIVE" : "STALE",
        );
      }
    }
    for (const designElement of processModel.designElements) {
      addGraphNode(nodes, metadata, { id: designElement.id, type: "DESIGN_ELEMENT" });
      addProcessEdge(featureId, "DESIGNED_BY", designElement.id);
      for (const reference of designElement.implementationFactRefs) {
        const known = metadata.get(reference.factId);
        if (!known) continue;
        addGraphNode(nodes, metadata, { id: reference.factId, type: known.type });
        addProcessEdge(
          designElement.id,
          "IMPLEMENTED_BY",
          reference.factId,
          reference.snapshotManifestId === snapshotManifestId ? "ACTIVE" : "STALE",
        );
      }
    }
  }
  return { center: featureId, snapshotManifestId, nodes, edges };
}

function viewFilteredGraph(graph, view, nodeTypes, relations) {
  const allowedByView = graphViews[view];
  const explicitTypes = new Set(nodeTypes);
  const allowedNode = (node) =>
    (allowedByView === null || allowedByView.has(node.type)) &&
    (explicitTypes.size === 0 || explicitTypes.has(node.type) || node.id === graph.center);
  const nodes = new Map([...graph.nodes].filter(([, node]) => allowedNode(node)));
  const explicitRelations = new Set(relations);
  const edges = new Map([...graph.edges].filter(([, edge]) =>
    nodes.has(edge.source) &&
    nodes.has(edge.target) &&
    (explicitRelations.size === 0 || explicitRelations.has(edge.type))));
  return { ...graph, nodes, edges };
}

function boundedBreadthFirst(graph, depth, limit) {
  const adjacency = new Map();
  for (const edge of graph.edges.values()) {
    const source = adjacency.get(edge.source) ?? [];
    source.push({ nodeId: edge.target, edge });
    adjacency.set(edge.source, source);
    const target = adjacency.get(edge.target) ?? [];
    target.push({ nodeId: edge.source, edge });
    adjacency.set(edge.target, target);
  }
  for (const entries of adjacency.values()) {
    entries.sort((left, right) => left.edge.type.localeCompare(right.edge.type) || left.nodeId.localeCompare(right.nodeId));
  }
  const distances = new Map([[graph.center, 0]]);
  const queue = [graph.center];
  while (queue.length > 0) {
    const current = queue.shift();
    const currentDepth = distances.get(current);
    if (currentDepth >= depth) continue;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (distances.has(neighbor.nodeId)) continue;
      distances.set(neighbor.nodeId, currentDepth + 1);
      queue.push(neighbor.nodeId);
    }
  }
  const orderedIds = [...distances].sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
  const selectedIds = new Set(orderedIds.slice(0, limit).map(([id]) => id));
  const nodes = [...selectedIds].map((id) => graph.nodes.get(id)).filter(Boolean);
  const edges = [...graph.edges.values()].filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const expansionCounts = new Map();
  for (const edge of graph.edges.values()) {
    const visibleSource = selectedIds.has(edge.source);
    const visibleTarget = selectedIds.has(edge.target);
    if (visibleSource === visibleTarget) continue;
    const hiddenId = visibleSource ? edge.target : edge.source;
    const hidden = graph.nodes.get(hiddenId);
    const key = `${edge.type}\u0000${hidden?.type ?? "UNKNOWN"}`;
    expansionCounts.set(key, (expansionCounts.get(key) ?? 0) + 1);
  }
  const availableExpansions = [...expansionCounts].map(([key, count]) => {
    const [relation, nodeType] = key.split("\u0000");
    return { relation, nodeType, count };
  }).sort((left, right) => left.relation.localeCompare(right.relation) || left.nodeType.localeCompare(right.nodeType));
  return {
    nodes,
    edges,
    truncated: selectedIds.size < graph.nodes.size || orderedIds.length > limit,
    availableExpansions,
  };
}

export function createFeatureGraphProjection(traceability, options = {}) {
  if (traceability === null || typeof traceability !== "object" || Array.isArray(traceability)) {
    throw new TypeError("traceability must be an object");
  }
  const view = options.view ?? "traceability";
  if (!Object.hasOwn(graphViews, view)) {
    throw new TypeError(`view must be one of ${Object.keys(graphViews).join(", ")}`);
  }
  const depth = positiveInteger(options.depth, 1, "depth", 8);
  const limit = positiveInteger(options.limit, 30, "limit", 100);
  const nodeTypes = requireStringArray(options.nodeTypes, "nodeTypes");
  const relations = requireStringArray(options.relations, "relations");
  const complete = buildCompleteGraph(traceability);
  const filtered = viewFilteredGraph(complete, view, nodeTypes, relations);
  const bounded = boundedBreadthFirst(filtered, depth, limit);
  return deepFreeze({
    center: complete.center,
    snapshotManifestId: complete.snapshotManifestId,
    view,
    depth,
    nodes: bounded.nodes,
    edges: bounded.edges,
    truncated: bounded.truncated,
    availableExpansions: bounded.availableExpansions,
  });
}

export function queryFeatureGraphPath(graph, input) {
  if (graph === null || typeof graph !== "object" || Array.isArray(graph)) {
    throw new TypeError("graph must be an object");
  }
  const fromNodeId = requireNonEmptyString(input?.fromNodeId, "fromNodeId");
  const toNodeId = requireNonEmptyString(input?.toNodeId, "toNodeId");
  const direction = input?.direction ?? "ANY";
  if (!["ANY", "FORWARD", "REVERSE"].includes(direction)) {
    throw new TypeError("direction must be ANY, FORWARD, or REVERSE");
  }
  const maxDepth = positiveInteger(input?.maxDepth, 8, "maxDepth", 12);
  const nodes = new Map((graph.nodes ?? []).map((node) => [node.id, node]));
  if (!nodes.has(fromNodeId) || !nodes.has(toNodeId)) return deepFreeze({ found: false, nodes: [], edges: [], hopCount: null });
  const adjacency = new Map();
  const add = (from, to, edge) => {
    const items = adjacency.get(from) ?? [];
    items.push({ nodeId: to, edge });
    adjacency.set(from, items);
  };
  for (const edge of graph.edges ?? []) {
    if (direction !== "REVERSE") add(edge.source, edge.target, edge);
    if (direction !== "FORWARD") add(edge.target, edge.source, edge);
  }
  for (const items of adjacency.values()) items.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const queue = [fromNodeId];
  const previous = new Map([[fromNodeId, null]]);
  while (queue.length > 0 && !previous.has(toNodeId)) {
    const current = queue.shift();
    let currentDepth = 0;
    for (let cursor = current; previous.get(cursor); cursor = previous.get(cursor).nodeId) currentDepth += 1;
    if (currentDepth >= maxDepth) continue;
    for (const next of adjacency.get(current) ?? []) {
      if (previous.has(next.nodeId)) continue;
      previous.set(next.nodeId, { nodeId: current, edge: next.edge });
      queue.push(next.nodeId);
    }
  }
  if (!previous.has(toNodeId)) return deepFreeze({ found: false, nodes: [], edges: [], hopCount: null });
  const pathNodeIds = [];
  const pathEdges = [];
  for (let cursor = toNodeId; cursor !== null;) {
    pathNodeIds.push(cursor);
    const step = previous.get(cursor);
    if (!step) break;
    pathEdges.push(step.edge);
    cursor = step.nodeId;
  }
  pathNodeIds.reverse();
  pathEdges.reverse();
  return deepFreeze({
    found: true,
    nodes: pathNodeIds.map((id) => nodes.get(id)),
    edges: pathEdges,
    hopCount: pathEdges.length,
  });
}
