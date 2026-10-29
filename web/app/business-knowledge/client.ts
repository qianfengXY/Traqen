import { sessionFetch, notifySessionLoss } from "../auth-client.ts";
import type { ExecutionProfile } from "../product-foundation-client.ts";
import type { BusinessGraph, GraphFilter, GraphIdentity, GraphMaterial, Investigation, InvestigationEvent, PublicationBinding, PublicationHead, PublicationReadiness, SevenQuestions, StartInvestigation, TaskEvidence, Trace } from "./types.ts";
import {authorityMatches,bindingMatches,mappedTargetsMatch,publicationMatches} from "./authority-types.ts";
import type {AuthorityFixed,AuthorityResponse,BindingInput,BindingSet,Publication,PublishedVersion} from "./authority-types.ts";
import {WorkSessionClient} from './work-client.ts';
import {GovernanceClient} from './governance-client.ts';
import {PublishedReadClient} from './published-client.ts';
import type {SourceOverview,FrozenVersion,Page} from '../source-truth/types.ts';
import type {FactsOverview} from '../deterministic-facts/types.ts';
type FixedGraph = Pick<GraphIdentity,"graphDigest"|"sourceBundleId"|"profileId">;

export class BusinessKnowledgeError extends Error {
  code: string; status: number; requestId: string | null;
  missing: string[] = [];
  constructor(message: string, code = "F003_NETWORK_UNCONFIRMED", status = 0, requestId: string | null = null) {
    super(message); this.name = "BusinessKnowledgeError"; this.code = code; this.status = status; this.requestId = requestId;
  }
}
const invalid = () => new BusinessKnowledgeError("响应与固定工作区或调查不符，未替换当前内容。", "F003_RESPONSE_INVALID");
const segment = (id: string) => {
  if (!id || [".",".."].includes(id) || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) throw invalid();
  return encodeURIComponent(id);
};

async function boundedBytes(response: Response, signal: AbortSignal, maxBytes: number) {
  if (!response.body) throw invalid();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once:true });
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) throw new BusinessKnowledgeError("响应超过读取上限；不会展示局部正文。", "F003_MATERIAL_TOO_LARGE");
      chunks.push(part.value);
    }
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export class BusinessKnowledgeClient {
  readonly workspaceId: string;
  readonly signal?: AbortSignal;
  private apiBase: string;
  private base: string;
  constructor(apiBase: string, workspaceId: string, signal?: AbortSignal) {
    this.apiBase = apiBase.replace(/\/$/, ""); this.workspaceId = workspaceId; this.signal = signal;
    this.base = `${this.apiBase}/v1/workspaces/${segment(workspaceId)}/business-knowledge/investigations`;
  }
  withSignal(signal: AbortSignal) {
    return new BusinessKnowledgeClient(this.apiBase, this.workspaceId, this.signal ? AbortSignal.any([signal, this.signal]) : signal);
  }
  private async response(url: string, method = "GET", input?: object) {
    const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(this.signal ? [this.signal] : [])]);
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await sessionFetch(url, { method, signal, credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: input === undefined ? {} : { "content-type": "application/json" }, body: input === undefined ? undefined : JSON.stringify(input) }, { inspectUnauthorized:false });
    } catch {
      signal.throwIfAborted();
      throw new BusinessKnowledgeError("连接中断，提交结果未确认；请查询原调查，不会自动重新提交。");
    }
    if (!response.ok) {
      // Preserve the refusal status even if a gateway sends HTML, malformed
      // JSON or an oversized body. Denial bodies are not unbounded originals.
      let result;
      try {
        const bytes = await boundedBytes(response, signal, 64 * 1024);
        if (response.headers.get("content-type")?.split(";")[0].trim() === "application/json") result = JSON.parse(new TextDecoder().decode(bytes));
      } catch { /* A received HTTP refusal remains a refusal even if its body fails or is aborted. */ }
      if (response.status === 401 && !signal.aborted) notifySessionLoss(result?.error);
      const error = new BusinessKnowledgeError(typeof result?.error?.message === "string" ? result.error.message : "业务调查读取未完成", typeof result?.error?.code === "string" ? result.error.code : "F003_HTTP_ERROR",
        response.status, response.headers.get("x-request-id"));
      if(error.code==='F003_SESSION_WRITE_BLOCKED'&&Array.isArray(result?.error?.details?.missing))error.missing=result.error.details.missing.slice(0,100).flatMap((v:unknown)=>{
        const code=typeof v==='string'?v:(v&&typeof v==='object'&&'code' in v?v.code:null);
        return typeof code==='string'&&/^F003_[A-Z0-9_]{1,100}$/.test(code)?[code]:[];
      });
      throw error;
    }
    signal.throwIfAborted();
    return { response, signal };
  }
  private async json<T>(url: string, method = "GET", input?: object, business = true): Promise<T> {
    const { response, signal } = await this.response(url, method, input);
    if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") { await response.body?.cancel(); throw invalid(); }
    let result;
    try { result = JSON.parse(new TextDecoder().decode(await boundedBytes(response, signal, 8 * 1024 * 1024))); }
    catch (error) { signal.throwIfAborted(); if (error instanceof BusinessKnowledgeError) throw error; throw invalid(); }
    signal.throwIfAborted();
    if (!result || typeof result !== "object" || (business && (result.schemaVersion !== 1 || result.workspaceId !== this.workspaceId))) throw invalid();
    return result as T;
  }
  private investigation(result: { investigation: Investigation }, id?: string) {
    if (!result.investigation || result.investigation.workspaceId !== this.workspaceId || !result.investigation.id
      || (id && result.investigation.id !== id)) throw invalid();
    return result.investigation;
  }
  async list() {
    const result = await this.json<{ investigations: Investigation[] }>(`${this.base}?limit=1000`);
    if (!Array.isArray(result.investigations) || result.investigations.some(item => !item.id || item.workspaceId !== this.workspaceId)) throw invalid();
    return result.investigations;
  }
  work(){return new WorkSessionClient(this.workspaceId,<T>(path:string,method='GET',input?:object)=>{
    if(input&&new TextEncoder().encode(JSON.stringify(input)).byteLength>64*1024)throw invalid();
    return this.json<T>(`${this.base.replace(/investigations$/,'')}${path}`,method,input);
  });}
  publishedReads(version:PublishedVersion){
    const root=this.base.replace(/investigations$/,'');
    return new PublishedReadClient(this.workspaceId,version,<T>(path:string)=>this.json<T>(`${root}${path}`),path=>this.response(`${root}${path}`),boundedBytes);
  }
  governance(){return new GovernanceClient(<T>(path:string,method='GET',input?:object)=>{
    if(input&&new TextEncoder().encode(JSON.stringify(input)).byteLength>64*1024)throw invalid();
    return this.json<T>(`${this.apiBase}/v1/projects/${segment(this.workspaceId)}/${path}`,method,input,false);
  });}
  async currentWorkspaceRole(){
    const v=await this.json<SourceOverview>(`${this.apiBase}/v1/workspaces/${segment(this.workspaceId)}/source-truth`,"GET",undefined,false);
    if(!['READ','MAINTAIN'].includes(v.role)||!v.actor?.actorId)throw invalid();return v;
  }
  async sourceBundles(cursor?:string){
    const q=new URLSearchParams({limit:'50'});if(cursor)q.set('cursor',cursor);
    const v=await this.json<Page<FrozenVersion>>(`${this.apiBase}/v1/workspaces/${segment(this.workspaceId)}/source-truth/history/bundles?${q}`,"GET",undefined,false);
    if(!Array.isArray(v.items)||v.items.length>50||v.items.some(b=>!b||!/^[a-f0-9]{64}$/.test(b.id)||!Array.isArray(b.components)||(b.latestReceipt&&b.latestReceipt.bundleId!==b.id))
      ||(v.nextCursor!==null&&(typeof v.nextCursor!=='string'||!v.nextCursor||v.nextCursor===cursor)))throw invalid();return v;
  }
  async technicalVersions(){
    const v=await this.json<FactsOverview>(`${this.apiBase}/v1/workspaces/${segment(this.workspaceId)}/deterministic-facts`,"GET",undefined,false);
    if(!Array.isArray(v.versions)||v.versions.some(x=>!x||!/^[a-f0-9]{64}$/.test(x.graphVersionId)||!/^[a-f0-9]{64}$/.test(x.bundleId)))throw invalid();return v.versions;
  }
  async get(id: string) { return this.investigation(await this.json<{ investigation: Investigation }>(`${this.base}/${segment(id)}`), id); }
  async start(input: StartInvestigation) { return this.investigation(await this.json<{ investigation: Investigation }>(this.base, "POST", input)); }
  async control(id: string, action: "pause" | "resume" | "cancel", expectedRevision: number) {
    return this.investigation(await this.json<{ investigation: Investigation }>(`${this.base}/${segment(id)}/${action}`, "POST", { expectedRevision }), id);
  }
  async adopt(id: string, input: { requestId: string; versionId: string; expectedRevision: number }) {
    return this.investigation(await this.json<{ investigation: Investigation }>(`${this.base}/${segment(id)}/adopt-technical-version`, "POST", input), id);
  }
  async events(id: string) {
    const result = await this.json<{ events: InvestigationEvent[] }>(`${this.base}/${segment(id)}/events`);
    if (!Array.isArray(result.events)) throw invalid(); return result.events;
  }
  async taskEvidence(run: Investigation) {
    if (run.workspaceId !== this.workspaceId) throw invalid();
    const query = new URLSearchParams({ expectedRevision: String(run.revision), expectedGraphDigest: run.latestGraph?.digest ?? "" });
    const { taskEvidence: value } = await this.json<{ taskEvidence: TaskEvidence }>(`${this.base}/${segment(run.id)}/task-evidence?${query}`);
    const expected = { workspaceId: this.workspaceId, investigationId: run.id, runRevision: run.revision, runGeneration: run.generation,
      sourceBundleId: run.sourceInput.sourceBundleSnapshotId, receiptId: run.sourceInput.receiptId, profileId: run.profile.id,
      graphDigest: run.latestGraph?.digest ?? null };
    if (value?.version !== 1 || !value.binding || Object.entries(expected).some(([k, v]) => value.binding[k as keyof typeof expected] !== v)
      || value.runState !== run.state || !["SAVED_GRAPH", "CURRENT_CHECKPOINTS", "UNAVAILABLE"].includes(value.snapshotKind)
      || (value.snapshotKind === "SAVED_GRAPH" && (!run.latestGraph || value.snapshotGeneration !== run.latestGraph.generation))
      || !Array.isArray(value.tasks) || !Array.isArray(value.pending) || !Array.isArray(value.missing)
      || typeof value.manifestAvailable !== "boolean" || typeof value.pendingInventoryAvailable !== "boolean"
      || value.tasks.some(t => !t || typeof t.taskKey !== "string" || !["RETURN_RECORDED", "PENDING"].includes(t.status)
        || !Array.isArray(t.sourceRanges) || !Array.isArray(t.obligations) || !Array.isArray(t.propositions) || !Array.isArray(t.crossTaskLeads)
        || t.propositions.some(p => !p || typeof p.key !== "string" || typeof p.state !== "string" || !Array.isArray(p.evidence) || !Array.isArray(p.mappingStatuses)))) throw invalid();
    return value;
  }
  private graphResult<T extends { investigationId: string }>(value: T, id: string, expected?:FixedGraph) {
    if (!value || value.investigationId !== id || (expected&&Object.entries(expected).some(([key,wanted])=>value[key as keyof T]!==wanted))) throw invalid(); return value;
  }
  async graph(id: string, filter: GraphFilter) {
    const query = new URLSearchParams({ view: filter.view, text: filter.text ?? "", includeUncertain: String(filter.includeUncertain ?? false), onlyHumanConfirmed: String(filter.onlyHumanConfirmed ?? false) });
    if (filter.kind) query.set("kind", filter.kind);
    return this.graphResult((await this.json<{ graph: BusinessGraph }>(`${this.base}/${segment(id)}/graph?${query}`)).graph, id);
  }
  async trace(id: string, target: { key: string } | { materialId: string }, expected?:FixedGraph) {
    return this.graphResult((await this.json<{ trace: Trace }>(`${this.base}/${segment(id)}/trace?${new URLSearchParams(target)}`)).trace, id, expected);
  }
  async inspect(id:string,key:string,expected:FixedGraph) {
    // The server's trace/seven-questions key is an object key, not a relation
    // key. Inspect a relation from the exact saved graph instead of issuing an
    // unsupported trace or silently substituting one of its endpoint objects.
    const graph=this.graphResult(await this.graph(id,{view:"IMPLEMENTATION",includeUncertain:true}),id,expected);
    const edge=graph.edges.find(item=>item.key===key);
    if(!edge)return {...await this.trace(id,{key},expected),relation:false};
    const endpoints=new Set([edge.sourceKey,edge.targetKey]);
    const materialIds=new Set([...edge.evidence.map(c=>c.materialId),...graph.materials.filter(m=>endpoints.has(m.id)).map(m=>m.id)]);
    return {...graph,nodes:graph.nodes.filter(n=>endpoints.has(n.key)),edges:[edge],materials:graph.materials.filter(m=>materialIds.has(m.id)),relation:true};
  }
  async sevenQuestions(id: string, key: string, expected?:FixedGraph) {
    const answer = this.graphResult((await this.json<{ answer: SevenQuestions }>(`${this.base}/${segment(id)}/seven-questions?${new URLSearchParams({ key })}`)).answer, id, expected);
    if (answer.key !== key) throw invalid();
    return answer;
  }
  async profiles() {
    const result = await this.json<{ profiles: ExecutionProfile[] }>(`${this.apiBase}/v1/workspaces/${segment(this.workspaceId)}/execution-profile-revisions`, "GET", undefined, false);
    if (!Array.isArray(result.profiles) || result.profiles.some(profile => profile.workspaceId !== this.workspaceId)) throw invalid();
    // This API's producer sorts the actual active head first, not newest timestamp.
    return result.profiles;
  }
  async publicationReadiness(id: string) {
    const result = await this.json<{readiness: PublicationReadiness}>(`${this.base}/${segment(id)}/publication-readiness`);
    const value = result.readiness;
    if (!value || value.binding?.workspaceId !== this.workspaceId || value.binding?.investigationId !== id
      || !["READY", "BLOCKED"].includes(value.status) || typeof value.canPublish !== "boolean" || !Array.isArray(value.missing)
      || (value.currentHead && value.currentHead.projectId !== this.workspaceId)) throw invalid();
    return value;
  }
  async importPublicationEvidence(id: string) {
    const result = await this.json<{binding: PublicationBinding; importedEvidenceRefs: unknown[]; diagnostics: unknown[]}>(`${this.base}/${segment(id)}/import-publication-evidence`, "POST", {});
    if (result.binding?.workspaceId !== this.workspaceId || result.binding?.investigationId !== id) throw invalid();
    return result;
  }
  async publish(id: string, input: {operationId: string; expectedGraphDigest: string; expectedHeadVersion: number}) {
    const result = await this.json<{publication: {workspaceId:string;investigationId:string;graphDigest:string;graphRevisionId:string;headVersion:number}; head: PublicationHead; replayed: boolean}>(`${this.base}/${segment(id)}/publish`, "POST", input);
    const {publication,head,replayed}=result;
    if (publication?.workspaceId!==this.workspaceId || publication.investigationId!==id || publication.graphDigest!==input.expectedGraphDigest
      || publication.headVersion!==input.expectedHeadVersion+1 || !publication.graphRevisionId || head?.projectId!==this.workspaceId
      || !Number.isSafeInteger(head.version) || head.version<publication.headVersion || typeof replayed!=="boolean"
      || (!replayed && head.version!==publication.headVersion)
      || (head.version===publication.headVersion && head.graphRevisionId!==publication.graphRevisionId)) throw invalid();
    return result;
  }
  async currentPublication() {
    const result = await this.json<{head: PublicationHead | null; publication: {workspaceId: string; investigationId: string; graphDigest: string; graphRevisionId: string} | null}>(this.base.replace(/investigations$/, "current"));
    if ((result.head && result.head.projectId !== this.workspaceId) || (result.publication && result.publication.workspaceId !== this.workspaceId)) throw invalid();
    return result;
  }
  async material(id: string, material: GraphMaterial, maxBytes = 8 * 1024 * 1024) {
    const { response, signal } = await this.response(`${this.base}/${segment(id)}/materials/${segment(material.id)}`);
    if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/octet-stream"
      || response.headers.get("x-source-material-ref") !== material.id) { await response.body?.cancel(); throw invalid(); }
    const bytes = await boundedBytes(response, signal, maxBytes);
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    signal.throwIfAborted();
    if (actual !== material.sourceMaterial.contentDigest) throw new BusinessKnowledgeError("原文字节与冻结材料摘要不一致，未展示内容。", "F003_MATERIAL_DIGEST_MISMATCH");
    let text: string | null = null;
    try { if (!bytes.includes(0)) text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* Non-text is not interpreted as HTML or executed. */ }
    return { text, bytes: bytes.byteLength, digest: actual };
  }
  async publishedVersions() {
    const result=await this.json<{versions:Publication[]}>(this.base.replace(/investigations$/,"versions?limit=1000"));
    if(!Array.isArray(result.versions)||result.versions.some(p=>!publicationMatches(p,this.workspaceId)))throw invalid();
    return result.versions;
  }
  async publishedVersion(revision:string,id:string,expected:FixedGraph) {
    const value=await this.json<PublishedVersion>(this.base.replace(/investigations$/,`versions/${segment(revision)}`));
    const p=value.publication,g=value.graph,r=value.revision;
    if(!publicationMatches(p,this.workspaceId)||p.graphRevisionId!==revision||p.investigationId!==id||p.graphDigest!==expected.graphDigest
      ||p.binding.sourceInput.sourceBundleSnapshotId!==expected.sourceBundleId||p.binding.profileId!==expected.profileId
      ||r?.id!==revision||r.projectId!==this.workspaceId||r.status!=="PUBLISHED"||r.analysisRunId!==id||r.graphArtifactDigest!==p.graphDigest
      ||g?.digest!==expected.graphDigest||g.sourceBundleId!==expected.sourceBundleId||g.profileId!==expected.profileId
      ||!Array.isArray(g.candidates)||!Array.isArray(g.relations)||JSON.stringify(g.adoptedVersionIds)!==JSON.stringify(p.binding.adoptedVersionIds))throw invalid();
    return value;
  }
  async readPublished(revision:string) {
    const value=await this.json<PublishedVersion>(this.base.replace(/investigations$/,`versions/${segment(revision)}`));
    const p=value.publication,g=value.graph,r=value.revision;
    if(!publicationMatches(p,this.workspaceId)||p.graphRevisionId!==revision||r?.id!==revision||r.projectId!==this.workspaceId
      ||r.status!=="PUBLISHED"||r.analysisRunId!==p.investigationId||r.graphArtifactDigest!==p.graphDigest
      ||g?.digest!==p.graphDigest||g.sourceBundleId!==p.binding.sourceInput.sourceBundleSnapshotId||g.profileId!==p.binding.profileId
      ||JSON.stringify(g.adoptedVersionIds)!==JSON.stringify(p.binding.adoptedVersionIds)
      ||!Array.isArray(g.candidates)||!Array.isArray(g.relations)||g.candidates.length+g.relations.length>100000
      ||[...g.candidates,...g.relations].some(x=>!x||typeof x.key!=="string"||typeof x.scope!=="string"||!Array.isArray(x.evidence)||!Array.isArray(x.uncertainties)||!Array.isArray(x.technicalRefs)))throw invalid();
    return value;
  }
  async authorityBindings(revision:string,key:string,fixed:AuthorityFixed,history?:number) {
    if(history!==undefined&&(!Number.isSafeInteger(history)||history<1))throw invalid();
    const query=new URLSearchParams({objectKey:key});if(history!==undefined)query.set("bindingVersion",String(history));
    const result=await this.json<AuthorityResponse>(this.base.replace(/investigations$/,`versions/${segment(revision)}/authority-bindings?${query}`));
    if(!authorityMatches(result,this.workspaceId,revision,key,fixed,history))throw invalid();
    return result;
  }
  async bindAuthority(revision:string,input:BindingInput,fixed:AuthorityFixed) {
    if(input.expectedGraphDigest!==fixed.graphDigest||new TextEncoder().encode(JSON.stringify(input)).byteLength>64*1024)throw invalid();
    const result=await this.json<{bindingSet:BindingSet;replayed:boolean}>(this.base.replace(/investigations$/,`versions/${segment(revision)}/authority-bindings`),"POST",input);
    const b=result.bindingSet;
    if(!bindingMatches(b,this.workspaceId,revision,input.objectKey,fixed)||b.version!==input.expectedVersion+1
      ||b.rationale!==input.rationale||!mappedTargetsMatch(b.targets,input.targets)||typeof result.replayed!=="boolean")throw invalid();
    return result;
  }
}
