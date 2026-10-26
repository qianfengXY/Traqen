import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { InvestigationWorker } from "../src/business-knowledge/worker.js";
import { canonicalEncode } from "../src/source-truth/identity.js";

function model(f, calls, override = null) {
  return async context => {
    const { input, slotId } = context;
    const reservation = await f.service.reserveModelCall(owner, "workspace", context.investigationId, context);
    calls.push({ phase: input.phase, slotId, reservationId: reservation.id });
    const changed = await override?.(context);
    if (changed) return { result: changed, reservationId: reservation.id };
    let result;
    if (input.phase === "PLAN") result = { assignments: [{ slotId: "child-1", obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "解释取消订单", materialKeys: input.inventory.map(m => m.key) }] };
    if (input.phase === "INVESTIGATE") result = { candidates: [{ key: "cancel", kind: "FUNCTION", name: "取消订单", statement: "用户可取消未支付订单。", scope: "本测试冻结业务说明", uncertainties: [],
      evidence: [{ materialId: input.materials[0].id, startLine: 1, endLine: 1, quote: "用户可以取消未支付的订单。" }] }], relations: [], requestedMaterialKeys: [] };
    if (input.phase === "VERIFY") result = { reviews: input.candidates.map(c => ({ key: c.key, support: "SUPPORTED", rationale: "逐句核查原文", premises: ["仅未支付订单"], unresolvedConflicts: [] })) };
    return { result, reservationId: reservation.id };
  };
}

test("F003 real source worker persists Main/Child/verification process and immutable unpublished graph", async t => {
  const f = await investigationFixture(t), calls = [];
  const admitted = await f.service.start(owner, "workspace", f.request);
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: model(f, calls) });
  const result = await worker.run(owner, "workspace", admitted.id, { workerId: "worker", leaseMs: 60000 });
  assert.equal(result.state, "COMPLETED");
  assert.deepEqual(calls.map(c => [c.phase, c.slotId]), [["PLAN", "main"], ["INVESTIGATE", "child-1"], ["VERIFY", "main"]]);
  const graph = await f.service.graph(owner, "workspace", admitted.id);
  assert.equal(graph.published, false);
  assert.equal(graph.candidates[0].state, "ANALYSIS_ACCEPTED");
  assert.equal(graph.materials[0].sourceMaterial.bundleId, f.reference.bundleId);
  assert.equal(graph.coverage[0].businessStatus, "ASSOCIATED");
  assert.equal(graph.process.filter(p => p.reservationId).length, 3);
  const inspected = await f.service.evidenceMaterial(owner, "workspace", admitted.id, graph.materials[0].id);
  assert.equal(inspected.bytes.toString("utf8"), "用户可以取消未支付的订单。");
  assert.equal(inspected.sourceMaterial.id, graph.materials[0].id);
  await assert.rejects(f.service.evidenceMaterial(owner, "workspace", admitted.id, "invented-material"), { code: "F003_OBJECT_NOT_FOUND" });
  assert.equal((await f.service.get(owner, "workspace", admitted.id)).usage.modelCalls, 3);
  await assert.rejects(f.service.graph(reader, "workspace", admitted.id), { code: "F003_INVESTIGATION_FORBIDDEN" });
  const persisted = await f.service.checkpoints(owner, "workspace", admitted.id);
  assert.ok(persisted.some(p => p.key === "graph"));
  await assert.rejects(worker.run(owner, "workspace", admitted.id, { workerId: "late" }), { code: "F003_LEASE_UNAVAILABLE" });
});

test("F003 cannot accept a plan that skips all configured Child agents", async t => {
  const f = await investigationFixture(t), calls = [];
  const run = await f.service.start(owner, "workspace", f.request);
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: model(f, calls, async ({ input }) => input.phase === "PLAN" ? { assignments: [] } : null) });
  await assert.rejects(worker.run(owner, "workspace", run.id, { workerId: "worker" }), { code: "F003_MODEL_OUTPUT_INVALID" });
  assert.equal((await f.service.get(owner, "workspace", run.id)).state, "FAILED");
  await assert.rejects(f.service.graph(owner, "workspace", run.id), { code: "F003_GRAPH_NOT_FOUND" });
});

test("F003 Main actually consolidates equivalent observations from two task-local namespaces before canonical verification", async t => {
  const f = await investigationFixture(t), calls = [], run = await f.service.start(owner, "workspace", f.request);
  let verifiedCanonicalCount = null;
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: model(f, calls, async ({ input }) => {
    if (input.phase === "PLAN") return { assignments: ['允许取消的条件是什么？','哪些付款状态排除取消？'].map(objective => ({ slotId: "child-1", obligations: ["核查条件、反例与未供应前提"], objective, sharedEvidenceReason:'同一原文同时包含允许与排除条件，归并须保留两项任务来源', materialKeys: input.inventory.map(m => m.key) })) };
    if (input.stage === "CONSOLIDATE_PROPOSALS") return { mergeSuggestions: [{ keys: input.candidates.map(c => c.key), rationale: "逐条核对，原文/规则/范围一致" }], conflictGroups: [] };
    if (input.stage === "EVIDENCE_VERIFICATION") verifiedCanonicalCount = input.candidates.length;
  }) });
  await worker.run(owner, "workspace", run.id, { workerId: "merge" });
  const graph = await f.service.graph(owner, "workspace", run.id);
  assert.equal(verifiedCanonicalCount, 1);
  assert.equal(graph.candidates.length, 1);
  assert.equal(graph.candidates[0].state, "ANALYSIS_ACCEPTED");
  assert.equal(graph.candidates[0].originRefs.length, 2);
  assert.equal(graph.consolidation.originalProposals.length, 2);
  assert.equal(new Set(graph.consolidation.originalProposals.map(p => p.origin.taskKey)).size,2);
  assert.ok(graph.consolidation.originalProposals.every(p=>/^child-[a-f0-9]{64}$/.test(p.origin.taskKey)));
  assert.ok(graph.consolidation.sourceToCanonical.every(m => m.status === "MERGED" && m.canonicalKey === graph.candidates[0].key));
  assert.deepEqual(calls.map(c => c.phase), ["PLAN", "INVESTIGATE", "INVESTIGATE", "VERIFY", "VERIFY"]);
  assert.equal((await f.service.get(owner, "workspace", run.id)).usage.modelCalls, 5);
});

test("F003 final verification cannot hide a newly discovered business conflict behind generic supported reviews", async t => {
  const f = await investigationFixture(t), calls = [], run = await f.service.start(owner, "workspace", f.request);
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: model(f, calls, async ({ input }) => {
    if (input.phase === "PLAN") return { assignments: ['允许取消的条件是什么？','哪些付款状态排除取消？'].map(objective => ({ slotId: "child-1", obligations: ["核查条件、反例与未供应前提"], objective, sharedEvidenceReason:'同一原文的条件与排除解释需要交Main检查冲突', materialKeys: input.inventory.map(m => m.key) })) };
    if (input.stage === "CONSOLIDATE_PROPOSALS") return { mergeSuggestions: [], conflictGroups: [] };
    if (input.stage === "EVIDENCE_VERIFICATION") return { reviews: input.candidates.map(c => ({ key: c.key, support: "SUPPORTED", rationale: "原文存在", premises: ["条件待澄清"], unresolvedConflicts: [] })),
      conflictGroups: [{ keys: input.candidates.map(c => c.key), rationale: "复核后发现适用条件的业务解释仍冲突" }] };
  }) });
  await worker.run(owner, "workspace", run.id, { workerId: "late-conflict" });
  const graph = await f.service.graph(owner, "workspace", run.id);
  assert.equal(graph.candidates.length, 2);
  assert.ok(graph.candidates.every(c => c.state === "HUMAN_REVIEW"));
  assert.equal(graph.consolidation.pendingConflictGroups.length, 1);
  assert.ok(graph.consolidation.sourceToCanonical.every(m => m.status === "CONFLICT"));
});

test("F003 cancels during model execution and fences a model that ignores its abort signal", async t => {
  const f = await investigationFixture(t), calls = [];
  const run = await f.service.start(owner, "workspace", f.request);
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: model(f, calls, async ({ input }) => {
    if (input.phase !== "INVESTIGATE") return null;
    const current = await f.service.get(owner, "workspace", run.id);
    await f.service.control(owner, "workspace", run.id, { action: "CANCEL", expectedRevision: current.revision });
    return { candidates: [], relations: [], requestedMaterialKeys: [] };
  }) });
  await assert.rejects(worker.run(owner, "workspace", run.id, { workerId: "worker" }), { code: "F003_STALE_WORKER" });
  assert.equal((await f.service.get(owner, "workspace", run.id)).state, "CANCELLED");
  assert.equal((await f.service.checkpoints(owner, "workspace", run.id)).some(p => p.key.startsWith('child-')), false);
});

test("F003 explicit resume reuses committed same-input checkpoints without resetting budgets or replaying Main planning", async t => {
  const f = await investigationFixture(t), calls = [];
  const run = await f.service.start(owner, "workspace", f.request);
  const broken = new InvestigationWorker({ investigations: f.service, invokeModel: model(f, calls, async ({ input }) => {
    if (input.phase === "INVESTIGATE") throw Object.assign(new Error("isolated injected model failure"), { code: "TEST_MODEL_UNAVAILABLE" });
  }) });
  await assert.rejects(broken.run(owner, "workspace", run.id, { workerId: "worker" }), { code: "TEST_MODEL_UNAVAILABLE" });
  const failed = await f.service.get(owner, "workspace", run.id);
  assert.equal(failed.state, "FAILED");
  await f.service.control(owner, "workspace", run.id, { action: "RESUME", expectedRevision: failed.revision });
  const recovered = new InvestigationWorker({ investigations: f.service, invokeModel: model(f, calls) });
  await recovered.run(owner, "workspace", run.id, { workerId: "replacement" });
  assert.equal(calls.filter(c => c.phase === "PLAN").length, 1);
  assert.equal((await f.service.get(owner, "workspace", run.id)).usage.modelCalls, 4);
  assert.equal((await f.service.graph(owner, "workspace", run.id)).candidates[0].state, "ANALYSIS_ACCEPTED");
});

test("F003 resume retains original-to-canonical identities and does not replay completed consolidation", async t => {
  const f = await investigationFixture(t), calls = [];
  const run = await f.service.start(owner, "workspace", { ...f.request, budget: { ...f.request.budget, maxModelCalls: 6 } });
  const phases = [];
  const broken = new InvestigationWorker({ investigations: f.service, invokeModel: model(f, calls, async ({ input }) => {
    phases.push(input.stage ?? input.phase);
    if (input.phase === "PLAN") return { assignments: ['允许取消的条件是什么？','哪些付款状态排除取消？'].map(objective => ({ slotId: "child-1", obligations: ["核查条件、反例与未供应前提"], objective, sharedEvidenceReason:'同一原文独立条件核查，恢复不得改变原任务', materialKeys: input.inventory.map(m => m.key) })) };
    if (input.stage === "CONSOLIDATE_PROPOSALS") return { mergeSuggestions: [{ keys: input.candidates.map(c => c.key), rationale: "同义且同范围" }], conflictGroups: [] };
    if (input.stage === "EVIDENCE_VERIFICATION") throw Object.assign(new Error("verification interrupted"), { code: "TEST_MODEL_UNAVAILABLE" });
  }) });
  await assert.rejects(broken.run(owner, "workspace", run.id, { workerId: "first" }), { code: "TEST_MODEL_UNAVAILABLE" });
  const before = (await f.service.checkpoints(owner, "workspace", run.id)).find(p => p.key === "consolidated-proposals").payload.data;
  const failed = await f.service.get(owner, "workspace", run.id);
  await f.service.control(owner, "workspace", run.id, { action: "RESUME", expectedRevision: failed.revision });
  const recovered = new InvestigationWorker({ investigations: f.service, invokeModel: model(f, calls, async ({ input }) => { phases.push(input.stage ?? input.phase); }) });
  await recovered.run(owner, "workspace", run.id, { workerId: "second" });
  const graph = await f.service.graph(owner, "workspace", run.id);
  assert.deepEqual(graph.consolidation, before.consolidation);
  assert.deepEqual(graph.candidates[0].originRefs, before.candidates[0].originRefs);
  assert.equal(graph.candidates[0].state, "ANALYSIS_ACCEPTED");
  assert.deepEqual(phases, ["PLAN", "INVESTIGATE", "INVESTIGATE", "CONSOLIDATE_PROPOSALS", "EVIDENCE_VERIFICATION", "EVIDENCE_VERIFICATION"]);
  assert.equal((await f.service.get(owner, "workspace", run.id)).usage.modelCalls, 6);
});

for (const version of [2, 3, 4, 5, 6, 7, 8]) test(`F003 does not reuse v${version} checkpoints from before stage-specific complete-JSON context validation`, async t => {
  const f = await investigationFixture(t), admitted = await f.service.start(owner, "workspace", f.request);
  const run = await f.service.claim(owner, "workspace", admitted.id, { workerId: "v2" });
  const oldBinding = createHash("sha256").update(canonicalEncode({ analysisContractVersion: version, sourceInput: run.sourceInput,
    profileId: run.profile.id, adoptedVersionIds: run.adoptedVersionIds })).digest("hex");
  await f.service.checkpoint(owner, "workspace", run.id, { generation: run.generation, key: "plan", payload: { binding: oldBinding, data: { assignments: [] } } });
  const paused = await f.service.control(owner, "workspace", run.id, { action: "PAUSE", expectedRevision: (await f.service.get(owner, "workspace", run.id)).revision });
  await f.service.control(owner, "workspace", run.id, { action: "RESUME", expectedRevision: paused.revision });
  let replanned = false;
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: async ({ input }) => {
    replanned = input.phase === "PLAN";
    throw Object.assign(new Error("new planning captured"), { code: "CAPTURE_ONLY" });
  } });
  await assert.rejects(worker.run(owner, "workspace", run.id, { workerId: "v3" }), { code: "CAPTURE_ONLY" });
  assert.equal(replanned, true);
});
