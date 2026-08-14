import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LegacyUnderstandingRuntime,
  reviewedCandidateTraceComplete,
  validateProjectionSourceSliceReferences,
} from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { WorkspaceAnalysisJobRunner } from "../src/application/workspace-analysis-job-runner.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";
import { canonicalJson, contentId, createFeatureVersion } from "../src/domain/index.js";
import { validateRelationAgainstEvidenceAllowset } from "../src/analysis/index.js";
import {
  deterministicFixtureChildProducer,
  deterministicFixtureMainProducer,
  fixtureEquivalenceResolver,
  fixtureReviewedEvaluationResolver,
  persistFixtureExecutionProfile,
  persistFixtureIndependentRun,
} from "./helpers/legacy-understanding-fixture.js";

test("Candidate completeness cannot exceed its canonical reviewed TraceChain", () => {
  assert.equal(reviewedCandidateTraceComplete({ complete: true }, []), true);
  assert.equal(reviewedCandidateTraceComplete({ complete: false }, []), false);
  assert.equal(reviewedCandidateTraceComplete({ complete: true }, [{ type: "MISSING_EVIDENCE" }]), false);
  assert.equal(reviewedCandidateTraceComplete(null, []), false);
});

async function runProducerBoundaryScenario(projectId, { childProducer, mainProducer, credentialHandleIds = [] }) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-producer-boundary-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(
    path.join(source, "entry.js"),
    "export function producerBoundary() { return true; }\nexport function secondEvidence() { return true; }\n",
  );
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, projectId, "LOCAL-DETERMINISTIC-PROFILE", { credentialHandleIds });
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots }),
    childProducer,
    mainProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const registration = await runtime.registerSource({ projectId, rootPath: source, displayName: projectId });
  const result = await runtime.start({
    id: `${projectId}-JOB`, projectId, sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id, requestedMode: "FULL",
  }, { background: false });
  return { result, store, runtime, registration, profile };
}

test("runtime issues and mounts only Run- and Slot-scoped model secret grants", async () => {
  const observed = [];
  const childProducer = async (input) => {
    observed.push({ slotId: input.assignment.slotId, grants: input.secretGrants });
    return deterministicFixtureChildProducer(input);
  };
  const mainProducer = async (input) => {
    observed.push({ slotId: "MAIN", grants: input.secretGrants });
    return deterministicFixtureMainProducer(input);
  };
  const { result, store, profile } = await runProducerBoundaryScenario("P-SCOPED-GRANTS", {
    childProducer,
    mainProducer,
    credentialHandleIds: ["MODEL-HANDLE-1"],
  });
  assert.equal(result.status, "COMPLETED", JSON.stringify(result.error));
  assert.ok(observed.length >= 3);
  for (const { slotId, grants } of observed) {
    assert.equal(grants.length, 1);
    assert.equal(grants[0].workspaceId, "P-SCOPED-GRANTS");
    assert.equal(grants[0].profileId, profile.id);
    assert.equal(grants[0].analysisRunId, "P-SCOPED-GRANTS-JOB");
    assert.equal(grants[0].slotId, slotId);
    assert.equal(grants[0].credentialHandleId, "MODEL-HANDLE-1");
  }
  const persisted = await store.listUnderstandingRecords("P-SCOPED-GRANTS", "SECRET_GRANT");
  assert.equal(persisted.length, 3);
});

async function runCanonicalRelationScenario(projectId, { sourceContent, childEvidence }) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-canonical-relation-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), sourceContent);
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, projectId);
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots }),
    childProducer: async ({ candidate, sourceSlices }) => ({
      candidates: [{
        name: candidate.proposal.name,
        statement: `${childEvidence} relation candidate`,
        confidence: "LOW",
        evidenceFactIds: childEvidence === "FACT" ? [...candidate.evidenceFactIds] : [],
        sourceSliceIds: childEvidence === "SOURCE_SLICE" ? [sourceSlices[0].id] : [],
      }],
    }),
    mainProducer: async (input) => {
      const accepted = await deterministicFixtureMainProducer(input);
      const option = input.candidateOptions[0];
      return {
        ...accepted,
        relations: [{
          sourceCandidateRef: option.ref,
          predicate: "RELATES_TO",
          targetArtifactId: input.scopedArtifacts[0].id,
          evidenceFactIds: [...(option.proposal.evidenceFactIds ?? [])],
          sourceSliceIds: [...(option.proposal.sourceSliceIds ?? [])],
        }],
      };
    },
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const registration = await runtime.registerSource({ projectId, rootPath: source, displayName: projectId });
  const result = await runtime.start({
    id: `${projectId}-JOB`,
    projectId,
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "FULL",
  }, { background: false });
  return { result, store, runtime, registration, profile };
}

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
  await store.appendFeatureVersion("P", createFeatureVersion({
    id: "FEATURE-RUNTIME-HISTORICAL",
    version: 1,
    name: "Runtime historical Feature",
  }));
  const profile = await persistFixtureExecutionProfile(store, "P");
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  let producerCalls = 0;
  let mainCalls = 0;
  const selectedProducer = async (input) => {
    producerCalls += 1;
    assert.equal(input.assignment.route.model, "LOCAL-DETERMINISTIC-PROFILE");
    assert.equal(input.executionProfile.id, "LOCAL-DETERMINISTIC-PROFILE");
    const output = await deterministicFixtureChildProducer(input);
    return {
      candidates: output.candidates.map((candidate) => ({
        ...candidate,
        statement: `${candidate.statement} (${input.assignment.slotId} independent wording)`,
      })),
    };
  };
  const selectedMain = async (input) => {
    mainCalls += 1;
    return deterministicFixtureMainProducer(input);
  };
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: broker,
    childProducer: selectedProducer,
    mainProducer: selectedMain,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("src/orders.js"),
  });
  const registration = await runtime.registerSource({ projectId: "P", rootPath: source, displayName: "Traqen fixture" });
  const first = await runtime.start({
    id: "JOB-1",
    projectId: "P",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(first.status, "COMPLETED", JSON.stringify(first.error));
  assert.ok(producerCalls >= 8);
  assert.equal(mainCalls, producerCalls / 2);
  assert.equal((await store.listUnderstandingRecords("P", "MAIN_BATCH_RESULT")).length, mainCalls);
  assert.deepEqual(first.completedPhases, ["SOURCE_SCAN", "FACT_COMMIT", "ANALYSIS", "RECONCILIATION", "EVALUATION", "PROJECTION", "PUBLISHING"]);
  const currentA = await store.getCurrentGraphHead("P");
  const revisionA = await store.getUnderstandingRecord("P", "GRAPH_REVISION", currentA.graphRevisionId);
  const artifactA = await store.getUnderstandingRecord("P", "GRAPH_ARTIFACT", revisionA.graphArtifactId);
  assert.equal(artifactA.featureTraceability[0].featureId, "FEATURE-RUNTIME-HISTORICAL");
  assert.equal(artifactA.featureTraceability[0].traceability.feature.version, 1);
  assert.equal(artifactA.featureTraceability[0].traceability.snapshotManifest.id, revisionA.snapshotManifestId);
  assert.equal(artifactA.graphArtifactDigest, revisionA.graphArtifactDigest);
  const traceabilityApplication = new TraceabilityApplication({ store });
  await traceabilityApplication.appendFeatureVersion("P", {
    id: "FEATURE-RUNTIME-HISTORICAL",
    version: 2,
    name: "Runtime current Feature",
  });
  const historicalTraceability = await traceabilityApplication.getFeatureTraceability(
    "P",
    "FEATURE-RUNTIME-HISTORICAL",
    revisionA.snapshotManifestId,
    { graphRevisionId: revisionA.id },
  );
  const currentTraceability = await traceabilityApplication.getFeatureTraceability(
    "P",
    "FEATURE-RUNTIME-HISTORICAL",
    revisionA.snapshotManifestId,
  );
  assert.equal(historicalTraceability.feature.version, 1);
  assert.equal(currentTraceability.feature.version, 2);
  const historicalGraph = await traceabilityApplication.getFeatureGraph(
    "P",
    "FEATURE-RUNTIME-HISTORICAL",
    revisionA.snapshotManifestId,
    { rootNodeId: "FEATURE-RUNTIME-HISTORICAL", graphRevisionId: revisionA.id },
  );
  const historicalNode = historicalGraph.nodes.find(({ id }) => id === "FEATURE-RUNTIME-HISTORICAL");
  assert.equal(historicalNode.label, "Runtime historical Feature");
  const resolvedHistoricalNode = await traceabilityApplication.resolveGraphEvidence(
    "P",
    revisionA.id,
    "node",
    historicalNode.id,
    {
      featureId: historicalNode.id,
      rootNodeId: historicalNode.id,
      snapshotManifestId: revisionA.snapshotManifestId,
    },
  );
  assert.equal(resolvedHistoricalNode.object.label, "Runtime historical Feature");
  assert.equal(resolvedHistoricalNode.context.graphArtifactDigest, artifactA.graphArtifactDigest);
  assert.ok(artifactA.nodes.some(({ authority }) => authority === "CANDIDATE"));
  assert.ok(artifactA.nodes.filter(({ authority }) => authority === "CANDIDATE").length >= producerCalls);
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
    workspaceExecutionProfileRevisionId: profile.id,
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
    workspaceExecutionProfileRevisionId: profile.id,
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
    workspaceExecutionProfileRevisionId: profile.id,
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
    mainProducer: selectedMain,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("src/orders.js"),
    equivalenceResolver: async ({ job, surface, store: evidenceStore }) => {
      const divergentContent = { ...structuredClone(surface), candidates: [] };
      delete divergentContent.digest;
      const divergent = {
        digest: contentId("UNDERSTANDING-SEMANTIC-SURFACE", canonicalJson(divergentContent)),
        ...divergentContent,
      };
      const replay = await persistFixtureIndependentRun({
        store: evidenceStore, job, surface, id: `${job.id}:REPLAY`, mode: job.resolvedMode,
      });
      const full = await persistFixtureIndependentRun({
        store: evidenceStore, job, surface: divergent, id: `${job.id}:FULL`, mode: "FULL",
      });
      return { replayAnalysisRunId: replay.id, fullAnalysisRunId: full.id };
    },
  });
  const rejected = await rejectingRuntime.start({
    id: "JOB-5-EQUIVALENCE-FAIL",
    projectId: "P",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(rejected.status, "FAILED");
  assert.match(rejected.error.message, /Evaluation is FAILED/);
  const currentAfterRejected = await store.getCurrentGraphHead("P");
  assert.equal(currentAfterRejected.graphRevisionId, deleted.outputs.PUBLISHING.currentGraphHead.graphRevisionId);
  const equivalenceReports = await store.listUnderstandingRecords("P", "EQUIVALENCE_REPORT");
  assert.equal(equivalenceReports.find(({ analysisRunId }) => analysisRunId === rejected.id).status, "FAILED");
});

test("incremental reuse is invalidated when the pinned execution profile changes", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-profile-reuse-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function profileBoundCapability() { return true; }\n");
  const store = new MemoryTraceabilityStore();
  const profileA = await persistFixtureExecutionProfile(store, "PROFILE-REUSE", "PROFILE-A");
  const profileB = await persistFixtureExecutionProfile(store, "PROFILE-REUSE", "PROFILE-B");
  const calls = { "PROFILE-A": 0, "PROFILE-B": 0 };
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots }),
    childProducer: async (input) => {
      calls[input.executionProfile.id] += 1;
      const output = await deterministicFixtureChildProducer(input);
      return {
        candidates: output.candidates.map((candidate) => ({
          ...candidate,
          name: `${input.executionProfile.id} capability`,
          statement: `${input.executionProfile.id} produced this statement`,
        })),
      };
    },
    mainProducer: deterministicFixtureMainProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const registration = await runtime.registerSource({
    projectId: "PROFILE-REUSE", rootPath: source, displayName: "Profile reuse",
  });
  const first = await runtime.start({
    id: "PROFILE-A-JOB",
    projectId: "PROFILE-REUSE",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profileA.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(first.status, "COMPLETED", JSON.stringify(first.error));
  const profileACalls = calls["PROFILE-A"];
  assert.ok(profileACalls > 0);

  const second = await runtime.start({
    id: "PROFILE-B-JOB",
    projectId: "PROFILE-REUSE",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profileB.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(second.status, "COMPLETED", JSON.stringify(second.error));
  assert.ok(calls["PROFILE-B"] > 0);
  assert.equal(calls["PROFILE-A"], profileACalls);
  assert.equal(second.outputs.ANALYSIS.reusedCandidateIds.length, 0);
  assert.ok(second.outputs.ANALYSIS.routeDecisionIds.length > 0);
  const plan = await store.getUnderstandingRecord(
    "PROFILE-REUSE", "INCREMENTAL_PLAN", second.outputs.SOURCE_SCAN.incrementalPlanId,
  );
  assert.equal(plan.reuseCompatibility.compatible, false);
  assert.ok(plan.reuseCompatibility.reasons.includes("WORKSPACE_EXECUTION_PROFILE_REVISION_CHANGED"));
  assert.ok(plan.workUnitReuseDecisions.every(({ disposition, previousProfileRevisionId, currentProfileRevisionId }) =>
    disposition === "REVALIDATE"
    && previousProfileRevisionId === profileA.id
    && currentProfileRevisionId === profileB.id));
  const bundle = await store.getUnderstandingRecord(
    "PROFILE-REUSE", "CANDIDATE_BUNDLE", second.outputs.ANALYSIS.candidateBundleId,
  );
  assert.equal(bundle.workspaceExecutionProfileRevisionId, profileB.id);
  assert.equal(bundle.reuseContract.executionPolicyDigest, "traqen-understanding-runtime-v1");
  assert.ok(bundle.reuseContract.producerContractDigest);
  assert.ok(bundle.reuseContract.producerContract.childProducers.every((producer) =>
    producer.modelRevision === profileB.id
    && producer.skillVersion === profileB.id
    && Array.isArray(producer.mcpNames)));
  assert.ok(bundle.candidates.length > 0);
  assert.ok(bundle.candidates.every(({ proposal }) => proposal.statement.includes("PROFILE-B")));
  assert.ok(bundle.candidates.every(({ proposal }) => !proposal.statement.includes("PROFILE-A")));
});

test("incremental reuse is invalidated when the execution policy digest changes", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-policy-reuse-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function policyBoundCapability() { return true; }\n");
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, "POLICY-REUSE");
  let producerCalls = 0;
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots }),
    childProducer: async (input) => {
      producerCalls += 1;
      return deterministicFixtureChildProducer(input);
    },
    mainProducer: deterministicFixtureMainProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const registration = await runtime.registerSource({
    projectId: "POLICY-REUSE", rootPath: source, displayName: "Policy reuse",
  });
  const first = await runtime.start({
    id: "POLICY-A-JOB",
    projectId: "POLICY-REUSE",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    policyDigest: "POLICY-A",
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(first.status, "COMPLETED", JSON.stringify(first.error));
  const callsAfterFirst = producerCalls;
  const second = await runtime.start({
    id: "POLICY-B-JOB",
    projectId: "POLICY-REUSE",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    policyDigest: "POLICY-B",
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(second.status, "COMPLETED", JSON.stringify(second.error));
  assert.ok(producerCalls > callsAfterFirst);
  assert.equal(second.outputs.ANALYSIS.reusedCandidateIds.length, 0);
  const plan = await store.getUnderstandingRecord(
    "POLICY-REUSE", "INCREMENTAL_PLAN", second.outputs.SOURCE_SCAN.incrementalPlanId,
  );
  assert.equal(plan.reuseCompatibility.compatible, false);
  assert.ok(plan.reuseCompatibility.reasons.includes("EXECUTION_POLICY_DIGEST_CHANGED"));
});

test("SourceSlice-only evidence is retained as safe canonical graph lineage", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-source-slice-graph-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  const rawSecret = "do-not-publish-this-secret";
  await writeFile(path.join(source, "entry.js"), `const api_key = "${rawSecret}";\nconst opaqueCapability = true;\n`);
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, "SLICE-GRAPH");
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots }),
    childProducer: deterministicFixtureChildProducer,
    mainProducer: deterministicFixtureMainProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const registration = await runtime.registerSource({
    projectId: "SLICE-GRAPH", rootPath: source, displayName: "SourceSlice graph",
  });
  const completed = await runtime.start({
    id: "SLICE-GRAPH-JOB",
    projectId: "SLICE-GRAPH",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(completed.status, "COMPLETED", JSON.stringify(completed.error));
  const bundle = await store.getUnderstandingRecord(
    "SLICE-GRAPH", "CANDIDATE_BUNDLE", completed.outputs.ANALYSIS.candidateBundleId,
  );
  const sliceIds = [...new Set(bundle.candidates.flatMap(({ sourceSliceIds }) => sourceSliceIds))];
  assert.ok(sliceIds.length > 0);
  assert.ok(bundle.candidates.every(({ evidenceFactIds, sourceSliceIds }) =>
    evidenceFactIds.length === 0 && sourceSliceIds.length > 0));
  const revision = await store.getUnderstandingRecord(
    "SLICE-GRAPH", "GRAPH_REVISION", completed.outputs.PROJECTION.graphRevisionId,
  );
  const graph = await store.getUnderstandingRecord("SLICE-GRAPH", "GRAPH_ARTIFACT", revision.graphArtifactId);
  for (const sliceId of sliceIds) {
    const node = graph.nodes.find(({ id }) => id === sliceId);
    assert.equal(node?.type, "SOURCE_SLICE_EVIDENCE");
    assert.equal(node?.authority, "CANDIDATE");
    assert.ok(graph.edges.some(({ target, type }) => target === sliceId && type === "SUPPORTED_BY"));
    assert.ok(graph.traceChains.some(({ subject, nodeIds, segments, analysisEvidenceNodeIds }) =>
      subject?.kind === "CANDIDATE"
      && nodeIds.includes(sliceId)
      && analysisEvidenceNodeIds.includes(sliceId)
      && segments.some(({ type, nodeIds: evidenceIds }) => type === "EVIDENCE" && evidenceIds.includes(sliceId))));
  }
  const serializedGraph = canonicalJson(graph);
  assert.doesNotMatch(serializedGraph, new RegExp(rawSecret));
  assert.doesNotMatch(serializedGraph, /redactedText/);
});

test("SourceSlice projection scope validation covers Project, Snapshot, AnalysisRun, and WorkUnit", () => {
  const job = { id: "RUN", projectId: "PROJECT", snapshotManifestId: "SNAPSHOT" };
  const candidate = { id: "CANDIDATE", workUnitId: "WORK-UNIT", sourceSliceIds: ["SLICE"] };
  const validSlice = {
    id: "SLICE",
    projectId: job.projectId,
    snapshotManifestId: job.snapshotManifestId,
    analysisRunId: job.id,
    workUnitId: candidate.workUnitId,
    status: "COMPLETE",
  };
  assert.equal(validateProjectionSourceSliceReferences({
    job, candidates: [candidate], sourceSlices: [validSlice],
  }), true);
  for (const [field, value] of [
    ["projectId", "FOREIGN-PROJECT"],
    ["snapshotManifestId", "FOREIGN-SNAPSHOT"],
    ["analysisRunId", "FOREIGN-RUN"],
    ["workUnitId", "FOREIGN-WORK-UNIT"],
  ]) {
    assert.throws(() => validateProjectionSourceSliceReferences({
      job,
      candidates: [candidate],
      sourceSlices: [{ ...validSlice, [field]: value }],
    }), new RegExp(`${field} is outside`));
  }
  assert.throws(() => validateProjectionSourceSliceReferences({
    job, candidates: [candidate], sourceSlices: [],
  }), /is unavailable/);
  assert.throws(() => validateProjectionSourceSliceReferences({
    job, candidates: [candidate], sourceSlices: [{ ...validSlice, status: "REJECTED" }],
  }), /is rejected/);
});

test("foreign SourceSlice scope fails projection without creating a revision or moving GraphHead", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-foreign-slice-projection-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "const opaqueCapability = true;\n");
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, "FOREIGN-SLICE");
  const sourceSliceBroker = {
    async read(request) {
      const artifactId = request.selectors[0].artifactId;
      const slice = {
        id: contentId("FOREIGN-PROJECTION-SLICE", { requestId: request.id }),
        requestId: request.id,
        projectId: "ANOTHER-PROJECT",
        snapshotManifestId: request.snapshotManifestId,
        analysisRunId: request.analysisRunId,
        workUnitId: request.workUnitId,
        status: "COMPLETE",
        artifactSlices: [{
          artifactId,
          relativePath: "entry.js",
          contentDigest: "sha256:fixture",
          range: { startByte: 0, endByte: 30 },
          redactedText: "const opaqueCapability = true;",
        }],
        factIds: [],
        redactions: [],
        contentDigest: "sha256:foreign-slice",
        truncated: false,
        omittedReasons: [],
        diagnostics: [],
        policyDecisionId: "FOREIGN-POLICY-DECISION",
        responseDigest: "sha256:foreign-response",
        createdAt: new Date().toISOString(),
      };
      await store.appendUnderstandingRecord(request.projectId, "SOURCE_SLICE", slice);
      return slice;
    },
  };
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker,
    childProducer: deterministicFixtureChildProducer,
    mainProducer: deterministicFixtureMainProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const registration = await runtime.registerSource({
    projectId: "FOREIGN-SLICE", rootPath: source, displayName: "Foreign SourceSlice",
  });
  const failed = await runtime.start({
    id: "FOREIGN-SLICE-JOB",
    projectId: "FOREIGN-SLICE",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error.message, /projectId is outside the graph projection scope/);
  assert.equal(await store.getCurrentGraphHead("FOREIGN-SLICE"), null);
  assert.equal((await store.listUnderstandingRecords("FOREIGN-SLICE", "GRAPH_ARTIFACT")).length, 0);
  assert.equal((await store.listUnderstandingRecords("FOREIGN-SLICE", "GRAPH_REVISION")).length, 0);
});

test("Main Candidate relations preserve Fact and SourceSlice evidence in canonical graph lineage", async (t) => {
  const cases = [
    {
      name: "Fact-backed relation",
      projectId: "RELATION-FACT",
      sourceContent: "export function relatedCapability() { return true; }\n",
      childEvidence: "FACT",
    },
    {
      name: "SourceSlice-only relation",
      projectId: "RELATION-SLICE-ONLY",
      sourceContent: "const opaqueRelatedCapability = true;\n",
      childEvidence: "SOURCE_SLICE",
    },
    {
      name: "SourceSlice relation in a mixed Fact and SourceSlice WorkUnit",
      projectId: "RELATION-MIXED-EVIDENCE",
      sourceContent: "export function mixedRelatedCapability() { return true; }\n",
      childEvidence: "SOURCE_SLICE",
    },
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const { result, store, runtime, registration, profile } = await runCanonicalRelationScenario(
        testCase.projectId,
        testCase,
      );
      assert.equal(result.status, "COMPLETED", JSON.stringify(result.error));
      const bundle = await store.getUnderstandingRecord(
        testCase.projectId, "CANDIDATE_BUNDLE", result.outputs.ANALYSIS.candidateBundleId,
      );
      assert.ok(bundle.relations.length > 0);
      const revision = await store.getUnderstandingRecord(
        testCase.projectId, "GRAPH_REVISION", result.outputs.PROJECTION.graphRevisionId,
      );
      const graph = await store.getUnderstandingRecord(testCase.projectId, "GRAPH_ARTIFACT", revision.graphArtifactId);
      for (const relation of bundle.relations) {
        const edge = graph.edges.find(({ id }) => id === relation.id);
        assert.equal(edge?.source, relation.sourceId);
        assert.equal(edge?.target, relation.targetId);
        assert.equal(edge?.type, relation.predicate);
        assert.equal(edge?.authority, "CANDIDATE");
        assert.deepEqual(edge?.evidenceFactIds, relation.evidenceFactIds);
        assert.deepEqual(edge?.sourceSliceIds, relation.sourceSliceIds);
        const chain = graph.traceChains.find(({ subject }) =>
          subject?.kind === "RELATION" && subject.id === relation.id);
        const evidenceIds = [...relation.evidenceFactIds, ...relation.sourceSliceIds];
        assert.ok(chain);
        assert.ok(evidenceIds.every((id) => chain.nodeIds.includes(id)));
        assert.ok(chain.segments.some(({ type, nodeIds }) =>
          type === "EVIDENCE" && evidenceIds.every((id) => nodeIds.includes(id))));
      }
      const incremental = await runtime.start({
        id: `${testCase.projectId}-INCREMENTAL-JOB`,
        projectId: testCase.projectId,
        sourceRegistrationId: registration.id,
        workspaceExecutionProfileRevisionId: profile.id,
        requestedMode: "AUTO",
      }, { background: false });
      assert.equal(incremental.status, "COMPLETED", JSON.stringify(incremental.error));
      const incrementalBundle = await store.getUnderstandingRecord(
        testCase.projectId, "CANDIDATE_BUNDLE", incremental.outputs.ANALYSIS.candidateBundleId,
      );
      const incrementalRevision = await store.getUnderstandingRecord(
        testCase.projectId, "GRAPH_REVISION", incremental.outputs.PROJECTION.graphRevisionId,
      );
      const incrementalGraph = await store.getUnderstandingRecord(
        testCase.projectId, "GRAPH_ARTIFACT", incrementalRevision.graphArtifactId,
      );
      assert.ok(incrementalBundle.relations.every(({ id }) =>
        incrementalGraph.edges.some((edge) => edge.id === id)
        && incrementalGraph.traceChains.some(({ subject }) =>
          subject?.kind === "RELATION" && subject.id === id)));
    });
  }
});

test("SourceSlice revalidation invalidates dependent relation synthesis while preserving unrelated reuse", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-slice-dependency-closure-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(path.join(source, "src"), { recursive: true });
  await mkdir(path.join(source, "lib"), { recursive: true });
  await mkdir(snapshots);
  await writeFile(path.join(source, "src", "mixed.js"), "export function mixedEvidenceLeaf() { return true; }\n");
  await writeFile(path.join(source, "lib", "unrelated.js"), "export function unrelatedLeaf() { return true; }\n");
  const backingStore = new MemoryTraceabilityStore();
  let corruptReconciliationRunId = null;
  const store = new Proxy(backingStore, {
    get(target, property) {
      if (property === "getUnderstandingRecord") {
        return async (projectId, recordType, recordId) => {
          const record = await target.getUnderstandingRecord(projectId, recordType, recordId);
          if (recordType !== "RECONCILIATION"
            || record?.analysisRunId !== corruptReconciliationRunId
            || record.relations.length === 0) return record;
          const corrupted = structuredClone(record);
          corrupted.relations[0].targetId = "STALE-CANDIDATE-ENDPOINT";
          return corrupted;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const profile = await persistFixtureExecutionProfile(store, "SLICE-CLOSURE");
  const childProducer = async ({ artifact, assignment, candidate, sourceSlices }) => {
    const sourceSliceLeaf = artifact.relativePath === "src/mixed.js"
      && assignment.slotId === "CHILD-1";
    return { candidates: [{
      name: candidate.proposal.name,
      statement: `${artifact.relativePath} ${assignment.slotId}`,
      confidence: "LOW",
      evidenceFactIds: sourceSliceLeaf ? [] : [...candidate.evidenceFactIds],
      sourceSliceIds: sourceSliceLeaf ? [sourceSlices[0].id] : [],
    }] };
  };
  const mainProducer = async (input) => {
    const accepted = await deterministicFixtureMainProducer(input);
    if (input.workUnit.kind === "LEAF") return accepted;
    const target = input.workUnit.kind === "MODULE_SYNTHESIS"
      ? input.contextCandidates.find(({ sourceSliceIds }) => sourceSliceIds.length > 0)
      : input.contextCandidates[0];
    return {
      ...accepted,
      relations: [{
        sourceCandidateRef: input.candidateOptions[0].ref,
        predicate: "DEPENDS_ON",
        targetArtifactId: target.id,
        evidenceFactIds: [...input.candidateOptions[0].proposal.evidenceFactIds],
        sourceSliceIds: [],
      }],
    };
  };
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots }),
    childProducer,
    mainProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("src/mixed.js"),
  });
  const registration = await runtime.registerSource({
    projectId: "SLICE-CLOSURE", rootPath: source, displayName: "SourceSlice closure",
  });
  const first = await runtime.start({
    id: "SLICE-CLOSURE-FULL",
    projectId: "SLICE-CLOSURE",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(first.status, "COMPLETED", JSON.stringify(first.error));
  const firstBundle = await store.getUnderstandingRecord(
    "SLICE-CLOSURE", "CANDIDATE_BUNDLE", first.outputs.ANALYSIS.candidateBundleId,
  );
  const sourceSliceLeaf = firstBundle.candidates.find(({ sourceSliceIds }) => sourceSliceIds.length > 0);
  assert.ok(sourceSliceLeaf);
  assert.ok(firstBundle.relations.some(({ targetId }) => targetId === sourceSliceLeaf.id));

  const incremental = await runtime.start({
    id: "SLICE-CLOSURE-AUTO",
    projectId: "SLICE-CLOSURE",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(incremental.status, "COMPLETED", JSON.stringify(incremental.error));
  const incrementalPlan = await store.getUnderstandingRecord(
    "SLICE-CLOSURE", "INCREMENTAL_PLAN", incremental.outputs.SOURCE_SCAN.incrementalPlanId,
  );
  const plan = await store.getUnderstandingRecord(
    "SLICE-CLOSURE", "UNDERSTANDING_PLAN", incremental.outputs.SOURCE_SCAN.planId,
  );
  const dependentIds = new Set([sourceSliceLeaf.workUnitId]);
  for (const unit of plan.workUnits) {
    if (unit.dependencies.some((id) => dependentIds.has(id))) dependentIds.add(unit.id);
  }
  assert.ok([...dependentIds].every((id) => incrementalPlan.affectedWorkUnitIds.includes(id)));
  assert.ok([...dependentIds].every((id) => !incrementalPlan.reusedWorkUnitIds.includes(id)));
  assert.deepEqual(
    incremental.outputs.ANALYSIS.revalidatedWorkUnitIds,
    [...incrementalPlan.affectedWorkUnitIds].sort(),
  );
  assert.deepEqual(incrementalPlan.sourceSliceRevalidationWorkUnitIds, [sourceSliceLeaf.workUnitId]);
  assert.deepEqual(incrementalPlan.revalidationPlan.affectedWorkUnitIds, [...incrementalPlan.affectedWorkUnitIds].sort());
  assert.equal(incrementalPlan.revalidationPlan.required, true);
  assert.ok(incrementalPlan.revalidationPlan.affectedArtifactIds.length > 0);
  assert.ok(incrementalPlan.reusedWorkUnitIds.length > 0);
  const incrementalBundle = await store.getUnderstandingRecord(
    "SLICE-CLOSURE", "CANDIDATE_BUNDLE", incremental.outputs.ANALYSIS.candidateBundleId,
  );
  assert.ok(incrementalBundle.relations.every(({ sourceId, targetId }) =>
    incrementalBundle.candidates.some(({ id }) => id === sourceId)
    && incrementalBundle.candidates.some(({ id }) => id === targetId)));
  const semanticRelations = (bundle) => bundle.relations.map((relation) => [
    bundle.candidates.find(({ id }) => id === relation.sourceId)?.proposal.statement,
    relation.predicate,
    bundle.candidates.find(({ id }) => id === relation.targetId)?.proposal.statement,
  ]).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  assert.deepEqual(semanticRelations(incrementalBundle), semanticRelations(firstBundle));
  const current = await store.getCurrentGraphHead("SLICE-CLOSURE");
  assert.equal(current.version, 2);

  const revisionCount = (await store.listUnderstandingRecords("SLICE-CLOSURE", "GRAPH_REVISION")).length;
  corruptReconciliationRunId = "SLICE-CLOSURE-STALE-ENDPOINT";
  const failed = await runtime.start({
    id: corruptReconciliationRunId,
    projectId: "SLICE-CLOSURE",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error.message, /cannot resolve both endpoints/);
  assert.equal((await store.listUnderstandingRecords("SLICE-CLOSURE", "GRAPH_REVISION")).length, revisionCount);
  assert.deepEqual(await store.getCurrentGraphHead("SLICE-CLOSURE"), current);
});

test("Main relation evidence rejects missing, duplicate, foreign, and mixed-valid-foreign references", async (t) => {
  const cases = [
    { name: "missing evidence", evidence: () => ({ evidenceFactIds: [], sourceSliceIds: [] }) },
    { name: "duplicate evidence", evidence: (factId) => ({ evidenceFactIds: [factId, factId], sourceSliceIds: [] }) },
    { name: "foreign Fact", evidence: () => ({ evidenceFactIds: ["FACT-FOREIGN"], sourceSliceIds: [] }) },
    { name: "mixed valid and foreign Fact", evidence: (factId) => ({ evidenceFactIds: [factId, "FACT-FOREIGN"], sourceSliceIds: [] }) },
    { name: "foreign or rejected SourceSlice", evidence: () => ({ evidenceFactIds: [], sourceSliceIds: ["SLICE-FOREIGN"] }) },
  ];
  for (const [index, testCase] of cases.entries()) {
    await t.test(testCase.name, async () => {
      const projectId = `INVALID-RELATION-EVIDENCE-${index}`;
      const { result, store } = await runProducerBoundaryScenario(projectId, {
        childProducer: deterministicFixtureChildProducer,
        mainProducer: async (input) => ({
          ...await deterministicFixtureMainProducer(input),
          relations: [{
            sourceCandidateRef: input.candidateOptions[0].ref,
            predicate: "RELATES_TO",
            targetArtifactId: input.scopedArtifacts[0].id,
            ...testCase.evidence(input.candidateOptions[0].proposal.evidenceFactIds[0]),
          }],
        }),
      });
      assert.equal(result.status, "FAILED");
      assert.equal((await store.listUnderstandingRecords(projectId, "MAIN_BATCH_RESULT")).length, 0);
      assert.equal((await store.listUnderstandingRecords(projectId, "CANDIDATE_BUNDLE")).length, 0);
      assert.equal((await store.listUnderstandingRecords(projectId, "GRAPH_REVISION")).length, 0);
      assert.equal(await store.getCurrentGraphHead(projectId), null);
    });
  }
});

test("Candidate relation scope is bound to one Project, Snapshot, AnalysisRun, and WorkUnit", () => {
  const allowset = {
    projectId: "PROJECT",
    snapshotManifestId: "SNAPSHOT",
    analysisRunId: "RUN",
    workUnitId: "WORK-UNIT",
    factIds: ["FACT"],
    sourceSliceIds: ["SLICE"],
  };
  const relation = {
    id: "RELATION",
    projectId: allowset.projectId,
    snapshotManifestId: allowset.snapshotManifestId,
    analysisRunId: allowset.analysisRunId,
    workUnitId: allowset.workUnitId,
    sourceId: "SOURCE",
    targetId: "TARGET",
    predicate: "RELATES_TO",
    evidenceFactIds: ["FACT"],
    sourceSliceIds: ["SLICE"],
  };
  assert.equal(validateRelationAgainstEvidenceAllowset(relation, allowset), true);
  for (const [field, value] of [
    ["projectId", "FOREIGN-PROJECT"],
    ["snapshotManifestId", "FOREIGN-SNAPSHOT"],
    ["analysisRunId", "FOREIGN-RUN"],
    ["workUnitId", "FOREIGN-WORK-UNIT"],
  ]) {
    assert.throws(
      () => validateRelationAgainstEvidenceAllowset({ ...relation, [field]: value }, allowset),
      new RegExp(`${field} is outside`),
    );
  }
});

test("Main MERGE produces one reconciled Candidate with complete Child provenance", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-merge-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(
    path.join(source, "entry.js"),
    "export function mergedCapability() { return true; }\nexport function secondMergeEvidence() { return true; }\n",
  );
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, "MERGE");
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots }),
    childProducer: async ({ candidate, assignment, executionProfile }) => {
      const slotIndex = executionProfile.childSlots.findIndex(({ id }) => id === assignment.slotId);
      return { candidates: [{
        name: `Wording from ${assignment.slotId}`,
        statement: `${candidate.proposal.statement} via ${assignment.slotId}`,
        confidence: "LOW",
        evidenceFactIds: candidate.evidenceFactIds.length > 0
          ? [candidate.evidenceFactIds[slotIndex % candidate.evidenceFactIds.length]]
          : [],
        sourceSliceIds: candidate.sourceSliceIds.length > 0
          ? [candidate.sourceSliceIds[slotIndex % candidate.sourceSliceIds.length]]
          : [],
      }] };
    },
    mainProducer: async ({ candidateOptions }) => {
      const refs = candidateOptions.map(({ ref }) => ref).sort();
      const mergedProposal = { name: "Merged capability", statement: "One reconciled semantic claim", confidence: "LOW" };
      return {
        candidateDecisions: refs.map((candidateRef) => ({
          candidateRef,
          disposition: "MERGE",
          relatedCandidateRefs: refs.filter((ref) => ref !== candidateRef),
          mergedProposal,
          rationale: "Both independent Child outputs describe the same bounded capability.",
        })),
        relations: [],
        gaps: [],
      };
    },
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const registration = await runtime.registerSource({ projectId: "MERGE", rootPath: source, displayName: "Merge" });
  const completed = await runtime.start({
    id: "MERGE-JOB", projectId: "MERGE", sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id, requestedMode: "FULL",
  }, { background: false });
  assert.equal(completed.status, "COMPLETED", JSON.stringify(completed.error));
  const bundle = await store.getUnderstandingRecord("MERGE", "CANDIDATE_BUNDLE", completed.outputs.ANALYSIS.candidateBundleId);
  const mainResults = await store.listUnderstandingRecords("MERGE", "MAIN_BATCH_RESULT");
  const childResults = new Map(
    (await store.listUnderstandingRecords("MERGE", "CHILD_BATCH_RESULT")).map((result) => [result.id, result]),
  );
  assert.equal(bundle.candidates.length, mainResults.length);
  assert.ok(bundle.candidates.every((candidate) =>
    candidate.mainDisposition === "MERGE"
    && candidate.proposal.name === "Merged capability"
    && candidate.mergedFromCandidateRefs.length === 2
    && candidate.childResultIds.length === 2
    && candidate.independenceGroups.length === 2));
  for (const candidate of bundle.candidates) {
    const expectedFactIds = [...new Set(candidate.childResultIds.flatMap((id) =>
      childResults.get(id).output.candidates.flatMap(({ evidenceFactIds = [] }) => evidenceFactIds)))].sort();
    const expectedSliceIds = [...new Set(candidate.childResultIds.flatMap((id) =>
      childResults.get(id).output.candidates.flatMap(({ sourceSliceIds = [] }) => sourceSliceIds)))].sort();
    assert.deepEqual(candidate.evidenceFactIds, expectedFactIds);
    assert.deepEqual(candidate.sourceSliceIds, expectedSliceIds);
  }
});

test("malformed Main MERGE proposals become explicit gaps and cannot publish Candidates", async (t) => {
  const cases = [
    {
      name: "uncontracted object description",
      proposal: {
        name: "Merged capability",
        statement: "valid",
        description: { injected: true },
        confidence: "CERTAIN",
      },
      error: /unsupported field description/,
    },
    {
      name: "invalid confidence",
      proposal: { name: "Merged capability", statement: "valid", confidence: "CERTAIN" },
      error: /confidence must be LOW, MEDIUM, or HIGH/,
    },
    {
      name: "non-string statement",
      proposal: { name: "Merged capability", statement: { injected: true }, confidence: "LOW" },
      error: /statement must be a non-empty string/,
    },
  ];
  for (const [index, testCase] of cases.entries()) {
    await t.test(testCase.name, async () => {
      const projectId = `MALFORMED-MERGE-${index}`;
      const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-malformed-merge-"));
      const source = path.join(temporary, "source");
      const snapshots = path.join(temporary, "snapshots");
      await mkdir(source);
      await mkdir(snapshots);
      await writeFile(path.join(source, "entry.js"), "export function malformedMergeMustFail() { return true; }\n");
      const store = new MemoryTraceabilityStore();
      const profile = await persistFixtureExecutionProfile(store, projectId);
      const runtime = new LegacyUnderstandingRuntime({
        store,
        allowlistedRoots: [source],
        snapshotRoot: snapshots,
        sourceSliceBroker: createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots }),
        childProducer: deterministicFixtureChildProducer,
        mainProducer: async ({ candidateOptions }) => {
          const refs = candidateOptions.map(({ ref }) => ref).sort();
          return {
            candidateDecisions: refs.map((candidateRef) => ({
              candidateRef,
              disposition: "MERGE",
              relatedCandidateRefs: refs.filter((ref) => ref !== candidateRef),
              mergedProposal: testCase.proposal,
              rationale: "Exercise the untrusted Main output boundary.",
            })),
            relations: [],
            gaps: [],
          };
        },
        equivalenceResolver: fixtureEquivalenceResolver,
        reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
      });
      const registration = await runtime.registerSource({ projectId, rootPath: source, displayName: projectId });
      const failed = await runtime.start({
        id: `${projectId}-JOB`, projectId, sourceRegistrationId: registration.id,
        workspaceExecutionProfileRevisionId: profile.id, requestedMode: "FULL",
      }, { background: false });
      assert.equal(failed.status, "FAILED");
      assert.equal(await store.getCurrentGraphHead(projectId), null);
      assert.equal((await store.listUnderstandingRecords(projectId, "MAIN_BATCH_RESULT")).length, 0);
      const bundle = (await store.listUnderstandingRecords(projectId, "CANDIDATE_BUNDLE")).at(-1);
      assert.equal(bundle.candidates.length, 0);
      const diagnosticGaps = await store.listUnderstandingRecords(projectId, "GAP");
      assert.ok(diagnosticGaps.some(({ code, details }) =>
        code === "INVALID_OR_FAILED_MAIN_PRODUCER_OUTPUT" && testCase.error.test(details?.message)));
    });
  }
});

test("invalid Child candidate fields fail at the first durable producer boundary", async (t) => {
  const invalidConfidences = [null, false, 0, "", [], {}, "CERTAIN"];
  for (const [index, confidence] of invalidConfidences.entries()) {
    await t.test(`${JSON.stringify(confidence)} confidence`, async () => {
      let mainCalls = 0;
      const projectId = `INVALID-CHILD-${index}`;
      const { result, store } = await runProducerBoundaryScenario(projectId, {
        childProducer: async ({ candidate }) => ({ candidates: [{
          name: candidate.proposal.name,
          statement: candidate.proposal.statement,
          confidence,
        }] }),
        mainProducer: async (input) => {
          mainCalls += 1;
          return deterministicFixtureMainProducer(input);
        },
      });
      assert.equal(result.status, "FAILED");
      assert.equal(await store.getCurrentGraphHead(projectId), null);
      const childResults = await store.listUnderstandingRecords(projectId, "CHILD_BATCH_RESULT");
      assert.ok(childResults.length > 0);
      assert.ok(childResults.every(({ status, output }) =>
        status === "GAP"
        && output.gap.code === "INVALID_OR_FAILED_PRODUCER_OUTPUT"
        && /candidates\[0\]\.confidence/.test(output.gap.message)));
      assert.equal(mainCalls, 0);
      assert.equal((await store.listUnderstandingRecords(projectId, "MAIN_BATCH_RESULT")).length, 0);
      assert.equal((await store.listUnderstandingRecords(projectId, "CANDIDATE_BUNDLE")).length, 0);
      assert.equal((await store.listUnderstandingRecords(projectId, "GRAPH_REVISION")).length, 0);
    });
  }
});

test("Child candidate evidence is validated before the first durable producer checkpoint", async (t) => {
  const cases = [
    {
      name: "missing evidence",
      evidence: () => ({}),
      error: /requires at least one evidenceFactIds or sourceSliceIds/,
    },
    {
      name: "foreign evidence",
      evidence: () => ({
        evidenceFactIds: ["FACT-OUTSIDE-ALLOWSET"],
        sourceSliceIds: ["SLICE-OUTSIDE-ALLOWSET"],
      }),
      error: /evidenceFactIds\[0\].*outside the evidence allowset/,
    },
    {
      name: "duplicate evidence",
      evidence: ({ candidate }) => ({ evidenceFactIds: [candidate.evidenceFactIds[0], candidate.evidenceFactIds[0]] }),
      error: /duplicate evidenceFactIds/,
    },
    {
      name: "valid and foreign evidence mixed",
      evidence: ({ candidate }) => ({ evidenceFactIds: [candidate.evidenceFactIds[0], "FACT-OUTSIDE-ALLOWSET"] }),
      error: /evidenceFactIds\[1\].*outside the evidence allowset/,
    },
    {
      name: "foreign SourceSlice mixed with a valid Fact",
      evidence: ({ candidate }) => ({
        evidenceFactIds: [candidate.evidenceFactIds[0]],
        sourceSliceIds: ["SLICE-OUTSIDE-ALLOWSET"],
      }),
      error: /sourceSliceIds\[0\].*outside the evidence allowset/,
    },
    {
      name: "non-array evidence",
      evidence: () => ({ evidenceFactIds: { injected: true } }),
      error: /evidenceFactIds must be an array/,
    },
    {
      name: "empty evidence identifier",
      evidence: () => ({ evidenceFactIds: [""] }),
      error: /evidenceFactIds\[0\] must be a non-empty string/,
    },
    {
      name: "confidence above the evidence cap",
      confidence: "HIGH",
      evidence: ({ candidate }) => ({ evidenceFactIds: [candidate.evidenceFactIds[0]] }),
      error: /confidence exceeds evidence cap LOW/,
    },
  ];
  for (const [index, testCase] of cases.entries()) {
    await t.test(testCase.name, async () => {
      let mainCalls = 0;
      const projectId = `INVALID-CHILD-EVIDENCE-${index}`;
      const { result, store } = await runProducerBoundaryScenario(projectId, {
        childProducer: async (input) => ({ candidates: [{
          name: input.candidate.proposal.name,
          statement: "Untrusted statement must never inherit unrelated evidence",
          confidence: testCase.confidence ?? "LOW",
          ...testCase.evidence(input),
        }] }),
        mainProducer: async (input) => {
          mainCalls += 1;
          return deterministicFixtureMainProducer(input);
        },
      });
      assert.equal(result.status, "FAILED");
      assert.equal(await store.getCurrentGraphHead(projectId), null);
      const childResults = await store.listUnderstandingRecords(projectId, "CHILD_BATCH_RESULT");
      assert.ok(childResults.length > 0);
      assert.ok(childResults.every(({ status, output }) =>
        status === "GAP"
        && output.gap.code === "INVALID_OR_FAILED_PRODUCER_OUTPUT"
        && testCase.error.test(output.gap.message)));
      assert.equal(mainCalls, 0);
      assert.equal((await store.listUnderstandingRecords(projectId, "MAIN_BATCH_RESULT")).length, 0);
      assert.equal((await store.listUnderstandingRecords(projectId, "CANDIDATE_BUNDLE")).length, 0);
      assert.equal((await store.listUnderstandingRecords(projectId, "GRAPH_REVISION")).length, 0);
    });
  }
});

test("valid Child evidence is preserved without expansion to unrelated WorkUnit evidence", async () => {
  const projectId = "VALID-CHILD-EVIDENCE";
  const { result, store, runtime, registration, profile } = await runProducerBoundaryScenario(projectId, {
    childProducer: async ({ candidate }) => ({ candidates: [{
      name: candidate.proposal.name,
      statement: "Only the explicitly cited evidence may support this statement",
      confidence: "LOW",
      evidenceFactIds: candidate.evidenceFactIds.slice(0, 1),
      sourceSliceIds: candidate.sourceSliceIds.slice(0, 1),
    }] }),
    mainProducer: deterministicFixtureMainProducer,
  });
  assert.equal(result.status, "COMPLETED", JSON.stringify(result.error));
  const bundle = await store.getUnderstandingRecord(
    projectId,
    "CANDIDATE_BUNDLE",
    result.outputs.ANALYSIS.candidateBundleId,
  );
  assert.ok(bundle.candidates.length > 0);
  assert.ok(bundle.candidates.every(({ evidenceFactIds, sourceSliceIds }) =>
    evidenceFactIds.length + sourceSliceIds.length === 1));
  const leafAllowset = (await store.listUnderstandingRecords(projectId, "EVIDENCE_ALLOWSET"))
    .find(({ factIds }) => factIds.length > 1);
  assert.ok(leafAllowset);
  const leafCandidate = bundle.candidates.find(({ workUnitId }) => workUnitId === leafAllowset.workUnitId);
  assert.equal(leafCandidate.evidenceFactIds.length, 1);
  assert.ok(leafAllowset.factIds.length > leafCandidate.evidenceFactIds.length);
  const reused = await runtime.start({
    id: `${projectId}-REUSE-JOB`,
    projectId,
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(reused.status, "COMPLETED", JSON.stringify(reused.error));
  assert.ok(reused.outputs.ANALYSIS.reusedCandidateIds.length > 0);
});

test("Child output must choose exactly one fully valid Candidate or Gap shape", async (t) => {
  const cases = [
    {
      name: "Gap and Candidates together",
      output: { gap: { code: "DECLARED", message: "ambiguous" }, candidates: [] },
      error: /exactly one of gap or candidates/,
    },
    {
      name: "both Candidate aliases",
      output: { candidates: [], candidateFeatures: [] },
      error: /cannot contain both candidates and candidateFeatures/,
    },
    {
      name: "Gap without message",
      output: { gap: { code: "DECLARED" } },
      error: /gap\.message must be a non-empty string/,
    },
    {
      name: "explicit null name with fallback displayName",
      output: { candidates: [{ name: null, displayName: "fallback", statement: "valid" }] },
      error: /candidates\[0\]\.name must be a non-empty string/,
    },
    {
      name: "object description",
      output: { candidates: [{ name: "valid", description: { injected: true } }] },
      error: /candidates\[0\]\.description must be a non-empty string/,
    },
    {
      name: "array subjectKey",
      output: { candidates: [{ name: "valid", subjectKey: ["entry.js"] }] },
      error: /candidates\[0\]\.subjectKey must be a non-empty string/,
    },
  ];
  for (const [index, testCase] of cases.entries()) {
    await t.test(testCase.name, async () => {
      const projectId = `INVALID-CHILD-SHAPE-${index}`;
      const { result, store } = await runProducerBoundaryScenario(projectId, {
        childProducer: async () => structuredClone(testCase.output),
        mainProducer: deterministicFixtureMainProducer,
      });
      assert.equal(result.status, "FAILED");
      const childResults = await store.listUnderstandingRecords(projectId, "CHILD_BATCH_RESULT");
      assert.ok(childResults.every(({ status, output }) =>
        status === "GAP"
        && output.gap.code === "INVALID_OR_FAILED_PRODUCER_OUTPUT"
        && testCase.error.test(output.gap.message)));
      assert.equal((await store.listUnderstandingRecords(projectId, "MAIN_BATCH_RESULT")).length, 0);
      assert.equal((await store.listUnderstandingRecords(projectId, "CANDIDATE_BUNDLE")).length, 0);
      assert.equal(await store.getCurrentGraphHead(projectId), null);
    });
  }
});

test("Main COMPLETED checkpoint waits for relation and Candidate projection validation", async () => {
  const projectId = "INVALID-MAIN-PROJECTION";
  const { result, store } = await runProducerBoundaryScenario(projectId, {
    childProducer: deterministicFixtureChildProducer,
    mainProducer: async (input) => ({
      ...await deterministicFixtureMainProducer(input),
      relations: [{
        sourceArtifactId: "OUTSIDE-BOUNDARY",
        predicate: "REFERENCES",
        targetArtifactId: input.scopedArtifacts[0].id,
        evidenceFactIds: [input.facts[0].id],
        sourceSliceIds: [],
      }],
    }),
  });
  assert.equal(result.status, "FAILED");
  assert.equal(await store.getCurrentGraphHead(projectId), null);
  assert.equal((await store.listUnderstandingRecords(projectId, "MAIN_BATCH_RESULT")).length, 0);
  assert.equal((await store.listUnderstandingRecords(projectId, "CANDIDATE_BUNDLE")).length, 0);
  const gaps = await store.listUnderstandingRecords(projectId, "GAP");
  assert.ok(gaps.some(({ code, details }) =>
    code === "INVALID_OR_FAILED_MAIN_PRODUCER_OUTPUT" && /escapes the bounded/.test(details?.message)));
});

test("missing configured Child executors persist explicit gaps and cannot publish synthetic candidates", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-no-producer-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function realProducerRequired() {}\n");
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, "NO-PRODUCER");
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: broker,
    mainProducer: deterministicFixtureMainProducer,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
    equivalenceResolver: fixtureEquivalenceResolver,
  });
  const registration = await runtime.registerSource({ projectId: "NO-PRODUCER", rootPath: source, displayName: "No producer" });
  const failed = await runtime.start({
    id: "NO-PRODUCER-JOB",
    projectId: "NO-PRODUCER",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
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

test("missing pinned Main executor cannot reconcile or publish Child candidates", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-no-main-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function mainReconciliationRequired() {}\n");
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, "NO-MAIN");
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots }),
    childProducer: deterministicFixtureChildProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const registration = await runtime.registerSource({ projectId: "NO-MAIN", rootPath: source, displayName: "No Main" });
  const failed = await runtime.start({
    id: "NO-MAIN-JOB",
    projectId: "NO-MAIN",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(failed.status, "FAILED");
  assert.equal(await store.getCurrentGraphHead("NO-MAIN"), null);
  assert.equal((await store.listUnderstandingRecords("NO-MAIN", "MAIN_BATCH_RESULT")).length, 0);
  const gaps = await store.listUnderstandingRecords("NO-MAIN", "GAP");
  assert.ok(gaps.some(({ code }) => code === "INVALID_OR_FAILED_MAIN_PRODUCER_OUTPUT"));
  const bundles = await store.listUnderstandingRecords("NO-MAIN", "CANDIDATE_BUNDLE");
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
    mainProducer: deterministicFixtureMainProducer,
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
    mainProducer: deterministicFixtureMainProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const recovered = await restarted.recover();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "COMPLETED", JSON.stringify(recovered[0].error));
  assert.equal((await restarted.get("RECOVERY", "RECOVER-ME")).status, "COMPLETED");
  assert.equal((await restarted.get("RECOVERY", "STAY-PAUSED")).status, "PAUSED");
});
