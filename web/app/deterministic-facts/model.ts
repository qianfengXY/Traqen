export const evidenceTabs = ["objects", "relations", "coverage", "delivery"] as const;
export { OperationJournal } from "./operations.ts";
export { rememberEvidenceView, restoreEvidenceView } from "./view-state.ts";
export { controlledTextWindow } from "./text-window.ts";
export { matchEvidenceRecords, filterEvidenceMaterials } from "./search.ts";
export { filterRelationFacts, projectEvidenceGraph, filterEvidenceGaps } from "./traversal.ts";
export { projectEvidenceDirectory } from "./directory.ts";
export { explainEvidenceRecord } from "./explanation.ts";
export { sourceAnchorTextRange } from "./source-anchor.ts";
import type { EvidenceRequest, FactRecord } from "./types.ts";
import { boundedTextRange } from "./text-window.ts";
export type EvidenceTab = typeof evidenceTabs[number];
export type ReturnContext = {
  page: "overview" | "graph"; workspaceId: string; objectId?: string; graphRevisionId?: string;
  section?: string; scrollTop?: number; focusId?: string;
};
export type EvidenceLocation = {
  workspaceId: string; graphVersionId?: string; preview?: { runId: string; scopeId: string; revision: number }; runId?: string; step?: number; tab: EvidenceTab; kind?: string; recordId?: string; line?: number; lineEnd?: number; windowLine?: number;
  sourceVersionId?: string; businessGraphRevisionId?: string; returnTo?: ReturnContext;
  graphRootId?: string; relationReturn?: { factId: string; rootId: string; scrollTop: number };
};

const digest = /^[a-f0-9]{64}$/;
const locator = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

function validate(context: EvidenceLocation) {
  if (!locator(context.workspaceId) || !evidenceTabs.includes(context.tab)) throw new Error("证据工作区或页签定位无效");
  if (context.step !== undefined && (!Number.isInteger(context.step) || context.step < 1 || context.step > 5)) throw new Error("分析步骤无效");
  if (context.runId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(context.runId)) throw new Error("运行定位无效");
  if (context.preview && (context.graphVersionId || !/^[A-Za-z0-9_-]{1,128}$/.test(context.preview.runId) || !digest.test(context.preview.scopeId)
    || !Number.isSafeInteger(context.preview.revision) || context.preview.revision < 1)) throw new Error("未封存成果定位无效");
  if (context.graphVersionId !== undefined && !digest.test(context.graphVersionId)) throw new Error("必须引用精确事实集版本");
  if (context.sourceVersionId !== undefined && !digest.test(context.sourceVersionId)) throw new Error("来源版本定位无效");
  if (context.businessGraphRevisionId !== undefined && !locator(context.businessGraphRevisionId)) throw new Error("业务图修订定位无效");
  if (context.recordId !== undefined || context.kind !== undefined) {
    if (!(context.graphVersionId || context.preview) || !digest.test(context.recordId ?? "") || !/^[A-Z_]{1,64}$/.test(context.kind ?? "")) throw new Error("记录引用必须包含固定事实集、类型和 ID");
  }
  if (context.line !== undefined && (!Number.isInteger(context.line) || context.line < 1 || context.line > 10_000_000)) throw new Error("材料行定位无效");
  if (context.lineEnd !== undefined || context.windowLine !== undefined) {
    if (context.line === undefined || !context.recordId) throw new Error("材料行范围必须绑定精确记录和起始行");
    boundedTextRange(context.line, context.lineEnd);
    if (context.windowLine !== undefined) boundedTextRange(context.windowLine);
  }
  if (context.graphRootId !== undefined && (!(context.graphVersionId || context.preview) || !digest.test(context.graphRootId))) throw new Error("关系图根定位无效");
  if (context.relationReturn && (!(context.graphVersionId || context.preview) || !digest.test(context.relationReturn.factId) || !digest.test(context.relationReturn.rootId)
    || !Number.isFinite(context.relationReturn.scrollTop) || context.relationReturn.scrollTop < 0 || context.relationReturn.scrollTop > 10_000_000)) throw new Error("关系返回定位无效");
  const back = context.returnTo;
  if (back) {
    if (!["overview", "graph"].includes(back.page) || back.workspaceId !== context.workspaceId) throw new Error("返回上下文必须指向同一工作区的内部答卷或会话入口");
    for (const key of ["objectId", "graphRevisionId", "section", "focusId"] as const) if (back[key] !== undefined && !locator(back[key])) throw new Error("返回定位无效");
    if (back.scrollTop !== undefined && (!Number.isFinite(back.scrollTop) || back.scrollTop < 0 || back.scrollTop > 10_000_000)) throw new Error("返回阅读位置无效");
  }
}

export function evidenceHref(context: EvidenceLocation) {
  validate(context);
  const params = new URLSearchParams({ page: "evidence", workspace: context.workspaceId, tab: context.tab });
  for (const [key, value] of [["factset", context.graphVersionId], ["source", context.sourceVersionId], ["businessGraph", context.businessGraphRevisionId],
    ["kind", context.kind], ["record", context.recordId], ["line", context.line], ["lineEnd", context.lineEnd], ["windowLine", context.windowLine], ["graphRoot", context.graphRootId]] as const) if (value !== undefined) params.set(key, String(value));
  if (context.preview) { params.set("run", context.preview.runId); params.set("scope", context.preview.scopeId); params.set("revision", String(context.preview.revision)); }
  else if (context.runId) params.set("run", context.runId);
  if (context.step) params.set("step", String(context.step));
  if (context.relationReturn) {
    const { factId, rootId, scrollTop } = context.relationReturn;
    params.set("relationReturn", JSON.stringify({ factId, rootId, scrollTop }));
  }
  if (context.returnTo) {
    // Explicitly copy permitted navigation metadata; never serialize a caller's
    // whole object, credentials, raw material, or an arbitrary return URL.
    const { page, workspaceId, objectId, graphRevisionId, section, scrollTop, focusId } = context.returnTo;
    params.set("return", JSON.stringify({ page, workspaceId, objectId, graphRevisionId, section, scrollTop, focusId }));
  }
  return `/?${params}`;
}

export function readEvidenceLocation(search: string): EvidenceLocation {
  const params = new URLSearchParams(search);
  const result: EvidenceLocation = { workspaceId: params.get("workspace") ?? "", tab: (params.get("tab") ?? "objects") as EvidenceTab };
  for (const [parameter, key] of [["factset", "graphVersionId"], ["source", "sourceVersionId"], ["businessGraph", "businessGraphRevisionId"], ["kind", "kind"], ["record", "recordId"], ["graphRoot", "graphRootId"]] as const) {
    const value = params.get(parameter);
    if (value !== null) result[key] = value;
  }
  for (const key of ["line", "lineEnd", "windowLine"] as const) {
    if (params.has(key)) { if (!/^\d+$/.test(params.get(key) ?? "")) throw new Error("材料行范围定位无效"); result[key] = Number(params.get(key)); }
  }
  if (params.has("relationReturn")) {
    const raw = JSON.parse(params.get("relationReturn")!);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("关系返回定位无效");
    const { factId, rootId, scrollTop } = raw;
    result.relationReturn = { factId, rootId, scrollTop };
  }
  if (params.has("return")) {
    let raw: ReturnContext;
    try { raw = JSON.parse(params.get("return") ?? ""); } catch { throw new Error("返回上下文无效"); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("返回上下文无效");
    const { page, workspaceId, objectId, graphRevisionId, section, scrollTop, focusId } = raw;
    result.returnTo = Object.fromEntries(Object.entries({ page, workspaceId, objectId, graphRevisionId, section, scrollTop, focusId }).filter(([, value]) => value !== undefined)) as ReturnContext;
  }
  if (params.has("run")) result.runId = params.get("run")!;
  if (params.has("scope") || params.has("revision")) {
    if (!/^[1-9][0-9]{0,8}$/.test(params.get("revision") ?? "")) throw new Error("成果修订定位无效");
    result.preview = { runId: params.get("run") ?? "", scopeId: params.get("scope") ?? "", revision: Number(params.get("revision")) };
  }
  if (params.has("step")) { if (!/^[1-5]$/.test(params.get("step") ?? "")) throw new Error("分析步骤无效"); result.step = Number(params.get("step")); }
  validate(result);
  return result;
}

// This is a UI/cache locator, never a published graphVersionId or an authority.
export function evidenceResultKey(context: Pick<EvidenceLocation, "graphVersionId" | "preview">): string {
  return context.preview ? `unsealed:${context.preview.runId}:${context.preview.scopeId}:${context.preview.revision}` : context.graphVersionId ?? "";
}

export function relationEndpointLocation(context: EvidenceLocation, relation: FactRecord, endpointId: string, scrollTop: number): EvidenceLocation {
  validate(context);
  if (relation.kind !== "FACT" || relation.payload.kind !== "RELATION" || ![relation.payload.subjectId, relation.payload.targetId].includes(endpointId)) throw new Error("关系端点定位无效");
  const next: EvidenceLocation = { ...context, step: context.step === undefined ? undefined : 3, tab: "objects", kind: "OBJECT", recordId: endpointId, line: undefined, lineEnd: undefined, windowLine: undefined,
    relationReturn: { factId: relation.id, rootId: context.graphRootId ?? relation.id, scrollTop } };
  validate(next); return next;
}

export function evidenceRelationReturn(context: EvidenceLocation): EvidenceLocation | null {
  validate(context);
  if (!context.relationReturn) return null;
  return { ...context, step: context.step === undefined ? undefined : 3, tab: "relations", kind: "FACT", recordId: context.relationReturn.factId, graphRootId: context.relationReturn.rootId, line: undefined, lineEnd: undefined, windowLine: undefined };
}

export function evidenceReturnHref(context: EvidenceLocation) {
  validate(context);
  if (!context.returnTo) return null;
  const back = context.returnTo;
  const params = new URLSearchParams({ page: back.page, workspace: back.workspaceId, evidenceReturn: "1" });
  for (const [parameter, value] of [["object", back.objectId], ["graphRevision", back.graphRevisionId],
    ["section", back.section], ["focus", back.focusId], ["scrollTop", back.scrollTop]] as const) if (value !== undefined) params.set(parameter, String(value));
  return `/?${params}`;
}

export function readEvidenceReturnLocation(search: string, workspaceId: string): ReturnContext | null {
  const params = new URLSearchParams(search);
  if (!params.has("evidenceReturn")) return null;
  if (params.get("evidenceReturn") !== "1") throw new Error("返回入口无效");
  const back: ReturnContext = { page: params.get("page") as ReturnContext["page"], workspaceId: params.get("workspace") ?? "" };
  for (const [parameter, key] of [["object", "objectId"], ["graphRevision", "graphRevisionId"], ["section", "section"], ["focus", "focusId"]] as const) {
    if (params.has(parameter)) back[key] = params.get(parameter)!;
  }
  if (params.has("scrollTop")) {
    const value = params.get("scrollTop")!;
    if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("返回阅读位置无效");
    back.scrollTop = Number(value);
  }
  validate({ workspaceId, tab: "objects", returnTo: back });
  return back;
}

export function evidenceReference(workspaceId: string, graphVersionId: string, kind: string, recordId: string) {
  validate({ workspaceId, graphVersionId, kind, recordId, tab: "objects" });
  const key = kind === "FACT" ? "factId" : kind === "MATERIAL" ? "materialId" : "recordId";
  return JSON.stringify({ workspaceId, graphVersionId, ...(key === "recordId" ? { kind } : {}), [key]: recordId });
}

export type ReadTicket = { epoch: number; key: string; signal: AbortSignal };
export class ReadFence {
  private epoch = 0;
  private current: ReadTicket | null = null;
  private controller: AbortController | null = null;
  begin(key: string): ReadTicket {
    this.clear();
    this.controller = new AbortController();
    this.current = { epoch: this.epoch, key, signal: this.controller.signal };
    return this.current;
  }
  accepts(ticket: ReadTicket) { return this.current === ticket && !ticket.signal.aborted; }
  clear() { this.controller?.abort(); this.controller = null; this.current = null; this.epoch += 1; }
}

export function requestPresentation(request: { status: string; outcome: string | null }) {
  const statuses: Record<string, string> = { QUEUED: "等待处理", RUNNING: "正在处理", COMPLETED: "处理结束", CANCELLED: "已取消", FAILED: "处理失败" };
  const outcomes: Record<string, string> = { EXISTING_EVIDENCE: "复用已有证据", NEW_VERSION: "独立新事实集", LIMITATION: "限制或未知", REJECTED: "越权或版本不符" };
  return { statusLabel: statuses[request.status] ?? "状态未知", outcomeLabel: request.outcome ? outcomes[request.outcome] ?? "未知返回类型" : "尚无取证结果" };
}

// Presentation only. A locator grants neither material access nor F003
// adoption; following it still goes through the current member's F002 reads.
export function requestResultNavigation(request: EvidenceRequest, context: EvidenceLocation): {
  links: { href: string; label: string }[]; explanation: string; error: string | null;
} {
  try {
    validate(context);
    if (!digest.test(request.baseVersionId) || request.baseVersionId !== context.graphVersionId) throw new Error("请求基准与当前固定事实集不同；保留原回执，不改绑当前阅读。");
    if (request.status !== "COMPLETED") return { links: [], explanation: "任务尚未产生可核查的终态返回；失败、取消或处理中不等于已有依据。", error: null };
    if (!["EXISTING_EVIDENCE", "NEW_VERSION", "LIMITATION", "REJECTED"].includes(request.outcome ?? "")) throw new Error("取证返回类型未知，不能推断成功或新版本。");
    const result = request.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("取证结果缺少可核查回执。");
    if (result.baseVersionId !== undefined && result.baseVersionId !== request.baseVersionId) throw new Error("结果基准与原请求不匹配，不能生成证据入口。");
    if (request.outcome === "LIMITATION") return { links: [], explanation: "仍不确定或不支持。保留限制与原基准；没有依据不证明业务不存在。", error: null };
    if (request.outcome === "REJECTED") return { links: [], explanation: "请求被拒绝或版本不符；不能将拒绝当作成功空结果，也未扩大调查授权。", error: null };
    const references: { kind: string; id: string }[] = [];
    let version = request.baseVersionId;
    const newVersion = request.outcome === "NEW_VERSION";
    if (newVersion) {
      if (typeof result.graphVersionId !== "string" || !digest.test(result.graphVersionId) || result.graphVersionId === version) throw new Error("独立新事实集缺少不同于原基准的精确版本。");
      version = result.graphVersionId;
      for (const field of ["addedRefs", "correctedRefs"] as const) {
        const values = result[field] ?? [];
        if (!Array.isArray(values) || values.length > 200_000) throw new Error("新版本记录清单无效。");
        for (const value of values) {
          if (!value || typeof value !== "object" || !["MATERIAL", "OBJECT", "FACT", "EVIDENCE", "GAP"].includes(value.kind) || typeof value.id !== "string" || !digest.test(value.id)) throw new Error("新版本记录定位无效。");
          references.push({ kind: value.kind, id: value.id });
        }
      }
    } else {
      if (result.baseVersionId !== request.baseVersionId) throw new Error("已有依据缺少精确基准。");
      for (const [field, kind] of [["factRefs", "FACT"], ["materialRefs", "MATERIAL"]] as const) {
        const values = result[field] ?? [];
        if (!Array.isArray(values) || values.length > 200_000 || values.some(id => typeof id !== "string" || !digest.test(id))) throw new Error("已有依据定位无效。");
        for (const id of values) references.push({ kind, id });
      }
      if (!references.length) throw new Error("已有依据未包含可定位记录，不能制造证据入口。");
    }
    const unique = [...new Map(references.map(ref => [`${ref.kind}:${ref.id}`, ref])).values()];
    const target: EvidenceLocation = { ...context, graphVersionId: version, sourceVersionId: newVersion ? undefined : context.sourceVersionId,
      tab: "objects", kind: undefined, recordId: undefined, line: undefined, lineEnd: undefined, windowLine: undefined, graphRootId: undefined, relationReturn: undefined };
    const links = newVersion ? [{ href: evidenceHref(target), label: "查看独立新事实集（不采用）" }] : [];
    for (const ref of unique.slice(0, 200)) links.push({ href: evidenceHref({ ...target, tab: ref.kind === "GAP" ? "coverage" : "objects", kind: ref.kind, recordId: ref.id }), label: `查看 ${ref.kind} · ${ref.id.slice(0, 12)}…` });
    const explanation = newVersion ? "新事实集可显式核查；原调查基准及上游采用状态未改变。" : "已有依据指向原固定基准；技术记录不自动证明业务结论。";
    return { links, explanation: `${explanation}${unique.length > 200 ? ` 共 ${unique.length} 条引用，入口仅展示前 200 条；完整回执仍可核对。` : ""}`, error: null };
  } catch (error) {
    return { links: [], explanation: "回执定位尚未确认；不替换为最新版本或其它记录。", error: (error as Error).message };
  }
}
