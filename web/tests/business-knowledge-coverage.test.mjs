import assert from "node:assert/strict";
import test from "node:test";
import {renderComponent} from "./support/render-components.mjs";
const {GraphView}=await import("../app/business-knowledge/graph-view.tsx");
const {RunStatus}=await import("../app/business-knowledge/run-status.tsx");
const meaning="TRANSPORT_COVERAGE_NOT_SEMANTIC_COMPLETENESS";
const entry={key:"file",path:"orders.js",disposition:"VERIFIED",businessStatus:"ASSOCIATED"};
const render=coverage=>renderComponent(GraphView,{graph:{view:"COVERAGE",nodes:[],edges:[],materials:[],coverage,
 adoptedVersionIds:[],uncertaintyCount:0,graphDigest:"fixed-graph",sourceBundleId:"fixed-source",profileId:"fixed-profile"},selectedKey:"",onSelect(){},onMaterial(){}});

test("coverage separates collection, original reads, model byte transport and business association",()=>{
 const html=render([{...entry,sourceReadStatus:"READ",modelInput:{status:"PARTIALLY_SUPPLIED",meaning,suppliedByteRanges:[[0,4]],pendingByteRanges:[[4,19]]}}]);
 assert.match(html,/原文读取/);assert.match(html,/模型片段传输/);assert.match(html,/已读取原文/);assert.match(html,/部分字节已传输/);
 assert.match(html,/已有分析关联/);assert.match(html,/\[0, 4\)/);assert.match(html,/\[4, 19\)/);
 assert.match(html,/UTF-8 半开字节范围/);assert.match(html,/不代表业务理解完整/);
 assert.doesNotMatch(html,/调查率|完成率|100%/);
});

test("missing historical ledgers stay unknown rather than inheriting collection or association success",()=>{
 const html=render([entry]);
 assert.match(html,/读取情况未知/);assert.match(html,/旧图谱未记录模型片段/);
 assert.match(html,/已有分析关联/);assert.doesNotMatch(html,/已读取原文|全部字节已传输/);
});

test("full transport does not create business association and unread is not missing source data",()=>{
 const html=render([{...entry,key:"full",businessStatus:"UNASSOCIATED",sourceReadStatus:"READ",modelInput:{status:"FULLY_SUPPLIED",meaning,suppliedByteRanges:[[0,19]],pendingByteRanges:[]}},
 {...entry,key:"unread",sourceReadStatus:"UNREAD",businessStatus:"UNASSOCIATED",modelInput:{status:"NOT_SUPPLIED",meaning,suppliedByteRanges:[],pendingByteRanges:[]}}]);
 assert.match(html,/全部字节已传输/);assert.match(html,/未传输给模型/);assert.match(html,/尚未读取原文/);
 assert.match(html,/尚未关联/);assert.doesNotMatch(html,/业务理解完成|全部调查完成/);
});

test("unrecognized or malformed model ledger cannot be rendered as full transport",()=>{
 for(const patch of [{meaning:"UNRECOGNIZED"},{suppliedByteRanges:[[-1,20]]},{pendingByteRanges:[[10,3]]}]){
  const html=render([{...entry,sourceReadStatus:"READ",modelInput:{status:"FULLY_SUPPLIED",meaning,suppliedByteRanges:[[0,19]],pendingByteRanges:[],...patch}}]);
  assert.match(html,/模型片段记录不可核对/);assert.doesNotMatch(html,/全部字节已传输/);
 }
});

test("the safe model input limit is a typed failure, never an inferred timeout or successful investigation",()=>{
 const run={id:"run",question:"固定问题",state:"FAILED",revision:2,generation:1,updatedAt:"2026-10-23T00:00:00Z",
  sourceInput:{sourceBundleSnapshotId:"source",receiptId:"receipt"},profile:{id:"profile"},budget:{maxModelCalls:12,maxReadBytes:4096,deadline:"2099-01-01T00:00:00Z"},
  usage:{modelCalls:2,readBytes:100},adoptedVersionIds:[],technicalVersionId:null,leaseUntil:null,lastFailure:{code:"F003_MODEL_INPUT_LIMIT",generation:1,phase:"CHILD",taskKey:"part-one",slotId:"child"}};
 const html=renderComponent(RunStatus,{run,busy:false,canControl:true,onControl(){}});
 assert.match(html,/模型输入超过安全上限/);assert.match(html,/part-one/);assert.doesNotMatch(html,/模型调用超时|>分析已保存</);
});

test("zero-byte transport and pending task ranges stay independent of supplied ranges and association",()=>{
 const html=render([{...entry,sourceReadStatus:"READ",modelInput:{status:"FULLY_SUPPLIED",meaning,suppliedByteRanges:[[0,0]],pendingByteRanges:[[0,0]]}},
  {...entry,key:"unknown",sourceReadStatus:"UNREAD",modelInput:{status:"UNKNOWN",meaning,suppliedByteRanges:[],pendingByteRanges:[[9,12],[0,4]]}}]);
 assert.match(html,/全部字节已传输/);assert.match(html,/\[0, 0\)/);assert.match(html,/待处理 · 1段/);
 assert.match(html,/传输情况未知/);assert.match(html,/\[9, 12\).*\[0, 4\)/s);assert.match(html,/已有分析关联/);
});
