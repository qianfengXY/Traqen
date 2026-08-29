> Language: **English** · [简体中文](README.zh-CN.md)

# Documentation

This directory is organized as a feature lifecycle, not as a chronological pile of design drafts. Traqen maintains the active product and engineering truth in English and Simplified Chinese.

## Active truth map

- [Feature roadmap](ROADMAP.md) · [简体中文](ROADMAP.zh-CN.md)
- [Product architecture](architecture/traqen-product-architecture.md) · [简体中文](architecture/traqen-product-architecture.zh-CN.md)
- [System requirements: legacy-system understanding and canonical quality traceability](architecture/traqen-system-requirements.md) · [简体中文](architecture/traqen-system-requirements.zh-CN.md)
- [ADR-0001: canonical traceability ontology](decisions/ADR-0001-canonical-traceability-ontology.md) · [简体中文](decisions/ADR-0001-canonical-traceability-ontology.zh-CN.md)
- [ADR-0002: Workspace aggregate and execution isolation](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md) · [简体中文](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.zh-CN.md)
- [Branch Review Publication Policy](policies/branch-review-publication-policy.md) · [简体中文](policies/branch-review-publication-policy.zh-CN.md)
- [Project overview and operating guide](../README.md) · [简体中文](../README.zh-CN.md)

## Feature truth

| ID | Active Feature document | Supporting design |
|---|---|---|
| F001 | [Workspace & Source Truth](features/F001-legacy-system-understanding.md) · [中文](features/F001-legacy-system-understanding.zh-CN.md) | product architecture |
| F002 | [Deterministic Evidence & API Structure](features/F002-feature-api-traceability.md) · [中文](features/F002-feature-api-traceability.zh-CN.md) | product architecture |
| F003 | [Agent Candidates & Reviewed Business Function Tree](features/F003-traceability-graph.md) · [中文](features/F003-traceability-graph.zh-CN.md) | product architecture |
| F004 | [Test/Execution Evidence, Change Impact & Revalidation](features/F004-claim-review.md) · [中文](features/F004-claim-review.zh-CN.md) | product architecture |
| F006 | [Workspace Capability Settings](features/F006-workspace-capability-settings.md) · [中文](features/F006-workspace-capability-settings.zh-CN.md) | [capability-resolution diagram](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html) |

F001–F004 are the active legacy-system-understanding design baseline. F006 retains its separate implementation track. Historical working artifacts may remain unlinked for compatibility or audit, but cannot compete with this table, the roadmap, or the active architecture documents.

## Visual design

- [Workspace capability resolution — Archify](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html)

The F001–F004 redesign does not treat older visual explorations as active specifications; implementation will add visual projections only after the reference-pilot contracts are proven.

## Baseline policy

The roadmap, active `Fxxx` documents, product architecture, and ADRs form one design baseline. Superseded material is either removed or explicitly unlinked and marked historical; Git history remains the recovery record.

## Bilingual documentation policy

Every pull request that adds or changes documentation must add or update both language versions in the same change.

- Prefer an English canonical filename such as `guide.md` with a Simplified Chinese counterpart named `guide.zh-CN.md`.
- When an existing Chinese document owns a stable canonical path, retain that path and add an English counterpart named `guide.en.md`. The architecture design currently follows this compatibility rule.
- Every pair must begin with a language switch linking to the other version.
- Keep code, commands, API paths, identifiers, enum values, configuration keys, and product model names unchanged unless the document explicitly explains a localized label.
- Product vision, guardrails, security boundaries, acceptance status, and known limitations must have equivalent meaning in both versions. A translation must not weaken or expand a requirement.
- Update both versions together. If one version cannot be updated accurately, do not merge the documentation change.

The automated test `test/bilingual-documentation.test.js` enforces file pairing and language-switch links for Markdown files under `docs/` and for repository README files.
