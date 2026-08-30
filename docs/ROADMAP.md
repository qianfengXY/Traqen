> Language: **English** · [简体中文](ROADMAP.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004, F006]
topics: [roadmap, product-modules, delivery]
doc_kind: roadmap
created: 2026-07-29
updated: 2026-08-30
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
| F001 | P0 | Workspace & Source Truth | spec | CodeX | operator-authorized [source-truth convergence](../feature-discussions/2026-08-30-F001-workspace-source-truth/README.md) | [F001](features/F001-legacy-system-understanding.md) |
| F002 | P0 | Deterministic Evidence & API Structure | spec | TBD | operator-confirmed redesign | [F002](features/F002-feature-api-traceability.md) |
| F003 | P1 | Agent Candidates & Reviewed Business Function Tree | spec | TBD | operator-confirmed redesign | [F003](features/F003-traceability-graph.md) |
| F004 | P0 | Test/Execution Evidence, Change Impact & Revalidation | spec | TBD | operator-confirmed redesign | [F004](features/F004-claim-review.md) |
| F006 | P2 | Workspace capability settings | spec | TBD | operator-authorized [design convergence](../feature-discussions/2026-08-28-F006-workspace-capability-settings-design/README.md) | [F006](features/F006-workspace-capability-settings.md) |

## Delivery waves

| Wave | Goal | Features | Exit evidence |
|---|---|---|---|
| 0 | Establish one Workspace root and an effective capability profile | F006 | approved capability configuration, active snapshots, restart recovery, and no ungranted runtime capability access |
| 1 | Make the analyzed source boundary reproducible | F001 | qualifying Source Truth Receipt, immutable snapshot, complete inventory, explicit gaps, and controlled F002 admission |
| 2 | Publish deterministic technical evidence and the API projection | F002 | reproducible facts, evidence links, API structure tree, and visible gaps |
| 3 | Establish reviewed business meaning | F003 | bounded agent candidates, human review decisions, and a traceable business-function tree |
| 4 | Turn understanding into safer next-change guidance | F004 | snapshot-bound execution evidence, advisory impact classifications, and revalidation recommendations |
| 5 | Prove the slice on a controlled repository change | F001–F004 | reference-pilot evidence with no automatic merge, CI, or deployment gate |
