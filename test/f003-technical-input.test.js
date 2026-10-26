import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { owner } from "./support/source-truth-database.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { F002AdmissionService } from "../src/deterministic-facts/admission.js";
import { F002Worker } from "../src/deterministic-facts/worker.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { boundedF002Profile } from "../src/deterministic-facts/runtime.js";
import { InvestigationWorker } from "../src/business-knowledge/worker.js";
import { canonicalEncode } from "../src/source-truth/identity.js";

async function fixture(t) {
  const f = await investigationFixture(t, { entryPath: "orders.js", content: "export function validateOrder() { return true; } export function approveOrder() { return validateOrder(); }" });
  const facts = new F002Repository(f.db, { authorize: (actor, w, tx, maintain) => f.repository.authorize(actor, w, maintain, tx) });
  const profile = boundedF002Profile(); await facts.registerProfile(profile);
  const admission = new F002AdmissionService(facts, f.sourceAdmission);
  const run = await admission.start(owner, "workspace", { operationId: "technical-input", reference: f.reference, profile,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId: f.request.scope.componentIds[0] }] }] });
  const scope = await new F002Worker(facts, { admission }).run(owner, "workspace", run.id, run.scopes[0].scopeId, { workerId: "facts", leaseMs: 60000 });
  const version = await new F002PublicationService(facts).publish(owner, "workspace", run.id, scope.scopeId, { revision: scope.revision, operationId: "publish" });
  const investigation = await f.service.start(owner, "workspace", { ...f.request, technicalVersionId: version.graphVersionId });
  return { ...f, investigation, versionId: version.graphVersionId };
}

test("F003 PLAN is non-evidence routing while both Child tasks, consolidation and VERIFY preserve dereferenceable same-adoption technical payloads", async t => {
  const f = await fixture(t), phases = [], digests = new Map();
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: async context => {
    const { input } = context, technical = input.technicalEvidence;
    phases.push(input.phase);
    assert.deepEqual(technical.versionIds, [f.versionId]);
    if(input.phase==='PLAN') {
      assert.equal(technical.authority,'ROUTING_NOT_EVIDENCE');assert.deepEqual(technical.records,[]);assert.deepEqual(technical.allowedFactIds,[]);
    } else assert.ok(technical.objects.some(o => o.name === "validateOrder"));
    for (const fact of technical.records) {
      const key=`${fact.versionId}/${fact.id}`,values=digests.get(key)??new Set();
      values.add(createHash('sha256').update(canonicalEncode(fact.record)).digest('hex'));digests.set(key,values);
      const sameVersion = r => r.versionId === fact.versionId;
      assert.ok(technical.objects.some(o => sameVersion(o) && o.objectId === fact.record.subjectId));
      if (fact.record.targetId) assert.ok(technical.objects.some(o => sameVersion(o) && o.objectId === fact.record.targetId));
      for (const id of fact.record.evidenceIds) assert.ok(technical.evidence.some(e => sameVersion(e) && e.evidenceId === id && e.anchor));
      for (const id of fact.record.premiseFactIds) assert.ok(technical.records.some(p => sameVersion(p) && p.id === id));
    }
    assert.ok(technical.materials.every(m => m.sourceMaterial.bundleId === f.reference.bundleId));
    const reservation = await f.service.reserveModelCall(owner, "workspace", f.investigation.id, context);
    const result = input.phase === "PLAN" ? { assignments: ['approveOrder调用条件是什么？','validateOrder的前提是什么？'].map(objective => ({ slotId: "child-1", obligations: ['核查调用与完整技术前提'], objective,sharedEvidenceReason:'同一调用与被调用声明的前提闭包', materialKeys: [input.inventory[0].key] })),pendingMaterials:input.inventory.slice(1).map(m=>({materialKey:m.key,reason:'未分派的机制材料保留待调查'})) }
      : input.phase === "INVESTIGATE" ? { candidates: [{ key: "validate", kind: "RULE", name: "校验调用", statement: "approveOrder调用validateOrder", scope: "仅本冻结代码",
        technicalRefs:[technical.records.find(r=>[r.record.subjectId,r.record.targetId].some(id=>technical.objects.some(o=>o.objectId===id&&o.name==='validateOrder'))).id],
        evidence: [{ materialId: input.materials[0].id, startLine: 1, endLine: 1, quote: input.materials[0].text }], uncertainties: [] }], relations: [] }
        : input.stage === "CONSOLIDATE_PROPOSALS" ? { mergeSuggestions: [{ keys: input.candidates.map(c => c.key), rationale: "同版代码与关系依据相同" }], conflictGroups: [] }
          : { reviews: input.candidates.map(c => ({ key: c.key, support: "SUPPORTED", rationale: "已对原文和技术关系", premises: ["仅冻结代码"], unresolvedConflicts: [] })) };
    return { result, reservationId: reservation.id };
  } });
  await worker.run(owner, "workspace", f.investigation.id, { workerId: "business" });
  assert.deepEqual(phases, ["PLAN", "INVESTIGATE", "INVESTIGATE", "VERIFY", "VERIFY"]);
  assert.ok(digests.size>0);assert.ok([...digests.values()].every(values=>values.size===1));
});

test("F003 does not reuse a previous Fact-only checkpoint after the model-input contract changes", async t => {
  const f = await fixture(t), run = await f.service.claim(owner, "workspace", f.investigation.id, { workerId: "old" });
  const oldBinding = createHash("sha256").update(canonicalEncode({ sourceInput: run.sourceInput, profileId: run.profile.id, adoptedVersionIds: run.adoptedVersionIds })).digest("hex");
  await f.service.checkpoint(owner, "workspace", run.id, { generation: run.generation, key: "technical", payload: { binding: oldBinding,
    data: { records: [{ id: "orphan", kind: "FACT", record: {} }], versionIds: [f.versionId], allowedFactIds: ["orphan"], truncated: false } } });
  const paused = await f.service.control(owner, "workspace", run.id, { action: "PAUSE", expectedRevision: (await f.service.get(owner, "workspace", run.id)).revision });
  await f.service.control(owner, "workspace", run.id, { action: "RESUME", expectedRevision: paused.revision });
  let observed = false;
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: async ({ input }) => {
    observed = input.technicalEvidence.authority==='ROUTING_NOT_EVIDENCE' && input.technicalEvidence.versionIds.includes(f.versionId)
      && !input.technicalEvidence.allowedFactIds.includes('orphan');
    throw Object.assign(new Error("capture only"), { code: "CAPTURE_ONLY" });
  } });
  await assert.rejects(worker.run(owner, "workspace", run.id, { workerId: "new" }), { code: "CAPTURE_ONLY" });
  assert.equal(observed, true);
});

test('F003 stage selection reads an explicitly adopted Fact outside the old global prefix with its complete same-version dependencies',async t=>{
  const f=await fixture(t),run=await f.service.claim(owner,'workspace',f.investigation.id,{workerId:'targeted-context'});
  const options={generation:run.generation,maxBytes:32768};
  const all=await f.service.technicalEvidence(owner,'workspace',run.id,options);
  const prefix=await f.service.technicalEvidence(owner,'workspace',run.id,{...options,limit:1});
  const wanted=all.records.find(r=>!prefix.allowedFactIds.includes(r.id));assert.ok(wanted,'fixture must contain a root outside the first closed packet');
  const selected=await f.service.technicalEvidence(owner,'workspace',run.id,{...options,limit:1,selection:{factIds:[wanted.id]}});
  assert.ok(selected.records.some(r=>r.id===wanted.id),'a relevant adopted Fact must not depend on global prefix order');
  const record=selected.records.find(r=>r.id===wanted.id);
  assert.deepEqual(record.record,wanted.record);assert.equal(record.versionId,f.versionId);
  assert.ok(selected.objects.some(o=>o.objectId===wanted.record.subjectId));
  for(const id of wanted.record.evidenceIds)assert.ok(selected.evidence.some(e=>e.evidenceId===id));
  assert.ok(Buffer.byteLength(JSON.stringify(selected))<=32768);
  const byOriginal=await f.service.technicalEvidence(owner,'workspace',run.id,{...options,selection:{materials:all.materials.map(m=>({id:m.sourceMaterial.id,startLine:1,endLine:100}))}});
  assert.ok(byOriginal.records.length>0);assert.deepEqual(byOriginal.versionIds,[f.versionId]);
  assert.ok(byOriginal.allowedFactIds.every(id=>all.allowedFactIds.includes(id)));
});
