import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../src/deterministic-facts/runtime.js';
import {F002Repository} from '../src/deterministic-facts/repository.js';
import {F002QueryService} from '../src/deterministic-facts/queries.js';
import {F002PublicationService} from '../src/deterministic-facts/publication-service.js';
import {F002Worker} from '../src/deterministic-facts/worker.js';
import {owner,sourceDatabase} from './support/source-truth-database.js';
const componentId='a'.repeat(64),bundleId='b'.repeat(64);
const sourceInput={workspaceId:'workspace',bundleId,sourceBundleSnapshotId:bundleId,receiptId:'receipt-1',receiptStatus:'READY',confirmationId:'confirmation-1',acceptanceRecordIds:[],receiptValidUntil:null,qualifiedAt:'2026-09-17T00:00:00.000Z',inventoryId:'inventory-1',inventoryDigest:'inventory-1',policyRevisionId:'policy-v1',inheritedGapSet:{id:'gaps-1',count:'0',consumption:'ALL_PAGES_REQUIRED'}};
async function fixture(t){
 const {db,repository:sources}=await sourceDatabase(t);
 const repository=new F002Repository(db,{authorize:(actor,w,tx,maintain)=>sources.authorize(actor,w,maintain,tx)});
 const profile=runtime.technicalF002Profile();await repository.registerProfile(profile);
 const run=await repository.createAdmittedRun(owner,'workspace',{operationId:'journey',sourceInput,profile,scopes:[{selections:[{kind:'COMPONENT',componentId}]}]});
 const queries=new F002QueryService(repository,{cursorSecret:'journey-test-cursor-secret'});
 return {db,repository,queries,run,scopeId:run.scopes[0].scopeId};
}
test('new review profile keeps exact technical rules but never inherits automatic publication',()=>{
 assert.equal(typeof runtime.reviewF002Profile,'function');
 const old=runtime.technicalF002Profile(),review=runtime.reviewF002Profile();
 assert.equal(old.extractionLimits.automaticPublication,'closed-scope-v1');assert.equal(review.extractionLimits.automaticPublication,undefined);
 assert.notEqual(review.id,old.id);assert.deepEqual(review.ruleVersions,old.ruleVersions);
});
test('unsealed reads bind run/scope/revision, keep signed pagination and reject lifecycle/auth drift',async t=>{
 const {repository,queries,run,scopeId}=await fixture(t);
 const draft=()=>({runId:run.id,scopeId,revision:3});
 assert.equal(typeof queries.preview,'function');
 await assert.rejects(queries.preview(owner,'workspace',draft(),q=>q.collection('materials')),{code:'F002_PREVIEW_NOT_READY'});
 await new F002Worker(repository).run(owner,'workspace',run.id,scopeId,{workerId:'journey-worker',leaseMs:60000,materials:[
 {componentId,pathBytes:Buffer.from('a.js').toString('base64url'),bytes:Buffer.from('export function target(){}; export function caller(){target();}'),mediaType:'text/plain'},
 {componentId,pathBytes:Buffer.from('opaque.custom').toString('base64url'),bytes:Buffer.from('unknown original'),mediaType:'text/plain'}]});
 const ready=(await repository.getRun(owner,'workspace',run.id)).scopes[0];assert.equal(ready.revision,3);
 const read=(fn,binding=draft(),actor=owner,workspace='workspace')=>queries.preview(actor,workspace,binding,fn);
 const first=await read(q=>q.collection('materials',{limit:1}));assert.equal(first.items.length,1);assert.ok(first.nextCursor);
 const second=await read(q=>q.collection('materials',{limit:1,cursor:first.nextCursor}));assert.equal(second.items.length,1);assert.notEqual(second.items[0].id,first.items[0].id);
 const relations=await read(q=>q.collection('relations'));assert.ok(relations.items.length);
 const detail=await read(q=>q.record('FACT',relations.items[0].id));assert.ok(detail.references.some(r=>r.role==='evidence'));
 const graph=await read(q=>q.graph({rootId:relations.items[0].id,depth:2,limit:40}));assert.ok(graph.edges.length);
 const gaps=await read(q=>q.collection('gaps'));assert.ok(gaps.items.some(g=>g.payload.code==='FORMAT_UNSUPPORTED'));
 const manifest=await read(q=>q.manifest());assert.equal(manifest.graphVersionId,undefined);assert.deepEqual(manifest.preview,{...draft(),source:run.sourceInput});
 assert.equal((await read(q=>q.coverage())).counts.PENDING,0);assert.equal((await queries.versions(owner,'workspace')).length,0);
 await assert.rejects(read(q=>q.collection('materials'),{...draft(),revision:2}),{code:'F002_PREVIEW_REVISION_CONFLICT'});
 await assert.rejects(read(q=>q.collection('materials'),draft(),owner,'workspace2'),{code:'SOURCE_FORBIDDEN'});
 await new F002PublicationService(repository).publish(owner,'workspace',run.id,scopeId,{revision:3,operationId:'explicit-seal'});
 await assert.rejects(read(q=>q.collection('materials')),{code:'F002_PREVIEW_NOT_READY'});
 const versions=await queries.versions(owner,'workspace');assert.equal(versions.length,1);
 assert.deepEqual((await queries.collection(owner,'workspace',versions[0].graphVersionId,'relations')).items,relations.items);
});
test('real parser progress is durable, generation-bound and reports completed units without publishing',async t=>{
 const {db,repository,run,scopeId}=await fixture(t);
 await new F002Worker(repository).run(owner,'workspace',run.id,scopeId,{workerId:'progress-worker',leaseMs:60000,materials:[{componentId,pathBytes:Buffer.from('hello.js').toString('base64url'),bytes:Buffer.from('export const answer=42'),mediaType:'text/plain'}]});
 const result=await repository.scopeProgress(owner,'workspace',run.id,scopeId);
 assert.equal(result.scope.status,'READY_TO_SEAL');assert.equal(result.latest.phase,'READY');assert.equal(result.latest.completed,1);assert.equal(result.latest.total,1);
 assert.ok(result.events.some(e=>e.phase==='MATERIALS'&&e.completed===1));assert.ok(result.events.some(e=>e.phase==='DOCUMENT_LINKS'));
 assert.equal(result.workItems.pending,0);assert.ok(result.workItems.total>0);
 assert.ok(result.events.every(e=>e.generation===1&&Number.isFinite(Date.parse(e.updatedAt))));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM f002_fact_set')).rows[0].n,0);
});
test('late progress cannot overwrite cancellation, a retry generation or a foreign scope',async t=>{
 const {repository,run,scopeId}=await fixture(t);
 const claimed=await repository.claimScope(owner,'workspace',run.id,scopeId,{workerId:'late-worker',leaseMs:60000});
 const progress={phase:'MATERIALS',completed:0,total:1};
 const record=()=>repository.recordScopeProgress(owner,{workspaceId:'workspace',runId:run.id,scopeId,generation:claimed.generation,workerId:'late-worker',progress});
 await record();await repository.cancelScope(owner,'workspace',run.id,scopeId,{revision:claimed.revision,operationId:'cancel-progress'});
 await assert.rejects(record(),{code:'F002_STALE_SCOPE_WORKER'});
 const read=await repository.scopeProgress(owner,'workspace',run.id,scopeId);assert.equal(read.scope.status,'CANCELLED');assert.equal(read.latest.completed,0);
 await assert.rejects(repository.scopeProgress(owner,'workspace2',run.id,scopeId),{code:'SOURCE_FORBIDDEN'});
});
