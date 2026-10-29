import test from "node:test";
import assert from "node:assert/strict";
import {projectTaskEvidence} from "../src/business-knowledge/task-evidence.js";
import {createHash} from "node:crypto";
import {canonicalEncode} from "../src/source-truth/identity.js";

const hash=v=>createHash("sha256").update(canonicalEncode(v)).digest("hex");
const run={workspaceId:"w",id:"i",revision:3,generation:2,state:"COMPLETED",analysisContractVersion:13,
  sourceInput:{sourceBundleSnapshotId:"source",receiptId:"receipt"},profile:{id:"profile",mainAgentSlot:{id:"main"},childAgentSlots:[{id:"child"}]},
  adoptedVersionIds:[],latestGraph:{generation:1,digest:"graph"}};

test("legacy missing fields remain missing, and a saved graph cannot borrow another manifest or its raw input",()=>{
  const graph={process:[],materials:[],coverage:[],candidates:[],relations:[],adoptedVersionIds:[]};
  const source={key:"business-task-manifest",payload:{binding:"another",data:{tasks:[{taskKey:"fake-current",input:{question:"MUST_NOT_BORROW"}}]}}};
  const before=structuredClone(source),value=projectTaskEvidence({...run,analysisContractVersion:undefined},{graph,checkpoints:[source]});
  assert.equal(value.manifestAvailable,false);assert.deepEqual(value.tasks,[]);assert.equal(value.pendingInventoryAvailable,false);
  assert.ok(!JSON.stringify(value).includes("MUST_NOT_BORROW"));assert.deepEqual(source,before);
  const legacyCurrent=projectTaskEvidence({...run,analysisContractVersion:undefined,latestGraph:undefined},
    {checkpoints:[{key:"plan",payload:{binding:null,process:{taskKey:"unbound"}}}]});
  assert.equal(legacyCurrent.snapshotKind,"UNAVAILABLE");assert.deepEqual(legacyCurrent.tasks,[]);
});

test("exact manifest digest preserves completed-run pending work and maps original task proposals through consolidation",()=>{
  const manifest={tasks:[{taskKey:"task",slotId:"child",responsibilityId:"r",sourceRanges:[{materialId:"m",byteStart:0,byteEnd:8}],
    input:{objective:"目标",task:{obligations:["找反例"]},outputContract:{private:"DO_NOT_EXPOSE"},materials:[{text:"RAW_PROMPT_DO_NOT_EXPOSE"}]}}]};
  const graph={adoptedVersionIds:[],materials:[{id:"m"}],coverage:[{materialId:"m",key:"material-key",path:"orders.js"}],
    process:[{taskKey:"task",slotId:"child",generation:1},{stage:"TRIAGE",taskManifestDigest:hash(manifest),
      taskReports:[{taskKey:"task",obligations:[{obligation:"找反例",status:"REPORTED_NOT_VERIFIED",reason:"仅Child报告"}]}],
      pendingTasks:[{taskKey:"pending-original",reason:"BUDGET",sourceRanges:[]}]}],
    candidates:[{key:"canonical",name:"规则",state:"HUMAN_REVIEW",originRefs:["original"],evidence:[{materialId:"m",startLine:1,endLine:1}]}],relations:[],
    consolidation:{originalProposals:[{id:"original",origin:{taskKey:"task"},proposal:{private:"DO_NOT_EXPOSE"}}],sourceToCanonical:[{sourceKey:"original",canonicalKey:"canonical",status:"MERGED"}]}};
  const value=projectTaskEvidence(run,{graph,checkpoints:[{key:"business-task-manifest",generation:1,payload:{binding:"saved",data:manifest}}]});
  assert.equal(value.tasks[0].objective,"目标");assert.equal(value.tasks[0].propositions[0].key,"canonical");
  assert.deepEqual(value.tasks[0].propositions[0].mappingStatuses,["MERGED"]);
  assert.equal(value.tasks[0].obligations[0].status,"REPORTED_NOT_VERIFIED");
  assert.equal(value.pending[0].taskKey,"pending-original");assert.equal(value.runState,"COMPLETED");
  assert.equal(value.tasks[0].sourceRanges[0].readable,true);
  assert.ok(!JSON.stringify(value).includes("DO_NOT_EXPOSE"));
});
