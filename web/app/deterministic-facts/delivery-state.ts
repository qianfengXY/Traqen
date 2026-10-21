import type { Profile, Scope } from "./types.ts";

export type ScopeCheck = { scope: Scope; ready: boolean; blockers: unknown[] };
export type ScopeChecks = Record<string, ScopeCheck>;

export const defaultProfileId = (profiles: Profile[]): string => (profiles.find(profile => profile.startable && profile.recommended)
  ?? profiles.find(profile => profile.startable))?.id ?? "";

// Scope ids identify fixed input, not an execution. A later run may select the
// same scope while owning a different state, revision and publication receipt.
const checkKey = (runId: string, scopeId: string) => JSON.stringify([runId, scopeId]);

export function storeScopeCheck(current: ScopeChecks, runId: string, scopeId: string, result: ScopeCheck): ScopeChecks {
  if (result.scope.scopeId !== scopeId) throw new Error("封存检查返回了另一范围；未采用该结果。");
  return { ...current, [checkKey(runId, scopeId)]: result };
}

export function currentScopeCheck(current: ScopeChecks, runId: string, scope: Scope): ScopeCheck | undefined {
  const result = current[checkKey(runId, scope.scopeId)];
  return result?.scope.revision === scope.revision && result.scope.status === scope.status ? result : undefined;
}

export function scopeExplanation(scope: Scope, check?: ScopeCheck): string {
  let message: string;
  if (scope.status === "FAILED_RETRYABLE") message = scope.diagnostic?.code === "F002_PARSE_TIMEOUT"
    ? "解析超过本次运行预算，此范围未封存；因此还没有可查看的封存版本。固定来源仍保留。"
    : scope.diagnostic?.code === "F002_SCOPE_RECORD_BUDGET_TOO_SMALL"
      ? "当前记录预算容不下完整材料目录；未封存。请新建目录或文件范围，或使用另行批准的配置；相同输入重试不会解除此限制。"
      : "提取失败，此范围未封存；先查看诊断，修复后可按原输入重试。";
  else if (scope.status === "RUNNING") message = "正在提取，尚不能封存；完成后再核验封存条件。";
  else if (scope.status === "QUEUED") message = "等待执行提取，尚未形成可封存结果。";
  else if (scope.status === "READY_TO_SEAL") message = check?.ready
    ? "当前封存条件已通过；点击“封存此范围”后才会生成独立封存版本。"
    : "提取已完成；先点击“查看封存条件”，通过后才能封存此范围。";
  else if (scope.status === "SEALED") message = scope.graphVersionId ? "此范围已封存；可点击“查看独立封存版本”。" : "封存版本回执待核验，请刷新当前运行。";
  else if (scope.status === "CANCELLED") message = "此范围已取消，不能封存；其他范围与历史版本不受影响。";
  else if (scope.status === "BLOCKED") message = "此范围受阻，不能封存；请查看当前诊断与封存条件。";
  else message = "当前范围状态待核验；请刷新读取，不按未知状态发起封存。";
  const pending = check?.blockers.find(blocker => !!blocker && typeof blocker === "object" && "code" in blocker && blocker.code === "F002_SCOPE_PENDING");
  if (pending && typeof pending === "object" && "count" in pending && Number.isSafeInteger(pending.count) && (pending.count as number) >= 0) {
    message += ` 尚有 ${(pending.count as number).toLocaleString("en-US")} 个材料×能力工作项未完成。`;
  }
  return message;
}
