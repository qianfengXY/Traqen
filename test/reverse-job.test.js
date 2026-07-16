import assert from "node:assert/strict";
import test from "node:test";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import {
  createReverseRunJob,
  createReverseRunJobEvent,
  projectReverseRunJob,
} from "../src/domain/index.js";
import { MemoryTraceabilityStore, PersistenceConflictError } from "../src/storage/index.js";

const fixedClock = () => new Date("2026-07-15T11:00:00.000Z");

function request() {
  return {
    id: "REVERSE-JOB-001",
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    sourceComponentId: "SOURCE-001",
    factBundleIds: ["BUNDLE-001"],
    skills: [{ id: "skill-001", version: "1.0.0" }],
    taskScope: { nodeTypes: ["ENDPOINT"] },
  };
}

test("reverse job projection preserves queued, cancellation-requested, and terminal events", () => {
  const job = createReverseRunJob(request(), fixedClock);
  const events = [
    createReverseRunJobEvent({ id: "E1", jobId: job.id, status: "QUEUED" }, fixedClock),
    createReverseRunJobEvent({ id: "E2", jobId: job.id, status: "CANCEL_REQUESTED" }, fixedClock),
    createReverseRunJobEvent({ id: "E3", jobId: job.id, status: "CANCELLED" }, fixedClock),
  ];
  const projection = projectReverseRunJob(job, events);
  assert.equal(projection.status, "CANCELLED");
  assert.equal(projection.cancelRequested, true);
  assert.equal(projection.terminal, true);
});

test("an orphaned durable reverse job can be cancelled during recovery without executing a Skill", async () => {
  const store = new MemoryTraceabilityStore();
  const job = createReverseRunJob(request(), fixedClock);
  await store.appendReverseRunJob("PROJECT-001", job, createReverseRunJobEvent({
    id: "E1",
    jobId: job.id,
    status: "QUEUED",
  }, fixedClock));
  const application = new TraceabilityApplication({ store, clock: fixedClock });
  const cancelled = await application.cancelReverseRun("PROJECT-001", job.id);
  assert.equal(cancelled.status, "CANCELLED");
  assert.deepEqual(cancelled.events.map((event) => event.status), ["QUEUED", "CANCEL_REQUESTED", "CANCELLED"]);
  await assert.rejects(
    application.cancelReverseRun("PROJECT-001", job.id),
    PersistenceConflictError,
  );
});

test("a persisted nonterminal job can resume and records a bounded failure when its executor is unavailable", async () => {
  const store = new MemoryTraceabilityStore();
  const job = createReverseRunJob({ ...request(), id: "REVERSE-JOB-RESUME-001" }, fixedClock);
  await store.appendReverseRunJob("PROJECT-001", job, createReverseRunJobEvent({
    id: "E-RESUME-QUEUED",
    jobId: job.id,
    status: "QUEUED",
  }, fixedClock));
  const application = new TraceabilityApplication({ store, clock: fixedClock });
  await application.resumeReverseRun("PROJECT-001", job.id);
  let projection;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    projection = await application.getReverseRunJobProjection("PROJECT-001", job.id);
    if (projection.terminal) break;
  }
  assert.equal(projection.status, "FAILED");
  assert.deepEqual(projection.events.map((event) => event.status), ["QUEUED", "STARTED", "FAILED"]);
  assert.match(projection.events.at(-1).details.error.message, /not configured/);
});
