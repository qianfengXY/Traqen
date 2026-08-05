> 语言：**简体中文** · [English](F003-traceability-graph.md)

---
feature_ids: [F003]
related_features: [F001, F002, F005]
topics: [traceability-graph, graph-path, evidence, visualization, frontend, user-journey]
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

## 前端产品体验

### 聚焦图谱工作区

F003 从当前 F002 Feature/API 选择进入，或通过显式受治理对象搜索进入；默认不能加载整仓图谱。页面包含：

- Root/Context 页头，展示 Workspace、对象身份、Authority Class 与 `GraphRevision`；
- 有界展开预设和 Node/Relation/Status 筛选；
- 聚焦图谱画布，初始只加载一跳或声明过的有界邻域，只能按用户命令继续展开；
- Node/Edge 证据检查器，展示 Identity、Relation Semantics、Authority、Snapshot/Revision 上下文、Conflict/Gap 状态与 Evidence Resolver；
- 始终可用的关系/路径列表，不使用画布也能完成相同检查。

选择 Edge 后必须解释关系为何存在并解析 Evidence，只高亮一条线不算完成。Change Impact 可以作为 F005 Overlay 展示，但不能修改底层 GraphRevision。

### 历史、状态与可访问性

- **无 Root：** 保留当前 Workspace，并提供 Governed Feature/API 搜索或返回 F002 的入口。
- **无路径 / 达到有界上限：** 区分已验证空结果、尚未展开完全和 Gap。
- **部分覆盖：** Candidate、Governed、Conflict、Gap、Stale 与 Missing 除颜色外，还必须使用形状、线型与文字表达。
- **历史比较：** 并排或以明确图层比较 Current 与 Historical Revision，绝不能合成虚假当前图。
- **Workspace 切换：** 加载新 Workspace 同一模块前，丢弃旧 Root、展开状态与迟到图谱响应。
- **v2 之前的 artifact：** F002 追溯不可用状态必须保持明确；F003 的有界 Node、Edge、Path 与 Resolver 只能读取所选旧 GraphArtifact 中实际保存的证据。

键盘和屏幕阅读器用户可以通过关系/路径列表搜索 Root、展开有界关系组、选择路径并检查每一跳。移动端默认使用该列表，画布为可选视图。

### 前端验收标准

- [ ] 从 F002 打开 F003 时保留 Workspace、Governed Identity 与 Revision，不要求手工输入 ID。
- [ ] 初始与后续 Graph 查询均有界，并明确是否仍有可加载数据或覆盖不完整。
- [ ] 每个可见 Node/Edge 都展示 Identity、Authority、Revision/Snapshot 上下文、状态与 Evidence Resolver。
- [ ] Current、Historical、Candidate、Conflict、Gap、Stale 与 Missing 不能因布局或单一颜色而混淆。
- [ ] 关系/路径列表在桌面、键盘、屏幕阅读器与移动端提供等价的路径解释能力。

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
