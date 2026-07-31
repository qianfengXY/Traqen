> Language: **English** · [简体中文](F002-feature-api-traceability.zh-CN.md)

---
feature_ids: [F002]
related_features: [F001, F003, F004, F005]
topics: [feature-tree, api-tree, traceability, history, evidence-gaps]
doc_kind: spec
created: 2026-07-31
---

# F002: Feature and API Traceability

> **Status**: spec | **Owner**: TBD | **Priority**: P0

## Why

An understood repository is useful only when a person can select one current Feature or API and see whether its requirement, design, implementation, data, configuration, tests, and results form a complete evidence chain.

## What

F002 owns two Workspace-scoped projections over the same canonical graph:

- **Feature Tree:** user-recognizable capabilities and governed Feature identity;
- **API Tree:** endpoints, contracts, handlers, callers, data/configuration effects, tests, and results.

Both default to the latest published `CurrentGraphHead`. A working Candidate tree from an active analysis is shown separately and never masquerades as the governed tree.

## User journey

1. The user switches Workspace; the Feature and API trees reload under that Workspace context.
2. The user selects a Feature or API.
3. The detail view shows requirement, design, code ranges, data, configuration, test assets, TestSpecs, executions, results, Decisions, conflicts, and gaps.
4. Missing or stale evidence is visible by evidence class and severity.
5. The user opens history to compare governed FeatureVersions and implementation mappings by Snapshot while the tree remains on the latest version by default.

## Terminal contract

- every displayed relation resolves to an immutable evidence or Decision reference;
- latest and historical views use the same identity and lineage rules;
- a code change may update implementation mapping and impact without creating a new business FeatureVersion;
- test files, TestSpecs, executions, results, and Evidence remain distinct;
- the API tree is not a second graph store.

## Acceptance criteria

- [ ] Switching Workspace changes both trees, selected details, history, and subscriptions atomically.
- [ ] The default tree reads the latest published head and labels working Candidates separately.
- [ ] A selected Feature/API exposes all required evidence classes with explicit `MISSING`, `STALE`, `CONFLICTED`, or `NOT_APPLICABLE` states.
- [ ] Every source excerpt is Snapshot-bound and content-digest verified.
- [ ] Feature history lists FeatureVersion Decisions, implementation mappings, impacts, reviews, tests, results, and gaps in chronological order.
- [ ] API history preserves contract and implementation changes without inventing business identity.
- [ ] No demo fallback can appear in a live Workspace.

## Current gap

Implementation commit `1682d7d` has Candidate Feature/API modes and traceability/history APIs, but the main UI does not consume the Feature history API and still mixes local Candidate projections with live/demo paths.

## Dependencies

- F001 provides Workspace, Snapshot, Candidate, reconciliation, and published graph foundations.
- F003 visualizes the same selected object and paths.
- F004 governs insufficient or automated outcomes.
- F005 attaches change history and impact.

## Non-goals

- generating business truth from a tree label;
- hiding missing evidence to simplify the UI;
- storing a separate Feature tree database.
