import assert from 'node:assert/strict';
import test from 'node:test';
import {investigationFixture} from './support/f003-investigation-fixture.js';
import {owner} from './support/source-truth-database.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';
import {InvestigationService} from '../src/business-knowledge/investigation-service.js';

// Actual F001/SQL/admission/worker; F006 and model replies are mechanism doubles.
const w='workspace';
const planFor=input=>({assignments:[{slotId:'child-1',objective:'哪些付款状态允许取消？',
  obligations:['找出允许条件并保留相反条件和缺失前提'],materialKeys:input.inventory.filter(m=>m.kind==='FILE').map(m=>m.key)}],pendingMaterials:[]});
function executor(f,calls,plan=planFor,reply=null) {
  return async context=>{
    const r=await f.service.reserveModelCall(owner,w,context.investigationId,context);
    await f.service.beginModelCall(owner,w,context.investigationId,{generation:context.generation,reservationId:r.id});
    calls.push(context);
    try {
      const result=await reply?.(context)??(context.input.phase==='PLAN'?plan(context.input):context.input.phase==='INVESTIGATE'
        ?{candidates:[],relations:[],requestedMaterialKeys:[]}:context.input.stage==='CONSOLIDATE_PROPOSALS'?{mergeSuggestions:[],conflictGroups:[]}:{reviews:[]});
      await f.service.finishModelCall(owner,w,context.investigationId,{generation:context.generation,reservationId:r.id,outcome:'SUCCEEDED'});
      return {reservationId:r.id,result};
    } catch(error) {
      await f.service.finishModelCall(owner,w,context.investigationId,{generation:context.generation,reservationId:r.id,outcome:'FAILED'});
      throw error;
    }
  };
}
test('F003 global question copied over physical fragments is not a bounded business plan',async t=>{
  const f=await investigationFixture(t,{content:'订单条件\n'.repeat(7000)}),calls=[],run=await f.service.start(owner,w,
    {...f.request,budget:{...f.request.budget,maxReadBytes:256*1024,maxModelCalls:8}});
  const worker=new InvestigationWorker({investigations:f.service,invokeModel:executor(f,calls,input=>({assignments:[{
    slotId:'child-1',objective:input.question,obligations:['重新回答整个问题'],materialKeys:input.inventory.map(m=>m.key)}],pendingMaterials:[]}))});
  await assert.rejects(worker.run(owner,w,run.id,{workerId:'worker'}),{code:'F003_PLAN_UNBOUNDED_TASK'});
  assert.deepEqual(calls.map(c=>c.input.phase),['PLAN']);
});
test('F003 exact-fit PLAN1 plus actual Child1 plus two Main calls needs no mandatory fifth retry',async t=>{
  const f=await investigationFixture(t),calls=[];
  const run=await f.service.start(owner,w,{...f.request,budget:{...f.request.budget,maxModelCalls:4}});
  const worker=new InvestigationWorker({investigations:f.service,invokeModel:executor(f,calls,planFor,({input})=>{
    if(input.phase==='INVESTIGATE')return {candidates:['allow','exclude'].map(key=>({key,kind:'RULE',name:key,statement:key,scope:'synthetic exact-fit condition',uncertainties:[],
      evidence:[{materialId:input.materials[0].id,startLine:1,endLine:1,quote:input.materials[0].text}]})),relations:[]};
  })});
  assert.equal((await worker.run(owner,w,run.id,{workerId:'exact-fit'})).state,'COMPLETED');
  assert.equal((await f.service.get(owner,w,run.id)).usage.modelCalls,4);
  assert.deepEqual(calls.map(c=>c.input.stage??c.input.phase),['PLAN','INVESTIGATE','CONSOLIDATE_PROPOSALS','EVIDENCE_VERIFICATION']);
  const saved = await f.service.get(owner,w,run.id), count = calls.length;
  const evidence = await f.service.taskEvidence(owner,w,run.id,{expectedRevision:saved.revision,expectedGraphDigest:saved.latestGraph.digest});
  assert.equal(evidence.snapshotKind,'SAVED_GRAPH');
  const child = evidence.tasks.find(task=>task.role==='CHILD');
  assert.equal(child.status,'RETURN_RECORDED');
  assert.equal(child.objective,'哪些付款状态允许取消？');
  assert.equal(child.obligations[0].status,'UNRESOLVED','missing obligation reports remain unresolved without verification');
  assert.equal(child.propositions.length,2);
  const graph = await f.service.graph(owner,w,run.id);
  const propositionIdentity = ({key,state,evidence})=>({key,state,evidence:evidence.map(({materialId,startLine,endLine})=>({materialId,startLine,endLine}))});
  assert.equal(graph.candidates.length,2);
  assert.deepEqual(child.propositions.map(propositionIdentity),graph.candidates.map(propositionIdentity));
  assert.deepEqual(child.propositions.map(p=>p.state),['RETAINED_UNKNOWN','RETAINED_UNKNOWN']);
  assert.ok(graph.candidates.every(p=>p.verification===null),'empty verification reviews do not accept candidates');
  assert.ok(child.propositions.every(p=>p.evidence.length>0&&p.evidence.every(e=>e.readable&&graph.materials.some(m=>m.id===e.materialId))));
  assert.ok(child.sourceRanges.every(range=>range.readable));
  assert.equal(evidence.tasks.filter(task=>task.role==='MAIN').length,3);
  assert.deepEqual(await f.service.taskEvidence(owner,w,run.id,{expectedRevision:saved.revision,expectedGraphDigest:saved.latestGraph.digest}),evidence);
  assert.equal(calls.length,count,'refresh projects persisted records without invoking a model');
  await assert.rejects(f.service.taskEvidence(owner,w,run.id,{expectedRevision:saved.revision,expectedGraphDigest:'0'.repeat(64)}),{code:'F003_TASK_EVIDENCE_CONFLICT'});
});
test('F003 preflight counts actual serialized fragments before any Child, retaining infeasible responsibilities',async t=>{
  const f=await investigationFixture(t,{content:'订单条件\n'.repeat(7000)}),calls=[];
  const run=await f.service.start(owner,w,{...f.request,budget:{...f.request.budget,maxReadBytes:256*1024,maxModelCalls:4}});
  const worker=new InvestigationWorker({investigations:f.service,invokeModel:executor(f,calls)});
  await assert.rejects(worker.run(owner,w,run.id,{workerId:'worker'}),{code:'F003_PLAN_CALL_BUDGET'});
  assert.deepEqual(calls.map(c=>c.input.phase),['PLAN']);
  const manifest=(await f.service.checkpoints(owner,w,run.id)).find(c=>c.key==='business-task-manifest').payload.data;
  assert.ok(manifest.tasks.length>1);
  assert.equal(manifest.responsibilities.length,1);
  assert.ok(manifest.tasks.every(c=>c.inputDigest && c.sourceRanges.length && c.inputBytes<=128*1024));
});
test('F003 actual sent task identity, obligations and manifest survive known failure and explicit charged resume',async t=>{
  const f=await investigationFixture(t),calls=[],run=await f.service.start(owner,w,{...f.request,budget:{...f.request.budget,maxModelCalls:6}});
  let first=true;
  const worker=new InvestigationWorker({investigations:f.service,invokeModel:executor(f,calls,planFor,context=>{
    if(context.input.phase==='INVESTIGATE'&&first){first=false;throw Object.assign(Error('known failure'),{code:'KNOWN_FAILURE'});}
  })});
  await assert.rejects(worker.run(owner,w,run.id,{workerId:'first'}),{code:'KNOWN_FAILURE'});
  const failed=await f.service.get(owner,w,run.id),before=await f.service.checkpoints(owner,w,run.id);
  const unfinished=await f.service.taskEvidence(owner,w,run.id,{expectedRevision:failed.revision,expectedGraphDigest:null});
  assert.equal(unfinished.snapshotKind,'CURRENT_CHECKPOINTS');
  assert.equal(unfinished.runState,'FAILED');
  assert.ok(unfinished.tasks.some(task=>task.role==='CHILD'&&task.status==='PENDING'));
  assert.ok(unfinished.tasks.every(task=>task.propositions.length===0));
  await f.service.control(owner,w,run.id,{action:'RESUME',expectedRevision:failed.revision});
  await worker.run(owner,w,run.id,{workerId:'second'});
  assert.equal(calls.filter(c=>c.input.phase==='PLAN').length,1);
  const child=calls.filter(c=>c.input.phase==='INVESTIGATE');
  assert.equal(child.length,2);assert.equal(child[0].taskKey,child[1].taskKey);
  assert.match(child[0].taskKey,/^child-[a-f0-9]{64}$/);
  assert.equal(child[0].input.task.obligations.length,1);
  assert.equal((await f.service.get(owner,w,run.id)).usage.modelCalls,4);
  const manifest=before.find(c=>c.key==='business-task-manifest').payload.data;
  assert.equal(manifest.tasks[0].taskKey,child[0].taskKey);
  assert.equal(manifest.tasks[0].inputDigest,(await f.service.graph(owner,w,run.id)).process.find(p=>p.taskKey===child[0].taskKey).inputDigest);
});
test('F003 pre-upgrade analysis remains readable and original create-operation replay is not a new admission',async t=>{
  const f=await investigationFixture(t),run=await f.service.start(owner,w,f.request);
  // Simulate the immutable payload of an actually admitted v9 run, not a new request flag.
  await f.db.query("UPDATE f003_investigation SET payload=jsonb_set(payload,'{analysisContractVersion}','9') WHERE id=$1",[run.id]);
  const fresh=new InvestigationService({sources:f.repository,sourceAdmission:f.sourceAdmission,profiles:{
    resolveActive:async()=>{throw Error('old operation must not re-admit');},assertUsable:async()=>{}}});
  assert.equal((await fresh.start(owner,w,f.request)).id,run.id);
  assert.equal((await fresh.get(owner,w,run.id)).analysisContractVersion,9);
  await assert.rejects(fresh.claim(owner,w,run.id,{workerId:'new-code'}),{code:'F003_ANALYSIS_CONTRACT_CHANGED'});
  assert.equal((await fresh.get(owner,w,run.id)).usage.modelCalls,0);
});

// Permanent form of root780's independent f4c1 RED and its passing contrast.
async function started(f,id,run) {
  const r=await f.service.reserveModelCall(owner,w,id,{generation:run.generation,slotId:'child-1',taskKey:'bounded-business-obligation',phase:'INVESTIGATE'});
  await f.service.beginModelCall(owner,w,id,{generation:run.generation,reservationId:r.id});return r;
}
test('F003 automatic lease reclaim cannot reserve an already STARTED unknown investigation call',async t=>{
  const f=await investigationFixture(t),admitted=await f.service.start(owner,w,f.request);
  const run=await f.service.claim(owner,w,admitted.id,{workerId:'old-worker'});await started(f,admitted.id,run);
  await f.db.query("UPDATE f003_investigation SET lease_until=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND id=$2",[w,admitted.id]);
  const replacement=await f.service.claim(owner,w,admitted.id,{workerId:'replacement'});
  await assert.rejects(f.service.reserveModelCall(owner,w,admitted.id,{generation:replacement.generation,slotId:'child-1',taskKey:'bounded-business-obligation',phase:'INVESTIGATE'}),{code:'F003_CALL_OUTCOME_UNKNOWN'});
  assert.equal((await f.service.get(owner,w,admitted.id)).usage.modelCalls,1);
});
test('F003 known failed invocation permits explicit charged RESUME attempt without refund; late old success stays discarded',async t=>{
  const f=await investigationFixture(t),admitted=await f.service.start(owner,w,f.request);
  const run=await f.service.claim(owner,w,admitted.id,{workerId:'old-worker'}),call=await started(f,admitted.id,run);
  await f.service.finishModelCall(owner,w,admitted.id,{generation:run.generation,reservationId:call.id,outcome:'FAILED'});
  const current=await f.service.get(owner,w,admitted.id);
  const paused=await f.service.control(owner,w,admitted.id,{action:'PAUSE',expectedRevision:current.revision});
  await f.service.control(owner,w,admitted.id,{action:'RESUME',expectedRevision:paused.revision});
  const replacement=await f.service.claim(owner,w,admitted.id,{workerId:'replacement'});
  const retry=await f.service.reserveModelCall(owner,w,admitted.id,{generation:replacement.generation,slotId:'child-1',taskKey:'bounded-business-obligation',phase:'INVESTIGATE'});
  assert.notEqual(retry.id,call.id);assert.equal((await f.service.get(owner,w,admitted.id)).usage.modelCalls,2);
  await f.service.beginModelCall(owner,w,admitted.id,{generation:replacement.generation,reservationId:retry.id});
  const state=await f.service.get(owner,w,admitted.id);
  await f.service.control(owner,w,admitted.id,{action:'CANCEL',expectedRevision:state.revision});
  assert.equal((await f.service.finishModelCall(owner,w,admitted.id,{generation:replacement.generation,reservationId:retry.id,outcome:'SUCCEEDED'})).outcome,'DISCARDED');
});
test('F003 eight actual business tasks resume four committed results inside the original twelve-call account',async t=>{
  const content=Array.from({length:8},(_,n)=>`CONDITION_${n+1}`).join('\n');
  const f=await investigationFixture(t,{content}),calls=[];
  const run=await f.service.start(owner,w,{...f.request,budget:{...f.request.budget,maxModelCalls:12}});
  const plan=input=>({assignments:Array.from({length:8},(_,n)=>({slotId:'child-1',objective:`条件组${n+1}的允许或拒绝前提是什么？`,
    obligations:[`核查第${n+1}组条件与未决前提`],materialKeys:[input.inventory[0].key],ranges:[{materialKey:input.inventory[0].key,startLine:n+1,endLine:n+1}]})),pendingMaterials:[]});
  let children=0,interrupted=false;
  const invoke=executor(f,calls,plan,({input})=>{
    if(input.phase==='INVESTIGATE'){
      if(++children===5&&!interrupted){interrupted=true;throw Object.assign(Error('known fifth-task failure'),{code:'KNOWN_FIFTH_FAILURE'});}
      const m=input.materials[0];return {candidates:[{key:'local-condition',kind:'RULE',name:m.text,statement:m.text,scope:'synthetic line responsibility',uncertainties:[],
        evidence:[{materialId:m.id,startLine:m.startLine,endLine:m.startLine,quote:m.text}]}],relations:[],requestedMaterialKeys:[],
        obligationResults:input.task.obligations.map(obligation=>({obligation,status:'EVIDENCE_FOUND',reason:'synthetic original line'}))};
    }
    if(input.stage==='EVIDENCE_VERIFICATION')return {reviews:input.candidates.map(c=>({key:c.key,support:'SUPPORTED',rationale:'mechanism double, not semantic score',premises:['fixed line'],unresolvedConflicts:[]}))};
  });
  const worker=new InvestigationWorker({investigations:f.service,invokeModel:invoke});
  await assert.rejects(worker.run(owner,w,run.id,{workerId:'first'}),{code:'KNOWN_FIFTH_FAILURE'});
  const before=await f.service.get(owner,w,run.id),history=await f.service.checkpoints(owner,w,run.id);
  const completed=history.filter(c=>c.key.startsWith('child-'));
  assert.equal(completed.length,4);assert.equal(before.usage.modelCalls,6);
  await f.service.control(owner,w,run.id,{action:'RESUME',expectedRevision:before.revision});
  await new InvestigationWorker({investigations:f.service,invokeModel:invoke}).run(owner,w,run.id,{workerId:'replacement'});
  const after=await f.service.get(owner,w,run.id),graph=await f.service.graph(owner,w,run.id);
  assert.equal(after.usage.modelCalls,12);assert.equal(after.usage.readBytes,before.usage.readBytes);
  assert.equal(graph.candidates.length,8);assert.equal(graph.process.filter(p=>p.taskKey?.startsWith('child-')&&p.reusedFromCheckpoint).length,4);
  for(const c of completed)assert.equal(calls.filter(p=>p.taskKey===c.key).length,1,'committed Child was not replayed');
  assert.equal(calls.filter(c=>c.input.phase==='PLAN').length,1);
  assert.deepEqual(calls.slice(-2).map(c=>c.input.stage),['CONSOLIDATE_PROPOSALS','EVIDENCE_VERIFICATION']);
});
test('F003 missing/v9/v10 legacy contract preserves graph/material/event reads, stopping and terminal audit without new semantic writes',async t=>{
  const f=await investigationFixture(t),calls=[],run=await f.service.start(owner,w,f.request);
  await new InvestigationWorker({investigations:f.service,invokeModel:executor(f,calls)}).run(owner,w,run.id,{workerId:'completed'});
  const graph=await f.service.graph(owner,w,run.id),events=await f.service.events(owner,w,run.id);
  for(const version of [null,9,10,11,12]) {
    await f.db.query("UPDATE f003_investigation SET payload=CASE WHEN $2::integer IS NULL THEN payload-'analysisContractVersion' ELSE jsonb_set(payload,'{analysisContractVersion}',to_jsonb($2::integer)) END WHERE id=$1",[run.id,version]);
    const before=await f.service.get(owner,w,run.id);
    assert.deepEqual(await f.service.graph(owner,w,run.id),graph);
    assert.deepEqual((await f.service.evidenceMaterial(owner,w,run.id,graph.materials[0].id)).bytes,f.bytes);
    assert.deepEqual(await f.service.events(owner,w,run.id),events);
    assert.equal((await f.service.start(owner,w,f.request)).id,run.id);
    assert.deepEqual(await f.service.get(owner,w,run.id),before);
  }
  const pending=await f.service.start(owner,w,{...f.request,operationId:'legacy-outbound'}),claimed=await f.service.claim(owner,w,pending.id,{workerId:'old'});
  const call=await started(f,pending.id,claimed);
  await f.db.query("UPDATE f003_investigation SET payload=payload-'analysisContractVersion' WHERE id=$1",[pending.id]);
  const current=await f.service.get(owner,w,pending.id);
  await f.service.control(owner,w,pending.id,{action:'CANCEL',expectedRevision:current.revision});
  const terminal=await f.service.finishModelCall(owner,w,pending.id,{generation:claimed.generation,reservationId:call.id,outcome:'SUCCEEDED'});
  assert.equal(terminal.outcome,'DISCARDED');assert.equal((await f.service.get(owner,w,pending.id)).usage.modelCalls,1);
  assert.equal((await f.service.get(owner,w,pending.id)).state,'CANCELLED');
});
test('F003 actual Worker sends responsibility windows only and persists every unsent byte gap as pending coverage',async t=>{
  const content='ONE\nTWO\nUNASSIGNED\nFOUR\nFIVE\n',f=await investigationFixture(t,{content}),calls=[];
  const run=await f.service.start(owner,w,f.request);
  const plan=i=>({assignments:[{...planFor(i).assignments[0],ranges:[{materialKey:i.inventory[0].key,startLine:1,endLine:2},
    {materialKey:i.inventory[0].key,startLine:4,endLine:5}]}],pendingMaterials:[]});
  await new InvestigationWorker({investigations:f.service,invokeModel:executor(f,calls,plan)}).run(owner,w,run.id,{workerId:'windows'});
  const child=calls.find(c=>c.input.phase==='INVESTIGATE').input;
  assert.deepEqual(child.materials.map(m=>[m.startLine,m.endLine]),[[1,2],[4,5]]);
  assert.ok(child.materials.every(m=>!m.text.includes('UNASSIGNED')));
  const graph=await f.service.graph(owner,w,run.id),coverage=graph.coverage.find(c=>c.kind==='FILE');
  assert.equal(coverage.modelInput.status,'PARTIALLY_SUPPLIED');
  assert.deepEqual(coverage.modelInput.pendingByteRanges,[[8,19]]);
  assert.ok(graph.process.at(-1).pendingTasks.some(p=>p.reason==='UNASSIGNED_SOURCE_RANGE'));
});
