import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain/index.js';
import { SourceSnapshotReader } from '../source-truth/admission-service.js';
import { structureDigest } from '../source-truth/identity.js';
import { queryBusinessGraph, traceBusinessGraph, businessSevenQuestions } from './queries.js';
import { requireF003 } from './errors.js';

const keyValid = k => typeof k === 'string' && k.length > 0 && k.length <= 256;
const graphIdentity = (v, technicalVersions) => ({ graphRevisionId:v.publication.graphRevisionId,
  graphDigest:v.graph.digest, sourceInput:v.publication.binding.sourceInput, profileId:v.graph.profileId,
  adoptedVersionIds:v.graph.adoptedVersionIds, technicalVersions, published:true,canonicalAnalysisPublished:v.graph.published,
  publicationState:'PUBLISHED' });
export function executionStatus(targets) {
  if (!targets.length) return 'NOT_RUN';
  // A known current failure remains a failure, but obsolete receipts cannot
  // establish either current success or failure. Never shrink the explicit
  // obligation set to a passing subset when a Claim/Feature/scope expires.
  if (targets.some(e=>e.mappingCurrent===true && e.status==='FAIL')) return 'FAIL';
  if (targets.some(e=>e.mappingCurrent!==true)) return 'UNKNOWN';
  return targets.every(e=>e.status==='PASS')?'PASS':targets.every(e=>e.status==='NOT_RUN')?'NOT_RUN':'UNKNOWN';
}
function dimensions(record) {
  const targets=record.currentAuthority.targets;
  const conflicts=[...(record.consolidationIssues??[]),...(record.verification?.unresolvedConflicts??[])];
  return {authority:{status:record.currentAuthority.status,objectAuthority:'NOT_ESTABLISHED_BY_MAPPING'},
    conformance:{status:'UNKNOWN',reason:'NO_INDEPENDENT_IMPLEMENTATION_CONFORMANCE_ASSESSMENT'},
    verification:{status:executionStatus(record.currentExecution.targets),scope:'EXACT_MAPPED_TESTSPEC_AND_ENVIRONMENT_ONLY'},
    freshness:{status:targets.some(t=>!t.authority.versionCurrent || !t.authority.scopeActive)?'STALE':'UNKNOWN',
      reason:'FROZEN_REFERENCE_IS_NOT_A_CLAIM_OF_LATEST_OR_CURRENT_FRESHNESS'},
    conflict:{status:conflicts.length?'UNRESOLVED':'UNKNOWN',recordedConflicts:conflicts}};
}
function currentView(p) {
  const targets=p.projection.targets;
  const confirmedTargets=targets.filter(t=>t.authority.applies && t.authority.status==='CONFIRMED');
  return {
    currentAuthority:{objectAuthority:'NOT_ESTABLISHED_BY_MAPPING', bindingVersion:p.currentBindingVersion,
      status:!targets.length?'UNMAPPED':confirmedTargets.length===targets.length?'BOUND_TARGETS_CONFIRMED'
        :confirmedTargets.length?'PARTIALLY_CONFIRMED':'NO_CURRENT_CONFIRMATION',
      confirmedTargets, targets, evaluatedAt:p.projection.evaluatedAt},
    currentExecution:{targets:targets.flatMap(t=>t.verification.map(v=>({claimId:t.claimId,claimVersion:t.claimVersion,
      scopeId:t.scopeId,scopeVersion:t.scopeVersion,authorityApplies:t.authority.applies,
      mappingCurrent:t.authority.scopeActive && t.authority.versionCurrent,...v})))},
  };
}

export class F003PublishedReadService {
  constructor({sources,admission,publications,authorityBindings}) {
    Object.assign(this,{sources,publications,authorityBindings});
    // SnapshotReader deliberately does not renew consent, qualify an analysis,
    // or write MATERIAL_READ_* audit records while answering a pure GET.
    this.reader=new SourceSnapshotReader(sources,admission.candidates);
  }
  async #binding(tx,actor,workspaceId,version) {
    const {graph,publication}=version,b=publication.binding;
    requireF003(graph.workspaceId===workspaceId && graph.sourceBundleId===b.sourceInput.sourceBundleSnapshotId
      && graph.profileId===b.profileId && canonicalJson(graph.adoptedVersionIds)===canonicalJson(b.adoptedVersionIds),
    'F003_VERSION_CORRUPT','发布图谱来源、采用版本或配置不一致');
    const reference={bundleId:b.sourceInput.sourceBundleSnapshotId,receiptId:b.sourceInput.receiptId};
    const records=await this.reader.records(actor,workspaceId,reference,tx);
    const componentIds=new Set(records.bundle.payload.components.map(c=>c.id));
    requireF003(graph.materials.every(m=>m.sourceMaterial?.workspaceId===workspaceId
      && m.sourceMaterial.bundleId===reference.bundleId && componentIds.has(m.sourceMaterial.componentId)
      && (!m.receiptId || m.receiptId===reference.receiptId)), 'F003_VERSION_CORRUPT','材料定位不属于图谱冻结来源');
    const technicalVersions=[];
    for(const id of graph.adoptedVersionIds) {
      const row=(await tx.query(`SELECT f.profile_id,f.record_digest,r.source_input FROM f002_fact_set f
        JOIN f002_run r ON r.workspace_id=f.workspace_id AND r.id=f.run_id
        WHERE f.workspace_id=$1 AND f.graph_version_id=$2`,[workspaceId,id])).rows[0];
      // Each consumer was separately admitted, so qualifiedAt is intentionally
      // different. Compare immutable source identity, never admission time or
      // current/latest profile eligibility.
      const sourceKeys=['workspaceId','bundleId','sourceBundleSnapshotId','receiptId','confirmationId','inventoryId',
        'inventoryDigest','policyRevisionId','gapSetId','acceptanceRecordIds'];
      requireF003(row && sourceKeys.every(k=>canonicalJson(row.source_input[k]??null)===canonicalJson(b.sourceInput[k]??null)),
        'F003_TECHNICAL_VERSION_MISMATCH','发布采用的技术证据不属于此精确冻结来源');
      technicalVersions.push({versionId:id,profileId:row.profile_id,recordDigest:row.record_digest});
    }
    return {identity:graphIdentity(version,technicalVersions),reference};
  }
  #read(actor,workspaceId,revisionId,work) {
    return this.publications.withPublishedVersion(actor,workspaceId,revisionId,false,async(tx,version)=>
      work(tx,version,await this.#binding(tx,actor,workspaceId,version)));
  }
  async #decorate(tx,workspaceId,revisionId,version,view,{onlyHumanConfirmed=false}={}) {
    const keys=[...new Set([...view.nodes,...view.edges].filter(o=>o.state!=='QUARANTINED').map(o=>o.key))];
    const projections=await this.authorityBindings.projectManyInVersion(tx,workspaceId,revisionId,version,keys);
    const decorate=o=>{
      const record={...o,...(projections[o.key]?currentView(projections[o.key]):{
        currentAuthority:{objectAuthority:'NOT_ESTABLISHED_BY_MAPPING',status:'QUARANTINED',confirmedTargets:[],targets:[]},currentExecution:{targets:[]}})};
      return {...record,stateDimensions:dimensions(record)};
    };
    let nodes=view.nodes.map(decorate),edges=view.edges.map(decorate);
    if(onlyHumanConfirmed) {
      edges=edges.filter(o=>o.currentAuthority.confirmedTargets.length);
      const endpointKeys=new Set(edges.flatMap(e=>[e.sourceKey,e.targetKey]));
      nodes=nodes.filter(o=>o.currentAuthority.confirmedTargets.length || endpointKeys.has(o.key)).map(o=>({...o,
        selectionRole:o.currentAuthority.confirmedTargets.length?'EXPLICIT_CONFIRMED_TARGETS':'ENDPOINT_CONTEXT_ONLY'}));
      edges=edges.map(o=>({...o,selectionRole:'EXPLICIT_CONFIRMED_TARGETS'}));
    }
    return {...view,nodes,edges,selectionScope:onlyHumanConfirmed?'EXPLICIT_CONFIRMED_TARGETS_ONLY':'ANALYSIS_WITH_CURRENT_PROJECTION'};
  }
  graph(actor,workspaceId,revisionId,options={}) {
    return this.#read(actor,workspaceId,revisionId,async(tx,version,{identity})=>{
      const view=queryBusinessGraph(version.graph,{...options,includeUncertain:options.onlyHumanConfirmed || options.includeUncertain,onlyHumanConfirmed:false});
      return {...await this.#decorate(tx,workspaceId,revisionId,version,view,options),...identity};
    });
  }
  #trace(graph,options) {
    const relation=options.key && graph.relations.find(r=>r.key===options.key);
    if(!relation) return traceBusinessGraph(graph,options);
    requireF003(!options.materialId,'F003_QUERY_INVALID','请选择一个图谱对象或材料',{status:422});
    const endpoints=new Set([relation.sourceKey,relation.targetKey]);
    const nodes=graph.candidates.filter(n=>endpoints.has(n.key));
    const materials=new Set([...nodes,relation].flatMap(n=>n.evidence.map(e=>e.materialId)));
    for(const k of endpoints) if(graph.materials.some(m=>m.id===k)) materials.add(k);
    return {graphId:graph.id,graphDigest:graph.digest,direction:'RELATION_TO_ENDPOINTS_AND_MATERIAL',
      relationKey:relation.key,nodes,edges:[relation],materials:graph.materials.filter(m=>materials.has(m.id))};
  }
  trace(actor,workspaceId,revisionId,options) {
    return this.#read(actor,workspaceId,revisionId,async(tx,version,{identity})=>
      ({...await this.#decorate(tx,workspaceId,revisionId,version,this.#trace(version.graph,options)),...identity}));
  }
  sevenQuestions(actor,workspaceId,revisionId,key) {
    return this.#read(actor,workspaceId,revisionId,async(tx,version,{identity})=>{
      requireF003(keyValid(key),'F003_QUERY_INVALID','请选择精确对象',{status:422});
      const trace=await this.#decorate(tx,workspaceId,revisionId,version,this.#trace(version.graph,{key}));
      const relation=version.graph.relations.find(r=>r.key===key);
      const answer=relation ? {authority:'DERIVED_VIEW',key,sections:[
        {question:'关系及有向端点',nodes:trace.nodes,relations:trace.edges},
        {question:'关系适用范围',scope:relation.scope},
        {question:'关系的原材料依据',materials:trace.materials,relations:trace.edges},
        {question:'业务端点',nodes:trace.nodes},
        {question:'独立真实执行'}, {question:'版本和环境'}, {question:'依据与缺口',evidence:relation.evidence,uncertainties:relation.uncertainties},
      ]} : businessSevenQuestions(version.graph,key);
      const execution=trace.nodes.concat(trace.edges).flatMap(o=>o.currentExecution.targets.map(t=>({objectKey:o.key,...t})));
      // Human approval and execution are independent axes. A trusted TestSpec
      // receipt is not erased merely because nobody confirmed the business
      // Claim, and a neighbour's PASS is not this object's execution proof.
      const selectedExecution=execution.filter(e=>e.objectKey===key);
      const status=executionStatus(selectedExecution);
      answer.sections[4]={...answer.sections[4],executionStatus:status,executionTargets:execution,
        rule:'CURRENT_EXACT_MAPPED_TESTSPEC_VERSION_SNAPSHOT_ENVIRONMENT_ONLY'};
      answer.sections[5]={...answer.sections[5],...identity,environmentStatus:execution.length?'EXPLICIT_EXECUTION_TARGETS':'UNKNOWN',
        environments:execution.map(e=>({objectKey:e.objectKey,snapshotManifestId:e.snapshotManifestId,deploymentId:e.deploymentId}))};
      return {...answer,...identity,currentProjection:{nodes:trace.nodes,edges:trace.edges},
        stateDimensions:trace.nodes.concat(trace.edges).find(o=>o.key===key)?.stateDimensions??null};
    });
  }
  materials(actor,workspaceId,revisionId) {
    return this.#read(actor,workspaceId,revisionId,async(_tx,{graph},{identity})=>({...identity,materials:graph.materials,coverage:graph.coverage}));
  }
  async material(actor,workspaceId,revisionId,id) {
    requireF003(keyValid(id),'F003_QUERY_INVALID','材料定位无效',{status:422});
    const selected=await this.#read(actor,workspaceId,revisionId,async(_tx,{graph},binding)=>{
      const material=graph.materials.find(m=>m.id===id);
      requireF003(material,'F003_OBJECT_NOT_FOUND','材料不属于此精确图谱',{status:404});
      return {...binding,material};
    });
    const locator={componentId:selected.material.sourceMaterial.componentId,pathBytes:selected.material.sourceMaterial.pathBytes};
    const page=await this.reader.inventory(actor,workspaceId,selected.reference,{...locator,limit:1}),item=page.items[0];
    requireF003(item?.componentId===locator.componentId && item.entry.pathBytes===locator.pathBytes
      && item.disposition?.digest===selected.material.sourceMaterial.contentDigest,
    'F003_VERSION_CORRUPT','原材料摘要与冻结图谱不符');
    const maxBytes=8*1024*1024;
    requireF003(/^\d+$/.test(item.disposition.sizeBytes??'') && BigInt(item.disposition.sizeBytes)<=BigInt(maxBytes),
      'F003_MATERIAL_READ_LIMIT','材料超过8MiB有界读取限制',{status:413});
    const chunks=[],hash=createHash('sha256');let size=0;
    for await(const chunk of this.reader.readFile(actor,workspaceId,selected.reference,locator)) {
      size+=chunk.length;requireF003(size<=maxBytes,'F003_MATERIAL_READ_LIMIT','材料超过读取限制',{status:413});
      chunks.push(Buffer.from(chunk));hash.update(chunk);
    }
    const originalDigest=hash.digest('hex');
    const sourceMaterial={workspaceId,bundleId:selected.reference.bundleId,...locator,contentDigest:originalDigest};
    requireF003(String(size)===item.disposition.sizeBytes && originalDigest===item.disposition.digest
      && structureDigest('material',sourceMaterial)===id,'F003_VERSION_CORRUPT','原文字节长度或身份校验失败');
    // Never hold the Workspace lock while opening another F001 reader lock.
    // Return no buffered bytes until the final current ACL + restore fence.
    await this.#read(actor,workspaceId,revisionId,async(_tx,_v,{identity})=>{
      requireF003(identity.graphDigest===selected.identity.graphDigest,'F003_GRAPH_CONFLICT','图谱修订不一致');
    });
    return {bytes:Buffer.concat(chunks,size),originalDigest,sourceMaterial:{...sourceMaterial,id},...selected.identity};
  }
}
