> 语言：**简体中文** · [English](ROADMAP.md)

---
feature_ids: [F001, F002, F003, F004, F006]
topics: [roadmap, product-modules, delivery]
doc_kind: roadmap
created: 2026-07-29
updated: 2026-08-29
---

# Traqen Feature 路线图

Traqen 使用仓库内独立的 `Fxxx` 序列跟踪工程 Feature 生命周期。

- ID 使用三位补零、单调递增且永不复用。
- `docs/features/Fxxx-*.md` 是一个 Feature 的稳定聚合入口。
- 活跃 Feature 出现在本路线图；完成后的 Feature 聚合文档永久保留并可追溯。
- `Fxxx` 路线图编号是工程交付标识，**不是** Traqen 追溯本体中受治理的业务 `Feature.id`。
- 历史文档在归入某个 `Fxxx` 前可以保留主题式 `feature_ids`；新正式 Feature 使用 `Fxxx`。
- 一个产品模块只能有一份活跃的 `docs/features/Fxxx-*.md` 聚合真相源。共享详细架构放在 `docs/architecture/`；讨论与实施计划不得和 Feature 真相竞争。

## 活跃 Feature

| ID | 优先级 | Feature | 状态 | Owner | 来源 | Spec |
|---|---|---|---|---|---|---|
| F001 | P0 | 工作空间与源码真相 | spec | CodeX | operator 已确认的重构 | [F001](features/F001-legacy-system-understanding.zh-CN.md) |
| F002 | P0 | 确定性证据与 API 结构 | spec | TBD | operator 已确认的重构 | [F002](features/F002-feature-api-traceability.zh-CN.md) |
| F003 | P1 | Agent 候选与审阅后的业务功能树 | spec | TBD | operator 已确认的重构 | [F003](features/F003-traceability-graph.zh-CN.md) |
| F004 | P0 | 测试/执行证据、变更影响与重验证 | spec | TBD | operator 已确认的重构 | [F004](features/F004-claim-review.zh-CN.md) |
| F006 | P2 | Workspace 能力设置 | spec | TBD | operator 已授权的[设计收敛](../feature-discussions/2026-08-28-F006-workspace-capability-settings-design/README.zh-CN.md) | [F006](features/F006-workspace-capability-settings.zh-CN.md) |

## 交付波次

| 波次 | 目标 | Feature | 退出证据 |
|---|---|---|---|
| 0 | 建立一个 Workspace 根和一份生效能力 Profile | F006 | 获批准的能力配置、生效快照、重启恢复，以及 Runtime 无法访问未授权能力 |
| 1 | 让被分析的源码边界可复现 | F001 | 不可变源码快照、完整产物清单和明确覆盖处置状态 |
| 2 | 发布确定性技术证据和 API 投影 | F002 | 可复现事实、证据链接、API 结构树和可见缺口 |
| 3 | 建立已审阅的业务含义 | F003 | 有边界的 Agent 候选、人工审阅决策和可追溯业务功能树 |
| 4 | 将理解转为更安全的下一次变更指引 | F004 | 快照绑定的执行证据、建议性影响分类和重验证建议 |
| 5 | 在受控仓库变更上验证切片 | F001–F004 | 参考试点证据，且不设自动合并、CI 或部署卡点 |
