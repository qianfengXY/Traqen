> 语言：**简体中文** · [English](traqen-product-architecture.md)

---
feature_ids: [F001, F002, F003, F004, F005, F006]
related_features: []
topics:
  - product-architecture
  - workspace
  - analysis-agent
  - traceability
  - governance
  - change-impact
  - frontend
  - user-journey
doc_kind: architecture
created: 2026-07-31
status: proposed
---

# Traqen 产品架构

## 1. 使命与设计边界

Traqen 要把一个存量项目的代码和文件理解到足以构建可审核图谱的程度，在图谱中关联需求、设计、代码、数据、配置、测试、测试结果与变更历史。图谱服务于审核，不能假装自动分析已经恢复了不容置疑的业务真相。

本文是产品级架构真相源，负责定义：

- Workspace 聚合根与跨模块上下文；
- 产品 Feature 地图；
- Main/Child Analysis Agent 拓扑；
- 全局模板与 Workspace 生效配置；
- Canonical Graph 权威与历史；
- 目标架构和实现提交 `1682d7d` 之间经过代码核验的差距。

详细执行合同保留在 [F001 Workspace 扫描与 Analysis Agent 生命周期](../features/workspace-scan-and-analysis-lifecycle.zh-CN.md)，Canonical Entity 的权威边界保留在 [ADR-0001](../decisions/ADR-0001-canonical-traceability-ontology.zh-CN.md)；Workspace 身份、切换与能力隔离由 [ADR-0002](../decisions/ADR-0002-workspace-aggregate-and-execution-isolation.zh-CN.md)固定。

## 2. 架构不变量

1. **Workspace 是聚合根。** 每个 Run、Snapshot、Inventory 记录、Fact、Candidate、Decision、GraphRevision、审核、影响评估、配置和投影必须且只能属于一个 `workspaceId`。
2. **切换 Workspace 就切换整个产品。** 导航可以停留在同一模块，但数据、选择、订阅、设置和 Current Graph Head 必须全部重新绑定到新 Workspace。
3. **移出不是删除。** 添加/移除只改变 Workspace 是否出现在用户的切换器中；删除则在可审计的保留策略下改变 Workspace 生命周期。
4. **原始源码是 Agent 任务源。** 完整、不可变的 `SourceSnapshot` 与 `ArtifactInventory` 定义分析覆盖；Scanner Facts 是独立的对账参考，绝不能定义 Child Agent 的任务全集。
5. **每个已配置 Child Agent 都收到同一批任务。** 一个 Workspace 有一个 Main Agent 和一个或多个 Child Agent 槽位，默认两个。对同一个 `AnalysisBatch`，所有启用 Child 槽位收到相同源码范围和输出合同，使 Main Agent 能比较独立产生的结果。
6. **模型、Skill、MCP 都是显式运行输入。** Main 和各 Child 槽位可以选择不同模型 Profile；Run 固定引用不可变的 Workspace 生效执行 Profile。
7. **全局能力配置只作为模板。** Runtime Worker 只能拿到物化后的 Workspace Profile，不能查询或挂载全局 Skill/MCP Registry。
8. **不可信证据不能静默通过。** 无效、越界、矛盾或不可验证证据必须隔离 Candidate 或记录 Gap；不能无账本丢弃，更不能按票数晋升。
9. **实时树是投影，不是权威。** Workspace Analysis 可以流式展示已对账 Working Candidate；受治理的 Feature/API 树默认读取最新发布的 `CurrentGraphHead`。
10. **历史只追加。** 新 Snapshot 或实现映射不能重写业务 Feature 版本；Decision、Mapping、GraphRevision、ChangeSet、Impact、测试与结果始终可查询。

## 3. 产品 Feature 地图

| ID | 产品模块 | 负责内容 | 依赖 |
|---|---|---|---|
| F001 | Workspace 与分析基础 | Workspace 生命周期、源码登记、静态扫描、Main/Child 分析、对账、进度与 Working Tree | F006 |
| F002 | 功能与 API 追溯 | 最新 Feature/API 树、证据块、缺口和单 Feature 历史 | F001 |
| F003 | 追溯图谱 | 交互式图谱投影和证据路径探索 | F001、F002 |
| F004 | 声明审核 | 审核队列、证据不足流程、批量 Decision 和编辑自动准入结果 | F001、F002 |
| F005 | 变更影响 | 增量变化路径、受影响对象和重新验证计划 | F001、F002、F003 |
| F006 | Workspace 能力设置 | 全局模板、Workspace 覆盖、依赖、规范、模型、Skill 与 MCP | 无 |

以上工程 `Fxxx` 是交付标识，不是 Traqen 图谱中的受治理业务 `Feature.id`。

## 4. 总体功能架构

[打开可编辑 Excalidraw 源](../diagrams/traqen-product-architecture/traqen-product-functional-architecture.excalidraw) · [静态 SVG](../diagrams/traqen-product-architecture/traqen-product-functional-architecture.svg)

总体图只遵循一条核心规则：`CurrentWorkspaceContext` 向所有产品界面扇出，任何模块都不能拥有独立的项目选择器。

```text
Workspace 切换器
  └─ CurrentWorkspaceContext
       ├─ Workspace 分析
       ├─ 功能追溯
       ├─ 追溯图谱
       ├─ 声明审核
       ├─ 变更影响
       └─ Workspace 设置
```

所有模块读取相同 Canonical Ledgers，但使用不同投影。Working Candidate Tree 与已发布 Governed Tree 必须在视觉和契约上严格区分。

### 4.1 跨 Feature 产品体验

产品 Shell 把上述六个模块组织成一条受 Workspace 定界的用户旅程，而不是六个互不相干的管理页面：

| 导航分组 | 产品界面 | 用户首要任务 |
|---|---|---|
| 理解 | Workspace 分析（F001） | 建立或更新系统理解 |
| 理解 | 功能 / API（F002） | 核对受治理能力及其证据链 |
| 理解 | 追溯图谱（F003） | 解释关系与证据路径 |
| 治理 | 声明审核（F004） | 裁决弱证据、冲突、抽样或过期 Candidate |
| 治理 | 变更影响（F005） | 解释变化并关闭审核/重验证动作 |
| 配置 | 能力设置（F006） | 固定 Workspace 执行能力与边界 |

Workspace 根路径是**落地总览**，不是第七个产品模块。总览汇总当前 Published Head、活跃 Job、审核队列、未关闭影响动作、配置有效性和最近的不可变活动。主操作随 Workspace 状态变化：登记源码、修复配置、开始首次分析、继续活跃 Job、启动增量分析，或处理阻断审核。

常驻 Shell 必须展示：

- Workspace 切换器与当前 Workspace 身份；
- 当前模块与选中对象的面包屑；
- 当前已发布 `GraphRevision`，或明确的历史只读上下文；
- 当前 Workspace 的审核与变更影响数量；
- 语言、主题、身份、帮助和连接健康状态。

API Base URL、Token、原始对象 ID 等部署诊断不是产品主导航。开发或部署模式仍需要时，应放入环境级诊断抽屉。正常用户旅程从 Workspace、Job、受治理对象、审核队列或最新已发布 ChangeSet 进入，绝不能要求用户手工输入内部 ID。

### 4.2 权威与视觉状态合同

所有产品界面必须使用一致的权威语言：

- **Published：** 实线容器、`GraphRevision` 标识和 `PUBLISHED` 文字；
- **Working Candidate：** 虚线容器、`CANDIDATE` 文字和固定的非权威说明；
- **Historical：** 显示选中 Revision 的只读横幅，并提供直接返回 Current Head 的入口；
- **Conflict、Gap、Missing、Stale：** 同时使用图标、文字和颜色，颜色不能成为唯一编码；
- **Unavailable：** 展示缺失的分母或来源及其原因，不能编造 0 分或满分。

Candidate 与 Governed Projection 可以互相跳转，但不能共用一棵树、静默合并，或复用会隐藏权威差异的视觉状态。Graph 布局、客户端选择与缓存偏好都不能创建 Canonical Node、Edge、Decision 或进度。

### 4.3 共享交互与状态合同

- 页面 Mount、刷新、重连和 Workspace 切换都是只读操作。Start、Pause、Resume、Cancel、Review 与保存设置只能由用户显式命令触发；Publishing 遵循受治理的服务端工作流，绝不能作为页面生命周期副作用触发。
- 切换 Workspace 时禁用旧上下文命令、清除旧选择、重绑订阅，并按 5.2 节拒绝迟到响应。
- 空状态解释对象为什么不存在，并指出下一项有效动作；重试必须保留筛选和未保存输入。
- 并发命令必须明确失败；审核与设置冲突要同时保留用户输入和服务端新版本以供比较。
- 进度独立展示 Inventory、静态提取、Agent 工作、审核、评估与发布分母；Traqen 不能把它们压缩成一个置信度或理解度总分。
- 桌面端可以使用列表/内容/证据多栏；移动端通过列表到详情的逐级导航保留相同任务，Graph 默认展示可访问的关系/路径列表，画布是可选视图。
- Tree 导航、批量选择、审核 Decision 与图谱路径查看必须支持键盘；实时进度使用摘要播报，不能逐条朗读高频诊断。

F001-F006 Feature 文档分别负责本页面的旅程、状态、权威绑定和前端验收标准。[Enterprise Blue](../design/enterprise-blue-theme.zh-CN.md) 继续作为视觉设计系统真相源；本文不重复其颜色或组件 Token。

## 5. Workspace 聚合与生命周期

### 5.1 Canonical 对象

```ts
type Workspace = {
  id: string;
  name: string;
  status: "ACTIVE" | "DELETION_PENDING" | "DELETED";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type WorkspaceViewPreference = {
  workspaceId: string;
  principalId: string;
  visible: boolean;
  lastOpenedAt: string | null;
};

type CurrentWorkspaceContext = {
  workspaceId: string;
  workspaceVersion: number;
  effectiveConfigurationRevisionId: string;
  currentGraphHeadVersion: number | null;
};
```

`WorkspaceViewPreference.visible=false` 实现移出/隐藏但保留数据。删除是独立的可审计命令。已删除 Workspace 不能启动 Run 或接收新 Decision，物理清理不可变产物的时机由保留策略控制。

现有服务端 `Project.id` 应迁移为 `Workspace.id`，或在过渡期仅作为同一身份的兼容别名保留。它不能继续作为第二个 1:1 聚合，拥有独立生命周期、选择状态或授权状态。

### 5.2 切换事务

用户选择另一个 Workspace 时，Shell 必须：

1. 替换 `CurrentWorkspaceContext`；
2. 取消或脱离旧 UI 订阅，但不能取消服务端任务；
3. 清除旧 Workspace 的 Feature/API/Graph/Review/Impact 选择；
4. 加载新 Workspace 的生效配置与 Current Graph Head；
5. 挂接新 Workspace 的活跃 Job 和投影；
6. 拒绝 `workspaceId` 或 Context Version 已不匹配的迟到响应。

这样可以防止慢响应在切换后把一个 Workspace 的数据展示到另一个 Workspace。

## 6. Workspace Analysis 架构

### 6.1 独立证据通道

一个不可变 Snapshot 同时进入两条独立通道：

- **静态扫描通道：** 清点文件、代码、配置、文档、图片、测试、结果以及不支持/二进制内容；在能力范围内提取确定性 Facts。
- **Agent 通道：** 从完整 Inventory 确定性产生 `AnalysisBatch`，让每个已配置 Child Agent 从同一批次读取受策略约束的原始 `SourceSlice`。

图片和其他二进制 Artifact 始终留在 Inventory 分母中。只有安装并声明了媒体/OCR 能力的 Specialist 才能分析；否则必须产生显式 Unsupported 或 Unprocessed Gap。

### 6.2 Main 与 Child Agent 合同

Main Agent 负责规划问题、输出合同、生命周期控制、对账、Follow-up、Module/Project 汇总和面向用户的说明。覆盖率统计不归 Main 模型决定；即使 Main 模型失败，确定性 Planner 仍必须保证全部 Artifact 得到处置。

每个启用的 Child Agent：

- 有自己固定的模型、Skill 集、MCP 集与能力 Provenance；
- 收到与其他启用 Child 完全相同的 `AnalysisBatch` 身份、源码范围、约束和输出 Schema；
- 独立分析，不能读取其他 Child 的输出或私有推理；
- 返回有证据约束的 Candidate Observation 或显式不确定性。

Workspace 默认模板创建两个 Child 槽位，用户可以配置一个或多个。Run 用 `independenceGroup` 记录两个结果是否真正独立；使用同一底层模型族仍可运行，但不能算独立佐证。

[打开交互式 Analysis Batch 工作流](../diagrams/traqen-product-architecture/workspace-analysis-batch.workflow.html) · [Archify 源](../diagrams/traqen-product-architecture/workspace-analysis-batch.workflow.json)

### 6.3 批次扇出与对账

对每个批次：

1. 确定性 Planner 密封共享输入；
2. Scheduler 为每个启用 Child 槽位创建一个 `ChildWorkUnit`；
3. 全部 ChildWorkUnit 独立运行，并允许并发；
4. 证据校验拒绝 Snapshot、Batch 或 SourceSlice Allowset 以外的引用；
5. Main Agent 把所有合法 Child 结果与静态 Facts、历史 Lineage 一起比较；
6. 完全一致只能在校准过的置信上限内增加佐证；
7. 分歧写入 `ConflictLedger`，不能按多数票决定；
8. 证据无效输出隔离为 Candidate 或 Gap；
9. 已对账的批次投影更新 Working Feature/API Tree；
10. Module 与 Project 汇总读取已对账输出及原始证据引用，绝不能只读 Child Summary。

因此，超大工程无需一个整仓 Prompt。Batch 数量动态增长，逻辑 Child 数量由 Workspace 配置。

### 6.4 实时进度

进度必须分别展示不同分母：

- Snapshot 与 Inventory：发现、密封、纳入、排除、不支持、失败；
- 静态扫描：计划与完成的 Extractor WorkUnit；
- Agent 分析：已规划 Batch、已完成 ChildWorkUnit、等待兄弟结果、完成对账；
- 质量：证据合法 Candidate、隔离 Candidate、冲突、Gap；
- 发布：Evaluation 与 GraphRevision 状态。

实时树只能在批次对账后更新。原始模型文本永远不能直接修改可见 Feature/API 节点。

## 7. 能力配置与隔离

### 7.1 两层配置、一个运行快照

全局设置定义可复用模板；Workspace 设置导入并覆盖模板。同名稳定标识由 Workspace 覆盖优先，Workspace 也可以新增或移除条目。

```text
GlobalCapabilityTemplate（只提供配置便利）
                +
WorkspaceCapabilityConfig（权威选择）
                ↓ 确定性解析
WorkspaceExecutionProfileRevision（不可变 Run 输入）
                ↓ 只挂载本 Revision
Main Agent / Child Agents / Worker
```

[打开交互式配置数据流](../diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html) · [Archify 源](../diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.json)

Workspace Revision 包含：

- Main Agent 模型以及规划/对账 Skill/MCP Grant；
- 有序 Child Agent 槽位及各自模型/Skill/MCP Grant；
- 项目依赖项；
- 项目规范与约束；
- 数据边界、预算、并发、重试与校准策略；
- 用于 Provenance 的精确全局模板 Revision。

Runtime 代码不能拿到全局 Registry Handle。某个 Skill 或 MCP 即使已全局安装，只要没有进入 Workspace Revision，在本次运行就不可用。

### 7.2 Secret

模板只能引用凭据 Handle，不能把明文 Secret 复制进 Run。解析器只向精确的 Workspace 和 Agent 槽位授予最小 Secret Handle。Telemetry 与持久化 Prompt 不包含凭据和未脱敏秘密。

## 8. Canonical Graph、审核与历史

权威顺序是：

```text
SourceSnapshot / ArtifactInventory
  → 确定性 Facts
  → Child 结果
  → 已对账 Candidates + Conflict/Coverage/Gap Ledgers
  → 人工 Review 与 Decision
  → 不可变 GraphRevision
  → 评估通过后原子发布 CurrentGraphHead
```

Candidate 可以进入 Working Tree，但不能创建或修改受治理 Feature、Claim、FeatureVersion 或 TestSpec。自动准入是可编辑的审核结果，不是不可修改的真相。

[打开交互式 Graph 生命周期](../diagrams/traqen-product-architecture/graph-governance.lifecycle.html) · [Archify 源](../diagrams/traqen-product-architecture/graph-governance.lifecycle.json)

默认 Feature/API Tree 读取最新 Published Head。单个 Feature 的历史视图必须解析：

- 每个受治理 FeatureVersion 及其 Decision；
- 按 Snapshot 记录的实现映射；
- 需求、设计、数据、配置、测试和结果证据；
- ChangeSet 与 ImpactAssessment；
- Review Event、Conflict、Gap 和 VerificationResult。

## 9. `1682d7d` 实现差距

下表描述仓库实现，而不是设计意图。

| 愿景领域 | 状态 | 已核验实现证据 | 必须调整 |
|---|---|---|---|
| Workspace 根与切换 | 部分具备 | `web/app/traqen-product.tsx` 保存 `workspaceProjectId` 并把 `projectId` 传入多数页面；`local-workspace-store.ts` 在浏览器持久化项目与可见性 | 建立服务端 Workspace 聚合/Context，拒绝跨 Workspace 迟到响应 |
| 新建、隐藏/显示、删除 | 部分具备 | 浏览器 UI 可新建和隐藏本地记录；`contracts/openapi.json` 只有 `POST /v1/projects` 与 `GET /v1/projects/{projectId}` | 分离 View Preference 与可审计删除，增加 List/Lifecycle API |
| 完整工程静态扫描 | 部分具备 | 浏览器扫描只读取指定文本扩展和不超过 768 KiB 的文件；`LegacyUnderstandingRuntime` 另有服务端 Inventory 路径 | 删除竞争的权威扫描路径；图片/二进制也必须有处置 |
| Agent 读取原始源码 | 部分具备 | `LegacyUnderstandingRuntime` 读取 Snapshot `SourceSlice`；旧 `AnalysisAgent` 只消费 Scanner FactGraph | 收敛为一条 Child 读取 Snapshot Slice、Scanner Facts 只用于对账的运行链 |
| 可配置 Main + 1..N Child，默认 2 | 缺失/冲突 | 只有一个全局 Active Model；Web 固定渲染三个空闲 Child 槽；模型 Planner 强制恰好三个 Assignment | 引入按角色的 Workspace Agent 槽位，删除硬编码三个 |
| 同一批任务发送给所有 Child | 缺失 | 未接入的 Planner 把不同 Module 分给三个 Assignment；服务端 `AnalysisAgent` 每个 WorkUnit 只调用一个模型 | 引入 `AnalysisBatch`，为每个已配置槽位创建 ChildWorkUnit |
| Main 规划与多结果对账 | 部分具备 | 有确定性 Reconciliation；客户端 Helper 只把一组 Enrichment 与 Scanner Candidate 对比 | 对同批全部兄弟结果、静态 Facts 和 Lineage 做对账 |
| Skill/MCP 全局模板 + Workspace 隔离 | 缺失 | Skill 与策略在 `src/api/application-bootstrap.js` 全局装载；没有 Workspace MCP 配置 | 物化不可变 Workspace Execution Profile，Runtime 不得访问全局 Registry |
| 实时分析统计/树 | 部分具备 | 浏览器发布 Scanner 派生进度树；服务端 AnalysisRun 只提供 WorkUnit 计数 | 流式发布已对账 Batch 投影和独立覆盖/质量分母 |
| Feature/API 追溯与历史 | 部分具备 | Tree 与 API 已存在；`getFeatureUnderstandingHistory` 已实现但主产品 UI 未使用 | 两棵树与历史统一绑定 Published Workspace Graph Projection |
| 追溯图谱 | 部分具备 | 已有交互图和 Current Head API | 删除 Demo Fallback，所有路径必须可解析证据 |
| 审核队列、批量审核、编辑自动通过 | 缺失/部分具备 | 当前 UI 按 ID 读取一个 Reverse Candidate 并单条提交；无批量队列或自动准入编辑器 | 增加 Workspace Review Queue、批量命令、可编辑自动 Outcome 与乐观并发 |
| 变更影响 | 部分具备 | 有领域/API 与手工 Snapshot 对比 UI，仍带 Demo Fallback | 从 Published Incremental Run 和当前 Workspace 图谱路径驱动 |

因此，当前实现提供的是可复用领域部件，不是本架构的连贯实现。

## 10. 交付顺序

Codex 的唯一活动实施计划是
[`feature-specs/2026-07-31-traqen-product-foundation.md`](../../feature-specs/2026-07-31-traqen-product-foundation.md)。

1. **基础：** F006 配置解析和 F001 Workspace 聚合合同。
2. **分析切换：** 一条服务端 Snapshot/Inventory/Scanner/Agent 路径，实现同批 Child 扇出与对账。
3. **发布投影：** F002 最新/历史 Tree 与 F004 审核队列。
4. **探索：** F003 图谱路径只能读取 Canonical Ledgers。
5. **演进：** F005 增量影响与重新验证。
6. **Dogfood：** 用两个固定 Traqen Snapshot 证明 FULL → INCREMENTAL、审核、历史与影响。

F002～F005 不必等待 F001 所有 Dogfood 活动结束，但必须等各自依赖的 F001 Canonical Contract 稳定后才能开始。它们可以在这些合同上构建投影与工作流，不能为了等待完整发布门禁而另建临时 Store 或权威规则。

后续模块不能再发明另一套项目选择器、模型 Registry、Candidate 权威规则或 Graph Store。

## 11. 非目标

- 自动把模型共识声明为业务真相；
- 把整个仓库发送给一次模型请求；
- 在独立完成前让 Child Agent 读取兄弟输出；
- 在 Runtime 直接使用全局 Skill/MCP；
- 代码变化后重写历史 Feature Version；
- 假装不支持的图片、二进制、生成物或秘密不存在。
