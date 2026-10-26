import assert from 'node:assert/strict';
import test from 'node:test';
import {questionFixture,questionActor as actor} from './support/f003-question-fixture.js';
import {freezeContinuationSource} from './support/f003-continuation-source.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';

test('F003 actual new frozen files require reviewed changes and explicit new graph adoption, retaining old answers and human recognition without inheritance',async t=>{
  const f=await questionFixture(t),s=f.s;
  const oldQuestion=await f.ask();s.executor.enqueue(oldQuestion.run);await s.executor.drain();const old=await f.read(oldQuestion.run.id);
  await s.authorityBindings.bind(actor,'workspace',f.published.publication.graphRevisionId,f.bindingRequest);await f.decide('CONFIRMED');
  const human=await s.authorityBindings.project(actor,'workspace',f.published.publication.graphRevisionId,f.graph.candidates[0].key);
  const next=await freezeContinuationSource(f,[['business.md','用户可取消未支付订单，但已发货订单需要人工处理。'],['exception.md','已发货订单不能自动取消。']]);
  const selection={...next,technicalVersionId:null};
  const preview=await s.workSessions.continuationPreview(actor,'workspace',f.session.id,selection);
  assert.notEqual(preview.from.sourceInput.sourceBundleSnapshotId,preview.to.reference.bundleId);
  assert.deepEqual(preview.deltas[0].counts,{added:'1',modified:'1',deleted:'0',unchanged:'0'});
  assert.deepEqual(preview.changedEntries.map(e=>e.change).sort(),['ADDED','MODIFIED']);
  assert.equal(preview.from.graphDigest,f.graph.digest);
  const input={...selection,operationId:'new-materials',expectedSessionVersion:2,expectedChangeSetDigest:preview.changeSetDigest,
    expectedProfileId:f.request.expectedProfileId,question:'新版本如何处理已发货订单？',budget:{...f.request.budget,maxModelCalls:5},supplementBudget:f.request.supplementBudget};
  const counts=(await f.db.query('SELECT (SELECT count(*) FROM f003_investigation) AS runs,(SELECT count(*) FROM understanding_record WHERE record_type=\'WORK_SESSION\') AS sessions')).rows;
  await assert.rejects(()=>s.workSessions.continue(actor,'workspace',f.session.id,{...input,expectedChangeSetDigest:'e'.repeat(64)}),e=>e.code==='F003_CHANGESET_CONFLICT');
  assert.deepEqual((await f.db.query('SELECT (SELECT count(*) FROM f003_investigation) AS runs,(SELECT count(*) FROM understanding_record WHERE record_type=\'WORK_SESSION\') AS sessions')).rows,counts);
  s.investigations.implementationVersion=f.investigations.implementationVersion; // Synthetic verified implementation, not a real publication verdict.
  const continued=await s.workSessions.continue(actor,'workspace',f.session.id,input);
  assert.equal(continued.session.binding.graphRevisionId,null);assert.deepEqual(continued.run.sourceInput.sourceBundleSnapshotId,next.reference.bundleId);
  const worker=new InvestigationWorker({investigations:s.investigations,invokeModel:async c=>{
    const reservation=await s.investigations.reserveModelCall(actor,'workspace',continued.run.id,c),i=c.input;
    const result=i.phase==='PLAN'?{assignments:[{slotId:'child-1',obligations:["核查本任务原文条件、反例与未供应前提（机制替身）"],objective:'read new frozen evidence',materialKeys:i.inventory.map(m=>m.key)}]}
      :i.phase==='INVESTIGATE'?{candidates:[{key:'cancel',kind:'RULE',name:'取消规则',statement:'已发货订单需要人工处理',scope:'仅本明确新版本',uncertainties:[],
        evidence:[{materialId:i.materials[0].id,startLine:1,endLine:1,quote:i.materials[0].text}]}],relations:[]}
        :{reviews:i.candidates.map(o=>({key:o.key,support:'SUPPORTED',rationale:'isolated new-version mechanism',unresolvedConflicts:[]}))};
    return {result,reservationId:reservation.id};
  }});
  await worker.run(actor,'workspace',continued.run.id,{workerId:'new-materials-test'});
  const graph=await s.investigations.graph(actor,'workspace',continued.run.id);
  const published=await f.publishAnalysis(continued.run.id,graph,{operationId:'new-source-publish',expectedHeadVersion:1});
  const adopted=await s.workSessions.adoptGraph(actor,'workspace',continued.session.id,{operationId:'adopt-exact-new-graph',expectedSessionVersion:1,
    graphRevisionId:published.publication.graphRevisionId,expectedGraphDigest:graph.digest,adoptedVersionIds:[]});
  assert.equal(adopted.event.binding.graphDigest,graph.digest);
  const recovered=await s.workSessions.operation(actor,'workspace','adopt-exact-new-graph',
    {kind:'ADOPT_GRAPH',originSessionId:continued.session.id});
  assert.equal(recovered.operation.result.eventId,adopted.event.id);
  assert.equal(recovered.operation.result.sessionId,continued.session.id);
  assert.equal(recovered.operation.result.graphRevisionId,published.publication.graphRevisionId);
  assert.equal(recovered.operation.origin.graphRevisionId,null,'pending session was not already using the adopted revision');
  const continuedRecovery=await s.workSessions.operation(actor,'workspace','new-materials',{kind:'CONTINUATION'});
  assert.equal(continuedRecovery.operation.origin.sessionId,f.session.id);
  assert.equal(continuedRecovery.operation.origin.graphRevisionId,f.published.publication.graphRevisionId);
  assert.equal(continuedRecovery.operation.result.sessionId,continued.session.id);
  assert.equal(continuedRecovery.session.binding.graphRevisionId,published.publication.graphRevisionId);
  assert.equal((await s.workSessions.list(actor,'workspace',{graphRevisionId:published.publication.graphRevisionId})).sessions[0].id,continued.session.id);
  assert.equal((await s.workSessions.get(actor,'workspace',continued.session.id)).session.binding.graphRevisionId,published.publication.graphRevisionId);
  assert.deepEqual((await f.read(oldQuestion.run.id)).answer,old.answer);
  assert.deepEqual(await s.authorityBindings.project(actor,'workspace',f.published.publication.graphRevisionId,f.graph.candidates[0].key),human);
  const newAuthority=await s.authorityBindings.project(actor,'workspace',published.publication.graphRevisionId,graph.candidates[0].key);
  assert.equal(newAuthority.bindingSet,null);assert.deepEqual(newAuthority.projection.targets,[]);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM human_decision')).rows[0].n,1);
});
