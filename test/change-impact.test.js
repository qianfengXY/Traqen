import assert from "node:assert/strict";
import test from "node:test";

import {
  compareFactGraphs,
  createChangeSet,
  createFactBundle,
  createImpactAssessment,
} from "../src/domain/index.js";

const fixedClock = () => new Date("2026-07-14T12:00:00.000Z");

function graph(snapshotManifestId, contentHash, observedAt, extraNodes = []) {
  const source = {
    artifact: "src/orders.js",
    startLine: 10,
    endLine: 20,
    contentHash,
  };
  const bundle = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId,
    sourceComponentId: `SOURCE-${snapshotManifestId}`,
    sourceDigest: contentHash,
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt,
    complete: true,
    diagnostics: [],
    nodes: [
      {
        type: "ENDPOINT",
        naturalKey: "http:POST /orders/{id}/submit",
        name: "POST /orders/{id}/submit",
        attributes: { method: "POST", path: "/orders/{id}/submit" },
        source,
      },
      ...extraNodes.map((node) => ({ ...node, source })),
    ],
    edges: [],
  });
  return { nodes: bundle.nodes, edges: bundle.edges, complete: true, bundleIds: [bundle.id] };
}

test("Fact graph comparison ignores observation identity but detects semantic implementation changes", () => {
  const hashA = `sha256:${"a".repeat(64)}`;
  const hashB = `sha256:${"b".repeat(64)}`;
  const before = graph("SNAPSHOT-001", hashA, "2026-07-14T10:00:00.000Z");
  const same = graph("SNAPSHOT-002", hashA, "2026-07-14T11:00:00.000Z");
  assert.deepEqual(compareFactGraphs(before, same), []);

  const after = graph("SNAPSHOT-003", hashB, "2026-07-14T12:00:00.000Z", [{
    type: "CONFIGURATION",
    naturalKey: "config:submit.enabled",
    name: "submit.enabled",
    attributes: { value: true },
  }]);
  const changes = compareFactGraphs(before, after);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes.map((change) => change.kind).sort(), ["ADDED", "MODIFIED"]);
  assert.ok(changes.some((change) => change.changeType === "API_CONTRACT"));
  assert.ok(changes.some((change) => change.changeType === "CONFIGURATION"));
});

test("Fact graph comparison keeps independent extractor observations instead of overwriting stable nodes", () => {
  const hashA = `sha256:${"a".repeat(64)}`;
  const hashB = `sha256:${"b".repeat(64)}`;
  const scannerOneBefore = graph("SNAPSHOT-001", hashA, "2026-07-14T10:00:00.000Z");
  const scannerTwoBefore = structuredClone(scannerOneBefore);
  scannerTwoBefore.nodes[0].extractor = { id: "SCANNER-002", version: "1.0.0" };
  scannerTwoBefore.nodes[0].factId = "FACT-SCANNER-002-BEFORE";
  const scannerOneAfter = graph("SNAPSHOT-002", hashA, "2026-07-14T11:00:00.000Z");
  const scannerTwoAfter = structuredClone(scannerOneAfter);
  scannerTwoAfter.nodes[0].extractor = { id: "SCANNER-002", version: "1.0.0" };
  scannerTwoAfter.nodes[0].factId = "FACT-SCANNER-002-AFTER";
  scannerTwoAfter.nodes[0].source.contentHash = hashB;

  const changes = compareFactGraphs(
    { nodes: [...scannerOneBefore.nodes, ...scannerTwoBefore.nodes], edges: [] },
    { nodes: [...scannerOneAfter.nodes, ...scannerTwoAfter.nodes], edges: [] },
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].beforeFactId, "FACT-SCANNER-002-BEFORE");
  assert.equal(changes[0].afterFactId, "FACT-SCANNER-002-AFTER");
});

test("impact assessment invalidates derived layers while preserving normative truth and history", () => {
  const before = graph("SNAPSHOT-001", `sha256:${"a".repeat(64)}`, "2026-07-14T10:00:00.000Z");
  const after = graph("SNAPSHOT-002", `sha256:${"b".repeat(64)}`, "2026-07-14T11:00:00.000Z");
  const changes = compareFactGraphs(before, after);
  const changeSet = createChangeSet({
    id: "CHANGESET-001",
    fromSnapshotManifestId: "SNAPSHOT-001",
    toSnapshotManifestId: "SNAPSHOT-002",
    complete: true,
    warnings: [],
    changes,
  }, fixedClock);
  const impact = createImpactAssessment({
    changeSet,
    affectedMappings: [{
      id: "MAPPING-001",
      featureId: "FEATURE-001",
      claimId: "CLAIM-001",
      claimVersion: 1,
      scopeId: "SCOPE-001",
      scopeVersion: 1,
      changeIds: changes.map((change) => change.id),
      testSpecIds: ["TEST-001"],
    }],
  }, fixedClock);

  assert.deepEqual(impact.affectedFeatureIds, ["FEATURE-001"]);
  assert.deepEqual(impact.affectedClaimRefs, [{ id: "CLAIM-001", version: 1 }]);
  assert.ok(impact.invalidations[0].layers.includes("IMPLEMENTATION_MAPPING"));
  assert.ok(impact.invalidations[0].layers.includes("CONFORMANCE"));
  assert.ok(impact.invalidations[0].layers.includes("VERIFICATION"));
  assert.ok(impact.invalidations[0].layers.includes("TRACE_CHAIN"));
  assert.ok(impact.invalidations[0].preserves.includes("NORMATIVE_CLAIM"));
  assert.ok(impact.invalidations[0].preserves.includes("BUSINESS_DECISION"));
  assert.ok(impact.invalidations[0].preserves.includes("HISTORICAL_FACT"));
  assert.ok(impact.invalidations[0].preserves.includes("HISTORICAL_EVIDENCE"));
  assert.equal(impact.invalidations[0].scopeId, "SCOPE-001");
  assert.ok(impact.invalidations[0].recommendedActions.includes("RECOMPUTE_IMPLEMENTATION_CONFORMANCE"));
  assert.ok(impact.invalidations[0].recommendedActions.includes("RERUN_AFFECTED_TESTS"));
});
