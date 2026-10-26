import assert from "node:assert/strict";
import test from "node:test";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { owner } from "./support/source-truth-database.js";
import { InvestigationWorker } from "../src/business-knowledge/worker.js";
import { partitionOriginalMaterials, originalEvidenceContext, citationVisible } from "../src/business-knowledge/model-context.js";

const rawLimit = 64 * 1024;
const content = Array.from({ length: 900 }, (_, i) => `规则${i}：用户仅可取消未支付订单；已支付订单必须保留。 ${"x".repeat(32)}\r\n`).join("");

async function runFixture(t, { maxModelCalls = 12, failVerify = false } = {}) {
  const f = await investigationFixture(t, { content });
  const run = await f.service.start(owner, "workspace", { ...f.request,
    budget: { ...f.request.budget, maxReadBytes: 512 * 1024, maxModelCalls } });
  const calls = [], fragments = [];
  const invokeModel = async c => {
    const reservation = await f.service.reserveModelCall(owner, "workspace", c.investigationId, c), input = c.input;
    calls.push(input);
    if (input.materials) assert.ok(input.materials.reduce((n, m) => n + Buffer.byteLength(m.text), 0) <= rawLimit,
      `${input.stage ?? input.phase} must receive bounded original context, not the complete raw collection`);
    let result;
    if (input.phase === "PLAN") result = { assignments: [{ slotId: "child-1", obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "same fixed business question", materialKeys: input.inventory.map(m => m.key) }] };
    else if (input.phase === "INVESTIGATE") {
      fragments.push(...input.materials);
      result = { candidates: input.materials.map((m, i) => ({ key: `rule-${i}`, kind: "RULE", name: "取消订单条件", statement: "只能取消未支付订单", scope: "未支付订单", uncertainties: [],
        evidence: [{ materialId: m.id, startLine: m.startLine ?? 1, endLine: m.startLine ?? 1, quote: m.text.split(/\r?\n/)[0] }] })), relations: [], requestedMaterialKeys: [] };
    } else if (input.stage === "CONSOLIDATE_PROPOSALS") result = { mergeSuggestions: [], conflictGroups: [] };
    else {
      if (failVerify) { failVerify = false; throw Object.assign(new Error("isolated verification interruption"), { code: "TEST_MODEL_UNAVAILABLE" }); }
      result = { reviews: [...input.candidates, ...input.relations].map(p => ({ key: p.key, support: "SUPPORTED", rationale: "test-double, not business quality", premises: ["未支付条件"], unresolvedConflicts: [] })) };
    }
    return { result, reservationId: reservation.id };
  };
  return { ...f, run, calls, fragments, invokeModel, worker: new InvestigationWorker({ investigations: f.service, invokeModel }) };
}

test("F003 actual Worker partitions bounded Child bytes and supplies original global-line context to Main and VERIFY", async t => {
  const f = await runFixture(t);
  await f.worker.run(owner, "workspace", f.run.id, { workerId: "bounded" });
  assert.ok(f.fragments.length > 1);
  assert.equal(f.fragments.map(m => m.text).join(""), content);
  assert.ok(f.fragments.every(m => m.sourceMaterial.bundleId === f.reference.bundleId && m.startLine >= 1 && m.endLine >= m.startLine));
  assert.equal(f.fragments[0].byteStart, 0);
  assert.equal(f.fragments.at(-1).byteEnd, Buffer.byteLength(content));
  const graph = await f.service.graph(owner, "workspace", f.run.id);
  assert.equal(graph.materials.length, 1);
  assert.ok(graph.candidates.every(p => p.state === "ANALYSIS_ACCEPTED"));
  assert.ok(graph.consolidation.originalProposals.every(p => p.origin.sourceRanges?.length));
  assert.ok(graph.process.filter(p => p.taskKey?.startsWith("child-")).every(p => p.sourceRanges?.length && p.originalContextBytes <= rawLimit));
  assert.equal((await f.service.get(owner, "workspace", f.run.id)).usage.readBytes, Buffer.byteLength(content));
  assert.deepEqual(f.calls.slice(-2).map(c => c.stage), ["CONSOLIDATE_PROPOSALS", "EVIDENCE_VERIFICATION"]);
});

test("F003 reserves Main calls and rejects all infeasible fragments before an arbitrary partial investigation", async t => {
  const f = await runFixture(t, { maxModelCalls: 4 });
  await assert.rejects(f.worker.run(owner, "workspace", f.run.id, { workerId: "fixed-budget" }),{code:'F003_PLAN_CALL_BUDGET'});
  const manifest=(await f.service.checkpoints(owner,'workspace',f.run.id)).find(c=>c.key==='business-task-manifest').payload.data;
  assert.equal(f.calls.filter(c => c.phase === "INVESTIGATE").length,0);
  const ranges = manifest.tasks.flatMap(p=>p.sourceRanges.map(m=>[m.byteStart,m.byteEnd])).sort((a,b)=>a[0]-b[0]);
  assert.equal(ranges[0][0], 0); assert.equal(ranges.at(-1)[1], Buffer.byteLength(content));
  for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i][0], ranges[i - 1][1]);
  assert.equal((await f.service.get(owner, "workspace", f.run.id)).usage.modelCalls,1);
  await assert.rejects(f.service.graph(owner,'workspace',f.run.id),{code:'F003_GRAPH_NOT_FOUND'});
});

test("F003 rejects a guessed citation outside the emitting Child's supplied fragment even when another fragment contains the true text", async t => {
  const f = await investigationFixture(t, { content });
  const run = await f.service.start(owner, "workspace", { ...f.request, budget: { ...f.request.budget, maxReadBytes: 512 * 1024, maxModelCalls: 12 } });
  const lines = content.split(/\r?\n/);let emitted=0;
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: async c => {
    const r = await f.service.reserveModelCall(owner, "workspace", c.investigationId, c), i = c.input;
    const result = i.phase === "PLAN" ? { assignments: [{ slotId: "child-1", obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "same scope", materialKeys: i.inventory.map(m => m.key) }] }
      : i.phase === "INVESTIGATE" ? { candidates: i.materials.filter(m => m.endLine < 900).map(m => ({ key: "guessed", kind: "RULE", name: "越界引用", statement: "一个未提供行段的真实断言", scope: "same frozen material", uncertainties: [],
        evidence: [{ materialId: m.id, startLine: m.endLine + 1, endLine: m.endLine + 1, quote: lines[m.endLine] }] })), relations: [], requestedMaterialKeys: [] }
        : { reviews: i.candidates.map(p => ({ key: p.key, support: "SUPPORTED", rationale: "blind test review", premises: ["same material"], unresolvedConflicts: [] })) };
    if(i.phase==='INVESTIGATE')emitted+=result.candidates.length;
    return { result, reservationId: r.id };
  } });
  await worker.run(owner, "workspace", run.id, { workerId: "outside-range" });
  const graph = await f.service.graph(owner, "workspace", run.id);
  assert.ok(emitted>0);assert.equal(graph.candidates.length,emitted);
  assert.ok(graph.candidates.every(p=>p.state==='QUARANTINED' && p.identityIssues.includes('OUTSIDE_SUPPLIED_SOURCE_RANGE')));
});

test("F003 bounded-input recovery reuses exact fragments and completed Child checkpoints without resetting usage", async t => {
  const f = await runFixture(t, { failVerify: true });
  await assert.rejects(f.worker.run(owner, "workspace", f.run.id, { workerId: "before-restart" }), { code: "TEST_MODEL_UNAVAILABLE" });
  const failed = await f.service.get(owner, "workspace", f.run.id), children = f.calls.filter(c => c.phase === "INVESTIGATE").length;
  await f.service.control(owner, "workspace", f.run.id, { action: "RESUME", expectedRevision: failed.revision });
  await new InvestigationWorker({ investigations: f.service, invokeModel: f.invokeModel }).run(owner, "workspace", f.run.id, { workerId: "after-restart" });
  const after = await f.service.get(owner, "workspace", f.run.id);
  assert.equal(f.calls.filter(c => c.phase === "PLAN").length, 1);
  assert.equal(f.calls.filter(c => c.phase === "INVESTIGATE").length, children);
  assert.equal(after.usage.readBytes, failed.usage.readBytes);
  assert.equal(after.usage.modelCalls, failed.usage.modelCalls + 1);
});

test("F003 pure original fragments retain UTF-8, CRLF, long lines and global coordinates without silent truncation", () => {
  const text = `第一行\r\n${"中文𠮷".repeat(40)}\n第三行\r\n`, material = { id: "real-original", text };
  const parts = partitionOriginalMaterials([material], 31).flat();
  assert.equal(parts.map(p => p.text).join(""), text);
  for (const [i, p] of parts.entries()) {
    assert.ok(Buffer.byteLength(p.text) <= 31); assert.ok(!p.text.includes("\ufffd"));
    assert.equal(p.byteStart, i ? parts[i - 1].byteEnd : 0);
    assert.equal(p.startLine, 1 + text.slice(0, Buffer.from(text).subarray(0, p.byteStart).toString("utf8").length).split("\n").length - 1);
  }
  assert.ok(parts.some(p => p.partialFirstLine || p.partialLastLine));
  assert.equal(citationVisible({ materialId: material.id, startLine: 3, endLine: 3, quote: "第三行" }, [parts[0]]), false);
  const context = originalEvidenceContext([{ key: "rule", evidence: [{ materialId: material.id, startLine: 3, endLine: 3, quote: "第三行" }] }], [material], 2048);
  assert.deepEqual(context.evidenceContext.missingEvidence, []);
  assert.equal(citationVisible({ materialId: material.id, startLine: 3, endLine: 3, quote: "第三行" }, context.materials), true);
});

test("F003 original review context includes neighboring conditions, not only a model quote, and exposes oversized or unknown ranges", () => {
  const material = { id: "source", text: "禁止条件\r\n不允许已支付订单\r\n允许取消\r\n仅在未支付时\r\n审计要求\r\n" };
  const proposal = { key: "cancel", evidence: [{ materialId: "source", startLine: 3, endLine: 3, quote: "允许取消" }] };
  const context = originalEvidenceContext([proposal], [material]);
  assert.ok(context.materials[0].text.includes("不允许已支付订单"));
  assert.ok(context.materials[0].text.includes("仅在未支付时"));
  assert.equal(originalEvidenceContext([proposal], [material], 8).evidenceContext.missingEvidence[0].reason, "ORIGINAL_CONTEXT_BYTE_BUDGET");
  assert.equal(originalEvidenceContext([{ key: "foreign", evidence: [{ materialId: "unknown", startLine: 1, endLine: 1 }] }], [material]).evidenceContext.missingEvidence[0].reason, "INVALID_ORIGINAL_RANGE");
});

test("F003 missing full original-line context cannot become supported through a generic Main vote", async t => {
  const raw = "明确前提：" + "中文".repeat(19000), f = await investigationFixture(t, { content: raw });
  const run = await f.service.start(owner, "workspace", { ...f.request, budget: { ...f.request.budget, maxReadBytes: 512 * 1024, maxModelCalls: 10 } });
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: async c => {
    const r = await f.service.reserveModelCall(owner, "workspace", c.investigationId, c), i = c.input;
    const result = i.phase === "PLAN" ? { assignments: [{ slotId: "child-1", obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "固定业务", materialKeys: i.inventory.map(m => m.key) }] }
      : i.phase === "INVESTIGATE" ? { candidates: i.materials.filter(m => m.text.includes("明确前提：")).map(m => ({ key: "rule", kind: "RULE", name: "前提", statement: "存在明确前提", scope: "本冻结材料", uncertainties: [],
        evidence: [{ materialId: m.id, startLine: 1, endLine: 1, quote: "明确前提：" }] })), relations: [], requestedMaterialKeys: [] }
        : { reviews: i.candidates.map(p => ({ key: p.key, support: "SUPPORTED", rationale: "blind test vote", premises: ["test"], unresolvedConflicts: [] })) };
    return { result, reservationId: r.id };
  } });
  await worker.run(owner, "workspace", run.id, { workerId: "missing-context" });
  const graph = await f.service.graph(owner, "workspace", run.id);
  assert.equal(graph.candidates.length, 1); assert.equal(graph.candidates[0].state, "RETAINED_UNKNOWN");
  assert.equal(graph.candidates[0].verification.contextGuard.originalReview.support, "SUPPORTED");
  assert.ok(graph.process.at(-1).originalContextGaps.some(g => g.reason === "ORIGINAL_CONTEXT_BYTE_BUDGET"));
});
