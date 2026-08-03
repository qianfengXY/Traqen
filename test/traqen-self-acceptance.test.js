import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LegacyUnderstandingRuntime } from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { createReviewedUnderstandingEvaluationResolver } from "../src/application/reviewed-understanding-evaluation.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";
import { deterministicFixtureChildProducer } from "./helpers/legacy-understanding-fixture.js";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);

async function runtimeFor(projectId, source, snapshotRoot, truth) {
  const store = new MemoryTraceabilityStore();
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot });
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot,
    sourceSliceBroker: broker,
    childProducer: deterministicFixtureChildProducer,
    reviewedEvaluationResolver: createReviewedUnderstandingEvaluationResolver({
      truthSet: truth,
      reviewerId: "TRAQEN-SELF-INDEPENDENT-REVIEWER",
    }),
  });
  const registration = await runtime.registerSource({ projectId, rootPath: source, displayName: "Traqen" });
  return { store, runtime, registration };
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

test("Traqen dogfoods two real immutable Snapshots through FULL → INCREMENTAL → independent FULL", async () => {
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
  assert.ok(first.artifact.traceChains.some(({ segments }) =>
    segments.some(({ type, nodeIds }) => type === "IMPLEMENTATION" && nodeIds.length > 0)
    && segments.some(({ type, nodeIds }) => type === "EVIDENCE" && nodeIds.length > 0)));

  await mkdir(path.join(source, "review-notes"), { recursive: true });
  await cp(
    path.join(repositoryRoot, "review-notes/2026-07-30-F001-kimi-codex-consensus-review.md"),
    path.join(source, "review-notes/2026-07-30-F001-kimi-codex-consensus-review.md"),
  );
  const incremental = await primary.runtime.start({
    id: "TRAQEN-INCREMENTAL-2",
    projectId: "TRAQEN-SELF",
    sourceRegistrationId: primary.registration.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(incremental.status, "COMPLETED", JSON.stringify(incremental.error));
  const second = await currentArtifact(primary.store, "TRAQEN-SELF");
  assert.equal(second.revision.mode, "INCREMENTAL");
  assert.equal(second.head.version, 2);
  assert.ok(second.artifact.changeSet);
  assert.ok(second.artifact.impactAssessment);
  assert.ok(second.artifact.revalidationPlan.required);

  const independent = await runtimeFor("TRAQEN-SELF-FULL", source, independentSnapshots, truth);
  const fullTwo = await independent.runtime.start({
    id: "TRAQEN-FULL-2",
    projectId: "TRAQEN-SELF-FULL",
    sourceRegistrationId: independent.registration.id,
    requestedMode: "FULL",
  }, { background: false });
  assert.equal(fullTwo.status, "COMPLETED");
  const independentSecond = await currentArtifact(independent.store, "TRAQEN-SELF-FULL");
  assert.deepEqual(semanticGraph(second.artifact), semanticGraph(independentSecond.artifact));

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
});
