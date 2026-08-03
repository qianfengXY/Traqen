import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LegacyUnderstandingRuntime } from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { WorkspaceAnalysisJobRunner } from "../src/application/workspace-analysis-job-runner.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";
import {
  deterministicFixtureChildProducer,
  fixtureReviewedEvaluationResolver,
} from "./helpers/legacy-understanding-fixture.js";

test("HTTP-owned runtime composes all seven durable phases and publishes immutable FULL then INCREMENTAL graphs", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-runtime-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(path.join(source, "src"), { recursive: true });
  await mkdir(path.join(source, "lib"), { recursive: true });
  await mkdir(snapshots);
  await writeFile(path.join(source, "src", "orders.js"), "export function submitOrder() { return true; }\n");
  await writeFile(path.join(source, "lib", "customers.js"), "export function findCustomer() { return true; }\n");
  const store = new MemoryTraceabilityStore();
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: broker,
    childProducer: deterministicFixtureChildProducer,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("src/orders.js"),
  });
  const registration = await runtime.registerSource({ projectId: "P", rootPath: source, displayName: "Traqen fixture" });
  const first = await runtime.start({
    id: "JOB-1",
    projectId: "P",
    sourceRegistrationId: registration.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(first.status, "COMPLETED");
  assert.deepEqual(first.completedPhases, ["SOURCE_SCAN", "FACT_COMMIT", "ANALYSIS", "RECONCILIATION", "EVALUATION", "PROJECTION", "PUBLISHING"]);
  const currentA = await store.getCurrentGraphHead("P");
  const revisionA = await store.getUnderstandingRecord("P", "GRAPH_REVISION", currentA.graphRevisionId);
  const artifactA = await store.getUnderstandingRecord("P", "GRAPH_ARTIFACT", revisionA.graphArtifactId);
  assert.ok(artifactA.nodes.some(({ authority }) => authority === "CANDIDATE"));
  assert.ok(artifactA.traceChains.some(({ segments, gaps }) =>
    segments.some(({ type, nodeIds }) => type === "IMPLEMENTATION" && nodeIds.length > 0)
    && segments.some(({ type, nodeIds }) => type === "EVIDENCE" && nodeIds.length > 0)
    && gaps.some(({ type }) => type === "MISSING_REQUIREMENT")));

  await writeFile(path.join(source, "src", "orders.js"), "export function submitOrder() { return true; }\nexport function cancelOrder() { return true; }\n");
  const second = await runtime.start({
    id: "JOB-2",
    projectId: "P",
    sourceRegistrationId: registration.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(second.status, "COMPLETED", JSON.stringify(second.error));
  const currentB = await store.getCurrentGraphHead("P");
  assert.equal(currentB.version, 2);
  const revisionB = await store.getUnderstandingRecord("P", "GRAPH_REVISION", currentB.graphRevisionId);
  const artifactB = await store.getUnderstandingRecord("P", "GRAPH_ARTIFACT", revisionB.graphArtifactId);
  assert.equal(revisionB.baseRevisionId, revisionA.id);
  assert.ok(artifactB.changeSet);
  assert.ok(artifactB.impactAssessment);
  assert.ok(artifactB.revalidationPlan.required);
  assert.ok(second.outputs.SOURCE_SCAN.reusedWorkUnitIds.length > 0);
  assert.ok(second.outputs.ANALYSIS.reusedCandidateIds.length > 0);

  const unchanged = await runtime.start({
    id: "JOB-3",
    projectId: "P",
    sourceRegistrationId: registration.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(unchanged.status, "COMPLETED", JSON.stringify(unchanged.error));
  assert.equal(unchanged.outputs.SOURCE_SCAN.affectedWorkUnitIds.length, 0);
  assert.equal(unchanged.outputs.ANALYSIS.revalidatedWorkUnitIds.length, 0);
  assert.equal(unchanged.outputs.ANALYSIS.routeDecisionIds.length, 0);
  assert.ok(unchanged.outputs.ANALYSIS.reusedCandidateIds.length >= 2);
});

test("a restarted runtime automatically recovers persisted running jobs but not paused jobs", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-recovery-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source, { recursive: true });
  await mkdir(snapshots, { recursive: true });
  await writeFile(path.join(source, "entry.js"), "export function recoveredCapability() { return true; }\n");
  const store = new MemoryTraceabilityStore();
  await store.appendProjectFoundation({ project: { id: "RECOVERY", name: "Recovery" } });
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const initial = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: broker,
    childProducer: deterministicFixtureChildProducer,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const registration = await initial.registerSource({
    projectId: "RECOVERY",
    rootPath: source,
    displayName: "Recovery source",
  });
  await store.appendUnderstandingRecord("RECOVERY", "WORKSPACE_EXECUTION_PROFILE", {
    id: "PROFILE-RECOVERY",
    workspaceId: "RECOVERY",
    childSlots: [
      { id: "CHILD-1", model: "FIXTURE", skillNames: [], mcpNames: [], independenceGroup: "A" },
      { id: "CHILD-2", model: "FIXTURE", skillNames: [], mcpNames: [], independenceGroup: "B" },
    ],
    createdAt: new Date().toISOString(),
  });
  const seedRunner = new WorkspaceAnalysisJobRunner({ store, handlers: {} });
  const running = await seedRunner.start({
    id: "RECOVER-ME",
    projectId: "RECOVERY",
    sourceRegistrationId: registration.id,
    snapshotManifestId: "SNAPSHOT-RECOVERY",
    requestedMode: "FULL",
    policyDigest: "fixture-policy",
    workspaceExecutionProfileRevisionId: "PROFILE-RECOVERY",
  });
  const paused = await seedRunner.pause(await seedRunner.start({
    id: "STAY-PAUSED",
    projectId: "RECOVERY",
    sourceRegistrationId: registration.id,
    snapshotManifestId: "SNAPSHOT-PAUSED",
    requestedMode: "FULL",
    policyDigest: "fixture-policy",
    workspaceExecutionProfileRevisionId: "PROFILE-RECOVERY",
  }));
  assert.equal(running.status, "RUNNING");
  assert.equal(paused.status, "PAUSED");

  const restarted = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: broker,
    childProducer: deterministicFixtureChildProducer,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const recovered = await restarted.recover();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "COMPLETED", JSON.stringify(recovered[0].error));
  assert.equal((await restarted.get("RECOVERY", "RECOVER-ME")).status, "COMPLETED");
  assert.equal((await restarted.get("RECOVERY", "STAY-PAUSED")).status, "PAUSED");
});
