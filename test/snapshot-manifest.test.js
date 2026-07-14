import assert from "node:assert/strict";
import test from "node:test";

import { createSnapshotManifest } from "../src/domain/index.js";
import { fixedClock } from "./fixtures.js";

const baseInput = {
  source: { id: "SOURCE-001", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  build: { id: "BUILD-001", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
  deployment: { id: "DEPLOY-001", digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
  runtime: { id: "RUNTIME-001", digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
  failedSources: [],
  observedFrom: "2026-07-14T01:00:00.000Z",
  observedTo: "2026-07-14T01:05:00.000Z",
};

test("snapshot manifest ID is deterministic across object key order", () => {
  const first = createSnapshotManifest(baseInput, fixedClock);
  const second = createSnapshotManifest(
    {
      observedTo: baseInput.observedTo,
      runtime: { digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", id: "RUNTIME-001" },
      deployment: { digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", id: "DEPLOY-001" },
      observedFrom: baseInput.observedFrom,
      build: { digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", id: "BUILD-001" },
      failedSources: [],
      source: { digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", id: "SOURCE-001" },
    },
    fixedClock,
  );

  assert.equal(first.id, second.id);
  assert.equal(first.complete, true);
});

test("snapshot manifest exposes missing and failed sources", () => {
  const input = structuredClone(baseInput);
  delete input.runtime;
  input.failedSources = ["trace-collector", "trace-collector"];

  const manifest = createSnapshotManifest(input, fixedClock);

  assert.equal(manifest.complete, false);
  assert.deepEqual(manifest.missingComponents, ["runtime"]);
  assert.deepEqual(manifest.failedSources, ["trace-collector"]);
});

test("snapshot manifest validates its observation window", () => {
  assert.throws(
    () =>
      createSnapshotManifest(
        {
          ...baseInput,
          observedFrom: "2026-07-14T02:00:00.000Z",
          observedTo: "2026-07-14T01:00:00.000Z",
        },
        fixedClock,
      ),
    /observedFrom must be earlier/,
  );
});

test("snapshot manifest and nested components are immutable", () => {
  const manifest = createSnapshotManifest(baseInput, fixedClock);

  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.components), true);
  assert.equal(Object.isFrozen(manifest.components.source), true);
  assert.throws(() => {
    manifest.components.source.id = "SOURCE-TAMPERED";
  }, TypeError);
});

test("a normalized Snapshot manifest can be safely re-registered", () => {
  const original = createSnapshotManifest(baseInput, fixedClock);
  const normalized = createSnapshotManifest(original, fixedClock);

  assert.equal(normalized.complete, true);
  assert.equal(normalized.id, original.id);
  assert.deepEqual(normalized.components, original.components);
});
