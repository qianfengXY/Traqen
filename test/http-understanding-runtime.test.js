import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LegacyUnderstandingRuntime } from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";
import {
  deterministicFixtureChildProducer,
  deterministicFixtureMainProducer,
  fixtureEquivalenceResolver,
  fixtureReviewedEvaluationResolver,
  persistFixtureExecutionProfile,
} from "./helpers/legacy-understanding-fixture.js";

function assertClosedTopLevelSchema(value, schema, label) {
  const required = new Set(schema.required ?? []);
  const declared = new Set(Object.keys(schema.properties ?? {}));
  assert.deepEqual(
    Object.keys(value).filter((key) => !declared.has(key)),
    [],
    `${label} must not contain properties rejected by additionalProperties: false`,
  );
  assert.deepEqual(
    [...required].filter((key) => !Object.hasOwn(value, key)),
    [],
    `${label} must contain every required property`,
  );
}

test("allowlisted HTTP SourceRegistration starts and reads the real server-owned F001 job", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-http-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function httpStartedCapability() {}\n");
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, "P");
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const runtime = new LegacyUnderstandingRuntime({
    store, allowlistedRoots: [source], snapshotRoot: snapshots, sourceSliceBroker: broker,
    childProducer: deterministicFixtureChildProducer,
    mainProducer: deterministicFixtureMainProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const application = new TraceabilityApplication({
    store, sourceSliceBroker: broker, legacyUnderstandingRuntime: runtime,
  });
  await application.appendFeatureVersion("P", {
    id: "FEATURE-HTTP-CONTRACT",
    version: 1,
    name: "HTTP contract feature",
  });
  const server = createTraceabilityHttpServer({ application });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/v1/projects/P`;
  const registrationResponse = await fetch(`${base}/source-registrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: source, displayName: "HTTP source" }),
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  assert.equal(Object.hasOwn(registration, "canonicalRootRef"), false);
  const missingProfileResponse = await fetch(`${base}/workspace-analysis-jobs?async=false`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceRegistrationId: registration.id, requestedMode: "AUTO" }),
  });
  assert.equal(missingProfileResponse.status, 400);
  assert.match((await missingProfileResponse.json()).error.message, /workspaceExecutionProfileRevisionId is required/);
  const startResponse = await fetch(`${base}/workspace-analysis-jobs?async=false`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceRegistrationId: registration.id, requestedMode: "AUTO", workspaceExecutionProfileRevisionId: profile.id }),
  });
  assert.equal(startResponse.status, 201);
  const completed = await startResponse.json();
  assert.equal(completed.status, "COMPLETED");
  const readResponse = await fetch(`${base}/workspace-analysis-jobs/${completed.id}`);
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).outputs.PUBLISHING.currentGraphHead.version, 1);
  const listResponse = await fetch(`${base}/workspace-analysis-jobs`);
  assert.equal(listResponse.status, 200);
  assert.deepEqual((await listResponse.json()).jobs.map(({ id }) => id), [completed.id]);
  const graphResponse = await fetch(`${base}/graph/current`);
  assert.equal(graphResponse.status, 200);
  const graph = await graphResponse.json();
  assert.equal(graph.graphArtifact.id, graph.revision.graphArtifactId);
  assert.ok(graph.graphArtifact.nodes.some(({ authority }) => authority === "CANDIDATE"));
  const graphArtifactContract = JSON.parse(await readFile(
    new URL("../contracts/immutable-graph-artifact.schema.json", import.meta.url),
    "utf8",
  ));
  assertClosedTopLevelSchema(graph.graphArtifact, graphArtifactContract, "current GraphArtifact");
  assert.equal(graph.graphArtifact.artifactSchemaVersion, 2);
  assert.equal(graph.graphArtifact.featureTraceability.length, 1);
  assert.equal(graph.graphArtifact.featureTraceability[0].featureId, "FEATURE-HTTP-CONTRACT");
  assert.equal(
    graph.graphArtifact.featureTraceability[0].traceability.snapshotManifest.id,
    graph.revision.snapshotManifestId,
  );
  const revisionResponse = await fetch(`${base}/graph/revisions/${encodeURIComponent(graph.revision.id)}`);
  assert.equal(revisionResponse.status, 200);
  const historical = await revisionResponse.json();
  assertClosedTopLevelSchema(historical.graphArtifact, graphArtifactContract, "revision GraphArtifact");
  assert.deepEqual(historical.graphArtifact, graph.graphArtifact);
});

test("historical reanalysis reuses the sealed Revision Snapshot without moving CurrentGraphHead", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-historical-reanalysis-http-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function immutableHistoricalSource() { return 'v1'; }\n");
  const projectId = "P-HISTORICAL-REANALYSIS";
  const featureId = "FEATURE-HISTORICAL-REANALYSIS";
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, projectId, "PROFILE-HISTORICAL-REANALYSIS");
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const runtime = new LegacyUnderstandingRuntime({
    store, allowlistedRoots: [source], snapshotRoot: snapshots, sourceSliceBroker: broker,
    childProducer: deterministicFixtureChildProducer,
    mainProducer: deterministicFixtureMainProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const application = new TraceabilityApplication({
    store, sourceSliceBroker: broker, legacyUnderstandingRuntime: runtime,
  });
  await application.appendFeatureVersion(projectId, {
    id: featureId,
    version: 1,
    name: "Historical reanalysis feature",
  });
  const server = createTraceabilityHttpServer({ application });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}/v1/projects/${projectId}`;
  const registrationResponse = await fetch(`${base}/source-registrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: source, displayName: "Historical recovery source" }),
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  const firstResponse = await fetch(`${base}/workspace-analysis-jobs?async=false`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceRegistrationId: registration.id,
      requestedMode: "AUTO",
      workspaceExecutionProfileRevisionId: profile.id,
    }),
  });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  assert.equal(first.status, "COMPLETED");
  const firstHead = await application.getCurrentUnderstandingGraph(projectId);
  const legacyRevisionId = "GRAPH-REVISION-PRE-V2-RECOVERY";
  const legacyArtifactId = "GRAPH-ARTIFACT-PRE-V2-RECOVERY";
  const legacyDigest = `sha256:${"c".repeat(64)}`;
  const now = "2026-08-06T04:00:00.000Z";
  await store.appendUnderstandingRecord(projectId, "GRAPH_ARTIFACT", {
    id: legacyArtifactId,
    projectId,
    snapshotManifestId: first.snapshotManifestId,
    analysisRunId: first.id,
    graphArtifactDigest: legacyDigest,
    nodes: [{
      id: featureId,
      type: "FEATURE",
      label: "Historical reanalysis feature",
      authority: "GOVERNED_BASELINE",
    }],
    edges: [], traceChains: [], gaps: [], changeSet: null,
    impactAssessment: null, revalidationPlan: null, createdAt: now,
  });
  await store.appendUnderstandingRecord(projectId, "GRAPH_REVISION", {
    id: legacyRevisionId,
    projectId,
    evaluationRunId: first.outputs.EVALUATION.evaluationRunId,
    mode: "FULL",
    baseRevisionId: null,
    snapshotManifestId: first.snapshotManifestId,
    analysisRunId: first.id,
    graphArtifactId: legacyArtifactId,
    graphArtifactDigest: legacyDigest,
    status: "EVALUATING",
    createdAt: now,
  });
  const legacyHead = await store.publishGraphRevision(projectId, legacyRevisionId, firstHead.head.version);
  await writeFile(path.join(source, "entry.js"), "export function liveSourceChangedAfterRevision() { return 'v2'; }\n");

  const availabilityResponse = await fetch(
    `${base}/features/${featureId}/traceability?${new URLSearchParams({
      snapshotManifestId: first.snapshotManifestId,
      graphRevisionId: legacyRevisionId,
    })}`,
  );
  assert.equal(availabilityResponse.status, 200);
  const availability = (await availabilityResponse.json()).historicalAvailability;
  assert.equal(availability.recovery.method, "POST");
  assert.equal(availability.recovery.snapshotManifestId, first.snapshotManifestId);
  assert.equal(availability.recovery.graphRevisionId, legacyRevisionId);
  assert.equal(
    availability.recovery.endpoint,
    `/v1/projects/${projectId}/graph/revisions/${legacyRevisionId}/reanalysis-jobs`,
  );

  const recoveryResponse = await fetch(`${origin}${availability.recovery.endpoint}?async=false`, {
    method: availability.recovery.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceRegistrationId: registration.id,
      workspaceExecutionProfileRevisionId: profile.id,
    }),
  });
  assert.equal(recoveryResponse.status, 201);
  const recovered = await recoveryResponse.json();
  assert.equal(recovered.status, "COMPLETED", JSON.stringify(recovered.error));
  assert.equal(recovered.purpose, "HISTORICAL_REANALYSIS");
  assert.equal(recovered.requestedMode, "FULL");
  assert.equal(recovered.resolvedMode, "FULL");
  assert.equal(recovered.snapshotManifestId, first.snapshotManifestId);
  assert.equal(recovered.reanalysisOfGraphRevisionId, legacyRevisionId);
  assert.equal(recovered.outputs.SOURCE_SCAN.inventoryId, first.outputs.SOURCE_SCAN.inventoryId);
  assert.equal(recovered.outputs.PUBLISHING.currentGraphHeadChanged, false);
  const unchangedHead = await store.getCurrentGraphHead(projectId);
  assert.equal(unchangedHead.graphRevisionId, legacyRevisionId);
  assert.equal(unchangedHead.version, legacyHead.version);
  const recoveredRevisionId = recovered.outputs.PROJECTION.graphRevisionId;
  const recoveredRevision = await application.getGraphRevision(projectId, recoveredRevisionId);
  assert.equal(recoveredRevision.revision.status, "PUBLISHED");
  assert.equal(recoveredRevision.revision.reanalysisOfGraphRevisionId, legacyRevisionId);
  assert.equal(recoveredRevision.revision.snapshotManifestId, first.snapshotManifestId);
  assert.equal(recoveredRevision.graphArtifact.artifactSchemaVersion, 2);
  const originalAfterRecovery = await application.getGraphRevision(projectId, legacyRevisionId);
  assert.equal(originalAfterRecovery.graphArtifact.artifactSchemaVersion, undefined);
  assert.equal(originalAfterRecovery.graphArtifact.featureTraceability, undefined);
});
