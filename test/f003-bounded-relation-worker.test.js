import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {incrementalFixture,actor,workspace} from './support/f003-incremental-fixture.js';
import {isolatedPostgres} from './support/source-truth-postgres.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';
import {InvestigationService} from '../src/business-knowledge/investigation-service.js';
import {SourceTruthRepository} from '../src/source-truth/repository.js';
import {SourceMaterialRepository} from '../src/source-truth/material-repository.js';
import {SourceCandidateService} from '../src/source-truth/candidate-service.js';
import {SourceAdmissionService} from '../src/source-truth/admission-service.js';
import {resolveF003ImplementationVersion} from '../src/business-knowledge/implementation-version.js';
import {analysisInputBytes,stageTechnicalBytes,jsonBytes} from '../src/business-knowledge/stage-context.js';
import {analysisContractVersion} from '../src/business-knowledge/model-context.js';

test('native Main keeps one directed closure through aliasing, failed VERIFY/resume and offline reopening while omissions stay UNKNOWN',async t=>{
 const pg=await isolatedPostgres(t);let databaseName,failVerify=true,allCanonical=[];
 const files={'left.js':'export function left() { return true; }\n','right.js':'export function right() { return 1; }\n'};
 const modelResult=i=>{
  if(i.phase==='PLAN')return {assignments:[{slotId:'child-1',objective:'Inspect synthetic local declarations and their directed condition',
   obligations:['Check local raw declarations and directed applicability; no global inference'],materialKeys:i.inventory.map(m=>m.key)}],pendingMaterials:[]};
  if(i.phase==='INVESTIGATE') {
   const emit=(name,key)=>{
    const m=i.materials.find(m=>m.text.includes(`function ${name}()`));assert.ok(m);
    const o=i.technicalEvidence.objects.find(o=>o.name===name);assert.ok(o);
    const fact=i.technicalEvidence.records.find(r=>r.record.subjectId===o.objectId);assert.ok(fact);
    return {key,kind:'RULE',name,statement:`${name} local declaration: `+'z'.repeat(1600),scope:'Synthetic local condition only.',
     evidence:[{materialId:m.id,startLine:1,endLine:1,quote:m.text.trim()}],technicalRefs:[fact.id],uncertainties:[]};
   };
   const left=emit('left','left'),right=emit('right','right');
   const noise=Array.from({length:40},(_,n)=>({...left,key:`noise-${n}`,name:`noise ${n}`,technicalRefs:[]}));
   const edge={key:'edge',sourceKey:'left',targetKey:'right',predicate:'REQUIRES',
    scope:'Only the explicitly supplied local fixture condition.',evidence:[...left.evidence,...right.evidence],technicalRefs:[...left.technicalRefs,...right.technicalRefs],uncertainties:[]};
   return {candidates:[left,{...left,key:'alias-left'},right,...noise],relations:[edge,{...edge,key:'alias-edge',sourceKey:'alias-left'}],requestedMaterialKeys:[]};
  }
  const edge=i.relations[0];assert.ok(edge,`${i.stage} must supply a directed relation`);
  const endpoints=[edge.sourceKey,edge.targetKey].map(k=>i.candidates.find(p=>p.key===k));
  assert.ok(endpoints.every(Boolean),'both endpoints must receive separate Main reviews');
  assert.ok(i.candidates.some(p=>p.name.startsWith('noise')),'ordinary independent candidates remain supplied');
  assert.ok(jsonBytes(i)<=analysisInputBytes);assert.ok(jsonBytes(i.technicalEvidence)<=stageTechnicalBytes);
  assert.ok(i.evidenceContext.suppliedBytes<=65536);assert.deepEqual(i.evidenceContext.missingEvidence,[]);
  for(const p of [...endpoints,edge]) {
   for(const c of p.evidence)assert.ok(i.materials.some(m=>m.id===c.materialId&&m.text.includes(c.quote)));
   for(const ref of p.technicalRefs)assert.ok(i.technicalEvidence.allowedFactIds.includes(ref));
   const origins=i.originalProposals??i.consolidation.originalProposals;
   for(const ref of p.originRefs)assert.ok(origins.some(o=>o.id===ref));
  }
  assert.equal(endpoints[0].name,'left');assert.equal(endpoints[1].name,'right');
  if(i.stage==='CONSOLIDATE_PROPOSALS') {
   // A same-meaning alias changes the key before VERIFY. Ensure both actual
   // supplied copies enter the merge; otherwise keep them separate honestly.
   const same=i.candidates.filter(p=>p.name==='left');
   assert.equal(same.length,2);assert.equal(i.relations.length,2);
   return {mergeSuggestions:[{keys:same.map(p=>p.key),rationale:'Same supplied local declaration, unchanged meaning'},
    {keys:i.relations.map(p=>p.key),rationale:'Same supplied directed condition after endpoint aliasing'}],conflictGroups:[]};
  }
  if(failVerify){failVerify=false;throw Object.assign(Error('Synthetic known VERIFY failure'),{code:'SYNTHETIC_VERIFY_FAILURE'});}
  // Deliberately vote for unsupplied persisted keys too: the server, not the
  // fixture's cooperation, must keep those objects UNKNOWN.
  return {reviews:allCanonical.map(p=>({key:p.key,support:'SUPPORTED',rationale:'Fixture vote; only actually supplied closure can support it',
   premises:['Only the supplied local conditional declaration'],unresolvedConflicts:[]}))};
 };
 const f=await incrementalFixture(t,{files,modelResult,database:async()=>{const d=await pg.createDatabase();databaseName=d.name;return d;}});
 const implementation=await resolveF003ImplementationVersion();f.service.implementationVersion=implementation;
 const run=await f.service.start(actor,workspace,{...f.request,operationId:'bounded-directed-closure',question:'Explain the synthetic local directed condition.'});
 // Preserve the failed call as a charged, terminal attempt before explicit
 // resume. The fixture adapter does not start external processes.
 const invoke=async(c,service=f.service)=>{
  try{return await f.invoke(c,service);}
  catch(error){
   const calls=await f.db.query("SELECT payload FROM f003_investigation_event WHERE investigation_id=$1 AND event_type='MODEL_CALL_STARTED' AND (payload->>'generation')::int=$2",[run.id,c.generation]);
   for(const row of calls.rows)await service.finishModelCall(actor,workspace,run.id,{generation:c.generation,reservationId:row.payload.id,outcome:'FAILED',code:error.code});
   throw error;
  }
 };
 await assert.rejects(new InvestigationWorker({investigations:f.service,invokeModel:invoke}).run(actor,workspace,run.id,{workerId:'before-restart'}),{code:'SYNTHETIC_VERIFY_FAILURE'});
 const failed=await f.service.get(actor,workspace,run.id),checkpoints=await f.service.checkpoints(actor,workspace,run.id);
 assert.equal(failed.state,'FAILED');assert.equal(failed.usage.modelCalls,4);
 const mainInput=checkpoints.find(p=>p.key==='input-consolidation').payload.data;
 const canonical=checkpoints.find(p=>p.key==='consolidated-proposals').payload.data;
 allCanonical=[...canonical.candidates,...canonical.relations];
 assert.ok(mainInput.omitted.length>0);
 await pg.restart();
 const sources=new SourceTruthRepository(pg.pool(databaseName)),materials=new SourceMaterialRepository(sources),
  candidates=new SourceCandidateService(sources,materials,f.blobs),sourceAdmission=new SourceAdmissionService(sources,candidates);
 const service=new InvestigationService({sources,sourceAdmission,profiles:f.profiles,implementationVersion:implementation});
 await service.control(actor,workspace,run.id,{action:'RESUME',expectedRevision:failed.revision});
 await new InvestigationWorker({investigations:service,invokeModel:c=>invoke(c,service)}).run(actor,workspace,run.id,{workerId:'after-restart'});
 const done=await service.get(actor,workspace,run.id),graph=await service.graph(actor,workspace,run.id),edge=graph.relations[0];
 assert.equal(done.usage.modelCalls,5);assert.equal(done.usage.readBytes,failed.usage.readBytes);assert.equal(done.analysisContractVersion,analysisContractVersion);
 assert.equal(graph.candidates.length,42,'only the independently proposed same-meaning alias may merge; omissions are not deleted');
 assert.equal(edge.state,'ANALYSIS_ACCEPTED');
 for(const k of [edge.sourceKey,edge.targetKey])assert.equal(graph.candidates.find(p=>p.key===k).state,'ANALYSIS_ACCEPTED');
 assert.ok(graph.candidates.some(p=>p.state==='RETAINED_UNKNOWN'));
 assert.ok(graph.candidates.some(p=>p.verification?.contextGuard?.originalReview?.support==='SUPPORTED'));
 assert.equal(graph.quarantine.length,0);assert.equal(graph.published,false);
 const verification=f.calls.find(c=>c.input.stage==='EVIDENCE_VERIFICATION').input;
 for(const p of graph.candidates.filter(p=>!verification.candidates.some(c=>c.key===p.key)))assert.equal(p.state,'RETAINED_UNKNOWN');
 const finalCheckpoints=await service.checkpoints(actor,workspace,run.id),events=await service.events(actor,workspace,run.id);
 await pg.restart();
 const offlineSources=new SourceTruthRepository(pg.pool(databaseName));
 const offline=new InvestigationService({sources:offlineSources,sourceAdmission,profiles:{resolveActive:()=>{throw Error('offline');},assertUsable:()=>{throw Error('offline');}},implementationVersion:{status:'UNVERIFIED'}});
 assert.deepEqual(await offline.graph(actor,workspace,run.id),graph);
 assert.deepEqual(await offline.checkpoints(actor,workspace,run.id),finalCheckpoints);
 assert.deepEqual(await offline.events(actor,workspace,run.id),events);
 assert.deepEqual(await offline.get(actor,workspace,run.id),done);
 await pg.stop();assert.equal(existsSync(pg.data+'/postmaster.pid'),false);
 console.log(JSON.stringify({kind:'BOUNDED_RELATION_NATIVE_RECOVERY',graphDigest:graph.digest,sourceDigest:implementation.sourceDigest,
  contractVersion:analysisContractVersion,suppliedCandidates:verification.candidates.length,retainedUnknown:graph.candidates.filter(p=>p.state==='RETAINED_UNKNOWN').length,
  modelCalls:done.usage.modelCalls,readBytes:done.usage.readBytes,externalModels:0,pgRoot:pg.root,postmasterExited:true}));
});
