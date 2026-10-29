import test from "node:test";
import assert from "node:assert/strict";
import {renderComponent} from "./support/render-components.mjs";
const {TaskEvidenceView}=await import("../app/business-knowledge/task-evidence.tsx");

test("the actual task view keeps reported obligations, pending work and original navigation keys distinct",()=>{
  const task={taskKey:"child-original",role:"CHILD",slotId:"child-1",responsibilityId:"responsibility",objective:"何时可取消？",
    status:"RETURN_RECORDED",reportAvailable:true,sourceRanges:[{materialId:"material-original",path:"orders.js",startLine:2,endLine:4,byteStart:10,byteEnd:90,readable:true}],
    obligations:[{obligation:"找到相反条件",status:"REPORTED_NOT_VERIFIED",reason:"Child报告有条件，Main尚须核查"}],crossTaskLeads:[],
    returnedCandidateCount:1,returnedRelationCount:0,propositions:[{key:"canonical-original",name:"取消规则",state:"HUMAN_REVIEW",mappingStatuses:["MERGED"],
      evidence:[{materialId:"material-original",startLine:2,endLine:4,readable:true}]}]};
  const value={version:1,runState:"COMPLETED",snapshotKind:"SAVED_GRAPH",snapshotGeneration:2,binding:{graphDigest:"a".repeat(64)},
    manifestAvailable:true,taskManifestDigest:"b".repeat(64),pendingInventoryAvailable:true,tasks:[task],
    pending:[{taskKey:"not-done",materialKey:null,reason:"MODEL_CALL_BUDGET_RESERVED_FOR_MAIN",sourceRanges:[]}],missing:[]};
  const selected=[],materials=[],props={value,onSelect:key=>selected.push(key),onMaterial:id=>materials.push(id)};
  const before=structuredClone(value),html=renderComponent(TaskEvidenceView,props);
  assert.match(html,/Child报告有依据，尚未核实/);assert.match(html,/存在歧义 · 待人工处理/);
  assert.match(html,/MODEL_CALL_BUDGET_RESERVED_FOR_MAIN/);assert.match(html,/未完成项 · 1/);
  assert.doesNotMatch(html,/已人工确认|全部完成/);
  const buttons=[];const visit=v=>{if(Array.isArray(v))return v.forEach(visit);if(!v||typeof v!=="object")return;
    if(v.type==="button")buttons.push(v);visit(v.props?.children);};
  visit(TaskEvidenceView(props));buttons.forEach(button=>button.props.onClick());
  assert.deepEqual(selected,["canonical-original"]);
  assert.ok(materials.length&&materials.every(id=>id==="material-original"));
  assert.deepEqual(value,before);
});

test("running and old/empty records cannot become completed reports or invented tasks",()=>{
  for(const snapshotKind of ["CURRENT_CHECKPOINTS","UNAVAILABLE"]){
    const html=renderComponent(TaskEvidenceView,{value:{version:1,runState:"RUNNING",snapshotKind,snapshotGeneration:null,
      binding:{graphDigest:null},manifestAvailable:false,taskManifestDigest:null,pendingInventoryAvailable:false,tasks:[],pending:[],missing:["TASK_MANIFEST_UNAVAILABLE"]},onSelect(){},onMaterial(){}});
    assert.match(html,/任务清单尚无可核实记录/);assert.match(html,/未完成清单尚无记录/);
    assert.doesNotMatch(html,/任务已完成|没有未完成任务|Child报告有依据/);
  }
});
