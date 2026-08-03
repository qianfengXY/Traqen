import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LegacyUnderstandingRuntime } from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { WorkspaceAnalysisJobRunner } from "../src/application/workspace-analysis-job-runner.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";
import { canonicalJson, contentId } from "../src/domain/index.js";
import {
  deterministicFixtureChildProducer,
  fixtureEquivalenceResolver,
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
  let producerCalls = 0;
  const selectedProducer = async (input) => {
    producerCalls += 1;
    assert.equal(input.assignment.route.model, "LOCAL-DETERMINISTIC-PROFILE");
    assert.equal(input.executionProfile.id, "LOCAL-DETERMINISTIC-PROFILE");
    return deterministicFixtureChildProducer(input);
  };
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: broker,
    childProducer: selectedProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
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
  assert.equal(producerCalls, 4);
  assert.deepEqual(first.completedPhases, ["SOURCE_SCAN", "FACT_COMMIT", "ANALYSIS", "RECONCILIATION", "EVALUATION", "PROJECTION", "PUBLISHING"]);
  const currentA = await store.getCurrentGraphHead("P");
  const revisionA = await store.getUnderstandingRecord("P", "GRAPH_REVISION", currentA.graphRevisionId);
  const artifactA = await store.getUnderstandingRecord("P", "GRAPH_ARTIFACT", revisionA.graphArtifactId);
  assert.ok(artifactA.nodes.some(({ authority }) => authority === "CANDIDATE"));
  const candidateIds = artifactA.nodes.filter(({ type }) => type === "CANDIDATE_FEATURE").map(({ id }) => id);
  const candidateChains = artifactA.traceChains.filter(({ subject }) => subject?.kind === "CANDIDATE");
  assert.deepEqual(candidateChains.map(({ subject }) => subject.id).sort(), candidateIds.sort());
  assert.ok(candidateChains.every(({ complete }) => complete === false));
  assert.ok(candidateChains.some(({ segments, gaps, analysisEvidenceNodeIds }) =>
    segments.some(({ type, nodeIds }) => type === "IMPLEMENTATION" && nodeIds.length > 0)
    && segments.some(({ type, nodeIds }) => type === "EVIDENCE" && nodeIds.length === 0)
    && analysisEvidenceNodeIds.length > 0
    && gaps.some(({ type }) => type === "MISSING_REQUIREMENT")));
  assert.deepEqual(
    artifactA.traceChains.filter(({ subject }) => subject?.kind === "RELATION").map(({ subject }) => subject.id).sort(),
    artifactA.edges.map(({ id }) => id).sort(),
  );

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

  await rm(path.join(source, "lib", "customers.js"));
  const deleted = await runtime.start({
    id: "JOB-4-DELETED-ARTIFACT",
    projectId: "P",
    sourceRegistrationId: registration.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(deleted.status, "COMPLETED", JSON.stringify(deleted.error));
  const deletedPlan = await store.getUnderstandingRecord(
    "P",
    "INCREMENTAL_PLAN",
    deleted.outputs.SOURCE_SCAN.incrementalPlanId,
  );
  assert.ok(deletedPlan.changes.some(({ type, path: changedPath }) =>
    type === "REMOVED" && changedPath === "lib/customers.js"));
  assert.ok(deletedPlan.affectedWorkUnitIds.length > 0);
  assert.ok(deletedPlan.retiredWorkUnitIds.length > 0);

  await writeFile(path.join(source, "src", "orders.js"), "export function brokenEquivalence() { return false; }\n");
  const rejectingRuntime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: broker,
    childProducer: selectedProducer,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("src/orders.js"),
    equivalenceResolver: async ({ job, surface }) => {
      const divergentContent = { ...structuredClone(surface), candidates: [] };
      delete divergentContent.digest;
      const divergent = {
        digest: contentId("UNDERSTANDING-SEMANTIC-SURFACE", canonicalJson(divergentContent)),
        ...divergentContent,
      };
      return {
        replay: {
          analysisRunId: `${job.id}:REPLAY`, snapshotManifestId: job.snapshotManifestId,
          policyDigest: job.policyDigest, mode: job.resolvedMode, independent: true,
          producer: { id: "INDEPENDENT", version: "1" }, surface,
        },
        full: {
          analysisRunId: `${job.id}:FULL`, snapshotManifestId: job.snapshotManifestId,
          policyDigest: job.policyDigest, mode: "FULL", independent: true,
          producer: { id: "INDEPENDENT", version: "1" }, surface: divergent,
        },
      };
    },
  });
  const rejected = await rejectingRuntime.start({
    id: "JOB-5-EQUIVALENCE-FAIL",
    projectId: "P",
    sourceRegistrationId: registration.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(rejected.status, "FAILED");
  assert.match(rejected.error.message, /Evaluation is FAILED/);
  const currentAfterRejected = await store.getCurrentGraphHead("P");
  assert.equal(currentAfterRejected.graphRevisionId, deleted.outputs.PUBLISHING.currentGraphHead.graphRevisionId);
  const equivalenceReports = await store.listUnderstandingRecords("P", "EQUIVALENCE_REPORT");
  assert.equal(equivalenceReports.find(({ analysisRunId }) => analysisRunId === rejected.id).status, "FAILED");
});

test("missing configured Child executors persist explicit gaps and cannot publish synthetic candidates", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-no-producer-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function realProducerRequired() {}\n");
  const store = new MemoryTraceabilityStore();
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: broker,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
    equivalenceResolver: fixtureEquivalenceResolver,
  });
  const registration = await runtime.registerSource({ projectId: "NO-PRODUCER", rootPath: source, displayName: "No producer" });
  const failed = await runtime.start({
    id: "NO-PRODUCER-JOB",
    projectId: "NO-PRODUCER",
    sourceRegistrationId: registration.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(failed.status, "FAILED");
  assert.equal(await store.getCurrentGraphHead("NO-PRODUCER"), null);
  const results = await store.listUnderstandingRecords("NO-PRODUCER", "CHILD_BATCH_RESULT");
  assert.ok(results.length > 0);
  assert.ok(results.every(({ status, output }) =>
    status === "GAP" && output.gap.code === "NO_ELIGIBLE_PRODUCER"));
  const bundles = await store.listUnderstandingRecords("NO-PRODUCER", "CANDIDATE_BUNDLE");
  assert.equal(bundles.at(-1).candidates.length, 0);
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
    equivalenceResolver: fixtureEquivalenceResolver,
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
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const recovered = await restarted.recover();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "COMPLETED", JSON.stringify(recovered[0].error));
  assert.equal((await restarted.get("RECOVERY", "RECOVER-ME")).status, "COMPLETED");
  assert.equal((await restarted.get("RECOVERY", "STAY-PAUSED")).status, "PAUSED");
});
