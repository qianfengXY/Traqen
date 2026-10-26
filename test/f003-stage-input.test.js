import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {investigationFixture} from './support/f003-investigation-fixture.js';
import {owner} from './support/source-truth-database.js';
import {structureDigest} from '../src/source-truth/identity.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';

// Infrastructure and Worker are real; this is an explicit synthetic technical
// port and reasoning double, not an F002 publication or model-quality claim.
test('F003 every analysis stage bounds the complete JSON and selects related closed technical context rather than the global package',async t=>{
  const text='ALLOW_CANCEL_ONLY_UNPAID\n',f=await investigationFixture(t,{content:text,additionalFiles:[{entryPath:'other.md',content:'UNREAD_OTHER_BUSINESS\n'}]});
  const componentId=f.request.scope.componentIds[0],sourceMaterial={workspaceId:'workspace',bundleId:f.reference.bundleId,componentId,
    pathBytes:Buffer.from('business.md').toString('base64url'),contentDigest:createHash('sha256').update(text).digest('hex')};
  sourceMaterial.id=structureDigest('material',sourceMaterial);
  const rawMaterial={materialId:'m',versionId:'adopted-v',sourceMaterial},other={materialId:'other',versionId:'adopted-v',sourceMaterial:{...sourceMaterial,id:'other-source-id'}};
  const object=(objectId,materialId,name)=>({objectId,versionId:'adopted-v',materialId,name,kind:'FUNCTION',anchor:{kind:'TEXT',lineStart:1,lineEnd:1}});
  const fact=(id,record)=>({id,kind:'FACT',versionId:'adopted-v',record,contextStatus:'DEPENDENCIES_COMPLETE'});
  const packet={versionIds:['adopted-v'],sourceBundleId:f.reference.bundleId,records:[
    fact('root',{subjectId:'call',targetId:'target',predicate:'callsDeclaration',evidenceIds:['e'],premiseFactIds:['premise']}),
    fact('premise',{subjectId:'target',predicate:'declaration',evidenceIds:['e'],premiseFactIds:[]}),
    fact('unrelated',{subjectId:'unrelated',predicate:'declaration',evidenceIds:[],premiseFactIds:[],diagnostic:'unrelated '.repeat(23000)})],
    objects:[object('call','m','cancel'),object('target','m','validateUnpaid'),object('unrelated','other','UNRELATED_TARGET')],
    evidence:[{evidenceId:'e',versionId:'adopted-v',materialId:'m',anchor:{kind:'TEXT',lineStart:1,lineEnd:1}}],materials:[rawMaterial,other],
    allowedFactIds:['root','premise','unrelated'],unresolved:[],truncated:false,omittedFactCount:0,limitations:[]};
  assert.ok(Buffer.byteLength(JSON.stringify(packet))>200000);
  f.service.technicalEvidence=async()=>structuredClone(packet);
  const run=await f.service.start(owner,'workspace',f.request),seen=[];
  const worker=new InvestigationWorker({investigations:f.service,invokeModel:async c=>{
    const r=await f.service.reserveModelCall(owner,'workspace',run.id,c),i=c.input;seen.push(i);
    const result=i.phase==='PLAN'?{assignments:['允许取消的前提是什么？','校验调用提供什么条件？'].map(objective=>({slotId:'child-1',obligations:['核查固定原文和已采用闭包'],objective,sharedEvidenceReason:'原文业务条件与实现前提需要共享',materialKeys:i.inventory.filter(m=>m.path==='business.md').map(m=>m.key)})),pendingMaterials:i.inventory.filter(m=>m.path!=='business.md').map(m=>({materialKey:m.key,reason:'该机制用例未调查此材料，保持待完成'}))}
      :i.phase==='INVESTIGATE'?{candidates:['root','unrelated'].map((ref,n)=>({key:n?'guessed-unsent':'rule',kind:'RULE',name:'cancel condition',statement:'Only unpaid orders can be cancelled',scope:'unpaid',uncertainties:[],
        evidence:[{materialId:i.materials[0].id,startLine:1,endLine:1,quote:'ALLOW_CANCEL_ONLY_UNPAID'}],technicalRefs:[ref]})),relations:[]}
        :i.stage==='CONSOLIDATE_PROPOSALS'?{mergeSuggestions:[],conflictGroups:[]}
          :{reviews:[...i.candidates,...i.relations].map(p=>({key:p.key,support:'SUPPORTED',rationale:'mechanism-only',premises:['unpaid'],unresolvedConflicts:[]}))};
    return {result,reservationId:r.id};
  }});
  await worker.run(owner,'workspace',run.id,{workerId:'stage-budget'});
  for(const stage of ['PLAN','INVESTIGATE','CONSOLIDATE_PROPOSALS','EVIDENCE_VERIFICATION']) await t.test(stage,()=>{
    const inputs=seen.filter(i=>(i.stage??i.phase)===stage);assert.ok(inputs.length);
    for(const i of inputs) {
      assert.ok(Buffer.byteLength(JSON.stringify(i))<=128*1024,`${stage} exceeds the complete JSON resource bound`);
      if(stage==='PLAN') {assert.equal(i.technicalEvidence.records.length,0);assert.equal(i.technicalEvidence.authority,'ROUTING_NOT_EVIDENCE');}
      else {
        assert.deepEqual([...i.technicalEvidence.allowedFactIds].sort(),['premise','root']);
        assert.ok(i.technicalEvidence.objects.some(o=>o.name==='validateUnpaid'));
        assert.equal(i.technicalEvidence.objects.some(o=>o.name==='UNRELATED_TARGET'),false);
      }
    }
  });
  const graph=await f.service.graph(owner,'workspace',run.id);
  // Full source accounting remains in coverage, independent of model routing.
  assert.equal(graph.coverage.filter(m=>m.kind==='FILE').length,2);
  assert.ok(graph.coverage.some(m=>m.sourceReadStatus==='UNREAD'));
  assert.equal(graph.candidates.filter(p=>p.state==='QUARANTINED'&&p.identityIssues.includes('OUTSIDE_SUPPLIED_TECHNICAL_CONTEXT')).length,2);
  assert.equal(graph.candidates.filter(p=>p.state==='ANALYSIS_ACCEPTED').length,2);
  assert.equal((await f.service.get(owner,'workspace',run.id)).usage.modelCalls,5);
});
