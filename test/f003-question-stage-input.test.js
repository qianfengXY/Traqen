import assert from 'node:assert/strict';
import test from 'node:test';
import {questionFixture} from './support/f003-question-fixture.js';

// Actual session/admission/worker/checkpoints, explicit reasoning and technical
// port doubles. This test is resource/authority mechanics, never quality.
test('F003 GRAPH_QUESTION PLAN/DRAFT/VERIFY bound actual JSON and never treat a global routing package as evidence',async t=>{
  const f=await questionFixture(t);
  f.s.investigations.technicalEvidence=async()=>({versionIds:[],sourceBundleId:f.reference.bundleId,
    records:[{id:'unrelated',versionId:'not-adopted',record:{subjectId:'absent',diagnostic:'unrelated '.repeat(23000)}}],
    objects:[],evidence:[],materials:[],allowedFactIds:['unrelated'],limitations:[],unresolved:[],truncated:false,omittedFactCount:0});
  const q=await f.ask();f.s.executor.enqueue(q.run);await f.s.executor.drain();
  const result=await f.read(q.run.id);assert.equal(result.run.state,'COMPLETED',JSON.stringify(result.run.lastFailure));
  for(const operation of ['PLAN','DRAFT','VERIFY']) await t.test(operation,()=>{
    const input=f.calls.find(c=>(c.input.operation??c.input.phase)===operation || (operation==='PLAN'&&c.input.phase==='PLAN'))?.input;
    assert.ok(input);assert.ok(Buffer.byteLength(JSON.stringify(input))<=128*1024,`${operation} exceeds the complete JSON budget`);
    assert.deepEqual(input.technicalEvidence.allowedFactIds,[]);
    if(operation==='PLAN')assert.equal(input.technicalEvidence.authority,'ROUTING_NOT_EVIDENCE');
  });
  assert.equal(result.answer.segments[0].stance,'SUPPORTED');
});

test('F003 HTTP persists exact v4 stage resources and reads them offline without calls or writes',async t=>{
  const f=await questionFixture(t),q=await f.ask();f.s.executor.enqueue(q.run);await f.s.executor.drain();
  const url=`${f.root}/work-sessions/${f.session.id}/questions/${q.run.id}`;
  const response=await fetch(url,{headers:f.headers});assert.equal(response.status,200);
  const saved=await response.json();assert.equal(saved.run.state,'COMPLETED');assert.equal(saved.answer.questionContractVersion,4);
  for(const p of saved.answer.process) {
    const input=f.calls.find(c=>c.taskKey===p.taskKey).input;
    assert.equal(p.inputBytes,Buffer.byteLength(JSON.stringify(input)));assert.equal(p.maxInputBytes,131072);
    assert.ok(p.inputBytes<=p.maxInputBytes);assert.equal(p.technicalContextBytes,Buffer.byteLength(JSON.stringify(input.technicalEvidence)));
    assert.ok(p.technicalContextBytes<=32768);assert.equal(p.resourceContext.questionContractVersion,4);
    if(input.operation==='VERIFY') {
      assert.equal(p.resourceContext.isolatedItems.count,0);assert.match(p.resourceContext.isolatedItems.digest,/^[a-f0-9]{64}$/);
    }
  }
  const count=async()=>(await f.db.query('SELECT count(*)::int n FROM source_truth_event')).rows[0].n;
  const before=await count(),calls=f.calls.length;
  f.s.investigations.profiles.assertUsable=async()=>{throw Error('offline model for readback only');};
  const again=await fetch(url,{headers:f.headers});assert.equal(again.status,200);
  assert.deepEqual((await again.json()).answer,saved.answer);assert.equal(f.calls.length,calls);assert.equal(await count(),before);
});
