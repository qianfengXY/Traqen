import {createHash} from 'node:crypto';
import {canonicalEncode} from '../source-truth/identity.js';
import {requireF003} from './errors.js';
import {analysisContractVersion,sourceRange,originalLineWindow} from './model-context.js';
import {jsonBytes} from './stage-context.js';

export const taskDigest=value=>createHash('sha256').update(canonicalEncode(value)).digest('hex');
const text=(v,max=2048)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const list=(v,max)=>Array.isArray(v)&&v.length<=max;
const sameQuestion=v=>v.normalize('NFKC').replace(/\s+/g,'').toLowerCase();

// This validates responsibility and resource structure, not the semantic
// adequacy of a decomposition. Only independent evaluation can establish that.
export function businessPlan(plan,{inventory,visibleKeys,childIds,question}) {
  const byKey=new Map(inventory.map(m=>[m.key,m]));
  const invalid=()=>requireF003(false,'F003_MODEL_OUTPUT_INVALID','Main必须提供具体业务子问题、待核义务、固定材料责任和明确未完成项');
  if(!list(plan?.assignments,32)||!plan.assignments.length||!list(plan.pendingMaterials??[],10000))invalid();
  const assignments=plan.assignments.map(a=>{
    if(!a||Object.keys(a).some(k=>!['slotId','objective','obligations','materialKeys','ranges','sharedEvidenceReason'].includes(k))
      ||!childIds.has(a.slotId)||!text(a.objective,4096)||!list(a.obligations,16)||!a.obligations.length
      ||!a.obligations.every(o=>text(o))||!list(a.materialKeys,100)||!a.materialKeys.length
      ||new Set(a.materialKeys).size!==a.materialKeys.length||!a.materialKeys.every(k=>byKey.has(k)&&visibleKeys.has(k))
      ||!list(a.ranges??[],100)||(a.sharedEvidenceReason!==undefined&&!text(a.sharedEvidenceReason)))invalid();
    requireF003(sameQuestion(a.objective)!==sameQuestion(question),'F003_PLAN_UNBOUNDED_TASK',
      '不能把整个调查问题原样复制到物理分片；请给具体业务子问题和证据责任');
    const orderedRanges=(a.ranges??[]).map(r=>{
      if(!r||Object.keys(r).some(k=>!['materialKey','startLine','endLine'].includes(k))||!a.materialKeys.includes(r.materialKey)
        ||!Number.isSafeInteger(r.startLine)||r.startLine<1||!Number.isSafeInteger(r.endLine)||r.endLine<r.startLine)invalid();
      return {materialKey:r.materialKey,startLine:r.startLine,endLine:r.endLine};
    }).sort((a,b)=>a.materialKey.localeCompare(b.materialKey)||a.startLine-b.startLine||a.endLine-b.endLine);
    const ranges=[];
    for(const r of orderedRanges){const p=ranges.at(-1);if(p?.materialKey===r.materialKey&&r.startLine<=p.endLine+1)p.endLine=Math.max(p.endLine,r.endLine);else ranges.push(r);}
    const normalized={slotId:a.slotId,objective:a.objective.trim(),obligations:[...new Set(a.obligations.map(o=>o.trim()))].sort(),
      materialKeys:[...a.materialKeys].sort(),ranges,sharedEvidenceReason:a.sharedEvidenceReason?.trim()??null};
    return {...normalized,responsibilityId:taskDigest(normalized)};
  }).sort((a,b)=>a.responsibilityId.localeCompare(b.responsibilityId));
  requireF003(new Set(assignments.map(a=>a.responsibilityId)).size===assignments.length,'F003_PLAN_DUPLICATE_TASK','同一规范任务不能换模型taskId重复领取');
  // Shared premises are legal, but their overlap must be deliberate and
  // explained, not an accidental problem-by-entire-inventory Cartesian loop.
  const overlap=(a,b,k)=>{
    const x=a.ranges.filter(r=>r.materialKey===k),y=b.ranges.filter(r=>r.materialKey===k);
    return !x.length||!y.length||x.some(r=>y.some(s=>r.startLine<=s.endLine&&s.startLine<=r.endLine));
  };
  for(let i=0;i<assignments.length;i++)for(const b of assignments.slice(i+1)) {
    const a=assignments[i];
    requireF003(!a.materialKeys.some(k=>b.materialKeys.includes(k)&&overlap(a,b,k))||(a.sharedEvidenceReason&&b.sharedEvidenceReason),
      'F003_PLAN_DUPLICATED_EVIDENCE','多任务重叠证据必须说明共享前提，不能反复分派全目录');
  }
  const pending=[];
  for(const p of plan.pendingMaterials??[]) {
    if(!p||Object.keys(p).some(k=>!['materialKey','reason'].includes(k))||!byKey.has(p.materialKey)||!visibleKeys.has(p.materialKey)||!text(p.reason))invalid();
    if(pending.some(m=>m.materialKey===p.materialKey))invalid();
    pending.push({materialKey:p.materialKey,reason:p.reason.trim(),status:'PENDING'});
  }
  for(const m of inventory)if(!assignments.some(a=>a.materialKeys.includes(m.key))&&!pending.some(p=>p.materialKey===m.key)) {
    requireF003(m.kind!=='FILE'||!visibleKeys.has(m.key),'F003_PLAN_COVERAGE_GAP','完整目录中的可见文件既无调查责任也无明确未完成原因',
      {details:{materialKey:m.key}});
    pending.push({materialKey:m.key,status:'PENDING',reason:visibleKeys.has(m.key)?'NO_TEXT_RESPONSIBILITY':'NOT_SENT_TO_PLANNER'});
  }
  return {assignments,pending};
}

export function responsibilityMaterials(assignment,materialByKey) {
  return assignment.materialKeys.flatMap(k=>{
    const material=materialByKey.get(k);if(!material)return [];
    const requested=assignment.ranges.filter(r=>r.materialKey===k);
    if(!requested.length)return [material];
    // Merge overlapping/adjacent windows, never widen across a gap.
    const merged=[];
    for(const r of requested){const prev=merged.at(-1);if(prev&&r.startLine<=prev.endLine+1)prev.endLine=Math.max(prev.endLine,r.endLine);else merged.push({...r});}
    try{return merged.map(r=>originalLineWindow(material,r.startLine,r.endLine));}
    catch{requireF003(false,'F003_PLAN_SOURCE_RANGE','任务行区间不属于实际冻结原文');}
  });
}

export function bindBusinessTask(run,assignment,input) {
  // Hash the ACTUAL projected packet, including local dependency-closed F002
  // context, not the global allow-list or an array position/model-supplied id.
  const identity={contractVersion:analysisContractVersion,question:run.question,sourceInput:run.sourceInput,
    adoptedVersionIds:run.adoptedVersionIds,profileId:run.profile.id,
    continuationBasisDigest:run.continuationBasis?.digest??null,
    slot:run.profile.childAgentSlots.find(s=>s.id===assignment.slotId),responsibilityId:assignment.responsibilityId,input};
  return {taskKey:`child-${taskDigest(identity)}`,slotId:assignment.slotId,responsibilityId:assignment.responsibilityId,
    inputDigest:taskDigest(input),inputBytes:jsonBytes(input),sourceRanges:input.materials.map(sourceRange),input};
}

export function futureTaskBudget(manifest,{usage,maxModelCalls,cached,mainKeys=['consolidation','verification']}) {
  const remaining=manifest.tasks.filter(t=>!cached.has(t.taskKey));
  const main=mainKeys.filter(k=>!cached.has(k));
  const requiredCalls=remaining.length+main.length,availableCalls=maxModelCalls-usage.modelCalls;
  return {availableCalls,requiredCalls,remainingChildCalls:remaining.length,remainingMainCalls:main.length,
    discretionaryCalls:Math.max(0,availableCalls-requiredCalls),feasible:availableCalls>=requiredCalls};
}
