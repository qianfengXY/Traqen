> 语言：**简体中文** · [English](F002-feature-api-traceability.md)

---
feature_ids: [F002]
related_features: [F001, F003, F004, F005]
topics: [feature-tree, api-tree, traceability, history, evidence-gaps, frontend, user-journey]
doc_kind: spec
created: 2026-07-31
---

# F002：功能与 API 追溯

> **Status**: spec | **Owner**: TBD | **Priority**: P0

## Why

只有当人能够选择当前 Feature 或 API，核对其需求、设计、实现、数据、配置、测试与结果是否形成完整证据链时，对存量工程的理解才真正有价值。

## What

F002 负责同一 Canonical Graph 上两种 Workspace 级投影：

- **Feature Tree：** 用户可识别能力与受治理 Feature 身份；
- **API Tree：** Endpoint、Contract、Handler、Caller、数据/配置影响、测试与结果。

两棵树默认读取最新发布的 `CurrentGraphHead`。活跃分析产生的 Working Candidate Tree 必须独立展示，绝不能冒充 Governed Tree。

## 用户旅程

1. 用户切换 Workspace，Feature/API Tree 在该 Workspace Context 下重新加载。
2. 用户选择 Feature 或 API。
3. 详情展示需求、设计、代码范围、数据、配置、测试文件、TestSpec、执行、结果、Decision、冲突与 Gap。
4. 缺失或过期证据按类别和严重级别清晰可见。
5. 用户打开历史，对比受治理 FeatureVersion 及按 Snapshot 记录的实现映射；Tree 默认仍显示最新版本。

## 前端产品体验

### Governed Tree 与详情工作区

F002 使用 Tree/Detail 工作区：

- 左栏在 Feature Tree 与 API Tree 间切换，搜索当前投影，并按证据状态筛选；
- 页头标明当前已发布 `GraphRevision`，并提供显式历史 Revision 选择器；
- 详情栏提供概览、证据、关系、Gap 与历史视图；
- 紧凑五段式 Trace Chain 继承现有视觉语言，但其详情必须展开完整的需求、设计、实现、数据、配置、测试文件、TestSpec、执行、结果、Decision、Conflict 与 Gap 对象，不能压缩其身份。

每项 Evidence 都必须展示状态、不可变 Resolver、Snapshot/Revision 上下文、适用时的源码位置和 Digest 校验。选择关系可以打开 F003 聚焦图；选择可审核的弱证据可以打开对应 F004 队列项，同时保留当前 Workspace 与 Revision 上下文。

### 权威与历史

主 Feature/API Tree 始终读取已发布 Governed Projection。Working Candidate 可以在独立的虚线非权威分区中访问，或链接回 F001，但绝不能成为 Governed Tree 的节点。

选择历史 Revision 后，整棵树、详情、证据与关系视图进入只读历史模式。Feature 历史展示 FeatureVersion Decision、各 Snapshot 实现映射、Impact、Review、TestSpec、Execution、Result 与 Gap；API 历史展示 Contract 和实现变化，但不能发明业务身份。

### 状态与响应式行为

- **无 Published Head：** 解释尚未形成受治理图谱，并链接到当前 F001 Job 或设置动作。
- **部分覆盖：** 每个必需证据类别都渲染为 `MISSING`、`STALE`、`CONFLICTED` 或 `NOT_APPLICABLE`，不能隐藏空类别。
- **Revision 不可用 / Evidence 无效：** 保留选中身份，解释不可变引用失败，并提供有效的当前或历史上下文。
- **Workspace 切换：** 加载新投影前先清除旧 Tree 选择和历史上下文。

### 旧版 GraphArtifact 兼容

GraphArtifact schema v2 将 `featureTraceability` 纳入 artifact digest。此前已发布的 artifact 继续作为不可变 schema v1 记录保留。Traqen 不能使用当前 Feature baseline 重建其缺失的 F002 历史。只有当不可变 artifact 包含请求的准确 Feature，并且能证明所选对象只有一个 Feature Owner 时，旧版 Feature 或对象才可使用；Feature 缺失、对象缺失、无主、歧义或跨 Feature Evidence 一律 Fail Closed，以具体 Reason Code 返回 `UNAVAILABLE_REQUIRES_REANALYSIS`。

只有服务端核验所选 Revision 的已完成来源 Job、原始 SourceRegistration、WorkspaceExecutionProfileRevision、SnapshotManifest、封存源码包与持久化 ArtifactInventory 后，恢复上下文才声明为可执行。`POST /v1/projects/{projectId}/graph/revisions/{graphRevisionId}/reanalysis-jobs` 从来源 Revision 推导这些绑定，客户端不能用当前 Workspace 状态替换。命令创建并发布一个由 `reanalysisOfGraphRevisionId` 关联的新 `HISTORICAL_REANALYSIS` GraphRevision；它既不改写来源 Revision，也不移动 `CurrentGraphHead`。迁移而来的旧记录若缺少任何前提，availability 必须返回独立的不可执行恢复状态且不提供 endpoint。当前 Published Head 仍是独立、显式的 `GET` 上下文。

桌面端使用 Tree/Detail 多栏；移动端改为 Tree 到 Detail 的逐级导航，常驻 Revision/Authority 页头，返回后恢复原 Tree 位置。

### 前端验收标准

- [ ] 用户不输入 Workspace、Snapshot、Revision、Feature 或 API ID 即可打开最新 Governed Feature/API 证据链。
- [ ] Governed、Working Candidate 与 Historical 上下文在视觉和文字上明确区分，客户端筛选不能把它们合并。
- [ ] 五段摘要不能把测试文件、TestSpec、Execution、Result、Decision 或 Evidence 合并成一个对象。
- [ ] 所有必需证据类别显示明确的 Missing、Stale、Conflicted 或 Not Applicable 状态，并解析到不可变上下文。
- [ ] Tree 选择、Revision 切换、证据检查与返回导航在桌面、键盘和移动端布局均可工作。

## 完成态合同

- 每条可见关系都能解析到不可变 Evidence 或 Decision；
- 最新与历史视图使用相同 Identity/Lineage 规则；
- 代码变化可以更新实现映射和影响，但不能自动创建业务 FeatureVersion；
- 测试文件、TestSpec、执行、结果与 Evidence 必须保持不同对象；
- API Tree 不是第二套 Graph Store。

## 验收标准

- [ ] 切换 Workspace 会原子切换两棵树、选中详情、历史与订阅。
- [ ] 默认 Tree 读取最新 Published Head，并单独标记 Working Candidate。
- [ ] 选中 Feature/API 后，所有必需证据类别都有 `MISSING`、`STALE`、`CONFLICTED` 或 `NOT_APPLICABLE` 状态。
- [ ] 每个源码摘录都绑定 Snapshot，并通过内容 Digest 校验。
- [ ] Feature 历史按时间展示 FeatureVersion Decision、实现映射、影响、审核、测试、结果与 Gap。
- [ ] API 历史保留 Contract 与实现变化，但不能发明业务身份。
- [ ] Live Workspace 中不能出现 Demo Fallback。

## 当前差距

实现提交 `1682d7d` 已有 Candidate Feature/API 模式及追溯/历史 API，但主 UI 没有消费 Feature History API，并且仍混合本地 Candidate Projection、Live 与 Demo 路径。

## 依赖

- F001 提供 Workspace、Snapshot、Candidate、对账和 Published Graph 基础。
- F003 展示同一选中对象及路径。
- F004 治理证据不足或自动结果。
- F005 关联变化历史与影响。

## 非目标

- 从 Tree Label 生成业务真相；
- 为简化 UI 隐藏缺失证据；
- 存储独立的 Feature Tree 数据库。
