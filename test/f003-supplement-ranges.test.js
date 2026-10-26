import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {investigationFixture} from './support/f003-investigation-fixture.js';
import {owner} from './support/source-truth-database.js';
import {structureDigest} from '../src/source-truth/identity.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';

// Real isolated PGlite/F001/service/Worker/checkpoints. Technical evidence and
// model are explicit synthetic ports, not a real F002 publication or pilot.
test('actual supplement Worker retains a Fact anchored in the earlier of two supplied windows',async t=>{
  const text=Array.from({length:40},(_,n)=>`SOURCE_${n+1}`).join('\n')+'\n';
  const f=await investigationFixture(t,{content:text,additionalFiles:[{entryPath:'extra.md',content:'EXTRA_SOURCE\n'}]});
  const sourceMaterial={workspaceId:'workspace',bundleId:f.reference.bundleId,componentId:f.request.scope.componentIds[0],
    pathBytes:Buffer.from('business.md').toString('base64url'),contentDigest:createHash('sha256').update(text).digest('hex')};
  sourceMaterial.id=structureDigest('material',sourceMaterial);
  const packet={versionIds:['adopted-v'],sourceBundleId:f.reference.bundleId,
    records:[{id:'first-window-fact',versionId:'adopted-v',record:{subjectId:'first-object',predicate:'declares',basis:'OBSERVED',evidenceIds:[],premiseFactIds:[]}}],
    objects:[{objectId:'first-object',versionId:'adopted-v',materialId:'technical-m',name:'first declaration',kind:'DECLARATION',anchor:{kind:'TEXT',lineStart:1,lineEnd:1}}],
    materials:[{materialId:'technical-m',versionId:'adopted-v',sourceMaterial}],evidence:[],allowedFactIds:['first-window-fact'],limitations:[],unresolved:[],truncated:false};
  f.service.technicalEvidence=async()=>structuredClone(packet);
  // A genuine adopted Fact in the unsent gap must be present in the full
  // first Child, but absent from the actual disjoint-window supplement input.
  packet.records.push({id:'gap-fact',versionId:'adopted-v',record:{subjectId:'gap-object',predicate:'declares',basis:'OBSERVED',evidenceIds:[],premiseFactIds:[]}});
  packet.objects.push({objectId:'gap-object',versionId:'adopted-v',materialId:'technical-m',name:'gap declaration',kind:'DECLARATION',anchor:{kind:'TEXT',lineStart:15,lineEnd:15}});
  packet.allowedFactIds.push('gap-fact');
  const run=await f.service.start(owner,'workspace',f.request),seen=[];let requestedKey;
  const worker=new InvestigationWorker({investigations:f.service,invokeModel:async c=>{
    const r=await f.service.reserveModelCall(owner,'workspace',run.id,c),i=c.input;seen.push({taskKey:c.taskKey,input:i});let result;
    if(i.phase==='PLAN'){
      requestedKey=i.inventory.find(m=>m.path==='extra.md').key;
      result={assignments:[{slotId:'child-1',obligations:["核查本任务原文条件、反例与未供应前提（机制替身）"],objective:'one source, then explicit bounded supplement',materialKeys:[i.inventory.find(m=>m.path==='business.md').key]}],pendingMaterials:[{materialKey:requestedKey,reason:'该材料需Child明确缺前提后有界补证'}]};
    }else if(i.phase==='INVESTIGATE'&&c.taskKey.startsWith('child-')) {
      assert.deepEqual(i.technicalEvidence.allowedFactIds,['first-window-fact','gap-fact']);
      result={candidates:[1,30].map(line=>({key:'rule-'+line,kind:'RULE',name:'rule '+line,statement:'synthetic source rule '+line,scope:'fixture',uncertainties:[],
        evidence:[{materialId:sourceMaterial.id,startLine:line,endLine:line,quote:'SOURCE_'+line}],technicalRefs:[]})),relations:[],requestedMaterialKeys:[requestedKey]};
    }else if(i.phase==='INVESTIGATE')result={candidates:[],relations:[]};
    else if(i.stage==='CONSOLIDATE_PROPOSALS')result={mergeSuggestions:[],conflictGroups:[]};
    else result={reviews:i.candidates.map(p=>({key:p.key,support:'SUPPORTED',rationale:'mechanism-only synthetic reviewer',premises:['fixed source'],unresolvedConflicts:[]}))};
    return {result,reservationId:r.id};
  }});
  await worker.run(owner,'workspace',run.id,{workerId:'review-disjoint-window'});
  const actual=seen.find(c=>c.taskKey.startsWith('supplement-')).input;
  const windows=actual.materials.filter(m=>m.id===sourceMaterial.id);
  assert.equal(windows.length,2);assert.ok(windows.some(m=>m.startLine===1));
  assert.ok(!windows.some(m=>m.startLine<=15&&m.endLine>=15),'the raw gap was never supplied');
  console.log(JSON.stringify({kind:'REAL_PGLITE_INVESTIGATION_SUPPLEMENT_MECHANISM',ranges:windows.map(m=>[m.startLine,m.endLine]),
    selected:actual.technicalEvidence.allowedFactIds,selection:actual.technicalEvidence.selection,runState:(await f.service.get(owner,'workspace',run.id)).state}));
  assert.deepEqual(actual.technicalEvidence.allowedFactIds,['first-window-fact'],'supplement dropped a related Fact despite sending its original range');
});
