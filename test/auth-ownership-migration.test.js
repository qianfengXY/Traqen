import assert from 'node:assert/strict';
import test from 'node:test';
import {sourceDatabase} from './support/source-truth-database.js';
import {AuthRepository} from '../src/auth/repository.js';
import {AuthService} from '../src/auth/service.js';
import {authPolicy} from '../src/auth/runtime.js';
import {totp} from '../src/auth/crypto.js';
async function setup(t){
 const {db}=await sourceDatabase(t),repository=new AuthRepository(db),now=1800000000000;
 const service=new AuthService({repository,key:Buffer.alloc(32,2),clock:()=>now,policy:authPolicy({DECISION_BUSINESS_ROLES:'approver',DECISION_COMPLIANCE_ROLES:'auditor'})});
 const account=await service.initialize({login:'admin',displayName:'Admin',password:'password1'}),pending=await service.login({login:'admin',password:'password1'}),enrollment=await service.beginTotp(pending.token),session=await service.confirmTotp(pending.token,totp(enrollment.secret,now));
 return {db,repository,service,account,session};
}
test('explicit migration preserves canonical historical identities and rejects D3 conflicts atomically',async t=>{
 const {db,service,account,session}=await setup(t);
 const inventory=await service.inventory();assert.ok(inventory.principals.some(p=>p.id==='owner'));
 await assert.rejects(service.migrate({bindings:[],owners:[],grants:[]}),e=>e.code==='AUTH_MIGRATION_CONFIRMATION_REQUIRED');
 await service.migrate({confirmed:true,requestedBy:'DEPLOYMENT',bindings:[{principalId:'owner',accountId:account.id}],owners:[{workspaceId:'workspace',accountId:account.id}],grants:[{workspaceId:'workspace',accountId:account.id,roles:['approver']}]});
 assert.equal(await service.canonicalActor('owner'),account.id);await service.authorizeActor('owner','workspace','approver');
 await assert.rejects(service.authenticate(session.token),e=>e.code==='AUTH_SESSION_REVOKED');
 await assert.rejects(service.migrate({confirmed:true,requestedBy:'DEPLOYMENT',bindings:[],owners:[],grants:[{workspaceId:'workspace',accountId:account.id,roles:['auditor']}]}),e=>e.code==='AUTH_ROLE_CONFLICT');
 await service.authorizeActor('owner','workspace','approver');await assert.rejects(service.authorizeActor('owner','workspace','auditor'),e=>e.code==='AUTH_FORBIDDEN');
 assert.equal((await db.query("SELECT display_name FROM principal WHERE id='owner'")).rows[0].display_name,'Owner');
 await assert.rejects(service.authorizeActor('unmapped','workspace','READ'),e=>e.code==='AUTH_FORBIDDEN');
});
test('Owner transfer needs acceptance by the named target and administrator designation restores management',async t=>{
 const {service,account,session}=await setup(t);
 const create=await service.apply(session.token,{kind:'CREATE',name:'Transfer',reason:'Owner succession',operationId:'transfer'}),space=await service.decide(session.token,create.id,{approve:true,version:1});
 const created=await service.createAccount(session.token,{login:'successor',displayName:'Successor'});await service.setPassword({credential:created.credential,password:'password1'});const successor=await service.login({login:'successor',password:'password1'});
 await service.transfer(session.token,space.workspaceId,successor.account.id);
 assert.equal((await service.accessContext(successor.token)).spaces[0].pendingOwner,true);assert.deepEqual(await service.listSpaces(successor.token),[]);
 await assert.rejects(service.transfer(session.token,space.workspaceId,null,{confirm:true}),e=>e.code==='AUTH_FORBIDDEN');
 await service.transfer(successor.token,space.workspaceId,null,{confirm:true});assert.equal((await service.authorize(successor.token,space.workspaceId,'OWNER')).owner,true);
 await assert.rejects(service.authorize(session.token,space.workspaceId,'READ'),e=>e.code==='AUTH_FORBIDDEN');
 await service.designateOwner(session.token,space.workspaceId,account.id);assert.equal((await service.authorize(session.token,space.workspaceId,'OWNER')).owner,true);
 await assert.rejects(service.authorize(successor.token,space.workspaceId,'OWNER'),e=>e.code==='AUTH_FORBIDDEN');
});
