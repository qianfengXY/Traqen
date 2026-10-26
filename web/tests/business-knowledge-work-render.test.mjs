import test from "node:test";
import assert from "node:assert/strict";
import { renderComponent } from "./support/render-components.mjs";
const { AnswerView } = await import("../app/business-knowledge/work-sessions.tsx");
const {PublishedProjection}=await import('../app/business-knowledge/published-projection.tsx');
test('published execution retains each declared target and its stale mapping, never aggregates a current subset as whole-object PASS',()=>{
 const value={currentAuthority:{status:'PARTIALLY_CONFIRMED',confirmedTargets:[],targets:[]},currentExecution:{targets:[
  {claimId:'current-claim',claimVersion:1,scopeId:'scope',scopeVersion:1,mappingCurrent:true,authorityApplies:true,testSpecId:'spec-A',testSpecVersion:1,status:'PASS',history:[]},
  {claimId:'stale-claim',claimVersion:1,scopeId:'scope',scopeVersion:1,mappingCurrent:false,authorityApplies:false,testSpecId:'spec-B',testSpecVersion:1,status:'UNKNOWN',history:[]}
 ]},stateDimensions:Object.fromEntries(['authority','conformance','verification','freshness','conflict'].map(k=>[k,{status:k==='freshness'?'STALE':'UNKNOWN'}]))};
 const html=renderComponent(PublishedProjection,{value});
 for(const text of ['spec-A','spec-B','current-claim','stale-claim','映射已失效','完整声明集合'])assert.ok(html.includes(text),text);
});
test("saved derived answers keep UNKNOWN, conflicts, exact source and citations without human or execution promotion", () => {
  const answer = {
    binding: { graphRevisionId: "exact-revision", graphDigest: "a".repeat(64) },
    requestDigest: "b".repeat(64),
    segments: [
      {
        key: "segment",
        stance: "UNKNOWN",
        text: "<script>not executed</script>",
        graphRefs: ["unresolved-key"],
        technicalRefs: ["fact-ref"],
        evidence: [{ quote: "original quote", materialId: "material", startLine: 2, endLine: 3 }],
        uncertainties: ["missing premise"],
        guardReasons: ["ORIGINAL_CONTEXT_INCOMPLETE"],
        verification: { premises: ["not established"] },
      },
    ],
    unknowns: ["unknown reason"],
    conflicts: [{ reason: "disputed" }],
    unresolvedConflicts: ["not resolved"],
    readGaps: [{ reason: "unread" }],
    process: [],
  };
  const html = renderComponent(AnswerView, { value: { answer } });
  for (const text of [
    "派生答案 · 非业务权威",
    "COMPLETED仅代表答案已保存",
    "UNKNOWN",
    "exact-revision",
    "original quote",
    "missing premise",
    "disputed",
    "not resolved",
    "unread",
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<a href="));
  answer.questionContractVersion = 2;
  answer.premiseContext = {
    scope: "PARTIAL_WINDOWS_NOT_COMPLETE_SEMANTIC_CONTEXT",
    missingEvidence: [{ reason: "ORIGINAL_CONTEXT_BYTE_BUDGET" }],
  };
  answer.segments[0].evidence.push({
    materialId: { untrusted: "not a string" },
    startLine: -1,
    quote: { not: "renderable as React text" },
  });
  const v2 = renderComponent(AnswerView, { value: { answer } });
  for (const text of [
    "答案核查合同：2",
    "实际原文前提闭包与缺口",
    "ORIGINAL_CONTEXT_BYTE_BUDGET",
    "UNKNOWN中的无效引用",
  ])
    assert.ok(v2.includes(text), text);
});
test('QA v4 shows eligible pending work separately from isolated invalid originals and retains legacy versions',()=>{
  const answer={binding:{graphRevisionId:'R1',graphDigest:'a'.repeat(64)},requestDigest:'b'.repeat(64),questionContractVersion:4,
    segments:[],unknowns:['pending remains unknown'],conflicts:[],unresolvedConflicts:[],readGaps:[],
    premiseContext:{pendingObjects:[{key:'waiting-object',reason:'MODEL_INPUT_BYTE_BUDGET'}],missingEvidence:[],omittedSegments:[]},
    process:[{taskKey:'qa-verify',inputBytes:120,maxInputBytes:131072,technicalContextBytes:20,resourceContext:{questionContractVersion:4,requestedItems:3,suppliedItems:1,pendingItems:1,isolatedItems:{count:1,digest:'c'.repeat(64),scope:'SERVER_SIDE_INVALID_DRAFTS_NOT_SEMANTIC_INPUT'}}}]};
  const html=renderComponent(AnswerView,{value:{answer}});
  for(const text of ['waiting-object','已供应1项','待处理1项','隔离1项','131072','MODEL_INPUT_BYTE_BUDGET'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('未提供可核实的v2'));
  for(const version of [1,2,3]){
    const legacy={...answer,questionContractVersion:version};
    const old=renderComponent(AnswerView,{value:{answer:legacy}});assert.ok(old.includes(`答案核查合同：${version}`));assert.ok(old.includes('pending remains unknown'));
  }
});
