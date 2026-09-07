import assert from "node:assert/strict";
import test from "node:test";
import { sourceDatabase, owner, reader } from "./support/source-truth-database.js";

const input = { sources: [{ kind: "DIRECTORY_UPLOAD", sourceId: "directory-1", label: "资料" }], baselineBundleId: null };

test("B-05 authority is current tenant/Workspace membership, not body actor", async (t) => {
  const { repository: r } = await sourceDatabase(t);
  assert.equal((await r.authorize(owner, "workspace", true))?.role, "MAINTAIN");
  await assert.rejects(r.authorize(reader, "workspace", true), { code: "SOURCE_FORBIDDEN" });
  await assert.rejects(r.authorize({ ...owner, tenantId: "other" }, "workspace", false), { code: "SOURCE_FORBIDDEN" });
  await assert.rejects(r.authorize(owner, "workspace2", false), { code: "SOURCE_FORBIDDEN" });
  await assert.rejects(r.authorize(null, "workspace", false), { code: "SOURCE_AUTHENTICATION_REQUIRED" });
});

test("B-08 drafts save by CAS and cannot be rewritten by read-only users", async (t) => {
  const { repository: r } = await sourceDatabase(t);
  const saved = await r.saveDraft(owner, "workspace", { expectedRevision: 0, input });
  assert.equal(saved?.revision, 1);
  assert.deepEqual((await r.getDraft(reader, "workspace")).input, input);
  await assert.rejects(r.saveDraft(owner, "workspace", { expectedRevision: 0, input }), { code: "SOURCE_REVISION_CONFLICT" });
  await assert.rejects(r.saveDraft(reader, "workspace", { expectedRevision: 1, input }), { code: "SOURCE_FORBIDDEN" });
  const next = await r.saveDraft(owner, "workspace", { expectedRevision: 1, input: { ...input, note: "next" } });
  assert.equal(next.revision, 2);
});

test("B-08 only one active run, repeat start resolves it, stale worker cannot advance", async (t) => {
  const { repository: r } = await sourceDatabase(t);
  await r.saveDraft(owner, "workspace", { expectedRevision: 0, input });
  const run = await r.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "policy-v1" });
  assert.equal(run?.status, "PREFLIGHTING");
  const repeated = await r.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "policy-v1" });
  assert.equal(repeated.id, run.id);
  const first = await r.claimRun("workspace", run.id, { workerId: "worker-1", leaseMs: 1000 });
  assert.equal(first.generation, 1);
  await assert.rejects(r.claimRun("workspace", run.id, { workerId: "worker-2", leaseMs: 1000 }), { code: "SOURCE_LEASE_BUSY" });
  await assert.rejects(r.transition("workspace", run.id, { generation: 0, expectedStatus: "PREFLIGHTING", status: "ENUMERATING" }), { code: "SOURCE_STALE_WORKER" });
  const advanced = await r.transition("workspace", run.id, { generation: first.generation, expectedStatus: "PREFLIGHTING", status: "ENUMERATING" });
  assert.equal(advanced.status, "ENUMERATING");
  assert.equal(advanced.station, 4);
  assert.deepEqual(await r.listBundles(reader, "workspace"), []);
});

test("B-11 terminal retry keeps distinct audit and input", async (t) => {
  const { repository: r } = await sourceDatabase(t);
  await r.saveDraft(owner, "workspace", { expectedRevision: 0, input });
  const run = await r.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "policy-v1" });
  assert.equal(run?.status, "PREFLIGHTING");
  const lease = await r.claimRun("workspace", run.id, { workerId: "w", leaseMs: 30000 });
  await r.transition("workspace", run.id, { generation: lease.generation, expectedStatus: "PREFLIGHTING", status: "FAILED_RETRYABLE", diagnostic: { code: "STORAGE_UNAVAILABLE" } });
  const retry = await r.startRun(owner, "workspace", { retryOf: run.id });
  assert.notEqual(retry.id, run.id);
  assert.equal(retry.retryOf, run.id);
  assert.deepEqual(retry.input, run.input);
  assert.equal((await r.getRun(reader, "workspace", run.id)).status, "FAILED_RETRYABLE");
});

test("B-05 revocation fences state transitions as well as material writes", async (t) => {
  const { repository: r } = await sourceDatabase(t);
  await r.saveDraft(owner, "workspace", { expectedRevision: 0, input });
  const run = await r.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "v1" });
  const lease = await r.claimRun("workspace", run.id, { workerId: "w", leaseMs: 60000 });
  await r.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "REVOKED" }] });
  await assert.rejects(r.transition("workspace", run.id, { generation: lease.generation, expectedStatus: "PREFLIGHTING", status: "ENUMERATING" }), { code: "SOURCE_FORBIDDEN" });
});

test("B-08 cancellation fences in-flight workers without deleting the run or saved draft", async (t) => {
  const { repository: r } = await sourceDatabase(t);
  await r.saveDraft(owner, "workspace", { expectedRevision: 0, input });
  const run = await r.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "v1" });
  const lease = await r.claimRun("workspace", run.id, { workerId: "w", leaseMs: 60000 });
  assert.equal((await r.cancel(owner, "workspace", run.id))?.status, "CANCELLED");
  await assert.rejects(r.transition("workspace", run.id, { generation: lease.generation, expectedStatus: "PREFLIGHTING", status: "ENUMERATING" }), { code: "SOURCE_STALE_WORKER" });
  assert.equal((await r.getDraft(owner, "workspace")).revision, 1);
  assert.equal((await r.cancel(owner, "workspace", run.id)).status, "CANCELLED");
});

test("B-08 lease heartbeat preserves generation; releasing it permits a fenced takeover", async (t) => {
  const { repository: r } = await sourceDatabase(t);
  await r.saveDraft(owner, "workspace", { expectedRevision: 0, input });
  const run = await r.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "v1" });
  const lease = await r.claimRun("workspace", run.id, { workerId: "w", leaseMs: 60000 });
  const context = { workspaceId: "workspace", runId: run.id, generation: lease.generation };
  assert.equal((await r.heartbeat(context))?.generation, 1);
  await r.releaseLease(context);
  const next = await r.claimRun("workspace", run.id, { workerId: "w2", leaseMs: 60000 });
  assert.equal(next.generation, 2);
  await assert.rejects(r.heartbeat(context), { code: "SOURCE_STALE_WORKER" });
});
