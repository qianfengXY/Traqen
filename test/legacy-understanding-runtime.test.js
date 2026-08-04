import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LegacyUnderstandingRuntime,
  reviewedCandidateTraceComplete,
} from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { WorkspaceAnalysisJobRunner } from "../src/application/workspace-analysis-job-runner.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";
import { canonicalJson, contentId } from "../src/domain/index.js";
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

async function runProducerBoundaryScenario(projectId, { childProducer, mainProducer }) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-producer-boundary-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function producerBoundary() { return true; }\n");
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, projectId);
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
  return { result, store };
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
  assert.equal(first.status, "COMPLETED");
  assert.ok(producerCalls >= 8);
  assert.equal(mainCalls, producerCalls / 2);
  assert.equal((await store.listUnderstandingRecords("P", "MAIN_BATCH_RESULT")).length, mainCalls);
  assert.deepEqual(first.completedPhases, ["SOURCE_SCAN", "FACT_COMMIT", "ANALYSIS", "RECONCILIATION", "EVALUATION", "PROJECTION", "PUBLISHING"]);
  const currentA = await store.getCurrentGraphHead("P");
  const revisionA = await store.getUnderstandingRecord("P", "GRAPH_REVISION", currentA.graphRevisionId);
  const artifactA = await store.getUnderstandingRecord("P", "GRAPH_ARTIFACT", revisionA.graphArtifactId);
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

test("Main MERGE produces one reconciled Candidate with complete Child provenance", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-merge-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function mergedCapability() { return true; }\n");
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, "MERGE");
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots }),
    childProducer: async ({ candidate, assignment }) => ({ candidates: [{
      name: `Wording from ${assignment.slotId}`,
      statement: `${candidate.proposal.statement} via ${assignment.slotId}`,
      confidence: "LOW",
    }] }),
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
  assert.equal(bundle.candidates.length, mainResults.length);
  assert.ok(bundle.candidates.every((candidate) =>
    candidate.mainDisposition === "MERGE"
    && candidate.proposal.name === "Merged capability"
    && candidate.mergedFromCandidateRefs.length === 2
    && candidate.childResultIds.length === 2
    && candidate.independenceGroups.length === 2));
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
