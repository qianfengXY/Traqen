import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../src/storage/postgres/migrations.js';
import { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import { AuthHttp } from '../src/auth/http.js';
import { createTraceabilityHttpServer } from '../src/api/http-server.js';
let origin='http://localhost:54321';
async function fixture(t) {
 const db=await PGlite.create();t.after(()=>db.close());await applyMigrations(db,new URL('../db/migrations/',import.meta.url).pathname);
 const service=new AuthService({repository:new AuthRepository(db),key:Buffer.alloc(32,3)});
 const auth=new AuthHttp({service,origin,development:true});
 const app={listWorkspaces:async()=>[{id:'SECRET',name:'Secret space'}]};
 const server=createTraceabilityHttpServer({application:app,auth});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const base=`http://127.0.0.1:${server.address().port}`; origin=base; auth.origin=base; auth.host=new URL(base).host;
 return {base,service,auth,request:(path,options={})=>fetch(base+path,{...options,headers:{host:'localhost:54321',...options.headers}})};
}
test('uninitialized and shared-token callers cannot enter business routes',async t=>{
 const {request}=await fixture(t);
 let response=await request('/v1/workspaces');assert.equal(response.status,503);assert.equal((await response.json()).error.code,'AUTH_NOT_INITIALIZED');
 response=await request('/v1/workspaces',{headers:{authorization:'Bearer old-deployment-token'}});assert.notEqual(response.status,200);
 assert.equal((await request('/health')).status,200);
});
test('login mutations require exact Origin and signed CSRF proof, including prelogin',async t=>{
 const {request}=await fixture(t);
 for(const headers of [{},{origin:'null'},{origin:'http://attacker.localhost:54321'},{origin}]) {
  const response=await request('/v1/auth/login',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({login:'admin',password:'password1'})});
  assert.equal(response.status,403);assert.equal((await response.json()).error.code,'AUTH_CSRF_REJECTED');
 }
 const bootstrap=await request('/v1/auth/csrf');assert.equal(bootstrap.status,200);
 const {csrfToken}=await bootstrap.json();assert.ok(csrfToken);
 const cookie=bootstrap.headers.get('set-cookie').split(';')[0];
 const response=await request('/v1/auth/login',{method:'POST',headers:{origin,'x-traqen-csrf':csrfToken,cookie,'content-type':'application/json'},body:'{}'});
 assert.equal(response.status,503);
});

test('unsigned workspace observations cannot bypass account and space authorization',async t=>{
 const {service,request}=await fixture(t);
 await service.initialize({login:'admin',displayName:'Admin',password:'password1'});
 const response=await request('/v1/projects/not-owned/workspace-observations',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.equal(response.status,403);assert.equal((await response.json()).error.code,'AUTH_CSRF_REJECTED');
});

test('login never trusts a browser-supplied source address for rate limiting',async t=>{
 const {service,request}=await fixture(t);await service.initialize({login:'admin',displayName:'Admin',password:'password1'});
 const response=await request('/v1/auth/csrf'),csrf=(await response.json()).csrfToken,cookie=response.headers.get('set-cookie').split(';')[0];
 await request('/v1/auth/login',{method:'POST',headers:{cookie,origin,'x-traqen-csrf':csrf,'content-type':'application/json'},body:JSON.stringify({login:'missing',password:'password1',source:'forged-source'})});
 const records=await service.repository.read();assert.equal(Object.keys(records.attempts).some(key=>key.startsWith('source:')),false);
});

test('public login admission bounds queued password work before it reaches the database',async t=>{
 const {service,request}=await fixture(t);await service.initialize({login:'admin',displayName:'Admin',password:'password1'});
 const pre=await request('/v1/auth/csrf'),csrf=(await pre.json()).csrfToken,cookie=pre.headers.get('set-cookie').split(';')[0];
 const results=await Promise.all(Array.from({length:40},async()=>{const response=await request('/v1/auth/login',{method:'POST',headers:{cookie,origin,'x-traqen-csrf':csrf,'content-type':'application/json'},body:JSON.stringify({login:'unknown',password:'wrong-password'})});return {status:response.status,code:(await response.json()).error?.code};}));
 assert.ok(results.every(result=>[401,429].includes(result.status)));
 assert.ok(results.some(result=>result.code==='AUTH_BUSY'),'excess requests are rejected before waiting for the global auth transaction');
});
