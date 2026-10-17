import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, PostgresTraceabilityStore } from '../src/storage/index.js';
import { contextualDatabase } from '../src/auth/database.js';
import { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import { AuthHttp } from '../src/auth/http.js';
import { authorizedStore } from '../src/auth/authorized-store.js';
import { authContext } from '../src/auth/context.js';
import { createConfiguredApplication } from '../src/api/application-bootstrap.js';
import { createTraceabilityHttpServer } from '../src/api/http-server.js';
import { totp } from '../src/auth/crypto.js';
async function fixture(t){
 const db=await PGlite.create();t.after(()=>db.close());const database=contextualDatabase(db);
 await applyMigrations(database,new URL('../db/migrations/',import.meta.url).pathname);
 let now=1800000000000;const service=new AuthService({repository:new AuthRepository(database),key:Buffer.alloc(32,8),clock:()=>now});
 const bootstrap={active:true};const configured=authContext.run({system:true},()=>createConfiguredApplication({store:authorizedStore(new PostgresTraceabilityStore(database),service,database,{bootstrap}),identityService:service,env:{}}));
 await configured.ready;bootstrap.active=false;
 const http=new AuthHttp({service,origin:'http://127.0.0.1:54321',development:true});const server=createTraceabilityHttpServer({application:configured.application,auth:http});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;http.origin=base;http.host=new URL(base).host;
 function client(){const jar={};let csrf='';return {async call(path,method='GET',body,extra={}){
  const response=await fetch(base+path,{method,headers:{...(['GET','HEAD'].includes(method)?{}:{origin:base,'x-traqen-csrf':csrf}),cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{'content-type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
  for(const cookie of response.headers.getSetCookie()){const [key,value]=cookie.split(';')[0].split('=');jar[key]=value;}
  const result=await response.json();if(result.csrfToken)csrf=result.csrfToken;return {status:response.status,body:result};
 },async login(login,password='password1'){await this.call('/v1/auth/csrf');const r=await this.call('/v1/auth/login','POST',{login,password});assert.equal(r.status,200);return r.body;}};}
 async function admin(){await service.initialize({login:'admin',displayName:'Admin',password:'password1'});const c=client();await c.login('admin');const setup=(await c.call('/v1/auth/totp/begin','POST',{})).body;const verified=await c.call('/v1/auth/totp/confirm','POST',{code:totp(setup.secret,now)});assert.equal(verified.status,200);return c;}
 return {service,base,client,admin,advance:ms=>{now+=ms;}};
}
test('real HTTP composition isolates identities, preserves application decisions and protects every workspace alias',async t=>{
 const f=await fixture(t),admin=await f.admin();
 const create=await admin.call('/v1/access/applications','POST',{kind:'CREATE',name:'Orders',reason:'Team work',operationId:'orders'});assert.equal(create.status,200);
 const approved=await admin.call(`/v1/access/applications/${create.body.id}/decide`,'POST',{approve:true,version:1});assert.equal(approved.status,200);const id=approved.body.workspaceId;
 assert.equal((await admin.call('/v1/access/applications','POST',{kind:'CREATE',name:'Orders',reason:'Duplicate',operationId:'orders-again'})).status,409);
 const created=await admin.call('/v1/admin/accounts','POST',{login:'alice',displayName:'Alice'});assert.equal(created.status,200);
 const alice=f.client();await alice.call('/v1/auth/csrf');assert.equal((await alice.call('/v1/auth/set-password','POST',{credential:created.body.credential,password:'password1'})).status,200);await alice.login('alice');
 assert.deepEqual((await alice.call('/v1/workspaces')).body.workspaces,[]);
 const directory=await alice.call('/v1/access/directory');assert.deepEqual(Object.keys(directory.body.spaces[0]).sort(),['id','name','ownerName']);
 const join=await alice.call('/v1/access/applications','POST',{kind:'JOIN',workspaceId:id,roles:['MAINTAIN'],reason:'Read only is sufficient',operationId:'join'});assert.equal(join.status,200);
 const granted=await admin.call(`/v1/access/applications/${join.body.id}/decide`,'POST',{approve:true,roles:['READ'],version:1});assert.deepEqual(granted.body.actualRoles,['READ']);
 const exact=await admin.call(`/v1/access/applications?pending=true&applicationId=${join.body.id}`);
 assert.equal(exact.body.applications.length,1);assert.equal(exact.body.applications[0].id,join.body.id);assert.equal(exact.body.applications[0].status,'APPROVED');
 assert.equal(exact.body.applications[0].canDecide,true);
 assert.deepEqual((await alice.call(`/v1/access/applications?applicationId=${create.body.id}`)).body.applications,[],'a link cannot expose another applicant reason');
 assert.equal((await alice.call('/v1/workspaces')).body.workspaces[0].id,id);
 assert.equal((await alice.call(`/v1/workspaces/${id}`)).status,200);
 const catalog=await alice.call(`/v1/workspaces/${id}/settings-catalog`);assert.equal(catalog.status,200);assert.deepEqual(catalog.body.models,[]);assert.equal((await alice.call('/v1/global-accounts')).status,403);
 assert.equal((await alice.call(`/v1/projects/${id}/features`)).status,200);
 await admin.call(`/v1/access/spaces/${id}/members`,'PUT',{accountId:created.body.account.id,roles:['READ','developer']});
 const review=await alice.call(`/v1/projects/${id}/features/MISSING/claims/CLAIM/implementation-reanalyses`,'POST',{id:'review',sourceRunId:'run',sourceCandidateId:'candidate',rationale:'Review with granted implementation role'}, {'x-traqen-review-role':'developer'});assert.equal(review.status,409,'review role reaches object validation without requiring MAINTAIN');
 assert.equal((await alice.call(`/v1/workspaces/${id}?userId=forged`)).status,400);
 assert.equal((await alice.call(`/v1/workspaces/${id}`,'PATCH',{name:'Forged'})).status,403);
 assert.equal((await admin.call(`/v1/workspaces/${id}`,'PATCH',{name:'Forged',actorId:'someone-else'})).status,400);
 assert.equal((await alice.call(`/v1/workspaces/${id}/view-preference`,'PUT',{hidden:true})).status,200);
 assert.equal((await alice.call('/v1/workspaces')).body.workspaces[0].hidden,true);
 assert.equal((await alice.call('/v1/workspaces','GET',undefined,{authorization:'Bearer old-deployment-token'})).status,400);
 assert.equal((await alice.call(`/v1/workspaces/${id}/view-preference`,'PUT',{hidden:false},{origin:'http://another.localhost'})).body.error.code,'AUTH_CSRF_REJECTED');
 assert.equal((await admin.call(`/v1/access/spaces/${id}/members`,'PUT',{accountId:created.body.account.id,roles:[]})).status,200);
 assert.equal((await alice.call(`/v1/projects/${id}/features`)).status,403);
 await admin.call(`/v1/access/applications/${join.body.id}/decide`,'POST',{approve:true,roles:['READ'],version:1});assert.equal((await alice.call(`/v1/workspaces/${id}`)).status,403);
 assert.equal((await alice.call('/v1/admin/accounts')).status,403);
 await admin.call(`/v1/access/spaces/${id}/settings`,'PUT',{visibility:'SECRET'});
 assert.deepEqual((await alice.call('/v1/access/directory')).body.spaces,[]);
 const unavailable=await alice.call(`/v1/workspaces/${id}`),absent=await alice.call('/v1/workspaces/does-not-exist');assert.equal(unavailable.status,404);assert.equal(absent.status,404);assert.equal(unavailable.body.error.code,absent.body.error.code);
});
