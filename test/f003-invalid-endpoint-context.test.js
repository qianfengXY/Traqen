import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisStagePacket} from '../src/business-knowledge/stage-context.js';
import {createHash} from 'node:crypto';
import {investigationFixture} from './support/f003-investigation-fixture.js';
import {owner} from './support/source-truth-database.js';
import {structureDigest} from '../src/source-truth/identity.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';

test('invalid endpoint origins cannot re-enter Main technical competition through an incident relation',()=>{
  const raw={id:'raw',text:'SOURCE',sourceMaterial:{id:'raw',bundleId:'bundle'}};
  const evidence=[{materialId:'raw',startLine:1,endLine:1,quote:'SOURCE'}];
  const good={key:'good',kind:'RULE',name:'good',statement:'good',scope:'fixed',evidence,technicalRefs:['good']};
  const bad={...good,key:'bad',technicalRefs:['bad'],evidence:[{...evidence[0],quote:'forged'}]};
  const packet={versionIds:['v'],sourceBundleId:'bundle',records:['good','bad'].map(id=>({id,versionId:'v',record:{subjectId:id,basis:id==='bad'?'DERIVED':'OBSERVED',premiseFactIds:[],evidenceIds:[],payload:'x'.repeat(20000)}})),
    objects:['good','bad'].map(id=>({objectId:id,versionId:'v',materialId:'m',anchor:{kind:'TEXT',lineStart:1,lineEnd:1}})),
    materials:[{materialId:'m',versionId:'v',sourceMaterial:raw.sourceMaterial}],evidence:[],allowedFactIds:['good','bad']};
  const r=analysisStagePacket({phase:'VERIFY',candidates:[good,bad],relations:[{key:'edge',sourceKey:'bad',targetKey:'raw',predicate:'DESCRIBED_BY',scope:'fixed',evidence,technicalRefs:[]}],invalidProposalKeys:['bad'],technicalEvidence:packet},[raw]);
  assert.ok(r.input.technicalEvidence.allowedFactIds.includes('good'));
  assert.ok(!r.input.technicalEvidence.allowedFactIds.includes('bad'));
  assert.equal(r.input.relations.length,0);assert.equal(r.input.resourceContext.isolatedItems.count,2);
  const control=analysisStagePacket({phase:'VERIFY',candidates:[good,bad],relations:[{key:'edge',sourceKey:'good',targetKey:'raw',predicate:'DESCRIBED_BY',scope:'fixed',evidence,technicalRefs:[]}],invalidProposalKeys:['bad'],technicalEvidence:packet},[raw]);
  assert.equal(control.input.relations.length,1);assert.equal(control.input.relations[0].sourceKey,'good');
  assert.equal(control.input.relations[0].targetKey,'raw');assert.ok(control.input.technicalEvidence.allowedFactIds.includes('good'));
});

test('actual InvestigationWorker isolates an invalid endpoint and its incident relation without evicting the independently valid branch',async t=>{
  const f=await investigationFixture(t,{content:'SOURCE_GOOD\n',additionalFiles:[{entryPath:'bad.md',content:'SOURCE_BAD\n'}]}),seen=[];
  const source=(path,text)=>{
    const m={workspaceId:'workspace',bundleId:f.reference.bundleId,componentId:f.request.scope.componentIds[0],
      pathBytes:Buffer.from(path).toString('base64url'),contentDigest:createHash('sha256').update(text).digest('hex')};
    return {...m,id:structureDigest('material',m)};
  };
  const sources={good:source('business.md','SOURCE_GOOD\n'),bad:source('bad.md','SOURCE_BAD\n')};
  const packet={versionIds:['v'],sourceBundleId:f.reference.bundleId,records:['good','bad'].map(id=>({id,versionId:'v',record:{subjectId:id,
    basis:id==='bad'?'DERIVED':'OBSERVED',premiseFactIds:[],evidenceIds:[],payload:'x'.repeat(20000)}})),
    objects:['good','bad'].map(id=>({objectId:id,versionId:'v',materialId:id,anchor:{kind:'TEXT',lineStart:1,lineEnd:1}})),
    materials:['good','bad'].map(id=>({materialId:id,versionId:'v',sourceMaterial:sources[id]})),evidence:[],allowedFactIds:['good','bad'],truncated:false,limitations:[],unresolved:[]};
  // Technical/model ports are explicit doubles; F001, SQL, collection,
  // qualification, graph triage, budgeting and both Main stages are actual.
  f.service.technicalEvidence=async()=>structuredClone(packet);
  const run=await f.service.start(owner,'workspace',f.request);
  await new InvestigationWorker({investigations:f.service,invokeModel:async c=>{
    const reservation=await f.service.reserveModelCall(owner,'workspace',run.id,c),i=c.input;seen.push(i);let result;
    if(i.phase==='PLAN')result={assignments:['business.md','bad.md'].map(path=>({slotId:'child-1',obligations:["核查本任务原文条件、反例与未供应前提（机制替身）"],objective:'isolated source',materialKeys:[i.inventory.find(m=>m.path===path).key]}))};
    else if(i.phase==='INVESTIGATE') {
      const bad=i.materials[0].text==='SOURCE_BAD\n',key=bad?'bad':'good',evidence=[{materialId:i.materials[0].id,startLine:1,endLine:1,quote:bad?'FORGED':'SOURCE_GOOD'}];
      assert.ok(i.technicalEvidence.allowedFactIds.includes(key));
      result={candidates:[{key,kind:'RULE',name:key,statement:'synthetic assertion',scope:'fixed',evidence,technicalRefs:[key],uncertainties:[]}],
        relations:bad?[{key:'bad-edge',sourceKey:'bad',targetKey:i.materials[0].id,predicate:'DESCRIBED_BY',scope:'fixed',technicalRefs:['bad'],uncertainties:[],
          evidence:[{...evidence[0],quote:'SOURCE_BAD'}]}]:[]};
    }else if(i.stage==='CONSOLIDATE_PROPOSALS')result={mergeSuggestions:[],conflictGroups:[]};
    else result={reviews:[...i.candidates,...i.relations].map(p=>({key:p.key,support:'SUPPORTED',rationale:'mechanism only',premises:['fixed source'],unresolvedConflicts:[]}))};
    return {result,reservationId:reservation.id};
  }}).run(owner,'workspace',run.id,{workerId:'invalid-incident-edge'});
  const graph=await f.service.graph(owner,'workspace',run.id);
  assert.equal(graph.candidates.find(p=>p.name==='bad').state,'QUARANTINED');
  assert.equal(graph.candidates.find(p=>p.name==='good').state,'ANALYSIS_ACCEPTED');
  assert.notEqual(graph.relations[0].state,'ANALYSIS_ACCEPTED');
  for(const i of seen.filter(i=>i.phase==='VERIFY')) {
    assert.ok(i.technicalEvidence.allowedFactIds.includes('good'));
    assert.ok(!i.technicalEvidence.allowedFactIds.includes('bad'));
    assert.equal(i.relations.length,0);assert.equal(i.resourceContext.isolatedItems.count,2);
  }
});
