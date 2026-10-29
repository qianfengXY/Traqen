"use client";
import { useCallback } from "react";
import type { BusinessKnowledgeClient } from "./client.ts";
import type { Investigation, TaskEvidence } from "./types.ts";
import { useKnowledgeRead } from "./use-read.ts";
import { ReadIssue } from "./read-issue.tsx";
import { investigationState, propositionName, propositionState } from "./model.ts";

export function TaskEvidencePanel({ client, run, onSelect, onMaterial, onAccessLost }: {
  client: BusinessKnowledgeClient; run: Investigation; onSelect: (key: string) => void; onMaterial: (id: string) => void;
  onAccessLost: (error: Error) => void;
}) {
  const load = useCallback((bound: BusinessKnowledgeClient) => bound.taskEvidence(run), [run.id, run.revision, run.generation, run.latestGraph?.digest, run.state]);
  const state = useKnowledgeRead(client, `task-evidence:${run.id}:${run.revision}:${run.latestGraph?.digest ?? "none"}`, load, onAccessLost,
    ["QUEUED", "RUNNING"].includes(run.state) ? 2500 : 0);
  return <section className="bk-panel" aria-label="调查任务与证据返回"><div className="bk-heading"><h2>调查任务与证据返回</h2>
    <button className="button" onClick={state.retry}>刷新任务证据</button></div>
    {state.loading && <p role="status">正在读取当前授权的固定调查任务…</p>}
    {state.error && <ReadIssue error={state.error} retry={state.retry} />}
    {state.data && <TaskEvidenceView value={state.data} onSelect={onSelect} onMaterial={onMaterial} />}
  </section>;
}

const obligationNames: Record<string, string> = { REPORTED_NOT_VERIFIED: "Child报告有依据，尚未核实", UNRESOLVED: "义务未解决",
  NOT_REPORTED: "尚无返回报告", UNKNOWN: "报告状态未知" };
const mappingNames: Record<string, string> = { MERGED: "已归并，仍须按命题核查", KEPT: "保留原候选", INVALID: "原提案无效",
  CONFLICT: "存在冲突", UNRESOLVED: "归并问题未解决" };

export function TaskEvidenceView({ value, onSelect, onMaterial }: { value: TaskEvidence;
  onSelect: (key: string) => void; onMaterial: (id: string) => void }) {
  return <div><p>调查状态：{investigationState(value.runState)}。任务返回、模型核查、人工确认和实际执行分别记录。</p>
    <p>{value.snapshotKind === "SAVED_GRAPH" ? "以下是已保存图谱的任务证据，不将当前运行进度倒写进历史图谱。"
      : value.snapshotKind === "CURRENT_CHECKPOINTS" ? "以下是当前依据的持久检查点；尚无保存图谱，任务返回不等于命题已核实。"
        : "尚无可读取的任务检查点；未构造已完成任务。"}</p>
    <p className="bk-caption">任务证据世代：{value.snapshotGeneration ?? "未记录"} · 图谱摘要：{value.binding.graphDigest ?? "尚无保存图谱"}</p>
    {!value.manifestAvailable && <p className="bk-warning">任务清单尚无可核实记录；旧记录缺少说明时保留缺失。</p>}
    {!value.tasks.length && <p>尚无可展示的持久任务记录，不据此推断业务已调查完整。</p>}
    {value.tasks.map(task => <details key={task.taskKey}><summary>{task.role === "MAIN" ? "Main" : task.role === "CHILD" ? "Child" : "未记录角色"}
      {" · "}{task.objective ?? "任务目标未记录"}{" · "}{task.status === "RETURN_RECORDED" ? "已有返回记录，非核实结论" : "尚无返回记录"}</summary>
      <p>任务：<code>{task.taskKey}</code> · 执行位：{task.slotId ?? "未记录"} · 实际返回世代：{task.generation ?? "未记录"}</p>
      <p>责任：{task.responsibilityId ?? "未记录"} · 返回候选：{task.returnedCandidateCount ?? "未记录"} · 返回关系：{task.returnedRelationCount ?? "未记录"}</p>
      <h4>实际来源范围</h4>{!task.sourceRanges.length && <p>来源范围未记录。</p>}
      {task.sourceRanges.map((range, i) => <p key={i}>{range.readable && range.materialId
        ? <button className="bk-text-button" onClick={() => onMaterial(range.materialId!)}>{range.path ?? range.materialId}</button>
        : <span>{range.path ?? range.materialId ?? "材料身份未记录"}（尚无本图谱可回查入口）</span>}
        {" · "}行 {range.startLine ?? "未记录"}–{range.endLine ?? "未记录"} · 字节 {range.byteStart ?? "未记录"}–{range.byteEnd ?? "未记录"}</p>)}
      <h4>调查义务与返回</h4>{!task.obligations.length && <p>义务报告未记录。</p>}
      {!task.reportAvailable && task.role === "CHILD" && <p>尚无完整Child义务报告；候选或返回计数不能替代它。</p>}
      {task.obligations.map((o, i) => <p key={i}>{o.obligation ?? "义务未记录"}：{obligationNames[o.status] ?? "报告状态未知"} · {o.reason ?? "原因未记录"}</p>)}
      {task.crossTaskLeads.map((lead, i) => <p key={i}>跨任务线索：{lead.materialKey ?? "材料键未记录"} · {lead.reason ?? "原因未记录"}</p>)}
      <h4>本图谱候选去向</h4><p>候选核查去向与上面的义务报告分别保留；模型核查不等于独立质量验收。</p>{!task.propositions.length && <p>尚无可核实的同版命题关联；未用返回数量补造命题。</p>}
      {task.propositions.map(p => <div key={p.key}><button className="bk-text-button" onClick={() => onSelect(p.key)}>{propositionName(p)}</button>
        {" · "}{propositionState({state:p.state,authority:"AGENT_ANALYSIS"})}
        {p.mappingStatuses.map(status => <p key={status}>{mappingNames[status] ?? "归并状态未识别"}</p>)}
        {p.evidence.map((e, i) => <p key={i}>{e.readable && e.materialId ? <button className="bk-text-button" onClick={() => onMaterial(e.materialId!)}>回查返回依据 · 行{e.startLine ?? "未记录"}–{e.endLine ?? "未记录"}</button>
          : "本依据尚无可核实的原文入口"}</p>)}</div>)}
    </details>)}
    <h3>未完成项 · {value.pending.length}</h3>{!value.pendingInventoryAvailable && <p>未完成清单尚无记录，不能据此报告没有待查工作。</p>}
    {value.pendingInventoryAvailable && !value.pending.length && <p>本次记录的未完成条目为零；不代表材料已完整理解或业务已确认。</p>}
    {value.pending.map((pending, i) => <div key={i}><p>{pending.taskKey ?? pending.materialKey ?? "未完成责任身份未记录"} · {pending.reason ?? "原因未记录"}</p>
      {pending.sourceRanges.map((r, n) => <p key={n}>{r.materialId ?? "材料未记录"} · 字节{r.byteStart ?? "未记录"}–{r.byteEnd ?? "未记录"}</p>)}</div>)}
  </div>;
}
