import assert from "node:assert/strict";
import test from "node:test";

import { startTraceabilityJourneyServer } from "../../test/support/traceability-journey-server.js";
import {
  buildFeatureDetail,
  buildGraphInspector,
  featureDetailTabs,
} from "../app/traceability-view-model.ts";
import {
  getFeatureGraph,
  getFeatureTraceability,
  getFeatureUnderstandingHistory,
  queryFeatureGraphPath,
  resolveGraphEvidence,
} from "../app/understanding-graph-client.ts";

test("F002 preserves a selected API identity through every detail tab on the real application API", async (t) => {
  const journey = await startTraceabilityJourneyServer(t);
  const response = await getFeatureTraceability(
    journey.baseUrl,
    "",
    journey.projectId,
    journey.featureId,
    journey.snapshotManifestId,
    { selectedObjectId: journey.endpointId, graphRevisionId: journey.graphRevisionId },
  );
  const history = await getFeatureUnderstandingHistory(
    journey.baseUrl,
    "",
    journey.projectId,
    journey.featureId,
    { selectedObjectId: journey.endpointId, graphRevisionId: journey.graphRevisionId },
  );
  const detail = buildFeatureDetail(response, null, {
    workspaceId: journey.projectId,
    featureId: journey.featureId,
    selectedObjectId: journey.endpointId,
    snapshotManifestId: journey.snapshotManifestId,
    graphRevisionId: journey.graphRevisionId,
    historical: false,
  }, history);

  assert.deepEqual(featureDetailTabs, ["overview", "evidence", "relations", "gaps", "history"]);
  for (const tab of featureDetailTabs) assert.ok(detail[tab]);
  assert.equal(response.selection.id, journey.endpointId);
  assert.equal(response.selection.type, "ENDPOINT");
  assert.equal(history.selection.id, journey.endpointId);
  assert.equal(history.selectionHistory[0].graphRevisionId, journey.graphRevisionId);
  assert.equal(detail.overview.selectedObject.id, journey.endpointId);
  assert.equal(detail.overview.selectedObject.type, "ENDPOINT");
  assert.ok(detail.evidence.items.some((item) => item.objectType === "IMPLEMENTATION_MAPPING"));
  assert.ok(detail.evidence.items.some((item) => item.objectType === "TEST_SPEC" && item.status === "MISSING"));
  assert.ok(detail.evidence.items.some((item) => item.objectType === "TEST_EXECUTION" && item.status === "MISSING"));
  assert.ok(detail.evidence.items.some((item) => item.objectType === "VERIFICATION_RESULT" && item.status === "MISSING"));
  assert.ok(detail.evidence.items.some((item) => item.objectType === "EVIDENCE" && item.status === "MISSING"));
  assert.ok(detail.evidence.items.every((item) => item.resolver.startsWith("/v1/")));
  assert.ok(detail.evidence.items.every((item) => !item.resolver.includes("#")));
  const mapping = detail.evidence.items.find((item) => item.objectType === "IMPLEMENTATION_MAPPING");
  const resolvedMapping = await resolveGraphEvidence(journey.baseUrl, "", mapping.resolver);
  assert.equal(resolvedMapping.status, "RESOLVED");
  assert.equal(resolvedMapping.id, mapping.id);
  assert.equal(resolvedMapping.context.objectType, "IMPLEMENTATION_MAPPING");
});

test("F003 centers a real graph on an API and executes its path and edge Evidence Resolver", async (t) => {
  const journey = await startTraceabilityJourneyServer(t);
  const projection = await getFeatureGraph(
    journey.baseUrl,
    "",
    journey.projectId,
    journey.featureId,
    journey.snapshotManifestId,
    {
      depth: 8,
      limit: 100,
      view: "traceability",
      rootNodeId: journey.endpointId,
      graphRevisionId: journey.graphRevisionId,
    },
  );
  const targetId = projection.nodes.find(({ id }) => id !== journey.endpointId)?.id;
  assert.ok(targetId);
  const path = await queryFeatureGraphPath(journey.baseUrl, "", journey.projectId, journey.featureId, {
    snapshotManifestId: journey.snapshotManifestId,
    fromNodeId: journey.endpointId,
    toNodeId: targetId,
    direction: "ANY",
    maxDepth: 8,
    view: "traceability",
    graphRevisionId: journey.graphRevisionId,
  });
  const inspector = buildGraphInspector(projection, path, {
    workspaceId: journey.projectId,
    featureId: journey.featureId,
    snapshotManifestId: journey.snapshotManifestId,
    graphRevisionId: journey.graphRevisionId,
    selectedObjectId: journey.endpointId,
    historical: false,
  });

  assert.equal(projection.center, journey.endpointId);
  assert.equal(projection.ownerFeatureId, journey.featureId);
  assert.equal(projection.graphRevisionId, journey.graphRevisionId);
  assert.equal(projection.nodes.find(({ id }) => id === projection.center)?.type, "ENDPOINT");
  assert.equal(path.found, true);
  assert.ok(inspector.hops.length > 0);
  const edge = projection.edges.find(({ evidenceResolver }) => evidenceResolver);
  assert.ok(edge);
  assert.ok(!edge.evidenceResolver.includes("#"));
  const resolved = await resolveGraphEvidence(journey.baseUrl, "", edge.evidenceResolver);
  assert.equal(resolved.status, "RESOLVED");
  assert.equal(resolved.id, edge.id);
  assert.equal(resolved.context.graphRevisionId, journey.graphRevisionId);
  assert.equal(resolved.context.rootNodeId, journey.endpointId);

  const noPath = buildGraphInspector(projection, { ...path, found: false, nodes: [], edges: [], hopCount: null }, {
    workspaceId: journey.projectId,
    featureId: journey.featureId,
    snapshotManifestId: journey.snapshotManifestId,
    graphRevisionId: journey.graphRevisionId,
    selectedObjectId: journey.endpointId,
    historical: false,
  });
  assert.equal(noPath.found, false);
  assert.deepEqual(noPath.hops, []);
});

test("historical F002 and F003 reads remain bound to V1 after the current Feature advances to V2", async (t) => {
  const journey = await startTraceabilityJourneyServer(t);
  await journey.appendCurrentFeatureVersion();

  const historicalOptions = {
    selectedObjectId: journey.endpointId,
    graphRevisionId: journey.graphRevisionId,
  };
  const [historical, current, history, graph] = await Promise.all([
    getFeatureTraceability(
      journey.baseUrl,
      "",
      journey.projectId,
      journey.featureId,
      journey.snapshotManifestId,
      historicalOptions,
    ),
    getFeatureTraceability(
      journey.baseUrl,
      "",
      journey.projectId,
      journey.featureId,
      journey.snapshotManifestId,
      { selectedObjectId: journey.endpointId },
    ),
    getFeatureUnderstandingHistory(
      journey.baseUrl,
      "",
      journey.projectId,
      journey.featureId,
      historicalOptions,
    ),
    getFeatureGraph(
      journey.baseUrl,
      "",
      journey.projectId,
      journey.featureId,
      journey.snapshotManifestId,
      {
        depth: 8,
        limit: 100,
        view: "traceability",
        rootNodeId: journey.endpointId,
        graphRevisionId: journey.graphRevisionId,
      },
    ),
  ]);

  assert.equal(current.feature.version, 2);
  assert.equal(current.feature.name, "Submit order with current-only changes");
  assert.equal(current.claims[0].latestDecision.id, "DECISION-JOURNEY-CURRENT-ONLY");
  assert.equal(historical.feature.version, 1);
  assert.equal(historical.feature.name, "Submit order");
  assert.equal(historical.claims[0].latestDecision.id, "DECISION-JOURNEY");
  assert.deepEqual(history.featureVersions.map(({ version }) => version), [1]);
  assert.deepEqual(history.decisions.map(({ id }) => id), ["DECISION-JOURNEY"]);
  assert.equal(history.feature.version, 1);
  assert.equal(graph.nodes.find(({ id }) => id === journey.featureId)?.label, "Submit order");

  for (const node of graph.nodes) {
    const resolvedNode = await resolveGraphEvidence(journey.baseUrl, "", node.evidenceResolver);
    assert.equal(resolvedNode.object.id, node.id);
    assert.equal(resolvedNode.context.graphRevisionId, journey.graphRevisionId);
    assert.equal(resolvedNode.context.graphArtifactDigest, journey.graphArtifactDigest);
    assert.notEqual(resolvedNode.object.label, "Submit order with current-only changes");
  }
  for (const edge of graph.edges) {
    const resolvedEdge = await resolveGraphEvidence(journey.baseUrl, "", edge.evidenceResolver);
    assert.equal(resolvedEdge.object.id, edge.id);
    assert.equal(resolvedEdge.context.graphRevisionId, journey.graphRevisionId);
    assert.equal(resolvedEdge.context.graphArtifactDigest, journey.graphArtifactDigest);
  }

  const detail = buildFeatureDetail(historical, null, {
    workspaceId: journey.projectId,
    featureId: journey.featureId,
    selectedObjectId: journey.endpointId,
    snapshotManifestId: journey.snapshotManifestId,
    graphRevisionId: journey.graphRevisionId,
    historical: true,
  }, history);
  for (const tab of featureDetailTabs) assert.ok(detail[tab]);
  assert.equal(detail.overview.feature.version, 1);
  assert.equal(detail.history.featureVersions.some(({ version }) => version === 2), false);

  const targetId = graph.nodes.find(({ id }) => id !== journey.endpointId)?.id;
  const path = await queryFeatureGraphPath(journey.baseUrl, "", journey.projectId, journey.featureId, {
    snapshotManifestId: journey.snapshotManifestId,
    fromNodeId: journey.endpointId,
    toNodeId: targetId,
    direction: "ANY",
    maxDepth: 8,
    view: "traceability",
    graphRevisionId: journey.graphRevisionId,
  });
  assert.equal(path.found, true);
  assert.ok(path.nodes.every(({ label }) => label !== "Submit order with current-only changes"));

  const mapping = detail.evidence.items.find((item) => item.objectType === "IMPLEMENTATION_MAPPING");
  const resolvedObject = await resolveGraphEvidence(journey.baseUrl, "", mapping.resolver);
  assert.equal(resolvedObject.status, "RESOLVED");
  assert.equal(resolvedObject.object.id, mapping.id);
  assert.equal(resolvedObject.context.graphArtifactDigest, journey.graphArtifactDigest);
  for (const evidence of detail.evidence.items) {
    const resolution = await resolveGraphEvidence(journey.baseUrl, "", evidence.resolver);
    assert.equal(resolution.context.graphRevisionId, journey.graphRevisionId);
    assert.equal(resolution.context.graphArtifactDigest, journey.graphArtifactDigest);
    if (evidence.status === "MISSING") assert.equal(resolution.status, "MISSING");
  }
});
