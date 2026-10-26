import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {authorityFixture} from './support/f003-authority-fixture.js';
import {AuthService} from '../src/auth/service.js';
import {AuthRepository} from '../src/auth/repository.js';
import {AuthHttp} from '../src/auth/http.js';
import {contextualDatabase} from '../src/auth/database.js';
import {SourceTruthRepository} from '../src/source-truth/repository.js';
import {SourceMaterialRepository} from '../src/source-truth/material-repository.js';
import {SourceCandidateService} from '../src/source-truth/candidate-service.js';
import {SourceAdmissionService} from '../src/source-truth/admission-service.js';
import {createF003Runtime} from '../src/business-knowledge/runtime.js';
import {createTraceabilityHttpHandler} from '../src/api/http-server.js';
import {questionInput} from './support/f003-question-fixture.js';

test('F003 work HTTP enforces actual F008 Cookie/CSRF/Origin/current roles, strict bodies, pure backup-period reads and revocation',async t=>{
  const f=await authorityFixture(t);await f.closeHttp();
  const identity=new AuthService({repository:new AuthRepository(contextualDatabase(f.db)),key:Buffer.alloc(32,37)}),password='isolated-work-password1';
  const admin=await identity.initialize({login:'admin',displayName:'isolated QA administrator',password}),administrator=await identity.login({login:'admin',password}),accounts={};
  for(const login of ['owner','reader']) {
    const made=await identity.createAccount(administrator.token,{login,displayName:`isolated ${login}`});
    await identity.setPassword({credential:made.credential,password});accounts[login]=made.account;
  }
  await identity.migrate({bindings:['owner','reader'].map(principalId=>({principalId,accountId:accounts[principalId].id})),
    owners:[{workspaceId:'workspace',accountId:admin.id}],grants:[{workspaceId:'workspace',accountId:accounts.owner.id,roles:['MAINTAIN']},
      {workspaceId:'workspace',accountId:accounts.reader.id,roles:['READ']}],confirmed:true,requestedBy:'ISOLATED_TEST'});
  let handler;const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin=`http://127.0.0.1:${server.address().port}`,repository=new SourceTruthRepository(f.db,{identityService:identity}),
    admission=new SourceAdmissionService(repository,new SourceCandidateService(repository,new SourceMaterialRepository(repository),f.blobs));
  const runtime=await createF003Runtime({publicationAuthorityFile:null,application:f.application,sourceRuntime:{pool:f.db,
    services:{repository,admission},configuration:{members:[],origins:[origin]}}});t.after(()=>runtime.close());
  const pubs=f.runtime.services.publications;
  // Explicit synthetic quality/restore/F006 ports; identity and HTTP remain real.
  Object.assign(runtime.services.publications,{authority:pubs.authority,qualityPolicy:pubs.qualityPolicy,backup:pubs.backup,implementationResolver:pubs.implementationResolver});
  runtime.services.investigations.profiles=f.profiles;runtime.services.executor.enqueue=()=>{};
  handler=createTraceabilityHttpHandler({application:f.application,auth:new AuthHttp({service:identity,origin,development:true}),businessKnowledgeHandler:runtime.businessKnowledgeHandler});
  async function login(name) {
    const csrf=await fetch(`${origin}/v1/auth/csrf`),proof=await csrf.json();
    const result=await fetch(`${origin}/v1/auth/login`,{method:'POST',headers:{origin,'content-type':'application/json','x-traqen-csrf':proof.csrfToken,
      cookie:csrf.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')},body:JSON.stringify({login:name,password})});
    const body=await result.json();assert.equal(result.status,200,JSON.stringify(body));
    return {cookie:result.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf:body.csrfToken};
  }
  const owner=await login('owner'),reader=await login('reader'),root='/v1/workspaces/workspace/business-knowledge';
  const request=(who,route,body=null,headers={})=>fetch(`${origin}${root}/${route}`,{method:body===null?'GET':'POST',headers:{origin,cookie:who.cookie,
    ...(body===null?{}:{'content-type':'application/json','x-traqen-csrf':who.csrf}),...headers},...(body===null?{}:{body:JSON.stringify(body)})});
  const createPath=`versions/${f.published.publication.graphRevisionId}/work-sessions`,input={operationId:'http-session',expectedGraphDigest:f.graph.digest,title:'real auth, isolated mechanism'};
  assert.equal((await fetch(`${origin}${root}/${createPath}`,{method:'POST',headers:f.headers,body:JSON.stringify(input)})).status,401);
  assert.equal((await request(owner,createPath,input,{'x-traqen-csrf':'wrong'})).status,403);
  assert.equal((await request(owner,createPath,input,{origin:'http://untrusted.invalid'})).status,403);
  assert.equal((await request(reader,createPath,input,{'x-traqen-review-role':'business-owner'})).status,403);
  assert.equal((await request(owner,createPath,{...input,actorId:'reader',approved:true})).status,422);
  const made=await request(owner,createPath,input);assert.equal(made.status,201,await made.clone().text());const {session}=await made.json();
  const ask=await request(owner,`work-sessions/${session.id}/questions`,questionInput(f));assert.equal(ask.status,201,await ask.clone().text());const q=await ask.json();
  assert.equal(q.run.actorId,'owner');assert.equal(q.run.usage.modelCalls,0);assert.equal(q.answer,null);
  assert.equal((await request(reader,`work-sessions/${session.id}/questions/${q.run.id}`)).status,200);
  const published=`versions/${f.published.publication.graphRevisionId}`;
  assert.equal((await request(reader,`${published}/graph?view=IMPLEMENTATION`)).status,200,'minimum F008 READ needs no investigation delegation');
  assert.equal((await request(reader,`investigations/${f.run.id}/graph`)).status,403);
  assert.equal((await request(reader,'work-sessions?limit=1')).status,200);
  assert.equal((await request(reader,'work-operations/http-session?kind=CREATE_SESSION')).status,404,'operation recovery is actor-own, not a shared operation ledger');
  const recovered=await request(owner,'work-operations/http-session?kind=CREATE_SESSION');assert.equal(recovered.status,200);
  assert.equal((await recovered.json()).operation.result.sessionId,session.id);
  const count=()=>f.db.query("SELECT (SELECT count(*) FROM understanding_record) records,(SELECT count(*) FROM source_truth_event) events");
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=true WHERE workspace_id='workspace'");const before=(await count()).rows;
  assert.equal((await request(owner,`work-sessions/${session.id}`)).status,200);assert.deepEqual((await count()).rows,before);
  for(const route of [`${published}/graph?view=COVERAGE`,`${published}/seven-questions?key=${f.graph.candidates[0].key}`,
    `${published}/trace?key=${f.graph.candidates[0].key}`,`${published}/materials`,`${published}/materials/${f.graph.materials[0].id}`,'work-sessions?limit=1']) {
    const read=await request(reader,route);assert.equal(read.status,200,await read.clone().text());
  }
  assert.deepEqual((await count()).rows,before,'new published GETs do not write audit or records inside backup barrier');
  const feedback={operationId:'http-feedback',expectedSessionVersion:2,graphDigest:f.graph.digest,objectKey:f.graph.candidates[0].key,answerId:null,kind:'REVIEW_REQUEST',message:'需要人检查'};
  const blocked=await request(owner,`work-sessions/${session.id}/feedback`,feedback);assert.equal((await blocked.json()).error.code,'F003_BACKUP_BARRIER');
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=false WHERE workspace_id='workspace'");
  runtime.services.publications.qualityPolicy=null;
  const missing=await request(owner,`work-sessions/${session.id}/feedback`,feedback);assert.equal((await missing.json()).error.code,'F003_SESSION_WRITE_BLOCKED');
  const adminSession=await identity.login({login:'admin',password});await identity.grant(adminSession.token,'workspace',{accountId:accounts.owner.id,roles:[]});
  assert.equal((await request(owner,createPath,input)).status,403);assert.equal((await request(owner,`work-sessions/${session.id}`)).status,403);
  assert.equal((await request(reader,`work-sessions/${session.id}`)).status,200);
  await identity.grant(adminSession.token,'workspace',{accountId:accounts.reader.id,roles:[]});
  assert.equal((await request(reader,`${published}/graph`)).status,403);
  assert.equal((await request(reader,`${published}/materials/${f.graph.materials[0].id}`)).status,403);
  assert.equal((await request(reader,'work-sessions')).status,403);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM understanding_record WHERE record_type='KNOWLEDGE_ANSWER'")).rows[0].n,0);
});
