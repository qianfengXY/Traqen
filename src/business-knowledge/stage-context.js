import {publicationDigest as digest} from './publication-authority.js';
import {questionPremiseResolver,questionOriginalContext} from './question-context.js';
import {analysisContractVersion} from './model-context.js';

export const analysisInputBytes=128*1024;
export const stageTechnicalBytes=32*1024;
export const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value));
const key=(v,k,id)=>`${v}\0${k}\0${id}`;
const routingName=value=>[...String(value??'')].slice(0,24).join('');

// A well-formed relation still cannot supply semantic premises through an
// invalid candidate endpoint. Preserve it in the server-side audit, without
// letting that endpoint re-enter Main's technical budget through the edge.
export function analysisExcludedKeys(relations,invalidKeys=[]) {
  const excluded=new Set(invalidKeys);
  for(const r of relations)if(excluded.has(r.sourceKey)||excluded.has(r.targetKey))excluded.add(r.key);
  return excluded;
}

// Pure projections of already authorized immutable records. This does not
// enlarge the investigation's allowed ids or establish a new technical Fact.
export function selectStageTechnical(packet,{materials=[],factIds=null,maxBytes=stageTechnicalBytes}={}) {
  const cache=new Map(),put=(kind,id,row)=>cache.set(key(row.versionId,kind,id),row);
  for(const r of packet.records??[])put('FACT',r.id,r);
  for(const r of packet.objects??[])put('OBJECT',r.objectId,r);
  for(const r of packet.evidence??[])put('EVIDENCE',r.evidenceId,r);
  for(const r of packet.materials??[])put('MATERIAL',r.materialId,r);
  const original=new Map(),allowed=new Set(packet.allowedFactIds??[]),versions=new Set(packet.versionIds??[]);
  for(const m of materials)original.set(m.id,[...(original.get(m.id)??[]),m]);
  const relevant=(v,kind,id)=>{
    const r=cache.get(key(v,kind,id)),m=r&&cache.get(key(v,'MATERIAL',r.materialId)),ranges=m&&original.get(m.sourceMaterial?.id);
    if(!ranges)return false;
    const a=r.anchor;
    // These are the actual supplied windows, not the bounding span of their
    // union: a Fact anchored in a gap must not acquire stage eligibility.
    return ranges.some(raw=>a?.kind!=='TEXT' || ((a.lineStart??0)<=(raw.endLine??Infinity) && (a.lineEnd??Infinity)>=(raw.startLine??1)));
  };
  const roots=(packet.records??[]).filter(r=>factIds!==null?factIds.includes(r.id)
    :relevant(r.versionId,'OBJECT',r.record.subjectId) || (r.record.targetId && relevant(r.versionId,'OBJECT',r.record.targetId))
      || (r.record.evidenceIds??[]).some(id=>relevant(r.versionId,'EVIDENCE',id)))
    .sort((a,b)=>Number(b.record.basis==='DERIVED')-Number(a.record.basis==='DERIVED')
      ||Number(!!b.record.targetId)-Number(!!a.record.targetId)||a.id.localeCompare(b.id));
  const emitted=new Map(),unresolved=[],limitations=[];
  for(const l of packet.limitations??[])if(typeof l?.code==='string'&&l.code.length<=128&&!limitations.some(p=>p.code===l.code)&&limitations.length<16)
    limitations.push({code:l.code,status:'UNKNOWN'});
  let omittedFactCount=0;
  const note=code=>{if(!limitations.some(l=>l.code===code)&&limitations.length<24)limitations.push({code,status:'UNKNOWN'});};
  const visit=(v,kind,id,rows,stack=new Set())=>{
    const k=key(v,kind,id);
    if(stack.has(k)||stack.size>=32)throw Error('CONTEXT_CYCLE_OR_DEPTH');
    if(rows.has(k))return;
    const r=cache.get(k);
    if(!r||!versions.has(v)||(kind==='FACT'&&!allowed.has(id)))throw Error('CONTEXT_MISSING_OR_OUT_OF_SCOPE');
    const next=new Set(stack);next.add(k);
    if(kind==='FACT') {
      visit(v,'OBJECT',r.record.subjectId,rows,next);
      if(r.record.targetId)visit(v,'OBJECT',r.record.targetId,rows,next);
      for(const e of r.record.evidenceIds??[])visit(v,'EVIDENCE',e,rows,next);
      for(const p of r.record.premiseFactIds??[])visit(v,'FACT',p,rows,next);
    } else if(kind==='OBJECT'||kind==='EVIDENCE') {
      visit(v,'MATERIAL',r.materialId,rows,next);
      if(kind==='OBJECT'&&r.parentId)visit(v,'OBJECT',r.parentId,rows,next);
    } else if(r.sourceMaterial?.bundleId!==packet.sourceBundleId)throw Error('CONTEXT_SOURCE_VERSION_MISMATCH');
    rows.set(k,r);
  };
  const project=rows=>{
    const of=kind=>[...rows].filter(([k])=>k.split('\0')[1]===kind).map(([,r])=>r);
    return {versionIds:packet.versionIds,sourceBundleId:packet.sourceBundleId,records:of('FACT'),objects:of('OBJECT'),evidence:of('EVIDENCE'),materials:of('MATERIAL'),
      allowedFactIds:[...new Set(of('FACT').map(r=>r.id))],unresolved,limitations,omittedFactCount,
      truncated:!!packet.truncated||omittedFactCount>0,
      selection:{kind:factIds===null?'ORIGINAL_RANGES':'EXPLICIT_FACT_REFS',eligibleRootCount:roots.length,
        availableRecordCount:(packet.records??[]).length,upstreamTruncated:!!packet.truncated,upstreamOmittedFactCount:packet.omittedFactCount??0},
      interpretation:'Only supplied dependency-closed adopted references may support this stage. Unselected or missing context is not evidence of absence.'};
  };
  for(const root of roots) {
    const rows=new Map();
    try{visit(root.versionId,'FACT',root.id,rows);}
    catch(error){omittedFactCount++;note(error.message);if(unresolved.length<16)unresolved.push({versionId:root.versionId,factId:root.id,status:'UNKNOWN',reason:error.message});continue;}
    const combined=new Map([...emitted,...rows]);
    if(jsonBytes(project(combined))+4096>maxBytes){omittedFactCount++;note('CONTEXT_BYTE_LIMIT');continue;}
    for(const [k,r]of rows)emitted.set(k,r);
  }
  if(factIds!==null)for(const id of factIds)if(!roots.some(r=>r.id===id)) {
    omittedFactCount++;note('CONTEXT_MISSING_OR_OUT_OF_SCOPE');
    if(unresolved.length<16)unresolved.push({factId:id,status:'UNKNOWN',reason:'CONTEXT_MISSING_OR_OUT_OF_SCOPE'});
  }
  const result=project(emitted);
  while(jsonBytes(result)>maxBytes && unresolved.length)unresolved.pop();
  return result;
}

export function technicalRouting(packet) {
  return {authority:'ROUTING_NOT_EVIDENCE',versionIds:packet.versionIds,sourceBundleId:packet.sourceBundleId,
    records:[],objects:[],evidence:[],materials:[],allowedFactIds:[],
    availableFactCount:packet.availableFactCount??(packet.records??[]).length,
    truncated:!!packet.truncated,omittedFactCount:packet.omittedFactCount??0,
    interpretation:'Routing/coverage metadata only. PLAN cannot establish a technical or business conclusion.'};
}

export function stageInput(input) {
  const refs=[...(input.candidates??[]),...(input.relations??[])].flatMap(p=>p.technicalRefs??[]);
  const technicalEvidence=input.phase==='PLAN'?technicalRouting(input.technicalEvidence)
    :selectStageTechnical(input.technicalEvidence,{materials:input.materials??[],factIds:refs.length?[...new Set(refs)]:null});
  const result={...input,technicalEvidence,resourceContext:{contractVersion:analysisContractVersion,maxInputBytes:analysisInputBytes,maxTechnicalBytes:stageTechnicalBytes}};
  if(input.inventory)result.inventory=[];
  if(input.existingCandidates) {
    // Supplement relations may reference only these actual supplied routing
    // keys. Old observations are not duplicated as fresh semantic evidence.
    result.existingCandidates=[];
    result.existingCandidateCoverage={total:input.existingCandidates.length,supplied:0,pending:input.existingCandidates.length,
      digest:digest(input.existingCandidates),authority:'ROUTING_NOT_EVIDENCE'};
    for(const p of input.existingCandidates) {
      result.existingCandidates.push({key:p.key,kind:p.kind??'UNKNOWN',name:routingName(p.name)});
      if(jsonBytes(result)>analysisInputBytes){result.existingCandidates.pop();break;}
    }
    result.existingCandidateCoverage.supplied=result.existingCandidates.length;
    result.existingCandidateCoverage.pending=input.existingCandidates.length-result.existingCandidates.length;
  }
  if(input.inventory) {
    const inventory=[];
    result.inventory=inventory;
    result.inventoryCoverage={total:input.inventory.length,supplied:0,pending:input.inventory.length,digest:digest(input.inventory),meaning:'ROUTING_NOT_SEMANTIC_COVERAGE'};
    for(const item of input.inventory) {
      inventory.push(item);result.inventoryCoverage.supplied=inventory.length;result.inventoryCoverage.pending=input.inventory.length-inventory.length;
      if(jsonBytes(result)>analysisInputBytes){inventory.pop();result.inventoryCoverage.supplied=inventory.length;result.inventoryCoverage.pending=input.inventory.length-inventory.length;break;}
    }
  }
  return result;
}

// One Main call remains one fixed-budget call. All originals stay in the
// canonical store; atomic items which cannot enter this bounded verification
// packet remain pending/UNKNOWN rather than disappearing from the graph.
export function analysisStagePacket(input,rawMaterials=[]) {
  if(input.phase!=='VERIFY')return {input:stageInput(input),omitted:[]};
  if(input.taskReports||input.pendingResponsibilities) {
    input={...input};
    for(const [field,coverage]of [['taskReports','taskReportCoverage'],['pendingResponsibilities','pendingResponsibilityCoverage']])if(input[field]) {
      const full=input[field],supplied=[];
      for(const row of full){supplied.push(row);if(jsonBytes(supplied)>8192){supplied.pop();break;}}
      input[field]=supplied;input[coverage]={total:full.length,supplied:supplied.length,pending:full.length-supplied.length,
        digest:digest(full),authority:'ROUTING_NOT_EVIDENCE',scope:'UNSUPPLIED_RESPONSIBILITIES_REMAIN_UNFINISHED'};
    }
  }
  const all=[...(input.candidates??[]),...(input.relations??[])],byKey=new Map(all.map(p=>[p.key,p])),candidateKeys=new Set((input.candidates??[]).map(p=>p.key));
  const invalid=analysisExcludedKeys(input.relations??[],input.invalidProposalKeys??[]),retained=[],omitted=[];
  const isolatedKeys=all.filter(p=>invalid.has(p.key)).map(p=>p.key);
  const project=items=>{
    const keys=new Set(items.map(p=>p.key)),endpoints=[];
    for(const p of items.filter(p=>!candidateKeys.has(p.key)))for(const k of [p.sourceKey,p.targetKey])if(k&&!keys.has(k)) {
      const endpoint=byKey.get(k)??rawMaterials.find(m=>m.id===k);
      // Endpoint identity and original bytes are separate. The necessary raw
      // body is supplied exactly once by questionOriginalContext below.
      if(endpoint&&!endpoints.some(e=>(e.key??e.id)===k))endpoints.push(endpoint.key?endpoint:{id:endpoint.id,key:k,sourceMaterial:endpoint.sourceMaterial});
    }
    const refs=[...new Set([...items,...endpoints].flatMap(p=>p.technicalRefs??[]))];
    const technicalEvidence=selectStageTechnical(input.technicalEvidence,{factIds:refs});
    const resolver=questionPremiseResolver(items,endpoints,technicalEvidence,{requireAccepted:false});
    const original=questionOriginalContext(items.filter(p=>!invalid.has(p.key)).map(p=>({key:p.key,graphRefs:[p.key]})),rawMaterials,resolver);
    const origins=new Set([...items,...endpoints].flatMap(p=>p.originRefs??[]));
    const originalProposals=(input.originalProposals??input.consolidation?.originalProposals??[]).filter(p=>origins.has(p.id));
    const {candidates:_c,relations:_r,originalProposals:_o,consolidation:_g,materials:_m,evidenceContext:_e,technicalEvidence:_t,...base}=input;
    return {...base,candidates:items.filter(p=>candidateKeys.has(p.key)),relations:items.filter(p=>!candidateKeys.has(p.key)),endpoints,
      ...(input.invalidProposalKeys?{invalidProposalKeys:input.invalidProposalKeys.filter(k=>keys.has(k))}:{}),
      ...(input.originalProposals?{originalProposals}:{}),
      ...(input.consolidation?{consolidation:{originalProposals,
        sourceToCanonical:(input.consolidation.sourceToCanonical??[]).filter(p=>keys.has(p.canonicalKey)),
        groups:(input.consolidation.groups??[]).filter(g=>g.keys?.some(k=>origins.has(k)||keys.has(k)))}}:{}),
      ...original,technicalEvidence,resourceContext:{contractVersion:analysisContractVersion,maxInputBytes:analysisInputBytes,maxTechnicalBytes:stageTechnicalBytes,
        isolatedItems:{count:isolatedKeys.length,digest:digest(isolatedKeys),scope:'SERVER_SIDE_INVALID_ORIGINALS_NOT_SEMANTIC_INPUT'},
        totalProposals:all.length,suppliedProposals:items.length,scope:'BOUNDED_SUBSET_PENDING_IS_NOT_ACCEPTED'}};
  };
  // Invalid originals remain in the durable proposal/guard audit. Neither
  // their text nor their Fact roots participate in Main's semantic budget.
  for(const p of all.filter(p=>!invalid.has(p.key))) {
    const proposed=project([...retained,p]);
    if(jsonBytes(proposed)<=analysisInputBytes)retained.push(p);
    else omitted.push({key:p.key,reason:'MODEL_INPUT_BYTE_BUDGET'});
  }
  return {input:project(retained),omitted};
}

export const questionStageContractVersion=4;

// A routing key is not a graph assertion or a citable Fact. PLAN keeps the
// complete requested key set without duplicating graph evidence into a prompt.
export function questionPlanPacket(input) {
  return {...input,objects:input.objects.map(o=>({key:o.key,kind:o.kind??'DIRECTED_RELATION',name:routingName(o.name??o.predicate)})),endpoints:[],
    technicalEvidence:technicalRouting(input.technicalEvidence),
    resourceContext:{questionContractVersion:questionStageContractVersion,maxInputBytes:analysisInputBytes,
      maxTechnicalBytes:stageTechnicalBytes,authority:'ROUTING_NOT_EVIDENCE',requestedObjects:input.objects.length,
      graphViewDigest:digest({objects:input.objects,endpoints:input.endpoints})}};
}

// Project the graph, directed endpoints, original ranges and technical DAG as
// one atomic closure per assigned object / answer segment. Omitted items stay
// in the durable request/draft and cannot be approved by a generic model vote.
export function questionStagePacket(base,{drafts=null,materials=[],eligible=()=>true}={}) {
  const objects=base.objects,endpoints=base.endpoints,all=new Map([...endpoints,...objects].map(o=>[o.key,o]));
  const fullResolver=questionPremiseResolver(objects,endpoints,base.technicalEvidence);
  const items=drafts?drafts.flatMap(d=>d.segments):objects.map(o=>({key:o.key,graphRefs:[o.key]}));
  const semanticItems=items.filter(eligible),isolatedKeys=items.filter(s=>!eligible(s)).map(s=>s.key);
  const provenance=new Map((drafts??[]).flatMap(d=>d.segments.map(s=>[s.key,d])));
  const project=retained=>{
    const refs=new Set(retained.flatMap(s=>s.graphRefs)),keys=new Set();
    for(const k of refs)for(const g of fullResolver.forKeys([k]).graphKeys)keys.add(g);
    const selected=objects.filter(o=>refs.has(o.key)),selectedKeys=new Set(selected.map(o=>o.key));
    const selectedEndpoints=[...keys].filter(k=>!selectedKeys.has(k)).map(k=>all.get(k)).filter(Boolean);
    const technicalEvidence=selectStageTechnical(base.technicalEvidence,{factIds:[...new Set([...selected,...selectedEndpoints].flatMap(o=>o.technicalRefs??[]))]});
    const resolver=questionPremiseResolver(selected,selectedEndpoints,technicalEvidence);
    const original=questionOriginalContext(retained.filter(eligible),materials,resolver);
    const input={...base,objects:selected,endpoints:selectedEndpoints,...original,technicalEvidence,
      resourceContext:{questionContractVersion:questionStageContractVersion,maxInputBytes:analysisInputBytes,maxTechnicalBytes:stageTechnicalBytes,
        isolatedItems:{count:isolatedKeys.length,digest:digest(isolatedKeys),scope:'SERVER_SIDE_INVALID_DRAFTS_NOT_SEMANTIC_INPUT'},
        requestedItems:items.length,suppliedItems:retained.length,pendingItems:semanticItems.length-retained.length,scope:'BOUNDED_SUBSET_PENDING_IS_NOT_SUPPORTED'}};
    if(drafts) {
      input.drafts=[];
      for(const s of retained) {
        const d=provenance.get(s.key);let group=input.drafts.find(g=>g.taskKey===d.taskKey);
        if(!group){group={taskKey:d.taskKey,segments:[],unknowns:[]};input.drafts.push(group);}
        group.segments.push(s);
      }
    }
    return input;
  };
  const retained=[],omitted=[];
  for(const item of semanticItems) {
    if(jsonBytes(project([...retained,item]))<=analysisInputBytes)retained.push(item);
    else omitted.push({key:item.key,reason:'MODEL_INPUT_BYTE_BUDGET'});
  }
  const input=project(retained);
  return {input:jsonBytes(input)<=analysisInputBytes?input:null,omitted,
    resolver:input?questionPremiseResolver(input.objects,input.endpoints,input.technicalEvidence):null};
}
