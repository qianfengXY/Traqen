import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkSessionClient} from '../app/business-knowledge/work-client.ts';
const binding={graphRevisionId:'revision',graphDigest:'a'.repeat(64),sourceInput:{sourceBundleSnapshotId:'b'.repeat(64),receiptId:'receipt'},adoptedVersionIds:[]};
const session={id:'session',workspaceId:'workspace',actorId:'canonical-owner',operationId:'create-op',version:1,title:'Persisted session',binding};
test('durable discovery sends exact server filters and preserves opaque pagination without relying on local bookmarks',async()=>{
  const calls=[];const client=new WorkSessionClient('workspace',async(path,method='GET')=>{calls.push({path,method});return {sessions:[{...session,origin:null,investigationId:null,graphState:'EXPLICITLY_ADOPTED'}],nextCursor:'opaque_cursor'};});
  const page=await client.listSessions({graphRevisionId:'revision',limit:1});assert.equal(page.sessions[0].id,'session');assert.equal(page.nextCursor,'opaque_cursor');
  assert.ok(calls[0].path.startsWith('work-sessions?'));assert.equal(calls[0].method,'GET');
  const q=new URLSearchParams(calls[0].path.split('?')[1]);assert.equal(q.get('graphRevisionId'),'revision');assert.equal(q.get('limit'),'1');
  await assert.rejects(client.listSessions({graphRevisionId:'revision',cursor:'opaque_cursor',limit:1}));
});
test('own operation recovery validates kind, original origin and result before returning a readable session; 404 is retained and never retried as POST',async()=>{
  const calls=[],operation={id:'create-op',kind:'CREATE_SESSION',actorId:'canonical-owner',requestDigest:'c'.repeat(64),origin:{sessionId:null,graphRevisionId:'revision'},result:{sessionId:'session'}};
  let body={operation,session};
  const client=new WorkSessionClient('workspace',async(path,method='GET')=>{calls.push({path,method});return body;});
  const fixed={kind:'CREATE_SESSION',originGraphRevisionId:'revision',expectedRequestDigest:'c'.repeat(64)};
  assert.equal((await client.operation('create-op',fixed)).session.id,'session');
  for(const patch of [{id:'other'},{kind:'QUESTION'},{origin:{sessionId:null,graphRevisionId:'other'}},{result:{sessionId:'other'}},{requestDigest:'d'.repeat(64)}]){
    body={operation:{...operation,...patch},session};await assert.rejects(client.operation('create-op',fixed));
  }
  assert.ok(calls.every(c=>c.method==='GET'&&c.path.startsWith('work-operations/create-op?')));
  const missing=Object.assign(new Error('No matching committed operation'),{status:404});
  const denied=new WorkSessionClient('workspace',async()=>{throw missing;});await assert.rejects(denied.operation('create-op',fixed),e=>e===missing);
});
