"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { SourceClientError, SourceTruthClient } from "./client.ts";
import { freezeReviewedCandidate } from "./freeze.ts";
import { draftFromVersion, sourceJourney, sourceStations } from "./journey.ts";
import { SourceForm } from "./source-form.tsx";
import { ArtifactTable } from "./evidence-view.tsx";
import { LocalEntryStore } from "./local-entry-store.ts";
import { transferDirectory, type TransferProgress } from "./transfer.ts";
import type { DirectoryHandle } from "./directory.ts";
import type { DraftInput, FrozenVersion, Page, RunDetail, SourceOverview, SourceRun } from "./types.ts";
import { SourceVersionView } from "./version-view.tsx";
import { SourceStagingView } from "./staging-view.tsx";
import { observeSourceReads } from "./observe.ts";
import { revealSourceStation } from "./rail.ts";
import { isConfirmedEmptyGitSource } from "./empty-git.ts";
import "./workbench.css";
import type { SourceEntryContext, SourceAssociationService } from "./context.ts";
import { FixedSourceReference, SourceEntryBanner } from "./entry.tsx";
import { combinedFileCoverage, CoverageMetrics } from "./coverage.tsx";
import { GapReview } from "./gap-review.tsx";
import { SourceOverviewTabs, SourceTaskContext, type SourceOverviewTab } from "./layout.tsx";

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

export function SourceAccessState({ error }: { error: Error | null }) {
  return error ? <section className="st-panel st-access-state"><h2>来源访问尚未就绪</h2><p>当前无法读取此 Workspace 的来源记录，不代表没有材料或任务。</p><p>{error instanceof SourceClientError && error.status === 403 ? "请向本空间 Owner 或权限管理员申请查看或维护权限。" : "请核对当前账号和服务状态，再查询最新状态。不会重复创建任务，也不会修改既有版本。"}</p></section> : <p className="st-panel" role="status">正在验证来源访问权限和存储状态…</p>;
}

export function SourceTruthWorkbench({ apiBase, apiToken, workspaceId, workspaceName, onDirtyChange, entryContext, associationService }: { apiBase: string; apiToken: string; workspaceId: string; workspaceName: string; onDirtyChange?: (dirty: boolean) => void; entryContext?: SourceEntryContext; associationService?: SourceAssociationService }) {
  const referenceClient = useMemo(() => new SourceTruthClient(apiBase, "", workspaceId), [apiBase, workspaceId]);
  return <section className="st-workbench" aria-label="来源快照工作台">
    {entryContext?.mode === "REFERENCE" ? <FixedSourceReference client={referenceClient} context={entryContext} workspaceId={workspaceId} /> : <>
      {entryContext && <SourceEntryBanner context={entryContext} />}
      <SourceWorkspaceSession key={`${apiBase}:${workspaceId}`} apiBase={apiBase} token="" workspaceId={workspaceId} workspaceName={workspaceName} onDirtyChange={onDirtyChange} entryContext={entryContext} associationService={associationService} />
    </>}
  </section>;
}

function SourceWorkspaceSession({ apiBase, token, workspaceId, workspaceName, onDirtyChange, entryContext, associationService }: { apiBase: string; token: string; workspaceId: string; workspaceName: string; onDirtyChange?: (dirty: boolean) => void; entryContext?: SourceEntryContext; associationService?: SourceAssociationService }) {
  const client = useMemo(() => new SourceTruthClient(apiBase, token, workspaceId), [apiBase, token, workspaceId]);
  const [overview, setOverview] = useState<SourceOverview | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [versions, setVersions] = useState<Page<FrozenVersion>>({ items: [], nextCursor: null });
  const [latestVersion, setLatestVersion] = useState<FrozenVersion | null>(null);
  const [runs, setRuns] = useState<Page<SourceRun>>({ items: [], nextCursor: null });
  const [form, setForm] = useState<DraftInput>(emptyInput);
  const [baselineVersion, setBaselineVersion] = useState<FrozenVersion | null>(null);
  const [editing, setEditing] = useState(false), [reviewAgain, setReviewAgain] = useState(false);
  const [inputStage, setInputStage] = useState<1 | 2 | null>(null);
  const [selectedStation, setSelectedStation] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState<TransferProgress | null>(null);
  const [transferring, setTransferring] = useState(false), [cancelling, setCancelling] = useState(false);
  const [directoryName, setDirectoryName] = useState<string | null>(null);
  const [confirmationChecked, setConfirmationChecked] = useState(false), [gapsAccepted, setGapsAccepted] = useState(false), [acceptedCount, setAcceptedCount] = useState("0");
  const [versionId, setVersionId] = useState<string | null>(null);
  const [overviewTab, setOverviewTab] = useState<SourceOverviewTab>("versions"), [showVersion, setShowVersion] = useState(false);
  const overviewId = useId();
  const [loadedFrozen, setFrozen] = useState<FrozenVersion | null>(null);
  const [readRevision, setReadRevision] = useState(0);
  const frozen = loadedFrozen?.id === versionId ? loadedFrozen : null;
  const selectVersion = (id: string | null) => { setFrozen(null); setVersionId(id); setShowVersion(Boolean(id)); };
  const selectedRun = useRef<string | null>(null), sequence = useRef(0), hydrated = useRef(false), inFlight = useRef(false);
  const historyCursor = useRef<{ bundles: string | null; runs: string | null }>({ bundles: null, runs: null });
  const directory = useRef<DirectoryHandle | null>(null), transferController = useRef<AbortController | null>(null);
  const readController = useRef<AbortController | null>(null);
  const rail = useRef<HTMLOListElement | null>(null);
  const reportFailure = useCallback((error: Error) => {
    if (client.signal?.aborted) return;
    setError(error);
    if (error instanceof SourceClientError && [401, 403].includes(error.status)) {
      // Current authorization fences the entire read model, not just rows.
      // Cancel older reads/transfers before they can publish a cached result.
      ++sequence.current; readController.current?.abort(); transferController.current?.abort();
      setOverview(null); setDetail(null); setFrozen(null); setLatestVersion(null);
      setVersions({ items: [], nextCursor: null }); setRuns({ items: [], nextCursor: null });
      setBaselineVersion(null); setForm(emptyInput); setEditing(false); setInputStage(null);
      setDirectoryName(null); directory.current = null; setProgress(null); setTransferring(false);
      setBusy(false); setNotice(""); setConfirmationChecked(false); setGapsAccepted(false); setAcceptedCount("0");
      hydrated.current = false; historyCursor.current = { bundles: null, runs: null };
    }
  }, [client]);
  useEffect(() => {
    onDirtyChange?.(editing && JSON.stringify(form) !== JSON.stringify(overview?.draft?.input ?? emptyInput));
    return () => onDirtyChange?.(false);
  }, [editing, form, overview?.draft?.input, onDirtyChange]);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    const [data, versionPage, runPage] = await Promise.all([client.request<SourceOverview>(), client.request<Page<FrozenVersion>>(`/history/bundles?limit=50${historyCursor.current.bundles ? `&cursor=${historyCursor.current.bundles}` : ""}`), client.request<Page<SourceRun>>(`/history/runs?limit=50${historyCursor.current.runs ? `&cursor=${historyCursor.current.runs}` : ""}`)]);
    const runId = selectedRun.current === "NEW" ? null : selectedRun.current ?? data.activeRun?.id ?? runPage.items[0]?.id;
    const current = runId ? await client.request<RunDetail>(`/runs/${encodeURIComponent(runId)}/view`) : null;
    if (client.signal?.aborted || request !== sequence.current) return;
    setOverview(data); setVersions(versionPage); setRuns(runPage); setDetail(current);
    if (!historyCursor.current.bundles) setLatestVersion(versionPage.items[0] ?? null);
    if (!hydrated.current) { setForm(data.draft?.input ?? emptyInput); hydrated.current = true; }
  }, [client]);
  useEffect(() => {
    // A fresh signal for each effect setup, including React StrictMode's
    // setup/cleanup/setup cycle. Never reuse the first aborted signal.
    const controller = client.beginSession();
    readController.current = controller;
    const stop = observeSourceReads(refresh, { signal: controller.signal, onError: reportFailure });
    return () => { stop(); controller.abort(); transferController.current?.abort(); };
  }, [refresh, client, reportFailure, readRevision]);

  const run = detail?.run ?? null;
  const journey = sourceJourney(run, inputStage === 1 ? 0 : inputStage === 2 ? 1 : editing ? 0 : overview?.draft?.revision ?? 0, Boolean(detail?.confirmation) && detail?.confirmation?.currentlyValid !== false && !reviewAgain, selectedStation);
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
  useEffect(() => {
    if (!versionId) return;
    let active = true;
    // Selection is exact even when the history page changes. Never fall back
    // to the newest item or keep a previous selection after a denied read.
    void client.request<FrozenVersion>(`/bundles/${versionId}`).then(value => { if (active && !client.signal?.aborted) setFrozen(value); })
      .catch(error => { if (active && !client.signal?.aborted) { setFrozen(null); reportFailure(error); } });
    return () => { active = false; };
  }, [client, versionId, readRevision, reportFailure]);
  const canEdit = writable && !overview?.activeRun && (!run || terminal.has(run.status));
  const attempt = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice("");
    try { await work(); }
    catch (error) { reportFailure(error instanceof Error ? error : new Error("操作未确认，请查询原任务")); }
    finally { inFlight.current = false; if (!client.signal?.aborted) { setBusy(false); await refresh().catch(reportFailure); } }
  };
  const retryRead = () => {
    if (client.signal?.aborted) { setError(null); setReadRevision(value => value + 1); }
    else void attempt(refresh);
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
        if (!client.signal?.aborted && (progress.phase !== lastPhase || now - lastUpdate > 100)) { setProgress(progress); lastUpdate = now; lastPhase = progress.phase; }
      });
      setNotice(`本机完整核对完成；本次传输 ${result.sentBytes} 字节，无需再次传输 ${result.unnecessaryBytes} 字节。请继续复核清单。`);
    } catch (error) {
      if (localController.signal.aborted && !client.signal?.aborted) setNotice("本机传输已暂停。服务端任务和已验证检查点保留；重新选择相同目录即可继续。");
      else throw error;
    } finally { transferController.current = null; if (!client.signal?.aborted) setTransferring(false); await store.discard(); }
  };
  const newDraft = (base?: FrozenVersion) => {
    if (base) { setForm(draftFromVersion(base)); setBaselineVersion(base); }
    selectedRun.current = "NEW"; setDetail(null); setEditing(true); setInputStage(base ? 2 : 1); setSelectedStation(null); setVersionId(null); setFrozen(null); setShowVersion(false); setOverviewTab("versions"); setReviewAgain(false); setConfirmationChecked(false);
  };
  const saveDraft = async (nextStage: 1 | 2) => {
    await client.request("/draft", "PUT", { expectedRevision: overview?.draft?.revision ?? 0, input: form });
    setEditing(false); setInputStage(nextStage); setSelectedStation(null);
    setNotice(nextStage === 1 ? "草稿已保存到服务端；尚未启动预检或采集。" : "来源已保存，请配置范围后明确运行预检。");
  };
  const confirm = () => attempt(async () => {
    if (!detail?.candidate || !confirmationChecked) return;
    await freezeReviewedCandidate(client, run!.id, detail.candidate, crypto.randomUUID());
    setReviewAgain(false); setSelectedStation(null); setConfirmationChecked(false);
  });
  const primary = () => {
    switch (journey.action) {
      case "SAVE": return void attempt(() => saveDraft(2));
      case "START": return void attempt(async () => {
        // Editing range does not start a run. Lock only the saved revision
        // which actually contains these inputs, including a new-version draft.
        let revision = overview?.draft?.revision ?? 0;
        if (JSON.stringify(form) !== JSON.stringify(overview?.draft?.input)) {
          const saved = await client.request<{ revision: number }>("/draft", "PUT", { expectedRevision: revision, input: form });
          revision = saved.revision; setEditing(false);
        }
        const created = await client.request<SourceRun>("/runs", "POST", { draftRevision: revision });
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
  const labels: Record<string, string> = { SAVE: "继续配置范围", START: "确认范围并运行预检", RESUME_DIRECTORY: "重新选择目录并继续", RECONCILE_RESTORE: "核对恢复点，继续原任务", CONFIRM: "冻结来源包", SEAL: "冻结来源包", QUERY_RESULT: "查询并恢复原任务", RETRY: "保留原输入，创建重试", EDIT: "编辑来源，创建新尝试", NEW_VERSION: "创建新版本" };
  const confirmDisabled = journey.action === "CONFIRM" && (!confirmationChecked || (hasGaps && !gapsAccepted));

  return <>
    <header className="st-heading"><div><h1>来源快照</h1><p>先固定依据，再开始理解。{workspaceName} 的每个冻结版本都可独立回查。</p></div><span className={`st-badge ${journey.tone}`}>{journey.label}</span></header>
    {error && <div className="st-callout danger" role="alert"><strong>{error.message}</strong>{error instanceof SourceClientError && <small>{error.code} {error.requestId ? `· 请求 ${error.requestId}` : ""}</small>}<button className="st-link" onClick={retryRead}>查询最新状态</button></div>}
    {notice && <p className="st-callout" role="status">{notice}</p>}
    {!overview ? <SourceAccessState error={error} /> : <>
      {!writable && <p className="st-callout">当前成员为只读权限，可查看历史与证据，不能创建任务、上传、确认或冻结。</p>}
      <div hidden={showVersion}>
      <SourceOverviewTabs id={overviewId} selected={overviewTab} onSelect={setOverviewTab} />
      <div id={`${overviewId}-versions-panel`} role="tabpanel" aria-labelledby={`${overviewId}-versions`} hidden={overviewTab !== "versions"}>
      {!latestVersion && <section className="st-panel"><h2>尚无冻结来源版本</h2><p>来源尚未冻结。完成八站后材料清单与 Receipt 长期保留；不是未认证或读取失败的替代空态。</p></section>}
      {latestVersion && <section className="st-panel st-frozen-summary" aria-label="最近冻结版本"><div><h2>最近冻结版本</h2><p><code>{short(latestVersion.id)}</code> · 文件 {latestVersion.counts.fileCount} · 目录 {latestVersion.counts.directoryCount}</p><small>冻结记录保留；新采集失败不覆盖旧版本。当前准入与备份覆盖需独立核验。</small></div><button className="button" onClick={() => { historyCursor.current.bundles = null; selectVersion(latestVersion.id); void attempt(refresh); document.getElementById("source-version-history")?.scrollIntoView({ block: "start" }); }}>查看冻结版本</button></section>}
      <section className="st-metro" aria-label="八站来源快照旅程"><div className="st-metro-head"><div><h2>快照旅程</h2><p>一个工作台，八个节点。实线表示已完成；点击节点只回看或预览，不跳过验证。</p></div><button className="st-link" onClick={returnToCurrent}>回到当前 · 第 {journey.current} 站</button></div>
        <ol className="st-rail" ref={rail}>{sourceStations.map((name, index) => <li key={name} className={`${index + 1 < journey.current ? "done" : ""} ${index + 1 === journey.current ? `current ${journey.tone}` : ""} ${index + 1 === journey.selected ? "selected" : ""}`}><button data-station={index + 1} aria-current={index + 1 === journey.current ? "step" : undefined} aria-label={`第 ${index + 1} 站 ${name}${index + 1 !== journey.current ? "（只读预览）" : "（当前）"}`} onClick={() => setSelectedStation(index + 1)}><span>{index + 1 < journey.current ? "✓" : index + 1}</span><strong>{name}</strong><small>{index + 1 < journey.current ? "已完成 · 可回看" : index + 1 === journey.current ? "当前节点" : "尚未到达"}</small></button></li>)}</ol>
      </section>
      <div className="st-grid"><section className={`st-panel st-current ${journey.tone}`}><div className="st-card-head"><div><p className="st-eyebrow">第 {journey.selected} / 8 站</p><h2>{sourceStations[journey.selected - 1]}</h2></div>{journey.preview && <span className="st-badge muted">{journey.selected < journey.current ? "历史回看" : "未来预览"} · 只读</span>}</div><p className="st-muted">{copies[journey.selected - 1]}</p>
        {journey.preview && <p className="st-callout">这是节点说明及已有记录，不改变真实进度。上一步：{sourceStations[journey.selected - 2] ?? "旅程开始"}；下一步：{sourceStations[journey.selected] ?? "包已冻结，旅程结束"}。</p>}
        {journey.selected <= 2 ? <SourceForm input={run?.input ?? form} versions={baselineVersion && !versions.items.some((version) => version.id === baselineVersion.id) ? [baselineVersion, ...versions.items] : versions.items} stage={journey.selected as 1 | 2} disabled={busy || journey.preview || !canEdit} gitEnabled={overview.policy.gitEnabled} onChange={(input) => { setForm(input); setEditing(true); setInputStage(journey.current as 1 | 2); }} onPickDirectory={() => void chooseDirectory()} directoryName={directoryName} /> : <>
          <CoverageMetrics coverage={detail?.sources.every(source => source.enumerationClosed) ? combinedFileCoverage(detail.sources) : null} />
          <p className="st-muted">目录 {detail?.candidate?.directoryCount ?? "尚未闭合"} · 逻辑字节 {detail?.candidate?.knownBytes ?? run?.progress.knownBytes ?? "—"} · Gap {detail?.candidate?.gapCount ?? "未对账"}（与文件覆盖分开）</p>
          {detail?.sources.map((source) => <article className="st-source-line" key={source.sourceId}><strong>{source.kind === "GIT" ? "Git" : "目录"} · {source.mode === "REUSE" ? "沿用精确组件" : "本版更新"}</strong><dl><dt>来源</dt><dd>{source.sourceId}</dd><dt>{source.kind === "GIT" ? "精确 commit" : "目录版本身份"}</dt><dd>{source.nativeIdentity?.commit ?? (source.manifestId ? `manifest:${source.manifestId}` : "完整枚举尚未闭合")}</dd><dt>采集范围</dt><dd>{source.kind === "GIT" ? source.scope?.root ? `${source.scope.root}（不是全仓库）` : "全仓库" : "完整所选目录"}</dd><dt>待处置条目</dt><dd>{source.summary.pendingCount}</dd></dl>
            {isConfirmedEmptyGitSource(source, detail) && <><p><strong>已确认空 Git 版本，0 个文件</strong></p><dl><dt>空 manifest 摘要</dt><dd>{source.manifestId}</dd></dl><p className="st-muted">此组件的完整清单已确认为空；空清单不跳过第 7 站人工确认，冻结后当前准入另行核验。</p></>}
          </article>)}
          {journey.selected === 3 && <p className={`st-callout ${overview.storage.ready ? "" : "danger"}`}>主存储：{overview.storage.ready ? "可访问" : overview.storage.code ?? "未就绪"}。阻断项不能手工接受。这里不执行用户内容。</p>}
          {[4, 5, 6].includes(journey.selected) && <>
            {journey.selected === 4 && <p className="st-callout warning">目录需完整枚举、逐文件读取哈希。关页或授权中断时保留原任务；不能把尚未读到的文件计为删除。</p>}
            {progress && <div className="st-callout" role="status"><strong>{progress.phase === "LOCAL_SCAN" ? "本机完整核对" : progress.phase === "MANIFEST" ? "提交预期清单" : "服务端已验证接收"}</strong><p>{progress.path}</p><p>{progress.phase === "LOCAL_SCAN" ? `文件 ${progress.fileCount} · 目录 ${progress.directoryCount} · 读取 ${progress.readBytes} 字节` : `已完成文件 ${progress.verifiedFiles} · 本次传输 ${progress.sentBytes} 字节 · 无需重复 ${progress.unnecessaryBytes} 字节`}</p></div>}
            {detail?.sources.map((source) => <ArtifactTable key={`${run!.id}:${source.sourceId}`} client={client} route={`/runs/${run!.id}/sources/${source.sourceId}/entries`} label={`${source.kind} · ${source.sourceId}`} live={!terminal.has(run!.status)} />)}
          </>}
          {journey.selected === 7 && detail?.candidate && <>
            <GapReview key={detail.candidate.id} client={client} runId={run!.id} candidate={detail.candidate} actorId={overview.actor.actorId} disabled={busy || journey.preview || !writable} onStatus={(complete, count) => { setGapsAccepted(complete); setAcceptedCount(count); }} />
            <p className="st-callout warning">接受不代表缺口已解决。所有接受的 Gap 都随本包进入后续分析的 inherited set；限制分析的脱敏同样必须成为独立 Gap，纯 UI 脱敏不改变采集内容。</p>
            <label className="st-check"><input type="checkbox" checked={confirmationChecked} disabled={busy || journey.preview || !writable} onChange={(event) => setConfirmationChecked(event.target.checked)} />我已核对完整清单{hasGaps ? `，全部限制已逐项接受，理解其限制将继续保留` : "，确认本次采集范围"}。</label>
            <p role="status">冻结前检查：内容处置已对账；{hasGaps ? `${acceptedCount} / ${detail.candidate.gapCount} 项限制当前有效接受` : "无已知限制"}；还需当前用户确认。阻断不能绕过，提交时再次复验。</p>
          </>}
          {journey.selected === 8 && <>{detail?.result ? <div className={`st-callout ${detail.result.receipt.status === "READY_WITH_ACCEPTED_GAPS" ? "warning" : ""}`}><h3>来源包已冻结</h3><dl><dt>Bundle</dt><dd>{detail.result.bundle.id}</dd><dt>Receipt</dt><dd>{detail.result.receipt.id}</dd><dt>冻结时状态</dt><dd>{detail.result.receipt.status}</dd><dt>保留 Gap</dt><dd>{detail.result.receipt.gapCount}</dd></dl><p>当前准入与备份覆盖需分别核验。采集旅程结束，不自动启动技术提取或业务分析。</p><button className="button" onClick={() => selectVersion(detail.result!.bundle.id)}>浏览材料与查看 Receipt</button></div> : <p className="st-callout warning">{detail?.confirmation ? `确认人 ${detail.confirmation.actorId} · 已记录确认。冻结提交前仍没有公开包。` : "尚未完成第 7 站确认，不能冻结包。"}</p>}{detail?.confirmation && run?.status !== "SUCCEEDED" && writable && <button className="st-link" disabled={busy} onClick={() => { setReviewAgain(true); setSelectedStation(null); }}>重新复核缺口与失效时间</button>}</>}
        </>}
        {run?.diagnostic && <div className="st-callout danger" role="alert"><strong>{run.diagnostic.message}</strong><p>{run.diagnostic.recovery}</p><small>{run.diagnostic.code} · 既有冻结包不变</small></div>}
        {run && terminal.has(run.status) && run.status !== "SUCCEEDED" && <SourceStagingView key={run.id} client={client} runId={run.id} writable={Boolean(writable) && !journey.preview} onChanged={refresh} />}
        {journey.action === "RECONCILE_RESTORE" && <p className="st-callout warning">此任务来自已校验备份中的未完成记录，不代表最新现场或成功包。继续后只恢复原锁定输入；本机目录仍需完整重选核对，缺口接受不会自动续期，系统不会代你冻结。</p>}
        <footer className="st-actions st-sticky-actions">
          {journey.preview ? <button className="button primary" onClick={returnToCurrent}>回到当前节点</button> : journey.action && <button className="button primary" disabled={busy || !writable || confirmDisabled || (journey.action === "SAVE" && !form.sources.length) || (journey.action === "START" && !overview.storage.ready)} onClick={primary}>{busy ? "处理中…" : labels[journey.action]}</button>}
          {!run && !journey.preview && writable && <button className="button" disabled={busy || !form.sources.length} onClick={() => void attempt(() => saveDraft(journey.current as 1 | 2))}>保存草稿</button>}
          {!run && journey.current === 2 && writable && <button className="button" disabled={busy} onClick={() => { setInputStage(1); setSelectedStation(null); }}>返回编辑来源</button>}
          {transferring && <button className="button" onClick={() => transferController.current?.abort()}>暂停本机传输</button>}
          {run && !terminal.has(run.status) && run.status !== "FINALIZING" && writable && <button className="button" disabled={cancelling} onClick={() => {
            if (!window.confirm("取消本次任务？已验证检查点与记录将保留，既有冻结包不受影响。")) return;
            setCancelling(true);
            void client.request(`/runs/${run.id}/cancel`, "POST", {}).then(async () => { transferController.current?.abort(); await refresh(); })
              .catch((error) => { if (!client.signal?.aborted) setError(error); }).finally(() => { if (!client.signal?.aborted) setCancelling(false); });
          }}>取消本次任务</button>}
        </footer>
      </section><SourceTaskContext workspaceName={workspaceName} overview={overview} input={run?.input ?? form} detail={detail} current={journey.current} acceptedCount={acceptedCount} /></div>
      <section id="source-version-history" className="st-panel st-history"><h2>冻结版本</h2><p className="st-muted">只列已冻结版本；失败、取消和活动任务在采集记录中独立保留。</p>
        <div><h3>冻结包</h3>{versions.items.length ? versions.items.map((version) => <button className={`st-history-row ${versionId === version.id ? "selected" : ""}`} key={version.id} disabled={busy} onClick={() => selectVersion(version.id)}><strong>{short(version.id)}</strong><span className={`st-badge ${version.latestReceipt?.status === "READY_WITH_ACCEPTED_GAPS" ? "warning" : "muted"}`}>{version.latestReceipt?.status ?? "凭据待核查"}</span><small>{new Date(version.publishedAt).toLocaleString("zh-CN")} · 文件 {version.counts.fileCount} · Gap {version.counts.gapCount}</small></button>) : <p>还没有冻结包。</p>}{versions.nextCursor && <button className="st-link" onClick={() => void attempt(async () => { historyCursor.current.bundles = versions.nextCursor; await refresh(); })}>更早的包</button>}</div>
        <button className="st-link" disabled={busy} onClick={() => void attempt(async () => { historyCursor.current = { bundles: null, runs: null }; await refresh(); })}>返回最新历史</button>
      </section></div>
      <section id={`${overviewId}-materials-panel`} role="tabpanel" aria-labelledby={`${overviewId}-materials`} hidden={overviewTab !== "materials"} className="st-panel"><h2>材料清单</h2><p>先明确选择冻结版本和 Receipt，再读取完整材料清单；不会把最近版本作为固定引用的替代。</p>{versionId ? <button className="button" onClick={() => setShowVersion(true)}>继续查看已选版本 {short(versionId)}</button> : <p>尚未选择版本。</p>}<button className="st-link" onClick={() => setOverviewTab("versions")}>到版本页选择来源包</button></section>
      <section id={`${overviewId}-captures-panel`} role="tabpanel" aria-labelledby={`${overviewId}-captures`} hidden={overviewTab !== "captures"} className="st-panel st-history"><h2>采集记录</h2><p>进行中、失败、取消与成功尝试均保留，不是冻结版本列表。</p>
        {runs.items.map(item => <button className={`st-history-row ${run?.id === item.id ? "selected" : ""}`} key={item.id} disabled={busy} onClick={() => { selectedRun.current = item.id; setSelectedStation(null); setReviewAgain(false); setProgress(null); setOverviewTab("versions"); void attempt(refresh); }}><strong>{short(item.id)}</strong><span>{item.status} · 第 {item.station} 站</span><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small></button>)}{!runs.items.length && <p>尚无采集任务；保存草稿不会创建任务。</p>}{runs.nextCursor && <button className="st-link" onClick={() => void attempt(async () => { historyCursor.current.runs = runs.nextCursor; await refresh(); })}>更早的任务</button>}
      </section></div>
      <section hidden={!showVersion} aria-label="明确选定的冻结版本"><div className="st-actions"><button className="button" onClick={() => { setShowVersion(false); requestAnimationFrame(() => document.getElementById(`${overviewId}-${overviewTab}`)?.focus({ preventScroll: true })); }}>返回来源总览</button>
        {writable && !overview.activeRun && <button className="button" disabled={busy || !frozen} onClick={() => { if (frozen) newDraft(frozen); }}>从选中的冻结包创建新版本</button>}</div>
        {versionId && !frozen && <p role="status">正在核对所选冻结包；不会改用最新版本。</p>}
        {frozen && <SourceVersionView key={frozen.id} client={client} version={frozen} versions={versions.items} writable={Boolean(writable)} onChanged={refresh} entryContext={entryContext} associationService={associationService} />}
      </section>
    </>}
  </>;
}
