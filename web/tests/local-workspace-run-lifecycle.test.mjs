import assert from "node:assert/strict";
import test from "node:test";

import { planLocalWorkspaceAnalysisRunRecovery } from "../app/local-workspace-run-lifecycle.ts";

function checkpoint(status) {
  return {
    id: "PROJECT-WEB:ACTIVE",
    projectId: "PROJECT-WEB",
    rootName: "workspace",
    mode: "FULL",
    engine: "HYBRID",
    status,
    phase: "MODEL_ENRICHMENT",
    modelProfileId: "model-a",
    completedModelBatchCount: 7,
    totalModelBatchCount: 12,
    scannerVersion: 5,
    evidencePolicyVersion: 2,
    plannedFileCount: 240,
    completedFileCount: 240,
    records: [],
    currentPaths: [],
    counters: { added: 240, modified: 0, unchanged: 0 },
    startedAt: "2026-07-27T08:00:00.000Z",
    updatedAt: "2026-07-27T08:05:00.000Z",
  };
}

test("reattaches a persisted running Workspace analysis after browser refresh", () => {
  const recovery = planLocalWorkspaceAnalysisRunRecovery(checkpoint("RUNNING"));

  assert.equal(recovery.status, "RUNNING");
  assert.equal(recovery.phase, "MODEL_ENRICHMENT");
  assert.equal(recovery.shouldAutoResume, true);
  assert.equal(recovery.endedAt, null);
  assert.equal(recovery.completed, 7);
  assert.equal(recovery.total, 12);
});

test("keeps an explicitly paused Workspace analysis paused until manual resume", () => {
  const recovery = planLocalWorkspaceAnalysisRunRecovery(checkpoint("PAUSED"));

  assert.equal(recovery.status, "PAUSED");
  assert.equal(recovery.phase, "PAUSED");
  assert.equal(recovery.shouldAutoResume, false);
  assert.equal(recovery.endedAt, Date.parse("2026-07-27T08:05:00.000Z"));
});

test("keeps a failed Workspace analysis distinct from a user pause", () => {
  const recovery = planLocalWorkspaceAnalysisRunRecovery(checkpoint("FAILED"));

  assert.equal(recovery.status, "FAILED");
  assert.equal(recovery.phase, "FAILED");
  assert.equal(recovery.shouldAutoResume, false);
});
