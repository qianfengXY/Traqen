import assert from 'node:assert/strict';
import test from 'node:test';
import {questionFixture} from './support/f003-question-fixture.js';
import {owner,reader} from './support/source-truth-database.js';

test('F003 durable session discovery and actor-own operation recovery use pure GET, never retry POST or enqueue a model',async t=>{
  const f=await questionFixture(t);
  const response=await fetch(`${f.root}/work-sessions?limit=1`,{headers:f.headers});
  assert.equal(response.status,200);const page=await response.json();
  assert.equal(page.sessions[0].id,f.session.id);
  const recovery=await fetch(`${f.root}/work-operations/test-session?kind=CREATE_SESSION`,{headers:f.headers});
  assert.equal(recovery.status,200);const recovered=await recovery.json();
  assert.equal(recovered.operation.result.sessionId,f.session.id);
  assert.equal(recovered.operation.origin.graphRevisionId,f.session.binding.graphRevisionId);
  assert.equal(recovered.operation.actorId,'owner');assert.equal(f.calls.length,0);
  assert.equal((await fetch(`${f.root}/work-operations/test-session?kind=CREATE_SESSION&expectedRequestDigest=${'0'.repeat(64)}`,{headers:f.headers})).status,409);
  assert.equal((await fetch(`${f.root}/work-operations/test-session?kind=CREATE_SESSION&originGraphRevisionId=wrong`,{headers:f.headers})).status,409);
  const foreign=await fetch(`${f.root}/work-operations/test-session?kind=CREATE_SESSION`,{headers:{authorization:'Bearer isolated-reader-token'}});
  assert.equal(foreign.status,404);
});

test('F003 session index paginates exact SQL microseconds and own operation GET fixes origin/result without bypassing current read permission',async t=>{
  const f=await questionFixture(t),work=f.s.workSessions,rid=f.session.binding.graphRevisionId;
  const made=[];for(let i=0;i<3;i++) made.push((await work.create(owner,'workspace',rid,{operationId:`index-${i}`,expectedGraphDigest:f.graph.digest,title:`persistent ${i}`})).session);
  // Actual timestamp precision is significant: a millisecond cursor would
  // repeat its last microsecond row forever. Do not mutate immutable records.
  let cursor=null,ids=[];
  do {const page=await work.list(reader,'workspace',{limit:1,cursor});ids.push(...page.sessions.map(s=>s.id));cursor=page.nextCursor;
    assert.ok(ids.length<=4,'pagination must advance');}while(cursor);
  assert.equal(new Set(ids).size,4);assert.ok(made.every(s=>ids.includes(s.id)));
  const first=await work.list(reader,'workspace',{limit:1,graphRevisionId:rid});assert.ok(first.nextCursor);
  await assert.rejects(work.list(reader,'workspace',{limit:1,cursor:first.nextCursor}),{code:'F003_WORK_INPUT_INVALID'});
  await assert.rejects(work.list(owner,'workspace',{limit:1,cursor:first.nextCursor,graphRevisionId:rid}),{code:'F003_WORK_INPUT_INVALID'});
  const q=await f.ask();
  const pendingCalls=q.run.usage.modelCalls;
  const question=await work.operation(owner,'workspace','question-1',{kind:'QUESTION',originSessionId:f.session.id,originGraphRevisionId:rid});
  assert.equal(question.operation.result.questionId,q.run.id);assert.equal(question.question.answer,null);
  assert.equal(question.question.run.usage.modelCalls,pendingCalls);
  await assert.rejects(work.operation(owner,'workspace','question-1',{kind:'QUESTION',originSessionId:made[0].id}),{code:'F003_OPERATION_ORIGIN_MISMATCH'});
  const feedback=await work.feedback(owner,'workspace',f.session.id,{operationId:'index-feedback',expectedSessionVersion:2,
    graphDigest:f.graph.digest,objectKey:f.graph.candidates[0].key,answerId:null,kind:'CORRECTION',message:'not an authority write'});
  assert.equal((await work.operation(owner,'workspace','index-feedback',{kind:'FEEDBACK'})).operation.result.feedbackId,feedback.feedback.id);
  const selection={reference:f.reference,scope:f.request.scope,technicalVersionId:null};
  const delta=await work.continuationPreview(owner,'workspace',f.session.id,selection);
  const continuation=await work.continue(owner,'workspace',f.session.id,{...selection,operationId:'index-continuation',expectedSessionVersion:3,
    expectedChangeSetDigest:delta.changeSetDigest,expectedProfileId:f.request.expectedProfileId,question:'new explicitly selected scope',budget:f.request.budget,supplementBudget:f.request.supplementBudget});
  const recovered=await work.operation(owner,'workspace','index-continuation',{kind:'CONTINUATION',originSessionId:f.session.id,originGraphRevisionId:rid});
  assert.equal(recovered.operation.origin.sessionId,f.session.id);assert.equal(recovered.operation.result.sessionId,continuation.session.id);
  assert.notEqual(recovered.operation.origin.sessionId,recovered.operation.result.sessionId);
  assert.equal(recovered.session.binding.graphRevisionId,null);
  assert.equal((await work.list(reader,'workspace',{originSessionId:f.session.id})).sessions[0].id,continuation.session.id);
  await assert.rejects(work.operation(owner,'workspace','index-continuation',{kind:'CREATE_SESSION'}),{status:404});
  const counts=()=>f.db.query(`SELECT (SELECT count(*) FROM understanding_record) records,(SELECT count(*) FROM source_truth_event) events,
    (SELECT count(*) FROM f003_investigation_event) calls`);
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=true WHERE workspace_id='workspace'");
  f.s.publications.qualityPolicy=null;const before=await counts();
  await work.list(reader,'workspace');await work.operation(owner,'workspace','test-session',{kind:'CREATE_SESSION'});
  await work.operation(owner,'workspace','question-1',{kind:'QUESTION'});await work.operation(owner,'workspace','index-feedback',{kind:'FEEDBACK'});
  await work.operation(owner,'workspace','index-continuation',{kind:'CONTINUATION'});
  assert.deepEqual(await counts(),before);assert.equal(f.calls.length,0);
  await f.db.query("UPDATE source_truth_workspace SET restore_ready=false WHERE workspace_id='workspace'");
  await assert.rejects(work.list(reader,'workspace'),{code:'F003_RESTORE_UNVERIFIED'});
  await f.db.query("UPDATE source_truth_workspace SET restore_ready=true WHERE workspace_id='workspace'");
  await f.db.query("DELETE FROM source_truth_access_legacy WHERE actor_id='reader'");
  await assert.rejects(work.list(reader,'workspace'),{status:403});
});
