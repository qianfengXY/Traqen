import assert from "node:assert/strict";
import test from "node:test";

import { createProfileId } from "../src/deterministic-facts/identity.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { F002RequestDerivationService, F002RequestService } from "../src/deterministic-facts/request-service.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { F002AdmissionService } from "../src/deterministic-facts/admission.js";
import { F002Worker } from "../src/deterministic-facts/worker.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { owner, reader, sourceDatabase } from "./support/source-truth-database.js";
import { verifiedF002Records } from "./support/f002-records.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";

const componentId = "a".repeat(64);
const bundleId = "b".repeat(64);
const profileInput = { version: "1", schemaVersion: 1, capabilityIds: ["javascript"], ruleVersions: ["javascript@1"], canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024, maxRecords: 10 }, redactionPolicyRevision: "policy-v1" };
const profile = { ...profileInput, id: createProfileId(profileInput), startable: true };
const sourceInput = { workspaceId: "workspace", bundleId, sourceBundleSnapshotId: bundleId, receiptId: "receipt-1", receiptStatus: "READY", confirmationId: "confirmation-1", acceptanceRecordIds: [], receiptValidUntil: null, qualifiedAt: "2026-09-17T00:00:00.000Z", inventoryId: "inventory-1", inventoryDigest: "inventory-1", policyRevisionId: "policy-v1", inheritedGapSet: { id: "gaps-1", count: "0", consumption: "ALL_PAGES_REQUIRED" } };

async function fixture(t) {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "request-run", sourceInput, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scope = run.scopes[0];
  const claimed = await repository.claimScope(owner, "workspace", run.id, scope.scopeId, { workerId: "request-worker", leaseMs: 60_000 });
  const publisher = new F002PublicationService(repository);
  const verified = verifiedF002Records({ workspaceId: "workspace", bundleId, componentId, profile });
  await publisher.prepare(owner, "workspace", run.id, scope.scopeId, { generation: claimed.generation, records: verified.records });
  await repository.recordScopeItems(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation,
    items: [{ materialId: verified.materialId, capabilityId: "javascript", status: "DONE" }] });
  const ready = await repository.readyToSeal(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation });
  const sealed = await publisher.publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.revision, operationId: "seal-request" });
  return { db, repository, sources, graphVersionId: sealed.graphVersionId, factId: verified.factIds[0], materialId: verified.materialId };
}

const request = (graphVersionId, factId, overrides = {}) => ({ operationId: "request-1", investigationId: "investigation-1", baseVersionId: graphVersionId,
  requestKind: "LOOKUP", question: "Where is this fact proven?", materialRefs: [], factRefs: [factId], requestedCapabilities: ["javascript"], ...overrides });

test("F002 investigation preview reads current trusted limits and usage without reserving or creating requests", async t => {
  const f = await fixture(t);
  const budget = { maxMaterials: 4, maxBytes: 4096, maxRuleApplications: 8, maximumAttempts: 2, deadline: "2099-01-01T00:00:00.000Z" };
  const binding = { investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.graphVersionId, state: "RUNNING",
    allowedFactIds: [f.factId], allowedMaterialIds: [f.materialId], allowedCapabilities: ["javascript"], budget };
  let allowed = true;
  const service = new F002RequestService(f.repository, { resolver: {
    resolve: async actor => allowed && actor.actorId === owner.actorId ? binding : null,
    authorizeRead: async (actor, workspaceId, investigationId, id) => ({ workspaceId, investigationId, baseVersionId: f.graphVersionId, allowedRequestIds: [id] }),
  } });
  const preview = await service.investigation(owner, "workspace", "investigation-1", f.graphVersionId);
  assert.deepEqual(preview, { workspaceId: "workspace", investigationId: "investigation-1", baseVersionId: f.graphVersionId, state: "RUNNING", budget,
    usage: { materials: 0, bytes: 0, ruleApplications: 0, attempts: 0 }, allowedCapabilities: ["javascript"] });
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM f002_request")).rows[0].n, 0);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM f002_request_budget_account")).rows[0].n, 0);
  binding.budget = { ...budget, maxBytes: Number.MAX_SAFE_INTEGER + 1 };
  await assert.rejects(service.investigation(owner, "workspace", "investigation-1", f.graphVersionId), { code: "F002_CONSUMER_REJECTED" });
  binding.budget = budget;
  binding.baseVersionId = "c".repeat(64);
  await assert.rejects(service.investigation(owner, "workspace", "investigation-1", binding.baseVersionId), { code: "F002_VERSION_NOT_FOUND" });
  binding.baseVersionId = f.graphVersionId;
  const submitted = await service.submit(owner, "workspace", request(f.graphVersionId, f.factId));
  await service.execute(owner, "workspace", submitted.id, { workerId: "preview-budget-worker" });
  assert.deepEqual((await service.investigation(owner, "workspace", "investigation-1", f.graphVersionId)).usage,
    { materials: 0, bytes: 0, ruleApplications: 0, attempts: 1 });
  await assert.rejects(service.investigation(reader, "workspace", "investigation-1", f.graphVersionId), { code: "F002_CONSUMER_REJECTED" });
  await assert.rejects(service.investigation(owner, "workspace", "investigation-1", "b".repeat(64)), { code: "F002_CONSUMER_REJECTED" });
  allowed = false;
  await assert.rejects(service.investigation(owner, "workspace", "investigation-1", f.graphVersionId), { code: "F002_CONSUMER_REJECTED" });
  allowed = true; binding.state = "STOPPED";
  await assert.rejects(service.investigation(owner, "workspace", "investigation-1", f.graphVersionId), { code: "F002_CONSUMER_REJECTED" });
  await assert.rejects(new F002RequestService(f.repository).investigation(owner, "workspace", "investigation-1", f.graphVersionId), { code: "F002_CONSUMER_UNAVAILABLE" });
});

test("F002 request list pages only current individually authorized receipts in the exact investigation baseline", async t => {
  const f = await fixture(t), denied = new Set(), checked = [];
  const resolver = {
    resolve: async (actor, workspaceId, investigationId) => ({ workspaceId, investigationId, baseVersionId: f.graphVersionId, state: "RUNNING",
      allowedFactIds: [f.factId], allowedMaterialIds: [], allowedCapabilities: ["javascript"],
      budget: { maxMaterials: 1, maxBytes: 1024, maxRuleApplications: 1, maximumAttempts: 4, deadline: "2099-01-01T00:00:00Z" } }),
    authorizeRead: async (actor, workspaceId, investigationId, id) => {
      checked.push(id);
      return actor.actorId === owner.actorId && !denied.has(id) ? { workspaceId, investigationId, baseVersionId: f.graphVersionId, allowedRequestIds: [id] } : null;
    },
  };
  const service = new F002RequestService(f.repository, { resolver });
  const created = [];
  for (let i = 0; i < 3; i++) created.push(await service.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: `list-${i}`, question: `question-${i}` })));
  const unrelated = await service.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: "other-investigation", investigationId: "investigation-2", question: "private other investigation" }));
  const sorted = created.sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  denied.add(sorted[1].id);
  const options = { investigationId: "investigation-1", baseVersionId: f.graphVersionId, limit: 1 };
  const first = await service.list(owner, "workspace", options);
  assert.equal(first.items.length, 1); assert.equal(first.items[0].id, sorted[0].id); assert.equal(first.nextCursor, sorted[0].id);
  assert.equal(first.items[0].questionSummary, sorted[0].operationId.replace("list", "question"));
  assert.deepEqual(first.items[0].scope, { factRefs: [f.factId], materialRefs: [] });
  assert.ok(Number.isFinite(Date.parse(first.items[0].updatedAt)));
  assert.equal("result" in first.items[0], false, "discovering IDs does not eagerly deliver full result artifacts");
  const second = await service.list(owner, "workspace", { ...options, cursor: first.nextCursor });
  assert.deepEqual(second.items.map(item => item.id), [sorted[2].id]); assert.equal(second.nextCursor, null);
  assert.ok(!checked.includes(unrelated.id), "unrelated investigation is not even a permission candidate");
  assert.ok(!JSON.stringify([first, second]).includes(sorted[1].id), "denied IDs are not disclosed through pagination");
  assert.deepEqual(await service.list(reader, "workspace", options), { items: [], nextCursor: null });
  denied.add(sorted[0].id);
  await assert.rejects(service.list(owner, "workspace", { ...options, cursor: first.nextCursor }), { code: "F002_CONSUMER_REJECTED" });
  await assert.rejects(service.list(owner, "workspace", { ...options, cursor: unrelated.id }), { code: "F002_PAGE_INVALID" });
  await assert.rejects(service.list(owner, "workspace2", options), { status: 403 });
  await assert.rejects(service.list(owner, "workspace", { ...options, limit: 0 }), { code: "F002_PAGE_INVALID" });
  await assert.rejects(service.list(owner, "workspace", { ...options, limit: 101 }), { code: "F002_PAGE_INVALID" });
  await assert.rejects(new F002RequestService(f.repository).list(owner, "workspace", options), { code: "F002_CONSUMER_UNAVAILABLE" });
});

test("F002 request list refuses bounded-scan exhaustion and unexpected authorization faults without publishing a partial prefix", async () => {
  const baseVersionId = "a".repeat(64), calls = [];
  const repository = { withMaintainedWorkspace() {}, withAuthorizedWorkspace: async (actor, workspaceId, apply) => apply({
    query: async (_sql, values) => { calls.push(values); return { rows: Array.from({ length: 100 }, (_, index) => ({ id: `request-${calls.length}-${index}`,
      investigation_id: "i", base_version_id: baseVersionId })) }; },
  }) };
  const service = new F002RequestService(repository, { resolver: { resolve() {}, authorizeRead: async () => null } });
  await assert.rejects(service.list(owner, "workspace", { investigationId: "i", baseVersionId }), { code: "F002_REQUEST_LIST_LIMIT", status: 409 });
  assert.equal(calls.length, 10);
  service.resolver.authorizeRead = async () => { throw new Error("consumer read outage"); };
  await assert.rejects(service.list(owner, "workspace", { investigationId: "i", baseVersionId }), /consumer read outage/);
});

function profileWithCapabilities(capabilityIds) {
  const input = { ...profileInput, capabilityIds, ruleVersions: capabilityIds.map((capabilityId) => `${capabilityId}@1`) };
  return { ...input, id: createProfileId(input), startable: true };
}

async function expandableFixture(t) {
  const source = await candidateFixture(t, { git: true, entryPath: "openapi.json", content: '{"openapi":"3.0.0","paths":{"/orders":{"get":{"responses":{"200":{"description":"ok"}}}}}}\n' });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publications = new SourcePublicationService(source.repository, source.candidates);
  const confirmed = await publications.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publications.seal(owner, source.context, { confirmationId: confirmed.id, clientToken: "request-expansion-source" });
  const repository = new F002Repository(source.db, { authorize: (actor, workspaceId, tx, maintain) => source.repository.authorize(actor, workspaceId, maintain, tx) });
  const baseProfile = profileWithCapabilities(["javascript"]);
  const expandedProfile = profileWithCapabilities(["javascript", "json"]);
  await repository.registerProfile(baseProfile);
  await repository.registerProfile(expandedProfile);
  const admission = new F002AdmissionService(repository, new SourceAdmissionService(source.repository, source.candidates));
  const run = await admission.start(owner, "workspace", { operationId: "request-expansion-base", reference: { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id }, profile: baseProfile,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId: frozen.bundle.components[0].id }] }] });
  const worker = new F002Worker(repository, { admission });
  const ready = await worker.run(owner, "workspace", run.id, run.scopes[0].scopeId, { workerId: "request-expansion-base", leaseMs: 60_000, timeoutMs: 10_000 });
  const base = await new F002PublicationService(repository).publish(owner, "workspace", run.id, run.scopes[0].scopeId, { revision: ready.revision, operationId: "request-expansion-seal" });
  const materialId = (await source.db.query("SELECT id FROM f002_record WHERE workspace_id='workspace' AND graph_version_id=$1 AND kind='MATERIAL'", [base.graphVersionId])).rows[0].id;
  return { repository, sourceRepository: source.repository, admission, worker, base, baseRunId: run.id, materialId };
}

test("F002 request provider fails closed without a trusted consumer binding", async (t) => {
  const f = await fixture(t);
  await assert.rejects(new F002RequestService(f.repository).submit(owner, "workspace", request(f.graphVersionId, f.factId)), { code: "F002_CONSUMER_UNAVAILABLE", status: 503 });
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM f002_request")).rows[0].count, 0);
});

test("F002 provider persists a trusted investigation result idempotently without trusting request-body scope", async (t) => {
  const f = await fixture(t);
  const reads = [];
  const resolver = { resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.graphVersionId,
    state: "RUNNING", allowedFactIds: [f.factId], allowedMaterialIds: [f.materialId], allowedCapabilities: ["javascript"], budget: { maxMaterials: 1, maxBytes: 1024, maxRuleApplications: 1, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } }),
  authorizeRead: async (actor, workspaceId, investigationId, requestId) => {
    reads.push(actor.actorId);
    return actor.actorId === owner.actorId ? { workspaceId, investigationId, baseVersionId: f.graphVersionId, allowedRequestIds: [requestId] } : null;
  } };
  const requests = new F002RequestService(f.repository, { resolver });
  const queued = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId));
  assert.equal(queued.status, "QUEUED");
  const first = await requests.execute(owner, "workspace", queued.id, { workerId: "request-worker", leaseMs: 60_000 });
  assert.equal(first.status, "COMPLETED");
  assert.equal(first.outcome, "EXISTING_EVIDENCE");
  const recovered = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId));
  assert.equal(recovered.id, first.id);
  assert.equal((await requests.get(owner, "workspace", first.id)).id, first.id);
  await assert.rejects(requests.get(reader, "workspace", first.id), { code: "F002_CONSUMER_REJECTED" }, "Workspace read access does not replace investigation-result authorization");
  assert.deepEqual(reads, ["owner", "owner", "reader"]);
  await assert.rejects(requests.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: "out-of-scope", factRefs: ["not-authorized"] })), { code: "F002_CONSUMER_REJECTED" });
  const queuedMaterialOnly = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: "material-only", factRefs: [], materialRefs: [f.materialId] }));
  const materialOnly = await requests.execute(owner, "workspace", queuedMaterialOnly.id, { workerId: "request-worker", leaseMs: 60_000 });
  assert.equal(materialOnly.outcome, "LIMITATION", "an empty fact set cannot prove that a selected material already answers the investigation");
});

test("F002 reserves a trusted investigation budget once and turns exhaustion into a limitation", async (t) => {
  const f = await fixture(t);
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.graphVersionId,
      state: "RUNNING", allowedFactIds: [f.factId], allowedMaterialIds: [f.materialId], allowedCapabilities: ["javascript"],
      budget: { maxMaterials: 1, maxBytes: 1024, maxRuleApplications: 1, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.graphVersionId, allowedRequestIds: [requestId] }),
  };
  const requests = new F002RequestService(f.repository, { resolver });
  const first = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId));
  assert.equal((await requests.execute(owner, "workspace", first.id, { workerId: "budget-worker", leaseMs: 60_000 })).outcome, "EXISTING_EVIDENCE");
  const second = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: "request-2" }));
  const exhausted = await requests.execute(owner, "workspace", second.id, { workerId: "budget-worker", leaseMs: 60_000 });
  assert.equal(exhausted.status, "COMPLETED");
  assert.equal(exhausted.outcome, "LIMITATION");
  assert.deepEqual(exhausted.result, { code: "F002_REQUEST_BUDGET_EXHAUSTED", baseVersionId: f.graphVersionId });
  const account = await f.db.query("SELECT reserved_attempts,settled_attempts FROM f002_request_budget_account WHERE workspace_id=$1", ["workspace"]);
  assert.deepEqual(account.rows, [{ reserved_attempts: 0, settled_attempts: 1 }]);
});

test("F002 rejects changed binding cleanly and keeps one investigation budget across authorization snapshots", async (t) => {
  const f = await fixture(t);
  const binding = { investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.graphVersionId,
    state: "RUNNING", allowedFactIds: [f.factId], allowedMaterialIds: [f.materialId], allowedCapabilities: ["javascript"],
    budget: { maxMaterials: 1, maxBytes: 1024, maxRuleApplications: 1, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } };
  const resolver = {
    resolve: async (actor) => actor.actorId === owner.actorId ? binding : null,
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => actor.actorId === owner.actorId ? { workspaceId, investigationId, baseVersionId: f.graphVersionId, allowedRequestIds: [requestId] } : null,
  };
  const requests = new F002RequestService(f.repository, { resolver });
  const rejected = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: "changed-binding" }));
  binding.allowedCapabilities.push("json");
  const rejectedResult = await requests.execute(owner, "workspace", rejected.id, { workerId: "binding-worker", leaseMs: 60_000 });
  assert.deepEqual({ status: rejectedResult.status, outcome: rejectedResult.outcome }, { status: "COMPLETED", outcome: "REJECTED" });

  const first = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: "budget-first", requestedCapabilities: ["javascript"] }));
  assert.equal((await requests.execute(owner, "workspace", first.id, { workerId: "budget-worker", leaseMs: 60_000 })).outcome, "EXISTING_EVIDENCE");
  binding.allowedCapabilities.push("yaml");
  const second = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: "budget-second", requestedCapabilities: ["javascript"] }));
  const exhausted = await requests.execute(owner, "workspace", second.id, { workerId: "budget-worker", leaseMs: 60_000 });
  assert.deepEqual(exhausted.result, { code: "F002_REQUEST_BUDGET_EXHAUSTED", baseVersionId: f.graphVersionId });
  assert.deepEqual((await f.db.query("SELECT reserved_attempts,settled_attempts FROM f002_request_budget_account WHERE workspace_id='workspace'")).rows,
    [{ reserved_attempts: 0, settled_attempts: 1 }]);
});

test("F002 cancellation requires current investigation authorization, not only Workspace MAINTAIN", async (t) => {
  const f = await fixture(t);
  const resolver = {
    resolve: async (actor) => actor.actorId === owner.actorId ? { investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.graphVersionId,
      state: "RUNNING", allowedFactIds: [f.factId], allowedMaterialIds: [f.materialId], allowedCapabilities: ["javascript"],
      budget: { maxMaterials: 1, maxBytes: 1024, maxRuleApplications: 1, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } } : null,
    authorizeRead: async () => null,
  };
  const requests = new F002RequestService(f.repository, { resolver });
  const queued = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: "private-cancel" }));
  await f.sources.provision("workspace", { tenantId: "tenant", grants: [{ actorId: reader.actorId, role: "MAINTAIN" }] });
  await assert.rejects(requests.cancel(reader, "workspace", queued.id, { revision: queued.revision, operationId: "reader-cancel" }), { code: "F002_CONSUMER_REJECTED" });
});

test("F002 cancellation reconciliation rechecks current investigation access", async (t) => {
  const f = await fixture(t);
  let allowed = true;
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.graphVersionId,
      state: "RUNNING", allowedFactIds: [f.factId], allowedMaterialIds: [f.materialId], allowedCapabilities: ["javascript"],
      budget: { maxMaterials: 1, maxBytes: 1024, maxRuleApplications: 1, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => allowed && actor.actorId === owner.actorId
      ? { workspaceId, investigationId, baseVersionId: f.graphVersionId, allowedRequestIds: [requestId] } : null,
  };
  const requests = new F002RequestService(f.repository, { resolver });
  const queued = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId));
  await requests.cancel(owner, "workspace", queued.id, { revision: queued.revision, operationId: "lost-request-cancel" });
  const recovered = await requests.findByOperation(owner, "workspace", "lost-request-cancel");
  assert.equal(recovered?.id, queued.id, "cancellation keys must remain queryable independently of create keys");
  assert.equal(recovered.status, "CANCELLED");
  assert.equal(recovered.cancelOperationId, "lost-request-cancel");
  allowed = false;
  await assert.rejects(requests.findByOperation(owner, "workspace", "lost-request-cancel"), { code: "F002_CONSUMER_REJECTED" });
  assert.equal((await f.db.query("SELECT count(*)::int AS count FROM f002_request_event WHERE event_type='REQUEST_CANCELLED'")).rows[0].count, 1);
});

test("F002 cancellation fences a claimed request before its worker can settle a result", async (t) => {
  const f = await fixture(t);
  let resolving;
  let release;
  const started = new Promise((resolve) => { resolving = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  let resolveCalls = 0;
  const resolver = {
    resolve: async () => {
      resolveCalls += 1;
      if (resolveCalls === 2) {
        resolving();
        await released;
      }
      return { investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.graphVersionId,
        state: "RUNNING", allowedFactIds: [f.factId], allowedMaterialIds: [f.materialId], allowedCapabilities: ["javascript"],
        budget: { maxMaterials: 1, maxBytes: 1024, maxRuleApplications: 1, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } };
    },
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.graphVersionId, allowedRequestIds: [requestId] }),
  };
  const requests = new F002RequestService(f.repository, { resolver });
  const queued = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId));
  const executing = requests.execute(owner, "workspace", queued.id, { workerId: "late-request-worker", leaseMs: 60_000 });
  await started;
  const running = await requests.get(owner, "workspace", queued.id);
  const cancelled = await requests.cancel(owner, "workspace", queued.id, { revision: running.revision, operationId: "cancel-request" });
  assert.equal(cancelled.status, "CANCELLED");
  release();
  await assert.rejects(executing, { code: "F002_STALE_REQUEST_WORKER" });
  assert.equal((await requests.get(owner, "workspace", queued.id)).status, "CANCELLED");
});

test("F002 cancellation releases a reserved request and fences a late derivation result", async (t) => {
  const f = await fixture(t);
  let started;
  let release;
  const blocked = new Promise((resolve) => { started = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.graphVersionId,
      state: "RUNNING", allowedFactIds: [f.factId], allowedMaterialIds: [f.materialId], allowedCapabilities: ["json"],
      budget: { maxMaterials: 1, maxBytes: 1024, maxRuleApplications: 1, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.graphVersionId, allowedRequestIds: [requestId] }),
  };
  const expansion = {
    plan: async () => ({ kind: "DERIVE", usage: { materials: 1, bytes: 1, ruleApplications: 1, attempts: 1 } }),
    derive: async () => { started(); await released; return { kind: "NEW_VERSION", result: { baseVersionId: f.graphVersionId, graphVersionId: "c".repeat(64), addedRefs: [], correctedRefs: [] } }; },
  };
  const requests = new F002RequestService(f.repository, { resolver, expansion });
  const queued = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: "cancel-reserved", requestedCapabilities: ["json"] }));
  const executing = requests.execute(owner, "workspace", queued.id, { workerId: "cancel-reserved-worker", leaseMs: 60_000 });
  await blocked;
  const running = await requests.get(owner, "workspace", queued.id);
  assert.equal((await requests.cancel(owner, "workspace", queued.id, { revision: running.revision, operationId: "cancel-reserved-request" })).status, "CANCELLED");
  release();
  await assert.rejects(executing, { code: "F002_STALE_REQUEST_WORKER" });
  const reservation = await f.db.query("SELECT status FROM f002_request_budget_reservation WHERE request_id=$1", [queued.id]);
  assert.deepEqual(reservation.rows, [{ status: "RELEASED" }]);
  assert.equal((await requests.get(owner, "workspace", queued.id)).status, "CANCELLED");
});

test("F002 settles a reserved budget when an accepted derivation fails", async (t) => {
  const f = await fixture(t);
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.graphVersionId,
      state: "RUNNING", allowedFactIds: [f.factId], allowedMaterialIds: [f.materialId], allowedCapabilities: ["json"],
      budget: { maxMaterials: 1, maxBytes: 1024, maxRuleApplications: 1, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.graphVersionId, allowedRequestIds: [requestId] }),
  };
  const expansion = {
    plan: async () => ({ kind: "DERIVE", usage: { materials: 1, bytes: 17, ruleApplications: 1, attempts: 1 } }),
    derive: async () => { throw new Error("synthetic deterministic worker failure"); },
  };
  const requests = new F002RequestService(f.repository, { resolver, expansion });
  const queued = await requests.submit(owner, "workspace", request(f.graphVersionId, f.factId, { operationId: "settle-failed", requestedCapabilities: ["json"] }));
  const failed = await requests.execute(owner, "workspace", queued.id, { workerId: "settle-failed-worker", leaseMs: 60_000 });
  assert.equal(failed.status, "FAILED");
  const account = await f.db.query("SELECT reserved_attempts,settled_attempts FROM f002_request_budget_account WHERE workspace_id='workspace'");
  assert.deepEqual(account.rows, [{ reserved_attempts: 0, settled_attempts: 1 }]);
  assert.deepEqual((await f.db.query("SELECT status FROM f002_request_budget_reservation WHERE request_id=$1", [queued.id])).rows, [{ status: "SETTLED" }]);
});

test("F002 request produces and returns an independently sealed NEW_VERSION without advancing its base version", async (t) => {
  const f = await expandableFixture(t);
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.base.graphVersionId,
      state: "RUNNING", allowedFactIds: [], allowedMaterialIds: [f.materialId], allowedCapabilities: ["json"],
      budget: { maxMaterials: 1, maxBytes: 16_384, maxRuleApplications: 2, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.base.graphVersionId, allowedRequestIds: [requestId] }),
  };
  const requests = new F002RequestService(f.repository, {
    resolver,
    expansion: new F002RequestDerivationService({ repository: f.repository, admission: f.admission, worker: f.worker, publication: new F002PublicationService(f.repository) }),
  });
  const queued = await requests.submit(owner, "workspace", request(f.base.graphVersionId, "unused", {
    operationId: "request-new-version", factRefs: [], materialRefs: [f.materialId], requestedCapabilities: ["json"],
  }));
  const completed = await requests.execute(owner, "workspace", queued.id, { workerId: "request-new-version", leaseMs: 60_000 });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.outcome, "NEW_VERSION");
  assert.equal(completed.result.baseVersionId, f.base.graphVersionId);
  assert.notEqual(completed.result.graphVersionId, f.base.graphVersionId);
  assert.equal((await f.repository.getRun(owner, "workspace", f.baseRunId)).scopes[0].graphVersionId, f.base.graphVersionId, "the prior sealed scope remains immutable and selected by the original investigation");
  const budget = await f.repository.database.query(`SELECT reserved_materials,reserved_bytes,reserved_rule_applications,reserved_attempts,
    settled_materials,settled_bytes,settled_rule_applications,settled_attempts
    FROM f002_request_budget_account WHERE workspace_id='workspace'`);
  assert.deepEqual(budget.rows.map((row) => ({ ...row, settled_bytes: Number(row.settled_bytes), reserved_bytes: Number(row.reserved_bytes) })), [{
    reserved_materials: 0, reserved_bytes: 0, reserved_rule_applications: 0, reserved_attempts: 0,
    settled_materials: 1, settled_bytes: Buffer.byteLength('{"openapi":"3.0.0","paths":{"/orders":{"get":{"responses":{"200":{"description":"ok"}}}}}}\n', "utf8"), settled_rule_applications: 1, settled_attempts: 1,
  }]);
});

test("F002 revalidates a consumer investigation at the derived publication fence", async (t) => {
  const f = await expandableFixture(t);
  let consumerState = "RUNNING";
  const publisher = new F002PublicationService(f.repository);
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.base.graphVersionId, state: consumerState,
      allowedFactIds: [], allowedMaterialIds: [f.materialId], allowedCapabilities: ["json"],
      budget: { maxMaterials: 1, maxBytes: 16_384, maxRuleApplications: 2, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.base.graphVersionId, allowedRequestIds: [requestId] }),
  };
  const publication = { publish: async (...args) => { consumerState = "STOPPED"; return publisher.publish(...args); } };
  const requests = new F002RequestService(f.repository, {
    resolver,
    expansion: new F002RequestDerivationService({ repository: f.repository, admission: f.admission, worker: f.worker, publication }),
  });
  const queued = await requests.submit(owner, "workspace", request(f.base.graphVersionId, "unused", {
    operationId: "stopped-before-seal", factRefs: [], materialRefs: [f.materialId], requestedCapabilities: ["json"],
  }));
  const result = await requests.execute(owner, "workspace", queued.id, { workerId: "stopped-before-seal", leaseMs: 60_000 });
  assert.equal(result.outcome, "REJECTED");
  assert.equal((await f.repository.database.query("SELECT count(*)::int AS count FROM f002_fact_set WHERE workspace_id='workspace'")).rows[0].count, 1);
  assert.equal((await f.repository.getScope(owner, "workspace", result.derivedRunId, result.derivedScopeId)).status, "CANCELLED",
    "a rejected request must cancel its linked derived scope rather than leave it sealable by another route");
});

test("F002 does not let the ordinary seal route publish a request-owned derived scope", async (t) => {
  const f = await expandableFixture(t);
  const publisher = new F002PublicationService(f.repository);
  let ordinarySealError = null;
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.base.graphVersionId,
      state: "RUNNING", allowedFactIds: [], allowedMaterialIds: [f.materialId], allowedCapabilities: ["json"],
      budget: { maxMaterials: 1, maxBytes: 16_384, maxRuleApplications: 2, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.base.graphVersionId, allowedRequestIds: [requestId] }),
  };
  const publication = {
    publish: async (...args) => {
      const [actor, workspaceId, runId, scopeId, options] = args;
      await assert.rejects(publisher.publish(actor, workspaceId, runId, scopeId, {
        revision: options.revision, operationId: "ordinary-derived-seal",
      }), (error) => {
        ordinarySealError = error;
        return error.code === "F002_REQUEST_GUARD_REQUIRED";
      });
      return publisher.publish(...args);
    },
  };
  const requests = new F002RequestService(f.repository, {
    resolver,
    expansion: new F002RequestDerivationService({ repository: f.repository, admission: f.admission, worker: f.worker, publication }),
  });
  const queued = await requests.submit(owner, "workspace", request(f.base.graphVersionId, "unused", {
    operationId: "ordinary-derived-seal-request", factRefs: [], materialRefs: [f.materialId], requestedCapabilities: ["json"],
  }));
  const completed = await requests.execute(owner, "workspace", queued.id, { workerId: "ordinary-derived-seal", leaseMs: 60_000 });
  assert.equal(ordinarySealError?.code, "F002_REQUEST_GUARD_REQUIRED");
  assert.equal(completed.outcome, "NEW_VERSION");
  assert.equal((await f.repository.database.query("SELECT count(*)::int AS count FROM f002_fact_set WHERE workspace_id='workspace'")).rows[0].count, 2,
    "only the request-owned guarded seal may create the derived version");
});

test("F002 treats a deadline reached after reserve as a limitation before derived publication", async (t) => {
  const f = await expandableFixture(t);
  const publisher = new F002PublicationService(f.repository);
  const originalNow = Date.now;
  const deadline = new Date(originalNow() + 30_000).toISOString();
  t.after(() => { Date.now = originalNow; });
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.base.graphVersionId,
      state: "RUNNING", allowedFactIds: [], allowedMaterialIds: [f.materialId], allowedCapabilities: ["json"],
      budget: { maxMaterials: 1, maxBytes: 16_384, maxRuleApplications: 2, maximumAttempts: 1, deadline } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.base.graphVersionId, allowedRequestIds: [requestId] }),
  };
  const publication = {
    publish: async (...args) => {
      Date.now = () => Date.parse(deadline) + 1;
      return publisher.publish(...args);
    },
  };
  const requests = new F002RequestService(f.repository, {
    resolver,
    expansion: new F002RequestDerivationService({ repository: f.repository, admission: f.admission, worker: f.worker, publication }),
  });
  const queued = await requests.submit(owner, "workspace", request(f.base.graphVersionId, "unused", {
    operationId: "deadline-after-reserve", factRefs: [], materialRefs: [f.materialId], requestedCapabilities: ["json"],
  }));
  const result = await requests.execute(owner, "workspace", queued.id, { workerId: "deadline-after-reserve", leaseMs: 60_000 });
  assert.deepEqual({ status: result.status, outcome: result.outcome, result: result.result }, {
    status: "COMPLETED", outcome: "LIMITATION", result: { code: "F002_REQUEST_BUDGET_DEADLINE_EXCEEDED", baseVersionId: f.base.graphVersionId },
  });
  assert.equal((await f.repository.database.query("SELECT count(*)::int AS count FROM f002_fact_set WHERE workspace_id='workspace'")).rows[0].count, 1);
});

test("F002 rechecks a request deadline after waiting for the derived scope lock", async (t) => {
  const f = await expandableFixture(t);
  const publisher = new F002PublicationService(f.repository);
  const originalNow = Date.now;
  const deadline = new Date(originalNow() + 30_000).toISOString();
  t.after(() => { Date.now = originalNow; });
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.base.graphVersionId,
      state: "RUNNING", allowedFactIds: [], allowedMaterialIds: [f.materialId], allowedCapabilities: ["json"],
      budget: { maxMaterials: 1, maxBytes: 16_384, maxRuleApplications: 2, maximumAttempts: 1, deadline } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.base.graphVersionId, allowedRequestIds: [requestId] }),
  };
  let crossedDeadline = false;
  const timedRepository = {
    withAuthorizedWorkspace: f.repository.withAuthorizedWorkspace.bind(f.repository),
    withMaintainedWorkspace: (actor, workspaceId, callback) => f.repository.withMaintainedWorkspace(actor, workspaceId, (tx) => callback({
      query: async (sql, params) => {
        const result = await tx.query(sql, params);
        if (!crossedDeadline && sql.startsWith("SELECT * FROM f002_scope WHERE") && sql.endsWith("FOR UPDATE")) {
          crossedDeadline = true;
          Date.now = () => Date.parse(deadline) + 1;
        }
        return result;
      },
    })),
  };
  const requests = new F002RequestService(f.repository, {
    resolver,
    expansion: new F002RequestDerivationService({ repository: f.repository, admission: f.admission, worker: f.worker, publication: new F002PublicationService(timedRepository) }),
  });
  const queued = await requests.submit(owner, "workspace", request(f.base.graphVersionId, "unused", {
    operationId: "deadline-after-scope-lock", factRefs: [], materialRefs: [f.materialId], requestedCapabilities: ["json"],
  }));
  const result = await requests.execute(owner, "workspace", queued.id, { workerId: "deadline-after-scope-lock", leaseMs: 60_000 });
  const scope = await f.repository.getScope(owner, "workspace", result.derivedRunId, result.derivedScopeId);
  assert.equal(crossedDeadline, true);
  assert.deepEqual({ status: result.status, outcome: result.outcome, result: result.result }, {
    status: "COMPLETED", outcome: "LIMITATION", result: { code: "F002_REQUEST_BUDGET_DEADLINE_EXCEEDED", baseVersionId: f.base.graphVersionId },
  });
  assert.equal(scope.status, "CANCELLED");
  assert.equal((await f.repository.database.query("SELECT count(*)::int AS count FROM f002_fact_set WHERE workspace_id='workspace'")).rows[0].count, 1,
    "a deadline crossed while waiting for the scope lock must roll back the derived FactSet");
});

test("F002 classifies a deadline crossed inside the final derived seal as a limitation", async (t) => {
  const f = await expandableFixture(t);
  const deadline = new Date(Date.now() + 5_000).toISOString();
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.base.graphVersionId,
      state: "RUNNING", allowedFactIds: [], allowedMaterialIds: [f.materialId], allowedCapabilities: ["json"],
      budget: { maxMaterials: 1, maxBytes: 16_384, maxRuleApplications: 2, maximumAttempts: 1, deadline } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.base.graphVersionId, allowedRequestIds: [requestId] }),
  };
  let delayedFinalSeal = false;
  const timedRepository = {
    withAuthorizedWorkspace: f.repository.withAuthorizedWorkspace.bind(f.repository),
    withMaintainedWorkspace: (actor, workspaceId, callback) => f.repository.withMaintainedWorkspace(actor, workspaceId, (tx) => callback({
      query: async (sql, params) => {
        if (!delayedFinalSeal && sql.startsWith("UPDATE f002_scope AS scope SET")) {
          delayedFinalSeal = true;
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(deadline) + 100 - Date.now())));
        }
        return tx.query(sql, params);
      },
    })),
  };
  const requests = new F002RequestService(f.repository, {
    resolver,
    expansion: new F002RequestDerivationService({ repository: f.repository, admission: f.admission, worker: f.worker, publication: new F002PublicationService(timedRepository) }),
  });
  const queued = await requests.submit(owner, "workspace", request(f.base.graphVersionId, "unused", {
    operationId: "deadline-inside-final-seal", factRefs: [], materialRefs: [f.materialId], requestedCapabilities: ["json"],
  }));
  const result = await requests.execute(owner, "workspace", queued.id, { workerId: "deadline-inside-final-seal", leaseMs: 60_000 });
  const scope = await f.repository.getScope(owner, "workspace", result.derivedRunId, result.derivedScopeId);
  assert.equal(delayedFinalSeal, true);
  assert.deepEqual({ status: result.status, outcome: result.outcome, result: result.result }, {
    status: "COMPLETED", outcome: "LIMITATION", result: { code: "F002_REQUEST_BUDGET_DEADLINE_EXCEEDED", baseVersionId: f.base.graphVersionId },
  });
  assert.equal(scope.status, "CANCELLED");
  assert.equal((await f.repository.database.query("SELECT count(*)::int AS count FROM f002_fact_set WHERE workspace_id='workspace'")).rows[0].count, 1,
    "a deadline crossed in the final seal SQL must roll back the derived FactSet");
});

test("F002 refuses generic scope cancellation for a request-owned derived scope", async (t) => {
  const f = await expandableFixture(t);
  await f.sourceRepository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: reader.actorId, role: "MAINTAIN" }] });
  const publisher = new F002PublicationService(f.repository);
  const resolver = {
    resolve: async (actor) => actor.actorId === owner.actorId ? ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.base.graphVersionId,
      state: "RUNNING", allowedFactIds: [], allowedMaterialIds: [f.materialId], allowedCapabilities: ["json"],
      budget: { maxMaterials: 1, maxBytes: 16_384, maxRuleApplications: 2, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } }) : null,
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.base.graphVersionId, allowedRequestIds: [requestId] }),
  };
  let requests;
  let queued;
  let genericCancelError;
  const guardedPublisher = {
    publish: async (...args) => {
      const [, workspaceId, runId, scopeId, options] = args;
      await assert.rejects(requests.cancel(reader, workspaceId, queued.id, { revision: (await requests.get(owner, workspaceId, queued.id)).revision, operationId: "reader-request-cancel" }),
        { code: "F002_CONSUMER_REJECTED" });
      await assert.rejects(f.repository.claimScope(reader, workspaceId, runId, scopeId, {
        workerId: "reader-derived-worker", leaseMs: 60_000,
      }), { code: "F002_REQUEST_SCOPE_OWNED" });
      await assert.rejects(f.repository.cancelScope(reader, workspaceId, runId, scopeId, { revision: options.revision, operationId: "reader-generic-scope-cancel" }),
        (error) => { genericCancelError = error; return error?.code === "F002_REQUEST_SCOPE_OWNED"; });
      await assert.rejects(f.repository.retryScope(reader, workspaceId, runId, scopeId, { revision: options.revision, operationId: "reader-generic-scope-retry" }),
        { code: "F002_REQUEST_SCOPE_OWNED" });
      await assert.rejects(f.repository.sealScope(reader, workspaceId, runId, scopeId, {
        revision: options.revision, operationId: "reader-generic-scope-seal", graphVersionId: "c".repeat(64),
      }), { code: "F002_REQUEST_SCOPE_OWNED" });
      return publisher.publish(...args);
    },
  };
  requests = new F002RequestService(f.repository, {
    resolver,
    expansion: new F002RequestDerivationService({ repository: f.repository, admission: f.admission, worker: f.worker, publication: guardedPublisher }),
  });
  queued = await requests.submit(owner, "workspace", request(f.base.graphVersionId, "unused", {
    operationId: "generic-derived-cancel", factRefs: [], materialRefs: [f.materialId], requestedCapabilities: ["json"],
  }));
  const result = await requests.execute(owner, "workspace", queued.id, { workerId: "generic-derived-cancel", leaseMs: 60_000 });
  assert.equal(genericCancelError?.code, "F002_REQUEST_SCOPE_OWNED");
  assert.equal(result.outcome, "NEW_VERSION");
});

test("F002 cancellation fences a real derived scope before its delayed publication", async (t) => {
  const f = await expandableFixture(t);
  let arrived;
  let release;
  const publishing = new Promise((resolve) => { arrived = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  const publication = new F002PublicationService(f.repository);
  const blockingPublication = {
    publish: async (...args) => {
      arrived();
      await released;
      return publication.publish(...args);
    },
  };
  const resolver = {
    resolve: async () => ({ investigationId: "investigation-1", workspaceId: "workspace", baseVersionId: f.base.graphVersionId,
      state: "RUNNING", allowedFactIds: [], allowedMaterialIds: [f.materialId], allowedCapabilities: ["json"],
      budget: { maxMaterials: 1, maxBytes: 16_384, maxRuleApplications: 2, maximumAttempts: 1, deadline: "2099-01-01T00:00:00.000Z" } }),
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => ({ workspaceId, investigationId, baseVersionId: f.base.graphVersionId, allowedRequestIds: [requestId] }),
  };
  const requests = new F002RequestService(f.repository, {
    resolver,
    expansion: new F002RequestDerivationService({ repository: f.repository, admission: f.admission, worker: f.worker, publication: blockingPublication }),
  });
  const queued = await requests.submit(owner, "workspace", request(f.base.graphVersionId, "unused", {
    operationId: "cancel-real-derived", factRefs: [], materialRefs: [f.materialId], requestedCapabilities: ["json"],
  }));
  const executing = requests.execute(owner, "workspace", queued.id, { workerId: "cancel-real-derived", leaseMs: 60_000 });
  await publishing;
  const running = await requests.get(owner, "workspace", queued.id);
  await requests.cancel(owner, "workspace", queued.id, { revision: running.revision, operationId: "cancel-real-derived-request" });
  release();
  await assert.rejects(executing, { code: "F002_STALE_REQUEST_WORKER" });
  assert.equal((await requests.get(owner, "workspace", queued.id)).status, "CANCELLED");
  assert.equal((await f.repository.database.query("SELECT count(*)::int AS count FROM f002_fact_set WHERE workspace_id='workspace'")) .rows[0].count, 1,
    "a cancelled request must fence the derived scope before it can publish a new FactSet");
});
