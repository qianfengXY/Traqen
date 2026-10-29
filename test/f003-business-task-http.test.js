import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {knowledgeServerFixture,syntheticPassword} from './support/f002-f003-server-fixture.js';
import {isolatedPostgres} from './support/source-truth-postgres.js';
import {technicalF002Profile} from '../src/deterministic-facts/runtime.js';
import {owner} from './support/source-truth-database.js';
import {analysisContractVersion} from '../src/business-knowledge/model-context.js';

// Actual Cookie/F008/F001/F002/F006 registry/Worker/native SQL. Only the
// external CLI process is synthetic; no real model or quality assertion.
test('F003 bounded task manifest survives native restart through actual Cookie/F006; old operation replays without admission or model writes',
  {timeout:120000},async t=>{
    assert.ok(process.env.F001_TEST_PG_BIN,'owned native PostgreSQL is required, not skipped');
    const pg=await isolatedPostgres(t);let databaseName;
    const f=await knowledgeServerFixture(t,{database:async()=>{const db=await pg.createDatabase();databaseName=db.name;return db;},modelResponse:i=>{
      if(i.phase==='PLAN')return {assignments:i.inventory.filter(m=>m.kind==='FILE').map(m=>({slotId:i.childSlots[0].id,
        objective:m.path.endsWith('.js')?'该函数声明返回什么状态？':'该API声明何种响应？',obligations:['保留声明范围、条件和未证实执行'],materialKeys:[m.key]})),
        pendingMaterials:i.inventory.filter(m=>m.kind!=='FILE').map(m=>({materialKey:m.key,reason:'非文本目录保持未完成'}))};
      if(i.phase==='INVESTIGATE')return {candidates:i.materials.map(m=>({key:'local-declaration',kind:'FUNCTION',name:'synthetic declaration',statement:m.text,
        scope:'exact synthetic source declaration, not execution',uncertainties:['mechanism double'],
        evidence:[{materialId:m.id,startLine:m.startLine,endLine:m.startLine,quote:m.text.split('\n')[0]}]})),relations:[],requestedMaterialKeys:[],
        obligationResults:i.task.obligations.map(obligation=>({obligation,status:'EVIDENCE_FOUND',reason:'synthetic exact line'}))};
      if(i.stage==='CONSOLIDATE_PROPOSALS')return {mergeSuggestions:[],conflictGroups:[]};
      return {reviews:i.candidates.map(c=>({key:c.key,support:'SUPPORTED',rationale:'synthetic evidence mechanism',premises:['only source declaration'],unresolvedConflicts:[]}))};
    }});
    async function login(name='owner') {
      const proof=await fetch(f.runtime.origin+'/v1/auth/csrf'),p=await proof.json();
      const r=await fetch(f.runtime.origin+'/v1/auth/login',{method:'POST',headers:{origin:f.runtime.origin,'content-type':'application/json',
        'x-traqen-csrf':p.csrfToken,cookie:proof.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')},body:JSON.stringify({login:name,password:syntheticPassword})});
      const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return {cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),csrf:b.csrfToken};
    }
    let session=await login();
    const root='/v1/workspaces/workspace/business-knowledge/investigations',facts='/v1/workspaces/workspace/deterministic-facts';
    async function request(path,body=null,who=session,extra={}) {
      const r=await fetch(f.runtime.origin+path,{method:body===null?'GET':'POST',headers:{origin:f.runtime.origin,cookie:who.cookie,
        ...(body===null?{}:{'content-type':'application/json','x-traqen-csrf':who.csrf}),...extra},...(body===null?{}:{body:JSON.stringify(body)})});
      return {status:r.status,body:await r.json()};
    }
    async function until(read,predicate){let v;for(let n=0;n<600;n++){v=await read();if(predicate(v))return v;await delay(25);}assert.fail(JSON.stringify(v));}
    await f.runtime.knowledge.facts.services.repository.registerProfile(technicalF002Profile());
    const technical=await request(facts+'/runs',{operationId:'bounded-tech',source:f.reference,profileId:technicalF002Profile().id,
      scopes:[{selections:[{kind:'COMPONENT',componentId:f.componentId}]}]});assert.equal(technical.status,202,JSON.stringify(technical));
    const sealed=await until(()=>request(facts+'/runs/'+technical.body.run.id),r=>r.body.run?.scopes[0].status==='SEALED');
    const input={operationId:'bounded-http-run',reference:f.reference,expectedProfileId:f.profile.id,question:'订单API和状态声明有哪些约束？',
      technicalVersionId:sealed.body.run.scopes[0].graphVersionId,scope:{componentIds:[f.componentId]},
      budget:{maxReadBytes:65536,maxModelCalls:6,deadline:'2099-01-01T00:00:00Z'},
      supplementBudget:{maxMaterials:10,maxBytes:65536,maxRuleApplications:100,maximumAttempts:2,deadline:'2099-01-01T00:00:00Z'}};
    const oldInput={...input,operationId:'old-lost-reply'},s=f.runtime.knowledge.business.services;
    const old=await s.investigations.start(owner,'workspace',oldInput);
    await f.runtime.db.query("UPDATE f003_investigation SET payload=jsonb_set(payload,'{analysisContractVersion}','9') WHERE id=$1",[old.id]);
    const beforeOld=(await request(root+'/'+old.id)).body.investigation;
    f.model.release();const oldReplay=await request(root,oldInput);assert.equal(oldReplay.status,202);assert.equal(oldReplay.body.investigation.id,old.id);
    await s.executor.drain();assert.deepEqual((await request(root+'/'+old.id)).body.investigation,beforeOld);
    const made=await request(root,input);assert.equal(made.status,202,JSON.stringify(made));const id=made.body.investigation.id;
    const completed=await until(()=>request(root+'/'+id),r=>['FAILED','COMPLETED'].includes(r.body.investigation?.state));
    assert.equal(completed.body.investigation.state,'COMPLETED',JSON.stringify(completed));assert.equal(completed.body.investigation.analysisContractVersion,analysisContractVersion);
    const taskUrl=root+'/'+id+'/task-evidence?'+new URLSearchParams({expectedRevision:String(completed.body.investigation.revision),expectedGraphDigest:completed.body.investigation.latestGraph.digest});
    const taskEvidence=await request(taskUrl);
    assert.equal(taskEvidence.status,200,JSON.stringify(taskEvidence));
    assert.equal(taskEvidence.body.taskEvidence.tasks.filter(task=>task.role==='CHILD').length,2);
    assert.ok(taskEvidence.body.taskEvidence.tasks.flatMap(task=>task.obligations).some(obligation=>obligation.status==='REPORTED_NOT_VERIFIED'));
    assert.ok(!JSON.stringify(taskEvidence).includes('outputContract'),'HTTP never returns the model input envelope');
    assert.equal((await request(taskUrl.replace('expectedGraphDigest=','expectedGraphDigest=bad'))).status,422);
    const graph=await s.investigations.graph(owner,'workspace',id),checkpoints=await s.investigations.checkpoints(owner,'workspace',id);
    const manifest=checkpoints.find(c=>c.key==='business-task-manifest').payload.data;
    assert.equal(manifest.tasks.length,2);assert.equal(graph.candidates.length,2);assert.equal(completed.body.investigation.usage.modelCalls,5);
    assert.ok(manifest.tasks.every(task=>task.inputDigest===graph.process.find(p=>p.taskKey===task.taskKey).inputDigest));
    assert.deepEqual(completed.body.investigation.adoptedVersionIds,[input.technicalVersionId]);
    const audit=(await request(root+'/'+id+'/events')).body.events;
    const reservations=audit.filter(e=>e.event_type==='MODEL_CALL_RESERVED');
    assert.equal(reservations.length,5);
    assert.ok(reservations.every(e=>/^[a-f0-9]{64}$/.test(e.payload.semanticContextDigest)));
    assert.equal(new Set(reservations.map(e=>e.payload.semanticContextDigest)).size,1,'same fixed source/adoption is one server context');
    const reader=await login('reader');assert.equal((await request(root+'/'+id,null,reader)).status,403);
    assert.equal((await request(taskUrl,null,reader)).status,403);
    assert.equal((await request(root,{...input,operationId:'forged-contract',analysisContractVersion})).status,422);
    assert.equal((await request(root,{...input,operationId:'wrong-csrf'},session,{'x-traqen-csrf':'wrong'})).status,403);
    const count=()=>f.runtime.db.query("SELECT (SELECT count(*) FROM f003_investigation_event)::int events,(SELECT count(*) FROM f003_checkpoint)::int checkpoints");
    await f.runtime.db.query("UPDATE source_truth_workspace SET backup_barrier=true WHERE workspace_id='workspace'");
    const before=(await count()).rows;assert.equal((await request(root+'/'+id+'/graph')).status,200);assert.equal((await request(root+'/'+id+'/events')).status,200);
    assert.equal((await request(taskUrl)).status,200,'read-only task evidence remains readable during the existing backup write barrier');
    assert.deepEqual((await count()).rows,before);
    await f.runtime.db.query("UPDATE source_truth_workspace SET backup_barrier=false WHERE workspace_id='workspace'");
    const calls=f.model.calls.length;await f.stop();await pg.restart();await f.start(pg.pool(databaseName));session=await login();
    assert.deepEqual(await f.runtime.knowledge.business.services.investigations.graph(owner,'workspace',id),graph);
    assert.deepEqual(await f.runtime.knowledge.business.services.investigations.checkpoints(owner,'workspace',id),checkpoints);
    assert.deepEqual((await request(root+'/'+id+'/events')).body.events,audit);
    assert.deepEqual((await request(taskUrl)).body.taskEvidence,taskEvidence.body.taskEvidence);
    assert.equal((await request(root,oldInput)).body.investigation.id,old.id);
    await f.runtime.knowledge.business.services.executor.drain();assert.equal(f.model.calls.length,calls);
    assert.deepEqual((await request(root+'/'+old.id)).body.investigation,beforeOld);
    assert.equal((await request(root+'/'+id)).body.investigation.usage.modelCalls,5);
    console.log(JSON.stringify({kind:'BOUNDED_BUSINESS_TASK_NATIVE_COOKIE_MECHANISM_ONLY',tasks:2,contractVersion:analysisContractVersion,questionContractUnchanged:4,
      technicalProfile:technicalF002Profile().id,calls:5,nativeRestart:true,oldOperationModelCalls:0,realModel:false,realQuality:false}));
  });
