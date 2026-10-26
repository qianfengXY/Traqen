import assert from 'node:assert/strict';
import test from 'node:test';
import {analysisStagePacket,selectStageTechnical,stageInput,analysisInputBytes,stageTechnicalBytes,jsonBytes,questionStagePacket,questionPlanPacket} from '../src/business-knowledge/stage-context.js';
import {partitionOriginalMaterials} from '../src/business-knowledge/model-context.js';
import {publicationDigest as digest} from '../src/business-knowledge/publication-authority.js';

const technical={sourceBundleId:'bundle',versionIds:[],records:[],objects:[],evidence:[],materials:[],allowedFactIds:[],limitations:[],unresolved:[],truncated:false};
const raw=(id,text)=>({id,text,sourceMaterial:{id,bundleId:'bundle'}});
const cite=(id,quote)=>({materialId:id,startLine:1,endLine:1,quote});
const candidate=(key,id,quote)=>({key,kind:'RULE',name:key,statement:'A bounded proposition',scope:'fixed scope',evidence:[cite(id,quote)],technicalRefs:[],originRefs:[key],consolidationIssues:[]});

test('F003 Main stage retains directed endpoints and actual full citation lines, not a small anchor quote',()=>{
  const a=candidate('a','doc','ALLOW'),b=candidate('b','condition','ANCHOR'),edge={key:'edge',sourceKey:'a',targetKey:'b',predicate:'INVOKES',scope:'unpaid',evidence:[cite('code','CALL')],technicalRefs:[]};
  const originals=[raw('doc','ALLOW\n'),raw('condition','RAW_CONDITION_ONLY_UNPAID ANCHOR\n'),raw('code','CALL\n')];
  const packet=analysisStagePacket({phase:'VERIFY',stage:'EVIDENCE_VERIFICATION',candidates:[a,b],relations:[edge],materials:originals,technicalEvidence:technical},originals);
  assert.ok(packet.input.materials.some(m=>m.text.includes('RAW_CONDITION_ONLY_UNPAID')));
  assert.equal(packet.input.relations[0].sourceKey,'a');assert.equal(packet.input.relations[0].targetKey,'b');
  assert.ok(jsonBytes(packet.input)<=analysisInputBytes);
});

test('F003 oversized Main proposal stays pending while a valid independent branch retains its complete original context',()=>{
  const good=candidate('good','doc','ALLOW'),large={...candidate('large','doc','ALLOW'),uncertainties:['x'.repeat(300000)]};
  const original=raw('doc','ALLOW\n'),input={phase:'VERIFY',stage:'CONSOLIDATE_PROPOSALS',candidates:[large,good],relations:[],originalProposals:[],materials:[original],technicalEvidence:technical};
  const before=structuredClone(input),packet=analysisStagePacket(input,[original]);
  assert.deepEqual(packet.input.candidates.map(p=>p.key),['good']);
  assert.deepEqual(packet.omitted,[{key:'large',reason:'MODEL_INPUT_BYTE_BUDGET'}]);
  assert.deepEqual(input,before);assert.ok(jsonBytes(packet.input)<=analysisInputBytes);
});

test('F003 Main long citation window is explicitly incomplete, never replaced by its small quote',()=>{
  const p=candidate('p','doc','ANCHOR'),original=raw('doc','ANCHOR '+'x'.repeat(100000));
  const packet=analysisStagePacket({phase:'VERIFY',stage:'EVIDENCE_VERIFICATION',candidates:[p],relations:[],materials:[original],technicalEvidence:technical},[original]);
  assert.ok(packet.input.evidenceContext.missingEvidence.some(g=>g.key==='p'));
  assert.equal(packet.input.materials.length,0);
});

test('F003 related technical roots cannot retain an orphan or a dependency from another adopted version',()=>{
  const packet={...technical,versionIds:['v'],allowedFactIds:['root'],records:[{id:'root',versionId:'v',record:{subjectId:'missing',evidenceIds:[],premiseFactIds:[]}}]};
  const selected=selectStageTechnical(packet,{factIds:['root']});
  assert.deepEqual(selected.allowedFactIds,[]);assert.ok(selected.unresolved.some(r=>r.factId==='root'));
  assert.ok(jsonBytes(selected)<=stageTechnicalBytes);
});

test('F003 full JSON material partition accounts escaped control bytes, original UTF-8 offsets and metadata',()=>{
  const original=raw('doc',('\u0001\\\t中文𠮷\n').repeat(7000)),parts=partitionOriginalMaterials([original],65536,{serialized:true}).flat();
  assert.equal(parts.map(p=>p.text).join(''),original.text);
  for(const [i,p]of parts.entries()) {
    assert.ok(jsonBytes(p)+1<=65536);assert.ok(Buffer.byteLength(p.text)<=65536);assert.ok(!p.text.includes('\ufffd'));
    assert.equal(p.byteStart,i?parts[i-1].byteEnd:0);
  }
});

test('F003 PLAN routing inventory is explicitly partial without mutating the complete source inventory',()=>{
  const inventory=Array.from({length:2000},(_,n)=>({key:`key-${n}`,path:'real-path-'+n+'x'.repeat(120),kind:'FILE'})),before=structuredClone(inventory);
  const input=stageInput({phase:'PLAN',inventory,technicalEvidence:technical});
  assert.ok(jsonBytes(input)<=analysisInputBytes);assert.ok(input.inventoryCoverage.pending>0);
  assert.equal(input.inventoryCoverage.total,inventory.length);assert.equal(input.technicalEvidence.authority,'ROUTING_NOT_EVIDENCE');
  assert.deepEqual(inventory,before);
});

test('F003 a related DAG over the technical bound never supplies an orphan Fact, even if its id remains globally authorized',()=>{
  const packet={...technical,versionIds:['v'],allowedFactIds:['root'],records:[{id:'root',versionId:'v',record:{subjectId:'object',evidenceIds:[],premiseFactIds:[]}}],
    objects:[{objectId:'object',versionId:'v',materialId:'m',name:'unavoidably large '+ 'x'.repeat(40000)}],
    materials:[{materialId:'m',versionId:'v',sourceMaterial:{id:'doc',bundleId:'bundle'}}]};
  const selected=selectStageTechnical(packet,{factIds:['root']});
  assert.deepEqual(selected.records,[]);assert.deepEqual(selected.allowedFactIds,[]);assert.equal(selected.omittedFactCount,1);
  assert.ok(selected.limitations.some(l=>l.code==='CONTEXT_BYTE_LIMIT'));
  const p={...candidate('p','doc','ALLOW'),state:'ANALYSIS_ACCEPTED',technicalRefs:['root']};
  const q=questionStagePacket({phase:'ANSWER',operation:'VERIFY',objects:[p],endpoints:[],technicalEvidence:packet},
    {materials:[raw('doc','ALLOW\n')],drafts:[{taskKey:'child',segments:[{key:'segment',graphRefs:['p'],technicalRefs:['root'],evidence:p.evidence}]}]});
  assert.deepEqual(q.input.technicalEvidence.allowedFactIds,[]);
  assert.ok(q.input.evidenceContext.missingEvidence.some(g=>g.key==='segment'&&g.reasons.includes('TECHNICAL_CONTEXT_INCOMPLETE')));
});

test('F003 QA whole-input projection retains a valid branch when another assigned object cannot fit, with full requested scope left pending',()=>{
  const good={...candidate('good','doc','ALLOW'),state:'ANALYSIS_ACCEPTED'},large={...good,key:'large',statement:'x'.repeat(150000)};
  const before=structuredClone([large,good]);
  const packet=questionStagePacket({phase:'ANSWER',operation:'DRAFT',objects:[large,good],endpoints:[],technicalEvidence:technical},{materials:[raw('doc','ALLOW\n')]});
  assert.deepEqual(packet.input.objects.map(p=>p.key),['good']);assert.deepEqual(packet.omitted,[{key:'large',reason:'MODEL_INPUT_BYTE_BUDGET'}]);
  assert.equal(packet.input.resourceContext.requestedItems,2);assert.equal(packet.input.resourceContext.pendingItems,1);
  assert.ok(jsonBytes(packet.input)<=analysisInputBytes);assert.deepEqual([large,good],before);
});

test('F003 serialized splitting uses the available range rather than doubling calls through half-sized fragments',()=>{
  const m=raw('doc','a'.repeat(120000)),parts=partitionOriginalMaterials([m],65536,{serialized:true});
  assert.equal(parts.length,2);assert.equal(parts.flat().map(p=>p.text).join(''),m.text);
  assert.ok(parts.every(ps=>jsonBytes(ps)<=65536+1));
});

test('F003 graph routing summaries keep directed relationship and Unicode names canonical without making them evidence',()=>{
  const p=questionPlanPacket({phase:'PLAN',objects:[{key:'edge',predicate:'INVOKES',name:'x'.repeat(23)+'𠮷'}],endpoints:[],technicalEvidence:technical});
  assert.doesNotThrow(()=>digest(p));assert.equal(p.objects[0].kind,'DIRECTED_RELATION');assert.ok(p.objects[0].name.endsWith('𠮷'));
  assert.deepEqual(p.technicalEvidence.allowedFactIds,[]);
});

test('F003 local technical relevance is the union of actual source windows, never the last window or their full bounding span',()=>{
  const packet={...technical,versionIds:['v'],records:[],objects:[],materials:[{versionId:'v',materialId:'m',sourceMaterial:{id:'doc',bundleId:'bundle'}}],allowedFactIds:[]};
  for(const line of [1,15,30,39]) {
    const id=`line-${line}`;packet.allowedFactIds.push(id);
    packet.records.push({id,versionId:'v',record:{subjectId:id,evidenceIds:[],premiseFactIds:[]}});
    packet.objects.push({objectId:id,versionId:'v',materialId:'m',anchor:{kind:'TEXT',lineStart:line,lineEnd:line}});
  }
  const windows=[{id:'doc',startLine:1,endLine:3},{id:'doc',startLine:28,endLine:32}];
  for(const materials of [windows,[...windows].reverse()]) {
    const result=selectStageTechnical(packet,{materials});
    assert.deepEqual([...result.allowedFactIds].sort(),['line-1','line-30']);
    assert.equal(result.selection.eligibleRootCount,2);assert.equal(result.truncated,false);
  }
  assert.deepEqual(selectStageTechnical(packet,{materials:[{id:'another-source',startLine:1,endLine:40}]}).records,[]);
});

test('F003 invalid originals remain outside Main semantic budget, and no explicit Fact reference means no unrelated fallback evidence',()=>{
  const good=candidate('good','doc','ALLOW'),bad={...good,key:'bad',statement:'invalid'.repeat(30000),technicalRefs:['missing']};
  const before=structuredClone([good,bad]);
  const p=analysisStagePacket({phase:'VERIFY',candidates:[bad,good],relations:[],invalidProposalKeys:['bad'],technicalEvidence:technical},[raw('doc','ALLOW')]);
  assert.deepEqual(p.input.candidates,[good]);assert.deepEqual(p.input.technicalEvidence.allowedFactIds,[]);
  assert.deepEqual(p.omitted,[]);assert.equal(p.input.resourceContext.isolatedItems.count,1);
  assert.deepEqual([good,bad],before);assert.ok(jsonBytes(p.input)<=analysisInputBytes);
});

test('F003 de-duplicating endpoint metadata does not turn an over-bound original body into support',()=>{
  const code=raw('code','ANCHOR '+'x'.repeat(70000)),doc=raw('doc','ALLOW'),p=candidate('rule','doc','ALLOW');
  const relation={key:'edge',sourceKey:'rule',targetKey:'code',predicate:'IMPLEMENTED_BY',scope:'fixed',evidence:[cite('code','ANCHOR')]};
  const result=analysisStagePacket({phase:'VERIFY',candidates:[p],relations:[relation],technicalEvidence:technical},[code,doc]);
  assert.equal(result.input.relations[0].sourceKey,'rule');assert.equal(result.input.relations[0].targetKey,'code');
  assert.equal('text' in result.input.endpoints[0],false);
  assert.ok(result.input.evidenceContext.missingEvidence.some(g=>g.key==='edge'));
  assert.ok(jsonBytes(result.input)<=analysisInputBytes);
});
