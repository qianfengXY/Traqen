import assert from "node:assert/strict";
import test from "node:test";

import {
  createFeatureGraphProjection,
  evaluateTraceChain,
  queryFeatureGraphPath,
} from "../src/domain/index.js";
import { completeInput, fixedClock } from "./fixtures.js";

function traceability({ currentExecution = true } = {}) {
  const fixture = completeInput();
  const endpoint = {
    id: "ENDPOINT-ORDER-SUBMIT",
    factId: "FACT-ENDPOINT-ORDER-SUBMIT",
    type: "ENDPOINT",
    name: "POST /orders/{id}/submit",
    source: { artifact: "src/orders.js", startLine: 80, endLine: 96, contentHash: `sha256:${"e".repeat(64)}` },
    extractor: { id: "SCANNER-001", version: "1.0.0" },
  };
  const testSpec = {
    ...fixture.testSpec,
    name: "Submit a draft order",
    verifiesClaims: [{ id: fixture.claim.id, version: fixture.claim.version }],
    assertions: [
      { id: "ASSERT-HTTP", type: "HTTP_STATUS", stepId: "invoke", expected: 200 },
      { id: "ASSERT-DATABASE", type: "DATABASE_FIELD", stepId: "read-order", field: "status", expected: "SUBMITTED" },
    ],
  };
  const claim = {
    ...fixture.claim,
    statement: "A normal user may submit only a draft order.",
    sourceType: "HUMAN",
  };
  const scope = { id: fixture.scope.id, version: 1, scope: { actor: "normal-user", state: "DRAFT" } };
  const decision = { id: "DECISION-001", type: "CONFIRMED", actorRole: "business-owner" };
  const execution = currentExecution ? fixture.execution : null;
  const evidence = currentExecution ? fixture.evidence.map((item) => ({
    ...item,
    type: "ASSERTION",
    integrity: "VERIFIED",
    freshness: "FRESH",
  })) : [];
  const input = {
    ...fixture,
    claim,
    decision,
    scope,
    implementation: { endpoints: [endpoint], codeSymbols: [], dataObjects: [], configurations: [], dependencies: [] },
    testSpec,
    execution,
    evidence,
  };
  const chain = evaluateTraceChain(input, fixedClock);
  return {
    feature: { ...fixture.feature, version: 1 },
    snapshotManifest: fixture.snapshotManifest,
    claims: [{
      claim,
      scope,
      latestDecision: decision,
      conformance: fixture.conformance,
      facts: { nodes: [endpoint], edges: [], missingFactRefs: [] },
      testSpecs: [testSpec],
      execution,
      evidence,
      traceChain: chain,
    }],
    traceChains: [chain],
  };
}

test("Feature graph projection uses the same governed chain and exposes progressive expansion", () => {
  const initial = createFeatureGraphProjection(traceability());
  assert.equal(initial.depth, 1);
  assert.deepEqual(initial.nodes.map((node) => node.type).sort(), ["CLAIM", "FEATURE"]);
  assert.equal(initial.truncated, true);
  assert.ok(initial.availableExpansions.some((item) => item.nodeType === "TEST_SPEC"));

  const full = createFeatureGraphProjection(traceability(), { depth: 8, limit: 100 });
  assert.ok(full.nodes.some((node) => node.type === "TEST_ASSERTION" && node.id === "ASSERT-HTTP"));
  assert.ok(full.nodes.some((node) => node.type === "EVIDENCE"));
  assert.ok(full.edges.some((edge) => edge.type === "HAS_ASSERTION"));
  assert.ok(full.edges.every((edge) => edge.snapshotManifestId === full.snapshotManifestId));
});

test("bounded projections preserve a selected governed API as the graph root", () => {
  const projection = createFeatureGraphProjection(traceability(), {
    rootNodeId: "ENDPOINT-ORDER-SUBMIT",
    depth: 1,
    limit: 30,
  });

  assert.equal(projection.center, "ENDPOINT-ORDER-SUBMIT");
  assert.equal(projection.nodes.find(({ id }) => id === projection.center)?.type, "ENDPOINT");
  assert.ok(projection.edges.some(({ source, target }) =>
    source === projection.center || target === projection.center));
  assert.throws(
    () => createFeatureGraphProjection(traceability(), { rootNodeId: "UNKNOWN" }),
    /rootNodeId UNKNOWN is not present/,
  );
});

test("Feature graph presets suppress unrelated noise without creating a second truth model", () => {
  const source = traceability();
  const business = createFeatureGraphProjection(source, { view: "business", depth: 8, limit: 100 });
  assert.ok(business.nodes.some((node) => node.type === "DECISION"));
  assert.ok(!business.nodes.some((node) => node.type === "ENDPOINT"));

  const coverage = createFeatureGraphProjection(source, { view: "coverage", depth: 8, limit: 100 });
  assert.ok(coverage.nodes.some((node) => node.type === "TEST_EXECUTION"));
  assert.ok(!coverage.nodes.some((node) => node.type === "ENDPOINT"));
});

test("bounded path queries find forward proof chains and never invent unavailable nodes", () => {
  const graph = createFeatureGraphProjection(traceability(), { view: "coverage", depth: 8, limit: 100 });
  const evidence = graph.nodes.find((node) => node.type === "EVIDENCE");
  const path = queryFeatureGraphPath(graph, {
    fromNodeId: graph.center,
    toNodeId: evidence.id,
    direction: "FORWARD",
    maxDepth: 8,
  });
  assert.equal(path.found, true);
  assert.equal(path.nodes[0].id, graph.center);
  assert.equal(path.nodes.at(-1).id, evidence.id);
  assert.ok(path.edges.every((edge, index) => edge.source === path.nodes[index].id));

  assert.deepEqual(
    queryFeatureGraphPath(graph, { fromNodeId: graph.center, toNodeId: "UNKNOWN", maxDepth: 8 }),
    { found: false, nodes: [], edges: [], hopCount: null },
  );
});

test("TraceGap nodes remain explicit in incomplete graph projections", () => {
  const graph = createFeatureGraphProjection(traceability({ currentExecution: false }), { depth: 8, limit: 100 });
  const gaps = graph.nodes.filter((node) => node.type === "TRACE_GAP");
  assert.ok(gaps.some((node) => node.label === "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT"));
  assert.ok(gaps.some((node) => node.label === "EVIDENCE_MISSING"));
  assert.ok(graph.edges.some((edge) => edge.type === "HAS_GAP"));
});
