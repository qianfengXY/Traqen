import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
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
  await writeFile(path.join(source, "src", "entry.js"), "export const mutated = true;\n");
  const replayed = await capture.capture({ projectId: "P", snapshotManifestId: "S", rootPath: source });
  assert.deepEqual(replayed, inventory);
  assert.equal(await readFile(path.join(snapshots, "S", "src", "entry.js"), "utf8"), "export const entry = true;\n");

  const store = new MemoryTraceabilityStore();
  await store.appendUnderstandingRecord("P", "ARTIFACT_INVENTORY", inventory);
  const artifact = inventory.artifacts.find(({ relativePath }) => relativePath === "src/entry.js");
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const request = createSourceSliceRequest({
    projectId: "P", snapshotManifestId: "S", analysisRunId: "R", workUnitId: "W",
    artifactId: artifact.id, policyDigest: "POLICY", range: { startByte: 0, endByte: null },
  });
  const slice = await broker.read(request, {
    serviceIdentity: "worker", projectId: "P", analysisRunId: "R", workUnitArtifactIds: [artifact.id],
  });
  assert.equal(slice.status, "COMPLETE");
  assert.match(slice.artifactSlices[0].redactedText, /entry = true/);
});

test("Snapshot inventory digest is derived from captured bytes even when live source mutates before sealing", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-source-race-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  const sourceFile = path.join(source, "entry.js");
  await writeFile(sourceFile, "export const before = true;\n");
  const capture = new LocalSourceSnapshotCapture({ allowlistedRoots: [source], snapshotRoot: snapshots });
  const originalCapture = capture.scanner.capture.bind(capture.scanner);
  capture.scanner.capture = async (input) => {
    const captured = await originalCapture(input);
    await writeFile(sourceFile, "export const after = true;\n");
    await writeFile(path.join(source, "added.js"), "export const added = true;\n");
    return captured;
  };
  const inventory = await capture.capture({ projectId: "P", snapshotManifestId: "RACE", rootPath: source });
  const artifact = inventory.artifacts.find(({ relativePath }) => relativePath === "entry.js");
  const snapshotBytes = await readFile(path.join(snapshots, "RACE", "entry.js"));
  assert.equal(`sha256:${createHash("sha256").update(snapshotBytes).digest("hex")}`, artifact.contentDigest);
  assert.match(snapshotBytes.toString("utf8"), /before/);
  await assert.rejects(readFile(path.join(snapshots, "RACE", "added.js")));

  await unlink(sourceFile);
  await symlink("/etc/passwd", sourceFile);
  const second = new LocalSourceSnapshotCapture({ allowlistedRoots: [source], snapshotRoot: snapshots });
  const inventory2 = await second.capture({ projectId: "P", snapshotManifestId: "SYMLINK", rootPath: source });
  assert.equal(inventory2.artifacts.find(({ relativePath }) => relativePath === "entry.js").disposition, "EXCLUDED_BY_POLICY");
  await assert.rejects(readFile(path.join(snapshots, "SYMLINK", "entry.js")));
});

test("sealed Snapshot loading verifies inventory, metadata files, and payloads", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-source-sealed-verification-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  const original = Buffer.from("export const sealed = true;\n");
  await writeFile(path.join(source, "entry.js"), original);
  const capture = new LocalSourceSnapshotCapture({ allowlistedRoots: [source], snapshotRoot: snapshots });
  const inventory = await capture.capture({ projectId: "P", snapshotManifestId: "SEALED", rootPath: source });
  assert.deepEqual(
    await capture.loadExisting({ projectId: "P", snapshotManifestId: "SEALED" }),
    inventory,
  );

  const snapshotDirectory = path.join(snapshots, "SEALED");
  const inventoryPath = path.join(snapshotDirectory, ".traqen-inventory.json");
  const sealPath = path.join(snapshotDirectory, ".traqen-sealed");
  const originalInventoryBytes = await readFile(inventoryPath);
  const originalSeal = await readFile(sealPath, "utf8");
  const truncatedInventory = JSON.parse(originalInventoryBytes.toString("utf8"));
  truncatedInventory.artifacts = [];
  await chmod(inventoryPath, 0o640);
  await writeFile(inventoryPath, JSON.stringify(truncatedInventory));
  await assert.rejects(
    capture.loadExisting({ projectId: "P", snapshotManifestId: "SEALED" }),
    /inventory integrity verification failed/,
  );

  await writeFile(inventoryPath, originalInventoryBytes);
  await chmod(inventoryPath, 0o440);
  assert.deepEqual(
    await capture.loadExisting({ projectId: "P", snapshotManifestId: "SEALED" }),
    inventory,
  );

  await chmod(snapshotDirectory, 0o750);
  const externalInventoryPath = path.join(temporary, "external-inventory.json");
  await writeFile(externalInventoryPath, originalInventoryBytes);
  await unlink(inventoryPath);
  await symlink(externalInventoryPath, inventoryPath);
  await assert.rejects(
    capture.loadExisting({ projectId: "P", snapshotManifestId: "SEALED" }),
    /Snapshot metadata must be a non-symlink file/,
  );
  await unlink(inventoryPath);
  await writeFile(inventoryPath, originalInventoryBytes, { mode: 0o440 });

  const externalSealPath = path.join(temporary, "external-seal");
  await writeFile(externalSealPath, originalSeal);
  await unlink(sealPath);
  await symlink(externalSealPath, sealPath);
  await assert.rejects(
    capture.loadExisting({ projectId: "P", snapshotManifestId: "SEALED" }),
    /Snapshot metadata must be a non-symlink file/,
  );
  await unlink(sealPath);
  await writeFile(sealPath, originalSeal, { mode: 0o440 });

  const payload = path.join(snapshotDirectory, "entry.js");
  await chmod(payload, 0o640);
  await writeFile(payload, "export const tampered = true;\n");
  await assert.rejects(
    capture.loadExisting({ projectId: "P", snapshotManifestId: "SEALED" }),
    /digest verification failed/,
  );

  await writeFile(payload, original);
  await chmod(payload, 0o440);
  assert.deepEqual(
    await capture.loadExisting({ projectId: "P", snapshotManifestId: "SEALED" }),
    inventory,
  );

  await unlink(payload);
  await symlink(path.join(source, "entry.js"), payload);
  await assert.rejects(
    capture.loadExisting({ projectId: "P", snapshotManifestId: "SEALED" }),
    /non-symlink file/,
  );

  await unlink(payload);
  await assert.rejects(
    capture.loadExisting({ projectId: "P", snapshotManifestId: "SEALED" }),
    { code: "ENOENT" },
  );
});

test("Snapshot manifest IDs cannot escape or create nested paths under the Snapshot root", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-source-snapshot-id-fence-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export const bounded = true;\n");
  const capture = new LocalSourceSnapshotCapture({ allowlistedRoots: [source], snapshotRoot: snapshots });

  for (const snapshotManifestId of ["", ".", "..", "../escaped", "nested/escaped", "nested\\escaped"]) {
    await assert.rejects(
      capture.capture({ projectId: "P", snapshotManifestId, rootPath: source }),
      /snapshotManifestId must be a single safe path segment/,
    );
  }
  await assert.rejects(
    capture.loadExisting({ projectId: "P", snapshotManifestId: "../escaped" }),
    /snapshotManifestId must be a single safe path segment/,
  );
});
