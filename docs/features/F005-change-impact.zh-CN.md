> 语言：**简体中文** · [English](F005-change-impact.md)

---
feature_ids: [F005]
related_features: [F001, F002, F003]
topics: [change-impact, incremental-analysis, revalidation, history]
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
