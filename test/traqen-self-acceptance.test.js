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
import { canonicalJson } from "../src/domain/index.js";
import {
  deterministicFixtureChildProducer,
  fixtureEquivalenceResolver,
  fixtureReviewedMeasurementResolver,
} from "./helpers/legacy-understanding-fixture.js";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);

async function runtimeFor(projectId, source, snapshotRoot, truth) {
  const store = new MemoryTraceabilityStore();
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot });
  const equivalenceState = { fullSurface: null, fullAnalysisRunId: null };
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot,
    sourceSliceBroker: broker,
    childProducer: deterministicFixtureChildProducer,
    reviewedEvaluationResolver: createReviewedUnderstandingEvaluationResolver({
      truthSet: truth,
      reviewerId: "TRAQEN-SELF-INDEPENDENT-REVIEWER",
      measurementResolver: fixtureReviewedMeasurementResolver("TRAQEN-SELF-INDEPENDENT-REVIEWER", truth),
    }),
    equivalenceResolver: async (input) => {
      const evidence = await fixtureEquivalenceResolver(input);
      if (!equivalenceState.fullSurface) return evidence;
      return {
        ...evidence,
        full: {
          ...evidence.full,
          analysisRunId: equivalenceState.fullAnalysisRunId,
          surface: structuredClone(equivalenceState.fullSurface),
        },
      };
    },
  });
  const registration = await runtime.registerSource({ projectId, rootPath: source, displayName: "Traqen" });
  return { store, runtime, registration, equivalenceState };
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

test("Traqen dogfoods two real immutable Snapshots through FULL → INCREMENTAL → independent FULL", async (t) => {
  const truth = JSON.parse(await readFile(
    new URL("./fixtures/understanding/traqen-self-calibration-v1.json", import.meta.url),
    "utf8",
  ));
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-self-dogfood-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  const independentSnapshots = path.join(temporary, "independent-snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await mkdir(independentSnapshots);
  for (const directory of ["src", "contracts", "docs/features", "feature-specs", "test", "web/app", "web/tests", "db/migrations"]) {
    await cp(path.join(repositoryRoot, directory), path.join(source, directory), { recursive: true });
  }

  const primary = await runtimeFor("TRAQEN-SELF", source, snapshots, truth);
  const fullOne = await primary.runtime.start({
    id: "TRAQEN-FULL-1",
    projectId: "TRAQEN-SELF",
    sourceRegistrationId: primary.registration.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(fullOne.status, "COMPLETED", JSON.stringify(fullOne.error));
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
  const independent = await runtimeFor("TRAQEN-SELF-FULL", source, independentSnapshots, truth);
  const fullTwo = await independent.runtime.start({
    id: "TRAQEN-FULL-2",
    projectId: "TRAQEN-SELF-FULL",
    sourceRegistrationId: independent.registration.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(fullTwo.status, "COMPLETED");
  primary.equivalenceState.fullSurface = await evaluationSurface(
    independent.store,
    "TRAQEN-SELF-FULL",
    fullTwo,
  );
  primary.equivalenceState.fullAnalysisRunId = fullTwo.id;
  const incremental = await primary.runtime.start({
    id: "TRAQEN-INCREMENTAL-2",
    projectId: "TRAQEN-SELF",
    sourceRegistrationId: primary.registration.id,
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
      .slice(0, 3),
    candidateOnlyFull: primary.equivalenceState.fullSurface.candidates
      .filter((candidate) => !primarySurface.candidates.some(({ id }) => id === candidate.id))
      .slice(0, 3),
  }));
  const second = await currentArtifact(primary.store, "TRAQEN-SELF");
  assert.equal(second.revision.mode, "INCREMENTAL");
  assert.equal(second.head.version, 2);
  assert.ok(second.artifact.changeSet);
  assert.ok(second.artifact.impactAssessment);
  assert.ok(second.artifact.revalidationPlan.required);
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
