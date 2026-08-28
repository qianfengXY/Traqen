> 语言：**简体中文** · [English](F001-legacy-system-understanding.md)

---
feature_ids: [F001]
related_features: [F002, F003, F004, F005, F006]
topics:
  - workspace
  - legacy-system-understanding
  - canonical-graph
  - source-inventory
  - analysis-agent
  - correctness-evaluation
  - traceability
  - dogfood
  - frontend
  - user-journey
doc_kind: spec
created: 2026-07-29
updated: 2026-08-28
---

# F001：Workspace 与存量系统分析基础

> **Status**: spec | **Owner**: CodeX | **Priority**: P0

## Why

Traqen 的首要能力是把存量代码和文件理解到足以构建可审核图谱的程度，在图谱中关联需求、设计、代码、数据、配置、测试、测试结果、Evidence、变更和 Decision。Workspace 是这套理解能力的聚合根：每次分析、树、图谱、审核、影响视图、配置修订和历史查询都必须由 `workspaceId` 定界。

此前 F001 把“执行不依赖浏览器”当成目标。它是必要基础设施，但没有回答核心问题：**Traqen 是否准确恢复了存量系统的重要能力和关系，并明确展示证据与缺口？**

因此，F001 负责完整的理解基础：

```text
选定 Workspace + 不可变执行配置修订
  → 完整、不可变的源码范围
  → 确定性观察
  → 同一 AnalysisBatch 分发给所有已配置子 Agent
  → 主 Agent 做证据校验与结果对账
  → 正确性评估
  → canonical Candidate graph
```

受治理 Feature 与 Claim 仍必须由人工 Decision 创建；测试执行与 Evidence 是独立的下游权威。

## Current state

### 已有能力

- Snapshot Manifest、确定性 Facts、Candidate Bundle、证据边界校验和稳定 lineage；
- JavaScript 扫描与浏览器侧多语言启发式扫描；
- Analysis Agent、Reverse Skill 契约、模型 Adapter 和检查点；
- 治理、Feature Graph、TraceChain、Impact、TestSpec、Runner、Evidence 和指标领域；
- 浏览器提交派生观察后，服务端拥有 AnalysisRun；
- 浏览器本地项目列表、可见性偏好和 Workspace 分析 UI 骨架。

### 阻塞本 Feature 的缺口

- 没有覆盖纳入、不支持、排除、失败、生成、二进制和秘密脱敏内容的完整 ArtifactInventory 分母；
- 浏览器与服务端扫描的能力和所有权不一致；
- 部分语义规划从扫描器发现的根开始，扫描器 Miss 会继续传播；
- 真实仓库验证只测数量和降噪，没有测人工审核能力召回、Candidate 精度或关系正确性；
- 没有带正向/负向图谱断言的版本化 Truth Set；
- 没有全量/增量等价门禁；
- 没有 Traqen 分析 Traqen 的强制产品验收；
- 源码扫描仍依赖浏览器，大仓分析可能在 canonical Facts 建立前被中断；
- 没有服务端权威 Workspace 聚合、生命周期和带版本的切换上下文；
- 主运行时依赖单一全局 active model profile，另一条运行路径又硬编码本地确定性 Profile；
- 固定三个子 Agent 的规划/UI 只是装饰或把不同 Module 分给不同 Agent，没有按可配置 roster 执行同一批次；
- 没有 Workspace 专属 Skill/MCP 能力边界和不可变的解析后执行配置。

## What

### Phase A：Workspace 根、配置 Profile 与审核真相

定义 Workspace 聚合与生命周期、带版本的 `CurrentWorkspaceContext`，由 F006 把全局模型选择与内置/项目能力选择激活为不可变 `WorkspaceExecutionProfileRevision`，并定义多维正确性、审核 Truth Set Schema、显式 Unknown 状态和回归阈值。

`ReviewedUnderstandingMeasurement` 是封闭且带判别字段的 Evidence 合同。生产评估只接受由独立控制方生成且 `independent: true` 的记录。隔离开发启动只能持久化显式的 `LocalReferenceSynthetic` 变体：`independent: false`、`dataClassification: LOCAL_DEVELOPMENT_REFERENCE_ONLY`、`productionEligible: false`、`evaluationEvidenceType: LOCAL_REFERENCE_SYNTHETIC`；该变体可用于跑通产品，但绝不能满足生产发布 Gate。

### Phase B：不可变范围与完整清点

建立授权 SourceRegistration、不可变 Snapshot 捕获、完整 ArtifactInventory、显式处置、提取器能力注册表与安全 SourceSlice Broker。

### Phase C：同批次独立理解通道

把确定性提取与 Agent 源码分析作为可独立观察的通道。确定性 Planner 从完整 Source Manifest 和约定生成有界 `AnalysisBatch`。每个 active 子 Agent 收到完全相同的批次、源码范围和输出合同，但使用各自经 Workspace 许可的模型、Skill、MCP 与 independence group。子 Agent 在完成前不能查看同伴输出；主 Agent 负责任务意图与批次后对账，但不负责全量 Inventory 处置。

### Phase D：对账与 Lineage

校验证据边界，对重复和层级做对账，保留冲突与替代解释，跨 Snapshot 连接 Candidate，并产出 CandidateGraph、CoverageLedger 与 ConflictLedger，但不创建受治理权威。

### Phase E：持久与增量执行

在一个服务端持久 Job 下执行扫描与 Agent WorkUnit。首个 Snapshot 强制 `FULL`，后续 Snapshot 默认 `INCREMENTAL`；复用已提交工作、选择性失效变化区域、证明增量/全量等价，并且只有完整且评估通过的 GraphRevision 才能原子更新 `CurrentGraphHead`。默认图谱展示最新状态，但 FeatureVersion、Snapshot 映射、ChangeSet、ImpactAssessment、Decision 和 Evidence 历史必须长期保留。

### Phase F：Traqen 分析 Traqen

分析固定 Traqen Snapshot，与人工审核种子 Truth Set 对比，在 Traqen 中展示自身 Candidate 与受治理种子图，渲染完整 TraceChain，并验证一次受控变更影响旅程。

## User journey

### 主旅程：理解并查看一个存量系统

- **Scope unit**：一个包含不可变仓库 Snapshot 的 Workspace
- **Actor**：operator
- **Entry**：带授权 SourceRegistration 与已解析执行配置修订的当前 Workspace
- **Flow**：
  1. 选择一个 Workspace；所有模块重新绑定到同一个带版本 Workspace 上下文。
  2. 把主/子 Agent 模型、Skill、MCP、依赖和规范解析成一份不可变执行配置修订。
  3. 启动一个持久理解 Job，并查看完整 Artifact 分母。
  4. 观察静态通道与同批次子 Agent roster。F006 默认一个 Child；具体高风险运行可由分析策略要求更多独立 Child。
  5. 查看主 Agent 对账、被拒证据、冲突、缺口和已对账 working tree 更新。
  6. 对比分维度审核正确性，而不是单一置信度。
  7. 用 Decision 建立受治理 Feature、Claim、Taxonomy 与 TestSpec。
  8. 从同一 canonical model 查看 Graph、TraceChain、内容、Impact 与质量投影。
- **Success evidence**：Inventory 报告、评估报告、图谱断言、重放/增量报告、持久 Job 轨迹和产品可见的 Traqen 自身图谱
- **Non-goals**：自动恢复业务真相、自动批准 Candidate、执行任意源码、第一版支持所有语言

### 支撑旅程

| ID | 旅程 | 必须证据 |
|---|---|---|
| J1 | Parser 漏掉入口点，独立 Manifest/Source 通道仍发现并举证 | 对抗 Fixture 与 Candidate 来源 |
| J2 | 两个 Skill 对一个能力边界有分歧 | ConflictLedger 与双方解释 |
| J3 | 有测试文件，但没有当前执行证明 Claim | TestAsset/TestSpec/Execution 分离状态 |
| J4 | 扫描期间刷新或关闭浏览器 | Job 身份不变且服务端进度增长 |
| J5 | 首次全量分析后，一个文件变化只影响一个图谱区域 | 新 Snapshot、增量/全量等价、原子 CurrentGraphHead 更新与 Impact 路径 |
| J6 | Traqen 分析固定的自身仓库 | 审核自图谱、缺口、TraceChain 与 Impact 报告 |
| J7 | 查看一项长期演进的 Feature | FeatureVersion Decision、各 Snapshot 实现映射、ChangeSet、Impact 与验证时间线 |
| J8 | 分析一个超大、多语言工程 | 完整原始源码处置、确定性分区、动态 DAG 进度、模型/Skill 路由决策、同批子 Agent 相互印证与显式剩余 Gap |

## 前端产品体验

### 入口与首次设置

Workspace 落地总览应把用户引导到第一个未满足的前置条件，而不是直接展示空白分析控制台。设置顺序为：

1. 创建或选择 Workspace；
2. 登记经过授权的源码；
3. 在 F006 解析并校验 Workspace 执行 Profile Revision；
4. 启动第一次 `FULL` 分析。

创建 Workspace 与启动分析是两个独立的显式命令。Start 前确认摘要必须展示选中的 `SourceRegistration`，恢复任务时还要展示已固定 Snapshot，并同时展示执行 Profile Revision、Main/Child roster、数据边界、预算策略，以及选中的 `AUTO`、`FULL` 或 `INCREMENTAL` 模式。高级模式选择也不能绕过“第一次发布图谱必须使用 `FULL`”的规则。

### 分析指挥台

F001 界面围绕一个持久 `WorkspaceAnalysisJob` 展示：

- 七阶段轨道：`SOURCE_SCAN`、`FACT_COMMIT`、`ANALYSIS`、`RECONCILIATION`、`EVALUATION`、`PROJECTION`、`PUBLISHING`；
- 独立 Static 通道：展示完整 Inventory 分母及每项处置，包括排除、不支持、二进制、超大、Secret 脱敏和读取失败 Artifact；
- 独立 Agent 通道：展示 Batch/WorkUnit 进度、Main Agent、每个已配置 Child 槽位、相同批次 Scope、各自结果和对账状态；
- 视觉独立的 Working Candidate Tree，展示 Candidate、Conflict、Quarantine 与 Gap 数量；
- 显式 Start、Pause、Resume、Cancel 命令，以及持久 Job/Event 历史。

Main Agent 的界面语义是“把完整同批 Child 结果与源码证据、确定性 Facts 和历史做对账”，绝不能显示为投票。原始 Prompt、模型响应、Digest 与 Trace ID 放入技术详情；默认事件流只解释用户可理解的进度与阻塞。

### 页面状态与恢复

- **无 Source / Profile 无效：** 展示未满足的前置条件并深链到 F006 的准确位置；Start 保持禁用。
- **Running：** 用户可以离开页面，服务端 Job 继续运行；刷新与重连恢复同一个 Job，不能发出生命周期命令。
- **Pause requested / paused / recovering：** 保留固定 Snapshot 与 Profile Revision，并解释当前是在等待原子 WorkUnit 提交还是恢复 Worker Lease。
- **Partial failure / completed with gaps：** 保留已完成检查点，列出可重试单元与 Gap，并说明是否阻断发布。
- **Completed but unpublished：** 展示评估/发布 Gate 与非权威 Working Candidate，不能把它跳转成 F002 受治理树。
- **Failed / cancelled：** 保留历史和诊断；重试只能通过受支持的显式命令创建或恢复，不能覆盖失败记录。

桌面端可以在阶段轨道下并排展示 Static 与 Agent 通道；移动端改为按顺序展开，但阶段、命令状态、各自分母、阻塞项和 Candidate 权威标签必须保留。

### 前端验收标准

- [ ] 首次与回访 Workspace 旅程始终给出一个有效下一步，不要求手工输入 Job、Snapshot 或 Candidate ID。
- [ ] 七个持久阶段与 Static/Agent 通道分母独立可见，不能用复合理解度总分替代。
- [ ] 每个 Active Child 槽位都显示相同 Batch Scope 与输出合同，Main 对账不能表现为多数票。
- [ ] Working Candidate 在视觉和文字上明确非权威，绝不能进入 F002 Governed Tree。
- [ ] 刷新、重连、页面导航和 Workspace 切换都是 GET-only，不能暂停或取消服务端 Job。
- [ ] 所有非终态、部分失败、配置阻断、旧 Workspace 迟到响应和历史 Job 都有明确且可恢复的界面状态。

## Acceptance criteria

### A. 范围与确定性 Facts

- [ ] **AC-A0**：Workspace 新建、显示/隐藏、切换和经审计删除生命周期由服务端拥有；所有功能界面使用 `workspaceId` 与上下文版本定界，旧 Workspace 的迟到响应不能更新当前 UI。
- [ ] **AC-A0b**：全局账号和 Allowlist CLI 模型是显式选择的可复用资产；active 全局 Skill/MCP 资产与 Workspace 禁用/本地能力状态解析为不可变 Active Configuration，Runtime 只接收其 Snapshot 与显式 Agent Grant，不能访问可变 Registry。
- [ ] **AC-A1**：固定 Snapshot 内每个 Artifact 都有显式 Inventory 处置并留在覆盖分母中。
- [ ] **AC-A2**：每个受支持提取器声明精确能力，并通过正向、负向、源码跨度和诊断 Fixture。
- [ ] **AC-A3**：Facts 不可变、绑定 Snapshot、可定位源码，并可按提取器版本重现。

### B. 独立 Agent/Skill 理解

- [ ] **AC-B1**：初始 WorkUnit 计划包含独立于单一扫描器发现的 Manifest/Module/入口/文档/测试/配置根。
- [ ] **AC-B2**：Agent/Skill 能请求策略约束的 SourceSlice，并恢复一个被某确定性提取器有意漏掉的审核锚点。
- [ ] **AC-B3**：每个 Candidate 节点和关系只引用同一 Snapshot 与 WorkUnit 内允许证据；拒绝非法 ID 和过高置信度。
- [ ] **AC-B4**：预算耗尽、不支持语法、歧义和模型失败产生显式 Gap，不能伪造完成。
- [ ] **AC-B5**：每条 ArtifactInventory 记录都必须直接读取不可变 Snapshot 原始源码、交给声明过能力的专用 Skill，或形成显式 Gap；Scanner Facts 只是可选增强，绝不能定义 Agent 任务全集。
- [ ] **AC-B6**：相同 Snapshot、Planner/Convention 版本、执行策略与源码范围必须产生相同且完整的 `UnderstandingPlan`，其 Partition ID 稳定且 `unassignedCount=0`；动态依赖 DAG 以有界大文件、文件、Module、跨 Module、Critic 与汇总 WorkUnit 处理规模，子任务摘要不能单独作为证据。
- [ ] **AC-B7**：每个 WorkUnit 都有基于已验证模型能力/校准 Profile 与 Skill 合同、版本固定且已持久化的 `AnalysisRouteDecision`；高风险冗余使用相互独立的 Producer Group 和证据对账，找不到合格 Producer 与未解决分歧必须显式保留，不能 Fallback 或按多数票造真相。
- [ ] **AC-B8**：每个已激活 Workspace Profile 恰好包含一个 Main Agent 和至少一个已启用且完整的 Child Agent Slot；每个 Slot 独立固定模型 Revision、Skill、MCP Grant、Role Policy 和 Independence Group。运行级分析策略可要求更多独立 Child Slot，但不改变 F006 生效下限。
- [ ] **AC-B9**：每个 `AnalysisBatch` 以相同源码范围和输出 Schema 分发给完整 active 子 Agent roster；子 Agent 完成前相互隔离，主 Agent 对完整同批结果集合、静态 Facts 和历史 lineage 做对账，不能多数票裁决。
- [ ] **AC-B10**：子 Agent 或主 Agent 的原始模型输出不能直接修改 Feature/API working tree；只有通过 Schema 与证据校验的对账结果才能发布批次检查点，不可信证据必须进入隔离区、冲突或 Gap。

### C. 对账与治理

- [ ] **AC-C1**：对账识别重复、层级、矛盾和替代解释并保留各自证据。
- [ ] **AC-C2**：名称、路径、Domain 或 Hash 不能静默创建受治理 Feature 身份。
- [ ] **AC-C3**：只有 Decision 能创建或修订 FeatureVersion、Claim、Taxonomy 分类和 TestSpec。
- [ ] **AC-C4**：Candidate、受治理对象、测试线索、TestSpec、TestExecution、VerificationResult 和 Evidence 在存储/API/UI 中严格区分。

### D. 正确性与增量

- [ ] **AC-D1**：评估报告为 Inventory、锚点召回、Candidate 精度、必须/禁止关系、来源、缺口、重放和增量等价提供分母。
- [ ] **AC-D2**：Truth Set 数据版本化、经审核，并排除在生产分析输入之外。
- [ ] **AC-D3**：同一 Snapshot 与引擎重复运行产生稳定 Facts 和 Candidate lineage。
- [ ] **AC-D4**：受控新 Snapshot 的增量图谱在评估范围内等价于全量图谱，并保留不受影响的 Decision。
- [ ] **AC-D5**：项目没有已发布图谱时只能执行 FULL；已有 `CurrentGraphHead` 时 AUTO 默认 INCREMENTAL，operator 可显式强制 FULL。
- [ ] **AC-D6**：构建中、失败或评估未通过的运行不能替换 `CurrentGraphHead`；发布新 GraphRevision 与移动当前头在一个原子事务中完成。
- [ ] **AC-D7**：每个已发布 Snapshot 转换都生成 `ChangeSet`、`ImpactAssessment`、受影响 Feature/Claim/TestSpec/依赖集合和重验证计划。
- [ ] **AC-D8**：默认图谱只显示最新已发布状态，但 Feature 历史能查询每个 FeatureVersion 的 Decision、各 Snapshot 实现映射、本次变化影响和验证结果；代码变化不得自动修订业务 FeatureVersion。

### E. 持久生命周期与安全

- [ ] **AC-E1**：扫描与 Agent 阶段运行在一个持久 Job 下；刷新、关闭、重连或另一浏览器接入不会改变状态。
- [ ] **AC-E2**：人工 Pause/Resume 保留相同 Snapshot 并跳过已提交 WorkUnit；运行任务在 Worker 重启后恢复，人工暂停任务保持暂停。
- [ ] **AC-E3**：Local Runner Allowlist、路径/Symlink fencing、SourceSlice 策略、秘密脱敏和隔离评估 Store 通过安全测试。
- [ ] **AC-E4**：切换后浏览器不包含权威扫描或模型执行循环。

### F. Traqen 分析 Traqen

- [ ] **AC-F1**：固定 Traqen Snapshot 清点 `docs/`、`feature-specs/`、`contracts/`、`src/`、`test/`、`web/` 和安全构建/测试产物，并显式列出排除项。
- [ ] **AC-F2**：输出按 `traqen-self-v1` 与盲测 Truth Set 对比：100% Inventory 处置、至少 30 个正向锚点/10 项能力且召回 ≥90%、至少 60 条必须关系 100% 满足、至少 30 条禁止关系零违反、分层 Candidate 样本精度 ≥90%，并由非实现作者审批。
- [ ] **AC-F3**：Traqen 展示自身 Candidate 图和视觉区分的受治理种子图，并提供源码内容与缺口报告。
- [ ] **AC-F4**：至少一项 Traqen 能力具有从系统需求/设计到代码、TestSpec、当前执行、VerificationResult 与 Evidence 的完整审核 TraceChain。
- [ ] **AC-F5**：一项受控 Traqen 变更产出经审核的 Impact 路径和重验证计划。
- [ ] **AC-F6**：后端、Web、Build、Lint、Diff、评估、浏览器验收和独立 Review 门禁通过。
- [ ] **AC-F7**：Traqen UI 默认展示第二个 Snapshot 的最新图谱，同时能打开一项 Feature 的版本/实现/影响/验证历史，并证明第一次 FULL 和第二次 INCREMENTAL 的图谱切换是原子的。

## 需求点 Checklist

| ID | operator 原话 | AC | 验证方式 | 状态 |
|---|---|---|---|---|
| R1 | “扫描与分析 Agent 可能需要重新设计。” | AC-B1～B7、AC-C1 | 完整源码分区/DAG/Router 对抗测试 + 对账 | [ ] |
| R2 | “这个需求是我最核心的需求，怎么把存量代码的分析正确。” | AC-A1～A3、AC-B5～B7、AC-D1～D8 | 完整源码覆盖与版本化 Truth Set 评估 | [ ] |
| R3 | “做一个需求、设计、代码、测试用例、测试结果、配置等图谱关联。” | AC-C4、AC-F3～F4 | canonical graph 断言与 UI | [ ] |
| R4 | “便于之后做变更影响分析、内容查看、质量追溯。” | AC-D4～D8、AC-F4～F5、AC-F7 | 内容、TraceChain、Impact 与历史验收 | [ ] |
| R5 | “拿 Traqen 项目做测试验证，通过 Traqen 自己展示自己的功能图谱。” | AC-F1～F7 | 隔离 Traqen 自分析验收 | [ ] |
| R6 | “刷新浏览器，当前运行的任务状态未发生变化。” | AC-E1～E2 | Job 身份、进度、WorkUnit 调用 | [ ] |
| R7 | “第一次全量形成完整图谱；以后增量更新最新图谱，同时保留功能版本变化和每次变更影响。” | AC-D4～D8、AC-F5、AC-F7 | 两个 Snapshot 的 FULL→INCREMENTAL 验收、CurrentGraphHead 与 Feature 历史查询 | [ ] |
| R8 | “Workspace 切换，则其他功能全部跟随一起变化。” | AC-A0 | 覆盖全部模块的 Workspace 切换集成测试与迟到响应拒绝 | [ ] |
| R9 | 历史 F006 需求；已被 2026-08-28“一个或多个 Child”决定取代。 | AC-B8～B10 | 下限、同批分发、隔离、完整集合对账和 Working-tree 检查点测试 | [ ] |
| R10 | 历史 F006 Overlay 需求；已被全局可用性、Workspace 本地资产和显式 Grant 取代。 | AC-A0b、AC-B8 | 能力解析 Fixture 与 Runtime Capability Denial 测试 | [ ] |

### 覆盖检查

- [x] 每条 operator 需求都映射到可执行 AC。
- [x] 正确性、图谱价值和自身 Dogfood 是主要结果。
- [x] 刷新耐久性作为基础设施保留，不再定义整个 Feature。
- [ ] UI 证据映射将在实现验收阶段补全。

## Dependencies

- **系统需求**：`docs/architecture/traqen-system-requirements.zh-CN.md`
- **产品架构**：`docs/architecture/traqen-product-architecture.zh-CN.md`
- **本体权威**：ADR-0001 canonical traceability ontology
- **已实现前置**：PR #5 服务端 AnalysisRun；只覆盖派生观察后的 Agent 阶段
- **支撑设计**：现有 Agent、Workspace、Graph、TestSpec、Runner、Evidence 与持久生命周期文档
- **实现门禁**：替换当前源码扫描所有权前必须通过 Design Gate

## Architecture ownership

- **Architecture cell**：存量系统理解 → canonical traceability graph
- **Map delta**：update required
- **Why**：F001 扩展源码理解所有权，引入独立证据通道与对账，并把正确性评估和自身 Dogfood 纳入发布边界。

## Risks

| 风险 | 缓解 |
|---|---|
| 把节点数量误当理解质量 | 人工审核多维评估与负向断言 |
| 一个扫描器盲点变成整条管线盲点 | Manifest 派生规划与独立源码通道 |
| “分析所有文件”退化成超大 Prompt 或只分析部分扫描结果 | Snapshot 确定性分区、有界层级 DAG 与 `unassignedCount=0` |
| 通用或未校准模型静默处理所有语言与角色 | 已验证 ModelCapabilityProfile、版本固定 Skill 合同、持久 Route Decision 与 `NO_ELIGIBLE_PRODUCER` |
| 多模型把相关猜测变成多数票真相 | 同批隔离的子 Agent 输出、Independence Group 来源、主 Agent 证据对账与 ConflictLedger 保留 |
| Agent 文字虚构关系 | 结构化 Bundle、有界源码/证据、确定性拒绝 |
| 把当前代码冻结成业务真相 | Candidate/Decision/受治理对象分离 |
| 隐藏不支持范围 | 完整 Inventory 分母与显式处置 |
| Truth Set 对当前实现过拟合 | 正负关系断言、版本化、独立 Review |
| 增量模式偏离全量分析 | 全量/增量等价门禁 |
| 失败的增量运行污染当前图谱 | GraphRevision 评估通过后原子移动 CurrentGraphHead |
| 代码变化被误写为业务 Feature 新版本 | FeatureVersion 只由 Decision 创建；实现映射和影响历史独立记录 |
| “只保留最新图谱”被误解为删除历史 | 当前投影与不可变 Snapshot/版本/影响账本分离 |
| 自分析污染生产数据 | 隔离 Worktree、Store、端口与经审核执行 |
| 耐久性工程再次挤占产品正确性 | 正确性与 Dogfood 阶段为发布阻塞项 |

## Open questions

| # | 问题 | 建议 | 状态 |
|---|---|---|---|
| OQ-1 | 谁批准初始 Traqen 种子 Truth Set？ | operator 决定业务边界；独立 Reviewer 验证技术锚点 | Design Gate |
| OQ-2 | 哪些阈值阻塞发布？ | 已定义 `traqen-self-v1` 数字阈值；后续变更必须有 Decision | Resolved |
| OQ-3 | 第一种 Source Connector 是什么？ | Allowlisted Local Runner，随后加入 Remote Git，但图谱契约不变 | Design Gate |

## Key decisions

| # | 决策 | 理由 | 日期 |
|---|---|---|---|
| KD-1 | F001 是存量系统理解正确性，不是刷新 Bug。 | 只有耐久性、没有语义正确性，不满足产品使命。 | 2026-07-29 |
| KD-2 | 正确性按多维评估，并与人工审核 Truth Set 对比。 | 遗留意图不能由单一模型置信度表达。 | 2026-07-29 |
| KD-3 | 分析通道独立产证据，之后对账。 | 一个提取器不能决定系统允许发现什么。 | 2026-07-29 |
| KD-4 | Traqen 分析 Traqen 是发布门禁。 | 产品必须在自身真实系统上展示有用追溯。 | 2026-07-29 |
| KD-5 | `Fxxx` 生命周期 ID 与受治理 `Feature.id` 分离。 | 工程规划不能创建业务权威。 | 2026-07-29 |
| KD-6 | 第一次分析强制 FULL，后续默认 INCREMENTAL；当前图谱头与历史账本分离。 | 系统既要提供最新可用图谱，也要长期解释 Feature 如何变化及每次变化影响什么。 | 2026-07-29 |
| KD-7 | 代码/配置变化不能自行创建 FeatureVersion。 | 业务定义的版本权威来自 Decision，实现演进应记录为 Snapshot 映射、Impact 与验证历史。 | 2026-07-29 |
| KD-8 | Agent 从完整不可变 Snapshot 规划，执行确定性动态分区 DAG，把每个有界 AnalysisBatch 发送给所有已配置且相互独立的子 Agent slot，再由主 Agent 对照静态 Facts 进行证据对账，禁止多数票。 | 超大工程需要可审核的完整处置、有界上下文、显式 Producer 适配度并保留分歧，不能让 Scanner 盲点或相关模型猜测定义真相。 | 2026-07-29 |
| KD-9 | Workspace 是所有产品对象和视图的聚合根；显示/隐藏是用户偏好，删除是经审计生命周期。 | 单一 Scope 身份使切换具有原子语义，也避免把 UI 可见性误当成破坏性删除。 | 2026-07-31 |
| KD-10 | 每个 active 子 Agent 分析同一个有界批次；主 Agent 对完整同批结果集、静态证据和历史做对账。 | 可比较的独立观察才能暴露分歧；把不同 Module 分给不同 Agent 只有吞吐量，没有相互印证。 | 2026-07-31 |
| KD-11 | F006 部分已被 KD-14 取代。 | 仅作为历史上下文保留。 | 2026-08-11 |
| KD-12 | 现有 `Project.id` 迁入 Canonical Workspace 身份，或仅作为兼容别名；Workspace 与 Project 不再保留为两个独立 1:1 聚合。 | 两套生命周期与授权身份会重新制造 Workspace 本应消除的跨模块漂移。 | 2026-07-31 |
| KD-13 | F001 的实现切片是活动计划中的 Task，不新增 `F001a`～`F001k` 生命周期 ID。 | 一份 Feature 真相源加可测试的计划任务既能分解交付，也不会再产生竞争的 Feature 命名空间。 | 2026-07-31 |
| KD-14 | F006 分离全局账号、CLI 模型与 active Skill/MCP 资产，以及 Workspace 可用性与显式 Agent 授权；使用一个或多个 Child、持久草稿、显式应用和不可变运行快照。 | 全局治理、Workspace 意图、Agent 权限和运行 Provenance 必须可分别解释。 | 2026-08-28 |

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-07-29 | F001 最初按持久扫描生命周期立项 |
| 2026-07-29 | operator 纠正为存量系统理解正确性和 Traqen 自身 Dogfood |
| 2026-07-29 | operator 明确长期演进模型：首次全量、后续增量、最新图谱投影与 Feature/Impact 历史并存 |
| 2026-07-29 | operator 明确 Agent 完整原始源码覆盖、确定性分区/DAG、显式模型/Skill 路由与多模型对账 |
| 2026-07-31 | operator 明确 Workspace 全局联动切换、同批次主/子 Agent 相互印证和 Workspace 专属运行时能力 |
| 2026-07-31 | GPT/Kimi 相互印证确认 F001～F006 边界；operator 选择本次方案作为设计基线并要求删除被替代文档；ADR-0002 裁决 Canonical Workspace 身份、F006 顺序与 Runtime 隔离 |
| 2026-08-11 | 记录历史 F006 合同；已于 2026-08-28 取代 |
| 2026-08-28 | operator 确认 F006 全局账号/CLI 模型/Skill/MCP 资产、Workspace 可用性和显式 Agent 授权、Child 1..N、显式应用与不可变运行快照 |

## Review gate

Design Gate 必须确认：

1. 系统使命与 canonical graph 终态；
2. 多维正确性合同；
3. 人工审核 Truth Set 权威；
4. 独立分析通道与对账边界；
5. Traqen 分析 Traqen 是强制验收；
6. 第一阶段 Local Runner 数据边界；
7. FULL→INCREMENTAL、CurrentGraphHead 原子发布与 Feature 历史语义。
8. Snapshot 派生的完整 Agent 规划、按能力路由的模型/Skill 执行与基于证据的多模型对账。
9. Workspace 聚合所有权、上下文版本切换、同批子 Agent 隔离和项目专属能力的不可变解析。

实现随后执行 TDD、Quality Gate、独立 Review 与 Merge Gate。

## Links

| 类型 | 路径 | 说明 |
|---|---|---|
| 系统需求 | `docs/architecture/traqen-system-requirements.zh-CN.md` | 产品使命、图谱、旅程、系统需求、Dogfood 合同 |
| 产品架构 | `docs/architecture/traqen-product-architecture.zh-CN.md` | Workspace 根、F001～F006 边界、Agent 拓扑、权威模型和当前实现差距 |
| 活动 F006 实施计划 | `feature-specs/2026-08-28-f006-workspace-capability-settings.md` | F006 实施顺序、TDD 边界、迁移、前端与验收 |
| 历史基础计划 | `feature-specs/2026-07-31-traqen-product-foundation.md` | F001 基础历史；其中此前 F006 任务已被取代 |
| 详细生命周期设计 | `docs/features/workspace-scan-and-analysis-lifecycle.zh-CN.md` | 完整 Inventory、同批次主/子 Agent 执行、对账、服务端所有权与恢复 |
| Excalidraw 整体架构 | `docs/diagrams/traqen-product-architecture/traqen-product-functional-architecture.excalidraw` | 可编辑的 Workspace 根与产品模块架构 |
| Archify 分析工作流 | `docs/diagrams/traqen-product-architecture/workspace-analysis-batch.workflow.html` | 确定性批次、同批子 Agent 隔离、能力路由、对账与 Gap |
| 历史 Archify 能力解析 | `docs/diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html` | 已被取代的 Overlay 图；F006 实施验证当前合同后需重新生成 |
| Archify 图谱生命周期 | `docs/diagrams/traqen-product-architecture/graph-governance.lifecycle.html` | Candidate、Decision、评估、发布、拒绝与隔离 |
| Canonical ontology | `docs/decisions/ADR-0001-canonical-traceability-ontology.zh-CN.md` | 真相与权威边界 |
| Workspace 聚合 ADR | `docs/decisions/ADR-0002-workspace-aggregate-and-execution-isolation.zh-CN.md` | Canonical Workspace 身份、切换、迁移与运行能力隔离 |
