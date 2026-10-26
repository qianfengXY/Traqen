import assert from "node:assert/strict";
import test from "node:test";
import { authorityFixture } from "./support/f003-authority-fixture.js";

const actor={actorId:'owner',tenantId:'tenant'};
const askInput=f=>({operationId:'ask-1',expectedSessionVersion:1,expectedProfileId:f.request.expectedProfileId,question:'该版本有哪些依据与未知？',
  objectKeys:[f.graph.candidates[0].key],budget:{maxReadBytes:8192,maxModelCalls:4,deadline:'2099-01-01T00:00:00Z'}});
async function session(f,operationId='session') {
  return (await f.runtime.services.workSessions.create(actor,'workspace',f.published.publication.graphRevisionId,
    {operationId,expectedGraphDigest:f.graph.digest,title:'explicit mechanism-only working context'})).session;
}

test("F003 creates an explicitly graph-bound work session through the actual HTTP entry, without changing authority or executing a model", async t => {
  const f = await authorityFixture(t);
  const before = await f.runtime.services.publications.current({ actorId:"owner", tenantId:"tenant" }, "workspace");
  const route = `${f.root}/versions/${f.published.publication.graphRevisionId}/work-sessions`;
  const response = await fetch(route, { method:"POST", headers:f.headers, body:JSON.stringify({ operationId:"session-1", expectedGraphDigest:f.graph.digest, title:"核对取消规则的证据与未知" }) });
  assert.equal(response.status, 201, await response.clone().text());
  const { session } = await response.json();
  assert.equal(session.binding.graphDigest, f.graph.digest);
  assert.deepEqual(session.binding.adoptedVersionIds, f.graph.adoptedVersionIds);
  assert.equal(session.binding.sourceInput.sourceBundleSnapshotId, f.graph.sourceBundleId);
  assert.deepEqual(await f.runtime.services.publications.current({ actorId:"owner", tenantId:"tenant" }, "workspace"), before);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM human_decision")).rows[0].n, 0);
  f.runtime.services.publications.qualityPolicy=null;
  const rejected=await fetch(route,{method:"POST",headers:f.headers,body:JSON.stringify({operationId:"must-stay-blocked",expectedGraphDigest:f.graph.digest,title:"不能用客户端开关通过"})});
  assert.equal(rejected.status,409);
  const error=(await rejected.json()).error;
  assert.equal(error.code,"F003_SESSION_WRITE_BLOCKED");
  assert.ok(error.details.missing.some(m=>m.code==="F003_QUALITY_POLICY_UNCONFIRMED"));
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM understanding_record WHERE record_type='WORK_SESSION'")).rows[0].n,1);
  const historical=await fetch(`${f.root}/work-sessions/${session.id}`,{headers:f.headers});
  assert.equal(historical.status,200,"lost write qualification does not run a model or hide stored history");
});

test('F003 feedback is exact-version correction/review only, with immutable idempotency, CAS, current permissions and no authority promotion',async t=>{
  const f=await authorityFixture(t), s=f.runtime.services, created=await session(f);
  const input={operationId:'feedback-1',expectedSessionVersion:1,graphDigest:f.graph.digest,objectKey:f.graph.candidates[0].key,
    answerId:null,kind:'CORRECTION',message:'请核对缺失的取消前提；这不是批准。'};
  const response=await fetch(`${f.root}/work-sessions/${created.id}/feedback`,{method:'POST',headers:f.headers,body:JSON.stringify(input)});
  assert.equal(response.status,201,await response.clone().text()); const result=await response.json();
  assert.equal(result.feedback.status,'REVIEW_REQUESTED');
  assert.deepEqual((await s.workSessions.feedback(actor,'workspace',created.id,input)).feedback,result.feedback);
  await assert.rejects(()=>s.workSessions.feedback(actor,'workspace',created.id,{...input,message:'different'}),e=>e.code==='F003_OPERATION_CONFLICT');
  await assert.rejects(()=>s.workSessions.feedback(actor,'workspace',created.id,{...input,operationId:'stale'}),e=>e.code==='F003_SESSION_CONFLICT');
  await assert.rejects(()=>s.workSessions.feedback(actor,'workspace',created.id,{...input,operationId:'bad-key',expectedSessionVersion:2,objectKey:'foreign'}),e=>e.code==='F003_QA_SCOPE_INVALID');
  await assert.rejects(()=>s.workSessions.feedback(actor,'workspace',created.id,{...input,operationId:'bad-graph',expectedSessionVersion:2,graphDigest:'a'.repeat(64)}),e=>e.code==='F003_GRAPH_CONFLICT');
  await assert.rejects(()=>s.workSessions.feedback(actor,'workspace',created.id,{...input,operationId:'approval',expectedSessionVersion:2,kind:'CONFIRMED'}),e=>e.code==='F003_WORK_INPUT_INVALID');
  await assert.rejects(()=>s.workSessions.feedback({actorId:'reader',tenantId:'tenant'},'workspace',created.id,{...input,operationId:'no-write',expectedSessionVersion:2}));
  assert.equal((await f.db.query('SELECT count(*)::int n FROM human_decision')).rows[0].n,0);
  assert.deepEqual(await f.investigations.graph(actor,'workspace',f.run.id),f.graph);
  await assert.rejects(()=>f.db.query("UPDATE understanding_record SET status='APPROVED' WHERE record_type='KNOWLEDGE_FEEDBACK'"),/append|immutable/i);
});

test('F003 continuation previews fixed source/adoption changes before explicit new investigation/session, without latest or name inheritance',async t=>{
  const f=await authorityFixture(t), s=f.runtime.services, created=await session(f);
  s.investigations.profiles=f.profiles; s.executor.enqueue=()=>{};
  const selection={reference:f.reference,scope:f.request.scope,technicalVersionId:null};
  const preview=await s.workSessions.continuationPreview(actor,'workspace',created.id,selection);
  assert.equal(preview.from.graphDigest,f.graph.digest); assert.equal(preview.to.reference.bundleId,f.reference.bundleId);
  assert.equal(preview.changedEntries.length,0); assert.equal(preview.adoptionChange.kind,'EXPLICIT_NONE');
  const input={...selection,operationId:'continue-1',expectedSessionVersion:1,expectedChangeSetDigest:preview.changeSetDigest,
    expectedProfileId:f.request.expectedProfileId,question:'同一来源的新明确问题',budget:f.request.budget,supplementBudget:f.request.supplementBudget};
  const response=await fetch(`${f.root}/work-sessions/${created.id}/continue`,{method:'POST',headers:f.headers,body:JSON.stringify(input)});
  assert.equal(response.status,201,await response.clone().text()); const next=await response.json();
  assert.notEqual(next.session.id,created.id); assert.notEqual(next.run.id,f.run.id);
  assert.equal(next.session.binding.graphRevisionId,null); assert.equal(next.run.state,'QUEUED');
  assert.equal(next.session.origin.sessionId,created.id); assert.deepEqual(next.run.adoptedVersionIds,[]);
  const replay=await s.workSessions.continue(actor,'workspace',created.id,input); assert.equal(replay.replayed,true); assert.equal(replay.run.id,next.run.id);
  await assert.rejects(()=>s.workSessions.ask(actor,'workspace',next.session.id,askInput(f)),e=>e.code==='F003_SESSION_GRAPH_PENDING');
  await assert.rejects(()=>s.workSessions.adoptGraph(actor,'workspace',next.session.id,{operationId:'foreign-adopt',expectedSessionVersion:1,
    graphRevisionId:f.published.publication.graphRevisionId,expectedGraphDigest:f.graph.digest,adoptedVersionIds:[]}),e=>e.code==='F003_CONTINUATION_GRAPH_MISMATCH');
  await assert.rejects(()=>s.workSessions.continue(actor,'workspace',created.id,{...input,operationId:'wrong-preview',expectedSessionVersion:2,
    expectedChangeSetDigest:'0'.repeat(64)}),e=>e.code==='F003_CHANGESET_CONFLICT');
  assert.equal((await s.workSessions.get(actor,'workspace',created.id)).session.binding.graphDigest,f.graph.digest);
  assert.deepEqual(await f.investigations.graph(actor,'workspace',f.run.id),f.graph);
});

test('F003 saved work history is paged without copying every graph payload or losing earlier feedback/events, and reads remain pure',async t=>{
  const f=await authorityFixture(t),s=f.runtime.services,created=await session(f);
  for(let i=0;i<3;i++)await s.workSessions.feedback(actor,'workspace',created.id,{operationId:`feedback-${i}`,expectedSessionVersion:i+1,
    graphDigest:f.graph.digest,objectKey:f.graph.candidates[0].key,answerId:null,kind:'REVIEW_REQUEST',message:`review ${i}`});
  const before=(await f.db.query('SELECT count(*)::int n FROM source_truth_event')).rows;
  const first=await s.workSessions.get(actor,'workspace',created.id,{limit:2});assert.equal(first.records.length,2);assert.ok(first.nextCursor);
  const response=await fetch(`${f.root}/work-sessions/${created.id}?limit=2&cursor=${first.nextCursor}`,{headers:f.headers});
  assert.equal(response.status,200,await response.clone().text());const last=await response.json();
  assert.equal(last.records.length,1);assert.equal(last.nextCursor,null);assert.notEqual(last.records[0].id,first.records[0].id);
  const events=await fetch(`${f.root}/work-sessions/${created.id}/events?afterVersion=0&limit=2`,{headers:f.headers});
  assert.equal(events.status,200,await events.clone().text());const page=await events.json();assert.deepEqual(page.events.map(e=>e.version),[2,3]);assert.equal(page.nextAfterVersion,3);
  const rest=await s.workSessions.events(actor,'workspace',created.id,{afterVersion:3,limit:2});assert.deepEqual(rest.events.map(e=>e.version),[4]);
  assert.deepEqual((await f.db.query('SELECT count(*)::int n FROM source_truth_event')).rows,before);
});

test("F003 question admission pins graph/source/adoption and current team in a separate durable budget, not a new business graph", async t=>{
  const f=await authorityFixture(t);
  f.runtime.services.investigations.profiles=f.profiles; // Explicit isolated F006 mechanism port.
  f.runtime.services.executor.enqueue=()=>{};
  const response=await fetch(`${f.root}/versions/${f.published.publication.graphRevisionId}/work-sessions`,{method:"POST",headers:f.headers,
    body:JSON.stringify({operationId:"qa-session",expectedGraphDigest:f.graph.digest,title:"隔离问答机制"})});
  const {session}=await response.json(); assert.equal(response.status,201);
  const input={operationId:"ask-1",expectedSessionVersion:1,expectedProfileId:f.request.expectedProfileId,
    question:"根据该版图谱，能确定哪些取消条件，还有什么未知？",objectKeys:[f.graph.candidates[0].key],
    budget:{maxReadBytes:8192,maxModelCalls:4,deadline:"2099-01-01T00:00:00Z"}};
  const ask=await fetch(`${f.root}/work-sessions/${session.id}/questions`,{method:"POST",headers:f.headers,body:JSON.stringify(input)});
  assert.equal(ask.status,201,await ask.clone().text());
  const q=await ask.json(); assert.equal(q.run.purpose,"GRAPH_QUESTION"); assert.equal(q.run.state,"QUEUED");
  assert.equal(q.request.binding.graphDigest,f.graph.digest); assert.deepEqual(q.run.adoptedVersionIds,f.graph.adoptedVersionIds);
  assert.equal(q.run.sourceInput.sourceBundleSnapshotId,f.graph.sourceBundleId);
  assert.equal(q.run.profile.id,input.expectedProfileId); assert.deepEqual(q.run.usage,{readBytes:0,modelCalls:0});
  assert.equal(q.answer,null); assert.equal(q.run.latestGraph,undefined);
});

test("F003 Main/Child answer is a persisted evidence-checked derivation, and reopening it offline neither invokes nor changes authority",async t=>{
  const calls=[];
  const f=await authorityFixture(t,{modelExecutor:service=>async c=>{
    const reservation=await service.reserveModelCall(c.actor,c.workspaceId,c.investigationId,{...c,phase:c.input.phase});
    await service.beginModelCall(c.actor,c.workspaceId,c.investigationId,{generation:c.generation,reservationId:reservation.id});
    calls.push({phase:c.input.phase,operation:c.input.operation,slotId:c.slotId});
    const i=c.input;
    const result=i.phase==='PLAN' ? {assignments:[{slotId:i.childSlots[0].id,objectKeys:i.objects.map(o=>o.key)}]}
      :i.operation==='DRAFT' ? {segments:[{key:'a1',text:'该版材料说明用户可取消未支付订单。',stance:'SUPPORTED',graphRefs:[i.objects[0].key],evidence:i.objects[0].evidence,technicalRefs:[],uncertainties:[]}],unknowns:['尚无实际运行证明']}
      :{reviews:i.drafts.flatMap(d=>d.segments).map(s=>({key:s.key,support:'SUPPORTED',rationale:'isolated mechanism review, not quality',unresolvedConflicts:[]}))};
    await service.finishModelCall(c.actor,c.workspaceId,c.investigationId,{generation:c.generation,reservationId:reservation.id,outcome:'SUCCEEDED'});
    return {result,reservationId:reservation.id};
  }});
  const s=f.runtime.services; s.investigations.profiles=f.profiles;
  const created=await s.workSessions.create({actorId:'owner',tenantId:'tenant'},'workspace',f.published.publication.graphRevisionId,
    {operationId:'answer-session',expectedGraphDigest:f.graph.digest,title:'mechanism-only derived answer'});
  const q=await s.workSessions.ask({actorId:'owner',tenantId:'tenant'},'workspace',created.session.id,{operationId:'answer-question',expectedSessionVersion:1,
    expectedProfileId:f.request.expectedProfileId,question:'取消条件有哪些，执行过吗？',objectKeys:[f.graph.candidates[0].key],
    budget:{maxReadBytes:8192,maxModelCalls:4,deadline:'2099-01-01T00:00:00Z'}});
  s.executor.enqueue(q.run); await s.executor.drain();
  const completed=await s.workSessions.question({actorId:'owner',tenantId:'tenant'},'workspace',created.session.id,q.request.id);
  assert.equal(completed.run.state,'COMPLETED',JSON.stringify(completed.run.lastFailure));
  assert.equal(completed.answer.kind,'DERIVED_KNOWLEDGE_ANSWER');
  assert.equal(completed.answer.segments[0].stance,'SUPPORTED');
  assert.equal(completed.answer.binding.graphDigest,f.graph.digest);
  assert.equal(completed.run.usage.modelCalls,3); assert.equal(calls.length,3);
  assert.ok(calls.some(c=>c.slotId==='child-1')); assert.ok(calls.some(c=>c.slotId==='main'));
  s.investigations.profiles.assertUsable=async()=>{throw Error('offline retired model')};
  const reopened=await s.workSessions.question({actorId:'owner',tenantId:'tenant'},'workspace',created.session.id,q.request.id);
  assert.deepEqual(reopened.answer,completed.answer); assert.equal(calls.length,3);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM human_decision")).rows[0].n,0);
  assert.deepEqual(await f.investigations.graph({actorId:'owner',tenantId:'tenant'},'workspace',f.run.id),f.graph);
});
