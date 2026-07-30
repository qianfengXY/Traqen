> 语言：**简体中文** · [English](legacy-system-understanding-engine.md)

---
feature_ids: [F001]
related_features: []
topics:
  - source-inventory
  - deterministic-facts
  - analysis-agent
  - reverse-skills
  - reconciliation
  - correctness-evaluation
  - dogfood
doc_kind: feature-design
created: 2026-07-29
status: proposed
priority: P0
---

# 存量系统理解引擎设计

> Feature 聚合入口：[F001](F001-legacy-system-understanding.zh-CN.md)

> 可视化地图：
> [端到端架构](../diagrams/f001-legacy-system-understanding/understanding-architecture.html) ·
> [Analysis Agent 工作流](../diagrams/f001-legacy-system-understanding/analysis-agent-workflow.html) ·
> [Archify 源与交付回执](../diagrams/f001-legacy-system-understanding/README.zh-CN.md)

## 1. 设计目标

F001 必须产出一张能解释存量系统、可审核且盲区可度量的 Candidate 图谱，而不只是完成文件循环、按路径名分类，或让一个模型概括整个仓库。

引擎成功意味着：

- 分析范围完整且绑定固定版本；
- 确定性观察与源码一致；
- 独立分析通道能发现其他通道漏掉的内容；
- 每条语义结论都有有界证据；
- 重复、冲突和 Unknown 保持可见；
- 经审核能力和关系以可度量质量被恢复；
- 同一 Snapshot 可重放并可一致地增量更新；
- Traqen 能分析并展示 Traqen 自身。

浏览器刷新安全属于执行设计，不是“理解正确”的定义。

## 2. 当前实现缺口

现有实现已经具备有价值的基础：

- `SnapshotManifest`、`FactBundle`、稳定 Fact ID 与签名验证；
- JavaScript 项目扫描与浏览器侧多语言启发式扫描；
- `AnalysisAgent` WorkUnit 规划、证据校验与检查点；
- 独立 Reverse Skill 契约与对账；
- Candidate 与受治理对象分离；
- Feature Graph、TraceChain、Impact、TestSpec、Runner 与 Evidence 领域能力。

但当前真实仓库报告主要证明 Traqen 能清点很多文件并减少明显噪音，尚未证明：

- 不支持或排除内容有完整分母；
- 重要能力的人工审核召回；
- Candidate Feature 与关系的精度；
- 需求、设计、代码、测试、结果和配置之间链接正确；
- 全量与增量分析等价；
- 产品里真实展示 Traqen 自身图谱。

当前浏览器扫描器与 canonical 服务端扫描器的语言和关系行为也不一致。一部分 Candidate 根来自路径或某个扫描器的发现，这会让解析器漏掉的内容继续遮蔽下游 Agent 规划。

## 3. 正确性合同

一个 `UnderstandingEvaluation` 按以下身份版本化：

```text
evaluationPolicyId
projectId
snapshotManifestId
engineVersion
extractorSetDigest
analysisProfileDigest
truthSetVersion
```

它分别报告以下指标和证据：

```text
inventoryCoverage
supportedArtifactCoverage
factFixturePassRate
reviewedAnchorRecall
reviewedCandidatePrecision
requiredRelationPassRate
forbiddenRelationPassRate
provenanceValidity
replayStability
incrementalEquivalence
unknownAndConflictCounts
```

指标分母、样本选择、审核 Decision 和缺口都是报告的一部分。UI 可以汇总维度，但不能压成无法解释的“准确率”总分。

## 4. 完成态架构

```text
SourceRegistration
  → Snapshot 捕获
  → ArtifactInventory ───────────────────────────────────────┐
       ├─ 确定性提取 WorkUnits → FactBundle                  │
       ├─ 文档/契约 WorkUnits → CandidateBundles             │
       ├─ 测试/配置/结果 WorkUnits → CandidateBundles        │
       ├─ Agent/Skill 源码切片 WorkUnits → CandidateBundles  │
       └─ 缺口诊断                                           │
                                                              ▼
                                         CandidateReconciliation
                                           ├─ CandidateGraph
                                           ├─ ConflictLedger
                                           ├─ CoverageLedger
                                           └─ CandidateLineage
                                                              │
                                                    确定性校验 │
                                                              ▼
                                          Review + Decision
                                                              │
                                                              ▼
                                           Canonical graph
```

`WorkspaceAnalysisJob` 持久编排这些阶段。浏览器只观察，不执行。

## 5. 领域对象

### 5.1 `ArtifactInventory`

每个 Snapshot Artifact 一行：

```json
{
  "artifactId": "ART-...",
  "snapshotManifestId": "SNAP-...",
  "relativePath": "src/domain/trace-chain.js",
  "contentDigest": "sha256:...",
  "mediaType": "text/javascript",
  "artifactKinds": ["SOURCE", "DOMAIN_LOGIC"],
  "language": "javascript",
  "disposition": "INCLUDED",
  "reasonCode": null,
  "sizeBytes": 1234
}
```

`disposition` 取值：

- `INCLUDED`
- `EXCLUDED_BY_POLICY`
- `UNSUPPORTED`
- `GENERATED`
- `BINARY`
- `OVERSIZED`
- `SECRET_REDACTED`
- `READ_FAILED`

无论处置为何，Artifact 都保留在分母中。

### 5.2 `ExtractorCapability`

声明：

- 支持的 Artifact 类型和语言/版本；
- Fact 节点与边类型；
- Parser 与 Adapter 版本；
- 已知不支持语法；
- Fallback 行为；
- Fixture 套件与质量状态。

文本正则 Fallback 必须作为单独能力命名，不能伪装成 AST 支持。

### 5.3 `SourceSlice`

Agent 或 Skill 不能直接读取任意路径。它必须通过 Broker 用 Snapshot 内稳定 ID 请求经过授权、有界的源码投影：

```ts
type SourceSliceRequest = {
  id: string;
  projectId: string;
  snapshotManifestId: string;
  analysisRunId: string;
  workUnitId: string;
  producerRef: string;
  purpose:
    | "ENTRYPOINT_RECOVERY"
    | "RELATION_RESOLUTION"
    | "CONTRADICTION_PROBE"
    | "TEST_INTENT"
    | "CONFIG_INFLUENCE";
  selectors: Array<{
    artifactId: string;
    symbolId?: string;
    startLine?: number;
    endLine?: number;
  }>;
  allowedFactIds: string[];
  maxBytes: number;   // traqen-source-slice-v1 默认/硬上限：64 KiB
  maxTokens: number;  // traqen-source-slice-v1 默认/硬上限：12,000
  policyId: string;
  requestedAt: string;
};

type SourceSlice = {
  id: string;
  requestId: string;
  artifactSlices: Array<{
    artifactId: string;
    relativePath: string;
    contentDigest: string;
    range: { startLine: number; endLine: number };
    redactedText?: string;
    structuralSummary?: object;
  }>;
  factIds: string[];
  redactions: Array<{ kind: string; range: object }>;
  contentDigest: string;
  truncated: boolean;
  omittedReasons: string[];
  policyDecisionId: string;
  createdAt: string;
};
```

API 边界：

```http
POST /v1/projects/{projectId}/analysis-runs/{runId}/work-units/{workUnitId}/source-slices
GET  /v1/projects/{projectId}/analysis-runs/{runId}/work-units/{workUnitId}/source-slices/{sliceId}
```

- 只有服务端 Agent/Skill Runtime 身份能创建请求；普通浏览器不能借此任意读取源码。
- Selector 只能使用同一 Snapshot 的 Artifact/Symbol ID，禁止绝对路径、任意 Glob 和跨 Snapshot 范围。
- `allowedFactIds` 必须是 WorkUnit 证据集合的子集；返回 Fact 也不能越界。
- Broker 在内容离开可信 Runner 前执行确定性秘密扫描、脱敏、范围裁剪和预算限制，并记录目的、策略、请求/响应 Digest。
- 错误必须可判定：`SOURCE_SLICE_SCOPE_VIOLATION` (403)、`ARTIFACT_NOT_IN_SNAPSHOT` (422)、`FACT_NOT_IN_WORK_UNIT` (422)、`SECRET_POLICY_BLOCKED` (422)、`SOURCE_SLICE_BUDGET_EXCEEDED` (413)、`UNSUPPORTED_BINARY` (422)、`STALE_ANALYSIS_RUN` (409)。
- 被拒绝或截断必须成为 WorkUnit Diagnostic/Gap，不能改用绕过 Broker 的源码读取。

### 5.4 `UnderstandingWorkUnit`

WorkUnit 由 Snapshot、通道、范围、Adapter 版本和策略确定性标识：

```text
sha256(snapshotId + lane + scope + producerVersion + policyDigest)
```

WorkUnit 范围包括：

- 仓库/模块清点分片；
- 入口点与公开接口；
- 文档段落与 API Operation；
- 代码符号邻域；
- 测试/配置/数据簇；
- 跨文件关系解析；
- 变化图谱区域；
- 显式缺口探针。

规划从 Source Manifest 和已知入口约定开始，不能只从已发现的 Fact 根开始。

### 5.5 `CandidateRelation`

每条语义边记录：

- 类型化源/目标 Candidate 或 Fact 引用；
- `evidenceFactIds` 和/或授权 SourceSlice 引用；
- 生产者及版本；
- Snapshot 与 WorkUnit ID；
- 分维度置信度和确定性上限；
- 替代解释与冲突；
- 到旧 Snapshot Candidate 的 lineage。

## 6. 分析通道

### 6.1 清点与分类

清点通道：

1. 遍历已密封 Snapshot；
2. 应用显式纳入/排除策略；
3. 根据内容和约定识别 Artifact 类型；
4. 记录每项处置；
5. 按模块与 Artifact 类别建立覆盖 WorkUnit。

路径名可以帮助路由工作，但不是语义证明。

### 6.2 确定性提取

提取器为受支持结构生成 Facts，包括：

- 模块、符号、Import、Call、继承、路由、RPC 方法、命令和 Job；
- 文档段落、声明需求、ADR Decision、OpenAPI Operation 与 Schema；
- 数据模型、迁移、查询、Read 和 Write；
- 配置 Key 与引用，绝不记录真实秘密值；
- 测试套件、Case、断言、Fixture 与代码链接；
- 构建/测试报告身份与执行元数据。

解析诊断和不完整结构进入缺口。不支持语法不能静默 Fallback 为“成功”。

### 6.3 文档与契约通道

该通道独立处理需求、设计、ADR、Feature 文档、OpenAPI、Schema 与 Runbook：

- 确定性解析保留段落、Operation、Schema 和显式交叉引用为 Facts；
- 语义步骤提出 Requirement/Design/API Candidate 及其关系；
- 文档陈述不能自动成为受治理 Claim；
- 文档与代码冲突进入 ConflictLedger，不能以“文档优先”或“代码优先”静默覆盖。

### 6.4 测试、配置、结果与执行通道

引擎分别产生：

- `TestAssetFact`：观察到静态测试文件/Case/断言；
- `CandidateTestIntent`：该资产可能覆盖规则的候选说明；
- `ConfigurationFact`：配置 Key、默认/存在性及消费者，不包含真实秘密值；
- `ExecutionArtifactFact`：观察到构建/测试结果 Artifact，但尚未证明其可信执行 lineage；
- `TestSpec`：仅在治理之后出现；
- `TestExecution`：一次实际受控执行；
- `VerificationResult`：针对 Claim 的 PASS/FAIL/INCONCLUSIVE；
- `Evidence`：支撑结果的受保护输出。

文件名含有 “test”、结果文件名含有 “passed” 或模型声称“已验证”都不能关闭验证缺口。

### 6.5 Agent/Skill 独立语义通道

Agent/Skill 采用多个有界视角：

- 业务能力与规则重建；
- API/命令/事件表面重建；
- 流程、Actor、State 与例外重建；
- 设计到实现映射；
- 数据与配置影响；
- 测试意图与规则覆盖；
- 缺失关系与矛盾探测。

每个视角可以在策略内请求更多 SourceSlice，并返回结构化 Candidate，而不只是 Markdown。

直接源码分析独立于确定性发现，但不能绕过确定性证据和 Schema 校验。

### 6.6 对账通道

对账结合证据与语义：

- 精确内容/稳定引用匹配；
- 历史 lineage 匹配；
- 兼容范围与约束匹配；
- 疑似重复；
- 疑似父子；
- 矛盾；
- 未解决替代解释。

它不能从名称、路径、Domain 或 Hash 生成业务稳定 Feature ID；身份不确定必须进入 Review。

## 7. Work 规划与迭代检索

分区、动态 DAG、模型/Skill 路由与多模型对账的精确合同见
[`workspace-scan-and-analysis-lifecycle.zh-CN.md`](workspace-scan-and-analysis-lifecycle.zh-CN.md) §3.3。
本节固定引擎级不变量。

### 7.1 完整 Snapshot 规划

Agent 的任务全集是完整不可变 `SourceSnapshot` 与 ArtifactInventory，不是 Scanner Facts。每条 ArtifactInventory 记录必须且只能有一种基础结果：

- 通过授权原始 SourceSlice 直接读取；
- 交给声明过能力的 Binary/Generated/Result 专用 Skill；或
- 形成 Excluded、Unsupported、Policy、Secret、Size、Read Failure 或 Budget 显式处置/Gap。

Planner 按固定顺序确定性派生不可变 `UnderstandingPlan`：

1. 由版本化 Workspace/Package/Build 约定识别工程边界；
2. 由内容类型与声明的 Manifest 结构确定 Artifact 通道；
3. 按工程、语言/工具链、Module、Package 归属与直接结构关系形成局部性分组；
4. 形成预算分片，超大文件按稳定语法/文档 Range 切分并追加文件汇总；
5. 为入口、公开接口、流程、配置 Consumer、测试、文档和变化前沿增加允许重叠的横切根任务。

每条 Inventory 记录必须有且只有一种基础处置，不能遗漏；SourceRange 可有声明过的有界重叠，横切与 Follow-up 分区也可与基础任务重叠。相同 Snapshot、Planner、Convention Registry、执行策略、Range 与 Policy Digest 重规划时必须得到相同稳定 Partition ID，且 `unassignedCount=0`。

Scanner Facts 作为可选增强并行到达。它可以增加细粒度关系或 Gap WorkUnit，但不能删除基础覆盖 WorkUnit，也不能成为直接源码结论的唯一证据。

### 7.2 动态层级执行

`UnderstandingPlan` 展开为持久化依赖 DAG，绝不是固定数量的子 Agent：

1. 有界原始源码、文档、测试、配置、数据与专用 Skill 叶子 WorkUnit；
2. 大文件及文件/Module 汇总；
3. 跨 Module 能力、流程、状态、规则、数据/配置与测试意图重建；
4. 独立 Critic、矛盾与缺失关系探针；
5. 工程级 CandidateBundle 汇总与对账。

每个 WorkUnit 持久化准确 Artifact/Range 与可选 Fact 输入、依赖、必需能力、所选 Producer Route、预算、Attempt、Checkpoint 和 Input/Output Digest。就绪单元在 Worker/Provider 配额内并行；at-least-once 调度配合一个 Input Digest 的 exactly-once 结果提交。子任务摘要可以引导检索，但绝不能单独成为 Candidate 证据。

各通道可为未解析 Call、无文档接口、缺失实现关系、意图模糊测试、未知配置 Consumer 或文档/代码矛盾创建有界 Follow-up WorkUnit。跟进深度与总预算由策略固定；触顶形成 `UNEXPLORED_BUDGET_LIMIT`，不能记为完成。

### 7.3 模型与 Skill 能力路由

`AnalysisModelProfile` 的传输/凭据可用性与版本化 `ModelCapabilityProfile` 分离；后者声明模型 Revision、支持 Role、语言、Artifact、结构化输出、Context 上限、数据边界类别（`FACTS_ONLY_EXTERNAL`、`RAW_SOURCE_LOCAL` 或 `RAW_SOURCE_PRIVATE_RUNNER`）、Calibration Policy、Quality Tier、Independence Group 与 Cost Class。

签名 Skill Manifest 继续声明 Capability、兼容性、Schema、Permission、Model Policy、Cost 与增量行为。其终态输入合同区分：

- **Direct-source Skill**：必需 `PROJECT_SNAPSHOT`，读取 SourceSlice，`CODE_FACT_BUNDLE` 只是可选增强；
- **Fact-dependent Skill**：显式要求对应 FactBundle。

确定性 Capability Router 把 WorkUnit 要求与已验证 Model Profile、允许且版本固定的 Skill、源码策略以及本次运行质量/成本/截止时间/并发/冗余策略求交集。Direct-source WorkUnit 必须使用 `RAW_SOURCE_LOCAL` 或 `RAW_SOURCE_PRIVATE_RUNNER` Producer；`FACTS_ONLY_EXTERNAL` 模型绝不能读取原始 SourceSlice。Router 持久化 `AnalysisRouteDecision`，记录候选、选定和拒绝 Route、原因码、精确版本、Calibration、Independence Group 与预算。能力缺失形成 `NO_ELIGIBLE_PRODUCER`，不能触发隐藏通用 Fallback 或外部源码泄露。

设计期没有默认厂商模型。版本化 Calibration Suite 按 Role、语言、Artifact 与 Risk Cell，用 Schema 有效率、源码 Grounding、关系正确性、Context 退化、Gap 诚实度、数据边界合规、延迟与成本晋升合格 Primary/Critic Revision；每个新 Model Revision 初始状态都是未验证。生命周期设计中的 Role 表把这些 Cell 映射到现有 Reverse Skill Capability 词汇。

### 7.4 超大工程与多模型

一次完整分析是由许多有界 WorkUnit 构成的持久 Run，不是整仓单 Prompt。叶子单元横向扩展；大文件按 Range 分片；Module 输出进入跨 Module 汇总；不变 Input Digest 可复用；全局汇总只读取有界 Candidate/Evidence Index 与选定 SourceSlice。完成条件是 Inventory 无未分配项、所有必需 WorkUnit 进入终态，且每个不支持或预算不足区域都有显式 Gap。

多模型执行采用：

- 默认按合格能力对 Partition 并行；
- 只对高风险、低置信、矛盾或 Challenge 抽样范围做选择性独立冗余；
- 由不同 `independenceGroup` 的 Critic 审核 Candidate 证据，且看不到 Primary Producer 的私有推理；
- 确定性证据校验与 Candidate 对账。

引擎绝不把相关模型/Prompt 变体当成独立投票。一致结果只能在 Calibration 上限内提高 Corroboration；分歧保留在 ConflictLedger，未解决高风险冲突进入人工 Review/Decision。

生产规划器从不读取 Truth Set。评估 Harness 只能在运行完成后比较结果；held-out Miss 触发的是下一次工程改进或公开类别的诊断重跑，不能把隐藏答案塞回同一次分析。

## 8. 增量分析

项目没有已发布图谱时，请求模式无论是 `AUTO` 还是 `FULL` 都执行完整清点、全部通道、全量对账与评估；`INCREMENTAL` 请求被拒绝。第一次成功运行原子发布首个 `CurrentGraphHead`。

已有 `CurrentGraphHead` 后，新 Snapshot 的 `AUTO` 默认执行增量分析：

1. 按内容身份比较 ArtifactInventory；
2. 失效变化提取器输入对应 Facts；
3. 重新计算依赖前沿发生变化的跨文件关系；
4. 重跑证据或生产者版本变化的语义 WorkUnit；
5. 保留未变 Candidate lineage；
6. 把受治理 Claim 标记为可能过期，而不删除 Decision；
7. 生成从旧 Snapshot 到新 Snapshot 的 `ChangeSet`；
8. 生成受影响 Feature/Claim/TestSpec/依赖、失效原因和重验证工作的 `ImpactAssessment`；
9. 构建不可变 `GraphRevision(status=BUILDING)`；
10. 将增量图谱与策略要求的全量重建范围对比；
11. 评估通过后，在同一事务中把 GraphRevision 标记为 `PUBLISHED` 并移动 `CurrentGraphHead`。

只有在被评估的未变/变化范围中，增量图谱与全量图谱除允许时间戳和 Run ID 外等价，增量运行才算通过。

构建失败、评估失败或发布事务失败时，旧 `CurrentGraphHead` 保持不变；失败 GraphRevision 和诊断仍保留用于审核。

### 8.1 当前投影与历史语义

- 默认 Graph API/UI 只读取 `CurrentGraphHead` 指向的最新已发布 Revision。
- GraphRevision、SnapshotManifest、FactBundle、Candidate lineage、Decision、FeatureVersion、Claim/TestSpec 版本、ChangeSet、ImpactAssessment、Execution 和 Evidence 不可变且可按时间查询。
- Feature 的业务定义只有在 Decision 授权时才产生新 FeatureVersion。代码、配置、测试或部署变化只更新该 Snapshot 下的实现映射、符合性、Impact 与 Verification 历史。
- Candidate 在新 Snapshot 中消失不等于 Feature 退役；退役、合并、拆分仍由治理决定。
- Feature History 以稳定 `Feature.id` 为轴，显示 FeatureVersion、授权 Decision、每个 Snapshot 的实现映射、每次 Snapshot 转换的影响以及对应重验证结果。

### 8.2 GraphRevision 状态与不变量

```text
BUILDING → EVALUATING → PUBLISHED
                     ↘ REJECTED
```

- 首次发布前 Project 可以没有 `CurrentGraphHead`；发布后恰好有一个，且只能指向 `PUBLISHED` Revision。
- 首个 `PUBLISHED` Revision 必须来自 FULL Run。
- `PUBLISHED` Revision 和 CurrentGraphHead 指针移动必须原子提交。
- `REJECTED` Revision 不可转回 PUBLISHED；修复后创建新 Revision。
- 删除或覆盖历史 Revision、ChangeSet 或 ImpactAssessment 不属于正常更新路径。

## 9. 持久执行生命周期

`workspace-scan-and-analysis-lifecycle.zh-CN.md` 的持久生命周期仍是 F001 的支撑设计：

- `SourceScanRun` 与 `AnalysisRun` 是独立检查点阶段；
- Resume 复用已提交 WorkUnit；
- 浏览器生命周期事件只读；
- Worker Lease 与 Fencing 阻止过期提交；
- 人工 Pause 跨重启保持暂停；
- 运行任务在 Worker 恢复后继续；
- 一个不可变 Snapshot 绑定所有子结果。

阶段 UI 还必须显示覆盖与正确性进度，而不只是文件百分比。

## 10. 评估 Harness

### 10.1 Truth Set Schema

人工审核 Truth Set 包含：

- 正向能力锚点；
- 必须存在的节点和类型边；
- 禁止存在的节点和边；
- 可接受 Alias 与替代边界；
- 显式 Unknown；
- Artifact 纳入/排除预期；
- Reviewer、Decision、理由与版本。

生产模式分析时，引擎不能把 Truth Set 当成输入。评估 Harness 在运行完成后比较输出。

### 10.2 Truth Set 防过拟合与盲审协议

每个 TruthSetVersion 密封后按稳定 `evaluationSeed` 分层分区：

- **60% calibration**：实现者可见，用于本地 TDD 和解释失败；
- **30% held-out**：对实现者密封，仅验收 Harness 和指定独立 Reviewer 可读；
- **10% rotating challenge**：每次重要发布轮换，覆盖新语言、误导命名、跨模块关系和历史变化。

分层维度至少包含节点/边类型、证据层级、核心能力、模块、Artifact 类型和正向/负向断言，禁止随机抽样把稀有但关键关系丢掉。Candidate 人工精度审查最多抽样 100 条（不足则全量），并在各 Candidate/关系类型、置信区间和来源通道间分层。

每个抽样项由独立 Reviewer 标为 `SUPPORTED`、`AMBIGUOUS_EXPLICIT`、`UNSUPPORTED`、`DUPLICATE` 或 `WRONG_RELATION`：

- 精度分母是除 `AMBIGUOUS_EXPLICIT` 外的明确 Candidate；
- 真实歧义只有在产品中显式为 Gap/Conflict 时才能排除；
- 高置信 `UNSUPPORTED`、Truth Set 输入泄漏或 P0 锚点漏检直接阻塞发布。

operator/业务权威批准能力边界、P0 锚点和阈值；独立技术 Reviewer 批准源码锚点与类型关系。实现作者不能批准 held-out 内容、修改分区 Seed 或签署自己的验收结果。分歧保持为 `UNKNOWN/CONFLICT`，不能为了过门禁强制选边。

发布后保存完整 EvaluationRun 与 TruthSetVersion；下一版轮换 challenge 项，但旧答案和旧结果不可改写。确定性边界测试必须证明生产 AnalysisRun 的输入 Digest 不包含 Truth Set Digest、锚点答案或 held-out 内容。

### 10.3 测试层

| 层 | 数据集 | 目的 |
|---|---|---|
| 提取器单元 | 最小语法 Fixture | 精确节点、边、跨度与诊断 |
| 跨文件集成 | 合成多文件 Fixture | Call、Route、Data/Config/Test 关系 |
| 对抗语义 | 误导名称与诱饵 | 负向精度与证据边界 |
| 受控产品 | `examples/order-platform` | 完整预期 TraceChain |
| 真实 dogfood | 固定 Traqen Snapshot | 系统级召回、精度、缺口与 UI 可用性 |
| 增量 | 受控 Commit | Lineage、失效、全量/增量等价 |

### 10.4 回归策略

评估策略按维度版本化阈值。节点数量增加不能掩盖必须关系正确性或不确定性诚实度下降。阈值变化必须由 Decision 明确版本、生效范围和理由，且不能追溯性改变旧 EvaluationRun。

## 11. Traqen 自分析设计

### 11.1 输入与隔离

用干净、固定的 Traqen Worktree，使用测试专用数据存储和非保留端口分析：

- 源码与文档 Snapshot；
- 安全的 Package/Build 元数据；
- 验收环境生成的后端与 Web 测试报告；
- 经审核的配置存在性，不包含秘密值。

### 11.2 预期输出

Candidate 图谱必须在支持范围内显式连接：

```text
系统需求
  → F001 / 子系统设计
  → 领域与应用代码
  → API 契约
  → 测试与受治理 TestSpec
  → 当前测试执行/结果/Evidence
```

至少一个受治理种子 Feature 必须展示完整 TraceChain，Candidate-only 节点保持视觉区分。

### 11.3 自分析验收

- 使用 `traqen-self-v1`；
- 100% 处置范围内 Artifact；
- 至少 30 个正向锚点覆盖至少 10 项核心能力，召回 ≥90%，且无 P0 锚点漏检；
- 至少 60 条必须类型边 100% 满足，至少 30 条禁止边零违反；
- 分层抽样最多 100 条 Candidate（不足则全量），明确 Candidate 人工支持精度 ≥90%，且不存在高置信无支撑结论；
- 同 Snapshot/引擎/策略的语义 Digest 100% 一致；
- 受控第二 Snapshot 的未变区域 100% 等价，变化区域只有预期或已解释差异；
- 明确 Web/语言/文档的不支持区域；
- 每个抽样 Fact 与 Candidate 都能查看源码；
- 执行不依赖浏览器所有权；
- 在 Traqen 自身产品中展示图谱；
- 对一项受控变更做 Impact 并和人工预期对比；
- 默认显示第二个 Snapshot 的 CurrentGraphHead，并能打开一项 Feature 的版本/实现/Impact/验证历史。

## 12. API 与 UI 要求

读取 API 提供：

- Snapshot 与 Artifact 覆盖；
- Run/阶段/WorkUnit 进度；
- Facts、Candidates、冲突与缺口；
- Candidate lineage 与评估报告；
- 按策略提供的图谱投影与源码节选；
- 当前 `GraphRevision` 与 `CurrentGraphHead`；
- FeatureVersion、Snapshot 实现映射、ChangeSet、ImpactAssessment 与验证历史。

命令 API 提供显式 Start、Pause、Resume、Cancel、Review 和 Decision 操作。SourceSlice API 只提供给服务端 Agent/Skill Runtime。GraphRevision 发布是评估通过后的内部原子命令，普通浏览器不能直接移动 CurrentGraphHead。

UI 必须区分：

- 权威 Job 状态与连接状态；
- 清点进度与理解质量；
- Candidate 与受治理 Feature；
- 测试线索与 TestSpec/执行结果；
- 置信度与证据覆盖；
- “未分析”“不支持”“未知”“冲突”和“不存在”。

## 13. 安全边界

### 13.1 部署能力模式

| 模式 | 源码访问 | 约束 |
|---|---|---|
| `LOCAL_SINGLE_TENANT` | API/Runner 共置并直接读取 allowlisted 本地路径 | 适合本机；普通 API 不暴露绝对路径 |
| `PRIVATE_RUNNER` | Runner 位于源码侧，通过双向认证/出站连接接收任务 | 原始源码留在私有边界，只上传允许的 Facts/Candidates/Evidence |
| `CLOUD_CONTROL_PLANE` | 禁止解释浏览器提交的本地路径 | 必须配 Private Runner 或受治理 Remote Git Connector |

`SourceRegistration.connectorKind` 和 capability/policy version 明确记录模式。云端/多租户 API 未配置 Private Runner 或 Remote Connector 时必须拒绝 `LOCAL_FILESYSTEM` 注册，不能假装服务端能读取用户机器路径。

### 13.2 通用边界

- Runner 只能访问 Allowlist 内 SourceRegistration；
- 拒绝 Symlink 逃逸、路径穿越、过宽 Root/Home、设备、Socket 和非普通文件；
- 普通读取只暴露相对/不透明路径；
- SourceSlice 在模型访问前脱敏并限制预算；
- 模型凭据与真实配置秘密不能进入 Run 或图谱数据；
- 原始源码只在本地/私有边界内处理；外部模型只接收策略过滤后的 Facts；
- 所有评估和 Dogfood 使用隔离的非生产 Store。

## 14. 验收标准

- **AC-01**：固定 Snapshot 中每个 Artifact 都有明确 Inventory 处置。
- **AC-02**：受支持提取器通过精确正向、负向、跨度和诊断 Fixture。
- **AC-03**：每条 Inventory 记录都有一种可审核基础处置，且每个可分析源码 Artifact 都独立于 Scanner Facts 直接读取 Snapshot。
- **AC-03a**：确定性重规划产生稳定 Partition、`unassignedCount=0` 与有界动态 DAG，并能恢复一个被某个确定性提取器漏掉的审核锚点。
- **AC-03b**：每个 WorkUnit 持久化经验证、版本固定的模型/Skill Route；不支持能力形成 `NO_ELIGIBLE_PRODUCER`，不能隐藏 Fallback。
- **AC-03c**：选择性多模型冗余使用独立 Group 与证据对账；相关一致不能算投票，未解决分歧保持 Conflict。
- **AC-04**：全部 Candidate 节点与关系通过 Snapshot 和 WorkUnit 证据校验。
- **AC-05**：对账保留冲突与替代解释，且不能创建受治理权威。
- **AC-06**：评估报告带分母展示召回、精度、关系、来源、缺口、重放和增量维度。
- **AC-07**：受控变更的全量与增量运行产生等价的被评估图谱。
- **AC-07a**：首次运行强制 FULL；后续 AUTO 默认 INCREMENTAL；只有评估通过的 GraphRevision 能原子替换 CurrentGraphHead。
- **AC-07b**：默认图谱只显示最新状态，Feature 历史保留版本 Decision、各 Snapshot 实现、ChangeSet、Impact 与验证；代码变化不自动创建 FeatureVersion。
- **AC-08**：刷新、关闭、重连、人工 Pause/Resume 和 Worker 重启保留相同 Job 与已提交工作。
- **AC-09**：测试线索、TestSpec、执行、结果和 Evidence 在领域数据和 UI 中保持区分。
- **AC-10**：两个固定 Traqen Snapshot 按 `traqen-self-v1` 在 Traqen 内产出经审核 Candidate 图、一个受治理完整 TraceChain、可见缺口报告、最新图谱头、Feature 历史和经审核 Impact 结果。
- **AC-11**：源码与秘密安全边界通过确定性测试。
- **AC-12**：后端、Web、Build、Lint、Diff、评估和独立 Review 门禁通过。

## 15. 非目标

- 宣称完美恢复未记录的历史意图；
- 自动批准 Candidate；
- 静态理解时执行任意仓库代码；
- 用节点数量或一个模型评分代表正确性；
- 用 Scanner 输出定义 Agent 任务全集，或把整仓单 Prompt 当作全量分析；
- 把所有角色路由给未验证通用模型，或把模型多数票当真相；
- 第一版支持所有语言；
- 为改善指标隐藏不支持范围；
- 让浏览器 IndexedDB 成为执行或真相权威。

## 16. Design Gate 决策

推荐确认：

1. 接受多维正确性合同；
2. 接受版本化、人工审核 Truth Set 作为评估权威；
3. 把 Traqen 分析 Traqen 设为强制发布门禁；
4. 把持久生命周期保留为 F001 支撑层；
5. Connector 增量交付，第一阶段采用 Allowlisted Local Runner，但不改变 canonical graph 契约；
6. 接受 `traqen-self-v1` 数字阈值、calibration/held-out/challenge 盲测协议与独立审批；
7. 接受首次 FULL、后续默认 INCREMENTAL、CurrentGraphHead 原子发布和 Feature 历史账本语义。
8. 接受完整 Snapshot 派生的 Agent 规划、能力路由动态 DAG 与选择性证据型多模型对账。
