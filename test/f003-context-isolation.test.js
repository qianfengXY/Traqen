import test from 'node:test';
import assert from 'node:assert/strict';
import {QuestionWorker} from '../src/business-knowledge/question-worker.js';
import {originalEvidenceContext} from '../src/business-knowledge/model-context.js';
import {selectStageTechnical,stageInput,jsonBytes,analysisStagePacket} from '../src/business-knowledge/stage-context.js';

// Explicit mechanism-only in-memory service/model ports, real production
// QuestionWorker and projections. No database, external model, pilot or truth.
const source={id:'raw',bundleId:'bundle',componentId:'component',pathBytes:'c291cmNlLnR4dA=='};
const raw={id:'raw',sourceMaterial:source,text:'SOURCE\n'};
const cite={materialId:'raw',startLine:1,endLine:1,quote:'SOURCE'};
const anchor={kind:'TEXT',lineStart:1,lineEnd:1};
function technical() {
  const p={versionIds:['v'],sourceBundleId:'bundle',records:[],objects:[],evidence:[],
    materials:[{versionId:'v',materialId:'m',sourceMaterial:source}],allowedFactIds:[],limitations:[],unresolved:[],truncated:false};
  for(const family of ['good','bad']) {
    const ids=Array.from({length:32},(_,i)=>`${family}-premise-${i}`);
    for(const id of [family,...ids]) {
      p.records.push({id,versionId:'v',record:{subjectId:id+'-object',predicate:'declares',basis:id==='bad'?'DERIVED':'OBSERVED',
        evidenceIds:[id+'-evidence'],premiseFactIds:id===family?ids:[]}});
      p.objects.push({objectId:id+'-object',versionId:'v',materialId:'m',kind:'DECLARATION',name:`${id}_${'read_scope_'.repeat(6)}`,anchor});
      p.evidence.push({evidenceId:id+'-evidence',versionId:'v',materialId:'m',anchor,quote:'SOURCE'});
      p.allowedFactIds.push(id);
    }
  }
  return p;
}
const graphObject=id=>({key:id,kind:'RULE',name:id,statement:'synthetic bounded rule',scope:'fixture',state:'ANALYSIS_ACCEPTED',evidence:[cite],technicalRefs:[id]});

async function runQuestion(withInvalid) {
  const packet=technical(),checkpoints=[],calls=[];
  const run={id:'question',purpose:'GRAPH_QUESTION',generation:1,question:'fixture rules',questionContext:{sessionId:'session',graphDigest:'fixed'},
    sourceInput:{bundleId:'bundle'},adoptedVersionIds:['v'],profile:{id:'profile',mainAgentSlot:{id:'main'},childAgentSlots:[{id:'child'}]},
    budget:{maxModelCalls:4,maxReadBytes:1024},usage:{readBytes:0,modelCalls:0},implementationVersion:{id:'review-mechanism'}};
  let answer;
  const investigations={get:async()=>run,expire:async()=>{},claim:async()=>run,heartbeat:async()=>{},checkpoints:async()=>checkpoints,
    checkpoint:async(_a,_w,_id,p)=>{checkpoints.push(p);},technicalEvidence:async()=>packet,
    readMaterial:async()=>{run.usage.readBytes+=7;return {sourceMaterial:source,bytes:Buffer.from(raw.text)};},
    completeQuestion:async(_a,_w,_id,p)=>{answer=p.answer;return answer;},fail:async()=>{},releaseForShutdown:async()=>{}};
  const workSessions={executionContext:async()=>({request:{requestDigest:'request',graphView:[graphObject('good'),graphObject('bad')]},
    endpoints:[],materials:[raw],coverage:[{materialId:'raw',sizeBytes:7}]})};
  const worker=new QuestionWorker({investigations,workSessions,invokeModel:async c=>{
    const i=c.input;calls.push(i);run.usage.modelCalls++;let result;
    if(i.phase==='PLAN')result={assignments:['good','bad'].map(id=>({slotId:'child',objectKeys:[id]}))};
    else if(i.operation==='DRAFT'){
      const o=i.objects[0];
      result=o.key==='bad'&&!withInvalid?{segments:[],unknowns:['no additional assertion']}
        :{segments:[{key:o.key,text:'synthetic assertion',stance:'SUPPORTED',graphRefs:[o.key],technicalRefs:[o.key],
          evidence:o.key==='good'?[cite]:[{...cite,materialId:'forged-raw'}],uncertainties:[]}],unknowns:[]};
    }else result={reviews:i.drafts.flatMap(d=>d.segments).map(s=>({key:s.key,support:'SUPPORTED',rationale:'mechanism-only deterministic reviewer',unresolvedConflicts:[]}))};
    return {result,reservationId:'reservation-'+calls.length};
  }});
  await worker.run({actorId:'reviewer'},'workspace','question',{workerId:'review-worker'});
  assert.ok(calls.every(i=>jsonBytes(i)<=128*1024&&jsonBytes(i.technicalEvidence)<=32*1024));
  for(const i of calls.filter(i=>i.operation==='DRAFT'))assert.ok(i.technicalEvidence.allowedFactIds.includes(i.objects[0].key));
  return {answer,calls,checkpoints};
}

test('worker positive: valid branch with 33-Fact closure is SUPPORTED without ineligible output',async()=>{
  const {answer}=await runQuestion(false);
  assert.equal(answer.segments.find(s=>s.localKey==='good').stance,'SUPPORTED');
});

test('worker: ineligible draft must not evict valid branch technical premises at Main',async()=>{
  const {answer,calls}=await runQuestion(true),good=answer.segments.find(s=>s.localKey==='good'),bad=answer.segments.find(s=>s.localKey==='bad');
  const main=calls.find(i=>i.operation==='VERIFY');
  console.log(JSON.stringify({kind:'REAL_QUESTION_WORKER_SYNTHETIC_PORTS',good:good.stance,goodReasons:good.guardReasons,
    bad:bad.stance,badReasons:bad.guardReasons,mainTechnicalBytes:jsonBytes(main.technicalEvidence),mainInputBytes:jsonBytes(main),
    goodFactSent:main.technicalEvidence.allowedFactIds.includes('good'),badFactSent:main.technicalEvidence.allowedFactIds.includes('bad')}));
  assert.ok(bad.guardReasons.includes('INVALID_ORIGINAL_REFERENCE'));
  assert.equal(good.stance,'SUPPORTED','an invalid sibling evicted the valid branch despite fitting original bounds');
  assert.ok(main.technicalEvidence.allowedFactIds.includes('good'));
  assert.ok(!main.technicalEvidence.allowedFactIds.includes('bad'));
  assert.equal(main.resourceContext.isolatedItems.count,1);
  assert.ok(main.drafts.every(d=>d.segments.every(s=>s.localKey!=='bad')));
  assert.equal(bad.stance,'UNKNOWN','invalid originals remain in the saved answer audit');
});

test('investigation Main projection: invalid proposal cannot evict valid technical closure either',()=>{
  const p=analysisStagePacket({phase:'VERIFY',operation:'VERIFY',candidates:[graphObject('good'),graphObject('bad')],relations:[],
    invalidProposalKeys:['bad'],technicalEvidence:technical()},[raw]);
  console.log(JSON.stringify({kind:'ANALYSIS_INVALID_TECHNICAL_EVICTION',goodFactSent:p.input.technicalEvidence.allowedFactIds.includes('good'),
    missing:p.input.evidenceContext.missingEvidence.map(g=>({key:g.key,reasons:g.reasons})),bytes:jsonBytes(p.input)}));
  assert.ok(p.input.technicalEvidence.allowedFactIds.includes('good'));
  assert.ok(!p.input.technicalEvidence.allowedFactIds.includes('bad'));
  assert.deepEqual(p.input.candidates.map(p=>p.key),['good']);
  assert.equal(p.input.resourceContext.isolatedItems.count,1);
});

test('actual original windows into supplement stage must union all ranges of one material',()=>{
  const body={...raw,text:Array.from({length:40},(_,i)=>`SOURCE_${i+1}`).join('\n')+'\n'};
  const observations=[1,30].map(line=>({key:`p${line}`,evidence:[{materialId:'raw',startLine:line,endLine:line,quote:`SOURCE_${line}`}]}));
  const windows=originalEvidenceContext(observations,[body]);
  assert.equal(windows.materials.length,2);
  const packet=technical();packet.records=packet.records.filter(r=>r.id==='good-premise-0');packet.allowedFactIds=['good-premise-0'];
  const control=stageInput({phase:'INVESTIGATE',technicalEvidence:packet,materials:[windows.materials[0]],existingCandidates:observations});
  assert.deepEqual(control.technicalEvidence.allowedFactIds,['good-premise-0']);
  const actual=stageInput({phase:'INVESTIGATE',technicalEvidence:packet,...windows,existingCandidates:observations});
  console.log(JSON.stringify({kind:'REAL_ORIGINAL_CONTEXT_SUPPLEMENT_PROJECTION',ranges:actual.materials.map(m=>[m.startLine,m.endLine]),
    selected:actual.technicalEvidence.allowedFactIds,selection:actual.technicalEvidence.selection,truncated:actual.technicalEvidence.truncated}));
  assert.deepEqual(actual.technicalEvidence.allowedFactIds,['good-premise-0']);
});
