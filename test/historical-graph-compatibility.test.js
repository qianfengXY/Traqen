import assert from "node:assert/strict";
import test from "node:test";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";
import { completeInput } from "./fixtures.js";

test("pre-v2 published GraphArtifacts remain addressable without fabricating historical traceability", async (t) => {
  const projectId = "PROJECT-LEGACY-REVISION";
  const featureId = "FEATURE-LEGACY-REVISION";
  const graphRevisionId = "GRAPH-REVISION-LEGACY-V1";
  const graphArtifactId = "GRAPH-ARTIFACT-LEGACY-V1";
  const graphArtifactDigest = `sha256:${"a".repeat(64)}`;
  const now = "2026-08-05T09:30:00.000Z";
  const store = new MemoryTraceabilityStore();
  const application = new TraceabilityApplication({ store, clock: () => new Date(now) });
  await application.createProject({
    organization: { id: "ORG-REVIEW", name: "Review" },
    tenant: { id: "TENANT-REVIEW", name: "Review" },
    project: { id: projectId, name: "Legacy revision migration review" },
    principals: [],
  });
  await application.appendFeatureVersion(projectId, {
    id: featureId,
    version: 1,
    name: "Historical feature name",
  });
  const snapshot = await application.registerSnapshot(projectId, completeInput().snapshotManifest);
  const denominators = {
    inventory: 1, anchors: 1, candidateSample: 1, requiredRelationships: 1,
    forbiddenRelationships: 1, sourceAttributions: 1, gaps: 1,
    replaySamples: 1, incrementalComparisons: 1,
  };
  await store.appendUnderstandingRecord(projectId, "EVALUATION_RUN", {
    id: "EVALUATION-LEGACY-V1", status: "PASSED", policyVersion: "review-v1",
    minimumDenominators: denominators, denominators, completedAt: now,
  });
  await store.appendUnderstandingRecord(projectId, "GRAPH_ARTIFACT", {
    id: graphArtifactId,
    projectId,
    snapshotManifestId: snapshot.id,
    analysisRunId: "ANALYSIS-LEGACY-V1",
    graphArtifactDigest,
    nodes: [{
      id: featureId,
      type: "FEATURE",
      label: "Historical feature name",
      authority: "GOVERNED_BASELINE",
    }],
    edges: [], traceChains: [], gaps: [], changeSet: null,
    impactAssessment: null, revalidationPlan: null, createdAt: now,
  });
  await store.appendUnderstandingRecord(projectId, "GRAPH_REVISION", {
    id: graphRevisionId, projectId, evaluationRunId: "EVALUATION-LEGACY-V1",
    mode: "FULL", baseRevisionId: null, snapshotManifestId: snapshot.id,
    analysisRunId: "ANALYSIS-LEGACY-V1", graphArtifactId, graphArtifactDigest,
    status: "EVALUATING", createdAt: now,
  });
  await store.publishGraphRevision(projectId, graphRevisionId, 0);
  await application.appendFeatureVersion(projectId, {
    id: featureId,
    version: 2,
    name: "Current feature name",
  });

  const traceability = await application.getFeatureTraceability(
    projectId,
    featureId,
    snapshot.id,
    { graphRevisionId },
  );
  assert.equal(traceability.historicalAvailability.status, "UNAVAILABLE_REQUIRES_REANALYSIS");
  assert.equal(traceability.historicalAvailability.artifactSchemaVersion, 1);
  assert.equal(traceability.selection.label, "Historical feature name");
  assert.equal(traceability.graphRevisionId, graphRevisionId);
  assert.equal(Object.hasOwn(traceability, "feature"), false);

  const history = await application.getFeatureUnderstandingHistory(
    projectId,
    featureId,
    { graphRevisionId },
  );
  assert.equal(history.historicalAvailability.graphArtifactDigest, graphArtifactDigest);
  assert.equal(history.selection.id, featureId);

  const graph = await application.getFeatureGraph(projectId, featureId, snapshot.id, {
    rootNodeId: featureId,
    graphRevisionId,
    depth: 2,
  });
  assert.equal(graph.nodes[0].label, "Historical feature name");
  assert.equal(graph.historicalAvailability.status, "UNAVAILABLE_REQUIRES_REANALYSIS");
  const resolvedNode = await application.resolveGraphEvidence(
    projectId,
    graphRevisionId,
    "node",
    featureId,
    { featureId, rootNodeId: featureId, snapshotManifestId: snapshot.id },
  );
  assert.equal(resolvedNode.status, "RESOLVED");
  assert.equal(resolvedNode.object.label, "Historical feature name");
  const resolvedObject = await application.resolveGraphEvidence(
    projectId,
    graphRevisionId,
    "object",
    "DECISION-LEGACY-UNKNOWN",
    { featureId, rootNodeId: featureId, snapshotManifestId: snapshot.id },
  );
  assert.equal(resolvedObject.status, "UNAVAILABLE_REQUIRES_REANALYSIS");
  assert.equal(resolvedObject.historicalAvailability.graphRevisionId, graphRevisionId);

  const server = createTraceabilityHttpServer({ application });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/v1/projects/${projectId}`;
  const query = new URLSearchParams({ snapshotManifestId: snapshot.id, graphRevisionId });
  const traceabilityResponse = await fetch(`${base}/features/${featureId}/traceability?${query}`);
  assert.equal(traceabilityResponse.status, 200);
  assert.equal((await traceabilityResponse.json()).historicalAvailability.graphRevisionId, graphRevisionId);
  const historyResponse = await fetch(`${base}/features/${featureId}/history?graphRevisionId=${graphRevisionId}`);
  assert.equal(historyResponse.status, 200);
  assert.equal((await historyResponse.json()).selection.label, "Historical feature name");
  const graphResponse = await fetch(`${base}/features/${featureId}/graph?${query}&rootNodeId=${featureId}&depth=2`);
  assert.equal(graphResponse.status, 200);
  const httpGraph = await graphResponse.json();
  assert.equal(httpGraph.historicalAvailability.reasonCode, "IMMUTABLE_TRACEABILITY_SNAPSHOT_NOT_CAPTURED");
  const resolverResponse = await fetch(`http://127.0.0.1:${server.address().port}${httpGraph.nodes[0].evidenceResolver}`);
  assert.equal(resolverResponse.status, 200);
  assert.equal((await resolverResponse.json()).object.label, "Historical feature name");
  const pathResponse = await fetch(`${base}/features/${featureId}/graph/paths/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      snapshotManifestId: snapshot.id,
      fromNodeId: featureId,
      toNodeId: featureId,
      graphRevisionId,
      maxDepth: 2,
    }),
  });
  assert.equal(pathResponse.status, 200);
  assert.equal((await pathResponse.json()).historicalAvailability.graphArtifactDigest, graphArtifactDigest);
});
