import type { DraftInput, FrozenVersion } from "./types.ts";

export function draftFromVersion(version: Pick<FrozenVersion, "id" | "components">): DraftInput {
  return { baselineBundleId: version.id, sources: version.components.map((component) => {
    if (component.kind !== "GIT" && component.kind !== "DIRECTORY_UPLOAD") throw new Error("无法建立新版本：来源类型不受支持");
    return { sourceId: component.sourceId, kind: component.kind, mode: "REUSE", componentId: component.id,
      label: component.kind === "GIT" ? "Git 源码" : "本机目录",
      ...(component.kind === "GIT" ? { url: component.sourceUrl ?? "", ref: component.nativeIdentity?.commit ?? "HEAD", root: component.scope?.root ?? null } : {}) };
  }) };
}

export const sourceStations = ["添加来源", "确认范围", "来源预检", "枚举材料", "冻结清单", "采集校验", "复核缺口", "冻结包"] as const;
export type SourceRunState = { status: string; station: number; abandoned?: boolean; progress?: { waitingFor?: string | null } };
export function sourceJourney(run: SourceRunState | null, draftRevision: number, confirmation: boolean, selected: number | null = null) {
  const current = run ? run.status === "REVIEW_REQUIRED" && confirmation ? 8 : run.station : draftRevision ? 2 : 1;
  const index = selected ?? current;
  const preview = index !== current;
  const states: Record<string, { tone: string; label: string; action: string | null }> = {
    BLOCKED: { tone: "danger", label: "存在阻断 · 未创建包", action: "EDIT" },
    FAILED_RETRYABLE: { tone: "danger", label: "本次失败 · 既有包不变", action: "RETRY" },
    CANCELLED: { tone: "muted", label: "任务已取消 · 检查点仍保留", action: "EDIT" },
    WAITING_FOR_CLIENT: run?.progress?.waitingFor === "RESTORE_RECONCILIATION"
      ? { tone: "warning", label: "已恢复备份 · 等待核对恢复点", action: "RECONCILE_RESTORE" }
      : { tone: "warning", label: "等待本机目录 · 可续传", action: "RESUME_DIRECTORY" },
    REVIEW_REQUIRED: { tone: "warning", label: confirmation ? "已确认 · 尚未冻结包" : "等待你的复核", action: confirmation ? "SEAL" : "CONFIRM" },
    PREPARING_SEAL: { tone: "info", label: "正在准备冻结 · 结果未确认", action: "QUERY_RESULT" },
    FINALIZING: { tone: "info", label: "正在原子最终化 · 仅可查询", action: "QUERY_RESULT" },
    SUCCEEDED: { tone: "info", label: "包已冻结 · 当前准入另行核验", action: "NEW_VERSION" },
  };
  const state = run?.abandoned ? { tone: "muted", label: "已放弃续传 · 历史记录保留", action: "EDIT" }
    : run ? states[run.status] ?? { tone: "info", label: "服务端处理中", action: "QUERY_RESULT" } : { tone: "info", label: draftRevision ? "草稿已保存 · 待开始" : "开始建立来源快照", action: draftRevision ? "START" : "SAVE" };
  return { current, selected: index, preview, ...state, action: preview ? null : state.action };
}
