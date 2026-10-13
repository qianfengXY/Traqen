"use client";
import type { DraftInput, RunDetail, SourceOverview } from "./types.ts";
import { sourceStations } from "./journey.ts";

export type SourceOverviewTab = "versions" | "materials" | "captures";
export function SourceOverviewTabs({ selected, onSelect, id }: { selected: SourceOverviewTab; onSelect: (tab: SourceOverviewTab) => void; id: string }) {
  return <div className="st-tabs" role="tablist" aria-label="来源快照总览">{([["versions", "版本"], ["materials", "材料清单"], ["captures", "采集记录"]] as const).map(([tab, label]) => <button
    role="tab" id={`${id}-${tab}`} aria-controls={`${id}-${tab}-panel`} aria-selected={selected === tab} tabIndex={selected === tab ? 0 : -1}
    className={selected === tab ? "selected" : ""} key={tab} onClick={() => onSelect(tab)} onKeyDown={event => {
      const buttons = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("[role=tab]"));
      const index = buttons.indexOf(event.currentTarget);
      const target = event.key === "ArrowRight" ? (index + 1) % buttons.length : event.key === "ArrowLeft" ? (index + buttons.length - 1) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
      if (target >= 0) { event.preventDefault(); buttons[target].focus(); }
    }}>{label}</button>)}</div>;
}

export function SourceTaskContext({ workspaceName, overview, input, detail, current, acceptedCount }: { workspaceName: string; overview: SourceOverview; input: DraftInput; detail: RunDetail | null; current: number; acceptedCount: string }) {
  const run = detail?.run;
  const inputOnly = current <= 2;
  return <aside className="st-side" aria-label="当前任务上下文"><section className="st-panel"><h2>{inputOnly ? "当前输入" : current === 7 ? "冻结前检查" : "本次上下文"}</h2>
    <dl><dt>Workspace</dt><dd>{workspaceName}</dd><dt>当前成员</dt><dd>{overview.actor.actorId} · {overview.role}</dd>
      {inputOnly ? <><dt>Git</dt><dd>{input.sources.find(source => source.kind === "GIT")?.ref ?? "未添加"}</dd><dt>目录</dt><dd>{input.sources.some(source => source.kind === "DIRECTORY_UPLOAD") ? "已登记 · 完整核对在采集时进行" : "未选择"}</dd><dt>基线</dt><dd>{input.baselineBundleId ?? "首次来源版本"}</dd></>
        : <><dt>采集任务</dt><dd>{run?.id ?? "尚未启动"}</dd><dt>清单闭合</dt><dd>{detail?.sources.every(source => source.enumerationClosed) ? "枚举已闭合" : "尚未闭合"}</dd>
          <dt>限制有效接受</dt><dd>{current === 7 ? `${acceptedCount} / ${detail?.candidate?.gapCount ?? "未对账"}` : "在核对站逐项核验"}</dd></>}
      <dt>主存储</dt><dd>{overview.storage.ready ? "可访问" : "不可用"}</dd><dt>备份配置</dt><dd>{overview.backup.status === "NOT_CONFIGURED" ? "未配置 · 没有覆盖证明" : overview.backup.status}</dd></dl>
    <p className="st-muted">{inputOnly ? "尚未枚举，不显示可信文件总数。" : "接受不会补齐缺失；阻断不可绕过，冻结前由服务端再次复验。"}</p>
  </section><section className="st-panel"><h2>{inputOnly ? "下一站门槛" : current === 8 ? "冻结后使用" : "下一步"}</h2>
    <p>{inputOnly ? "至少一种合法来源；确认后再配置范围并运行预检。" : current < 8 ? sourceStations[current] : "查看冻结版本、当前准入与备份条件；不自动启动分析。"}</p>
    <p className="st-muted">{run?.progress.waitingFor === "RESTORE_RECONCILIATION" ? "先核对备份恢复点，才能恢复原任务；不会自动确认或冻结。" : run?.status === "WAITING_FOR_CLIENT" ? "请重新授权相同目录；重选完整核对后继续原任务。" : "工作会话不是采集任务。节点预览不改变真实进度。"}</p>
    <h3>平台边界</h3><p className="st-muted">最多 {overview.policy.maxEntries.toLocaleString("zh-CN")} 个条目；单文件上限 {overview.policy.maxFileBytes} 字节。不能靠排除文件变绿。</p>
  </section></aside>;
}
