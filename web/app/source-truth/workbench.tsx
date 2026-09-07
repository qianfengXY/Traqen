"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SourceClientError, SourceTruthClient } from "./client.ts";
import { draftFromVersion, sourceJourney, sourceStations } from "./journey.ts";
import { SourceForm } from "./source-form.tsx";
import { ArtifactTable, GapBrowser } from "./evidence-view.tsx";
import { LocalEntryStore } from "./local-entry-store.ts";
import { transferDirectory, type TransferProgress } from "./transfer.ts";
import type { DirectoryHandle } from "./directory.ts";
import type { Confirmation, DraftInput, FrozenVersion, Page, RunDetail, SourceOverview, SourceRun } from "./types.ts";
import { SourceVersionView } from "./version-view.tsx";
import { SourceStagingView } from "./staging-view.tsx";
import { observeSourceReads } from "./observe.ts";
import { revealSourceStation } from "./rail.ts";
import "./workbench.css";

const terminal = new Set(["SUCCEEDED", "BLOCKED", "FAILED_RETRYABLE", "CANCELLED"]);
const copies = [
  "选择 Git、目录，或将两者组合。来源先登记为草稿，不会立即执行分析。",
  "确认精确基线、Git 目录根以及各来源本版更新或沿用。开始后本次输入锁定。",
  "自动验证读取授权、目标安全、版本与资源。阻断不能通过接受缺口绕过。",
  "枚举完整的选定范围。目录需要本机访问授权；此时数量只代表已发现条目。",
  "形成不可变的预期清单。清单有哈希不代表文件内容已经收到。",
  "流式接收、逐文件哈希校验、对账并保存检查点。关页不等于取消服务端任务。",
  "核对全部处置。非阻断缺口必须保留范围、理由、责任人与明确失效时间。",
  "准备私有材料后原子冻结包与 Receipt；提交前没有半包，冻结后不改写历史。",
];
const emptyInput: DraftInput = { sources: [], baselineBundleId: null };
const short = (value: string | null | undefined) => value ? `${value.slice(0, 12)}…` : "—";

export function SourceTruthWorkbench({ apiBase, apiToken, workspaceId, workspaceName }: { apiBase: string; apiToken: string; workspaceId: string; workspaceName: string }) {
  const [credential, setCredential] = useState(apiToken);
  const [credentialInput, setCredentialInput] = useState(apiToken);
  const [identityVersion, setIdentityVersion] = useState(0);
  return <section className="st-workbench" aria-label="来源快照工作台">
    <details className="st-auth"><summary>来源快照成员身份</summary><p>由服务端绑定成员与 Workspace 权限；通用 API Token 不自动获得来源材料权限。</p><div className="st-actions"><label>成员访问令牌（仅本页内存）<input type="password" autoComplete="off" value={credentialInput} onChange={(event) => setCredentialInput(event.target.value)} /></label><button className="button" onClick={() => { setCredential(credentialInput); setIdentityVersion((version) => version + 1); }}>验证并连接</button></div></details>
    <SourceWorkspaceSession key={`${apiBase}:${workspaceId}:${identityVersion}`} apiBase={apiBase} token={credential} workspaceId={workspaceId} workspaceName={workspaceName} />
  </section>;
}

function SourceWorkspaceSession({ apiBase, token, workspaceId, workspaceName }: { apiBase: string; token: string; workspaceId: string; workspaceName: string }) {
  const client = useMemo(() => new SourceTruthClient(apiBase, token, workspaceId), [apiBase, token, workspaceId]);
  const [overview, setOverview] = useState<SourceOverview | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [versions, setVersions] = useState<Page<FrozenVersion>>({ items: [], nextCursor: null });
  const [runs, setRuns] = useState<Page<SourceRun>>({ items: [], nextCursor: null });
  const [form, setForm] = useState<DraftInput>(emptyInput);
  const [baselineVersion, setBaselineVersion] = useState<FrozenVersion | null>(null);
  const [editing, setEditing] = useState(false), [reviewAgain, setReviewAgain] = useState(false);
  const [selectedStation, setSelectedStation] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState<TransferProgress | null>(null);
  const [transferring, setTransferring] = useState(false), [cancelling, setCancelling] = useState(false);
  const [directoryName, setDirectoryName] = useState<string | null>(null);
  const [confirmationChecked, setConfirmationChecked] = useState(false), [reason, setReason] = useState(""), [expires, setExpires] = useState("");
  const [versionId, setVersionId] = useState<string | null>(null);
  const selectedRun = useRef<string | null>(null), sequence = useRef(0), hydrated = useRef(false), inFlight = useRef(false);
  const historyCursor = useRef<{ bundles: string | null; runs: string | null }>({ bundles: null, runs: null });
  const directory = useRef<DirectoryHandle | null>(null), transferController = useRef<AbortController | null>(null);
  const rail = useRef<HTMLOListElement | null>(null);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    const [data, versionPage, runPage] = await Promise.all([client.request<SourceOverview>(), client.request<Page<FrozenVersion>>(`/history/bundles?limit=50${historyCursor.current.bundles ? `&cursor=${historyCursor.current.bundles}` : ""}`), client.request<Page<SourceRun>>(`/history/runs?limit=50${historyCursor.current.runs ? `&cursor=${historyCursor.current.runs}` : ""}`)]);
    const runId = selectedRun.current === "NEW" ? null : selectedRun.current ?? data.activeRun?.id ?? runPage.items[0]?.id;
    const current = runId ? await client.request<RunDetail>(`/runs/${encodeURIComponent(runId)}/view`) : null;
    if (client.signal?.aborted || request !== sequence.current) return;
    setOverview(data); setVersions(versionPage); setRuns(runPage); setDetail(current);
    if (!hydrated.current) { setForm(data.draft?.input ?? emptyInput); hydrated.current = true; }
  }, [client]);
  useEffect(() => {
    // A fresh signal for each effect setup, including React StrictMode's
    // setup/cleanup/setup cycle. Never reuse the first aborted signal.
    const controller = client.beginSession();
    const report = (error: Error) => { if (!controller.signal.aborted) setError(error); };
    const stop = observeSourceReads(refresh, { signal: controller.signal, onError: report });
    return () => { stop(); controller.abort(); transferController.current?.abort(); };
  }, [refresh, client]);

  const run = detail?.run ?? null;
  const journey = sourceJourney(run, editing ? 0 : overview?.draft?.revision ?? 0, Boolean(detail?.confirmation) && detail?.confirmation?.currentlyValid !== false && !reviewAgain, selectedStation);
  const loaded = overview !== null;
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const reveal = () => revealSourceStation(element, journey.selected);
    reveal();
    const resize = new ResizeObserver(reveal);
    resize.observe(element);
    return () => resize.disconnect();
  }, [loaded, journey.selected]);
  const returnToCurrent = () => {
    setSelectedStation(null);
    revealSourceStation(rail.current, journey.current);
  };
  const writable = overview?.role === "MAINTAIN";
  const hasGaps = Boolean(detail?.candidate && detail.candidate.gapCount !== "0");
  const frozen = versions.items.find((version) => version.id === versionId);
  const canEdit = writable && !overview?.activeRun && (!run || terminal.has(run.status));
  const attempt = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice("");
    try { await work(); }
    catch (error) { if (!client.signal?.aborted) setError(error instanceof Error ? error : new Error("操作未确认，请查询原任务")); }
    finally { inFlight.current = false; if (!client.signal?.aborted) { setBusy(false); await refresh().catch((error) => setError(error)); } }
  };
  const chooseDirectory = async () => {
    const picker = (window as Window & { showDirectoryPicker?: (options: { mode: "read" }) => Promise<DirectoryHandle> }).showDirectoryPicker;
    if (!picker) { setError(new Error("当前浏览器不能完整枚举目录。请使用支持目录访问 API 的安全上下文；不能用遗漏空目录的文件列表冒充完整目录。")); return null; }
    try { const handle = await picker({ mode: "read" }); directory.current = handle; setDirectoryName(handle.name ?? "已选择目录"); return handle; }
    catch (error) { if ((error as Error).name !== "AbortError") setError(error as Error); return null; }
  };
  const sendDirectory = async (runId: string, input: DraftInput, handle: DirectoryHandle) => {
    const source = input.sources.find((source) => source.kind === "DIRECTORY_UPLOAD" && source.mode === "UPDATE");
    if (!source || !overview) return;
    const store = await LocalEntryStore.open();
    const localController = new AbortController(); transferController.current = localController; setTransferring(true);
    const localClient = new SourceTruthClient(apiBase, token, workspaceId, AbortSignal.any([client.signal!, localController.signal]));
    try {
      let lastUpdate = 0, lastPhase = "";
      const result = await transferDirectory(localClient, runId, source.sourceId, handle, store, overview.policy, (progress) => {
        const now = performance.now();
        if (progress.phase !== lastPhase || now - lastUpdate > 100) { setProgress(progress); lastUpdate = now; lastPhase = progress.phase; }
      });
      setNotice(`本机完整核对完成；本次传输 ${result.sentBytes} 字节，无需再次传输 ${result.unnecessaryBytes} 字节。请继续复核清单。`);
    } catch (error) {
      if (localController.signal.aborted && !client.signal?.aborted) setNotice("本机传输已暂停。服务端任务和已验证检查点保留；重新选择相同目录即可继续。");
      else throw error;
    } finally { transferController.current = null; if (!client.signal?.aborted) setTransferring(false); await store.discard(); }
  };
  const newDraft = (base?: FrozenVersion) => {
    if (base) { setForm(draftFromVersion(base)); setBaselineVersion(base); }
    selectedRun.current = "NEW"; setDetail(null); setEditing(true); setSelectedStation(null); setVersionId(null); setReviewAgain(false); setConfirmationChecked(false);
  };
  const confirm = () => attempt(async () => {
    if (!detail?.candidate || !confirmationChecked) return;
    const input = { candidateId: detail.candidate.id, gapSetId: detail.candidate.gapSetId, ...(hasGaps ? { reason, expiresAt: new Date(expires).toISOString() } : {}) };
    await client.request<Confirmation>(`/runs/${run!.id}/confirm`, "POST", input);
    setReviewAgain(false); setSelectedStation(null); setConfirmationChecked(false);
  });
  const primary = () => {
    switch (journey.action) {
      case "SAVE": return void attempt(async () => { await client.request("/draft", "PUT", { expectedRevision: overview?.draft?.revision ?? 0, input: form }); setEditing(false); setSelectedStation(null); });
      case "START": return void attempt(async () => {
        const created = await client.request<SourceRun>("/runs", "POST", { draftRevision: overview!.draft!.revision });
        selectedRun.current = created.id; setSelectedStation(null); await refresh();
        const active = await client.request<SourceRun>(`/runs/${created.id}/advance`, "POST", {}); await refresh();
        if (active.status === "WAITING_FOR_CLIENT" && directory.current) await sendDirectory(active.id, active.input, directory.current);
      });
      case "RESUME_DIRECTORY": return void (async () => {
        const handle = await chooseDirectory();
        if (handle) await attempt(() => sendDirectory(run!.id, run!.input, handle));
      })();
      case "RECONCILE_RESTORE": return void attempt(async () => {
        await client.request(`/runs/${run!.id}/reconcile-restore`, "POST", {});
        setSelectedStation(null); setNotice("已按原输入核对恢复点。未完成材料继续采集；清单复核和冻结仍需你明确操作。");
      });
      case "CONFIRM": return void confirm();
      case "SEAL": return void attempt(async () => {
        await client.request(`/runs/${run!.id}/seal`, "POST", { confirmationId: detail!.confirmation!.id, clientToken: crypto.randomUUID() }); setSelectedStation(null);
      });
      case "QUERY_RESULT": return void attempt(async () => {
        if (run!.status === "PREPARING_SEAL" && detail?.confirmation) await client.request(`/runs/${run!.id}/seal`, "POST", { confirmationId: detail.confirmation.id, clientToken: crypto.randomUUID() });
        else if (run!.status !== "FINALIZING") await client.request(`/runs/${run!.id}/advance`, "POST", {});
        await refresh();
      });
      case "RETRY": return void attempt(async () => {
        const created = await client.request<SourceRun>("/runs", "POST", { draftRevision: run!.draftRevision, retryOf: run!.id });
        selectedRun.current = created.id; setSelectedStation(null); await client.request(`/runs/${created.id}/advance`, "POST", {});
      });
      case "EDIT": return newDraft();
      case "NEW_VERSION": return void attempt(async () => {
        if (!detail?.result) throw new Error("尚未确认原任务的冻结结果，请查询原任务。");
        newDraft(await client.request<FrozenVersion>(`/bundles/${detail.result.bundle.id}`));
      });
    }
  };
  const labels: Record<string, string> = { SAVE: "保存来源，确认范围", START: "确认范围并开始", RESUME_DIRECTORY: "重新选择目录并继续", RECONCILE_RESTORE: "核对恢复点，继续原任务", CONFIRM: "确认清单与缺口", SEAL: "冻结包", QUERY_RESULT: "查询并恢复原任务", RETRY: "保留原输入，创建重试", EDIT: "编辑来源，创建新尝试", NEW_VERSION: "创建新版本" };
  const confirmDisabled = journey.action === "CONFIRM" && (!confirmationChecked || (hasGaps && (!reason.trim() || !expires || !Number.isFinite(Date.parse(expires)))));

  return <>
    <header className="st-heading"><div><p className="st-eyebrow">SOURCE TRUTH · F001</p><h1>来源快照</h1><p>在 {workspaceName} 中，将 Git 与本机目录建立为可复现、可追溯的冻结包。</p></div><span className={`st-badge ${journey.tone}`}>{journey.label}</span></header>
    {error && <div className="st-callout danger" role="alert"><strong>{error.message}</strong>{error instanceof SourceClientError && <small>{error.code} {error.requestId ? `· 请求 ${error.requestId}` : ""}</small>}<button className="st-link" onClick={() => void attempt(refresh)}>查询最新状态</button></div>}
    {notice && <p className="st-callout" role="status">{notice}</p>}
    {!overview ? <p role="status">正在验证来源访问权限和存储状态…</p> : <>
      {!writable && <p className="st-callout">当前成员为只读权限，可查看历史与证据，不能创建任务、上传、确认或冻结。</p>}
      <section className="st-metro" aria-label="八站来源快照旅程"><div className="st-metro-head"><div><h2>快照旅程</h2><p>一个工作台，八个节点。实线表示已完成；点击节点只回看或预览，不跳过验证。</p></div><button className="st-link" onClick={returnToCurrent}>回到当前 · 第 {journey.current} 站</button></div>
        <ol className="st-rail" ref={rail}>{sourceStations.map((name, index) => <li key={name} className={`${index + 1 < journey.current ? "done" : ""} ${index + 1 === journey.current ? `current ${journey.tone}` : ""} ${index + 1 === journey.selected ? "selected" : ""}`}><button data-station={index + 1} aria-current={index + 1 === journey.current ? "step" : undefined} aria-label={`第 ${index + 1} 站 ${name}${index + 1 !== journey.current ? "（只读预览）" : "（当前）"}`} onClick={() => setSelectedStation(index + 1)}><span>{index + 1 < journey.current ? "✓" : index + 1}</span><strong>{name}</strong><small>{index + 1 < journey.current ? "已完成 · 可回看" : index + 1 === journey.current ? "当前节点" : "尚未到达"}</small></button></li>)}</ol>
      </section>
      <div className="st-grid"><section className={`st-panel st-current ${journey.tone}`}><div className="st-card-head"><div><p className="st-eyebrow">第 {journey.selected} / 8 站</p><h2>{sourceStations[journey.selected - 1]}</h2></div>{journey.preview && <span className="st-badge muted">{journey.selected < journey.current ? "历史回看" : "未来预览"} · 只读</span>}</div><p className="st-muted">{copies[journey.selected - 1]}</p>
        {journey.preview && <p className="st-callout">这是节点说明及已有记录，不改变真实进度。上一步：{sourceStations[journey.selected - 2] ?? "旅程开始"}；下一步：{sourceStations[journey.selected] ?? "包已冻结，旅程结束"}。</p>}
        {journey.selected <= 2 ? <SourceForm input={run?.input ?? form} versions={baselineVersion && !versions.items.some((version) => version.id === baselineVersion.id) ? [baselineVersion, ...versions.items] : versions.items} disabled={busy || journey.preview || journey.selected === 2 || !canEdit} gitEnabled={overview.policy.gitEnabled} onChange={(input) => { setForm(input); setEditing(true); }} onPickDirectory={() => void chooseDirectory()} directoryName={directoryName} /> : <>
          <div className="st-metrics"><div><small>文件</small><strong>{detail?.candidate?.fileCount ?? detail?.sources.reduce((sum, source) => sum + Number(source.summary.fileCount), 0) ?? "—"}</strong></div><div><small>目录</small><strong>{detail?.candidate?.directoryCount ?? detail?.sources.reduce((sum, source) => sum + Number(source.summary.directoryCount), 0) ?? "—"}</strong></div><div><small>预期字节</small><strong>{detail?.candidate?.knownBytes ?? run?.progress.knownBytes ?? "—"}</strong></div><div><small>已知 Gap</small><strong>{detail?.candidate?.gapCount ?? "未对账"}</strong></div></div>
          {detail?.sources.map((source) => <article className="st-source-line" key={source.sourceId}><strong>{source.kind === "GIT" ? "Git" : "目录"} · {source.mode === "REUSE" ? "沿用精确组件" : "本版更新"}</strong><dl><dt>来源</dt><dd>{source.sourceId}</dd><dt>{source.kind === "GIT" ? "精确 commit" : "目录版本身份"}</dt><dd>{source.nativeIdentity?.commit ?? (source.manifestId ? `manifest:${source.manifestId}` : "完整枚举尚未闭合")}</dd><dt>采集范围</dt><dd>{source.kind === "GIT" ? source.scope?.root ? `${source.scope.root}（不是全仓库）` : "全仓库" : "完整所选目录"}</dd><dt>待处置条目</dt><dd>{source.summary.pendingCount}</dd></dl></article>)}
          {journey.selected === 3 && <p className={`st-callout ${overview.storage.ready ? "" : "danger"}`}>主存储：{overview.storage.ready ? "可访问" : overview.storage.code ?? "未就绪"}。阻断项不能手工接受。这里不执行用户内容。</p>}
          {[4, 5, 6].includes(journey.selected) && <>
            {journey.selected === 4 && <p className="st-callout warning">目录需完整枚举、逐文件读取哈希。关页或授权中断时保留原任务；不能把尚未读到的文件计为删除。</p>}
            {progress && <div className="st-callout" role="status"><strong>{progress.phase === "LOCAL_SCAN" ? "本机完整核对" : progress.phase === "MANIFEST" ? "提交预期清单" : "服务端已验证接收"}</strong><p>{progress.path}</p><p>{progress.phase === "LOCAL_SCAN" ? `文件 ${progress.fileCount} · 目录 ${progress.directoryCount} · 读取 ${progress.readBytes} 字节` : `已完成文件 ${progress.verifiedFiles} · 本次传输 ${progress.sentBytes} 字节 · 无需重复 ${progress.unnecessaryBytes} 字节`}</p></div>}
            {detail?.sources.map((source) => <ArtifactTable key={`${run!.id}:${source.sourceId}`} client={client} route={`/runs/${run!.id}/sources/${source.sourceId}/entries`} live={!terminal.has(run!.status)} />)}
          </>}
          {journey.selected === 7 && detail?.candidate && <>
            <GapBrowser key={detail.candidate.id} client={client} route={`/runs/${run!.id}/gaps`} />
            <p className="st-callout warning">接受不代表缺口已解决。所有接受的 Gap 都随本包进入后续分析的 inherited set；限制分析的脱敏同样必须成为独立 Gap，纯 UI 脱敏不改变采集内容。</p>
            {hasGaps && <><label>接受全部非阻断缺口的理由<textarea disabled={busy || journey.preview || !writable} value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} /></label><label>接受失效时间（浏览器本地时间）<input type="datetime-local" disabled={busy || journey.preview || !writable} value={expires} onChange={(event) => setExpires(event.target.value)} /></label>{expires && Number.isFinite(Date.parse(expires)) && <small>绝对 UTC 时间：{new Date(expires).toISOString()}。冻结不会顺延期限。</small>}</>}
            <label className="st-check"><input type="checkbox" checked={confirmationChecked} disabled={busy || journey.preview || !writable} onChange={(event) => setConfirmationChecked(event.target.checked)} />我已核对完整清单{hasGaps ? `，并接受当前完整 Gap 集（${detail.candidate.gapCount} 项），理解其限制将继续保留` : "，确认本次采集范围"}。</label>
          </>}
          {journey.selected === 8 && <>{detail?.result ? <div className={`st-callout ${detail.result.receipt.status === "READY_WITH_ACCEPTED_GAPS" ? "warning" : ""}`}><h3>冻结包已建立</h3><dl><dt>Bundle</dt><dd>{detail.result.bundle.id}</dd><dt>Receipt</dt><dd>{detail.result.receipt.id}</dd><dt>冻结时状态</dt><dd>{detail.result.receipt.status}</dd><dt>保留 Gap</dt><dd>{detail.result.receipt.gapCount}</dd></dl><p>当前准入与备份覆盖需分别核验。此站结束 F001，不自动启动 F002。</p></div> : <p className="st-callout warning">{detail?.confirmation ? `确认人 ${detail.confirmation.actorId} · 已记录确认。冻结提交前仍没有公开包。` : "尚未完成第 7 站确认，不能冻结包。"}</p>}{detail?.confirmation && run?.status !== "SUCCEEDED" && writable && <button className="st-link" disabled={busy} onClick={() => { setReviewAgain(true); setSelectedStation(null); }}>重新复核缺口与失效时间</button>}</>}
        </>}
        {run?.diagnostic && <div className="st-callout danger" role="alert"><strong>{run.diagnostic.message}</strong><p>{run.diagnostic.recovery}</p><small>{run.diagnostic.code} · 既有冻结包不变</small></div>}
        {run && terminal.has(run.status) && run.status !== "SUCCEEDED" && <SourceStagingView key={run.id} client={client} runId={run.id} writable={Boolean(writable) && !journey.preview} onChanged={refresh} />}
        {journey.action === "RECONCILE_RESTORE" && <p className="st-callout warning">此任务来自已校验备份中的未完成记录，不代表最新现场或成功包。继续后只恢复原锁定输入；本机目录仍需完整重选核对，缺口接受不会自动续期，系统不会代你冻结。</p>}
        <footer className="st-actions st-sticky-actions">
          {journey.preview ? <button className="button primary" onClick={returnToCurrent}>回到当前节点</button> : journey.action && <button className="button primary" disabled={busy || !writable || confirmDisabled || (journey.action === "SAVE" && !form.sources.length) || (journey.action === "START" && !overview.storage.ready)} onClick={primary}>{busy ? "处理中…" : labels[journey.action]}</button>}
          {!run && !editing && overview.draft && writable && <button className="button" disabled={busy} onClick={() => { setEditing(true); setSelectedStation(null); }}>返回编辑来源</button>}
          {transferring && <button className="button" onClick={() => transferController.current?.abort()}>暂停本机传输</button>}
          {run && !terminal.has(run.status) && run.status !== "FINALIZING" && writable && <button className="button" disabled={cancelling} onClick={() => {
            if (!window.confirm("取消本次任务？已验证检查点与记录将保留，既有冻结包不受影响。")) return;
            setCancelling(true);
            void client.request(`/runs/${run.id}/cancel`, "POST", {}).then(async () => { transferController.current?.abort(); await refresh(); })
              .catch((error) => { if (!client.signal?.aborted) setError(error); }).finally(() => { if (!client.signal?.aborted) setCancelling(false); });
          }}>取消本次任务</button>}
        </footer>
      </section><aside className="st-side"><section className="st-panel"><h2>本次上下文</h2><dl><dt>Workspace</dt><dd>{workspaceName}</dd><dt>认证成员</dt><dd>{overview.actor.actorId} · {overview.role}</dd><dt>任务</dt><dd>{run?.id ?? "尚未启动"}</dd><dt>输入草稿</dt><dd>r{run?.draftRevision ?? overview.draft?.revision ?? 0}</dd><dt>预期清单</dt><dd>{short(detail?.candidate?.inventoryId)}</dd><dt>包</dt><dd>{detail?.result ? short(detail.result.bundle.id) : "未冻结"}</dd><dt>主存储</dt><dd>{overview.storage.ready ? "可访问" : "不可用"}</dd><dt>备份</dt><dd>{overview.backup.status === "NOT_CONFIGURED" ? "未配置 · 没有覆盖证明" : overview.backup.status}</dd></dl><p className="st-muted">主存储可访问不等于备份已覆盖；历史 READY 不等于当前可以准入。</p></section>
        <section className="st-panel"><h2>下一步</h2><p>{journey.current < 8 ? sourceStations[journey.current] : "查看冻结包、历史或新建版本"}</p><p className="st-muted">{run?.progress.waitingFor === "RESTORE_RECONCILIATION" ? "先核对备份恢复点，才能恢复原任务；不会自动确认或冻结。" : run?.status === "WAITING_FOR_CLIENT" ? "请在本机重新授权相同目录。已验证字节不会被重复计为新覆盖。" : "节点进度来自服务端记录。看图、点击未来节点不会推进任务。"}</p><h3>平台边界</h3><p className="st-muted">最多 {overview.policy.maxEntries.toLocaleString("zh-CN")} 个条目；单文件上限 {overview.policy.maxFileBytes} 字节。超限不能靠自动排除文件变绿。</p></section>
      </aside></div>
      <section className="st-panel st-history"><div className="st-card-head"><div><h2>版本与任务历史</h2><p className="st-muted">失败、取消与旧包仍可追溯；新任务失败不替换旧基线。</p></div>{writable && !overview.activeRun && <button className="button" disabled={busy || !frozen} onClick={() => newDraft(frozen)}>从选中的冻结包创建新版本</button>}</div>
        <div className="st-history-columns"><div><h3>冻结包</h3>{versions.items.length ? versions.items.map((version) => <button className={`st-history-row ${versionId === version.id ? "selected" : ""}`} key={version.id} disabled={busy} onClick={() => setVersionId(versionId === version.id ? null : version.id)}><strong>{short(version.id)}</strong><span className={`st-badge ${version.latestReceipt?.status === "READY_WITH_ACCEPTED_GAPS" ? "warning" : "muted"}`}>{version.latestReceipt?.status ?? "凭据待核查"}</span><small>{new Date(version.publishedAt).toLocaleString("zh-CN")} · 文件 {version.counts.fileCount} · Gap {version.counts.gapCount}</small></button>) : <p>还没有冻结包。</p>}{versions.nextCursor && <button className="st-link" onClick={() => void attempt(async () => { historyCursor.current.bundles = versions.nextCursor; await refresh(); })}>更早的包</button>}</div>
          <div><h3>采集任务</h3>{runs.items.map((item) => <button className={`st-history-row ${run?.id === item.id ? "selected" : ""}`} key={item.id} disabled={busy} onClick={() => { selectedRun.current = item.id; setSelectedStation(null); setReviewAgain(false); setProgress(null); void attempt(refresh); }}><strong>{short(item.id)}</strong><span>{item.status} · 第 {item.station} 站</span><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small></button>)}{runs.nextCursor && <button className="st-link" onClick={() => void attempt(async () => { historyCursor.current.runs = runs.nextCursor; await refresh(); })}>更早的任务</button>}</div></div>
        <button className="st-link" disabled={busy} onClick={() => void attempt(async () => { historyCursor.current = { bundles: null, runs: null }; await refresh(); })}>返回最新历史</button>
        {frozen && <SourceVersionView key={frozen.id} client={client} version={frozen} versions={versions.items} writable={Boolean(writable)} onChanged={refresh} />}
      </section>
    </>}
  </>;
}
