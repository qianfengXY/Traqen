> 语言：**简体中文** · [English](ADR-0002-workspace-aggregate-and-execution-isolation.md)

---
feature_ids: [F001, F002, F003, F004, F005, F006]
related_features: []
topics: [workspace, aggregate-root, context-switch, capability-isolation, migration]
doc_kind: adr
created: 2026-07-31
status: accepted
---

# ADR-0002：Workspace 聚合与执行隔离

## 背景

Traqen 当前同时存在浏览器本地 Workspace 概念和以 `Project.id` 定界的服务端治理对象；不同产品模块还可能保留各自的项目选择与订阅。当前 Runtime Bootstrap 路径也可以访问全局模型与 Skill Registry。

产品要求更强：Workspace 是项目整体空间；切换 Workspace 时，分析、功能/API 追溯、图谱、审核、影响、设置、历史和活动任务投影必须一起变化。运行时 Skill 与 MCP 必须严格限制在选中 Workspace 的配置内。

GPT 与 Kimi 的独立设计均认同 Workspace 全局产品边界，但暴露了两种身份方案：

1. Workspace 与 Project 永久作为两个对象，以 1:1 关系连接；
2. Workspace 成为 Canonical 聚合身份，把旧 Project 身份迁入其中。

同时也暴露了两种能力方案：

1. Runtime 直接读取全局 Registry，再动态按 Workspace 过滤；
2. 执行前解析模板与 Workspace 覆盖，Runtime 只接收不可变 Workspace 修订。

## 决策

1. **Workspace 是 Canonical 聚合根与租户边界。** 每个 Snapshot、Inventory 记录、Fact、Run、Batch、Candidate、Ledger、Decision、GraphRevision、Review、Impact、配置修订与投影都属于一个 `workspaceId`。
2. **旧 `Project.id` 不再作为第二聚合。** 它迁移成 `Workspace.id`，或在过渡期仅作为同一身份的兼容别名；不能拥有独立生命周期、选择状态、授权状态或 Current Head。
3. **可见性与删除分离。** `WorkspaceViewPreference` 控制每个用户的显示/隐藏；删除是受保留策略约束、可审计的 Workspace 生命周期。
4. **Workspace 切换带版本。** `CurrentWorkspaceContext` 携带 `workspaceId` 和 `contextVersion`。每个模块必须脱离旧订阅、清除旧选择、挂接新 Workspace，并拒绝来自旧 Context 的迟到响应或事件。
5. **全局能力是模板，不是运行权威。** 确定性 Resolver 把模板修订与 Workspace 覆盖、新增、移除、依赖、约定、策略和 Slot 配置合并。
6. **执行固定到不可变 Workspace Profile。** 主 Agent、子 Agent 与 Worker 只接收 `WorkspaceExecutionProfileRevision`、作用域 Secret Grant 及有界源码/工具 Handle，不能拿到全局模型/Skill/MCP Registry Handle。
7. **模块不能另建项目选择器或图谱 Store。** F002～F005 消费 F001/F006 建立的 Workspace 作用域 Canonical Contract。

## 被否决方案

### 永久 Workspace → Project 1:1 聚合

否决原因：两套生命周期与授权身份会重新制造 Workspace 需求本来要消除的漂移。1:1 兼容映射只允许用于迁移，不能成为产品架构。

### Runtime 回退到全局 Skill 或 MCP

否决原因：调用时过滤可变全局 Registry 难以重放、审计和安全关闭。Workspace 缺少能力时必须形成 `NO_ELIGIBLE_PRODUCER` 等显式路由失败。

### 模块独立选择项目

否决原因：慢请求或不完整切换后，功能页、图谱、审核队列或影响模块可能展示另一个项目的数据。

### 把隐藏当作删除

否决原因：侧栏偏好是可逆用户状态；删除会改变受治理数据的可用性与保留语义。

## 影响

- 兼容迁移期可保留 `/v1/projects/{projectId}`，但应用层必须把该参数解析为 Canonical Workspace 身份。
- Store 记录与事件必须包含 Workspace Scope，并增加跨 Workspace 唯一性和授权测试。
- Web Client 需要共享的 Context Version 迟到响应保护。
- 现有全局模型 Profile 需要迁移为模板修订与 Workspace 选择。
- Runtime Bootstrap 收窄为只挂载固定执行修订和作用域 Grant。
- F006 是 F001 Capability Routing 的 P0 基础依赖，不是最后才做的设置阶段。

## 验证

- 新建、显示/隐藏、切换和可审计删除测试；
- 所有模块的迟到响应与旧事件切换测试；
- 稳定身份且无重复聚合的迁移测试；
- 未物化的全局 Skill/MCP 在 Runtime 不可用的负向测试；
- 重启后仍解析到同一能力修订的重放测试。
