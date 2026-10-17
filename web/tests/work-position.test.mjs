import assert from 'node:assert/strict';
import test from 'node:test';
import {graphAtPosition, workPosition} from '../app/work-position.ts';
const current={revision:{id:'LATEST'},graphArtifact:{nodes:[{id:'LATEST-OBJECT'}]}};
const historical={revision:{id:'OLDER'},graphArtifact:{nodes:[{id:'OLD-1'},{id:'OLD-2'}]}};
test('exact historical graph and object survive serialized positions without reading the latest as a substitute',async()=>{
 const calls=[];const search='?page=graph&workspace=W1&revision=OLDER&objectId=OLD-2';
 const restored=await graphAtPosition(search,current,async id=>{calls.push(id);return historical;});
 assert.equal(restored.selected.revision.id,'OLDER');assert.equal(restored.focusedId,'OLD-2');assert.equal(restored.historical,true);assert.deepEqual(calls,['OLDER']);
 await assert.rejects(graphAtPosition(search,current,async()=>{throw new Error('404');}),/指定图谱版本无法读取/);
 await assert.rejects(graphAtPosition(search.replace('OLD-2','MISSING'),current,async()=>historical),/指定图谱对象无法读取/);
 assert.equal((await graphAtPosition('?page=graph',current,async()=>assert.fail())).selected,current);
});
test('source positions retain an explicit nonlatest bundle, receipt and capture independently',()=>{
 assert.deepEqual(workPosition('?page=sources&workspace=W1&bundleId=OLDER&receiptId=RECEIPT-1&runId=OLD-TASK'),{revision:null,objectId:null,bundleId:'OLDER',receiptId:'RECEIPT-1',runId:'OLD-TASK'});
});
