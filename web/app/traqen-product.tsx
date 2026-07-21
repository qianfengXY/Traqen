"use client";

import cytoscape from "cytoscape";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { configureAndVerifyAnalysisModel, enrichWorkspaceCandidateBatch, listAnalysisModelProfiles, verifyConfiguredAnalysisModel, workspaceModelCandidateBatches, type AnalysisModelProfile } from "./analysis-model-client";
import { changedTraqenArtifacts, currentTraqenArtifacts, type DesignDocument, type EnvironmentConfiguration, type FeatureDescriptionDocument, type HumanConfirmation, type ScenarioTestResult, type TestCaseDefinition, type TestDesign, type TraceDetailArtifacts } from "./trace-detail-model";
import { analyzeLocalWorkspaceRecords, applyLocalModelEnrichment, isLocalBusinessFeature, localWorkspaceAnalysisForTreeMode, localWorkspaceScannerVersion, scanLocalWorkspaceFile, type LocalFeatureCandidate, type LocalFeatureTreeMode, type LocalFeatureTreeNode, type LocalWorkspaceAnalysis, type LocalWorkspaceFileRecord, type LocalWorkspaceInputFile } from "./local-workspace-analysis";
import { clearLocalWorkspaceAnalysisRun, listLocalWorkspaceProjects, loadLocalWorkspaceAnalysisRun, loadLocalWorkspaceProject, saveLocalWorkspaceAnalysisRun, saveLocalWorkspaceProject, setLocalWorkspaceProjectVisibility, type LocalWorkspaceAnalysisRunCheckpoint, type LocalWorkspaceProjectSnapshot, type LocalWorkspaceProjectSummary } from "./local-workspace-store";
import { localWorkspaceStatisticsForNode } from "./local-workspace-statistics";

type View = "workspace" | "trace" | "graph" | "review" | "impact" | "metrics";
type NodeStatus = "ACTIVE" | "STALE" | "PENDING";
type GraphViewPreset = "traceability" | "business" | "implementation" | "coverage";
type TraceBlockKey = "description" | "design" | "configuration" | "test-case" | "test-result";
type WorkspaceTraceBlock = TraceBlockKey;
type TraceDetail = { label: string; value: string };
type Language = "zh-CN" | "en";

const LanguageContext = createContext<Language>("zh-CN");

const localizedTerms: Record<string, { zh: string; en: string }> = {
  // Trace and graph object types.
  Feature: { zh: "功能", en: "Feature" },
  FEATURE: { zh: "功能", en: "Feature" },
  Claim: { zh: "声明", en: "Claim" },
  CLAIM: { zh: "声明", en: "Claim" },
  Scope: { zh: "适用范围", en: "Scope" },
  CLAIM_SCOPE: { zh: "适用范围", en: "Scope" },
  Decision: { zh: "人工决策", en: "Decision" },
  DECISION: { zh: "人工决策", en: "Decision" },
  Conformance: { zh: "实现符合分析", en: "Conformance" },
  IMPLEMENTATION_CONFORMANCE: {
    zh: "实现符合分析",
    en: "Implementation conformance",
  },
  Implementation: { zh: "设计实现", en: "Implementation" },
  IMPLEMENTATION_FACT: { zh: "实现事实", en: "Implementation fact" },
  ENDPOINT: { zh: "接口", en: "Endpoint" },
  CODE_SYMBOL: { zh: "代码符号", en: "Code symbol" },
  HANDLER: { zh: "处理入口", en: "Handler" },
  CALLS: { zh: "调用实现", en: "Calls" },
  MATCHED_IMPLEMENTATION: { zh: "匹配实现", en: "Matched implementation" },
  API_SERVICE: { zh: "对外接口服务", en: "External API services" },
  BUSINESS_CAPABILITY: { zh: "业务处理能力", en: "Business capabilities" },
  DATA_INTEGRATION: { zh: "数据与外部集成", en: "Data and external integrations" },
  BACKGROUND_INTEGRATION: { zh: "后台任务与消息", en: "Background jobs and messaging" },
  PROJECT_OPERATION: { zh: "工程与运行能力", en: "Project and runtime operations" },
  "Data / Config": { zh: "数据 / 配置", en: "Data / Configuration" },
  DATA_OBJECT: { zh: "数据对象", en: "Data object" },
  CONFIGURATION: { zh: "配置", en: "Configuration" },
  EXTERNAL_DEPENDENCY: { zh: "外部依赖", en: "External dependency" },
  TestSpec: { zh: "测试规范", en: "TestSpec" },
  TEST_SPEC: { zh: "测试规范", en: "TestSpec" },
  Assertions: { zh: "断言", en: "Assertions" },
  TEST_ASSERTION: { zh: "测试断言", en: "Test assertion" },
  Execution: { zh: "测试执行", en: "Execution" },
  TEST_EXECUTION: { zh: "测试执行", en: "Test execution" },
  Evidence: { zh: "证据", en: "Evidence" },
  EVIDENCE: { zh: "证据", en: "Evidence" },
  ACTOR_ROLE: { zh: "参与者 / 角色", en: "Actor / Role" },
  BUSINESS_STATE: { zh: "业务状态", en: "Business state" },
  STATE_TRANSITION: { zh: "状态流转", en: "State transition" },
  DESIGN_ELEMENT: { zh: "设计元素", en: "Design element" },
  TRACE_GAP: { zh: "追溯缺口", en: "Trace gap" },
  CONFLICT: { zh: "冲突", en: "Conflict" },

  // Status and trust dimensions.
  ACTIVE: { zh: "生效", en: "Active" },
  PENDING: { zh: "待处理", en: "Pending" },
  STALE: { zh: "已过期", en: "Stale" },
  CONFLICTED: { zh: "存在冲突", en: "Conflicted" },
  GAP: { zh: "存在缺口", en: "Gap" },
  CONFIRMED: { zh: "已确认", en: "Confirmed" },
  REJECTED: { zh: "已驳回", en: "Rejected" },
  EXCEPTION_RECORDED: { zh: "已确认并记录例外", en: "Exception recorded" },
  CONFORMS: { zh: "符合", en: "Conforms" },
  DEVIATES: { zh: "偏离", en: "Deviates" },
  PARTIAL: { zh: "部分符合", en: "Partial" },
  PASS: { zh: "通过", en: "Pass" },
  FAIL: { zh: "失败", en: "Fail" },
  ERROR: { zh: "执行错误", en: "Error" },
  NOT_RUN: { zh: "未执行", en: "Not run" },
  FRESH: { zh: "新鲜", en: "Fresh" },
  EXPIRING: { zh: "即将过期", en: "Expiring" },
  INCOMPLETE: { zh: "不完整", en: "Incomplete" },
  UNKNOWN: { zh: "未知", en: "Unknown" },
  NONE: { zh: "无", en: "None" },
  VERIFIED: { zh: "已验证", en: "Verified" },
  UNVERIFIED: { zh: "未验证", en: "Unverified" },
  UNRESOLVED: { zh: "未解决", en: "Unresolved" },
  BLOCKING: { zh: "阻断", en: "Blocking" },
  WARNING: { zh: "警告", en: "Warning" },
  CURRENT: { zh: "当前", en: "Current" },
  HISTORICAL: { zh: "历史", en: "Historical" },
  COMPLETE: { zh: "完整", en: "Complete" },
  APPROVED: { zh: "已批准", en: "Approved" },
  DRAFT: { zh: "草稿", en: "Draft" },
  BLOCKED: { zh: "已阻断", en: "Blocked" },
  UNAVAILABLE: { zh: "不可用", en: "Unavailable" },
  HIGH: { zh: "高置信度", en: "High confidence" },
  MEDIUM: { zh: "中置信度", en: "Medium confidence" },
  LOW: { zh: "低置信度", en: "Low confidence" },

  // Roles.
  "business-owner": { zh: "业务负责人", en: "Business owner" },
  "product-owner": { zh: "产品负责人", en: "Product owner" },
  "technical-owner": { zh: "技术负责人", en: "Technical owner" },
  developer: { zh: "开发负责人", en: "Developer" },
  DEVELOPER: { zh: "开发负责人", en: "Developer" },
  "quality-owner": { zh: "质量负责人", en: "Quality owner" },
  QUALITY_OWNER: { zh: "质量负责人", en: "Quality owner" },
  "platform-operator": { zh: "平台运维", en: "Platform operator" },
  "claim-owner": { zh: "声明负责人", en: "Claim owner" },
  "security-owner": { zh: "安全负责人", en: "Security owner" },
  "implementation-reviewer": {
    zh: "实现审核人",
    en: "Implementation reviewer",
  },

  // Execution and policy types.
  READ_ONLY: { zh: "只读", en: "Read only" },
  CONTROLLED_WRITE: { zh: "受控写入", en: "Controlled write" },
  READY: { zh: "可自动执行", en: "Ready" },
  MANUAL: { zh: "人工执行", en: "Manual" },
  FIXTURE: { zh: "测试数据准备", en: "Fixture" },
  HTTP: { zh: "HTTP 请求", en: "HTTP" },
  DATABASE: { zh: "数据库", en: "Database" },
  LOG: { zh: "日志", en: "Log" },
  TRACE: { zh: "链路追踪", en: "Trace" },
  CLEANUP: { zh: "清理", en: "Cleanup" },
  DOMAIN: { zh: "领域规则", en: "Domain" },
  GRAPH: { zh: "图谱", en: "Graph" },
  CONTRACT: { zh: "契约", en: "Contract" },
  ADVISORY: { zh: "建议模式", en: "Advisory" },
  MANUAL_APPROVAL: { zh: "人工批准", en: "Manual approval" },
  ENFORCED: { zh: "强制执行", en: "Enforced" },
  WARN: { zh: "告警", en: "Warn" },
  REQUIRE_APPROVAL: { zh: "需要批准", en: "Require approval" },
  WAITING_REVIEW: { zh: "等待审核", en: "Waiting review" },
  CREATE: { zh: "新建", en: "Create" },
  EXISTING: { zh: "关联既有", en: "Existing" },

  // Relationship, change and provenance types.
  HAS_RULE: { zh: "包含规则", en: "Has rule" },
  APPLIES_IN: { zh: "适用于", en: "Applies in" },
  CONFIRMED_BY: { zh: "由其确认", en: "Confirmed by" },
  CONFORMS_TO: { zh: "符合", en: "Conforms to" },
  CONTROLLED_BY: { zh: "受其控制", en: "Controlled by" },
  VERIFIED_BY: { zh: "由其验证", en: "Verified by" },
  ASSERTED_BY: { zh: "由其断言", en: "Asserted by" },
  EXECUTED_AS: { zh: "执行为", en: "Executed as" },
  PROVEN_BY: { zh: "由证据证明", en: "Proven by" },
  HAS_GAP: { zh: "存在缺口", en: "Has gap" },
  MODIFIED: { zh: "已修改", en: "Modified" },
  ADDED: { zh: "已新增", en: "Added" },
  REMOVED: { zh: "已删除", en: "Removed" },
  SOURCE_CODE: { zh: "源代码", en: "Source code" },
  CONFIGURATION_CHANGE: { zh: "配置变更", en: "Configuration change" },
  SERVER_DERIVED: { zh: "服务端派生", en: "Server derived" },
  GOVERNED_BASELINE: { zh: "受治理基线", en: "Governed baseline" },
  AUTHORIZED_HUMAN_DECISION: {
    zh: "授权人工决策",
    en: "Authorized human decision",
  },
  DETERMINISTIC_FACT: { zh: "确定性事实", en: "Deterministic fact" },
  APPROVED_TEST_SPEC: { zh: "已批准测试规范", en: "Approved TestSpec" },
  ATTESTED_RUNNER: { zh: "已证明 Runner", en: "Attested runner" },
  VERIFIED_EVIDENCE: { zh: "已验证证据", en: "Verified evidence" },
  SUPPORTS: { zh: "支持", en: "Supports" },
  CONTEXT: { zh: "上下文", en: "Context" },
  SOURCE: { zh: "来源", en: "Source" },
  CONFORMANCE: { zh: "实现符合", en: "Conformance" },
  VERIFICATION: { zh: "验证", en: "Verification" },
  TRACE_SEGMENTS: { zh: "追溯链段", en: "Trace segments" },
  NORMATIVE_CLAIM: { zh: "规范性声明", en: "Normative claim" },
  BUSINESS_DECISION: { zh: "业务决策", en: "Business decision" },
  HISTORICAL_FACTS: { zh: "历史事实", en: "Historical facts" },
  HISTORICAL_EVIDENCE: { zh: "历史证据", en: "Historical evidence" },
  TARGETED_UNION_HIGH_RISK: {
    zh: "定向测试与高风险集并集",
    en: "Targeted union with high-risk set",
  },
  FEATURE_PROOF_CHAIN_INCOMPLETE: {
    zh: "功能证明链不完整",
    en: "Feature proof chain incomplete",
  },
  REPAIR_TRACE_GAPS: { zh: "修复追溯缺口", en: "Repair trace gaps" },
  RERUN_SELECTED_TESTS: { zh: "重跑所选测试", en: "Rerun selected tests" },
  MAPPED_IMPLEMENTATION_CHANGE: {
    zh: "已映射实现发生变更",
    en: "Mapped implementation changed",
  },
  REMAP_IMPLEMENTATION_FACTS: {
    zh: "重新映射实现事实",
    en: "Remap implementation facts",
  },
  RECOMPUTE_IMPLEMENTATION_CONFORMANCE: {
    zh: "重新计算实现符合性",
    en: "Recompute implementation conformance",
  },
  RERUN_AFFECTED_TESTS: { zh: "重跑受影响测试", en: "Rerun affected tests" },
  RECOMPUTE_TRACE_CHAIN: { zh: "重新计算追踪链", en: "Recompute trace chain" },

  // Self-workspace scenarios.
  完整证明链: { zh: "完整证明链", en: "Complete proof chain" },
  缺口透明性: { zh: "缺口透明性", en: "Gap transparency" },
  新鲜度边界: { zh: "新鲜度边界", en: "Freshness boundary" },
  图谱投影: { zh: "图谱投影", en: "Graph projection" },
  文档一致性: { zh: "文档一致性", en: "Document consistency" },
  product: { zh: "产品", en: "Product" },
  rules: { zh: "规则", en: "Rules" },
  implementation: { zh: "实现", en: "Implementation" },
  data: { zh: "数据", en: "Data" },
  configuration: { zh: "配置", en: "Configuration" },
  tests: { zh: "测试", en: "Tests" },
  assertions: { zh: "断言", en: "Assertions" },
  execution: { zh: "执行", en: "Execution" },
  evidence: { zh: "证据", en: "Evidence" },
  NO_TEST_SPEC: { zh: "缺少测试规范", en: "No TestSpec" },
  EVIDENCE_STALE: { zh: "证据已过期", en: "Evidence stale" },
  DEFECT_ESCAPE_RATE: { zh: "缺陷逃逸率", en: "Defect escape rate" },
  MISSING_AUTHORITY: { zh: "缺少业务权威", en: "Missing authority" },
  IMPLEMENTATION_UNREVIEWED: { zh: "实现尚未审核", en: "Implementation unreviewed" },
  NOT_EXECUTED_ON_CURRENT_DEPLOYMENT: { zh: "当前部署尚未执行", en: "Not executed on current deployment" },
  COMMAND: { zh: "运行命令", en: "Command" },
  WORKSPACE: { zh: "工作空间", en: "Workspace" },
  MODULE: { zh: "模块", en: "Module" },
  DOMAIN: { zh: "领域 / 产品区域", en: "Domain / Product area" },
  GROUP: { zh: "分组", en: "Group" },

  // Named dimensions and common field categories.
  业务权威: { zh: "业务权威", en: "Business authority" },
  实现符合性: { zh: "实现符合性", en: "Implementation conformance" },
  验证结果: { zh: "验证结果", en: "Verification result" },
  证据新鲜度: { zh: "证据新鲜度", en: "Evidence freshness" },
  冲突: { zh: "冲突", en: "Conflict" },
};

function useI18n() {
  const language = useContext(LanguageContext);
  const t = useCallback((zh: string, en: string) => (language === "zh-CN" ? zh : en), [language]);
  const term = useCallback(
    (value: string | null | undefined) => {
      if (value === null || value === undefined || value === "") return "—";
      return localizedTerms[value]?.[language === "zh-CN" ? "zh" : "en"] ?? value;
    },
    [language],
  );
  const role = useCallback(
    (value: string | null | undefined) => {
      if (!value) return "—";
      let result = value;
      for (const key of ["implementation-reviewer", "platform-operator", "technical-owner", "business-owner", "product-owner", "quality-owner", "security-owner", "claim-owner", "QUALITY_OWNER", "DEVELOPER", "developer"]) {
        result = result.replaceAll(key, localizedTerms[key][language === "zh-CN" ? "zh" : "en"]);
      }
      return result;
    },
    [language],
  );
  return { language, t, term, role };
}

type FeatureGraphNode = {
  id: string;
  type: string;
  label: string;
  version: string | number | null;
  status: "ACTIVE" | "PENDING" | "STALE" | "CONFLICTED" | "GAP";
  risk: string | null;
  provenance: string;
  source: Record<string, unknown> | null;
  details: Record<string, unknown>;
};

type FeatureGraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  provenance: string;
  status: "ACTIVE" | "PENDING" | "STALE";
  snapshotManifestId: string;
};

type FeatureGraph = {
  center: string;
  snapshotManifestId: string;
  view: GraphViewPreset;
  depth: number;
  nodes: FeatureGraphNode[];
  edges: FeatureGraphEdge[];
  truncated: boolean;
  availableExpansions: Array<{
    relation: string;
    nodeType: string;
    count: number;
  }>;
};

type FeatureGraphPath = {
  found: boolean;
  nodes: FeatureGraphNode[];
  edges: FeatureGraphEdge[];
  hopCount: number | null;
};

type ChainNode = {
  id: string;
  kind: string;
  title: string;
  meta: string;
  status: NodeStatus;
  relation?: string;
  provenance: string;
  details?: TraceDetail[];
};

type TraceBlock = {
  key: TraceBlockKey;
  label: string;
  detailLabel: string;
  description: string;
  summary: string;
  state: string;
  relation: string;
  details: TraceDetail[];
  records: ChainNode[];
};

type Gap = {
  type: string;
  severity: string;
  ownerRole: string;
  message: string;
};
type Dimension = { label: string; value: string };
type Evidence = { type: string; id: string; detail: string; state: string };

type ReviewCandidate = {
  id: string;
  featureCandidateId: string;
  statement: string;
  subjectKey: string;
  constraint: { dimension: string; operator: string; value: unknown };
  scope: Record<string, unknown>;
  evidence: Array<{ factId: string; relation: string }>;
  sources: Array<{
    candidateId?: string;
    producer?: { skillId?: string; skillVersion?: string };
  }>;
};

type ImpactResult = {
  changeSet: {
    id: string;
    fromSnapshotManifestId: string;
    toSnapshotManifestId: string;
    complete: boolean;
    warnings: string[];
    changes: Array<{
      id: string;
      kind: string;
      changeType: string;
      artifact: string | null;
    }>;
  };
  impact: {
    affectedFeatureIds: string[];
    affectedClaimRefs: Array<{ id: string; version: number }>;
    affectedTestSpecIds: string[];
    continuedFeatureIds: string[];
    invalidations: Array<{
      id: string;
      featureId: string;
      layers: string[];
      preserves: string[];
      reason: string;
      recommendedActions: string[];
    }>;
  };
};

type ContinuousProtection = {
  regressionPlan: {
    selectionStrategy: "TARGETED_UNION_HIGH_RISK" | "CONSERVATIVE_UNION";
    complete: boolean;
    selectedTests: Array<{
      id: string;
      version: number;
      featureId: string;
      name: string;
      approved: boolean;
      operationLevel: string;
      reasons: string[];
    }>;
    unresolvedTestSpecIds: string[];
    changeSetWarnings: string[];
  };
  featureAssessments: Array<{
    featureId: string;
    highRisk: boolean;
    available: boolean;
    chainComplete: boolean;
    dimensions: Record<string, Array<{ status: string }>> | null;
    gaps: Gap[];
  }>;
  qualityGate: {
    status: "PASS" | "BLOCKED" | "UNKNOWN";
    policyMode: "ADVISORY" | "MANUAL_APPROVAL" | "ENFORCED";
    enforcement: "PASS" | "WARN" | "REQUIRE_APPROVAL" | "FAIL";
    reasons: string[];
    requiredActions: string[];
  };
};

type ProductMetrics = {
  projectId: string;
  snapshotManifestId: string;
  computedAt: string;
  highValueValidTraceChainRate: {
    numerator: number;
    denominator: number;
    ratio: number | null;
  };
  claimConfirmationRate: {
    numerator: number;
    denominator: number;
    ratio: number | null;
  };
  confirmedRuleTestCoverageRate: {
    numerator: number;
    denominator: number;
    ratio: number | null;
  };
  meaningfulAssertionRate: {
    numerator: number;
    denominator: number;
    ratio: number | null;
  };
  evidenceFreshness: Record<string, number>;
  gapBreakdown: {
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    byOwnerRole: Record<string, number>;
  };
  features: Array<{
    featureId: string;
    name: string;
    highValue: boolean;
    chainComplete: boolean;
    coverage: Record<string, boolean>;
    openGapCount: number;
  }>;
  unavailableMetrics: Array<{ metric: string; reason: string }>;
};

type PlatformMetrics = {
  computedAt: string;
  reverseRuns: {
    runCount: number;
    retryCount: number;
    failedAttemptCount: number;
    queue: { activeCount: number };
    duration: { meanMs: number | null };
  };
  scanners: {
    bundleCount: number;
    incompleteBundleCount: number;
    nodeCount: number;
    edgeCount: number;
  };
  tests: {
    executionCount: number;
    unstableTestSpecCount: number;
    duration: { meanMs: number | null };
  };
  evidence: { evidenceCount: number; externalObjectCount: number };
  impactAnalysis: {
    assessmentCount: number;
    regressionSelectionCount: number;
    duration: { meanMs: number | null };
  };
  unavailableSignals: Array<{
    signal: string;
    status: "UNAVAILABLE";
    reason: string;
  }>;
};

type Scenario = {
  feature: { id: string; name: string; version: number };
  snapshotId: string;
  deploymentId: string;
  computedAt: string;
  complete: boolean;
  dimensions: Dimension[];
  nodes: ChainNode[];
  gaps: Gap[];
  evidence: Evidence[];
  reasons: string[];
};

const completeScenario: Scenario = {
  feature: {
    id: "FEATURE-TRACEABILITY-001",
    name: "功能追溯 / Feature traceability",
    version: 4,
  },
  snapshotId: "SNAPSHOT-TRAQEN-7D31E8",
  deploymentId: "DEPLOY-TRAQEN-20260716.4",
  computedAt: "2026-07-16 18:52:04 CST",
  complete: true,
  dimensions: [
    { label: "业务权威", value: "CONFIRMED" },
    { label: "实现符合性", value: "CONFORMS" },
    { label: "验证结果", value: "PASS" },
    { label: "证据新鲜度", value: "FRESH" },
    { label: "冲突", value: "NONE" },
  ],
  nodes: [
    {
      id: "CLAIM-TRACEABILITY-PROOF-001@2",
      kind: "Claim",
      title: "只有完整证明链才能标记当前功能可信",
      meta: "NORMATIVE_REQUIREMENT",
      status: "ACTIVE",
      relation: "APPLIES_IN",
      provenance: "产品负责人确认",
      details: [
        {
          label: "业务功能逻辑",
          value: "从人工确认的功能意图按顺序关联到当前实现、配置、测试和 Evidence；任何阻断缺口都必须显式展示。",
        },
        {
          label: "前置条件",
          value: "Project、Feature、Snapshot Manifest 与治理基线已经建立。",
        },
      ],
    },
    {
      id: "SCOPE-TRAQEN-WORKSPACE@2",
      kind: "Scope",
      title: "Traqen Workspace · 当前 Snapshot",
      meta: "workspace=Traqen",
      status: "ACTIVE",
      relation: "CONFIRMED_BY",
      provenance: "生效范围 v2",
      details: [
        { label: "适用对象", value: "Traqen Platform 中受治理的 Feature" },
        {
          label: "适用范围",
          value: "所选 Snapshot Manifest 与 deploymentId；历史版本单独保留。",
        },
      ],
    },
    {
      id: "DECISION-TRACEABILITY-001",
      kind: "Decision",
      title: "已确认",
      meta: "product-owner · 16 Jul",
      status: "ACTIVE",
      relation: "CONFORMS_TO",
      provenance: "不可变人工决策",
      details: [
        { label: "权威结论", value: "CONFIRMED" },
        {
          label: "确认责任",
          value: "product-owner · Decision 不可变并绑定 Claim/Scope 版本。",
        },
      ],
    },
    {
      id: "ENDPOINT-FEATURE-TRACEABILITY",
      kind: "Implementation",
      title: "GET /v1/projects/{projectId}/features/{featureId}/traceability",
      meta: "src/domain/trace-chain.js:210",
      status: "ACTIVE",
      relation: "CONTROLLED_BY",
      provenance: "Scanner + exact Fact mapping",
      details: [
        {
          label: "设计流程",
          value: "加载治理基线与 Snapshot Facts → evaluateTraceChain → 返回服务端派生的维度、segments 与 gaps",
        },
        {
          label: "代码定位",
          value: "src/domain/trace-chain.js:210 · evaluateTraceChain",
        },
        {
          label: "设计约束",
          value: "权威、符合、验证、新鲜度与冲突独立计算；浏览器不生成替代分数。",
        },
      ],
    },
    {
      id: "SCHEMA-TRACEABILITY + QUALITY-GATE",
      kind: "Data / Config",
      title: "feature-traceability.schema · QUALITY_GATE_MODE",
      meta: "JSON Schema + environment",
      status: "ACTIVE",
      relation: "VERIFIED_BY",
      provenance: "Snapshot-bound Facts",
      details: [
        {
          label: "配置项",
          value: "QUALITY_GATE_MODE = ADVISORY / MANUAL_APPROVAL / ENFORCED",
        },
        {
          label: "数据契约",
          value: "contracts/feature-traceability.schema.json",
        },
        {
          label: "配置来源",
          value: "当前部署环境与 Snapshot-bound Schema Fact。",
        },
      ],
    },
    {
      id: "TEST-TRACEABILITY-COMPLETE-001@3",
      kind: "TestSpec",
      title: "当前部署形成完整证明链",
      meta: "READ_ONLY",
      status: "ACTIVE",
      relation: "ASSERTED_BY",
      provenance: "独立批准的 TestSpec",
      details: [
        {
          label: "测试用例",
          value: "构造当前 Claim、Fact、TestSpec、Execution 和 Evidence，调用领域评估器并验证完整性。",
        },
        { label: "执行级别", value: "READ_ONLY · 版本化 Fixture" },
        {
          label: "测试步骤",
          value: "构造领域输入 → evaluateTraceChain → 校验维度、segments 和 gaps",
        },
      ],
    },
    {
      id: "ASSERT-TRACEABILITY-COMPLETE",
      kind: "Assertions",
      title: "complete=true · gaps=[]",
      meta: "5 deterministic checks",
      status: "ACTIVE",
      relation: "EXECUTED_AS",
      provenance: "Runner deterministic assertions",
      details: [
        {
          label: "业务断言",
          value: "chain.complete=true；不存在阻断级 TraceGap；verification=PASS。",
        },
        {
          label: "证据断言",
          value: "freshness=FRESH；conflict=NONE；所有 segment 保留 provenance。",
        },
      ],
    },
    {
      id: "EXEC-TRAQEN-DOMAIN-20260716-001",
      kind: "Execution",
      title: "PASS · 184 backend tests",
      meta: "node --test",
      status: "ACTIVE",
      relation: "PROVEN_BY",
      provenance: "Current repository test run",
      details: [
        {
          label: "测试结果",
          value: "PASS · 领域、API、图谱及 Evidence 生命周期测试全部通过",
        },
        {
          label: "执行环境",
          value: "DEPLOY-TRAQEN-20260716.4 · Node.js test runner",
        },
      ],
    },
    {
      id: "EVIDENCE-TRACEABILITY-BUNDLE-001",
      kind: "Evidence",
      title: "领域输出 · API 契约 · 测试报告 · 源码 Hash",
      meta: "integrity verified",
      status: "ACTIVE",
      provenance: "Current deployment artifact evidence",
      details: [
        {
          label: "结果数据",
          value: "evaluateTraceChain 输出、feature-traceability Schema 校验、测试运行结果和源码内容 Hash。",
        },
        {
          label: "完整性",
          value: "VERIFIED · 绑定当前 TestSpec、Snapshot 与部署。",
        },
      ],
    },
  ],
  gaps: [],
  evidence: [
    {
      type: "DOMAIN",
      id: "EVIDENCE-TRACEABILITY-DOMAIN-001",
      detail: "evaluateTraceChain → complete=true · gaps=[]",
      state: "VERIFIED",
    },
    {
      type: "HTTP",
      id: "EVIDENCE-TRACEABILITY-RESPONSE-001",
      detail: "GET feature traceability → server-derived projection",
      state: "VERIFIED",
    },
    {
      type: "SCHEMA",
      id: "EVIDENCE-TRACEABILITY-CONTRACT-001",
      detail: "feature-traceability.schema.json → valid",
      state: "VERIFIED",
    },
    {
      type: "TEST",
      id: "EVIDENCE-TRACEABILITY-TESTS-001",
      detail: "184 backend tests · PASS",
      state: "VERIFIED",
    },
    {
      type: "SOURCE",
      id: "EVIDENCE-TRACEABILITY-SOURCE-001",
      detail: "trace-chain.js + feature-graph.js content hashes",
      state: "VERIFIED",
    },
  ],
  reasons: ["功能愿景由产品负责人确认，并绑定 Traqen Workspace 与明确 Snapshot Scope。", "trace-chain 与 feature-graph 实现 Fact 精确映射到当前 Snapshot，符合性为 CONFORMS。", "批准的 TestSpec 在当前 Traqen 部署执行，领域、API 和 Schema 断言全部通过。", "Evidence 绑定 TestSpec 版本、Snapshot、部署与源码 Hash，并通过完整性校验。"],
};

const staleScenario: Scenario = {
  ...completeScenario,
  snapshotId: "SNAPSHOT-TRAQEN-92A44C",
  deploymentId: "DEPLOY-TRAQEN-20260716.5",
  computedAt: "2026-07-16 19:08:31 CST",
  complete: false,
  dimensions: [
    { label: "业务权威", value: "CONFIRMED" },
    { label: "实现符合性", value: "STALE" },
    { label: "验证结果", value: "NOT_RUN" },
    { label: "证据新鲜度", value: "STALE" },
    { label: "冲突", value: "NONE" },
  ],
  nodes: completeScenario.nodes.map((node, index) => {
    const changed = {
      ...node,
      status: (index <= 2 ? "ACTIVE" : "STALE") as NodeStatus,
    };
    if (node.kind === "Execution") {
      changed.details = [
        {
          label: "当前测试结果",
          value: "NOT_RUN · DEPLOY-TRAQEN-20260716.5 尚未执行批准的 TestSpec。",
        },
        {
          label: "历史测试结果",
          value: "DEPLOY-TRAQEN-20260716.4 · PASS · 184 backend tests",
        },
      ];
    }
    if (node.kind === "Evidence") {
      changed.details = [
        {
          label: "当前结果数据",
          value: "暂无；必须在当前部署重新执行后生成。",
        },
        {
          label: "历史 Evidence",
          value: "完整性仍为 VERIFIED，但仅绑定 DEPLOY-TRAQEN-20260716.4，对当前部署为 STALE。",
        },
      ];
    }
    return changed;
  }),
  gaps: [
    {
      type: "CONFORMANCE_STALE",
      severity: "BLOCKING",
      ownerRole: "DEVELOPER",
      message: "trace-chain 评估器发生语义变化，需要重新分析当前实现是否仍符合已确认规则。",
    },
    {
      type: "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT",
      severity: "BLOCKING",
      ownerRole: "QUALITY_OWNER",
      message: "已批准 TestSpec 尚未在 DEPLOY-TRAQEN-20260716.5 上重新执行。",
    },
    {
      type: "EVIDENCE_STALE",
      severity: "WARNING",
      ownerRole: "QUALITY_OWNER",
      message: "历史 Evidence 保留，但不能证明新部署当前正常。",
    },
  ],
  reasons: ["规范性 Claim 与业务 Decision 仍然有效，没有被代码变化自动废弃。", "trace-chain.js 的实现 Fact 已变化，因此实现符合性和后续验证链路被标记为 STALE。", "必须重新分析映射并在当前部署重跑 TestSpec，才能恢复完整可信链。"],
};

function demoGraphForScenario(scenario: Scenario, view: GraphViewPreset): FeatureGraph {
  const kindTypes: Record<string, string> = {
    Claim: "CLAIM",
    Scope: "CLAIM_SCOPE",
    Decision: "DECISION",
    Implementation: "ENDPOINT",
    "Data / Config": "DATA_OBJECT",
    TestSpec: "TEST_SPEC",
    Assertions: "TEST_ASSERTION",
    Execution: "TEST_EXECUTION",
    Evidence: "EVIDENCE",
  };
  const typeSets: Record<GraphViewPreset, Set<string> | null> = {
    traceability: null,
    business: new Set(["FEATURE", "CLAIM", "CLAIM_SCOPE", "DECISION", "ACTOR_ROLE", "BUSINESS_STATE", "STATE_TRANSITION", "DESIGN_ELEMENT", "TRACE_GAP"]),
    implementation: new Set(["FEATURE", "CLAIM", "ENDPOINT", "CODE_SYMBOL", "DATA_OBJECT", "CONFIGURATION", "EXTERNAL_DEPENDENCY", "TRACE_GAP"]),
    coverage: new Set(["FEATURE", "CLAIM", "TEST_SPEC", "TEST_ASSERTION", "TEST_EXECUTION", "EVIDENCE", "TRACE_GAP"]),
  };
  const demoProcessNodes: FeatureGraphNode[] = [
    ["ACTOR-TRAQEN-PRODUCT-OWNER", "ACTOR_ROLE", "产品负责人 · authority owner"],
    ["STATE-TRACE-INCOMPLETE", "BUSINESS_STATE", "证明链不完整 · INITIAL"],
    ["STATE-TRACE-COMPLETE", "BUSINESS_STATE", "当前证明完整 · VERIFIED"],
    ["STATE-TRACE-STALE", "BUSINESS_STATE", "实现或证据过期 · EXCEPTION"],
    ["TRANSITION-EVALUATE-TRACE", "STATE_TRANSITION", "评估当前追踪链"],
    ["TRANSITION-INVALIDATE-TRACE", "STATE_TRANSITION", "Snapshot 变化触发分层失效"],
    ["DESIGN-SERVER-DERIVED-PROJECTION", "DESIGN_ELEMENT", "服务端派生投影 · DOMAIN SERVICE"],
  ].map(([id, type, label]) => ({
    id,
    type,
    label,
    version: 1,
    status: "ACTIVE",
    risk: null,
    provenance: "SELF_WORKSPACE_AUTHORIZED_HUMAN_DECISION",
    source: null,
    details: { workspace: "Traqen Platform", authority: "product-owner" },
  }));
  const allNodes: FeatureGraphNode[] = [
    {
      id: scenario.feature.id,
      type: "FEATURE",
      label: scenario.feature.name,
      version: scenario.feature.version,
      status: "ACTIVE",
      risk: null,
      provenance: "SELF_WORKSPACE_GOVERNED_BASELINE",
      source: null,
      details: { workspace: "Traqen Platform" },
    },
    ...scenario.nodes.map((node) => ({
      id: node.id,
      type: kindTypes[node.kind] ?? node.kind.toUpperCase().replaceAll(" ", "_"),
      label: node.title,
      version: null,
      status: node.status,
      risk: null,
      provenance: node.provenance,
      source: null,
      details: { meta: node.meta, workspace: "Traqen Platform" },
    })),
    ...demoProcessNodes,
    ...scenario.gaps.map((gap) => ({
      id: `TRACE-GAP:SELF-WORKSPACE:${gap.type}`,
      type: "TRACE_GAP",
      label: gap.type,
      version: null,
      status: "GAP" as const,
      risk: gap.severity,
      provenance: "SELF_WORKSPACE_TRACE_CHAIN_EVALUATION",
      source: null,
      details: {
        ownerRole: gap.ownerRole,
        message: gap.message,
        workspace: "Traqen Platform",
      },
    })),
  ];
  const allEdges: FeatureGraphEdge[] = [];
  const chainNodes = allNodes.slice(0, scenario.nodes.length + 1);
  for (let index = 0; index < chainNodes.length - 1; index += 1) {
    const original = index === 0 ? null : scenario.nodes[index - 1];
    allEdges.push({
      id: `SELF-WORKSPACE-EDGE-${index + 1}`,
      source: chainNodes[index].id,
      target: chainNodes[index + 1].id,
      type: original?.relation ?? (index === 0 ? "HAS_RULE" : "LINKED_TO"),
      provenance: "SELF_WORKSPACE_TRACE_CHAIN",
      status: chainNodes[index + 1].status === "STALE" ? "STALE" : "ACTIVE",
      snapshotManifestId: scenario.snapshotId,
    });
  }
  for (const gap of allNodes.filter((node) => node.type === "TRACE_GAP")) {
    allEdges.push({
      id: `SELF-WORKSPACE-GAP-EDGE-${gap.id}`,
      source: scenario.nodes[0].id,
      target: gap.id,
      type: "HAS_GAP",
      provenance: "SELF_WORKSPACE_TRACE_CHAIN_EVALUATION",
      status: "ACTIVE",
      snapshotManifestId: scenario.snapshotId,
    });
  }
  for (const [source, type, target] of [
    [scenario.feature.id, "HAS_ROLE", "ACTOR-TRAQEN-PRODUCT-OWNER"],
    [scenario.feature.id, "HAS_STATE", "STATE-TRACE-INCOMPLETE"],
    [scenario.feature.id, "HAS_STATE", "STATE-TRACE-COMPLETE"],
    [scenario.feature.id, "HAS_STATE", "STATE-TRACE-STALE"],
    ["STATE-TRACE-INCOMPLETE", "HAS_TRANSITION", "TRANSITION-EVALUATE-TRACE"],
    ["TRANSITION-EVALUATE-TRACE", "TRANSITIONS_TO", "STATE-TRACE-COMPLETE"],
    ["STATE-TRACE-COMPLETE", "HAS_TRANSITION", "TRANSITION-INVALIDATE-TRACE"],
    ["TRANSITION-INVALIDATE-TRACE", "TRANSITIONS_TO", "STATE-TRACE-STALE"],
    ["ACTOR-TRAQEN-PRODUCT-OWNER", "PERFORMS", "TRANSITION-EVALUATE-TRACE"],
    [scenario.feature.id, "DESIGNED_BY", "DESIGN-SERVER-DERIVED-PROJECTION"],
  ]) {
    allEdges.push({
      id: `SELF-WORKSPACE-PROCESS-EDGE:${source}:${type}:${target}`,
      source,
      target,
      type,
      provenance: "SELF_WORKSPACE_AUTHORIZED_HUMAN_DECISION",
      status: "ACTIVE",
      snapshotManifestId: scenario.snapshotId,
    });
  }
  const allowed = typeSets[view];
  const nodes = allowed ? allNodes.filter((node) => allowed.has(node.type)) : allNodes;
  const ids = new Set(nodes.map((node) => node.id));
  return {
    center: scenario.feature.id,
    snapshotManifestId: scenario.snapshotId,
    view,
    depth: 8,
    nodes,
    edges: allEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    truncated: false,
    availableExpansions: [],
  };
}

function tone(value: string) {
  if (["CONFIRMED", "CONFORMS", "PASS", "FRESH", "NONE", "VERIFIED", "ACTIVE"].includes(value)) return "good";
  if (["STALE", "NOT_RUN", "EXPIRING", "PENDING", "INCOMPLETE"].includes(value)) return "warn";
  return "bad";
}

function apiHeaders(apiToken: string, headers: Record<string, string> = {}) {
  return apiToken.trim() ? { ...headers, "x-traqen-api-token": apiToken.trim() } : headers;
}

function nodeLabel(type: string) {
  return (
    (
      {
        FEATURE: "Feature",
        CLAIM: "Claim",
        CLAIM_SCOPE: "Scope",
        DECISION: "Decision",
        IMPLEMENTATION_CONFORMANCE: "Conformance",
        IMPLEMENTATION_FACT: "Implementation",
        TEST_SPEC: "TestSpec",
        TEST_ASSERTION: "Assertions",
        TEST_EXECUTION: "Execution",
        EVIDENCE: "Evidence",
        ACTOR_ROLE: "Actor / Role",
        BUSINESS_STATE: "Business State",
        STATE_TRANSITION: "State Transition",
        DESIGN_ELEMENT: "Design Element",
      } as Record<string, string>
    )[type] ?? type.replaceAll("_", " ")
  );
}

function fromApi(input: Record<string, unknown>): Scenario {
  const feature = input.feature as { id?: string; name?: string; version?: number } | undefined;
  const snapshot = input.snapshotManifest as { id?: string; components?: { deployment?: { id?: string } } } | undefined;
  const chains = Array.isArray(input.traceChains) ? (input.traceChains as Array<Record<string, unknown>>) : [];
  const chain = chains[0] ?? {};
  const segments = Array.isArray(chain.segments) ? (chain.segments as Array<Record<string, unknown>>) : [];
  const nodeMap = new Map<string, ChainNode>();
  for (const segment of segments) {
    for (const endpoint of [segment.from, segment.to]) {
      const ref = endpoint as { id?: string; type?: string; version?: string | number | null } | undefined;
      if (!ref?.id || nodeMap.has(`${ref.type}:${ref.id}`)) continue;
      nodeMap.set(`${ref.type}:${ref.id}`, {
        id: ref.id,
        kind: nodeLabel(ref.type ?? "UNKNOWN"),
        title: ref.id,
        meta: ref.version == null ? "immutable" : `version ${ref.version}`,
        status: (segment.status as NodeStatus) ?? "PENDING",
        relation: segment.relation as string | undefined,
        provenance: String(segment.provenance ?? "server-derived"),
      });
    }
  }
  const dimensions = input.dimensions as Record<string, Array<{ status?: string }>> | undefined;
  const dimensionLabels: Record<string, string> = {
    authority: "业务权威",
    conformance: "实现符合性",
    verification: "验证结果",
    freshness: "证据新鲜度",
    conflict: "冲突",
  };
  const dimensionList = Object.entries(dimensionLabels).map(([key, label]) => ({
    label,
    value: dimensions?.[key]?.[0]?.status ?? "UNKNOWN",
  }));
  const claims = Array.isArray(input.claims) ? (input.claims as Array<Record<string, unknown>>) : [];
  const evidence = claims
    .flatMap((claim) => (Array.isArray(claim.evidence) ? (claim.evidence as Array<Record<string, unknown>>) : []))
    .slice(0, 8)
    .map((item) => ({
      type: String(item.type ?? "EVIDENCE"),
      id: String(item.id ?? "unknown"),
      detail: String(item.contentHash ?? item.storageUri ?? "snapshot-bound manifest"),
      state: String(item.integrity ?? "VERIFIED"),
    }));
  const gaps = Array.isArray(input.gaps) ? (input.gaps as Gap[]) : [];
  const complete = chains.length > 0 && chains.every((item) => item.complete === true) && gaps.length === 0;
  return {
    feature: {
      id: feature?.id ?? "UNKNOWN-FEATURE",
      name: feature?.name ?? feature?.id ?? "Unknown feature",
      version: feature?.version ?? 1,
    },
    snapshotId: snapshot?.id ?? "UNKNOWN-SNAPSHOT",
    deploymentId: snapshot?.components?.deployment?.id ?? String(chain.deploymentId ?? "UNKNOWN-DEPLOYMENT"),
    computedAt: String(input.computedAt ?? new Date().toISOString()),
    complete,
    dimensions: dimensionList,
    nodes: [...nodeMap.values()],
    gaps,
    evidence,
    reasons: complete ? ["服务端派生的全部追踪链均完整。", "所有独立维度满足当前 Snapshot 与部署的可信要求。", "没有未解决的 TraceGap。"] : ["服务端返回了未闭合的 TraceGap。", "只有完成缺口修复与重新计算后，平台才会恢复可信状态。"],
  };
}

const traceBlockDefinitions: Array<{
  key: TraceBlockKey;
  label: string;
  detailLabel: string;
  description: string;
  relation: string;
  kinds: string[];
}> = [
  {
    key: "description",
    label: "功能描述",
    detailLabel: "业务功能逻辑",
    description: "说明功能解决什么问题、适用于谁、遵循什么业务规则，以及由谁确认。",
    relation: "指导设计",
    kinds: ["Claim", "Scope", "Decision"],
  },
  {
    key: "design",
    label: "设计实现",
    detailLabel: "设计图与代码",
    description: "展示接口、组件、状态流转、代码定位和实现符合性。",
    relation: "依赖配置",
    kinds: ["Implementation"],
  },
  {
    key: "configuration",
    label: "配置",
    detailLabel: "配置与数据约束",
    description: "展示当前 Snapshot 中影响功能行为的配置、数据结构和运行约束。",
    relation: "约束用例",
    kinds: ["Data / Config"],
  },
  {
    key: "test-case",
    label: "测试用例",
    detailLabel: "用例、步骤与断言",
    description: "展示批准的 TestSpec、准备条件、执行步骤和有意义的业务断言。",
    relation: "产生结果",
    kinds: ["TestSpec", "Assertions"],
  },
  {
    key: "test-result",
    label: "测试结果",
    detailLabel: "执行结果数据",
    description: "展示当前部署的执行结论、证据数据、完整性和新鲜度。",
    relation: "",
    kinds: ["Execution", "Evidence"],
  },
];

function dimensionState(scenario: Scenario, label: string, fallback: string) {
  return scenario.dimensions.find((dimension) => dimension.label === label)?.value ?? fallback;
}

function nodeState(nodes: ChainNode[]) {
  if (nodes.some((node) => node.status === "STALE")) return "STALE";
  if (nodes.some((node) => node.status === "PENDING")) return "PENDING";
  return nodes.length > 0 ? "ACTIVE" : "UNKNOWN";
}

function traceBlocksForScenario(scenario: Scenario): TraceBlock[] {
  return traceBlockDefinitions.map((definition) => {
    const records = scenario.nodes.filter((node) => definition.kinds.includes(node.kind));
    const recordDetails = records.flatMap((node) => node.details ?? [{ label: node.kind, value: `${node.title} · ${node.meta}` }]);
    let state = nodeState(records);
    let summary = records.map((node) => node.title).join(" · ") || "尚无可展示数据";
    let context: TraceDetail[] = [];

    if (definition.key === "description") {
      state = dimensionState(scenario, "业务权威", state);
      summary = records.find((node) => node.kind === "Claim")?.title ?? scenario.feature.name;
      context = [
        {
          label: "功能",
          value: `${scenario.feature.name} · ${scenario.feature.id}@${scenario.feature.version}`,
        },
        { label: "业务权威", value: state },
      ];
    } else if (definition.key === "design") {
      state = dimensionState(scenario, "实现符合性", state);
      context = [
        { label: "实现符合性", value: state },
        { label: "实现快照", value: scenario.snapshotId },
      ];
    } else if (definition.key === "configuration") {
      context = [
        { label: "配置快照", value: scenario.snapshotId },
        { label: "目标部署", value: scenario.deploymentId },
      ];
    } else if (definition.key === "test-case") {
      context = [
        { label: "用例状态", value: state },
        { label: "绑定快照", value: scenario.snapshotId },
      ];
    } else {
      const verification = dimensionState(scenario, "验证结果", state);
      const freshness = dimensionState(scenario, "证据新鲜度", "UNKNOWN");
      state = verification;
      summary = `${verification} · ${scenario.evidence.length} 条结果证据`;
      context = [
        { label: "验证结果", value: verification },
        { label: "证据新鲜度", value: freshness },
        { label: "执行部署", value: scenario.deploymentId },
        { label: "结果时间", value: scenario.computedAt },
      ];
    }

    return {
      ...definition,
      summary,
      state,
      details: [...context, ...recordDetails],
      records,
    };
  });
}

export function TraqenProduct() {
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [view, setView] = useState<View>("workspace");
  const [scenarioKey, setScenarioKey] = useState<"current" | "changed">("current");
  const [liveScenario, setLiveScenario] = useState<Scenario | null>(null);
  const [selectedTraceBlock, setSelectedTraceBlock] = useState<TraceBlockKey>("description");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false);
  const [analysisModelProfileId, setAnalysisModelProfileId] = useState("workspace-default");
  const [analysisModelEndpoint, setAnalysisModelEndpoint] = useState("https://api.openai.com/v1/chat/completions");
  const [analysisModelName, setAnalysisModelName] = useState("");
  const [analysisModelApiKey, setAnalysisModelApiKey] = useState("");
  const [analysisModelProfile, setAnalysisModelProfile] = useState<AnalysisModelProfile | null>(null);
  const [analysisModelStatus, setAnalysisModelStatus] = useState<"IDLE" | "CHECKING" | "READY" | "ERROR">("IDLE");
  const [analysisModelMessage, setAnalysisModelMessage] = useState("");
  const [apiBase, setApiBase] = useState("http://127.0.0.1:3100");
  const [apiToken, setApiToken] = useState("");
  const [projectId, setProjectId] = useState("PROJECT-TRAQEN");
  const [featureId, setFeatureId] = useState("FEATURE-TRACEABILITY-001");
  const [snapshotId, setSnapshotId] = useState("SNAPSHOT-TRAQEN-7D31E8");
  const [workspaceName, setWorkspaceName] = useState("Traqen Platform");
  const [workspaceProjectId, setWorkspaceProjectId] = useState("PROJECT-TRAQEN");
  const [workspaceAnalysis, setWorkspaceAnalysis] = useState<LocalWorkspaceAnalysis | null>(null);
  const [workspaceTreeMode, setWorkspaceTreeMode] = useState<LocalFeatureTreeMode>("BUSINESS");
  const [workspaceFeatureId, setWorkspaceFeatureId] = useState("");
  const [workspaceTraceBlock, setWorkspaceTraceBlock] = useState<WorkspaceTraceBlock>("description");
  const [workspaceExpandedNodeIds, setWorkspaceExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [workspaceSelectedFiles, setWorkspaceSelectedFiles] = useState<File[]>([]);
  const [workspaceDirectoryName, setWorkspaceDirectoryName] = useState("");
  const [workspaceRegisteredRootName, setWorkspaceRegisteredRootName] = useState("");
  const [workspaceFileRecords, setWorkspaceFileRecords] = useState<LocalWorkspaceFileRecord[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<LocalWorkspaceProjectSummary[]>([]);
  const [workspaceProjectLoading, setWorkspaceProjectLoading] = useState(false);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const t = (zh: string, en: string) => (language === "zh-CN" ? zh : en);
  const visibleWorkspaceAnalysis = useMemo(() => workspaceAnalysis ? localWorkspaceAnalysisForTreeMode(workspaceAnalysis, workspaceTreeMode) : null, [workspaceAnalysis, workspaceTreeMode]);
  const visibleWorkspaceProjects = useMemo(() => workspaceProjects.filter((project) => project.visible), [workspaceProjects]);
  const analysisModelReady = analysisModelStatus === "READY" && Boolean(analysisModelProfile?.ready);
  const workspaceTreeModeCounts = useMemo(() => ({
    BUSINESS: workspaceAnalysis?.features.filter(isLocalBusinessFeature).length ?? 0,
    API: workspaceAnalysis?.features.filter((feature) => feature.kind === "ENDPOINT").length ?? 0,
  }), [workspaceAnalysis]);
  const activateWorkspaceSnapshot = useCallback((snapshot: LocalWorkspaceProjectSnapshot, preserveSelectedFiles = false, treeMode: LocalFeatureTreeMode = "BUSINESS") => {
    const result = snapshot.analysis;
    const firstFeatureId = localWorkspaceAnalysisForTreeMode(result, treeMode).features[0]?.id ?? "";
    setWorkspaceAnalysis(result);
    setWorkspaceName(result.workspaceName);
    setWorkspaceProjectId(result.projectId);
    setProjectId(result.projectId);
    setWorkspaceDirectoryName(snapshot.project.rootName);
    setWorkspaceRegisteredRootName(snapshot.project.rootName);
    if (!preserveSelectedFiles) setWorkspaceSelectedFiles([]);
    setWorkspaceFileRecords(snapshot.records);
    setWorkspaceFeatureId(firstFeatureId);
    setWorkspaceTraceBlock("description");
    setWorkspaceExpandedNodeIds(new Set([result.tree.id]));
    if (firstFeatureId) setFeatureId(firstFeatureId);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      let selectedId = "workspace-default";
      try {
        const stored = JSON.parse(localStorage.getItem("traqen-analysis-model-settings") ?? "null") as { id?: string; endpoint?: string; model?: string } | null;
        if (stored?.id) { selectedId = stored.id; setAnalysisModelProfileId(stored.id); }
        if (stored?.endpoint) setAnalysisModelEndpoint(stored.endpoint);
        if (stored?.model) setAnalysisModelName(stored.model);
      } catch {
        localStorage.removeItem("traqen-analysis-model-settings");
      }
      try {
        const profiles = await listAnalysisModelProfiles("http://127.0.0.1:3100", "");
        const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles.find((profile) => profile.ready) ?? null;
        setAnalysisModelProfile(selected);
        setAnalysisModelStatus(selected?.ready ? "READY" : "IDLE");
        if (selected) {
          setAnalysisModelProfileId(selected.id);
          setAnalysisModelEndpoint(selected.endpoint);
          setAnalysisModelName(selected.model);
        }
      } catch {
        setAnalysisModelProfile(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const refreshAnalysisModelProfile = useCallback(async () => {
    try {
      const profiles = await listAnalysisModelProfiles(apiBase, apiToken);
      const selected = profiles.find((profile) => profile.id === analysisModelProfileId) ?? profiles.find((profile) => profile.ready) ?? null;
      setAnalysisModelProfile(selected);
      setAnalysisModelStatus(selected?.ready ? "READY" : "IDLE");
      if (selected) {
        setAnalysisModelProfileId(selected.id);
        setAnalysisModelEndpoint(selected.endpoint);
        setAnalysisModelName(selected.model);
      }
    } catch {
      setAnalysisModelProfile(null);
      setAnalysisModelStatus("IDLE");
    }
  }, [analysisModelProfileId, apiBase, apiToken]);

  useEffect(() => {
    let cancelled = false;
    void listLocalWorkspaceProjects({ includeHidden: true }).then(async (projects) => {
      if (cancelled) return;
      setWorkspaceProjects(projects);
      const firstVisible = projects.find((project) => project.visible);
      if (!firstVisible) return;
      const snapshot = await loadLocalWorkspaceProject(firstVisible.id);
      if (!cancelled && snapshot) activateWorkspaceSnapshot(snapshot, false, "BUSINESS");
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activateWorkspaceSnapshot]);

  const scenario = liveScenario ?? (scenarioKey === "current" ? completeScenario : staleScenario);
  async function initializeWorkspace(result: LocalWorkspaceAnalysis, records: LocalWorkspaceFileRecord[], rootName: string) {
    const existing = workspaceProjects.find((project) => project.id === result.projectId);
    const now = new Date().toISOString();
    const project: LocalWorkspaceProjectSummary = {
      id: result.projectId,
      name: result.workspaceName,
      rootName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      fileCount: result.fileCount,
      supportedFileCount: result.supportedFileCount,
      featureCount: result.features.length,
      visible: true,
    };
    const snapshot = { project, analysis: result, records } satisfies LocalWorkspaceProjectSnapshot;
    await saveLocalWorkspaceProject(snapshot);
    setWorkspaceProjects((current) => [project, ...current.filter((item) => item.id !== project.id)].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    activateWorkspaceSnapshot(snapshot, true, workspaceTreeMode);
    setWorkspaceDirectoryName(rootName);
  }

  function clearWorkspaceAnalysis() {
    setWorkspaceAnalysis(null);
    setWorkspaceFeatureId("");
    setWorkspaceTraceBlock("description");
    setWorkspaceExpandedNodeIds(new Set());
    setWorkspaceFileRecords([]);
    setWorkspaceRegisteredRootName("");
  }

  function startNewWorkspace() {
    setLiveScenario(null);
    clearWorkspaceAnalysis();
    setWorkspaceName(t("新 Workspace", "New Workspace"));
    setWorkspaceProjectId("PROJECT-LOCAL-NEW");
    setWorkspaceSelectedFiles([]);
    setWorkspaceDirectoryName("");
    setWorkspaceRegisteredRootName("");
    setView("workspace");
  }

  async function openStoredWorkspace(targetProjectId: string) {
    setWorkspaceProjectLoading(true);
    try {
      const snapshot = await loadLocalWorkspaceProject(targetProjectId);
      if (snapshot) {
        setLiveScenario(null);
        activateWorkspaceSnapshot(snapshot, false, workspaceTreeMode);
        setView("workspace");
      }
    } finally {
      setWorkspaceProjectLoading(false);
    }
  }

  async function connectAnalysisModel() {
    setAnalysisModelStatus("CHECKING");
    setAnalysisModelMessage("");
    try {
      const verifyExistingEnvironmentProfile = analysisModelProfile?.id === analysisModelProfileId && analysisModelProfile.source === "ENVIRONMENT" && !analysisModelApiKey.trim();
      const profile = verifyExistingEnvironmentProfile
        ? await verifyConfiguredAnalysisModel(apiBase, apiToken, analysisModelProfileId)
        : await configureAndVerifyAnalysisModel(apiBase, apiToken, {
            id: analysisModelProfileId,
            endpoint: analysisModelEndpoint,
            model: analysisModelName,
            apiKey: analysisModelApiKey,
          });
      setAnalysisModelProfile(profile);
      setAnalysisModelStatus("READY");
      setAnalysisModelEndpoint(profile.endpoint);
      setAnalysisModelApiKey("");
      localStorage.setItem("traqen-analysis-model-settings", JSON.stringify({ id: profile.id, endpoint: profile.endpoint, model: profile.model }));
      setAnalysisModelMessage(t(`模型连接成功，延迟 ${profile.latencyMs ?? "—"} ms。`, `Model connected successfully in ${profile.latencyMs ?? "—"} ms.`));
    } catch (error) {
      setAnalysisModelProfile(null);
      setAnalysisModelStatus("ERROR");
      setAnalysisModelMessage(error instanceof Error ? error.message : t("模型连接失败", "Unable to connect the model"));
    }
  }

  async function changeWorkspaceVisibility(targetProjectId: string, visible: boolean) {
    const updated = await setLocalWorkspaceProjectVisibility(targetProjectId, visible);
    const nextProjects = workspaceProjects.map((project) => project.id === targetProjectId ? updated : project);
    setWorkspaceProjects(nextProjects);
    if (!visible && workspaceAnalysis?.projectId === targetProjectId) {
      clearWorkspaceAnalysis();
      const nextVisible = nextProjects.find((project) => project.visible && project.id !== targetProjectId);
      if (nextVisible) await openStoredWorkspace(nextVisible.id);
      else startNewWorkspace();
    }
  }

  function selectWorkspaceFeature(nextFeatureId: string) {
    setWorkspaceFeatureId(nextFeatureId);
    setWorkspaceTraceBlock("description");
    setFeatureId(nextFeatureId);
  }

  function changeWorkspaceTreeMode(nextMode: LocalFeatureTreeMode) {
    setWorkspaceTreeMode(nextMode);
    if (!workspaceAnalysis) return;
    const nextAnalysis = localWorkspaceAnalysisForTreeMode(workspaceAnalysis, nextMode);
    const nextFeatureId = nextAnalysis.features.some((feature) => feature.id === workspaceFeatureId) ? workspaceFeatureId : nextAnalysis.features[0]?.id ?? "";
    setWorkspaceFeatureId(nextFeatureId);
    setWorkspaceTraceBlock("description");
    setWorkspaceExpandedNodeIds(new Set([nextAnalysis.tree.id]));
    if (nextFeatureId) setFeatureId(nextFeatureId);
  }

  function toggleWorkspaceTreeNode(nodeId: string) {
    setWorkspaceExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }
  async function fetchTraceability(targetFeatureId: string, targetSnapshotId: string) {
    const base = apiBase.replace(/\/$/, "");
    const url = `${base}/v1/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(targetFeatureId)}/traceability?snapshotManifestId=${encodeURIComponent(targetSnapshotId)}`;
    const response = await fetch(url, {
      headers: apiHeaders(apiToken, { accept: "application/json" }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const error = body.error as { message?: string } | undefined;
      throw new Error(error?.message ?? `API returned ${response.status}`);
    }
    const normalized = fromApi(body);
    setLiveScenario(normalized);
    setSelectedTraceBlock("description");
    setConnectionOpen(false);
    setMessage(t("已加载服务端派生的 Feature 追溯视图。", "Loaded the server-derived Feature traceability view."));
  }

  async function loadTraceability() {
    setLoading(true);
    setMessage("");
    try {
      await fetchTraceability(featureId, snapshotId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("无法加载追溯视图", "Unable to load the traceability view"));
    } finally {
      setLoading(false);
    }
  }

  async function discoverAndLoadTraceability() {
    setLoading(true);
    setMessage("");
    try {
      const base = apiBase.replace(/\/$/, "");
      const headers = apiHeaders(apiToken, { accept: "application/json" });
      const [featureResponse, snapshotResponse] = await Promise.all([
        fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/features`, {
          headers,
        }),
        fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/snapshots`, { headers }),
      ]);
      const featureBody = (await featureResponse.json()) as {
        features?: Array<{
          feature?: { id?: string };
          confirmedClaimCount?: number;
        }>;
        error?: { message?: string };
      };
      const snapshotBody = (await snapshotResponse.json()) as {
        snapshots?: Array<{ id?: string }>;
        error?: { message?: string };
      };
      if (!featureResponse.ok) throw new Error(featureBody.error?.message ?? `Feature discovery returned ${featureResponse.status}`);
      if (!snapshotResponse.ok) throw new Error(snapshotBody.error?.message ?? `Snapshot discovery returned ${snapshotResponse.status}`);
      const discoveredFeature = [...(featureBody.features ?? [])].sort((left, right) => (right.confirmedClaimCount ?? 0) - (left.confirmedClaimCount ?? 0)).find((item) => item.feature?.id)?.feature?.id;
      const discoveredSnapshot = snapshotBody.snapshots?.find((item) => item.id)?.id;
      if (!discoveredFeature) throw new Error(t("该项目尚无可加载的 Feature。", "This project has no loadable Feature."));
      if (!discoveredSnapshot) throw new Error(t("该项目尚无可加载的 Snapshot Manifest。", "This project has no loadable Snapshot Manifest."));
      setFeatureId(discoveredFeature);
      setSnapshotId(discoveredSnapshot);
      await fetchTraceability(discoveredFeature, discoveredSnapshot);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("无法自动发现项目资源", "Unable to discover project resources"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <LanguageContext.Provider value={language}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">TQ</span>Traqen
          </div>
          <div>
            <div className="workspace-switcher-head"><p className="workspace-label">Workspace</p><div><button aria-label={t("管理 Workspace 展示", "Manage Workspace visibility")} onClick={() => setWorkspaceManagerOpen((value) => !value)}>☷</button><button aria-label={t("新建 Workspace", "Create Workspace")} onClick={startNewWorkspace}>＋</button></div></div>
            <div className="workspace active-workspace">
              <strong>{workspaceName}</strong>
              <small>{liveScenario ? projectId : workspaceProjectId} · {visibleWorkspaceAnalysis ? `${visibleWorkspaceAnalysis.features.length} FEATURES` : "SELF"}</small>
            </div>
            {visibleWorkspaceProjects.length > 0 && <div className="workspace-project-list" aria-label={t("显示中的本地 Workspace 项目", "Visible local Workspace projects")}>{visibleWorkspaceProjects.map((project) => <div className={`workspace-project-row ${workspaceAnalysis?.projectId === project.id ? "active" : ""}`} key={project.id}><button className="workspace-project-open" disabled={workspaceProjectLoading} onClick={() => void openStoredWorkspace(project.id)}><strong>{project.name}</strong><small>{project.featureCount} {t("功能", "features")} · {new Date(project.updatedAt).toLocaleDateString(language)}</small></button><button className="workspace-project-remove" aria-label={t(`从展示中移出 ${project.name}`, `Remove ${project.name} from display`)} title={t("移出展示（保留分析数据）", "Remove from display (keep analysis data)")} onClick={() => void changeWorkspaceVisibility(project.id, false)}>{t("移出", "Hide")}</button></div>)}</div>}
          </div>
          <nav className="nav" aria-label={t("产品导航", "Product navigation")}>
            <button className={`nav-button ${view === "workspace" ? "active" : ""}`} onClick={() => setView("workspace")}>
              <span className="nav-icon">⌘</span>
              {t("Workspace 分析", "Workspace analysis")}
            </button>
            <button className={`nav-button ${view === "trace" ? "active" : ""}`} onClick={() => setView("trace")}>
              <span className="nav-icon">→</span>
              {t("功能追溯", "Feature traceability")}
            </button>
            <button className={`nav-button ${view === "graph" ? "active" : ""}`} onClick={() => setView("graph")}>
              <span className="nav-icon">◎</span>
              {t("追溯图谱", "Trace graph")}
            </button>
            <button className={`nav-button ${view === "review" ? "active" : ""}`} onClick={() => setView("review")}>
              <span className="nav-icon">✓</span>
              {t("声明审核", "Claim review")}
            </button>
            <button className={`nav-button ${view === "impact" ? "active" : ""}`} onClick={() => setView("impact")}>
              <span className="nav-icon">△</span>
              {t("变更影响", "Change impact")}
            </button>
            <button className={`nav-button ${view === "metrics" ? "active" : ""}`} onClick={() => setView("metrics")}>
              <span className="nav-icon">▦</span>
              {t("效果指标", "Effectiveness metrics")}
            </button>
          </nav>
          <div className="sidebar-note">
            <b>{t("北极星", "North star")}</b>
            <br />
            {t("从当前部署证据反向证明业务规则，而不是统计生成了多少文档或测试。", "Prove business rules from current-deployment evidence, rather than counting generated documents or tests.")}
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <div className="breadcrumb">
              {workspaceName}&nbsp; / &nbsp;
              <b>
                {
                  {
                    workspace: t("Workspace 分析", "Workspace analysis"),
                    trace: t("功能追溯", "Feature traceability"),
                    graph: t("追溯图谱", "Trace graph"),
                    review: t("声明审核", "Claim review"),
                    impact: t("变更影响", "Change impact"),
                    metrics: t("效果指标", "Effectiveness metrics"),
                  }[view]
                }
              </b>
            </div>
            <div className="top-actions">
              <span className={`mode-badge ${liveScenario || workspaceAnalysis ? "live" : ""}`}>{liveScenario ? "LIVE API" : workspaceAnalysis ? t("已初始化", "INITIALIZED") : "SELF WORKSPACE"}</span>
              <div className="language-switch" role="group" aria-label={t("全局语言", "Global language")}>
                <button aria-pressed={language === "zh-CN"} className={language === "zh-CN" ? "active" : ""} onClick={() => setLanguage("zh-CN")}>
                  中文
                </button>
                <button aria-pressed={language === "en"} className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>
                  English
                </button>
              </div>
              {liveScenario && (
                <button className="button ghost" onClick={() => setLiveScenario(null)}>
                  {t("返回自 Workspace", "Back to self Workspace")}
                </button>
              )}
              <button className={`button model-connection-button ${analysisModelReady ? "ready" : ""}`} onClick={() => { setAnalysisSettingsOpen((value) => !value); setConnectionOpen(false); }}>
                <span aria-hidden="true">{analysisModelReady ? "●" : "○"}</span>{analysisModelReady ? t("模型已连接", "Model connected") : t("配置分析模型", "Configure model")}
              </button>
              <button className="button" onClick={() => { setConnectionOpen((value) => !value); setAnalysisSettingsOpen(false); }}>
                {t("连接 Traqen API", "Connect Traqen API")}
              </button>
            </div>
          </header>

          {workspaceManagerOpen && (
            <section className="panel workspace-manager-panel" aria-label={t("Workspace 展示管理", "Workspace visibility management")}>
              <div className="panel-head"><div><p className="eyebrow">Workspace visibility</p><h2>{t("选择要在侧栏展示的项目", "Choose projects shown in the sidebar")}</h2><p>{t("移出仅隐藏项目并保留扫描结果。隐藏项目只读取轻量摘要，不加载源码索引、功能树和追溯数据；重新勾选后可再次打开。", "Removing only hides a project and keeps its scan results. Hidden projects load only lightweight summaries, not source indexes, Feature trees, or traceability data; select them again to restore access.")}</p></div><button className="button" onClick={() => setWorkspaceManagerOpen(false)}>{t("完成", "Done")}</button></div>
              <div className="workspace-visibility-list">
                {workspaceProjects.length === 0 ? <div className="workspace-stat-empty">{t("尚无已扫描项目。", "No scanned projects yet.")}</div> : workspaceProjects.map((project) => <label key={project.id} className={project.visible ? "visible" : ""}><input type="checkbox" checked={project.visible} onChange={(event) => void changeWorkspaceVisibility(project.id, event.currentTarget.checked)} /><span><b>{project.name}</b><small>{project.id} · {project.featureCount} {t("功能", "features")} · {project.rootName}</small></span><em>{project.visible ? t("展示", "Shown") : t("已移出", "Hidden")}</em></label>)}
              </div>
            </section>
          )}

          {analysisSettingsOpen && (
            <section className="panel analysis-model-panel" aria-label={t("分析模型配置", "Analysis model configuration")}>
              <div className="panel-head"><div><p className="eyebrow">Analysis Agent · LLM</p><h2>{t("先连接模型，再启动工程分析", "Connect a model before analyzing a project")}</h2><p>{t("Traqen API 在服务端内存中保管 API Key，并以有界候选批次调用 OpenAI-compatible Chat Completions 接口。密钥不会返回浏览器、写入 Workspace 或进入分析历史。", "The Traqen API keeps the API key in server memory and calls an OpenAI-compatible Chat Completions endpoint with bounded candidate batches. The secret is never returned to the browser, written into a Workspace, or added to analysis history.")}</p></div><span className={`model-status ${analysisModelStatus.toLowerCase()}`}>{analysisModelStatus === "READY" ? t("已验证", "Verified") : analysisModelStatus === "CHECKING" ? t("验证中", "Verifying") : analysisModelStatus === "ERROR" ? t("连接失败", "Connection failed") : t("未连接", "Not connected")}</span></div>
              <div className="analysis-model-grid">
                <div className="field"><label htmlFor="analysis-profile-id">Profile ID</label><input id="analysis-profile-id" value={analysisModelProfileId} onChange={(event) => { setAnalysisModelProfileId(event.target.value); setAnalysisModelProfile(null); setAnalysisModelStatus("IDLE"); }} /></div>
                <div className="field"><label htmlFor="analysis-model-name">Model</label><input id="analysis-model-name" placeholder="gpt-5-mini / qwen / local model" value={analysisModelName} onChange={(event) => { setAnalysisModelName(event.target.value); setAnalysisModelProfile(null); setAnalysisModelStatus("IDLE"); }} /></div>
                <div className="field full"><label htmlFor="analysis-model-endpoint">API Base URL / Chat Completions URL</label><input id="analysis-model-endpoint" placeholder="https://api.example.com/v1 或 /v1/chat/completions" value={analysisModelEndpoint} onChange={(event) => { setAnalysisModelEndpoint(event.target.value); setAnalysisModelProfile(null); setAnalysisModelStatus("IDLE"); }} /><small>{t("填写服务根地址或以 /v1 结尾的地址时，会自动补全 /chat/completions；也可以直接填写完整接口地址。", "A root URL or URL ending in /v1 is completed to /chat/completions automatically; you may also enter the full endpoint.")}</small></div>
                <div className="field full"><label htmlFor="analysis-model-key">API Key</label><input id="analysis-model-key" type="password" autoComplete="off" placeholder={analysisModelProfile?.source === "ENVIRONMENT" ? t("环境变量配置；如需替换请输入新 Key", "Configured by environment; enter a new key to replace") : "sk-…"} value={analysisModelApiKey} onChange={(event) => setAnalysisModelApiKey(event.target.value)} /></div>
              </div>
              <div className="connection-actions"><button className="button primary" disabled={analysisModelStatus === "CHECKING" || !analysisModelProfileId.trim() || !analysisModelEndpoint.trim() || !analysisModelName.trim() || (!analysisModelApiKey.trim() && !(analysisModelProfile?.id === analysisModelProfileId && analysisModelProfile.source === "ENVIRONMENT"))} onClick={() => void connectAnalysisModel()}>{analysisModelStatus === "CHECKING" ? t("正在验证…", "Verifying…") : !analysisModelApiKey.trim() && analysisModelProfile?.source === "ENVIRONMENT" ? t("验证环境配置", "Verify environment profile") : t("保存并验证连接", "Save and verify")}</button><button className="button" onClick={() => void refreshAnalysisModelProfile()}>{t("刷新服务端状态", "Refresh server status")}</button>{analysisModelMessage && <span className={`form-message ${analysisModelStatus === "ERROR" ? "error" : ""}`}>{analysisModelMessage}</span>}</div>
            </section>
          )}

          {connectionOpen && (
            <section className="panel connection-panel" aria-label={t("API 连接", "API connection")}>
              <div className="connection-grid">
                <div className="field full">
                  <label htmlFor="api-base">API Base URL</label>
                  <input id="api-base" value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="project-id">Project ID</label>
                  <input id="project-id" value={projectId} onChange={(event) => setProjectId(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="feature-id">Feature ID</label>
                  <input id="feature-id" value={featureId} onChange={(event) => setFeatureId(event.target.value)} />
                </div>
                <div className="field full">
                  <label htmlFor="snapshot-id">Snapshot Manifest ID</label>
                  <input id="snapshot-id" value={snapshotId} onChange={(event) => setSnapshotId(event.target.value)} />
                </div>
                <div className="field full">
                  <label htmlFor="api-token">{t("API token（仅保存在当前页面内存）", "API token (kept only in page memory)")}</label>
                  <input id="api-token" type="password" autoComplete="off" value={apiToken} onChange={(event) => setApiToken(event.target.value)} />
                </div>
              </div>
              <div className="connection-actions">
                <button className="button primary" disabled={loading} onClick={() => void discoverAndLoadTraceability()}>
                  {loading ? t("加载中…", "Loading…") : t("自动发现并加载", "Discover and load")}
                </button>
                <button className="button" disabled={loading} onClick={() => void loadTraceability()}>
                  {t("按指定 ID 加载", "Load specified IDs")}
                </button>
                {message && <span className={`form-message ${message.startsWith("已加载") || message.startsWith("Loaded") ? "" : "error"}`}>{message}</span>}
              </div>
            </section>
          )}

          {view === "workspace" && <WorkspaceAnalysisView workspaceName={workspaceName} setWorkspaceName={setWorkspaceName} projectId={workspaceProjectId} setProjectId={setWorkspaceProjectId} selectedFiles={workspaceSelectedFiles} setSelectedFiles={setWorkspaceSelectedFiles} directoryName={workspaceDirectoryName} setDirectoryName={setWorkspaceDirectoryName} registeredRootName={workspaceRegisteredRootName} analysis={visibleWorkspaceAnalysis} fileRecords={workspaceFileRecords} onInitialize={initializeWorkspace} selectedFeatureId={workspaceFeatureId} onSelectFeature={selectWorkspaceFeature} expandedNodeIds={workspaceExpandedNodeIds} onToggleNode={toggleWorkspaceTreeNode} onOpenTrace={() => setView("trace")} treeMode={workspaceTreeMode} onTreeModeChange={changeWorkspaceTreeMode} treeModeCounts={workspaceTreeModeCounts} analysisModelProfile={analysisModelReady ? analysisModelProfile : null} apiBase={apiBase} apiToken={apiToken} onRequireModel={() => { setAnalysisSettingsOpen(true); setConnectionOpen(false); }} />}
          {view === "trace" && (visibleWorkspaceAnalysis && !liveScenario ? <WorkspaceTraceabilityView analysis={visibleWorkspaceAnalysis} selectedFeatureId={workspaceFeatureId} onSelectFeature={selectWorkspaceFeature} selectedBlock={workspaceTraceBlock} setSelectedBlock={setWorkspaceTraceBlock} expandedNodeIds={workspaceExpandedNodeIds} onToggleNode={toggleWorkspaceTreeNode} onManageWorkspace={() => setView("workspace")} treeMode={workspaceTreeMode} onTreeModeChange={changeWorkspaceTreeMode} treeModeCounts={workspaceTreeModeCounts} /> : <TraceView scenario={scenario} demo={!liveScenario} scenarioKey={scenarioKey} setScenarioKey={setScenarioKey} selectedBlock={selectedTraceBlock} setSelectedBlock={setSelectedTraceBlock} />)}
          {view === "graph" && (visibleWorkspaceAnalysis && !liveScenario ? <WorkspaceGraphSurface analysis={visibleWorkspaceAnalysis} selectedFeatureId={workspaceFeatureId} onSelectFeature={selectWorkspaceFeature} expandedNodeIds={workspaceExpandedNodeIds} onToggleNode={toggleWorkspaceTreeNode} treeMode={workspaceTreeMode} onTreeModeChange={changeWorkspaceTreeMode} treeModeCounts={workspaceTreeModeCounts}><GraphView key={`${visibleWorkspaceAnalysis.projectId}:${workspaceTreeMode}:${workspaceFeatureId}`} apiBase={apiBase} apiToken={apiToken} projectId={projectId} featureId={workspaceFeatureId} snapshotId={snapshotId} scenario={scenario} live={false} workspaceAnalysis={visibleWorkspaceAnalysis} /></WorkspaceGraphSurface> : <GraphView apiBase={apiBase} apiToken={apiToken} projectId={projectId} featureId={featureId} snapshotId={snapshotId} scenario={scenario} live={Boolean(liveScenario)} />)}
          {view === "review" && <ReviewView apiBase={apiBase} apiToken={apiToken} projectId={projectId} />}
          {view === "impact" && <ImpactView apiBase={apiBase} apiToken={apiToken} projectId={projectId} />}
          {view === "metrics" && <MetricsView apiBase={apiBase} apiToken={apiToken} projectId={projectId} snapshotId={snapshotId} />}
        </main>
      </div>
    </LanguageContext.Provider>
  );
}

function FeatureTreeBranch({ node, selectedFeatureId, onSelect, expandedNodeIds, onToggleNode, selectedNodeId = "", onSelectNode }: { node: LocalFeatureTreeNode; selectedFeatureId: string; onSelect: (featureId: string) => void; expandedNodeIds: Set<string>; onToggleNode: (nodeId: string) => void; selectedNodeId?: string; onSelectNode?: (node: LocalFeatureTreeNode) => void }) {
  const { term } = useI18n();
  const open = expandedNodeIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const displayLabel = node.kind === "GROUP" ? term(node.label) : node.label;
  if (node.kind === "FEATURE") {
    return (
      <li>
        <button className={`feature-tree-leaf ${selectedNodeId === node.id || (!selectedNodeId && selectedFeatureId === node.featureId) ? "selected" : ""}`} aria-pressed={selectedNodeId === node.id || (!selectedNodeId && selectedFeatureId === node.featureId)} onClick={() => { onSelectNode?.(node); if (node.featureId) onSelect(node.featureId); }}>
          <span className="feature-tree-leaf-mark">◇</span>
          <span className="feature-tree-leaf-copy"><b>{displayLabel}</b>{node.detail && <small>{node.detail}</small>}</span>
          {node.badge && <em>{node.badge}</em>}
        </button>
      </li>
    );
  }
  return (
    <li className={`feature-tree-branch ${node.kind.toLowerCase()}`}>
      <button title={node.detail} className={`feature-tree-toggle ${selectedNodeId === node.id ? "selected" : ""}`} aria-expanded={open} aria-pressed={selectedNodeId === node.id} onClick={() => { onSelectNode?.(node); onToggleNode(node.id); }}>
        <span>{hasChildren ? (open ? "▾" : "▸") : "·"}</span>
        <b>{displayLabel}</b>
        <small>{term(node.kind)} · {node.featureCount}</small>
      </button>
      {open && hasChildren && <ul>{node.children.map((child) => <FeatureTreeBranch key={child.id} node={child} selectedFeatureId={selectedFeatureId} onSelect={onSelect} expandedNodeIds={expandedNodeIds} onToggleNode={onToggleNode} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />)}</ul>}
    </li>
  );
}

type WorkspaceTreeModeProps = {
  treeMode: LocalFeatureTreeMode;
  onTreeModeChange: (mode: LocalFeatureTreeMode) => void;
  treeModeCounts: Record<LocalFeatureTreeMode, number>;
};

function WorkspaceTreeModeSwitch({ treeMode, onTreeModeChange, treeModeCounts }: WorkspaceTreeModeProps) {
  const { t } = useI18n();
  const options: Array<{ mode: LocalFeatureTreeMode; label: string; hint: string }> = [
    { mode: "BUSINESS", label: t("纯业务功能", "Business features"), hint: t("不含接口与工程命令", "No APIs or commands") },
    { mode: "API", label: t("API 接口", "API endpoints"), hint: t("仅展示 HTTP 接口", "HTTP endpoints only") },
  ];
  return (
    <div className="feature-tree-mode-switch" role="group" aria-label={t("功能树模式", "Feature tree mode")}>
      {options.map((option) => <button key={option.mode} type="button" className={treeMode === option.mode ? "active" : ""} aria-pressed={treeMode === option.mode} onClick={() => onTreeModeChange(option.mode)}><span><b>{option.label}</b><small>{option.hint}</small></span><em>{treeModeCounts[option.mode].toLocaleString()}</em></button>)}
    </div>
  );
}

function WorkspaceFeatureDetail({ feature, block, setBlock }: { feature: LocalFeatureCandidate; block: WorkspaceTraceBlock; setBlock: (block: WorkspaceTraceBlock) => void }) {
  const { t, term, role } = useI18n();
  const blocks: Array<{ key: WorkspaceTraceBlock; label: string; state: string; count: string }> = [
    { key: "description", label: t("功能描述", "Feature description"), state: feature.dimensions.authority, count: "1" },
    { key: "design", label: t("设计实现", "Design implementation"), state: feature.dimensions.conformance, count: "1" },
    { key: "configuration", label: t("配置", "Configuration"), state: feature.configurations.length > 0 ? "ACTIVE" : "UNKNOWN", count: String(feature.configurations.length) },
    { key: "test-case", label: t("测试用例", "Test cases"), state: feature.tests.length > 0 ? "PARTIAL" : "NOT_RUN", count: String(feature.tests.length) },
    { key: "test-result", label: t("测试结果", "Test results"), state: feature.dimensions.verification, count: "0" },
  ];
  return (
    <article className="workspace-feature-detail">
      <header className="workspace-feature-head">
        <div>
          <p className="eyebrow">{term(feature.kind)} · {feature.id}</p>
          <h2>{feature.displayName ?? feature.name}</h2>
          <p>{feature.sourcePath}:{feature.startLine} · {feature.modulePath}</p>
        </div>
        <span className={`mode-badge ${feature.modelClassification ? "live" : ""}`}>{feature.modelClassification ? t("模型增强候选", "Model-enriched candidate") : t("扫描候选", "Discovered candidate")}</span>
      </header>
      <div className="workspace-dimensions" aria-label={t("候选功能可信维度", "Candidate feature trust dimensions")}>
        {Object.entries(feature.dimensions).map(([key, value]) => <div key={key}><span>{term(({ authority: "业务权威", conformance: "实现符合性", verification: "验证结果", freshness: "证据新鲜度", conflict: "冲突" } as Record<string, string>)[key] ?? key)}</span><b className={tone(value)}>{term(value)}</b></div>)}
      </div>
      <nav className="workspace-trace-tabs" aria-label={t("功能追溯五大块", "Five feature trace blocks")}>
        {blocks.map((item) => <button key={item.key} className={block === item.key ? "active" : ""} aria-pressed={block === item.key} onClick={() => setBlock(item.key)}><span>{item.label}</span><b>{term(item.state)}</b><small>{item.count}</small></button>)}
      </nav>
      <div className="workspace-trace-content">
        {block === "description" && <section className="workspace-document"><div className="artifact-intro"><div><h3>{t("完整功能说明", "Complete feature description")}</h3><p>{t("以下内容先由确定性源码证据发现，再由已验证模型在有界上下文内整理；仍是待业务负责人确认的候选说明。", "This description starts from deterministic source evidence and is then organized by a verified model within bounded context. It remains a candidate pending business-owner confirmation.")}</p></div><span>{term(feature.dimensions.authority)}</span></div><dl><dt>{t("候选名称", "Candidate name")}</dt><dd>{feature.displayName ?? feature.name}</dd><dt>{t("发现类型", "Discovery type")}</dt><dd>{term(feature.kind)}</dd><dt>{t("业务逻辑线索", "Business logic clue")}</dt><dd>{feature.description}</dd><dt>{t("适用模块", "Applicable module")}</dt><dd>{feature.modulePath}</dd>{feature.modelClassification && <><dt>{t("模型业务分类", "Model business classification")}</dt><dd>{feature.modelClassification.domain} · {term(feature.modelClassification.group)} · {term(feature.modelClassification.confidence)}</dd><dt>{t("分类依据", "Classification rationale")}</dt><dd>{feature.modelClassification.rationale}</dd></>}<dt>{t("前置条件与权限", "Prerequisites and permissions")}</dt><dd>{t("源码与模型都不能替代业务授权确认，必须由业务负责人补充并确认。", "Neither source evidence nor a model can replace governed business confirmation; a business owner must supply and confirm these details.")}</dd></dl></section>}
        {block === "design" && <section className="workspace-code">{feature.apiDesign && <div className="workspace-api-design"><div><span>{t("接口协议", "Protocol")}</span><b>{feature.apiDesign.protocol}</b></div><div><span>{t("方法与路径", "Method and path")}</span><b>{feature.apiDesign.method} {feature.apiDesign.path}</b></div><div><span>{t("处理逻辑入口", "Handler")}</span><b>{feature.apiDesign.handler ?? t("尚未匹配", "Not matched")}</b></div><div><span>{t("接口设计来源", "Design source")}</span><b>{feature.apiDesign.source}</b></div></div>}{(feature.implementationBlocks ?? [{ path: feature.sourcePath, symbol: feature.name, startLine: feature.startLine, relation: "HANDLER" as const, code: feature.code }]).map((implementation, index) => <details key={`${implementation.path}:${implementation.startLine}:${index}`} open={index === 0}><summary><div className="reader-file-head"><div><span className="file-type code">{implementation.path.split(".").at(-1)?.toUpperCase()}</span><div><b>{implementation.symbol}</b><small>{implementation.path}:{implementation.startLine}</small></div></div><span>{term(implementation.relation)}</span></div></summary><SourceCodeViewer content={implementation.code} /></details>)}</section>}
        {block === "configuration" && <section className="workspace-related-list"><div className="artifact-intro"><div><h3>{t("相关配置线索", "Related configuration clues")}</h3><p>{t("展示工程中发现的配置文件；在形成治理映射前，不声称每一项都控制当前功能。", "Shows configuration files discovered in the project. No item is claimed to control this feature until a governed mapping exists.")}</p></div><span>{feature.configurations.length}</span></div>{feature.configurations.length === 0 ? <div className="gap-empty">{t("未发现受支持的配置文件。", "No supported configuration files were discovered.")}</div> : feature.configurations.map((configuration) => <details key={configuration.path}><summary><b>{configuration.key}</b><span>{configuration.path}</span></summary><SourceCodeViewer content={configuration.value} /></details>)}</section>}
        {block === "test-case" && <section className="workspace-related-list"><div className="artifact-intro"><div><h3>{t("相关测试用例线索", "Related test-case clues")}</h3><p>{t("根据文件名、源码引用和符号名称建立候选关联；后续仍需生成并批准正式 TestSpec。", "Candidate links are based on filenames, source references, and symbol names. A formal TestSpec must still be generated and approved.")}</p></div><span>{feature.tests.length}</span></div>{feature.tests.length === 0 ? <div className="gap-empty">{t("没有发现关联测试，这是一个阻断级 TraceGap。", "No related tests were discovered; this is a blocking TraceGap.")}</div> : feature.tests.map((test) => <details key={test.path}><summary><b>{test.title}</b><span>{test.path}</span></summary><SourceCodeViewer content={test.code} /></details>)}</section>}
        {block === "test-result" && <section className="workspace-result-empty"><span className="result-status not_run">{term("NOT_RUN")}</span><h3>{t("当前没有可信执行结果", "No trusted execution result is available")}</h3><p>{t("本地扫描只发现源码事实，不执行工程代码。需要批准的 TestSpec、目标环境、Runner 身份与签名 Evidence 后，结果才能进入追溯链。", "The local scan discovers source Facts but does not execute project code. An approved TestSpec, target environment, Runner identity, and signed Evidence are required before results enter the trace chain.")}</p></section>}
      </div>
      <section className="workspace-gaps"><div className="panel-head"><div><h3>TraceGap</h3><p>{t("从扫描候选升级为可信 Feature 仍需完成的工作", "Work required to promote a discovered candidate into a trusted Feature")}</p></div><span className="mode-badge">{feature.gaps.length} OPEN</span></div>{feature.gaps.map((gap) => <div key={gap.type}><span>{term(gap.severity)} · {term(gap.type)}</span><b>{role(gap.ownerRole)}</b></div>)}</section>
    </article>
  );
}

type WorkspaceFeatureExplorerProps = {
  analysis: LocalWorkspaceAnalysis;
  selectedFeatureId: string;
  onSelectFeature: (featureId: string) => void;
  selectedBlock: WorkspaceTraceBlock;
  setSelectedBlock: (block: WorkspaceTraceBlock) => void;
  expandedNodeIds: Set<string>;
  onToggleNode: (nodeId: string) => void;
} & WorkspaceTreeModeProps;

function WorkspaceFeatureExplorer({ analysis, selectedFeatureId, onSelectFeature, selectedBlock, setSelectedBlock, expandedNodeIds, onToggleNode, treeMode, onTreeModeChange, treeModeCounts }: WorkspaceFeatureExplorerProps) {
  const { t } = useI18n();
  const selectedFeature = analysis.features.find((feature) => feature.id === selectedFeatureId) ?? analysis.features[0];
  return (
    <section className="workspace-analysis-shell">
      <aside className="panel feature-tree-panel"><div className="feature-tree-head"><div><p className="eyebrow">Feature tree</p><h2>{analysis.workspaceName}</h2></div><b>{analysis.features.length}</b></div><WorkspaceTreeModeSwitch treeMode={treeMode} onTreeModeChange={onTreeModeChange} treeModeCounts={treeModeCounts} /><div className="workspace-scan-stats"><span>{analysis.supportedFileCount} {t("已分析", "analyzed")}</span><span>{analysis.skippedFileCount} {t("已跳过", "skipped")}</span><small>{analysis.scannedAt}</small></div><ul className="feature-tree"><FeatureTreeBranch node={analysis.tree} selectedFeatureId={selectedFeature?.id ?? ""} onSelect={onSelectFeature} expandedNodeIds={expandedNodeIds} onToggleNode={onToggleNode} /></ul></aside>
      <div className="panel workspace-analysis-main">{selectedFeature ? <WorkspaceFeatureDetail feature={selectedFeature} block={selectedBlock} setBlock={setSelectedBlock} /> : <div className="workspace-no-features"><h2>{t("未发现候选功能", "No candidate features discovered")}</h2><p>{t("当前扫描器识别 Spring MVC/WebFlux、JAX-RS、Java 后端组件与接口方法，以及 JavaScript/TypeScript、Python、Go、C#、Rust 能力、OpenAPI 路径和工程命令。", "The scanner recognizes Spring MVC/WebFlux, JAX-RS, Java backend components and interface methods, plus JavaScript/TypeScript, Python, Go, C#, and Rust capabilities, OpenAPI paths, and project commands.")}</p></div>}</div>
    </section>
  );
}

function percentage(value: number, total: number) {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "—";
}

function WorkspaceAnalysisDashboard({ analysis, selectedFeatureId, onSelectFeature, expandedNodeIds, onToggleNode, treeMode, onTreeModeChange, treeModeCounts }: Pick<WorkspaceFeatureExplorerProps, "analysis" | "selectedFeatureId" | "onSelectFeature" | "expandedNodeIds" | "onToggleNode" | "treeMode" | "onTreeModeChange" | "treeModeCounts">) {
  const { t, term } = useI18n();
  const [selectedNodeId, setSelectedNodeId] = useState(analysis.tree.id);
  const scope = localWorkspaceStatisticsForNode(analysis, selectedNodeId);
  const statistics = scope.statistics;
  const childStatistics = scope.node.children.map((node) => ({ node, statistics: localWorkspaceStatisticsForNode(analysis, node.id).statistics }));
  const cards: Array<{ label: string; value: string; meta: string; state: "good" | "warn" | "bad" | "neutral" }> = [
    { label: t("功能点", "Features"), value: statistics.featureCount.toLocaleString(), meta: t("当前层级全部功能", "All Features in scope"), state: "neutral" },
    { label: t("设计实现", "Design / implementation"), value: statistics.designImplementationCount.toLocaleString(), meta: `${percentage(statistics.designImplementationCount, statistics.featureCount)} ${t("已定位源码", "source located")}`, state: statistics.designImplementationCount === statistics.featureCount ? "good" : "warn" },
    { label: t("配置", "Configuration"), value: statistics.configurationItemCount.toLocaleString(), meta: `${statistics.configuredFeatureCount.toLocaleString()} / ${statistics.featureCount.toLocaleString()} ${t("个功能有关联", "Features linked")}`, state: statistics.configuredFeatureCount === statistics.featureCount && statistics.featureCount > 0 ? "good" : "warn" },
    { label: t("测试用例", "Test cases"), value: statistics.testCaseCount.toLocaleString(), meta: `${statistics.testedFeatureCount.toLocaleString()} / ${statistics.featureCount.toLocaleString()} ${t("个功能有关联", "Features linked")}`, state: statistics.testedFeatureCount === statistics.featureCount && statistics.featureCount > 0 ? "good" : "warn" },
    { label: t("执行结果", "Execution results"), value: `${statistics.executedFeatureCount.toLocaleString()} / ${statistics.featureCount.toLocaleString()}`, meta: `${t("通过", "Passed")} ${statistics.execution.passed} · ${t("失败/错误", "Failed / error")} ${statistics.execution.failed + statistics.execution.error}`, state: statistics.execution.failed + statistics.execution.error > 0 ? "bad" : statistics.execution.notRun > 0 ? "warn" : "good" },
    { label: t("待人工确认", "Pending human confirmation"), value: statistics.pendingHumanConfirmationCount.toLocaleString(), meta: t("业务权威尚未确认", "Business authority not confirmed"), state: statistics.pendingHumanConfirmationCount > 0 ? "warn" : "good" },
    { label: t("证据链完整", "Complete evidence chains"), value: `${statistics.completeEvidenceChainCount.toLocaleString()} / ${statistics.featureCount.toLocaleString()}`, meta: `${statistics.incompleteEvidenceChainCount.toLocaleString()} ${t("条链仍不完整", "chains remain incomplete")}`, state: statistics.incompleteEvidenceChainCount > 0 ? "warn" : "good" },
    { label: t("明确不符合", "Explicitly nonconforming"), value: statistics.nonconformingFeatureCount.toLocaleString(), meta: t("不包含未知、待审核和未执行", "Excludes unknown, unreviewed, and not run"), state: statistics.nonconformingFeatureCount > 0 ? "bad" : "good" },
  ];

  function selectScope(node: LocalFeatureTreeNode) {
    setSelectedNodeId(node.id);
    if (node.children.length > 0 && !expandedNodeIds.has(node.id)) onToggleNode(node.id);
  }

  return (
    <section className="workspace-analysis-shell">
      <aside className="panel feature-tree-panel">
        <div className="feature-tree-head"><div><p className="eyebrow">Analysis scope</p><h2>{analysis.workspaceName}</h2></div><b>{analysis.features.length}</b></div>
        <WorkspaceTreeModeSwitch treeMode={treeMode} onTreeModeChange={onTreeModeChange} treeModeCounts={treeModeCounts} />
        <div className="workspace-scan-stats"><span>{analysis.supportedFileCount} {t("已分析", "analyzed")}</span><span>{analysis.skippedFileCount} {t("已跳过", "skipped")}</span><small>{analysis.scannedAt}</small></div>
        <p className="workspace-analysis-tree-help">{t("选择任意层级，右侧重新统计该节点下的全部功能。", "Select any level to recalculate all Features below that node.")}</p>
        <ul className="feature-tree"><FeatureTreeBranch node={analysis.tree} selectedFeatureId={selectedFeatureId} onSelect={onSelectFeature} expandedNodeIds={expandedNodeIds} onToggleNode={onToggleNode} selectedNodeId={scope.node.id} onSelectNode={selectScope} /></ul>
      </aside>

      <div className="workspace-statistics-main">
        <section className="panel workspace-statistics-overview">
          <header className="workspace-statistics-head">
            <div><p className="eyebrow">{term(scope.node.kind)} · {t("分层统计", "Hierarchical statistics")}</p><h2>{scope.node.kind === "GROUP" ? term(scope.node.label) : scope.node.label}</h2><p>{t("统计仅覆盖当前树节点及其全部下级，不会混入其他 Workspace 数据。", "Statistics cover only this tree node and all descendants; data from other Workspaces is never mixed in.")}</p></div>
            <span className="mode-badge">{statistics.featureCount} FEATURES</span>
          </header>
          <div className="workspace-stat-card-grid">
            {cards.map((card) => <article key={card.label} className={`workspace-stat-card ${card.state}`}><span>{card.label}</span><strong>{card.value}</strong><small>{card.meta}</small></article>)}
          </div>
        </section>

        <section className="workspace-statistics-grid">
          <article className="panel workspace-stat-panel">
            <div className="workspace-stat-section-head"><div><p className="eyebrow">Coverage</p><h3>{t("功能类型与覆盖", "Feature types and coverage")}</h3></div></div>
            <div className="workspace-kind-grid">
              {(["ENDPOINT", "CODE_SYMBOL", "COMMAND"] as const).map((kind) => <div key={kind}><span>{term(kind)}</span><b>{statistics.byKind[kind]}</b><small>{percentage(statistics.byKind[kind], statistics.featureCount)}</small></div>)}
            </div>
            <dl className="workspace-stat-list">
              <div><dt>{t("源码实现覆盖", "Source implementation coverage")}</dt><dd>{statistics.designImplementationCount} / {statistics.featureCount}</dd></div>
              <div><dt>{t("配置关联覆盖", "Configuration linkage coverage")}</dt><dd>{statistics.configuredFeatureCount} / {statistics.featureCount}</dd></div>
              <div><dt>{t("测试关联覆盖", "Test linkage coverage")}</dt><dd>{statistics.testedFeatureCount} / {statistics.featureCount}</dd></div>
            </dl>
          </article>

          <article className="panel workspace-stat-panel">
            <div className="workspace-stat-section-head"><div><p className="eyebrow">Execution</p><h3>{t("执行结果分布", "Execution result distribution")}</h3></div><b>{statistics.executedFeatureCount} / {statistics.featureCount}</b></div>
            <div className="workspace-execution-grid">
              <div className="pass"><span>{t("通过", "Passed")}</span><b>{statistics.execution.passed}</b></div>
              <div className="fail"><span>{t("失败", "Failed")}</span><b>{statistics.execution.failed}</b></div>
              <div className="error"><span>{t("错误", "Error")}</span><b>{statistics.execution.error}</b></div>
              <div className="skip"><span>{t("跳过", "Skipped")}</span><b>{statistics.execution.skipped}</b></div>
              <div className="not-run"><span>{t("未执行", "Not run")}</span><b>{statistics.execution.notRun}</b></div>
            </div>
            <p className="workspace-stat-note">{t("本地扫描不会执行工程代码；只有可信 Runner 回传的结果才能计入已执行。", "Local scanning never executes project code; only results returned by a trusted Runner count as executed.")}</p>
          </article>

          <article className="panel workspace-stat-panel workspace-evidence-panel">
            <div className="workspace-stat-section-head"><div><p className="eyebrow">Evidence & quality</p><h3>{t("证据链与不符合", "Evidence chains and nonconformance")}</h3></div></div>
            <dl className="workspace-stat-list">
              <div><dt>{t("完整证据链", "Complete evidence chains")}</dt><dd className="good">{statistics.completeEvidenceChainCount}</dd></div>
              <div><dt>{t("不完整证据链", "Incomplete evidence chains")}</dt><dd className="warn">{statistics.incompleteEvidenceChainCount}</dd></div>
              <div><dt>{t("阻断级 TraceGap", "Blocking TraceGaps")}</dt><dd className="bad">{statistics.blockingGapCount}</dd></div>
              <div><dt>{t("警告级 TraceGap", "Warning TraceGaps")}</dt><dd className="warn">{statistics.warningGapCount}</dd></div>
              <div><dt>{t("实现待审核", "Implementation awaiting review")}</dt><dd className="warn">{statistics.unreviewedImplementationCount}</dd></div>
              <div><dt>{t("冲突", "Conflicts")}</dt><dd className={statistics.conflictCount > 0 ? "bad" : "good"}>{statistics.conflictCount}</dd></div>
              <div><dt>{t("明确不符合功能", "Explicitly nonconforming Features")}</dt><dd className={statistics.nonconformingFeatureCount > 0 ? "bad" : "good"}>{statistics.nonconformingFeatureCount}</dd></div>
            </dl>
          </article>
        </section>

        <section className="panel workspace-layer-statistics">
          <div className="workspace-stat-section-head"><div><p className="eyebrow">Child scopes</p><h3>{t("下一层统计", "Next-level statistics")}</h3><p>{t("点击层级名称可继续下钻；叶子功能仍可在“功能追溯”查看完整追踪链。", "Select a scope to drill down; leaf Features retain their complete chains in Feature traceability.")}</p></div><span>{childStatistics.length}</span></div>
          {childStatistics.length === 0 ? <div className="workspace-stat-empty">{t("当前已是功能叶子节点。", "The current scope is a Feature leaf.")}</div> : <div className="workspace-layer-table-wrap"><table className="workspace-layer-table"><thead><tr><th>{t("层级", "Scope")}</th><th>{t("功能", "Features")}</th><th>{t("设计实现", "Implementation")}</th><th>{t("配置", "Config")}</th><th>{t("测试", "Tests")}</th><th>{t("已执行", "Executed")}</th><th>{t("待确认", "Pending")}</th><th>TraceGap</th><th>{t("不符合", "Nonconforming")}</th></tr></thead><tbody>{childStatistics.map(({ node, statistics: child }) => <tr key={node.id}><td><button onClick={() => selectScope(node)}><b>{node.kind === "GROUP" ? term(node.label) : node.label}</b><small>{term(node.kind)} · {node.featureCount}</small></button></td><td>{child.featureCount}</td><td>{child.designImplementationCount}</td><td>{child.configurationItemCount}</td><td>{child.testCaseCount}</td><td>{child.executedFeatureCount}</td><td>{child.pendingHumanConfirmationCount}</td><td>{child.blockingGapCount + child.warningGapCount}</td><td className={child.nonconformingFeatureCount > 0 ? "bad" : ""}>{child.nonconformingFeatureCount}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </section>
  );
}

function WorkspaceTraceabilityView({ analysis, selectedFeatureId, onSelectFeature, selectedBlock, setSelectedBlock, expandedNodeIds, onToggleNode, onManageWorkspace, treeMode, onTreeModeChange, treeModeCounts }: WorkspaceFeatureExplorerProps & { onManageWorkspace: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <section className="panel workspace-trace-overview">
        <div className="panel-head">
          <div><p className="eyebrow">Initialized workspace</p><h1>{t("从功能树逐项查看端到端追溯链", "Inspect each end-to-end trace chain from the Feature tree")}</h1><p>{t(`Workspace 已由 ${analysis.supportedFileCount.toLocaleString()} 个受支持文件初始化。左侧功能树和当前选择在全局导航间保持一致。`, `The Workspace was initialized from ${analysis.supportedFileCount.toLocaleString()} supported files. The Feature tree and current selection remain consistent across global navigation.`)}</p></div>
          <button className="button" onClick={onManageWorkspace}>{t("管理 / 重新扫描", "Manage / rescan")}</button>
        </div>
      </section>
      <WorkspaceFeatureExplorer analysis={analysis} selectedFeatureId={selectedFeatureId} onSelectFeature={onSelectFeature} selectedBlock={selectedBlock} setSelectedBlock={setSelectedBlock} expandedNodeIds={expandedNodeIds} onToggleNode={onToggleNode} treeMode={treeMode} onTreeModeChange={onTreeModeChange} treeModeCounts={treeModeCounts} />
    </>
  );
}

type WorkspaceAnalysisViewProps = Omit<WorkspaceFeatureExplorerProps, "analysis" | "selectedBlock" | "setSelectedBlock"> & {
  workspaceName: string;
  setWorkspaceName: (value: string) => void;
  projectId: string;
  setProjectId: (value: string) => void;
  selectedFiles: File[];
  setSelectedFiles: (files: File[]) => void;
  directoryName: string;
  setDirectoryName: (value: string) => void;
  registeredRootName: string;
  analysis: LocalWorkspaceAnalysis | null;
  fileRecords: LocalWorkspaceFileRecord[];
  onInitialize: (analysis: LocalWorkspaceAnalysis, records: LocalWorkspaceFileRecord[], rootName: string) => Promise<void>;
  onOpenTrace: () => void;
  analysisModelProfile: AnalysisModelProfile | null;
  apiBase: string;
  apiToken: string;
  onRequireModel: () => void;
};

function WorkspaceAnalysisView({ workspaceName, setWorkspaceName, projectId, setProjectId, selectedFiles, setSelectedFiles, directoryName, setDirectoryName, registeredRootName, analysis, fileRecords, onInitialize, selectedFeatureId, onSelectFeature, expandedNodeIds, onToggleNode, onOpenTrace, treeMode, onTreeModeChange, treeModeCounts, analysisModelProfile, apiBase, apiToken, onRequireModel }: WorkspaceAnalysisViewProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pauseRequestedRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ completed: number; total: number } | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    inputRef.current?.setAttribute("webkitdirectory", "");
    inputRef.current?.setAttribute("directory", "");
  }, []);

  function selectDirectory(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    setSelectedFiles(files);
    setMessage("");
    const root = files[0]?.webkitRelativePath.split("/")[0] ?? "";
    setDirectoryName(root);
    if (root && !analysis) {
      setWorkspaceName(root);
      setProjectId(`PROJECT-${root.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase()}`);
    }
    event.currentTarget.value = "";
  }

  async function scanWorkspace() {
    if (!analysisModelProfile?.ready) {
      setMessage(t("请先在全局“配置分析模型”中填写 API URL、模型和 API Key，并通过连接验证。", "Configure the API URL, model, and API key in the global model settings and verify the connection before analysis."));
      onRequireModel();
      return;
    }
    setScanning(true);
    pauseRequestedRef.current = false;
    setMessage("");
    try {
      const textExtensions = /\.(?:[cm]?[jt]sx?|py|java|go|cs|rs|vue|json|md|ya?ml|sql|properties|env|xml|gradle|kts)$/i;
      const ignored = /(^|\/)(?:\.git|node_modules|dist|build|target|out|\.gradle|\.next|\.vinext|coverage|vendor)(\/|$)/;
      if (analysis && registeredRootName && directoryName !== registeredRootName) throw new Error(t(`请选择原工程目录“${registeredRootName}”进行增量扫描。`, `Select the original project directory “${registeredRootName}” for an incremental scan.`));
      const activeRun = await loadLocalWorkspaceAnalysisRun(projectId);
      const canResume = activeRun?.rootName === directoryName
        && activeRun.scannerVersion === localWorkspaceScannerVersion
        && activeRun.plannedFileCount === selectedFiles.length
        && activeRun.modelProfileId === analysisModelProfile.id;
      const resumedRecords = new Map((canResume ? activeRun.records : []).map((record) => [record.path, record]));
      const previousRecords = new Map(fileRecords.map((record) => [record.path, record]));
      const nextRecords: LocalWorkspaceFileRecord[] = [];
      const currentPaths = new Set<string>();
      let added = canResume ? activeRun.counters.added : 0;
      let modified = canResume ? activeRun.counters.modified : 0;
      let unchanged = canResume ? activeRun.counters.unchanged : 0;
      const startedAt = canResume ? activeRun.startedAt : new Date().toISOString();
      const runId = `${projectId}:ACTIVE`;
      const batchSize = 120;
      for (let offset = 0; offset < selectedFiles.length; offset += batchSize) {
        const batch = selectedFiles.slice(offset, offset + batchSize);
        const records = await Promise.all(batch.map(async (file) => {
          const path = file.webkitRelativePath || file.name;
          const relativePath = path.split("/").slice(1).join("/") || path;
          currentPaths.add(relativePath);
          const resumed = resumedRecords.get(relativePath);
          if (resumed && resumed.scannerVersion === localWorkspaceScannerVersion && resumed.size === file.size && resumed.lastModified === file.lastModified) return resumed;
          const previous = previousRecords.get(relativePath);
          if (previous && previous.scannerVersion === localWorkspaceScannerVersion && previous.size === file.size && previous.lastModified === file.lastModified) {
            unchanged += 1;
            return previous;
          }
          const name = path.split("/").at(-1)?.toLowerCase() ?? "";
          const actualEnvironmentFile = /^\.env(?:\.[^.]+)?$/.test(name) && !/\.(?:example|sample|template)$/.test(name);
          const supportedText = textExtensions.test(path) || /^\.env\.(?:example|sample|template)$/.test(name);
          const readable = !actualEnvironmentFile && !ignored.test(path) && supportedText && file.size <= 768 * 1024;
          const input: LocalWorkspaceInputFile = { path: relativePath, size: file.size, lastModified: file.lastModified, content: readable ? await file.text() : "" };
          if (previous) modified += 1;
          else added += 1;
          return scanLocalWorkspaceFile(input);
        }));
        nextRecords.push(...records);
        const completed = Math.min(offset + batch.length, selectedFiles.length);
        const checkpoint: LocalWorkspaceAnalysisRunCheckpoint = {
          id: runId,
          projectId,
          rootName: directoryName,
          mode: analysis ? "INCREMENTAL" : "FULL",
          engine: "HYBRID",
          status: pauseRequestedRef.current ? "PAUSED" : "RUNNING",
          phase: "SCANNING",
          modelProfileId: analysisModelProfile.id,
          completedModelBatchCount: 0,
          totalModelBatchCount: 0,
          scannerVersion: localWorkspaceScannerVersion,
          plannedFileCount: selectedFiles.length,
          completedFileCount: completed,
          records: nextRecords,
          currentPaths: [...currentPaths],
          counters: { added, modified, unchanged },
          startedAt,
          updatedAt: new Date().toISOString(),
        };
        const shouldCheckpoint = pauseRequestedRef.current || completed === selectedFiles.length || Math.ceil(completed / batchSize) % 40 === 0;
        if (shouldCheckpoint) await saveLocalWorkspaceAnalysisRun(checkpoint);
        setScanProgress({ completed, total: selectedFiles.length });
        setMessage(t(`${canResume ? "正在续跑" : "正在分析"} ${completed.toLocaleString()} / ${selectedFiles.length.toLocaleString()} 个工程文件${shouldCheckpoint ? "；检查点已保存" : ""}。`, `${canResume ? "Resuming" : "Analyzing"} ${completed.toLocaleString()} / ${selectedFiles.length.toLocaleString()} project files${shouldCheckpoint ? "; checkpoint saved" : ""}.`));
        if (pauseRequestedRef.current) {
          setMessage(t(`分析已暂停在 ${completed.toLocaleString()} / ${selectedFiles.length.toLocaleString()}；重新选择同一目录后可从检查点继续。`, `Analysis paused at ${completed.toLocaleString()} / ${selectedFiles.length.toLocaleString()}; reselect the same directory to resume from the checkpoint.`));
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const deleted = [...previousRecords.keys()].filter((path) => !currentPaths.has(path)).length;
      let enrichedRecords = nextRecords;
      const modelBatches = workspaceModelCandidateBatches(enrichedRecords, analysisModelProfile.id);
      for (let index = 0; index < modelBatches.length; index += 1) {
        const enrichments = await enrichWorkspaceCandidateBatch(apiBase, apiToken, analysisModelProfile.id, modelBatches[index]);
        enrichedRecords = applyLocalModelEnrichment(enrichedRecords, analysisModelProfile.id, enrichments);
        const completedModelBatchCount = index + 1;
        await saveLocalWorkspaceAnalysisRun({
          id: runId,
          projectId,
          rootName: directoryName,
          mode: analysis ? "INCREMENTAL" : "FULL",
          engine: "HYBRID",
          status: pauseRequestedRef.current ? "PAUSED" : "RUNNING",
          phase: "MODEL_ENRICHMENT",
          modelProfileId: analysisModelProfile.id,
          completedModelBatchCount,
          totalModelBatchCount: modelBatches.length,
          scannerVersion: localWorkspaceScannerVersion,
          plannedFileCount: selectedFiles.length,
          completedFileCount: selectedFiles.length,
          records: enrichedRecords,
          currentPaths: [...currentPaths],
          counters: { added, modified, unchanged },
          startedAt,
          updatedAt: new Date().toISOString(),
        });
        setScanProgress({ completed: completedModelBatchCount, total: modelBatches.length });
        setMessage(t(`模型正在理解功能语义 ${completedModelBatchCount} / ${modelBatches.length}；检查点已保存。`, `The model is resolving feature semantics ${completedModelBatchCount} / ${modelBatches.length}; checkpoint saved.`));
        if (pauseRequestedRef.current) {
          setMessage(t(`模型分析已暂停在 ${completedModelBatchCount} / ${modelBatches.length}；重新选择同一目录后可继续。`, `Model analysis paused at ${completedModelBatchCount} / ${modelBatches.length}; reselect the same directory to resume.`));
          return;
        }
      }
      const result = analyzeLocalWorkspaceRecords({ workspaceName, projectId, records: enrichedRecords });
      await onInitialize(result, enrichedRecords, directoryName);
      await clearLocalWorkspaceAnalysisRun(projectId);
      setMessage(result.features.length > 0 ? t(`混合分析已更新 ${result.features.length} 个候选功能：新增 ${added}、修改 ${modified}、删除 ${deleted}、未变化 ${unchanged} 个文件；模型处理 ${modelBatches.length} 个有界批次。`, `Hybrid analysis updated ${result.features.length} candidate features: ${added} added, ${modified} modified, ${deleted} deleted, and ${unchanged} unchanged files; the model processed ${modelBatches.length} bounded batches.`) : t("分析完成，但没有发现有证据支持的接口或业务能力候选。", "Analysis completed, but no evidence-backed API or business-capability candidates were found."));
    } catch (error) {
      const activeRun = await loadLocalWorkspaceAnalysisRun(projectId).catch(() => undefined);
      if (activeRun) await saveLocalWorkspaceAnalysisRun({ ...activeRun, status: "PAUSED", updatedAt: new Date().toISOString() }).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : t("Workspace 分析失败；检查点已保留", "Workspace analysis failed; its checkpoint was preserved"));
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }

  return (
    <>
      <section className="panel workspace-onboarding">
        <div className="panel-head"><div><p className="eyebrow">Analysis Agent · hybrid profile</p><h1>{t("选择工程，由分析 Agent 建立功能追溯 Workspace", "Select a project and let the Analysis Agent build its traceability Workspace")}</h1><p>{t("先在本地确定性扫描十万级文件，再将候选名称、路径及必要代码片段按有界批次发送给已配置模型理解业务语义；每批保存检查点，首次全量、后续增量。API Key 只保存在 Traqen API 进程内存中。", "The Agent first scans 100,000-scale projects deterministically, then sends candidate names, paths, and necessary code excerpts to the configured model in bounded batches for semantic interpretation. Every batch is checkpointed; the first run is full and later runs are incremental. The API key stays only in Traqen API process memory.")}</p></div><span className={`mode-badge ${analysisModelProfile?.ready ? "live" : ""}`}>{analysisModelProfile?.ready ? `${analysisModelProfile.model} · ${t("已连接", "CONNECTED")}` : t("需要模型", "MODEL REQUIRED")}</span></div>
        <div className="workspace-setup-grid">
          <div className="field"><label htmlFor="workspace-name">Workspace Name</label><input id="workspace-name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /></div>
          <div className="field"><label htmlFor="workspace-project-id">Project ID</label><input id="workspace-project-id" value={projectId} onChange={(event) => setProjectId(event.target.value)} /></div>
          <div className="workspace-directory"><input ref={inputRef} className="visually-hidden" id="workspace-directory" type="file" multiple onChange={selectDirectory} /><button className="button" onClick={() => inputRef.current?.click()}>{t("选择代码工程", "Select code project")}</button><span>{directoryName || t("尚未选择目录", "No directory selected")}</span><small>{selectedFiles.length} {t("个文件", "files")}</small></div>
          <div className="workspace-analysis-actions"><button className="button primary workspace-scan-button" disabled={scanning || (Boolean(analysisModelProfile?.ready) && selectedFiles.length === 0)} onClick={() => analysisModelProfile?.ready ? void scanWorkspace() : onRequireModel()}>{scanning ? t("分析中…", "Analyzing…") : !analysisModelProfile?.ready ? t("先配置模型", "Configure model first") : analysis ? t("执行增量分析", "Run incremental analysis") : t("初始化分析", "Initialize analysis")}</button>{scanning && <button className="button" onClick={() => { pauseRequestedRef.current = true; setMessage(t("将在当前批次完成后暂停…", "Pausing after the current batch…")); }}>{t("暂停", "Pause")}</button>}</div>
        </div>
        {scanProgress && <div className="analysis-agent-progress"><span style={{ width: `${Math.round((scanProgress.completed / Math.max(1, scanProgress.total)) * 100)}%` }} /><small>{scanProgress.completed.toLocaleString()} / {scanProgress.total.toLocaleString()}</small></div>}
        {message && <div className="inline-message">{message}</div>}
        {analysis && <div className="workspace-initialized-actions"><span>{t("初始化完成：Workspace 已成为全局导航上下文。", "Initialization complete: this Workspace is now the global navigation context.")}</span><button className="button primary" onClick={onOpenTrace}>{t("进入功能追溯", "Open feature traceability")}</button></div>}
      </section>
      {analysis && <WorkspaceAnalysisDashboard key={`${analysis.projectId}:${analysis.scannedAt}:${treeMode}`} analysis={analysis} selectedFeatureId={selectedFeatureId} onSelectFeature={onSelectFeature} expandedNodeIds={expandedNodeIds} onToggleNode={onToggleNode} treeMode={treeMode} onTreeModeChange={onTreeModeChange} treeModeCounts={treeModeCounts} />}
    </>
  );
}

function WorkspaceGraphSurface({ analysis, selectedFeatureId, onSelectFeature, expandedNodeIds, onToggleNode, children, treeMode, onTreeModeChange, treeModeCounts }: Pick<WorkspaceFeatureExplorerProps, "analysis" | "selectedFeatureId" | "onSelectFeature" | "expandedNodeIds" | "onToggleNode" | "treeMode" | "onTreeModeChange" | "treeModeCounts"> & { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="workspace-graph-shell">
      <aside className="panel feature-tree-panel"><div className="feature-tree-head"><div><p className="eyebrow">Workspace graph</p><h2>{analysis.workspaceName}</h2></div><b>{analysis.features.length}</b></div><WorkspaceTreeModeSwitch treeMode={treeMode} onTreeModeChange={onTreeModeChange} treeModeCounts={treeModeCounts} /><p className="workspace-graph-help">{t("选择功能后，右侧图谱只使用该 Workspace 的扫描索引生成。", "Select a Feature to build the graph only from this Workspace's scan index.")}</p><ul className="feature-tree"><FeatureTreeBranch node={analysis.tree} selectedFeatureId={selectedFeatureId} onSelect={onSelectFeature} expandedNodeIds={expandedNodeIds} onToggleNode={onToggleNode} /></ul></aside>
      <div className="workspace-graph-main">{children}</div>
    </section>
  );
}

function workspaceGraphForAnalysis(analysis: LocalWorkspaceAnalysis, featureId: string, view: GraphViewPreset): FeatureGraph | null {
  const feature = analysis.features.find((item) => item.id === featureId) ?? analysis.features[0];
  if (!feature) return null;
  const snapshotManifestId = `LOCAL-SCAN-${analysis.scannedAt}`;
  const nodes: FeatureGraphNode[] = [
    { id: feature.id, type: "FEATURE", label: feature.displayName ?? feature.name, version: null, status: "PENDING", risk: null, provenance: "LOCAL_WORKSPACE_SCAN", source: { path: feature.sourcePath, line: feature.startLine }, details: { workspace: analysis.workspaceName, module: feature.modulePath } },
    { id: `${feature.id}:DESCRIPTION`, type: "CLAIM", label: "Candidate feature description", version: null, status: "PENDING", risk: null, provenance: "LOCAL_WORKSPACE_STATIC_DISCOVERY", source: { path: feature.sourcePath, line: feature.startLine }, details: { description: feature.description } },
    { id: `${feature.id}:IMPLEMENTATION`, type: feature.kind, label: `${feature.sourcePath}:${feature.startLine}`, version: null, status: "PENDING", risk: null, provenance: "LOCAL_WORKSPACE_SOURCE_FACT", source: { path: feature.sourcePath, line: feature.startLine }, details: { module: feature.modulePath } },
    ...feature.configurations.slice(0, 6).map((configuration, index) => ({ id: `${feature.id}:CONFIG:${index}`, type: "CONFIGURATION", label: configuration.key, version: null, status: "PENDING" as const, risk: null, provenance: "LOCAL_WORKSPACE_CONFIGURATION_CLUE", source: { path: configuration.path }, details: {} })),
    ...feature.tests.slice(0, 8).map((test, index) => ({ id: `${feature.id}:TEST:${index}`, type: "TEST_SPEC", label: test.title, version: null, status: "PENDING" as const, risk: null, provenance: "LOCAL_WORKSPACE_TEST_CLUE", source: { path: test.path }, details: {} })),
    { id: `${feature.id}:RESULT`, type: "TEST_EXECUTION", label: "No trusted execution result", version: null, status: "GAP", risk: "BLOCKING", provenance: "LOCAL_WORKSPACE_TRACE_CHAIN_EVALUATION", source: null, details: { verification: feature.dimensions.verification } },
    ...feature.gaps.map((gap, index) => ({ id: `${feature.id}:GAP:${index}`, type: "TRACE_GAP", label: gap.type, version: null, status: "GAP" as const, risk: gap.severity, provenance: "LOCAL_WORKSPACE_TRACE_CHAIN_EVALUATION", source: null, details: { ownerRole: gap.ownerRole } })),
  ];
  const edges: FeatureGraphEdge[] = [];
  const addEdge = (source: string, target: string, type: string) => edges.push({ id: `${source}:${type}:${target}`, source, target, type, provenance: "LOCAL_WORKSPACE_TRACE_CHAIN", status: "PENDING", snapshotManifestId });
  addEdge(feature.id, `${feature.id}:DESCRIPTION`, "HAS_RULE");
  addEdge(`${feature.id}:DESCRIPTION`, `${feature.id}:IMPLEMENTATION`, "CONFORMS_TO");
  const configurationNodes = nodes.filter((node) => node.type === "CONFIGURATION");
  const testNodes = nodes.filter((node) => node.type === "TEST_SPEC");
  for (const node of configurationNodes) addEdge(`${feature.id}:IMPLEMENTATION`, node.id, "CONTROLLED_BY");
  const testSource = configurationNodes.at(-1)?.id ?? `${feature.id}:IMPLEMENTATION`;
  for (const node of testNodes) addEdge(testSource, node.id, "VERIFIED_BY");
  for (const node of testNodes.length > 0 ? testNodes : [{ id: testSource }]) addEdge(node.id, `${feature.id}:RESULT`, "EXECUTED_AS");
  for (const node of nodes.filter((item) => item.type === "TRACE_GAP")) addEdge(feature.id, node.id, "HAS_GAP");
  const allowedTypes: Record<GraphViewPreset, Set<string> | null> = {
    traceability: null,
    business: new Set(["FEATURE", "CLAIM", "TRACE_GAP"]),
    implementation: new Set(["FEATURE", feature.kind, "CONFIGURATION", "TRACE_GAP"]),
    coverage: new Set(["FEATURE", "TEST_SPEC", "TEST_EXECUTION", "TRACE_GAP"]),
  };
  const allowed = allowedTypes[view];
  const visibleNodes = allowed ? nodes.filter((node) => allowed.has(node.type)) : nodes;
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  for (const node of visibleNodes.filter((item) => item.id !== feature.id && !visibleEdges.some((edge) => edge.target === item.id))) {
    visibleEdges.push({ id: `${feature.id}:SUPPORTS:${node.id}`, source: feature.id, target: node.id, type: "SUPPORTS", provenance: "LOCAL_WORKSPACE_GRAPH_PROJECTION", status: "PENDING", snapshotManifestId });
  }
  return { center: feature.id, snapshotManifestId, view, depth: 8, nodes: visibleNodes, edges: visibleEdges, truncated: feature.configurations.length > 6 || feature.tests.length > 8, availableExpansions: [] };
}

function localGraphPath(graph: FeatureGraph, fromNodeId: string, toNodeId: string): FeatureGraphPath {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodes.has(fromNodeId) || !nodes.has(toNodeId)) return { found: false, nodes: [], edges: [], hopCount: null };
  const adjacency = new Map<string, Array<{ nodeId: string; edge: FeatureGraphEdge }>>();
  for (const edge of graph.edges) {
    const forward = adjacency.get(edge.source) ?? [];
    forward.push({ nodeId: edge.target, edge });
    adjacency.set(edge.source, forward);
    const reverse = adjacency.get(edge.target) ?? [];
    reverse.push({ nodeId: edge.source, edge });
    adjacency.set(edge.target, reverse);
  }
  const queue = [fromNodeId];
  const previous = new Map<string, { nodeId: string; edge: FeatureGraphEdge } | null>([[fromNodeId, null]]);
  while (queue.length > 0 && !previous.has(toNodeId)) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (previous.has(next.nodeId)) continue;
      previous.set(next.nodeId, { nodeId: current, edge: next.edge });
      queue.push(next.nodeId);
    }
  }
  if (!previous.has(toNodeId)) return { found: false, nodes: [], edges: [], hopCount: null };
  const nodeIds: string[] = [];
  const edges: FeatureGraphEdge[] = [];
  for (let cursor: string | null = toNodeId; cursor !== null;) {
    nodeIds.push(cursor);
    const step = previous.get(cursor);
    if (!step) break;
    edges.push(step.edge);
    cursor = step.nodeId;
  }
  nodeIds.reverse();
  edges.reverse();
  return {
    found: true,
    nodes: nodeIds.map((id) => nodes.get(id) as FeatureGraphNode),
    edges,
    hopCount: edges.length,
  };
}

function GraphView({ apiBase, apiToken, projectId, featureId, snapshotId, scenario, live, workspaceAnalysis = null }: { apiBase: string; apiToken: string; projectId: string; featureId: string; snapshotId: string; scenario: Scenario; live: boolean; workspaceAnalysis?: LocalWorkspaceAnalysis | null }) {
  const { language, t, term } = useI18n();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [preset, setPreset] = useState<GraphViewPreset>("traceability");
  const [depth, setDepth] = useState(8);
  const [nodeTypes, setNodeTypes] = useState("");
  const [relations, setRelations] = useState("");
  const [remoteGraph, setRemoteGraph] = useState<FeatureGraph | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathResult, setPathResult] = useState<FeatureGraphPath | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const demoGraph = useMemo(() => demoGraphForScenario(scenario, preset), [scenario, preset]);
  const workspaceGraph = useMemo(() => workspaceAnalysis ? workspaceGraphForAnalysis(workspaceAnalysis, featureId, preset) : null, [featureId, preset, workspaceAnalysis]);
  const graph = remoteGraph ?? workspaceGraph ?? demoGraph;
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? graph.nodes[0];
  const effectivePathFrom = graph.nodes.some((node) => node.id === pathFrom) ? pathFrom : graph.center;
  const effectivePathTo = graph.nodes.some((node) => node.id === pathTo) ? pathTo : (graph.nodes.find((node) => node.type === "EVIDENCE")?.id ?? graph.nodes.at(-1)?.id ?? graph.center);
  const pathNodeIds = useMemo(() => new Set(pathResult?.nodes.map((node) => node.id) ?? []), [pathResult]);
  const pathEdgeIds = useMemo(() => new Set(pathResult?.edges.map((edge) => edge.id) ?? []), [pathResult]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const instance = cytoscape({
      container: canvasRef.current,
      elements: [
        ...graph.nodes.map((node) => ({
          data: { ...node, path: pathNodeIds.has(node.id) ? 1 : 0 },
        })),
        ...graph.edges.map((edge) => ({
          data: {
            ...edge,
            displayType: term(edge.type),
            path: pathEdgeIds.has(edge.id) ? 1 : 0,
          },
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#fffdf8",
            "border-color": "#718c7d",
            "border-width": 2,
            label: "data(label)",
            color: "#13221d",
            "font-size": 9,
            "text-wrap": "wrap",
            "text-max-width": 92,
            width: 52,
            height: 52,
            "text-valign": "bottom",
            "text-margin-y": 8,
          },
        },
        {
          selector: "node[type = 'FEATURE']",
          style: {
            "background-color": "#143f32",
            color: "#143f32",
            "border-color": "#d9ef7b",
            "border-width": 4,
            width: 68,
            height: 68,
            shape: "round-rectangle",
          },
        },
        {
          selector: "node[type = 'CLAIM']",
          style: { "background-color": "#dcece4", shape: "round-rectangle" },
        },
        {
          selector: "node[type = 'TEST_SPEC'], node[type = 'TEST_ASSERTION']",
          style: { "background-color": "#e8eef0", shape: "round-rectangle" },
        },
        {
          selector: "node[type = 'EVIDENCE']",
          style: { "background-color": "#d9ef7b", shape: "hexagon" },
        },
        {
          selector: "node[type = 'CONFLICT']",
          style: {
            "background-color": "#e98572",
            shape: "diamond",
            "border-color": "#8d3f34",
          },
        },
        {
          selector: "node[type = 'TRACE_GAP']",
          style: {
            "background-color": "#f4c666",
            shape: "octagon",
            "border-color": "#8a6724",
          },
        },
        {
          selector: "node[status = 'STALE']",
          style: { "border-style": "dashed", "background-color": "#fbf4e3" },
        },
        {
          selector: "node[path = 1]",
          style: { "border-color": "#266f50", "border-width": 5 },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#9aa79f",
            "target-arrow-color": "#9aa79f",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(displayType)",
            "font-size": 7,
            color: "#69766f",
            "text-background-color": "#f4f1e9",
            "text-background-opacity": 0.9,
            "text-background-padding": 2,
          },
        },
        {
          selector: "edge[status = 'STALE']",
          style: {
            "line-style": "dashed",
            "line-color": "#bd9345",
            "target-arrow-color": "#bd9345",
          },
        },
        {
          selector: "edge[path = 1]",
          style: {
            width: 4,
            "line-color": "#266f50",
            "target-arrow-color": "#266f50",
            "z-index": 10,
          },
        },
      ],
      layout: {
        name: "breadthfirst",
        directed: true,
        padding: 28,
        spacingFactor: 1.25,
        animate: false,
      },
      minZoom: 0.35,
      maxZoom: 2.2,
      wheelSensitivity: 0.2,
    });
    instance.on("tap", "node", (event) => setSelectedId(event.target.id()));
    return () => instance.destroy();
  }, [graph, language, pathEdgeIds, pathNodeIds, term]);

  async function loadGraph() {
    setLoading(true);
    setMessage("");
    try {
      const base = apiBase.replace(/\/$/, "");
      const parameters = new URLSearchParams({
        snapshotManifestId: snapshotId,
        view: preset,
        depth: String(depth),
        limit: "30",
      });
      for (const type of nodeTypes
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean))
        parameters.append("nodeType", type);
      for (const relation of relations
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean))
        parameters.append("relation", relation);
      const response = await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/graph?${parameters}`, { headers: apiHeaders(apiToken, { accept: "application/json" }) });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
      const loadedGraph = body as unknown as FeatureGraph;
      setRemoteGraph(loadedGraph);
      setSelectedId(loadedGraph.center);
      setPathFrom(loadedGraph.center);
      setPathTo(loadedGraph.nodes.find((node) => node.type === "EVIDENCE")?.id ?? loadedGraph.nodes.at(-1)?.id ?? loadedGraph.center);
      setPathResult(null);
      setMessage(t("已加载服务端受限图谱；节点、边和线性追踪链来自同一底层数据。", "Loaded the bounded server graph; nodes, edges, and the linear trace chain share one underlying model."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("无法加载 Feature 图谱", "Unable to load the Feature graph"));
    } finally {
      setLoading(false);
    }
  }

  async function queryPath() {
    setLoading(true);
    setMessage("");
    try {
      if (!remoteGraph) {
        const result = localGraphPath(graph, effectivePathFrom, effectivePathTo);
        setPathResult(result);
        setMessage(result.found ? t(`自 Workspace 路径已锁定：${result.hopCount} 跳。`, `Self-Workspace path locked: ${result.hopCount} hops.`) : t("所选自 Workspace 节点之间不存在路径。", "No path exists between the selected self-Workspace nodes."));
        return;
      }
      const base = apiBase.replace(/\/$/, "");
      const response = await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/graph/paths/query`, {
        method: "POST",
        headers: apiHeaders(apiToken, { "content-type": "application/json" }),
        body: JSON.stringify({
          snapshotManifestId: remoteGraph.snapshotManifestId,
          fromNodeId: effectivePathFrom,
          toNodeId: effectivePathTo,
          direction: "ANY",
          maxDepth: 8,
          view: preset,
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
      const result = body as unknown as FeatureGraphPath;
      setPathResult(result);
      setMessage(result.found ? t(`服务端路径已锁定：${result.hopCount} 跳。`, `Server path locked: ${result.hopCount} hops.`) : t("受限图谱中未找到路径。", "No path was found in the bounded graph."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("路径查询失败", "Path query failed"));
    } finally {
      setLoading(false);
    }
  }

  function changePreset(next: GraphViewPreset) {
    const nextGraph = workspaceAnalysis ? workspaceGraphForAnalysis(workspaceAnalysis, featureId, next) ?? demoGraphForScenario(scenario, next) : demoGraphForScenario(scenario, next);
    setPreset(next);
    setRemoteGraph(null);
    setSelectedId(nextGraph.center);
    setPathFrom(nextGraph.center);
    setPathTo(nextGraph.nodes.find((node) => node.type === "EVIDENCE")?.id ?? nextGraph.nodes.at(-1)?.id ?? nextGraph.center);
    setPathResult(null);
  }

  return (
    <>
      <section className="panel graph-toolbar">
        <div className="panel-head">
          <div>
            <h2>{t("Feature 可交互追溯图谱", "Interactive Feature trace graph")}</h2>
            <p>{t("默认最多 30 个节点；按业务问题渐进披露，而不是展开全量代码“毛线团”。", "Shows at most 30 nodes by default and progressively discloses the graph around a business question.")}</p>
          </div>
          <span className={`mode-badge ${remoteGraph || workspaceGraph ? "live" : ""}`}>{remoteGraph ? "LIVE GRAPH" : workspaceGraph ? t("当前 Workspace", "ACTIVE WORKSPACE") : "SELF WORKSPACE"}</span>
        </div>
        <div className="graph-presets" aria-label={t("图谱预设视图", "Graph view presets")}>
          {(["traceability", "business", "implementation", "coverage"] as GraphViewPreset[]).map((item) => (
            <button key={item} className={preset === item ? "active" : ""} onClick={() => changePreset(item)}>
              {
                (
                  {
                    traceability: t("产品追溯", "Traceability"),
                    business: t("业务流程", "Business flow"),
                    implementation: t("实现依赖", "Implementation"),
                    coverage: t("测试覆盖", "Test coverage"),
                  } as Record<GraphViewPreset, string>
                )[item]
              }
            </button>
          ))}
        </div>
        <div className="graph-filter-row">
          <div className="field">
            <label htmlFor="graph-depth">{t("展开深度", "Expansion depth")}</label>
            <select id="graph-depth" value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
              <option value={1}>{t("1 层", "1 level")}</option>
              <option value={2}>{t("2 层", "2 levels")}</option>
              <option value={4}>{t("4 层", "4 levels")}</option>
              <option value={8}>{t("8 层（完整路径上限）", "8 levels (full-path limit)")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="graph-node-types">{t("节点类型过滤（逗号分隔）", "Node type filter (comma-separated)")}</label>
            <input id="graph-node-types" placeholder="CLAIM,TEST_SPEC,EVIDENCE" value={nodeTypes} onChange={(event) => setNodeTypes(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="graph-relations">{t("关系过滤（逗号分隔）", "Relationship filter (comma-separated)")}</label>
            <input id="graph-relations" placeholder="VERIFIED_BY,PROVED_BY" value={relations} onChange={(event) => setRelations(event.target.value)} />
          </div>
          <button className="button primary" disabled={loading} onClick={() => void loadGraph()}>
            {loading ? t("加载中…", "Loading…") : live ? t("加载服务端图谱", "Load server graph") : t("尝试连接服务端", "Try server connection")}
          </button>
        </div>
        {message && <div className="inline-message">{message}</div>}
      </section>

      <section className="panel graph-panel">
        <div className="graph-layout">
          <aside className="graph-legend" aria-label={t("图谱过滤与图例", "Graph filters and legend")}>
            <p className="eyebrow">Visible graph</p>
            <strong>
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </strong>
            <p>{graph.snapshotManifestId}</p>
            <ul>
              <li>
                <i className="legend-swatch feature" />
                {t("Feature 中心", "Feature center")}
              </li>
              <li>
                <i className="legend-swatch claim" />
                {t("规则 / Scope", "Rule / Scope")}
              </li>
              <li>
                <i className="legend-swatch evidence" />
                {t("执行 Evidence", "Execution Evidence")}
              </li>
              <li>
                <i className="legend-swatch gap" />
                {t("冲突 / 追溯缺口", "Conflict / Trace gap")}
              </li>
            </ul>
            {graph.truncated && <div className="graph-warning">{t("结果已按节点上限截断。请缩小类型/关系或逐层展开。", "Results were truncated at the node limit. Narrow the type or relationship filters, or expand progressively.")}</div>}
            {graph.availableExpansions.length > 0 && (
              <div className="expansion-list">
                <b>{t("可继续展开", "Available expansions")}</b>
                {graph.availableExpansions.map((item) => (
                  <span key={`${item.relation}:${item.nodeType}`}>
                    {term(item.relation)} → {term(item.nodeType)} · {item.count}
                  </span>
                ))}
              </div>
            )}
          </aside>
          <div ref={canvasRef} className="graph-canvas" role="img" aria-label={t(`Feature ${graph.center} 的 ${preset} 追溯图谱`, `${preset} trace graph for Feature ${graph.center}`)} />
          <aside className="graph-detail" aria-live="polite">
            <p className="eyebrow">{t("选中节点", "Selected node")}</p>
            {selected ? (
              <>
                <h2>{selected.label}</h2>
                <span className={`graph-status ${selected.status.toLowerCase()}`}>
                  {term(selected.type)} · {term(selected.status)}
                </span>
                <dl>
                  <dt>ID</dt>
                  <dd>{selected.id}</dd>
                  <dt>{t("来源", "Provenance")}</dt>
                  <dd>{term(selected.provenance)}</dd>
                  <dt>{t("版本", "Version")}</dt>
                  <dd>{selected.version ?? t("不可变", "Immutable")}</dd>
                  <dt>{t("风险", "Risk")}</dt>
                  <dd>{term(selected.risk)}</dd>
                  <dt>{t("定位", "Location")}</dt>
                  <dd>{selected.source ? JSON.stringify(selected.source) : t("无源文件定位", "No source-file location")}</dd>
                </dl>
              </>
            ) : (
              <p>{t("选择节点查看来源、版本和状态。", "Select a node to inspect provenance, version, and status.")}</p>
            )}
          </aside>
        </div>
        <div className="graph-path-bar">
          <div className="field">
            <label htmlFor="path-from">{t("路径起点", "Path start")}</label>
            <select id="path-from" value={effectivePathFrom} onChange={(event) => setPathFrom(event.target.value)}>
              {graph.nodes.map((node) => (
                <option key={`from:${node.id}`} value={node.id}>
                  {term(node.type)} · {node.label}
                </option>
              ))}
            </select>
          </div>
          <span aria-hidden="true">→</span>
          <div className="field">
            <label htmlFor="path-to">{t("路径终点", "Path end")}</label>
            <select id="path-to" value={effectivePathTo} onChange={(event) => setPathTo(event.target.value)}>
              {graph.nodes.map((node) => (
                <option key={`to:${node.id}`} value={node.id}>
                  {term(node.type)} · {node.label}
                </option>
              ))}
            </select>
          </div>
          <button className="button" disabled={loading || graph.nodes.length === 0} onClick={() => void queryPath()}>
            {t("锁定最短路径", "Lock shortest path")}
          </button>
          {pathResult && (
            <button className="button ghost" onClick={() => setPathResult(null)}>
              {t("清除路径", "Clear path")}
            </button>
          )}
        </div>
        <div className="graph-accessible-list">
          <h3>{t("当前可见关系", "Visible relationships")}</h3>
          {graph.edges.map((edge) => (
            <div key={edge.id}>
              <span>{edge.source}</span>
              <b>{term(edge.type)}</b>
              <span>{edge.target}</span>
              <small>
                {term(edge.provenance)} · {term(edge.status)}
              </small>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function TraceView({ scenario, demo, scenarioKey, setScenarioKey, selectedBlock, setSelectedBlock }: { scenario: Scenario; demo: boolean; scenarioKey: "current" | "changed"; setScenarioKey: (value: "current" | "changed") => void; selectedBlock: TraceBlockKey; setSelectedBlock: (value: TraceBlockKey) => void }) {
  const { t, term, role } = useI18n();
  const blocks = traceBlocksForScenario(scenario);
  const selected = blocks.find((block) => block.key === selectedBlock) ?? blocks[0];
  const evidenceFreshness = dimensionState(scenario, "证据新鲜度", "UNKNOWN");
  const artifacts = demo ? (scenarioKey === "current" ? currentTraqenArtifacts : changedTraqenArtifacts) : null;

  return (
    <>
      <section className="hero">
        <div className="hero-card">
          <p className="eyebrow">
            {term("FEATURE")} · {scenario.feature.id} · v{scenario.feature.version}
          </p>
          <h1>{scenario.feature.name}</h1>
          <p className="hero-sub">{t("从已确认业务声明出发，沿实现、测试与执行证据回答：为什么相信这个功能在当前部署正常？每个状态维度独立展示，任何断链都会阻止“完整可信”。", "Starting from confirmed business claims, follow implementation, tests, and execution evidence to answer why this feature should be trusted in the current deployment. Every trust dimension remains independent, and any broken link prevents a complete verdict.")}</p>
        </div>
        <div className="hero-card trust-card">
          <div className="trust-status">
            <span className={`status-light ${scenario.complete ? "" : "warn"}`} />
            {scenario.complete ? t("追踪链完整", "Trace chain complete") : t("存在阻断缺口", "Blocking gaps detected")}
          </div>
          <div>
            <strong>{scenario.complete ? t("当前可被证据支持", "Supported by current evidence") : t("当前不能证明正常", "Current behavior is not proven")}</strong>
            <p>
              {scenario.deploymentId}
              <br />
              {scenario.computedAt}
            </p>
          </div>
        </div>
      </section>

      <section className="dimension-grid" aria-label={t("独立可信维度", "Independent trust dimensions")}>
        {scenario.dimensions.map((dimension) => (
          <div className="dimension-card" key={dimension.label}>
            <span>{term(dimension.label)}</span>
            <div className="dimension-value">
              <i className={`dot ${tone(dimension.value) === "warn" ? "warn" : tone(dimension.value) === "bad" ? "bad" : ""}`} />
              {term(dimension.value)}
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{t("端到端功能追踪链", "End-to-end feature trace chain")}</h2>
            <p>
              Snapshot {scenario.snapshotId} · {t("点击五大块查看对应数据与底层追溯记录", "Select one of the five blocks to inspect its data and underlying trace records")}
            </p>
          </div>
          {demo && (
            <div className="scenario-switch">
              <button className={scenarioKey === "current" ? "active" : ""} onClick={() => setScenarioKey("current")}>
                {t("当前部署", "Current deployment")}
              </button>
              <button className={scenarioKey === "changed" ? "active" : ""} onClick={() => setScenarioKey("changed")}>
                {t("代码变更后", "After code change")}
              </button>
            </div>
          )}
        </div>
        <div className="chain-wrap">
          <div className="chain five-block-chain">
            {blocks.map((block, index) => (
              <div className="chain-item" key={block.key}>
                <button aria-pressed={selected.key === block.key} className={`chain-node ${tone(block.state)} ${selected.key === block.key ? "selected" : ""}`} onClick={() => setSelectedBlock(block.key)}>
                  <span className="node-kind">
                    {t(
                      block.detailLabel,
                      (
                        {
                          description: "Business logic",
                          design: "Design and code",
                          configuration: "Configuration constraints",
                          "test-case": "Cases, steps and assertions",
                          "test-result": "Execution result data",
                        } as Record<TraceBlockKey, string>
                      )[block.key],
                    )}
                  </span>
                  <strong className="node-title">
                    {t(
                      block.label,
                      (
                        {
                          description: "Feature description",
                          design: "Design implementation",
                          configuration: "Configuration",
                          "test-case": "Test cases",
                          "test-result": "Test results",
                        } as Record<TraceBlockKey, string>
                      )[block.key],
                    )}
                  </strong>
                  <span className="node-summary">{block.summary}</span>
                  <span className="node-meta">
                    {term(block.state)} · {block.records.length} {t("条追溯记录", "trace records")}
                  </span>
                </button>
                {index < blocks.length - 1 && (
                  <div className="chain-link" aria-hidden="true">
                    <span />
                    <small>
                      {t(
                        block.relation,
                        (
                          {
                            description: "guides design",
                            design: "depends on configuration",
                            configuration: "constrains cases",
                            "test-case": "produces results",
                            "test-result": "",
                          } as Record<TraceBlockKey, string>
                        )[block.key],
                      )}
                    </small>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="chain-foot trace-block-foot">
          <div className="detail-pane trace-block-pane">
            <div className="trace-detail-heading">
              <div>
                <p className="eyebrow">
                  {t(
                    selected.detailLabel,
                    (
                      {
                        description: "Business logic",
                        design: "Design and code",
                        configuration: "Configuration constraints",
                        "test-case": "Cases, steps and assertions",
                        "test-result": "Execution result data",
                      } as Record<TraceBlockKey, string>
                    )[selected.key],
                  )}
                </p>
                <h3>
                  {t(
                    selected.label,
                    (
                      {
                        description: "Feature description",
                        design: "Design implementation",
                        configuration: "Configuration",
                        "test-case": "Test cases",
                        "test-result": "Test results",
                      } as Record<TraceBlockKey, string>
                    )[selected.key],
                  )}
                </h3>
                <p>
                  {t(
                    selected.description,
                    (
                      {
                        description: "Explains the problem, audience, business rules, and accountable confirmer.",
                        design: "Shows endpoints, components, state transitions, code locations, and implementation conformance.",
                        configuration: "Shows configuration, data structures, and runtime constraints bound to the current Snapshot.",
                        "test-case": "Shows approved TestSpecs, setup, steps, and meaningful business assertions.",
                        "test-result": "Shows execution outcomes, evidence, integrity, and freshness for the current deployment.",
                      } as Record<TraceBlockKey, string>
                    )[selected.key],
                  )}
                </p>
              </div>
              <span className={`mode-badge ${tone(selected.state) === "good" ? "live" : ""}`}>{term(selected.state)}</span>
            </div>
            {artifacts ? (
              <TraceArtifactDetail block={selected.key} artifacts={artifacts} demo={demo} />
            ) : (
              <div className="trace-detail-grid">
                {selected.details.map((detail, index) => (
                  <div key={`${detail.label}:${index}`}>
                    <span>{term(detail.label)}</span>
                    <strong>{role(term(detail.value))}</strong>
                  </div>
                ))}
              </div>
            )}
            <div className="trace-records">
              <h3>{t("底层追溯记录", "Underlying trace records")}</h3>
              {selected.records.map((record) => (
                <div key={record.id}>
                  <span>
                    {term(record.kind)} · {term(record.status)}
                  </span>
                  <b>{record.id}</b>
                  <small>{role(term(record.provenance))}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="why-pane">
            <h3>{scenario.complete ? t("为什么相信", "Why trust it") : t("为什么不能相信", "Why it cannot be trusted")}</h3>
            <ul>
              {scenario.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="two-column">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>TraceGap</h2>
              <p>{t("缺口、责任角色与下一步动作", "Gaps, accountable roles, and next actions")}</p>
            </div>
            <span className="mode-badge">
              {scenario.gaps.length} {t("未解决", "OPEN")}
            </span>
          </div>
          <div className="gap-list">
            {scenario.gaps.length === 0 ? (
              <div className="gap-empty">{t("没有缺失环节。该状态仅对所选 Snapshot 与部署成立。", "No missing links. This state applies only to the selected Snapshot and deployment.")}</div>
            ) : (
              scenario.gaps.map((gap) => (
                <div className="gap" key={gap.type}>
                  <div className="gap-top">
                    <span>
                      {term(gap.severity)} · {term(gap.type)}
                    </span>
                    <span className="owner">{role(gap.ownerRole)}</span>
                  </div>
                  <p>{gap.message}</p>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Evidence</h2>
              <p>{evidenceFreshness === "FRESH" ? t("当前执行产生的已验证证据", "Verified evidence produced by the current execution") : t("保留的历史证据；完整性已验证，但不能证明当前部署", "Retained historical evidence whose integrity is verified but which cannot prove the current deployment")}</p>
            </div>
          </div>
          <div className="evidence-list">
            {scenario.evidence.map((item) => (
              <div className="evidence-item" key={item.id}>
                <div>
                  <strong>
                    {term(item.type)} · {item.detail}
                  </strong>
                  <small>{item.id}</small>
                </div>
                <span className={`evidence-state ${evidenceFreshness === "FRESH" ? "" : "stale"}`}>
                  {term(item.state)}
                  {evidenceFreshness === "FRESH" ? "" : ` · ${term("STALE")}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function TraceArtifactDetail({ block, artifacts, demo }: { block: TraceBlockKey; artifacts: TraceDetailArtifacts; demo: boolean }) {
  if (block === "description") return <FeatureDescriptionDetail key={`${artifacts.featureDescription.title}@${artifacts.featureDescription.version}`} document={artifacts.featureDescription} demo={demo} />;
  if (block === "design") return <DesignImplementationDetail key={`${artifacts.design.id}@${artifacts.design.version}:${artifacts.design.status}`} document={artifacts.design} />;
  if (block === "configuration") return <ConfigurationDetail configurations={artifacts.configurations} />;
  if (block === "test-case") return <TestCaseDetail key={artifacts.testDesign.agentContract.schema} design={artifacts.testDesign} />;
  return <TestResultDetail key={artifacts.testResults.map((result) => result.id).join(":")} results={artifacts.testResults} design={artifacts.testDesign} />;
}

function NarrativeSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="narrative-section">
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(`[^`]+`)/g)
        .filter(Boolean)
        .map((part, index) => (part.startsWith("`") && part.endsWith("`") ? <code key={`${part}-${index}`}>{part.slice(1, -1)}</code> : <span key={`${part}-${index}`}>{part}</span>))}
    </>
  );
}

function MarkdownDocument({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: Array<{
    type: "heading" | "paragraph" | "unordered" | "ordered";
    level?: number;
    text?: string;
    items?: string[];
  }> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || line.startsWith("> Language") || line.startsWith("> 语言")) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      index += 1;
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(lines[index].trim().slice(2));
        index += 1;
      }
      blocks.push({ type: "unordered", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ordered", items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || /^(#{1,3})\s+/.test(next) || next.startsWith("- ") || /^\d+\.\s+/.test(next)) break;
      paragraph.push(next.replace(/\s{2}$/, ""));
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return (
    <article className="markdown-document">
      {blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          if (block.level === 1)
            return (
              <h1 key={blockIndex}>
                <InlineMarkdown text={block.text ?? ""} />
              </h1>
            );
          if (block.level === 2)
            return (
              <h2 key={blockIndex}>
                <InlineMarkdown text={block.text ?? ""} />
              </h2>
            );
          return (
            <h3 key={blockIndex}>
              <InlineMarkdown text={block.text ?? ""} />
            </h3>
          );
        }
        if (block.type === "unordered")
          return (
            <ul key={blockIndex}>
              {block.items?.map((item) => (
                <li key={item}>
                  <InlineMarkdown text={item} />
                </li>
              ))}
            </ul>
          );
        if (block.type === "ordered")
          return (
            <ol key={blockIndex}>
              {block.items?.map((item) => (
                <li key={item}>
                  <InlineMarkdown text={item} />
                </li>
              ))}
            </ol>
          );
        return (
          <p key={blockIndex}>
            <InlineMarkdown text={block.text ?? ""} />
          </p>
        );
      })}
    </article>
  );
}

function SourceCodeViewer({ content }: { content: string }) {
  return (
    <pre className="source-file">
      <code>
        {content.split("\n").map((line, index) => (
          <span className="source-line" key={`${index}-${line}`}>
            <i>{String(index + 1).padStart(3, "0")}</i>
            <b>{line || " "}</b>
          </span>
        ))}
      </code>
    </pre>
  );
}

function FeatureDescriptionDetail({ document, demo }: { document: FeatureDescriptionDocument; demo: boolean }) {
  const { t, term, role } = useI18n();
  const [confirmation, setConfirmation] = useState<HumanConfirmation>(document.confirmation);
  const [draft, setDraft] = useState<HumanConfirmation>(document.confirmation);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  function beginEdit() {
    setDraft(confirmation);
    setEditing(true);
    setMessage("");
  }

  function saveDraft() {
    setConfirmation(draft);
    setEditing(false);
    setMessage(demo ? t("自 Workspace 确认草稿已更新；刷新页面后恢复，不会写入业务基线。", "The self-Workspace confirmation draft is updated locally. A refresh restores it; no business baseline is changed.") : t("确认草稿已更新；正式生效仍需通过服务端鉴权生成不可变 Decision。", "The confirmation draft is updated. Activation still requires server authorization and a new immutable Decision."));
  }

  return (
    <div className="feature-description-layout">
      <article className="feature-document" aria-label={t("完整功能说明", "Complete feature description")}>
        <header>
          <div>
            <span>
              {t("功能描述", "FEATURE DESCRIPTION")} · v{document.version}
            </span>
            <h4>{document.title}</h4>
          </div>
          <b>{t("受治理功能说明", "Governed feature description")}</b>
        </header>
        <section className="feature-purpose">
          <h4>{t("功能目标", "Feature objective")}</h4>
          <p>{document.purpose}</p>
        </section>
        <div className="feature-narrative-grid document-sections">
          <NarrativeSection title={t("业务逻辑", "Business logic")} items={document.businessLogic} />
          <NarrativeSection title={t("权限控制", "Access control")} items={document.permissions} />
          <NarrativeSection title={t("前置条件", "Prerequisites")} items={document.prerequisites} />
          <NarrativeSection title={t("外部依赖", "External dependencies")} items={document.dependencies} />
          <NarrativeSection title={t("适用范围", "Applicable scope")} items={document.applicableScope} />
          <NarrativeSection title={t("例外与边界", "Exceptions and boundaries")} items={document.exceptions} />
        </div>
      </article>
      <aside className="human-confirmation-card">
        <div className="confirmation-head">
          <div>
            <p className="eyebrow">Human confirmation</p>
            <h4>{t("业务人工确认", "Business confirmation")}</h4>
          </div>
          <span className={"confirmation-status " + confirmation.status.toLowerCase()}>{term(confirmation.status)}</span>
        </div>
        {!editing ? (
          <div className="confirmation-summary">
            <dl>
              <dt>{t("确认结果", "Result")}</dt>
              <dd>{term(confirmation.status)}</dd>
              <dt>{t("确认时间", "Confirmed at")}</dt>
              <dd>{confirmation.confirmedAt}</dd>
              <dt>{t("负责人", "Owner")}</dt>
              <dd>{role(confirmation.owner)}</dd>
              <dt>Decision</dt>
              <dd>
                {confirmation.decisionId}@{confirmation.version}
              </dd>
              <dt>{t("确认说明", "Rationale")}</dt>
              <dd>{confirmation.rationale}</dd>
            </dl>
            <button className="button" onClick={beginEdit}>
              {t("编辑确认结果", "Edit confirmation")}
            </button>
          </div>
        ) : (
          <div className="confirmation-editor">
            <div className="field">
              <label htmlFor="confirmation-status">{t("确认结果", "Result")}</label>
              <select
                id="confirmation-status"
                value={draft.status}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    status: event.target.value as HumanConfirmation["status"],
                  })
                }
              >
                {(["PENDING", "CONFIRMED", "EXCEPTION_RECORDED", "REJECTED"] as const).map((status) => (
                  <option key={status} value={status}>
                    {term(status)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="confirmation-time">{t("确认时间", "Confirmed at")}</label>
              <input id="confirmation-time" type="datetime-local" value={draft.confirmedAt} onChange={(event) => setDraft({ ...draft, confirmedAt: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="confirmation-owner">{t("负责人", "Owner")}</label>
              <input id="confirmation-owner" value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="confirmation-rationale">{t("确认说明", "Rationale")}</label>
              <textarea id="confirmation-rationale" value={draft.rationale} onChange={(event) => setDraft({ ...draft, rationale: event.target.value })} />
            </div>
            <div className="confirmation-actions">
              <button className="button primary" onClick={saveDraft}>
                {t("保存确认草稿", "Save draft")}
              </button>
              <button className="button ghost" onClick={() => setEditing(false)}>
                {t("取消", "Cancel")}
              </button>
            </div>
          </div>
        )}
        <p className="confirmation-boundary">{t("编辑不会直接覆盖权威事实。正式确认必须由有权限的负责人提交，并由服务端记录新的不可变 Decision。", "Editing never overwrites an authoritative fact. A formal confirmation must be submitted by an authorized owner and recorded by the server as a new immutable Decision.")}</p>
        {message && <div className="inline-message confirmation-message">{message}</div>}
      </aside>
    </div>
  );
}

function DesignImplementationDetail({ document }: { document: DesignDocument }) {
  const { language, t, term, role } = useI18n();
  const [view, setView] = useState<"document" | "raw-markdown" | "code-blocks" | "source-file">("document");
  const [selectedSourcePath, setSelectedSourcePath] = useState(document.sourceFiles[0]?.path ?? "");
  const sourceFile = document.sourceFiles.find((source) => source.path === selectedSourcePath) ?? document.sourceFiles[0];
  const markdownFile = language === "en" && document.englishMarkdownFile ? document.englishMarkdownFile : document.markdownFile;
  const views = [
    ["document", t("设计文档", "Design document")],
    ["raw-markdown", t("原始 Markdown", "Raw Markdown")],
    ["code-blocks", t("业务代码块", "Business code blocks")],
    ["source-file", t("完整源文件", "Full source file")],
  ] as const;

  return (
    <div className="design-document file-reader">
      <header className="artifact-document-head">
        <div>
          <span>
            {document.id} · v{document.version}
          </span>
          <h4>{document.title}</h4>
          <p>{document.overview}</p>
        </div>
        <div>
          <b className={"artifact-state " + document.status.toLowerCase()}>{term(document.status)}</b>
          <small>
            {role(document.owner)}
            <br />
            {document.updatedAt}
          </small>
        </div>
      </header>
      <nav className="reader-toolbar" aria-label={t("设计与代码查看方式", "Design and code view mode")}>
        {views.map(([key, label]) => (
          <button key={key} className={view === key ? "active" : ""} aria-pressed={view === key} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </nav>
      {(view === "document" || view === "raw-markdown") && (
        <div className="reader-file-head">
          <div>
            <span className="file-type">MD</span>
            <div>
              <b>{markdownFile.path.split("/").at(-1)}</b>
              <small>{markdownFile.path}</small>
            </div>
          </div>
          <span>
            {markdownFile.content.split("\n").length} {t("行", "lines")}
          </span>
        </div>
      )}
      {view === "document" && <MarkdownDocument content={markdownFile.content} />}
      {view === "raw-markdown" && <SourceCodeViewer content={markdownFile.content} />}
      {view === "code-blocks" && (
        <section className="code-evidence">
          <div className="reader-section-title">
            <div>
              <h4>{t("业务逻辑代码块", "Business logic code blocks")}</h4>
              <p>{t("从原文件中提取并绑定 Fact 的关键实现，不用摘要替代代码。", "Key implementations are extracted from original files and bound to Facts; summaries never replace source code.")}</p>
            </div>
            <span>{document.codeBlocks.length} BLOCKS</span>
          </div>
          {document.codeBlocks.map((codeBlock) => (
            <article key={codeBlock.id}>
              <header>
                <div>
                  <b>{codeBlock.title}</b>
                  <span>
                    {codeBlock.file}:{codeBlock.startLine}
                  </span>
                </div>
                <small>
                  {codeBlock.factId} · {codeBlock.language}
                </small>
              </header>
              <SourceCodeViewer content={codeBlock.code} />
            </article>
          ))}
        </section>
      )}
      {view === "source-file" && sourceFile && (
        <section className="full-source-view">
          <div className="reader-file-head">
            <div>
              <span className="file-type code">JS</span>
              <div>
                <b>{sourceFile.path.split("/").at(-1)}</b>
                <small>{sourceFile.path}</small>
              </div>
            </div>
            <span>{sourceFile.factIds.join(" · ")}</span>
          </div>
          {document.sourceFiles.length > 1 && (
            <select aria-label={t("选择源文件", "Select source file")} value={sourceFile.path} onChange={(event) => setSelectedSourcePath(event.target.value)}>
              {document.sourceFiles.map((source) => (
                <option key={source.path} value={source.path}>
                  {source.path}
                </option>
              ))}
            </select>
          )}
          <SourceCodeViewer content={sourceFile.content} />
        </section>
      )}
    </div>
  );
}

function ConfigurationDetail({ configurations }: { configurations: EnvironmentConfiguration[] }) {
  const { t } = useI18n();
  const environments = ["DEV", "SIT", "UAT", "PROD"] as const;
  return (
    <div className="configuration-document">
      <div className="artifact-intro">
        <div>
          <h4>{t("跨环境配置矩阵", "Cross-environment configuration matrix")}</h4>
          <p>{t("配置值与来源绑定到环境 Snapshot；敏感配置只展示密钥引用，不展示明文。", "Configuration values and sources are bound to each environment Snapshot; sensitive values show only secret references, never plaintext.")}</p>
        </div>
        <span>
          {configurations.length} {t("项配置", "CONFIG ITEMS")}
        </span>
      </div>
      <div className="config-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("配置项", "Configuration")}</th>
              {environments.map((environment) => (
                <th key={environment}>{environment}</th>
              ))}
              <th>{t("来源", "Source")}</th>
            </tr>
          </thead>
          <tbody>
            {configurations.map((configuration) => (
              <tr key={configuration.key}>
                <th>
                  <b>{configuration.key}</b>
                  <small>
                    {configuration.description}
                    {configuration.sensitive ? t(" · 敏感引用", " · SENSITIVE REF") : ""}
                  </small>
                </th>
                {environments.map((environment) => (
                  <td key={environment}>
                    <code>{configuration.values[environment]}</code>
                  </td>
                ))}
                <td>
                  <span>{configuration.source}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="config-boundary">{t("后续环境变更必须形成新的配置 Fact 与 Snapshot 比较；页面不能用一个环境的值推断其他环境。", "Future environment changes must produce new configuration Facts and Snapshot comparisons; one environment must never be inferred from another.")}</p>
    </div>
  );
}

function TestCaseDetail({ design }: { design: TestDesign }) {
  const { t, term } = useI18n();
  const [selectedCaseId, setSelectedCaseId] = useState(design.cases[0]?.id ?? "");
  const selectedCase = design.cases.find((testCase) => testCase.id === selectedCaseId) ?? design.cases[0];

  return (
    <div className="test-design-layout">
      <article className="test-strategy-document">
        <div className="artifact-intro">
          <div>
            <h4>{t("测试设计策略", "Test design strategy")}</h4>
            <p>{design.strategy.objective}</p>
          </div>
          <span>{t("策略", "STRATEGY")}</span>
        </div>
        <div className="strategy-grid document-sections">
          <NarrativeSection title={t("风险重点", "Risk focus")} items={design.strategy.riskFocus} />
          <NarrativeSection title={t("测试层次", "Test levels")} items={design.strategy.levels} />
          <section className="narrative-section">
            <h4>{t("测试数据策略", "Test data strategy")}</h4>
            <p>{design.strategy.dataStrategy}</p>
          </section>
          <section className="narrative-section">
            <h4>{t("环境策略", "Environment strategy")}</h4>
            <p>{design.strategy.environmentStrategy}</p>
          </section>
          <NarrativeSection title={t("退出准则", "Exit criteria")} items={design.strategy.exitCriteria} />
        </div>
      </article>
      <div className="test-case-workbench">
        <aside className="test-case-list">
          <header>
            <h4>{t("具体测试用例", "Test cases")}</h4>
            <span>
              {design.cases.length} {t("条用例", "CASES")}
            </span>
          </header>
          {design.cases.map((testCase) => (
            <button key={testCase.id} className={selectedCase?.id === testCase.id ? "selected" : ""} aria-pressed={selectedCase?.id === testCase.id} onClick={() => setSelectedCaseId(testCase.id)}>
              <span>
                {term(testCase.scenario)} · {testCase.priority}
              </span>
              <b>{testCase.title}</b>
              <small>
                {testCase.id}@{testCase.version} · {term(testCase.automationStatus)}
              </small>
            </button>
          ))}
        </aside>
        {selectedCase && <TestCaseLogic testCase={selectedCase} />}
      </div>
      <section className="agent-contract">
        <div>
          <p className="eyebrow">Future agent contract</p>
          <h4>{t("Agent 执行与回传预留", "Reserved Agent execution and reporting contract")}</h4>
          <p>{design.agentContract.note}</p>
        </div>
        <dl>
          <dt>Schema</dt>
          <dd>{design.agentContract.schema}</dd>
          <dt>{t("执行请求", "Execution request")}</dt>
          <dd>{design.agentContract.requestFields.join(" · ")}</dd>
          <dt>{t("结果回传", "Result report")}</dt>
          <dd>{design.agentContract.resultFields.join(" · ")}</dd>
        </dl>
      </section>
    </div>
  );
}

function TestCaseLogic({ testCase }: { testCase: TestCaseDefinition }) {
  const { t, term } = useI18n();
  return (
    <article className="test-case-logic">
      <header>
        <div>
          <p className="eyebrow">
            {term(testCase.scenario)} · {testCase.priority}
          </p>
          <h4>{testCase.title}</h4>
          <span>
            {testCase.id}@{testCase.version}
          </span>
        </div>
        <div>
          <b>{term(testCase.operationLevel)}</b>
          <small>{term(testCase.automationStatus)}</small>
        </div>
      </header>
      <p className="test-objective">{testCase.objective}</p>
      <div className="test-meta-grid">
        <NarrativeSection title={t("前置条件", "Preconditions")} items={testCase.preconditions} />
        <NarrativeSection title={t("测试数据", "Test data")} items={testCase.testData} />
      </div>
      <section className="test-steps">
        <h4>{t("测试逻辑与步骤", "Test logic and steps")}</h4>
        {testCase.steps.map((step, index) => (
          <div key={step.id}>
            <span>{index + 1}</span>
            <b>{term(step.executor)}</b>
            <p>{step.action}</p>
            <small>
              {t("期望", "Expected")}: {step.expected}
            </small>
          </div>
        ))}
      </section>
      <section className="test-assertions">
        <h4>{t("断言", "Assertions")}</h4>
        {testCase.assertions.map((assertion) => (
          <code key={assertion}>{assertion}</code>
        ))}
      </section>
      <dl className="test-execution-contract">
        <dt>Fixture</dt>
        <dd>{testCase.fixtureProtocol ?? "N/A"}</dd>
        <dt>Cleanup</dt>
        <dd>{testCase.cleanupProtocol ?? "N/A"}</dd>
        <dt>{t("所需能力", "Required capabilities")}</dt>
        <dd>{testCase.requiredCapabilities.map(term).join(" · ")}</dd>
      </dl>
    </article>
  );
}

function TestResultDetail({ results, design }: { results: ScenarioTestResult[]; design: TestDesign }) {
  const { t, term } = useI18n();
  const initialResult = results.find((result) => result.status === "FAIL" || result.status === "ERROR") ?? results[0];
  const [selectedResultId, setSelectedResultId] = useState(initialResult?.id ?? "");
  const selectedResult = results.find((result) => result.id === selectedResultId) ?? initialResult;
  const groups = results.reduce<Record<string, ScenarioTestResult[]>>((grouped, result) => {
    grouped[result.scenario] = [...(grouped[result.scenario] ?? []), result];
    return grouped;
  }, {});

  const linkedCase = design.cases.find((testCase) => testCase.id === selectedResult?.testCaseId);

  return (
    <div className="test-result-layout">
      <div className="result-scenario-list">
        <div className="artifact-intro">
          <div>
            <h4>{t("按场景执行结果", "Execution results by scenario")}</h4>
            <p>{t("每个结果绑定 TestCase 版本、部署、环境和 Evidence；失败条目可下钻到具体步骤与错误。", "Every result is bound to a TestCase version, deployment, environment, and Evidence. Failed entries can be inspected down to the step and error.")}</p>
          </div>
          <span>
            {results.length} {t("条结果", "RESULTS")}
          </span>
        </div>
        {Object.entries(groups).map(([scenario, scenarioResults]) => (
          <section key={scenario}>
            <h4>{term(scenario)}</h4>
            {scenarioResults.map((result) => (
              <button key={result.id} className={selectedResult?.id === result.id ? "selected" : ""} aria-pressed={selectedResult?.id === result.id} onClick={() => setSelectedResultId(result.id)}>
                <span className={"result-status " + result.status.toLowerCase()}>{term(result.status)}</span>
                <div>
                  <b>{design.cases.find((testCase) => testCase.id === result.testCaseId)?.title ?? result.testCaseId}</b>
                  <small>
                    {term(result.applicability)} · {result.testCaseId} · {result.environment} · {result.durationMs === null ? term("NOT_RUN") : String(result.durationMs) + " ms"}
                  </small>
                </div>
                <i aria-hidden="true">›</i>
              </button>
            ))}
          </section>
        ))}
      </div>
      {selectedResult && (
        <article className="result-detail">
          <header>
            <div>
              <p className="eyebrow">
                {term(selectedResult.scenario)} · {term(selectedResult.applicability)}
              </p>
              <h4>{linkedCase?.title ?? selectedResult.testCaseId}</h4>
              <span>{selectedResult.executionId}</span>
            </div>
            <b className={"result-status large " + selectedResult.status.toLowerCase()}>{term(selectedResult.status)}</b>
          </header>
          <p className="result-summary">{selectedResult.summary}</p>
          <dl>
            <dt>{t("测试用例", "Test case")}</dt>
            <dd>
              {selectedResult.testCaseId}
              {linkedCase ? "@" + linkedCase.version : ""}
            </dd>
            <dt>{t("部署", "Deployment")}</dt>
            <dd>{selectedResult.deploymentId}</dd>
            <dt>{t("环境", "Environment")}</dt>
            <dd>{selectedResult.environment}</dd>
            <dt>{t("开始时间", "Started at")}</dt>
            <dd>{selectedResult.startedAt ?? term("NOT_RUN")}</dd>
            <dt>{t("耗时", "Duration")}</dt>
            <dd>{selectedResult.durationMs === null ? "N/A" : String(selectedResult.durationMs) + " ms"}</dd>
          </dl>
          {(selectedResult.status === "FAIL" || selectedResult.status === "ERROR") && (
            <section className="failure-detail">
              <h4>{t("失败详情", "Failure details")}</h4>
              <div>
                <span>{t("失败步骤", "Failed step")}</span>
                <b>{selectedResult.failedStepId}</b>
                <span>{t("错误码", "Error code")}</span>
                <b>{selectedResult.errorCode}</b>
                <span>{t("期望", "Expected")}</span>
                <b>{selectedResult.expected}</b>
                <span>{t("实际", "Actual")}</span>
                <b>{selectedResult.actual}</b>
              </div>
              <p>{selectedResult.errorMessage}</p>
            </section>
          )}
          <section className="result-evidence">
            <h4>{t("Evidence 引用", "Evidence references")}</h4>
            {selectedResult.evidenceIds.map((evidenceId) => (
              <code key={evidenceId}>{evidenceId}</code>
            ))}
          </section>
          <p className="result-agent-boundary">{t("未来 Agent 回传此结构化执行结果与签名 Evidence；服务端负责校验身份、版本、部署绑定和可信状态，不接受 Agent 自行判定功能可信。", "Future Agents will return this structured execution result and signed Evidence. The server validates identity, version, deployment binding, and trust state; an Agent cannot declare a feature trusted by itself.")}</p>
        </article>
      )}
    </div>
  );
}

const demoCandidate: ReviewCandidate = {
  id: "CANDIDATE-TRACEABILITY-ENDPOINT-001",
  featureCandidateId: "CANDIDATE-FEATURE-TRACEABILITY-001",
  statement: "平台必须针对所选 Snapshot 返回服务端派生的 Feature 追溯视图。",
  subjectKey: "endpoint:GET /v1/projects/{projectId}/features/{featureId}/traceability",
  constraint: { dimension: "endpointExposed", operator: "EQUALS", value: true },
  scope: {
    workspace: "Traqen Platform",
    snapshotBoundary: "selected-manifest",
  },
  evidence: [
    { factId: "FACT-ENDPOINT-FEATURE-TRACEABILITY", relation: "SUPPORTS" },
    { factId: "FACT-TRACE-CHAIN-EVALUATOR", relation: "SUPPORTS" },
    { factId: "FACT-FEATURE-TRACEABILITY-SCHEMA", relation: "CONTEXT" },
  ],
  sources: [
    {
      candidateId: "RAW-SPECONE-001",
      producer: { skillId: "specone-reference", skillVersion: "1.0.0" },
    },
    {
      candidateId: "RAW-GSD-001",
      producer: { skillId: "gsd-reference", skillVersion: "1.0.0" },
    },
  ],
};

function parseObject(value: string, field: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${field} 必须是 JSON object`);
  return parsed as Record<string, unknown>;
}

function ReviewView({ apiBase, apiToken, projectId }: { apiBase: string; apiToken: string; projectId: string }) {
  const { t, term, role } = useI18n();
  const [candidate, setCandidate] = useState<ReviewCandidate>(demoCandidate);
  const [liveCandidate, setLiveCandidate] = useState(false);
  const [runId, setRunId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [reviewId, setReviewId] = useState("REVIEW-UI-001");
  const [token, setToken] = useState("");
  const [outcome, setOutcome] = useState("");
  const [rationale, setRationale] = useState("产品负责人确认该声明适用于 Traqen Workspace 的所选 Snapshot。");
  const [featureMode, setFeatureMode] = useState<"CREATE" | "EXISTING">("CREATE");
  const [featureId, setFeatureId] = useState("FEATURE-TRACEABILITY-001");
  const [claimId, setClaimId] = useState("CLAIM-TRACEABILITY-ENDPOINT-001");
  const [scopeId, setScopeId] = useState("SCOPE-TRAQEN-WORKSPACE-001");
  const [decisionId, setDecisionId] = useState("DECISION-TRACEABILITY-ENDPOINT-001");
  const [statement, setStatement] = useState(demoCandidate.statement);
  const [scopeJson, setScopeJson] = useState(JSON.stringify(demoCandidate.scope, null, 2));
  const [conflictIds, setConflictIds] = useState("");
  const [associationRationale, setAssociationRationale] = useState("该候选描述既有 Feature 的当前实现。");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadCandidate() {
    if (!runId.trim() || !candidateId.trim()) {
      setMessage(t("请先填写 Reverse Run ID 与 Candidate ID。", "Enter a Reverse Run ID and Candidate ID first."));
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const base = apiBase.replace(/\/$/, "");
      const response = await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/reverse-runs/${encodeURIComponent(runId)}`, { headers: apiHeaders(apiToken) });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
      const merged = body.mergedOutput as Record<string, unknown> | undefined;
      const claims = Array.isArray(merged?.candidateClaims) ? (merged.candidateClaims as Array<Record<string, unknown>>) : [];
      const raw = claims.find((item) => item.id === candidateId);
      if (!raw) throw new Error(t("该 Reverse Run 中未找到 Candidate ID。", "The Candidate ID was not found in this Reverse Run."));
      const features = Array.isArray(merged?.candidateFeatures) ? (merged.candidateFeatures as Array<Record<string, unknown>>) : [];
      const feature = features.find((item) => item.externalKey === raw.subjectKey);
      const loaded: ReviewCandidate = {
        id: String(raw.id),
        featureCandidateId: String(feature?.id ?? ""),
        statement: String((Array.isArray(raw.statements) ? raw.statements[0] : raw.statement) ?? raw.subjectKey ?? raw.id),
        subjectKey: String(raw.subjectKey ?? raw.id),
        constraint: (raw.constraint as ReviewCandidate["constraint"] | undefined) ?? {
          dimension: "candidateAccepted",
          operator: "EQUALS",
          value: true,
        },
        scope: (raw.scope as Record<string, unknown> | undefined) ?? {},
        evidence: (Array.isArray(raw.evidence) ? raw.evidence : []) as ReviewCandidate["evidence"],
        sources: (Array.isArray(raw.sources) ? raw.sources : []) as ReviewCandidate["sources"],
      };
      setCandidate(loaded);
      setStatement(loaded.statement);
      setScopeJson(JSON.stringify(loaded.scope, null, 2));
      setLiveCandidate(true);
      setMessage(t("已加载候选；正式提交仍需核对规范性表述、Scope 与目标 ID。", "Candidate loaded. Verify the normative statement, Scope, and target IDs before formal submission."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("无法加载候选", "Unable to load candidate"));
    } finally {
      setLoading(false);
    }
  }

  async function submitReview(selectedOutcome: "CONFIRMED" | "EXCEPTION_RECORDED" | "REJECTED") {
    if (!liveCandidate) {
      setOutcome(selectedOutcome);
      setMessage(t(`自 Workspace 选择：${term(selectedOutcome)}。预览操作不会写入业务基线。`, `Self-Workspace selection: ${term(selectedOutcome)}. Preview actions do not change the business baseline.`));
      return;
    }
    if (!token.trim()) {
      setMessage(t("正式提交需要 Reviewer bearer token；身份与角色由服务端解析。", "Formal submission requires a reviewer bearer token; identity and role are resolved by the server."));
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const request: Record<string, unknown> = {
        id: reviewId,
        outcome: selectedOutcome,
        rationale,
        acknowledgedConflictIds: conflictIds
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      };
      if (selectedOutcome !== "REJECTED") {
        request.candidateFeatureId = candidate.featureCandidateId;
        request.target = {
          featureMode,
          featureId,
          claimId,
          scopeId,
          decisionId,
          ...(featureMode === "CREATE"
            ? {
                featureName: candidate.subjectKey,
                businessDomain: "reviewed-candidate",
              }
            : { associationRationale }),
        };
        request.normative = {
          statement,
          constraint: candidate.constraint,
          scope: parseObject(scopeJson, "Scope"),
          decisionContent: rationale,
        };
      }
      const base = apiBase.replace(/\/$/, "");
      const response = await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/reverse-runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidate.id)}/reviews`, {
        method: "POST",
        headers: apiHeaders(apiToken, {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify(request),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
      const review = body.review as { outcome?: string; actorId?: string; actorRole?: string } | undefined;
      setOutcome(review?.outcome ?? selectedOutcome);
      setMessage(t(`已由服务端记录 ${term(review?.outcome ?? selectedOutcome)}；审核人 ${review?.actorId ?? "server-resolved"} / ${role(review?.actorRole ?? "authorized-role")}。`, `The server recorded ${term(review?.outcome ?? selectedOutcome)}; reviewer ${review?.actorId ?? "server-resolved"} / ${role(review?.actorRole ?? "authorized-role")}.`));
      setToken("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("审核提交失败", "Review submission failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="panel review-loader">
        <div className="panel-head">
          <div>
            <h2>{t("加载待审核候选", "Load candidate for review")}</h2>
            <p>{t("从 Reverse Run 读取原始候选与 Fact 来源；浏览器不生成业务真相。", "Read the raw candidate and Fact sources from a Reverse Run; the browser does not create business truth.")}</p>
          </div>
          <span className={`mode-badge ${liveCandidate ? "live" : ""}`}>{liveCandidate ? "LIVE CANDIDATE" : "SELF WORKSPACE"}</span>
        </div>
        <div className="inline-form">
          <div className="field">
            <label htmlFor="review-run">Reverse Run ID</label>
            <input id="review-run" value={runId} onChange={(event) => setRunId(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="review-candidate">Candidate ID</label>
            <input id="review-candidate" value={candidateId} onChange={(event) => setCandidateId(event.target.value)} />
          </div>
          <button className="button primary" disabled={loading} onClick={loadCandidate}>
            {loading ? t("处理中…", "Processing…") : t("加载候选", "Load candidate")}
          </button>
        </div>
      </section>
      <div className="review-grid">
        <section className="panel candidate">
          <p className="eyebrow">Reverse candidate · {term("WAITING_REVIEW")}</p>
          <h1>{candidate.subjectKey}</h1>
          <div className="candidate-statement">“{candidate.statement}”</div>
          <p className="hero-sub">{t("这是 Skill 生成的候选陈述，不是业务事实。确认时平台会新建独立的规范性 Claim 与 Decision，并保留候选原文和 Fact 证据。", "This is a Skill-generated candidate statement, not a business fact. Confirmation creates separate normative Claim and Decision records while retaining the original candidate and Fact evidence.")}</p>
          <h2>{t("原始证据", "Source evidence")}</h2>
          <div className="candidate-evidence">
            {candidate.evidence.map((item) => (
              <div className="evidence-snippet" key={`${item.factId}:${item.relation}`}>
                {term(item.relation)} · {item.factId}
              </div>
            ))}
            {candidate.sources.map((item, index) => (
              <div className="evidence-snippet" key={`${item.candidateId ?? index}:source`}>
                {term("SOURCE")} · {item.producer?.skillId ?? "unknown-skill"}@{item.producer?.skillVersion ?? "unknown"}
                <br />
                {item.candidateId ?? "raw candidate"}
              </div>
            ))}
          </div>
        </section>
        <section className="panel decision-box">
          <p className="eyebrow">Human authority boundary</p>
          <h2>{t("最小声明审核", "Minimal claim review")}</h2>
          <p>{t("候选不能自行晋升为业务真相。正式提交由服务端鉴权、校验冲突并记录不可变 Decision。", "A candidate cannot promote itself to business truth. Formal submission is authorized by the server, checked for conflicts, and recorded as an immutable Decision.")}</p>
          <div className="review-fields">
            <div className="field full">
              <label htmlFor="normative-statement">{t("规范性表述", "Normative statement")}</label>
              <textarea id="normative-statement" value={statement} onChange={(event) => setStatement(event.target.value)} />
            </div>
            <div className="field full">
              <label htmlFor="scope-json">Scope JSON</label>
              <textarea id="scope-json" value={scopeJson} onChange={(event) => setScopeJson(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="feature-mode">{t("Feature 模式", "Feature mode")}</label>
              <select id="feature-mode" value={featureMode} onChange={(event) => setFeatureMode(event.target.value as "CREATE" | "EXISTING")}>
                <option value="CREATE">{term("CREATE")}</option>
                <option value="EXISTING">{term("EXISTING")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="target-feature">Feature ID</label>
              <input id="target-feature" value={featureId} onChange={(event) => setFeatureId(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="target-claim">Claim ID</label>
              <input id="target-claim" value={claimId} onChange={(event) => setClaimId(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="target-scope">Scope ID</label>
              <input id="target-scope" value={scopeId} onChange={(event) => setScopeId(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="target-decision">Decision ID</label>
              <input id="target-decision" value={decisionId} onChange={(event) => setDecisionId(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="review-id">Review ID</label>
              <input id="review-id" value={reviewId} onChange={(event) => setReviewId(event.target.value)} />
            </div>
            {featureMode === "EXISTING" && (
              <div className="field full">
                <label htmlFor="association-rationale">{t("关联既有 Feature 的理由", "Existing Feature association rationale")}</label>
                <textarea id="association-rationale" value={associationRationale} onChange={(event) => setAssociationRationale(event.target.value)} />
              </div>
            )}
            <div className="field full">
              <label htmlFor="review-rationale">{t("审核理由", "Review rationale")}</label>
              <textarea id="review-rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} />
            </div>
            <div className="field full">
              <label htmlFor="conflict-ids">{t("已确认 Conflict IDs（逗号分隔）", "Acknowledged Conflict IDs (comma-separated)")}</label>
              <input id="conflict-ids" value={conflictIds} onChange={(event) => setConflictIds(event.target.value)} />
            </div>
            <div className="field full">
              <label htmlFor="review-token">{t("Reviewer bearer token（仅保存在当前页面内存，成功后清空）", "Reviewer bearer token (kept in page memory and cleared after success)")}</label>
              <input id="review-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />
            </div>
          </div>
          <div className="decision-actions">
            <button disabled={loading} className="decision-action confirm" onClick={() => void submitReview("CONFIRMED")}>
              <b>{t("确认最小声明", "Confirm minimal claim")}</b>
              <span>{t("创建独立 Claim、Scope 与 CONFIRMED Decision", "Create separate Claim, Scope, and confirmed Decision records")}</span>
            </button>
            <button disabled={loading} className="decision-action" onClick={() => void submitReview("EXCEPTION_RECORDED")}>
              <b>{t("确认并记录例外", "Confirm with exception")}</b>
              <span>{t("保留冲突并明确适用边界", "Retain conflicts and define applicability boundaries")}</span>
            </button>
            <button disabled={loading} className="decision-action" onClick={() => void submitReview("REJECTED")}>
              <b>{t("驳回候选", "Reject candidate")}</b>
              <span>{t("不创建规范性业务基线", "Do not create a normative business baseline")}</span>
            </button>
          </div>
          <div className={`review-notice ${message && !message.startsWith("已") && !message.startsWith("自 Workspace") && !message.startsWith("The server") && !message.startsWith("Candidate loaded") ? "error" : ""}`}>{message || (outcome ? `${t("审核结果", "Review result")}：${term(outcome)}` : t("自 Workspace 候选的选择不会写入；只有加载真实候选并提供凭据后才会调用正式审核 API。", "Self-Workspace selections are not persisted. The formal review API is called only after loading a real candidate and providing credentials."))}</div>
        </section>
      </div>
    </>
  );
}

function MetricsView({ apiBase, apiToken, projectId, snapshotId }: { apiBase: string; apiToken: string; projectId: string; snapshotId: string }) {
  const { t, term } = useI18n();
  const [metrics, setMetrics] = useState<ProductMetrics | null>(null);
  const [platformMetrics, setPlatformMetrics] = useState<PlatformMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const demo: ProductMetrics = {
    projectId,
    snapshotManifestId: snapshotId,
    computedAt: "2026-07-15T09:30:00.000Z",
    highValueValidTraceChainRate: { numerator: 7, denominator: 10, ratio: 0.7 },
    claimConfirmationRate: { numerator: 16, denominator: 20, ratio: 0.8 },
    confirmedRuleTestCoverageRate: {
      numerator: 12,
      denominator: 16,
      ratio: 0.75,
    },
    meaningfulAssertionRate: { numerator: 18, denominator: 24, ratio: 0.75 },
    evidenceFreshness: {
      FRESH: 7,
      EXPIRING: 1,
      STALE: 1,
      INCOMPLETE: 1,
      UNKNOWN: 0,
    },
    gapBreakdown: {
      byType: { NO_TEST_SPEC: 2, EVIDENCE_STALE: 1 },
      bySeverity: { BLOCKING: 2, WARNING: 1 },
      byOwnerRole: { QUALITY_OWNER: 2, DEVELOPER: 1 },
    },
    features: [
      {
        featureId: "FEATURE-TRACEABILITY-001",
        name: "功能追溯",
        highValue: true,
        chainComplete: true,
        coverage: {
          product: true,
          rules: true,
          implementation: true,
          data: true,
          configuration: true,
          tests: true,
          assertions: true,
          execution: true,
          evidence: true,
        },
        openGapCount: 0,
      },
      {
        featureId: "FEATURE-CHANGE-IMPACT-001",
        name: "变更影响分析",
        highValue: true,
        chainComplete: false,
        coverage: {
          product: true,
          rules: true,
          implementation: true,
          data: true,
          configuration: false,
          tests: true,
          assertions: true,
          execution: false,
          evidence: false,
        },
        openGapCount: 2,
      },
    ],
    unavailableMetrics: [
      {
        metric: "DEFECT_ESCAPE_RATE",
        reason: "需要外部缺陷管理系统提供结果数据。",
      },
    ],
  };
  const current = metrics ?? demo;
  const rateCards = [
    [t("高价值功能有效追踪链率", "Valid trace-chain rate for high-value features"), current.highValueValidTraceChainRate],
    [t("声明确认率", "Claim confirmation rate"), current.claimConfirmationRate],
    [t("已确认规则测试覆盖率", "Confirmed-rule test coverage"), current.confirmedRuleTestCoverageRate],
    [t("有效断言率", "Meaningful assertion rate"), current.meaningfulAssertionRate],
  ] as const;

  async function loadMetrics() {
    setLoading(true);
    setMessage("");
    try {
      const base = apiBase.replace(/\/$/, "");
      const headers = apiHeaders(apiToken, { accept: "application/json" });
      const [response, platformResponse] = await Promise.all([fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/metrics/product-effectiveness?snapshotManifestId=${encodeURIComponent(snapshotId)}`, { headers }), fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/metrics/platform-operations`, { headers })]);
      const [body, platformBody] = await Promise.all([response.json() as Promise<Record<string, unknown>>, platformResponse.json() as Promise<Record<string, unknown>>]);
      if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
      if (!platformResponse.ok) throw new Error(String((platformBody.error as { message?: string } | undefined)?.message ?? `Platform metrics returned ${platformResponse.status}`));
      setMetrics(body as unknown as ProductMetrics);
      setPlatformMetrics(platformBody as unknown as PlatformMetrics);
      setMessage(t("已加载服务端按当前 Snapshot 派生的产品效果与平台运营指标。", "Loaded server-derived product effectiveness and platform operations metrics for the current Snapshot."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("产品指标加载失败", "Product metrics load failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="panel metrics-head">
        <div className="panel-head">
          <div>
            <h2>{t("产品效果指标", "Product effectiveness metrics")}</h2>
            <p>{t("每项指标独立展示分子、分母、断点与数据边界；没有综合绿色分数。", "Each metric independently shows its numerator, denominator, breakpoints, and data boundary; there is no composite green score.")}</p>
          </div>
          <span className={`mode-badge ${metrics ? "live" : ""}`}>{metrics ? "LIVE METRICS" : "SELF WORKSPACE"}</span>
        </div>
        <div className="metrics-context">
          <span>{current.snapshotManifestId}</span>
          <span>{current.computedAt}</span>
          <button className="button primary" disabled={loading} onClick={() => void loadMetrics()}>
            {loading ? t("加载中…", "Loading…") : t("加载服务端指标", "Load server metrics")}
          </button>
        </div>
        {message && <div className="inline-message">{message}</div>}
      </section>
      <section className="metrics-rate-grid">
        {rateCards.map(([label, value]) => (
          <div className="panel rate-card" key={label}>
            <span>{label}</span>
            <strong>{value.ratio === null ? "N/A" : `${Math.round(value.ratio * 100)}%`}</strong>
            <small>
              {value.numerator} / {value.denominator}
            </small>
          </div>
        ))}
      </section>
      {platformMetrics && (
        <section className="panel operations-metrics">
          <div className="panel-head">
            <div>
              <h2>平台运营可观测性</h2>
              <p>任务、Scanner、执行、Evidence 与影响分析分别展示；没有数据源的信号明确标记为不可用。</p>
            </div>
            <span className="mode-badge live">LIVE OPERATIONS</span>
          </div>
          <div className="operations-grid">
            <div>
              <span>Reverse Runs / retries</span>
              <b>
                {platformMetrics.reverseRuns.runCount} / {platformMetrics.reverseRuns.retryCount}
              </b>
              <small>
                active queue {platformMetrics.reverseRuns.queue.activeCount} · mean {platformMetrics.reverseRuns.duration.meanMs ?? "N/A"} ms
              </small>
            </div>
            <div>
              <span>Scanner bundles</span>
              <b>{platformMetrics.scanners.bundleCount}</b>
              <small>
                {platformMetrics.scanners.nodeCount} nodes · {platformMetrics.scanners.edgeCount} edges · {platformMetrics.scanners.incompleteBundleCount} incomplete
              </small>
            </div>
            <div>
              <span>Test executions</span>
              <b>{platformMetrics.tests.executionCount}</b>
              <small>
                {platformMetrics.tests.unstableTestSpecCount} unstable · mean {platformMetrics.tests.duration.meanMs ?? "N/A"} ms
              </small>
            </div>
            <div>
              <span>Evidence objects</span>
              <b>{platformMetrics.evidence.evidenceCount}</b>
              <small>{platformMetrics.evidence.externalObjectCount} external objects</small>
            </div>
            <div>
              <span>Impact assessments</span>
              <b>{platformMetrics.impactAnalysis.assessmentCount}</b>
              <small>
                {platformMetrics.impactAnalysis.regressionSelectionCount} regression selections · mean {platformMetrics.impactAnalysis.duration.meanMs ?? "N/A"} ms
              </small>
            </div>
          </div>
          <div className="unavailable-list">
            {platformMetrics.unavailableSignals.map((item) => (
              <div key={item.signal}>
                <b>
                  {item.signal} · {term(item.status)}
                </b>
                <p>{item.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="metrics-grid">
        <section className="panel metrics-card">
          <div className="panel-head">
            <div>
              <h2>{t("证据新鲜度与断点", "Evidence freshness and breakpoints")}</h2>
              <p>{t("未知和不完整不会被其他维度抵消。", "Unknown and incomplete states are never offset by other dimensions.")}</p>
            </div>
          </div>
          <div className="metric-breakdown">
            <h3>Evidence freshness</h3>
            {Object.entries(current.evidenceFreshness).map(([key, value]) => (
              <div key={key}>
                <span>{term(key)}</span>
                <b>{value}</b>
              </div>
            ))}
            <h3>TraceGap by type</h3>
            {Object.entries(current.gapBreakdown.byType).map(([key, value]) => (
              <div key={key}>
                <span>{term(key)}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="panel metrics-card">
          <div className="panel-head">
            <div>
              <h2>{t("明确缺失的数据源", "Explicitly unavailable data sources")}</h2>
              <p>{t("无法由仓库内事实证明的指标不会被估算。", "Metrics that cannot be proven from repository Facts are not estimated.")}</p>
            </div>
          </div>
          <div className="unavailable-list">
            {current.unavailableMetrics.map((item) => (
              <div key={item.metric}>
                <b>{term(item.metric)}</b>
                <p>{item.reason}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="panel feature-metrics">
        <div className="panel-head">
          <div>
            <h2>{t("Feature 追溯维度", "Feature traceability dimensions")}</h2>
            <p>{t("逐项显示产品、规则、实现、数据、配置、测试、断言、执行与 Evidence。", "Show product, rules, implementation, data, configuration, tests, assertions, execution, and Evidence separately.")}</p>
          </div>
        </div>
        {current.features.map((feature) => (
          <div className="feature-metric-row" key={feature.featureId}>
            <div>
              <b>{feature.name}</b>
              <small>
                {feature.featureId} · {feature.highValue ? t("高价值", "HIGH VALUE") : t("受治理", "GOVERNED")} · {feature.openGapCount} {t("个缺口", "gaps")}
              </small>
            </div>
            <span className={`graph-status ${feature.chainComplete ? "active" : "gap"}`}>{term(feature.chainComplete ? "COMPLETE" : "INCOMPLETE")}</span>
            <div className="coverage-flags">
              {Object.entries(feature.coverage).map(([key, present]) => (
                <span className={present ? "present" : "missing"} key={key}>
                  {term(key)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function ImpactView({ apiBase, apiToken, projectId }: { apiBase: string; apiToken: string; projectId: string }) {
  const { t, term } = useI18n();
  const [changeSetId, setChangeSetId] = useState("CHANGESET-UI-001");
  const [fromSnapshot, setFromSnapshot] = useState("SNAPSHOT-TRAQEN-7D31E8");
  const [toSnapshot, setToSnapshot] = useState("SNAPSHOT-TRAQEN-92A44C");
  const [result, setResult] = useState<ImpactResult | null>(null);
  const [protection, setProtection] = useState<ContinuousProtection | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [repairFeatureId, setRepairFeatureId] = useState("FEATURE-TRACEABILITY-001");
  const [repairClaimId, setRepairClaimId] = useState("CLAIM-TRACEABILITY-PROOF-001");
  const [repairRunId, setRepairRunId] = useState("");
  const [repairCandidateId, setRepairCandidateId] = useState("");
  const [repairAnalysisId, setRepairAnalysisId] = useState("IMPLEMENTATION-REANALYSIS-UI-001");
  const [repairRationale, setRepairRationale] = useState("开发负责人确认新 Snapshot 的实现候选仍满足既有规范性 Claim。");
  const [repairToken, setRepairToken] = useState("");
  const [repairMessage, setRepairMessage] = useState("");

  async function loadContinuousProtection(targetChangeSetId = changeSetId) {
    const base = apiBase.replace(/\/$/, "");
    const response = await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/change-sets/${encodeURIComponent(targetChangeSetId)}/continuous-protection`, { headers: apiHeaders(apiToken, { accept: "application/json" }) });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
    setProtection(body as unknown as ContinuousProtection);
  }

  async function refreshContinuousProtection() {
    setLoading(true);
    setMessage("");
    try {
      await loadContinuousProtection();
      setMessage(t("已刷新服务端增量回归计划与质量门禁。", "Refreshed the server-derived incremental regression plan and quality gate."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("质量门禁刷新失败", "Quality gate refresh failed"));
    } finally {
      setLoading(false);
    }
  }

  async function compareSnapshots() {
    setLoading(true);
    setMessage("");
    try {
      const base = apiBase.replace(/\/$/, "");
      const response = await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/change-sets`, {
        method: "POST",
        headers: apiHeaders(apiToken, { "content-type": "application/json" }),
        body: JSON.stringify({
          id: changeSetId,
          fromSnapshotManifestId: fromSnapshot,
          toSnapshotManifestId: toSnapshot,
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
      const impactResult = body as unknown as ImpactResult;
      setResult(impactResult);
      setRepairFeatureId(impactResult.impact.affectedFeatureIds[0] ?? repairFeatureId);
      setRepairClaimId(impactResult.impact.affectedClaimRefs[0]?.id ?? repairClaimId);
      await loadContinuousProtection(impactResult.changeSet.id);
      setMessage(t("已加载 Snapshot 影响、增量回归计划和服务端质量门禁。", "Loaded Snapshot impact, the incremental regression plan, and the server quality gate."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Snapshot 比较失败", "Snapshot comparison failed"));
    } finally {
      setLoading(false);
    }
  }

  async function reanalyzeAffectedImplementation() {
    if (!repairRunId.trim() || !repairCandidateId.trim() || !repairToken.trim()) {
      setRepairMessage(t("需要新 Snapshot 的 Reverse Run、Candidate 与实现审核凭据。", "A Reverse Run, Candidate, and implementation review credential for the new Snapshot are required."));
      return;
    }
    setLoading(true);
    setRepairMessage("");
    try {
      const base = apiBase.replace(/\/$/, "");
      const response = await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(repairFeatureId)}/claims/${encodeURIComponent(repairClaimId)}/implementation-reanalyses`, {
        method: "POST",
        headers: apiHeaders(apiToken, {
          authorization: `Bearer ${repairToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          id: repairAnalysisId,
          sourceRunId: repairRunId,
          sourceCandidateId: repairCandidateId,
          rationale: repairRationale,
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
      const conformance = body.conformance as { status?: string; snapshotManifestId?: string } | undefined;
      setRepairMessage(t(`服务端已重建当前实现映射：${term(conformance?.status ?? "RECORDED")} · ${conformance?.snapshotManifestId ?? toSnapshot}`, `The server rebuilt the current implementation mapping: ${term(conformance?.status ?? "RECORDED")} · ${conformance?.snapshotManifestId ?? toSnapshot}`));
      setRepairToken("");
    } catch (error) {
      setRepairMessage(error instanceof Error ? error.message : t("实现重分析失败", "Implementation reanalysis failed"));
    } finally {
      setLoading(false);
    }
  }

  const changes = result?.changeSet.changes ?? [
    {
      id: "CHANGE-SELF-WORKSPACE-001",
      kind: "MODIFIED",
      changeType: "SOURCE_CODE",
      artifact: "src/domain/trace-chain.js",
    },
  ];
  const invalidations = result?.impact.invalidations ?? [
    {
      id: "INVALIDATION-SELF-WORKSPACE-001",
      featureId: "FEATURE-TRACEABILITY-001",
      layers: ["CONFORMANCE", "VERIFICATION", "TRACE_SEGMENTS"],
      preserves: ["NORMATIVE_CLAIM", "BUSINESS_DECISION", "HISTORICAL_FACTS", "HISTORICAL_EVIDENCE"],
      reason: "追踪链评估器 Fact 的内容 Hash 发生变化，旧实现映射不能证明新 Snapshot。",
      recommendedActions: ["REMAP_IMPLEMENTATION_FACTS", "RECOMPUTE_IMPLEMENTATION_CONFORMANCE", "RERUN_AFFECTED_TESTS", "RECOMPUTE_TRACE_CHAIN"],
    },
  ];
  const affectedFeatures = result?.impact.affectedFeatureIds ?? ["FEATURE-TRACEABILITY-001"];
  const affectedClaims = result?.impact.affectedClaimRefs ?? [{ id: "CLAIM-TRACEABILITY-PROOF-001", version: 2 }];
  const affectedTests = result?.impact.affectedTestSpecIds ?? ["TEST-TRACEABILITY-COMPLETE-001"];
  const qualityGate = protection?.qualityGate ?? {
    status: "BLOCKED" as const,
    policyMode: "ADVISORY" as const,
    enforcement: "WARN" as const,
    reasons: ["FEATURE_PROOF_CHAIN_INCOMPLETE"],
    requiredActions: ["REPAIR_TRACE_GAPS", "RERUN_SELECTED_TESTS"],
  };
  const regressionTests = protection?.regressionPlan.selectedTests ?? [
    {
      id: "TEST-TRACEABILITY-COMPLETE-001",
      version: 3,
      featureId: "FEATURE-TRACEABILITY-001",
      name: "功能追溯完整链回归",
      approved: true,
      operationLevel: "READ_ONLY",
      reasons: ["MAPPED_IMPLEMENTATION_CHANGE"],
    },
  ];

  return (
    <>
      <section className="panel review-loader">
        <div className="panel-head">
          <div>
            <h2>历史版本比较</h2>
            <p>由服务端比较两个不可变 Snapshot Manifest，并持久化可审计 ChangeSet。</p>
          </div>
          <span className={`mode-badge ${result ? "live" : ""}`}>{result ? "LIVE IMPACT" : "SELF WORKSPACE"}</span>
        </div>
        <div className="inline-form impact-form">
          <div className="field">
            <label htmlFor="change-set">ChangeSet ID</label>
            <input id="change-set" value={changeSetId} onChange={(event) => setChangeSetId(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="from-snapshot">From Snapshot</label>
            <input id="from-snapshot" value={fromSnapshot} onChange={(event) => setFromSnapshot(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="to-snapshot">To Snapshot</label>
            <input id="to-snapshot" value={toSnapshot} onChange={(event) => setToSnapshot(event.target.value)} />
          </div>
          <button className="button primary" disabled={loading} onClick={compareSnapshots}>
            {loading ? t("比较中…", "Comparing…") : t("比较并记录影响", "Compare and record impact")}
          </button>
        </div>
        {message && <div className="inline-message">{message}</div>}
      </section>
      <section className="panel protection-panel">
        <div className="panel-head">
          <div>
            <h2>{t("增量回归与质量门禁", "Incremental regression and quality gate")}</h2>
            <p>{t("静态影响测试与固定高风险集取并集；影响不完整时自动扩大范围，不把未知显示为通过。", "Take the union of statically impacted tests and the fixed high-risk set. Incomplete impact expands the scope and never presents unknown as passed.")}</p>
          </div>
          <button className="button" disabled={loading || !result} onClick={() => void refreshContinuousProtection()}>
            {protection ? t("刷新门禁", "Refresh gate") : t("等待真实 ChangeSet", "Await real ChangeSet")}
          </button>
        </div>
        <div className="protection-summary">
          <div className={`gate-card ${qualityGate.status.toLowerCase()}`}>
            <span>{t("可信状态", "Trust status")}</span>
            <strong>{term(qualityGate.status)}</strong>
            <small>{qualityGate.reasons.map(term).join(" · ") || t("所有受影响链路已恢复", "All affected chains are restored")}</small>
          </div>
          <div className="gate-card">
            <span>{t("执行策略", "Execution policy")}</span>
            <strong>{term(qualityGate.policyMode)}</strong>
            <small>CI/CD: {term(qualityGate.enforcement)}</small>
          </div>
          <div className="gate-card">
            <span>{t("回归选择", "Regression selection")}</span>
            <strong>{regressionTests.length} TestSpec</strong>
            <small>{term(protection?.regressionPlan.selectionStrategy ?? "TARGETED_UNION_HIGH_RISK")}</small>
          </div>
        </div>
        <div className="regression-list">
          {regressionTests.map((testSpec) => (
            <div key={testSpec.id}>
              <b>
                {testSpec.id}@{testSpec.version} · {testSpec.name}
              </b>
              <span>
                {testSpec.featureId} · {term(testSpec.operationLevel)}
              </span>
              <small>{testSpec.reasons.map(term).join(" + ")}</small>
            </div>
          ))}
        </div>
        {qualityGate.requiredActions.length > 0 && (
          <div className="gate-actions">
            <b>{t("门禁要求：", "Gate requirements:")}</b>
            {qualityGate.requiredActions.map((action) => (
              <span key={action}>{term(action)}</span>
            ))}
          </div>
        )}
      </section>
      <div className="impact-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{t("Snapshot 变更影响", "Snapshot change impact")}</h2>
              <p>
                {result?.changeSet.fromSnapshotManifestId ?? fromSnapshot} → {result?.changeSet.toSnapshotManifestId ?? toSnapshot}
              </p>
            </div>
            <span className="mode-badge">{changes.length} FACT CHANGES</span>
          </div>
          <div className="impact-summary">
            <div className="metric">
              <strong>{affectedFeatures.length}</strong>
              <span>{t("受影响 Feature", "Affected Features")}</span>
            </div>
            <div className="metric">
              <strong>{affectedClaims.length}</strong>
              <span>{t("受影响 Claim", "Affected Claims")}</span>
            </div>
            <div className="metric">
              <strong>{affectedTests.length}</strong>
              <span>{t("需重跑 TestSpec", "TestSpecs to rerun")}</span>
            </div>
          </div>
          <div className="candidate">
            {changes.slice(0, 8).map((change) => (
              <div className="impact-row" key={change.id}>
                <b>
                  {term(change.kind)} · {term(change.changeType)} · {change.artifact ?? change.id}
                </b>
                <p>该差异来自服务端 Fact Graph 比较；缺失或不完整扫描会保留 warning，不能伪装成完整影响结论。</p>
              </div>
            ))}
            {invalidations.map((item) => (
              <div className="impact-row" key={item.id}>
                <b>
                  {item.featureId} · {t("分层失效", "layered invalidation")}
                </b>
                <p>{item.reason}</p>
                <p>
                  {item.layers.map((layer) => (
                    <span className="preserved invalidated" key={layer}>
                      {term(layer)} → {term("STALE")}
                    </span>
                  ))}
                </p>
                <p>
                  {item.preserves.map((layer) => (
                    <span className="preserved" key={layer}>
                      {term(layer)}
                    </span>
                  ))}
                </p>
              </div>
            ))}
            {result && result.changeSet.warnings.length > 0 && (
              <div className="impact-row">
                <b>{t("比较警告", "Comparison warnings")}</b>
                <p>{result.changeSet.warnings.join(" · ")}</p>
              </div>
            )}
          </div>
        </section>
        <section className="panel impact-card">
          <p className="eyebrow">Repair queue</p>
          <h2>{t("断链修复顺序", "Broken-chain repair order")}</h2>
          {[...new Set(invalidations.flatMap((item) => item.recommendedActions))].map((action, index) => (
            <div className="impact-row" key={action}>
              <b>
                {index + 1} · {term(action)}
              </b>
              <p>按服务端给出的推荐动作修复受影响 segment；Claim、Decision 与历史 Evidence 不因代码变化自动删除。</p>
            </div>
          ))}
          {result && result.impact.continuedFeatureIds.length > 0 && (
            <div className="impact-row">
              <b>无需失效的连续 Feature</b>
              <p>{result.impact.continuedFeatureIds.join(" · ")}</p>
            </div>
          )}
          <div className="repair-form">
            <p className="eyebrow">Authorized implementation repair</p>
            <h2>重建当前实现映射</h2>
            <p>先对新 Snapshot 执行 Reverse Run，再由开发/架构角色把候选 Fact 重新关联到既有 Claim；不会创建或改写业务 Decision。</p>
            <div className="review-fields">
              <div className="field">
                <label htmlFor="repair-feature">Feature ID</label>
                <input id="repair-feature" value={repairFeatureId} onChange={(event) => setRepairFeatureId(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="repair-claim">Claim ID</label>
                <input id="repair-claim" value={repairClaimId} onChange={(event) => setRepairClaimId(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="repair-run">Reverse Run ID</label>
                <input id="repair-run" value={repairRunId} onChange={(event) => setRepairRunId(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="repair-candidate">Candidate ID</label>
                <input id="repair-candidate" value={repairCandidateId} onChange={(event) => setRepairCandidateId(event.target.value)} />
              </div>
              <div className="field full">
                <label htmlFor="repair-analysis">Analysis ID</label>
                <input id="repair-analysis" value={repairAnalysisId} onChange={(event) => setRepairAnalysisId(event.target.value)} />
              </div>
              <div className="field full">
                <label htmlFor="repair-rationale">重分析理由</label>
                <textarea id="repair-rationale" value={repairRationale} onChange={(event) => setRepairRationale(event.target.value)} />
              </div>
              <div className="field full">
                <label htmlFor="repair-token">Implementation reviewer bearer token（成功后清空）</label>
                <input id="repair-token" type="password" autoComplete="off" value={repairToken} onChange={(event) => setRepairToken(event.target.value)} />
              </div>
            </div>
            <button className="button primary repair-button" disabled={loading} onClick={reanalyzeAffectedImplementation}>
              提交实现重分析
            </button>
            {repairMessage && <div className="review-notice">{repairMessage}</div>}
          </div>
        </section>
      </div>
    </>
  );
}
