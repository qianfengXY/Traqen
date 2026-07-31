> Language: **English** · [简体中文](F003-traceability-graph.zh-CN.md)

---
feature_ids: [F003]
related_features: [F001, F002, F005]
topics: [traceability-graph, graph-path, evidence, visualization]
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
