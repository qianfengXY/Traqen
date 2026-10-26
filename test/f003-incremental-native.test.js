import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPostgres} from './support/source-truth-postgres.js';
import {incrementalFixture,actor,workspace} from './support/f003-incremental-fixture.js';
import {SourceTruthRepository} from '../src/source-truth/repository.js';
import {SourceMaterialRepository} from '../src/source-truth/material-repository.js';
import {SourceCandidateService} from '../src/source-truth/candidate-service.js';
import {SourceAdmissionService} from '../src/source-truth/admission-service.js';
import {InvestigationService} from '../src/business-knowledge/investigation-service.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';
import {resolveF003ImplementationVersion} from '../src/business-knowledge/implementation-version.js';

test('native restart preserves exact unpublished basis/rebinding and charged checkpoints, then explicit resume invokes only failed current Main',async t=>{
  const pg=await isolatedPostgres(t);let databaseName;
  const f=await incrementalFixture(t,{database:async()=>{const db=await pg.createDatabase();databaseName=db.name;return db;}});
  const implementation=await resolveF003ImplementationVersion();f.service.implementationVersion=implementation;
  const a=await f.run({...f.request,operationId:'native-A'}),next=await f.next();
  const input={...f.request,...next,operationId:'native-B',baseInvestigationId:a.run.id,expectedBaseGraphDigest:a.graph.digest};
  const b=await f.service.startIncremental(actor,workspace,input);
  const failing=new InvestigationWorker({investigations:f.service,invokeModel:async c=>{
    if(c.input.stage!=='EVIDENCE_VERIFICATION')return f.invoke(c);
    const r=await f.service.reserveModelCall(actor,workspace,c.investigationId,c);
    await f.service.beginModelCall(actor,workspace,c.investigationId,{generation:c.generation,reservationId:r.id});
    await f.service.finishModelCall(actor,workspace,c.investigationId,{generation:c.generation,reservationId:r.id,outcome:'FAILED',code:'KNOWN_VERIFY_FAILURE'});
    throw Object.assign(Error('known synthetic verification failure'),{code:'KNOWN_VERIFY_FAILURE'});
  }});
  await assert.rejects(failing.run(actor,workspace,b.id,{workerId:'before-restart'}),{code:'KNOWN_VERIFY_FAILURE'});
  const before=await f.service.get(actor,workspace,b.id),events=await f.service.events(actor,workspace,b.id),
    checkpoints=await f.service.checkpoints(actor,workspace,b.id),calls=f.calls.length;
  assert.equal(before.state,'FAILED');assert.equal(before.usage.modelCalls,5);
  assert.equal(checkpoints.find(p=>p.key==='continuation-rebinding').payload.data.candidates[0].provenance.producer.investigationId,a.run.id);
  await pg.restart();
  const db=pg.pool(databaseName),sources=new SourceTruthRepository(db),materials=new SourceMaterialRepository(sources),
    candidates=new SourceCandidateService(sources,materials,f.blobs),sourceAdmission=new SourceAdmissionService(sources,candidates);
  const offlineProfiles={resolveActive:async()=>{throw Error('offline reads cannot resolve a model');},assertUsable:async()=>{throw Error('offline reads cannot invoke a model');}};
  const offline=new InvestigationService({sources,sourceAdmission,profiles:offlineProfiles,implementationVersion:{status:'UNVERIFIED'}});
  assert.deepEqual(await offline.get(actor,workspace,b.id),before);
  assert.deepEqual(await offline.checkpoints(actor,workspace,b.id),checkpoints);
  assert.deepEqual(await offline.events(actor,workspace,b.id),events);
  assert.deepEqual(await offline.graph(actor,workspace,a.run.id),a.graph);
  assert.equal((await offline.startIncremental(actor,workspace,input)).id,b.id);
  assert.equal(f.calls.length,calls,'offline recovery and same-operation reads perform zero model calls');
  const restored=new InvestigationService({sources,sourceAdmission,profiles:f.profiles,implementationVersion:implementation});
  await restored.control(actor,workspace,b.id,{action:'RESUME',expectedRevision:before.revision});
  await new InvestigationWorker({investigations:restored,invokeModel:c=>f.invoke(c,restored)}).run(actor,workspace,b.id,{workerId:'fresh-worker'});
  const done=await restored.get(actor,workspace,b.id),graph=await restored.graph(actor,workspace,b.id);
  assert.equal(done.usage.modelCalls,6);assert.equal(done.usage.readBytes,before.usage.readBytes);
  assert.equal(f.calls.length,calls+1);assert.equal(f.calls.at(-1).input.stage,'EVIDENCE_VERIFICATION');
  assert.equal(graph.continuation.mode,'INCREMENTAL_A_TO_B');
  assert.equal(graph.candidates.find(p=>p.name==='health').provenance.producer.investigationId,a.run.id);
  assert.deepEqual(done.continuationBasis,before.continuationBasis);
  console.log(JSON.stringify({kind:'NATIVE_INCREMENTAL_CHECKPOINT_RECOVERY_MECHANISM_ONLY',sourceDigest:implementation.sourceDigest,
    graphDigest:graph.digest,basisDigest:done.continuationBasis.digest,offlineModelCalls:0,resumedMainCalls:1,
    noRefund:true,realModel:false,realQuality:false,publicationOpened:false}));
});
