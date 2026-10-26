import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalEncode, decodePathBytes, structureDigest } from "../source-truth/identity.js";
import { requireF003, F003HostShutdown } from "./errors.js";
import { buildBusinessGraph } from "./semantic-graph.js";
import { qualifyTaskProposals, consolidateProposals } from "./proposals.js";
import { analysisContractVersion, originalContextBytes, partitionOriginalMaterials, sourceRange, citationVisible, originalEvidenceContext } from "./model-context.js";
import {analysisStagePacket,analysisExcludedKeys,analysisInputBytes,stageTechnicalBytes,jsonBytes} from './stage-context.js';
import {businessPlan,responsibilityMaterials,bindBusinessTask,futureTaskBudget,taskDigest} from './business-tasks.js';
import {dependencyIndex,recordDependencies,rebindContinuation,literalDeclaration,guardHistoricalReview,dependencyDigest,historicalRecheckContext} from './dependency-review.js';

const hash = value => createHash("sha256").update(canonicalEncode(value)).digest("hex");
const array = (v, max = 2000) => Array.isArray(v) && v.length <= max;
const candidateContract = { key: "unique semantic key", kind: "FUNCTION | RULE | ROLE | STATE | PROCESS | EXCEPTION | BUSINESS_OBJECT",
  name: "readable name", statement: "one evidence-bounded proposition", scope: "conditions and exclusions", uncertainties: ["remaining unknowns"],
  evidence: [{ materialId: "supplied material id", startLine: "original global 1-based line, not fragment-local", endLine: "original inclusive line", quote: "exact supplied raw text" }], technicalRefs: ["optional supplied Fact ids"],
  dependencyScope:{optional:'Only exact declaration-only propositions can use LOCAL_RETURN_LITERAL; all other claims remain conservative rechecks',
    example:literalDeclaration('example','literal'),rules:'Not a completeness flag. AST, original full function, F002 anchors and recursive premises are verified server-side; no absence/runtime/global inference.'} };
const relationContract = { key: "unique key", sourceKey: "candidate key or supplied material id", predicate: "DIRECTED_UPPERCASE_RELATION",
  targetKey: "candidate key or supplied material id (engineering assets are first-class endpoints)",
  scope: "conditions", uncertainties: [], evidence: candidateContract.evidence, technicalRefs: [] };
const childContract = { candidates: [candidateContract], relations: [relationContract], requestedMaterialKeys: ["additional in-scope inventory keys needed for missing evidence"] };

export async function abortable(signal, work) {
  signal.throwIfAborted();
  const interrupted = Promise.withResolvers(), abort = () => interrupted.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }), interrupted.promise]); }
  finally { signal.removeEventListener("abort", abort); }
}

// No model process owns a database transaction. Each stage is authorized,
// budgeted and fenced. Committed same-input checkpoints survive a restart;
// changed adopted evidence cannot inherit old semantic results.
export class InvestigationWorker {
  constructor({ investigations, invokeModel }) {
    if (!investigations?.claim || typeof invokeModel !== "function") throw new TypeError("F003 requires durable investigation and configured models");
    Object.assign(this, { investigations, invokeModel }); this.controllers = new Map();
  }
  stop(workspaceId, id) { this.controllers.get(`${workspaceId}\0${id}`)?.abort(new Error("F003 execution stopped")); }

  async run(actor, workspaceId, id, { workerId, leaseMs = 60000, signal = null } = {}) {
    const service = this.investigations;
    requireF003((await service.get(actor,workspaceId,id)).purpose !== "GRAPH_QUESTION","F003_QA_WRONG_WORKER","派生问答不使用业务图谱生成器");
    signal?.throwIfAborted();
    await service.expire(actor, workspaceId, id);
    signal?.throwIfAborted();
    const run = await service.claim(actor, workspaceId, id, { workerId, leaseMs });
    const { generation } = run, controller = new AbortController(), controllerKey = `${workspaceId}\0${id}`;
    this.controllers.set(controllerKey, controller);
    const abort = () => controller.abort(signal.reason ?? new Error("F003 caller cancelled"));
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    let renewing = false;
    const timer = setInterval(async () => {
      if (renewing) return; renewing = true;
      try { await service.heartbeat(actor, workspaceId, id, { generation, leaseMs }); }
      catch (error) { controller.abort(error); } finally { renewing = false; }
    }, Math.max(100, Math.floor(leaseMs / 3)));
    timer.unref();
    const binding = hash({ analysisContractVersion, sourceInput: run.sourceInput, profileId: run.profile.id, adoptedVersionIds: run.adoptedVersionIds,
      continuationBasisDigest:run.continuationBasis?.digest??null });
    let failureContext = {};
    try {
      const history = await service.checkpoints(actor, workspaceId, id), process = [],packets=new Map(),allMaterials=[],availableFactIds=new Set();
      const cached = new Map(history.filter(p => p.payload?.binding === binding).map(p => [p.key, p.payload]));
      const stage = async (key, work, context = { taskKey: key }) => {
        failureContext = context;
        controller.signal.throwIfAborted();
        if (cached.has(key)) {
          await service.heartbeat(actor, workspaceId, id, { generation, leaseMs });
          const reused = cached.get(key);
          if (reused.process) process.push({ ...reused.process, reusedFromCheckpoint: true });
          return structuredClone(reused.data);
        }
        const value = await work(); controller.signal.throwIfAborted();
        await service.checkpoint(actor, workspaceId, id, { generation, key, payload: { binding, ...value } });
        if (value.process) process.push(value.process); return value.data;
      };
      const invoke = async (key, slotId, unprojected, prepared=false) => {
        const projected=key==='plan'&&cached.get(key)?.input?{input:cached.get(key).input,omitted:[]}
          :prepared?{input:unprojected,omitted:[]}:analysisStagePacket(unprojected,allMaterials);
        const packet=await stage(`input-${key}`,async()=>({data:projected})),input=packet.input;
        requireF003(key==='plan'||hash(input)===hash(projected.input),'F003_CHECKPOINT_INPUT_CHANGED',
          '当前任务与已冻结发送输入不同；不能借同阶段名替换证据');
        packets.set(key,packet);
        // Main stage names are checkpoint roles, not cross-adoption call ids.
        // A new explicitly adopted basis is a different task; an unknown call
        // on the SAME basis keeps its identity and cannot bypass the guard.
        const invocationTaskKey=/^(child-|supplement-)/.test(key)?key:`${key}-${binding}`;
        if(cached.has(key))requireF003(cached.get(key).process?.inputDigest===hash(input),'F003_CHECKPOINT_INPUT_CHANGED',
          '检查点实际输入与本次投影不符，不能按相同数组位置复用旧模型结果');
        return stage(key, async () => {
        requireF003(jsonBytes(input) <= analysisInputBytes, "F003_MODEL_INPUT_LIMIT", "本轮完整JSON输入超过阶段资源界；不能静默删除提案或增加预算");
        const output = await abortable(controller.signal, () => this.invokeModel({ actor, workspaceId, investigationId: id,
          generation, slotId, taskKey: invocationTaskKey, input, signal: controller.signal }));
        requireF003(output?.reservationId && output.result && typeof output.result === "object" && !Array.isArray(output.result)
          && Buffer.byteLength(JSON.stringify(output.result)) <= 1024 * 1024, "F003_MODEL_OUTPUT_INVALID", "模型必须返回有界结构化结果和调用预留");
        return { data: output.result, input,process: { taskKey: key,invocationTaskKey,slotId, modelRevisionId: [run.profile.mainAgentSlot, ...run.profile.childAgentSlots]
          .find(s => s.id === slotId)?.modelProfileRevisionId, reservationId: output.reservationId, inputDigest: hash(input), outputDigest: hash(output.result), generation,
          inputBytes:jsonBytes(input),maxInputBytes:analysisInputBytes,technicalContextBytes:jsonBytes(input.technicalEvidence),
          ...(packet.omitted.length?{pendingProposals:packet.omitted}:{}),
          ...(Array.isArray(input.materials) ? { sourceRanges: input.materials.map(sourceRange),
            originalContextBytes: input.materials.reduce((n, m) => n + Buffer.byteLength(m.text), 0),
            contextGaps: input.evidenceContext?.missingEvidence ?? [] } : {}) } };
      }, { phase: unprojected.phase, taskKey: invocationTaskKey, slotId });};
      const inventory = await stage("inventory", async () => {
        const entries = [];
        for (const componentId of run.scope.componentIds) {
          let cursor = null;
          do {
            const page = await service.inventory(actor, workspaceId, id, { componentId, limit: 1000, cursor });
            for (const item of page.items) {
              const locator = { componentId: item.componentId, pathBytes: item.entry.pathBytes };
              const material = item.disposition?.digest ? { workspaceId, bundleId: run.sourceInput.sourceBundleSnapshotId, ...locator, contentDigest: item.disposition.digest } : null;
              entries.push({ key: hash(locator), ...locator, path: decodePathBytes(locator.pathBytes).toString("utf8"), kind: item.entry.kind,
                disposition: item.disposition?.disposition ?? "PENDING", reasonCode: item.disposition?.reasonCode ?? "UNKNOWN",
                sizeBytes: item.disposition?.sizeBytes ?? item.entry.sizeBytes, materialId: material ? structureDigest("material", material) : null });
            }
            cursor = page.nextCursor;
            requireF003(entries.length <= 10000, "F003_INVENTORY_LIMIT", "目录超过本轮已验证上限，请缩小范围；完整材料仍留在F001");
          } while (cursor);
        }
        return { data: entries };
      });
      const technical = await stage("technical", async () => ({ data: await service.technicalEvidence(actor, workspaceId, id, { generation,routingOnly:true }) }));
      const technicalFor=(taskKey,materials,factIds=null)=>stage(`technical-${taskKey}`,async()=>({data:await service.technicalEvidence(actor,workspaceId,id,
        {generation,maxBytes:stageTechnicalBytes,selection:{materials,factIds}})}));
      const continuation=await stage('continuation-source',async()=>({data:service.continuationEvidence
        ?await service.continuationEvidence(actor,workspaceId,id,{generation}):null}));
      const factSelectors=(continuation?.graph.dependencyReview?.entries??[]).flatMap(e=>[
        ...(e.factBindings??[]).flatMap(f=>f.selector?[f.selector]:[]),...(e.proof?.nameFactSelector?[e.proof.nameFactSelector]:[])]);
      const dependencyData=await stage('dependency-index',async()=>({data:service.dependencyEvidence
        ?await service.dependencyEvidence(actor,workspaceId,id,{generation,factSelectors}):{rows:[],profiles:[],inventory:[],status:'INCOMPLETE'}}));
      const index=dependencyIndex({...dependencyData,bundleId:run.sourceInput.sourceBundleSnapshotId,workspaceId});
      const continuationRouting=continuation?{basisDigest:continuation.basis.digest,sourceGraphDigest:continuation.graph.digest,
        authority:'HISTORICAL_ROUTING_NOT_B_EVIDENCE',historicalRecheck:historicalRecheckContext(continuation,null,index),
        rules:['Recheck changed premises and their consumers, including unchanged callers.',
          'Only server-proved rebinding may import A semantics. All B files retain responsibility or pending coverage.',
          'Reused propositions still require purposeful B evidence/counterexample verification; historical A is not evidence for B.']}:null;
      const plan = await invoke("plan", run.profile.mainAgentSlot.id, { phase: "PLAN", question: run.question, scope: run.scope, inventory,
        ...(continuationRouting?{continuation:continuationRouting}:{}),
        technicalEvidence: technical, childSlots: run.profile.childAgentSlots.map(s => ({ id: s.id, independenceGroup: s.independenceGroup ?? null })),
        budget: run.budget, usage: (await service.get(actor, workspaceId, id)).usage,
        outputContract: { assignments: [{ slotId: "configured Child id (may take multiple sequential tasks)", objective: "one concrete business subquestion, NOT a copy of the overall question",
          obligations:["specific conditions, counterexamples and missing premises to check; not predetermined answers"],materialKeys: ["actual supplied inventory keys for this responsibility"],
          ranges:[{materialKey:"optional exact supplied key",startLine:"optional global first line",endLine:"optional global last line"}],
          sharedEvidenceReason:"required only when two tasks deliberately share overlapping premises"}],pendingMaterials:[{materialKey:"any unassigned FILE key",reason:"why this evidence remains unfinished"}],
          rules: ["At least one configured Child must investigate. Do not supply taskId: the server binds normalized responsibilities and actual evidence to task identity.",
            "Decompose by business subquestions and evidence responsibilities, not copies of the global question across every file. Every visible file needs responsibility or an explicit pending reason.",
            "Ranges are original global lines, not new materials. Omit ranges to investigate the selected whole file. All unassigned ranges remain pending, never silently irrelevant.",
            "Plan for actual serialized 64 KiB raw / 32 KiB dependency-closed technical / 128 KiB whole-input fragments, not assignment count. Reserve two Main calls and preferably one discretionary attempt within the EXISTING remaining budget.",
            "Routing metadata is not evidence. Never claim unread materials were understood; an infeasible plan will not run a smaller arbitrary subset."] } });
      const childIds = new Set(run.profile.childAgentSlots.map(s => s.id)), byKey = new Map(inventory.map(m => [m.key, m]));
      const plannedInventoryKeys=new Set(packets.get('plan').input.inventory.map(m=>m.key));
      const responsibilities=businessPlan(plan,{inventory,visibleKeys:plannedInventoryKeys,childIds,question:run.question});
      const materials = allMaterials, materialByKey = new Map(), unavailableMaterialKeys=new Set(),candidates = [], relations = [], requested = [], originalProposals = [], pendingTasks = [];
      const hasChildBudget = async key => cached.has(key) || (await service.get(actor, workspaceId, id)).usage.modelCalls + 3 <= run.budget.maxModelCalls;
      const collect = (taskKey, slotId, output, suppliedMaterials, existingCandidateKeys = []) => {
        const modelProcess = process.find(p => p.taskKey === taskKey);
        const qualified = qualifyTaskProposals({ investigationId: id, sourceBundleId: run.sourceInput.sourceBundleSnapshotId, taskKey, slotId,
          modelRevisionId: modelProcess.modelRevisionId, reservationId: modelProcess.reservationId, materialIds: [...new Set(suppliedMaterials.map(m => m.id))],
          sourceRanges: suppliedMaterials.map(sourceRange), existingCandidateKeys, output });
        const suppliedTechnical=new Set(packets.get(taskKey).input.technicalEvidence.allowedFactIds);
        for(const id of suppliedTechnical)availableFactIds.add(id);
        for (const p of [...qualified.candidates, ...qualified.relations]) {
          if (Array.isArray(p.evidence) && p.evidence.some(c => !citationVisible(c, suppliedMaterials))) p.identityIssues.push("OUTSIDE_SUPPLIED_SOURCE_RANGE");
          if(Array.isArray(p.technicalRefs)&&p.technicalRefs.some(id=>!suppliedTechnical.has(id)))p.identityIssues.push('OUTSIDE_SUPPLIED_TECHNICAL_CONTEXT');
        }
        candidates.push(...qualified.candidates); relations.push(...qualified.relations); originalProposals.push(...qualified.originalProposals);
      };
      const read = async materialKey => {
        if (materialByKey.has(materialKey)) return materialByKey.get(materialKey);
        if(unavailableMaterialKeys.has(materialKey))return null;
        const entry = byKey.get(materialKey);
        const material = await stage(`material-${materialKey}`, async () => {
          if (!entry.materialId || entry.kind !== "FILE" || !/^\d+$/.test(entry.sizeBytes ?? "") || Number(entry.sizeBytes) > 128 * 1024)
            return { data: { unavailable: true, reason: "NO_BOUNDED_TEXT_BODY" } };
          if (materials.reduce((n, m) => n + Buffer.byteLength(m.text), 0) + Number(entry.sizeBytes) > 512 * 1024)
            return { data: { unavailable: true, reason: "PROMPT_MATERIAL_BUDGET" } };
          const value = await service.readMaterial(actor, workspaceId, id, { componentId: entry.componentId, pathBytes: entry.pathBytes }, { generation, maxBytes: 128 * 1024 });
          let text;
          try { text = new TextDecoder("utf-8", { fatal: true }).decode(value.bytes); }
          catch { return { data: { unavailable: true, reason: "NON_UTF8_BODY" } }; }
          if (text.includes("\0")) return { data: { unavailable: true, reason: "BINARY_BODY" } };
          const assetType = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/i.test(entry.path) ? "TEST_ASSET"
            : /\.(md|rst|txt|adoc)$/i.test(entry.path) ? "DOCUMENT"
              : /\.(json|ya?ml|toml|properties|env|sql|csv)$|(^|\/)\.env(?:\.|$)/i.test(entry.path) ? "CONFIG_DATA"
                : /\.(m?[jt]sx?|c[jt]s|java|py|go|rs|cs|rb|php|c|cpp|h)$/i.test(entry.path) ? "API_CODE" : "OTHER";
          return { data: { id: value.sourceMaterial.id, sourceMaterial: value.sourceMaterial, receiptId: value.receiptId, text, kind: "RAW_MATERIAL", assetType } };
        });
        if (material.unavailable) { entry.investigationReason = material.reason;unavailableMaterialKeys.add(materialKey);return null; }
        materials.push(material); materialByKey.set(materialKey, material); return material;
      };
      for(const a of responsibilities.assignments)for(const k of a.materialKeys)await read(k);
      // Rebinding is a real B read, charged through the same admitted reader.
      // Never relabel A material ids or fabricate a new generation reservation.
      if(continuation)for(const entry of continuation.graph.dependencyReview?.entries??[])if(['PROVABLE_LOCAL','HISTORICAL_CANDIDATE_ONLY'].includes(entry.eligibility)) {
        for(const citation of entry.rawEvidence) {
          const old=continuation.graph.dependencyReview.inventory.find(m=>m.materialId===citation.materialId);
          const target=old&&index.inventory.filter(m=>m.sourceId===old.sourceId&&m.pathBytes===old.pathBytes);
          if(target?.length===1) {const inventoryEntry=inventory.find(m=>m.materialId===target[0].materialId);if(inventoryEntry)await read(inventoryEntry.key);}
        }
      }
      const reused=await stage('continuation-rebinding',async()=>({data:continuation
        ?rebindContinuation({basis:continuation.basis,graph:continuation.graph,index,materials,run}):null}));
      if(reused) {
        candidates.push(...reused.candidates);relations.push(...reused.relations);originalProposals.push(...reused.originalProposals);
        for(const p of [...reused.candidates,...reused.relations])for(const ref of p.technicalRefs)availableFactIds.add(ref);
      }
      const manifest=await stage('business-task-manifest',async()=>{
        const tasks=[],pending=[...responsibilities.pending];
        for(const assignment of responsibilities.assignments) {
          for(const k of assignment.materialKeys)if(!materialByKey.has(k))pending.push({materialKey:k,status:'PENDING',reason:byKey.get(k).investigationReason??'NO_BOUNDED_TEXT_BODY'});
          const selected=responsibilityMaterials(assignment,materialByKey);
          const task={responsibilityId:assignment.responsibilityId,question:assignment.objective,obligations:assignment.obligations,
            sharedEvidenceReason:assignment.sharedEvidenceReason,authority:'INVESTIGATION_TASK_NOT_BUSINESS_TRUTH'};
          const envelopeBytes=jsonBytes({phase:'INVESTIGATE',question:assignment.objective,investigationQuestion:run.question,task,outputContract:childContract});
          const fragmentLimit=Math.max(1024,Math.min(originalContextBytes,analysisInputBytes-envelopeBytes-stageTechnicalBytes-4096));
          const batches=selected.length?partitionOriginalMaterials(selected,fragmentLimit,{serialized:true,packRemaining:true}):[];
          for(const [part,snippets]of batches.entries()) {
            const selectionKey=hash({responsibilityId:assignment.responsibilityId,ranges:snippets.map(sourceRange)});
            const reuseProposals=(reused?.candidates??[]).filter(p=>p.evidence.every(c=>citationVisible(c,snippets)));
            const input=analysisStagePacket({phase:'INVESTIGATE',question:assignment.objective,investigationQuestion:run.question,objective:assignment.objective,
              ...(continuation?{historicalRecheck:historicalRecheckContext(continuation,reused,index,snippets)}:{}),
              ...(reuseProposals.length?{reuseProposals,continuationBasisDigest:reused.basisDigest,
                taskPurpose:'B_EVIDENCE_REVALIDATION_NOT_REGENERATION',
                reuseRules:['These proposals retain their actual A producer, not this Child reservation. Check B premises and counterexamples.',
                  'A reuse marker never establishes acceptance. Report contradictions or missing premises; Main verifies all canonical propositions.']}:{}),
              task,materials:snippets,originalContext:{maxBytes:originalContextBytes,part:part+1,totalParts:batches.length,
                rules:['Only answer this concrete subquestion and supplied range responsibility. Other fragments are NOT implicitly supplied.',
                  'Preserve global lines, missing premises, unmet obligations and cross-task leads for Main. Never claim global completion from this fragment.']},
              inventory,technicalEvidence:await technicalFor(`task-${selectionKey}`,snippets,
                reuseProposals.length?[...new Set(reuseProposals.flatMap(p=>p.technicalRefs))]:null),outputContract:{...childContract,
                obligationResults:[{obligation:'exact supplied obligation',status:'EVIDENCE_FOUND | UNRESOLVED',reason:'actual evidence or missing premise'}],
                crossTaskLeads:[{materialKey:'actual supplied inventory key',reason:'specific missing premise for Main; not a new accepted proposition'}]}}).input;
            requireF003(jsonBytes(input)<=analysisInputBytes,'F003_MODEL_INPUT_LIMIT','任务实际完整JSON超过既有界；请细化责任，不得扩大输入预算');
            tasks.push(bindBusinessTask(run,assignment,input));
          }
        }
        for(const [k,m]of materialByKey) {
          const ranges=tasks.flatMap(t=>t.input.materials.filter(s=>s.id===m.id).map(s=>[s.byteStart,s.byteEnd])).sort((a,b)=>a[0]-b[0]);
          let end=0;
          for(const [a,b]of ranges){if(a>end)pending.push({materialKey:k,status:'PENDING',reason:'UNASSIGNED_SOURCE_RANGE',
            sourceRanges:[{materialId:m.id,byteStart:end,byteEnd:a}]});end=Math.max(end,b);}
          if(end<Buffer.byteLength(m.text))pending.push({materialKey:k,status:'PENDING',reason:'UNASSIGNED_SOURCE_RANGE',
            sourceRanges:[{materialId:m.id,byteStart:end,byteEnd:Buffer.byteLength(m.text)}]});
        }
        const data={contractVersion:analysisContractVersion,sourceInputDigest:hash(run.sourceInput),responsibilities:responsibilities.assignments,tasks,pending};
        requireF003(jsonBytes(data)<2*1024*1024-1024,'F003_PLAN_MANIFEST_LIMIT','完整任务清单超过现有检查点界，不能静默删减责任');
        return {data};
      });
      const usage=(await service.get(actor,workspaceId,id)).usage;
      const budget=futureTaskBudget(manifest,{usage,maxModelCalls:run.budget.maxModelCalls,cached,
        mainKeys:cached.get('main-requirements')?.data??['consolidation','verification']});
      await stage(`task-budget-${generation}`,async()=>({data:budget}));
      requireF003(manifest.tasks.length>0,'F003_PLAN_EVIDENCE_UNAVAILABLE','没有可实际发送的有界任务原文；未完成责任和读取原因保留在清单',
        {details:{pending:manifest.pending}});
      requireF003(budget.feasible,'F003_PLAN_CALL_BUDGET','实际投影分片及未提交Main所需调用超过剩余预算；未开始任何新Child',
        {details:{...budget,pendingTasks:manifest.tasks.filter(t=>!cached.has(t.taskKey)).map(t=>({taskKey:t.taskKey,sourceRanges:t.sourceRanges}))}});
      pendingTasks.push(...manifest.pending);
      const taskReports=[];
      for(const task of manifest.tasks) {
        requireF003(task.inputDigest===taskDigest(task.input)&&task.inputBytes===jsonBytes(task.input)
          &&task.taskKey===bindBusinessTask(run,manifest.responsibilities.find(a=>a.responsibilityId===task.responsibilityId),task.input).taskKey,
        'F003_TASK_MANIFEST_MISMATCH','冻结任务身份与实际发送输入不符，不能复用结果');
        const output=await invoke(task.taskKey,task.slotId,task.input,true);
        requireF003(array(output.candidates)&&array(output.relations)&&array(output.requestedMaterialKeys??[],100)
          &&array(output.obligationResults??[],100)&&array(output.crossTaskLeads??[],100),'F003_MODEL_OUTPUT_INVALID','Child必须保留候选、关系和有界义务/缺证据线索');
        collect(task.taskKey,task.slotId,output,task.input.materials);
        const reports=task.input.task.obligations.map(obligation=>{
          const report=(output.obligationResults??[]).find(r=>r?.obligation===obligation);
          return {obligation,status:report?.status==='EVIDENCE_FOUND'?'REPORTED_NOT_VERIFIED':'UNRESOLVED',
            reason:typeof report?.reason==='string'?report.reason.slice(0,2048):'CHILD_DID_NOT_REPORT_OBLIGATION'};
        });
        taskReports.push({taskKey:task.taskKey,responsibilityId:task.responsibilityId,sourceRanges:task.sourceRanges,obligations:reports,
          crossTaskLeads:(output.crossTaskLeads??[]).filter(l=>byKey.has(l?.materialKey)&&typeof l.reason==='string').map(l=>({materialKey:l.materialKey,reason:l.reason.slice(0,2048)}))});
        requested.push(...[...(output.requestedMaterialKeys??[]),...(output.crossTaskLeads??[]).map(l=>l?.materialKey)].filter(k=>byKey.has(k)&&!materialByKey.has(k)));
      }
      requireF003(process.some(p => p.taskKey.startsWith("child-")), "F003_BUDGET_EXCEEDED", "固定预算不足以执行至少一个Child并保留Main归并核查；未调用额外模型");
      // One bounded raw-material supplement pass, never a recursive loop or a
      // newly minted technical Fact. Remaining requests remain visible gaps.
      if (requested.length > 0) {
        const selected = [];
        for (const k of [...new Set(requested)].slice(0, 20)) { const m = await read(k); if (m) selected.push(m); }
        if (selected.length > 0) {
          const context = originalEvidenceContext(candidates, materials, originalContextBytes / 2), batches = partitionOriginalMaterials(selected, originalContextBytes / 2,{serialized:true});
          let discretionaryUsed=false;
          for (const [part, snippets] of batches.entries()) {
            const supplied = [...snippets, ...context.materials];
            const input={ phase: "INVESTIGATE", question: run.question,
              objective: "补充缺证据；仅输出新增命题与关系，不重复旧命题key；引用使用原文全局行号。", materials: supplied, existingCandidates: candidates,
              evidenceContext: context.evidenceContext, outputContract: childContract };
            const assignment={slotId:responsibilities.assignments[0].slotId,responsibilityId:hash({kind:'REQUESTED_MISSING_PREMISES',
              parents:taskReports.map(t=>t.taskKey),requests:[...new Set(requested)].sort(),ranges:snippets.map(sourceRange)})};
            const selectionKey=`supplement-${assignment.responsibilityId}`;
            input.technicalEvidence=await technicalFor(selectionKey,supplied);
            const projected=analysisStagePacket(input).input;
            const bound=bindBusinessTask(run,assignment,projected),taskKey=bound.taskKey.replace(/^child-/,'supplement-');
            await stage(`compiled-${taskKey}`,async()=>({data:{...bound,taskKey}}));
            if(discretionaryUsed||!await hasChildBudget(taskKey)) {
              pendingTasks.push({taskKey,reason:discretionaryUsed?'DISCRETIONARY_SUPPLEMENT_LIMIT':'MODEL_CALL_BUDGET_RESERVED_FOR_MAIN',sourceRanges:snippets.map(sourceRange)});continue;
            }
            if(jsonBytes(projected)>analysisInputBytes) {
              pendingTasks.push({taskKey,reason:'MODEL_INPUT_BYTE_BUDGET',sourceRanges:snippets.map(sourceRange)});continue;
            }
            const output = await invoke(taskKey, assignment.slotId,projected,true);discretionaryUsed=true;
            requireF003(array(output.candidates) && array(output.relations), "F003_MODEL_OUTPUT_INVALID", "补证输出必须是有界候选与关系");
            collect(taskKey, assignment.slotId, output, supplied, packets.get(taskKey).input.existingCandidates.map(c => c.key));
          }
        }
      }
      requireF003(candidates.length <= 2000 && relations.length <= 2000, "F003_MODEL_OUTPUT_INVALID", "合并候选超过调查上限");
      await stage('main-requirements',async()=>({data:candidates.length>1||relations.length>1?['consolidation','verification']:['verification']}));
      const graphInput = { workspaceId, investigationId: id, sourceBundleId: run.sourceInput.sourceBundleSnapshotId, profileId: run.profile.id,
        adoptedVersionIds: run.adoptedVersionIds, materials, inventory, allowedFactIds: [...availableFactIds] };
      const invalidKeys = buildBusinessGraph({ ...graphInput, candidates, relations, reviews: [] }).quarantine.map(q => q.key);
      const mainContext = originalEvidenceContext([...candidates, ...relations], materials);
      const unreviewable = new Set();
      const proposalRefs=(items,invalid=invalidKeys)=>{
        const excluded=analysisExcludedKeys(items.filter(p=>'sourceKey' in p||'targetKey' in p),invalid);
        return [...new Set(items.filter(p=>!excluded.has(p.key)).flatMap(p=>p.technicalRefs??[]))];
      };
      let consolidationPlan = { mergeSuggestions: [], conflictGroups: [] };
      if (candidates.length > 1 || relations.length > 1) {
        consolidationPlan = await invoke("consolidation", run.profile.mainAgentSlot.id, { phase: "VERIFY", stage: "CONSOLIDATE_PROPOSALS",
          ...(continuation?{historicalRecheck:historicalRecheckContext(continuation,reused,index)}:{}),
          question: run.question, candidates, relations, originalProposals, invalidProposalKeys: invalidKeys,
          taskReports,pendingResponsibilities:manifest.pending,
          ...mainContext, technicalEvidence: await technicalFor('consolidation',mainContext.materials,proposalRefs([...candidates,...relations])),
          outputContract: { mergeSuggestions: [{ keys: ["2..200 supplied same-kind proposal keys"], rationale: "evidence-bounded equivalence, not votes",
            mergedProposal: "required for differing propositions: kind/name/statement/scope (or predicate/sourceKey/targetKey/scope for relations); optional exact supplied citations, technicalRefs and uncertainties" }],
            conflictGroups: [{ keys: ["supplied keys"], rationale: "unresolved business conflict, not malformed syntax" }],
            rules: ["Use task-qualified supplied keys, never local aliases.", "Do not merge different business kinds or reverse relationship direction.",
              "Leave other propositions separate; no candidate or original evidence may disappear.", "This is consolidation, not acceptance; canonical propositions receive a separate evidence-verification pass."] } });
      }
      requireF003(array(consolidationPlan.mergeSuggestions ?? []) && array(consolidationPlan.conflictGroups ?? []),
        "F003_MODEL_OUTPUT_INVALID", "Main归并与冲突编组必须是有界清单");
      const consolidationPacket=packets.get('consolidation');
      const consolidationKeys=new Set([...(consolidationPacket?.input.candidates??[]),...(consolidationPacket?.input.relations??[])].map(p=>p.key));
      const suppliedGroup=g=>!Array.isArray(g?.keys)||g.keys.every(k=>consolidationKeys.has(k));
      if(consolidationPacket)for(const gap of [...consolidationPacket.omitted,...consolidationPacket.input.evidenceContext.missingEvidence])unreviewable.add(gap.key);
      const hasContext = group => !Array.isArray(group?.keys) || !group.keys.some(k => unreviewable.has(k));
      const consolidated = await stage("consolidated-proposals", async () => {
        const data=consolidateProposals({ candidates, relations, originalProposals, invalidKeys,
        mergeSuggestions: (consolidationPlan.mergeSuggestions ?? []).filter(g=>hasContext(g)&&suppliedGroup(g)),
        conflictGroups: (consolidationPlan.conflictGroups ?? []).filter(suppliedGroup) });
        data.consolidation.outsideSuppliedContext={mergeSuggestions:(consolidationPlan.mergeSuggestions??[]).filter(g=>!suppliedGroup(g)),
          conflictGroups:(consolidationPlan.conflictGroups??[]).filter(g=>!suppliedGroup(g))};
        if(unreviewable.size) {
          data.consolidation.contextGaps=[...(consolidationPacket?.input.evidenceContext.missingEvidence??[]),...(consolidationPacket?.omitted??[])];
          data.consolidation.deferredContextSuggestions={mergeSuggestions:(consolidationPlan.mergeSuggestions??[]).filter(g=>!hasContext(g))};
        }
        return {data};
      });
      const verifyContext = originalEvidenceContext([...consolidated.candidates, ...consolidated.relations], materials);
      const invalidCanonicalKeys = new Set(buildBusinessGraph({ ...graphInput, candidates: consolidated.candidates,
        relations: consolidated.relations, reviews: [] }).quarantine.map(p => p.key));
      const verification = await invoke("verification", run.profile.mainAgentSlot.id, { phase: "VERIFY", stage: "EVIDENCE_VERIFICATION", question: run.question,
        ...(continuation?{historicalRecheck:historicalRecheckContext(continuation,reused,index)}:{}),
        candidates: consolidated.candidates, relations: consolidated.relations, consolidation: consolidated.consolidation,
        taskReports,pendingResponsibilities:manifest.pending,
        invalidProposalKeys:[...invalidCanonicalKeys],
        ...verifyContext, technicalEvidence: await technicalFor('verification',verifyContext.materials,proposalRefs([...consolidated.candidates,...consolidated.relations],[...invalidCanonicalKeys])), outputContract: { reviews: [{ key: "every supplied canonical candidate and relation key exactly once",
          support: "SUPPORTED | INSUFFICIENT | AMBIGUOUS | UNKNOWN", rationale: "inspect evidence and counterexamples, never model votes",
          premises: ["explicit conditions"], unresolvedConflicts: ["unresolved interpretations"],
          dependencyAssessment:{extent:'POSITIVE_LOCAL | NEGATIVE | UNIVERSAL | UNKNOWN',
            applicabilityEvidence:[candidateContract.evidence[0]],counterexampleEvidence:[candidateContract.evidence[0]],
            unresolvedDependencies:['missing conditions, callers, exceptions or dynamic premises; never claim completeness from unchanged source'],
            rationale:'For a positive local hypothesis, explain actual applicability and examined counterexamples. This is NOT a dependency-completeness certificate.'} }],
          rules: ["Check the canonical proposition against all original members and actual evidence.", "Do not introduce unverified new merges; retain any unresolved conflict."] } });
      requireF003(array(verification.reviews, 4000) && array(verification.mergeSuggestions ?? []) && array(verification.conflictGroups ?? []),
        "F003_MODEL_OUTPUT_INVALID", "Main必须保留有界核查、归并及冲突结果");
      const verificationPacket=packets.get('verification');
      const suppliedVerificationKeys=new Set([...(verificationPacket.input.candidates??[]),...(verificationPacket.input.relations??[]),
        ...(verificationPacket.input.consolidation?.originalProposals??[])].map(p=>p.key??p.id));
      for (const gap of [...verificationPacket.input.evidenceContext.missingEvidence,...verificationPacket.omitted]) unreviewable.add(gap.key);
      const fullScopeRechecked=!manifest.pending.some(p=>byKey.get(p.materialKey)?.kind!=='DIRECTORY')
        &&taskReports.every(t=>t.obligations.every(o=>o.status==='REPORTED_NOT_VERIFIED'))
        &&inventory.filter(m=>m.kind==='FILE').every(m=>{
          const ranges=process.filter(p=>p.taskKey?.startsWith('child-')).flatMap(p=>p.sourceRanges??[])
            .filter(r=>r.materialId===m.materialId).sort((a,b)=>a.byteStart-b.byteStart);
          let end=0;for(const r of ranges){if(r.byteStart>end)return false;end=Math.max(end,r.byteEnd);}
          return end===Number(m.sizeBytes);
        });
      const reviews = verification.reviews.map(review => {
        const assessment=review?.dependencyAssessment;
        if(assessment&&(!Array.isArray(assessment.applicabilityEvidence)||!Array.isArray(assessment.counterexampleEvidence)
          ||[...assessment.applicabilityEvidence,...assessment.counterexampleEvidence]
            .some(c=>!citationVisible(c,verificationPacket.input.materials))))review={...review,support:'UNKNOWN',
            dependencyGuard:{code:'UNSUPPLIED_DEPENDENCY_CONTEXT',originalReview:structuredClone(review)}};
        const proposal=[...consolidated.candidates,...consolidated.relations].find(p=>p.key===review?.key);
        const guarded=proposal?guardHistoricalReview(proposal,review,{materials:verificationPacket.input.materials,fullScopeRechecked}):review;
        return unreviewable.has(review?.key) ? { ...guarded, support: "UNKNOWN",
          contextGuard: { code: "ORIGINAL_CONTEXT_INCOMPLETE", originalReview: structuredClone(review) } } : guarded;
      });
      // A late proposal is evidence of unfinished work, not permission to mutate
      // the canonical graph after verification. Retain it and its affected
      // source mappings; a generic SUPPORTED review cannot erase the conflict.
      const aliases = new Map(consolidated.consolidation.sourceToCanonical.map(m => [m.sourceKey, m.canonicalKey]));
      const canonicalKeys = new Set([...consolidated.candidates, ...consolidated.relations].map(p => p.key));
      const validConflictSource = key => suppliedVerificationKeys.has(key) && (aliases.has(key) || canonicalKeys.has(key)) && !invalidKeys.includes(key)
        && !invalidCanonicalKeys.has(aliases.get(key) ?? key);
      for (const [field, pending, code, status] of [["mergeSuggestions", "pendingMergeSuggestions", "LATE_MERGE_REQUIRES_RECHECK", "UNRESOLVED"],
        ["conflictGroups", "pendingConflictGroups", "BUSINESS_CONFLICT", "CONFLICT"]]) {
        const groups = [];
        for (const g of verification[field] ?? []) {
          const declared = Array.isArray(g?.keys) ? [...new Set(g.keys)] : [], keys = declared.filter(validConflictSource);
          if (keys.length < 2) {
            const rejected = field === "conflictGroups" ? "rejectedConflictGroups" : "rejectedMergeSuggestions";
            (consolidated.consolidation[rejected] ??= []).push({ proposal: g, reason: "INVALID_CONFLICT_SOURCE" }); continue;
          }
          groups.push({ ...g, keys, reportedKeys: declared });
        }
        if (groups.length === 0) continue;
        consolidated.consolidation[pending] = groups;
        const keys = new Set(groups.flatMap(g => g.keys).map(k => aliases.get(k) ?? k));
        for (const p of [...consolidated.candidates, ...consolidated.relations]) if (keys.has(p.key)) p.consolidationIssues.push(code);
        for (const mapping of consolidated.consolidation.sourceToCanonical) if (keys.has(mapping.canonicalKey)
          && mapping.status !== "INVALID" && (mapping.status !== "CONFLICT" || status === "CONFLICT")) mapping.status = status;
      }
      let graph = buildBusinessGraph({ ...graphInput, candidates: consolidated.candidates, relations: consolidated.relations,
        consolidation: consolidated.consolidation, reviews,
        process: [...process, { stage: "TRIAGE", remainingEvidenceRequests: [...new Set(requested)].filter(k => !materialByKey.has(k)),
          pendingTasks, taskReports, taskManifestDigest:hash(manifest),originalContextGaps: [...verificationPacket.input.evidenceContext.missingEvidence,...verificationPacket.omitted],
          technicalEvidenceTruncated: technical.truncated }] });
      const resultDependencies=await stage('dependency-result-index',async()=>({data:service.dependencyEvidence
        ?await service.dependencyEvidence(actor,workspaceId,id,{generation,
          factIds:[...new Set([...graph.candidates,...graph.relations].flatMap(p=>p.technicalRefs))],
          localProofMaterialIds:graph.candidates.filter(p=>p.dependencyScope?.kind==='LOCAL_RETURN_LITERAL').flatMap(p=>p.evidence.map(e=>e.materialId))})
        :{rows:[],profiles:[],inventory:[],status:'INCOMPLETE'}}));
      const dependencyReview=recordDependencies(graph,materials,dependencyIndex({...resultDependencies,bundleId:run.sourceInput.sourceBundleSnapshotId,workspaceId}));
      const acceptedReuse=(reused?.proofs??[]).filter(proof=>[...graph.candidates,...graph.relations].some(p=>p.reuse?.reuseProofDigest===proof.reuseProofDigest
        &&p.state==='ANALYSIS_ACCEPTED'));
      const continuationSummary=reused?{mode:acceptedReuse.length?'INCREMENTAL_A_TO_B':'FULL_B_FALLBACK',
        authority:'MECHANICAL_LINEAGE_NOT_SEMANTIC_QUALITY',
        dependencyCompleteness:'UNPROVEN_EXCEPT_RESTRICTED_LOCAL_SYNTAX',
        currentVerification:'MAIN_REPORTED_NOT_INDEPENDENT_QUALITY',
        basisDigest:reused.basisDigest,reasons:acceptedReuse.length?[]:[...(reused.reasons??[]),'NO_CURRENT_ACCEPTED_REUSE'],
        dispositions:reused.dispositions.map(d=>d.targetKey?{...d,targetKey:aliases.get(d.targetKey)??d.targetKey,status:acceptedReuse.some(p=>p.sourceKey===d.sourceKey)
          ?'REVALIDATED_REUSE':'PENDING_B_RECHECK'}:d),
        proofs:reused.proofs,reusedSemanticResultDigest:acceptedReuse.length?dependencyDigest(acceptedReuse):null}:null;
      graph=buildBusinessGraph({...graphInput,candidates:consolidated.candidates,relations:consolidated.relations,
        consolidation:consolidated.consolidation,reviews,process:graph.process,dependencyReview,
        ...(continuationSummary?{continuation:continuationSummary}:{})});
      return await service.complete(actor, workspaceId, id, { generation, graph });
    } catch (error) {
      await service.expire(actor, workspaceId, id).catch(() => {});
      if (error instanceof F003HostShutdown && error === controller.signal.reason) {
        await service.releaseForShutdown(actor, workspaceId, id, { generation, workerId }).catch(() => {});
      } else await service.fail(actor, workspaceId, id, { generation, code: error?.code, ...failureContext }).catch(() => {});
      throw error;
    } finally {
      clearInterval(timer); signal?.removeEventListener("abort", abort);
      if (this.controllers.get(controllerKey) === controller) this.controllers.delete(controllerKey);
    }
  }
}
