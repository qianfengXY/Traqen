import assert from "node:assert/strict";
import test from "node:test";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { owner } from "./support/source-truth-database.js";
import { InvestigationWorker } from "../src/business-knowledge/worker.js";

async function scenario(t, { late = false, invalid = false, interrupted = false } = {}) {
  const f = await investigationFixture(t, { content: "允许取消。", additionalFiles: [{ entryPath: "opposition.md", content: "拒绝取消。" + (invalid ? "" : "中文".repeat(19000)) }] });
  const run = await f.service.start(owner, "workspace", { ...f.request, budget: { ...f.request.budget, maxReadBytes: 512 * 1024, maxModelCalls: 12 } });
  const calls = [];
  const invokeModel = async c => {
    const r = await f.service.reserveModelCall(owner, "workspace", c.investigationId, c), i = c.input; calls.push(i.stage ?? i.phase);
    const conflict = () => [{ keys: i.candidates.map(p => p.key), rationale: "同一适用条件相反的业务结果仍未裁决" }];
    let result;
    if (i.phase === "PLAN") result = { assignments: [{ slotId: "child-1", obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "same fixed conflicting originals", materialKeys: i.inventory.map(m => m.key) }] };
    else if (i.phase === "INVESTIGATE") result = { candidates: i.materials.filter(m => m.text.startsWith("允许取消。") || m.text.startsWith("拒绝取消。")).map((m, n) => ({ key: `rule-${n}`, kind: "RULE", name: "取消规则",
      statement: m.text.startsWith("允许") ? "同一条件允许取消" : "同一条件禁止取消", scope: "同一固定条件与版本", uncertainties: [],
      evidence: [{ materialId: m.id, startLine: 1, endLine: 1, quote: invalid && m.text.startsWith("拒绝") ? "不存在的伪造依据" : m.text.startsWith("允许") ? "允许取消。" : "拒绝取消。" }] })), relations: [], requestedMaterialKeys: [] };
    else if (i.stage === "CONSOLIDATE_PROPOSALS") result = { mergeSuggestions: [], conflictGroups: late ? [] : conflict() };
    else {
      if (interrupted) { interrupted = false; throw Object.assign(new Error("isolated verification failure"), { code: "TEST_MODEL_UNAVAILABLE" }); }
      result = { reviews: i.candidates.map(p => ({ key: p.key, support: "SUPPORTED", rationale: "generic model vote does not resolve conflicts", premises: ["same scope"], unresolvedConflicts: [] })), conflictGroups: late ? conflict() : [] };
    }
    return { result, reservationId: r.id };
  };
  return { ...f, run, calls, invokeModel, worker: new InvestigationWorker({ investigations: f.service, invokeModel }) };
}

for (const late of [false, true]) test(`F003 preserves an explicit ${late ? "late" : "consolidation"} conflict even when an opposing original cannot fit Main context`, async t => {
  const f = await scenario(t, { late });
  await f.worker.run(owner, "workspace", f.run.id, { workerId: "explicit-conflict" });
  const graph = await f.service.graph(owner, "workspace", f.run.id);
  assert.equal(graph.candidates.length, 2);
  assert.ok(graph.consolidation.contextGaps.length > 0);
  assert.ok(graph.candidates.every(p => p.state === "HUMAN_REVIEW"));
  assert.ok(graph.consolidation.sourceToCanonical.every(m => m.status === "CONFLICT"));
  assert.equal(graph.consolidation.originalProposals.length, 2);
});

for (const late of [false, true]) test(`F003 rejects an invalid source in ${late ? "late" : "consolidation"} conflicts without contaminating an independently valid proposition`, async t => {
  const f = await scenario(t, { late, invalid: true });
  await f.worker.run(owner, "workspace", f.run.id, { workerId: "invalid-conflict-source" });
  const graph = await f.service.graph(owner, "workspace", f.run.id);
  assert.equal(graph.candidates.filter(p => p.state === "QUARANTINED").length, 1);
  assert.equal(graph.candidates.filter(p => p.state === "ANALYSIS_ACCEPTED").length, 1);
  assert.equal(graph.consolidation.sourceToCanonical.filter(m => m.status === "CONFLICT").length, 0);
});

test("F003 context-conflict recovery preserves mappings and budget without replaying consolidation or hiding opposition", async t => {
  const f = await scenario(t, { interrupted: true });
  await assert.rejects(f.worker.run(owner, "workspace", f.run.id, { workerId: "interrupted" }), { code: "TEST_MODEL_UNAVAILABLE" });
  const before = await f.service.get(owner, "workspace", f.run.id);
  const mapping = (await f.service.checkpoints(owner, "workspace", f.run.id)).find(p => p.key === "consolidated-proposals").payload.data.consolidation.sourceToCanonical;
  assert.ok(mapping.every(m => m.status === "CONFLICT"));
  await f.service.control(owner, "workspace", f.run.id, { action: "RESUME", expectedRevision: before.revision });
  await new InvestigationWorker({ investigations: f.service, invokeModel: f.invokeModel }).run(owner, "workspace", f.run.id, { workerId: "recovered" });
  const graph = await f.service.graph(owner, "workspace", f.run.id), after = await f.service.get(owner, "workspace", f.run.id);
  assert.deepEqual(graph.consolidation.sourceToCanonical, mapping);
  assert.ok(graph.candidates.every(p => p.state === "HUMAN_REVIEW"));
  assert.equal(f.calls.filter(stage => stage === "CONSOLIDATE_PROPOSALS").length, 1);
  assert.equal(after.usage.modelCalls, before.usage.modelCalls + 1); assert.equal(after.usage.readBytes, before.usage.readBytes);
});
