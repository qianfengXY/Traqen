"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ThemeSwitcher } from "./components/ui/theme-switcher";
import { createDefaultChildSlots } from "./capability-roster";
import { F006SettingsCenter } from "./f006-settings-center";
import {
  CapabilitySettings,
  EmptyWorkspace,
  FeatureExplorer,
  GraphExplorer,
  GlobalCapabilityTemplateLibrary,
  GlobalModelLibrary,
  ImpactWorkspace,
  ReviewWorkspace,
  WorkspaceOverview,
  AnalysisCommandCenter,
  type GraphArtifact,
  type T,
} from "./product-surfaces";
import {
  createGlobalModel,
  createGlobalModelReplacementPlan,
  applyGlobalModelReplacementPlan,
  deleteProjectCapability,
  decideWorkspaceReviewBatch,
  getConnectionHealth,
  getEffectiveCapabilities,
  getGlobalModelUsage,
  getWorkspaceCapabilityDraft,
  listWorkspaceExecutionProfiles,
  loadWorkspaceCapabilitySettings,
  getWorkspaceReviewQueue,
  listGlobalModels,
  listGlobalCapabilityTemplates,
  listGlobalAccounts,
  listGlobalCapabilities,
  createGlobalCliModel,
  getGlobalCapabilityImpact,
  recheckGlobalAccount,
  saveGlobalAccount,
  saveGlobalCapability,
  setGlobalCapabilityLifecycle,
  retireGlobalModel,
  updateGlobalModel,
  verifyGlobalModel,
  activateWorkspaceCapabilityDraft,
  ProductFoundationApiError,
  saveWorkspaceCapabilityDraft,
  saveProjectCapability,
  saveGlobalCapabilityTemplate,
  type CapabilityKey,
  type ChildCapabilityRole,
  type EffectiveCapabilityCatalog,
  type ExecutionProfile,
  type ReviewQueueItem,
  type GlobalModelProfile,
  type GlobalCapabilityTemplate,
  type GlobalAccount,
  type GlobalCapability,
  type GlobalCapabilityImpact,
  type GlobalModelUsage,
  type WorkspaceCapabilityDraft,
  type WorkspaceCapabilityDraftSaveInput,
} from "./product-foundation-client";
import { hasUnsavedCapabilityDraftChanges, type SecurityBoundaryDraft } from "./capability-settings-state";
import {
  controlServerWorkspaceUnderstanding,
  getServerWorkspaceUnderstanding,
  listServerWorkspaceUnderstandingJobs,
  registerServerWorkspaceSource,
  ServerUnderstandingApiError,
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

type View = "overview" | "workspace" | "feature" | "graph" | "review" | "impact" | "models" | "templates" | "settings";
type SettingsScope = "chooser" | "global" | "workspace";
type Language = "zh-CN" | "en";
type Health = "checking" | "healthy" | "unavailable";
type CapabilityDraftConflict = {
  head: "WORKSPACE_CAPABILITY_DRAFT";
  local: WorkspaceCapabilityDraftSaveInput;
  current: WorkspaceCapabilityDraft | null;
  currentCatalog: EffectiveCapabilityCatalog;
};
type StartConfirmation = {
  workspaceId: string;
  sourceRegistrationId: string;
  requestedMode: "AUTO" | "FULL";
  profile: ExecutionProfile;
};

const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_TRAQEN_API_BASE ?? "http://127.0.0.1:3100";
const DEFAULT_SOURCE_ROOT = process.env.NEXT_PUBLIC_TRAQEN_DEV_SOURCE_ROOT ?? "";
const WEB_OPERATOR = "WEB-OPERATOR";
const DEFAULT_SECURITY_BOUNDARY: SecurityBoundaryDraft = {
  dataBoundary: "WORKSPACE",
  budgetLimit: "100",
  mcpPermissionMode: "ALLOW_SELECTED_MCP",
  grantedHandleIds: [],
  telemetryPolicy: "METADATA_ONLY",
};

const modules: Array<{ key: View; icon: string; section: "overview" | "understanding" | "governance" | "configuration"; zh: string; en: string }> = [
  { key: "overview", icon: "⌂", section: "overview", zh: "工作台概览", en: "Workspace overview" },
  { key: "workspace", icon: "◎", section: "understanding", zh: "Workspace 分析", en: "Workspace analysis" },
  { key: "feature", icon: "◇", section: "understanding", zh: "功能 / API", en: "Feature / API" },
  { key: "graph", icon: "⌘", section: "understanding", zh: "理解图谱", en: "Understanding graph" },
  { key: "review", icon: "✓", section: "governance", zh: "声明审核", en: "Claim review" },
  { key: "impact", icon: "↗", section: "governance", zh: "变更影响", en: "Change impact" },
  { key: "settings", icon: "⚙", section: "configuration", zh: "设置中心", en: "Settings center" },
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
  const [globalModels, setGlobalModels] = useState<GlobalModelProfile[]>([]);
  const [globalCapabilityTemplates, setGlobalCapabilityTemplates] = useState<GlobalCapabilityTemplate[]>([]);
  const [globalAccounts, setGlobalAccounts] = useState<GlobalAccount[]>([]);
  const [globalCapabilities, setGlobalCapabilities] = useState<GlobalCapability[]>([]);
  const [settingsScope, setSettingsScope] = useState<SettingsScope>("chooser");
  const [effectiveCatalog, setEffectiveCatalog] = useState<EffectiveCapabilityCatalog>({ entries: [], effective: [], summary: { globalAvailableCount: 0, workspaceDisabledCount: 0, workspaceLocalCount: 0, globalUnavailableCount: 0, effectiveCount: 0 } });
  const [capabilityDraft, setCapabilityDraft] = useState<WorkspaceCapabilityDraft | null>(null);
  const [capabilityDraftConflict, setCapabilityDraftConflict] = useState<CapabilityDraftConflict | null>(null);
  const [capabilitySettingsReady, setCapabilitySettingsReady] = useState(false);
  const [importedKeys, setImportedKeys] = useState<CapabilityKey[]>([]);
  const [disabledKeys, setDisabledKeys] = useState<CapabilityKey[]>([]);
  const [dependencyNotes, setDependencyNotes] = useState("");
  const [conventionNotes, setConventionNotes] = useState("");
  const [securityNotes, setSecurityNotes] = useState("");
  const [securityBoundary, setSecurityBoundary] = useState<SecurityBoundaryDraft>(DEFAULT_SECURITY_BOUNDARY);
  const [executionProfile, setExecutionProfile] = useState<ExecutionProfile | null>(null);
  const [profileHistory, setProfileHistory] = useState<ExecutionProfile[]>([]);
  const [mainModel, setMainModel] = useState("");
  const [mainRolePolicy, setMainRolePolicy] = useState("PRIMARY_ANALYST");
  const [mainSkillNames, setMainSkillNames] = useState<string[]>([]);
  const [mainMcpNames, setMainMcpNames] = useState<string[]>([]);
  const [childSlots, setChildSlots] = useState<ChildCapabilityRole[]>(() => createDefaultChildSlots());
  const [startConfirmation, setStartConfirmation] = useState<StartConfirmation | null>(null);
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
    setCapabilitySettingsReady(false);
    const [graphResult, revisionResult, jobResult, reviewResult, capabilitySettingsResult] = await Promise.allSettled([
      getCurrentUnderstandingGraph(apiBase, apiToken, workspace.id),
      listGraphRevisions(apiBase, apiToken, workspace.id),
      listServerWorkspaceUnderstandingJobs(apiBase, apiToken, workspace.id),
      getWorkspaceReviewQueue(apiBase, apiToken, workspace.id),
      loadWorkspaceCapabilitySettings(apiBase, apiToken, workspace.id),
    ]);
    if (staleWorkspaceRequestResponse(requestContext, contextRef.current, revisionRequestVersion, revisionRequestRef.current)) return;
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
        setSourceRegistrationId(recoverable.sourceRegistrationId);
      }
    }
    if (reviewResult.status === "fulfilled") setReviewItems(reviewResult.value);
    if (capabilitySettingsResult.status === "fulfilled") {
      const { profiles, draft, catalog } = capabilitySettingsResult.value;
      setProfileHistory(profiles);
      const latestProfile = profiles[0] ?? null;
      setExecutionProfile(latestProfile);
      setProfileRevisionId(latestProfile?.id ?? "");
      setCapabilityDraft(draft);
      setImportedKeys(draft?.importedKeys ?? []);
      setDisabledKeys(draft?.disabledKeys ?? []);
      if (draft) {
        const main = draft.mainAgentSlot;
        setMainModel(main.modelProfileId);
        setMainRolePolicy(main.rolePolicy || "PRIMARY_ANALYST");
        setMainSkillNames(main.skillGrants.map(({ normalizedName }) => normalizedName));
        setMainMcpNames(main.mcpGrants.map(({ normalizedName }) => normalizedName));
        setChildSlots(draft.childAgentSlots.map((slot) => ({ id: slot.id, model: slot.modelProfileId, skillNames: slot.skillGrants.map(({ normalizedName }) => normalizedName), mcpNames: slot.mcpGrants.map(({ normalizedName }) => normalizedName), rolePolicy: slot.rolePolicy || "SPECIALIST", independenceGroup: slot.independenceGroup })));
        setDependencyNotes(String(draft.dependencies?.notes ?? ""));
        setConventionNotes(String(draft.conventions?.notes ?? ""));
        setSecurityNotes(String(draft.securityPolicy?.notes ?? ""));
        setSecurityBoundary({
          dataBoundary: draft.securityPolicy?.dataBoundary === "REPOSITORY" || draft.securityPolicy?.dataBoundary === "EXTERNAL" ? draft.securityPolicy.dataBoundary : "WORKSPACE",
          budgetLimit: String(draft.securityPolicy?.budgetLimit ?? "100"),
          mcpPermissionMode: draft.securityPolicy?.mcpPermissionMode === "DENY_MCP" ? "DENY_MCP" : "ALLOW_SELECTED_MCP",
          grantedHandleIds: Array.isArray(draft.securityPolicy?.grantedHandleIds) ? draft.securityPolicy.grantedHandleIds.filter((value): value is string => typeof value === "string") : [],
          telemetryPolicy: draft.securityPolicy?.telemetryPolicy === "DISABLED" ? "DISABLED" : "METADATA_ONLY",
        });
      } else {
        setMainModel("");
        setMainRolePolicy("PRIMARY_ANALYST");
        setMainSkillNames([]);
        setMainMcpNames([]);
        setChildSlots(createDefaultChildSlots());
        setDependencyNotes("");
        setConventionNotes("");
        setSecurityNotes("");
        setSecurityBoundary(DEFAULT_SECURITY_BOUNDARY);
      }
      setEffectiveCatalog(catalog);
      setCapabilitySettingsReady(true);
    }
    const failures = [graphResult, revisionResult, jobResult, reviewResult, capabilitySettingsResult].filter((result) => result.status === "rejected");
    if (failures.length > 0) notify(t("部分 Workspace 数据暂时不可用，请检查连接诊断。", "Some Workspace data is unavailable; inspect connection diagnostics."), "error");
  }, [apiBase, apiToken, notify, t]);

  const selectWorkspace = useCallback((workspace: Workspace) => {
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
    setCapabilityDraft(null);
    setCapabilityDraftConflict(null);
    setStartConfirmation(null);
    setCapabilitySettingsReady(false);
    setImportedKeys([]);
    setDisabledKeys([]);
    setDependencyNotes("");
    setConventionNotes("");
    setSecurityNotes("");
    setSecurityBoundary(DEFAULT_SECURITY_BOUNDARY);
    setExecutionProfile(null);
    setProfileHistory([]);
    setEffectiveCatalog({ entries: [], effective: [], summary: { globalAvailableCount: 0, workspaceDisabledCount: 0, workspaceLocalCount: 0, globalUnavailableCount: 0, effectiveCount: 0 } });
    setMainModel("");
    setMainRolePolicy("PRIMARY_ANALYST");
    setMainSkillNames([]);
    setMainMcpNames([]);
    setChildSlots(createDefaultChildSlots());
    setSourceRoot(DEFAULT_SOURCE_ROOT);
    setSourceRegistrationId("");
    setProfileRevisionId("");
    setMessage("");
    void refreshWorkspaceReads(workspace, nextContext);
  }, [refreshWorkspaceReads]);

  const reconnect = useCallback(async (preferRemembered = false) => {
    revisionRequestRef.current += 1;
    setTraceabilityLoading(false);
    setHealth("checking");
    try {
      const [available, , availableModels, availableTemplates, availableAccounts, availableCapabilities] = await Promise.all([
        listWorkspaces(apiBase, apiToken, WEB_OPERATOR),
        getConnectionHealth(apiBase),
        listGlobalModels(apiBase, apiToken),
        listGlobalCapabilityTemplates(apiBase, apiToken),
        listGlobalAccounts(apiBase, apiToken),
        listGlobalCapabilities(apiBase, apiToken),
      ]);
      const visible = available.filter(({ hidden, lifecycleState }) => !hidden && lifecycleState === "ACTIVE");
      setWorkspaces(visible);
      setHealth("healthy");
      setGlobalModels(availableModels);
      setGlobalCapabilityTemplates(availableTemplates);
      setGlobalAccounts(availableAccounts);
      setGlobalCapabilities(availableCapabilities);
      const remembered = preferRemembered ? window.localStorage.getItem("traqen.activeWorkspaceId") : activeWorkspace?.id;
      const selection = visible.find(({ id }) => id === remembered) ?? (preferRemembered ? visible[0] : null);
      if (selection && selection.id !== activeWorkspace?.id) selectWorkspace(selection);
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

  function openStartConfirmation() {
    if (!activeWorkspace || !sourceRegistrationId || !executionProfile) return;
    setStartConfirmation({
      workspaceId: activeWorkspace.id,
      sourceRegistrationId,
      requestedMode: jobs.length === 0 ? "FULL" : "AUTO",
      profile: structuredClone(executionProfile),
    });
  }

  async function startUnderstanding(confirmation: StartConfirmation) {
    if (!activeWorkspace || activeWorkspace.id !== confirmation.workspaceId) return;
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      const started = await startServerWorkspaceUnderstanding(apiBase, apiToken, confirmation.workspaceId, {
        sourceRegistrationId: confirmation.sourceRegistrationId,
        requestedMode: confirmation.requestedMode,
        expectedWorkspaceExecutionProfileRevisionId: confirmation.profile.id,
      });
      if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
      setJob(started);
      setJobs((existing) => [started, ...existing.filter(({ id }) => id !== started.id)]);
      setStartConfirmation(null);
      notify(t("服务端任务已启动；关闭浏览器不会停止分析。", "Server job started; closing the browser will not stop analysis."));
    } catch (error) {
      if (
        error instanceof ServerUnderstandingApiError
        && error.status === 409
        && error.code === "PERSISTENCE_CONFLICT"
        && error.details?.head === "WORKSPACE_EXECUTION_PROFILE"
        && !staleWorkspaceResponse(requestContext, contextRef.current)
      ) {
        await refreshWorkspaceReads(activeWorkspace, requestContext);
        if (!staleWorkspaceResponse(requestContext, contextRef.current)) {
          const currentProfile = (await listWorkspaceExecutionProfiles(apiBase, apiToken, activeWorkspace.id).catch(() => []))[0] ?? null;
          if (!currentProfile) {
            setStartConfirmation((existing) => existing?.workspaceId === activeWorkspace.id ? null : existing);
            notify(
              t("Active Profile 已不可用；确认已关闭，请刷新后重新启动。", "The Active Profile is no longer available. The confirmation was closed; refresh and start again."),
              "error",
            );
            return;
          }
          setStartConfirmation((existing) => existing && existing.workspaceId === activeWorkspace.id
            ? { ...existing, profile: structuredClone(currentProfile) }
            : existing);
          notify(
            t("Active Profile 已变更；确认信息已刷新，请检查后重试。", "The Active Profile changed. The confirmation was refreshed; review it and try again."),
            "error",
          );
        }
      } else if (!staleWorkspaceResponse(requestContext, contextRef.current)) {
        notify(messageOf(error, t("启动失败", "Start failed")), "error");
      }
    }
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

  function currentCapabilityDraftInput(expectedVersion: number): WorkspaceCapabilityDraftSaveInput {
    return {
      expectedVersion,
      mainAgentSlot: { id: "MAIN", role: "MAIN", displayName: "Main Agent", modelProfileId: mainModel, skillGrants: mainSkillNames.map((normalizedName) => ({ kind: "SKILL", normalizedName })), mcpGrants: mainMcpNames.map((normalizedName) => ({ kind: "MCP", normalizedName })), rolePolicy: mainRolePolicy, independenceGroup: "MAIN", enabled: true },
      childAgentSlots: childSlots.map((slot, index) => ({ id: slot.id, role: "CHILD", displayName: `Child Agent ${index + 1}`, modelProfileId: slot.model, skillGrants: slot.skillNames.map((normalizedName) => ({ kind: "SKILL", normalizedName })), mcpGrants: slot.mcpNames.map((normalizedName) => ({ kind: "MCP", normalizedName })), rolePolicy: slot.rolePolicy, independenceGroup: slot.independenceGroup, enabled: true })),
      projectCapabilityRevisionIds: effectiveCatalog.entries.filter(({ source }) => source === "WORKSPACE" || source === "PROJECT").map(({ id }) => id),
      // Global active capabilities are automatically available. This legacy field
      // stays in the payload for backwards-compatible storage reads only.
      importedKeys: [],
      disabledKeys,
      dependencies: { notes: dependencyNotes },
      conventions: { notes: conventionNotes },
      securityPolicy: { notes: securityNotes, dataBoundary: securityBoundary.dataBoundary, budgetLimit: securityBoundary.budgetLimit, mcpPermissionMode: securityBoundary.mcpPermissionMode, grantedHandleIds: securityBoundary.grantedHandleIds, telemetryPolicy: securityBoundary.telemetryPolicy },
    };
  }

  async function saveCapabilityDraft(input: WorkspaceCapabilityDraftSaveInput, { quiet = false } = {}) {
    if (!activeWorkspace || !capabilitySettingsReady) return;
    const workspace = activeWorkspace;
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      const saved = await saveWorkspaceCapabilityDraft(apiBase, apiToken, workspace.id, input);
      const catalog = await getEffectiveCapabilities(apiBase, apiToken, workspace.id);
      if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
      setCapabilityDraft(saved);
      setCapabilityDraftConflict(null);
      setEffectiveCatalog(catalog);
      if (!quiet) notify(t("Workspace 能力草稿已保存。", "Workspace capability draft saved."));
    } catch (error) {
      if (
        error instanceof ProductFoundationApiError
        && error.status === 409
        && error.code === "PERSISTENCE_CONFLICT"
        && error.details?.head === "WORKSPACE_CAPABILITY_DRAFT"
      ) {
        try {
          const [current, currentCatalog] = await Promise.all([
            getWorkspaceCapabilityDraft(apiBase, apiToken, workspace.id),
            getEffectiveCapabilities(apiBase, apiToken, workspace.id),
          ]);
          if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
          setCapabilityDraftConflict({
            head: "WORKSPACE_CAPABILITY_DRAFT",
            local: structuredClone(input),
            current: current ? structuredClone(current) : null,
            currentCatalog: structuredClone(currentCatalog),
          });
          notify(t("Workspace Draft 已更新；本地编辑已保留，请比较后显式选择。", "The Workspace Draft changed. Your local edits are retained; compare the two versions and choose explicitly."), "error");
          return;
        } catch (recoveryError) {
          notify(messageOf(recoveryError, t("无法读取新的 Workspace Draft", "Unable to read the newer Workspace Draft")), "error");
          return;
        }
      }
      notify(messageOf(error, t("能力配置保存失败", "Unable to save capability configuration")), "error");
    }
    finally { setWorking(false); }
  }

  async function saveCapabilities() {
    await saveCapabilityDraft(currentCapabilityDraftInput(capabilityDraft?.revision ?? 0));
  }

  function autoSaveCapabilities() {
    void saveCapabilityDraft(currentCapabilityDraftInput(capabilityDraft?.revision ?? 0), { quiet: true });
  }

  async function retryCapabilityDraft() {
    const conflict = capabilityDraftConflict;
    if (!conflict?.current) {
      notify(t("新的 Workspace Draft 已不可用；请刷新后重试。", "The newer Workspace Draft is unavailable; refresh and try again."), "error");
      return;
    }
    await saveCapabilityDraft({
      ...structuredClone(conflict.local),
      expectedVersion: conflict.current.revision,
    });
  }

  function useCurrentCapabilityDraft() {
    const conflict = capabilityDraftConflict;
    const current = conflict?.current;
    if (!current) {
      notify(t("新的 Workspace Draft 已不可用；请刷新后重试。", "The newer Workspace Draft is unavailable; refresh and try again."), "error");
      return;
    }
    const main = current.mainAgentSlot;
    setCapabilityDraft(current);
    setImportedKeys(current.importedKeys);
    setDisabledKeys(current.disabledKeys);
    setMainModel(main.modelProfileId);
    setMainRolePolicy(main.rolePolicy || "PRIMARY_ANALYST");
    setMainSkillNames(main.skillGrants.map(({ normalizedName }) => normalizedName));
    setMainMcpNames(main.mcpGrants.map(({ normalizedName }) => normalizedName));
    setChildSlots(current.childAgentSlots.map((slot) => ({ id: slot.id, model: slot.modelProfileId, skillNames: slot.skillGrants.map(({ normalizedName }) => normalizedName), mcpNames: slot.mcpGrants.map(({ normalizedName }) => normalizedName), rolePolicy: slot.rolePolicy || "SPECIALIST", independenceGroup: slot.independenceGroup })));
    setDependencyNotes(String(current.dependencies?.notes ?? ""));
    setConventionNotes(String(current.conventions?.notes ?? ""));
    setSecurityNotes(String(current.securityPolicy?.notes ?? ""));
    setSecurityBoundary({
      dataBoundary: current.securityPolicy?.dataBoundary === "REPOSITORY" || current.securityPolicy?.dataBoundary === "EXTERNAL" ? current.securityPolicy.dataBoundary : "WORKSPACE",
      budgetLimit: String(current.securityPolicy?.budgetLimit ?? "100"),
      mcpPermissionMode: current.securityPolicy?.mcpPermissionMode === "DENY_MCP" ? "DENY_MCP" : "ALLOW_SELECTED_MCP",
      grantedHandleIds: Array.isArray(current.securityPolicy?.grantedHandleIds) ? current.securityPolicy.grantedHandleIds.filter((value): value is string => typeof value === "string") : [],
      telemetryPolicy: current.securityPolicy?.telemetryPolicy === "DISABLED" ? "DISABLED" : "METADATA_ONLY",
    });
    setEffectiveCatalog(conflict.currentCatalog);
    setCapabilityDraftConflict(null);
    notify(t("已采用新的 Workspace Draft。", "The newer Workspace Draft is now in the editor."));
  }

  async function upsertProjectCapability(input: { kind: "SKILL" | "MCP"; normalizedName: string; expectedVersion: number; manifest: Record<string, unknown> }) {
    if (!activeWorkspace || !capabilitySettingsReady) return;
    const workspace = activeWorkspace;
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      await saveProjectCapability(apiBase, apiToken, workspace.id, input);
      const catalog = await getEffectiveCapabilities(apiBase, apiToken, workspace.id);
      if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
      setEffectiveCatalog(catalog);
      notify(t("项目能力 Revision 已保存。", "Project capability revision saved."));
    } catch (error) { notify(messageOf(error, t("项目能力保存失败", "Unable to save project capability")), "error"); }
    finally { setWorking(false); }
  }

  async function removeProjectCapability(kind: "SKILL" | "MCP", normalizedName: string, expectedVersion: number) {
    if (!activeWorkspace || !capabilitySettingsReady) return;
    const workspace = activeWorkspace;
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      await deleteProjectCapability(apiBase, apiToken, workspace.id, kind, normalizedName, expectedVersion);
      const catalog = await getEffectiveCapabilities(apiBase, apiToken, workspace.id);
      if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
      setEffectiveCatalog(catalog);
      notify(t("项目能力已删除；typed key 的禁用状态保持不变。", "Project capability removed; the typed key's disable state is preserved."));
    } catch (error) { notify(messageOf(error, t("项目能力删除失败", "Unable to delete project capability")), "error"); }
    finally { setWorking(false); }
  }

  async function refreshGlobalSettingsAssets() {
    const [accounts, models, capabilities] = await Promise.all([
      listGlobalAccounts(apiBase, apiToken),
      listGlobalModels(apiBase, apiToken),
      listGlobalCapabilities(apiBase, apiToken),
    ]);
    setGlobalAccounts(accounts);
    setGlobalModels(models);
    setGlobalCapabilities(capabilities);
  }

  async function saveGlobalAccountFromSettings(input: Record<string, unknown>) {
    setWorking(true);
    try {
      await saveGlobalAccount(apiBase, apiToken, input);
      await refreshGlobalSettingsAssets();
      notify(t("全局账号已保存。OAuth 仍由对应 CLI 自行登录。", "Global account saved. OAuth remains owned by its CLI."));
      return true;
    } catch (error) {
      notify(messageOf(error, t("账号保存失败", "Unable to save global account")), "error");
      return false;
    } finally { setWorking(false); }
  }

  async function recheckGlobalAccountFromSettings(accountId: string) {
    setWorking(true);
    try {
      const rechecked = await recheckGlobalAccount(apiBase, apiToken, accountId);
      setGlobalAccounts((accounts) => accounts.map((account) => account.accountId === accountId ? rechecked : account));
      notify(rechecked.instruction ?? t("账号状态已重新检查。", "Account status rechecked."));
    } catch (error) { notify(messageOf(error, t("账号重新检查失败", "Unable to recheck account")), "error"); }
    finally { setWorking(false); }
  }

  async function saveGlobalCliModelFromSettings(input: Record<string, unknown>) {
    setWorking(true);
    try {
      await createGlobalCliModel(apiBase, apiToken, input);
      await refreshGlobalSettingsAssets();
      notify(t("CLI 模型已保存；验证成功后会进入 Agent 选择器。", "CLI model saved. It enters Agent selectors after verification."));
      return true;
    } catch (error) {
      notify(messageOf(error, t("CLI 模型保存失败", "Unable to save CLI model")), "error");
      return false;
    } finally { setWorking(false); }
  }

  async function saveGlobalCapabilityFromSettings(input: Record<string, unknown>) {
    setWorking(true);
    try {
      await saveGlobalCapability(apiBase, apiToken, input);
      await refreshGlobalSettingsAssets();
      if (activeWorkspace) await refreshWorkspaceReads(activeWorkspace, { ...contextRef.current });
      notify(t("全局能力已保存；它进入项目可选目录，但不会自动授予 Agent。", "Global capability saved. It enters Workspace availability without being auto-granted."));
      return true;
    } catch (error) {
      notify(messageOf(error, t("全局能力保存失败", "Unable to save global capability")), "error");
      return false;
    } finally { setWorking(false); }
  }

  async function previewGlobalCapabilityImpactFromSettings(kind: "SKILL" | "MCP", normalizedName: string): Promise<GlobalCapabilityImpact | null> {
    try {
      return await getGlobalCapabilityImpact(apiBase, apiToken, kind, normalizedName);
    } catch (error) {
      notify(messageOf(error, t("无法读取全局能力影响", "Unable to read global capability impact")), "error");
      return null;
    }
  }

  async function setGlobalCapabilityLifecycleFromSettings(
    kind: "SKILL" | "MCP",
    normalizedName: string,
    input: { expectedVersion: number; lifecycle: "ACTIVE" | "INACTIVE" | "DELETED"; confirmation?: string },
  ) {
    setWorking(true);
    try {
      await setGlobalCapabilityLifecycle(apiBase, apiToken, kind, normalizedName, input);
      await refreshGlobalSettingsAssets();
      if (activeWorkspace) await refreshWorkspaceReads(activeWorkspace, { ...contextRef.current });
      notify(input.lifecycle === "ACTIVE"
        ? t("全局能力已重新启用。", "Global capability reactivated.")
        : t("全局能力状态已更新；历史运行仍保持自己的快照。", "Global capability updated; historical runs keep their snapshots."));
      return true;
    } catch (error) {
      notify(messageOf(error, t("全局能力状态更新失败", "Unable to update global capability")), "error");
      return false;
    } finally { setWorking(false); }
  }

  async function saveGlobalTemplate(input: {
    kind: "SKILL" | "MCP";
    logicalName: string;
    revision: number;
    manifest: Record<string, unknown>;
    credentialHandleIds: string[];
  }) {
    setWorking(true);
    try {
      await saveGlobalCapabilityTemplate(apiBase, apiToken, input);
      setGlobalCapabilityTemplates(await listGlobalCapabilityTemplates(apiBase, apiToken));
      notify(t("全局能力模板 Revision 已保存；请在 Workspace Draft 中显式导入。", "Global capability template revision saved; explicitly import it from a Workspace Draft."));
    } catch (error) { notify(messageOf(error, t("模板保存失败", "Unable to save capability template")), "error"); }
    finally { setWorking(false); }
  }

  async function saveGlobalModel(input: Record<string, unknown>) {
    setWorking(true);
    try {
      const profileId = String(input.profileId ?? "");
      if (globalModels.some((profile) => profile.profileId === profileId)) await updateGlobalModel(apiBase, apiToken, profileId, input);
      else await createGlobalModel(apiBase, apiToken, input);
      setGlobalModels(await listGlobalModels(apiBase, apiToken));
      notify(t("模型 Profile 已保存；验证成功后才会进入 Agent selector。", "Model profile saved. It enters Agent selectors only after verification."));
      return true;
    } catch (error) { notify(messageOf(error, t("模型保存失败", "Unable to save model profile")), "error"); return false; }
    finally { setWorking(false); }
  }

  async function verifyModel(profileId: string) {
    setWorking(true);
    try {
      await verifyGlobalModel(apiBase, apiToken, profileId);
      setGlobalModels(await listGlobalModels(apiBase, apiToken));
      notify(t("模型连接已验证。", "Model connection verified."));
    } catch (error) { notify(messageOf(error, t("模型验证失败", "Model verification failed")), "error"); }
    finally { setWorking(false); }
  }

  async function inspectModelUsage(profileId: string): Promise<GlobalModelUsage | null> {
    setWorking(true);
    try {
      const usage = await getGlobalModelUsage(apiBase, apiToken, profileId);
      const workspaces = [...new Set(usage.references.map(({ workspaceName }) => workspaceName))];
      notify(usage.usageCount
        ? t(`该模型有 ${usage.usageCount} 个引用：${workspaces.join("、")}`, `${usage.usageCount} references across: ${workspaces.join(", ")}`)
        : t("该模型没有 Workspace 或运行引用。", "This model has no Workspace or run references."));
      return usage;
    } catch (error) { notify(messageOf(error, t("无法读取模型影响", "Unable to load model impact")), "error"); return null; }
    finally { setWorking(false); }
  }

  async function retireModel(profileId: string) {
    setWorking(true);
    try {
      await retireGlobalModel(apiBase, apiToken, profileId);
      setGlobalModels(await listGlobalModels(apiBase, apiToken));
      notify(t("模型进入 RETIRING；已固定的历史运行仍可解析其 Revision。", "Model is RETIRING; pinned historical runs can still resolve its revision."));
    } catch (error) { notify(messageOf(error, t("模型仍被当前 Workspace 使用，无法退休", "Model is still used by current Workspaces and cannot retire")), "error"); }
    finally { setWorking(false); }
  }

  async function replaceModel(profileId: string, replacementProfileId: string) {
    const workspace = activeWorkspace;
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      const plan = await createGlobalModelReplacementPlan(apiBase, apiToken, profileId, replacementProfileId);
      await applyGlobalModelReplacementPlan(apiBase, apiToken, profileId, plan.id, plan.version);
      setGlobalModels(await listGlobalModels(apiBase, apiToken));
      if (workspace && !staleWorkspaceResponse(requestContext, contextRef.current)) await refreshWorkspaceReads(workspace, requestContext);
      notify(t("跨 Workspace 模型替换已原子应用；旧模型进入 RETIRING。", "The cross-Workspace replacement applied atomically; the old model is RETIRING."));
      return true;
    } catch (error) {
      notify(messageOf(error, t("模型替换失败；未应用部分 Workspace 变更", "Model replacement failed; no partial Workspace changes were applied")), "error");
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function resolveCapabilities(input: WorkspaceCapabilityDraftSaveInput) {
    if (!activeWorkspace || !capabilityDraft || !capabilitySettingsReady) return;
    if (hasUnsavedCapabilityDraftChanges(capabilityDraft, input)) {
      notify(t("当前 Workspace Draft 有未保存更改。请先保存完整 Effective Diff，再验证并激活。", "The current Workspace Draft has unsaved changes. Save the complete Effective Diff before validating and activating."), "error");
      return;
    }
    const workspace = activeWorkspace;
    const requestContext = { ...contextRef.current };
    setWorking(true);
    try {
      const profile = await activateWorkspaceCapabilityDraft(apiBase, apiToken, workspace.id);
      if (staleWorkspaceResponse(requestContext, contextRef.current)) return;
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
    if (view === "settings") return <F006SettingsCenter
      t={t}
      scope={settingsScope}
      setScope={setSettingsScope}
      workspace={activeWorkspace}
      accounts={globalAccounts}
      models={globalModels}
      capabilities={globalCapabilities}
      catalog={effectiveCatalog}
      draft={capabilityDraft}
      draftConflict={Boolean(capabilityDraftConflict)}
      profile={executionProfile}
      mainModel={mainModel}
      setMainModel={setMainModel}
      mainSkillNames={mainSkillNames}
      setMainSkillNames={setMainSkillNames}
      mainMcpNames={mainMcpNames}
      setMainMcpNames={setMainMcpNames}
      childSlots={childSlots}
      setChildSlots={setChildSlots}
      disabledKeys={disabledKeys}
      setDisabledKeys={setDisabledKeys}
      working={working}
      recoveryReady={capabilitySettingsReady}
      onAutoSave={autoSaveCapabilities}
      onApply={() => void resolveCapabilities(currentCapabilityDraftInput(capabilityDraft?.revision ?? 0))}
      onRetryDraftConflict={() => void retryCapabilityDraft()}
      onUseCurrentDraft={useCurrentCapabilityDraft}
      onSaveLocalCapability={(input) => void upsertProjectCapability(input)}
      onDeleteLocalCapability={(kind, name, version) => void removeProjectCapability(kind, name, version)}
      onSaveAccount={saveGlobalAccountFromSettings}
      onRecheckAccount={(accountId) => void recheckGlobalAccountFromSettings(accountId)}
      onSaveCliModel={saveGlobalCliModelFromSettings}
      onVerifyModel={(profileId) => void verifyModel(profileId)}
      onPreviewCapabilityImpact={previewGlobalCapabilityImpactFromSettings}
      onSetCapabilityLifecycle={setGlobalCapabilityLifecycleFromSettings}
      onSaveGlobalCapability={saveGlobalCapabilityFromSettings}
    />;
    if (view === "models") return <GlobalModelLibrary t={t} models={globalModels} working={working} onCreate={saveGlobalModel} onVerify={(profileId) => void verifyModel(profileId)} onInspectUsage={inspectModelUsage} onReplace={replaceModel} onRetire={(profileId) => void retireModel(profileId)} />;
    if (view === "templates") return <GlobalCapabilityTemplateLibrary t={t} templates={globalCapabilityTemplates} working={working} onSave={(input) => void saveGlobalTemplate(input)} />;
    if (!activeWorkspace) {
      return <EmptyWorkspace t={t} workspaceName={workspaceName} setWorkspaceName={setWorkspaceName} working={working} onCreate={() => void createFirstWorkspace()} />;
    }
    const workspace = activeWorkspace;
    if (view === "overview") return <WorkspaceOverview t={t} workspace={workspace} current={current} job={job} reviewCount={openReviewCount} impactCount={impactActionCount} configValid={Boolean(profileRevisionId)} onNavigate={(next) => setView(next as View)} />;
    if (view === "workspace") return <AnalysisCommandCenter t={t} job={job} jobs={jobs} agentSlots={executionProfile?.childSlots ?? childSlots} sourceRoot={sourceRoot} setSourceRoot={setSourceRoot} sourceRegistrationId={sourceRegistrationId} profileRevisionId={profileRevisionId} working={working} onRegisterSource={() => void registerSource()} onOpenCapabilitySettings={() => { setSettingsScope("workspace"); setView("settings"); }} onPrepareStart={openStartConfirmation} onControl={(action) => void controlUnderstanding(action)} onSelectJob={(selected) => { setJob(selected); setSourceRegistrationId(selected.sourceRegistrationId); }} />;
    if (view === "feature") return <FeatureExplorer t={t} workspaceId={workspace.id} artifact={artifact} revision={displayRevision} revisions={revisions} historical={historical} selectedId={focusedNodeId} history={featureHistory} traceability={featureTraceability} graph={boundedGraph} loading={traceabilityLoading} error={traceabilityError} working={working} onSelectRevision={(id) => void selectRevision(id)} onSelectNode={setFocusedNodeId} onOpenGraph={() => setView("graph")} onReanalyzeHistorical={(availability) => void reanalyzeHistoricalRevision(availability)} />;
    if (view === "graph") return <GraphExplorer t={t} workspaceId={workspace.id} artifact={artifact} revision={displayRevision} revisions={revisions} historical={historical} focusedId={focusedNodeId} graph={boundedGraph} path={graphPath} loading={traceabilityLoading} error={traceabilityError} working={working} onFocus={setFocusedNodeId} onSelectRevision={(id) => void selectRevision(id)} onLoadGraph={(depth, graphView) => void loadBoundedGraph(depth, graphView)} onQueryPath={(targetId, graphView) => void explainGraphPath(targetId, graphView)} onResolveEvidence={resolveEvidence} onReanalyzeHistorical={(availability) => void reanalyzeHistoricalRevision(availability)} />;
    if (view === "review") return <ReviewWorkspace t={t} items={reviewItems} selectedIds={selectedReviewIds} setSelectedIds={setSelectedReviewIds} outcome={reviewOutcome} setOutcome={setReviewOutcome} rationale={reviewRationale} setRationale={setReviewRationale} working={working} onRefresh={() => void refreshReviewQueue()} onDecide={() => void submitReviewDecision()} />;
    if (view === "impact") return <ImpactWorkspace t={t} artifact={current?.graphArtifact ?? null} impact={impact} revision={current?.revision ?? null} />;
    return <CapabilitySettings t={t} models={globalModels} globalTemplates={globalCapabilityTemplates} catalog={effectiveCatalog} draft={capabilityDraft} draftInput={currentCapabilityDraftInput(capabilityDraft?.revision ?? 0)} profile={executionProfile} profileHistory={profileHistory} mainModel={mainModel} setMainModel={setMainModel} mainRolePolicy={mainRolePolicy} setMainRolePolicy={setMainRolePolicy} mainSkillNames={mainSkillNames} setMainSkillNames={setMainSkillNames} mainMcpNames={mainMcpNames} setMainMcpNames={setMainMcpNames} childSlots={childSlots} setChildSlots={setChildSlots} importedKeys={importedKeys} setImportedKeys={setImportedKeys} disabledKeys={disabledKeys} setDisabledKeys={setDisabledKeys} dependencyNotes={dependencyNotes} setDependencyNotes={setDependencyNotes} conventionNotes={conventionNotes} setConventionNotes={setConventionNotes} securityNotes={securityNotes} setSecurityNotes={setSecurityNotes} security={securityBoundary} setSecurity={setSecurityBoundary} recoveryReady={capabilitySettingsReady} working={working} draftConflict={capabilityDraftConflict} onSaveProject={upsertProjectCapability} onDeleteProject={(kind, name, version) => void removeProjectCapability(kind, name, version)} onSave={() => void saveCapabilities()} onRetryDraftConflict={() => void retryCapabilityDraft()} onUseCurrentDraft={useCurrentCapabilityDraft} onResolve={(input) => void resolveCapabilities(input)} />;
  };

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">T</span><span>Traqen</span></div>
      <div className="workspace-block"><div className="workspace-switcher-head"><p className="workspace-label">Workspace</p><div><button title={t("刷新 Workspace", "Refresh Workspaces")} onClick={() => void reconnect(false)}>↻</button><button className="workspace-add-button" title={t("新建 Workspace", "New Workspace")} onClick={() => { setActiveWorkspace(null); setView("overview"); }}>＋</button></div></div>{activeWorkspace ? <div className="workspace active-workspace"><strong>{activeWorkspace.name}</strong><small>{current ? `Published revision ${current.head.version}` : t("等待首次发布", "Awaiting first publication")}</small></div> : <div className="workspace active-workspace empty-workspace"><strong>{t("未选择 Workspace", "No Workspace selected")}</strong><small>{t("选择或创建一个项目", "Select or create a project")}</small></div>}<div className="workspace-project-list">{workspaces.map((workspace) => <div key={workspace.id} className={`workspace-project-row ${workspace.id === activeWorkspace?.id ? "active" : ""}`}><button className="workspace-project-open" onClick={() => selectWorkspace(workspace)}><strong>{workspace.name}</strong><small>{workspace.lifecycleState}</small></button></div>)}</div></div>
      {(["overview", "understanding", "governance", "configuration"] as const).map((section) => <nav key={section} className="nav" aria-label={section}><p className="workspace-label">{section === "understanding" ? t("理解", "Understanding") : section === "governance" ? t("治理", "Governance") : section === "configuration" ? t("配置", "Configuration") : t("工作台", "Workspace")}</p>{modules.filter((item) => item.section === section).map((item) => <button key={item.key} className={`nav-button ${view === item.key ? "active" : ""}`} onClick={() => { if (item.key === "settings") setSettingsScope("chooser"); setView(item.key); }}><span className="nav-icon">{item.icon}</span><span>{language === "zh-CN" ? item.zh : item.en}</span>{item.key === "review" && openReviewCount > 0 && <em>{openReviewCount}</em>}{item.key === "impact" && impactActionCount > 0 && <em>{impactActionCount}</em>}</button>)}</nav>)}
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
    {startConfirmation && activeWorkspace && <div className="modal-backdrop"><section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="start-confirmation-title"><p className="eyebrow">Explicit command</p><h2 id="start-confirmation-title">{t("确认启动 Workspace 分析", "Confirm Workspace analysis start")}</h2><p>{t("以下输入将被固定到服务端任务。启动后仍可暂停、恢复或取消。", "The following inputs will be pinned to the server job. You may pause, resume, or cancel after start.")}</p><dl><dt>Workspace</dt><dd>{activeWorkspace.name}</dd><dt>SourceRegistration</dt><dd>{startConfirmation.sourceRegistrationId}</dd><dt>Snapshot</dt><dd>{job?.snapshotManifestId ?? t("服务端启动时创建", "Created by server at start")}</dd><dt>Profile Revision</dt><dd>{startConfirmation.profile.id}</dd><dt>Agent roster</dt><dd>Main + {startConfirmation.profile.childSlots.length} Child slots</dd><dt>{t("数据边界", "Data boundary")}</dt><dd>WORKSPACE</dd><dt>{t("模式", "Mode")}</dt><dd>{startConfirmation.requestedMode === "FULL" ? "FULL" : "AUTO (FULL / INCREMENTAL)"}</dd></dl><div className="modal-actions"><button className="button" onClick={() => setStartConfirmation(null)}>{t("返回", "Back")}</button><button className="button primary" disabled={working} onClick={() => void startUnderstanding(startConfirmation)}>{t("确认并启动", "Confirm and start")}</button></div></section></div>}
  </main>;
}

export function TraqenProduct() {
  return <ThemeProvider><ServerOwnedProduct /></ThemeProvider>;
}
