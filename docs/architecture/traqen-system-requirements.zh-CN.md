> 语言：**简体中文** · [English](traqen-system-requirements.md)

---
feature_ids: [F001]
related_features: []
topics:
  - product-requirements
  - legacy-system-understanding
  - canonical-graph
  - traceability
  - impact-analysis
  - quality
  - dogfood
doc_kind: system-requirements
created: 2026-07-29
status: proposed
priority: P0
---

# Traqen 系统需求：存量系统理解与统一质量追溯

## 1. 产品使命

Traqen 是一个版本化追溯知识系统：它从存量代码和文件中重建可审核的工程知识，把需求、设计、代码、测试、测试结果、配置、运行上下文和决策连接到同一张 canonical graph，并用这张图谱支持内容查看、变更影响分析和质量追溯。

核心问题不是生成一份“看起来合理”的功能列表，而是在不混淆已观察实现、推断意图、已批准业务真相和已验证运行行为的前提下，让存量系统变得可解释。

系统必须用可导航证据回答：

1. 当前似乎存在哪些能力和规则？
2. 哪些文档、代码符号、接口、数据对象和配置实现它们？
3. 哪些 TestSpec 计划验证每条 Claim？
4. 哪些精确执行和结果构成当前 Evidence？
5. 哪些内容是已知、推断、批准、冲突、缺失或过期？
6. 一项拟议变更可能影响什么，哪些内容必须重新审核或重新执行？

## 2. operator 终态体验

对于任何重要能力，operator 可以打开一个图谱支撑的视图，沿下列链路查看：

```text
源码 Snapshot
  → 确定性 Facts
  → 有证据边界的 Candidates
  → 人工 Decisions 与受治理对象
  → TestSpecs 与 TestExecutions
  → VerificationResults 与 Evidence
  → TraceChain / Impact / Metrics 投影
```

每个可见结论都链接到来源、范围、版本、生产者和可信状态。缺失链路保持为明确缺口，不能用模型生成的文字补齐。

## 3. 产品护栏

Traqen 不是：

- 把生成文字当成真相的文档生成器；
- 把语法结构等同业务意图的代码搜索或图形可视化工具；
- 静默把当前实现转换为已批准需求的 LLM；
- 把测试文件、模型判断和一次绿色命令混成同一种证据的测试生成器；
- 分别拥有独立真相的 Feature Tree、API Tree、看板和指标集合；
- 在遗留资料不完整时恢复唯一历史正确需求的承诺。

Traqen 必须保持以下区分：

| 层 | 含义 | 权威 |
|---|---|---|
| `Fact` | 对一个不可变 Snapshot 的确定性观察 | 提取器与源码证据 |
| `Candidate` | Agent 或 Skill 提出的有证据边界的推断 | 永远不是业务权威 |
| `Decision` | 人工接受、拒绝、拆分、合并或纠正 | 业务/治理权威 |
| `FeatureVersion` / `Claim` / `TestSpec` | 受治理的规范对象 | 由 Decision 授权 |
| `TestExecution` / `VerificationResult` / `Evidence` | 实际执行了什么、得到什么结果 | 执行与断言证据 |
| Projection | canonical graph 的有界视图 | 只读；不拥有独立真相 |

## 4. 存量系统理解范围

### 4.1 必须纳入清点的输入

Traqen 应对以下内容建立版本化清单：

- 需求、产品、ADR、Feature、API、Schema、运维和 Runbook 文档；
- 源码、生成代码标记、构建描述、Manifest 和 Lockfile；
- 路由、RPC 注册、公开 API、命令、Job 和事件消费者；
- 数据库 Schema、迁移、查询、数据模型和外部依赖；
- 配置定义及安全的配置存在性，不摄取秘密值；
- 测试资产、Fixture、断言、覆盖率元数据和测试计划；
- CI/构建/测试报告、日志、产物、部署清单和运行观察；
- 可用时的仓库历史和 Diff。

不支持、被排除、不可读、生成、过大、二进制、可能含秘密或提取失败的 Artifact 仍必须留在清单分母中并说明原因，不能静默消失。

### 4.2 不可变分析范围

每次分析绑定到 `Project`、`SourceRegistration` 和不可变 `SnapshotManifest`。Manifest 记录完整清单、纳入内容的身份、排除项、提取器版本和安全的环境元数据。

源码变化生成新 Snapshot，绝不修改已完成运行的含义。

## 5. “正确理解”的定义

单一置信度分数不足以说明正确性。Traqen 必须分别评估：

| 维度 | 必须回答的问题 | 最低证据 |
|---|---|---|
| 清点完整性 | 范围内每个 Artifact 是否都有去向？ | Manifest 分母与明确处置 |
| 提取有效性 | Fact 是否匹配源码位置和解析语义？ | 确定性 Fixture 与源码跨度断言 |
| 来源忠实性 | 每条 Candidate 关系能否追溯到允许的 Fact？ | `evidenceFactIds`、生产者、Snapshot、源码位置 |
| 锚点召回 | 是否恢复了人工审核后应发现的能力和关系？ | 人工 truth set 正向断言 |
| 候选精度 | 候选中有多少无支撑、重复或仅由路径名制造的噪音？ | 人工审核样本与负向断言 |
| 关系正确性 | 设计、实现、配置、测试和依赖边类型是否正确？ | 人工关系断言与冲突用例 |
| 不确定性诚实 | 不支持语言、证据缺失、冲突和歧义是否可见？ | 缺口账本；禁止静默成功 |
| 可重现性 | 同一 Snapshot 与引擎版本是否生成相同 Facts 和稳定 Candidate lineage？ | Digest 与重放测试 |
| 增量一致性 | 新 Snapshot 是否复用未变工作且只失效受影响派生知识？ | 全量与增量图谱等价 |
| 治理完整性 | 推断是否能绕过人工权威或篡改稳定身份？ | 确定性授权测试 |
| 验证完整性 | 测试线索、TestSpec、执行、结果和 Evidence 是否严格区分并绑定版本？ | 执行 lineage 与防混淆测试 |

正确性只能按维度、按人工审核范围报告。“未知”是合法结果；无法解释的绿色总分不是。

## 6. Canonical Graph

### 6.1 核心模型

```text
Project
  └─ HAS_SNAPSHOT → SnapshotManifest
       └─ CONTAINS → ArtifactVersion
            └─ OBSERVED_AS → Fact

AnalysisRun
  └─ HAS_WORK_UNIT → WorkUnit
       └─ PRODUCES → CandidateFeature / CandidateClaim / CandidateRelation
            └─ SUPPORTED_BY → Fact

Decision
  ├─ ACCEPTS / REJECTS / SPLITS / MERGES → Candidate
  └─ CREATES / REVISES → FeatureVersion / Claim / TestSpec

Feature
  └─ HAS_VERSION → FeatureVersion
       ├─ HAS_CLAIM → Claim
       ├─ DESIGNED_BY → DesignElement
       ├─ IMPLEMENTED_BY → CodeSymbolFact
       ├─ EXPOSED_BY → EndpointFact
       ├─ READS / WRITES → DataObjectFact
       ├─ CONTROLLED_BY → ConfigurationFact
       └─ VERIFIED_BY → TestSpec
            └─ EXECUTED_AS → TestExecution
                 └─ HAS_RESULT → VerificationResult
                      └─ SUPPORTED_BY → Evidence
```

Taxonomy 是独立、版本化的分类投影：

```text
TaxonomyVersion → TaxonomyNode → CLASSIFIES → FeatureVersion
```

Feature 在业务域间移动或源码路径改变，不能改变其不透明稳定身份。

### 6.2 必须提供的投影

所有投影都从同一张图谱生成并公开过滤范围：

- Candidate 发现视图；
- 受治理 Feature 视图；
- 节点状态显著区分的综合图谱；
- Feature Tree 与 API Tree；
- TraceChain 与源码内容视图；
- 实现依赖与数据流视图；
- TestSpec、执行、结果与 Evidence 视图；
- 变更影响与重验证计划；
- 完整性、缺口、可信和运行指标。

### 6.3 当前图谱与历史账本

Traqen 必须把“当前可查询状态”和“历史演进事实”分开建模：

```text
Project
  └─ CURRENT_GRAPH_HEAD → GraphRevision
       ├─ PROJECTS → 当前 Snapshot 的 Facts / Candidates / 受治理对象映射
       └─ EVALUATED_BY → EvaluationRun

Snapshot N ── ChangeSet / ImpactAssessment ──→ Snapshot N+1

Feature
  └─ HAS_VERSION → FeatureVersion 1..n
       └─ AUTHORIZED_BY → Decision
```

- 项目的第一次成功分析必须是 `FULL`，并在完整清点、分析、对账和评估通过后原子发布首个 `CurrentGraphHead`。
- 后续源码、需求文档、配置、测试或结果变化创建新 Snapshot，默认运行 `INCREMENTAL`；operator 或策略可以强制 `FULL`。
- 增量运行只重算受影响区域，但必须产生从前一已发布 Snapshot 到新 Snapshot 的 `ChangeSet`、`ImpactAssessment` 和重验证计划，并通过全量/增量等价门禁。
- 默认 Graph、Feature Tree、TraceChain、Impact 与 Metrics 查询只读取最新已发布的 `CurrentGraphHead`。构建中、失败或评估未通过的 GraphRevision 不能替换当前头。
- GraphRevision、SnapshotManifest、FactBundle、Candidate lineage、Decision、FeatureVersion、Claim/TestSpec 版本、ChangeSet、ImpactAssessment、TestExecution 和 Evidence 都是不可变、可追溯的历史账本；“只展示最新图谱”不等于删除历史。
- Feature 的稳定身份贯穿所有 Snapshot。只有业务定义发生变化并经 Decision 授权时才创建新的 FeatureVersion。代码、配置、测试或部署映射变化不能自行修订业务 FeatureVersion，而是生成新的实现映射、符合性状态、影响和验证记录。
- Candidate 在新 Snapshot 中消失只表示“当前未观察到”，不能自动表示 Feature 退役；Feature 退役、合并或拆分仍需要显式治理。

## 7. 理解流水线

### 7.1 独立证据通道

理解引擎运行多个可独立观察的通道：

1. **清点通道**：清点完整 Snapshot 并分配 Artifact 类型。
2. **确定性提取通道**：把受支持 Artifact 解析为 Facts 和类型化关系。
3. **文档与契约通道**：提取需求/设计/API/Schema 候选，但不把文档文字当成已批准真相。
4. **测试、配置与执行通道**：区分静态线索、受治理 TestSpec 和真实执行证据。
5. **Agent/Skill 通道**：在本地/私有边界内通过有界 SourceSlice 独立访问每个可分析 Artifact，用 Facts 做可选增强，提出业务语义，并只引用 WorkUnit 内证据。
6. **对账通道**：去重 Candidate、记录冲突、保留替代解释并计算 lineage。

一个通道失败或看不见某处，不能阻止其他通道检查源码。尤其是 Agent 任务规划必须从完整 Snapshot/ArtifactInventory 出发，不能只围绕某一个扫描器已经发现的节点。

### 7.2 治理前对账

对账可以建议等价、层级、拆分、合并或冲突。确定性验证器负责 Schema、Snapshot 绑定、证据边界、置信度上限和稳定 lineage。模型和对账都不能创建受治理 Feature 或 Claim。

### 7.3 持久执行

源码捕获、扫描和 Agent 分析是服务端/Runner 拥有的持久任务。浏览器刷新、关闭、重连或多标签页不会改变权威状态。Pause、Resume 和 Cancel 是显式命令；同一 Snapshot 的 Resume 复用已提交单元。

耐久性是正确分析大型仓库的必要条件，但不能代替正确性评估。

## 8. 系统核心需求

| ID | 需求 |
|---|---|
| SR-001 | 登记授权源码，并用完整 Artifact 清单密封不可变、内容寻址的 Snapshot。 |
| SR-002 | 在覆盖账本中保留纳入、排除、不支持、失败和秘密脱敏的 Artifact。 |
| SR-003 | 对受支持格式生成带精确源码位置和类型关系的版本化确定性 Facts。 |
| SR-004 | 即使确定性提取器没有产生对应 Fact，独立 Agent/Skill 仍能在本地/私有边界内直接检查每个可分析 Artifact 的有界 SourceSlice。 |
| SR-005 | 每条模型结论和 Candidate 关系必须引用其 WorkUnit 与 Snapshot 内证据。 |
| SR-006 | 对重复、冲突、层级和 lineage 做对账，不隐藏替代解释、不创建权威。 |
| SR-007 | 创建或修订受治理 Feature、Claim、Taxonomy 分类和 TestSpec 必须有显式 Decision。 |
| SR-008 | 在同一 canonical graph 中连接需求、设计、代码、数据、配置、测试、结果、Evidence、变更和决策。 |
| SR-009 | 严格区分 TestAsset 线索、TestSpec、TestExecution、VerificationResult 和 Evidence。 |
| SR-010 | 从 canonical graph 生成 TraceChain、内容、Feature/API Tree、Impact、覆盖、缺口和指标投影。 |
| SR-011 | 比较 Snapshot、定位受影响图谱区域、选择性失效派生知识并产生重验证计划。 |
| SR-012 | 任务状态和已提交 WorkUnit 独立于浏览器生命周期持久化；只有用户显式命令暂停或恢复。 |
| SR-013 | 用人工审核维度、正负断言和明确 Unknown 报告正确性。 |
| SR-014 | 按部署数据边界保护源码、路径、凭据、秘密、模型输入、日志和 Evidence。 |
| SR-015 | 用 Traqen 的固定 Snapshot 做自举分析，并在 Traqen 中展示经审核的 Traqen 自身能力图谱。 |
| SR-016 | 第一次成功分析必须是 FULL；后续 Snapshot 默认增量分析，并可按策略强制 FULL。 |
| SR-017 | 只有完成且评估通过的 GraphRevision 才能原子替换 CurrentGraphHead；失败运行保留旧头。 |
| SR-018 | 默认图谱只投影最新已发布状态，同时以不可变账本保留 FeatureVersion、Snapshot 映射、Decision、ChangeSet、ImpactAssessment 与 Evidence 历史。 |
| SR-019 | 每个已发布 Snapshot 转换都必须解释本次变化影响哪些现有 Feature/Claim/TestSpec/依赖，以及哪些对象需要重审或重验证。 |
| SR-020 | 只有 Decision 能创建新的业务 FeatureVersion；代码、配置、测试或部署变化只更新实现、符合性、影响与验证历史，不能静默改变业务定义。 |
| SR-021 | 从 Snapshot/ArtifactInventory 派生确定性完整 UnderstandingPlan，Partition 稳定、`unassignedCount=0`，并用有界动态 WorkUnit 依赖 DAG 扩展到超出单 Prompt 或固定子任务数量的工程。 |
| SR-022 | 每个 WorkUnit 都必须基于已验证模型能力/校准 Profile、签名 Skill 合同与部署数据边界持久化版本固定的 AnalysisRouteDecision；能力缺失必须以 `NO_ELIGIBLE_PRODUCER` 关闭失败。 |
| SR-023 | 每个有界 AnalysisBatch 都发送给所有已配置且相互独立的子 Agent；Batch 与同批 sibling 可以并发，但主 Agent 必须对完整终态 sibling 集合与静态 Facts 做对账并保留冲突，不能把相关一致或多数票当真相。 |

## 9. 核心用户旅程

### 9.1 理解一个存量仓库

1. operator 登记源码并启动分析。
2. Traqen 展示清点覆盖、不支持区域和持久阶段进度。
3. 确定性 Facts 与独立 Candidates 可通过源码链接检查。
4. 冲突、疑似重复、关系缺失和低证据区域持续可见。
5. operator 审核 Candidate，只有 Decision 能创建受治理 Feature/Claim。

### 9.2 查看一项能力

operator 打开 Feature 或 Candidate，可在同一图谱上下文中看到需求/设计文字、实现符号、接口/数据/配置关系、测试资产、受治理 TestSpec、最新执行、结果与缺口。

### 9.3 评估一项变更

operator 选择 Commit、Diff、Artifact、配置或 Feature。Traqen 识别可能受影响的 Claim、Feature、测试、数据和外部依赖，解释每条路径，并产生重新审核/执行计划。

### 9.4 做质量追溯

operator 能区分：

- 未发现测试线索；
- 存在测试资产，但不是受治理 TestSpec；
- 存在 TestSpec，但没有针对当前 Snapshot/Runtime 执行；
- 执行失败、通过或结论不明确；
- Evidence 缺失、过期、无效或完整。

### 9.5 持续演进一个已理解系统

1. operator 在首个完整图谱上选择一个后续 Commit、源码目录状态或其他新 Snapshot。
2. Traqen 比较新旧 Artifact/Facts，复用未变化工作，只对受影响区域执行扫描、Agent 分析与对账。
3. 发布前，Traqen 展示本次 `ChangeSet`、受影响 Feature/Claim/TestSpec/依赖、失效的派生知识和重验证计划。
4. 增量结果与受控全量重建在评估范围内等价后，新的 GraphRevision 原子成为 `CurrentGraphHead`；否则旧图谱继续作为当前真相。
5. operator 默认查看最新图谱，也可进入 Feature 历史查看每个 FeatureVersion 的 Decision、各 Snapshot 实现映射、每次变更影响和验证结果。

## 10. Traqen 分析 Traqen 验收合同

Traqen 自身仓库是强制的真实 dogfood 数据集。小型 Fixture 仍用于确定性边界用例，但不能代替这项验收。

### 10.1 固定输入

- 以一个明确 Traqen Commit 作为不可变 Snapshot；
- 纳入 `docs/`、`feature-specs/`、`contracts/`、`src/`、`test/`、`web/`、配置/Manifest 和安全的构建/测试报告；
- 清点仓库内每个 Artifact，并解释每个排除项；
- 静态理解阶段不得执行未审核的仓库代码。

### 10.2 人工审核种子 Truth Set

初始 Truth Set 至少为以下能力维护正向/负向断言、源码锚点、关系预期和允许的不确定性：

| 经审核能力 | 代表性锚点 |
|---|---|
| Project 与 Snapshot 基础 | `src/domain/project.js`、`src/domain/snapshot-manifest.js` |
| 确定性 Facts 与源码观察 | `src/domain/facts.js`、`src/domain/workspace-observations.js`、`src/scanner/` |
| Analysis Agent 与 Candidate 证据边界 | `src/analysis/analysis-agent.js`、`src/shared/candidate-bundle.js` |
| Reverse Skill 编排 | `src/domain/reverse-skill.js`、`src/skills/reverse-orchestrator.js` |
| HTTP API 与应用编排 | `src/api/http-server.js`、`src/application/traceability-application.js` |
| 治理与 Decision | `src/domain/governance.js`、`src/domain/decision-governance.js`、`src/domain/review.js` |
| Feature Graph 与 TraceChain | `src/domain/feature-graph.js`、`src/domain/trace-chain.js` |
| TestSpec、Runner、结果与 Evidence | `src/domain/test-spec*.js`、`src/runner/`、`src/domain/execution-evidence.js` |
| 变更影响与持续保护 | `src/domain/change-impact.js`、`src/domain/invalidation.js`、`src/domain/continuous-protection.js` |
| 产品与平台指标 | `src/domain/product-metrics.js`、`src/domain/platform-operations-metrics.js` |

Truth Set 是人工审核数据，不是硬编码扫描器输出；它通过 Decision 演进并保留版本。

### 10.3 必须形成的 dogfood 证据

- 含不支持与排除项的 Manifest 覆盖报告；
- 确定性 Fact 重放 Digest；
- Candidate 精度样本与审核锚点召回报告；
- 必须存在和禁止存在的关系断言；
- 冲突与缺口账本；
- 未变化区域的全量/增量等价报告；
- 产品 UI 中生成的 Traqen Candidate 图和受治理种子图；
- 一条从已审核 Traqen 能力到设计、代码、TestSpec、当前测试执行、结果和 Evidence 的 TraceChain；
- 一项受控 Traqen 变更，其预测影响与所需重验证结果能和人工预期对比。

仅仅扫描完成或生成很多节点，不能宣称“Traqen 已理解 Traqen”。

### 10.4 `traqen-self-v1` 判定阈值与权威

首个 Traqen 自分析策略固定为 `traqen-self-v1`，至少满足：

| 维度 | 阻塞阈值 |
|---|---|
| Inventory | 范围内 Artifact 处置率 100% |
| 来源/Schema | Fact、WorkUnit、Candidate 的 Snapshot 与证据边界有效率 100% |
| 锚点召回 | 至少 30 个正向锚点、覆盖至少 10 项核心能力；召回率 ≥ 90%，且不得漏掉 P0 锚点 |
| 必须关系 | 至少 60 条类型化关系断言，满足率 100% |
| 禁止关系 | 至少 30 条负向断言，违反数为 0 |
| Candidate 精度 | 分层抽样最多 100 条（不足则全量）；明确判断的 Candidate 中人工确认支持率 ≥ 90%，高置信无支撑结论为阻塞项 |
| 不确定性诚实度 | 所有抽样歧义、证据不足、不支持和预算耗尽案例必须显示 Gap/Conflict，不得静默成功 |
| 重放 | 同一 Snapshot 与引擎/策略版本的语义 Digest 100% 一致 |
| 增量等价 | 受控第二 Snapshot 的未变区域 100% 等价，变化区域只包含预期或已解释差异 |
| 端到端价值 | 至少 1 条完整审核 TraceChain，以及 1 个经过人工预期对照的变更影响场景 |

operator 批准业务能力边界、P0 锚点与阈值变更；独立技术 Reviewer 批准源码锚点和关系断言。实现作者不能批准自己的 held-out Truth Set 或验收结果。任何阈值调整都必须形成带生效版本的 Decision，不能追溯性改写旧 EvaluationRun。

## 11. 安全与可信要求

- 源码访问必须显式授权、最小权限且可审计。
- 普通客户端返回的路径使用 Workspace 相对路径或不透明标识。
- 真实秘密值不能持久化为 Fact，也不能发给外部模型。
- 外部模型只接收有界、按摘要/策略记录且经过策略过滤的 Facts；原始 SourceSlice 留在本地/私有源码边界内。
- 执行 Evidence 记录精确 Snapshot、构建、依赖、配置、Runtime、Runner、断言和尝试。
- 读取 API 强制 Project 边界并保持 Candidate/受治理对象区分。
- 每次图谱写入记录 Actor、理由、先前状态及 Decision 或执行来源。

## 12. 发布门禁

任何改变理解或追溯行为的发布都必须通过：

1. Schema 与本体兼容；
2. 确定性提取器 Fixture；
3. WorkUnit 证据边界验证；
4. 人工 Truth Set 的精度/召回/关系评估；
5. 全量与增量一致性；
6. 持久化与重启测试；
7. 安全与秘密边界测试；
8. Traqen 分析 Traqen 的图谱与 TraceChain 验收；
9. 后端、Web、构建、lint 与 diff 门禁；
10. 独立 Review。

阈值在评估策略中版本化。修改阈值属于受治理决策，不能藏在实现 PR 的测试修改里。

## 13. 交付顺序

1. **F006 + F001——Workspace 能力隔离与分析基础**：建立 Workspace 所有权，物化项目专属运行 Profile，扫描完整源码，以相同批次执行相互独立的子 Agent 分析，由主 Agent 对账，并证明持久编排。
2. **F002 + F004——追溯与审核**：展示最新/历史 Feature 与 API 证据、Gap、批量审核及可编辑的自动通过项。
3. **F003——图谱投影**：在同一 Canonical Ledger 上提供受治理、Workspace 作用域内的路径探索。
4. **F005——变更影响**：比较 Snapshot，保留 Feature 历史，计算受影响对象并驱动再验证。
5. **企业规模化**：核心发布门禁通过后，再增加 Connector、策略、分布式 Worker、可观测性和保留策略。

## 14. 与现有设计的关系

本文是系统需求真相源，但不替代：

- `traqen-product-architecture.zh-CN.md`：当前产品架构与实现差距图；
- ADR-0001：canonical ontology 与权威边界；
- 活动 `F001`～`F006` 文档：Feature 验收合同；
- 当前实施计划与详细生命周期设计。

这些文档如果和本文产品使命冲突，必须显式解决，不能静默实现。
被替代设计与历史验证从工作树删除。Git 历史是可恢复记录，不得覆盖上述真相源。

## 15. 验收状态

本文状态为 **proposed**。Design Gate 通过后，确定系统使命、正确性合同、F001 优先级和 Traqen 分析 Traqen 的发布门禁；这不代表当前实现已经满足要求。
