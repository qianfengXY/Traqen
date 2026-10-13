// UI context only. Work-session persistence and association authority belong to
// F007; these values never grant source access or change a capture identity.
import type { SourceTruthClient } from "./client.ts";
export type SourceReference = { workspaceId: string; bundleId: string; receiptId: string; componentId?: string };
export type SourceEntryContext = Partial<SourceReference> & {
  mode: "REFERENCE" | "ADD_MATERIAL";
  workspaceId: string;
  workSessionId?: string;
  businessId?: string;
  answerRef?: string;
  factSetId?: string;
  graphVersionId?: string;
  returnHref?: string;
  // Typed host-only reading location. Never included in shareable URLs.
  pathBytes?: string;
  tab?: "inventory" | "gaps" | "receipt" | "history";
};
const opaque = (value: string | null | undefined) => Boolean(value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value));
const digest = (value: string | undefined) => Boolean(value && /^[a-f0-9]{64}$/.test(value));

export function sourceContextError(context: SourceEntryContext, workspaceId: string) {
  if (context.workspaceId !== workspaceId) return "来路 Workspace 与当前工作区不一致；原引用未被替换，也不会读取其他工作区材料。";
  if (context.mode === "REFERENCE" && (!digest(context.bundleId) || !opaque(context.receiptId))) return "固定来源引用不完整或无效；请返回原工作核对 Bundle 与 Receipt，不自动改用最新版本。";
  if (context.componentId !== undefined && !digest(context.componentId)) return "固定组件身份无效；不会改用其他来源组件。";
  if (context.pathBytes !== undefined && (!context.componentId || context.pathBytes.length > 10923 || !/^[A-Za-z0-9_-]+$/.test(context.pathBytes))) return "材料定位不完整或无效；不会打开其他材料。";
  if (context.tab !== undefined && !["inventory", "gaps", "receipt", "history"].includes(context.tab)) return "材料页签定位无效。";
  return null;
}

export function sourceEntryFromSearch(search: string): SourceEntryContext | undefined {
  const params = new URLSearchParams(search);
  if (!params.has("sourceBundle") && !params.has("sourceReceipt")) return undefined;
  const unique = ["workspace", "sourceBundle", "sourceReceipt", "sourceComponent"].every(key => params.getAll(key).length <= 1);
  // A partial/malformed fixed reference is still a reference, not standalone.
  return { mode: "REFERENCE", workspaceId: params.get("workspace") ?? "", bundleId: unique ? params.get("sourceBundle") ?? "" : "",
    receiptId: params.get("sourceReceipt") ?? "", componentId: params.get("sourceComponent") ?? undefined };
}

export function safeSourceReturn(context: SourceEntryContext) {
  if (!context.returnHref) return null;
  try {
    const url = new URL(context.returnHref, "https://traqen.invalid");
    if (url.origin !== "https://traqen.invalid" || url.pathname !== "/" || url.hash
      || url.searchParams.get("workspace") !== context.workspaceId
      || !["overview", "graph", "evidence", "impact"].includes(url.searchParams.get("page") ?? "")) return null;
    const allowed = new Set(["page", "workspace", "business", "session", "answer", "factSet", "graphVersion"]);
    for (const [key, value] of url.searchParams) if (!allowed.has(key) || !opaque(value) || url.searchParams.getAll(key).length !== 1) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}

export function sourceReferenceParams(context: Partial<SourceReference>) {
  const params = new URLSearchParams();
  if (context.bundleId !== undefined) params.set("sourceBundle", context.bundleId);
  if (context.receiptId !== undefined) params.set("sourceReceipt", context.receiptId);
  if (context.componentId !== undefined) params.set("sourceComponent", context.componentId);
  return params;
}

// The embedding working-session page supplies a real service, not a simulated
// browser store. Query is bound to the same exact reference; the owning service
// resolves its durable idempotent operation (including after a page reload).
export type SourceAssociationResult = { status: "CONFIRMED" | "NOT_SAVED" | "UNKNOWN"; reference?: SourceReference; reason?: string };
export type SourceAssociationService = {
  validate(context: SourceEntryContext, signal: AbortSignal): Promise<{ valid: boolean; reason?: string }>;
  associate(context: SourceEntryContext, reference: SourceReference, signal: AbortSignal): Promise<SourceAssociationResult>;
  query(context: SourceEntryContext, reference: SourceReference, signal: AbortSignal): Promise<SourceAssociationResult>;
};

export function confirmedSourceAssociation(result: SourceAssociationResult, reference: SourceReference) {
  return result.status === "CONFIRMED" && result.reference?.workspaceId === reference.workspaceId
    && result.reference.bundleId === reference.bundleId && result.reference.receiptId === reference.receiptId;
}

export type SourceAssociationOutcome = SourceAssociationResult | { status: "INVALID"; reason: string };

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel: () => void = () => {};
  const interruption = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
  });
  try { return await Promise.race([work, interruption]); }
  finally { signal.removeEventListener("abort", cancel); }
}

export async function performSourceAssociation(service: SourceAssociationService, client: Pick<SourceTruthClient, "request">,
  context: SourceEntryContext, reference: SourceReference, query: boolean, signal: AbortSignal): Promise<SourceAssociationOutcome> {
  signal.throwIfAborted();
  const invalid = sourceContextError(context, reference.workspaceId);
  if (invalid || !context.workSessionId || !safeSourceReturn(context)) return { status: "INVALID", reason: invalid ?? "工作来路无法核验，不创建替代会话" };
  const valid = await abortable(service.validate(context, signal), signal);
  signal.throwIfAborted();
  if (!valid.valid) return { status: "INVALID", reason: valid.reason ?? "原工作已失效或无权访问" };
  if (!query) await abortable(client.request("/admission", "POST", { bundleId: reference.bundleId, receiptId: reference.receiptId }), signal);
  signal.throwIfAborted();
  const result = await abortable(query ? service.query(context, reference, signal) : service.associate(context, reference, signal), signal);
  signal.throwIfAborted();
  if (result.status === "CONFIRMED" && !confirmedSourceAssociation(result, reference)) return { status: "UNKNOWN", reason: "返回结果未绑定原定 Bundle 与 Receipt；先查询，不改用最新引用" };
  return result;
}
