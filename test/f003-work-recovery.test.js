import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {questionFixture,questionActor as actor} from './support/f003-question-fixture.js';
import {isolatedPostgres} from './support/source-truth-postgres.js';
import {recoverSourceFixtureIdentity} from './support/source-truth-recovery-identity.js';
import {SourceTruthRepository} from '../src/source-truth/repository.js';
import {SourceBackupService} from '../src/source-truth/backup-service.js';
import {SourceTruthBlobStore} from '../src/source-truth/blob-store.js';
import {SourceAdmissionService} from '../src/source-truth/admission-service.js';
import {SourceMaterialRepository} from '../src/source-truth/material-repository.js';
import {SourceCandidateService} from '../src/source-truth/candidate-service.js';
import {InvestigationService} from '../src/business-knowledge/investigation-service.js';
import {F003PublicationService} from '../src/business-knowledge/publication-service.js';
import {F003WorkSessionService} from '../src/business-knowledge/work-session-service.js';
import {F003PublishedReadService} from '../src/business-knowledge/published-read-service.js';
import {F003AuthorityService} from '../src/business-knowledge/authority-service.js';

test('F003 native restart and actual paired archive restore preserve answers, feedback, continuation, unknown call budgets and audit offline',
  {skip:!process.env.F001_TEST_PG_BIN,timeout:120000},async t=>{
  const cluster=await isolatedPostgres(t);let databaseName;
  const f=await questionFixture(t,{database:async()=>{const d=await cluster.createDatabase();databaseName=d.name;return d;}});
  const q=await f.ask();f.s.executor.enqueue(q.run);await f.s.executor.drain();const answered=await f.read(q.run.id);
  assert.equal(answered.run.state,'COMPLETED');
  const pending=await f.ask({operationId:'unknown-call',expectedSessionVersion:2});
  const claimed=await f.s.investigations.claim(actor,'workspace',pending.run.id,{workerId:'interrupted',leaseMs:60000});
  const reserved=await f.s.investigations.reserveModelCall(actor,'workspace',pending.run.id,{generation:claimed.generation,slotId:'main',taskKey:'qa-plan',phase:'PLAN'});
  await f.s.investigations.beginModelCall(actor,'workspace',pending.run.id,{generation:claimed.generation,reservationId:reserved.id});
  await f.s.investigations.releaseForShutdown(actor,'workspace',pending.run.id,{generation:claimed.generation,workerId:'interrupted'});
  const {feedback}=await f.s.workSessions.feedback(actor,'workspace',f.session.id,{operationId:'persist-feedback',expectedSessionVersion:3,
    graphDigest:f.graph.digest,objectKey:f.graph.candidates[0].key,answerId:answered.answer.id,kind:'CORRECTION',message:'review a missing premise, not approval'});
  const selection={reference:f.reference,scope:f.request.scope,technicalVersionId:null};
  const changes=await f.s.workSessions.continuationPreview(actor,'workspace',f.session.id,selection);
  const next=await f.s.workSessions.continue(actor,'workspace',f.session.id,{...selection,operationId:'persist-continuation',expectedSessionVersion:4,
    expectedChangeSetDigest:changes.changeSetDigest,expectedProfileId:f.request.expectedProfileId,question:'a new explicitly requested investigation',
    budget:f.request.budget,supplementBudget:f.request.supplementBudget});
  const beforeSession=await f.s.workSessions.get(actor,'workspace',f.session.id),beforePending=await f.read(pending.run.id),
    beforeNext=await f.s.workSessions.get(actor,'workspace',next.session.id);
  const records=async db=>(await db.query(`SELECT record_type,id,record_payload FROM understanding_record WHERE record_type IN
    ('WORK_SESSION','WORK_SESSION_EVENT','KNOWLEDGE_QUESTION','KNOWLEDGE_ANSWER','KNOWLEDGE_FEEDBACK') ORDER BY record_type,id`)).rows;
  const audit=async db=>(await db.query("SELECT event_type,payload,actor_id FROM source_truth_event WHERE event_type LIKE 'F003_%' ORDER BY sequence")).rows;
  const beforeRecords=await records(f.db),beforeAudit=await audit(f.db),calls=f.calls.length;
  const rid=f.published.publication.graphRevisionId;
  const discoveryBefore=await f.s.workSessions.list(actor,'workspace');
  const operationBefore=await f.s.workSessions.operation(actor,'workspace','persist-continuation',{kind:'CONTINUATION'});
  const pendingOperationBefore=await f.s.workSessions.operation(actor,'workspace','unknown-call',{kind:'QUESTION'});
  assert.equal(pendingOperationBefore.question.run.usage.modelCalls,1);
  const publishedBefore=await f.s.publishedReads.graph(actor,'workspace',rid,{view:'IMPLEMENTATION'});
  const materialBefore=await f.s.publishedReads.material(actor,'workspace',rid,f.graph.materials[0].id);
  await f.closeHttp();await cluster.restart();const db=cluster.pool(databaseName);
  const services=(database,blobs)=>{
    const sources=new SourceTruthRepository(database),sourceAdmission=new SourceAdmissionService(sources,new SourceCandidateService(sources,new SourceMaterialRepository(sources),blobs));
    const investigations=new InvestigationService({sources,sourceAdmission,profiles:{resolveActive:async()=>{throw Error('offline');},assertUsable:async()=>{throw Error('offline');}}});
    const publications=new F003PublicationService({sources,sourceReader:sourceAdmission});
    const authorityBindings=new F003AuthorityService({sources,publications});
    return {sources,publications,work:new F003WorkSessionService({sources,publications,investigations}),
      published:new F003PublishedReadService({sources,admission:sourceAdmission,publications,authorityBindings})};
  };
  const restarted=services(db,f.blobs);
  assert.deepEqual(await restarted.work.question(actor,'workspace',f.session.id,q.run.id),answered);
  assert.deepEqual(await restarted.work.get(actor,'workspace',f.session.id),beforeSession);
  assert.deepEqual(await restarted.work.question(actor,'workspace',f.session.id,pending.run.id),beforePending);
  assert.deepEqual(await restarted.work.list(actor,'workspace'),discoveryBefore);
  assert.deepEqual(await restarted.work.operation(actor,'workspace','persist-continuation',{kind:'CONTINUATION'}),operationBefore);
  assert.deepEqual(await restarted.work.operation(actor,'workspace','unknown-call',{kind:'QUESTION'}),pendingOperationBefore);
  const restartedView=await restarted.published.graph(actor,'workspace',rid,{view:'IMPLEMENTATION'});
  assert.equal(restartedView.graphDigest,publishedBefore.graphDigest);assert.equal(restartedView.graphRevisionId,rid);
  assert.deepEqual(await restarted.published.material(actor,'workspace',rid,f.graph.materials[0].id),materialBefore);
  assert.deepEqual(await records(db),beforeRecords);assert.deepEqual(await audit(db),beforeAudit);
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'traqen-f003-work-paired-')));
  // Actual pg_dump and encrypted material copy into new empty database and
  // material directory. Synthetic volume probe is NOT protected-media evidence.
  const backup=new SourceBackupService({repository:restarted.sources,blobs:f.blobs,configuration:{targetId:'work-paired-mechanism',root,maxBytes:'536870912',
    postgres:{binDirectory:cluster.bin,connection:cluster.connection(databaseName)},keyRecoveryOwner:'fixture-only',recoveryKeys:Object.fromEntries(f.blobs.keys),
    volumeProbe:async p=>({encrypted:true,permissionsEnforced:true,persistent:true,filesystemId:p.startsWith(root)?'test-backup':'test-main',
      physicalStores:[p.startsWith(root)?'SYNTHETIC-B':'SYNTHETIC-A']})}});
  const saved=await backup.create({requestedBy:'fixture-only'}),destination=await cluster.createDatabase({seed:false});
  const blobs=await SourceTruthBlobStore.open({root:await mkdtemp(path.join(tmpdir(),'traqen-f003-work-restored-')),keyVersion:'test',keys:Object.fromEntries(f.blobs.keys)});
  await backup.restore({backupId:saved.id,database:destination.db,blobs,postgres:{binDirectory:cluster.bin,connection:cluster.connection(destination.name)},requestedBy:'fixture-only'});
  const restored=services(destination.db,blobs);
  await assert.rejects(()=>restored.work.get(actor,'workspace',f.session.id),{status:403});await recoverSourceFixtureIdentity(destination.db);
  assert.deepEqual(await restored.work.question(actor,'workspace',f.session.id,q.run.id),answered);
  assert.deepEqual(await restored.work.question(actor,'workspace',f.session.id,pending.run.id),beforePending);
  assert.deepEqual(await restored.work.get(actor,'workspace',f.session.id),beforeSession);
  assert.deepEqual(await restored.work.get(actor,'workspace',next.session.id),beforeNext);
  assert.deepEqual(await restored.work.list(actor,'workspace'),discoveryBefore);
  assert.deepEqual(await restored.work.operation(actor,'workspace','persist-continuation',{kind:'CONTINUATION'}),operationBefore);
  assert.deepEqual(await restored.work.operation(actor,'workspace','unknown-call',{kind:'QUESTION'}),pendingOperationBefore);
  assert.equal((await restored.published.graph(actor,'workspace',rid,{view:'IMPLEMENTATION'})).graphDigest,publishedBefore.graphDigest);
  assert.deepEqual(await restored.published.material(actor,'workspace',rid,f.graph.materials[0].id),materialBefore);
  assert.deepEqual(await records(destination.db),beforeRecords);assert.deepEqual(await audit(destination.db),beforeAudit);
  assert.equal(f.calls.length,calls);assert.equal(beforePending.run.usage.modelCalls,1);
  assert.equal((await restored.work.get(actor,'workspace',f.session.id)).records.find(r=>r.id===feedback.id).status,'REVIEW_REQUESTED');
  console.log(JSON.stringify({kind:'ISOLATED_WORK_PAIRED_RESTORE_MECHANISM_ONLY',graphDigest:f.graph.digest,sessionId:f.session.id,answerId:answered.answer.id,
    backupId:saved.id,modelCallsAfterRecovery:0,realQuality:false,realProtectedMedia:false}));
});
