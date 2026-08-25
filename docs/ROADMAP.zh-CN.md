> 语言：**简体中文** · [English](ROADMAP.md)

---
feature_ids: [F001, F002, F003, F004, F005, F006, F007]
topics: [roadmap, product-modules, delivery]
doc_kind: roadmap
created: 2026-07-29
updated: 2026-08-25
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
| F001 | P0 | Workspace 与存量系统分析基础 | spec | CodeX | operator 核心需求 | [F001](features/F001-legacy-system-understanding.zh-CN.md) |
| F002 | P0 | 功能与 API 追溯 | spec | TBD | operator 产品规划 | [F002](features/F002-feature-api-traceability.zh-CN.md) |
| F003 | P1 | 追溯图谱 | spec | TBD | operator 产品规划 | [F003](features/F003-traceability-graph.zh-CN.md) |
| F004 | P0 | 声明审核 | spec | TBD | operator 产品规划 | [F004](features/F004-claim-review.zh-CN.md) |
| F005 | P1 | 变更影响 | spec | TBD | operator 产品规划 | [F005](features/F005-change-impact.zh-CN.md) |
| F006 | P0 | Workspace 能力设置 | spec | TBD | operator 已确认的[讨论记录](../feature-discussions/2026-08-11-F006-workspace-capability-settings/README.md) | [F006](features/F006-workspace-capability-settings.zh-CN.md) |
| F007 | P0 | 项目重新启动与发现 | spec | CodeX | operator 批准的保留历史式重启 | [F007](features/F007-traqen-project-relaunch.zh-CN.md) |

## 交付波次

| 波次 | 目标 | Feature | 退出证据 |
|---|---|---|---|
| 0 | 建立一个 Workspace 根与一个生效能力 Profile | F006 + F001 合同 | 持久 API/CLI 模型设置、Typed 项目覆盖/禁用、Main + Child 2..N、重启恢复，以及 Runtime 无法访问未授权能力 |
| 1 | 用一条持久分析运行时替换相互竞争的 Scanner/Agent 路径 | F001 | 完整 Inventory、同批 Child 扇出、对账、Published Graph |
| 2 | 通过最新/历史 Tree 和审核队列让图谱可审核 | F002 + F004 | 端到端证据旅程与批量审核 |
| 3 | 探索并演进图谱 | F003 + F005 | 可解释 Graph Path 与 Full-to-Incremental Impact |
| 4 | 用 Traqen 自身证明系统 | 全部 | 两个固定 Traqen Snapshot、独立验收、无 Demo Fallback |
| R | 继续实现前重新确认产品方向 | F007 | 证据化现状审计、已确认的愿景/用户旅程/MVP，以及分阶段计划 |
