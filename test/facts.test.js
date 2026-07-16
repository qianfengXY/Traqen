import assert from "node:assert/strict";
import test from "node:test";

import {
  createFactBundle,
  createFactNode,
  signFactBundle,
  verifyFactBundleAttestation,
} from "../src/domain/index.js";

const observedAt = "2026-07-14T08:00:00.000Z";
const contentHash = `sha256:${"a".repeat(64)}`;

function nodeInput(overrides = {}) {
  return {
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    type: "CODE_SYMBOL",
    naturalKey: "javascript:src/orders.js:loadOrder",
    name: "loadOrder",
    attributes: { language: "javascript", kind: "function" },
    source: { artifact: "src/orders.js", startLine: 3, endLine: 5, contentHash },
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt,
    ...overrides,
  };
}

function bundleInput() {
  return {
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    sourceComponentId: "SOURCE-001",
    sourceDigest: `sha256:${"b".repeat(64)}`,
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt,
    complete: true,
    diagnostics: [],
    nodes: [nodeInput()],
    edges: [],
  };
}

test("fact nodes keep a stable entity id while facts remain snapshot-specific", () => {
  const first = createFactNode(nodeInput());
  const second = createFactNode(nodeInput({ snapshotManifestId: "SNAPSHOT-002" }));

  assert.equal(first.id, second.id);
  assert.notEqual(first.factId, second.factId);
  assert.equal(Object.isFrozen(first.source), true);

  const observedAgain = createFactNode(nodeInput({ observedAt: "2026-07-14T08:05:00.000Z" }));
  assert.equal(first.id, observedAgain.id);
  assert.notEqual(first.factId, observedAgain.factId);
});

test("repeated observations of the same source become distinct immutable bundles", () => {
  const first = createFactBundle(bundleInput());
  const second = createFactBundle({
    ...bundleInput(),
    observedAt: "2026-07-14T08:05:00.000Z",
  });

  assert.notEqual(first.id, second.id);
});

test("fact bundles reject edges that escape their immutable snapshot", () => {
  assert.throws(
    () => createFactBundle({
      ...bundleInput(),
      edges: [{
        subjectId: createFactNode(nodeInput()).id,
        predicate: "CALLS",
        objectId: "FACT-NODE-outside",
        attributes: {},
        source: nodeInput().source,
      }],
    }),
    /outside the bundle/,
  );
});

test("scanner attestations are deterministic and detect fact tampering", () => {
  const bundle = createFactBundle(bundleInput());
  const signed = signFactBundle(bundle, "scanner-shared-secret");

  assert.equal(verifyFactBundleAttestation(signed, "scanner-shared-secret"), true);
  const tampered = structuredClone(signed);
  tampered.nodes[0].name = "tampered";
  assert.equal(verifyFactBundleAttestation(tampered, "scanner-shared-secret"), false);
});

test("an error diagnostic makes a fact snapshot explicitly incomplete", () => {
  const bundle = createFactBundle({
    ...bundleInput(),
    diagnostics: [{ severity: "ERROR", artifact: "src/broken.js", message: "parse failed" }],
  });

  assert.equal(bundle.complete, false);
});
