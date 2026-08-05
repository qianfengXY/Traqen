"use client";

import { useMemo, useState } from "react";

import { addChildSlot, removeChildSlot } from "./capability-roster";
import type { CapabilityTemplate, ChildCapabilityRole, ExecutionProfile, ReviewQueueItem, WorkspaceCapabilityConfig } from "./product-foundation-client";
import type { ServerUnderstandingJob } from "./server-understanding-client";
import { buildFeatureDetail, buildGraphInspector, featureDetailTabs, type FeatureDetailTab } from "./traceability-view-model";
import type { CurrentUnderstandingGraph, FeatureGraphPathResult, FeatureGraphProjection, FeatureTraceability, FeatureUnderstandingHistory, GraphRevision } from "./understanding-graph-client";
import type { Workspace } from "./workspace-client";

export type T = (zh: string, en: string) => string;
export type GraphArtifact = CurrentUnderstandingGraph["graphArtifact"];

export const UNDERSTANDING_STAGES = [
  "SOURCE_SCAN",
  "FACT_COMMIT",
  "ANALYSIS",
  "RECONCILIATION",
  "EVALUATION",
  "PROJECTION",
  "PUBLISHING",
] as const;

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0;
}

function shortId(value?: string | null) {
  if (!value) return "—";
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function authorityLabel(authority: string) {
  return authority === "GOVERNED" || authority === "DETERMINISTIC_FACT" ? "PUBLISHED" : authority;
}

export function EmptyWorkspace({ t, workspaceName, setWorkspaceName, working, onCreate }: {
  t: T;
  workspaceName: string;
  setWorkspaceName: (value: string) => void;
  working: boolean;
  onCreate: () => void;
}) {
  return <section className="onboarding panel">
    <div className="onboarding-copy">
      <p className="eyebrow">Server-owned Workspace</p>
      <h1>{t("创建第一个 Workspace", "Create the first Workspace")}</h1>
      <p>{t("先建立隔离的工作空间，再配置授权源码与不可变执行 Profile。所有扫描、Agent 执行、审核和发布均由服务端持有。", "Create an isolated Workspace, then configure its authorized source and immutable execution profile. Scanning, Agent execution, review, and publication remain server-owned.")}</p>
      <div className="onboarding-steps" aria-label={t("首次设置步骤", "First setup steps")}>
        <span><b>1</b>{t("Workspace", "Workspace")}</span><span><b>2</b>{t("授权源码", "Authorized source")}</span><span><b>3</b>{t("能力配置", "Capabilities")}</span><span><b>4</b>{t("FULL 分析", "FULL analysis")}</span>
      </div>
    </div>
    <div className="onboarding-form">
      <label>{t("Workspace 名称", "Workspace name")}<input value={workspaceName} onChange={(event) => setWorkspaceName(event.currentTarget.value)} placeholder={t("例如：支付平台", "e.g. Payments platform")} /></label>
      <button className="button primary" disabled={working || !workspaceName.trim()} onClick={onCreate}>{t("新建 Workspace", "New Workspace")}</button>
      <small>{t("创建是显式命令；页面加载和刷新不会写入任何业务数据。", "Creation is an explicit command; page load and refresh never mutate business data.")}</small>
    </div>
  </section>;
}

export function WorkspaceOverview({ t, workspace, current, job, reviewCount, impactCount, configValid, onNavigate }: {
  t: T;
  workspace: Workspace;
  current: CurrentUnderstandingGraph | null;
  job: ServerUnderstandingJob | null;
  reviewCount: number;
  impactCount: number;
  configValid: boolean;
  onNavigate: (view: string) => void;
}) {
  const nextView = job && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)
    ? "workspace"
    : reviewCount > 0 ? "review" : impactCount > 0 ? "impact" : current ? "feature" : "workspace";
  return <>
    <section className="hero product-hero">
      <div className="hero-card">
        <p className="eyebrow">{workspace.name}</p>
        <h1>{t("工作台概览", "Workspace overview")}</h1>
        <p className="hero-sub">{t("从当前发布版本出发，继续最重要的分析、审核或影响处置工作。", "Continue the most important analysis, review, or impact action from the current published state.")}</p>
        <button className="button primary" onClick={() => onNavigate(nextView)}>{t("继续下一项工作", "Continue next action")} →</button>
      </div>
      <div className={`trust-card hero-card ${current ? "" : "unavailable"}`}>
        <div className="trust-status"><span className={`status-light ${current ? "" : "warn"}`} />Published Head</div>
        <strong>{current ? `Revision ${current.head.version}` : t("尚未发布", "Not published")}</strong>
        <p>{current ? shortId(current.revision.id) : t("运行并通过评估后，服务端将原子发布首个版本。", "The server atomically publishes the first revision after a successful evaluated run.")}</p>
      </div>
    </section>
    <section className="overview-grid" aria-label={t("Workspace 状态", "Workspace status")}>
      <button className="overview-card" onClick={() => onNavigate("workspace")}><span>{t("活动任务", "Active job")}</span><strong>{job?.status ?? t("无", "None")}</strong><small>{job?.phase ?? t("开始 Workspace 分析", "Start Workspace analysis")}</small></button>
      <button className="overview-card" onClick={() => onNavigate("review")}><span>Review Queue</span><strong>{reviewCount}</strong><small>{t("待处理声明", "claims awaiting action")}</small></button>
      <button className="overview-card" onClick={() => onNavigate("impact")}><span>Impact Actions</span><strong>{impactCount}</strong><small>{t("待重验证动作", "revalidation actions")}</small></button>
      <button className="overview-card" onClick={() => onNavigate("settings")}><span>{t("能力配置", "Capability config")}</span><strong>{configValid ? t("有效", "Valid") : t("待配置", "Required")}</strong><small>{t("不可变 Profile", "immutable profile")}</small></button>
    </section>
    <section className="panel">
      <header className="panel-head"><div><h2>{t("最近不可变活动", "Recent immutable activity")}</h2><p>{t("这里仅汇总服务端返回的事实，不生成综合健康分数。", "This summary contains server facts only and never invents a composite health score.")}</p></div></header>
      <div className="activity-list">
        <div><span className="activity-icon published">✓</span><p><b>CurrentGraphHead</b><small>{current ? `${current.revision.mode} · ${new Date(current.head.updatedAt).toLocaleString()}` : t("等待首次发布", "Waiting for first publication")}</small></p></div>
        <div><span className="activity-icon">A</span><p><b>{t("分析任务", "Analysis job")}</b><small>{job ? `${job.status} · ${job.phase} · v${job.version}` : t("没有服务端任务", "No server job")}</small></p></div>
      </div>
    </section>
  </>;
}

export function AnalysisCommandCenter({ t, job, jobs, agentSlots, sourceRoot, setSourceRoot, sourceRegistrationId, profileRevisionId, working, onRegisterSource, onResolveProfile, onPrepareStart, onControl, onSelectJob }: {
  t: T;
  job: ServerUnderstandingJob | null;
  jobs: ServerUnderstandingJob[];
  agentSlots: ChildCapabilityRole[];
  sourceRoot: string;
  setSourceRoot: (value: string) => void;
  sourceRegistrationId: string;
  profileRevisionId: string;
  working: boolean;
  onRegisterSource: () => void;
  onResolveProfile: () => void;
  onPrepareStart: () => void;
  onControl: (action: "pause" | "resume" | "cancel") => void;
  onSelectJob: (job: ServerUnderstandingJob) => void;
}) {
  const completed = new Set(job?.completedPhases ?? []);
  const currentStage = Math.max(0, UNDERSTANDING_STAGES.indexOf(job?.phase as typeof UNDERSTANDING_STAGES[number]));
  return <>
    <section className="page-heading"><div><p className="eyebrow">F001 · Understanding</p><h1>{t("Workspace 分析", "Workspace analysis")}</h1><p>{t("以静态事实和独立 Agent 批次构建候选理解，评估通过后才发布。", "Build candidate understanding from static facts and independent Agent batches; publish only after evaluation.")}</p></div><span className={`authority-pill ${job ? "candidate" : "neutral"}`}>{job ? "CANDIDATE" : t("未运行", "NOT RUN")}</span></section>
    <section className="panel setup-panel">
      <header className="panel-head"><div><h2>{t("运行准备", "Run readiness")}</h2><p>{t("三个显式步骤相互独立，刷新不会自动注册、解析或启动。", "The three explicit steps are independent; refresh never registers, resolves, or starts work.")}</p></div></header>
      <div className="readiness-grid">
        <div className={sourceRegistrationId ? "ready" : ""}><span>1 · SourceRegistration</span><label>{t("服务端 allowlist 内的源码根目录", "Source root inside the server allowlist")}<input value={sourceRoot} onChange={(event) => setSourceRoot(event.currentTarget.value)} placeholder="/srv/workspaces/project" /></label><button className="button" disabled={working || !sourceRoot.trim()} onClick={onRegisterSource}>{sourceRegistrationId ? t("重新注册", "Register again") : t("注册授权源码", "Register source")}</button><small>{shortId(sourceRegistrationId)}</small></div>
        <div className={profileRevisionId ? "ready" : ""}><span>2 · Execution Profile</span><p>{t("从能力设置的当前草稿解析并固定模型、技能、MCP、预算和边界。", "Resolve and pin models, skills, MCPs, budgets, and boundaries from the current capability draft.")}</p><button className="button" disabled={working} onClick={onResolveProfile}>{t("验证并解析 Profile", "Validate and resolve profile")}</button><small>{shortId(profileRevisionId)}</small></div>
        <div className={sourceRegistrationId && profileRevisionId ? "ready" : ""}><span>3 · Analysis Job</span><p>{t("启动前审阅固定输入；首次运行使用 FULL，后续可由服务端判定增量等价性。", "Review pinned inputs before start; the first run is FULL and later runs may use server-validated incremental mode.")}</p><button className="button primary" disabled={working || !sourceRegistrationId || !profileRevisionId || job?.status === "RUNNING"} onClick={onPrepareStart}>{t("审阅并启动", "Review and start")}</button></div>
      </div>
    </section>
    <section className="panel">
      <header className="panel-head"><div><h2>{t("七阶段命令中心", "Seven-stage command center")}</h2><p>{job ? `${job.status} · ${job.resolvedMode} · ${shortId(job.id)}` : t("等待显式启动", "Waiting for explicit start")}</p></div><div className="run-controls">{job?.status === "RUNNING" && <button className="button" onClick={() => onControl("pause")}>{t("暂停", "Pause")}</button>}{job?.status === "PAUSED" && <button className="button primary" onClick={() => onControl("resume")}>{t("恢复", "Resume")}</button>}{job && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.status) && <button className="button danger" onClick={() => onControl("cancel")}>{t("取消", "Cancel")}</button>}</div></header>
      <div className="stage-rail">{UNDERSTANDING_STAGES.map((stage, index) => <div key={stage} className={completed.has(stage) ? "done" : job && index === currentStage ? "active" : ""}><i>{completed.has(stage) ? "✓" : index + 1}</i><span>{stage.replace("_", " ")}</span></div>)}</div>
      <div className="lane-grid">
        <article className="lane static-lane"><header><div><p className="eyebrow">Static lane</p><h3>{t("确定性事实库存", "Deterministic fact inventory")}</h3></div><span>{count(job?.outputs)}</span></header><div className="lane-metrics"><span>{t("Source scan", "Source scan")}<b>{completed.has("SOURCE_SCAN") ? t("已提交", "Committed") : t("待处理", "Pending")}</b></span><span>{t("Fact commit", "Fact commit")}<b>{completed.has("FACT_COMMIT") ? t("已提交", "Committed") : t("待处理", "Pending")}</b></span><span>{t("处置与 Gap", "Dispositions & gaps")}<b>{t("按服务器输出", "Server-owned")}</b></span></div></article>
        <article className="lane agent-lane"><header><div><p className="eyebrow">Agent lane</p><h3>{t("独立分析与主 Agent 协调", "Independent analysis and Main Agent reconciliation")}</h3></div><span>{job ? job.phase : "—"}</span></header><div className="agent-roster"><div className="main-agent"><b>Main Agent</b><small>{profileRevisionId ? shortId(profileRevisionId) : t("待解析 Profile", "Profile required")}</small></div>{agentSlots.map((slot) => <div key={slot.id}><b>{slot.id}</b><small>{slot.model} · {slot.independenceGroup}</small></div>)}</div><p className="lane-note">{t("各 Child 独立提交同范围 WorkUnit；Main Agent 只在 barrier 后协调，不把候选结论冒充已治理事实。", "Each Child independently submits the same-scope WorkUnit; Main Agent reconciles only after the barrier and never presents candidates as governed truth.")}</p></article>
      </div>
    </section>
    <section className="panel">
      <header className="panel-head"><div><h2>{t("任务与事件历史", "Job and event history")}</h2><p>{t("选择任务仅切换观察上下文，不会改变服务端状态。", "Selecting a job only changes the observation context and never mutates server state.")}</p></div></header>
      <div className="table-wrap"><table><thead><tr><th>{t("状态", "Status")}</th><th>{t("阶段", "Phase")}</th><th>{t("模式", "Mode")}</th><th>{t("更新时间", "Updated")}</th></tr></thead><tbody>{jobs.map((item) => <tr key={item.id} className={item.id === job?.id ? "selected" : ""} onClick={() => onSelectJob(item)}><td><span className={`status-chip ${item.status.toLowerCase()}`}>{item.status}</span></td><td>{item.phase}</td><td>{item.resolvedMode}</td><td>{new Date(item.updatedAt).toLocaleString()}</td></tr>)}{jobs.length === 0 && <tr><td colSpan={4}>{t("暂无服务端任务。", "No server jobs yet.")}</td></tr>}</tbody></table></div>
    </section>
  </>;
}

export function FeatureExplorer({ t, workspaceId, artifact, revision, revisions, historical, selectedId, history, traceability, graph, loading, error, onSelectRevision, onSelectNode, onOpenGraph }: {
  t: T;
  workspaceId: string;
  artifact: GraphArtifact | null;
  revision: GraphRevision | null;
  revisions: GraphRevision[];
  historical: boolean;
  selectedId: string;
  history: FeatureUnderstandingHistory | null;
  traceability: FeatureTraceability | null;
  graph: FeatureGraphProjection | null;
  loading: boolean;
  error: string;
  onSelectRevision: (revisionId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onOpenGraph: () => void;
}) {
  const [mode, setMode] = useState<"FEATURE" | "API">("FEATURE");
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FeatureDetailTab>("overview");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const nodes = useMemo(() => artifact?.nodes ?? [], [artifact]);
  const published = nodes.filter((node) => node.authority !== "CANDIDATE" && node.authority !== "GAP");
  const candidates = nodes.filter((node) => node.authority === "CANDIDATE" || node.authority === "GAP");
  const matches = (node: GraphArtifact["nodes"][number]) => `${node.type} ${node.label ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (mode === "API" ? /api|endpoint|route/i.test(node.type) : /feature/i.test(node.type));
  const visible = published.filter(matches);
  const selected = nodes.find(({ id }) => id === selectedId) ?? visible[0] ?? nodes[0];
  const governedSelection = selected && selected.authority !== "CANDIDATE" && selected.authority !== "GAP";
  const detail = useMemo(() => traceability && revision ? buildFeatureDetail(traceability, graph, {
    workspaceId,
    featureId: traceability.feature.id,
    snapshotManifestId: revision.snapshotManifestId,
    graphRevisionId: revision.id,
    historical,
  }, history) : null, [graph, historical, history, revision, traceability, workspaceId]);
  const tabLabels: Record<FeatureDetailTab, string> = {
    overview: t("概览", "Overview"), evidence: t("证据", "Evidence"), relations: t("关系", "Relations"), gaps: "Gaps", history: t("历史", "History"),
  };
  const evidenceItems = detail?.evidence.items.filter(({ status }) => statusFilter === "ALL" || status === statusFilter) ?? [];

  return <>
    {historical && <div className="historical-banner">◷ {t("正在查看不可变历史版本。整个详情面只读。", "Viewing an immutable historical revision. The entire detail surface is read-only.")}<button className="button" onClick={() => onSelectRevision("current")}>{t("返回当前发布版本", "Return to current")}</button></div>}
    <section className="page-heading"><div><p className="eyebrow">F002 · Understanding</p><h1>{t("功能 / API", "Feature / API")}</h1><p>{t("沿不可变 Snapshot 检查证据、关系、Gap 与历史；对象身份不会被混合。", "Inspect evidence, relations, gaps, and history in an immutable Snapshot without collapsing object identities.")}</p></div><div className="heading-actions"><select aria-label={t("图谱版本", "Graph revision")} value={historical ? revision?.id ?? "" : "current"} onChange={(event) => onSelectRevision(event.currentTarget.value)}><option value="current">{t("当前 Published Head", "Current Published Head")}</option>{revisions.map((item) => <option key={item.id} value={item.id}>{item.status} · {item.mode} · {shortId(item.id)}</option>)}</select><span className={`authority-pill ${historical ? "neutral" : "published"}`}>{historical ? "HISTORICAL · READ ONLY" : "PUBLISHED"}</span></div></section>
    {!artifact ? <Unavailable t={t} reason={t("尚无已发布图谱。完成一次 Workspace 分析后再浏览功能与 API。", "No published graph exists. Complete Workspace analysis before browsing Features and APIs.")} /> : <section className="explorer-layout panel">
      <aside className="explorer-tree"><div className="explorer-toolbar"><div className="segmented"><button className={mode === "FEATURE" ? "active" : ""} onClick={() => setMode("FEATURE")}>{t("功能", "Features")}</button><button className={mode === "API" ? "active" : ""} onClick={() => setMode("API")}>API</button></div><input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("搜索名称或类型", "Search name or type")} /></div><p className="tree-heading">{t("已发布治理树", "Published governed tree")} · {visible.length}</p><div className="tree-list">{visible.map((node) => <button key={node.id} className={node.id === selected?.id ? "active" : ""} onClick={() => onSelectNode(node.id)}><span>◆</span><div><b>{node.label ?? node.id}</b><small>{node.type}</small></div><em>PUBLISHED</em></button>)}{visible.length === 0 && <small>{t("没有匹配对象。", "No matching objects.")}</small>}</div><p className="tree-heading candidate-heading">{t("候选与 Gap（非权威）", "Candidates and gaps (non-authoritative)")} · {candidates.length}</p><div className="tree-list candidates">{candidates.slice(0, 20).map((node) => <button key={node.id} className={node.id === selected?.id ? "active" : ""} onClick={() => onSelectNode(node.id)}><span>{node.authority === "GAP" ? "!" : "◇"}</span><div><b>{node.label ?? node.id}</b><small>{node.type}</small></div><em>{authorityLabel(node.authority)}</em></button>)}</div></aside>
      <div className="explorer-detail">{selected && <><header><div><p className="eyebrow">{selected.type} · {historical ? "HISTORICAL" : "CURRENT"}</p><h2>{selected.label ?? selected.id}</h2><span className={`authority-pill ${authorityLabel(selected.authority).toLowerCase()}`}>{authorityLabel(selected.authority)}</span></div><button className="button" disabled={!governedSelection} onClick={onOpenGraph}>{t("在图谱中聚焦", "Focus in graph")} →</button></header><div className="detail-tabs" role="tablist" aria-label={t("详情视图", "Detail views")}>{featureDetailTabs.map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>{tabLabels[tab]}{tab === "gaps" && detail ? <em>{detail.gaps.items.length}</em> : null}</button>)}</div>
        {loading && <div className="inline-state" role="status">{t("正在加载服务端追溯详情…", "Loading server traceability detail…")}</div>}{error && <div className="inline-state error" role="alert">{error}</div>}
        {!governedSelection ? <div className="candidate-boundary"><b>{selected.authority}</b><p>{t("该对象不属于 Published governed tree。候选与 Gap 不能借用当前已治理详情伪装成权威证据。", "This object is outside the Published governed tree. Candidate and Gap objects cannot borrow governed detail as authoritative evidence.")}</p></div> : !detail ? <Unavailable t={t} reason={t("所选 Snapshot 的追溯响应不可用；所有证据保持 MISSING。", "Traceability is unavailable for the selected Snapshot; all evidence remains MISSING.")} /> : <div className="detail-view" role="tabpanel">
          {activeTab === "overview" && <div className="detail-overview"><section className="context-strip"><span>Workspace<b>{workspaceId}</b></span><span>Snapshot<b>{shortId(detail.context.snapshotManifestId)}</b></span><span>GraphRevision<b>{shortId(detail.context.graphRevisionId)}</b></span><span>{t("模式", "Mode")}<b>{detail.readOnly ? "HISTORICAL · READ ONLY" : "CURRENT · PUBLISHED"}</b></span></section><div className="evidence-state-summary">{Object.entries(detail.overview.statusCounts).map(([status, value]) => <article key={status} className={`evidence-state ${status.toLowerCase()}`}><span>{status}</span><strong>{value}</strong></article>)}</div><section className="trace-chain-summary"><h3>{t("五阶段摘要（对象保持独立）", "Five-stage summary (objects remain distinct)")}</h3>{["Requirement / Decision", "Implementation mapping / Source", "Test file / TestSpec", "TestExecution / VerificationResult", "Evidence / Gap"].map((label, index) => <div key={label}><b>{index + 1}</b><span>{label}</span></div>)}</section></div>}
          {activeTab === "evidence" && <><div className="detail-filter"><label>{t("证据状态", "Evidence state")}<select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)}>{["ALL", "VERIFIED", "MISSING", "STALE", "CONFLICTED", "INVALID", "NOT_APPLICABLE"].map((status) => <option key={status}>{status}</option>)}</select></label><span>{evidenceItems.length} {t("个独立对象", "distinct objects")}</span></div><div className="evidence-grid">{evidenceItems.map((evidence) => <article key={`${evidence.objectType}:${evidence.id}`} className={`evidence-card ${evidence.status.toLowerCase()}`}><header><span>{evidence.objectType}</span><b>{evidence.status}</b></header><h3>{evidence.title}</h3><dl><dt>ID</dt><dd>{evidence.id}</dd><dt>{t("权威", "Authority")}</dt><dd>{evidence.authority}</dd><dt>Workspace</dt><dd>{evidence.workspaceId}</dd><dt>Snapshot</dt><dd>{evidence.snapshotManifestId}</dd><dt>Revision</dt><dd>{evidence.graphRevisionId}</dd><dt>{t("源码", "Source")}</dt><dd>{evidence.sourceLocation ?? "NOT_APPLICABLE / MISSING"}</dd><dt>Digest</dt><dd>{evidence.digest ?? "MISSING"}</dd></dl><details><summary>Immutable Evidence Resolver</summary><code>{evidence.resolver}</code></details></article>)}</div></>}
          {activeTab === "relations" && <div className="relation-evidence-list"><header><h3>{t("带证据的关系", "Evidence-backed relations")} · {detail.relations.items.length}</h3><button className="button" onClick={onOpenGraph}>{t("打开路径解释", "Open path explanation")}</button></header>{detail.relations.items.length === 0 ? <p className="explicit-empty">MISSING · {t("该 Snapshot 未返回可验证关系。", "No verifiable relations were returned for this Snapshot.")}</p> : detail.relations.items.map((relation) => <article key={relation.id}><b>{relation.type}</b><span>{relation.source} → {relation.target}</span><small>{relation.status} · {relation.provenance}</small><code>{relation.resolver}</code></article>)}</div>}
          {activeTab === "gaps" && <div className="gap-list">{detail.gaps.items.length === 0 ? <p className="verified-empty">VERIFIED · {t("服务端在该 Snapshot 未声明 Gap 或 Conflict。", "The server declared no Gap or Conflict in this Snapshot.")}</p> : detail.gaps.items.map((gap) => <article key={String(gap.id)} className={String(gap.status).toLowerCase()}><b>{String(gap.type ?? "CONFLICT")}</b><span>{String(gap.status)}</span><p>{String(gap.message ?? gap.reason ?? t("没有说明", "No explanation"))}</p><small>{String(gap.severity ?? "UNKNOWN")} · {String(gap.ownerRole ?? "UNASSIGNED")}</small></article>)}</div>}
          {activeTab === "history" && <div className="history-detail"><div className="history-mode"><b>{detail.history.mode}</b><span>{t("切换 Revision 会同步更新树、证据、关系与 Gap；历史模式不允许变更。", "Revision selection updates tree, evidence, relations, and gaps together; historical mode disallows mutation.")}</span></div>{[["FeatureVersion", detail.history.featureVersions], ["Decision", detail.history.decisions], ["ImplementationMapping", detail.history.implementationMappings], ["TestSpec", detail.history.testSpecs], ["TestExecution", detail.history.testExecutions], ["GraphRevision", detail.history.graphRevisions]].map(([label, values]) => <section key={label as string}><h3>{label as string} · {(values as Array<Record<string, unknown>>).length}</h3>{(values as Array<Record<string, unknown>>).length === 0 ? <p>MISSING / NOT_APPLICABLE</p> : (values as Array<Record<string, unknown>>).map((value, index) => <article key={String(value.id ?? `${label}-${index}`)}><b>{String(value.name ?? value.type ?? value.id)}</b><span>{String(value.status ?? value.version ?? "IMMUTABLE")}</span><code>{String(value.snapshotManifestId ?? value.graphArtifactDigest ?? detail.context.snapshotManifestId)}</code></article>)}</section>)}</div>}
        </div>}</>}</div>
    </section>}
  </>;
}

export function GraphExplorer({ t, workspaceId, artifact, revision, revisions, historical, focusedId, graph, path, loading, error, onFocus, onSelectRevision, onLoadGraph, onQueryPath }: {
  t: T;
  workspaceId: string;
  artifact: GraphArtifact | null;
  revision: GraphRevision | null;
  revisions: GraphRevision[];
  historical: boolean;
  focusedId: string;
  graph: FeatureGraphProjection | null;
  path: FeatureGraphPathResult | null;
  loading: boolean;
  error: string;
  onFocus: (nodeId: string) => void;
  onSelectRevision: (revisionId: string) => void;
  onLoadGraph: (depth: number, view: FeatureGraphProjection["view"]) => void;
  onQueryPath: (targetNodeId: string, view: FeatureGraphProjection["view"]) => void;
}) {
  const [depth, setDepth] = useState(2);
  const [graphView, setGraphView] = useState<FeatureGraphProjection["view"]>("traceability");
  const [targetId, setTargetId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(focusedId);
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const inspector = useMemo(() => graph && revision ? buildGraphInspector(graph, path, {
    workspaceId,
    featureId: graph.center,
    snapshotManifestId: graph.snapshotManifestId,
    graphRevisionId: revision.id,
    historical,
  }) : null, [graph, historical, path, revision, workspaceId]);
  const selectedNode = inspector?.nodes.find(({ id }) => id === selectedNodeId) ?? inspector?.nodes.find(({ id }) => id === graph?.center) ?? inspector?.nodes[0];
  const selectedEdge = inspector?.edges.find(({ id }) => id === selectedEdgeId);
  const positions = useMemo(() => new Map((inspector?.nodes ?? []).map((node, index, list) => {
    if (node.id === graph?.center) return [node.id, { x: 50, y: 50 }];
    const offset = list.filter(({ id }) => id !== graph?.center).findIndex(({ id }) => id === node.id);
    const count = Math.max(1, list.length - 1);
    const angle = (offset / count) * Math.PI * 2 - Math.PI / 2;
    const radius = 38;
    return [node.id, { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius }];
  })), [graph?.center, inspector?.nodes]);

  return <>
    {historical && <div className="historical-banner">◷ {t("图谱固定在不可变历史 Revision。", "Graph is pinned to an immutable historical Revision.")}<button className="button" onClick={() => onSelectRevision("current")}>{t("返回当前版本", "Return to current")}</button></div>}
    <section className="page-heading"><div><p className="eyebrow">F003 · Understanding</p><h1>{t("理解图谱", "Understanding graph")}</h1><p>{t("服务端执行有界扩展与路径解释；每个节点、边和 hop 都携带可解析证据。", "The server performs bounded expansion and path explanation; every node, edge, and hop carries resolvable evidence.")}</p></div><div className="heading-actions"><select aria-label={t("图谱版本", "Graph revision")} value={historical ? revision?.id ?? "" : "current"} onChange={(event) => onSelectRevision(event.currentTarget.value)}><option value="current">{t("当前 Published Head", "Current Published Head")}</option>{revisions.map((item) => <option key={item.id} value={item.id}>{item.status} · {item.mode} · {shortId(item.id)}</option>)}</select><span className={`authority-pill ${historical ? "neutral" : "published"}`}>{historical ? "HISTORICAL" : "PUBLISHED"}</span></div></section>
    {!artifact || !revision ? <Unavailable t={t} reason={t("尚无 Published GraphRevision。", "No Published GraphRevision exists.")} /> : <><section className="graph-toolbar panel"><label>{t("投影视图", "Projection view")}<select value={graphView} onChange={(event) => setGraphView(event.currentTarget.value as FeatureGraphProjection["view"])}>{["traceability", "business", "implementation", "coverage"].map((value) => <option key={value}>{value}</option>)}</select></label><label>{t("有界深度", "Bounded depth")}<select value={depth} onChange={(event) => setDepth(Number(event.currentTarget.value))}>{[1, 2, 3, 4, 6, 8].map((value) => <option key={value}>{value}</option>)}</select></label><button className="button primary" disabled={loading} onClick={() => onLoadGraph(depth, graphView)}>{t("从服务端加载范围", "Load bounded scope from server")}</button><span>{graph ? `${graph.nodes.length} nodes · ${graph.edges.length} edges` : t("等待查询", "Awaiting query")}</span></section>
      {loading && <div className="inline-state" role="status">{t("正在查询有界图谱…", "Querying bounded graph…")}</div>}{error && <div className="inline-state error" role="alert">{error}</div>}
      {!graph || !inspector ? <Unavailable t={t} reason={t("有界 Feature Graph 响应不可用；不会退回完整仓库图或 Demo。", "The bounded Feature Graph response is unavailable; no full-repository or demo fallback is used.")} /> : <div className="graph-results">
        <section className={`coverage-state ${inspector.coverage.toLowerCase()}`}><b>{inspector.coverage}</b><span>{graph.truncated ? t("已达到声明边界；结果不代表完整覆盖。", "The declared bound was reached; this result is not complete coverage.") : t("服务端确认当前边界内完整。", "The server confirms completeness within this bound.")}</span>{graph.availableExpansions.map((item) => <em key={`${item.relation}:${item.nodeType}`}>{item.relation} → {item.nodeType} +{item.count}</em>)}</section>
        <section className="graph-layout panel"><div className="graph-canvas" role="region" aria-label={t("可交互的有界理解图谱", "Interactive bounded understanding graph")}><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{inspector.edges.map((edge) => { const source = positions.get(edge.source); const target = positions.get(edge.target); return source && target ? <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={edge.status.toLowerCase()} /> : null; })}</svg>{inspector.edges.map((edge) => { const source = positions.get(edge.source); const target = positions.get(edge.target); return source && target ? <button key={edge.id} className={`graph-edge ${edge.status.toLowerCase()} ${edge.id === selectedEdgeId ? "selected" : ""}`} style={{ left: `${(source.x + target.x) / 2}%`, top: `${(source.y + target.y) / 2}%` }} aria-label={`${edge.type}; ID ${edge.id}; ${edge.authority}; ${edge.status}; Snapshot ${edge.snapshotManifestId}; Revision ${edge.graphRevisionId}`} onClick={() => { setSelectedEdgeId(edge.id); setSelectedNodeId(""); }}>{edge.type}</button> : null; })}{inspector.nodes.map((node) => { const position = positions.get(node.id)!; return <button key={node.id} className={`graph-node ${node.authority.toLowerCase()} ${node.id === graph.center ? "focused" : ""} ${node.id === selectedNodeId ? "selected" : ""}`} style={{ left: `${position.x}%`, top: `${position.y}%` }} aria-label={`${node.type} ${node.label}; ID ${node.id}; ${node.authority}; ${node.status}; Snapshot ${node.snapshotManifestId}; Revision ${node.graphRevisionId}`} onClick={() => { setSelectedNodeId(node.id); setSelectedEdgeId(""); onFocus(node.id); }}><b>{node.label}</b><small>{node.status} · {node.authority}</small></button>; })}</div><aside className="graph-inspector">{selectedEdge ? <><p className="eyebrow">EDGE · {selectedEdge.type}</p><h2>{shortId(selectedEdge.id)}</h2><dl><dt>ID</dt><dd>{selectedEdge.id}</dd><dt>{t("语义", "Semantics")}</dt><dd>{selectedEdge.source} → {selectedEdge.target}</dd><dt>{t("权威", "Authority")}</dt><dd>{selectedEdge.authority}</dd><dt>{t("状态", "Status")}</dt><dd>{selectedEdge.status}</dd><dt>Snapshot</dt><dd>{selectedEdge.snapshotManifestId}</dd><dt>Revision</dt><dd>{selectedEdge.graphRevisionId}</dd></dl><h3>Immutable Evidence Resolver</h3><code>{selectedEdge.resolver}</code></> : selectedNode ? <><p className="eyebrow">NODE · {selectedNode.type}</p><h2>{selectedNode.label}</h2><dl><dt>ID</dt><dd>{selectedNode.id}</dd><dt>{t("权威", "Authority")}</dt><dd>{selectedNode.authority}</dd><dt>{t("状态", "Status")}</dt><dd>{selectedNode.status}</dd><dt>Snapshot</dt><dd>{selectedNode.snapshotManifestId}</dd><dt>Revision</dt><dd>{selectedNode.graphRevisionId}</dd><dt>{t("源码", "Source")}</dt><dd>{selectedNode.sourceLocation ?? "NOT_APPLICABLE / MISSING"}</dd></dl><h3>Immutable Evidence Resolver</h3><code>{selectedNode.resolver}</code></> : null}</aside></section>
        <section className="panel path-workbench"><header className="panel-head"><div><h2>{t("路径解释", "Path explanation")}</h2><p>{t("从 Feature center 到目标节点执行服务端有界路径查询。", "Run a bounded server path query from the Feature center to a target node.")}</p></div><div className="path-query"><select aria-label={t("路径目标", "Path target")} value={targetId} onChange={(event) => setTargetId(event.currentTarget.value)}><option value="">{t("选择目标节点", "Select target node")}</option>{graph.nodes.filter(({ id }) => id !== graph.center).map((node) => <option key={node.id} value={node.id}>{node.type} · {node.label}</option>)}</select><button className="button primary" disabled={!targetId || loading} onClick={() => onQueryPath(targetId, graphView)}>{t("解释路径", "Explain path")}</button></div></header>{path?.found === false && <p className="verified-empty">VERIFIED NO PATH · {t("服务端在指定 Revision、Snapshot、方向和最大深度内未找到路径。", "The server found no path within the specified Revision, Snapshot, direction, and maximum depth.")}</p>}{path?.found && <ol className="path-hop-list">{inspector.hops.map((hop) => <li key={hop.id}><b>{hop.hop}</b><div><strong>{hop.type}</strong><span>{hop.source} → {hop.target}</span><small>{hop.authority} · {hop.status} · Snapshot {hop.snapshotManifestId} · Revision {hop.graphRevisionId}</small><code>{hop.resolver}</code></div></li>)}</ol>}{!path && <p className="explicit-empty">{t("尚未查询路径；不能把未查询解释为不存在路径。", "No path query has run; an unqueried path is not a verified absence.")}</p>}</section>
        <section className="panel relation-registry"><header className="panel-head"><div><h2>{t("等价关系 / 路径列表", "Equivalent relation / path list")}</h2><p>{t("移动端、键盘和屏幕阅读器无需画布即可读取相同证据。", "Mobile, keyboard, and screen-reader users can inspect the same evidence without the canvas.")}</p></div></header><div className="table-wrap"><table><thead><tr><th>Edge ID</th><th>{t("来源", "Source")}</th><th>{t("关系语义", "Semantics")}</th><th>{t("目标", "Target")}</th><th>{t("状态 / 权威", "Status / authority")}</th><th>Snapshot / Revision / Resolver</th></tr></thead><tbody>{inspector.edges.map((edge) => <tr key={edge.id} className={edge.id === selectedEdgeId ? "selected" : ""}><td><button onClick={() => { setSelectedEdgeId(edge.id); setSelectedNodeId(""); }}>{edge.id}</button></td><td>{edge.source}</td><td>{edge.type}</td><td>{edge.target}</td><td>{edge.status} / {edge.authority}</td><td><small>{edge.snapshotManifestId}<br />{edge.graphRevisionId}</small><code>{edge.resolver}</code></td></tr>)}</tbody></table></div></section>
      </div>}
    </>}
  </>;
}

export function ReviewWorkspace({ t, items, selectedIds, setSelectedIds, outcome, setOutcome, rationale, setRationale, working, onRefresh, onDecide }: {
  t: T; items: ReviewQueueItem[]; selectedIds: string[]; setSelectedIds: (ids: string[]) => void; outcome: string; setOutcome: (value: string) => void; rationale: string; setRationale: (value: string) => void; working: boolean; onRefresh: () => void; onDecide: () => void;
}) {
  const openItems = items.filter((item) => ["OPEN", "PENDING", "READY_FOR_REVIEW"].includes(item.status));
  const selected = items.find((item) => selectedIds.includes(item.id)) ?? items[0];
  const toggle = (id: string) => setSelectedIds(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  return <><section className="page-heading"><div><p className="eyebrow">F004 · Governance</p><h1>{t("声明审核", "Claim review")}</h1><p>{t("按 Workspace 队列审阅证据化声明；审核人身份由服务端鉴权建立。", "Review evidenced claims from the Workspace queue; reviewer identity is established by server authentication.")}</p></div><button className="button" disabled={working} onClick={onRefresh}>{t("刷新队列", "Refresh queue")}</button></section><section className="review-layout panel"><div className="review-queue"><header><b>Review Queue</b><span>{openItems.length} {t("待处理", "open")}</span></header>{items.map((item) => <button key={item.id} className={selectedIds.includes(item.id) ? "selected" : ""} onClick={() => toggle(item.id)}><input type="checkbox" readOnly checked={selectedIds.includes(item.id)} /><div><b>{String(item.title ?? item.claimType ?? t("待审声明", "Review claim"))}</b><small>{item.severity ?? t("未分级", "Unclassified")} · {item.evidenceState ?? t("证据状态未知", "Evidence unknown")}</small></div><span className={`status-chip ${item.status.toLowerCase()}`}>{item.status}</span></button>)}{items.length === 0 && <div className="queue-empty">✓<b>{t("当前没有待审声明", "No claims awaiting review")}</b><small>{t("队列为空不代表不存在未知证据。", "An empty queue does not imply that evidence is complete.")}</small></div>}</div><div className="review-detail">{selected ? <><p className="eyebrow">{selected.source ?? "Workspace analysis"}</p><h2>{String(selected.title ?? selected.claimType ?? t("声明详情", "Claim details"))}</h2><dl><dt>{t("状态", "Status")}</dt><dd>{selected.status}</dd><dt>{t("严重性", "Severity")}</dt><dd>{selected.severity ?? t("未知", "Unknown")}</dd><dt>{t("证据", "Evidence")}</dt><dd>{selected.evidenceState ?? t("未知", "Unknown")}</dd><dt>{t("批次", "Batch")}</dt><dd>{shortId(selected.analysisBatchId)}</dd></dl><pre>{JSON.stringify(Object.fromEntries(Object.entries(selected).filter(([key]) => !["id", "workspaceId"].includes(key))), null, 2)}</pre></> : <Unavailable t={t} reason={t("选择一条声明查看详情。", "Select a claim to inspect it.")} />}</div><aside className="decision-panel"><p className="eyebrow">{t("审核决定", "Review decision")}</p><h3>{selectedIds.length} {t("项已选择", "selected")}</h3><label>{t("结果", "Outcome")}<select value={outcome} onChange={(event) => setOutcome(event.currentTarget.value)}>{["CONFIRMED", "EDITED", "REJECTED", "DEFERRED", "INSUFFICIENT_EVIDENCE"].map((value) => <option key={value}>{value}</option>)}</select></label><label>{t("理由（必填）", "Rationale (required)")}<textarea rows={6} value={rationale} onChange={(event) => setRationale(event.currentTarget.value)} /></label><button className="button primary" disabled={working || selectedIds.length === 0 || !rationale.trim()} onClick={onDecide}>{t("提交审核决定", "Submit decision")}</button><small>{t("批量操作只适用于同一证据状态和兼容结论；不兼容项应分别处理。", "Batch actions are intended for compatible evidence states and outcomes; incompatible items should be handled separately.")}</small></aside></section></>;
}

export function ImpactWorkspace({ t, artifact, impact, revision }: { t: T; artifact: GraphArtifact | null; impact: Record<string, unknown> | null; revision: GraphRevision | null }) {
  const changed = artifact?.changeSet?.changedNodeIds ?? [];
  const affected = artifact?.impactAssessment?.affectedNodeIds ?? [];
  const actions = artifact?.revalidationPlan?.actions ?? [];
  return <><section className="page-heading"><div><p className="eyebrow">F005 · Governance</p><h1>{t("变更影响", "Change impact")}</h1><p>{t("默认检查最新发布变更集；未知影响保持显式未知，不显示为“无影响”。", "Inspect the latest published change set by default; unknown impact remains explicitly unknown and is never shown as no impact.")}</p></div><span className="authority-pill published">PUBLISHED</span></section>{!artifact?.changeSet ? <Unavailable t={t} reason={t("当前发布版本没有关联的 ChangeSet，影响状态未知。", "The current published revision has no linked ChangeSet, so impact is unknown.")} /> : <><section className="impact-summary"><article><span>{t("版本对", "Revision pair")}</span><strong>{shortId(revision?.baseRevisionId)} → {shortId(revision?.id)}</strong></article><article><span>{t("直接变更", "Direct changes")}</span><strong>{changed.length}</strong></article><article><span>{t("受影响对象", "Affected objects")}</span><strong>{affected.length}</strong></article><article><span>{t("重验证动作", "Revalidation actions")}</span><strong>{actions.length}</strong></article></section><section className="impact-layout"><article className="panel"><header className="panel-head"><div><h2>{t("影响对象", "Impacted objects")}</h2><p>{t("直接变更与传播影响分开显示。", "Direct changes and propagated impact are shown separately.")}</p></div></header><div className="impact-list">{[...new Set([...changed, ...affected])].map((id) => <div key={id}><span className={changed.includes(id) ? "direct" : "propagated"}>{changed.includes(id) ? t("直接", "Direct") : t("传播", "Propagated")}</span><b>{artifact.nodes.find((node) => node.id === id)?.label ?? shortId(id)}</b><small>{artifact.nodes.find((node) => node.id === id)?.type ?? t("类型未知", "Unknown type")}</small></div>)}</div></article><article className="panel"><header className="panel-head"><div><h2>{t("重验证计划", "Revalidation plan")}</h2><p>{artifact.revalidationPlan?.required ? t("发布前后需要执行下列动作。", "The following actions are required around publication.") : t("服务端未声明必须重验证。", "The server did not declare revalidation mandatory.")}</p></div></header><ol className="action-list">{actions.map((action, index) => <li key={`${action}-${index}`}><span>{index + 1}</span>{action}</li>)}{actions.length === 0 && <li className="unknown">? {t("没有动作数据；保持未知，不推断为无影响。", "No action data; remaining unknown rather than inferring no impact.")}</li>}</ol></article></section>{impact && <details className="panel raw-details"><summary>{t("服务端影响证据", "Server impact evidence")}</summary><pre>{JSON.stringify(impact, null, 2)}</pre></details>}</>}</>;
}

export function CapabilitySettings({ t, templates, config, profile: incomingProfile, capabilityHistory, profileHistory, mainModel, setMainModel, mainSkillNames, setMainSkillNames, mainMcpNames, setMainMcpNames, childSlots, setChildSlots, working, onSave, onResolve }: {
  t: T; templates: CapabilityTemplate[]; config: WorkspaceCapabilityConfig | null; profile: ExecutionProfile | null; capabilityHistory: WorkspaceCapabilityConfig[]; profileHistory: ExecutionProfile[]; mainModel: string; setMainModel: (value: string) => void; mainSkillNames: string[]; setMainSkillNames: (value: string[]) => void; mainMcpNames: string[]; setMainMcpNames: (value: string[]) => void; childSlots: ChildCapabilityRole[]; setChildSlots: (value: ChildCapabilityRole[]) => void; working: boolean; onSave: () => void; onResolve: () => void;
}) {
  const models = templates.filter(({ kind }) => kind === "MODEL");
  const skills = templates.filter(({ kind }) => kind === "SKILL");
  const mcps = templates.filter(({ kind }) => kind === "MCP");
  const profile = incomingProfile ? {
    ...incomingProfile,
    configVersion: `${incomingProfile.configVersion} · ${t("历史", "history")} ${capabilityHistory.length}/${profileHistory.length}`,
  } : null;
  const updateSlot = (index: number, patch: Partial<ChildCapabilityRole>) => setChildSlots(childSlots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot));
  return <><section className="page-heading"><div><p className="eyebrow">F006 · Configuration</p><h1>{t("能力设置", "Capability settings")}</h1><p>{t("从全局模板形成 Workspace 草稿，再显式解析为不可变 ExecutionProfileRevision。", "Build a Workspace draft from global templates, then explicitly resolve it into an immutable ExecutionProfileRevision.")}</p></div>{profile ? <span className="authority-pill published">VALID · v{profile.configVersion}</span> : <span className="authority-pill candidate">DRAFT</span>}</section><section className="capability-layers"><article className="active"><b>1</b><span>{t("全局模板", "Global templates")}<small>{templates.length} entries</small></span></article><article className="active"><b>2</b><span>Workspace Draft<small>{config ? `v${config.version}` : t("未保存", "Unsaved")}</small></span></article><article><b>3</b><span>{t("有效差异", "Effective diff")}<small>{t("继承 + 覆盖", "Inheritance + overrides")}</small></span></article><article className={profile ? "active" : ""}><b>4</b><span>{t("不可变 Revision", "Immutable revision")}<small>{shortId(profile?.id)}</small></span></article></section><section className="settings-layout"><div><article className="panel settings-card"><header className="panel-head"><div><h2>Main Agent</h2><p>{t("主 Agent 负责计划、协调和最终 reconciliation。", "Main Agent owns planning, coordination, and final reconciliation.")}</p></div></header><div className="form-grid"><label>{t("模型能力", "Model capability")}<input list="model-options" value={mainModel} onChange={(event) => setMainModel(event.currentTarget.value)} placeholder={t("选择已注册 MODEL 模板", "Choose a registered MODEL template")} /></label><datalist id="model-options">{models.map((model) => <option key={model.id} value={model.logicalName} />)}</datalist><label>{t("技能模板（逗号分隔）", "Skill templates (comma-separated)")}<input value={mainSkillNames.join(", ")} onChange={(event) => setMainSkillNames(event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean))} placeholder={skills.map(({ logicalName }) => logicalName).join(", ") || t("无已注册技能", "No registered skills")} /></label><label>MCP<input value={mainMcpNames.join(", ")} onChange={(event) => setMainMcpNames(event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean))} placeholder={mcps.map(({ logicalName }) => logicalName).join(", ") || t("无已注册 MCP", "No registered MCPs")} /></label></div></article><article className="panel settings-card"><header className="panel-head"><div><h2>Child Agent Slots</h2><p>{t("默认两个，并可增加到任意数量；服务端已保存的 Workspace 配置始终优先。", "Two by default with no fixed maximum; persisted server-owned Workspace configuration always wins.")}</p></div><button className="button" onClick={() => setChildSlots(addChildSlot(childSlots, { model: mainModel, skillNames: mainSkillNames, mcpNames: mainMcpNames }))}>＋ {t("添加槽位", "Add slot")}</button></header><div className="child-slot-list">{childSlots.map((slot, index) => <div key={slot.id}><span>{slot.id}</span><label>{t("模型", "Model")}<input list="model-options" value={slot.model} onChange={(event) => updateSlot(index, { model: event.currentTarget.value })} /></label><label>{t("技能", "Skills")}<input value={slot.skillNames.join(", ")} onChange={(event) => updateSlot(index, { skillNames: event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label><label>MCP<input value={slot.mcpNames.join(", ")} onChange={(event) => updateSlot(index, { mcpNames: event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label><label>{t("独立组", "Independence group")}<input value={slot.independenceGroup} onChange={(event) => updateSlot(index, { independenceGroup: event.currentTarget.value })} /></label><button aria-label={t("删除槽位", "Remove slot")} disabled={childSlots.length === 1} onClick={() => setChildSlots(removeChildSlot(childSlots, slot.id))}>×</button></div>)}</div></article></div><aside><article className="panel config-summary"><p className="eyebrow">{t("有效配置", "Effective configuration")}</p><h2>{profile ? t("已验证", "Validated") : config ? t("草稿已保存", "Draft saved") : t("尚未保存", "Unsaved")}</h2><dl><dt>{t("模型模板", "Model templates")}</dt><dd>{models.length}</dd><dt>{t("技能模板", "Skill templates")}</dt><dd>{skills.length}</dd><dt>MCP</dt><dd>{mcps.length}</dd><dt>Child slots</dt><dd>{childSlots.length}</dd><dt>{t("密钥", "Secrets")}</dt><dd>{t("仅引用 Handle", "Handles only")}</dd></dl><button className="button" disabled={working || !mainModel || childSlots.some(({ model }) => !model)} onClick={onSave}>{t("保存 Workspace 草稿", "Save Workspace draft")}</button><button className="button primary" disabled={working || !config} onClick={onResolve}>{t("验证并创建不可变 Revision", "Validate and create immutable revision")}</button><small>{t("此页面不会接收或显示密钥值。凭据只能通过服务端 handle 和短期 grant 使用。", "This page never receives or displays secret values. Credentials are used only through server handles and short-lived grants.")}</small></article></aside></section></>;
}

export function Unavailable({ t, reason }: { t: T; reason: string }) {
  return <section className="unavailable-state panel"><span>◇</span><h2>{t("当前不可用", "Currently unavailable")}</h2><p>{reason}</p></section>;
}
