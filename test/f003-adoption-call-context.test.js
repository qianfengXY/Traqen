import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {investigationFixture} from './support/f003-investigation-fixture.js';
import {owner} from './support/source-truth-database.js';
import {F002Repository} from '../src/deterministic-facts/repository.js';
import {F002AdmissionService} from '../src/deterministic-facts/admission.js';
import {F002Worker} from '../src/deterministic-facts/worker.js';
import {F002PublicationService} from '../src/deterministic-facts/publication-service.js';
import {F002RequestService,F002RequestDerivationService} from '../src/deterministic-facts/request-service.js';
import {createProfileId} from '../src/deterministic-facts/identity.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';

// Real F001/SQL/F002 extraction/C03 derivation/adoption. Only F006 resolution
// and model replies are doubles. No real model, semantics or quality claim.
const w='workspace';
async function fixture(t,maxModelCalls=6) {
  const f=await investigationFixture(t,{entryPath:'openapi.json',content:'{"openapi":"3.0.0","paths":{"/orders":{"get":{"responses":{"200":{"description":"ok"}}}}}}'});
  const facts=new F002Repository(f.db,{authorize:(a,id,tx,maintain)=>f.repository.authorize(a,id,maintain,tx)});
  const input={version:'1',schemaVersion:1,capabilityIds:['javascript'],ruleVersions:['javascript@1'],canonicalizationVersion:'1',
    extractionLimits:{maxBytes:8192,maxRecords:1000},redactionPolicyRevision:'policy-v1'};
  const profile={...input,id:createProfileId(input),startable:true};await facts.registerProfile(profile);
  const admission=new F002AdmissionService(facts,f.sourceAdmission),worker=new F002Worker(facts,{admission}),publication=new F002PublicationService(facts);
  const extraction=await admission.start(owner,w,{operationId:'initial-tech',reference:f.reference,profile,
    scopes:[{selections:[{kind:'COMPONENT',componentId:f.request.scope.componentIds[0]}]}]});
  const scope=await worker.run(owner,w,extraction.id,extraction.scopes[0].scopeId,{workerId:'initial',leaseMs:60000,timeoutMs:10000});
  const version=await publication.publish(owner,w,extraction.id,scope.scopeId,{revision:scope.revision,operationId:'initial-publish'});
  const expanded={...input,capabilityIds:['javascript','json'],ruleVersions:['javascript@1','json@1']};
  await facts.registerProfile({...expanded,id:createProfileId(expanded),startable:true});
  const run=await f.service.start(owner,w,{...f.request,technicalVersionId:version.graphVersionId,budget:{...f.request.budget,maxModelCalls}});
  const provider=new F002RequestService(facts,{resolver:f.service,expansion:new F002RequestDerivationService({repository:facts,admission,worker,publication})});
  async function adopt() {
    const binding=await f.service.resolve(owner,w,run.id);
    const request=await provider.submit(owner,w,{operationId:'expand-json',investigationId:run.id,baseVersionId:version.graphVersionId,
      requestKind:'CAPABILITY_EXPANSION',question:'补查JSON接口结构',factRefs:[],materialRefs:binding.allowedMaterialIds,requestedCapabilities:['json']});
    const receipt=await provider.execute(owner,w,request.id,{workerId:'expander',leaseMs:60000});assert.equal(receipt.outcome,'NEW_VERSION');
    const current=await f.service.get(owner,w,run.id);
    return f.service.adoptTechnicalVersion(owner,w,run.id,{requestId:request.id,versionId:receipt.result.graphVersionId,expectedRevision:current.revision});
  }
  return {...f,run,adopt};
}
const reserve=(f,run,extra={})=>f.service.reserveModelCall(owner,w,f.run.id,{generation:run.generation,slotId:'main',taskKey:'plan',phase:'PLAN',...extra});
const begin=(f,run,call)=>f.service.beginModelCall(owner,w,f.run.id,{generation:run.generation,reservationId:call.id});
const finish=(f,run,call,outcome)=>f.service.finishModelCall(owner,w,f.run.id,{generation:run.generation,reservationId:call.id,outcome});

test('F003 successful committed PLAN followed by actual NEW_VERSION adoption admits a distinct charged planning context',async t=>{
  const f=await fixture(t),old=await f.service.claim(owner,w,f.run.id,{workerId:'before'}),prior=await reserve(f,old);
  await begin(f,old,prior);await finish(f,old,prior,'SUCCEEDED');
  await f.service.checkpoint(owner,w,f.run.id,{generation:old.generation,key:'plan',payload:{binding:'old-basis',data:{assignments:[]},process:{reservationId:prior.id}}});
  const checkpoints=await f.service.checkpoints(owner,w,f.run.id),events=await f.service.events(owner,w,f.run.id);
  await f.adopt();const fresh=await f.service.claim(owner,w,f.run.id,{workerId:'after'}),next=await reserve(f,fresh);
  assert.notEqual(next.id,prior.id);assert.match(next.semanticContextDigest,/^[a-f0-9]{64}$/);
  assert.notEqual(next.semanticContextDigest,prior.semanticContextDigest);
  assert.equal((await f.service.get(owner,w,f.run.id)).usage.modelCalls,2);
  assert.deepEqual(await f.service.checkpoints(owner,w,f.run.id),checkpoints);
  assert.deepEqual((await f.service.events(owner,w,f.run.id)).slice(0,events.length),events);
  await assert.rejects(begin(f,old,prior),{code:'F003_STALE_WORKER'});
});

// Replay the actual pre-fix immutable event shape without rewriting a past
// event or pretending the missing new field authorizes another invocation.
async function legacyStarted(f,run,outcome=null) {
  const payload={id:randomUUID(),generation:run.generation,slotId:'main',taskKey:'plan',phase:'PLAN'};
  for(const type of ['MODEL_CALL_RESERVED','MODEL_CALL_STARTED',...(outcome?['MODEL_CALL_FINISHED']:[])])
    await f.db.query('INSERT INTO f003_investigation_event (workspace_id,investigation_id,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)',
      [w,f.run.id,owner.actorId,type,JSON.stringify(type==='MODEL_CALL_FINISHED'?{...payload,outcome,started:true}:payload)]);
  await f.db.query("UPDATE f003_investigation SET usage=jsonb_set(usage,'{modelCalls}','1') WHERE workspace_id=$1 AND id=$2",[w,f.run.id]);
  return payload;
}
test('F003 legacy STARTED unknown remains blocked on the same basis, but actual adoption creates a new task without refund or late-result inheritance',async t=>{
  const f=await fixture(t,2),old=await f.service.claim(owner,w,f.run.id,{workerId:'legacy'}),prior=await legacyStarted(f,old);
  await f.db.query("UPDATE f003_investigation SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.run.id]);
  const reclaimed=await f.service.claim(owner,w,f.run.id,{workerId:'reclaim'});
  await assert.rejects(reserve(f,reclaimed,{semanticContextDigest:'f'.repeat(64)}),{code:'F003_CALL_OUTCOME_UNKNOWN'});
  const paused=await f.service.control(owner,w,f.run.id,{action:'PAUSE',expectedRevision:(await f.service.get(owner,w,f.run.id)).revision});
  await f.service.control(owner,w,f.run.id,{action:'RESUME',expectedRevision:paused.revision});
  const resumed=await f.service.claim(owner,w,f.run.id,{workerId:'explicit'});
  await assert.rejects(reserve(f,resumed),{code:'F003_CALL_OUTCOME_UNKNOWN'});
  assert.equal((await f.service.get(owner,w,f.run.id)).usage.modelCalls,1);
  await f.adopt();const next=await f.service.claim(owner,w,f.run.id,{workerId:'new-basis'}),call=await reserve(f,next);
  assert.notEqual(call.id,prior.id);assert.equal((await f.service.get(owner,w,f.run.id)).usage.modelCalls,2);
  assert.equal((await finish(f,old,prior,'SUCCEEDED')).outcome,'DISCARDED');
  await begin(f,next,call);await finish(f,next,call,'FAILED');
  const p=await f.service.control(owner,w,f.run.id,{action:'PAUSE',expectedRevision:(await f.service.get(owner,w,f.run.id)).revision});
  await f.service.control(owner,w,f.run.id,{action:'RESUME',expectedRevision:p.revision});
  const last=await f.service.claim(owner,w,f.run.id,{workerId:'no-budget'});
  await assert.rejects(reserve(f,last),{code:'F003_BUDGET_EXCEEDED'});
  assert.equal((await f.service.get(owner,w,f.run.id)).usage.modelCalls,2);
});
test('F003 a legacy succeeded call on unchanged evidence cannot be replayed merely by reclaiming its lease',async t=>{
  const f=await fixture(t),old=await f.service.claim(owner,w,f.run.id,{workerId:'legacy'});
  await legacyStarted(f,old,'SUCCEEDED');
  await f.db.query("UPDATE f003_investigation SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.run.id]);
  const next=await f.service.claim(owner,w,f.run.id,{workerId:'same-basis'});
  await assert.rejects(reserve(f,next),{code:'F003_CALL_RETRY_REQUIRES_RESUME'});
  assert.equal((await f.service.get(owner,w,f.run.id)).usage.modelCalls,1);
});
test('F003 actual Worker re-plans after adopting new technical evidence and retains the successful old PLAN checkpoint only as history',async t=>{
  const f=await fixture(t),calls=[];let failed=false;
  const invokeModel=async context=>{
    const r=await f.service.reserveModelCall(owner,w,f.run.id,context);await f.service.beginModelCall(owner,w,f.run.id,{generation:context.generation,reservationId:r.id});
    calls.push(context);
    if(context.input.phase==='INVESTIGATE'&&!failed){failed=true;await f.service.finishModelCall(owner,w,f.run.id,{generation:context.generation,reservationId:r.id,outcome:'FAILED'});throw Object.assign(Error('known failure'),{code:'KNOWN_FAILURE'});}
    const result=context.input.phase==='PLAN'?{assignments:[{slotId:'child-1',objective:'接口声明哪些响应？',obligations:['核查冻结声明与未知执行'],
      materialKeys:context.input.inventory.filter(m=>m.kind==='FILE').map(m=>m.key)}],pendingMaterials:[]}
      :context.input.phase==='INVESTIGATE'?{candidates:[],relations:[],requestedMaterialKeys:[]}
        :context.input.stage==='CONSOLIDATE_PROPOSALS'?{mergeSuggestions:[],conflictGroups:[]}:{reviews:[]};
    await f.service.finishModelCall(owner,w,f.run.id,{generation:context.generation,reservationId:r.id,outcome:'SUCCEEDED'});return {reservationId:r.id,result};
  };
  await assert.rejects(new InvestigationWorker({investigations:f.service,invokeModel}).run(owner,w,f.run.id,{workerId:'old'}),{code:'KNOWN_FAILURE'});
  const oldCheckpoints=await f.service.checkpoints(owner,w,f.run.id),oldPlan=oldCheckpoints.find(p=>p.key==='plan');assert.ok(oldPlan);
  await f.service.control(owner,w,f.run.id,{action:'RESUME',expectedRevision:(await f.service.get(owner,w,f.run.id)).revision});
  // The real C03 resolver requires a running parent, just as in production.
  await f.service.claim(owner,w,f.run.id,{workerId:'adoption-owner'});await f.adopt();
  const result=await new InvestigationWorker({investigations:f.service,invokeModel}).run(owner,w,f.run.id,{workerId:'new'});
  assert.equal(result.state,'COMPLETED');assert.equal(result.usage.modelCalls,5);
  const plans=calls.filter(c=>c.input.phase==='PLAN');assert.equal(plans.length,2);
  assert.equal(plans[0].input.technicalEvidence.versionIds.length,1);assert.equal(plans[1].input.technicalEvidence.versionIds.length,2);
  const history=await f.service.checkpoints(owner,w,f.run.id),newPlan=history.filter(p=>p.key==='plan').at(-1);
  assert.deepEqual(history.find(p=>p.key==='plan'&&p.generation===oldPlan.generation),oldPlan);
  assert.notEqual(newPlan.payload.binding,oldPlan.payload.binding);
  assert.ok(!(await f.service.graph(owner,w,f.run.id)).process.some(p=>p.reservationId===oldPlan.payload.process.reservationId));
});
