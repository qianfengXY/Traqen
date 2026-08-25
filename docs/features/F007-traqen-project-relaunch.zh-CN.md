---
feature_ids: [F007]
related_features: [F001, F002, F003, F004, F005, F006]
topics: [project-relaunch, discovery, vision, roadmap, preservation]
doc_kind: spec
created: 2026-08-25
description: "在完整保留历史的前提下，重新确立 Traqen 产品愿景、MVP 与交付基线的发现周期。"
description_source: model
description_author: cat-idwxwjba
description_updated_at: 2026-08-25T07:52:00Z
---

> 语言：**简体中文** · [English](F007-traqen-project-relaunch.md)

# F007：Traqen 项目重新启动与发现

> **Status**: spec | **Owner**: CodeX | **Priority**: P0

## Why

operator 希望把 Traqen 重新作为一个有治理的项目推进，同时完整保留现有 Traqen 历史。因此“重新开始”必须建立一份新的、可审查的产品基线，而不能删除仓库、替换 Mission Hub 项目身份、重写 F001–F006，或把旧假设未经审计直接带入下一轮实现。

## Current State / 现状基线

- 权威 checkout 是 `/Volumes/WorkSSD/projects/Traqen`，仓库为 `qianfengXY/Traqen`。
- 重新启动前基线是 `main@8eae0baf9ff4267dafb76040afcbc6ae335bffcd`；开始保存时它与 GitHub `main` 一致。
- 现有 Mission Hub 项目身份是 `ep-0001786546681891-000000-1450cfc1`，必须复用，不能删除后重新导入。
- F001–F006 及其设计、提交、worktree 与 Review 记录继续作为历史证据。F006 已真实运行 Desktop 开发闭环，并暴露了流程状态与默认分支现实不一致的问题。
- 两个 worktree 原本存在本地独有 refs 和未提交内容；现在由 annotated tag `traqen-pre-relaunch-2026-08-25`、`archive/pre-relaunch-20260825/*` refs、归档提交 `fcba064`/`9be31b8`，以及外部目录中已验证的全 refs bundle 保存。
- 当前路线图描述了目标模块，但尚未证明新的产品愿景、主用户旅程、MVP 边界与现有实现彼此一致。

## What

### Phase A：保存并建立基线

冻结旧阶段终点，保存所有可恢复的本地历史载体，让活动 `main` 回到已知状态，并记录在不公开未审分支的前提下如何恢复 refs 与 WIP。

### Phase B：先审计、后重设计

对产品行为、架构、代码、测试、文档、活动依赖、安全/数据边界和已知流程失败形成证据化现状报告。每个重要区域分类为保留、重构、归档或未决；在 operator 确认新方向前，分类只是一份提案。

### Phase C：重新确认产品方向

把审计与 operator 讨论收敛为新的愿景、主用户旅程、MVP、Non-goals、可测 AC、架构边界和分阶段交付计划。Design Gate 未确认前，不启动新的业务实现。

## User Journey

### Primary Journey：不丢旧项目地重新启动 Traqen

- **Scope unit**: workspace
- **Actor**: operator
- **Entry**: Mission Hub 中现有的 Traqen 项目
- **Flow**:
  1. operator 打开原 Traqen 项目，看到 F007 成为新的活动入口，同时旧 Feature 仍可追溯。
  2. 猫猫审计当前仓库并展示保留/重构/归档证据，而不是立即修改产品代码。
  3. operator 讨论并确认新的愿景、用户旅程、MVP 与 Non-goals。
  4. 猫猫把确认后的方向拆成带可观察 AC 的 Phase，再进入隔离实现、独立 Review 与验收。
- **Success evidence**: 精确保存清单和 Git tag；F007 审计报告；已确认的讨论/设计记录；更新后的 Feature/路线图；带可验证 AC 的分阶段计划。
- **Non-goals**: 删除或复制 Mission Hub 项目、替换仓库、抹去 F001–F006、把归档 WIP 当成已接受真相，或在发现阶段实现业务行为。

## Acceptance Criteria

### Phase A（保存与基线）

- [x] AC-A1: `git bundle --all` 产物验证为完整，并包含重新启动前 tag、全部具名本地分支、archive refs 与两条 WIP 归档提交。
- [x] AC-A2: 原 tracked WIP 可由 binary patch 恢复，原 untracked 文件可由已测试 archive 恢复，两个原脏 worktree 均已干净。
- [x] AC-A3: `traqen-pre-relaunch-2026-08-25^{}` 解析为 `8eae0baf9ff4267dafb76040afcbc6ae335bffcd`；未删除旧 Mission Hub 项目或持久知识库。

### Phase B（现状审计）

- [ ] AC-B1: 审计列出当前可运行的用户旅程，并为基线上的成功/失败行为记录精确命令或截图。
- [ ] AC-B2: 每个重要产品/模块区域都有保留、重构、归档或未决分类，并附代码、文档、提交、测试或运行证据。
- [ ] AC-B3: 审计列出现有产品行为、F001–F006 文档、路线图 claim 和 Review/验收历史之间的矛盾，但不改写历史源。

### Phase C（新方向）

- [ ] AC-C1: operator 确认的新愿景用用户语言说明主要用户、核心问题、主旅程、MVP 与 Non-goals。
- [ ] AC-C2: 已确认的架构和安全/数据边界分配清晰所有权，并禁止生产数据实验、隐藏 fallback 与重复真相源。
- [ ] AC-C3: 在任何业务代码开始前，分阶段实施计划将所有接受的需求映射到可独立复核的 AC、命令和验收证据。

## 需求点 Checklist

| ID | 需求点（operator experience/转述） | AC 编号 | 验证方式 | 状态 |
|----|-----------------------------------|---------|----------|------|
| R1 | “我需要保留现在的 Traqen 历史。” | AC-A1–A3 | bundle verify、patch check、tag/ref/status 清单 | [x] |
| R2 | “重新开始作为项目的方式进行推进。” | AC-B1–B3、AC-C1–C3 | 审计、确认后的讨论、Feature/计划 Review | [ ] |
| R3 | 保留原 Mission Hub 项目身份，而不是删除后重复导入 | AC-A3 | project ID 与仓库绑定证据 | [x] |

### 覆盖检查

- [x] 每个需求点都能映射到至少一个 AC
- [x] 每个 AC 都有验证方式
- [x] 前端需求已准备需求→证据映射表（本 Feature 不实现新前端；真实旅程证据在 Phase B 采集）

## Dependencies

- **Evolved from**: F001–F006（保留其产品与交付历史，不替换）
- **Blocked by**: Phase B 发现无硬阻塞
- **Related**: 现有 Mission Hub external-project 身份与仓库内治理文档

## Risk

| 风险 | 缓解 |
|------|------|
| 把“重新启动”误解为删除历史 | 固定旧基线，并永久保留旧 Feature ID 与项目身份 |
| 把归档 WIP 误当成已接受产品真相 | archive refs 只留本地；迁入提案标为探索输入；复用前重新核证 |
| 发现阶段滑入过早实现 | Phase C Design Gate 必须经 operator 确认后才允许业务实现 |
| 现有文档与 runtime 不一致 | 保留各源、记录矛盾，审计后只选择一个新的权威真相 |

## Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 哪个用户问题和主旅程应定义新的 Traqen MVP？ | ⬜ Phase C operator 决策 |
| OQ-2 | 当前 F001–F006 中哪些能力应进入新的 MVP？ | ⬜ Phase B 证据 → Phase C 决策 |

## Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 复用现有仓库和 Mission Hub 项目身份 | 项目身份承载持久 Backlog、thread、Review 与 work 历史 | 2026-08-25 |
| KD-2 | 用 F007 表达重新启动，不重编号或删除 F001–F006 | Feature ID 与历史证据必须永久可追溯 | 2026-08-25 |
| KD-3 | 未公开 WIP 保留在本地并确保可恢复，不推成已接受历史 | 保存不能把未审工作变成公开项目真相 | 2026-08-25 |

## Timeline

| 日期 | 事件 |
|------|------|
| 2026-08-25 | operator 批准保留历史的项目重新启动与文档归位 |
| 2026-08-25 | Phase A 保存产物与 archive refs 验证完成 |

## Review Gate

- Phase A：独立核对 bundle、patch、tag、refs 与干净 worktree，不依赖实现者叙述。
- Phase B：审计结论进入 Design Gate 前必须有证据化内容 Review。
- Phase C：新用户旅程与产品方向必须经 operator 明确确认，之后实施计划才能授权代码修改。

## Tips Contribution（F244）

`tips_exempt: 项目专属发现/治理 Feature，尚未新增可复用的 Traqen 产品交互。`

## Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **Plan** | `feature-specs/2026-08-25-traqen-history-preservation-and-relaunch.md` | 保存与重新启动实施计划 |
| **Roadmap** | `docs/ROADMAP.zh-CN.md` | 永久产品路线图与历史 Feature 索引 |
| **SOP** | `docs/SOP.md` | 仓库内交付与 Review 流程 |
| **探索性 UX 输入** | `docs/design/mission-hub-dev-loop-ui-redesign-proposal.md` | Traqen 试点语境分析，不是 EXT-001 权威 |
| **保存清单** | `/Volumes/WorkSSD/projects/Traqen-history/2026-08-25-pre-relaunch/README.md` | Git 外的本地恢复真相源 |
