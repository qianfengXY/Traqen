> Language: **English** · [简体中文](README.zh-CN.md)

# Documentation

This directory is organized as a feature lifecycle, not as a chronological pile of design drafts. Traqen maintains the active product and engineering truth in English and Simplified Chinese.

## Active truth map

- [Feature roadmap](ROADMAP.md) · [简体中文](ROADMAP.zh-CN.md)
- [Product architecture](architecture/traqen-product-architecture.md) · [简体中文](architecture/traqen-product-architecture.zh-CN.md)
- [System requirements: legacy-system understanding and canonical quality traceability](architecture/traqen-system-requirements.md) · [简体中文](architecture/traqen-system-requirements.zh-CN.md)
- [ADR-0001: canonical traceability ontology](decisions/ADR-0001-canonical-traceability-ontology.md) · [简体中文](decisions/ADR-0001-canonical-traceability-ontology.zh-CN.md)
- [ADR-0002: Workspace aggregate and execution isolation](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md) · [简体中文](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.zh-CN.md)
- [Project overview and operating guide](../README.md) · [简体中文](../README.zh-CN.md)

## Feature truth

| ID | Active Feature document | Supporting design |
|---|---|---|
| F001 | [Workspace and Analysis Foundation](features/F001-legacy-system-understanding.md) · [中文](features/F001-legacy-system-understanding.zh-CN.md) | [Workspace scan and Analysis Agent lifecycle](features/workspace-scan-and-analysis-lifecycle.md) · [中文](features/workspace-scan-and-analysis-lifecycle.zh-CN.md) |
| F002 | [Feature and API Traceability](features/F002-feature-api-traceability.md) · [中文](features/F002-feature-api-traceability.zh-CN.md) | product architecture |
| F003 | [Traceability Graph](features/F003-traceability-graph.md) · [中文](features/F003-traceability-graph.zh-CN.md) | product architecture |
| F004 | [Claim Review](features/F004-claim-review.md) · [中文](features/F004-claim-review.zh-CN.md) | product architecture |
| F005 | [Change Impact](features/F005-change-impact.md) · [中文](features/F005-change-impact.zh-CN.md) | product architecture |
| F006 | [Workspace Capability Settings](features/F006-workspace-capability-settings.md) · [中文](features/F006-workspace-capability-settings.zh-CN.md) | [capability-resolution diagram](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html) |

The current implementation plan is [`feature-specs/2026-07-31-traqen-product-foundation.md`](../feature-specs/2026-07-31-traqen-product-foundation.md). Superseded plan files are removed from the working tree; Git history remains the recovery record.

## Visual design

- [Overall functional architecture — editable Excalidraw](diagrams/traqen-product-architecture/traqen-product-functional-architecture.excalidraw) · [SVG](diagrams/traqen-product-architecture/traqen-product-functional-architecture.svg)
- [Workspace same-batch analysis workflow — Archify](diagrams/traqen-product-architecture/workspace-analysis-batch.workflow.html)
- [Workspace capability resolution — Archify](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html)
- [Graph governance lifecycle — Archify](diagrams/traqen-product-architecture/graph-governance.lifecycle.html)

## Baseline policy

Superseded designs, validation reports, resolved bug reports, diagrams, review notes, and implementation plans are removed from the working tree so the roadmap, active `Fxxx` documents, product architecture, ADRs, and current implementation plan form one design baseline. Git history remains the recovery record.

The `features/feature-traceability-design*.md` compatibility pair temporarily remains at its legacy path because the current Web build imports it as display content. Its banner redirects readers to F002, and the active implementation plan requires migrating the import before deleting the compatibility path.

## Bilingual documentation policy

Every pull request that adds or changes documentation must add or update both language versions in the same change.

- Prefer an English canonical filename such as `guide.md` with a Simplified Chinese counterpart named `guide.zh-CN.md`.
- When an existing Chinese document owns a stable canonical path, retain that path and add an English counterpart named `guide.en.md`. The architecture design currently follows this compatibility rule.
- Every pair must begin with a language switch linking to the other version.
- Keep code, commands, API paths, identifiers, enum values, configuration keys, and product model names unchanged unless the document explicitly explains a localized label.
- Product vision, guardrails, security boundaries, acceptance status, and known limitations must have equivalent meaning in both versions. A translation must not weaken or expand a requirement.
- Update both versions together. If one version cannot be updated accurately, do not merge the documentation change.

The automated test `test/bilingual-documentation.test.js` enforces file pairing and language-switch links for Markdown files under `docs/` and for repository README files.
