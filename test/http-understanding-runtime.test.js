import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { LegacyUnderstandingRuntime } from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";
import { completeInput } from "./fixtures.js";
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

async function assertHistoricalAvailabilityContract(value) {
  const schema = JSON.parse(await readFile(
    new URL("../contracts/historical-availability.schema.json", import.meta.url),
    "utf8",
  ));
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}

test("allowlisted HTTP SourceRegistration starts and reads the real server-owned F001 job", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-http-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function httpStartedCapability() {}\n");
  const store = new MemoryTraceabilityStore();
  const historicalProfile = await persistFixtureExecutionProfile(store, "P", "PROFILE-HISTORICAL");
  const profile = await persistFixtureExecutionProfile(store, "P", "PROFILE-ACTIVE");
  await store.appendUnderstandingRecordWithCas("P", "WORKSPACE_EXECUTION_PROFILE", profile, {
    headKey: "WORKSPACE_EXECUTION_PROFILE",
    expectedVersion: 0,
  });
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
  const clientSelectedProfileResponse = await fetch(`${base}/workspace-analysis-jobs?async=false`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceRegistrationId: registration.id,
      requestedMode: "AUTO",
      workspaceExecutionProfileRevisionId: historicalProfile.id,
    }),
  });
  assert.equal(clientSelectedProfileResponse.status, 400, "a new Run must not accept a client-selected historical Profile revision");
  const startResponse = await fetch(`${base}/workspace-analysis-jobs?async=false`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceRegistrationId: registration.id, requestedMode: "AUTO" }),
  });
  assert.equal(startResponse.status, 201);
  const completed = await startResponse.json();
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.workspaceExecutionProfileRevisionId, profile.id, "the server must pin the current Active Profile Head");
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

test("historical reanalysis requires an intact sealed Snapshot package and fails closed on metadata or payload drift", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-historical-reanalysis-http-"));
  const source = path.join(temporary, "source");
  const unrelatedSource = path.join(temporary, "unrelated-source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(unrelatedSource);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function immutableHistoricalSource() { return 'v1'; }\n");
  await writeFile(path.join(unrelatedSource, "entry.js"), "export function unrelatedCurrentSource() { return true; }\n");
  const projectId = "P-HISTORICAL-REANALYSIS";
  const featureId = "FEATURE-HISTORICAL-REANALYSIS";
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, projectId, "PROFILE-HISTORICAL-REANALYSIS");
  await store.appendUnderstandingRecordWithCas(projectId, "WORKSPACE_EXECUTION_PROFILE", profile, {
    headKey: "WORKSPACE_EXECUTION_PROFILE",
    expectedVersion: 0,
  });
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const runtime = new LegacyUnderstandingRuntime({
    store, allowlistedRoots: [source, unrelatedSource], snapshotRoot: snapshots, sourceSliceBroker: broker,
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
  assert.equal(availability.recovery.executable, true);
  assert.equal(availability.recovery.method, "POST");
  assert.equal(availability.recovery.snapshotManifestId, first.snapshotManifestId);
  assert.equal(availability.recovery.graphRevisionId, legacyRevisionId);
  assert.equal(availability.recovery.sourceRegistrationId, registration.id);
  assert.equal(availability.recovery.workspaceExecutionProfileRevisionId, profile.id);
  await assertHistoricalAvailabilityContract(availability);
  assert.equal(
    availability.recovery.endpoint,
    `/v1/projects/${projectId}/graph/revisions/${legacyRevisionId}/reanalysis-jobs`,
  );

  const unrelatedRegistrationResponse = await fetch(`${base}/source-registrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: unrelatedSource, displayName: "Unrelated current source" }),
  });
  assert.equal(unrelatedRegistrationResponse.status, 201);
  const unrelatedRegistration = await unrelatedRegistrationResponse.json();
  assert.notEqual(unrelatedRegistration.id, availability.recovery.sourceRegistrationId);
  const substitutedBindingResponse = await fetch(`${origin}${availability.recovery.endpoint}?async=false`, {
    method: availability.recovery.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceRegistrationId: unrelatedRegistration.id,
      workspaceExecutionProfileRevisionId: profile.id,
    }),
  });
  assert.equal(substitutedBindingResponse.status, 400);
  assert.match((await substitutedBindingResponse.json()).error.message, /sourceRegistrationId is not supported/);

  const recoveryResponse = await fetch(`${origin}${availability.recovery.endpoint}?async=false`, {
    method: availability.recovery.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
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

  const snapshotDirectory = path.join(snapshots, first.snapshotManifestId);
  const sealedInventoryPath = path.join(snapshotDirectory, ".traqen-inventory.json");
  const originalInventoryBytes = await readFile(sealedInventoryPath);
  const truncatedInventory = JSON.parse(originalInventoryBytes.toString("utf8"));
  truncatedInventory.artifacts = [];
  await chmod(sealedInventoryPath, 0o640);
  await writeFile(sealedInventoryPath, JSON.stringify(truncatedInventory));
  const truncatedInventoryAvailabilityResponse = await fetch(
    `${base}/features/${featureId}/traceability?${new URLSearchParams({
      snapshotManifestId: first.snapshotManifestId,
      graphRevisionId: legacyRevisionId,
    })}`,
  );
  assert.equal(truncatedInventoryAvailabilityResponse.status, 200);
  const truncatedInventoryAvailability = (
    await truncatedInventoryAvailabilityResponse.json()
  ).historicalAvailability;
  assert.equal(truncatedInventoryAvailability.recovery.executable, false);
  assert.equal(truncatedInventoryAvailability.recovery.action, "HISTORICAL_REANALYSIS_UNAVAILABLE");
  assert.equal(truncatedInventoryAvailability.recovery.reasonCode, "SEALED_SOURCE_SNAPSHOT_NOT_RETAINED");
  assert.equal(Object.hasOwn(truncatedInventoryAvailability.recovery, "method"), false);
  assert.equal(Object.hasOwn(truncatedInventoryAvailability.recovery, "endpoint"), false);
  await assertHistoricalAvailabilityContract(truncatedInventoryAvailability);

  await writeFile(sealedInventoryPath, originalInventoryBytes);
  await chmod(sealedInventoryPath, 0o440);
  const restoredInventoryAvailabilityResponse = await fetch(
    `${base}/features/${featureId}/traceability?${new URLSearchParams({
      snapshotManifestId: first.snapshotManifestId,
      graphRevisionId: legacyRevisionId,
    })}`,
  );
  assert.equal(restoredInventoryAvailabilityResponse.status, 200);
  const restoredInventoryAvailability = (
    await restoredInventoryAvailabilityResponse.json()
  ).historicalAvailability;
  assert.equal(restoredInventoryAvailability.recovery.executable, true);
  await assertHistoricalAvailabilityContract(restoredInventoryAvailability);

  const sealedPayload = path.join(snapshotDirectory, "entry.js");
  const originalPayload = await readFile(sealedPayload);
  await chmod(sealedPayload, 0o640);
  await writeFile(sealedPayload, "export function tamperedHistoricalSource() { return false; }\n");
  const tamperedAvailabilityResponse = await fetch(
    `${base}/features/${featureId}/traceability?${new URLSearchParams({
      snapshotManifestId: first.snapshotManifestId,
      graphRevisionId: legacyRevisionId,
    })}`,
  );
  assert.equal(tamperedAvailabilityResponse.status, 200);
  const tamperedAvailability = (await tamperedAvailabilityResponse.json()).historicalAvailability;
  assert.equal(tamperedAvailability.recovery.executable, false);
  assert.equal(tamperedAvailability.recovery.action, "HISTORICAL_REANALYSIS_UNAVAILABLE");
  assert.equal(tamperedAvailability.recovery.reasonCode, "SEALED_SOURCE_SNAPSHOT_NOT_RETAINED");
  assert.equal(Object.hasOwn(tamperedAvailability.recovery, "method"), false);
  assert.equal(Object.hasOwn(tamperedAvailability.recovery, "endpoint"), false);
  await assertHistoricalAvailabilityContract(tamperedAvailability);

  await writeFile(sealedPayload, originalPayload);
  await chmod(sealedPayload, 0o440);
  const restoredAvailabilityResponse = await fetch(
    `${base}/features/${featureId}/traceability?${new URLSearchParams({
      snapshotManifestId: first.snapshotManifestId,
      graphRevisionId: legacyRevisionId,
    })}`,
  );
  assert.equal(restoredAvailabilityResponse.status, 200);
  const restoredAvailability = (await restoredAvailabilityResponse.json()).historicalAvailability;
  assert.equal(restoredAvailability.recovery.executable, true);
  await assertHistoricalAvailabilityContract(restoredAvailability);

  await chmod(snapshotDirectory, 0o750);
  await rm(sealedPayload);
  const missingAvailabilityResponse = await fetch(
    `${base}/features/${featureId}/traceability?${new URLSearchParams({
      snapshotManifestId: first.snapshotManifestId,
      graphRevisionId: legacyRevisionId,
    })}`,
  );
  assert.equal(missingAvailabilityResponse.status, 200);
  const missingAvailability = (await missingAvailabilityResponse.json()).historicalAvailability;
  assert.equal(missingAvailability.recovery.executable, false);
  assert.equal(missingAvailability.recovery.action, "HISTORICAL_REANALYSIS_UNAVAILABLE");
  assert.equal(missingAvailability.recovery.reasonCode, "SEALED_SOURCE_SNAPSHOT_NOT_RETAINED");
  assert.equal(Object.hasOwn(missingAvailability.recovery, "method"), false);
  assert.equal(Object.hasOwn(missingAvailability.recovery, "endpoint"), false);
  await assertHistoricalAvailabilityContract(missingAvailability);
});

test("published pre-v2 Revisions without a retained source Job expose no executable recovery", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-historical-reanalysis-unavailable-http-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function currentSourceCannotRepairLegacyHistory() { return true; }\n");
  const projectId = "P-HISTORICAL-REANALYSIS-NO-JOB";
  const featureId = "FEATURE-HISTORICAL-REANALYSIS-NO-JOB";
  const revisionId = "GRAPH-REVISION-PRE-V2-NO-JOB";
  const artifactId = "GRAPH-ARTIFACT-PRE-V2-NO-JOB";
  const analysisRunId = "ANALYSIS-PRE-V2-NO-RETAINED-JOB";
  const digest = `sha256:${"d".repeat(64)}`;
  const now = "2026-08-06T05:00:00.000Z";
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, projectId, "PROFILE-NO-JOB");
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
    name: "Legacy Revision without retained Job",
  });
  const currentRegistration = await application.registerUnderstandingSource(projectId, {
    rootPath: source,
    displayName: "Current unrelated recovery candidate",
  });
  const snapshot = await application.registerSnapshot(projectId, completeInput().snapshotManifest);
  const denominators = {
    inventory: 1, anchors: 1, candidateSample: 1, requiredRelationships: 1,
    forbiddenRelationships: 1, sourceAttributions: 1, gaps: 1,
    replaySamples: 1, incrementalComparisons: 1,
  };
  await store.appendUnderstandingRecord(projectId, "EVALUATION_RUN", {
    id: "EVALUATION-PRE-V2-NO-JOB",
    status: "PASSED",
    policyVersion: "review-v1",
    minimumDenominators: denominators,
    denominators,
    completedAt: now,
  });
  await store.appendUnderstandingRecord(projectId, "GRAPH_ARTIFACT", {
    id: artifactId,
    projectId,
    snapshotManifestId: snapshot.id,
    analysisRunId,
    graphArtifactDigest: digest,
    nodes: [{
      id: featureId,
      type: "FEATURE",
      label: "Legacy Revision without retained Job",
      authority: "GOVERNED_BASELINE",
    }],
    edges: [], traceChains: [], gaps: [], changeSet: null,
    impactAssessment: null, revalidationPlan: null, createdAt: now,
  });
  await store.appendUnderstandingRecord(projectId, "GRAPH_REVISION", {
    id: revisionId,
    projectId,
    evaluationRunId: "EVALUATION-PRE-V2-NO-JOB",
    mode: "FULL",
    baseRevisionId: null,
    changeSetId: null,
    impactAssessmentId: null,
    snapshotManifestId: snapshot.id,
    analysisRunId,
    graphArtifactId: artifactId,
    graphArtifactDigest: digest,
    semanticDigest: `sha256:${"e".repeat(64)}`,
    status: "EVALUATING",
    createdAt: now,
    publishedAt: null,
  });
  await store.publishGraphRevision(projectId, revisionId, 0);

  const server = createTraceabilityHttpServer({ application });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}/v1/projects/${projectId}`;
  const availabilityResponse = await fetch(
    `${base}/features/${featureId}/traceability?${new URLSearchParams({
      snapshotManifestId: snapshot.id,
      graphRevisionId: revisionId,
    })}`,
  );
  assert.equal(availabilityResponse.status, 200);
  const availability = (await availabilityResponse.json()).historicalAvailability;
  assert.equal(availability.recovery.executable, false);
  assert.equal(availability.recovery.action, "HISTORICAL_REANALYSIS_UNAVAILABLE");
  assert.equal(availability.recovery.reasonCode, "SOURCE_ANALYSIS_JOB_NOT_RETAINED");
  assert.equal(availability.recovery.graphRevisionId, revisionId);
  assert.equal(availability.recovery.snapshotManifestId, snapshot.id);
  assert.equal(Object.hasOwn(availability.recovery, "method"), false);
  assert.equal(Object.hasOwn(availability.recovery, "endpoint"), false);
  assert.equal(Object.hasOwn(availability.recovery, "sourceRegistrationId"), false);
  assert.equal(Object.hasOwn(availability.recovery, "workspaceExecutionProfileRevisionId"), false);
  await assertHistoricalAvailabilityContract(availability);
  assert.equal(currentRegistration.status, "ACTIVE");
  assert.equal(profile.workspaceId, projectId);

  const guessedRecoveryResponse = await fetch(
    `${base}/graph/revisions/${revisionId}/reanalysis-jobs?async=false`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert.equal(guessedRecoveryResponse.status, 409);
  const guessedRecoveryBody = await guessedRecoveryResponse.json();
  assert.match(guessedRecoveryBody.error.message, /SOURCE_ANALYSIS_JOB_NOT_RETAINED/);
});
