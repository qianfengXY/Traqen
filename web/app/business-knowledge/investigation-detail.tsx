"use client";
import { useCallback, useState } from "react";
import { SourceTruthClient } from "../source-truth/client.ts";
import type { SourceOverview } from "../source-truth/types.ts";
import { BusinessKnowledgeClient, BusinessKnowledgeError } from "./client.ts";
import { useKnowledgeRead } from "./use-read.ts";
import { useCommandContext } from "./use-command.ts";
import { GraphView } from "./graph-view.tsx";
import { ReadIssue, TracePanel } from "./trace-panel.tsx";
import { RunEvents, RunStatus } from "./run-status.tsx";
import { writeKnowledgePosition } from "./model.ts";
import { TechnicalAdoption } from "./technical-adoption.tsx";
import {PublicationPanel} from "./publication-panel.tsx";
import type { GraphView as View, Investigation } from "./types.ts";
import { investigationKind } from './investigation-kind.ts';
import { InvestigationTypeNotice } from './investigation-type-notice.tsx';
import { TaskEvidencePanel } from './task-evidence.tsx';

export function InvestigationDetail({ client, apiBase, id, view, objectKey, onAccessLost, onChanged }: {
  client: BusinessKnowledgeClient; apiBase: string; id: string; view: View; objectKey: string;
  onAccessLost: (error: Error) => void; onChanged: () => void;
}) {
  const load = useCallback((bound: BusinessKnowledgeClient) => bound.get(id), [id]);
  const current = useKnowledgeRead(client, `investigation:${id}`, load, onAccessLost, 2500);
  return <>{current.loading && <section className="bk-panel" role="status">正在复验固定调查…</section>}
    {current.error && <ReadIssue error={current.error} retry={current.retry} />}
    {current.data && <InvestigationReadResult client={client} apiBase={apiBase} run={current.data} view={view} objectKey={objectKey}
      onAccessLost={onAccessLost} onRefresh={current.retry} onChanged={onChanged}/>}</>;
}

export function InvestigationReadResult(props: InvestigationContentsProps) {
  return investigationKind(props.run).kind === 'BUSINESS'
    ? <InvestigationContents {...props}/>: <InvestigationTypeNotice run={props.run}/>;
}

type InvestigationContentsProps = {
  client: BusinessKnowledgeClient; apiBase: string; run: Investigation; view: View; objectKey: string;
  onAccessLost: (error: Error) => void; onRefresh: () => void; onChanged: () => void;
};
function InvestigationContents({ client, apiBase, run, view, objectKey, onAccessLost, onRefresh, onChanged }: InvestigationContentsProps) {
  const [text, setText] = useState(""), [query, setQuery] = useState(""), [uncertain, setUncertain] = useState(false), [human, setHuman] = useState(false);
  const [materialId, setMaterialId] = useState(""), [busy, setBusy] = useState(false), [commandError, setCommandError] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);
  const beginCommand = useCommandContext(client, `${run.id}:${run.revision}`);
  const loadRole = useCallback((bound: BusinessKnowledgeClient) => new SourceTruthClient(apiBase, "", client.workspaceId, bound.signal).request<SourceOverview>(), [apiBase, client.workspaceId]);
  const access = useKnowledgeRead(client, "current-role", loadRole, onAccessLost, 10000);
  const loadEvents = useCallback((bound: BusinessKnowledgeClient) => bound.events(run.id), [run.id]);
  const events = useKnowledgeRead(client, `events:${run.id}:${run.revision}`, loadEvents, onAccessLost);
  const loadGraph = useCallback(async (bound: BusinessKnowledgeClient) => {
    const graph = await bound.graph(run.id, { view, text: query, includeUncertain: uncertain, onlyHumanConfirmed: human });
    if (graph.graphDigest !== run.latestGraph?.digest || graph.sourceBundleId !== run.sourceInput.sourceBundleSnapshotId || graph.profileId !== run.profile.id) {
      throw new BusinessKnowledgeError("图谱版本与当前已核实的调查不符，请重新读取调查状态。", "F003_GRAPH_BINDING_MISMATCH");
    }
    return graph;
  }, [run.id, run.latestGraph?.digest, run.sourceInput.sourceBundleSnapshotId, run.profile.id, view, query, uncertain, human]);
  const select = useCallback((key: string) => { setMaterialId(""); writeKnowledgePosition(client.workspaceId, run.id, view, key); }, [client.workspaceId, run.id, view]);
  const material = useCallback((id: string) => setMaterialId(id), []);
  const target = materialId ? { materialId } : objectKey ? { key: objectKey } : null;
  const refresh = () => { setCommandError(""); setUnconfirmed(false); onRefresh(); };
  const changed = () => { onRefresh(); onChanged(); };
  const canControl = access.data?.role === "MAINTAIN";
  const control = async (action: "pause" | "resume" | "cancel") => {
    if (!canControl || busy || unconfirmed) return;
    if (action === "cancel" && !window.confirm("取消此调查？已保存结果与已消耗预算不会删除或返还。")) return;
    const current = beginCommand();
    setBusy(true); setCommandError("");
    try { await client.control(run.id, action, run.revision); if (current()) changed(); }
    catch (cause) { if (current()) { const error = cause instanceof Error ? cause : new Error("操作未确认");
      setCommandError(error.message); setUnconfirmed(true); onAccessLost(error); } }
    finally { if (!client.signal?.aborted) setBusy(false); }
  };
  return <><p className="bk-caption">{investigationKind(run).label}</p><RunStatus run={run} busy={busy || unconfirmed} canControl={canControl} onControl={action => void control(action)} />
    {access.error && <ReadIssue error={access.error} retry={access.retry} />}
    {commandError && <div className="bk-error" role="alert"><p>{commandError}。未自动重试写操作，请先读取当前调查。</p><button className="button" onClick={refresh}>重新读取调查状态</button></div>}
    <TaskEvidencePanel client={client} run={run} onSelect={select} onMaterial={material} onAccessLost={onAccessLost} />
    <TechnicalAdoption key={`${run.id}:${run.revision}`} client={client} apiBase={apiBase} run={run} canControl={canControl && !busy && !unconfirmed} onAccessLost={onAccessLost} onChanged={changed} />
    {run.latestGraph ? <SavedGraph client={client} run={run} view={view} objectKey={objectKey} query={query} text={text} setText={setText}
      onSearch={() => setQuery(text)} uncertain={uncertain} setUncertain={setUncertain} human={human} setHuman={setHuman}
      load={loadGraph} onSelect={select} onMaterial={material} onAccessLost={onAccessLost} canControl={canControl && !busy && !unconfirmed} />
      : <section className="bk-panel bk-empty"><h2>尚无保存的分析图谱</h2><p>{["QUEUED", "RUNNING"].includes(run.state) ? "调查正在推进；未完成时不会生成成功图谱。" : "当前运行没有产生可读取图谱。失败、停止或材料不足不等于空图或已理解业务。"}</p></section>}
    {target && run.latestGraph && <TracePanel client={client} run={run} target={target} onSelect={select} onMaterial={material} onAccessLost={onAccessLost}
      canControl={canControl && !busy && !unconfirmed}
      onClose={() => { setMaterialId(""); writeKnowledgePosition(client.workspaceId, run.id, view); }} />}
    {events.error && <ReadIssue error={events.error} retry={events.retry} />}{events.data && <RunEvents events={events.data} />}
  </>;
}

function SavedGraph({ client, run, view, objectKey, query, text, setText, onSearch, uncertain, setUncertain, human, setHuman, load, onSelect, onMaterial, onAccessLost,canControl }: {
  client: BusinessKnowledgeClient; run: Investigation; view: View; objectKey: string; query: string; text: string; setText: (value: string) => void; onSearch: () => void;
  uncertain: boolean; setUncertain: (value: boolean) => void; human: boolean; setHuman: (value: boolean) => void;
  load: (client: BusinessKnowledgeClient) => Promise<import("./types.ts").BusinessGraph>; onSelect: (key: string) => void; onMaterial: (id: string) => void; onAccessLost: (error: Error) => void;
  canControl:boolean;
}) {
  const graph = useKnowledgeRead(client, `graph:${run.id}:${run.latestGraph?.digest}:${view}:${query}:${uncertain}:${human}`, load, onAccessLost);
  return <section className="bk-panel"><div className="bk-heading"><h2>已保存分析</h2><button className="button" onClick={graph.retry}>复验权限并刷新图谱</button></div>
    <PublicationPanel client={client} run={run} canControl={canControl} onAccessLost={onAccessLost}/>
    <div className="bk-tabs" role="group" aria-label="保存图谱视图">{([["BUSINESS", "业务关系"], ["IMPLEMENTATION", "实现与依据"], ["COVERAGE", "材料覆盖"]] as const).map(([key, label]) => <button className="button" aria-pressed={view === key} key={key} onClick={() => writeKnowledgePosition(client.workspaceId, run.id, key, objectKey)}>{label}</button>)}</div>
    <form className="bk-search" onSubmit={event => { event.preventDefault(); onSearch(); }}><label>搜索保存图谱<input value={text} maxLength={1000} onChange={event => setText(event.target.value)} placeholder="对象、规则或关联关键词" /></label><button className="button" type="submit">搜索</button>
      <label><input type="checkbox" checked={uncertain} onChange={event => setUncertain(event.target.checked)} />包含待查与未知</label><label><input type="checkbox" checked={human} onChange={event => setHuman(event.target.checked)} />仅人工确认</label></form>
    {graph.loading && <p role="status">正在复验保存图谱…</p>}{graph.error && <ReadIssue error={graph.error} retry={graph.retry} />}
    {graph.data && <><GraphView key={`${view}:${query}:${uncertain}:${human}`} graph={graph.data} selectedKey={objectKey} onSelect={onSelect} onMaterial={onMaterial} />
      {JSON.stringify(graph.data.adoptedVersionIds) !== JSON.stringify(run.adoptedVersionIds) && <p className="bk-warning">调查已明确采用新技术依据；此保存图谱仍使用上面列出的原依据，尚未被新分析替换。</p>}</>}
  </section>;
}
