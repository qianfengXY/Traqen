> Language: **English** · [简体中文](ROADMAP.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004, F005, F006, F007]
topics: [roadmap, product-modules, delivery]
doc_kind: roadmap
created: 2026-07-29
updated: 2026-08-28
---

# Traqen Feature Roadmap

Traqen uses a repository-local `Fxxx` sequence for engineering Feature lifecycle tracking.

- IDs are zero-padded, monotonically increasing, and never reused.
- `docs/features/Fxxx-*.md` is the stable aggregation entry for one Feature.
- Active Features appear here; completed Features remain permanently addressable from their aggregation document.
- An `Fxxx` roadmap ID is an engineering-delivery identifier. It is **not** a governed business `Feature.id` in Traqen's traceability ontology.
- Historical documents may retain topic-style `feature_ids` until they are associated with an `Fxxx`; new formal Features use `Fxxx`.
- One product module has one active `docs/features/Fxxx-*.md` aggregation source. Detailed shared architecture belongs under `docs/architecture/`; discussions and implementation plans do not compete with Feature truth.

## Active

| ID | Priority | Feature | Status | Owner | Source | Spec |
|---|---|---|---|---|---|---|
| F001 | P0 | Workspace and legacy-system analysis foundation | spec | CodeX | operator core requirement | [F001](features/F001-legacy-system-understanding.md) |
| F002 | P0 | Feature and API traceability | spec | TBD | operator product plan | [F002](features/F002-feature-api-traceability.md) |
| F003 | P1 | Traceability graph | spec | TBD | operator product plan | [F003](features/F003-traceability-graph.md) |
| F004 | P0 | Claim review | spec | TBD | operator product plan | [F004](features/F004-claim-review.md) |
| F005 | P1 | Change impact | spec | TBD | operator product plan | [F005](features/F005-change-impact.md) |
| F006 | P2 | Workspace capability settings | spec | TBD | operator-authorized [design convergence](../feature-discussions/2026-08-28-F006-workspace-capability-settings-design/README.md) | [F006](features/F006-workspace-capability-settings.md) |
| F007 | P0 | Project relaunch discovery | spec | CodeX | operator-approved history-preserving restart | [F007](features/F007-traqen-project-relaunch.md) |

## Delivery waves

| Wave | Goal | Features | Exit evidence |
|---|---|---|---|
| 0 | Establish one Workspace root and one effective capability profile | F006 + F001 contracts | durable global account/CLI-model settings, global availability plus Workspace-local/disabled capabilities, Main + Child 1..N, active snapshots, restart recovery, and no ungranted runtime capability access |
| 1 | Replace competing scan/Agent paths with one durable analysis runtime | F001 | complete inventory, same-batch Child fan-out, reconciliation, published graph |
| 2 | Make the graph reviewable through current/history trees and a review queue | F002 + F004 | end-to-end evidence journey and batch review |
| 3 | Explore and evolve the graph | F003 + F005 | explainable graph paths and full-to-incremental impact |
| 4 | Prove the system on itself | all | two pinned Traqen Snapshots, independent acceptance, no demo fallback |
| R | Reconfirm the product before further implementation | F007 | evidence-backed current-state audit, confirmed vision/user journey/MVP, and phased plan |
