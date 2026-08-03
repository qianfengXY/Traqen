import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LegacyUnderstandingRuntime } from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { createReviewedUnderstandingEvaluationResolver } from "../src/application/reviewed-understanding-evaluation.js";
import { createUnderstandingSemanticSurface } from "../src/application/understanding-equivalence.js";
import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";
import { canonicalJson, createSnapshotManifest } from "../src/domain/index.js";
import {
  deterministicFixtureChildProducer,
  deterministicFixtureMainProducer,
  fixtureEquivalenceResolver,
  fixtureReviewedSeedMainProducer,
  fixtureReviewedSeedChildProducer,
  fixtureReviewedMeasurementResolver,
  persistFixtureExecutionProfile,
  persistFixtureIndependentRun,
} from "./helpers/legacy-understanding-fixture.js";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);

async function runtimeFor(projectId, source, snapshotRoot, truth, seedGraph) {
  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, projectId);
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot });
  const equivalenceState = {
    fullSurface: null,
    fullAnalysisRunId: null,
    fullJob: null,
    replaySurface: null,
    replayJob: null,
  };
  const isIndependentRuntime = projectId.endsWith("-FULL");
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot,
    sourceSliceBroker: broker,
    childProducer: seedGraph ? fixtureReviewedSeedChildProducer(seedGraph) : deterministicFixtureChildProducer,
    mainProducer: seedGraph ? fixtureReviewedSeedMainProducer(seedGraph) : deterministicFixtureMainProducer,
    implementationAuthorId: isIndependentRuntime ? "TRAQEN-INDEPENDENT-IMPLEMENTATION" : "TRAQEN-RUNTIME",
    runnerId: isIndependentRuntime ? "TRAQEN-INDEPENDENT-RUNNER" : "TRAQEN-LOCAL-RUNNER",
    reviewedEvaluationResolver: createReviewedUnderstandingEvaluationResolver({
      truthSet: truth,
      reviewerId: "TRAQEN-SELF-INDEPENDENT-REVIEWER",
      measurementResolver: fixtureReviewedMeasurementResolver("TRAQEN-SELF-INDEPENDENT-REVIEWER", truth),
    }),
    equivalenceResolver: async (input) => {
      const evidence = await fixtureEquivalenceResolver(input);
      if (!equivalenceState.fullSurface) return evidence;
      const full = await persistFixtureIndependentRun({
        store,
        job: input.job,
        surface: equivalenceState.fullSurface,
        id: equivalenceState.fullAnalysisRunId,
        mode: "FULL",
        authorId: equivalenceState.fullJob?.implementationAuthorId,
        runnerId: equivalenceState.fullJob?.runnerId,
      });
      let replayAnalysisRunId = evidence.replayAnalysisRunId;
      if (equivalenceState.replaySurface && equivalenceState.replayJob) {
        const replay = await persistFixtureIndependentRun({
          store,
          job: input.job,
          surface: equivalenceState.replaySurface,
          id: equivalenceState.replayJob.id,
          mode: equivalenceState.replayJob.resolvedMode,
          authorId: equivalenceState.replayJob.implementationAuthorId,
          runnerId: equivalenceState.replayJob.runnerId,
        });
        replayAnalysisRunId = replay.id;
      }
      return { ...evidence, replayAnalysisRunId, fullAnalysisRunId: full.id };
    },
  });
  const registration = await runtime.registerSource({ projectId, rootPath: source, displayName: "Traqen" });
  return { store, runtime, registration, equivalenceState, profile };
}

async function evaluationSurface(store, projectId, job) {
  const [inventory, factBundle, candidateBundle, reconciliation] = await Promise.all([
    store.getUnderstandingRecord(projectId, "ARTIFACT_INVENTORY", job.outputs.SOURCE_SCAN.inventoryId),
    store.getUnderstandingRecord(projectId, "FACT_BUNDLE", job.outputs.FACT_COMMIT.factBundleId),
    store.getUnderstandingRecord(projectId, "CANDIDATE_BUNDLE", job.outputs.ANALYSIS.candidateBundleId),
    store.getUnderstandingRecord(projectId, "RECONCILIATION", job.outputs.RECONCILIATION.reconciliationId),
  ]);
  return createUnderstandingSemanticSurface({ inventory, factBundle, candidateBundle, reconciliation });
}

async function currentArtifact(store, projectId) {
  const head = await store.getCurrentGraphHead(projectId);
  const revision = await store.getUnderstandingRecord(projectId, "GRAPH_REVISION", head.graphRevisionId);
  return {
    head,
    revision,
    artifact: await store.getUnderstandingRecord(projectId, "GRAPH_ARTIFACT", revision.graphArtifactId),
  };
}

function semanticGraph(graph) {
  const labels = new Map(graph.nodes.map((node) => [node.id, `${node.authority}:${node.type}:${node.subjectKey ?? node.label}`]));
  return {
    nodes: [...labels.values()].sort(),
    edges: graph.edges.map((edge) =>
      `${labels.get(edge.source)}:${edge.type}:${labels.get(edge.target)}`).sort(),
  };
}

function traqenSnapshotManifest(version) {
  const digest = (character) => `sha256:${character.repeat(64)}`;
  return createSnapshotManifest({
    source: { id: `TRAQEN-SOURCE-${version}`, digest: digest(version === 1 ? "a" : "b") },
    build: { id: "TRAQEN-BUILD", digest: digest("c") },
    deployment: { id: "TRAQEN-DEPLOYMENT", digest: digest("d") },
    runtime: { id: "TRAQEN-RUNTIME", digest: digest("e") },
    failedSources: [],
    observedFrom: `2026-08-0${version}T00:00:00.000Z`,
    observedTo: `2026-08-0${version}T00:05:00.000Z`,
  });
}

function traqenReviewedTraceInput(snapshotManifest) {
  return {
    requirements: [{ id: "DOC-F001-REQUIREMENT", path: "docs/features/F001-legacy-system-understanding.md" }],
    designs: [{ id: "DOC-TRAQEN-ARCHITECTURE", path: "docs/architecture/traqen-product-architecture.md" }],
    feature: { id: "FEATURE-TRAQEN-LEGACY-UNDERSTANDING", name: "Legacy-system understanding" },
    claim: {
      id: "CLAIM-TRAQEN-UNDERSTANDING-PUBLICATION",
      version: 1,
      type: "NORMATIVE_REQUIREMENT",
      authorityStatus: "CONFIRMED",
      evidenceSupport: "MULTI_SOURCE",
    },
    decision: { id: "DECISION-TRAQEN-SEED-GRAPH-V1", type: "CONFIRMED" },
    scope: { id: "SCOPE-TRAQEN-SELF", actor: "workspace-operator" },
    snapshotManifest,
    implementation: {
      endpoints: ["POST /v1/projects/{projectId}/workspace-analysis-jobs"],
      codeSymbols: ["LegacyUnderstandingRuntime.start", "evaluateUnderstanding"],
      dataObjects: ["GraphRevision", "CurrentGraphHead"],
      configurations: ["UNDERSTANDING_TRUTH_SET_PATH"],
      dependencies: ["WorkspaceExecutionProfileRevision"],
    },
    conformance: {
      id: "CONFORMANCE-TRAQEN-F001",
      status: "CONFORMS",
      claimId: "CLAIM-TRAQEN-UNDERSTANDING-PUBLICATION",
      claimVersion: 1,
      scopeId: "SCOPE-TRAQEN-SELF",
      snapshotManifestId: snapshotManifest.id,
      analysisMethod: { type: "REVIEWED_SELF_DOGFOOD" },
    },
    testSpec: {
      id: "TESTSPEC-TRAQEN-SELF-DOGFOOD",
      version: 1,
      approved: true,
      verifiesClaims: [{ id: "CLAIM-TRAQEN-UNDERSTANDING-PUBLICATION", version: 1 }],
      assertions: [{ id: "ASSERT-FULL-INCREMENTAL-FULL" }],
    },
    execution: {
      id: "EXECUTION-TRAQEN-SELF-DOGFOOD",
      deploymentId: snapshotManifest.components.deployment.id,
      snapshotManifestId: snapshotManifest.id,
      testSpecId: "TESTSPEC-TRAQEN-SELF-DOGFOOD",
      testSpecVersion: 1,
      status: "PASS",
    },
    evidence: [{
      id: "EVIDENCE-TRAQEN-SELF-DOGFOOD",
      executionId: "EXECUTION-TRAQEN-SELF-DOGFOOD",
      integrity: "VERIFIED",
      freshness: "FRESH",
    }],
    conflicts: [],
  };
}

async function persistTraqenReviewedTrace(store, projectId, snapshotManifest) {
  await store.appendSnapshotManifest(projectId, snapshotManifest);
  const application = new TraceabilityApplication({ store });
  const input = traqenReviewedTraceInput(snapshotManifest);
  const result = await application.evaluateAndPersist(projectId, input);
  assert.equal(result.chain.complete, true);
  const stale = structuredClone(input);
  stale.evidence[0].freshness = "STALE";
  assert.equal(application.evaluate(stale).complete, false);
  return result.chain;
}

test("Traqen dogfoods two real immutable Snapshots through FULL → INCREMENTAL → independent FULL", async (t) => {
  const truth = JSON.parse(await readFile(
    new URL("./fixtures/understanding/traqen-self-calibration-v1.json", import.meta.url),
    "utf8",
  ));
  const seedGraph = JSON.parse(await readFile(
    new URL("./fixtures/understanding/traqen-reviewed-seed-graph-v1.json", import.meta.url),
    "utf8",
  ));
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-self-dogfood-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  const independentSnapshots = path.join(temporary, "independent-snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await mkdir(independentSnapshots);
  for (const directory of ["src", "contracts", "docs/features", "docs/architecture", "feature-specs", "test", "web/app", "web/tests", "db/migrations"]) {
    await cp(path.join(repositoryRoot, directory), path.join(source, directory), { recursive: true });
  }

  const primary = await runtimeFor("TRAQEN-SELF", source, snapshots, truth, seedGraph);
  const snapshotOne = traqenSnapshotManifest(1);
  await primary.store.appendSnapshotManifest("TRAQEN-SELF", snapshotOne);
  const fullOne = await primary.runtime.start({
    id: "TRAQEN-FULL-1",
    projectId: "TRAQEN-SELF",
    sourceRegistrationId: primary.registration.id,
    workspaceExecutionProfileRevisionId: primary.profile.id,
    snapshotManifestId: snapshotOne.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(fullOne.status, "COMPLETED", JSON.stringify({
    error: fullOne.error,
    evaluations: await primary.store.listUnderstandingRecords("TRAQEN-SELF", "EVALUATION_RUN"),
    measurements: (await primary.store.listUnderstandingRecords("TRAQEN-SELF", "REVIEWED_MEASUREMENT")).map((record) => ({
      candidateReviews: record.candidateReviews.length,
      relationReviews: record.relationReviews.length,
      observedRelations: record.relationReviews.filter(({ verdict }) => verdict === "OBSERVED").length,
    })),
  }));
  const firstEvaluation = await primary.store.getUnderstandingRecord(
    "TRAQEN-SELF",
    "EVALUATION_RUN",
    fullOne.outputs.EVALUATION.evaluationRunId,
  );
  assert.equal(firstEvaluation.truthSetVersionId, truth.id);
  assert.equal(firstEvaluation.status, "PASSED");
  const first = await currentArtifact(primary.store, "TRAQEN-SELF");
  assert.equal(first.revision.mode, "FULL");
  assert.ok(first.artifact.nodes.some(({ authority }) => authority === "CANDIDATE"));
  assert.ok(first.artifact.traceChains.some(({ subject, segments, analysisEvidenceNodeIds, complete }) =>
    subject?.kind === "CANDIDATE"
    && segments.some(({ type, nodeIds }) => type === "IMPLEMENTATION" && nodeIds.length > 0)
    && segments.some(({ type, nodeIds }) => type === "EVIDENCE" && nodeIds.length === 0)
    && analysisEvidenceNodeIds.length > 0
    && complete === false));

  await mkdir(path.join(source, "review-notes"), { recursive: true });
  await cp(
    path.join(repositoryRoot, "review-notes/2026-07-30-F001-kimi-codex-consensus-review.md"),
    path.join(source, "review-notes/2026-07-30-F001-kimi-codex-consensus-review.md"),
  );
  const snapshotTwo = traqenSnapshotManifest(2);
  const independent = await runtimeFor("TRAQEN-SELF-FULL", source, independentSnapshots, truth, seedGraph);
  await persistTraqenReviewedTrace(independent.store, "TRAQEN-SELF-FULL", snapshotTwo);
  const fullTwo = await independent.runtime.start({
    id: "TRAQEN-FULL-2",
    projectId: "TRAQEN-SELF-FULL",
    sourceRegistrationId: independent.registration.id,
    workspaceExecutionProfileRevisionId: independent.profile.id,
    snapshotManifestId: snapshotTwo.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(fullTwo.status, "COMPLETED");
  const replayTwo = await independent.runtime.start({
    id: "TRAQEN-INDEPENDENT-INCREMENTAL-2",
    projectId: "TRAQEN-SELF-FULL",
    sourceRegistrationId: independent.registration.id,
    workspaceExecutionProfileRevisionId: independent.profile.id,
    snapshotManifestId: snapshotTwo.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(replayTwo.status, "COMPLETED", JSON.stringify({
    error: replayTwo.error,
    evaluations: (await independent.store.listUnderstandingRecords("TRAQEN-SELF-FULL", "EVALUATION_RUN"))
      .filter(({ analysisRunId }) => analysisRunId === replayTwo.id),
    reports: (await independent.store.listUnderstandingRecords("TRAQEN-SELF-FULL", "EQUIVALENCE_REPORT"))
      .filter(({ analysisRunId }) => analysisRunId === replayTwo.id),
  }));
  primary.equivalenceState.fullSurface = await evaluationSurface(
    independent.store,
    "TRAQEN-SELF-FULL",
    fullTwo,
  );
  primary.equivalenceState.fullAnalysisRunId = fullTwo.id;
  primary.equivalenceState.fullJob = fullTwo;
  primary.equivalenceState.replaySurface = await evaluationSurface(
    independent.store,
    "TRAQEN-SELF-FULL",
    replayTwo,
  );
  primary.equivalenceState.replayJob = replayTwo;
  const reviewedChain = await persistTraqenReviewedTrace(primary.store, "TRAQEN-SELF", snapshotTwo);
  const incremental = await primary.runtime.start({
    id: "TRAQEN-INCREMENTAL-2",
    projectId: "TRAQEN-SELF",
    sourceRegistrationId: primary.registration.id,
    workspaceExecutionProfileRevisionId: primary.profile.id,
    snapshotManifestId: snapshotTwo.id,
    requestedMode: "AUTO",
  }, { background: false });
  const incrementalReports = await primary.store.listUnderstandingRecords("TRAQEN-SELF", "EQUIVALENCE_REPORT");
  const primarySurface = await evaluationSurface(primary.store, "TRAQEN-SELF", incremental);
  assert.equal(incremental.status, "COMPLETED", JSON.stringify({
    error: incremental.error,
    equivalence: incrementalReports.find(({ analysisRunId }) => analysisRunId === incremental.id),
    surfaceCounts: Object.fromEntries(["artifacts", "facts", "candidates", "conflicts", "gaps"].map((key) => [key, [
      primarySurface[key].length,
      primary.equivalenceState.fullSurface[key].length,
    ]])),
    surfaceEqual: Object.fromEntries(["artifacts", "facts", "candidates", "conflicts", "gaps"].map((key) => [
      key,
      canonicalJson(primarySurface[key]) === canonicalJson(primary.equivalenceState.fullSurface[key]),
    ])),
    candidateOnlyIncremental: primarySurface.candidates
      .filter((candidate) => !primary.equivalenceState.fullSurface.candidates.some(({ id }) => id === candidate.id))
      .slice(0, 3).map(({ id, subjectKey, evidenceFactIds }) => ({ id, subjectKey, evidenceCount: evidenceFactIds.length, firstEvidence: evidenceFactIds[0] })),
    candidateOnlyFull: primary.equivalenceState.fullSurface.candidates
      .filter((candidate) => !primarySurface.candidates.some(({ id }) => id === candidate.id))
      .slice(0, 3).map(({ id, subjectKey, evidenceFactIds }) => ({ id, subjectKey, evidenceCount: evidenceFactIds.length, firstEvidence: evidenceFactIds[0] })),
  }));
  const second = await currentArtifact(primary.store, "TRAQEN-SELF");
  assert.equal(second.revision.mode, "INCREMENTAL");
  assert.equal(second.head.version, 2);
  assert.ok(second.artifact.changeSet);
  assert.ok(second.artifact.impactAssessment);
  assert.ok(second.artifact.revalidationPlan.required);
  assert.ok(second.artifact.traceChains.some(({ id, complete }) => id === reviewedChain.id && complete === true));
  const independentSecond = await currentArtifact(independent.store, "TRAQEN-SELF-FULL");
  assert.deepEqual(semanticGraph(second.artifact), semanticGraph(independentSecond.artifact));
  const equivalence = await primary.store.getUnderstandingRecord(
    "TRAQEN-SELF",
    "EQUIVALENCE_REPORT",
    incremental.outputs.EVALUATION.equivalenceReportId,
  );
  assert.equal(equivalence.full.analysisRunId, fullTwo.id);
  assert.equal(equivalence.full.equivalent, true);

  const inventory = (await primary.store.listUnderstandingRecords("TRAQEN-SELF", "ARTIFACT_INVENTORY"))
    .find(({ snapshotManifestId }) => snapshotManifestId === second.revision.snapshotManifestId);
  const paths = new Set(inventory.artifacts.map(({ relativePath }) => relativePath));
  assert.equal(truth.capabilities.length, 10);
  assert.equal(truth.anchors.length, 30);
  assert.equal(truth.requiredRelationships.length, 60);
  assert.equal(truth.forbiddenRelationships.length, 30);
  assert.ok(truth.anchors.filter(({ path: anchorPath }) => paths.has(anchorPath)).length / truth.anchors.length >= 0.9);
  assert.notEqual(fullOne.outputs.SOURCE_SCAN.planId, truth.id);
  assert.deepEqual(second.artifact, JSON.parse(JSON.stringify(second.artifact)));
  assert.equal(second.artifact.graphArtifactDigest, second.revision.graphArtifactDigest);
  assert.equal(second.head.graphRevisionId, second.revision.id);

  const application = new TraceabilityApplication({
    store: primary.store,
    legacyUnderstandingRuntime: primary.runtime,
  });
  const server = createTraceabilityHttpServer({ application });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browserView = await fetch(
    `http://127.0.0.1:${server.address().port}/v1/projects/TRAQEN-SELF/graph/current`,
  ).then((response) => response.json());
  assert.equal(browserView.head.version, 2);
  assert.equal(browserView.revision.id, second.revision.id);
});
