"use client";
import { investigationState, shortId } from "./model.ts";
import type { Investigation, InvestigationEvent } from "./types.ts";

const failureNames: Record<string, string> = { F003_MODEL_TIMEOUT: "模型调用超时", F003_MODEL_OUTPUT_LIMIT: "模型输出超过上限",
  F003_MODEL_PROCESS_EXIT: "模型进程异常结束", F003_MODEL_OUTPUT_INVALID: "模型返回格式无效", F003_MODEL_UNAVAILABLE: "模型当前不可用", F003_MODEL_INPUT_LIMIT: "模型输入超过安全上限" };
export function RunStatus({ run, busy, canControl = false, onControl }: { run: Investigation; busy: boolean; canControl?: boolean; onControl: (action: "pause" | "resume" | "cancel") => void }) {
  return <section className="bk-panel" aria-label="调查状态与版本">
    <div className="bk-heading"><div><h2>{run.question}</h2><p><span className={`bk-state bk-state-${run.state.toLowerCase()}`}>{investigationState(run.state)}</span> · {new Date(run.updatedAt).toLocaleString()}</p></div>
      {canControl && <div className="bk-actions">{["QUEUED", "RUNNING"].includes(run.state) && <button className="button" disabled={busy} onClick={() => onControl("pause")}>暂停调查</button>}{run.state === "PAUSED" && <button className="button" disabled={busy} onClick={() => onControl("resume")}>恢复调查</button>}{["QUEUED", "RUNNING", "PAUSED"].includes(run.state) && <button className="button danger" disabled={busy} onClick={() => onControl("cancel")}>取消调查</button>}</div>}</div>
    {run.lastFailure && <div role="alert"><p>调查未完成：{failureNames[run.lastFailure.code] ?? "尚无可核实的具体原因"}（<code>{run.lastFailure.code}</code>）。未将失败记为分析成功。</p>
      {(run.lastFailure.phase || run.lastFailure.taskKey || run.lastFailure.slotId) && <details><summary>失败的阶段与任务</summary><p>阶段：{run.lastFailure.phase ?? "未记录"}；任务：{run.lastFailure.taskKey ?? "未记录"}；执行位：{run.lastFailure.slotId ?? "未记录"}；世代：{run.lastFailure.generation}</p></details>}</div>}
    <p className="bk-caption">材料 {shortId(run.sourceInput.sourceBundleSnapshotId)} · 模型调用 {run.usage.modelCalls ?? 0}/{run.budget.maxModelCalls} · 原文 {run.usage.readBytes ?? 0}/{run.budget.maxReadBytes} 字节 · 截止 {new Date(run.budget.deadline).toLocaleString()}</p>
    <p>已采用技术版本：{run.adoptedVersionIds.length ? run.adoptedVersionIds.map(shortId).join("、") : "未采用；业务调查直接读取原始材料"}。新技术结果不会自动切换本调查的依据。</p>
    <details><summary>来源、固定模型与恢复坐标</summary><dl className="bk-identities"><dt>调查</dt><dd>{run.id}</dd><dt>材料 Bundle</dt><dd>{run.sourceInput.sourceBundleSnapshotId}</dd><dt>准入 Receipt</dt><dd>{run.sourceInput.receiptId}</dd><dt>固定配置</dt><dd>{run.profile.id}</dd><dt>世代 / 修订</dt><dd>{run.generation} / {run.revision}</dd><dt>技术补证原始基准</dt><dd>{run.technicalVersionId ?? "未绑定"}</dd><dt>工作者租约</dt><dd>{run.leaseUntil ?? "无活动租约"}</dd></dl><p>刷新只重新读取当前权限与持久状态；不会重新调用模型、重建调查或重置预算。已保存分析与当前运行状态独立，重查失败不抹掉历史。</p></details>
  </section>;
}
const eventNames: Record<string, string> = { INVESTIGATION_ADMITTED: "调查已准入", INVESTIGATION_CLAIMED: "开始执行", ANALYSIS_COLLECTED: "分析已保存",
  INVESTIGATION_PAUSED: "调查已暂停", INVESTIGATION_RESUMED: "调查已恢复", INVESTIGATION_CANCELLED: "调查已取消", INVESTIGATION_FAILED: "调查失败", TECHNICAL_VERSION_ADOPTED: "明确采用技术版本", HOST_SHUTDOWN_RELEASED: "服务关机，保留工作等待恢复", MODEL_CALL_FINISHED: "模型调用终态（不等于分析收录或发布）" };
export function RunEvents({ events }: { events: InvestigationEvent[] }) {
  return <details className="bk-panel"><summary>调查与恢复历史 · {events.length}</summary><ol className="bk-events">{events.map(event => <li key={event.sequence}><time>{new Date(event.occurred_at).toLocaleString()}</time> · {eventNames[event.event_type] ?? event.event_type}<details><summary>事件记录</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details></li>)}</ol></details>;
}
