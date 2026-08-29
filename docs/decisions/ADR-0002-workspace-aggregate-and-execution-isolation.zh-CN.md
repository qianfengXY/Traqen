> 语言：**简体中文** · [English](ADR-0002-workspace-aggregate-and-execution-isolation.md)

---
feature_ids: [F001, F002, F003, F004, F006]
related_features: []
topics: [workspace, aggregate-root, context-switch, capability-isolation, model-registry, capability-overlay, model-retirement]
doc_kind: adr
created: 2026-07-31
updated: 2026-08-29
status: accepted
---

# ADR-0002：Workspace 聚合与执行隔离

## 背景

Traqen 当前同时存在浏览器本地 Workspace 概念和以 `Project.id` 定界的服务端治理对象；不同产品模块还可能保留各自的项目选择与订阅。当前 Runtime Bootstrap 路径可以访问全局模型与 Skill Registry，现有 F006 页面也把模型、Skill 和 MCP 表达为全局模板。

产品要求更强：Workspace 是项目整体空间；切换 Workspace 时，分析、功能/API 追溯、图谱、审核、影响、设置、历史和活动任务投影必须一起变化。operator 需要复用模型连接，但 Skill/MCP 覆盖、禁用状态、Agent Roster 与持久化设置必须属于具体项目。Runtime 必须接收一份可重放的能力快照，不能拿到可变 Registry Handle。

GPT 与 Kimi 的独立设计先认同 Workspace 全局产品边界，随后对新版 F006 合同达成收敛。候选方案包括：

1. Workspace 与 Project 永久 1:1 并存，或由 Workspace 成为 Canonical 聚合身份；
2. 把模型、Skill、MCP 都作为全局模板，或把可复用模型资产与内置/项目能力 Catalog 分开；
3. 执行中动态过滤可变 Registry，或在 Run 前解析并固定不可变 Workspace Profile；
4. 部分或原地替换被引用模型，或原子替换全部当前 Workspace 引用并保留历史 Run。

## 决策

1. **Workspace 是 Canonical 聚合根与租户边界。** 每个 Snapshot、Inventory 记录、Fact、Run、Batch、Candidate、Ledger、Decision、GraphRevision、Review、Impact、配置 Revision 与投影都属于一个 `workspaceId`。
2. **旧 `Project.id` 不再作为第二聚合。** 它迁移成 `Workspace.id`，或在过渡期仅作为同一身份的兼容别名；不能拥有独立生命周期、选择状态、授权状态或 Current Head。
3. **可见性与删除分离。** `WorkspaceViewPreference` 控制每个用户的显示/隐藏；删除是受保留策略约束、可审计的 Workspace 生命周期。
4. **Workspace 切换带版本。** `CurrentWorkspaceContext` 携带 `workspaceId` 和 `contextVersion`。每个模块必须脱离旧订阅、清除旧选择、挂接新 Workspace，并拒绝来自旧 Context 的迟到响应或事件。
5. **F006 使用分离的配置权威，不提供可编辑全局模板层。** 全局模型 Profile 是可复用 API/Allowlist CLI 连接资产；内置 Skill/MCP Catalog 只读且允许为空；每个 Workspace 拥有项目能力 Revision、Typed Disabled Key、Agent Slot、Dependency、Convention 与 Policy。
6. **能力解析先 Typed Overlay，再禁用。** 身份是 `(kind, normalizedName)`。项目条目完整覆盖相同 Typed Key 的内置条目。禁用作用于合并后的条目；禁用覆盖项不能回退内置能力。
7. **激活要求恰好一个 Main 和至少两个已启用且完整的 Child。** 领域模型、API 与 Web Client 共同守住下限，并允许继续增加 Child。
8. **可编辑设置与不可变运行输入分离。** Invalid Draft 仍持久化；激活创建新的 `WorkspaceExecutionProfileRevision`。Main Agent、Child Agent 与 Worker 只接收该 Revision、Scoped Secret Grant 与有界源码/工具 Handle，不能拿到可变全局 Registry Handle。
9. **Run 固定启动时的 Revision。** Active/Paused Run 不热切换设置，Resume 也不选择更新 Revision。operator 可以继续编辑并激活 Workspace，后续 Run 使用更新的 Active Revision。
10. **删除被引用模型时先全 Workspace 替换，再退役。** 服务端计算所有当前 Workspace 引用并固定 Expected Version，通过一个事务应用；任一冲突或校验失败都会回滚整个操作。历史 Revision 与 Active Run 不改写；普通生命周期为 `ACTIVE -> RETIRING -> RETIRED`。
11. **模块不能另建项目选择器或图谱 Store。** F002～F004 消费 F001/F006 建立的 Workspace 作用域 Canonical Contract。

### 修订——2026-08-28 F006 设置合同

以下修订取代上文决策第 5–10 条中与 F006 有关的部分；Workspace 聚合根裁决不变。

1. **全局设置负责账号、白名单 CLI 模型和全局 Skill/MCP 资产。** 认证是通过 Secret 引用的 API Key 或 CLI-owned OAuth 状态。Traqen 不执行 CLI OAuth 登录、不保存 OAuth Token，且 v1 没有直接 API 模型 Runtime。
2. **Workspace 设置负责可用能力选择与 Agent 团队。** Workspace 可禁用继承的 active 全局资产或增加独立本地资产；不可重新启用全局 inactive 资产，也不可替换或字段级 patch 全局 Manifest。
3. **Agent 授权必须显式。** 生效可用性为 `active global − Workspace disabled + Workspace local`，Agent 只能获得其 Grant 交集；新增全局资产不自动授权。
4. **生效要求一个 Main 和一个或多个完整 Child。** `Child 1` 是默认的未完成占位。更严格的分析运行策略可要求更多 Child，但不改变 F006 生效。
5. **自动保存 Draft 与显式 Apply 分离。** Apply 创建不可变 Active Configuration，每个 Run 固定该配置的非敏感 Snapshot。Active/Paused Run 永不热切换。
6. **全局 Skill/MCP 删除必须感知影响。** 服务端计算影响预览后再输入名称确认。既有 Snapshot 保持有效；只有 Active Configuration 实际授权了不可用能力时才阻断新 Run。

## 被否决方案

### 永久 Workspace -> Project 1:1 聚合

否决原因：两套生命周期与授权身份会重新制造 Workspace 需求本来要消除的漂移。1:1 兼容映射只允许用于迁移，不能成为产品架构。

### 可编辑的全局能力与 Role Template

否决原因：新版产品明确不提供模板工作流。模型连接复用、内置 Catalog 默认项、项目覆盖和 Agent 配置具有不同的所有权与生命周期。

### Runtime 回退到全局能力或被覆盖的内置能力

否决原因：调用时过滤可变 Registry 难以重放、审计和安全关闭。禁用项目覆盖项时不能暴露其覆盖的内置能力；缺少能力必须产生 `NO_ELIGIBLE_PRODUCER` 等显式失败。

### 只按名称标识能力或字段级合并 MCP

否决原因：Skill 与 MCP 可以同名；深层合并项目 MCP 与内置 Command、Environment、Permission 或 Credential 会制造不可审核的混合配置。

### 任意 CLI 命令或用户自定义 argv

否决原因：Shell 插值、参数注入、无界输出与不完整的进程清理越过了本机模型执行边界。只有 Allowlist Adapter 可以构造 argv。

### 模型替换时部分选择 Workspace

否决原因：删除可能在仍有当前 Workspace 引用时完成。替换范围必须由服务端计算并原子覆盖全部当前引用。

### 改写历史 Profile 或热切换 Active Run

否决原因：改变运行中的分析会破坏 Provenance 与可重放性。进行中的工作要使用新设置，必须取消并启动新 Run。

### 模块独立选择项目

否决原因：慢请求或不完整切换后，功能页、图谱、审核队列或影响模块可能展示另一个项目的数据。

### 把隐藏当作删除

否决原因：侧栏偏好是可逆用户状态；删除会改变受治理数据的可用性与保留语义。

## 影响

- Workspace 身份兼容迁移期间可以保留 `/v1/projects/{projectId}`，但应用层必须把参数映射到 Canonical Workspace 身份。
- Store 记录与事件必须包含 Workspace Scope，并增加跨 Workspace 唯一性和授权测试。
- Web Client 需要共享的 Context Version 迟到响应保护。
- 现有全局模型 Store 演进为带 Revision 的可复用 Registry，并删除 Active/Default Pointer；F006 不把旧模型 Profile 迁移作为产品行为。
- Workspace 项目能力、Disabled Key、Draft Head、Active Profile 与历史记录需要正式持久化和乐观并发控制。
- Runtime Bootstrap 收窄为只挂载固定执行 Revision 和 Scoped Grant。
- 普通模型退役可以在当前配置替换完成后继续等待固定旧 Revision 的 Active Run；紧急撤销凭据是单独且明确的破坏性操作。
- F006 是 F001 Capability Routing 的 P0 基础依赖，不是最后才做的设置阶段。

## 验证

- 新建、显示/隐藏、切换和可审计 Workspace 删除测试；
- 所有模块的迟到响应与旧事件切换测试；
- 稳定 Workspace 身份且不存在重复聚合；
- API 与 Allowlist CLI 模型验证、持久化、Cancel、注入和进程清理测试；
- Typed Skill/MCP 共存、项目覆盖、禁用、不回退和来源感知数量测试；
- 少于两个启用 Child 的领域/API/Web 负向测试；
- Invalid Draft 持久恢复与不可变激活/重启重放测试；
- 已禁用、未授权或未物化能力在 Runtime 不可用的负向测试；
- 全 Workspace 模型替换、CAS 冲突、完整回滚、零当前引用、退役和 Active Run 固定测试；
- 覆盖 Form、配置、API Response、Diff、Prompt、Profile、Telemetry、Diagnostic 与 Log 的 Secret 泄漏测试。
