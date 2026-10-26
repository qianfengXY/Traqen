import type {PublishedVersion, ProjectedTarget,VerificationProjection} from './authority-types.ts';
import type {BusinessGraph, GraphFilter, GraphMaterial, Proposition, SevenQuestions, Trace} from './types.ts';
import {sameList, workId} from './work-types.ts';

export type CurrentPublishedProjection = {
  currentAuthority: {objectAuthority:string;status:string;confirmedTargets:ProjectedTarget[];targets:ProjectedTarget[];bindingVersion?:number};
  currentExecution: {targets:PublishedExecutionTarget[];[key:string]:unknown};
  stateDimensions: Record<'authority'|'conformance'|'verification'|'freshness'|'conflict',{status:string;[key:string]:unknown}>;
  selectionRole?: 'ENDPOINT_CONTEXT_ONLY'|'EXPLICIT_CONFIRMED_TARGETS';
};
export type PublishedExecutionTarget=VerificationProjection&{objectKey?:string;claimId:string;claimVersion:number;scopeId:string;scopeVersion:number;authorityApplies:boolean;mappingCurrent:boolean};
export type PublishedGraph = Omit<BusinessGraph,'nodes'|'edges'> & {graphRevisionId:string;nodes:(Proposition&CurrentPublishedProjection)[];edges:(Proposition&CurrentPublishedProjection)[];selectionScope?:string};
export type PublishedTrace = Omit<Trace,'direction'> & {graphRevisionId:string;direction:string;nodes:(Proposition&CurrentPublishedProjection)[];edges:(Proposition&CurrentPublishedProjection)[]};
export type PublishedSeven = SevenQuestions & {graphRevisionId:string;currentProjection:{nodes:PublishedTrace['nodes'];edges:PublishedTrace['edges']};stateDimensions:CurrentPublishedProjection['stateDimensions']|null};
type Json = <T>(path:string)=>Promise<T>;
type Raw = (path:string)=>Promise<{response:Response;signal:AbortSignal}>;
type Bytes = (response:Response,signal:AbortSignal,max:number)=>Promise<Uint8Array>;
const invalid=()=>Object.assign(new Error('响应与选定发布版本、对象或原材料不符，未更新内容。'),{code:'F003_RESPONSE_INVALID',status:0});
const key=(v:string)=>{if(!workId(v))throw invalid();return encodeURIComponent(v);};
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function projected(o:Proposition&CurrentPublishedProjection){
  return !!o&&typeof o.key==='string'&&typeof o.scope==='string'&&typeof o.state==='string'
    &&Array.isArray(o.evidence)&&Array.isArray(o.uncertainties)&&Array.isArray(o.technicalRefs)
    &&!!o.currentAuthority&&Array.isArray(o.currentAuthority.targets)&&Array.isArray(o.currentAuthority.confirmedTargets)
    &&o.currentAuthority.targets.length<=200&&o.currentAuthority.confirmedTargets.length<=o.currentAuthority.targets.length
    &&!!o.currentExecution&&Array.isArray(o.currentExecution.targets)&&!!o.stateDimensions
    &&['authority','conformance','verification','freshness','conflict'].every(k=>typeof o.stateDimensions[k as keyof typeof o.stateDimensions]?.status==='string');
}

// All identities come from the already verified immutable publication, never
// the current head or an investigation permission. Network primitives are shared
// with the bounded Cookie/CSRF transport; no private-read fallback exists here.
export class PublishedReadClient {
  private root:string;
  private fixed:{revision:string;digest:string;bundle:string;receipt:string;profile:string;versions:string[];investigation:string};
  private workspace:string;
  private json:Json;
  private raw:Raw;
  private readBytes:Bytes;
  constructor(workspace:string,version:PublishedVersion,json:Json,raw:Raw,readBytes:Bytes){
    this.workspace=workspace;this.json=json;this.raw=raw;this.readBytes=readBytes;
    const p=version.publication,b=p.binding;
    if(p.workspaceId!==workspace||!workId(p.graphRevisionId)||!hash(p.graphDigest)||!hash(b.sourceInput.sourceBundleSnapshotId)||!workId(b.sourceInput.receiptId))throw invalid();
    this.root=`versions/${key(p.graphRevisionId)}/`;
    this.fixed={revision:p.graphRevisionId,digest:p.graphDigest,bundle:b.sourceInput.sourceBundleSnapshotId,receipt:b.sourceInput.receiptId,profile:b.profileId,versions:[...b.adoptedVersionIds],investigation:p.investigationId};
  }
  private identity<T>(value:T):T {
    const v=value as T&{graphRevisionId:string;graphDigest:string;investigationId:string;sourceBundleId?:string;sourceInput:{sourceBundleSnapshotId:string;receiptId:string;workspaceId?:string};profileId:string;adoptedVersionIds:string[];technicalVersions:{versionId:string;profileId:string;recordDigest:string}[];publicationState:string;published:boolean};
    const f=this.fixed;
    if(!v||v.graphRevisionId!==f.revision||v.graphDigest!==f.digest||(v.investigationId!==undefined&&v.investigationId!==f.investigation)||(v.sourceBundleId!==undefined&&v.sourceBundleId!==f.bundle)||v.sourceInput?.sourceBundleSnapshotId!==f.bundle||v.sourceInput.receiptId!==f.receipt
      ||(v.sourceInput.workspaceId!==undefined&&v.sourceInput.workspaceId!==this.workspace)||v.profileId!==f.profile||!sameList(v.adoptedVersionIds,f.versions)
      ||v.publicationState!=='PUBLISHED'||v.published!==true||!Array.isArray(v.technicalVersions)||!sameList(v.technicalVersions.map(t=>t.versionId),f.versions)
      ||v.technicalVersions.some(t=>!t||!workId(t.profileId)||!hash(t.recordDigest)))throw invalid();
    return value;
  }
  private materialsValid(materials:GraphMaterial[]){
    const f=this.fixed;
    return Array.isArray(materials)&&materials.length<=100000&&new Set(materials.map(m=>m?.id)).size===materials.length
      &&materials.every(m=>m&&workId(m.id)&&m.sourceMaterial?.workspaceId===this.workspace&&m.sourceMaterial.bundleId===f.bundle&&hash(m.sourceMaterial.contentDigest)
        &&typeof m.sourceMaterial.pathBytes==='string'&&(m.receiptId===null||m.receiptId===f.receipt));
  }
  async graph(filter:GraphFilter){
    const q=new URLSearchParams({view:filter.view,text:filter.text??'',includeUncertain:String(filter.includeUncertain??false),onlyHumanConfirmed:String(filter.onlyHumanConfirmed??false)});
    if(filter.kind)q.set('kind',filter.kind);
    const g=this.identity((await this.json<{graph:PublishedGraph}>(`${this.root}graph?${q}`)).graph);
    if(g.view!==filter.view||!Array.isArray(g.nodes)||!Array.isArray(g.edges)||g.nodes.length+g.edges.length>100000||![...g.nodes,...g.edges].every(projected)
      ||!this.materialsValid(g.materials)||!Array.isArray(g.coverage))throw invalid();
    return g;
  }
  async trace(target:{key:string}|{materialId:string}){
    const v=this.identity((await this.json<{trace:PublishedTrace}>(`${this.root}trace?${new URLSearchParams(target)}`)).trace);
    if(!Array.isArray(v.nodes)||!Array.isArray(v.edges)||![...v.nodes,...v.edges].every(projected)||!this.materialsValid(v.materials))throw invalid();
    if('key' in target&&![...v.nodes,...v.edges].some(o=>o.key===target.key))throw invalid();
    if('materialId' in target&&!v.materials.some(m=>m.id===target.materialId))throw invalid();
    return v;
  }
  async sevenQuestions(objectKey:string){
    const v=this.identity((await this.json<{answer:PublishedSeven}>(`${this.root}seven-questions?${new URLSearchParams({key:objectKey})}`)).answer);
    if(v.key!==objectKey||v.authority!=='DERIVED_VIEW'||!Array.isArray(v.sections)||v.sections.length!==7||!v.currentProjection||!Array.isArray(v.currentProjection.nodes)||!Array.isArray(v.currentProjection.edges)
      ||![...v.currentProjection.nodes,...v.currentProjection.edges].every(projected))throw invalid();return v;
  }
  async materials(){
    const v=this.identity(await this.json<{materials:GraphMaterial[];coverage:BusinessGraph['coverage']}>(`${this.root}materials`));
    if(!this.materialsValid(v.materials)||!Array.isArray(v.coverage))throw invalid();return v;
  }
  async material(material:GraphMaterial){
    if(!this.materialsValid([material]))throw invalid();
    const {response,signal}=await this.raw(`${this.root}materials/${key(material.id)}`),f=this.fixed;
    const expected={'x-source-material-ref':material.id,'x-original-sha256':material.sourceMaterial.contentDigest,'x-graph-revision-id':f.revision,'x-graph-digest':f.digest,'x-source-bundle-id':f.bundle,'x-source-receipt-id':f.receipt};
    if(response.headers.get('content-type')?.split(';')[0].trim()!=='application/octet-stream'||Object.entries(expected).some(([k,v])=>response.headers.get(k)!==v)){
      void response.body?.cancel().catch(()=>{});throw invalid();
    }
    const bytes=await this.readBytes(response,signal,8*1024*1024);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),b=>b.toString(16).padStart(2,'0')).join('');
    signal.throwIfAborted();if(digest!==material.sourceMaterial.contentDigest)throw invalid();
    let text:string|null=null;try{if(!bytes.includes(0))text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{/* Never execute non-text. */}
    return {text,data:bytes,bytes:bytes.byteLength,digest};
  }
}
