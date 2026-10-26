import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {canonicalEncode,structureDigest} from '../source-truth/identity.js';
import {analysisContractVersion} from './model-context.js';

export const dependencyContractVersion=1;
export const dependencyDigest=v=>createHash('sha256').update(canonicalEncode(v)).digest('hex');
const same=(a,b)=>canonicalEncode(a)===canonicalEncode(b);
const key=r=>`${r.versionId}\0${r.kind}\0${r.id}`;
const logical=m=>canonicalEncode({sourceId:m.sourceId,pathBytes:m.pathBytes});
const rawIdentity=m=>({sourceId:m.sourceId,pathBytes:m.pathBytes,kind:m.kind,disposition:m.disposition,
  reasonCode:m.reasonCode,sizeBytes:m.sizeBytes,contentDigest:m.contentDigest,sourceContract:m.sourceContract??null});
const unknown=(key,reason,dependencies=[])=>({key,eligibility:'RECHECK',reasons:[reason],dependencies});
const semantic=p=>'predicate'in p?{sourceKey:p.sourceKey,predicate:p.predicate,targetKey:p.targetKey,scope:p.scope}
  :{kind:p.kind,name:p.name,statement:p.statement,scope:p.scope,dependencyScope:p.dependencyScope??null};

// A deliberately small proof language, not a model-controlled completeness
// flag or an automatic business-semantic judge. Only this exact *local source
// declaration* proposition is eligible. General claims (including absence,
// universal/runtime claims) still need re-investigation under the full scope.
export function literalDeclaration(name,value) {
  return {kind:'FUNCTION',name,statement:`Local declaration ${name} returns literal ${JSON.stringify(value)}.`,
    scope:'LOCAL_DECLARATION_ONLY; no runtime, caller, absence or global claim',
    dependencyScope:{kind:'LOCAL_RETURN_LITERAL',functionName:name,value}};
}

export function dependencyIndex({rows,profiles,inventory,bundleId,workspaceId,status='AVAILABLE',impactEdges=[],
  maxDependencyWork=500000,maxDependencyClosureItems=50000}) {
  const byId=new Map(rows.map(r=>[key(r),r])),memo=new Map(),dependencyMemo=new Map(),materialById=new Map();
  let work=0,closureItems=0,exhausted=false;
  const charge=(n=1)=>{work+=n;if(exhausted||work>maxDependencyWork){exhausted=true;status='INCOMPLETE';throw Error('DEPENDENCY_WORK_LIMIT');}};
  const output=n=>{closureItems+=n;if(closureItems>maxDependencyClosureItems){exhausted=true;status='INCOMPLETE';throw Error('DEPENDENCY_CLOSURE_OUTPUT_LIMIT');}};
  for(const r of rows.filter(r=>r.kind==='MATERIAL')) {
    const p=r.payload,m=inventory.find(m=>m.componentId===p.componentId&&m.pathBytes===p.pathBytes);
    if(m&&m.contentDigest===p.contentDigest)materialById.set(key(r),{...m,technicalMaterialId:r.id,versionId:r.versionId});
  }
  const ref=(r,kind,id)=>byId.get(key({versionId:r.versionId,kind,id}));
  const solve=(r,path=new Set())=>{
    charge();if(!r||path.has(key(r))||path.size>=128)throw Error('MISSING_OR_CYCLIC_PREMISE');
    const cached=dependencyMemo.get(key(r));
    if(cached){if(path.size+cached.height>128)throw Error('DEPENDENCY_DEPTH_LIMIT');return cached;}
    const next=new Set(path);next.add(key(r));let result;
    if(r.kind==='MATERIAL') {
      const m=materialById.get(key(r));if(!m)throw Error('UNBOUND_TECHNICAL_MATERIAL');result={materials:[m.materialId],height:1};
    }else {
      const p=r.payload,refs=r.kind==='FACT'?[ref(r,'OBJECT',p.subjectId),...(p.targetId?[ref(r,'OBJECT',p.targetId)]:[]),
        ...(p.evidenceIds??[]).map(id=>ref(r,'EVIDENCE',id)),...(p.premiseFactIds??[]).map(id=>ref(r,'FACT',id))]
        :[ref(r,'MATERIAL',p.materialId),...(r.kind==='OBJECT'&&p.parentId?[ref(r,'OBJECT',p.parentId)]:[])];
      const materials=new Set();let height=1;
      for(const child of refs){const solved=solve(child,next);height=Math.max(height,solved.height+1);
        for(const id of solved.materials){charge();materials.add(id);}}
      if(path.size+height>128)throw Error('DEPENDENCY_DEPTH_LIMIT');
      result={materials:[...materials].sort(),height};
    }
    // Cache only a completely solved, acyclic subgraph. Height is retained so
    // a shallow cached visit cannot evade a later deep current-path boundary.
    output(result.materials.length);dependencyMemo.set(key(r),result);return result;
  };
  const dependencies=r=>solve(r).materials;
  const signature=(r,stack=new Set())=>{
    if(!r||stack.has(key(r))||stack.size>128)throw Error('MISSING_OR_CYCLIC_PREMISE');
    if(memo.has(key(r)))return memo.get(key(r));
    const next=new Set(stack);next.add(key(r));let normalized;
    if(r.kind==='MATERIAL') {const m=materialById.get(key(r));if(!m)throw Error('UNBOUND_TECHNICAL_MATERIAL');normalized=rawIdentity(m);}
    else {
      normalized={kind:r.kind};
      for(const [field,value] of Object.entries(r.payload)) {
        if(['factId','objectId','evidenceId'].includes(field))continue;
        const target=field==='materialId'?'MATERIAL':['subjectId','targetId','parentId'].includes(field)?'OBJECT':null;
        normalized[field]=target?signature(ref(r,target,value),next)
          :field==='evidenceIds'?value.map(id=>signature(ref(r,'EVIDENCE',id),next)).sort()
            :field==='premiseFactIds'?value.map(id=>signature(ref(r,'FACT',id),next)).sort():value;
      }
    }
    const result=dependencyDigest(normalized);memo.set(key(r),result);return result;
  };
  const factMap=new Map();for(const r of rows.filter(r=>r.kind==='FACT'))factMap.set(r.id,[...(factMap.get(r.id)??[]),r]);
  const facts=id=>factMap.get(id)??[];
  const refs=ids=>ids.map(id=>{const found=facts(id);if(found.length!==1)throw Error('AMBIGUOUS_FACT');return found[0];});
  const edges=new Map();for(const e of impactEdges)edges.set(e.from,[...new Set([...(edges.get(e.from)??[]),...e.to])]);
  for(const r of rows.filter(r=>r.kind==='FACT'))try {
    const subject=ref(r,'OBJECT',r.payload.subjectId),from=dependencies(subject);
    // Include complete declared/derived targets and premise DAG, not just
    // business graph adjacency. A changed callee affects its unchanged caller.
    const to=dependencies(r);
    for(const a of from)edges.set(a,[...new Set([...(edges.get(a)??[]),...to.filter(b=>b!==a)])]);
  } catch {status='INCOMPLETE';}
  const closure=ids=>{
    const visited=new Set(ids),queue=[...ids];
    for(let i=0;i<queue.length;i++)for(const id of edges.get(queue[i])??[]){charge();if(!visited.has(id)){visited.add(id);queue.push(id);}}
    output(visited.size);
    return [...visited].sort();
  };
  const selector=r=>{const o=ref(r,'OBJECT',r.payload.subjectId),m=o&&materialById.get(key({versionId:r.versionId,kind:'MATERIAL',id:o.payload.materialId}));
    if(!m)throw Error('UNBOUND_TECHNICAL_SUBJECT');
    return {sourceId:m.sourceId,pathBytes:m.pathBytes,predicate:r.payload.predicate,kind:o.payload.kind??null,
      name:o.payload.name??null,anchor:o.payload.anchor??null};};
  return {rows,profiles,inventory,bundleId,workspaceId,get status(){return status;},byId,materialById,signature,dependencies,refs,closure,selector,
    digest:dependencyDigest({rows,profiles,inventory,impactEdges,status})};
}

function validEvidence(c,materials) {
  return materials.some(m=>{
    const base=m.startLine??1;
    return m.id===c?.materialId&&Number.isSafeInteger(c.startLine)&&Number.isSafeInteger(c.endLine)&&c.startLine>=base&&c.endLine>=c.startLine
      &&c.endLine<base+m.text.split(/\r?\n/).length&&typeof c.quote==='string'&&c.quote.length>0
      &&m.text.split(/\r?\n/).slice(c.startLine-base,c.endLine-base+1).join('\n').includes(c.quote);
  });
}

// This is transport eligibility for a *hypothesis*, never a proof of semantic
// completeness. A positive local hypothesis requires an explicit A review of
// applicability and counterexamples; B must perform that review anew with
// full-scope Child counterexample coverage. No absence/universal shortcut.
export function positiveBoundary(p,materials) {
  const a=p.verification?.dependencyAssessment;
  if(a?.extent!=='POSITIVE_LOCAL'||typeof a.rationale!=='string'||!a.rationale.trim()
    ||!Array.isArray(a.unresolvedDependencies)||a.unresolvedDependencies.length
    ||!Array.isArray(a.applicabilityEvidence)||!a.applicabilityEvidence.length||a.applicabilityEvidence.length>200
    ||!Array.isArray(a.counterexampleEvidence)||!a.counterexampleEvidence.length||a.counterexampleEvidence.length>200
    ||[...a.applicabilityEvidence,...a.counterexampleEvidence].some(c=>!validEvidence(c,materials)))return null;
  if(!p.evidence?.length||!p.technicalRefs?.length||p.uncertainties?.length
    ||p.identityIssues?.length||p.consolidationIssues?.length)return null;
  return {kind:'POSITIVE_HISTORICAL_HYPOTHESIS',dependencyCompleteness:'UNPROVEN',
    requiredRecheck:'FULL_B_COUNTEREXAMPLES_AND_CURRENT_MAIN',assessment:structuredClone(a)};
}

function semanticProducer(graph,p) {
  if(p.provenance?.kind==='REVALIDATED_REUSE')return p.provenance.producer;
  if(p.provenance?.reservationId&&graph.process.some(c=>c.reservationId===p.provenance.reservationId))return p.provenance;
  const main=graph.process.find(c=>c.taskKey==='consolidation'),keys=p.provenance?.sourceKeys;
  if(!main?.reservationId||!Array.isArray(keys)||!keys.length||keys.length>200)throw Error('MISSING_SEMANTIC_PRODUCER');
  const originals=graph.consolidation.originalProposals.filter(o=>keys.includes(o.id));
  if(originals.length!==keys.length)throw Error('MISSING_CANONICAL_PRODUCER_LINEAGE');
  const reference=origin=>{
    const fields=['kind','investigationId','reservationId','modelRevisionId','taskKey','slotId','generation',
      'sourceGraphDigest','sourceKey','reuseProofDigest'];
    const result=Object.fromEntries(fields.filter(k=>origin?.[k]!==undefined).map(k=>[k,origin[k]]));
    if(origin?.producer)result.producer=Object.fromEntries(fields.filter(k=>origin.producer[k]!==undefined).map(k=>[k,origin.producer[k]]));
    return result;
  };
  return {kind:'MAIN_CONSOLIDATION',investigationId:graph.investigationId,reservationId:main.reservationId,
    modelRevisionId:main.modelRevisionId,taskKey:main.invocationTaskKey??main.taskKey,sourceKeys:keys,
    // Resolve fuller history through the immutable source graph/original id.
    // Never recursively inline a previous Main's entire producer tree into
    // each subsequent reuse+merge. Actual actor/model reservation ids stay exact.
    originalProducers:originals.map(o=>({id:o.id,originDigest:dependencyDigest(o.origin),origin:reference(o.origin)}))};
}

function localProof(p,materials,index) {
  const d=p.dependencyScope;
  if(!d||d.kind!=='LOCAL_RETURN_LITERAL'||Object.keys(d).some(k=>!['kind','functionName','value'].includes(k))
    ||typeof d.functionName!=='string'||!['string','number','boolean'].includes(typeof d.value))return null;
  if(!same(literalDeclaration(d.functionName,d.value),{kind:p.kind,name:p.name,statement:p.statement,scope:p.scope,dependencyScope:d}))return null;
  if(p.evidence?.length!==1||!p.technicalRefs?.length||p.uncertainties?.length||p.identityIssues?.length||p.consolidationIssues?.length)return null;
  const c=p.evidence[0],m=materials.find(m=>m.id===c.materialId);
  if(!m||m.completeMaterial===false||Buffer.byteLength(m.text)>128*1024)return null;
  const lines=m.text.split(/\r?\n/);
  if(!Number.isSafeInteger(c.startLine)||!Number.isSafeInteger(c.endLine)||c.startLine<1||c.endLine>lines.length
    ||typeof c.quote!=='string'||!lines.slice(c.startLine-1,c.endLine).join('\n').includes(c.quote))return null;
  let ast;
  try {ast=parse(m.text,{ecmaVersion:'latest',sourceType:'module',locations:true});}catch{return null;}
  const functions=ast.body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n)
    .filter(n=>n?.type==='FunctionDeclaration'&&n.id?.name===d.functionName);
  if(functions.length!==1)return null;
  const fn=functions[0],ret=fn.body.body;
  if(fn.async||fn.generator||fn.params.length||ret.length!==1||ret[0].type!=='ReturnStatement'
    ||ret[0].argument?.type!=='Literal'||!same(ret[0].argument.value,d.value))return null;
  const start=Buffer.byteLength(m.text.slice(0,fn.start)),end=Buffer.byteLength(m.text.slice(0,fn.end));
  if(c.startLine>fn.loc.start.line||c.endLine<fn.loc.end.line||!c.quote.includes(m.text.slice(fn.start,fn.end)))return null;
  const objects=index.rows.filter(r=>r.kind==='OBJECT'&&r.payload.kind==='FUNCTION'&&r.payload.name===d.functionName
    &&r.payload.anchor?.byteStart===start&&r.payload.anchor?.byteEnd===end
    &&index.materialById.get(key({versionId:r.versionId,kind:'MATERIAL',id:r.payload.materialId}))?.materialId===m.id);
  if(objects.length!==1)return null;
  const object=objects[0],names=index.rows.filter(r=>r.kind==='FACT'&&r.versionId===object.versionId
    &&r.payload.subjectId===object.id&&r.payload.predicate==='name'&&r.payload.value?.value===d.functionName);
  if(names.length!==1)return null;
  return {kind:'AST_LITERAL_DECLARATION',objectSignature:index.signature(object),nameFactSignature:index.signature(names[0]),nameFactSelector:index.selector(names[0]),
    anchor:object.payload.anchor,materialId:m.id,assertion:d,extent:'LOCAL_DECLARATION_NOT_RUNTIME_OR_CLOSED_WORLD'};
}

export function recordDependencies(graph,materials,index) {
  const entries=[...graph.candidates,...graph.relations].map(p=>{
    let dependencies=[],facts=[],proof=null,producer=null,reason='UNPROVED_SEMANTIC_BOUNDARY';
    try {
      if(index.status!=='AVAILABLE')throw Error('DEPENDENCY_INDEX_INCOMPLETE');
      facts=index.refs(p.technicalRefs);
      dependencies=index.closure([...new Set([...(p.evidence??[]).map(c=>c.materialId),...facts.flatMap(r=>index.dependencies(r))])]);
      if(index.status!=='AVAILABLE')throw Error('DEPENDENCY_INDEX_INCOMPLETE');
      if(p.state!=='ANALYSIS_ACCEPTED')throw Error('UNACCEPTED_SOURCE');
      if(!p.provenance||!p.originRefs?.length)throw Error('MISSING_SEMANTIC_PRODUCER');
      producer=semanticProducer(graph,p);
      proof=localProof(p,materials,index)??positiveBoundary(p,materials);
      if(proof?.kind==='POSITIVE_HISTORICAL_HYPOTHESIS')dependencies=index.closure([...new Set([...dependencies,
        ...proof.assessment.applicabilityEvidence.map(c=>c.materialId),...proof.assessment.counterexampleEvidence.map(c=>c.materialId)])]);
    } catch(error) {reason=error.message;}
    if(!proof)return unknown(p.key,reason,dependencies);
    const body={key:p.key,eligibility:proof.kind==='AST_LITERAL_DECLARATION'?'PROVABLE_LOCAL':'HISTORICAL_CANDIDATE_ONLY',dependencies,
      rawEvidence:structuredClone(proof.kind==='POSITIVE_HISTORICAL_HYPOTHESIS'
        ?[...p.evidence,...proof.assessment.applicabilityEvidence,...proof.assessment.counterexampleEvidence]:p.evidence),
      factBindings:facts.map(r=>({id:r.id,signature:index.signature(r),selector:index.selector(r)})),proof,
      producer:structuredClone(producer),
      originalRefs:[...(p.provenance.kind==='REVALIDATED_REUSE'?p.provenance.originalRefs:p.originRefs)],semanticDigest:dependencyDigest(semantic(p))};
    return {...body,proofDigest:dependencyDigest(body)};
  });
  for(const p of graph.relations) {
    const entry=entries.find(e=>e.key===p.key);if(entry.eligibility==='RECHECK')continue;
    const dependencies=[];
    for(const endpoint of [p.sourceKey,p.targetKey]) {
      const e=entries.find(e=>e.key===endpoint);
      if(e&&e.eligibility!=='RECHECK')dependencies.push(...e.dependencies);
      else if(index.inventory.some(m=>m.materialId===endpoint))dependencies.push(endpoint);
      else {entry.eligibility='RECHECK';entry.reasons=['UNPROVEN_ENDPOINT_BOUNDARY'];}
    }
    entry.dependencies=[...new Set([...entry.dependencies,...dependencies])].sort();
    const {proofDigest,...body}=entry;entry.proofDigest=dependencyDigest(body);
  }
  if(index.status!=='AVAILABLE')for(let i=0;i<entries.length;i++)entries[i]=unknown(entries[i].key,'DEPENDENCY_INDEX_INCOMPLETE',entries[i].dependencies);
  const body={version:dependencyContractVersion,status:index.status,indexDigest:index.digest,technicalProfiles:index.profiles,inventory:index.inventory,entries};
  return {...body,digest:dependencyDigest(body)};
}

export function rebindContinuation({basis,graph,index,materials,run}) {
  const review=graph.dependencyReview,dispositions=[],candidates=[],relations=[],originalProposals=[],proofs=[];
  const fallback=reason=>({mode:'FULL_B_FALLBACK',basisDigest:basis.digest,reasons:[reason],dispositions:
    [...graph.candidates,...graph.relations].map(p=>({sourceKey:p.key,status:'RECHECK',reasons:[reason]})),candidates,relations,originalProposals,proofs});
  if(review?.version!==dependencyContractVersion||basis.a.analysisContractVersion!==analysisContractVersion)return fallback('LEGACY_OR_UNPROVED_A');
  if(!same(basis.b.adoptedVersionIds,run.adoptedVersionIds))return fallback('B_ADOPTION_CHANGED');
  const {digest,...body}=review;
  if(digest!==dependencyDigest(body))return fallback('DEPENDENCY_PROOF_CORRUPT');
  if(review.status!=='AVAILABLE')return fallback('DEPENDENCY_INDEX_INCOMPLETE');
  if(index.status!=='AVAILABLE'||!same(review.technicalProfiles,index.profiles))return fallback('INCOMPATIBLE_TECHNICAL_RULES_OR_SCOPE');
  if(!same(basis.a.profile,basis.b.profile)||basis.a.question!==run.question
    ||!same(basis.a.implementationVersion,basis.b.implementationVersion))return fallback('INCOMPATIBLE_ANALYSIS_CONDITIONS');
  const newByLogical=new Map();
  for(const m of index.inventory)newByLogical.set(logical(m),[...(newByLogical.get(logical(m))??[]),m]);
  const mapped=new Map(),changed=new Set();
  for(const old of review.inventory) {
    const matches=newByLogical.get(logical(old))??[];
    if(matches.length===1&&same(rawIdentity(old),rawIdentity(matches[0])))mapped.set(old.materialId,matches[0]);
    else changed.add(old.materialId);
  }
  const oldById=new Map(review.inventory.map(m=>[m.materialId,m])),raw=new Map(materials.map(m=>[m.id,m])),signatureMap=new Map(),newKeys=new Map();
  for(const r of index.rows.filter(r=>r.kind==='FACT'))try{
    const signature=index.signature(r);signatureMap.set(signature,[...(signatureMap.get(signature)??[]),r]);
  }catch{/* A missing closure cannot create a mapping. */}
  for(const p of [...graph.candidates,...graph.relations]) {
    const entry=review.entries.find(e=>e.key===p.key),reasons=[];
    if(entry?.dependencies?.some(id=>changed.has(id)))reasons.push('AFFECTED_DEPENDENCY');
    const eligible=['PROVABLE_LOCAL','HISTORICAL_CANDIDATE_ONLY'].includes(entry?.eligibility);
    if(!eligible)reasons.push('UNPROVED_SEMANTIC_BOUNDARY');
    const relation='predicate'in p;
    const endpoint=id=>newKeys.get(id)??(mapped.has(id)&&raw.has(mapped.get(id).materialId)?mapped.get(id).materialId:null);
    if(relation&&(!eligible||!endpoint(p.sourceKey)||!endpoint(p.targetKey)))reasons.push('RELATION_OWN_CONDITIONS_REQUIRE_RECHECK');
    let evidence=[],technicalRefs=[],bindings=[];
    try {
      if(!entry)throw Error('MISSING_DEPENDENCY_BOUNDARY');
      const {proofDigest,...entryBody}=entry;
      if(eligible&&proofDigest!==dependencyDigest(entryBody))throw Error('DEPENDENCY_PROOF_CORRUPT');
      for(const c of p.evidence) {
        const target=mapped.get(c.materialId),m=target&&raw.get(target.materialId);
        if(!target||!m)throw Error('B_SOURCE_MAPPING_OR_READ_UNAVAILABLE');
        const lines=m.text.split(/\r?\n/);
        if(c.endLine>lines.length||!lines.slice(c.startLine-1,c.endLine).join('\n').includes(c.quote))throw Error('B_QUOTE_OR_ANCHOR_CHANGED');
        evidence.push({...c,materialId:m.id});
      }
      if(entry.eligibility==='HISTORICAL_CANDIDATE_ONLY')for(const c of [
        ...entry.proof.assessment.applicabilityEvidence,...entry.proof.assessment.counterexampleEvidence]) {
        const target=mapped.get(c.materialId),m=target&&raw.get(target.materialId);
        if(!m||!validEvidence({...c,materialId:m.id},materials))throw Error('B_CONDITION_OR_COUNTEREXAMPLE_NOT_REBOUND');
        if(!evidence.some(e=>same(e,{...c,materialId:m.id})))evidence.push({...c,materialId:m.id});
      }
      for(const f of entry.factBindings??[]) {
        const matches=signatureMap.get(f.signature)??[];
        if(matches.length!==1)throw Error('B_FACT_PREMISE_MAPPING_NOT_UNIQUE');
        technicalRefs.push(matches[0].id);bindings.push({from:f.id,to:matches[0].id,signature:f.signature});
      }
    } catch(error) {reasons.push(error.message);}
    if(reasons.length) {
      const missing=(p.evidence??[]).map(c=>oldById.get(c.materialId)).filter(Boolean).filter(m=>!newByLogical.has(logical(m)));
      dispositions.push({sourceKey:p.key,status:missing.length?'REMOVED_OR_OUT_OF_SCOPE':'RECHECK',reasons:[...new Set(reasons)]});continue;
    }
    const proof={basisDigest:basis.digest,sourceGraphDigest:graph.digest,sourceInvestigationId:graph.investigationId,
      sourceObjectId:p.id,...(!relation?{sourceCandidateId:p.id}:{}),sourceCollection:relation?'RELATION':'CANDIDATE',
      sourceKey:p.key,sourceProofDigest:entry.proofDigest,semanticDigest:entry.semanticDigest,
      targetInvestigationId:run.id,sourceBundleId:run.sourceInput.sourceBundleSnapshotId,
      adoptedVersionIds:run.adoptedVersionIds,evidence,technicalBindings:bindings,
      qualification:entry.eligibility==='PROVABLE_LOCAL'?'BOUNDED_DECLARATION_REBOUND':'HISTORICAL_HYPOTHESIS_REBOUND',
      dependencyCompleteness:entry.eligibility==='PROVABLE_LOCAL'?'LOCAL_SYNTAX_ONLY':'UNPROVEN',
      currentReviewRequired:true};
    const reuse={...proof,reuseProofDigest:dependencyDigest(proof)},newKey='reuse-'+dependencyDigest({basis:basis.digest,source:p.id});
    const proposal={key:newKey,proposalCollection:relation?'RELATION':'CANDIDATE',
      ...(relation?{predicate:p.predicate,sourceKey:endpoint(p.sourceKey),targetKey:endpoint(p.targetKey)}
        :{kind:p.kind,name:p.name,statement:p.statement,dependencyScope:p.dependencyScope??null}),scope:p.scope,
      uncertainties:[],evidence,technicalRefs,originRefs:[newKey],identityIssues:[],consolidationIssues:[],
      provenance:{kind:'REVALIDATED_REUSE',producer:entry.producer,sourceGraphDigest:graph.digest,sourceKey:p.key,
        originalRefs:entry.originalRefs,reuseProofDigest:reuse.reuseProofDigest},reuse};
    // Re-derive the positive bounded proof against B, not just matching hashes.
    if(entry.eligibility==='PROVABLE_LOCAL'&&!localProof(proposal,materials,index)) {dispositions.push({sourceKey:p.key,status:'RECHECK',reasons:['B_LOCAL_BOUNDARY_NOT_PROVED']});continue;}
    (relation?relations:candidates).push(proposal);newKeys.set(p.key,newKey);
    proofs.push(reuse);dispositions.push({sourceKey:p.key,targetKey:newKey,status:'HISTORICAL_CANDIDATE_PENDING_B_REVIEW',reasons:[]});
    originalProposals.push({id:newKey,origin:proposal.provenance,proposal:structuredClone(proposal)});
  }
  if(index.status!=='AVAILABLE') {
    candidates.length=relations.length=originalProposals.length=proofs.length=0;
    return fallback('DEPENDENCY_INDEX_INCOMPLETE');
  }
  const mode=proofs.length?'INCREMENTAL_A_TO_B':'FULL_B_FALLBACK';
  return {mode,basisDigest:basis.digest,dispositions,reasons:proofs.length?[]:['NO_PROVABLE_REUSE'],candidates,relations,originalProposals,proofs,
    reusedSemanticResultDigest:proofs.length?dependencyDigest(proofs):null};
}

// B source ids are re-created from actual bundle/component/path/digest rows.
export function inventoryMaterial(workspaceId,bundleId,row) {
  const source={workspaceId,bundleId,componentId:row.component_id,pathBytes:row.entry.pathBytes,contentDigest:row.disposition?.digest??null};
  return {sourceId:row.source_id,componentId:row.component_id,pathBytes:row.entry.pathBytes,kind:row.entry.kind,
    sizeBytes:row.disposition?.sizeBytes??row.entry.sizeBytes,disposition:row.disposition?.disposition??'PENDING',
    reasonCode:row.disposition?.reasonCode??'UNKNOWN',contentDigest:source.contentDigest,
    materialId:source.contentDigest?structureDigest('material',source):null};
}

// Current validity is intentionally separate from historical transport.
// A generic SUPPORTED/complete=true cannot discharge an unproved boundary.
export function guardHistoricalReview(proposal,review,{materials,fullScopeRechecked}) {
  if(proposal.reuse?.qualification!=='HISTORICAL_HYPOTHESIS_REBOUND')return review;
  const checked=review&&positiveBoundary({...proposal,verification:review},materials);
  if(fullScopeRechecked&&checked)return review;
  return {...review,support:'UNKNOWN',dependencyGuard:{code:fullScopeRechecked?'CURRENT_BOUNDARY_UNRESOLVED':'FULL_B_COUNTEREXAMPLE_SCOPE_INCOMPLETE',
    originalReview:structuredClone(review??null)}};
}

export function historicalRecheckContext(continuation,rebound,index,materials=null,maxBytes=8192) {
  if(!continuation)return null;
  const graph=continuation.graph,review=graph.dependencyReview,selected=materials&&new Set(materials.map(m=>m.id));
  const current=new Map(index.inventory.map(m=>[logical(m),m.materialId]));
  const endpoint=k=>{const p=graph.candidates.find(p=>p.key===k);return p?{key:k,name:p.name,statement:p.statement}
    :{key:k,kind:'HISTORICAL_MATERIAL'};};
  const all=[...graph.candidates,...graph.relations].filter(p=>!rebound?.proofs.some(r=>r.sourceKey===p.key)).map(p=>{
    const e=review?.entries.find(e=>e.key===p.key),dependencies=e?.dependencies??[];
    const currentMaterialIds=[...new Set(dependencies.flatMap(id=>{
      const old=review.inventory.find(m=>m.materialId===id);return old&&current.has(logical(old))?[current.get(logical(old))]:[];
    }))].filter(Boolean);
    return {sourceKey:p.key,sourceGraphDigest:graph.digest,
      ...('predicate'in p?{predicate:p.predicate,sourceEndpoint:endpoint(p.sourceKey),targetEndpoint:endpoint(p.targetKey)}
        :{kind:p.kind,name:p.name,statement:p.statement}),scope:p.scope,currentMaterialIds,
      disposition:rebound?.dispositions.find(d=>d.sourceKey===p.key)?.status??'RECHECK',
      dependencyCompleteness:'UNPROVEN',authority:'HISTORICAL_HYPOTHESIS_NOT_B_EVIDENCE'};
  }).filter(p=>!selected||!p.currentMaterialIds.length||p.currentMaterialIds.some(id=>selected.has(id)));
  const result={authority:'HISTORICAL_COMPARISON_NOT_CURRENT_EVIDENCE',items:[],coverage:{total:all.length,supplied:0,pending:all.length,digest:dependencyDigest(all)},
    rules:['Re-investigate these old positive/conditional propositions against actual supplied B source and closed technical references.',
      'Old ids, old authority and old conditions are NOT B citations. Missing scope, dependencies or history stays unresolved.']};
  for(const item of all) {
    result.items.push(item);result.coverage.supplied=result.items.length;result.coverage.pending=all.length-result.items.length;
    if(Buffer.byteLength(JSON.stringify(result))>maxBytes) {
      result.items.pop();result.coverage.supplied=result.items.length;result.coverage.pending=all.length-result.items.length;break;
    }
  }
  return result;
}
