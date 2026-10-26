import { createHash, randomUUID } from "node:crypto";
import { canonicalEncode } from "../source-truth/identity.js";
import { requireF003 } from "./errors.js";
import { technicalSnapshot } from "./technical-evidence.js";
import { loadTechnicalContext } from "./technical-context.js";
import { SourceSnapshotReader } from "../source-truth/admission-service.js";
import { appendWorkRecord, readWorkRecord } from "./work-records.js";
import { analysisContractVersion } from './model-context.js';
import {checkpointRowBytes,checkpointChunkPrefix,readCheckpointDocument,writeCheckpointDocument} from './checkpoint-storage.js';
import {intactBusinessGraph} from './semantic-graph.js';
import {analysisDependencyRows,analysisInventory,deriveContinuationBasis,readAnalysisGraph,intactContinuationBasis,technicalBinding} from './continuation-basis.js';
import {dependencyDigest} from './dependency-review.js';

const iso = value => value ? new Date(value).toISOString() : null;
const key = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const digest = value => createHash("sha256").update("Traqen.F003.v1\0").update(canonicalEncode(value)).digest("hex");
const rowView = row => ({ ...row.payload, id: row.id, workspaceId: row.workspace_id, actorId: row.actor_id,
  operationId: row.operation_id, revision: row.revision, generation: row.generation, state: row.state,
  sourceInput: row.source_input, profile: row.profile, usage: row.usage, workerId: row.worker_id,
  leaseUntil: iso(row.lease_until), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) });
export const investigationRecord = rowView;

function normalizedRequest(input) {
  const fields = ["operationId", "reference", "expectedProfileId", "question", "technicalVersionId", "scope", "budget", "supplementBudget"];
  requireF003(input && typeof input === "object" && Object.keys(input).every(k => fields.includes(k))
    && key(input.operationId) && typeof input.question === "string" && input.question.trim().length > 0 && input.question.length <= 16384
    && typeof input.expectedProfileId === "string" && input.expectedProfileId.length > 0,
  "F003_INPUT_INVALID", "调查请求必须包含操作键、问题和已确认的生效配置，不接受客户端准入结果", { status: 422 });
  const reference = input.reference;
  requireF003(reference && /^[a-f0-9]{64}$/.test(reference.bundleId ?? "") && key(reference.receiptId),
    "F003_INPUT_INVALID", "请选择精确冻结原材料和 Receipt", { status: 422 });
  const components = input.scope?.componentIds;
  requireF003(Array.isArray(components) && components.length > 0 && components.length <= 128
    && components.every(c => typeof c === "string" && /^[a-f0-9]{64}$/.test(c)), "F003_INPUT_INVALID", "调查范围必须为冻结组件", { status: 422 });
  const budget = input.budget, supplement = input.supplementBudget;
  const count = (v, max) => Number.isSafeInteger(v) && v > 0 && v <= max;
  requireF003(budget && count(budget.maxReadBytes, 1024 * 1024 * 1024) && count(budget.maxModelCalls, 1000)
    && Number.isFinite(Date.parse(budget.deadline)) && supplement && count(supplement.maxMaterials, 200000)
    && count(supplement.maxBytes, 1024 * 1024 * 1024) && count(supplement.maxRuleApplications, 100000000)
    && count(supplement.maximumAttempts, 1000) && Number.isFinite(Date.parse(supplement.deadline))
    && Date.parse(supplement.deadline) <= Date.parse(budget.deadline), "F003_INPUT_INVALID", "调查与补证必须具有有界预算及截止", { status: 422 });
  requireF003(input.technicalVersionId === null || (typeof input.technicalVersionId === "string" && /^[a-f0-9]{64}$/.test(input.technicalVersionId)),
    "F003_INPUT_INVALID", "必须明确选择技术证据版本，或明确本次尚未采用", { status: 422 });
  return { operationId: input.operationId, reference: { bundleId: reference.bundleId, receiptId: reference.receiptId },
    expectedProfileId: input.expectedProfileId, question: input.question.trim(), technicalVersionId: input.technicalVersionId,
    scope: { componentIds: [...new Set(components)].sort() },
    budget: { maxReadBytes: budget.maxReadBytes, maxModelCalls: budget.maxModelCalls, deadline: new Date(budget.deadline).toISOString() },
    supplementBudget: { maxMaterials: supplement.maxMaterials, maxBytes: supplement.maxBytes, maxRuleApplications: supplement.maxRuleApplications,
      maximumAttempts: supplement.maximumAttempts, deadline: new Date(supplement.deadline).toISOString() } };
}

function validateProfile(profile, workspaceId) {
  const slots = [profile?.mainAgentSlot, ...(profile?.childAgentSlots ?? [])];
  requireF003(profile?.workspaceId === workspaceId && profile.mainAgentSlot?.role === "MAIN"
    && profile.childAgentSlots?.length >= 1 && profile.childAgentSlots.every(s => s.role === "CHILD")
    && slots.every(s => s?.modelProfileRevisionId && (s.mcpGrants ?? []).length === 0
      && (s.mcpRevisionIds ?? []).length === 0 && profile.entries?.some(e => e.kind === "MODEL" && e.logicalName === s.modelProfileRevisionId
        && e.manifest.transport === "CLI" && typeof e.manifest.model === "string" && e.manifest.model.trim()
        && ["CODEX", "CLAUDE", "GEMINI", "KIMI"].includes(e.manifest.cliAdapter))),
  "F003_PROFILE_UNAVAILABLE", "需要一个 Main、至少一个 Child 及获准 CLI 模型；MCP 执行继续暂停");
}

// Derive each reservation's basis from durable server records, not a caller's
// task-name convention. Replay adoption events so pre-digest reservations also
// remain fenced on their original basis; missing new metadata is not a retry.
function analysisCallContexts(row, events) {
  const bindingDigest = digest({ workspaceId: row.workspace_id, investigationId: row.id,
    requestDigest: row.request_digest, sourceInput: row.source_input, profile: row.profile,
    analysisContractVersion: row.payload.analysisContractVersion,
    implementationVersion: row.payload.implementationVersion ?? null,
    ...(row.payload.continuationBasis?{continuationBasisDigest:row.payload.continuationBasis.digest}:{}) });
  const context = adoptedVersionIds => digest({ bindingDigest, adoptedVersionIds });
  const adopted = row.payload.technicalVersionId === null ? [] : [row.payload.technicalVersionId];
  const byReservation = new Map();
  for (const event of events) {
    if (event.event_type === 'TECHNICAL_VERSION_ADOPTED') adopted.push(event.payload.versionId);
    if (event.event_type === 'MODEL_CALL_RESERVED') {
      const expected = context(adopted);
      requireF003(event.payload.semanticContextDigest === undefined || event.payload.semanticContextDigest === expected,
        'F003_CALL_CONTEXT_UNAVAILABLE', '调用历史与服务端采用事件不一致，不能据此重发');
      byReservation.set(event.payload.id, expected);
    }
  }
  requireF003(canonicalEncode(adopted) === canonicalEncode(row.payload.adoptedVersionIds),
    'F003_CALL_CONTEXT_UNAVAILABLE', '缺少完整采用历史，不能推断调用的新语义依据');
  return { current: context(adopted), byReservation };
}

export class InvestigationService {
  constructor({ sources, sourceAdmission, profiles, implementationVersion = null }) {
    if (!sources?.withWorkspace || !sourceAdmission?.forAdmittedAnalysis || !profiles?.resolveActive || !profiles?.assertUsable) {
      throw new TypeError("F003 requires source authorization, controlled admission and F006 configuration services");
    }
    Object.assign(this, { sources, sourceAdmission, profiles, implementationVersion });
    this.admitted = sourceAdmission.forAdmittedAnalysis((actor, workspaceId, id, tx) => this.sourceBinding(actor, workspaceId, id, tx));
  }

  async #with(actor, workspaceId, id, maintain, work) {
    return this.sources.withWorkspace(actor, workspaceId, maintain, async (tx, access) => {
      requireF003(access.restoreReady, "F003_RESTORE_UNVERIFIED", "材料与数据库恢复尚未完成校验");
      requireF003(!maintain || !access.backupBarrier, "F003_BACKUP_BARRIER", "配套备份期间暂缓调查写入");
      const row = id ? await this.#row(tx, workspaceId, id) : null;
      if (id) this.#member(actor, row);
      return work(tx, row);
    });
  }

  async #questionAdmission(tx,actor,workspaceId,row) {
    if(row.payload.continuationBasis) {
      const basis=row.payload.continuationBasis;
      requireF003(intactContinuationBasis(basis),'F003_CONTINUATION_BASIS_CORRUPT','接续依据不完整，不能执行或提交新语义');
      const a=await this.#row(tx,workspaceId,basis.a.investigationId);
      if(basis.source.kind==='PRIVATE_ANALYSIS')this.#member(actor,a);
      requireF003(a.state==='COMPLETED'&&a.payload.latestGraph?.digest===basis.a.graphDigest,
        'F003_CONTINUATION_SOURCE_MISMATCH','A图谱已不匹配当前接续依据');
      await new SourceSnapshotReader(this.sources,this.sourceAdmission.candidates).records(actor,workspaceId,
        {bundleId:a.source_input.sourceBundleSnapshotId,receiptId:a.source_input.receiptId},tx);
    }
    if(row.payload.purpose==='PUBLISHED_WORK_CONTINUATION') {
      requireF003(typeof this.questionWriteGuard==='function','F003_SESSION_WRITE_BLOCKED','工作接续须保留原会话写入围栏');
      await this.questionWriteGuard(tx,actor,workspaceId,{graphRevisionId:row.payload.continuationBasis.source.graphRevisionId});
    }
    if(row.payload.purpose !== "GRAPH_QUESTION") return;
    requireF003(typeof this.questionWriteGuard === "function", "F003_SESSION_WRITE_BLOCKED", "问答真实写入核验未配置");
    await this.questionWriteGuard(tx,actor,workspaceId,row.payload.questionContext);
  }

  async #row(tx, workspaceId, id) {
    const row = (await tx.query("SELECT *,clock_timestamp() AS db_now FROM f003_investigation WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, id])).rows[0];
    requireF003(row, "F003_INVESTIGATION_NOT_FOUND", "未找到此调查", { status: 404 });
    return row;
  }

  #member(actor, row) {
    requireF003(row.actor_id === actor.actorId || row.payload.delegateActorIds.includes(actor.actorId),
      "F003_INVESTIGATION_FORBIDDEN", "当前成员未获此调查的委派", { status: 403 });
  }

  #running(row, generation = null) {
    this.#analysisContract(row);
    requireF003(row.state === "RUNNING" && (generation === null || row.generation === generation)
      && row.lease_until && new Date(row.lease_until) > new Date(row.db_now), "F003_STALE_WORKER", "调查已停止、执行世代变化或租约过期");
    requireF003(Date.parse(row.payload.budget.deadline) > new Date(row.db_now).getTime(), "F003_DEADLINE_EXCEEDED", "本次调查已到截止");
  }

  #analysisContract(row) {
    requireF003(row.payload.purpose==='GRAPH_QUESTION'||row.payload.analysisContractVersion===analysisContractVersion,
      'F003_ANALYSIS_CONTRACT_CHANGED','旧调查保留只读；新的任务合同必须明确创建新调查，不能换实现水印重跑旧结果');
  }

  async #event(tx, row, actor, type, payload) {
    await tx.query("INSERT INTO f003_investigation_event (workspace_id,investigation_id,actor_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)",
      [row.workspace_id, row.id, actor.actorId, type, JSON.stringify(payload)]);
  }

  // Internal authenticated analysis entry only. No HTTP route and no supplied
  // trust/basis/measurement flag. The owning admission resolves A itself.
  async startIncremental(actor,workspaceId,input) {
    const {baseInvestigationId,expectedBaseGraphDigest,...request}=input??{};
    requireF003(key(baseInvestigationId)&&/^[a-f0-9]{64}$/.test(expectedBaseGraphDigest??''),
      'F003_INPUT_INVALID','增量分析必须明确已完成A及精确图谱摘要',{status:422});
    return this.start(actor,workspaceId,request,{continuationSource:{kind:'PRIVATE_ANALYSIS',
      investigationId:baseInvestigationId,graphDigest:expectedBaseGraphDigest}});
  }

  async start(actor, workspaceId, input, { questionContext = null, onAdmit = null, continuationSource = null } = {}) {
    requireF003(questionContext === null || (typeof onAdmit === "function" && typeof this.questionWriteGuard === "function"),
      "F003_SESSION_WRITE_BLOCKED", "派生问答必须经过服务端会话准入");
    const request = normalizedRequest(input), requestDigest = digest(continuationSource?{request,continuationSource}:request);
    const prior = await this.#with(actor, workspaceId, null, true, async tx =>
      (await tx.query("SELECT * FROM f003_investigation WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3", [workspaceId, actor.actorId, request.operationId])).rows[0]);
    if (prior) {
      requireF003(prior.request_digest === requestDigest, "F003_OPERATION_CONFLICT", "此操作键已经绑定另一份调查请求");
      return this.get(actor, workspaceId, prior.id);
    }
    // Qualification checks the whole frozen source, including integrity. The
    // qualified server-clock decision is persisted, not accepted from HTTP.
    const sourceInput = await this.sourceAdmission.qualify(actor, workspaceId, request.reference);
    requireF003(request.scope.componentIds.every(c => sourceInput.components.some(v => v.componentSnapshotId === c)),
      "F003_SCOPE_MISMATCH", "调查组件不属于此原材料版本", { status: 422 });
    return this.#with(actor, workspaceId, null, true, async tx => {
      const existing = (await tx.query("SELECT * FROM f003_investigation WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3", [workspaceId, actor.actorId, request.operationId])).rows[0];
      if (existing) {
        requireF003(existing.request_digest === requestDigest, "F003_OPERATION_CONFLICT", "操作键冲突");
        return rowView(existing);
      }
      const profile = await this.profiles.resolveActive(actor, workspaceId, tx);
      requireF003(profile?.id === request.expectedProfileId, "F003_PROFILE_CONFLICT", "生效配置已变化，请保留调查输入并重新确认", { details: { currentProfileId: profile?.id ?? null } });
      validateProfile(profile, workspaceId);
      await this.profiles.assertUsable(actor, workspaceId, profile, tx);
      await this.sourceAdmission.records(actor, workspaceId, request.reference, tx);
      const now = new Date((await tx.query("SELECT clock_timestamp() AS now")).rows[0].now).getTime();
      requireF003(Date.parse(request.budget.deadline) > now && Date.parse(request.supplementBudget.deadline) > now,
        "F003_DEADLINE_EXCEEDED", "调查预算截止已过");
      const technical = request.technicalVersionId === null ? null : await technicalSnapshot(tx, workspaceId, request.technicalVersionId, request.reference.bundleId, request.scope.componentIds);
      if(questionContext) for(const versionId of questionContext.adoptedVersionIds) {
        await technicalSnapshot(tx,workspaceId,versionId,request.reference.bundleId,request.scope.componentIds);
      }
      const payload = { question: request.question, scope: request.scope, budget: request.budget, supplementBudget: request.supplementBudget,
        analysisContractVersion,
        implementationVersion: structuredClone(this.implementationVersion),
        technicalVersionId: request.technicalVersionId, adoptedVersionIds: technical ? [technical.versionId] : [],
        technical, delegateActorIds: [], checkpoints: [] };
      if(questionContext) Object.assign(payload,{purpose:"GRAPH_QUESTION",questionContext:structuredClone(questionContext),
        adoptedVersionIds:[...questionContext.adoptedVersionIds]});
      if(continuationSource) {
        requireF003(!questionContext,'F003_INPUT_INVALID','问答合同不创建增量图谱');
        payload.continuationBasis=await deriveContinuationBasis(tx,{actor,workspaceId,source:continuationSource,
          request,sourceInput,profile,implementationVersion:payload.implementationVersion,sources:this.sources,sourceAdmission:this.sourceAdmission});
        payload.purpose=payload.continuationBasis.purpose;
      }
      const row = (await tx.query(`INSERT INTO f003_investigation (workspace_id,id,actor_id,operation_id,request_digest,state,source_input,profile,payload)
        VALUES ($1,$2,$3,$4,$5,'QUEUED',$6,$7,$8) RETURNING *`, [workspaceId, randomUUID(), actor.actorId, request.operationId, requestDigest,
        JSON.stringify(sourceInput), JSON.stringify(profile), JSON.stringify(payload)])).rows[0];
      if(onAdmit) await onAdmit(tx,rowView(row));
      await this.#event(tx, row, actor, "INVESTIGATION_ADMITTED", { sourceInput, profileId: profile.id, technicalVersionId: request.technicalVersionId });
      return rowView(row);
    });
  }

  get(actor, workspaceId, id) { return this.#with(actor, workspaceId, id, false, async (_tx, row) => rowView(row)); }

  dependencyEvidence(actor,workspaceId,id,{generation,factIds=[],factSelectors=[],localProofMaterialIds=[]}) {
    return this.#with(actor,workspaceId,id,false,async(tx,row)=>{
      this.#running(row,generation);
      const inventory=await analysisInventory(tx,workspaceId,row.source_input,row.payload.scope);
      if(row.payload.continuationBasis
        &&canonicalEncode(row.payload.adoptedVersionIds)===canonicalEncode(row.payload.continuationBasis.b.adoptedVersionIds))
        requireF003(dependencyDigest(await technicalBinding(tx,workspaceId,row.payload.adoptedVersionIds))
          ===dependencyDigest(row.payload.continuationBasis.b.technicalBinding),'F003_CONTINUATION_BASIS_CORRUPT','B技术记录或规则水印不符');
      return {...await analysisDependencyRows(tx,workspaceId,row.source_input,row.payload.scope,row.payload.adoptedVersionIds,
        {factIds,factSelectors,localProofMaterialIds,inventory}),inventory};
    });
  }

  continuationEvidence(actor,workspaceId,id,{generation}) {
    return this.#with(actor,workspaceId,id,false,async(tx,row)=>{
      this.#running(row,generation);
      const basis=row.payload.continuationBasis;
      if(!basis)return null;
      requireF003(intactContinuationBasis(basis)&&basis.workspaceId===workspaceId,
        'F003_CONTINUATION_BASIS_CORRUPT','接续依据完整性不符，不能猜测重建');
      const a=await this.#row(tx,workspaceId,basis.a.investigationId);
      if(basis.source.kind==='PRIVATE_ANALYSIS')this.#member(actor,a);
      else {
        const publication=(await tx.query('SELECT payload FROM f003_publication WHERE workspace_id=$1 AND graph_revision_id=$2',
          [workspaceId,basis.source.graphRevisionId])).rows[0]?.payload;
        requireF003(publication&&publication.graphDigest===basis.a.graphDigest,'F003_CONTINUATION_SOURCE_MISMATCH','发布A来源不匹配');
      }
      await new SourceSnapshotReader(this.sources,this.sourceAdmission.candidates).records(actor,workspaceId,
        {bundleId:a.source_input.sourceBundleSnapshotId,receiptId:a.source_input.receiptId},tx);
      const graph=await readAnalysisGraph(tx,a);
      requireF003(graph.digest===basis.a.graphDigest&&dependencyDigest(await analysisInventory(tx,workspaceId,a.source_input,a.payload.scope))===basis.a.inventoryDigest,
        'F003_CONTINUATION_SOURCE_MISMATCH','A身份或来源清单发生变化');
      return {basis,graph};
    });
  }

  list(actor, workspaceId, { limit = 100 } = {}) {
    requireF003(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000, "F003_INPUT_INVALID", "调查清单大小无效", { status: 422 });
    return this.#with(actor, workspaceId, null, false, async tx => (await tx.query(`SELECT * FROM f003_investigation
      WHERE workspace_id=$1 AND (actor_id=$2 OR payload->'delegateActorIds' ? $2) ORDER BY created_at DESC,id DESC LIMIT $3`,
    [workspaceId, actor.actorId, limit])).rows.map(rowView));
  }

  checkpoints(actor, workspaceId, id) {
    return this.#with(actor, workspaceId, id, false, async (tx,row) => {
      const roots=(await tx.query(`SELECT generation,checkpoint_key,payload,created_at FROM f003_checkpoint
        WHERE workspace_id=$1 AND investigation_id=$2 AND strpos(checkpoint_key,$3)<>1 ORDER BY generation,checkpoint_key`,
      [workspaceId,id,checkpointChunkPrefix])).rows,results=[];
      for(const r of roots)results.push({generation:r.generation,key:r.checkpoint_key,
        payload:await readCheckpointDocument(tx,row,{generation:r.generation,key:r.checkpoint_key,payload:r.payload}),createdAt:iso(r.created_at)});
      return results;
    });
  }

  events(actor, workspaceId, id) {
    return this.#with(actor, workspaceId, id, false, async tx => (await tx.query(`SELECT sequence,event_type,payload,actor_id,occurred_at
      FROM f003_investigation_event WHERE workspace_id=$1 AND investigation_id=$2 ORDER BY sequence`, [workspaceId, id])).rows);
  }

  graph(actor, workspaceId, id) {
    return this.#with(actor, workspaceId, id, false, async (tx, row) => {
      const ref = row.payload.latestGraph;
      const saved = ref && (await tx.query(`SELECT payload FROM f003_checkpoint WHERE workspace_id=$1 AND investigation_id=$2
        AND generation=$3 AND checkpoint_key='graph'`, [workspaceId, id, ref.generation])).rows[0]?.payload;
      const graph=saved&&await readCheckpointDocument(tx,row,{generation:ref.generation,key:'graph',payload:saved});
      requireF003(graph && graph.digest === ref.digest, "F003_GRAPH_NOT_FOUND", "调查尚无完整分析图谱", { status: 404 });
      return graph;
    });
  }

  async evidenceMaterial(actor, workspaceId, id, materialId) {
    const graph = await this.graph(actor, workspaceId, id);
    const material = graph.materials.find(m => m.id === materialId);
    requireF003(material, "F003_OBJECT_NOT_FOUND", "该材料不属于本调查的已保存图谱", { status: 404 });
    const run = await this.get(actor, workspaceId, id);
    const reader = new SourceSnapshotReader(this.sources, this.sourceAdmission.candidates);
    const result = await reader.readMaterial(actor, workspaceId, { bundleId: run.sourceInput.sourceBundleSnapshotId, receiptId: run.sourceInput.receiptId },
      { componentId: material.sourceMaterial.componentId, pathBytes: material.sourceMaterial.pathBytes });
    requireF003(result.sourceMaterial.id === material.id, "F003_MATERIAL_MISMATCH", "历史依据字节身份不符");
    // Human evidence inspection is not a new analysis admission or a new model
    // send. Workspace permission and restored-source integrity still apply.
    await this.get(actor, workspaceId, id);
    return result;
  }

  async findRunnable({ limit = 20 } = {}) {
    requireF003(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, "F003_INPUT_INVALID", "调度扫描上限无效");
    return (await this.sources.database.query(`SELECT workspace_id,id,actor_id,state FROM f003_investigation
      WHERE (state='QUEUED' OR (state='RUNNING' AND lease_until<=clock_timestamp()))
      AND (payload->>'purpose'='GRAPH_QUESTION' OR payload->>'analysisContractVersion'=$2) ORDER BY created_at,id LIMIT $1`, [limit,String(analysisContractVersion)])).rows
      .map(r => ({ workspaceId: r.workspace_id, id: r.id, actorId: r.actor_id, state: r.state }));
  }

  expire(actor, workspaceId, id) {
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      if(row.payload.purpose!=='GRAPH_QUESTION'&&row.payload.analysisContractVersion!==analysisContractVersion)return rowView(row);
      if (!["QUEUED", "RUNNING", "PAUSED"].includes(row.state) || Date.parse(row.payload.budget.deadline) > new Date(row.db_now).getTime()) return rowView(row);
      const failure = { code: "F003_DEADLINE_EXCEEDED", generation: row.generation + 1 };
      const next = (await tx.query(`UPDATE f003_investigation SET state='FAILED',generation=generation+1,revision=revision+1,worker_id=NULL,lease_until=NULL,
        payload=$3,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 RETURNING *`, [workspaceId, id, JSON.stringify({ ...row.payload, lastFailure: failure })])).rows[0];
      await this.#event(tx, row, actor, "INVESTIGATION_EXPIRED", failure); return rowView(next);
    });
  }

  technicalEvidence(actor, workspaceId, id, { generation, limit = 2000, maxBytes = 256 * 1024, selection = null, routingOnly = false } = {}) {
    requireF003(Number.isSafeInteger(limit) && limit > 0 && limit <= 10000, "F003_INPUT_INVALID", "技术证据页大小无效", { status: 422 });
    return this.#with(actor, workspaceId, id, false, async (tx, row) => {
      this.#running(row, generation);
      const snapshots = await Promise.all(row.payload.adoptedVersionIds.map(v => technicalSnapshot(tx, workspaceId, v,
        row.source_input.sourceBundleSnapshotId, row.payload.scope.componentIds)));
      if(routingOnly) return {versionIds:snapshots.map(s=>s.versionId),sourceBundleId:row.source_input.sourceBundleSnapshotId,
        availableFactCount:snapshots.reduce((n,s)=>n+s.allowedFactIds.length,0),records:[],objects:[],evidence:[],materials:[],allowedFactIds:[],
        unresolved:[],limitations:[],truncated:false,omittedFactCount:0,authority:'ROUTING_NOT_EVIDENCE'};
      return loadTechnicalContext(tx, { workspaceId, bundleId: row.source_input.sourceBundleSnapshotId, snapshots, limit, maxBytes, selection });
    });
  }

  complete(actor, workspaceId, id, { generation, graph }) {
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      this.#running(row, generation);
      await this.#questionAdmission(tx,actor,workspaceId,row);
      requireF003(row.payload.purpose !== "GRAPH_QUESTION","F003_QA_GRAPH_FORBIDDEN","问答不能生成业务图谱");
      requireF003(intactBusinessGraph(graph) && graph.workspaceId === workspaceId && graph.investigationId === id && graph.published === false
        && graph.sourceBundleId === row.source_input.sourceBundleSnapshotId && graph.profileId === row.profile.id
        && canonicalEncode(graph.adoptedVersionIds) === canonicalEncode(row.payload.adoptedVersionIds),
      "F003_GRAPH_INPUT_INVALID", "图谱与调查固定输入不一致");
      await writeCheckpointDocument(tx,row,{generation,key:'graph',payload:graph});
      this.#running(await this.#row(tx,workspaceId,id),generation);
      const payload = { ...row.payload, latestGraph: { generation, digest: graph.digest, id: graph.id } };
      const next = (await tx.query(`UPDATE f003_investigation SET state='COMPLETED',revision=revision+1,worker_id=NULL,lease_until=NULL,
        payload=$3,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 RETURNING *`, [workspaceId, id, JSON.stringify(payload)])).rows[0];
      await this.#event(tx, row, actor, "ANALYSIS_COLLECTED", { generation, graphId: graph.id, graphDigest: graph.digest, published: false });
      return rowView(next);
    });
  }

  completeQuestion(actor,workspaceId,id,{generation,answer}) {
    return this.#with(actor,workspaceId,id,true,async(tx,row)=>{
      this.#running(row,generation);
      await this.#questionAdmission(tx,actor,workspaceId,row);
      await this.profiles.assertUsable(actor,workspaceId,row.profile,tx);
      const question=await readWorkRecord(tx,workspaceId,'KNOWLEDGE_QUESTION',id);
      requireF003(row.payload.purpose === "GRAPH_QUESTION" && answer?.investigationId === id
        && answer.kind==='DERIVED_KNOWLEDGE_ANSWER' && answer.authority==='DERIVED_ANALYSIS_NOT_BUSINESS_AUTHORITY'
        && canonicalEncode(answer.binding) === canonicalEncode(row.payload.questionContext)
        && canonicalEncode(answer.sourceInput)===canonicalEncode(row.source_input) && answer.requestDigest===question?.requestDigest
        && canonicalEncode(answer.implementationVersion)===canonicalEncode(row.payload.implementationVersion)
        && answer.profileId === row.profile.id && Buffer.byteLength(JSON.stringify(answer))<=1024*1024,
        "F003_QA_ANSWER_INVALID","答案不属于此固定问题");
      const saved=await appendWorkRecord(tx,workspaceId,"KNOWLEDGE_ANSWER",answer);
      const payload={...row.payload,latestAnswerId:saved.id};
      const next=(await tx.query(`UPDATE f003_investigation SET state='COMPLETED',revision=revision+1,worker_id=NULL,lease_until=NULL,
        payload=$3,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 RETURNING *`,[workspaceId,id,JSON.stringify(payload)])).rows[0];
      await this.#event(tx,row,actor,"DERIVED_ANSWER_SAVED",{generation,answerId:saved.id,graphDigest:answer.binding.graphDigest});
      return rowView(next);
    });
  }

  fail(actor, workspaceId, id, { generation, code, phase = null, taskKey = null, slotId = null }) {
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      this.#running(row, generation);
      const failure = { code: typeof code === "string" && /^[A-Z0-9_]{1,128}$/.test(code) ? code : "F003_EXECUTION_FAILED", generation };
      if (["PLAN", "INVESTIGATE", "VERIFY", "ANSWER"].includes(phase)) failure.phase = phase;
      if (key(taskKey)) failure.taskKey = taskKey;
      if ([row.profile.mainAgentSlot, ...row.profile.childAgentSlots].some(s => s.id === slotId)) failure.slotId = slotId;
      const next = (await tx.query(`UPDATE f003_investigation SET state='FAILED',revision=revision+1,worker_id=NULL,lease_until=NULL,
        payload=$3,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 RETURNING *`,
      [workspaceId, id, JSON.stringify({ ...row.payload, lastFailure: failure })])).rows[0];
      await this.#event(tx, row, actor, "INVESTIGATION_FAILED", failure);
      return rowView(next);
    });
  }

  releaseForShutdown(actor, workspaceId, id, { generation, workerId }) {
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      this.#running(row, generation);
      requireF003(row.worker_id === workerId, "F003_STALE_WORKER", "仅当前执行器可释放本轮租约");
      const next = (await tx.query(`UPDATE f003_investigation SET state='QUEUED',generation=generation+1,revision=revision+1,
        worker_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 RETURNING *`, [workspaceId, id])).rows[0];
      await this.#event(tx, row, actor, "INVESTIGATION_HOST_INTERRUPTED", { workerId, fromGeneration: generation, generation: next.generation });
      return rowView(next);
    });
  }

  async sourceBinding(actor, workspaceId, id, tx) {
    const access = await this.sources.authorize(actor, workspaceId, false, tx);
    requireF003(access.restoreReady, "F003_RESTORE_UNVERIFIED", "恢复未完成校验");
    const row = await this.#row(tx, workspaceId, id);
    this.#member(actor, row);
    this.#running(row);
    return { analysisRunId: row.id, sourceInput: row.source_input };
  }

  async claim(actor, workspaceId, id, { workerId, leaseMs = 60000 }) {
    requireF003(key(workerId) && Number.isSafeInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= 300000,
      "F003_INPUT_INVALID", "执行器租约无效", { status: 422 });
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      this.#analysisContract(row);
      requireF003(row.state === "QUEUED" || (row.state === "RUNNING" && new Date(row.lease_until) <= new Date(row.db_now)),
        "F003_LEASE_UNAVAILABLE", "调查尚不可领取或已有有效执行器");
      requireF003(Date.parse(row.payload.budget.deadline) > new Date(row.db_now).getTime(), "F003_DEADLINE_EXCEEDED", "调查已截止");
      await this.profiles.assertUsable(actor, workspaceId, row.profile, tx);
      await this.#questionAdmission(tx,actor,workspaceId,row);
      const next = (await tx.query(`UPDATE f003_investigation SET state='RUNNING',generation=generation+1,revision=revision+1,
        worker_id=$3,lease_until=clock_timestamp()+$4*interval '1 millisecond',updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND id=$2 RETURNING *`, [workspaceId, id, workerId, leaseMs])).rows[0];
      await this.#event(tx, row, actor, "INVESTIGATION_CLAIMED", { workerId, generation: next.generation });
      return rowView(next);
    });
  }

  async inventory(actor, workspaceId, id, options = {}) {
    const run = await this.get(actor, workspaceId, id);
    requireF003(!options.componentId || run.scope.componentIds.includes(options.componentId), "F003_SCOPE_MISMATCH", "目录组件超出调查范围", { status: 403 });
    // Source pagination must not be filtered after the fact: one page could
    // otherwise falsely imply that the selected investigation is exhausted.
    requireF003(options.componentId || run.scope.componentIds.length === 1, "F003_COMPONENT_REQUIRED", "多组件调查请逐组件读取完整目录", { status: 422 });
    return this.admitted.inventory(actor, workspaceId, { analysisRunId: id, bundleId: run.sourceInput.sourceBundleSnapshotId, receiptId: run.sourceInput.receiptId },
      { ...options, componentId: options.componentId ?? run.scope.componentIds[0] });
  }

  async readMaterial(actor, workspaceId, id, locator, { generation, maxBytes = 8 * 1024 * 1024 } = {}) {
    requireF003(Number.isSafeInteger(generation) && generation > 0, "F003_STALE_WORKER", "材料读取必须绑定当前执行世代");
    const run = await this.get(actor, workspaceId, id);
    requireF003(run.scope.componentIds.includes(locator?.componentId), "F003_SCOPE_MISMATCH", "材料超出调查范围", { status: 403 });
    const reference = { analysisRunId: id, bundleId: run.sourceInput.sourceBundleSnapshotId, receiptId: run.sourceInput.receiptId };
    const page = await this.admitted.inventory(actor, workspaceId, reference, { ...locator, limit: 1 });
    const item = page.items[0];
    requireF003(item?.entry.pathBytes === locator.pathBytes && /^\d+$/.test(item.disposition?.sizeBytes ?? ""), "F003_MATERIAL_UNAVAILABLE", "材料正文不可读");
    const bytes = Number(item.disposition.sizeBytes);
    requireF003(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 64 * 1024 * 1024 && Number.isSafeInteger(bytes) && bytes <= maxBytes,
      "F003_BUDGET_EXCEEDED", "材料超出单次读取预算");
    await this.#with(actor, workspaceId, id, true, async (tx, row) => {
      this.#running(row, generation);
      await this.#questionAdmission(tx,actor,workspaceId,row);
      requireF003(row.usage.readBytes + bytes <= row.payload.budget.maxReadBytes, "F003_BUDGET_EXCEEDED", "累计材料读取预算已用尽");
      const usage = { ...row.usage, readBytes: row.usage.readBytes + bytes };
      await tx.query("UPDATE f003_investigation SET usage=$3,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2", [workspaceId, id, JSON.stringify(usage)]);
      await this.#event(tx, row, actor, "MATERIAL_READ_RESERVED", { generation, locator, bytes });
    });
    const material = await this.admitted.readMaterial(actor, workspaceId, reference, locator, { maxBytes });
    await this.#with(actor, workspaceId, id, false, async (tx, row) => {
      this.#running(row, generation);
      await this.#event(tx, row, actor, "MATERIAL_READ_COMPLETED", { generation, sourceMaterial: material.sourceMaterial, receiptId: material.receiptId });
    });
    return material;
  }

  async control(actor, workspaceId, id, { action, expectedRevision }) {
    const from = { PAUSE: ["RUNNING"], RESUME: ["PAUSED", "FAILED"], CANCEL: ["QUEUED", "RUNNING", "PAUSED", "FAILED"] };
    const target = { PAUSE: "PAUSED", RESUME: "QUEUED", CANCEL: "CANCELLED" };
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      requireF003(row.revision === expectedRevision, "F003_REVISION_CONFLICT", "调查已经变化，请刷新当前记录");
      requireF003(from[action]?.includes(row.state), "F003_TRANSITION_INVALID", "当前调查状态不允许此操作");
      if (action === "RESUME") {
        this.#analysisContract(row);
        await this.#questionAdmission(tx,actor,workspaceId,row);
        requireF003(Date.parse(row.payload.budget.deadline) > new Date(row.db_now).getTime(), "F003_DEADLINE_EXCEEDED", "调查已截止，不能恢复");
        await this.profiles.assertUsable(actor, workspaceId, row.profile, tx);
      }
      const next = (await tx.query(`UPDATE f003_investigation SET state=$3,generation=generation+1,revision=revision+1,
        worker_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 RETURNING *`, [workspaceId, id, target[action]])).rows[0];
      await this.#event(tx, row, actor, `INVESTIGATION_${action}`, { from: row.state, generation: next.generation });
      return rowView(next);
    });
  }

  async checkpoint(actor, workspaceId, id, { generation, key: checkpointKey, payload }) {
    requireF003(Number.isSafeInteger(generation) && generation > 0, "F003_STALE_WORKER", "检查点必须绑定当前执行世代");
    requireF003(key(checkpointKey) && !checkpointKey.startsWith(checkpointChunkPrefix)
      && payload && typeof payload === "object" && !Array.isArray(payload), "F003_INPUT_INVALID", "检查点必须是有界的结构化结果", { status: 422 });
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      this.#running(row, generation);
      if(row.payload.purpose==='GRAPH_QUESTION')requireF003(Buffer.byteLength(JSON.stringify(payload))<=checkpointRowBytes,
        'F003_INPUT_INVALID','问答检查点保持原单条上限',{status:422});
      const existing = (await tx.query("SELECT payload FROM f003_checkpoint WHERE workspace_id=$1 AND investigation_id=$2 AND generation=$3 AND checkpoint_key=$4",
        [workspaceId,id,generation,checkpointKey])).rows[0];
      const saved=await writeCheckpointDocument(tx,row,{generation,key:checkpointKey,payload,allowChunks:row.payload.purpose!=='GRAPH_QUESTION'});
      if(existing)return saved;
      this.#running(await this.#row(tx,workspaceId,id),generation);
      await this.#event(tx, row, actor, "CHECKPOINT_COMMITTED", { generation, key: checkpointKey });
      return payload;
    });
  }

  async heartbeat(actor, workspaceId, id, { generation, leaseMs = 60000 }) {
    requireF003(Number.isSafeInteger(generation) && generation > 0 && Number.isSafeInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= 300000,
      "F003_INPUT_INVALID", "租约续期参数无效", { status: 422 });
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      this.#running(row, generation);
      const next = (await tx.query(`UPDATE f003_investigation SET lease_until=LEAST(clock_timestamp()+$3*interval '1 millisecond',$4::timestamptz),
        updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 RETURNING *`, [workspaceId, id, leaseMs, row.payload.budget.deadline])).rows[0];
      return rowView(next);
    });
  }

  async reserveModelCall(actor, workspaceId, id, { generation, slotId, taskKey, phase = null }) {
    requireF003(Number.isSafeInteger(generation) && generation > 0 && key(taskKey)
      && (phase === null || ["PLAN", "INVESTIGATE", "VERIFY", "ANSWER"].includes(phase)),
    "F003_INPUT_INVALID", "模型调用必须有执行世代和任务键及有效阶段", { status: 422 });
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      this.#running(row, generation);
      const slot = [row.profile.mainAgentSlot, ...row.profile.childAgentSlots].find(s => s.id === slotId);
      requireF003(slot, "F003_AGENT_FORBIDDEN", "Agent 不属于此调查的固定团队", { status: 403 });
      await this.profiles.assertUsable(actor, workspaceId, row.profile, tx);
      await this.#questionAdmission(tx,actor,workspaceId,row);
      let reuseUnstarted = false, semanticContextDigest = null;
      if(row.payload.purpose === "GRAPH_QUESTION") {
        const previous=(await tx.query(`SELECT event_type,payload FROM f003_investigation_event WHERE workspace_id=$1 AND investigation_id=$2
          AND event_type IN ('MODEL_CALL_RESERVED','MODEL_CALL_STARTED') AND payload->>'taskKey'=$3 AND payload->>'slotId'=$4`,
          [workspaceId,id,taskKey,slotId])).rows;
        requireF003(!previous.some(e=>e.event_type==='MODEL_CALL_STARTED'),"F003_QA_CALL_OUTCOME_UNKNOWN",
          "此逻辑任务已外发且缺少已提交检查点，不能自动重复调用；请读取原过程或明确创建新问题");
        reuseUnstarted=previous.some(e=>e.event_type==='MODEL_CALL_RESERVED');
      } else {
        const previous=(await tx.query(`SELECT sequence,event_type,payload FROM f003_investigation_event WHERE workspace_id=$1 AND investigation_id=$2
          AND event_type IN ('MODEL_CALL_RESERVED','MODEL_CALL_STARTED','MODEL_CALL_FINISHED','INVESTIGATION_RESUME','TECHNICAL_VERSION_ADOPTED') ORDER BY sequence`,[workspaceId,id])).rows;
        const contexts = analysisCallContexts(row, previous);
        semanticContextDigest = contexts.current;
        const relevant=previous.filter(e=>e.payload.taskKey===taskKey&&e.payload.slotId===slotId
          &&contexts.byReservation.get(e.payload.id)===semanticContextDigest);
        const started=relevant.filter(e=>e.event_type==='MODEL_CALL_STARTED');
        const terminal=call=>relevant.find(e=>e.event_type==='MODEL_CALL_FINISHED'&&e.payload.id===call.payload.id);
        requireF003(!started.some(e=>!terminal(e)),'F003_CALL_OUTCOME_UNKNOWN',
          '此任务曾STARTED但结果未知；租约接管或恢复不能静默重发或退还支出');
        const prior=relevant.filter(e=>e.event_type==='MODEL_CALL_RESERVED'&&e.payload.generation!==generation);
        if(prior.length) {
          const latest=prior.at(-1),finished=terminal(latest);
          if(finished)requireF003(['FAILED','ABORTED'].includes(finished.payload.outcome)&&previous.some(e=>e.event_type==='INVESTIGATION_RESUME'
            &&Number(e.sequence)>Number(finished.sequence)&&e.payload.generation>latest.payload.generation&&e.payload.generation<generation),
          'F003_CALL_RETRY_REQUIRES_RESUME','已外发任务仅允许已知失败后的显式新代际尝试；成功但未提交的结果不能自动重放');
        }
      }
      const existing = (await tx.query(`SELECT payload FROM f003_investigation_event WHERE workspace_id=$1 AND investigation_id=$2
        AND event_type='MODEL_CALL_RESERVED' AND (payload->>'generation')::integer=$3 AND payload->>'taskKey'=$4 AND payload->>'slotId'=$5`,
      [workspaceId, id, generation, taskKey, slotId])).rows[0];
      if (existing) {
        requireF003((existing.payload.phase ?? null) === phase, "F003_OPERATION_CONFLICT", "预留阶段与既有任务不一致");
        return { ...existing.payload, profile: row.profile, slot };
      }
      requireF003(reuseUnstarted || row.usage.modelCalls < row.payload.budget.maxModelCalls, "F003_BUDGET_EXCEEDED", "本轮模型调用预算已用尽");
      const reservation = { id: randomUUID(), generation, slotId, taskKey, phase };
      if (semanticContextDigest !== null) reservation.semanticContextDigest = semanticContextDigest;
      await tx.query("UPDATE f003_investigation SET usage=$3,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2",
        [workspaceId, id, JSON.stringify({ ...row.usage, modelCalls: row.usage.modelCalls + (reuseUnstarted ? 0 : 1) })]);
      await this.#event(tx, row, actor, "MODEL_CALL_RESERVED", reservation);
      return { ...reservation, profile: row.profile, slot };
    });
  }

  async beginModelCall(actor, workspaceId, id, { generation, reservationId }) {
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      this.#running(row, generation);
      await this.profiles.assertUsable(actor, workspaceId, row.profile, tx);
      await this.#questionAdmission(tx,actor,workspaceId,row);
      const events = (await tx.query(`SELECT event_type,payload FROM f003_investigation_event WHERE workspace_id=$1 AND investigation_id=$2
        AND event_type IN ('MODEL_CALL_RESERVED','MODEL_CALL_STARTED','MODEL_CALL_FINISHED') AND payload->>'id'=$3`, [workspaceId, id, reservationId])).rows;
      const reservation = events.find(e => e.event_type === "MODEL_CALL_RESERVED")?.payload;
      requireF003(reservation?.generation === generation && !events.some(e => ["MODEL_CALL_STARTED", "MODEL_CALL_FINISHED"].includes(e.event_type)),
        "F003_MODEL_CALL_UNAVAILABLE", "预留不存在、世代已变化或已尝试执行，不能重复外发");
      await this.#event(tx, row, actor, "MODEL_CALL_STARTED", reservation);
      return reservation;
    });
  }

  async finishModelCall(actor, workspaceId, id, { generation, reservationId, outcome, code = null }) {
    requireF003(["SUCCEEDED", "FAILED", "ABORTED"].includes(outcome), "F003_INPUT_INVALID", "模型调用终态无效", { status: 422 });
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      const events = (await tx.query(`SELECT event_type,payload FROM f003_investigation_event WHERE workspace_id=$1 AND investigation_id=$2
        AND event_type IN ('MODEL_CALL_RESERVED','MODEL_CALL_STARTED','MODEL_CALL_FINISHED') AND payload->>'id'=$3`, [workspaceId, id, reservationId])).rows;
      const reservation = events.find(e => e.event_type === "MODEL_CALL_RESERVED")?.payload;
      requireF003(reservation?.generation === generation, "F003_MODEL_CALL_UNAVAILABLE", "调用预留不属于此调查与执行世代");
      const finished = events.find(e => e.event_type === "MODEL_CALL_FINISHED")?.payload;
      if (finished) return finished;
      const started = events.some(e => e.event_type === "MODEL_CALL_STARTED");
      requireF003(outcome !== "SUCCEEDED" || started, "F003_MODEL_CALL_UNAVAILABLE", "未开始的调用不能记为成功");
      const current = row.state === "RUNNING" && row.generation === generation && row.lease_until
        && new Date(row.lease_until) > new Date(row.db_now) && Date.parse(row.payload.budget.deadline) > new Date(row.db_now).getTime();
      // Audit an old invocation without changing the investigation, its budget
      // or generation. A late success is never permission to use its result.
      const terminal = { ...reservation, outcome: outcome === "SUCCEEDED" && !current ? "DISCARDED" : outcome, started };
      if (["F003_MODEL_TIMEOUT", "F003_MODEL_OUTPUT_LIMIT", "F003_MODEL_PROCESS_EXIT", "F003_MODEL_OUTPUT_INVALID",
        "F003_MODEL_UNAVAILABLE"].includes(code)) terminal.code = code;
      await this.#event(tx, row, actor, "MODEL_CALL_FINISHED", terminal);
      return terminal;
    });
  }

  // C03 consumer contract. The original baseline remains stable even after
  // explicit adoption, so adoption cannot create a fresh F002 budget account.
  async #consumerRead(actor, workspaceId, id, tx, work) {
    if (!tx) return this.#with(actor, workspaceId, id, false, work);
    // The provider owns this transaction and its Workspace fence. Reusing it
    // avoids acquiring a second connection for the same locked Workspace.
    const access = await this.sources.authorize(actor, workspaceId, false, tx);
    requireF003(access.restoreReady, "F003_RESTORE_UNVERIFIED", "配套恢复尚未完成");
    const row = await this.#row(tx, workspaceId, id);
    this.#member(actor, row);
    return work(tx, row);
  }

  async resolve(actor, workspaceId, id, { tx = null } = {}) {
    return this.#consumerRead(actor, workspaceId, id, tx, async (_tx, row) => {
      this.#running(row);
      requireF003(row.payload.purpose !== "GRAPH_QUESTION","F003_QA_FIXED_BINDING","派生问答不能改变采用集合或创建定向补证");
      requireF003(row.payload.technicalVersionId, "F003_TECHNICAL_BASELINE_REQUIRED", "此调查尚未采用技术证据，不能请求基于事实集的补证");
      return { workspaceId, investigationId: id, baseVersionId: row.payload.technicalVersionId, state: "RUNNING",
        allowedFactIds: row.payload.technical.allowedFactIds, allowedMaterialIds: row.payload.technical.allowedMaterialIds,
        allowedCapabilities: row.payload.technical.allowedCapabilities, budget: row.payload.supplementBudget };
    });
  }

  async authorizeRead(actor, workspaceId, id, requestId, { tx: existing = null } = {}) {
    return this.#consumerRead(actor, workspaceId, id, existing, async (tx, row) => {
      const receipt = (await tx.query(`SELECT id,actor_id,base_version_id FROM f002_request
        WHERE workspace_id=$1 AND id=$2 AND investigation_id=$3`, [workspaceId, requestId, id])).rows[0];
      requireF003(receipt && receipt.base_version_id === row.payload.technicalVersionId
        && (receipt.actor_id === row.actor_id || row.payload.delegateActorIds.includes(receipt.actor_id)),
      "F003_REQUEST_FORBIDDEN", "取证结果不属于此调查的受信任请求", { status: 403 });
      return { workspaceId, investigationId: id, baseVersionId: receipt.base_version_id, allowedRequestIds: [receipt.id] };
    });
  }

  async adoptTechnicalVersion(actor, workspaceId, id, { requestId, versionId, expectedRevision }) {
    return this.#with(actor, workspaceId, id, true, async (tx, row) => {
      this.#analysisContract(row);
      requireF003(row.payload.purpose !== "GRAPH_QUESTION","F003_QA_FIXED_BINDING","新技术依据须经显式新工作上下文采用，不改旧答案绑定");
      requireF003(row.revision === expectedRevision, "F003_REVISION_CONFLICT", "调查已变化，请刷新后再采用");
      requireF003(["RUNNING", "PAUSED", "QUEUED"].includes(row.state), "F003_TRANSITION_INVALID", "当前调查不能再采用证据");
      const receipt = (await tx.query(`SELECT * FROM f002_request WHERE workspace_id=$1 AND id=$2 AND investigation_id=$3`, [workspaceId, requestId, id])).rows[0];
      requireF003(receipt && receipt.state === "COMPLETED" && receipt.outcome === "NEW_VERSION"
        && receipt.base_version_id === row.payload.technicalVersionId && receipt.result?.graphVersionId === versionId
        && (receipt.actor_id === row.actor_id || row.payload.delegateActorIds.includes(receipt.actor_id)),
      "F003_ADOPTION_UNPROVEN", "需要本调查真实完成且返回新版本的补证收据");
      await technicalSnapshot(tx, workspaceId, versionId, row.source_input.sourceBundleSnapshotId, row.payload.scope.componentIds);
      requireF003(!row.payload.adoptedVersionIds.includes(versionId), "F003_VERSION_ALREADY_ADOPTED", "此版本已经采用");
      const payload = { ...row.payload, adoptedVersionIds: [...row.payload.adoptedVersionIds, versionId] };
      const next = (await tx.query(`UPDATE f003_investigation SET payload=$3,state='QUEUED',generation=generation+1,revision=revision+1,
        lease_until=NULL,worker_id=NULL,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 RETURNING *`, [workspaceId, id, JSON.stringify(payload)])).rows[0];
      await this.#event(tx, row, actor, "TECHNICAL_VERSION_ADOPTED", { requestId, versionId, generation: next.generation, baseVersionId: row.payload.technicalVersionId });
      return rowView(next);
    });
  }
}
