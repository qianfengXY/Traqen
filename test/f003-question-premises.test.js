import assert from 'node:assert/strict';
import test from 'node:test';
import {authorityFixture} from './support/f003-authority-fixture.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';
import {isolatedPostgres} from './support/source-truth-postgres.js';

const actor={actorId:'owner',tenantId:'tenant'};
// Real source, graph publication, QuestionWorker, checkpoints and stores.
// Reasoning/quality/recovery ports are explicit mechanism-only doubles.
async function premiseFixture(t,{native=false,relation=false,conflict=false,readBudget=131072}={}) {
  const seen=[], condition='RAW_CONDITION_ONLY_UNPAID';let allowId;
  const cluster=native?await isolatedPostgres(t):null, database=cluster?()=>cluster.createDatabase():undefined;
  const f=await authorityFixture(t,{database,sourceOptions:{entryPath:'a.md',content:'ALLOW_CANCEL\n',additionalFiles:[
    {entryPath:'b.md',content:condition+' ANCHOR '+'.'.repeat(1000)+'\n'},
    {entryPath:'c.md',content:'CANCEL_INVOKES_RELEASE\n'}]},modelExecutor:service=>async c=>{
    const reservation=await service.reserveModelCall(actor,'workspace',c.investigationId,{...c,phase:c.input.phase});
    await service.beginModelCall(actor,'workspace',c.investigationId,{generation:c.generation,reservationId:reservation.id});
    const i=c.input;seen.push(i);
    const result=i.phase==='PLAN'?{assignments:[{slotId:i.childSlots[0].id,objectKeys:i.objects.map(o=>o.key)}]}
      :i.operation==='DRAFT'?{segments:(conflict?i.objects:[i.objects[0]]).map((o,n)=>({key:`answer-${n}`,text:'仅未支付订单可以取消。',stance:'SUPPORTED',graphRefs:[o.key],
        evidence:relation||conflict?o.evidence:o.evidence.filter(e=>e.materialId===allowId),technicalRefs:[],uncertainties:[]})),unknowns:[]}
        :{reviews:i.drafts.flatMap(d=>d.segments).map(s=>({key:s.key,support:'SUPPORTED',rationale:'mechanism-only generic review',unresolvedConflicts:[]})),
          ...(conflict?{conflictGroups:[{keys:i.drafts.flatMap(d=>d.segments).map(s=>s.key),rationale:'explicit unresolved condition conflict, including bounded context gap'}]}:{})};
    await service.finishModelCall(actor,'workspace',c.investigationId,{generation:c.generation,reservationId:reservation.id,outcome:'SUCCEEDED'});
    return {result,reservationId:reservation.id};
  }});
  const s=f.runtime.services;s.investigations.profiles=f.profiles;s.investigations.implementationVersion=f.investigations.implementationVersion;
  const run=await s.investigations.start(actor,'workspace',{...f.request,operationId:'premise-graph',budget:{...f.request.budget,maxReadBytes:131072}});
  const worker=new InvestigationWorker({investigations:s.investigations,invokeModel:async c=>{
    const reservation=await s.investigations.reserveModelCall(actor,'workspace',run.id,c),i=c.input;let result;
    if(i.phase==='PLAN')result={assignments:[{slotId:'child-1',obligations:["核查本任务原文条件、反例与未供应前提（机制替身）"],objective:'read fixed sources',materialKeys:i.inventory.map(m=>m.key)}]};
    else if(i.phase==='INVESTIGATE'){
      const a=i.materials.find(m=>m.text.includes('ALLOW_CANCEL')),b=i.materials.find(m=>m.text.includes(condition)),edge=i.materials.find(m=>m.text.includes('CANCEL_INVOKES_RELEASE'));
      assert.ok(a&&b&&edge);allowId=a.id;
      const citation=(m,quote)=>({materialId:m.id,startLine:1,endLine:1,quote});
      const candidate={key:'rule',kind:relation?'FUNCTION':'RULE',name:'取消',statement:'未支付订单可取消',scope:'固定冻结原文',uncertainties:[],
        evidence:[citation(a,'ALLOW_CANCEL'),citation(b,'ANCHOR')],technicalRefs:[]};
      result={candidates:conflict?[{...candidate,evidence:[citation(a,'ALLOW_CANCEL')]},{...structuredClone(candidate),key:'conditional-rule'}]
        :[candidate,...(relation?[{...structuredClone(candidate),key:'release',name:'释放库存',statement:'取消后释放库存'}]:[])],
        relations:relation?[{key:'invokes',sourceKey:'rule',targetKey:'release',predicate:'INVOKES',scope:'同一未支付订单',
          evidence:[citation(edge,'CANCEL_INVOKES_RELEASE')],technicalRefs:[]}]:[]};
    }else result={reviews:[...(i.candidates??[]),...(i.relations??[])].map(o=>({key:o.key,support:'SUPPORTED',rationale:'mechanism graph',
      premises:['All original sources jointly supply necessary conditions.'],unresolvedConflicts:[]}))};
    return {result,reservationId:reservation.id};
  }});
  await worker.run(actor,'workspace',run.id,{workerId:'premise-graph-worker'});
  const graph=await s.investigations.graph(actor,'workspace',run.id),object=relation?graph.relations[0]:graph.candidates[0];
  assert.equal(object.state,'ANALYSIS_ACCEPTED');
  const pub=await f.publishAnalysis(run.id,graph,{operationId:'premise-publish',expectedHeadVersion:1});
  const {session}=await s.workSessions.create(actor,'workspace',pub.publication.graphRevisionId,{operationId:'premise-session',expectedGraphDigest:graph.digest,title:'premise mechanism only'});
  const q=await s.workSessions.ask(actor,'workspace',session.id,{operationId:'premise-question',expectedSessionVersion:1,expectedProfileId:f.request.expectedProfileId,
    question:'说明本版允许条件',objectKeys:conflict?graph.candidates.map(o=>o.key):[object.key],budget:{maxReadBytes:readBudget,maxModelCalls:5,deadline:'2099-01-01T00:00:00Z'}});
  s.executor.enqueue(q.run);await s.executor.drain();
  const result=await s.workSessions.question(actor,'workspace',session.id,q.run.id);
  assert.equal(result.run.state,'COMPLETED',JSON.stringify(result.run.lastFailure));
  return {...f,s,session,q,result,seen,condition,object};
}

test('F003 QA native Main verifies every referenced graph premise even when Child cites only a harmless subset',async t=>{
  const f=await premiseFixture(t,{native:true});
  const sees=i=>i.materials.some(m=>m.text.includes(f.condition));
  assert.equal(sees(f.seen.find(i=>i.operation==='DRAFT')),true);
  assert.equal(sees(f.seen.find(i=>i.operation==='VERIFY')),true,'Main must read B, not just the Child-selected A or its short ANCHOR quote');
  assert.equal(f.result.answer.segments[0].stance,'SUPPORTED');
  assert.equal(f.result.answer.segments[0].evidence.length,1);
  const count=async()=>(await f.db.query('SELECT count(*)::int n FROM source_truth_event')).rows[0].n,before=await count();
  const response=await fetch(`${f.root}/work-sessions/${f.session.id}/questions/${f.q.run.id}`,{headers:f.headers});
  assert.equal(response.status,200);const reopened=await response.json();assert.deepEqual(reopened.answer,f.result.answer);
  assert.equal(reopened.answer.questionContractVersion,4);assert.deepEqual(reopened.answer.premiseContext.missingEvidence,[]);
  assert.deepEqual(reopened.answer.premiseContext.premises[0].graphKeys,[f.object.key]);assert.equal(await count(),before);
});

test('F003 QA selected directed relation brings both endpoints and their original conditions to Child and Main',async t=>{
  const f=await premiseFixture(t,{relation:true});
  for(const operation of ['DRAFT','VERIFY']) {
    const i=f.seen.find(i=>i.operation===operation);
    assert.ok(i.materials.some(m=>m.text.includes(f.condition)),`${operation} lacks endpoint premises`);
    assert.ok(i.materials.some(m=>m.text.includes('CANCEL_INVOKES_RELEASE')));
    assert.equal(i.objects[0].sourceKey,f.object.sourceKey);assert.equal(i.objects[0].targetKey,f.object.targetKey);
  }
  assert.equal(f.result.answer.segments[0].stance,'SUPPORTED');
});

test('F003 QA bounded missing joint premise cannot be restored by generic SUPPORTED or a visible small subset',async t=>{
  const f=await premiseFixture(t,{readBudget:32});
  const s=f.result.answer.segments[0];assert.equal(s.stance,'UNKNOWN');
  assert.ok(s.guardReasons.includes('ORIGINAL_CONTEXT_INCOMPLETE'));
  assert.ok(f.result.answer.readGaps.length>0);assert.ok(f.result.run.usage.readBytes<=32);
});

test('F003 QA missing raw context does not erase an explicit unresolved conflict and promote its other valid branch',async t=>{
  const f=await premiseFixture(t,{conflict:true,readBudget:32});
  assert.equal(f.result.answer.conflicts.length,1);assert.equal(f.result.answer.segments.length,2);
  for(const s of f.result.answer.segments) {assert.equal(s.stance,'UNKNOWN');assert.ok(s.guardReasons.includes('UNRESOLVED_ANSWER_CONFLICT'));}
  assert.ok(f.result.answer.segments.some(s=>s.guardReasons.includes('ORIGINAL_CONTEXT_INCOMPLETE')));
});
