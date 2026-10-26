import assert from "node:assert/strict";
import test from "node:test";
import { InvestigationService } from "../src/business-knowledge/investigation-service.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { F002AdmissionService } from "../src/deterministic-facts/admission.js";
import { F002Worker } from "../src/deterministic-facts/worker.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { F002RequestService, F002RequestDerivationService } from "../src/deterministic-facts/request-service.js";
import { createProfileId } from "../src/deterministic-facts/identity.js";

const profile = { id: "profile-v1", workspaceId: "workspace", mainAgentSlot: { id: "main", role: "MAIN", modelProfileRevisionId: "model-v1", mcpGrants: [] },
  childAgentSlots: [{ id: "child-1", role: "CHILD", modelProfileRevisionId: "model-v1", mcpGrants: [] }],
  entries: [{ kind: "MODEL", logicalName: "model-v1", manifest: { transport: "CLI", cliAdapter: "CODEX", model: "test-model" } }] };

async function fixture(t, options = {}) {
  const source = await candidateFixture(t, { entryPath: "business.md", content: "用户可以取消未支付的订单。", ...options });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publication.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const sealed = await publication.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "f003-source" });
  const reference = { bundleId: sealed.bundle.id, receiptId: sealed.receipt.id };
  const sourceAdmission = new SourceAdmissionService(source.repository, source.candidates);
  // Only F006 configuration resolution is a test double here. All source
  // bytes, admission, SQL persistence, ACL and lifecycle calls are real.
  const profiles = { resolveActive: async () => structuredClone(profile), assertUsable: async () => {} };
  const service = new InvestigationService({ sources: source.repository, sourceAdmission, profiles });
  const request = { operationId: "investigate-1", reference, expectedProfileId: profile.id, question: "取消订单有哪些规则？", technicalVersionId: null,
    scope: { componentIds: sealed.bundle.components.map(c => c.id) },
    budget: { maxReadBytes: 8192, maxModelCalls: 5, deadline: "2099-01-01T00:00:00Z" },
    supplementBudget: { maxMaterials: 10, maxBytes: 8192, maxRuleApplications: 50, maximumAttempts: 3, deadline: "2099-01-01T00:00:00Z" } };
  return { ...source, sourceAdmission, profiles, service, request, reference };
}

test("F003 persists independently admitted raw-source investigation and can read materials with no F002 facts", async t => {
  const f = await fixture(t);
  const run = await f.service.start(owner, "workspace", f.request);
  assert.equal(run.state, "QUEUED");
  assert.equal(run.actorId, owner.actorId);
  assert.equal(run.sourceInput.sourceBundleSnapshotId, f.reference.bundleId);
  assert.equal(run.profile.id, profile.id);
  assert.equal(run.technicalVersionId, null);
  assert.equal((await f.service.start(owner, "workspace", f.request)).id, run.id);
  const recovered = new InvestigationService({ sources: f.repository, sourceAdmission: f.sourceAdmission, profiles: f.profiles });
  assert.equal((await recovered.get(owner, "workspace", run.id)).id, run.id);
  const claimed = await recovered.claim(owner, "workspace", run.id, { workerId: "worker-1", leaseMs: 60_000 });
  const inventory = await recovered.inventory(owner, "workspace", run.id, { limit: 100 });
  assert.equal(inventory.items.length, 1);
  const material = await recovered.readMaterial(owner, "workspace", run.id, { componentId: inventory.items[0].componentId, pathBytes: f.entry.pathBytes }, { generation: claimed.generation });
  assert.equal(material.bytes.toString("utf8"), "用户可以取消未支付的订单。");
  assert.equal(material.sourceMaterial.bundleId, f.reference.bundleId);
  assert.equal("receiptId" in material.sourceMaterial, false);
  assert.equal((await recovered.get(owner, "workspace", run.id)).usage.readBytes, f.bytes.length);
});

test("F003 client cannot forge qualified inputs or silently switch confirmed configuration", async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.start(owner, "workspace", { ...f.request, sourceInput: {} }), { code: "F003_INPUT_INVALID" });
  await assert.rejects(f.service.start(owner, "workspace", { ...f.request, expectedProfileId: "old" }), { code: "F003_PROFILE_CONFLICT" });
  const run = await f.service.start(owner, "workspace", f.request);
  await assert.rejects(f.service.start(owner, "workspace", { ...f.request, question: "different" }), { code: "F003_OPERATION_CONFLICT" });
  assert.equal((await f.service.get(owner, "workspace", run.id)).question, f.request.question);
  await assert.rejects(f.service.get(reader, "workspace", run.id), { code: "F003_INVESTIGATION_FORBIDDEN" });
  await assert.rejects(f.service.get(owner, "workspace2", run.id), { status: 403 });
});

test("F003 pause/resume increments generation and preserves cumulative read budget", async t => {
  const f = await fixture(t);
  const run = await f.service.start(owner, "workspace", { ...f.request, budget: { ...f.request.budget, maxReadBytes: f.bytes.length } });
  const old = await f.service.claim(owner, "workspace", run.id, { workerId: "old", leaseMs: 60_000 });
  const locator = { componentId: run.scope.componentIds[0], pathBytes: f.entry.pathBytes };
  await f.service.readMaterial(owner, "workspace", run.id, locator, { generation: old.generation });
  await f.service.control(owner, "workspace", run.id, { action: "PAUSE", expectedRevision: (await f.service.get(owner, "workspace", run.id)).revision });
  await assert.rejects(f.service.checkpoint(owner, "workspace", run.id, { generation: old.generation, key: "late", payload: {} }), { code: "F003_STALE_WORKER" });
  const paused = await f.service.get(owner, "workspace", run.id);
  await f.service.control(owner, "workspace", run.id, { action: "RESUME", expectedRevision: paused.revision });
  const current = await f.service.claim(owner, "workspace", run.id, { workerId: "new", leaseMs: 60_000 });
  assert(current.generation > old.generation);
  await assert.rejects(f.service.readMaterial(owner, "workspace", run.id, locator, { generation: current.generation }), { code: "F003_BUDGET_EXCEEDED" });
  const stopped = await f.service.control(owner, "workspace", run.id, { action: "CANCEL", expectedRevision: (await f.service.get(owner, "workspace", run.id)).revision });
  assert.equal(stopped.state, "CANCELLED");
  await assert.rejects(f.service.checkpoint(owner, "workspace", run.id, { generation: current.generation, key: "late", payload: {} }), { code: "F003_STALE_WORKER" });
});

test("F003 no technical baseline cannot authorize C03; raw material access still rechecks current ACL", async t => {
  const f = await fixture(t);
  const run = await f.service.start(owner, "workspace", f.request);
  await f.service.claim(owner, "workspace", run.id, { workerId: "worker", leaseMs: 60_000 });
  await assert.rejects(f.service.resolve(owner, "workspace", run.id), { code: "F003_TECHNICAL_BASELINE_REQUIRED" });
  await f.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: owner.actorId, role: "REVOKED" }] });
  await assert.rejects(f.service.inventory(owner, "workspace", run.id, { limit: 100 }), { status: 403 });
});

test("F003 deadline expiration is durable and fences every old generation", async t => {
  const f = await fixture(t), run = await f.service.start(owner, "workspace", f.request);
  const claimed = await f.service.claim(owner, "workspace", run.id, { workerId: "old" });
  await f.db.query("UPDATE f003_investigation SET payload=jsonb_set(payload,'{budget,deadline}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE workspace_id=$1 AND id=$2", ["workspace", run.id]);
  const expired = await f.service.expire(owner, "workspace", run.id);
  assert.equal(expired.state, "FAILED");
  assert.equal(expired.lastFailure.code, "F003_DEADLINE_EXCEEDED");
  assert.ok(expired.generation > claimed.generation);
  await assert.rejects(f.service.checkpoint(owner, "workspace", run.id, { generation: claimed.generation, key: "late", payload: {} }), { code: "F003_STALE_WORKER" });
  assert.equal((await f.service.expire(owner, "workspace", run.id)).generation, expired.generation);
});

async function technicalFixture(t, options = {}) {
  const f = await fixture(t, { entryPath: "orders.js", content: "export function cancel(order) { return order.status === 'UNPAID'; }", ...options });
  const repository = new F002Repository(f.db, { authorize: (actor, workspaceId, tx, maintain) => f.repository.authorize(actor, workspaceId, maintain, tx) });
  const profileInput = { version: "1", schemaVersion: 1, capabilityIds: ["javascript"], ruleVersions: ["javascript@1"], canonicalizationVersion: "1",
    extractionLimits: { maxBytes: 8192, maxRecords: 1000 }, redactionPolicyRevision: "policy-v1" };
  const extractionProfile = { ...profileInput, id: createProfileId(profileInput), startable: true };
  await repository.registerProfile(extractionProfile);
  const admission = new F002AdmissionService(repository, f.sourceAdmission);
  const run = await admission.start(owner, "workspace", { operationId: "f003-reference", reference: f.reference, profile: extractionProfile,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId: f.request.scope.componentIds[0] }] }] });
  const worker = new F002Worker(repository, { admission });
  const scope = await worker.run(owner, "workspace", run.id, run.scopes[0].scopeId, { workerId: "extractor", leaseMs: 60000, timeoutMs: 10000 });
  const published = await new F002PublicationService(repository).publish(owner, "workspace", run.id, scope.scopeId, { revision: scope.revision, operationId: "f003-reference-publish" });
  const facts = (await f.db.query("SELECT id FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='FACT' ORDER BY id", ["workspace", published.graphVersionId])).rows;
  return { ...f, factId: facts[0]?.id ?? null, versionId: published.graphVersionId, facts: repository, extractionProfile, admission, worker };
}

test("F003 real persisted resolver drives F002 supplementation and individually authorized historical result reads", async t => {
  const f = await technicalFixture(t);
  const investigation = await f.service.start(owner, "workspace", { ...f.request, technicalVersionId: f.versionId });
  await f.service.claim(owner, "workspace", investigation.id, { workerId: "business-worker", leaseMs: 60000 });
  const resolver = new InvestigationService({ sources: f.repository, sourceAdmission: f.sourceAdmission, profiles: f.profiles });
  const provider = new F002RequestService(f.facts, { resolver });
  const request = await provider.submit(owner, "workspace", { operationId: "supplement-1", investigationId: investigation.id,
    baseVersionId: f.versionId, requestKind: "LOOKUP", question: "取消订单有哪些静态依据？", factRefs: [f.factId], materialRefs: [], requestedCapabilities: [] });
  const result = await provider.execute(owner, "workspace", request.id, { workerId: "supplement-worker", leaseMs: 60000 });
  assert.equal(result.outcome, "EXISTING_EVIDENCE");
  const run = await resolver.get(owner, "workspace", investigation.id);
  await resolver.control(owner, "workspace", run.id, { action: "CANCEL", expectedRevision: run.revision });
  assert.equal((await provider.get(owner, "workspace", request.id)).id, request.id, "stopping does not erase authorized historical results");
  await assert.rejects(provider.get(reader, "workspace", request.id), { code: "F003_INVESTIGATION_FORBIDDEN" });
  await assert.rejects(resolver.authorizeRead(owner, "workspace", investigation.id, "invented"), { code: "F003_REQUEST_FORBIDDEN" });
  await assert.rejects(provider.submit(owner, "workspace", { operationId: "late-request", investigationId: investigation.id,
    baseVersionId: f.versionId, requestKind: "LOOKUP", question: "late", factRefs: [f.factId], materialRefs: [], requestedCapabilities: [] }), { code: "F003_STALE_WORKER" });
});

test("F003 explicit technical adoption requires a real supplement receipt and invalidates older execution generations", async t => {
  const f = await technicalFixture(t, { entryPath: "openapi.json", content: '{"openapi":"3.0.0","paths":{"/orders":{"get":{"responses":{"200":{"description":"ok"}}}}}}' });
  const { id: _id, startable: _ready, ...baseProfile } = f.extractionProfile;
  const input = { ...baseProfile, capabilityIds: ["javascript", "json"], ruleVersions: ["javascript@1", "json@1"] };
  await f.facts.registerProfile({ ...input, id: createProfileId(input), startable: true });
  const run = await f.service.start(owner, "workspace", { ...f.request, technicalVersionId: f.versionId });
  const claimed = await f.service.claim(owner, "workspace", run.id, { workerId: "business-worker", leaseMs: 60000 });
  await assert.rejects(f.service.adoptTechnicalVersion(owner, "workspace", run.id, { requestId: "invented", versionId: f.versionId,
    expectedRevision: claimed.revision }), { code: "F003_ADOPTION_UNPROVEN" });
  const provider = new F002RequestService(f.facts, { resolver: f.service,
    expansion: new F002RequestDerivationService({ repository: f.facts, admission: f.admission, worker: f.worker, publication: new F002PublicationService(f.facts) }) });
  const binding = await f.service.resolve(owner, "workspace", run.id);
  const request = await provider.submit(owner, "workspace", { operationId: "expand-json", investigationId: run.id, baseVersionId: f.versionId,
    requestKind: "CAPABILITY_EXPANSION", question: "补查JSON接口结构", factRefs: [], materialRefs: binding.allowedMaterialIds, requestedCapabilities: ["json"] });
  const result = await provider.execute(owner, "workspace", request.id, { workerId: "expander", leaseMs: 60000 });
  assert.equal(result.outcome, "NEW_VERSION");
  assert.deepEqual((await f.service.get(owner, "workspace", run.id)).adoptedVersionIds, [f.versionId], "supplement completion alone does not adopt");
  // The historical record has a REAL completed NEW_VERSION receipt, so a
  // denial cannot be attributed to forged/nonexistent evidence instead.
  for(const state of ['PAUSED','QUEUED'])for(const version of [null,9,10,11]) {
    await f.db.query(`UPDATE f003_investigation SET state=$2,payload=CASE WHEN $3::integer IS NULL THEN payload-'analysisContractVersion'
      ELSE jsonb_set(payload,'{analysisContractVersion}',to_jsonb($3::integer)) END WHERE id=$1`,[run.id,state,version]);
    const old=await f.service.get(owner,'workspace',run.id),events=await f.service.events(owner,'workspace',run.id);
    await assert.rejects(f.service.adoptTechnicalVersion(owner,'workspace',run.id,{requestId:request.id,versionId:result.result.graphVersionId,
      expectedRevision:old.revision}),{code:'F003_ANALYSIS_CONTRACT_CHANGED'});
    assert.deepEqual(await f.service.get(owner,'workspace',run.id),old);
    assert.deepEqual(await f.service.events(owner,'workspace',run.id),events);
    assert.equal((await f.service.start(owner,'workspace',{...f.request,technicalVersionId:f.versionId})).id,run.id);
  }
  await f.db.query("UPDATE f003_investigation SET state='RUNNING',payload=jsonb_set(payload,'{analysisContractVersion}','12') WHERE id=$1",[run.id]);
  const adopted = await f.service.adoptTechnicalVersion(owner, "workspace", run.id, { requestId: request.id,
    versionId: result.result.graphVersionId, expectedRevision: (await f.service.get(owner, "workspace", run.id)).revision });
  assert(adopted.adoptedVersionIds.includes(result.result.graphVersionId));
  assert.equal(adopted.technicalVersionId, f.versionId, "original budget account baseline remains fixed");
  assert.equal(adopted.state, "QUEUED");
  await assert.rejects(f.service.checkpoint(owner, "workspace", run.id, { generation: claimed.generation, key: "late", payload: {} }), { code: "F003_STALE_WORKER" });
});

test("F003 model-call budget and worker lease survive recovery without accepting a substituted Agent", async t => {
  const f = await fixture(t);
  const run = await f.service.start(owner, "workspace", { ...f.request, budget: { ...f.request.budget, maxModelCalls: 1 } });
  const claimed = await f.service.claim(owner, "workspace", run.id, { workerId: "worker", leaseMs: 1000 });
  await assert.rejects(f.service.reserveModelCall(owner, "workspace", run.id, { generation: claimed.generation, slotId: "invented", taskKey: "fake" }), { code: "F003_AGENT_FORBIDDEN" });
  const call = await f.service.reserveModelCall(owner, "workspace", run.id, { generation: claimed.generation, slotId: "child-1", taskKey: "investigate" });
  assert.equal(call.profile.id, profile.id);
  assert.equal(call.slot.modelProfileRevisionId, "model-v1");
  await assert.rejects(f.service.reserveModelCall(owner, "workspace", run.id, { generation: claimed.generation, slotId: "main", taskKey: "review" }), { code: "F003_BUDGET_EXCEEDED" });
  await f.service.heartbeat(owner, "workspace", run.id, { generation: claimed.generation, leaseMs: 60000 });
  await f.db.query("UPDATE f003_investigation SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [run.id]);
  const recovered = await f.service.claim(owner, "workspace", run.id, { workerId: "restarted", leaseMs: 60000 });
  assert(recovered.generation > claimed.generation);
  assert.equal(recovered.usage.modelCalls, 1);
  await assert.rejects(f.service.checkpoint(owner, "workspace", run.id, { generation: claimed.generation, key: "late-model", payload: {} }), { code: "F003_STALE_WORKER" });
});
