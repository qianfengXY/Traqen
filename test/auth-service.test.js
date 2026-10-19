import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../src/storage/postgres/migrations.js";
import { AuthRepository } from "../src/auth/repository.js";
import { AuthService } from "../src/auth/service.js";
const migrations = new URL('../db/migrations/',import.meta.url).pathname;
async function fixture(t) {
 const db = await PGlite.create(); t.after(()=>db.close()); await applyMigrations(db,migrations);
 let now=1800000000000;
 const repo=new AuthRepository(db), service=new AuthService({repository:repo,key:Buffer.alloc(32,7),clock:()=>now});
 return {db,repo,service,advance:ms=>{now+=ms;},now:()=>now};
}
async function admin(service,now) {
 const account=await service.initialize({login:'admin',displayName:'Admin',password:'password1'});
 const session=await service.login({login:'admin',password:'password1'});
 assert.equal(session.state,'AUTHENTICATED');
 return {account,session};
}
test('bootstrap is one-shot; terminal initialization activates admin access; sessions survive service recreation',async t=>{
 const {repo,service,now}=await fixture(t);
 const {session}=await admin(service,now);
 await assert.rejects(service.initialize({login:'other',displayName:'Other',password:'password2'}),e=>e.code==='AUTH_ALREADY_INITIALIZED');
 const reopened=new AuthService({repository:repo,key:Buffer.alloc(32,7),clock:now});
 assert.equal((await reopened.authenticate(session.token)).account.login,'admin');
 await reopened.logout(session.token);
 await assert.rejects(service.authenticate(session.token),e=>e.code==='AUTH_SESSION_REVOKED');
});
test('account onboarding gives no spaces; approvals create exactly once and role revocation wins over historic approval',async t=>{
 const {service,now}=await fixture(t); const {session}=await admin(service,now);
 const created=await service.createAccount(session.token,{login:'alice',displayName:'Alice'});
 await service.setPassword({credential:created.credential,password:'password2'});
 const alice=await service.login({login:'alice',password:'password2'});
 assert.deepEqual(await service.listSpaces(alice.token),[]);
 const request=await service.apply(alice.token,{kind:'CREATE',name:'Orders',reason:'Team work',operationId:'create-orders'});
 const [first,second]=await Promise.all([service.decide(session.token,request.id,{approve:true,version:1}),service.decide(session.token,request.id,{approve:true,version:1})]);
 assert.equal(first.workspaceId,second.workspaceId);
 assert.equal((await service.listSpaces(alice.token)).length,1);
 assert.equal((await service.authorize(alice.token,first.workspaceId,'MAINTAIN')).roles.includes('OWNER'),true);
 const bobCreated=await service.createAccount(session.token,{login:'bob',displayName:'Bob'});
 await service.setPassword({credential:bobCreated.credential,password:'password3'});
 const bob=await service.login({login:'bob',password:'password3'});
 const join=await service.apply(bob.token,{kind:'JOIN',workspaceId:first.workspaceId,roles:['MAINTAIN'],reason:'Read',operationId:'join-orders'});
 await service.decide(alice.token,join.id,{approve:true,roles:['READ'],version:1});
 await assert.rejects(service.authorize(bob.token,first.workspaceId,'MAINTAIN'),e=>e.code==='AUTH_FORBIDDEN');
 await service.grant(alice.token,first.workspaceId,{accountId:bob.account.id,roles:[]});
 await service.decide(alice.token,join.id,{approve:true,roles:['READ'],version:1});
 await assert.rejects(service.authorize(bob.token,first.workspaceId,'READ'),e=>e.code==='AUTH_FORBIDDEN');
});
test('administrator roles, D3 conflicts, privilege self-escalation and the last administrator are protected',async t=>{
 const {service,now}=await fixture(t); const {session}=await admin(service,now);
 await assert.rejects(service.updateAccount(session.token,session.account.id,{status:'DISABLED'}),e=>e.code==='AUTH_LAST_ADMIN');
 const r=await service.apply(session.token,{kind:'CREATE',name:'Roles',reason:'Roles',operationId:'roles'});
 const space=await service.decide(session.token,r.id,{approve:true,version:1});
 await assert.rejects(service.grant(session.token,space.workspaceId,{accountId:session.account.id,roles:['business-owner','compliance']}),e=>e.code==='AUTH_ROLE_CONFLICT');
});

test('program credentials are scoped, rotate atomically and cannot participate in human approvals',async t=>{
 const {service,now}=await fixture(t);const {session}=await admin(service,now);
 const request=await service.apply(session.token,{kind:'CREATE',name:'CI',reason:'CI',operationId:'ci'});
 const approved=await service.decide(session.token,request.id,{approve:true,version:1});
 const program=await service.createProgram(session.token,{displayName:'CI',operations:['READ'],workspaceIds:[approved.workspaceId],expiresAt:now()+100000});
 await service.grant(session.token,approved.workspaceId,{accountId:program.account.id,roles:['READ']});
 await service.authorize(program.credential,approved.workspaceId,'READ');
 await assert.rejects(service.authorize(program.credential,approved.workspaceId,'MAINTAIN'),e=>e.code==='AUTH_FORBIDDEN');
 await assert.rejects(service.apply(program.credential,{kind:'CREATE',name:'bad',reason:'bad',operationId:'bad'}),e=>e.code==='AUTH_REQUIRED');
 const rotated=await service.rotateProgram(session.token,program.account.id);
 await assert.rejects(service.authorize(program.credential,approved.workspaceId,'READ'),e=>e.code==='AUTH_PROGRAM_INVALID');
 await service.authorize(rotated.credential,approved.workspaceId,'READ');
 assert.equal((await service.listPrograms(session.token)).length,1,'rotation keeps one management row per program identity');
});
test('a restored instance invalidates old sessions and credentials',async t=>{
 const {service,now}=await fixture(t);const {session}=await admin(service,now);
 await service.enterRecovery({requestedBy:'DEPLOYMENT'});
 await assert.rejects(service.authenticate(session.token),e=>e.code==='AUTH_SESSION_REVOKED');
 await assert.rejects(service.initialize({login:'new',displayName:'New',password:'password4'}),e=>e.code==='AUTH_ALREADY_INITIALIZED');
 await assert.rejects(service.login({login:'admin',password:'password1'}),e=>e.code==='AUTH_RECOVERY_REQUIRED');
});
test('idle expiry ignores polling; restoring per-account positions drops external destinations',async t=>{
 const {service,now,advance}=await fixture(t);const {session}=await admin(service,now);
 await service.savePosition(session.token,'/?page=sources&workspace=W1');
 assert.equal((await service.authenticate(session.token)).position,'/?page=sources&workspace=W1');
 await service.savePosition(session.token,'//evil.test');assert.equal((await service.authenticate(session.token)).position,'/');
 advance(7200001);
 await assert.rejects(service.authenticate(session.token),e=>e.code==='AUTH_SESSION_EXPIRED');
});

test('permission managers cannot approve manager promotion or assign roles to themselves',async t=>{
 const {service,now}=await fixture(t);const {session}=await admin(service,now);
 const create=await service.apply(session.token,{kind:'CREATE',name:'Managed',reason:'Team',operationId:'managed'});
 const space=await service.decide(session.token,create.id,{approve:true,version:1});
 const tokens={};
 for(const login of ['manager','member']){
  const created=await service.createAccount(session.token,{login,displayName:login});
  await service.setPassword({credential:created.credential,password:'password2'});
  tokens[login]=await service.login({login,password:'password2'});
 }
 await service.grant(session.token,space.workspaceId,{accountId:tokens.manager.account.id,roles:['PERMISSION_ADMIN']});
 const request=await service.apply(tokens.member.token,{kind:'JOIN',workspaceId:space.workspaceId,roles:['PERMISSION_ADMIN'],reason:'Manage',operationId:'promote'});
 await assert.rejects(service.decide(tokens.manager.token,request.id,{approve:true,version:1}),e=>e.code==='AUTH_SELF_ESCALATION');
});

test('revoking a program identity fences its credentials and persisted worker principal',async t=>{
 const {service,now}=await fixture(t);const {session}=await admin(service,now);
 const request=await service.apply(session.token,{kind:'CREATE',name:'Worker',reason:'Worker',operationId:'worker'});
 const space=await service.decide(session.token,request.id,{approve:true,version:1});
 const program=await service.createProgram(session.token,{displayName:'Worker',operations:['MAINTAIN'],workspaceIds:[space.workspaceId],expiresAt:now()+100000});
 await service.grant(session.token,space.workspaceId,{accountId:program.account.id,roles:['MAINTAIN']});
 const actor=await service.resolveActor(program.credential,space.workspaceId);
 await service.revokeProgram(session.token,program.account.id);
 await assert.rejects(service.authorize(program.credential,space.workspaceId,'MAINTAIN'),e=>e.code==='AUTH_PROGRAM_INVALID');
 await assert.rejects(service.authorizeActor(actor.actorId,space.workspaceId,'MAINTAIN'),e=>e.code==='AUTH_FORBIDDEN');
});

test('revoking an Owner review role retains ownership without retaining the withdrawn business role',async t=>{
 const {service,now}=await fixture(t);const {session}=await admin(service,now);
 const create=await service.apply(session.token,{kind:'CREATE',name:'Owner roles',reason:'Owner roles',operationId:'owner-roles'});const space=await service.decide(session.token,create.id,{approve:true,version:1});
 const review=await service.apply(session.token,{kind:'JOIN',workspaceId:space.workspaceId,roles:['business-owner'],reason:'Review',operationId:'owner-review'});await service.decide(session.token,review.id,{approve:true,version:1});
 await service.grant(session.token,space.workspaceId,{accountId:session.account.id,roles:[]});
 assert.equal((await service.authorize(session.token,space.workspaceId,'OWNER')).owner,true);
 await assert.rejects(service.reviewer(space.workspaceId,session.token,'business-owner'),e=>e.code==='AUTH_FORBIDDEN');
});

test('restoring an account-empty backup uses explicit terminal recovery without reopening initialization',async t=>{
 const {service,now}=await fixture(t);await service.enterRecovery({requestedBy:'DEPLOYMENT'});
 const account=await service.trustRecoveryAdmin({login:'recovery-admin',displayName:'Recovery administrator',password:'password1',requestedBy:'DEPLOYMENT'});
 await assert.rejects(service.initialize({login:'hijack',displayName:'Hijack',password:'password1'}),e=>e.code==='AUTH_ALREADY_INITIALIZED');
 const session=await service.login({login:'recovery-admin',password:'password1'});assert.equal(session.state,'AUTHENTICATED');
 assert.equal((await service.authenticate(session.token)).restrictedRestore,true);
 await service.finishRecovery({requestedBy:'DEPLOYMENT',confirmed:true});assert.equal((await service.authenticate(session.token)).restrictedRestore,false);assert.equal(session.account.id,account.id);
});

test('administrator self-grants through ordinary member management remain derived and expire on demotion',async t=>{
 const {service,now}=await fixture(t);const first=await admin(service,now);
 async function person(login){const created=await service.createAccount(first.session.token,{login,displayName:login});await service.setPassword({credential:created.credential,password:'password1'});return {account:created.account,session:await service.login({login,password:'password1'})};}
 const owner=await person('owner');const request=await service.apply(owner.session.token,{kind:'CREATE',name:'Independent owner',reason:'Team',operationId:'independent'});const space=await service.decide(first.session.token,request.id,{approve:true,version:1});
 await service.grant(first.session.token,space.workspaceId,{accountId:first.account.id,roles:['READ']});
 const second=await person('second-admin');await service.updateAccount(first.session.token,second.account.id,{admin:true});const secondSession=await service.login({login:'second-admin',password:'password1'});
 await service.updateAccount(secondSession.token,first.account.id,{admin:false});const ordinary=await service.login({login:'admin',password:'password1'});
 await assert.rejects(service.authorize(ordinary.token,space.workspaceId,'READ'),e=>e.code==='AUTH_FORBIDDEN');
 assert.equal((await service.authorize(owner.session.token,space.workspaceId,'READ')).owner,true);
});
