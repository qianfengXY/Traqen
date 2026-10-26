import assert from 'node:assert/strict';
import test from 'node:test';
import {authorityFixture} from './support/f003-authority-fixture.js';
import {questionActor as actor,questionInput} from './support/f003-question-fixture.js';
import {F002Repository} from '../src/deterministic-facts/repository.js';
import {F002AdmissionService} from '../src/deterministic-facts/admission.js';
import {F002Worker} from '../src/deterministic-facts/worker.js';
import {F002PublicationService} from '../src/deterministic-facts/publication-service.js';
import {technicalF002Profile} from '../src/deterministic-facts/runtime.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';
import {publicationDigest as digest} from '../src/business-knowledge/publication-authority.js';

test('F003 question Main/Child/VERIFY share dereferenceable explicitly adopted F002 context and retain frozen raw citations',async t=>{
  const contexts=[],rawContexts=[];
  const f=await authorityFixture(t,{sourceOptions:{entryPath:'orders.js',content:'// BUSINESS_ANCHOR\n'+ '\n'.repeat(5)
    +'export function validateOrder(order) { return order.unpaid; } // TECHNICAL_PREMISE_ONLY_UNPAID\n'+ '\n'.repeat(5)
    +'export function approveOrder(order) { return validateOrder(order); }\n'},
    modelExecutor:service=>async c=>{
      const reserved=await service.reserveModelCall(actor,'workspace',c.investigationId,{...c,phase:c.input.phase});
      await service.beginModelCall(actor,'workspace',c.investigationId,{generation:c.generation,reservationId:reserved.id});
      const i=c.input;contexts.push(i.technicalEvidence);rawContexts.push(i);
      const result=i.phase==='PLAN'?{assignments:[{slotId:i.childSlots[0].id,objectKeys:i.objects.map(o=>o.key)}]}
        :i.operation==='DRAFT'?{segments:[{key:'call',text:'该冻结代码中approveOrder调用validateOrder。',stance:'SUPPORTED',graphRefs:[i.objects[0].key],
          evidence:i.objects[0].evidence,technicalRefs:i.objects[0].technicalRefs,uncertainties:[]}],unknowns:['没有真实执行证明']}
          :{reviews:i.drafts.flatMap(d=>d.segments).map(s=>({key:s.key,support:'SUPPORTED',rationale:'code and closed technical context, mechanism only',unresolvedConflicts:[]}))};
      await service.finishModelCall(actor,'workspace',c.investigationId,{generation:c.generation,reservationId:reserved.id,outcome:'SUCCEEDED'});
      return {result,reservationId:reserved.id};
    }});
  const repository=new F002Repository(f.db,{authorize:(a,w,tx,maintain)=>f.repository.authorize(a,w,maintain,tx)}),profile=technicalF002Profile();
  assert.equal(profile.id,'6fedd46325aa1b9af809f65c19892d0c572599461f2cd7647fdd09e3e4f2d695');
  await repository.registerProfile(profile);const admission=new F002AdmissionService(repository,f.sourceAdmission);
  const technical=await admission.start(actor,'workspace',{operationId:'qa-technical',reference:f.reference,profile,
    scopes:[{selections:[{kind:'COMPONENT',componentId:f.request.scope.componentIds[0]}]}]});
  const scope=await new F002Worker(repository,{admission}).run(actor,'workspace',technical.id,technical.scopes[0].scopeId,{workerId:'actual-static-worker',leaseMs:60000});
  const version=await new F002PublicationService(repository).publish(actor,'workspace',technical.id,scope.scopeId,{revision:scope.revision,operationId:'qa-technical-publish'});
  const s=f.runtime.services;s.investigations.profiles=f.profiles;s.investigations.implementationVersion=f.investigations.implementationVersion;
  const run=await s.investigations.start(actor,'workspace',{...f.request,operationId:'adopt-for-qa',technicalVersionId:version.graphVersionId});
  const target=(await f.db.query("SELECT id FROM f002_record WHERE workspace_id='workspace' AND graph_version_id=$1 AND kind='FACT' AND payload->>'predicate'='callsDeclaration'",[version.graphVersionId])).rows[0];
  assert.ok(target);
  const probeRun=await s.investigations.claim(actor,'workspace',run.id,{workerId:'technical-budget-probe',leaseMs:60000});
  const closed=await s.investigations.technicalEvidence(actor,'workspace',run.id,{generation:probeRun.generation,maxBytes:32768,selection:{factIds:[target.id]}});
  assert.ok(closed.allowedFactIds.includes(target.id),JSON.stringify({rootClosureBytes:Buffer.byteLength(JSON.stringify(closed)),limitations:closed.limitations,unresolved:closed.unresolved}));
  await s.investigations.releaseForShutdown(actor,'workspace',run.id,{generation:probeRun.generation,workerId:'technical-budget-probe'});
  let factId;
  const worker=new InvestigationWorker({investigations:s.investigations,invokeModel:async c=>{
    const reserved=await s.investigations.reserveModelCall(actor,'workspace',run.id,c),i=c.input;
    factId??=i.technicalEvidence.records.find(r=>r.record.predicate==='callsDeclaration')?.id;
    if(i.phase==='INVESTIGATE')assert.ok(factId,JSON.stringify({predicates:i.technicalEvidence.records.map(r=>r.record.predicate),
      limitations:i.technicalEvidence.limitations,unresolved:i.technicalEvidence.unresolved,selection:i.technicalEvidence.selection}));
    const result=i.phase==='PLAN'?{assignments:[{slotId:'child-1',obligations:["核查本任务原文条件、反例与未供应前提（机制替身）"],objective:'read bounded code',materialKeys:i.inventory.map(m=>m.key)}]}
      :i.phase==='INVESTIGATE'?{candidates:[{key:'call',kind:'RULE',name:'校验调用',statement:'approveOrder调用validateOrder',scope:'仅本冻结代码',uncertainties:[],
        evidence:[{materialId:i.materials[0].id,startLine:1,endLine:1,quote:'BUSINESS_ANCHOR'}],technicalRefs:[factId]}],relations:[]}
        :{reviews:i.candidates.map(o=>({key:o.key,support:'SUPPORTED',rationale:'explicit synthetic semantic fixture',premises:['仅同一冻结代码中的静态调用，不代表真实执行'],unresolvedConflicts:[]}))};
    return {result,reservationId:reserved.id};
  }});
  await worker.run(actor,'workspace',run.id,{workerId:'semantic-fixture'});assert.ok(factId);
  const graph=await s.investigations.graph(actor,'workspace',run.id);assert.equal(graph.candidates[0].state,'ANALYSIS_ACCEPTED');
  const published=await f.publishAnalysis(run.id,graph,{operationId:'technical-graph',expectedHeadVersion:1});
  const {session}=await s.workSessions.create(actor,'workspace',published.publication.graphRevisionId,{operationId:'dual-input-session',expectedGraphDigest:graph.digest,title:'actual frozen dual-input mechanism'});
  const q=await s.workSessions.ask(actor,'workspace',session.id,questionInput(f,{objectKeys:[graph.candidates[0].key]}));
  assert.deepEqual(q.run.adoptedVersionIds,[version.graphVersionId]);s.executor.enqueue(q.run);await s.executor.drain();
  const result=await s.workSessions.question(actor,'workspace',session.id,q.run.id);assert.equal(result.run.state,'COMPLETED',JSON.stringify(result.run.lastFailure));
  assert.equal(result.answer.segments[0].stance,'SUPPORTED',JSON.stringify({segment:result.answer.segments[0],objects:graph.candidates}));assert.deepEqual(result.answer.segments[0].technicalRefs,[factId]);assert.equal(contexts.length,3);
  assert.equal(contexts[0].authority,'ROUTING_NOT_EVIDENCE');assert.deepEqual(contexts[0].allowedFactIds,[]);
  const factDigests=new Map();
  for(const packet of contexts.slice(1))for(const r of packet.records) {
    const signature=digest(r.record);assert.equal(factDigests.get(r.id)??signature,signature);factDigests.set(r.id,signature);
  }
  for(const operation of ['DRAFT','VERIFY']) assert.ok(rawContexts.find(i=>i.operation===operation).materials.some(m=>m.text.includes('TECHNICAL_PREMISE_ONLY_UNPAID')),
    `${operation} must see the adopted Fact's raw target/premise context outside the graph quote window`);
  assert.ok(contexts.slice(1).every(ctx=>ctx.versionIds.length===1 && ctx.versionIds[0]===version.graphVersionId && ctx.objects.some(o=>o.name==='validateOrder')
    && ctx.evidence.some(e=>e.anchor) && ctx.materials.every(m=>m.sourceMaterial.bundleId===f.reference.bundleId)));
  await assert.rejects(()=>s.investigations.adoptTechnicalVersion(actor,'workspace',q.run.id,{requestId:'fake',versionId:'f'.repeat(64),expectedRevision:result.run.revision}),e=>e.code==='F003_QA_FIXED_BINDING');
});
