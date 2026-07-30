import assert from "node:assert/strict";
import test from "node:test";

import { ArtifactDisposition, createArtifactInventory } from "../src/domain/index.js";

const digest = (letter) => `sha256:${letter.repeat(64)}`;

test("sealed ArtifactInventory preserves every disposition in the coverage denominator", () => {
  const dispositions = Object.values(ArtifactDisposition);
  const inventory = createArtifactInventory({
    projectId: "PROJECT-1",
    snapshotManifestId: "SNAPSHOT-1",
    sourceDigest: digest("a"),
    scannerVersion: "1.0.0",
    sealed: true,
    artifacts: dispositions.map((disposition, index) => ({
      id: `ARTIFACT-${index}`,
      path: `scope/file-${index}.txt`,
      kind: "SOURCE",
      byteSize: index,
      contentDigest: digest(((index + 1) % 10).toString()),
      disposition,
      reason: disposition === "INCLUDED" ? undefined : `explicit ${disposition}`,
    })),
  });
  assert.equal(inventory.totalCount, dispositions.length);
  assert.equal(inventory.disposedCount, dispositions.length);
  assert.equal(Object.values(inventory.dispositionCounts).reduce((sum, value) => sum + value, 0), dispositions.length);
  assert.throws(() => createArtifactInventory({
    projectId: "P", snapshotManifestId: "S", sourceDigest: digest("a"), scannerVersion: "1", sealed: true, artifacts: [],
  }), /must contain artifacts/);
});
