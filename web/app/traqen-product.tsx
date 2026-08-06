"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ThemeSwitcher } from "./components/ui/theme-switcher";
import { createDefaultChildSlots } from "./capability-roster";
import {
  CapabilitySettings,
  EmptyWorkspace,
  FeatureExplorer,
  GraphExplorer,
  ImpactWorkspace,
  ReviewWorkspace,
  WorkspaceOverview,
  AnalysisCommandCenter,
  type GraphArtifact,
  type T,
} from "./product-surfaces";
import {
  decideWorkspaceReviewBatch,
  getConnectionHealth,
  getWorkspaceReviewQueue,
  listCapabilityTemplates,
  listWorkspaceCapabilityConfigs,
  listWorkspaceExecutionProfiles,
  resolveWorkspaceExecutionProfile,
  saveWorkspaceCapabilityConfig,
  type CapabilityTemplate,
  type ChildCapabilityRole,
  type ExecutionProfile,
  type ReviewQueueItem,
  type WorkspaceCapabilityConfig,
} from "./product-foundation-client";
import {
  controlServerWorkspaceUnderstanding,
  getServerWorkspaceUnderstanding,
  listServerWorkspaceUnderstandingJobs,
  registerServerWorkspaceSource,
  resolveServerWorkspaceExecutionProfile,
  startHistoricalRevisionReanalysis,
  startServerWorkspaceUnderstanding,
  type ServerUnderstandingJob,
} from "./server-understanding-client";
import { ThemeProvider } from "./theme-context";
import {
  getCurrentUnderstandingGraph,
  getFeatureGraph,
  getFeatureTraceability,
  getFeatureUnderstandingHistory,
  getGraphRevision,
  getUnderstandingChangeImpact,
  listGraphRevisions,
  queryFeatureGraphPath,
  resolveGraphEvidence,
  type CurrentUnderstandingGraph,
  type FeatureGraphPathResult,
  type FeatureGraphProjection,
  type FeatureTraceability,
  type FeatureUnderstandingHistory,
  type GraphRevision,
  type HistoricalAvailability,
} from "./understanding-graph-client";
import { createWorkspace, listWorkspaces, staleWorkspaceRequestResponse, staleWorkspaceResponse, type CurrentWorkspaceContext, type Workspace } from "./workspace-client";

type View = "overview" | "workspace" | "feature" | "graph" | "review" | "impact" | "settings";
type Language = "zh-CN" | "en";
type Health = "checking" | "healthy" | "unavailable";

const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_TRAQEN_API_BASE ?? "http://127.0.0.1:3100";
const DEFAULT_SOURCE_ROOT = process.env.NEXT_PUBLIC_TRAQEN_DEV_SOURCE_ROOT ?? "";
const WEB_OPERATOR = "WEB-OPERATOR";

const modules: Array<{ key: View; icon: string; section: "overview" | "understanding" | "governance" | "configuration"; zh: string; en: string }> = [
  { key: "overview", icon: "⌂", section: "overview", zh: "工作台概览", en: "Workspace overview" },
  { key: "workspace", icon: "◎", section: "understanding", zh: "Workspace 分析", en: "Workspace analysis" },
  { key: "feature", icon: "◇", section: "understanding", zh: "功能 / API", en: "Feature / API" },
  { key: "graph", icon: "⌘", section: "understanding", zh: "理解图谱", en: "Understanding graph" },
  { key: "review", icon: "✓", section: "governance", zh: "声明审核", en: "Claim review" },
  { key: "impact", icon: "↗", section: "governance", zh: "变更影响", en: "Change impact" },
  { key: "settings", icon: "⚙", section: "configuration", zh: "能力设置", en: "Capability settings" },
];

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function resolveGovernedSelection(artifact: GraphArtifact | null, selectedId: string) {
  if (!artifact) return null;
  const selected = artifact.nodes.find(({ id }) => id === selectedId);
  if (!selected || selected.authority === "CANDIDATE" || selected.authority === "GAP") return null;
  if (/feature/i.test(selected.type)) return { ownerFeatureId: selected.id, selectedObjectId: selected.id };
  const features = new Set(artifact.nodes.filter(({ type, authority }) => /feature/i.test(type) && authority !== "CANDIDATE" && authority !== "GAP").map(({ id }) => id));
  if (features.size === 0) return null;
  const adjacency = new Map<string, string[]>();
  for (const edge of artifact.edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }
  const queue = [selected.id];
  const visited = new Set(queue);
  while (queue.length) {
    const currentId = queue.shift()!;
    if (features.has(currentId)) return { ownerFeatureId: currentId, selectedObjectId: selected.id };
    for (const nextId of adjacency.get(currentId) ?? []) {
      if (!visited.has(nextId)) {
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }
  return null;
}

function ServerOwnedProduct() {
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [view, setView] = useState<View>("overview");
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [apiToken, setApiToken] = useState("");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [health, setHealth] = useState<Health>("checking");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [sourceRoot, setSourceRoot] = useState(DEFAULT_SOURCE_ROOT);
  const [sourceRegistrationId, setSourceRegistrationId] = useState("");
  const [profileRevisionId, setProfileRevisionId] = useState("");
  const [job, setJob] = useState<ServerUnderstandingJob | null>(null);
  const [jobs, setJobs] = useState<ServerUnderstandingJob[]>([]);
  const [current, setCurrent] = useState<CurrentUnderstandingGraph | null>(null);
  const [artifact, setArtifact] = useState<GraphArtifact | null>(null);
  const [displayRevision, setDisplayRevision] = useState<GraphRevision | null>(null);
  const [revisions, setRevisions] = useState<GraphRevision[]>([]);
  const [historical, setHistorical] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState("");
  const [featureHistory, setFeatureHistory] = useState<FeatureUnderstandingHistory | null>(null);
  const [featureTraceability, setFeatureTraceability] = useState<FeatureTraceability | null>(null);
  const [boundedGraph, setBoundedGraph] = useState<FeatureGraphProjection | null>(null);
  const [graphPath, setGraphPath] = useState<FeatureGraphPathResult | null>(null);
  const [traceabilityLoading, setTraceabilityLoading] = useState(false);
  const [traceabilityError, setTraceabilityError] = useState("");
  const [reviewItems, setReviewItems] = useState<ReviewQueueItem[]>([]);
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
  const [reviewOutcome, setReviewOutcome] = useState("CONFIRMED");
  const [reviewRationale, setReviewRationale] = useState("");
  const [impact, setImpact] = useState<Record<string, unknown> | null>(null);
  const [templates, setTemplates] = useState<CapabilityTemplate[]>([]);
  const [capabilityConfig, setCapabilityConfig] = useState<WorkspaceCapabilityConfig | null>(null);
  const [executionProfile, setExecutionProfile] = useState<ExecutionProfile | null>(null);
  const [capabilityHistory, setCapabilityHistory] = useState<WorkspaceCapabilityConfig[]>([]);
  const [profileHistory, setProfileHistory] = useState<ExecutionProfile[]>([]);
  const [mainModel, setMainModel] = useState("");
  const [mainSkillNames, setMainSkillNames] = useState<string[]>([]);
  const [mainMcpNames, setMainMcpNames] = useState<string[]>([]);
  const [childSlots, setChildSlots] = useState<ChildCapabilityRole[]>(() => createDefaultChildSlots());
  const [startConfirmationOpen, setStartConfirmationOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");
  const [working, setWorking] = useState(false);
  const contextRef = useRef<CurrentWorkspaceContext>({ workspaceId: "", contextVersion: 0 });
  const detailRequestRef = useRef(0);
  const graphRequestRef = useRef(0);
  const pathRequestRef = useRef(0);
  const revisionRequestRef = useRef(0);
  const t: T = useCallback((zh, en) => language === "zh-CN" ? zh : en, [language]);
  const resolveEvidence = useCallback((resolver: string) =>
    resolveGraphEvidence(apiBase, apiToken, resolver), [apiBase, apiToken]);

  const notify = useCallback((text: string, kind: "info" | "error" = "info") => {
    setMessage(text);
    setMessageKind(kind);
  }, []);

  const refreshWorkspaceReads = useCallback(async (workspace: Workspace, requestContext: CurrentWorkspaceContext) => {
    const revisionRequestVersion = revisionRequestRef.current + 1;
    revisionRequestRef.current = revisionRequestVersion;
    const [graphResult, revisionResult, jobResult, reviewResult, configResult, profileResult] = await Promise.allSettled([
      getCurrentUnderstandingGraph(apiBase, apiToken, workspace.id),
      listGraphRevisions(apiBase, apiToken, workspace.id),
      listServerWorkspaceUnderstandingJobs(apiBase, apiToken, workspace.id),
      getWorkspaceReviewQueue(apiBase, apiToken, workspace.id),
      listWorkspaceCapabilityConfigs(apiBase, apiToken, workspace.id),
      listWorkspaceExecutionProfiles(apiBase, apiToken, workspace.id),
    ]);
    if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
    if (graphResult.status === "fulfilled" && revisionRequestVersion === revisionRequestRef.current) {
      setCurrent(graphResult.value);
      setArtifact(graphResult.value?.graphArtifact ?? null);
      setDisplayRevision(graphResult.value?.revision ?? null);
      setHistorical(false);
      setFocusedNodeId((existing) => existing || graphResult.value?.graphArtifact.nodes[0]?.id || "");
    }
    if (revisionResult.status === "fulfilled") setRevisions(revisionResult.value);
    if (jobResult.status === "fulfilled") {
      const availableJobs = jobResult.value;
      const recoverable = availableJobs.find(({ status }) => status === "RUNNING")
        ?? availableJobs.find(({ status }) => status === "PAUSED")
        ?? availableJobs[0]
        ?? null;
      setJobs(availableJobs);
      setJob(recoverable);
      if (recoverable) {
        setProfileRevisionId(recoverable.workspaceExecutionProfileRevisionId);
        setSourceRegistrationId(recoverable.sourceRegistrationId);
      }
    }
    if (reviewResult.status === "fulfilled") setReviewItems(reviewResult.value);
    if (configResult.status === "fulfilled") {
      setCapabilityHistory(configResult.value);
      const latestConfig = configResult.value[0] ?? null;
      setCapabilityConfig(latestConfig);
      if (latestConfig) {
        setMainModel(latestConfig.mainAgent.model);
        setMainSkillNames(latestConfig.mainAgent.skillNames);
        setMainMcpNames(latestConfig.mainAgent.mcpNames);
        setChildSlots(latestConfig.childSlots);
      }
    }
    if (profileResult.status === "fulfilled") {
      setProfileHistory(profileResult.value);
      const latestProfile = profileResult.value[0] ?? null;
      setExecutionProfile(latestProfile);
      if (latestProfile) setProfileRevisionId(latestProfile.id);
    }
    const failures = [graphResult, revisionResult, jobResult, reviewResult, configResult, profileResult].filter((result) => result.status === "rejected");
    if (failures.length > 1) notify(t("部分 Workspace 数据暂时不可用，请检查连接诊断。", "Some Workspace data is unavailable; inspect connection diagnostics."), "error");
  }, [apiBase, apiToken, notify, t]);

  const selectWorkspace = useCallback((workspace: Workspace, roster?: ChildCapabilityRole[]) => {
    const nextContext = { workspaceId: workspace.id, contextVersion: contextRef.current.contextVersion + 1 };
    contextRef.current = nextContext;
    window.localStorage.setItem("traqen.activeWorkspaceId", workspace.id);
    setActiveWorkspace(workspace);
    setView("overview");
    setJob(null);
    setJobs([]);
    setCurrent(null);
    setArtifact(null);
    setDisplayRevision(null);
    setRevisions([]);
    setHistorical(false);
    setFocusedNodeId("");
    setFeatureHistory(null);
    setFeatureTraceability(null);
    setBoundedGraph(null);
    setGraphPath(null);
    setTraceabilityLoading(false);
    setTraceabilityError("");
    detailRequestRef.current += 1;
    graphRequestRef.current += 1;
    pathRequestRef.current += 1;
    revisionRequestRef.current += 1;
    setReviewItems([]);
    setSelectedReviewIds([]);
    setImpact(null);
    setCapabilityConfig(null);
    setExecutionProfile(null);
    setCapabilityHistory([]);
    setProfileHistory([]);
    const firstModel = roster?.[0]?.model ?? templates.find(({ kind }) => kind === "MODEL")?.logicalName ?? "";
    const skillNames = roster?.[0]?.skillNames ?? templates.filter(({ kind }) => kind === "SKILL").map(({ logicalName }) => logicalName);
    const mcpNames = roster?.[0]?.mcpNames ?? templates.filter(({ kind }) => kind === "MCP").map(({ logicalName }) => logicalName);
    setMainModel(firstModel);
    setMainSkillNames([...skillNames]);
    setMainMcpNames([...mcpNames]);
    setChildSlots(roster ?? createDefaultChildSlots(firstModel, skillNames, mcpNames));
    setSourceRoot(DEFAULT_SOURCE_ROOT);
    setSourceRegistrationId("");
    setProfileRevisionId("");
    setMessage("");
    void refreshWorkspaceReads(workspace, nextContext);
  }, [refreshWorkspaceReads, templates]);

  const reconnect = useCallback(async (preferRemembered = false) => {
    revisionRequestRef.current += 1;
    setTraceabilityLoading(false);
    setHealth("checking");
    try {
      const [available, , availableTemplates] = await Promise.all([
        listWorkspaces(apiBase, apiToken, WEB_OPERATOR),
        getConnectionHealth(apiBase),
        listCapabilityTemplates(apiBase, apiToken),
      ]);
      const visible = available.filter(({ hidden, lifecycleState }) => !hidden && lifecycleState === "ACTIVE");
      setWorkspaces(visible);
      setHealth("healthy");
      setTemplates(availableTemplates);
      const firstModel = availableTemplates.find(({ kind }) => kind === "MODEL")?.logicalName ?? "";
      const skills = availableTemplates.filter(({ kind }) => kind === "SKILL").map(({ logicalName }) => logicalName);
      const mcps = availableTemplates.filter(({ kind }) => kind === "MCP").map(({ logicalName }) => logicalName);
      const defaultRoster = createDefaultChildSlots(firstModel, skills, mcps);
      setMainModel((value) => value || firstModel);
      setMainSkillNames((value) => value.length ? value : skills);
      setMainMcpNames((value) => value.length ? value : mcps);
      setChildSlots((slots) => slots.map((slot) => ({
        ...slot,
        model: slot.model || firstModel,
        skillNames: slot.skillNames.length ? slot.skillNames : skills,
        mcpNames: slot.mcpNames.length ? slot.mcpNames : mcps,
      })));
      const remembered = preferRemembered ? window.localStorage.getItem("traqen.activeWorkspaceId") : activeWorkspace?.id;
      const selection = visible.find(({ id }) => id === remembered) ?? (preferRemembered ? visible[0] : null);
      if (selection && selection.id !== activeWorkspace?.id) selectWorkspace(selection, defaultRoster);
      if (activeWorkspace && visible.some(({ id }) => id === activeWorkspace.id)) {
        const next = { ...contextRef.current };
        void refreshWorkspaceReads(activeWorkspace, next);
      }
      notify("");
    } catch (error) {
      setHealth("unavailable");
      notify(messageOf(error, t("无法连接 Traqen API", "Unable to connect to the Traqen API")), "error");
    }
  }, [activeWorkspace, apiBase, apiToken, notify, refreshWorkspaceReads, selectWorkspace, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reconnect(true);
    }, 0);
    return () => window.clearTimeout(timer);
    // Initial attachment is GET-only. Connection changes require an explicit reconnect command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeWorkspace || !job || ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return;
    const requestContext = { ...contextRef.current };
    const timer = window.setInterval(() => {
      void getServerWorkspaceUnderstanding(apiBase, apiToken, activeWorkspace.id, job.id).then((next) => {
        if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
        setJob(next);
        setJobs((existing) => existing.map((item) => item.id === next.id ? next : item));
        if (next.status === "COMPLETED") void refreshWorkspaceReads(activeWorkspace, requestContext);
      }).catch((error) => notify(messageOf(error, t("任务轮询失败", "Job polling failed")), "error"));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeWorkspace, apiBase, apiToken, job, notify, refreshWorkspaceReads, t]);

  useEffect(() => {
    if (!activeWorkspace || !artifact?.changeSet?.id) {
      const timer = window.setTimeout(() => setImpact(null), 0);
      return () => window.clearTimeout(timer);
    }
    const requestContext = { ...contextRef.current };
    void getUnderstandingChangeImpact(apiBase, apiToken, activeWorkspace.id, artifact.changeSet.id).then((result) => {
      if (!staleWorkspaceResponse(requestContext, contextRef.current)) setImpact(result);
    }).catch(() => setImpact(null));
  }, [activeWorkspace, apiBase, apiToken, artifact?.changeSet?.id]);

  useEffect(() => {
    const selection = resolveGovernedSelection(artifact, focusedNodeId);
    const snapshotManifestId = displayRevision?.snapshotManifestId ?? "";
    const graphRevisionId = displayRevision?.id ?? "";
    if (!activeWorkspace || !selection || !snapshotManifestId || !graphRevisionId) {
      const timer = window.setTimeout(() => {
        setFeatureHistory(null);
        setFeatureTraceability(null);
        setBoundedGraph(null);
        setGraphPath(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const requestContext = { ...contextRef.current };
    const requestVersion = detailRequestRef.current + 1;
    detailRequestRef.current = requestVersion;
    graphRequestRef.current += 1;
    pathRequestRef.current += 1;
    const loadingTimer = window.setTimeout(() => {
      if (requestVersion === detailRequestRef.current) {
        setTraceabilityLoading(true);
        setTraceabilityError("");
      }
    }, 0);
    void Promise.allSettled([
      getFeatureUnderstandingHistory(apiBase, apiToken, activeWorkspace.id, selection.ownerFeatureId, { selectedObjectId: selection.selectedObjectId, graphRevisionId }),
      getFeatureTraceability(apiBase, apiToken, activeWorkspace.id, selection.ownerFeatureId, snapshotManifestId, { selectedObjectId: selection.selectedObjectId, graphRevisionId }),
      getFeatureGraph(apiBase, apiToken, activeWorkspace.id, selection.ownerFeatureId, snapshotManifestId, { view: "traceability", depth: 2, limit: 60, rootNodeId: selection.selectedObjectId, graphRevisionId }),
    ]).then(([historyResult, traceabilityResult, graphResult]) => {
      if (staleWorkspaceRequestResponse(requestContext, contextRef.current, requestVersion, detailRequestRef.current)) return;
      setFeatureHistory(historyResult.status === "fulfilled" ? historyResult.value : null);
      setFeatureTraceability(traceabilityResult.status === "fulfilled" ? traceabilityResult.value : null);
      setBoundedGraph(graphResult.status === "fulfilled" ? graphResult.value : null);
      setGraphPath(null);
      const failures = [historyResult, traceabilityResult, graphResult].filter(({ status }) => status === "rejected");
      if (failures.length) setTraceabilityError(t("部分追溯详情无法加载；不可用证据保持为 MISSING。", "Some traceability details could not load; unavailable evidence remains MISSING."));
    }).finally(() => {
      if (requestVersion === detailRequestRef.current) setTraceabilityLoading(false);
    });
    return () => window.clearTimeout(loadingTimer);
  }, [activeWorkspace, apiBase, apiToken, artifact, displayRevision?.id, displayRevision?.snapshotManifestId, focusedNodeId, t]);

  const loadBoundedGraph = useCallback(async (depth: number, graphView: FeatureGraphProjection["view"]) => {
    const selection = resolveGovernedSelection(artifact, focusedNodeId);
    const snapshotManifestId = displayRevision?.snapshotManifestId;
    const graphRevisionId = displayRevision?.id;
    if (!activeWorkspace || !selection || !snapshotManifestId || !graphRevisionId) return;
    const requestContext = { ...contextRef.current };
    const requestVersion = graphRequestRef.current + 1;
    graphRequestRef.current = requestVersion;
    pathRequestRef.current += 1;
    setTraceabilityLoading(true);
    setTraceabilityError("");
    try {
      const result = await getFeatureGraph(apiBase, apiToken, activeWorkspace.id, selection.ownerFeatureId, snapshotManifestId, { view: graphView, depth, limit: 60, rootNodeId: selection.selectedObjectId, graphRevisionId });
      if (!staleWorkspaceRequestResponse(requestContext, contextRef.current, requestVersion, graphRequestRef.current)) {
        setBoundedGraph(result);
        setGraphPath(null);
      }
    } catch (error) {
      if (!staleWorkspaceRequestResponse(requestContext, contextRef.current, requestVersion, graphRequestRef.current)) setTraceabilityError(messageOf(error, t("有界图谱加载失败", "Bounded graph load failed")));
    } finally {
      if (requestVersion === graphRequestRef.current) setTraceabilityLoading(false);
    }
  }, [activeWorkspace, apiBase, apiToken, artifact, displayRevision?.id, displayRevision?.snapshotManifestId, focusedNodeId, t]);

  const explainGraphPath = useCallback(async (targetNodeId: string, graphView: FeatureGraphProjection["view"]) => {
    const selection = resolveGovernedSelection(artifact, focusedNodeId);
    const snapshotManifestId = displayRevision?.snapshotManifestId;
    const graphRevisionId = displayRevision?.id;
    if (!activeWorkspace || !selection || !snapshotManifestId || !graphRevisionId || !boundedGraph) return;
    const requestContext = { ...contextRef.current };
    const requestVersion = pathRequestRef.current + 1;
    pathRequestRef.current = requestVersion;
    setTraceabilityLoading(true);
    setTraceabilityError("");
    try {
      const result = await queryFeatureGraphPath(apiBase, apiToken, activeWorkspace.id, selection.ownerFeatureId, {
        snapshotManifestId,
        fromNodeId: boundedGraph.center,
        toNodeId: targetNodeId,
        direction: "ANY",
        maxDepth: 8,
        view: graphView,
        graphRevisionId,
      });
      if (!staleWorkspaceRequestResponse(requestContext, contextRef.current, requestVersion, pathRequestRef.current)) setGraphPath(result);
    } catch (error) {
      if (!staleWorkspaceRequestResponse(requestContext, contextRef.current, requestVersion, pathRequestRef.current)) setTraceabilityError(messageOf(error, t("路径解释失败", "Path explanation failed")));
    } finally {
      if (requestVersion === pathRequestRef.current) setTraceabilityLoading(false);
    }
  }, [activeWorkspace, apiBase, apiToken, artifact, boundedGraph, displayRevision?.id, displayRevision?.snapshotManifestId, focusedNodeId, t]);

  async function createFirstWorkspace() {
    if (!workspaceName.trim()) return;
    setWorking(true);
    try {
      const created = await createWorkspace(apiBase, apiToken, { id: `WORKSPACE-${crypto.randomUUID()}`, name: workspaceName.trim(), userId: WEB_OPERATOR });
      setWorkspaces((existing) => [...existing, created]);
      setWorkspaceName("");
      selectWorkspace(created);
      notify(t("Workspace 已创建。接下来配置能力并注册授权源码。", "Workspace created. Configure capabilities and register an authorized source next."));
    } catch (error) { notify(messageOf(error, t("创建失败", "Creation failed")), "error"); }
    finally { setWorking(false); }
  }

  async function registerSource() {
    if (!activeWorkspace || !sourceRoot.trim()) return;
    setWorking(true);
    try {
      const registration = await registerServerWorkspaceSource(apiBase, apiToken, activeWorkspace.id, sourceRoot.trim());
      setSourceRegistrationId(registration.id);
      notify(t("授权源码已注册。", "Authorized source registered."));
    } catch (error) { notify(messageOf(error, t("源码注册失败", "Source registration failed")), "error"); }
    finally { setWorking(false); }
  }

  async function resolveRunProfile() {
    if (!activeWorkspace) return;
    setWorking(true);
    try {
      // Keep the job-start contract on the server-owned client. This is an explicit POST command.
      const profile = await resolveServerWorkspaceExecutionProfile(apiBase, apiToken, activeWorkspace.id);
      setProfileRevisionId(profile.id);
      notify(t("Execution Profile 已验证并固定。", "Execution Profile validated and pinned."));
    } catch (error) {
      notify(messageOf(error, t("请先在能力设置中保存有效配置。", "Save a valid capability configuration first.")), "error");
      setView("settings");
    } finally { setWorking(false); }
  }

  async function startUnderstanding() {
    if (!activeWorkspace || !sourceRegistrationId || !profileRevisionId) return;
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      const started = await startServerWorkspaceUnderstanding(apiBase, apiToken, activeWorkspace.id, {
        sourceRegistrationId,
        requestedMode: "AUTO",
        workspaceExecutionProfileRevisionId: profileRevisionId,
      });
      if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
      setJob(started);
      setJobs((existing) => [started, ...existing.filter(({ id }) => id !== started.id)]);
      setStartConfirmationOpen(false);
      notify(t("服务端任务已启动；关闭浏览器不会停止分析。", "Server job started; closing the browser will not stop analysis."));
    } catch (error) { notify(messageOf(error, t("启动失败", "Start failed")), "error"); }
    finally { setWorking(false); }
  }

  async function controlUnderstanding(action: "pause" | "resume" | "cancel") {
    if (!activeWorkspace || !job) return;
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      const next = await controlServerWorkspaceUnderstanding(apiBase, apiToken, activeWorkspace.id, job.id, action);
      if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
      setJob(next);
      setJobs((existing) => existing.map((item) => item.id === next.id ? next : item));
      notify(t("任务状态已更新。", "Job state updated."));
    } catch (error) { notify(messageOf(error, t("任务控制失败", "Job control failed")), "error"); }
    finally { setWorking(false); }
  }

  async function selectRevision(revisionId: string) {
    if (!activeWorkspace) return;
    const requestContext = { ...contextRef.current };
    const workspaceId = activeWorkspace.id;
    const requestVersion = revisionRequestRef.current + 1;
    revisionRequestRef.current = requestVersion;
    if (revisionId === "current") {
      setArtifact(current?.graphArtifact ?? null);
      setDisplayRevision(current?.revision ?? null);
      setHistorical(false);
      setFocusedNodeId(current?.graphArtifact.nodes[0]?.id ?? "");
      setTraceabilityLoading(false);
      return;
    }
    setTraceabilityLoading(true);
    try {
      const result = await getGraphRevision(apiBase, apiToken, workspaceId, revisionId);
      if (staleWorkspaceRequestResponse(requestContext, contextRef.current, requestVersion, revisionRequestRef.current)) return;
      setArtifact(result.graphArtifact);
      setDisplayRevision(result.revision);
      setHistorical(true);
      setFocusedNodeId(result.graphArtifact.nodes[0]?.id ?? "");
    } catch (error) {
      if (!staleWorkspaceRequestResponse(requestContext, contextRef.current, requestVersion, revisionRequestRef.current)) {
        notify(messageOf(error, t("历史版本加载失败", "Unable to load historical revision")), "error");
      }
    } finally {
      if (!staleWorkspaceRequestResponse(requestContext, contextRef.current, requestVersion, revisionRequestRef.current)) {
        setTraceabilityLoading(false);
      }
    }
  }

  async function reanalyzeHistoricalRevision(availability: HistoricalAvailability) {
    if (!activeWorkspace) return;
    if (!availability.recovery.executable) {
      notify(availability.recovery.message, "error");
      return;
    }
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      const started = await startHistoricalRevisionReanalysis(
        apiBase,
        apiToken,
        activeWorkspace.id,
        availability.graphRevisionId,
      );
      if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
      setJob(started);
      setJobs((existing) => [started, ...existing.filter(({ id }) => id !== started.id)]);
      setView("workspace");
      notify(t("已从原不可变 Snapshot 启动历史重分析；完成后会生成不移动当前 Head 的新历史 Revision。", "Historical reanalysis started from the original immutable Snapshot. Completion creates a new historical Revision without moving the current Head."));
    } catch (error) {
      if (!staleWorkspaceResponse(requestContext, contextRef.current)) {
        notify(messageOf(error, t("历史重分析启动失败", "Unable to start historical reanalysis")), "error");
      }
    } finally {
      setWorking(false);
    }
  }

  async function refreshReviewQueue() {
    if (!activeWorkspace) return;
    setWorking(true);
    try { setReviewItems(await getWorkspaceReviewQueue(apiBase, apiToken, activeWorkspace.id)); }
    catch (error) { notify(messageOf(error, t("审核队列加载失败", "Unable to load review queue")), "error"); }
    finally { setWorking(false); }
  }

  async function submitReviewDecision() {
    if (!activeWorkspace || selectedReviewIds.length === 0 || !reviewRationale.trim()) return;
    setWorking(true);
    try {
      await decideWorkspaceReviewBatch(apiBase, apiToken, activeWorkspace.id, { itemIds: selectedReviewIds, outcome: reviewOutcome, rationale: reviewRationale.trim() });
      setSelectedReviewIds([]);
      setReviewRationale("");
      setReviewItems(await getWorkspaceReviewQueue(apiBase, apiToken, activeWorkspace.id));
      notify(t("审核决定已记录；审核人身份来自服务端鉴权。", "Review decision recorded; reviewer identity came from server authentication."));
    } catch (error) { notify(messageOf(error, t("审核提交失败", "Unable to submit review decision")), "error"); }
    finally { setWorking(false); }
  }

  async function saveCapabilities() {
    if (!activeWorkspace) return;
    setWorking(true);
    try {
      const saved = await saveWorkspaceCapabilityConfig(apiBase, apiToken, activeWorkspace.id, {
        mainAgent: { model: mainModel, skillNames: mainSkillNames, mcpNames: mainMcpNames },
        childSlots,
        overrides: [],
        removals: [],
        dependencies: {},
        conventions: {},
        policies: { dataBoundary: "WORKSPACE", secrets: "HANDLE_ONLY" },
      });
      setCapabilityConfig(saved);
      setCapabilityHistory((existing) => [saved, ...existing.filter(({ id }) => id !== saved.id)]);
      setExecutionProfile(null);
      notify(t("Workspace 能力草稿已保存。", "Workspace capability draft saved."));
    } catch (error) { notify(messageOf(error, t("能力配置保存失败", "Unable to save capability configuration")), "error"); }
    finally { setWorking(false); }
  }

  async function resolveCapabilities() {
    if (!activeWorkspace || !capabilityConfig) return;
    setWorking(true);
    try {
      const profile = await resolveWorkspaceExecutionProfile(apiBase, apiToken, activeWorkspace.id, capabilityConfig.id);
      setExecutionProfile(profile);
      setProfileHistory((existing) => [profile, ...existing.filter(({ id }) => id !== profile.id)]);
      setProfileRevisionId(profile.id);
      notify(t("不可变 ExecutionProfileRevision 已创建。", "Immutable ExecutionProfileRevision created."));
    } catch (error) { notify(messageOf(error, t("Profile 验证失败", "Profile validation failed")), "error"); }
    finally { setWorking(false); }
  }

  const openReviewCount = reviewItems.filter(({ status }) => ["OPEN", "PENDING", "READY_FOR_REVIEW"].includes(status)).length;
  const impactActionCount = current?.graphArtifact.revalidationPlan?.actions.length ?? 0;
  const referenceOnly = current?.head.productionEligible === false
    || current?.revision.productionEligible === false
    || artifact?.productionEligible === false;
  const selectedModule = modules.find(({ key }) => key === view) ?? modules[0];
  const renderView = () => {
    if (!activeWorkspace) return <EmptyWorkspace t={t} workspaceName={workspaceName} setWorkspaceName={setWorkspaceName} working={working} onCreate={() => void createFirstWorkspace()} />;
    if (view === "overview") return <WorkspaceOverview t={t} workspace={activeWorkspace} current={current} job={job} reviewCount={openReviewCount} impactCount={impactActionCount} configValid={Boolean(profileRevisionId)} onNavigate={(next) => setView(next as View)} />;
    if (view === "workspace") return <AnalysisCommandCenter t={t} job={job} jobs={jobs} agentSlots={executionProfile?.childSlots ?? capabilityConfig?.childSlots ?? childSlots} sourceRoot={sourceRoot} setSourceRoot={setSourceRoot} sourceRegistrationId={sourceRegistrationId} profileRevisionId={profileRevisionId} working={working} onRegisterSource={() => void registerSource()} onResolveProfile={() => void resolveRunProfile()} onPrepareStart={() => setStartConfirmationOpen(true)} onControl={(action) => void controlUnderstanding(action)} onSelectJob={(selected) => { setJob(selected); setSourceRegistrationId(selected.sourceRegistrationId); setProfileRevisionId(selected.workspaceExecutionProfileRevisionId); }} />;
    if (view === "feature") return <FeatureExplorer t={t} workspaceId={activeWorkspace.id} artifact={artifact} revision={displayRevision} revisions={revisions} historical={historical} selectedId={focusedNodeId} history={featureHistory} traceability={featureTraceability} graph={boundedGraph} loading={traceabilityLoading} error={traceabilityError} working={working} onSelectRevision={(id) => void selectRevision(id)} onSelectNode={setFocusedNodeId} onOpenGraph={() => setView("graph")} onReanalyzeHistorical={(availability) => void reanalyzeHistoricalRevision(availability)} />;
    if (view === "graph") return <GraphExplorer t={t} workspaceId={activeWorkspace.id} artifact={artifact} revision={displayRevision} revisions={revisions} historical={historical} focusedId={focusedNodeId} graph={boundedGraph} path={graphPath} loading={traceabilityLoading} error={traceabilityError} working={working} onFocus={setFocusedNodeId} onSelectRevision={(id) => void selectRevision(id)} onLoadGraph={(depth, graphView) => void loadBoundedGraph(depth, graphView)} onQueryPath={(targetId, graphView) => void explainGraphPath(targetId, graphView)} onResolveEvidence={resolveEvidence} onReanalyzeHistorical={(availability) => void reanalyzeHistoricalRevision(availability)} />;
    if (view === "review") return <ReviewWorkspace t={t} items={reviewItems} selectedIds={selectedReviewIds} setSelectedIds={setSelectedReviewIds} outcome={reviewOutcome} setOutcome={setReviewOutcome} rationale={reviewRationale} setRationale={setReviewRationale} working={working} onRefresh={() => void refreshReviewQueue()} onDecide={() => void submitReviewDecision()} />;
    if (view === "impact") return <ImpactWorkspace t={t} artifact={current?.graphArtifact ?? null} impact={impact} revision={current?.revision ?? null} />;
    return <CapabilitySettings t={t} templates={templates} config={capabilityConfig} profile={executionProfile} capabilityHistory={capabilityHistory} profileHistory={profileHistory} mainModel={mainModel} setMainModel={setMainModel} mainSkillNames={mainSkillNames} setMainSkillNames={setMainSkillNames} mainMcpNames={mainMcpNames} setMainMcpNames={setMainMcpNames} childSlots={childSlots} setChildSlots={setChildSlots} working={working} onSave={() => void saveCapabilities()} onResolve={() => void resolveCapabilities()} />;
  };

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">T</span><span>Traqen</span></div>
      <div className="workspace-block"><div className="workspace-switcher-head"><p className="workspace-label">Workspace</p><div><button title={t("刷新 Workspace", "Refresh Workspaces")} onClick={() => void reconnect(false)}>↻</button><button className="workspace-add-button" title={t("新建 Workspace", "New Workspace")} onClick={() => { setActiveWorkspace(null); setView("overview"); }}>＋</button></div></div>{activeWorkspace ? <div className="workspace active-workspace"><strong>{activeWorkspace.name}</strong><small>{current ? `Published revision ${current.head.version}` : t("等待首次发布", "Awaiting first publication")}</small></div> : <div className="workspace active-workspace empty-workspace"><strong>{t("未选择 Workspace", "No Workspace selected")}</strong><small>{t("选择或创建一个项目", "Select or create a project")}</small></div>}<div className="workspace-project-list">{workspaces.map((workspace) => <div key={workspace.id} className={`workspace-project-row ${workspace.id === activeWorkspace?.id ? "active" : ""}`}><button className="workspace-project-open" onClick={() => selectWorkspace(workspace)}><strong>{workspace.name}</strong><small>{workspace.lifecycleState}</small></button></div>)}</div></div>
      {(["overview", "understanding", "governance", "configuration"] as const).map((section) => <nav key={section} className="nav" aria-label={section}><p className="workspace-label">{section === "understanding" ? t("理解", "Understanding") : section === "governance" ? t("治理", "Governance") : section === "configuration" ? t("配置", "Configuration") : t("工作台", "Workspace")}</p>{modules.filter((item) => item.section === section).map((item) => <button key={item.key} className={`nav-button ${view === item.key ? "active" : ""}`} onClick={() => setView(item.key)}><span className="nav-icon">{item.icon}</span><span>{language === "zh-CN" ? item.zh : item.en}</span>{item.key === "review" && openReviewCount > 0 && <em>{openReviewCount}</em>}{item.key === "impact" && impactActionCount > 0 && <em>{impactActionCount}</em>}</button>)}</nav>)}
      <div className="shell-status-summary" aria-label={t("全局状态摘要", "Global status summary")}><span>Published Head <b>{current ? `r${current.head.version}` : "—"}</b></span><span>Review Queue <b>{openReviewCount}</b></span><span>Impact Actions <b>{impactActionCount}</b></span></div>
      <div className="sidebar-note"><b>{t("权威边界", "Authority boundary")}</b><br />{t("实线为 Published；虚线为 Candidate。历史版本只读。", "Solid is Published; dashed is Candidate. Historical revisions are read-only.")}</div>
    </aside>
    <div className="main">
      <header className="topbar"><div className="breadcrumb"><span>{activeWorkspace?.name ?? "Traqen"}</span><i>/</i><b>{language === "zh-CN" ? selectedModule.zh : selectedModule.en}</b>{historical && <em>{t("历史只读", "Historical read-only")}</em>}</div><div className="top-actions"><span className={`mode-badge ${current && !referenceOnly ? "live" : ""}`}>{current ? referenceOnly ? `REFERENCE ONLY · r${current.head.version}` : `PUBLISHED · r${current.head.version}` : t("未发布", "Unpublished")}</span><button className={`connection-button ${health}`} title={t("部署诊断", "Deployment diagnostics")} onClick={() => setDiagnosticsOpen(true)}><i />Connection Health · {health === "healthy" ? t("正常", "Healthy") : health === "checking" ? t("检查中", "Checking") : t("不可用", "Unavailable")}</button><ThemeSwitcher ariaLabel={t("全局主题配色", "Global color theme")} /><div className="language-switch"><button className={language === "zh-CN" ? "active" : ""} onClick={() => setLanguage("zh-CN")}>中文</button><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>English</button></div><span className="identity-chip" title={t("身份由服务端认证", "Identity is server-authenticated")}>◉ {WEB_OPERATOR}</span></div></header>
      {referenceOnly && <div className="reference-banner" role="alert"><b>LOCAL REFERENCE · NON-PRODUCTION</b><span>{t("该图谱由本地合成 reference evidence 生成，不是独立生产审核结论。", "This graph was generated from local synthetic reference evidence and is not an independently reviewed production conclusion.")}</span></div>}
      {message && <div className={`toast-message ${messageKind}`} role={messageKind === "error" ? "alert" : "status"}><span>{messageKind === "error" ? "!" : "✓"}</span>{message}<button onClick={() => setMessage("")}>×</button></div>}
      {renderView()}
    </div>
    {diagnosticsOpen && <div className="drawer-backdrop" onMouseDown={() => setDiagnosticsOpen(false)}><aside className="diagnostic-drawer" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">Deployment diagnostics</p><h2>{t("部署诊断", "Deployment diagnostics")}</h2></div><button onClick={() => setDiagnosticsOpen(false)}>×</button></header><p>{t("这些信息用于部署与故障诊断，不属于产品主导航。", "These settings are deployment diagnostics and are not primary product navigation.")}</p><label>{t("API 地址", "API base")}<input value={apiBase} onChange={(event) => setApiBase(event.currentTarget.value)} /></label><label>{t("API token（仅当前页面内存）", "API token (page memory only)")}<input type="password" value={apiToken} onChange={(event) => setApiToken(event.currentTarget.value)} autoComplete="off" /></label><dl><dt>Connection Health</dt><dd>{health}</dd><dt>Workspace ID</dt><dd>{activeWorkspace?.id ?? "—"}</dd><dt>GraphRevision ID</dt><dd>{displayRevision?.id ?? "—"}</dd></dl><button className="button primary" disabled={health === "checking"} onClick={() => void reconnect(false)}>{t("重新连接并刷新", "Reconnect and refresh")}</button></aside></div>}
    {startConfirmationOpen && activeWorkspace && <div className="modal-backdrop"><section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="start-confirmation-title"><p className="eyebrow">Explicit command</p><h2 id="start-confirmation-title">{t("确认启动 Workspace 分析", "Confirm Workspace analysis start")}</h2><p>{t("以下输入将被固定到服务端任务。启动后仍可暂停、恢复或取消。", "The following inputs will be pinned to the server job. You may pause, resume, or cancel after start.")}</p><dl><dt>Workspace</dt><dd>{activeWorkspace.name}</dd><dt>SourceRegistration</dt><dd>{sourceRegistrationId}</dd><dt>Snapshot</dt><dd>{job?.snapshotManifestId ?? t("服务端启动时创建", "Created by server at start")}</dd><dt>Profile Revision</dt><dd>{profileRevisionId}</dd><dt>Agent roster</dt><dd>Main + {childSlots.length} Child slots</dd><dt>{t("数据边界", "Data boundary")}</dt><dd>WORKSPACE</dd><dt>{t("模式", "Mode")}</dt><dd>{jobs.length === 0 ? "FULL" : "AUTO (FULL / INCREMENTAL)"}</dd></dl><div className="modal-actions"><button className="button" onClick={() => setStartConfirmationOpen(false)}>{t("返回", "Back")}</button><button className="button primary" disabled={working} onClick={() => void startUnderstanding()}>{t("确认并启动", "Confirm and start")}</button></div></section></div>}
  </main>;
}

export function TraqenProduct() {
  return <ThemeProvider><ServerOwnedProduct /></ThemeProvider>;
}
