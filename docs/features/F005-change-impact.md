> Language: **English** · [简体中文](F005-change-impact.zh-CN.md)

---
feature_ids: [F005]
related_features: [F001, F002, F003]
topics: [change-impact, incremental-analysis, revalidation, history, frontend, user-journey]
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

## Frontend product experience

### Published ChangeSet workspace

After a published incremental analysis, F005 opens that Workspace's latest ChangeSet by default. A historical revision-pair selector is secondary; users do not type Snapshot or ChangeSet IDs. The page contains:

- a `fromGraphRevision → toGraphRevision` header with ChangeSet identity and action-closure summary;
- filters for direct, transitive, uncertain, and policy-mandated impact plus Feature/API/Claim/TestSpec/data/configuration/dependency type;
- an impact list ordered by risk and unresolved required action;
- a path/evidence inspector that explains every hop, invalidated Mapping, and stale Verification;
- persistent Review and Revalidation actions with source Impact Path, status, owner where supported, and closure history.

Selecting an affected object can open its F002 governed history or F003 impact path without changing the revision pair. Closing an action never deletes the Impact; the record remains in Feature/API history.

### States and responsive behavior

- **No published incremental ChangeSet:** explain whether the Workspace has no Head, only a FULL baseline, or an unpublished/failed incremental Job, and link to the valid F001 action.
- **Unknown or broken path:** display `UNCERTAIN`/Gap and the missing coverage; never translate it to No Impact.
- **Actions open / partially closed / closed:** show the denominator and each persisted action state rather than one aggregate confidence score.
- **Historical pair:** use a read-only banner and preserve the current latest ChangeSet as a direct return target.
- **Workspace switch:** discard the old revision pair, filters, selections, and late responses before loading the new Workspace's latest published ChangeSet.

Desktop uses impact-list/path-detail panes. Mobile presents the impact summary, then the selected path and required actions as ordered pages while retaining the revision pair and uncertainty label.

### Frontend acceptance

- [ ] The latest published incremental result opens without manual Snapshot, GraphRevision, or ChangeSet IDs.
- [ ] Direct, transitive, uncertain, and policy-mandated impacts remain separately filterable and explainable.
- [ ] Every impact path resolves each hop and distinguishes incomplete coverage from verified No Impact.
- [ ] Review/Revalidation actions persist, link back to their source path, and retain open, partial, and closed history.
- [ ] Current and historical pairs, Workspace switches, keyboard navigation, and mobile detail flows preserve the correct revision context.

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
