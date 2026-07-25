> 语言：**简体中文** · [English](interactive-feature-graph-validation-2026-07-15.md)

# 交互式 Feature 图验证 — 2026-07-15

## 产品成果

Traqen 现在公开了设计双主视图的探索性一半。有序的证明链仍然是“为什么这个 Feature 在此部署上受信任？”的默认答案，而图表允许用户探索分支、检查来源、暴露冲突和差距，并锁定最短路径，而无需将产品变成无限制的代码拓扑浏览器。

两个视图都是 `getFeatureTraceability` 的投影。不存在仅图形 Feature、Claim、Fact、TestSpec、执行、Evidence、冲突或 TraceGap 记录。

## 服务器合约

- `GET /v1/projects/{projectId}/features/{featureId}/graph` 需要一个不可变的 `snapshotManifestId` 并接受预设视图、深度、节点限制、重复节点类型过滤器和重复关系过滤器。
- 深度限制为 8，可见节点限制为 100，默认响应限制为 30 个节点。响应报告截断和可用扩展的 count/type。
- `POST /v1/projects/{projectId}/features/{featureId}/graph/paths/query` 执行有界正向、反向或无向最短路径查找，最大深度为 12。
- 每条边都保留方向、类型关系、出处、active/stale 状态和 Snapshot 清单绑定。
- 测试断言是一流的 `TEST_ASSERTION` 节点。冲突和缺失链接是一流的 `CONFLICT` 和 `TRACE_GAP` 节点，而不是缺失或隐藏的数据。

JSON Schema 和 OpenAPI 文档定义投影、节点、边、扩展、查询和路径结果边界。

## 产品界面

Feature 工作区包括一个使用 Cytoscape.js 实现的专用 **回顾图谱** 表面。它提供：

- 产品可追溯性、受控业务流程、实施依赖性和测试覆盖率预设；
- 显式深度、节点类型和关系过滤器；
- 平移、缩放、节点选择、provenance/version/source 详细信息、特定于状态的形状和边框以及用于辅助访问的文本关系列表；
- 任意两个可见节点之间服务器支持的最短路径锁定，包括从 Evidence 到业务规则的反向探索；
- 可见的结果范围和可能的下一步扩展；
- 不执行写入的 complete/stale 演示模式，以及使用与工作区其余部分相同的内存中凭证边界的实时 API 模式。

## 可执行的证明

领域、应用程序、HTTP、合同、渲染产品、PostgreSQL 集成和内置试点测试涵盖了这个部分。除非完整的当前 Snapshot 图包含一流断言、Feature 到 Evidence 路径、三个授权的 BusinessState 节点和两个 StateTransition 节点，否则内置订单试点现在会失败。这证明技术证明和业务流程均由相同的持久 Feature 源支持。

## 刻意的边界

当前图形以 Feature 为中心且有界。其受控 Actor、BusinessState、StateTransition、DesignElement 和 Snapshot Fact 链接现在支持单 Feature 业务流程视图。跨Feature进程遍历和以ChangeSet为中心的影响图仍然是单独的预测；两者都不能从标签中推断出来，也不能仅仅为了可视化而发明。
