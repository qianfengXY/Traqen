import assert from 'node:assert/strict';
import test from 'node:test';
import {questionFixture,questionActor as actor} from './support/f003-question-fixture.js';
import {questionContractVersion} from '../src/business-knowledge/question-worker.js';
import {publicationDigest as digest} from '../src/business-knowledge/publication-authority.js';

for(const legacyVersion of [1,2,3])test(`F003 QA v${legacyVersion} checkpoints cannot authorize v4 reuse or replay/charge already-started logical calls`,async t=>{
  const f=await questionFixture(t),q=await f.ask(),investigations=f.s.investigations;
  assert.equal(questionContractVersion,4);
  const run=await investigations.claim(actor,'workspace',q.run.id,{workerId:'old-contract',leaseMs:60000});
  const context=await f.s.workSessions.executionContext(actor,'workspace',f.session.id,q.run.id);
  const oldBinding=digest({questionContractVersion:legacyVersion,requestDigest:context.request.requestDigest,sourceInput:run.sourceInput,
    profileId:run.profile.id,adoptedVersionIds:run.adoptedVersionIds});
  await investigations.checkpoint(actor,'workspace',run.id,{generation:run.generation,key:'qa-plan',payload:{binding:oldBinding,
    data:{assignments:[{slotId:'child-1',objectKeys:context.request.graphView.map(o=>o.key)}]}}});
  const before=await investigations.checkpoints(actor,'workspace',run.id);
  await investigations.releaseForShutdown(actor,'workspace',run.id,{generation:run.generation,workerId:'old-contract'});
  f.s.executor.enqueue(await investigations.get(actor,'workspace',run.id));await f.s.executor.drain();
  const result=await f.read(run.id);assert.equal(result.run.state,'FAILED');assert.equal(result.run.lastFailure.code,'F003_QA_CONTRACT_CHANGED');
  assert.deepEqual(result.run.usage,run.usage);assert.equal(f.calls.length,0);assert.equal(result.answer,null);
  assert.deepEqual(await investigations.checkpoints(actor,'workspace',run.id),before,'old checkpoints are immutable, not relabelled as the new contract');
});

test('F003 affirmative answers reject wrong graph/original/technical citations and retain UNKNOWN with original model references',async t=>{
  const modes=['graph','original','technical','review'];
  const f=await questionFixture(t,{transform:(c,result)=>{
    if(c.input.operation==='DRAFT') {
      const segment=result.segments[0];
      result.segments=modes.map(mode=>({...structuredClone(segment),key:mode,
        ...(mode==='graph'?{graphRefs:['foreign-revision-key']}:mode==='original'?{evidence:[{...segment.evidence[0],quote:'fabricated citation'}]}
          :mode==='technical'?{technicalRefs:['foreign-fact']}:{} )}));
    } else if(c.input.operation==='VERIFY') result.reviews=result.reviews.map(r=>c.input.drafts[0].segments.find(s=>s.key===r.key)?.localKey==='review'
      ? {...r,unresolvedConflicts:['an explicit unresolved premise']}:r);
    return result;
  }});
  const q=await f.ask(); f.s.executor.enqueue(q.run); await f.s.executor.drain();const result=await f.read(q.run.id);
  assert.equal(result.run.state,'COMPLETED',JSON.stringify(result.run.lastFailure));
  assert.equal(result.answer.segments.length,4);assert.ok(result.answer.segments.every(s=>s.stance==='UNKNOWN'));
  assert.ok(result.answer.segments.find(s=>s.localKey==='graph').guardReasons.includes('GRAPH_REFERENCE_NOT_SUPPORTED'));
  assert.ok(result.answer.segments.find(s=>s.localKey==='original').guardReasons.includes('INVALID_ORIGINAL_REFERENCE'));
  assert.ok(result.answer.segments.find(s=>s.localKey==='technical').guardReasons.includes('INVALID_TECHNICAL_REFERENCE'));
  assert.equal(result.run.usage.modelCalls,3);assert.equal((await f.db.query('SELECT count(*)::int n FROM human_decision')).rows[0].n,0);
});

test('F003 Main explicit late answer conflicts survive generic SUPPORTED reviews rather than silently promoting either branch',async t=>{
  const f=await questionFixture(t,{transform:(c,result)=>{
    if(c.input.operation==='DRAFT') result.segments=[result.segments[0],{...structuredClone(result.segments[0]),key:'other-interpretation',text:'该规则可能存在不同适用条件。'}];
    if(c.input.operation==='VERIFY') result.conflictGroups=[{keys:c.input.drafts[0].segments.map(s=>s.key),rationale:'explicit unresolved interpretation conflict'}];
    return result;
  }});
  const q=await f.ask(); f.s.executor.enqueue(q.run);await f.s.executor.drain();const result=await f.read(q.run.id);
  assert.equal(result.run.state,'COMPLETED',JSON.stringify(result.run.lastFailure));
  assert.equal(result.answer.segments.filter(s=>s.stance==='SUPPORTED').length,0);
  assert.equal(result.answer.conflicts.length,1);
});

test('F003 lost started model result cannot be reissued or charged on resume; cancellation stays available after qualification loss',async t=>{
  const f=await questionFixture(t);const q=await f.ask(), investigations=f.s.investigations;
  const first=await investigations.claim(actor,'workspace',q.run.id,{workerId:'lost-model',leaseMs:60000});
  const reservation=await investigations.reserveModelCall(actor,'workspace',q.run.id,{generation:first.generation,slotId:'main',taskKey:'qa-plan',phase:'PLAN'});
  await investigations.beginModelCall(actor,'workspace',q.run.id,{generation:first.generation,reservationId:reservation.id});
  await investigations.releaseForShutdown(actor,'workspace',q.run.id,{generation:first.generation,workerId:'lost-model'});
  f.s.executor.enqueue(await investigations.get(actor,'workspace',q.run.id));await f.s.executor.drain();
  let result=await f.read(q.run.id);assert.equal(result.run.state,'FAILED');assert.equal(result.run.lastFailure.code,'F003_QA_CALL_OUTCOME_UNKNOWN');
  assert.equal(result.run.usage.modelCalls,1);assert.equal(f.calls.length,0);
  f.s.publications.qualityPolicy=null;
  await assert.rejects(()=>f.s.workSessions.control(actor,'workspace',f.session.id,q.run.id,'RESUME',{expectedRevision:result.run.revision}),e=>e.code==='F003_SESSION_WRITE_BLOCKED');
  const cancel=await fetch(`${f.root}/work-sessions/${f.session.id}/questions/${q.run.id}/cancel`,{method:'POST',headers:f.headers,body:JSON.stringify({expectedRevision:result.run.revision})});
  assert.equal(cancel.status,200,await cancel.clone().text());result=await f.read(q.run.id);assert.equal(result.run.state,'CANCELLED');
  assert.equal(result.answer,null);assert.equal(result.run.usage.modelCalls,1);
});

test('F003 committed question stages resume without replaying models or resetting read budget',async t=>{
  const f=await questionFixture(t);const q=await f.ask(), investigations=f.s.investigations;
  const complete=investigations.completeQuestion.bind(investigations);let failOnce=true;
  investigations.completeQuestion=async(...args)=>{if(failOnce){failOnce=false;throw new Error('isolated commit interruption after answer checkpoint');}return complete(...args);};
  f.s.executor.enqueue(q.run);await f.s.executor.drain();let result=await f.read(q.run.id);
  assert.equal(result.run.state,'FAILED');assert.equal(f.calls.length,3);const usage=result.run.usage;
  const resumed=await f.s.workSessions.control(actor,'workspace',f.session.id,q.run.id,'RESUME',{expectedRevision:result.run.revision});
  f.s.executor.enqueue(resumed.run);await f.s.executor.drain();result=await f.read(q.run.id);
  assert.equal(result.run.state,'COMPLETED',JSON.stringify(result.run.lastFailure));assert.equal(f.calls.length,3);assert.deepEqual(result.run.usage,usage);
  await assert.rejects(()=>investigations.complete(actor,'workspace',q.run.id,{generation:result.run.generation,graph:f.graph}));
});

for(const legacyVersion of [1,2,3])test(`F003 saved v${legacyVersion} answer envelope is read verbatim offline, never relabelled to the current question contract`,async t=>{
  const f=await questionFixture(t),q=await f.ask(),investigations=f.s.investigations;
  const complete=investigations.completeQuestion.bind(investigations);
  // Explicit persistence-compatibility fixture, not an old-model quality claim.
  investigations.completeQuestion=(a,w,id,input)=>complete(a,w,id,{...input,answer:{...input.answer,questionContractVersion:legacyVersion}});
  f.s.executor.enqueue(q.run);await f.s.executor.drain();const saved=await f.read(q.run.id);
  assert.equal(saved.run.state,'COMPLETED');assert.equal(saved.answer.questionContractVersion,legacyVersion);
  const before=(await f.db.query('SELECT count(*)::int n FROM source_truth_event')).rows;
  f.s.investigations.profiles.assertUsable=async()=>{throw Error('offline model')};
  assert.deepEqual(await f.read(q.run.id),saved);assert.equal(f.calls.length,3);
  assert.deepEqual((await f.db.query('SELECT count(*)::int n FROM source_truth_event')).rows,before);
});

test('F003 cancelling active question generations discards a model ignoring abort, retaining budget and old call audit',async t=>{
  const entered=Promise.withResolvers(),late=Promise.withResolvers(),finished=Promise.withResolvers();
  const f=await questionFixture(t,{onCall:async c=>{if(c.input.operation==='DRAFT'){entered.resolve();await late.promise;}},
    transform:(c,result)=>{if(c.input.operation==='DRAFT')queueMicrotask(()=>finished.resolve());return result;}});
  const q=await f.ask();f.s.executor.enqueue(q.run);await entered.promise;
  const before=await f.read(q.run.id);
  const response=await fetch(`${f.root}/work-sessions/${f.session.id}/questions/${q.run.id}/cancel`,{method:'POST',headers:f.headers,
    body:JSON.stringify({expectedRevision:before.run.revision})});
  assert.equal(response.status,200,await response.clone().text());await f.s.executor.drain();
  const cancelled=await f.read(q.run.id);assert.equal(cancelled.run.state,'CANCELLED');assert.equal(cancelled.answer,null);
  assert.deepEqual(cancelled.run.usage,before.run.usage);
  late.resolve();await finished.promise;
  // Await the actual terminal-audit transaction, not a time-based guess.
  for(let i=0;i<20;i++) {
    const events=await f.s.investigations.events(actor,'workspace',q.run.id);
    if(events.some(e=>e.event_type==='MODEL_CALL_FINISHED' && e.payload.outcome==='DISCARDED'))break;
    await new Promise(resolve=>setImmediate(resolve));
  }
  const events=await f.s.investigations.events(actor,'workspace',q.run.id);
  assert.ok(events.some(e=>e.event_type==='MODEL_CALL_FINISHED' && e.payload.outcome==='DISCARDED'));
  assert.equal((await f.read(q.run.id)).answer,null);
});

test('F003 graceful question shutdown fences old generation, preserves spent calls and refuses an unknown Child outcome after restart',async t=>{
  const entered=Promise.withResolvers();
  const f=await questionFixture(t,{onCall:async c=>{if(c.input.operation==='DRAFT'){entered.resolve();await new Promise(()=>{});}}});
  const q=await f.ask();f.s.executor.enqueue(q.run);await entered.promise;
  const before=await f.read(q.run.id);await f.runtime.close();const after=await f.read(q.run.id);
  assert.equal(after.run.state,'QUEUED');assert.ok(after.run.generation>before.run.generation);assert.deepEqual(after.run.usage,before.run.usage);
  await assert.rejects(()=>f.s.worker.run(actor,'workspace',q.run.id,{workerId:'recovered-question'}),e=>e.code==='F003_QA_CALL_OUTCOME_UNKNOWN');
  assert.equal(f.calls.length,2);assert.equal((await f.read(q.run.id)).answer,null);
});

test('F003 model cannot smuggle human authority fields into a derived answer segment',async t=>{
  const f=await questionFixture(t,{transform:(c,result)=>{if(c.input.operation==='DRAFT')result.segments[0].authority='HUMAN_CONFIRMED';return result;}});
  const q=await f.ask();f.s.executor.enqueue(q.run);await f.s.executor.drain();const result=await f.read(q.run.id);
  assert.equal(result.run.state,'FAILED');assert.equal(result.run.lastFailure.code,'F003_MODEL_OUTPUT_INVALID');assert.equal(result.answer,null);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM human_decision')).rows[0].n,0);
});

test('F003 concurrent same-operation question admission stores one request and reports the existing run as an idempotent replay',async t=>{
  const f=await questionFixture(t),admission=f.s.investigations.sourceAdmission,qualify=admission.qualify.bind(admission),both=Promise.withResolvers();let entered=0;
  admission.qualify=async(...args)=>{const result=await qualify(...args);if(++entered===2)both.resolve();await both.promise;return result;};
  const results=await Promise.all([f.ask(),f.ask()]);admission.qualify=qualify;
  assert.equal(results[0].run.id,results[1].run.id);assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM understanding_record WHERE record_type='KNOWLEDGE_QUESTION'")).rows[0].n,1);
  assert.equal((await f.s.workSessions.get(actor,'workspace',f.session.id)).session.version,2);
});

test('F003 permits bounded overlapping Child question assignments with stable task-local answer identities instead of rejecting legitimate independent work',async t=>{
  const f=await questionFixture(t,{transform:(c,result)=>{if(c.input.phase==='PLAN')result.assignments.push(structuredClone(result.assignments[0]));return result;}});
  const q=await f.ask();f.s.executor.enqueue(q.run);await f.s.executor.drain();const result=await f.read(q.run.id);
  assert.equal(result.run.state,'COMPLETED',JSON.stringify(result.run.lastFailure));assert.equal(result.answer.segments.length,2);
  assert.equal(new Set(result.answer.segments.map(s=>s.key)).size,2);assert.equal(new Set(result.answer.segments.map(s=>s.localKey)).size,1);
  assert.ok(result.answer.segments.every(s=>s.stance==='SUPPORTED'));assert.equal(result.run.usage.modelCalls,4);
});
