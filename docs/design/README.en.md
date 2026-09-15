> Language: **English reference** · [简体中文（规范文本）](README.md)

---
feature_ids: [F001, F002, F003, F004, F006]
topics: [product-design, source-of-truth, publication]
doc_kind: published-design-index
created: 2026-09-15
status: active
---

# Published Design Baseline

This index states which design is current for each Feature. It is a release map, not a substitute for an interface contract or an implementation plan.

| Feature | Published baseline | Boundary |
|---|---|---|
| F001 | [Workspace & Source Truth entry](../features/F001-legacy-system-understanding.md) and [approved Design B](../../feature-discussions/2026-08-30-F001-workspace-source-truth-design/README.md) | Design B remains at its working-design path until the operator's uncommitted F001 material is separately preserved. It is the detailed authority; this index does not authorize moving or discarding that WIP. |
| F002 | [Deterministic Evidence & API Structure](../features/F002-feature-api-traceability.md) | The v4 panorama remains a discussion draft: its diagram is a content baseline, but its source-access, schema, and acceptance contracts are not final. |
| F003 | [Functional Panorama V2.0](F003-traceability-graph/README.en.md) and [Feature entry](../features/F003-traceability-graph.md) | The eight functional groups and five routing outcomes are published. Access interfaces, field contracts, and quantitative acceptance values remain open. |
| F004 | [Change Impact Analysis](../features/F004-change-impact-analysis.md) | No approved successor exists. |
| F006 | [Workspace Capability Settings](../features/F006-workspace-capability-settings.md) | The Feature document remains the acceptance contract; its discussion record is decision provenance, not a competing spec. |

## Publication rule

Only a Feature document or a design named by this index is current. `feature-discussions/` retains drafts, source artifacts, and decision provenance; a discussion does not become published merely because its diagram is polished. `feature-specs/` retains active implementation plans and is not an archive for valid work.

## Archive rule

Historical documents live in [the archive](../archive/README.en.md). Each archived document declares `superseded_by`; archive material is not part of the active navigation.
