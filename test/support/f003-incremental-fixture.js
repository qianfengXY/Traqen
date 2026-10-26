import assert from 'node:assert/strict';
import {investigationFixture} from './f003-investigation-fixture.js';
import {freezeContinuationSource} from './f003-continuation-source.js';
import {F002Repository} from '../../src/deterministic-facts/repository.js';
import {F002AdmissionService} from '../../src/deterministic-facts/admission.js';
import {F002Worker} from '../../src/deterministic-facts/worker.js';
import {F002PublicationService} from '../../src/deterministic-facts/publication-service.js';
import {technicalF002Profile} from '../../src/deterministic-facts/runtime.js';
import {InvestigationWorker} from '../../src/business-knowledge/worker.js';

export const actor={actorId:'owner',tenantId:'tenant'},workspace='workspace';
export const sourceA={
  'condition.js':'export function canCancel(order) { return order.total <= 100; }\n',
  'checkout.js':"import { canCancel } from './condition.js';\nexport function checkout(order) { return canCancel(order); }\n",
  'health.js':"export function health() { return 'ok'; }\n"
};
export const sourceB={...sourceA,'condition.js':sourceA['condition.js'].replace('100','50')};
// Formal declaration-only proposition, deliberately not a runtime/business
// completeness assertion. Free-text/global claims remain ordinary rechecks.
export const localClaim=(name,value)=>({
  kind:'FUNCTION',name,statement:`Local declaration ${name} returns literal ${JSON.stringify(value)}.`,
  scope:'LOCAL_DECLARATION_ONLY; no runtime, caller, absence or global claim',
  dependencyScope:{kind:'LOCAL_RETURN_LITERAL',functionName:name,value}
});

export async function incrementalFixture(t,{database=null,fixtureFactory=investigationFixture,files=sourceA,modelResult=null}={}) {
  const [first,...rest]=Object.keys(files);
  const directories=[...new Set(Object.keys(files).flatMap(p=>p.split('/').slice(0,-1).map((_,n)=>p.split('/').slice(0,n+1).join('/'))))];
  const f=await fixtureFactory(t,{...(database?{database}:{}),entryPath:first,content:files[first],
    directoryPaths:directories,additionalFiles:rest.map(entryPath=>({entryPath,content:files[entryPath]}))});
  const service=f.service??f.runtime.services.investigations,calls=[];
  const facts=new F002Repository(f.db,{authorize:(a,w,tx,m)=>f.repository.authorize(a,w,m,tx)});
  const profile=technicalF002Profile();await facts.registerProfile(profile);
  async function extract(label,reference,scope) {
    const admission=new F002AdmissionService(facts,f.sourceAdmission);
    const run=await admission.start(actor,workspace,{operationId:'technical-'+label,reference,profile,
      scopes:[{selections:scope.componentIds.map(componentId=>({kind:'COMPONENT',componentId}))}]});
    const ready=await new F002Worker(facts,{admission}).run(actor,workspace,run.id,run.scopes[0].scopeId,{workerId:label,leaseMs:60000});
    return (await new F002PublicationService(facts).publish(actor,workspace,run.id,ready.scopeId,{revision:ready.revision,operationId:'seal-'+label})).graphVersionId;
  }
  const versionA=await extract('A',f.reference,f.request.scope);
  async function invoke(c,invokeService=service) {
    const i=c.input,reservation=await invokeService.reserveModelCall(actor,workspace,c.investigationId,c);
    await invokeService.beginModelCall(actor,workspace,c.investigationId,{generation:c.generation,reservationId:reservation.id});
    let result;
    if(modelResult)result=await modelResult(i,c);
    else if(i.phase==='PLAN')result={assignments:[
      {slotId:'child-1',objective:'What condition governs the checkout caller?',obligations:['Follow the actual cross-asset condition and call premise'],
        materialKeys:i.inventory.filter(m=>m.path!=='health.js').map(m=>m.key)},
      {slotId:'child-1',objective:'Check only the bounded local health declaration',obligations:['Inspect literal declaration; never infer global health'],
        materialKeys:i.inventory.filter(m=>m.path==='health.js').map(m=>m.key)}].filter(a=>a.materialKeys.length),pendingMaterials:[]};
    else if(i.phase==='INVESTIGATE') {
      const named=n=>i.materials.find(m=>Buffer.from(m.sourceMaterial.pathBytes,'base64url').toString()===n);
      const cite=m=>({materialId:m.id,startLine:1,endLine:m.text.trimEnd().split('\n').length,quote:m.text.trimEnd()});
      const ref=n=>{const o=i.technicalEvidence.objects.find(o=>o.kind==='FUNCTION'&&o.name===n)??i.technicalEvidence.objects.find(o=>o.name===n);assert.ok(o);
        const fact=i.technicalEvidence.records.find(r=>r.record.subjectId===o.objectId)
          ??i.technicalEvidence.records.find(r=>i.technicalEvidence.objects.some(subject=>subject.objectId===r.record.subjectId&&subject.materialId===o.materialId));
        assert.ok(fact,JSON.stringify({
          missingFixtureFact:n,object:o,records:i.technicalEvidence.records.map(r=>({id:r.id,subjectId:r.record.subjectId,predicate:r.record.predicate})),
          selection:i.technicalEvidence.selection,truncated:i.technicalEvidence.truncated}));return fact.id;};
      if(named('health.js'))result={candidates:i.reuseProposals?.length?[]:[{key:'health',...localClaim('health','ok'),
        uncertainties:[],evidence:[cite(named('health.js'))],technicalRefs:[ref('health')]}],relations:[],requestedMaterialKeys:[]};
      else {
        const condition=named('condition.js'),checkout=named('checkout.js');assert.ok(condition&&checkout);
        result={candidates:[
          {key:'condition',kind:'RULE',name:'canCancel',statement:condition.text.includes('100')?'total <= 100':'total <= 50',scope:'local comparison only',
            uncertainties:[],evidence:[cite(condition)],technicalRefs:[ref('canCancel')]},
          {key:'checkout',kind:'FUNCTION',name:'checkout',statement:'Checkout is governed by canCancel',scope:'actual imported call and its condition',
            uncertainties:[],evidence:[cite(checkout)],technicalRefs:[ref('checkout')]}],
          relations:[{key:'depends',sourceKey:'checkout',targetKey:'condition',predicate:'REQUIRES',scope:'own directed call condition',
            uncertainties:[],evidence:[cite(checkout),cite(condition)],technicalRefs:[ref('canCancel')]}],requestedMaterialKeys:[]};
      }
    } else if(i.stage==='CONSOLIDATE_PROPOSALS')result={mergeSuggestions:[],conflictGroups:[]};
    else result={reviews:[...i.candidates,...i.relations].map(p=>({key:p.key,support:'SUPPORTED',rationale:'Explicit model double; mechanism not semantic quality',
      premises:['Check only actual supplied B source and premise closure, not historical A authority'],unresolvedConflicts:[]}))};
    if(i.phase==='INVESTIGATE')result.obligationResults=i.task.obligations.map(obligation=>({
      obligation,status:'EVIDENCE_FOUND',reason:'Explicit test double inspected actual supplied conditions; not semantic quality'}));
    await invokeService.finishModelCall(actor,workspace,c.investigationId,{generation:c.generation,reservationId:reservation.id,outcome:'SUCCEEDED'});
    calls.push({runId:c.investigationId,input:structuredClone(i),result:structuredClone(result),reservationId:reservation.id});
    return {result,reservationId:reservation.id};
  }
  const request={...f.request,question:'What are the cancellation condition, caller dependency and local health declaration?',
    technicalVersionId:versionA,budget:{...f.request.budget,maxModelCalls:12}};
  const worker=()=>new InvestigationWorker({investigations:service,invokeModel:invoke});
  async function run(input,options={}) {const admitted=await service.start(actor,workspace,input,options);
    await worker().run(actor,workspace,admitted.id,{workerId:input.operationId});return {run:await service.get(actor,workspace,admitted.id),graph:await service.graph(actor,workspace,admitted.id)};}
  async function next(files=sourceB) {const b=await freezeContinuationSource(f,Object.entries(files));
    return {...b,technicalVersionId:await extract('B',b.reference,b.scope)};}
  return {...f,service,calls,request,run,worker,next,extract,versionA,invoke};
}
