import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  buildFeatureDetail,
  buildGraphInspector,
  featureDetailTabs,
} from "../app/traceability-view-model.ts";
import {
  getFeatureGraph,
  getFeatureTraceability,
  queryFeatureGraphPath,
} from "../app/understanding-graph-client.ts";

const snapshotId = "SNAPSHOT-001";
const revisionId = "REVISION-001";

const traceability = {
  feature: { id: "FEATURE-001", version: 2, name: "Checkout" },
  snapshotManifest: { id: snapshotId, source: { id: "SOURCE-001", digest: `sha256:${"a".repeat(64)}` } },
  processModel: { designElements: [{ id: "DESIGN-001", name: "Checkout design", type: "COMPONENT" }] },
  processImplementationFacts: [],
  claims: [{
    claim: { id: "CLAIM-001", version: 1, statement: "Orders can be submitted" },
    scope: { id: "SCOPE-001", version: 1 },
    latestDecision: { id: "DECISION-001", type: "CONFIRM", status: "CONFIRMED" },
    decisionHistory: [],
    authorityStatus: "CONFIRMED",
    implementationMappings: [{ id: "MAPPING-001", snapshotManifestId: snapshotId, status: "ACTIVE" }],
    selectedImplementationMapping: { id: "MAPPING-001", snapshotManifestId: snapshotId, status: "ACTIVE" },
    facts: { nodes: [{ id: "ENDPOINT-001", type: "ENDPOINT", name: "POST /orders", source: { path: "src/orders.ts", startLine: 10, endLine: 18 }, sourceDigest: `sha256:${"b".repeat(64)}` }], edges: [], missingFactRefs: [] },
    conformance: { id: "CONFORMANCE-001", status: "CONFORMS" },
    testSpecs: [{ id: "TEST-SPEC-001", version: 3, name: "Submit order", approved: true }],
    selectedTestSpec: { id: "TEST-SPEC-001", version: 3, name: "Submit order", approved: true },
    execution: { id: "EXECUTION-001", testSpecId: "TEST-SPEC-001", testSpecVersion: 3, snapshotManifestId: snapshotId, status: "PASS" },
    evidence: [{ id: "EVIDENCE-001", executionId: "EXECUTION-001", type: "HTTP", freshness: "STALE", integrity: "VERIFIED", contentHash: `sha256:${"c".repeat(64)}`, manifest: { snapshotManifestId: snapshotId } }],
    traceChain: { id: "TRACE-001", complete: false, dimensions: { authority: "CONFIRMED", verification: "PASS", freshness: "STALE", conflict: "NONE" }, conflicts: [], gaps: [{ type: "EVIDENCE_STALE", severity: "WARNING", ownerRole: "quality-owner", message: "Evidence is stale" }] },
  }],
  dimensions: {},
  traceChains: [],
  gaps: [{ chainId: "TRACE-001", type: "EVIDENCE_STALE", severity: "WARNING", ownerRole: "quality-owner", message: "Evidence is stale" }],
  persisted: [],
  computedAt: "2026-08-05T00:00:00.000Z",
};

const graph = {
  center: "FEATURE-001",
  snapshotManifestId: snapshotId,
  view: "traceability",
  depth: 2,
  nodes: [
    { id: "FEATURE-001", type: "FEATURE", label: "Checkout", version: 2, status: "ACTIVE", provenance: "GOVERNED_BASELINE", source: null, details: {} },
    { id: "ENDPOINT-001", type: "ENDPOINT", label: "POST /orders", version: null, status: "STALE", provenance: "DETERMINISTIC_FACT", source: { path: "src/orders.ts", startLine: 10 }, details: {} },
    { id: "GAP-001", type: "TRACE_GAP", label: "Missing verification", version: null, status: "GAP", provenance: "TRACE_CHAIN_EVALUATION", source: null, details: {} },
    { id: "CONFLICT-001", type: "CONFLICT", label: "Conflicting implementation", version: null, status: "CONFLICTED", provenance: "CONFLICT_ANALYSIS", source: null, details: {} },
  ],
  edges: [{ id: "EDGE-001", source: "FEATURE-001", target: "ENDPOINT-001", type: "IMPLEMENTED_BY", provenance: "DETERMINISTIC_FACT", status: "STALE", snapshotManifestId: snapshotId }],
  truncated: true,
  availableExpansions: [{ relation: "VERIFIED_BY", nodeType: "EVIDENCE", count: 1 }],
};

async function startFixtureServer(t) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body });
    response.setHeader("content-type", "application/json");
    if (request.method === "POST") response.end(JSON.stringify({ ...graph, query: JSON.parse(body), found: true, hopCount: 1 }));
    else if (request.url.includes("/traceability?")) response.end(JSON.stringify(traceability));
    else response.end(JSON.stringify(graph));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}

test("F002 executes every detail tab against server traceability and preserves explicit stale/missing object identities", async (t) => {
  const { baseUrl } = await startFixtureServer(t);
  const response = await getFeatureTraceability(baseUrl, "", "WORKSPACE-001", "FEATURE-001", snapshotId);
  const detail = buildFeatureDetail(response, null, {
    workspaceId: "WORKSPACE-001",
    featureId: "FEATURE-001",
    snapshotManifestId: snapshotId,
    graphRevisionId: revisionId,
    historical: true,
  });

  assert.deepEqual(featureDetailTabs, ["overview", "evidence", "relations", "gaps", "history"]);
  for (const tab of featureDetailTabs) assert.ok(detail[tab]);
  assert.equal(detail.readOnly, true);
  assert.ok(detail.evidence.items.some((item) => item.objectType === "TEST_SPEC"));
  assert.ok(detail.evidence.items.some((item) => item.objectType === "TEST_EXECUTION"));
  assert.ok(detail.evidence.items.some((item) => item.objectType === "VERIFICATION_RESULT" && item.status === "MISSING"));
  assert.ok(detail.evidence.items.some((item) => item.objectType === "EVIDENCE" && item.status === "STALE"));
  assert.ok(detail.evidence.items.every((item) => item.resolver.includes(snapshotId)));
  assert.ok(detail.gaps.items.some((item) => item.status === "STALE"));
});

test("F003 executes bounded graph and path APIs and exposes evidence for every edge and hop", async (t) => {
  const { baseUrl, requests } = await startFixtureServer(t);
  const projection = await getFeatureGraph(baseUrl, "", "WORKSPACE-001", "FEATURE-001", snapshotId, { depth: 2, limit: 30, view: "traceability" });
  const path = await queryFeatureGraphPath(baseUrl, "", "WORKSPACE-001", "FEATURE-001", {
    snapshotManifestId: snapshotId,
    fromNodeId: "FEATURE-001",
    toNodeId: "ENDPOINT-001",
    direction: "ANY",
    maxDepth: 6,
    view: "traceability",
  });
  const inspector = buildGraphInspector(projection, path, {
    workspaceId: "WORKSPACE-001",
    featureId: "FEATURE-001",
    snapshotManifestId: snapshotId,
    graphRevisionId: revisionId,
    historical: false,
  });

  assert.match(requests[0].url, /depth=2/);
  assert.equal(requests[1].method, "POST");
  assert.equal(inspector.coverage, "BOUNDED_LIMIT_REACHED");
  assert.ok(inspector.nodes.some((node) => node.authority === "GAP" && node.evidenceStatus === "MISSING"));
  assert.ok(inspector.nodes.some((node) => node.authority === "CONFLICT" && node.evidenceStatus === "CONFLICTED"));
  assert.equal(inspector.edges[0].status, "STALE");
  assert.match(inspector.edges[0].resolver, /EDGE-001/);
  assert.equal(inspector.hops.length, 1);
  assert.match(inspector.hops[0].resolver, /EDGE-001/);
  assert.equal(inspector.hops[0].snapshotManifestId, snapshotId);
  assert.equal(inspector.hops[0].graphRevisionId, revisionId);

  const noPath = buildGraphInspector({ ...projection, truncated: false }, { ...path, found: false, nodes: [], edges: [], hopCount: null }, {
    workspaceId: "WORKSPACE-001",
    featureId: "FEATURE-001",
    snapshotManifestId: snapshotId,
    graphRevisionId: revisionId,
    historical: false,
  });
  assert.equal(noPath.found, false);
  assert.equal(noPath.coverage, "COMPLETE_WITHIN_BOUND");
  assert.deepEqual(noPath.hops, []);
});
