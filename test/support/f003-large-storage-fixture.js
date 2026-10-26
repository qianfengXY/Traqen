import assert from 'node:assert/strict';
import {investigationFixture} from './f003-investigation-fixture.js';
import {owner} from './source-truth-database.js';
import {InvestigationWorker} from '../../src/business-knowledge/worker.js';
import {InvestigationService} from '../../src/business-knowledge/investigation-service.js';

// Geometry follows the root808/810 incident: multiple individually legal
// Child outputs amplify through qualified provenance + preserved originals.
// This is synthetic SQL/Worker storage evidence, never semantic/model quality.
export async function largeStorageFixture(t,{database,implementationVersion,...options}={}) {
  const f=await investigationFixture(t,{content:'ALLOW\n',...(database?{database}:{}),...options});
  if(implementationVersion)f.service=new InvestigationService({sources:f.repository,sourceAdmission:f.sourceAdmission,profiles:f.profiles,implementationVersion});
  const calls=[],checkpoints=[];const checkpoint=f.service.checkpoint.bind(f.service);
  f.service.checkpoint=async(...args)=>{checkpoints.push({key:args[3].key,bytes:Buffer.byteLength(JSON.stringify(args[3].payload))});return checkpoint(...args);};
  const input={...f.request,question:'哪些条件、范围、关系及未决项需要保留？',budget:{...f.request.budget,maxModelCalls:12}};
  const run=await f.service.start(owner,'workspace',input);
  const invokeModel=async context=>{
    const r=await f.service.reserveModelCall(owner,'workspace',run.id,context);
    await f.service.beginModelCall(owner,'workspace',run.id,{generation:context.generation,reservationId:r.id});
    const i=context.input;let result;
    if(i.phase==='PLAN')result={assignments:Array.from({length:4},(_,n)=>({slotId:'child-1',objective:`第${n+1}组约束及例外如何对应？`,
      obligations:[`保留第${n+1}组原文、反例与未决项`],materialKeys:[i.inventory[0].key],sharedEvidenceReason:'合成保存反例共享同一条件行，非语义覆盖结论'})),pendingMaterials:[]};
    else if(i.phase==='INVESTIGATE') {
      const evidence=[{materialId:i.materials[0].id,startLine:1,endLine:1,quote:'ALLOW'}];
      result={candidates:Array.from({length:40},(_,n)=>({key:`candidate-${n}`,kind:'RULE',name:`synthetic-${n}`,
        statement:`bounded synthetic proposition ${n}:`+'s'.repeat(3500),scope:'synthetic storage condition:'+'c'.repeat(1800),uncertainties:['UNMEASURED_SEMANTICS'],evidence})),
      relations:Array.from({length:35},(_,n)=>({key:`relation-${n}`,sourceKey:'candidate-0',targetKey:n===34?'unsupplied-endpoint':`candidate-${n+1}`,
        predicate:'CONSTRAINS',scope:'synthetic directed storage relation:'+'r'.repeat(2000),uncertainties:['UNMEASURED_SEMANTICS'],evidence})),
      requestedMaterialKeys:[],obligationResults:[]};
    } else if(i.stage==='CONSOLIDATE_PROPOSALS')result={mergeSuggestions:[],conflictGroups:i.candidates.length>1?
      [{keys:i.candidates.slice(0,2).map(p=>p.key),rationale:'synthetic unresolved conflict must remain in storage'}]:[]};
    else result={reviews:[...i.candidates,...i.relations].map(p=>({key:p.key,support:'UNKNOWN',rationale:'mechanism double, no semantic judgement',
      premises:['synthetic supplied condition only'],unresolvedConflicts:[]}))};
    const outputBytes=Buffer.byteLength(JSON.stringify(result)),inputBytes=Buffer.byteLength(JSON.stringify(i));
    assert.ok(outputBytes<=1024*1024,'every individual output is valid BEFORE aggregate storage');
    assert.ok(inputBytes<=128*1024,'unchanged complete input envelope');
    calls.push({phase:i.phase,stage:i.stage??null,inputBytes,outputBytes,taskKey:context.taskKey});
    await f.service.finishModelCall(owner,'workspace',run.id,{generation:context.generation,reservationId:r.id,outcome:'SUCCEEDED'});
    return {reservationId:r.id,result};
  };
  return {...f,run,input,calls,checkpointSizes:checkpoints,invokeModel,worker:new InvestigationWorker({investigations:f.service,invokeModel})};
}
