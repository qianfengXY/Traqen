import traceChainSource from "../../src/domain/trace-chain.js?raw";
import featureGraphSource from "../../src/domain/feature-graph.js?raw";
import featureApiTraceabilityMarkdown from "../../docs/features/F002-feature-api-traceability.zh-CN.md?raw";
import featureApiTraceabilityEnglishMarkdown from "../../docs/features/F002-feature-api-traceability.md?raw";

export type ConfirmationStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "EXCEPTION_RECORDED";
export type TestResultStatus = "PASS" | "FAIL" | "ERROR" | "NOT_RUN";

export type HumanConfirmation = {
  status: ConfirmationStatus;
  confirmedAt: string;
  owner: string;
  rationale: string;
  decisionId: string;
  version: number;
};

export type FeatureDescriptionDocument = {
  title: string;
  version: number;
  purpose: string;
  businessLogic: string[];
  permissions: string[];
  prerequisites: string[];
  dependencies: string[];
  applicableScope: string[];
  exceptions: string[];
  confirmation: HumanConfirmation;
};

export type DesignDocument = {
  id: string;
  title: string;
  version: string;
  owner: string;
  updatedAt: string;
  status: "APPROVED" | "DRAFT" | "STALE";
  overview: string;
  markdownFile: { path: string; content: string };
  englishMarkdownFile?: { path: string; content: string };
  sourceFiles: Array<{
    path: string;
    language: string;
    content: string;
    factIds: string[];
  }>;
  flow: string[];
  decisions: Array<{ title: string; content: string }>;
  codeBlocks: Array<{
    id: string;
    title: string;
    language: string;
    file: string;
    startLine: number;
    code: string;
    factId: string;
  }>;
};

export type EnvironmentName = "DEV" | "SIT" | "UAT" | "PROD";

export type EnvironmentConfiguration = {
  key: string;
  description: string;
  source: string;
  sensitive: boolean;
  values: Record<EnvironmentName, string>;
};

export type TestStep = {
  id: string;
  executor: "FIXTURE" | "HTTP" | "DATABASE" | "LOG" | "TRACE" | "CLEANUP" | "DOMAIN" | "GRAPH" | "CONTRACT";
  action: string;
  expected: string;
};

export type TestCaseDefinition = {
  id: string;
  version: number;
  title: string;
  scenario: string;
  priority: "P0" | "P1" | "P2";
  operationLevel: "READ_ONLY" | "CONTROLLED_WRITE";
  automationStatus: "READY" | "MANUAL" | "BLOCKED";
  objective: string;
  preconditions: string[];
  testData: string[];
  steps: TestStep[];
  assertions: string[];
  fixtureProtocol: string | null;
  cleanupProtocol: string | null;
  requiredCapabilities: string[];
};

export type TestDesign = {
  strategy: {
    objective: string;
    riskFocus: string[];
    levels: string[];
    dataStrategy: string;
    environmentStrategy: string;
    exitCriteria: string[];
  };
  cases: TestCaseDefinition[];
  agentContract: {
    schema: string;
    requestFields: string[];
    resultFields: string[];
    note: string;
  };
};

export type ScenarioTestResult = {
  id: string;
  executionId: string;
  testCaseId: string;
  scenario: string;
  status: TestResultStatus;
  applicability: "CURRENT" | "HISTORICAL";
  startedAt: string | null;
  durationMs: number | null;
  environment: EnvironmentName;
  deploymentId: string;
  summary: string;
  failedStepId: string | null;
  expected: string | null;
  actual: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  evidenceIds: string[];
};

export type TraceDetailArtifacts = {
  featureDescription: FeatureDescriptionDocument;
  design: DesignDocument;
  configurations: EnvironmentConfiguration[];
  testDesign: TestDesign;
  testResults: ScenarioTestResult[];
};

const testCases: TestCaseDefinition[] = [
  {
    id: "TC-TRACEABILITY-COMPLETE-001",
    version: 3,
    title: "当前部署形成完整证明链",
    scenario: "完整证明链",
    priority: "P0",
    operationLevel: "READ_ONLY",
    automationStatus: "READY",
    objective: "证明权威、Scope、实现符合、已批准 TestSpec、当前执行和完整 Evidence 同时成立时，服务端返回完整追踪链。",
    preconditions: ["Feature/Claim/Scope/Decision 已版本化", "Snapshot Manifest 完整", "执行精确绑定当前部署与 TestSpec 版本"],
    testData: ["PROJECT-TRAQEN", "FEATURE-TRACEABILITY-001", "SNAPSHOT-TRAQEN-7D31E8", "DEPLOY-TRAQEN-20260716.4"],
    steps: [
      {
        id: "build-complete-input",
        executor: "FIXTURE",
        action: "构造包含当前 Claim、Fact、TestSpec、Execution 和 Evidence 的领域输入",
        expected: "所有不可变身份互相匹配",
      },
      {
        id: "evaluate-chain",
        executor: "DOMAIN",
        action: "调用 evaluateTraceChain",
        expected: "complete=true，gaps=[]",
      },
      {
        id: "verify-dimensions",
        executor: "CONTRACT",
        action: "逐项检查六个可信维度与有序 segments",
        expected: "维度独立，segments 保留来源",
      },
    ],
    assertions: ["chain.complete = true", "chain.gaps.length = 0", "verification = PASS", "freshness = FRESH", "conflict = NONE"],
    fixtureProtocol: "FIXTURE-TRACEABILITY-COMPLETE-001",
    cleanupProtocol: null,
    requiredCapabilities: ["NODE_TEST_RUNNER", "SIGNED_EVIDENCE", "SNAPSHOT_IDENTITY"],
  },
  {
    id: "TC-TRACEABILITY-GAP-002",
    version: 2,
    title: "缺失信息保持为明确 TraceGap",
    scenario: "缺口透明性",
    priority: "P0",
    operationLevel: "READ_ONLY",
    automationStatus: "READY",
    objective: "证明未确认权威、未知 Scope 或未映射实现不会被其他通过项抵消。",
    preconditions: ["输入合法但故意省略一个或多个证明层", "不存在伪造默认值"],
    testData: ["authority=UNREVIEWED", "scope=null", "implementation={} "],
    steps: [
      {
        id: "evaluate-incomplete-chain",
        executor: "DOMAIN",
        action: "评估不完整输入",
        expected: "complete=false",
      },
      {
        id: "inspect-gap-owners",
        executor: "CONTRACT",
        action: "检查 TraceGap 类型、严重度和 ownerRole",
        expected: "业务、产品和技术缺口分别归属",
      },
    ],
    assertions: ["MISSING_AUTHORITY 可见", "SCOPE_UNKNOWN 可见", "IMPLEMENTATION_UNMAPPED 可见", "不存在综合分数"],
    fixtureProtocol: "FIXTURE-TRACEABILITY-GAPS-002",
    cleanupProtocol: null,
    requiredCapabilities: ["NODE_TEST_RUNNER", "TRACE_GAP_SCHEMA"],
  },
  {
    id: "TC-TRACEABILITY-STALE-003",
    version: 2,
    title: "旧部署执行不能证明新 Snapshot",
    scenario: "新鲜度边界",
    priority: "P0",
    operationLevel: "READ_ONLY",
    automationStatus: "READY",
    objective: "证明部署、Snapshot 或 TestSpec 版本变化后，历史结果继续保留但当前验证变为 NOT_RUN，Evidence 变为 STALE。",
    preconditions: ["存在上一部署 PASS 执行", "当前 Snapshot 或 deploymentId 已变化"],
    testData: ["DEPLOY-TRAQEN-20260716.4 → .5", "TestSpec version=3"],
    steps: [
      {
        id: "change-snapshot-identity",
        executor: "FIXTURE",
        action: "保持历史执行并切换当前部署身份",
        expected: "历史记录不被删除",
      },
      {
        id: "evaluate-current-chain",
        executor: "DOMAIN",
        action: "重新评估当前链",
        expected: "verification=NOT_RUN，freshness=STALE",
      },
    ],
    assertions: ["NOT_EXECUTED_ON_CURRENT_DEPLOYMENT 可见", "EVIDENCE_STALE 可见", "历史 PASS 不等于当前 PASS"],
    fixtureProtocol: "FIXTURE-TRACEABILITY-STALE-003",
    cleanupProtocol: null,
    requiredCapabilities: ["NODE_TEST_RUNNER", "SNAPSHOT_IDENTITY"],
  },
  {
    id: "TC-TRACEABILITY-GRAPH-004",
    version: 1,
    title: "追踪链可投影并查询端到端路径",
    scenario: "图谱投影",
    priority: "P1",
    operationLevel: "READ_ONLY",
    automationStatus: "READY",
    objective: "证明相同服务端追溯数据可以按业务、实现、覆盖率和完整视图投影，并查询 Feature 到 Evidence 的路径。",
    preconditions: ["完整追溯响应已经生成", "图谱深度和节点上限合法"],
    testData: ["view=traceability", "depth=8", "from=FEATURE-TRACEABILITY-001", "to=EVIDENCE-TRACEABILITY-RESPONSE-001"],
    steps: [
      {
        id: "project-graph",
        executor: "GRAPH",
        action: "调用 createFeatureGraphProjection",
        expected: "节点、边、来源和状态被保留",
      },
      {
        id: "query-path",
        executor: "GRAPH",
        action: "调用 queryFeatureGraphPath",
        expected: "返回 Feature → Claim → TestSpec → Execution → Evidence 路径",
      },
    ],
    assertions: ["center = FEATURE-TRACEABILITY-001", "path.found = true", "所有边保留 relation 与 provenance"],
    fixtureProtocol: "FIXTURE-TRACEABILITY-GRAPH-004",
    cleanupProtocol: null,
    requiredCapabilities: ["NODE_TEST_RUNNER", "GRAPH_PROJECTION"],
  },
  {
    id: "TC-TRAQEN-BILINGUAL-DOC-005",
    version: 1,
    title: "功能设计文档保持中英文成对",
    scenario: "文档一致性",
    priority: "P1",
    operationLevel: "READ_ONLY",
    automationStatus: "READY",
    objective: "证明 Traqen Workspace 的 Markdown 设计文档同时存在英文与简体中文版本，并且语言切换链接可被自动发现。",
    preconditions: ["文档位于 docs/ 或仓库 README 边界", "文件名遵守 .zh-CN.md 配对约定"],
    testData: ["docs/features/F002-feature-api-traceability.md", "docs/features/F002-feature-api-traceability.zh-CN.md"],
    steps: [
      {
        id: "discover-document-pairs",
        executor: "CONTRACT",
        action: "扫描需要双语维护的 Markdown 文件",
        expected: "每个源文件都有对应语言版本",
      },
      {
        id: "verify-language-switch",
        executor: "CONTRACT",
        action: "检查文档首行语言切换链接",
        expected: "两个版本互相链接且目标存在",
      },
    ],
    assertions: ["英文文档存在", "简体中文文档存在", "语言切换位于文档开头", "链接目标可访问"],
    fixtureProtocol: null,
    cleanupProtocol: null,
    requiredCapabilities: ["NODE_TEST_RUNNER", "FILESYSTEM_READ"],
  },
];

export const currentTraqenArtifacts: TraceDetailArtifacts = {
  featureDescription: {
    title: "功能追溯 / Feature traceability",
    version: 4,
    purpose: "把 Traqen 自己作为一个 Workspace，针对所选 Feature、Snapshot 与部署，展示从完整功能说明到设计源码、环境配置、测试设计和真实执行结果的端到端证明链。",
    businessLogic: ["追踪链必须从版本化的规范性 Claim 开始，并关联明确 Scope 与授权人工 Decision；代码和 Agent 输出不能替代业务权威。", "服务端分别计算权威、实现符合、验证结果、Evidence 新鲜度与冲突，任何维度都不能通过平均分掩盖另一维度的未知或失败。", "实现 Fact、TestSpec、Execution 与 Evidence 必须绑定同一 Snapshot/部署身份；变更后保留历史，同时只让受影响的派生层变为 STALE。", "页面以功能描述、设计实现、配置、测试用例和测试结果五段呈现数据，并保留其下层 Claim → Scope → Decision → Fact → TestSpec → Execution → Evidence 关系。"],
    permissions: ["读取生产追溯数据需要有效 API_BEARER_TOKEN", "业务确认只允许 business-owner / product-owner", "实现重分析只允许 technical-owner", "Agent 只能提交候选、执行结果与 Evidence，不能修改人工 Decision"],
    prerequisites: ["Project 与不可变 Snapshot Manifest 已注册", "Feature、Claim、Scope 与 Decision 已建立治理基线", "Scanner Fact 与实现符合分析绑定当前 Snapshot", "已批准 TestSpec 和当前部署执行可用"],
    dependencies: ["Snapshot Manifest 与 Fact Graph", "Claim/Scope/Decision 治理模型", "TestSpec、Runner 与 Evidence 生命周期", "PostgreSQL 或开发期内存存储", "HTTP API 与产品 Web 投影"],
    applicableScope: ["Workspace: Traqen Platform", "Feature: 受治理的产品能力", "Environment: DEV/SIT/UAT/PROD", "时间边界: 当前选中的 Snapshot Manifest 与 deploymentId"],
    exceptions: ["缺失或扫描不完整时显示明确 TraceGap", "旧部署结果只作为 HISTORICAL 审计记录", "冲突在被授权人员解决前保持 UNRESOLVED", "敏感配置仅展示 Secret 引用"],
    confirmation: {
      status: "CONFIRMED",
      confirmedAt: "2026-07-16T18:20",
      owner: "product-owner / Traqen",
      rationale: "确认产品愿景是以可审计证据证明功能从业务意图到当前运行结果的完整关系，并以 Traqen 自身作为首个 Workspace 演示。",
      decisionId: "DECISION-TRACEABILITY-001",
      version: 2,
    },
  },
  design: {
    id: "DESIGN-FEATURE-TRACEABILITY-001",
    title: "功能追溯服务端派生与自 Workspace 设计",
    version: "4.0",
    owner: "Traqen architecture",
    updatedAt: "2026-07-16 18:40 CST",
    status: "APPROVED",
    overview: "应用层加载治理基线、实现 Fact、测试与 Evidence；领域层生成相互独立的可信维度、有序 segment 和 TraceGap；图谱层提供有界投影与路径查询；Web 只展示服务端事实。",
    markdownFile: {
      path: "docs/features/F002-feature-api-traceability.zh-CN.md",
      content: featureApiTraceabilityMarkdown,
    },
    englishMarkdownFile: {
      path: "docs/features/F002-feature-api-traceability.md",
      content: featureApiTraceabilityEnglishMarkdown,
    },
    sourceFiles: [
      {
        path: "src/domain/trace-chain.js",
        language: "javascript",
        content: traceChainSource,
        factIds: ["FACT-TRACE-CHAIN-EVALUATOR", "FACT-TRACE-GAP-OWNERSHIP"],
      },
      {
        path: "src/domain/feature-graph.js",
        language: "javascript",
        content: featureGraphSource,
        factIds: ["FACT-FEATURE-GRAPH-PROJECTION", "FACT-FEATURE-GRAPH-PATH"],
      },
    ],
    flow: ["GET /v1/projects/{projectId}/features/{featureId}/traceability", "加载治理基线和 Snapshot-bound Facts", "evaluateTraceChain 派生维度、segments 与 gaps", "createFeatureGraphProjection 生成有界视图", "Web/Agent 消费相同的服务端结果"],
    decisions: [
      {
        title: "权威边界",
        content: "业务 Claim 必须由授权人工 Decision 确认；Scanner、代码和 Agent 不能自动生成规范性事实。",
      },
      {
        title: "可信边界",
        content: "权威、符合、验证、新鲜度和冲突独立展示，不计算会掩盖缺口的综合绿色分数。",
      },
      {
        title: "时间边界",
        content: "Execution 必须同时匹配 deploymentId、snapshotManifestId 和 TestSpec 版本，旧 Evidence 自动成为历史证明。",
      },
    ],
    codeBlocks: [
      {
        id: "CODE-TRACE-CHAIN-COMPLETENESS",
        title: "完整性由阻断级 TraceGap 决定",
        language: "javascript",
        file: "src/domain/trace-chain.js",
        startLine: 376,
        factId: "FACT-TRACE-CHAIN-EVALUATOR",
        code: ["return Object.freeze({", "  id: chainId,", "  ...identity,", "  dimensions,", "  stages: Object.freeze([", '    { name: "BUSINESS_INTENT", status: authority },', '    { name: "SCOPE", status: input.scope?.id ? "DEFINED" : "UNKNOWN" },', '    { name: "IMPLEMENTATION_CONFORMANCE", status: conformance },', '    { name: "TECHNICAL_IMPLEMENTATION", status: implementationMapped(input.implementation) ? "MAPPED" : "UNMAPPED" },', '    { name: "TEST_SPEC", status: testSpec?.approved ? "APPROVED" : testSpec?.id ? "UNAPPROVED" : "MISSING" },', '    { name: "EXECUTION", status: verification },', '    { name: "EVIDENCE", status: freshness },', "  ]),", "  segments,", "  conflicts,", "  complete: !uniqueGaps.some((item) => item.severity === GapSeverity.BLOCKING),", "  gaps: Object.freeze(uniqueGaps),", "  computedAt: clock().toISOString(),", "});"].join("\n"),
      },
      {
        id: "CODE-FEATURE-GRAPH-PROJECTION",
        title: "相同追溯数据生成有界图谱投影",
        language: "javascript",
        file: "src/domain/feature-graph.js",
        startLine: 374,
        factId: "FACT-FEATURE-GRAPH-PROJECTION",
        code: [
          "export function createFeatureGraphProjection(traceability, options = {}) {",
          '  if (traceability === null || typeof traceability !== "object" || Array.isArray(traceability)) {',
          '    throw new TypeError("traceability must be an object");',
          "  }",
          '  const view = options.view ?? "traceability";',
          "  if (!Object.hasOwn(graphViews, view)) {",
          '    throw new TypeError(`view must be one of ${Object.keys(graphViews).join(", ")}`);',
          "  }",
          '  const depth = positiveInteger(options.depth, 1, "depth", 8);',
          '  const limit = positiveInteger(options.limit, 30, "limit", 100);',
          '  const nodeTypes = requireStringArray(options.nodeTypes, "nodeTypes");',
          '  const relations = requireStringArray(options.relations, "relations");',
          "  const complete = buildCompleteGraph(traceability);",
          "  const filtered = viewFilteredGraph(complete, view, nodeTypes, relations);",
          "  const bounded = boundedBreadthFirst(filtered, depth, limit);",
          "  return deepFreeze({",
          "    center: complete.center,",
          "    snapshotManifestId: complete.snapshotManifestId,",
          "    view,",
          "    depth,",
          "    nodes: bounded.nodes,",
          "    edges: bounded.edges,",
          "    truncated: bounded.truncated,",
          "    availableExpansions: bounded.availableExpansions,",
          "  });",
          "}",
        ].join("\n"),
      },
    ],
  },
  configurations: [
    {
      key: "API_BEARER_TOKEN",
      description: "生产 API 访问令牌；页面仅接受用户临时输入，不持久化明文",
      source: "environment / secret manager",
      sensitive: true,
      values: {
        DEV: "not required by dev-server",
        SIT: "required · secret manager reference",
        UAT: "required · secret manager reference",
        PROD: "required · secret manager reference",
      },
    },
    {
      key: "CORS_ALLOWED_ORIGINS",
      description: "允许访问 API 的精确 Web 来源列表；拒绝通配符",
      source: "src/api/application-bootstrap.js",
      sensitive: false,
      values: {
        DEV: "http://127.0.0.1:3000,http://localhost:3000",
        SIT: "deployment-specific exact HTTPS origin",
        UAT: "deployment-specific exact HTTPS origin",
        PROD: "deployment-specific exact HTTPS origin",
      },
    },
    {
      key: "QUALITY_GATE_MODE",
      description: "持续保护质量门禁策略",
      source: "src/api/application-bootstrap.js",
      sensitive: false,
      values: {
        DEV: "ADVISORY (default)",
        SIT: "ADVISORY (default)",
        UAT: "ADVISORY default · policy may override",
        PROD: "ADVISORY default · policy may override",
      },
    },
    {
      key: "DATABASE_URL",
      description: "生产 PostgreSQL 连接；开发启动器使用内存应用，不需要伪造数据库密钥",
      source: "src/api/production-server.js",
      sensitive: true,
      values: {
        DEV: "not required · in-memory store",
        SIT: "required · secret manager reference",
        UAT: "required · secret manager reference",
        PROD: "required · secret manager reference",
      },
    },
  ],
  testDesign: {
    strategy: {
      objective: "从完整链、缺口透明性、Snapshot/部署新鲜度、图谱路径和双语文档一致性五个场景验证功能追溯，证明平台不会把未知、失败或历史结果伪装成当前可信。",
      riskFocus: ["代码或 Agent 越权创建业务事实", "旧部署 PASS 被误认为当前 PASS", "缺失层被综合分数掩盖", "图谱过滤丢失来源或关系", "敏感配置明文泄露"],
      levels: ["领域规则测试", "图谱投影与路径测试", "HTTP/Schema 契约测试", "产品 Web 构建与详情投影", "生产运行边界验证"],
      dataStrategy: "优先使用 Traqen 仓库内真实设计、源码和 Node 测试；场景 Fixture 只构造不可变领域对象，不模拟外部业务。",
      environmentStrategy: "DEV 执行全部领域与 Web 测试；SIT/UAT 绑定真实 Snapshot 和部署验证 API；PROD 只接受已批准、签名且符合权限策略的执行与 Evidence。",
      exitCriteria: ["全部 P0 用例 PASS", "阻断级 TraceGap 为 0", "当前部署 Execution 与 Evidence 均匹配", "历史失败仍可审计", "中英文设计文档同步"],
    },
    cases: testCases,
    agentContract: {
      schema: "traqen.testspec.agent/v1",
      requestFields: ["testCaseId", "version", "snapshotManifestId", "deploymentId", "environment", "targetPolicyId", "fixtureProtocol", "requiredCapabilities"],
      resultFields: ["executionId", "testCaseId", "attempt", "status", "stepResults", "assertionResults", "evidenceRefs", "startedAt", "finishedAt", "runnerIdentity", "attestation"],
      note: "后续 Agent 只能消费已批准、版本固定的 TestSpec；它回传结构化结果和 Evidence，不能修改功能说明、人工 Decision、测试设计或服务端最终可信状态。",
    },
  },
  testResults: [
    {
      id: "RESULT-TRACEABILITY-COMPLETE-001",
      executionId: "EXEC-TRAQEN-DOMAIN-20260716-001",
      testCaseId: "TC-TRACEABILITY-COMPLETE-001",
      scenario: "完整证明链",
      status: "PASS",
      applicability: "CURRENT",
      startedAt: "2026-07-16 18:52:01 CST",
      durationMs: 64,
      environment: "SIT",
      deploymentId: "DEPLOY-TRAQEN-20260716.4",
      summary: "完整输入生成 complete=true、零阻断缺口，并保留六个独立可信维度。",
      failedStepId: null,
      expected: null,
      actual: null,
      errorCode: null,
      errorMessage: null,
      evidenceIds: ["EVIDENCE-TRACEABILITY-DOMAIN-001", "EVIDENCE-TRACEABILITY-CONTRACT-001"],
    },
    {
      id: "RESULT-TRACEABILITY-GAPS-002",
      executionId: "EXEC-TRAQEN-DOMAIN-20260716-002",
      testCaseId: "TC-TRACEABILITY-GAP-002",
      scenario: "缺口透明性",
      status: "PASS",
      applicability: "CURRENT",
      startedAt: "2026-07-16 18:52:02 CST",
      durationMs: 41,
      environment: "SIT",
      deploymentId: "DEPLOY-TRAQEN-20260716.4",
      summary: "未确认权威、未知 Scope 和未映射实现分别形成带责任人的阻断级 TraceGap。",
      failedStepId: null,
      expected: null,
      actual: null,
      errorCode: null,
      errorMessage: null,
      evidenceIds: ["EVIDENCE-TRACE-GAPS-002"],
    },
    {
      id: "RESULT-TRACEABILITY-STALE-003",
      executionId: "EXEC-TRAQEN-DOMAIN-20260716-003B",
      testCaseId: "TC-TRACEABILITY-STALE-003",
      scenario: "新鲜度边界",
      status: "PASS",
      applicability: "CURRENT",
      startedAt: "2026-07-16 18:52:03 CST",
      durationMs: 45,
      environment: "SIT",
      deploymentId: "DEPLOY-TRAQEN-20260716.4",
      summary: "修复后，旧执行保留为历史；当前链明确返回 NOT_RUN 和 STALE。",
      failedStepId: null,
      expected: null,
      actual: null,
      errorCode: null,
      errorMessage: null,
      evidenceIds: ["EVIDENCE-STALE-REGRESSION-003B"],
    },
    {
      id: "RESULT-TRACEABILITY-GRAPH-004",
      executionId: "EXEC-TRAQEN-GRAPH-20260716-004",
      testCaseId: "TC-TRACEABILITY-GRAPH-004",
      scenario: "图谱投影",
      status: "PASS",
      applicability: "CURRENT",
      startedAt: "2026-07-16 18:52:04 CST",
      durationMs: 52,
      environment: "SIT",
      deploymentId: "DEPLOY-TRAQEN-20260716.4",
      summary: "四类视图和 Feature 到 Evidence 的端到端路径均保留 relation、provenance 与状态。",
      failedStepId: null,
      expected: null,
      actual: null,
      errorCode: null,
      errorMessage: null,
      evidenceIds: ["EVIDENCE-GRAPH-PROJECTION-004", "EVIDENCE-GRAPH-PATH-004"],
    },
    {
      id: "RESULT-BILINGUAL-DOC-HISTORICAL-005",
      executionId: "EXEC-BILINGUAL-DOC-20260716-005A",
      testCaseId: "TC-TRAQEN-BILINGUAL-DOC-005",
      scenario: "文档一致性",
      status: "FAIL",
      applicability: "HISTORICAL",
      startedAt: "2026-07-16 19:16:02 CST",
      durationMs: 28,
      environment: "DEV",
      deploymentId: "WORKTREE-BEFORE-LANGUAGE-SWITCH",
      summary: "首次执行发现新增英文设计文档没有以双语语言切换开头；失败信息被保留并据此修复。",
      failedStepId: "verify-language-switch",
      expected: "文档首行包含指向简体中文版本的语言切换链接",
      actual: "文档以一级标题开头，语言切换位于标题之后",
      errorCode: "ERR_ASSERTION",
      errorMessage: "docs/features/F002-feature-api-traceability.md must begin with a bilingual language switch",
      evidenceIds: ["EVIDENCE-BILINGUAL-DOC-FAIL-005"],
    },
    {
      id: "RESULT-BILINGUAL-DOC-005",
      executionId: "EXEC-BILINGUAL-DOC-20260716-005B",
      testCaseId: "TC-TRAQEN-BILINGUAL-DOC-005",
      scenario: "文档一致性",
      status: "PASS",
      applicability: "CURRENT",
      startedAt: "2026-07-16 19:17:08 CST",
      durationMs: 17,
      environment: "DEV",
      deploymentId: "WORKTREE-CODEX-BILINGUAL-DOCS",
      summary: "修复后英文与简体中文设计文档互相链接，双语文档检查通过。",
      failedStepId: null,
      expected: null,
      actual: null,
      errorCode: null,
      errorMessage: null,
      evidenceIds: ["EVIDENCE-BILINGUAL-DOC-PASS-005"],
    },
  ],
};

export const changedTraqenArtifacts: TraceDetailArtifacts = {
  ...currentTraqenArtifacts,
  design: {
    ...currentTraqenArtifacts.design,
    status: "STALE",
    updatedAt: "2026-07-16 19:08 CST",
  },
  testResults: currentTraqenArtifacts.testResults.map((result) =>
    result.applicability === "HISTORICAL"
      ? result
      : {
          ...result,
          id: `${result.id}-STALE`,
          executionId: `${result.executionId}-HISTORICAL`,
          status: "NOT_RUN",
          startedAt: null,
          durationMs: null,
          deploymentId: "DEPLOY-TRAQEN-20260716.5",
          summary: `当前部署尚未执行；上一部署结果 ${result.status} 仅用于审计，不能证明当前版本。`,
          failedStepId: null,
          expected: null,
          actual: null,
          errorCode: null,
          errorMessage: null,
        },
  ),
};
