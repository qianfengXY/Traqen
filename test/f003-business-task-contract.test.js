import test from 'node:test';
import assert from 'node:assert/strict';
import {businessPlan,bindBusinessTask,responsibilityMaterials,futureTaskBudget} from '../src/business-knowledge/business-tasks.js';
import {partitionOriginalMaterials} from '../src/business-knowledge/model-context.js';
import {analysisStagePacket,jsonBytes} from '../src/business-knowledge/stage-context.js';
const inventory=[{key:'a',kind:'FILE'},{key:'b',kind:'FILE'},{key:'directory',kind:'DIRECTORY'}];
const context={inventory,visibleKeys:new Set(inventory.map(m=>m.key)),childIds:new Set(['child']),question:'完整业务规则是什么？'};
const assignment=(key='a')=>({slotId:'child',objective:key==='a'?'何时允许取消？':'何时必须拒绝退款？',obligations:['核查相反条件'],materialKeys:[key]});
const plan=()=>({assignments:[assignment('a'),assignment('b')],pendingMaterials:[]});
test('bounded Main contract rejects omitted responsibility, forged ids and duplicate semantic tasks',()=>{
  assert.throws(()=>businessPlan({assignments:[assignment()]},context),{code:'F003_PLAN_COVERAGE_GAP'});
  assert.throws(()=>businessPlan({assignments:[{...assignment(),taskId:'child-0'}]},context),{code:'F003_MODEL_OUTPUT_INVALID'});
  assert.throws(()=>businessPlan({assignments:[assignment(),assignment()]},context),{code:'F003_PLAN_DUPLICATE_TASK'});
  assert.throws(()=>businessPlan({assignments:[{...assignment(),materialKeys:['forged']}]},context),{code:'F003_MODEL_OUTPUT_INVALID'});
  const a=businessPlan(plan(),context),b=businessPlan({...plan(),assignments:plan().assignments.reverse()},context);
  assert.deepEqual(a,b,'model array order is not identity');
  assert.ok(a.pending.some(p=>p.materialKey==='directory'&&p.status==='PENDING'));
});
test('overlapping premises require explicit responsibility; disjoint windows do not expand to entire source',()=>{
  const assignments=[{...assignment(),ranges:[{materialKey:'a',startLine:1,endLine:2}]},
    {...assignment(),objective:'什么条件应拒绝？',ranges:[{materialKey:'a',startLine:5,endLine:6}]}];
  const p=businessPlan({assignments,pendingMaterials:[{materialKey:'b',reason:'待调查'}]},context);
  const material={id:'raw',text:'one\ntwo\nTHREE\nFOUR\nfive\nsix\n',sourceMaterial:{id:'raw'}};
  const windows=p.assignments.flatMap(a=>responsibilityMaterials(a,new Map([['a',material]])));
  const fragments=windows.flatMap(m=>partitionOriginalMaterials([m],2048,{serialized:true}).flat());
  assert.deepEqual(fragments.map(m=>m.startLine).sort((a,b)=>a-b),[1,5]);
  assert.ok(fragments.every(m=>!m.text.includes('THREE')&&!m.text.includes('FOUR')));
  assert.ok(fragments.some(m=>m.byteStart===19&&m.endLine===6));
  assert.throws(()=>businessPlan({assignments:[assignment(),{...assignment(),objective:'核查拒绝条件'}],pendingMaterials:[{materialKey:'b',reason:'待调查'}]},context),{code:'F003_PLAN_DUPLICATED_EVIDENCE'});
});
test('actual packet/source/obligations/technical closure/slot bind identity, not global allowed Fact ids',()=>{
  const a=businessPlan(plan(),context).assignments[0];
  const run={question:context.question,sourceInput:{bundle:'frozen',receipt:'receipt'},adoptedVersionIds:['v'],profile:{id:'p',childAgentSlots:[{id:'child',modelProfileRevisionId:'model'}]}};
  const input={task:{question:a.objective,obligations:a.obligations},materials:[{id:'raw',text:'line',byteStart:0,byteEnd:4,startLine:1,endLine:1}],
    technicalEvidence:{allowedFactIds:['actually-sent'],records:[{id:'actually-sent',record:{premiseFactIds:['premise']}}]},outputContract:{candidates:[]}};
  const original=bindBusinessTask(run,a,input);
  for(const mutate of [p=>{p.task.question='另一个具体问题';},p=>{p.task.obligations=['不同前提'];},p=>{p.materials[0].byteStart=2;},
    p=>{p.technicalEvidence.records[0].record.premiseFactIds=[];},p=>{p.outputContract.candidates=['new contract'];}]){
    const changed=structuredClone(input);mutate(changed);assert.notEqual(bindBusinessTask(run,a,changed).taskKey,original.taskKey);
  }
  assert.notEqual(bindBusinessTask({...run,sourceInput:{bundle:'other',receipt:'receipt'}},a,input).taskKey,original.taskKey);
});
test('remaining budget counts only uncommitted actual calls and never refunds failed expenditure',()=>{
  const manifest={tasks:Array.from({length:8},(_,n)=>({taskKey:'task-'+n}))},cached=new Map();
  const first=futureTaskBudget(manifest,{usage:{modelCalls:1},maxModelCalls:12,cached});
  assert.deepEqual([first.requiredCalls,first.discretionaryCalls,first.feasible],[10,1,true]);
  for(let n=0;n<4;n++)cached.set('task-'+n,{});
  const recovered=futureTaskBudget(manifest,{usage:{modelCalls:6},maxModelCalls:12,cached});
  assert.deepEqual([recovered.requiredCalls,recovered.discretionaryCalls,recovered.feasible],[6,0,true]);
  assert.equal(futureTaskBudget(manifest,{usage:{modelCalls:7},maxModelCalls:12,cached}).feasible,false);
});
test('exact-fit remaining calls are feasible without compulsory spare; a charged failure is never refunded',()=>{
  const manifest={tasks:Array.from({length:9},(_,n)=>({taskKey:'task-'+n}))},cached=new Map();
  const exact=futureTaskBudget(manifest,{usage:{modelCalls:1},maxModelCalls:12,cached});
  assert.equal(exact.feasible,true);assert.equal(exact.discretionaryCalls,0);
  assert.equal(futureTaskBudget(manifest,{usage:{modelCalls:2},maxModelCalls:12,cached}).feasible,false);
  const pending={tasks:[{taskKey:'remaining'}]};
  assert.equal(futureTaskBudget(pending,{usage:{modelCalls:3},maxModelCalls:6,cached}).feasible,true);
});
test('Main responsibility routing cannot crowd the bounded semantic packet; omitted reports remain explicit pending',()=>{
  const reports=Array.from({length:32},(_,n)=>({taskKey:'child-'+n,obligations:Array.from({length:16},()=>({obligation:'condition '.repeat(200),status:'UNRESOLVED',reason:'missing '.repeat(200)}))}));
  const input=analysisStagePacket({phase:'VERIFY',candidates:[],relations:[],taskReports:reports,pendingResponsibilities:[],
    technicalEvidence:{versionIds:[],sourceBundleId:'b',records:[],objects:[],evidence:[],materials:[],allowedFactIds:[],unresolved:[],limitations:[],truncated:false}}).input;
  assert.ok(jsonBytes(input)<=128*1024);
  assert.equal(input.taskReportCoverage.total,32);
  assert.ok(input.taskReportCoverage.pending>0);
  assert.equal(input.taskReportCoverage.authority,'ROUTING_NOT_EVIDENCE');
});
