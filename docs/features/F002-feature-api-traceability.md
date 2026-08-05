> Language: **English** · [简体中文](F002-feature-api-traceability.zh-CN.md)

---
feature_ids: [F002]
related_features: [F001, F003, F004, F005]
topics: [feature-tree, api-tree, traceability, history, evidence-gaps, frontend, user-journey]
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

## Frontend product experience

### Governed tree and detail workspace

The F002 surface uses a tree/detail workspace:

- the left pane switches between Feature Tree and API Tree, searches the selected projection, and filters by evidence state;
- the header identifies the current published `GraphRevision` and offers an explicit historical revision selector;
- the detail pane provides Overview, Evidence, Relations, Gaps, and History views;
- a compact five-stage Trace Chain preserves the existing visual language, while its detail expands the complete requirement, design, implementation, data, configuration, test-file, TestSpec, execution, result, Decision, conflict, and Gap objects without collapsing their identities.

Every evidence item exposes its state, immutable resolver, Snapshot/Revision context, source location where applicable, and digest validation. Selecting a relation can open the focused F003 graph; selecting reviewable weak evidence can open its F004 queue item without losing the current Workspace and revision context.

### Authority and history

The primary Feature/API tree always reads a published governed projection. Working Candidates may be available in a separate, dashed, explicitly non-authoritative section or through a link back to F001, but they never appear as nodes in the governed tree.

Selecting a historical Revision places the entire tree, detail, evidence, and relation view in read-only historical mode. Feature history shows FeatureVersion Decisions, implementation mappings by Snapshot, impacts, reviews, TestSpecs, executions, results, and Gaps. API history shows contract and implementation changes without inventing business identity.

### States and responsive behavior

- **No published head:** explain that analysis has not produced a governed graph and link to the current F001 Job or setup action.
- **Partial coverage:** render every required evidence category as `MISSING`, `STALE`, `CONFLICTED`, or `NOT_APPLICABLE`; do not hide empty categories.
- **Revision unavailable / evidence invalid:** keep the selected identity visible, explain the immutable reference failure, and offer a valid current or historical context.
- **Workspace switch:** clear the old tree selection and history context before loading the new projection.

Desktop uses tree/detail panes. Mobile uses tree-to-detail navigation with a persistent revision/authority header and returns to the same tree position.

### Frontend acceptance

- [ ] A user can open the latest governed Feature/API evidence chain without typing Workspace, Snapshot, Revision, Feature, or API IDs.
- [ ] Governed, Working Candidate, and Historical contexts are visually and textually distinct and cannot be merged by a client filter.
- [ ] The five-stage summary does not collapse test files, TestSpecs, executions, results, Decisions, or Evidence into one object.
- [ ] All required evidence categories expose explicit missing, stale, conflicted, or not-applicable states and resolve to immutable context.
- [ ] Tree selection, revision switching, evidence inspection, and return navigation work on desktop, keyboard, and mobile layouts.

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
