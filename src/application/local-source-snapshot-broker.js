import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
      const snapshotDirectory = path.join(root, snapshotManifestId);
      await readFile(path.join(snapshotDirectory, ".traqen-sealed"), "utf8");
      const absolute = path.join(snapshotDirectory, ...artifact.relativePath.split("/"));
      const [realSnapshotDirectory, realArtifact] = await Promise.all([realpath(snapshotDirectory), realpath(absolute)]);
      if (realArtifact !== realSnapshotDirectory && !realArtifact.startsWith(`${realSnapshotDirectory}${path.sep}`)) {
        throw new TypeError("Artifact escaped the immutable Snapshot root");
      }
      const metadata = await lstat(realArtifact);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError("Artifact must be a non-symlink file");
      const content = await readFile(realArtifact, "utf8");
      const contentDigest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      if (contentDigest !== artifact.contentDigest) throw new TypeError("Snapshot Artifact digest verification failed");
      return { ...artifact, content };
    },
  });
}
