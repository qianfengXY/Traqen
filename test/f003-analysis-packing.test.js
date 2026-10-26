import test from 'node:test';
import assert from 'node:assert/strict';
import {partitionOriginalMaterials} from '../src/business-knowledge/model-context.js';

test('analysis packing uses remaining physical capacity without reducing raw scope or changing the QA4 default partition',()=>{
  const materials=['a','b','c'].map(id=>({id,sourceMaterial:{id},text:id.repeat(6000),kind:'RAW_MATERIAL'}));
  const qa=partitionOriginalMaterials(materials,12288,{serialized:true});
  const analysis=partitionOriginalMaterials(materials,12288,{serialized:true,packRemaining:true});
  assert.equal(qa.length,3,'QA4 retains the old contract and layout');
  assert.equal(analysis.length,2,'same full source can fit in two actual serialized packets; no extra call required');
  for(const group of analysis)assert.ok(Buffer.byteLength(JSON.stringify(group))<=12288);
  for(const m of materials) {
    const parts=analysis.flat().filter(p=>p.id===m.id).sort((a,b)=>a.byteStart-b.byteStart);
    let end=0;for(const p of parts){assert.equal(p.byteStart,end);end=p.byteEnd;}
    assert.equal(end,Buffer.byteLength(m.text));assert.equal(parts.map(p=>p.text).join(''),m.text);
  }
});

test('analysis physical packing preserves UTF8 byte/line identity across escaped JSON and CRLF boundaries',()=>{
  for(const chunkBytes of [4096,8192,12288])for(const text of ['中文🐾\\\"\r\n'.repeat(2500),'a\n'.repeat(9000),'é—\t'.repeat(3000)]) {
    const materials=[0,1,2].map(n=>({id:'m'+n,sourceMaterial:{id:'m'+n},text,kind:'RAW_MATERIAL'}));
    const groups=partitionOriginalMaterials(materials,chunkBytes,{serialized:true,packRemaining:true});
    for(const group of groups)assert.ok(Buffer.byteLength(JSON.stringify(group))<=chunkBytes);
    for(const m of materials) {
      const parts=groups.flat().filter(p=>p.id===m.id).sort((a,b)=>a.byteStart-b.byteStart);let end=0;
      for(const p of parts){assert.equal(p.byteStart,end);assert.equal(p.byteEnd-p.byteStart,Buffer.byteLength(p.text));end=p.byteEnd;}
      assert.equal(parts.map(p=>p.text).join(''),text);assert.equal(end,Buffer.byteLength(text));
    }
  }
});
