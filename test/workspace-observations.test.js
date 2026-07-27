import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceObservationPackage } from "../src/domain/index.js";

const observedAt = "2026-07-27T12:00:00.000Z";
const fixedClock = () => new Date("2026-07-27T12:00:01.000Z");

function observationInput() {
  return {
    projectId: "PROJECT-WORKSPACE",
    workspaceName: "Orders",
    rootName: "orders-service",
    observedAt,
    records: [{
      path: "orders-service/src/orders.ts",
      size: 420,
      contentFingerprint: "CONTENT-FINGERPRINT-ORDERS",
      supported: true,
      candidates: [
        {
          localCandidateId: "CANDIDATE-GET-ORDER",
          kind: "ENDPOINT",
          name: "GET /orders/:id",
          method: "GET",
          modulePath: "orders-service",
          sourcePath: "orders-service/src/orders.ts",
          startLine: 12,
          description: "Discovered GET order endpoint.",
        },
        {
          localCandidateId: "CANDIDATE-LOAD-ORDER",
          kind: "CODE_SYMBOL",
          name: "Load Order",
          method: null,
          modulePath: "orders-service",
          sourcePath: "orders-service/src/orders.ts",
          startLine: 20,
          description: "Discovered order loading capability.",
        },
      ],
      configuration: {
        path: "orders-service/application.yml",
        key: "application.yml",
        value: "database:\n  password: <redacted>",
      },
      test: {
        path: "orders-service/test/orders.test.ts",
        title: "GET order",
      },
    }],
  };
}

test("Workspace observations normalize into one source Snapshot and canonical Facts without raw code", () => {
  const prepared = createWorkspaceObservationPackage(observationInput(), fixedClock);

  assert.equal(prepared.snapshotManifest.complete, false);
  assert.deepEqual(prepared.snapshotManifest.missingComponents, ["build", "deployment", "runtime"]);
  assert.equal(prepared.snapshotManifest.components.source.id, prepared.receipt.sourceComponentId);
  assert.equal(prepared.snapshotManifest.components.source.digest, prepared.factBundle.sourceDigest);
  assert.equal(prepared.factBundle.projectId, "PROJECT-WORKSPACE");
  assert.equal(prepared.factBundle.snapshotManifestId, prepared.snapshotManifest.id);
  assert.equal(prepared.factBundle.attestation.algorithm, "SERVER-NORMALIZED-SHA256");
  assert.equal(prepared.receipt.candidateFacts.length, 2);
  assert.deepEqual(
    prepared.factBundle.nodes.map((node) => node.type).sort(),
    ["ARTIFACT", "CODE_SYMBOL", "CONFIGURATION", "ENDPOINT", "TEST_ASSET"],
  );
  assert.equal(prepared.factBundle.edges.length, 4);
  assert.doesNotMatch(JSON.stringify(prepared), /api-key-value|function loadOrder|test source body/);
});

test("Workspace observation normalization is deterministic for the same bounded input", () => {
  const first = createWorkspaceObservationPackage(observationInput(), fixedClock);
  const second = createWorkspaceObservationPackage(observationInput(), fixedClock);

  assert.equal(first.snapshotManifest.id, second.snapshotManifest.id);
  assert.equal(first.factBundle.id, second.factBundle.id);
  assert.deepEqual(first.receipt.candidateFacts, second.receipt.candidateFacts);
});

test("Workspace Snapshot identity changes when source content changes without changing derived candidates", () => {
  const firstInput = observationInput();
  firstInput.records[0].contentFingerprint = "CONTENT-FINGERPRINT-A";
  const secondInput = observationInput();
  secondInput.records[0].contentFingerprint = "CONTENT-FINGERPRINT-B";

  const first = createWorkspaceObservationPackage(firstInput, fixedClock);
  const second = createWorkspaceObservationPackage(secondInput, fixedClock);

  assert.notEqual(first.snapshotManifest.id, second.snapshotManifest.id);
  assert.notEqual(first.factBundle.sourceDigest, second.factBundle.sourceDigest);
});

test("Workspace observations reject raw code and unredacted secret-bearing configuration", () => {
  const withCode = observationInput();
  withCode.records[0].candidates[0].code = "function loadOrder() {}";
  assert.throws(
    () => createWorkspaceObservationPackage(withCode, fixedClock),
    /candidate has unsupported fields: code/,
  );

  const withSecret = observationInput();
  withSecret.records[0].configuration.value = "apiKey: api-key-value";
  assert.throws(
    () => createWorkspaceObservationPackage(withSecret, fixedClock),
    /secret-like configuration values must be redacted/,
  );
});

test("Workspace observations require candidate paths to stay inside their record", () => {
  const input = observationInput();
  input.records[0].candidates[0].sourcePath = "../outside.ts";
  assert.throws(
    () => createWorkspaceObservationPackage(input, fixedClock),
    /relative path without traversal/,
  );
});
