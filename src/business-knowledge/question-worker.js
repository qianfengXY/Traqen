import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { publicationDigest as digest } from "./publication-authority.js";
import { requireF003, F003HostShutdown } from "./errors.js";
import { abortable } from "./worker.js";
import { citationVisible, sourceRange } from "./model-context.js";
import { questionPremiseResolver } from "./question-context.js";
import { analysisInputBytes, jsonBytes, questionPlanPacket, questionStagePacket, questionStageContractVersion } from "./stage-context.js";

const list = (v, max = 512) => Array.isArray(v) && v.length <= max;
const text = (v, max = 16384) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const fields=(v,allowed)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).every(k=>allowed.includes(k));
export const questionContractVersion = questionStageContractVersion;
const segmentContract = { key: "unique task-local key", text: "one evidence-bounded derived statement", stance: "SUPPORTED | UNKNOWN",
  graphRefs: ["supplied exact graph object or directed relationship key"], evidence: [{ materialId: "supplied material id", startLine: 1, endLine: 1, quote: "exact supplied original text" }],
  technicalRefs: ["optional supplied adopted Fact id"], uncertainties: ["explicit missing premises or unresolved conflicts"] };

// Shares the durable investigation scheduler, leases, F006 port and budgets.
// This worker can only save a derived Answer, never a Graph/Decision/Execution.
export class QuestionWorker {
  constructor({ investigations, workSessions, invokeModel }) {
    Object.assign(this, { investigations, workSessions, invokeModel }); this.controllers = new Map();
  }
  stop(workspaceId, id) { this.controllers.get(`${workspaceId}\0${id}`)?.abort(new Error("F003 question stopped")); }
  async run(actor, workspaceId, id, { workerId, leaseMs = 60000, signal = null } = {}) {
    const service = this.investigations;
    requireF003((await service.get(actor, workspaceId, id)).purpose === "GRAPH_QUESTION", "F003_QA_WRONG_WORKER", "仅处理明确的图谱问题");
    signal?.throwIfAborted(); await service.expire(actor, workspaceId, id); signal?.throwIfAborted();
    const run = await service.claim(actor, workspaceId, id, { workerId, leaseMs }), { generation } = run;
    const controller = new AbortController(), controllerKey = `${workspaceId}\0${id}`;
    this.controllers.set(controllerKey, controller);
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    let renewing = false, failureContext = {};
    const timer = setInterval(async () => {
      if (renewing) return; renewing = true;
      try { await service.heartbeat(actor, workspaceId, id, { generation, leaseMs }); }
      catch (error) { controller.abort(error); } finally { renewing = false; }
    }, Math.max(100, Math.floor(leaseMs / 3))); timer.unref();
    try {
      const context = await this.workSessions.executionContext(actor, workspaceId, run.questionContext.sessionId, id);
      const binding = digest({ questionContractVersion, requestDigest: context.request.requestDigest, sourceInput: run.sourceInput,
        profileId: run.profile.id, adoptedVersionIds: run.adoptedVersionIds });
      const history = await service.checkpoints(actor, workspaceId, id), process = [];
      requireF003(!history.some(p=>p.key.startsWith('qa-') && p.payload?.binding && p.payload.binding!==binding),
        'F003_QA_CONTRACT_CHANGED','旧问答检查点的核查合同已变化；保留原预算与历史，请明确创建新问题');
      const cached = new Map(history.filter(p => p.payload?.binding === binding).map(p => [p.key, p.payload]));
      const stage = async (key, work, detail = { taskKey: key }) => {
        failureContext = detail; controller.signal.throwIfAborted();
        if (cached.has(key)) {
          await service.heartbeat(actor, workspaceId, id, { generation, leaseMs });
          const value = cached.get(key); if (value.process) process.push({ ...value.process, reusedFromCheckpoint: true });
          return structuredClone(value.data);
        }
        const value = await work(); controller.signal.throwIfAborted();
        await service.checkpoint(actor, workspaceId, id, { generation, key, payload: { binding, ...value } });
        if (value.process) process.push(value.process); return value.data;
      };
      const invoke = (taskKey, slotId, input) => stage(taskKey, async () => {
        requireF003(jsonBytes(input) <= analysisInputBytes, "F003_MODEL_INPUT_LIMIT", "问答完整JSON输入超预算；未发送超限调用");
        const output = await abortable(controller.signal, () => this.invokeModel({ actor, workspaceId, investigationId: id, generation,
          slotId, taskKey, input, signal: controller.signal }));
        requireF003(output?.reservationId && output.result && typeof output.result === "object" && !Array.isArray(output.result)
          && Buffer.byteLength(JSON.stringify(output.result)) <= 1024 * 1024, "F003_MODEL_OUTPUT_INVALID", "问答模型须返回有界结构化结果");
        return { data: output.result, process: { taskKey, slotId, generation, reservationId: output.reservationId,
          modelRevisionId: [run.profile.mainAgentSlot, ...run.profile.childAgentSlots].find(s => s.id === slotId)?.modelProfileRevisionId,
          inputDigest: digest(input), outputDigest: digest(output.result), sourceRanges: (input.materials ?? []).map(sourceRange),
          inputBytes:jsonBytes(input),maxInputBytes:analysisInputBytes,technicalContextBytes:jsonBytes(input.technicalEvidence),
          resourceContext:input.resourceContext } };
      }, { phase: input.phase, taskKey, slotId });
      const objects = context.request.graphView, byKey = new Map(objects.map(o => [o.key, o]));
      const technical = await stage("qa-technical", async () => ({ data: await service.technicalEvidence(actor, workspaceId, id,
        { generation,selection:{factIds:[...new Set([...objects,...context.endpoints].flatMap(o=>o.technicalRefs??[]))]} }) }));
      const premises = questionPremiseResolver(objects, context.endpoints, technical);
      const plan = await invoke("qa-plan", run.profile.mainAgentSlot.id, questionPlanPacket({ phase: "PLAN", operation: "GRAPH_QUESTION_PLAN", question: run.question,
        binding: run.questionContext, objects, endpoints: context.endpoints, technicalEvidence: technical, budget: run.budget,
        childSlots: run.profile.childAgentSlots.map(s => ({ id: s.id })),
        outputContract: { assignments: [{ slotId: "configured Child id", objectKeys: ["explicit supplied object keys"] }],
          rules: ["At least one Child. Cover every selected object at least once; bounded independent overlap is allowed, never silently omit scope.", "Routing summaries are not citable evidence. This is derived question answering, never human authority or execution proof."] } }));
      const childIds = new Set(run.profile.childAgentSlots.map(s => s.id)), assigned = [];
      requireF003(list(plan.assignments, 30) && plan.assignments.length > 0 && plan.assignments.every(a => childIds.has(a?.slotId)
        && list(a.objectKeys) && a.objectKeys.length > 0 && new Set(a.objectKeys).size===a.objectKeys.length
        && a.objectKeys.every(k => byKey.has(k))), "F003_MODEL_OUTPUT_INVALID", "问答Main须分派真实Child和本版对象");
      for (const a of plan.assignments) assigned.push(...a.objectKeys);
      requireF003(new Set(assigned).size === byKey.size
        && plan.assignments.length + 2 <= run.budget.maxModelCalls, "F003_QA_PLAN_INCOMPLETE", "问答计划必须在固定预算内覆盖明确选择的全部对象");
      const materialIds = premises.materialIds, materials = [], readGaps = [];
      for (const materialId of materialIds) {
        const entry = context.materials.find(m => m.id === materialId), coverage = context.coverage.find(m => m.materialId === materialId);
        const body = await stage(`qa-material-${materialId}`, async () => {
          const size = Number(coverage?.sizeBytes), current = await service.get(actor, workspaceId, id);
          if (!entry?.sourceMaterial || !Number.isSafeInteger(size) || size < 0 || size > 128 * 1024
            || current.usage.readBytes + size > run.budget.maxReadBytes) return { data: { unavailable: true, materialId, reason: "BOUNDED_ORIGINAL_UNAVAILABLE" } };
          const raw = await service.readMaterial(actor, workspaceId, id, { componentId: entry.sourceMaterial.componentId,
            pathBytes: entry.sourceMaterial.pathBytes }, { generation, maxBytes: 128 * 1024 });
          requireF003(raw.sourceMaterial.id === materialId, "F003_QA_SOURCE_MISMATCH", "原文不属于图谱固定材料");
          let value;
          try { value = new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes); }
          catch { return { data: { unavailable: true, materialId, reason: "NON_UTF8_BODY" } }; }
          return { data: value.includes("\0") ? { unavailable: true, materialId, reason: "BINARY_BODY" }
            : { ...entry, text: value } };
        });
        if (body.unavailable) readGaps.push(body); else materials.push(body);
      }
      const drafts = [], suppliedByTask = new Map(),pendingObjects=[];
      for (const [index, assignment] of plan.assignments.entries()) {
        const selected = assignment.objectKeys.map(k => byKey.get(k));
        const taskKey = `qa-child-${index}`;
        const draftPacket=questionStagePacket({phase:"ANSWER",operation:"DRAFT",question:run.question,
          binding:run.questionContext,objects:selected,endpoints:context.endpoints,technicalEvidence:technical,
          readGaps, outputContract: { segments: [segmentContract], unknowns: ["explicit remaining gaps"],
            rules: ["All assertions occur only in segments. Reference only assigned graph objects and supplied original ranges.",
              "An accepted analysis is not a human decision, a passed test or runtime environment evidence.", "Conflicts, incomplete premises and missing original context must remain UNKNOWN."] } },{materials});
        pendingObjects.push(...draftPacket.omitted.map(p=>({...p,taskKey})));
        if(!draftPacket.input?.objects.length) {
          drafts.push({taskKey,segments:[],unknowns:["MODEL_INPUT_BYTE_BUDGET: assigned objects could not fit; no evidence or model support was invented."]});continue;
        }
        const output = await invoke(taskKey, assignment.slotId,draftPacket.input);
        requireF003(fields(output,['segments','unknowns']) && list(output.segments, 128) && list(output.unknowns ?? [], 128)
          && (output.segments.length>0 || (output.unknowns??[]).length>0) && (output.unknowns ?? []).every(v => text(v))
          && output.segments.every(s => fields(s,['key','text','stance','graphRefs','evidence','technicalRefs','uncertainties'])
            && text(s?.key, 128) && text(s.text) && ["SUPPORTED", "UNKNOWN"].includes(s.stance)
            && list(s.graphRefs) && s.graphRefs.every(k=>text(k,128)) && list(s.evidence)
            && s.evidence.every(c=>fields(c,['materialId','startLine','endLine','quote']))
            && list(s.technicalRefs ?? []) && (s.technicalRefs??[]).every(k=>text(k,128)) && list(s.uncertainties ?? [], 128)
            && (s.uncertainties ?? []).every(v => text(v))) && new Set(output.segments.map(s => s.key)).size === output.segments.length,
        "F003_MODEL_OUTPUT_INVALID", "Child答案须保留片段、引用及未知，不接受无依据肯定正文");
        const segments = output.segments.map(s => ({ ...s, localKey: s.key, key: digest({ id, taskKey, key: s.key }),
          origin: { taskKey, slotId: assignment.slotId }, technicalRefs: s.technicalRefs ?? [], uncertainties: s.uncertainties ?? [] }));
        drafts.push({ taskKey, segments, unknowns: output.unknowns ?? [] });
        suppliedByTask.set(taskKey, {selected:draftPacket.input.objects,...draftPacket.input});
      }
      requireF003(process.some(p=>p.taskKey.startsWith('qa-child-')),'F003_MODEL_INPUT_LIMIT','本轮没有可完整发送给Child的对象；保留读取预算及明确失败，不伪造问答核查');
      const segments = drafts.flatMap(d => d.segments);
      // Validate source identities before building Main's raw packet. Invalid
      // Child references cannot consume the valid branches' premise budget.
      const referenceReasons = new Map(segments.map(s => {
        const supplied = suppliedByTask.get(s.origin.taskKey), reasons = [], refs = s.graphRefs.map(k => supplied.selected.find(o => o.key === k));
        if (!refs.length || refs.some(o => !o || o.state !== "ANALYSIS_ACCEPTED")) reasons.push("GRAPH_REFERENCE_NOT_SUPPORTED");
        if (!s.evidence.length || s.evidence.some(c => !refs.some(o => (o?.evidence ?? []).some(e => digest(e) === digest(c))))
          || refs.some(o=>!(o?.evidence??[]).some(e=>s.evidence.some(c=>digest(e)===digest(c))))) reasons.push("INVALID_ORIGINAL_REFERENCE");
        if (s.evidence.some(c=>!citationVisible(c,supplied.materials))) reasons.push('ORIGINAL_CONTEXT_INCOMPLETE');
        if (s.technicalRefs.some(f => !supplied.technicalEvidence.allowedFactIds.includes(f) || !refs.some(o => (o?.technicalRefs ?? []).includes(f)))) reasons.push("INVALID_TECHNICAL_REFERENCE");
        return [s.key, reasons];
      }));
      const packet = questionStagePacket({ phase: "ANSWER", operation: "VERIFY", question: run.question,
        binding: run.questionContext, objects, endpoints: context.endpoints, technicalEvidence: technical, readGaps,
        outputContract: { reviews: [{ key: "supplied qualified answer segment key", support: "SUPPORTED | UNKNOWN | INSUFFICIENT | CONFLICT",
          rationale: "evidence and premises, not votes", unresolvedConflicts: ["remaining conflicts"] }],
          rules: ["Verify ALL graph/endpoint/technical original premises in evidenceContext, not only the Child's citation subset; UNKNOWN if incomplete or disputed.", "Never grant human authority or execution status through an answer."] } },
      {drafts,materials,eligible:s=>!referenceReasons.get(s.key).some(r=>r!=='ORIGINAL_CONTEXT_INCOMPLETE')});
      const original = packet.input ?? {materials:[],evidenceContext:{missingEvidence:[],premises:[]}};
      const verification = packet.input ? await invoke("qa-verify", run.profile.mainAgentSlot.id, packet.input) : {reviews:[]};
      requireF003(fields(verification,['reviews','conflictGroups','unresolvedConflicts']) && list(verification.reviews, 3840)
        && verification.reviews.every(r=>fields(r,['key','support','rationale','unresolvedConflicts','premises'])) && list(verification.conflictGroups ?? [],512)
        && list(verification.unresolvedConflicts ?? [],512), "F003_MODEL_OUTPUT_INVALID", "Main问答核查结果无效");
      const reviewMap = new Map();
      for (const review of verification.reviews) { const values = reviewMap.get(review?.key) ?? []; values.push(review); reviewMap.set(review?.key, values); }
      const missing = new Set([...original.evidenceContext.missingEvidence,...packet.omitted].map(e => e.key));
      const checked = segments.map(s => {
        const supplied = suppliedByTask.get(s.origin.taskKey), reasons = [...referenceReasons.get(s.key)], refs = s.graphRefs.map(k => supplied.selected.find(o => o.key === k));
        if (refs.some(o => (o?.consolidationIssues ?? []).length > 0 || (o?.verification?.unresolvedConflicts ?? []).length > 0)) reasons.push("UNRESOLVED_GRAPH_CONFLICT");
        if (missing.has(s.key) || refs.some(o => supplied.evidenceContext.missingEvidence.some(g => g.key === o?.key))) reasons.push("ORIGINAL_CONTEXT_INCOMPLETE");
        if (s.evidence.some(c => !citationVisible(c, original.materials))) reasons.push("ORIGINAL_CONTEXT_INCOMPLETE");
        if(s.technicalRefs.some(f=>!packet.input?.technicalEvidence.allowedFactIds.includes(f)))reasons.push('TECHNICAL_CONTEXT_INCOMPLETE');
        const actualPremises=packet.resolver?.forKeys(s.graphRefs);
        if(!actualPremises)reasons.push('ORIGINAL_CONTEXT_INCOMPLETE');
        else if(actualPremises.gaps.length)reasons.push(...actualPremises.gaps);
        const reviews = reviewMap.get(s.key) ?? [], review = reviews[0];
        if (reviews.length !== 1 || review?.support !== "SUPPORTED" || !text(review?.rationale)
          || !list(review?.unresolvedConflicts) || review.unresolvedConflicts.length > 0) reasons.push("NOT_INDEPENDENTLY_SUPPORTED");
        if (s.stance !== "SUPPORTED") reasons.push("CHILD_UNKNOWN");
        return { ...s, stance: reasons.length ? "UNKNOWN" : "SUPPORTED", guardReasons: [...new Set(reasons)], verification: review ?? null };
      });
      const conflicts=[], rejectedConflictGroups=[];
      const eligible=new Set(checked.filter(s=>s.graphRefs.length && s.graphRefs.every(k=>byKey.has(k) && byKey.get(k).state!=='QUARANTINED')
        && !s.guardReasons.some(r=>['INVALID_ORIGINAL_REFERENCE','INVALID_TECHNICAL_REFERENCE'].includes(r))).map(s=>s.key));
      for(const group of verification.conflictGroups ?? []) {
        const keys=list(group?.keys,512)?[...new Set(group.keys)].filter(k=>eligible.has(k)):[];
        if(keys.length<2) {rejectedConflictGroups.push({proposal:group,reason:'INVALID_CONFLICT_SOURCE'});continue;}
        conflicts.push({keys,reportedKeys:group.keys,rationale:typeof group.rationale==='string'?group.rationale:null});
        for(const s of checked) if(keys.includes(s.key)) {s.stance='UNKNOWN';s.guardReasons.push('UNRESOLVED_ANSWER_CONFLICT');}
      }
      if((verification.unresolvedConflicts ?? []).length) for(const s of checked) {s.stance='UNKNOWN';s.guardReasons.push('UNRESOLVED_ANSWER_CONTEXT');}
      const answer = await stage("qa-answer", async () => ({ data: { id: randomUUID(), kind: "DERIVED_KNOWLEDGE_ANSWER", authority: "DERIVED_ANALYSIS_NOT_BUSINESS_AUTHORITY",
        investigationId: id, binding: run.questionContext, sourceInput:run.sourceInput, questionContractVersion,
        profileId: run.profile.id, implementationVersion: run.implementationVersion,
        requestDigest: context.request.requestDigest, segments: checked, unknowns: [...drafts.flatMap(d => d.unknowns),
          ...pendingObjects.map(p=>`UNKNOWN ${p.key}: ${p.reason}`)], readGaps,
        premiseContext: {...original.evidenceContext,omittedSegments:packet.omitted,pendingObjects},
        conflicts,rejectedConflictGroups,unresolvedConflicts:verification.unresolvedConflicts ?? [],
        process, usage: (await service.get(actor, workspaceId, id)).usage,
        limits: ["No graph, human Decision or Execution is modified. Static test assets do not establish a passed execution.",
          "Only the explicitly bound graph and supplied original ranges were considered; semantic accuracy requires independent evaluation."],
        createdAt: new Date().toISOString() } }));
      return await service.completeQuestion(actor, workspaceId, id, { generation, answer });
    } catch (error) {
      await service.expire(actor, workspaceId, id).catch(() => {});
      if (error instanceof F003HostShutdown && error === controller.signal.reason)
        await service.releaseForShutdown(actor, workspaceId, id, { generation, workerId }).catch(() => {});
      else await service.fail(actor, workspaceId, id, { generation, code: error?.code, ...failureContext }).catch(() => {});
      throw error;
    } finally {
      clearInterval(timer); signal?.removeEventListener("abort", abort);
      if (this.controllers.get(controllerKey) === controller) this.controllers.delete(controllerKey);
    }
  }
}
