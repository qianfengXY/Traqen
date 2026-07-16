import assert from "node:assert/strict";
import test from "node:test";

import { createPlatformOperationsMetrics } from "../src/domain/index.js";

const clock = () => new Date("2026-07-15T12:00:00.000Z");

test("platform operations metrics preserve independent observations and unavailable telemetry", () => {
  const metrics = createPlatformOperationsMetrics("PROJECT-001", {
    reverseRuns: [{
      status: "WAITING_REVIEW",
      statusHistory: [{ occurredAt: "2026-07-15T11:00:00.000Z" }, { occurredAt: "2026-07-15T11:00:02.000Z" }],
      inputPackage: { facts: { nodes: [{}, {}], edges: [{}] } },
      skillRuns: [{ status: "COMPLETED", attempts: [{ status: "FAILED" }, { status: "COMPLETED" }] }],
      mergedOutput: { candidateFeatures: [{}], candidateClaims: [{}], candidateTestSpecs: [], openQuestions: [] },
    }],
    reverseJobs: [{ id: "JOB-1", status: "STARTED" }],
    factBundles: [{ extractorId: "scanner", extractorVersion: "1", complete: false, nodeCount: 2, edgeCount: 1 }],
    testExecutions: [
      { testSpecId: "TEST-1", testSpecVersion: 1, status: "PASS", startedAt: "2026-07-15T11:01:00.000Z", finishedAt: "2026-07-15T11:01:01.000Z", attempts: [{}] },
      { testSpecId: "TEST-1", testSpecVersion: 1, status: "FAIL", startedAt: "2026-07-15T11:02:00.000Z", finishedAt: "2026-07-15T11:02:03.000Z", attempts: [{}, {}] },
    ],
    evidence: [{ type: "ASSERTION", integrity: "VERIFIED", freshness: "FRESH", storageUri: "s3://evidence/1" }],
    evidenceLifecycleEvents: [{ action: "ARCHIVED" }],
    changeImpacts: [{ changeSetCreatedAt: "2026-07-15T11:03:00.000Z", impactCreatedAt: "2026-07-15T11:03:00.250Z", changedFactCount: 3, affectedFeatureCount: 1, regressionSelectionCount: 2 }],
  }, clock);

  assert.equal(metrics.reverseRuns.duration.meanMs, 2000);
  assert.equal(metrics.reverseRuns.retryCount, 1);
  assert.equal(metrics.reverseRuns.queue.activeCount, 1);
  assert.equal(metrics.scanners.incompleteBundleCount, 1);
  assert.equal(metrics.tests.unstableTestSpecCount, 1);
  assert.deepEqual(metrics.tests.stabilityRate, { numerator: 0, denominator: 1, ratio: 0 });
  assert.equal(metrics.evidence.lifecycleActionCounts.ARCHIVED, 1);
  assert.equal(metrics.impactAnalysis.regressionSelectionCount, 2);
  assert.ok(metrics.unavailableSignals.some((item) => item.signal === "MODEL_TOKEN_COST"));
  assert.equal(metrics.compositeScore, undefined);
});
