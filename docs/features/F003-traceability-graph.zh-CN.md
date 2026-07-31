> 语言：**简体中文** · [English](F003-traceability-graph.md)

---
feature_ids: [F003]
related_features: [F001, F002, F005]
topics: [traceability-graph, graph-path, evidence, visualization]
doc_kind: spec
created: 2026-07-31
---

# F003：追溯图谱

> **Status**: spec | **Owner**: TBD | **Priority**: P1

## Why

列表可以暴露字段缺失；图谱则能展示需求、设计、实现、数据、配置、测试与结果如何相互支持或矛盾。

## What

F003 从 Canonical Graph Artifact 渲染 Workspace 级可查询投影。用户从 Feature/API Tree 进入，以选中对象为根，展开类型化关系，并打开每条边背后的证据。

## 用户旅程

1. 在当前 Workspace 选择 Feature 或 API。
2. 打开以该对象为根的聚焦图谱。
3. 展开需求、设计、代码、数据、配置、测试、结果、Decision、Conflict 与 Gap。
4. 选择任意路径，查看每一跳的语义和证据。
5. 切换到历史 GraphRevision，但不修改 Current Head。

## 验收标准

- [ ] 图谱跟随 `CurrentWorkspaceContext` 切换；丢弃旧 Workspace 的迟到响应。
- [ ] 每个 Node/Edge 都携带 Identity、Authority Class、Snapshot/Revision Context 和 Evidence Resolver。
- [ ] Candidate、Governed、Conflict、Gap、Stale 与 Missing 状态视觉上明确区分。
- [ ] 一个 GraphRevision 内的路径查询有界、确定性，并能解释每一跳为何存在。
- [ ] 图谱可比较最新与历史 Revision，但不能把它们合成虚假的当前状态。
- [ ] Live 模式不能出现硬编码/Demo Graph Fallback。

## 当前差距

实现提交 `1682d7d` 已有交互图谱 API/UI，但 Live Surface 仍包含 Preset/Demo Fallback，且尚未让每条关系都可以解析到证据。

## 依赖

F001 负责图谱生产与发布；F002 提供选中 Feature/API Context；F005 提供变更影响 Overlay。

## 非目标

- 把图谱布局当作证据；
- 让客户端生成的 Edge 进入 Canonical Graph；
- 在有界邻域足以回答问题时加载整仓图谱。
