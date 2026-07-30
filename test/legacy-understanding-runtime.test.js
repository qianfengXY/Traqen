import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LegacyUnderstandingRuntime } from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";

test("HTTP-owned runtime composes all seven durable phases and publishes immutable FULL then INCREMENTAL graphs", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-runtime-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(path.join(source, "src"), { recursive: true });
  await mkdir(snapshots);
  await writeFile(path.join(source, "src", "orders.js"), "export function submitOrder() { return true; }\n");
  const store = new MemoryTraceabilityStore();
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot: snapshots,
    sourceSliceBroker: broker,
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
  assert.ok(artifactA.traceChains.some(({ complete }) => complete));

  await writeFile(path.join(source, "src", "orders.js"), "export function submitOrder() { return true; }\nexport function cancelOrder() { return true; }\n");
  const second = await runtime.start({
    id: "JOB-2",
    projectId: "P",
    sourceRegistrationId: registration.id,
    requestedMode: "AUTO",
  }, { background: false });
  assert.equal(second.status, "COMPLETED");
  const currentB = await store.getCurrentGraphHead("P");
  assert.equal(currentB.version, 2);
  const revisionB = await store.getUnderstandingRecord("P", "GRAPH_REVISION", currentB.graphRevisionId);
  const artifactB = await store.getUnderstandingRecord("P", "GRAPH_ARTIFACT", revisionB.graphArtifactId);
  assert.equal(revisionB.baseRevisionId, revisionA.id);
  assert.ok(artifactB.changeSet);
  assert.ok(artifactB.impactAssessment);
  assert.ok(artifactB.revalidationPlan.required);
});
