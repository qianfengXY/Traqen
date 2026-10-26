import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalEncode} from '../../src/source-truth/identity.js';
import {WorkJournal, beginWorkOperation, operationLookup} from '../app/business-knowledge/work-journal.ts';
const binding={graphRevisionId:'R1',graphDigest:'a'.repeat(64),sourceInput:{sourceBundleSnapshotId:'b'.repeat(64),receiptId:'P',scope:{componentIds:['C']}},adoptedVersionIds:[]};
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
test('durable recovery retains the original canonical request and origin across acknowledgement and later graph adoption',async()=>{
 const j=new WorkJournal(memory(),'w','account','continue:S');
 const input={operationId:'op',expectedSessionVersion:3,question:'问题',scope:{componentIds:['C']},technicalVersionId:null};
 await beginWorkOperation(j,'CONTINUATION','S',binding,input);
 const expected=createHash('sha256').update(canonicalEncode({sessionId:'S',input})).digest('hex');
 j.accepted('op','child');
 assert.equal(j.read().lookup.expectedRequestDigest,expected);
 assert.deepEqual(operationLookup(j.read(),'CONTINUATION','S',{...binding,graphRevisionId:'R2'}),{kind:'CONTINUATION',originSessionId:'S',originGraphRevisionId:'R1',expectedRequestDigest:expected,expectedBinding:binding,expectedResultId:'child'});
 assert.throws(()=>operationLookup(j.read(),'QUESTION','S',binding));
 assert.throws(()=>operationLookup(j.read(),'CONTINUATION','other',binding));
});
test('browser request digest agrees with server canonical JSON for numeric keys, Unicode, negative zero and nesting',async()=>{
 for(const extra of [{2:'二',10:'十',a:[-0,null,true,'é😀']},{title:'old',nested:{z:1,a:0}}]){
  const j=new WorkJournal(memory(),'w','a','create:R');const input={operationId:'op',...extra};
  await beginWorkOperation(j,'CREATE_SESSION',null,binding,input);
  assert.equal(j.read().lookup.expectedRequestDigest,createHash('sha256').update(canonicalEncode({revisionId:'R1',input})).digest('hex'));
 }
 const j=new WorkJournal(memory(),'w','a','bad');
 await assert.rejects(beginWorkOperation(j,'QUESTION','S',binding,{operationId:'op',bad:undefined}));assert.equal(j.read(),null);
});
