> Language: **English reference** · [简体中文（规范文本）](README.md)

---
feature_ids: [F001, F002, F003, F004, F005, F006]
topics: [product-design, source-of-truth, publication]
doc_kind: published-design-index
created: 2026-09-15
status: active
---

# Published Design Baseline

This index states which design is current for each Feature. It is a release map, not a substitute for an interface contract or an implementation plan.

| Feature | Published baseline | Boundary |
|---|---|---|
| F001 | [Canonical Chinese functional and UX design](F001-workspace-source-truth/README.md) | Approved Design B relocated without semantic changes. Pending PR #44 remains a separate publication, not implicitly approved by this move. |
| F002 | [Deterministic Facts: Functional Design V1.0 (normative Chinese)](F002-deterministic-facts/README.md) and [Feature entry](../features/F002-feature-api-traceability.md) | Six groups / 24 functions, five deliverables, and the bidirectional evidence loop are final, using style-edition v4. Access interfaces, schemas, initial capabilities, storage, and quantitative acceptance values remain open; implementation is not declared complete. |
| F003 | [Functional Panorama V2.0](F003-traceability-graph/README.en.md) | The eight functional groups and five routing outcomes are published. Access interfaces, field contracts, and quantitative acceptance values remain open. |
| F004 | [Change Impact Analysis](../features/F004-change-impact-analysis.md) | No approved successor exists. |
| F005 | [Layout and Navigation Design V1.0 (normative Chinese)](F005-layout-navigation/README.md) | Six destinations, one desktop canvas with uniform scaling, Porcelain/Graphite themes, components and acceptance. Supersedes the V2.1 proposal's separate-size rules; publication does not declare full implementation or Feature completion. |
| F006 | [Workspace Capability Settings](../features/F006-workspace-capability-settings.md) | The Feature document remains the acceptance contract; its discussion record is decision provenance, not a competing spec. |

## Publication rule

Only a Feature document or a design named by this index is current. `feature-discussions/` retains drafts, source artifacts, and decision provenance; a discussion does not become published merely because its diagram is polished. `feature-specs/` retains active implementation plans and is not an archive for valid work.

## Archive rule

Historical documents live in [the archive](../archive/README.en.md). Each archived document declares `superseded_by`; archive material is not part of the active navigation.
