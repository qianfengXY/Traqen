import { requestKinds } from "./request-input.ts";
import type { ExtractionKind } from "./delivery-input.ts";

type Store = Pick<Storage, "getItem" | "setItem">;
export type JournalContext = { workspaceId: string; actorId: string; baseVersionId?: string; targetRef?: string; workRef?: string; namespace: "delivery" | "request" };
export type PendingOperation = { operationId: string; path: string; purpose: string; body: Record<string, unknown> };
export type InputDraft = { investigationId?: string; question?: string; requestKind?: string; requestedCapabilities?: string[];
  materialTargetId?: string; sourceId?: string; profileId?: string; components?: string[]; separate?: boolean; lookup?: string; scopeKind?: ExtractionKind; scopePath?: string };
export type OperationEnvelope = { operationId: string; results: { kind: string; value: Record<string, unknown> }[] };
type Snapshot = { draft: InputDraft; pending: PendingOperation | null };
const id = /^[A-Za-z0-9_-]{1,128}$/, digest = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 256): value is string => typeof value === "string" && value.length <= max && !/[\u0000\u007f]/.test(value);

function draftInput(value: unknown): InputDraft {
  if (!object(value)) throw new Error("草稿恢复记录无效");
  const draft: InputDraft = {};
  if (value.scopeKind !== undefined) {
    if (!["COMPONENT", "DIRECTORY", "ENTRY"].includes(String(value.scopeKind))) throw new Error("草稿范围类型无效");
    draft.scopeKind = value.scopeKind as ExtractionKind;
  }
  if (value.scopePath !== undefined) {
    if (!text(value.scopePath, 4096)) throw new Error("草稿范围路径无效");
    draft.scopePath = value.scopePath;
  }
  for (const key of ["investigationId", "question", "sourceId", "profileId", "lookup"] as const) {
    if (value[key] !== undefined) {
      if (!text(value[key], key === "question" ? 16_384 : 256)) throw new Error("草稿恢复字段无效");
      draft[key] = value[key];
    }
  }
  if (value.components !== undefined) {
    if (!Array.isArray(value.components) || value.components.length > 32 || !value.components.every(item => typeof item === "string" && digest.test(item))) throw new Error("草稿组件定位无效");
    draft.components = [...value.components];
  }
  if (value.separate !== undefined) {
    if (typeof value.separate !== "boolean") throw new Error("草稿范围选项无效");
    draft.separate = value.separate;
  }
  if (value.requestKind !== undefined) {
    if (!requestKinds.some(kind => kind.value === value.requestKind)) throw new Error("草稿请求类型无效");
    draft.requestKind = value.requestKind as string;
  }
  if (value.requestedCapabilities !== undefined) {
    if (!Array.isArray(value.requestedCapabilities) || value.requestedCapabilities.length > 64
      || !value.requestedCapabilities.every(item => text(item, 512) && item.length > 0)) throw new Error("草稿请求能力无效");
    draft.requestedCapabilities = [...new Set(value.requestedCapabilities as string[])].sort();
  }
  if (value.materialTargetId !== undefined) {
    if (typeof value.materialTargetId !== "string" || !digest.test(value.materialTargetId)) throw new Error("草稿材料定位无效");
    draft.materialTargetId = value.materialTargetId;
  }
  // Only user-editable input and locators are retained. No response bodies,
  // tokens, display bytes, or caller-selected extra fields enter the journal.
  return draft;
}

function command(value: unknown): PendingOperation {
  if (!object(value) || typeof value.operationId !== "string" || !id.test(value.operationId) || !text(value.purpose, 80)
    || typeof value.path !== "string" || !object(value.body) || value.body.operationId !== value.operationId) throw new Error("原操作恢复记录无效");
  const path = value.path, body = value.body;
  const fields = path === "/runs" ? ["operationId", "source", "profileId", "scopes"]
    : path === "/requests" ? ["operationId", "investigationId", "baseVersionId", "requestKind", "question", "materialRefs", "factRefs", "requestedCapabilities"]
    : /^\/versions\/[a-f0-9]{64}\/replays$/.test(path) ? ["operationId"]
    : /^\/runs\/[A-Za-z0-9_-]{1,128}\/(retry|cancel)$/.test(path) ? ["operationId", "scopeId", "revision"]
    : /^\/runs\/[A-Za-z0-9_-]{1,128}\/scopes\/[a-f0-9]{64}\/seal$/.test(path)
      || /^\/(requests|replays)\/[A-Za-z0-9_-]{1,128}\/cancel$/.test(path) ? ["operationId", "revision"] : null;
  if (!fields || Object.keys(body).some(key => !fields.includes(key))) throw new Error("原操作含未定义或敏感字段");
  if (body.revision !== undefined && (!Number.isInteger(body.revision) || Number(body.revision) < 1)) throw new Error("原操作修订无效");
  if (body.scopeId !== undefined && !digest.test(String(body.scopeId))) throw new Error("原操作范围无效");
  if (path === "/runs") {
    if (!object(body.source) || Object.keys(body.source).some(key => !["bundleId", "receiptId"].includes(key))
      || !digest.test(String(body.source.bundleId)) || !text(body.source.receiptId) || !body.source.receiptId
      || !digest.test(String(body.profileId)) || !Array.isArray(body.scopes) || !body.scopes.length || body.scopes.length > 32) throw new Error("原提取输入无效");
    for (const scope of body.scopes) {
      if (!object(scope) || Object.keys(scope).some(key => !["label", "selections"].includes(key)) || !Array.isArray(scope.selections)) throw new Error("原提取范围无效");
      for (const selection of scope.selections) if (!object(selection)
        || Object.keys(selection).some(key => !["kind", "componentId", "pathBytes"].includes(key))
        || !["COMPONENT", "DIRECTORY", "ENTRY"].includes(String(selection.kind)) || !digest.test(String(selection.componentId))) throw new Error("原提取选择无效");
    }
  }
  if (path === "/requests" && (!id.test(String(body.investigationId)) || !digest.test(String(body.baseVersionId)) || !text(body.question, 16_384)
    || !text(body.requestKind, 64) || ["materialRefs", "factRefs", "requestedCapabilities"].some(key => !Array.isArray(body[key])
      || (body[key] as unknown[]).some(item => !text(item))))) throw new Error("原取证输入无效");
  const encoded = JSON.stringify({ operationId: value.operationId, path, purpose: value.purpose, body });
  if (encoded.length > 100_000) throw new Error("原操作记录超过本地保护上限");
  return JSON.parse(encoded) as PendingOperation;
}

function matches(pending: PendingOperation, context: JournalContext, result: OperationEnvelope) {
  if (!object(result) || result.operationId !== pending.operationId || !Array.isArray(result.results) || result.results.length !== 1) return false;
  const entry = result.results[0];
  if (!object(entry) || !object(entry.value)) return false;
  const value = entry.value, { path, body, operationId } = pending;
  if (entry.kind !== "SCOPE_OPERATION" && (typeof value.id !== "string" || !id.test(value.id))) return false;
  if (path === "/runs") return entry.kind === "RUN" && value.operationId === operationId && object(value.sourceInput)
    && object(body.source) && value.sourceInput.bundleId === body.source.bundleId && value.sourceInput.receiptId === body.source.receiptId && value.profileId === body.profileId;
  if (path === "/requests") return entry.kind === "REQUEST" && value.operationId === operationId
    && value.baseVersionId === body.baseVersionId && value.investigationId === body.investigationId;
  const replay = /^\/versions\/([a-f0-9]{64})\/replays$/.exec(path);
  if (replay) return entry.kind === "REPLAY" && value.operationId === operationId && value.graphVersionId === replay[1];
  const cancel = /^\/(requests|replays)\/([A-Za-z0-9_-]{1,128})\/cancel$/.exec(path);
  if (cancel) return entry.kind === (cancel[1] === "requests" ? "REQUEST" : "REPLAY") && value.id === cancel[2]
    && value.cancelOperationId === operationId && value.status === "CANCELLED"
    && (cancel[1] !== "requests" || !context.baseVersionId || value.baseVersionId === context.baseVersionId);
  const scope = /^\/runs\/([A-Za-z0-9_-]{1,128})\/(retry|cancel|scopes\/([a-f0-9]{64})\/seal)$/.exec(path);
  return !!scope && entry.kind === "SCOPE_OPERATION" && value.operationId === operationId && value.runId === scope[1]
    && value.scopeId === (scope[3] ?? body.scopeId)
    && value.eventType === (scope[2] === "retry" ? "SCOPE_RETRY_QUEUED" : scope[2] === "cancel" ? "SCOPE_CANCELLED" : "SCOPE_SEALED");
}

// Persistence is synchronous and precedes the network request. A journal does
// not send requests, expire records, infer failure, or retry any mutation.
export class OperationJournal {
  readonly storageKey: string;
  private storage: Store;
  private context: JournalContext;
  constructor(storage: Store, context: JournalContext) {
    if (!text(context.workspaceId) || !context.workspaceId || !text(context.actorId) || !context.actorId
      || !["delivery", "request"].includes(context.namespace) || (context.baseVersionId !== undefined && !digest.test(context.baseVersionId))
      || [context.targetRef, context.workRef].some(value => value !== undefined && !text(value, 1024))) throw new Error("草稿授权上下文无效");
    this.storage = storage;
    this.context = { workspaceId: context.workspaceId, actorId: context.actorId, ...(context.baseVersionId ? { baseVersionId: context.baseVersionId } : {}),
      ...(context.targetRef ? { targetRef: context.targetRef } : {}), ...(context.workRef ? { workRef: context.workRef } : {}), namespace: context.namespace };
    this.storageKey = `traqen:f002:journal:${JSON.stringify(this.context)}`;
  }
  read(): Snapshot {
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) return { draft: {}, pending: null };
    let record: Record<string, unknown>;
    try { record = JSON.parse(raw); } catch { throw new Error("草稿/原操作记录损坏，不能恢复或重新提交"); }
    if (!object(record) || record.schemaVersion !== 1 || JSON.stringify(record.context) !== JSON.stringify(this.context)
      || record.pending === undefined) throw new Error("草稿/原操作的身份恢复记录不匹配");
    return { draft: draftInput(record.draft), pending: record.pending === null ? null : command(record.pending) };
  }
  private write(snapshot: Snapshot) { this.storage.setItem(this.storageKey, JSON.stringify({ schemaVersion: 1, context: this.context, ...snapshot })); }
  saveDraft(draft: InputDraft) { const current = this.read(); this.write({ ...current, draft: draftInput(draft) }); }
  begin(pending: PendingOperation) {
    const current = this.read();
    if (current.pending) throw new Error("原操作未确认，不能创建重复提交");
    this.write({ ...current, pending: command(pending) });
  }
  resolve(result: OperationEnvelope) {
    const current = this.read();
    if (!current.pending || !matches(current.pending, this.context, result)) return false;
    this.write({ ...current, pending: null }); return true;
  }
  reject(operationId: string) {
    const current = this.read();
    if (current.pending?.operationId !== operationId) return false;
    this.write({ ...current, pending: null }); return true;
  }
}
