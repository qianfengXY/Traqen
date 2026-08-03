import assert from "node:assert/strict";
import test from "node:test";

import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";
import { WorkspaceAnalysisJobRunner, WorkspaceAnalysisPhase } from "../src/application/workspace-analysis-job-runner.js";

test("one durable job owns scan through atomic publishing and resume skips committed phases", async () => {
  const store = new MemoryTraceabilityStore();
  const calls = [];
  const handlers = Object.fromEntries(Object.values(WorkspaceAnalysisPhase).slice(0, -1).map((phase) => [
    phase,
    async () => { calls.push(phase); return { id: `${phase}-OUTPUT` }; },
  ]));
  const runner = new WorkspaceAnalysisJobRunner({ store, handlers });
  const job = await runner.start({
    projectId: "P",
    sourceRegistrationId: "SOURCE",
    snapshotManifestId: "S",
    requestedMode: "AUTO",
    policyDigest: "POLICY",
    workspaceExecutionProfileRevisionId: "PROFILE",
  });
  assert.equal(job.resolvedMode, "FULL");
  const result = await runner.run(job);
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(calls, Object.values(WorkspaceAnalysisPhase).slice(0, -1));
  calls.length = 0;
  await runner.run({ ...result, status: "RUNNING" });
  assert.deepEqual(calls, []);
  const restartedRunner = new WorkspaceAnalysisJobRunner({ store, handlers });
  const recovered = await restartedRunner.get("P", job.id);
  assert.equal(recovered.status, "COMPLETED");
  assert.equal(recovered.snapshotManifestId, job.snapshotManifestId);
});

test("durable jobs preserve pause, resume, cancel, and pinned profile state", async () => {
  const store = new MemoryTraceabilityStore();
  const runner = new WorkspaceAnalysisJobRunner({
    store,
    handlers: Object.fromEntries(Object.values(WorkspaceAnalysisPhase).slice(0, -1).map((phase) => [
      phase,
      async () => ({ phase }),
    ])),
  });
  const job = await runner.start({
    projectId: "P",
    sourceRegistrationId: "SOURCE",
    snapshotManifestId: "S",
    requestedMode: "FULL",
    policyDigest: "POLICY",
    workspaceExecutionProfileRevisionId: "PROFILE-7",
  });
  const paused = await runner.pause(job);
  assert.equal(paused.status, "PAUSED");
  assert.equal((await runner.get("P", job.id)).workspaceExecutionProfileRevisionId, "PROFILE-7");
  const resumed = await runner.resume(paused);
  assert.equal(resumed.status, "RUNNING");
  const cancelled = await runner.cancel(resumed);
  assert.equal(cancelled.status, "CANCELLED");
  await assert.rejects(() => runner.resume(cancelled), /only a PAUSED job/);
  await assert.rejects(() => runner.cancel(cancelled), /terminal job/);
});

test("a cancellation persisted while a phase is running cannot be overwritten by stale local state", async () => {
  const store = new MemoryTraceabilityStore();
  let releasePhase;
  const phaseStarted = new Promise((resolve) => {
    releasePhase = resolve;
  });
  let finishHandler;
  const handlerBlocked = new Promise((resolve) => {
    finishHandler = resolve;
  });
  const handlers = Object.fromEntries(Object.values(WorkspaceAnalysisPhase).slice(0, -1).map((phase) => [
    phase,
    phase === WorkspaceAnalysisPhase.SOURCE_SCAN
      ? async () => {
          releasePhase();
          await handlerBlocked;
          return { phase };
        }
      : async () => ({ phase }),
  ]));
  const runner = new WorkspaceAnalysisJobRunner({ store, handlers });
  const job = await runner.start({
    id: "CANCEL-RACE",
    projectId: "P",
    sourceRegistrationId: "SOURCE",
    snapshotManifestId: "S",
    requestedMode: "FULL",
    policyDigest: "POLICY",
    workspaceExecutionProfileRevisionId: "PROFILE",
  });
  const running = runner.run(job);
  await phaseStarted;
  const cancelled = await runner.cancel(await runner.get("P", job.id));
  finishHandler();
  const result = await running;
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(result.status, "CANCELLED");
  assert.equal((await runner.get("P", job.id)).status, "CANCELLED");
  await store.appendUnderstandingRecord("P", "WORKSPACE_ANALYSIS_JOB", {
    id: "STALE-RUNNER-CHECKPOINT-AFTER-CANCEL",
    jobId: job.id,
    checkpointSequence: 999,
    projectId: "P",
    snapshotManifestId: "S",
    analysisRunId: job.id,
    artifactIds: [],
    state: { ...job, version: 999, status: "COMPLETED", phase: "COMPLETED" },
    createdAt: new Date().toISOString(),
  });
  assert.equal((await runner.get("P", job.id)).status, "CANCELLED");
});
