import { createSnapshotManifest } from "../src/domain/index.js";

const fixedClock = () => new Date("2026-07-14T02:00:00.000Z");

export function completeInput() {
  const snapshotManifest = createSnapshotManifest(
    {
      source: { id: "SOURCE-001", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      build: { id: "BUILD-001", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      deployment: { id: "DEPLOY-001", digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
      runtime: { id: "RUNTIME-001", digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
      failedSources: [],
      observedFrom: "2026-07-14T01:00:00.000Z",
      observedTo: "2026-07-14T01:05:00.000Z",
    },
    fixedClock,
  );

  return {
    feature: { id: "FEATURE-001", name: "Submit order" },
    claim: {
      id: "CLAIM-001",
      version: 1,
      type: "NORMATIVE_REQUIREMENT",
      authorityStatus: "CONFIRMED",
      evidenceSupport: "MULTI_SOURCE",
    },
    scope: { id: "SCOPE-001", actor: "normal-user" },
    snapshotManifest,
    implementation: {
      endpoints: ["POST /orders/{id}/submit"],
      codeSymbols: ["OrderService.submit"],
      dataObjects: ["orders.status"],
      configurations: ["order.submit.enabled"],
      dependencies: ["inventory-service"],
    },
    conformance: {
      status: "CONFORMS",
      claimId: "CLAIM-001",
      claimVersion: 1,
      scopeId: "SCOPE-001",
      snapshotManifestId: snapshotManifest.id,
    },
    testSpec: {
      id: "TEST-001",
      version: 1,
      approved: true,
      verifiesClaims: [{ id: "CLAIM-001", version: 1 }],
      assertions: ["http-status", "database-status"],
    },
    execution: {
      id: "EXEC-001",
      deploymentId: "DEPLOY-001",
      snapshotManifestId: snapshotManifest.id,
      testSpecId: "TEST-001",
      testSpecVersion: 1,
      status: "PASS",
    },
    evidence: [
      {
        id: "EVIDENCE-001",
        executionId: "EXEC-001",
        integrity: "VERIFIED",
        freshness: "FRESH",
      },
    ],
    conflicts: [],
  };
}

export { fixedClock };
