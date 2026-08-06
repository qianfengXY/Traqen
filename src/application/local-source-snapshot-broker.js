import os from "node:os";
import path from "node:path";

import { readVerifiedLocalSnapshotArtifact } from "./local-source-snapshot.js";
import { SourceSliceBroker } from "./source-slice-broker.js";

export function createLocalSourceSnapshotBroker({ store, snapshotRoot, clock = () => new Date() }) {
  const root = path.resolve(snapshotRoot);
  if (root === path.parse(root).root || root === path.resolve(os.homedir())) {
    throw new TypeError("snapshotRoot cannot be the filesystem root or home directory");
  }
  return new SourceSliceBroker({
    clock,
    auditSink: async (slice) => {
      await store.appendUnderstandingRecord(
        slice.projectId,
        "SOURCE_SLICE",
        slice,
      ).catch(() => undefined);
    },
    artifactResolver: async (projectId, snapshotManifestId, artifactId) => {
      const inventories = await store.listUnderstandingRecords(projectId, "ARTIFACT_INVENTORY");
      const inventory = inventories.find((item) => item.snapshotManifestId === snapshotManifestId);
      const artifact = inventory?.artifacts.find(({ id }) => id === artifactId);
      if (!artifact) return null;
      if (artifact.disposition !== "INCLUDED") return artifact;
      const content = await readVerifiedLocalSnapshotArtifact({
        snapshotRoot: root,
        snapshotManifestId,
        inventoryId: inventory.id,
        artifact,
      });
      return { ...artifact, content: content.toString("utf8") };
    },
  });
}
