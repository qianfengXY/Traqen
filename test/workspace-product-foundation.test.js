import assert from "node:assert/strict";
import test from "node:test";

import {
  commitChildBatchResult,
  createAnalysisBatch,
  createCapabilityTemplateRevision,
  createProjectFoundation,
  createWorkspaceCapabilityConfig,
  fanOutAnalysisBatch,
  openAnalysisBatchBarrier,
  resolveWorkspaceExecutionProfile,
} from "../src/domain/index.js";
import { WorkspaceProductFoundation } from "../src/application/workspace-product-foundation.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";

const clock = (() => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 31, 0, 0, tick++));
})();

async function foundation() {
  const store = new MemoryTraceabilityStore();
  await store.appendProjectFoundation(createProjectFoundation({
    organization: { id: "O", name: "Org" },
    tenant: { id: "T", name: "Tenant" },
    project: { id: "W1", name: "Workspace One" },
    principals: [],
  }));
  const service = new WorkspaceProductFoundation({ store, clock });
  await service.recordWorkspaceCreated("W1", "USER-1");
  return { store, service };
}

test("Workspace lifecycle is audited while per-user hiding preserves all Workspace data", async () => {
  const { store, service } = await foundation();
  await store.appendUnderstandingRecord("W1", "GAP", { id: "G1", workspaceId: "W1", code: "VISIBLE_AFTER_HIDE" });

  await service.setWorkspaceVisibility("W1", "USER-1", true);
  assert.equal((await service.getWorkspace("W1", "USER-1")).hidden, true);
  assert.equal((await service.getWorkspace("W1", "USER-2")).hidden, false);
  assert.equal((await store.getUnderstandingRecord("W1", "GAP", "G1")).code, "VISIBLE_AFTER_HIDE");

  assert.equal((await service.transitionWorkspace("W1", "WORKSPACE_RENAMED", "USER-1", { name: "Renamed" })).name, "Renamed");
  assert.equal((await service.transitionWorkspace("W1", "DELETION_REQUESTED", "USER-1")).lifecycleState, "DELETION_REQUESTED");
  assert.equal((await service.transitionWorkspace("W1", "DELETION_CANCELLED", "USER-1")).lifecycleState, "ACTIVE");
  await service.transitionWorkspace("W1", "DELETION_REQUESTED", "USER-1");
  assert.equal((await service.transitionWorkspace("W1", "DELETION_COMPLETED", "USER-1")).lifecycleState, "DELETED");
  assert.equal((await service.listWorkspaces("USER-1")).length, 0);
  assert.equal((await service.listWorkspaces("USER-1", { includeDeleted: true })).length, 1);
});

test("Workspace execution profiles deterministically override and remove global templates", () => {
  const templates = [
    createCapabilityTemplateRevision({ kind: "MODEL", logicalName: "main", revision: 1, manifest: { model: "old" } }, clock),
    createCapabilityTemplateRevision({ kind: "MODEL", logicalName: "main", revision: 2, manifest: { model: "new" } }, clock),
    createCapabilityTemplateRevision({ kind: "SKILL", logicalName: "source", revision: 1, manifest: {} }, clock),
    createCapabilityTemplateRevision({ kind: "MCP", logicalName: "global-only", revision: 1, manifest: {} }, clock),
  ];
  const config = createWorkspaceCapabilityConfig({
    workspaceId: "W1",
    version: 1,
    mainAgent: { model: "main", skillNames: ["source"], mcpNames: [] },
    childSlots: [
      { id: "C1", model: "main", skillNames: ["source"], mcpNames: [], independenceGroup: "I1" },
      { id: "C2", model: "main", skillNames: ["source"], mcpNames: [], independenceGroup: "I2" },
    ],
    overrides: [{ kind: "MODEL", logicalName: "main", manifest: { model: "workspace" }, credentialHandleIds: ["HANDLE-1"] }],
    removals: ["global-only"],
  }, clock);
  const left = resolveWorkspaceExecutionProfile({ workspaceId: "W1", templates, config, clock });
  const right = resolveWorkspaceExecutionProfile({ workspaceId: "W1", templates, config, clock });
  assert.equal(left.id, right.id);
  assert.equal(left.entries.find(({ logicalName }) => logicalName === "main").manifest.model, "workspace");
  assert.equal(left.entries.some(({ logicalName }) => logicalName === "global-only"), false);
  assert.equal(JSON.stringify(left).includes("secret"), false);
  assert.throws(() => createCapabilityTemplateRevision({
    kind: "MCP",
    logicalName: "unsafe",
    revision: 1,
    manifest: { connection: { apiKey: "plaintext" } },
  }), /cannot contain credential material/);
});

test("every configured Child receives the same sealed batch and Main waits for the full terminal set", () => {
  const profile = {
    workspaceId: "W1",
    childSlots: [
      { id: "C1", model: "M1", skillNames: [], mcpNames: [], independenceGroup: "I1" },
      { id: "C2", model: "M2", skillNames: [], mcpNames: [], independenceGroup: "I2" },
    ],
  };
  const batch = createAnalysisBatch({
    workspaceId: "W1",
    snapshotManifestId: "S1",
    analysisRunId: "R1",
    profileRevisionId: "P1",
    sequence: 1,
    sourceScope: { artifactIds: ["A1"] },
    taskStatement: "Recover capability and cite evidence",
    outputSchema: { type: "object" },
    sourcePolicy: { maxBytes: 1000 },
  }, clock);
  const assignments = fanOutAnalysisBatch(batch, profile, clock);
  assert.equal(assignments.length, 2);
  assert.deepEqual(assignments.map(({ inputDigest }) => inputDigest), [batch.inputDigest, batch.inputDigest]);
  assert.deepEqual(assignments[0].sourceScope, assignments[1].sourceScope);

  const result = (assignment) => commitChildBatchResult({
    workspaceId: "W1",
    analysisRunId: "R1",
    analysisBatchId: batch.id,
    childWorkUnitId: assignment.id,
    slotId: assignment.slotId,
    inputDigest: assignment.inputDigest,
    independenceGroup: assignment.route.independenceGroup,
    status: "COMPLETED",
    output: { candidates: [] },
  }, clock);
  assert.throws(() => openAnalysisBatchBarrier(batch, assignments, [result(assignments[0])]), /every required Child/);
  const barrier = openAnalysisBatchBarrier(batch, assignments, assignments.map(result));
  assert.equal(barrier.opened, true);
  assert.deepEqual(barrier.independenceGroups, ["I1", "I2"]);
});

test("Child result retries are idempotent by sealed input digest", async () => {
  const { service } = await foundation();
  await service.registerCapabilityTemplate({
    kind: "MODEL", logicalName: "model", revision: 1, manifest: {},
  });
  const config = await service.saveWorkspaceCapabilityConfig("W1", {
    mainAgent: { model: "model", skillNames: [], mcpNames: [] },
    childSlots: [{ id: "C1", model: "model", skillNames: [], mcpNames: [], independenceGroup: "I1" }],
  });
  const profile = await service.resolveWorkspaceProfile("W1", config.id);
  const { batch, assignments } = await service.createBatch("W1", {
    snapshotManifestId: "S1",
    analysisRunId: "R1",
    profileRevisionId: profile.id,
    sequence: 1,
    sourceScope: { artifactIds: ["A1"] },
    taskStatement: "Recover semantics",
    outputSchema: { type: "object" },
    sourcePolicy: { maxBytes: 1000 },
  });
  const input = {
    analysisRunId: "R1",
    analysisBatchId: batch.id,
    childWorkUnitId: assignments[0].id,
    slotId: assignments[0].slotId,
    inputDigest: assignments[0].inputDigest,
    independenceGroup: "I1",
    status: "COMPLETED",
    output: { candidates: [] },
  };
  const first = await service.commitChildResult("W1", input);
  const retry = await service.commitChildResult("W1", input);
  assert.deepEqual(retry, first);
  await assert.rejects(
    () => service.commitChildResult("W1", { ...input, output: { candidates: [{ id: "different" }] } }),
    /conflicting Child result/,
  );
});

test("batch review projects one auditable decision atomically across selected queue items", async () => {
  const { store, service } = await foundation();
  for (const [id, evidenceState] of [["Q1", "EVIDENCE_VALIDATED"], ["Q2", "CONFLICT"]]) {
    await store.appendUnderstandingRecord("W1", "REVIEW_QUEUE_ITEM", {
      id,
      workspaceId: "W1",
      version: 1,
      status: "PENDING",
      severity: evidenceState === "CONFLICT" ? "BLOCKING" : "REVIEW",
      evidenceState,
      source: "RECONCILIATION",
      analysisBatchId: "B1",
      createdAt: clock().toISOString(),
    });
  }
  const decision = await service.decideReviewBatch("W1", {
    itemIds: ["Q1", "Q2"],
    outcome: "EDITED",
    edits: { Q1: { statement: "Reviewer wording" } },
    reviewerId: "REVIEWER-1",
    rationale: "Evidence checked against the selected Snapshot.",
  });
  assert.deepEqual(decision.versionVector, { Q1: 1, Q2: 1 });
  const reviewed = await service.getReviewQueue("W1", { status: "EDITED" });
  assert.equal(reviewed.length, 2);
  assert.equal(reviewed.find(({ id }) => id === "Q1").edits.statement, "Reviewer wording");
});
