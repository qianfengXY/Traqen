"use client";

import { useCallback, useEffect, useState } from "react";
import { DeterministicFactsClient, FactsClientError, isDefiniteWriteRejection } from "./client.ts";
import { SourceTruthClient } from "../source-truth/client.ts";
import type { FrozenVersion, Page } from "../source-truth/types.ts";
import type { FactVersion, Manifest, Profile, Replay, Run, Scope } from "./types.ts";
import { useEvidenceResource } from "./use-resource.ts";
import { useOperationJournal } from "./use-operation-journal.ts";
import type { OperationEnvelope, PendingOperation } from "./operations.ts";
import { isEvidenceShortcut } from "./keyboard.ts";
import { extractionScopes, type ExtractionKind } from "./delivery-input.ts";
import { currentScopeCheck, storeScopeCheck, scopeExplanation, defaultProfileId, isAutomaticAnalysis, type ScopeCheck, type ScopeChecks } from "./delivery-state.ts";

import { RunProgress } from "./run-progress.tsx";

const short = (id: string) => `${id.slice(0, 12)}…`;

export function DeliveryPanel({ client, sourceClient, actorId, workspaceId, writable, profiles, versions, runs, versionId, onVersion, refresh, onAccessLost, step = 1, onStarted, onRunChange, onPreview, onStep, initialRunId }: {
  step?: number; initialRunId?: string; onStarted?: (run: Run) => void; onRunChange?: (run: Run) => void;
  onPreview?: (run: Run, scope: Scope, step?: number) => void; onStep?: (step: number) => void;
  client: DeterministicFactsClient; sourceClient: SourceTruthClient; actorId: string; workspaceId: string; writable: boolean;
  profiles: Profile[]; versions: FactVersion[]; runs: Run[]; versionId?: string; onVersion: (id: string, run?: Run) => void;
  refresh: () => Promise<void>; onAccessLost: (error: Error) => void;
}) {
  const journal = useOperationJournal({ workspaceId, actorId, namespace: "delivery" });
  const sourceId = journal.draft.sourceId ?? "", profileId = profiles.some(p => p.id === journal.draft.profileId && !isAutomaticAnalysis(p)) ? journal.draft.profileId! : defaultProfileId(profiles);
  const components = journal.draft.components ?? [], separate = journal.draft.separate ?? false, pending = journal.pending;
  const scopeKind = journal.draft.scopeKind ?? "COMPONENT", scopePath = journal.draft.scopePath ?? "";
  let selectionsError = "";
  try { if (components.length) extractionScopes(components, separate, scopeKind, scopePath); }
  catch (error) { selectionsError = (error as Error).message; }
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [error, setError] = useState<Error | null>(null), [checks, setChecks] = useState<ScopeChecks>({});
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const selectedRunId = initialRunId ?? selectedRun?.id ?? journal.draft.runId;
  const [reviewed, setReviewed] = useState("");
  useEffect(() => { if (selectedRun) onRunChange?.(selectedRun); }, [selectedRun, onRunChange]);
  // The overview lists active work only. Keep following the newly created run
  // until its terminal receipt arrives, even when it disappears from that list.
  useEffect(() => {
    if (!selectedRunId) return;
    const controller = new AbortController();
    const signal = client.signal ? AbortSignal.any([client.signal, controller.signal]) : controller.signal;
    const bound = client.withSignal(signal);
    let reading = false, finished = false;
    const observe = async () => {
      if (reading || finished || signal.aborted) return;
      reading = true;
      try {
        const { run } = await bound.request<{ run: Run }>(`/runs/${selectedRunId}`);
        if (signal.aborted) return;
        setSelectedRun(run);
        finished = run.scopes.every(scope => !["QUEUED", "RUNNING", "READY_TO_SEAL"].includes(scope.status));
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof FactsClientError && [401, 403].includes(error.status)) onAccessLost(error);
        else setError(error instanceof Error ? error : new Error("任务状态读取未完成"));
      } finally { reading = false; }
    };
    void observe();
    const timer = window.setInterval(() => void observe(), 3000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [client, selectedRunId, onAccessLost]);
  const report = (error: unknown) => {
    if (client.signal?.aborted) return;
    if (error instanceof FactsClientError && [401, 403].includes(error.status)) onAccessLost(error);
    else setError(error instanceof Error ? error : new Error("操作未确认"));
  };
  const sourceLoad = useCallback(() => sourceClient.request<Page<FrozenVersion>>("/history/bundles?limit=50"), [sourceClient]);
  const sourceResource = useEvidenceResource(client, "source-bundles", sourceLoad, onAccessLost);
  const sources = sourceResource.data;
  const manifestLoad = useCallback(async (bound: DeterministicFactsClient) => versionId
    ? (await bound.request<{ manifest: Manifest }>(`/versions/${versionId}/manifest`)).manifest : null, [versionId]);
  const replayLoad = useCallback(async (bound: DeterministicFactsClient) => versionId
    ? (await bound.request<{ replays: Replay[] }>(`/versions/${versionId}/replays`)).replays : [], [versionId]);
  const manifestResource = useEvidenceResource(client, versionId ?? "none", manifestLoad, onAccessLost);
  const replayResource = useEvidenceResource(client, versionId ?? "none", replayLoad, onAccessLost);
  const manifest = manifestResource.data, replays = replayResource.data ?? [];
  const readError = sourceResource.error ?? manifestResource.error ?? replayResource.error;
  const source = sources?.items.find(item => item.id === sourceId);
  const commandsBlocked = !writable || busy || !journal.available || pending !== null;
  const saveDraft = (patch: Partial<typeof journal.draft>) => {
    try { journal.saveDraft({ ...journal.draft, ...patch }); } catch (error) { report(error); }
  };
  const recover = async (operation: PendingOperation) => {
    const result = await client.request<OperationEnvelope>(`/operations/${operation.operationId}`);
    if (!journal.resolve(result)) throw new Error("原操作回执与固定输入不匹配；保留原键，不重复提交。");
    const run = result.results.find(item => item.kind === "RUN")?.value;
    if (run && "scopes" in run) {
      const accepted = run as unknown as Run;
      journal.saveDraft({ ...journal.draft, runId: accepted.id });
      setSelectedRun(accepted); if (operation.path === "/runs") onStarted?.(accepted);
    }
    const runId = /^\/runs\/([A-Za-z0-9_-]+)\//.exec(operation.path)?.[1];
    if (runId) {
      const updated = (await client.request<{ run: Run }>(`/runs/${runId}`)).run;
      setSelectedRun(updated);
      if (operation.path.endsWith("/seal")) { const sealed = updated.scopes.find(scope => scope.graphVersionId); if (sealed?.graphVersionId) onVersion(sealed.graphVersionId, updated); }
    }
    const replay = result.results.find(item => item.kind === "REPLAY")?.value as Replay | undefined;
    if (replay) replayResource.update(current => [...current.filter(item => item.id !== replay.id), replay]);
    setNotice(operation.path === "/runs" ? "分析任务已接收并保存，正在读取实际处理进度。" : "操作已确认，已读取同一运行的最新状态。");
  };
  const reconcile = async () => {
    if (!pending || busy) return;
    setBusy(true); setError(null);
    try {
      await recover(pending);
      await refresh();
    } catch (error) { report(error); }
    finally { if (!client.signal?.aborted) setBusy(false); }
  };
  const send = async (path: string, input: Record<string, unknown>, purpose: string) => {
    if (commandsBlocked) return;
    const operationId = crypto.randomUUID();
    const operation = { operationId, path, body: { ...input, operationId }, purpose };
    let dispatching = true;
    setError(null); setNotice(path === "/runs" ? "正在提交所选材料，等待服务接收…" : "正在提交操作，等待真实回执…"); setBusy(true);
    try {
      // Persist before dispatch. If storage is unavailable, no write is sent.
      // No credentials, original material bytes, or returned facts are stored.
      journal.begin(operation);
      await client.request(path, "POST", operation.body);
      dispatching = false;
      if (client.signal?.aborted) return;
      await recover(operation);
      await refresh();
    } catch (error) {
      if (dispatching && isDefiniteWriteRejection(error)) { try { journal.reject(operationId); } catch (storageError) { report(storageError); } }
      report(error);
    } finally { if (!client.signal?.aborted) setBusy(false); }
  };
  const check = async (runId: string, scope: Scope) => {
    try { const result = await client.request<{ check: ScopeCheck }>(`/runs/${runId}/scopes/${scope.scopeId}/check`, "POST", {}); if (!client.signal?.aborted) setChecks(current => storeScopeCheck(current, runId, scope.scopeId, result.check)); } catch (error) { report(error); }
  };
  const exportVersion = async () => {
    if (!versionId || !manifest || busy) return;
    setBusy(true); setError(null);
    try {
      const blob = await client.exportVersion(versionId);
      client.signal?.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `f002-${versionId}.json`; anchor.click(); URL.revokeObjectURL(url);
      setNotice("已生成固定版本五部分交付 JSON；不包含材料原始字节，不自动采用为业务结论。");
    } catch (error) { report(error); }
    finally { if (!client.signal?.aborted) setBusy(false); }
  };
  const displayedRuns = selectedRun ? [selectedRun, ...runs.filter(run => run.id !== selectedRun.id)] : runs;
  const disabledReason = !writable ? "当前身份为只读" : busy ? "正在提交，请等待本次请求" : !journal.available ? "本地操作记录不可用，尚未发送请求" : pending ? "上次操作尚未确认，请核对原回执" : !source?.latestReceipt ? "请先选择一个已冻结的 F001 来源" : !components.length ? "请选择要分析的材料组件" : !profileId ? "分析规则尚未就绪" : selectionsError;
  const scopeReviewed = (run: Run, scope: Scope) => `${run.id}:${scope.scopeId}:${scope.revision}`;
  return <div className="f002-delivery"><section className="f002-panel" hidden={step !== 1}><p className="eyebrow">步骤 1 · 输入</p><h2>选择冻结材料</h2><p>从 F001 已冻结的来源选择材料。分析会产生可检查的对象、事实、关系和缺口；看完后由你明确封存。</p>
    {!writable && <p className="f002-notice">当前成员只读，可查历史；不能启动、重试、取消或封存。</p>}
    {(error || readError || journal.error) && <p role="alert">{(error ?? readError ?? journal.error)?.message}</p>}<p role="status">{notice}</p>{pending && !busy && <div className="f002-notice"><b>提交结果待对账</b><p>{pending.purpose} · 操作键 {pending.operationId}</p><button className="button" disabled={busy} onClick={() => void reconcile()}>查询同次操作</button><p>未确认前禁止新增写操作；不能把网络丢响应当作任务失败。</p></div>}
    <div className="f002-form-grid"><label>冻结来源<select aria-label="冻结来源" value={sourceId} disabled={busy || !!pending} onChange={event => saveDraft({ sourceId: event.target.value, components: [] })}><option value="">选择精确来源版本</option>{sources?.items.map(item => <option key={item.id} value={item.id}>{new Date(item.publishedAt).toLocaleString()} · {item.components.map(c => `${c.sourceId}（${c.kind}）`).join("、")} · {item.latestReceipt?.status ?? "无回执"}</option>)}</select></label><details><summary>分析规则与技术详情</summary><label>不可变能力配置<select aria-label="不可变能力配置" value={profileId} disabled={busy || !!pending} onChange={event => saveDraft({ profileId: event.target.value })}><option value="">选择服务端配置</option>{profiles.map(profile => <option key={profile.id} value={profile.id} disabled={!profile.startable || isAutomaticAnalysis(profile)}>{profile.name === "technical-review-v5" ? "技术分析 · 检查后手动封存（推荐）" : `${profile.name ?? short(profile.id)}${isAutomaticAnalysis(profile) ? " · 历史自动封存" : ""}`}</option>)}</select></label><p>当前规则：{profiles.find(p => p.id === profileId)?.capabilityIds.join("、")}。不执行材料代码，不调用模型。</p></details></div>
    {sources?.nextCursor && <button className="button" onClick={() => void sourceClient.request<Page<FrozenVersion>>(`/history/bundles?limit=50&cursor=${encodeURIComponent(sources.nextCursor!)}`).then(page => { if (!client.signal?.aborted) sourceResource.update(current => ({ items: [...current.items, ...page.items], nextCursor: page.nextCursor })); }).catch(report)}>加载更多来源版本</button>}
    {source && <p className="f002-source-summary">已选来源：{source.components.filter(component => components.includes(component.id)).map(component => `${component.sourceId} · ${component.kind}`).join("、") || "尚未选组件"}；{scopeKind === "COMPONENT" ? "组件内的全部冻结材料" : `${scopeKind === "ENTRY" ? "文件" : "目录"} ${scopePath}`}。输入与结果始终绑定此冻结来源。</p>}{source && <fieldset disabled={busy || !!pending}><legend>选择材料组件；不会读取本机路径或移动分支</legend>{source.components.map(component => <label key={component.id}><input type="checkbox" checked={components.includes(component.id)} onChange={event => saveDraft({ components: event.target.checked ? [...components, component.id] : components.filter(id => id !== component.id) })} />{component.sourceId} · {component.kind} · {component.fileCount} 文件 / {component.directoryCount} 目录</label>)}<label><input type="checkbox" checked={separate} onChange={event => saveDraft({ separate: event.target.checked })} />每个组件独立生成分析结果</label></fieldset>}
    {source && <details><summary>按目录或文件缩小提取范围</summary><p>大仓库可以先核验一个目录或文件，再扩大范围。路径属于所选冻结组件，不读取本机目录，也不改变来源版本。</p><label>提取范围<select aria-label="提取范围" disabled={busy || !!pending} value={scopeKind} onChange={event => saveDraft({ scopeKind: event.target.value as ExtractionKind })}><option value="COMPONENT">所选组件</option><option value="DIRECTORY">一个目录</option><option value="ENTRY">一个文件</option></select></label>{scopeKind !== "COMPONENT" && <label>冻结组件内的相对路径<input aria-label="冻结组件内的相对路径" disabled={busy || !!pending} value={scopePath} placeholder={scopeKind === "DIRECTORY" ? "src" : "src/index.js"} onChange={event => saveDraft({ scopePath: event.target.value })} /></label>}{selectionsError && <p role="alert">{selectionsError}</p>}</details>}
    <button className="button primary" disabled={commandsBlocked || !source?.latestReceipt || !components.length || !profileId || !!selectionsError} onClick={() => {
      if (source?.latestReceipt) void send("/runs", { source: { bundleId: source.id, receiptId: source.latestReceipt.id }, profileId,
        scopes: extractionScopes(components, separate, scopeKind, scopePath) }, "技术提取");
    }}>{busy ? "正在提交分析…" : "开始分析"}</button>{disabledReason && <p className="f002-disabled-reason">{disabledReason}</p>}</section>
    <section className="f002-panel" hidden={![2,5].includes(step)}><p className="eyebrow">{step === 5 ? "步骤 5 · 固定交付" : "步骤 2 · 处理"}</p><h2>{step === 5 ? "检查并封存成果" : "技术分析"}</h2><p role="status">{notice}</p>{error && <p role="alert">{error.message}</p>}<p>每个范围独立处理，已完成的结果不等待其他范围。失败和未完成工作不会显示为成功。</p>
      <details><summary>技术详情与运行回查</summary><label>按运行 ID 回查<input onKeyDown={event => { if (isEvidenceShortcut(event.nativeEvent, ["Enter"])) { const id = event.currentTarget.value.trim(); if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) void client.request<{ run: Run }>(`/runs/${id}`).then(value => { if (!client.signal?.aborted) setSelectedRun(value.run); }).catch(report); } }} placeholder="输入持久 Run ID 后按 Enter" /></label></details>
      {displayedRuns.map(run => <article key={run.id}><h3>{run.sourceInput?.bundleId === sourceId ? "本次所选材料" : "已保存的分析任务"} · {new Date(run.createdAt).toLocaleString()}</h3><details><summary>固定输入与运行标识</summary><p>运行 {run.id}</p><p>来源 {run.sourceInput?.bundleId} · 接收回执 {run.sourceInput?.receiptId} · 规则 {run.profileId}</p></details>{run.scopes.map(scope => <div className="f002-scope" key={scope.scopeId}><b>{scope.label ?? short(scope.scopeId)}</b><span>{({ QUEUED: "等待分析", RUNNING: "分析中", READY_TO_SEAL: "结果待检查", SEALED: "已封存", FAILED_RETRYABLE: "分析失败", BLOCKED: "任务受阻", CANCELLED: "已取消" } as Record<string, string>)[scope.status] ?? "状态待核实"}</span>{scope.diagnostic?.code && <code>{scope.diagnostic.code}</code>}
        {[2,5].includes(step) && <RunProgress key={`${run.id}:${scope.scopeId}`} client={client} runId={run.id} scope={scope} accessLost={onAccessLost} />}<p>{scopeExplanation(scope, currentScopeCheck(checks, run.id, scope), profiles.find(profile => profile.id === run.profileId))}</p>
        {scope.status === "READY_TO_SEAL" && <div className="f002-actions"><button className="button primary" onClick={() => onPreview?.(run, scope)}>查看待检查成果</button><button className="button" onClick={() => { onPreview?.(run, scope, 4); }}>查看覆盖与缺口</button>{step !== 5 && <button className="button" onClick={() => onStep?.(5)}>前往封存与交付</button>}</div>}{scope.graphVersionId && <button className="button" onClick={() => onVersion(scope.graphVersionId!)}>查看分析结果</button>}
        {scope.requestOwned ? <p>此范围属于业务调查的补证请求，请返回原调查管理。</p> : <div className="f002-actions">{step === 5 && !isAutomaticAnalysis(profiles.find(profile => profile.id === run.profileId)) && <button className="button" disabled={busy} onClick={() => void check(run.id, scope)}>查看封存条件</button>}
          {scope.status === "FAILED_RETRYABLE" && <button className="button" disabled={commandsBlocked} onClick={() => void send(`/runs/${run.id}/retry`, { scopeId: scope.scopeId, revision: scope.revision }, "范围重试")}>重试原范围</button>}
          {["QUEUED", "RUNNING", "READY_TO_SEAL", "FAILED_RETRYABLE", "BLOCKED"].includes(scope.status) && <button className="button" disabled={commandsBlocked} onClick={() => { if (window.confirm("取消此范围会围栏阻止迟到 worker 发布；其他范围和已封存历史不变。")) void send(`/runs/${run.id}/cancel`, { scopeId: scope.scopeId, revision: scope.revision }, "范围取消"); }}>取消此范围</button>}
          {step === 5 && scope.status === "READY_TO_SEAL" && !isAutomaticAnalysis(profiles.find(profile => profile.id === run.profileId)) && <><label><input type="checkbox" checked={reviewed === scopeReviewed(run, scope)} onChange={event => setReviewed(event.target.checked ? scopeReviewed(run, scope) : "")} />我已检查本次事实、关联与缺口</label><button className="button primary" disabled={commandsBlocked || reviewed !== scopeReviewed(run, scope) || !currentScopeCheck(checks, run.id, scope)?.ready} onClick={() => void send(`/runs/${run.id}/scopes/${scope.scopeId}/seal`, { revision: scope.revision }, "独立范围封存")}>封存此范围</button></>}</div>}
        {currentScopeCheck(checks, run.id, scope) && <details><summary>原始封存检查与工作项计数</summary><pre>{JSON.stringify(currentScopeCheck(checks, run.id, scope), null, 2)}</pre></details>}</div>)}</article>)}
      {!displayedRuns.length && <p>当前未读到活动运行；不代表历史事实集或材料不存在。</p>}</section>
    <section className="f002-panel" hidden={step !== 5}><h2>已封存结果与历史</h2>{versions.map(version => <button className="f002-ref" key={version.graphVersionId} aria-current={versionId === version.graphVersionId ? "true" : undefined} onClick={() => onVersion(version.graphVersionId)}>{version.publishedAt} · {short(version.graphVersionId)}<small>来源 {short(version.bundleId)} · 独立范围 {short(version.scopeId)}</small></button>)}
      {manifest && <><dl className="f002-counts">{Object.entries(manifest.counts).map(([kind, count]) => <div key={kind}><dt>{kind}</dt><dd>{count}</dd></div>)}</dl><details><summary>固定规则、分片摘要与封存闭包</summary><pre>{JSON.stringify(manifest, null, 2)}</pre></details><div className="f002-actions"><button className="button" disabled={busy} onClick={() => void exportVersion()}>导出五部分交付</button><button className="button" disabled={commandsBlocked} onClick={() => void send(`/versions/${versionId}/replays`, {}, "固定规则重放")}>启动真实重放</button></div></>}
      <h3>独立重放回执</h3>{replays.map(replay => <div key={replay.id}><code>{replay.id}</code><p>{replay.status} · candidateDigest {replay.candidateDigest ?? "尚未形成"}</p><button className="button" onClick={() => void client.request<{ replay: Replay }>(`/replays/${replay.id}`).then(value => { if (!client.signal?.aborted) replayResource.update(current => current.map(item => item.id === replay.id ? value.replay : item)); }).catch(report)}>刷新固定重放状态</button>{["RUNNING", "QUEUED"].includes(replay.status) && <button className="button" disabled={commandsBlocked} onClick={() => void send(`/replays/${replay.id}/cancel`, { revision: replay.revision }, "取消重放")}>取消重放</button>}</div>)}</section>
  </div>;
}
