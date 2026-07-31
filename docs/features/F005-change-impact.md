> Language: **English** · [简体中文](F005-change-impact.zh-CN.md)

---
feature_ids: [F005]
related_features: [F001, F002, F003]
topics: [change-impact, incremental-analysis, revalidation, history]
doc_kind: spec
created: 2026-07-31
---

# F005: Change Impact

> **Status**: spec | **Owner**: TBD | **Priority**: P1

## Why

The value of an auditable graph compounds when a new Snapshot can explain which Features, APIs, Claims, data, configuration, tests, and external dependencies may be affected and what must be reviewed again.

## What

F005 consumes a published incremental transition and produces:

- a `ChangeSet` between immutable Snapshots/GraphRevisions;
- evidence-backed impact paths;
- invalidated mappings and stale verification;
- affected Feature, API, Claim, TestSpec, data, configuration, and dependency sets;
- a re-review and re-execution plan.

## User journey

1. A Workspace completes an incremental analysis.
2. The Change Impact module opens the resulting ChangeSet automatically.
3. The user filters direct, transitive, uncertain, and policy-forced impacts.
4. Selecting an impact displays the graph path and evidence for every hop.
5. The user launches required review or revalidation work and tracks closure.
6. Historical Feature views retain the impact record after a newer head is published.

## Acceptance criteria

- [ ] Every impact belongs to one Workspace and one from/to revision pair.
- [ ] Direct and transitive impacts are distinguishable and explainable.
- [ ] Unknown or broken paths produce an uncertainty/gap, not a fabricated no-impact result.
- [ ] Unaffected governed Decisions remain unchanged.
- [ ] Required review and test actions are persisted and traceable to the originating impact path.
- [ ] The module opens published incremental results without manual Snapshot/ChangeSet ID entry.
- [ ] Full-versus-incremental equivalence is a publication gate for evaluated scopes.

## Current gap

Implementation commit `1682d7d` contains ChangeSet/Impact/continuous-protection domains and a manual comparison UI, but live use still depends on entered IDs and demo fallback data.

## Dependencies

F001 produces incremental GraphRevisions; F002 provides affected Feature/API history; F003 visualizes impact paths.

## Non-goals

- claiming complete impact when graph coverage is incomplete;
- auto-changing governed Feature identity;
- treating test selection as proof that tests passed.
