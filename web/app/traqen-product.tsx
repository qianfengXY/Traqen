"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ThemeSwitcher } from "./components/ui/theme-switcher";
import { controlServerWorkspaceUnderstanding, getServerWorkspaceUnderstanding, listServerWorkspaceUnderstandingJobs, registerServerWorkspaceSource, resolveServerWorkspaceExecutionProfile, startServerWorkspaceUnderstanding, type ServerUnderstandingJob } from "./server-understanding-client";
import { getCurrentUnderstandingGraph, listGraphRevisions, type CurrentUnderstandingGraph, type GraphRevision } from "./understanding-graph-client";
import { createWorkspace, listWorkspaces, staleWorkspaceResponse, type CurrentWorkspaceContext, type Workspace } from "./workspace-client";
import { ThemeProvider } from "./theme-context";

type View = "workspace" | "trace" | "graph" | "impact" | "metrics";
type Language = "zh-CN" | "en";

const labels = {
  workspace: ["Workspace 分析", "Workspace analysis"],
  trace: ["功能追溯", "Feature traceability"],
  graph: ["追溯图谱", "Trace graph"],
  impact: ["变更影响", "Change impact"],
  metrics: ["效果指标", "Effectiveness metrics"],
} satisfies Record<View, [string, string]>;

function ServerOwnedProduct() {
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [view, setView] = useState<View>("workspace");
  const [apiBase, setApiBase] = useState("http://localhost:3001");
  const [apiToken, setApiToken] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [sourceRoot, setSourceRoot] = useState("");
  const [profileRevisionId, setProfileRevisionId] = useState("");
  const [job, setJob] = useState<ServerUnderstandingJob | null>(null);
  const [current, setCurrent] = useState<CurrentUnderstandingGraph | null>(null);
  const [revisions, setRevisions] = useState<GraphRevision[]>([]);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const contextRef = useRef<CurrentWorkspaceContext>({ workspaceId: "", contextVersion: 0 });
  const t = useCallback((zh: string, en: string) => language === "zh-CN" ? zh : en, [language]);

  const refreshPublishedGraph = useCallback(async (workspace: Workspace, requestContext: CurrentWorkspaceContext) => {
    const [nextCurrent, nextRevisions] = await Promise.all([
      getCurrentUnderstandingGraph(apiBase, apiToken, workspace.id),
      listGraphRevisions(apiBase, apiToken, workspace.id),
    ]);
    if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
    setCurrent(nextCurrent);
    setRevisions(nextRevisions);
  }, [apiBase, apiToken]);

  const reconnectWorkspaceJob = useCallback(async (workspace: Workspace, requestContext: CurrentWorkspaceContext) => {
    const jobs = await listServerWorkspaceUnderstandingJobs(apiBase, apiToken, workspace.id);
    if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
    const latest = jobs[0] ?? null;
    setJob(latest);
    setProfileRevisionId(latest?.workspaceExecutionProfileRevisionId ?? "");
  }, [apiBase, apiToken]);

  async function refreshWorkspaces() {
    setWorking(true);
    try {
      const next = await listWorkspaces(apiBase, apiToken, "WEB-OPERATOR");
      setWorkspaces(next.filter(({ hidden, lifecycleState }) => !hidden && lifecycleState === "ACTIVE"));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("无法加载 Workspace", "Unable to load Workspaces"));
    } finally {
      setWorking(false);
    }
  }

  async function createFirstWorkspace() {
    if (!workspaceName.trim()) return;
    setWorking(true);
    try {
      const created = await createWorkspace(apiBase, apiToken, {
        id: `WORKSPACE-${crypto.randomUUID()}`,
        name: workspaceName.trim(),
        userId: "WEB-OPERATOR",
      });
      setWorkspaces((existing) => [...existing, created]);
      selectWorkspace(created);
      setWorkspaceName("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("创建失败", "Creation failed"));
    } finally {
      setWorking(false);
    }
  }

  function selectWorkspace(workspace: Workspace) {
    const nextContext = {
      workspaceId: workspace.id,
      contextVersion: contextRef.current.contextVersion + 1,
    };
    contextRef.current = nextContext;
    window.localStorage.setItem("traqen.activeWorkspaceId", workspace.id);
    setActiveWorkspace(workspace);
    setJob(null);
    setProfileRevisionId("");
    setCurrent(null);
    setRevisions([]);
    setMessage("");
    void refreshPublishedGraph(workspace, nextContext).catch(() => undefined);
    void reconnectWorkspaceJob(workspace, nextContext).catch(() => undefined);
  }

  useEffect(() => {
    const remembered = window.localStorage.getItem("traqen.activeWorkspaceId");
    if (!remembered || activeWorkspace?.id === remembered) return;
    void listWorkspaces(apiBase, apiToken, "WEB-OPERATOR").then((available) => {
      const workspace = available.find(({ id, hidden, lifecycleState }) =>
        id === remembered && !hidden && lifecycleState === "ACTIVE");
      if (workspace) selectWorkspace(workspace);
    }).catch(() => undefined);
    // Workspace selection deliberately re-establishes the server Job and graph context after refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, apiToken]);

  async function controlUnderstanding(action: "pause" | "resume" | "cancel") {
    if (!activeWorkspace || !job) return;
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      const next = await controlServerWorkspaceUnderstanding(apiBase, apiToken, activeWorkspace.id, job.id, action);
      if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
      setJob(next);
      setMessage(t(`服务端任务已${action === "pause" ? "暂停" : action === "resume" ? "恢复" : "取消"}。`, `The server job was ${action === "pause" ? "paused" : action === "resume" ? "resumed" : "cancelled"}.`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("控制任务失败", "Unable to control the job"));
    } finally {
      setWorking(false);
    }
  }

  async function startUnderstanding() {
    if (!activeWorkspace || !sourceRoot.trim()) return;
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      const profile = await resolveServerWorkspaceExecutionProfile(apiBase, apiToken, activeWorkspace.id);
      const registration = await registerServerWorkspaceSource(apiBase, apiToken, activeWorkspace.id, sourceRoot.trim());
      const started = await startServerWorkspaceUnderstanding(apiBase, apiToken, activeWorkspace.id, {
        sourceRegistrationId: registration.id,
        requestedMode: "AUTO",
        workspaceExecutionProfileRevisionId: profile.id,
      });
      if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
      setProfileRevisionId(profile.id);
      setJob(started);
      setMessage(t("服务端任务已启动；关闭浏览器不会停止分析。", "The server job started; closing the browser does not stop analysis."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("启动失败", "Start failed"));
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (!activeWorkspace || !job || ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return;
    const requestContext = { ...contextRef.current };
    const timer = window.setInterval(() => {
      void getServerWorkspaceUnderstanding(apiBase, apiToken, activeWorkspace.id, job.id)
        .then((next) => {
          if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
          setJob(next);
          if (next.status === "COMPLETED") void refreshPublishedGraph(activeWorkspace, requestContext);
        })
        .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeWorkspace, apiBase, apiToken, job, refreshPublishedGraph]);

  const graph = current?.graphArtifact;
  return (
    <main className="app-shell">
      <header className="topbar">
        <div><strong>Traqen</strong><span> · {t("可追溯质量工作台", "Traceable quality workspace")}</span></div>
        <div className="topbar-actions">
          <label>{t("API 地址", "API base")}<input value={apiBase} onChange={(event) => setApiBase(event.currentTarget.value)} /></label>
          <label>{t("API token（仅保存在当前页面内存）", "API token (page memory only)")}<input type="password" value={apiToken} onChange={(event) => setApiToken(event.currentTarget.value)} /></label>
          <ThemeSwitcher ariaLabel={t("全局主题配色", "Global color theme")} />
          <button onClick={() => setLanguage("zh-CN")}>中文</button>
          <button onClick={() => setLanguage("en")}>English</button>
        </div>
      </header>

      <nav className="global-nav" aria-label={t("全局导航", "Global navigation")}>
        {(Object.keys(labels) as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{language === "zh-CN" ? labels[item][0] : labels[item][1]}</button>)}
      </nav>

      {message && <p className="status-message">{message}</p>}

      {!activeWorkspace && <section className="workspace-create-page panel">
        <p className="eyebrow">Server-owned Workspace</p>
        <h1>{t("创建第一个 Workspace", "Create the first Workspace")}</h1>
        <p>{t("创建项目后，才会加载工程选择、分析 Agent、候选树与追溯统计。所有扫描、模型执行与发布均由服务端任务负责。", "After creating a project, source selection, Analysis Agents, Candidate graphs, and trace metrics load from server-owned jobs.")}</p>
        <label>{t("Workspace 名称", "Workspace name")}<input value={workspaceName} onChange={(event) => setWorkspaceName(event.currentTarget.value)} /></label>
        <button className="button primary" disabled={working || !workspaceName.trim()} onClick={() => void createFirstWorkspace()}>{t("新建 Workspace", "New Workspace")}</button>
        <button className="button" disabled={working} onClick={() => void refreshWorkspaces()}>{t("加载已有 Workspace", "Load existing Workspaces")}</button>
        <div>{workspaces.map((workspace) => <button key={workspace.id} onClick={() => selectWorkspace(workspace)}>{workspace.name}</button>)}</div>
        <p>{t("尚未创建项目 · 待创建", "No project yet · Pending creation")}</p>
        <p>{t("配置分析模型由服务端 WorkspaceExecutionProfileRevision 完成，浏览器不持有 authoritative 模型循环。", "Analysis models are configured through the server WorkspaceExecutionProfileRevision; the browser owns no authoritative model loop.")}</p>
      </section>}

      {activeWorkspace && view === "workspace" && <section className="panel">
        <p className="eyebrow">{activeWorkspace.name}</p>
        <h1>{t("Workspace 分析", "Workspace analysis")}</h1>
        <label>{t("服务端 allowlisted 源码根目录", "Server allowlisted source root")}<input value={sourceRoot} onChange={(event) => setSourceRoot(event.currentTarget.value)} placeholder="/srv/workspaces/project" /></label>
        <button className="button primary" disabled={working || !sourceRoot.trim() || job?.status === "RUNNING"} onClick={() => void startUnderstanding()}>{t("启动服务端分析", "Start server analysis")}</button>
        <p>{profileRevisionId ? `${t("固定执行 Profile", "Pinned execution profile")}: ${profileRevisionId}` : t("启动时解析当前 Workspace 的不可变执行 Profile；缺少配置将拒绝启动。", "The immutable profile for this Workspace is resolved at start; missing configuration rejects the run.")}</p>
        {job && <div><strong>{job.status}</strong><span> · {job.phase}</span><p>{job.completedPhases.join(" → ")}</p>{job.error && <p>{job.error.message}</p>}<div>{job.status === "RUNNING" && <button disabled={working} onClick={() => void controlUnderstanding("pause")}>{t("暂停", "Pause")}</button>}{job.status === "PAUSED" && <button disabled={working} onClick={() => void controlUnderstanding("resume")}>{t("恢复", "Resume")}</button>}{!["COMPLETED", "FAILED", "CANCELLED"].includes(job.status) && <button disabled={working} onClick={() => void controlUnderstanding("cancel")}>{t("取消", "Cancel")}</button>}</div></div>}
        <p>{t("浏览器刷新不会改变服务端任务状态；CurrentGraphHead 仅在 reviewed evaluation 通过后原子切换。", "Browser refresh does not change server job state; CurrentGraphHead moves atomically only after reviewed evaluation passes.")}</p>
      </section>}

      {activeWorkspace && view !== "workspace" && <section className="panel">
        <p className="eyebrow">CurrentGraphHead</p>
        <h1>{language === "zh-CN" ? labels[view][0] : labels[view][1]}</h1>
        {!graph && <p>{t("尚无已发布图谱。请先运行服务端 Workspace 分析。", "No published graph yet. Run server-owned Workspace analysis first.")}</p>}
        {graph && <>
          <p>{current.revision.mode} · {current.revision.snapshotManifestId} · revision {current.head.version}</p>
          <div className="published-understanding-artifact">
            <span>{graph.nodes.length} nodes</span><span>{graph.edges.length} relations</span><span>{graph.traceChains.filter(({ complete }) => complete).length} complete TraceChains</span><span>{graph.gaps.length} gaps</span>
          </div>
          <ol>{graph.nodes.slice(0, 30).map((node) => <li key={node.id}><strong>{node.type}</strong> · {node.label ?? node.id} · {node.authority}</li>)}</ol>
          {view === "impact" && <pre>{JSON.stringify(graph.impactAssessment ?? graph.changeSet ?? {}, null, 2)}</pre>}
          {view === "metrics" && <p>{t("没有综合绿色分数；库存、正确性、关系、来源、Gap、回放和增量等价维度独立展示。", "There is no composite green score; inventory, correctness, relations, provenance, gaps, replay, and incremental equivalence remain independent.")}</p>}
        </>}
        <p>{revisions.length} {t("个不可变历史版本", "immutable historical revisions")}</p>
      </section>}
    </main>
  );
}

export function TraqenProduct() {
  return <ThemeProvider><ServerOwnedProduct /></ThemeProvider>;
}
