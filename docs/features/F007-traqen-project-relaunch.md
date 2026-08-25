---
feature_ids: [F007]
related_features: [F001, F002, F003, F004, F005, F006]
topics: [project-relaunch, discovery, vision, roadmap, preservation]
doc_kind: spec
created: 2026-08-25
description: "A history-preserving discovery cycle that re-establishes Traqen's product vision, MVP, and delivery baseline."
description_source: model
description_author: cat-idwxwjba
description_updated_at: 2026-08-25T07:52:00Z
---

> Language: **English** · [简体中文](F007-traqen-project-relaunch.zh-CN.md)

# F007: Traqen Project Relaunch Discovery

> **Status**: spec | **Owner**: CodeX | **Priority**: P0

## Why

The operator wants to restart Traqen as a deliberately governed project while preserving the existing Traqen history. Starting over must therefore create a new, reviewable product baseline without deleting the repository, replacing the Mission Hub project identity, rewriting F001–F006, or silently carrying old assumptions into the next implementation cycle.

## Current State / 现状基线

- The canonical checkout is `qianfengXY/Traqen` at `/Volumes/WorkSSD/projects/Traqen`.
- The pre-relaunch baseline is `main@8eae0baf9ff4267dafb76040afcbc6ae335bffcd`, which matched GitHub `main` when preservation started.
- The existing Mission Hub identity is `ep-0001786546681891-000000-1450cfc1`; it must be reused rather than deleted and re-imported.
- F001–F006, their design documents, commits, worktrees, and Review records remain historical evidence. F006 has already exercised the Desktop development loop and exposed a mismatch between process state and default-branch reality.
- Local-only refs and uncommitted work existed in two worktrees. They are preserved by the annotated tag `traqen-pre-relaunch-2026-08-25`, named `archive/pre-relaunch-20260825/*` refs, archive commits `fcba064` and `9be31b8`, and a verified all-ref bundle documented outside the checkout.
- The current roadmap describes intended modules but does not yet prove that the renewed product vision, primary user journey, MVP boundary, and current implementation all agree.

## What

### Phase A: Preserve and establish the baseline

Freeze the old-stage endpoint, preserve every recoverable local history carrier, restore active `main` to a known state, and record how to recover archived refs and WIP without publishing unreviewed branches.

### Phase B: Audit before redesign

Produce an evidence-backed current-state report covering product behavior, architecture, code, tests, documentation, active dependencies, security/data boundaries, and known workflow failures. Classify each material area as keep, refactor, archive, or undecided; classification is a proposal until the operator confirms the renewed direction.

### Phase C: Renew product direction

Turn the audit and operator discussion into a renewed vision, primary user journey, MVP, non-goals, measurable acceptance criteria, architecture boundaries, and phased delivery plan. No new business implementation begins before this Design Gate is confirmed.

## User Journey

### Primary Journey: restart Traqen without losing the old project

- **Scope unit**: workspace
- **Actor**: operator
- **Entry**: the existing Traqen project in Mission Hub
- **Flow**:
  1. The operator opens the existing Traqen project and sees F007 as the new active kickoff while earlier Features remain addressable.
  2. The cats audit the current repository and present keep/refactor/archive evidence instead of immediately modifying product code.
  3. The operator discusses and confirms the renewed vision, user journey, MVP, and non-goals.
  4. The cats turn the confirmed direction into phased work with observable acceptance criteria, isolated implementation, independent Review, and acceptance.
- **Success evidence**: exact preservation manifest and Git tag; F007 audit report; confirmed discussion/design record; updated Feature/roadmap documents; a phased plan with verifiable AC.
- **Non-goals**: deleting or duplicating the Mission Hub project, replacing the repository, erasing F001–F006, treating archived WIP as accepted product truth, or implementing business behavior during discovery.

## Acceptance Criteria

### Phase A（Preservation and baseline）

- [x] AC-A1: A `git bundle --all` artifact verifies as complete and contains the pre-relaunch tag, all named local branches, archival refs, and both WIP archive commits.
- [x] AC-A2: Original tracked WIP is recoverable from binary patches, original untracked files are recoverable from a tested archive, and the two previously dirty worktrees are clean.
- [x] AC-A3: `traqen-pre-relaunch-2026-08-25^{}` resolves to `8eae0baf9ff4267dafb76040afcbc6ae335bffcd`; no old Mission Hub project or persistent knowledge store was deleted.

### Phase B（Current-state audit）

- [ ] AC-B1: An audit names the currently runnable user journeys and records exact commands/screenshots for what succeeds and fails on the pinned baseline.
- [ ] AC-B2: Every material product/module area has a keep/refactor/archive/undecided classification backed by code, document, commit, test, or runtime evidence.
- [ ] AC-B3: The audit identifies contradictions among current product behavior, F001–F006 documents, roadmap claims, and Review/acceptance history without rewriting the historical sources.

### Phase C（Renewed direction）

- [ ] AC-C1: The operator-confirmed vision identifies the primary user, core problem, primary journey, MVP, and non-goals in user language.
- [ ] AC-C2: The confirmed architecture and security/data boundaries assign ownership and prohibit production-data experiments, hidden fallback behavior, and duplicate truth sources.
- [ ] AC-C3: A phased implementation plan maps every accepted requirement to independently verifiable AC, commands, and acceptance evidence before any business-code work starts.

## 需求点 Checklist

| ID | 需求点（operator experience/转述） | AC 编号 | 验证方式 | 状态 |
|----|-----------------------------------|---------|----------|------|
| R1 | “我需要保留现在的 Traqen 历史。” | AC-A1–A3 | bundle verify, patch check, tag/ref/status inventory | [x] |
| R2 | “重新开始作为项目的方式进行推进。” | AC-B1–B3, AC-C1–C3 | audit, confirmed discussion, Feature/plan review | [ ] |
| R3 | 保留原 Mission Hub 项目身份，而不是删除后重复导入 | AC-A3 | project ID and repository binding evidence | [x] |

### 覆盖检查

- [x] 每个需求点都能映射到至少一个 AC
- [x] 每个 AC 都有验证方式
- [x] 前端需求已准备需求→证据映射表（本 Feature 不实现新前端；真实旅程证据在 Phase B 采集）

## Dependencies

- **Evolved from**: F001–F006（retain their product and delivery history; do not replace them）
- **Blocked by**: none for Phase B discovery
- **Related**: existing Mission Hub external-project identity and project-local governance documents

## Risk

| 风险 | 缓解 |
|------|------|
| “Relaunch” is interpreted as deleting history | Pin the old baseline and keep all prior Feature IDs and project identity immutable |
| Archived WIP is mistaken for accepted product truth | Keep archive refs local, label migrated proposals exploratory, and require fresh evidence before reuse |
| Discovery drifts into premature implementation | Phase C Design Gate must be operator-confirmed before business-code work |
| Existing docs and runtime disagree | Preserve sources, record contradictions, and choose one renewed canonical truth only after the audit |

## Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | Which user problem and primary journey should define the renewed Traqen MVP? | ⬜ Phase C operator decision |
| OQ-2 | Which current F001–F006 capabilities remain part of the renewed MVP? | ⬜ Phase B evidence → Phase C decision |

## Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | Reuse the existing repository and Mission Hub project identity | Project identity owns persistent backlog, thread, Review, and work history | 2026-08-25 |
| KD-2 | Represent the restart as F007 rather than renumbering or deleting F001–F006 | Feature IDs and historical evidence are permanent | 2026-08-25 |
| KD-3 | Keep unpublished WIP local and recoverable rather than pushing it as accepted history | Preservation must not turn unreviewed work into public project truth | 2026-08-25 |

## Timeline

| 日期 | 事件 |
|------|------|
| 2026-08-25 | Operator approved history-preserving project relaunch and document relocation |
| 2026-08-25 | Phase A preservation artifacts and archival refs verified |

## Review Gate

- Phase A: verify bundle, patches, tag, refs, and clean worktrees independently from the implementation narrative.
- Phase B: audit conclusions require evidence-backed content Review before the Design Gate.
- Phase C: renewed user journey and product direction require explicit operator confirmation before implementation planning can authorize code changes.

## Tips Contribution（F244）

`tips_exempt: project-specific discovery/governance feature; it adds no reusable Traqen product interaction yet.`

## Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **Plan** | `feature-specs/2026-08-25-traqen-history-preservation-and-relaunch.md` | Preservation and kickoff execution plan |
| **Roadmap** | `docs/ROADMAP.md` | Permanent product roadmap and historical Feature index |
| **SOP** | `docs/SOP.md` | Repository-local delivery and Review workflow |
| **Exploratory UX input** | `docs/design/mission-hub-dev-loop-ui-redesign-proposal.md` | Traqen-context pilot analysis; not EXT-001 authority |
| **Preservation manifest** | `/Volumes/WorkSSD/projects/Traqen-history/2026-08-25-pre-relaunch/README.md` | Local recovery truth; intentionally outside Git |
