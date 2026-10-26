import assert from "node:assert/strict";
import test from "node:test";
import { knowledgePosition, makeStart, propositionState, investigationState } from "../app/business-knowledge/model.ts";

const bundle = "a".repeat(64), component = "b".repeat(64), version = "c".repeat(64);
const input = { operationId: "original-op", question: "订单取消有哪些约束", bundle: { id: bundle, components: [{ id: component }], latestReceipt: { id: "receipt" } },
  componentIds: [component], profileId: "active-profile", confirmedProfileId: "active-profile", technicalVersionId: "",
  versions: [], maxReadMiB: 4, maxModelCalls: 12, durationMinutes: 60, supplementMaterials: 100, supplementMiB: 4,
  supplementRules: 100000, supplementAttempts: 4, now: 0 };

test("the saved URL restores an exact investigation, never another workspace or latest graph", () => {
  assert.deepEqual(knowledgePosition("?page=graph&workspace=w&runId=original&view=COVERAGE&objectId=rule", "w"), { id: "original", view: "COVERAGE", key: "rule", legacy: false, error:"" });
  assert.equal(knowledgePosition("?page=graph&workspace=other&runId=foreign", "w").id, "");
  assert.equal(knowledgePosition("?page=graph&workspace=w&revision=old-graph&objectId=old-node", "w").legacy, true);
  assert.equal(knowledgePosition("?page=graph&workspace=w&view=legacy", "w").legacy, true);
});

test("ambiguous or invalid explicit investigation positions cannot become an empty-state start or a legacy selection",()=>{
 for(const search of ["?workspace=w&runId=one&runId=two","?workspace=w&runId=","?workspace=w&runId=%2Fother","?workspace=w&runId=one&view=BUSINESS&view=COVERAGE",
  "?workspace=w&runId=one&revision=legacy","?workspace=w&runId=one&objectId=a&objectId=b"]){
  const position=knowledgePosition(search,"w");assert.ok(position.error,search);assert.equal(position.id,"");assert.equal(position.legacy,false);
 }
});

test("starting pins F001 receipt, selected components, confirmed active configuration and explicit absence of technical evidence", () => {
  const request = makeStart(input);
  assert.deepEqual(request.reference, { bundleId: bundle, receiptId: "receipt" });
  assert.deepEqual(request.scope, { componentIds: [component] });
  assert.equal(request.technicalVersionId, null);
  assert.equal(request.expectedProfileId, "active-profile");
  assert.equal(request.budget.maxReadBytes, 4 * 1024 * 1024);
  assert.equal(request.budget.maxModelCalls, 12);
  assert.equal(Date.parse(request.budget.deadline), 60 * 60 * 1000);
  assert.equal(request.supplementBudget.deadline, request.budget.deadline);
  assert.throws(() => makeStart({ ...input, confirmedProfileId: "old-profile" }), /确认/);
  assert.throws(() => makeStart({ ...input, componentIds: ["foreign"] }), /组件/);
  assert.throws(() => makeStart({ ...input, technicalVersionId: version, versions: [{ graphVersionId: version, bundleId: "foreign" }] }), /同版/);
  for (const key of ["maxReadMiB", "maxModelCalls", "durationMinutes", "supplementMaterials", "supplementMiB", "supplementRules", "supplementAttempts"]) {
    assert.throws(() => makeStart({ ...input, [key]: 0 }), /预算/);
  }
});

test("analysis acceptance, human confirmation, unknown, quarantine and failure remain distinct", () => {
  assert.equal(propositionState({ state: "ANALYSIS_ACCEPTED", authority: "AGENT_ANALYSIS" }), "分析收录 · 非人工确认");
  assert.equal(propositionState({ state: "ANALYSIS_ACCEPTED", authority: "HUMAN_CONFIRMED" }), "人工确认");
  assert.equal(propositionState({ state: "QUARANTINED", authority: "AGENT_ANALYSIS" }), "无效输出 · 已隔离");
  assert.equal(propositionState({ state: "RETAINED_UNKNOWN", authority: "AGENT_ANALYSIS" }), "保留未知");
  assert.equal(investigationState("COMPLETED"), "分析已保存");
  assert.equal(investigationState("FAILED"), "调查失败");
  assert.equal(investigationState("PAUSED"), "已暂停");
});
