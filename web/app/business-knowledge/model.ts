import type { FrozenVersion } from "../source-truth/types.ts";
import type { FactVersion } from "../deterministic-facts/types.ts";
import type { GraphView, Proposition, StartInvestigation } from "./types.ts";

export function knowledgePosition(search: string, workspaceId: string) {
  const params = new URLSearchParams(search), same = params.get("workspace") === workspaceId;
  const id = same && params.getAll("runId").length === 1 ? params.get("runId") ?? "" : "";
  const view = params.get("view");
  const error=params.has("runId")&&(!same||params.getAll("workspace").length!==1||params.getAll("runId").length!==1
    ||! /^[A-Za-z0-9_-]{1,128}$/.test(id)||params.getAll("view").length>1||params.getAll("objectId").length>1
    ||params.has("revision")||(params.has("view")&&!["BUSINESS","IMPLEMENTATION","COVERAGE"].includes(view??"")))?"调查地址无效或含重复定位，未读取其他版本或新建调查。":"";
  return { id: !error && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : "",
    view: (["BUSINESS", "IMPLEMENTATION", "COVERAGE"].includes(view ?? "") ? view : "BUSINESS") as GraphView,
    key: same && id && !error ? params.get("objectId") ?? "" : "",
    legacy: same && !params.has("runId") && (view === "legacy" || params.has("revision") || params.has("objectId")),error };
}
export function writeKnowledgePosition(workspaceId: string, id: string, view: GraphView = "BUSINESS", key = "") {
  const url = new URL(window.location.href);
  if (url.searchParams.get("workspace") !== workspaceId) return;
  for (const name of ["revision", "objectId", "runId", "view", "knowledge", "publishedRevision", "sessionId", "questionId", "publishedObject"]) url.searchParams.delete(name);
  if (id) url.searchParams.set("runId", id);
  if (id) url.searchParams.set("view", view);
  if (id && key) url.searchParams.set("objectId", key);
  window.history.replaceState(null, "", url.pathname + url.search);
  window.dispatchEvent(new Event("traqen:navigate"));
}
export function investigationState(value: string) {
  return ({ QUEUED: "等待调查", RUNNING: "调查中", PAUSED: "已暂停", COMPLETED: "分析已保存", FAILED: "调查失败", CANCELLED: "已取消" } as Record<string, string>)[value] ?? "状态待核实";
}
export function propositionState(value: Pick<Proposition, "state" | "authority">) {
  if (value.authority === "HUMAN_CONFIRMED") return "人工确认";
  return ({ ANALYSIS_ACCEPTED: "分析收录 · 非人工确认", HUMAN_REVIEW: "存在歧义 · 待人工处理", NEEDS_EVIDENCE: "缺少依据 · 待补证",
    RETAINED_UNKNOWN: "保留未知", QUARANTINED: "无效输出 · 已隔离" } as Record<string, string>)[value.state] ?? "状态待核实";
}
export const kindNames: Record<string, string> = { FUNCTION: "业务功能", RULE: "业务规则", ROLE: "业务角色", STATE: "业务状态",
  PROCESS: "业务流程", EXCEPTION: "业务异常", BUSINESS_OBJECT: "业务对象", DOCUMENT: "业务文档", CONFIG_DATA: "配置与数据", API_CODE: "接口与代码", TEST_ASSET: "测试资产", OTHER: "其他材料" };
export type StartDraft = { question: string; bundle: FrozenVersion; componentIds: string[]; profileId: string; confirmedProfileId: string;
  technicalVersionId: string; versions: FactVersion[]; maxReadMiB: number; maxModelCalls: number; durationMinutes: number;
  supplementMaterials: number; supplementMiB: number; supplementRules: number; supplementAttempts: number; operationId: string; now: number };
export function makeStart(input: StartDraft): StartInvestigation {
  const { bundle } = input;
  if (!bundle?.latestReceipt || !/^[a-f0-9]{64}$/.test(bundle.id)) throw Error("请选择具有准入收据的冻结材料版本。");
  if (!input.componentIds.length || !input.componentIds.every(id => bundle.components.some(component => component.id === id))) throw Error("请选择属于该冻结版本的材料组件。");
  if (!input.profileId || input.confirmedProfileId !== input.profileId) throw Error("请确认当前生效的 Main 与 Child 配置。");
  if (!input.question.trim() || input.question.length > 16384) throw Error("请输入本轮要调查的业务问题（不超过16384字）。");
  if (input.technicalVersionId && !input.versions.some(v => v.graphVersionId === input.technicalVersionId && v.bundleId === bundle.id)) throw Error("技术依据必须是所选同版材料的精确结果。");
  const bounded = (value: number, max: number) => Number.isSafeInteger(value) && value > 0 && value <= max;
  if (!bounded(input.maxReadMiB, 1024) || !bounded(input.maxModelCalls, 1000) || !bounded(input.durationMinutes, 10080)
    || !bounded(input.supplementMaterials, 200000) || !bounded(input.supplementMiB, 1024) || !bounded(input.supplementRules, 100000000)
    || !bounded(input.supplementAttempts, 1000)) throw Error("预算必须是范围内的正整数；不能以零或无限值启动调查。");
  const deadline = new Date(input.now + input.durationMinutes * 60000).toISOString();
  return { operationId: input.operationId, question: input.question.trim(), expectedProfileId: input.profileId,
    reference: { bundleId: bundle.id, receiptId: bundle.latestReceipt.id }, scope: { componentIds: [...new Set(input.componentIds)] },
    technicalVersionId: input.technicalVersionId || null,
    budget: { maxReadBytes: input.maxReadMiB * 1024 * 1024, maxModelCalls: input.maxModelCalls, deadline },
    supplementBudget: { maxMaterials: input.supplementMaterials, maxBytes: input.supplementMiB * 1024 * 1024,
      maxRuleApplications: input.supplementRules, maximumAttempts: input.supplementAttempts, deadline } };
}
export function materialPath(pathBytes: string) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(pathBytes.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))); }
  catch { return "路径字节不可显示"; }
}
export const shortId = (value: string) => value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
