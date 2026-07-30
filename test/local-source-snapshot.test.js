import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalSourceSnapshotCapture } from "../src/application/local-source-snapshot.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { createSourceSliceRequest } from "../src/domain/index.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";

test("Local Runner captures an immutable allowlisted Snapshot and brokers Artifact-ID slices", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-source-snapshot-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(path.join(source, "src"), { recursive: true });
  await mkdir(snapshots);
  await writeFile(path.join(source, "src", "entry.js"), "export const entry = true;\n");
  await writeFile(path.join(source, ".env"), "TOKEN=do-not-copy\n");
  const capture = new LocalSourceSnapshotCapture({ allowlistedRoots: [source], snapshotRoot: snapshots });
  const inventory = await capture.capture({
    projectId: "P", snapshotManifestId: "S", rootPath: source, sourceDigest: `sha256:${"a".repeat(64)}`,
  });
  assert.equal(inventory.disposedCount, inventory.totalCount);
  assert.equal(await readFile(path.join(snapshots, "S", "src", "entry.js"), "utf8"), "export const entry = true;\n");
  await assert.rejects(readFile(path.join(snapshots, "S", ".env"), "utf8"));

  const store = new MemoryTraceabilityStore();
  await store.appendUnderstandingRecord("P", "ARTIFACT_INVENTORY", inventory);
  const artifact = inventory.artifacts.find(({ path: artifactPath }) => artifactPath === "src/entry.js");
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const request = createSourceSliceRequest({
    projectId: "P", snapshotManifestId: "S", analysisRunId: "R", workUnitId: "W",
    artifactId: artifact.id, policyDigest: "POLICY", range: { startByte: 0, endByte: null },
  });
  const slice = await broker.read(request, {
    serviceIdentity: "worker", projectId: "P", analysisRunId: "R", workUnitArtifactIds: [artifact.id],
  });
  assert.equal(slice.status, "COMPLETE");
  assert.match(slice.content, /entry = true/);
});
