> 语言：**简体中文** · [English](F005-change-impact.md)

---
feature_ids: [F005]
related_features: [F001, F002, F003]
topics: [change-impact, incremental-analysis, revalidation, history, frontend, user-journey]
doc_kind: spec
created: 2026-07-31
---

# F005：变更影响

> **Status**: spec | **Owner**: TBD | **Priority**: P1

## Why

当新 Snapshot 能解释哪些 Feature、API、Claim、数据、配置、测试和外部依赖可能受影响，以及哪些内容必须重新审核时，可审核图谱的价值才会持续复利。

## What

F005 消费一次已发布的增量迁移并生成：

- 不可变 Snapshot/GraphRevision 之间的 `ChangeSet`；
- 有证据的影响路径；
- 已失效 Mapping 与过期 Verification；
- 受影响的 Feature、API、Claim、TestSpec、数据、配置与依赖集合；
- 重新审核和重新执行计划。

## 用户旅程

1. Workspace 完成一次增量分析。
2. 变更影响模块自动打开对应 ChangeSet。
3. 用户筛选直接、传递、不确定和策略强制影响。
4. 选择影响后展示每一跳的图谱路径与证据。
5. 用户启动必需 Review/Revalidation，并追踪关闭状态。
6. 发布更新 Head 后，Feature 历史仍保留该影响记录。

## 前端产品体验

### Published ChangeSet 工作区

一次增量分析发布后，F005 默认打开该 Workspace 最新的 ChangeSet。历史 Revision Pair 选择器是次级入口，用户不能靠手填 Snapshot 或 ChangeSet ID 进入。页面包含：

- `fromGraphRevision → toGraphRevision` 页头，展示 ChangeSet 身份与 Action 关闭摘要；
- Direct、Transitive、Uncertain、Policy-mandated Impact 筛选，以及 Feature/API/Claim/TestSpec/Data/Configuration/Dependency 类型筛选；
- 按风险与未解决必需 Action 排序的 Impact 列表；
- Path/Evidence 检查器，解释每一跳、失效 Mapping 和过期 Verification；
- 持久 Review/Revalidation Action，展示来源 Impact Path、状态、支持时的 Owner 与关闭历史。

选择受影响对象可以打开其 F002 Governed History 或 F003 Impact Path，但不能改变 Revision Pair。关闭 Action 绝不能删除 Impact；该记录继续保留在 Feature/API 历史中。

### 状态与响应式行为

- **无已发布增量 ChangeSet：** 解释 Workspace 是没有 Head、只有 FULL Baseline，还是存在未发布/失败的增量 Job，并链接到有效 F001 动作。
- **Unknown 或断裂路径：** 展示 `UNCERTAIN`/Gap 与缺失覆盖，绝不能翻译成 No Impact。
- **Action Open / Partially Closed / Closed：** 展示分母与每个持久 Action 状态，不能用一个聚合置信分代替。
- **Historical Pair：** 使用只读横幅，并保留直接返回最新 ChangeSet 的入口。
- **Workspace 切换：** 加载新 Workspace 最新 Published ChangeSet 前，丢弃旧 Revision Pair、筛选、选择和迟到响应。

桌面端使用 Impact List/Path Detail 多栏；移动端依次展示 Impact 摘要、选中路径与必需 Action，同时保留 Revision Pair 与 Uncertainty 标签。

### 前端验收标准

- [ ] 最新 Published Incremental Result 不需要手工输入 Snapshot、GraphRevision 或 ChangeSet ID 即可打开。
- [ ] Direct、Transitive、Uncertain 与 Policy-mandated Impact 可以分别筛选和解释。
- [ ] 每条 Impact Path 解析每一跳，并区分覆盖不完整与已验证 No Impact。
- [ ] Review/Revalidation Action 持久化、链接回来源 Path，并保留 Open、Partial 与 Closed 历史。
- [ ] Current/Historical Pair、Workspace 切换、键盘导航与移动端详情都保持正确 Revision 上下文。

## 验收标准

- [ ] 每个 Impact 只能属于一个 Workspace 和一对 From/To Revision。
- [ ] 直接与传递影响可以区分并解释。
- [ ] 未知或断裂路径产生 Uncertainty/Gap，不能伪造 No Impact。
- [ ] 未受影响的 Governed Decision 保持不变。
- [ ] 必需 Review/Test Action 被持久化，并可追溯到原始 Impact Path。
- [ ] 模块无需手工输入 Snapshot/ChangeSet ID 即可打开 Published Incremental Result。
- [ ] 对评估范围而言，Full/Incremental 等价是发布门禁。

## 当前差距

实现提交 `1682d7d` 已有 ChangeSet/Impact/Continuous Protection 领域与手工比较 UI，但 Live 使用仍依赖手填 ID 和 Demo Fallback。

## 依赖

F001 产生增量 GraphRevision；F002 展示受影响 Feature/API 历史；F003 展示影响路径。

## 非目标

- 在 Graph Coverage 不完整时声称 Impact 完整；
- 自动改变 Governed Feature Identity；
- 把 Test Selection 当作测试通过证据。
