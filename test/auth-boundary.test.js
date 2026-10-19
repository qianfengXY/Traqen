import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceDatabase } from './support/source-truth-database.js';
import { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import { authorizedStore } from '../src/auth/authorized-store.js';
import { authContext } from '../src/auth/context.js';
import { PostgresTraceabilityStore } from '../src/storage/postgres/postgres-traceability-store.js';
import { contextualDatabase } from '../src/auth/database.js';
test('service persistence boundary checks actual workspace and current grants, with no ambient bypass',async t=>{
 const {db}=await sourceDatabase(t),database=contextualDatabase(db);
 const service=new AuthService({repository:new AuthRepository(database),key:Buffer.alloc(32,2),clock:()=>1800000000000});
 const admin=await service.initialize({login:'admin',displayName:'Admin',password:'password1'});
 const session=await service.login({login:'admin',password:'password1'});
 await service.repository.change(s=>{for(const id of ['workspace','workspace2']){s.spaces[id]={id,status:'ACTIVE',visibility:'DISCOVERABLE',tenantId:'tenant',ownerId:admin.id};s.grants[id]={workspaceId:id,accountId:admin.id,roles:['OWNER'],source:'DIRECT'};}s.bindings.owner={principalId:'owner',accountId:admin.id,tenantId:'tenant'};});
 const store=authorizedStore(new PostgresTraceabilityStore(database),service,database);
 await assert.rejects(store.getProjectFoundation('workspace'),e=>e.code==='AUTH_CONTEXT_REQUIRED');
 await authContext.run({accountId:admin.id,actorId:'owner',workspaceId:'workspace',operation:'READ'},async()=>{
  assert.equal((await store.getProjectFoundation('workspace')).project.id,'workspace');
  await assert.rejects(store.getProjectFoundation('workspace2'),e=>e.code==='AUTH_OBJECT_SPACE_MISMATCH');
 });
});

test('a session revoked after HTTP admission cannot write through the persistence boundary',async t=>{
 const {db}=await sourceDatabase(t),database=contextualDatabase(db);
 const service=new AuthService({repository:new AuthRepository(database),key:Buffer.alloc(32,2),clock:()=>1800000000000});
 const admin=await service.initialize({login:'admin',displayName:'Admin',password:'password1'});
 const session=await service.login({login:'admin',password:'password1'});
 await service.repository.change(s=>{s.spaces.workspace={id:'workspace',status:'ACTIVE',visibility:'DISCOVERABLE',tenantId:'tenant',ownerId:admin.id};s.grants.workspace={workspaceId:'workspace',accountId:admin.id,roles:['OWNER'],source:'DIRECT'};s.bindings.owner={principalId:'owner',accountId:admin.id,tenantId:'tenant'};});
 const store=authorizedStore(new PostgresTraceabilityStore(database),service,database);
 await service.authorize(session.token,'workspace','MAINTAIN');await service.logout(session.token);
 await authContext.run({raw:session.token,accountId:admin.id,actorId:'owner',workspaceId:'workspace',operation:'MAINTAIN'},async()=>{
  await assert.rejects(store.appendUnderstandingRecord('workspace','WORKSPACE_EVENT',{id:'stale',type:'WORKSPACE_RENAMED',payload:{name:'stale request'}}),e=>e.code==='AUTH_SESSION_REVOKED');
 });
 assert.equal((await db.query("SELECT count(*)::integer AS count FROM understanding_record WHERE record_payload->>'id'='stale'")).rows[0].count,0);
});
