import assert from 'node:assert/strict';
import test from 'node:test';
import {analysisStagePacket,jsonBytes} from '../src/business-knowledge/stage-context.js';

test('Main retains a direct engineering material edge whose unique original+technical closure fits, instead of duplicating the body in endpoint metadata',()=>{
  const raw={id:'code',text:'ANCHOR '+'x'.repeat(60000),sourceMaterial:{id:'code',bundleId:'b'}},doc={id:'doc',text:'ALLOW',sourceMaterial:{id:'doc',bundleId:'b'}};
  const candidate={key:'rule',kind:'RULE',name:'rule',statement:'allow',scope:'fixed',evidence:[{materialId:'doc',startLine:1,endLine:1,quote:'ALLOW'}],technicalRefs:[]};
  const edge={key:'edge',sourceKey:'rule',targetKey:'code',predicate:'IMPLEMENTED_BY',scope:'fixed',evidence:[{materialId:'code',startLine:1,endLine:1,quote:'ANCHOR'}],technicalRefs:['fact']};
  const technical={versionIds:['v'],sourceBundleId:'b',records:[{id:'fact',versionId:'v',record:{subjectId:'object',evidenceIds:[],premiseFactIds:[],proof:'p'.repeat(20000)}}],
    objects:[{objectId:'object',versionId:'v',materialId:'m',name:'code',anchor:{kind:'TEXT',lineStart:1,lineEnd:1}}],evidence:[],
    materials:[{versionId:'v',materialId:'m',sourceMaterial:{id:'code',bundleId:'b'}}],allowedFactIds:['fact'],limitations:[]};
  const before=structuredClone([raw,doc]),packet=analysisStagePacket({phase:'VERIFY',candidates:[candidate],relations:[edge],technicalEvidence:technical,materials:[raw,doc]},[raw,doc]);
  assert.equal(packet.input.relations.length,1,'A <=128KiB unique closure must not be evicted by a second copy of raw endpoint text');
  assert.deepEqual(packet.omitted,[]);assert.ok(jsonBytes(packet.input)<=131072);assert.deepEqual(packet.input.evidenceContext.missingEvidence,[]);
  assert.equal(packet.input.endpoints[0].key,'code');assert.equal('text' in packet.input.endpoints[0],false);
  assert.ok(packet.input.materials.some(m=>m.id==='code'&&m.text===raw.text));assert.deepEqual([raw,doc],before);
});
