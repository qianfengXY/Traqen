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
  executor: "FIXTURE" | "HTTP" | "DATABASE" | "LOG" | "TRACE" | "CLEANUP";
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
    id: "TC-ORDER-SUBMIT-HAPPY-001",
    version: 2,
    title: "草稿订单正常提交",
    scenario: "正常流程",
    priority: "P0",
    operationLevel: "CONTROLLED_WRITE",
    automationStatus: "READY",
    objective: "证明普通用户可以提交属于自己的 DRAFT 标准订单，并形成完整业务证据。",
    preconditions: ["order.submit.enabled=true", "用户拥有 order:submit 权限", "订单状态为 DRAFT"],
    testData: ["ORDER-001 由可信 Fixture 创建", "库存 ITEM-001 可预留"],
    steps: [
      { id: "seed-order", executor: "FIXTURE", action: "创建 DRAFT 标准订单 ORDER-001", expected: "订单和库存前置数据创建成功" },
      { id: "invoke-submit", executor: "HTTP", action: "POST /orders/ORDER-001/submit", expected: "HTTP 200，响应状态为 SUBMITTED" },
      { id: "verify-order", executor: "DATABASE", action: "通过可信查询 order_by_id 读取订单", expected: "orders.status=SUBMITTED" },
      { id: "verify-observability", executor: "TRACE", action: "读取订单提交 Trace 与结构化日志", expected: "span=OK 且起止业务事件完整" },
      { id: "cleanup-order", executor: "CLEANUP", action: "执行受控清理协议", expected: "订单与库存 Fixture 清理成功" },
    ],
    assertions: ["HTTP status = 200", "response.status = SUBMITTED", "database.orders.status = SUBMITTED", "Trace status = OK", "cleanup = PASS"],
    fixtureProtocol: "FIXTURE-ORDER-DRAFT-001",
    cleanupProtocol: "CLEANUP-ORDER-001",
    requiredCapabilities: ["HTTP_ALLOWLIST", "TRUSTED_QUERY_CATALOG", "SIGNED_EVIDENCE", "CONTROLLED_FIXTURE"],
  },
  {
    id: "TC-ORDER-SUBMIT-STATE-002",
    version: 1,
    title: "非草稿订单禁止提交",
    scenario: "状态约束",
    priority: "P0",
    operationLevel: "READ_ONLY",
    automationStatus: "READY",
    objective: "证明已提交或已取消订单不能再次提交。",
    preconditions: ["order.submit.enabled=true", "订单状态为 SUBMITTED"],
    testData: ["ORDER-002 为已提交订单"],
    steps: [
      { id: "invoke-resubmit", executor: "HTTP", action: "POST /orders/ORDER-002/submit", expected: "HTTP 409，返回 ORDER_STATE_INVALID" },
      { id: "verify-unchanged", executor: "DATABASE", action: "读取 ORDER-002", expected: "状态仍为 SUBMITTED，未产生额外库存变更" },
    ],
    assertions: ["HTTP status = 409", "error.code = ORDER_STATE_INVALID", "database state unchanged"],
    fixtureProtocol: null,
    cleanupProtocol: null,
    requiredCapabilities: ["HTTP_ALLOWLIST", "TRUSTED_QUERY_CATALOG", "SIGNED_EVIDENCE"],
  },
  {
    id: "TC-ORDER-SUBMIT-AUTH-003",
    version: 1,
    title: "无权限用户禁止提交",
    scenario: "权限控制",
    priority: "P0",
    operationLevel: "READ_ONLY",
    automationStatus: "READY",
    objective: "证明缺少 order:submit 权限的用户不能提交订单。",
    preconditions: ["用户已认证但没有 order:submit 权限", "订单状态为 DRAFT"],
    testData: ["ORDER-003 属于无提交权限用户"],
    steps: [
      { id: "invoke-without-permission", executor: "HTTP", action: "使用受限身份提交 ORDER-003", expected: "HTTP 403，返回 FORBIDDEN" },
      { id: "verify-no-write", executor: "DATABASE", action: "读取 ORDER-003", expected: "状态仍为 DRAFT" },
    ],
    assertions: ["HTTP status = 403", "error.code = FORBIDDEN", "database.orders.status = DRAFT"],
    fixtureProtocol: null,
    cleanupProtocol: null,
    requiredCapabilities: ["IDENTITY_PROFILE", "HTTP_ALLOWLIST", "TRUSTED_QUERY_CATALOG"],
  },
  {
    id: "TC-ORDER-SUBMIT-FLAG-004",
    version: 1,
    title: "功能开关关闭时拒绝提交",
    scenario: "配置约束",
    priority: "P1",
    operationLevel: "READ_ONLY",
    automationStatus: "READY",
    objective: "证明关闭 order.submit.enabled 后系统失败关闭且不写入订单。",
    preconditions: ["目标环境 order.submit.enabled=false", "订单状态为 DRAFT"],
    testData: ["ORDER-004 为可提交草稿订单"],
    steps: [
      { id: "invoke-disabled-feature", executor: "HTTP", action: "POST /orders/ORDER-004/submit", expected: "HTTP 503，返回 FEATURE_DISABLED" },
      { id: "verify-disabled-no-write", executor: "DATABASE", action: "读取 ORDER-004", expected: "状态仍为 DRAFT" },
    ],
    assertions: ["HTTP status = 503", "error.code = FEATURE_DISABLED", "database.orders.status = DRAFT"],
    fixtureProtocol: null,
    cleanupProtocol: null,
    requiredCapabilities: ["ENVIRONMENT_CONFIG_SNAPSHOT", "HTTP_ALLOWLIST", "TRUSTED_QUERY_CATALOG"],
  },
];

export const currentOrderSubmitArtifacts: TraceDetailArtifacts = {
  featureDescription: {
    title: "订单提交 / Submit order",
    version: 3,
    purpose: "允许具备提交权限的普通用户将自己的标准草稿订单安全地提交为正式订单，并留下可验证的状态、库存和审计证据。",
    businessLogic: [
      "仅 DRAFT 状态订单允许提交；重复提交保持幂等，不重复扣减或预留库存。",
      "提交成功后订单进入 SUBMITTED，并产生 ORDER_SUBMIT_RECEIVED 与 ORDER_SUBMIT_COMPLETED 业务事件。",
      "数据库写入或库存处理失败时必须回滚，不能留下部分成功状态。",
    ],
    permissions: ["用户必须已认证", "必须拥有 order:submit 权限", "只能提交属于自己的订单", "管理员强制提交属于独立例外能力"],
    prerequisites: ["订单存在且状态为 DRAFT", "order.submit.enabled=true", "目标商品库存满足预留条件", "订单组件与库存组件版本已记录在当前 Snapshot"],
    dependencies: ["PostgreSQL orders 数据对象", "Inventory reservation service", "身份与权限服务", "订单提交配置中心", "日志与 Trace 基础设施"],
    applicableScope: ["Actor: normal-user / order-owner", "Order type: standard", "Environment: DEV/SIT/UAT/PROD", "不包含管理员强制提交和批量导入订单"],
    exceptions: ["管理员例外必须走 forceSubmit 独立 Claim 与审批边界", "功能开关关闭时失败关闭", "外部库存服务不可用时整体回滚"],
    confirmation: {
      status: "CONFIRMED",
      confirmedAt: "2026-07-14T16:20",
      owner: "business-owner / 王敏",
      rationale: "确认该说明覆盖普通用户标准订单提交主流程；管理员例外独立治理。",
      decisionId: "DECISION-ORDER-001",
      version: 1,
    },
  },
  design: {
    id: "DESIGN-ORDER-SUBMIT-001",
    title: "订单提交事务与证据设计",
    version: "2.1",
    owner: "order-platform-architect",
    updatedAt: "2026-07-14 15:40 CST",
    status: "APPROVED",
    overview: "提交入口先校验身份、权限、订单归属、状态和功能开关，再在受控事务中完成订单状态迁移与库存生命周期处理。所有关键边界输出结构化日志与 Trace。",
    flow: ["HTTP POST /orders/{id}/submit", "鉴权与 order:submit 权限校验", "读取并锁定 DRAFT 订单", "库存预留与订单状态原子提交", "发布业务事件并生成 Evidence"],
    decisions: [
      { title: "状态机边界", content: "只允许 DRAFT → SUBMITTED；其他状态返回稳定冲突错误，不执行写入。" },
      { title: "一致性边界", content: "订单写入失败时撤销库存预留；Cleanup 失败必须形成 ERROR Evidence。" },
      { title: "可观测性边界", content: "请求关联 ID 必须贯穿 API、数据库、日志和 Trace，便于从失败结果反查实现。" },
    ],
    codeBlocks: [
      {
        id: "CODE-ORDER-SUBMIT-HANDLER",
        title: "提交入口与状态校验",
        language: "javascript",
        file: "examples/order-platform/src/order-service.js",
        startLine: 48,
        factId: "FACT-ENDPOINT-ORDER-SUBMIT",
        code: [
          "async submitOrder({ orderId, actor }) {",
          "  const order = await this.orders.lockById(orderId);",
          "  authorize(actor, \"order:submit\", order.ownerId);",
          "  assertState(order, \"DRAFT\");",
          "  return this.transaction.run(() =>",
          "    this.commitSubmission(order)",
          "  );",
          "}",
        ].join("\n"),
      },
      {
        id: "CODE-ORDER-SUBMIT-ROLLBACK",
        title: "失败回滚与库存补偿",
        language: "javascript",
        file: "examples/order-platform/src/order-service.js",
        startLine: 83,
        factId: "FACT-CODE-ORDER-ROLLBACK",
        code: [
          "try {",
          "  await inventory.reserve(order.items);",
          "  await orders.markSubmitted(order.id);",
          "} catch (error) {",
          "  await inventory.release(order.items);",
          "  throw error;",
          "}",
        ].join("\n"),
      },
    ],
  },
  configurations: [
    {
      key: "order.submit.enabled",
      description: "订单提交功能总开关",
      source: "config/order-submit.yaml",
      sensitive: false,
      values: { DEV: "true", SIT: "true", UAT: "true", PROD: "true" },
    },
    {
      key: "order.submit.idempotencyTtlSeconds",
      description: "提交幂等键有效期",
      source: "config/order-submit.yaml",
      sensitive: false,
      values: { DEV: "300", SIT: "900", UAT: "1800", PROD: "1800" },
    },
    {
      key: "inventory.reserve.timeoutMs",
      description: "库存预留调用超时",
      source: "config/inventory-client.yaml",
      sensitive: false,
      values: { DEV: "3000", SIT: "2000", UAT: "1500", PROD: "1500" },
    },
    {
      key: "database.orders.connection",
      description: "订单数据库连接引用；页面不展示密钥",
      source: "secret-manager reference",
      sensitive: true,
      values: { DEV: "secret://traqen/dev/orders", SIT: "secret://traqen/sit/orders", UAT: "secret://traqen/uat/orders", PROD: "secret://traqen/prod/orders" },
    },
  ],
  testDesign: {
    strategy: {
      objective: "从业务规则、权限、状态机、配置和失败补偿五个角度证明订单提交能力，而不是只检查 HTTP 状态。",
      riskFocus: ["非法状态被提交", "越权提交他人订单", "重复提交造成重复库存操作", "数据库失败留下部分成功", "功能开关关闭后仍发生写入"],
      levels: ["API 契约测试", "数据库状态断言", "配置约束测试", "日志与 Trace 断言", "受控写入与 Cleanup 验证"],
      dataStrategy: "写入用例只能使用版本化可信 Fixture；每个用例声明 Seed、数据所有权和 Cleanup 协议。",
      environmentStrategy: "DEV 用于快速契约验证，SIT/UAT 执行真实依赖集成；PROD 默认只接收已批准的只读或合成探针策略。",
      exitCriteria: ["全部 P0 用例 PASS", "不存在 ERROR 或 INSUFFICIENT_EVIDENCE", "Cleanup 全部 PASS", "Evidence 绑定当前部署且保持 FRESH"],
    },
    cases: testCases,
    agentContract: {
      schema: "traqen.testspec.agent/v1",
      requestFields: ["testCaseId", "version", "snapshotManifestId", "deploymentId", "environment", "targetPolicyId", "fixtureProtocol", "cleanupProtocol", "requiredCapabilities"],
      resultFields: ["executionId", "testCaseId", "attempt", "status", "stepResults", "assertionResults", "evidenceRefs", "startedAt", "finishedAt", "runnerIdentity", "attestation"],
      note: "后续 Agent 只能消费已批准、版本固定的 TestSpec；Agent 回传结构化结果与 Evidence，不能直接改写业务确认、测试设计或最终可信状态。",
    },
  },
  testResults: [
    {
      id: "RESULT-HAPPY-001",
      executionId: "EXEC-WRITE-001",
      testCaseId: "TC-ORDER-SUBMIT-HAPPY-001",
      scenario: "正常流程",
      status: "PASS",
      applicability: "CURRENT",
      startedAt: "2026-07-14 16:40:01 CST",
      durationMs: 1842,
      environment: "SIT",
      deploymentId: "DEPLOY-SIT-20260714.4",
      summary: "接口、数据库、日志、Trace 与 Cleanup 全部通过。",
      failedStepId: null,
      expected: null,
      actual: null,
      errorCode: null,
      errorMessage: null,
      evidenceIds: ["EVIDENCE-EXEC-WRITE-001-invoke-endpoint", "EVIDENCE-EXEC-WRITE-001-verify-database", "EVIDENCE-EXEC-WRITE-001-LIFECYCLE"],
    },
    {
      id: "RESULT-STATE-002",
      executionId: "EXEC-READ-STATE-002",
      testCaseId: "TC-ORDER-SUBMIT-STATE-002",
      scenario: "状态约束",
      status: "PASS",
      applicability: "CURRENT",
      startedAt: "2026-07-14 16:41:03 CST",
      durationMs: 386,
      environment: "SIT",
      deploymentId: "DEPLOY-SIT-20260714.4",
      summary: "非草稿订单返回稳定冲突，数据库状态未变化。",
      failedStepId: null,
      expected: null,
      actual: null,
      errorCode: null,
      errorMessage: null,
      evidenceIds: ["EVIDENCE-STATE-HTTP-002", "EVIDENCE-STATE-DB-002"],
    },
    {
      id: "RESULT-AUTH-003",
      executionId: "EXEC-READ-AUTH-003",
      testCaseId: "TC-ORDER-SUBMIT-AUTH-003",
      scenario: "权限控制",
      status: "PASS",
      applicability: "CURRENT",
      startedAt: "2026-07-14 16:41:41 CST",
      durationMs: 291,
      environment: "SIT",
      deploymentId: "DEPLOY-SIT-20260714.4",
      summary: "无权限身份被拒绝，订单保持 DRAFT。",
      failedStepId: null,
      expected: null,
      actual: null,
      errorCode: null,
      errorMessage: null,
      evidenceIds: ["EVIDENCE-AUTH-HTTP-003", "EVIDENCE-AUTH-DB-003"],
    },
    {
      id: "RESULT-FLAG-004",
      executionId: "EXEC-READ-FLAG-004",
      testCaseId: "TC-ORDER-SUBMIT-FLAG-004",
      scenario: "配置约束",
      status: "FAIL",
      applicability: "HISTORICAL",
      startedAt: "2026-07-14 15:58:08 CST",
      durationMs: 412,
      environment: "SIT",
      deploymentId: "DEPLOY-SIT-20260714.3",
      summary: "历史执行发现功能开关关闭后接口仍进入处理器；缺陷已修复，失败 Evidence 继续保留供审计。",
      failedStepId: "invoke-disabled-feature",
      expected: "HTTP 503 · FEATURE_DISABLED",
      actual: "HTTP 200 · SUBMITTED",
      errorCode: "ASSERTION_MISMATCH",
      errorMessage: "order.submit.enabled=false 未阻止订单提交。",
      evidenceIds: ["EVIDENCE-FLAG-HTTP-004", "EVIDENCE-FLAG-CONFIG-004"],
    },
    {
      id: "RESULT-FLAG-005",
      executionId: "EXEC-READ-FLAG-005",
      testCaseId: "TC-ORDER-SUBMIT-FLAG-004",
      scenario: "配置约束",
      status: "PASS",
      applicability: "CURRENT",
      startedAt: "2026-07-14 16:42:08 CST",
      durationMs: 398,
      environment: "SIT",
      deploymentId: "DEPLOY-SIT-20260714.4",
      summary: "修复后重新执行：功能开关关闭时返回 FEATURE_DISABLED，订单未发生写入。",
      failedStepId: null,
      expected: null,
      actual: null,
      errorCode: null,
      errorMessage: null,
      evidenceIds: ["EVIDENCE-FLAG-HTTP-005", "EVIDENCE-FLAG-CONFIG-005", "EVIDENCE-FLAG-DB-005"],
    },
  ],
};

export const changedOrderSubmitArtifacts: TraceDetailArtifacts = {
  ...currentOrderSubmitArtifacts,
  design: {
    ...currentOrderSubmitArtifacts.design,
    status: "STALE",
    updatedAt: "2026-07-14 17:18 CST",
  },
  testResults: currentOrderSubmitArtifacts.testResults.map((result) => result.applicability === "HISTORICAL" ? result : ({
    ...result,
    id: `${result.id}-STALE`,
    executionId: `${result.executionId}-HISTORICAL`,
    status: "NOT_RUN",
    startedAt: null,
    durationMs: null,
    deploymentId: "DEPLOY-SIT-20260714.5",
    summary: `当前部署尚未执行；上一部署结果 ${result.status} 仅用于审计，不能证明当前版本。`,
    failedStepId: null,
    expected: null,
    actual: null,
    errorCode: null,
    errorMessage: null,
  })),
};
