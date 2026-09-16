> Language: **English reference** · [简体中文（规范文本）](README.md)

# Documentation

This directory is organized as a feature lifecycle, not as a chronological pile of design drafts. Simplified Chinese is Traqen's normative documentation language; this English file is an optional reference.

## Active truth map

- [Feature roadmap](ROADMAP.md) · [简体中文](ROADMAP.zh-CN.md)
- [Product architecture](architecture/traqen-product-architecture.md) · [简体中文](architecture/traqen-product-architecture.zh-CN.md)
- [System requirements: legacy-system understanding and canonical quality traceability](architecture/traqen-system-requirements.md) · [简体中文](architecture/traqen-system-requirements.zh-CN.md)
- [Published design baseline](design/README.en.md) · [简体中文（规范文本）](design/README.md)
- [ADR-0001: canonical traceability ontology](decisions/ADR-0001-canonical-traceability-ontology.md) · [简体中文](decisions/ADR-0001-canonical-traceability-ontology.zh-CN.md)
- [ADR-0002: Workspace aggregate and execution isolation](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md) · [简体中文](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.zh-CN.md)
- [Branch Review Publication Policy](policies/branch-review-publication-policy.md) · [简体中文](policies/branch-review-publication-policy.zh-CN.md)
- [Project overview and operating guide](../README.md) · [简体中文](../README.zh-CN.md)

## Feature truth

| ID | Active Feature document | Supporting design |
|---|---|---|
| F001 | [Workspace & Source Truth](features/F001-legacy-system-understanding.md) · [中文](features/F001-legacy-system-understanding.zh-CN.md) | [approved Design B](../feature-discussions/2026-08-30-F001-workspace-source-truth-design/README.md) |
| F002 | [Current design entry and historical spec](features/F002-feature-api-traceability.md) · [中文](features/F002-feature-api-traceability.zh-CN.md) | [Deterministic Facts: Functional Design V1.0 (normative Chinese)](design/F002-deterministic-facts/README.md) |
| F003 | [Current design entry and historical spec](features/F003-traceability-graph.md) · [中文](features/F003-traceability-graph.zh-CN.md) | [Functional Panorama V2.0](design/F003-traceability-graph/README.en.md) · [中文（规范文本）](design/F003-traceability-graph/README.md) |
| F004 | [Change Impact Analysis](features/F004-change-impact-analysis.md) · [中文](features/F004-change-impact-analysis.zh-CN.md) | product architecture |
| F006 | [Workspace Capability Settings](features/F006-workspace-capability-settings.md) · [中文](features/F006-workspace-capability-settings.zh-CN.md) | [capability-resolution diagram](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html) |

F001–F004 are the active legacy-system-understanding design baseline. F006 retains its separate implementation track. Historical working artifacts may remain unlinked for compatibility or audit, but cannot compete with this table, the roadmap, or the active architecture documents.

## Visual design

- [Workspace capability resolution — Archify](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html)

The F001–F004 redesign does not treat older visual explorations as active specifications; implementation will add visual projections only after the reference-pilot contracts are proven.

## Baseline policy

The roadmap, active `Fxxx` documents, product architecture, ADRs, and the published-design index form one design baseline. Superseded material is moved to [archive](archive/README.en.md), declares its replacement, and is excluded from this navigation; Git history remains the recovery record.

## Documentation language

Simplified Chinese is the default and normative documentation language.

- New or changed normative documents use ordinary `.md` filenames and are written directly in Chinese; no English counterpart, language switch, or synchronized translation is required.
- Existing English files may remain as historical or reader-oriented references, but do not compete with the normative source or create a maintenance obligation.
- Code, commands, API paths, identifiers, enum values, configuration keys, and product model names remain unchanged unless the document explicitly introduces a Chinese display label.
