import type { EvidenceLocation } from "./model.ts";
import type { InputDraft } from "./operations.ts";

export const requestKinds = [
  { value: "TARGETED_EVIDENCE", label: "定向取证" },
  { value: "SUSPECTED_OMISSION", label: "疑似漏提" },
  { value: "SUSPECTED_ERROR", label: "疑似错误" },
] as const;

export type RequestInputField = "investigationId" | "question" | "baseVersionId" | "target" | "requestKind" | "requestedCapabilities";
export type MaterialBinding = { workspaceId: string; graphVersionId: string; materialId: string };
export class RequestInputError extends Error {
  field: RequestInputField;
  constructor(field: RequestInputField, message: string) {
    super(message); this.name = "RequestInputError"; this.field = field;
  }
}

// Generic validation and authorization errors do not identify a single field.
// Keep them in the existing error/access-loss paths instead of guessing.
export function requestRejectionField(code: string, status: number): RequestInputField | null {
  return code === "F002_VERSION_NOT_FOUND" && status === 404 ? "baseVersionId" : null;
}

// A client-side intent, not a consumer authorization or fact correction.
// The existing server resolver still checks the exact scope and budget.
export function buildEvidenceRequestInput(context: EvidenceLocation, draft: InputDraft, installedCapabilities: readonly string[], material: MaterialBinding | null = null) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(draft.investigationId ?? "")) throw new RequestInputError("investigationId", "请填写可回查的调查 ID；输入 ID 本身不授予权限。");
  if (!draft.question?.trim() || draft.question.length > 16_384) throw new RequestInputError("question", "请填写待核查问题，最多16384字符；其他输入已保留。");
  if (!/^[a-f0-9]{64}$/.test(context.graphVersionId ?? "")) throw new RequestInputError("baseVersionId", "请先选择精确基准事实集，不能以最新版本代替。");
  if (draft.materialTargetId !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(draft.materialTargetId) || !material || material.materialId !== draft.materialTargetId
      || material.workspaceId !== context.workspaceId || material.graphVersionId !== context.graphVersionId) {
      throw new RequestInputError("target", "重选材料尚未通过当前成员与固定版本复验；问题和其他输入已保留。");
    }
  } else if (!["MATERIAL", "FACT"].includes(context.kind ?? "") || !/^[a-f0-9]{64}$/.test(context.recordId ?? "")) throw new RequestInputError("target", "请从当前固定版本选择材料或事实；不接受任意路径。");
  const requestKind = draft.requestKind ?? "TARGETED_EVIDENCE";
  if (!requestKinds.some(kind => kind.value === requestKind)) throw new RequestInputError("requestKind", "请求类型不可识别；怀疑不能成为已确认更正。");
  const capabilities = draft.requestedCapabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.length > 64 || capabilities.some(value => typeof value !== "string" || !value || value.length > 512
    || !installedCapabilities.includes(value))) throw new RequestInputError("requestedCapabilities", "请求能力不再可启动或超过64项；请核对选择，未自动清除草稿。");
  return { investigationId: draft.investigationId!, baseVersionId: context.graphVersionId!, requestKind, question: draft.question,
    materialRefs: draft.materialTargetId ? [draft.materialTargetId] : context.kind === "MATERIAL" ? [context.recordId!] : [],
    factRefs: !draft.materialTargetId && context.kind === "FACT" ? [context.recordId!] : [],
    requestedCapabilities: [...new Set(capabilities)].sort() };
}
