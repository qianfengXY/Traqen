"use client";

import { useCallback, useState } from "react";
import { DeterministicFactsClient, FactsClientError, isDefiniteWriteRejection } from "./client.ts";
import { SourceTruthClient } from "../source-truth/client.ts";
import type { FrozenVersion, Page } from "../source-truth/types.ts";
import type { FactVersion, Manifest, Profile, Replay, Run, Scope } from "./types.ts";
import { useEvidenceResource } from "./use-resource.ts";
import { useOperationJournal } from "./use-operation-journal.ts";
import type { OperationEnvelope, PendingOperation } from "./operations.ts";
import { isEvidenceShortcut } from "./keyboard.ts";
import { extractionScopes, type ExtractionKind } from "./delivery-input.ts";
import { currentScopeCheck, storeScopeCheck, scopeExplanation, defaultProfileId, type ScopeCheck, type ScopeChecks } from "./delivery-state.ts";

const short = (id: string) => `${id.slice(0, 12)}…`;

export function DeliveryPanel({ client, sourceClient, actorId, workspaceId, writable, profiles, versions, runs, versionId, onVersion, refresh, onAccessLost }: {
  client: DeterministicFactsClient; sourceClient: SourceTruthClient; actorId: string; workspaceId: string; writable: boolean;
  profiles: Profile[]; versions: FactVersion[]; runs: Run[]; versionId?: string; onVersion: (id: string) => void;
  refresh: () => Promise<void>; onAccessLost: (error: Error) => void;
}) {
  const journal = useOperationJournal({ workspaceId, actorId, namespace: "delivery" });
  const sourceId = journal.draft.sourceId ?? "", profileId = journal.draft.profileId ?? defaultProfileId(profiles);
  const components = journal.draft.components ?? [], separate = journal.draft.separate ?? false, pending = journal.pending;
  const scopeKind = journal.draft.scopeKind ?? "COMPONENT", scopePath = journal.draft.scopePath ?? "";
  let selectionsError = "";
  try { if (components.length) extractionScopes(components, separate, scopeKind, scopePath); }
  catch (error) { selectionsError = (error as Error).message; }
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [error, setError] = useState<Error | null>(null), [checks, setChecks] = useState<ScopeChecks>({});
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
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
    if (run && "scopes" in run) setSelectedRun(run as unknown as Run);
    const runId = /^\/runs\/([A-Za-z0-9_-]+)\//.exec(operation.path)?.[1];
    if (runId) setSelectedRun((await client.request<{ run: Run }>(`/runs/${runId}`)).run);
    const replay = result.results.find(item => item.kind === "REPLAY")?.value as Replay | undefined;
    if (replay) replayResource.update(current => [...current.filter(item => item.id !== replay.id), replay]);
    setNotice("已按原操作键核对持久回执；草稿保留，不自动采用业务结果。");
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
    setError(null); setNotice(""); setBusy(true);
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
  const displayedRuns = selectedRun && !runs.some(run => run.id === selectedRun.id) ? [selectedRun, ...runs] : runs;
  return <div className="f002-delivery"><section className="f002-panel"><h2>新建技术提取</h2><p>仅选择 F001 已冻结 Bundle 与精确 Receipt；资格在服务端再次核验。未接收合格来源不能绕过。</p>
    {!writable && <p className="f002-notice">当前成员只读，可查历史；不能启动、重试、取消或封存。</p>}
    {(error || readError || journal.error) && <p role="alert">{(error ?? readError ?? journal.error)?.message}</p>}<p role="status">{notice}</p>{pending && <div className="f002-notice"><b>提交结果待对账</b><p>{pending.purpose} · 操作键 {pending.operationId}</p><button className="button" disabled={busy} onClick={() => void reconcile()}>查询同次操作</button><p>未确认前禁止新增写操作；不能把网络丢响应当作任务失败。</p></div>}
    <div className="f002-form-grid"><label>冻结来源<select aria-label="冻结来源" value={sourceId} disabled={busy || !!pending} onChange={event => saveDraft({ sourceId: event.target.value, components: [] })}><option value="">选择精确来源版本</option>{sources?.items.map(item => <option key={item.id} value={item.id}>{short(item.id)} · {item.latestReceipt?.status ?? "无 Receipt"}</option>)}</select></label><label>不可变能力配置<select aria-label="不可变能力配置" value={profileId} disabled={busy || !!pending} onChange={event => saveDraft({ profileId: event.target.value })}><option value="">选择服务端配置</option>{profiles.map(profile => <option key={profile.id} value={profile.id} disabled={!profile.startable}>{profile.name ?? short(profile.id)} · {profile.capabilityIds.join(" / ")}</option>)}</select></label></div>
    {sources?.nextCursor && <button className="button" onClick={() => void sourceClient.request<Page<FrozenVersion>>(`/history/bundles?limit=50&cursor=${encodeURIComponent(sources.nextCursor!)}`).then(page => { if (!client.signal?.aborted) sourceResource.update(current => ({ items: [...current.items, ...page.items], nextCursor: page.nextCursor })); }).catch(report)}>加载更多来源版本</button>}
    {source && <fieldset disabled={busy || !!pending}><legend>选定冻结组件；不读取本机路径或分支</legend>{source.components.map(component => <label key={component.id}><input type="checkbox" checked={components.includes(component.id)} onChange={event => saveDraft({ components: event.target.checked ? [...components, component.id] : components.filter(id => id !== component.id) })} />{component.sourceId} · {component.kind} · {short(component.id)}</label>)}<label><input type="checkbox" checked={separate} onChange={event => saveDraft({ separate: event.target.checked })} />每个组件作为可独立封存的范围</label></fieldset>}
    {source && <details><summary>按目录或文件缩小提取范围</summary><p>大仓库可以先核验一个目录或文件，再扩大范围。路径属于所选冻结组件，不读取本机目录，也不改变来源版本。</p><label>提取范围<select aria-label="提取范围" disabled={busy || !!pending} value={scopeKind} onChange={event => saveDraft({ scopeKind: event.target.value as ExtractionKind })}><option value="COMPONENT">所选组件</option><option value="DIRECTORY">一个目录</option><option value="ENTRY">一个文件</option></select></label>{scopeKind !== "COMPONENT" && <label>冻结组件内的相对路径<input aria-label="冻结组件内的相对路径" disabled={busy || !!pending} value={scopePath} placeholder={scopeKind === "DIRECTORY" ? "src" : "src/index.js"} onChange={event => saveDraft({ scopePath: event.target.value })} /></label>}{selectionsError && <p role="alert">{selectionsError}</p>}</details>}
    <button className="button primary" disabled={commandsBlocked || !source?.latestReceipt || !components.length || !profileId || !!selectionsError} onClick={() => {
      if (source?.latestReceipt) void send("/runs", { source: { bundleId: source.id, receiptId: source.latestReceipt.id }, profileId,
        scopes: extractionScopes(components, separate, scopeKind, scopePath) }, "技术提取");
    }}>按固定输入开始提取</button></section>
    <section className="f002-panel"><h2>活动范围与真实恢复状态</h2><p>只显示最近至多 100 个活动运行；查询指定运行可恢复更早记录。A 已封存不要求 B 完成。</p>
      <label>按运行 ID 回查<input onKeyDown={event => { if (isEvidenceShortcut(event.nativeEvent, ["Enter"])) { const id = event.currentTarget.value.trim(); if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) void client.request<{ run: Run }>(`/runs/${id}`).then(value => { if (!client.signal?.aborted) setSelectedRun(value.run); }).catch(report); } }} placeholder="输入持久 Run ID 后按 Enter" /></label>
      {displayedRuns.map(run => <article key={run.id}><h3>运行 {run.id}</h3>{run.scopes.map(scope => <div className="f002-scope" key={scope.scopeId}><b>{scope.label ?? short(scope.scopeId)}</b><span>{scope.status} · revision {scope.revision}</span><code>{scope.diagnostic?.code ?? "无额外诊断"}</code>
        <p>{scopeExplanation(scope, currentScopeCheck(checks, run.id, scope))}</p>
        {scope.graphVersionId && <button className="button" onClick={() => onVersion(scope.graphVersionId!)}>查看独立封存版本</button>}
        {scope.requestOwned ? <p>此范围由取证请求持久拥有，通用入口不能重试、取消或封存。</p> : <div className="f002-actions"><button className="button" disabled={busy} onClick={() => void check(run.id, scope)}>查看封存条件</button>
          {scope.status === "FAILED_RETRYABLE" && <button className="button" disabled={commandsBlocked} onClick={() => void send(`/runs/${run.id}/retry`, { scopeId: scope.scopeId, revision: scope.revision }, "范围重试")}>重试原范围</button>}
          {["QUEUED", "RUNNING", "READY_TO_SEAL", "FAILED_RETRYABLE", "BLOCKED"].includes(scope.status) && <button className="button" disabled={commandsBlocked} onClick={() => { if (window.confirm("取消此范围会围栏阻止迟到 worker 发布；其他范围和已封存历史不变。")) void send(`/runs/${run.id}/cancel`, { scopeId: scope.scopeId, revision: scope.revision }, "范围取消"); }}>取消此范围</button>}
          {scope.status === "READY_TO_SEAL" && <button className="button primary" disabled={commandsBlocked || !currentScopeCheck(checks, run.id, scope)?.ready} onClick={() => void send(`/runs/${run.id}/scopes/${scope.scopeId}/seal`, { revision: scope.revision }, "独立范围封存")}>封存此范围</button>}</div>}
        {currentScopeCheck(checks, run.id, scope) && <details><summary>原始封存检查与工作项计数</summary><pre>{JSON.stringify(currentScopeCheck(checks, run.id, scope), null, 2)}</pre></details>}</div>)}</article>)}
      {!displayedRuns.length && <p>当前未读到活动运行；不代表历史事实集或材料不存在。</p>}</section>
    <section className="f002-panel"><h2>版本与五部分交付</h2>{versions.map(version => <button className="f002-ref" key={version.graphVersionId} aria-current={versionId === version.graphVersionId ? "true" : undefined} onClick={() => onVersion(version.graphVersionId)}>{version.publishedAt} · {short(version.graphVersionId)}<small>来源 {short(version.bundleId)} · 独立范围 {short(version.scopeId)}</small></button>)}
      {manifest && <><dl className="f002-counts">{Object.entries(manifest.counts).map(([kind, count]) => <div key={kind}><dt>{kind}</dt><dd>{count}</dd></div>)}</dl><details><summary>固定规则、分片摘要与封存闭包</summary><pre>{JSON.stringify(manifest, null, 2)}</pre></details><div className="f002-actions"><button className="button" disabled={busy} onClick={() => void exportVersion()}>导出五部分交付</button><button className="button" disabled={commandsBlocked} onClick={() => void send(`/versions/${versionId}/replays`, {}, "固定规则重放")}>启动真实重放</button></div></>}
      <h3>独立重放回执</h3>{replays.map(replay => <div key={replay.id}><code>{replay.id}</code><p>{replay.status} · candidateDigest {replay.candidateDigest ?? "尚未形成"}</p><button className="button" onClick={() => void client.request<{ replay: Replay }>(`/replays/${replay.id}`).then(value => { if (!client.signal?.aborted) replayResource.update(current => current.map(item => item.id === replay.id ? value.replay : item)); }).catch(report)}>刷新固定重放状态</button>{["RUNNING", "QUEUED"].includes(replay.status) && <button className="button" disabled={commandsBlocked} onClick={() => void send(`/replays/${replay.id}/cancel`, { revision: replay.revision }, "取消重放")}>取消重放</button>}</div>)}</section>
  </div>;
}
