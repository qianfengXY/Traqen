> Language: **English** · [简体中文](F003-traceability-graph.zh-CN.md)

---
feature_ids: [F003]
related_features: [F001, F002, F005]
topics: [traceability-graph, graph-path, evidence, visualization, frontend, user-journey]
doc_kind: spec
created: 2026-07-31
---

# F003: Traceability Graph

> **Status**: spec | **Owner**: TBD | **Priority**: P1

## Why

Lists reveal missing fields; a graph reveals how requirement, design, implementation, data, configuration, tests, and results support or contradict one another.

## What

F003 renders a Workspace-scoped, queryable projection from canonical graph artifacts. The user enters from the Feature or API tree, selects a node, expands typed relationships, and opens the evidence behind each edge.

## User journey

1. Select a Feature or API from the current Workspace.
2. Open a focused graph with the selected object as root.
3. Expand requirements, design, code, data, configuration, tests, results, Decisions, conflicts, and gaps.
4. Choose any path to read its edge meanings and evidence.
5. Switch to a historical GraphRevision without mutating the current head.

## Frontend product experience

### Focused graph workspace

F003 opens from the current F002 Feature/API selection or from an explicit governed-object search. It does not load a whole-repository graph by default. The page contains:

- a root/context header with Workspace, object identity, authority class, and `GraphRevision`;
- bounded expansion presets and node/relation/status filters;
- a focused graph canvas that loads one hop or a declared bounded neighborhood and expands only by user request;
- a node/edge evidence inspector containing identity, relation semantics, authority, Snapshot/Revision context, Conflict/Gap state, and Evidence Resolver;
- an always-available relationship/path list that supports the same inspection without the canvas.

Selecting an Edge explains why the relation exists and resolves its evidence; merely highlighting a line is insufficient. Change impact may appear as an F005 overlay, but it cannot mutate the underlying GraphRevision.

### History, states, and accessibility

- **No root:** preserve the current Workspace and offer governed Feature/API search or return to F002.
- **No path / bounded limit reached:** distinguish a verified empty result from an incomplete expansion or Gap.
- **Partial coverage:** render Candidate, Governed, Conflict, Gap, Stale, and Missing with shape/line/text semantics in addition to color.
- **Historical comparison:** compare current and historical Revisions side by side or as explicit layers; never synthesize them into a false current graph.
- **Workspace switch:** discard the old root, expansion, and late graph response before loading the equivalent module in the new Workspace.
- **Pre-v2 artifact:** keep F002 traceability unavailability explicit, while bounded F003 node, edge, path, and resolver reads may use only evidence physically stored in the selected legacy GraphArtifact.

Keyboard and screen-reader users can search a root, expand a bounded relation group, select a path, and inspect every hop through the relationship/path list. On mobile this list is the default view; the canvas is optional.

### Frontend acceptance

- [ ] Opening F003 from F002 preserves Workspace, governed identity, and Revision without requiring manual IDs.
- [ ] Initial and subsequent graph queries are bounded and expose when more data is available or coverage is incomplete.
- [ ] Every visible Node and Edge exposes identity, authority, Revision/Snapshot context, status, and an Evidence Resolver.
- [ ] Current, Historical, Candidate, Conflict, Gap, Stale, and Missing states cannot be confused by layout or color alone.
- [ ] The relationship/path list is functionally equivalent for path explanation on desktop, keyboard, screen reader, and mobile.

## Acceptance criteria

- [ ] The graph changes with `CurrentWorkspaceContext`; stale responses from the previous Workspace are discarded.
- [ ] Every node and edge carries identity, authority class, Snapshot/revision context, and evidence resolvers.
- [ ] Candidate, governed, conflict, gap, stale, and missing states are visually distinct.
- [ ] Path queries are bounded, deterministic for one GraphRevision, and explain why each hop exists.
- [ ] The graph can compare latest and historical revisions without combining them into a false present state.
- [ ] Live mode has no hard-coded/demo graph fallback.

## Current gap

Implementation commit `1682d7d` contains interactive graph APIs and UI, but the live surface still includes preset/demo fallback paths and does not yet make every relationship evidence-resolvable.

## Dependencies

F001 owns graph production and publication; F002 owns selected Feature/API context; F005 supplies change-impact overlays.

## Non-goals

- using graph layout as evidence;
- allowing client-side edges to become canonical;
- loading the entire repository graph when a bounded neighborhood answers the question.
