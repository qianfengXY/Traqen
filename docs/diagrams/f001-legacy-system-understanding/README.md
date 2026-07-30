> Language: **English** · [简体中文](README.zh-CN.md)

---
feature_ids: [F001]
related_features: []
topics:
  - legacy-system-understanding
  - architecture-diagram
  - analysis-agent
  - archify
doc_kind: design-artifact
created: 2026-07-30
status: proposed
priority: P0
---

# F001 Archify diagrams

These diagrams are visual projections of the approved F001 design. The design
documents remain authoritative; the checked-in Archify JSON is the reproducible
diagram source.

| Diagram | Static preview | Interactive artifact | Archify source |
|---|---|---|---|
| Legacy-system understanding architecture | [PNG](understanding-architecture.png) | [HTML](understanding-architecture.html) | [JSON](understanding-architecture.architecture.json) |
| Analysis Agent execution workflow | [PNG](analysis-agent-workflow.png) | [HTML](analysis-agent-workflow.html) | [JSON](analysis-agent-workflow.workflow.json) |

## Delivery receipts

| Diagram | Specification SHA-256 | Artifact SHA-256 | Validation | Visual review |
|---|---|---|---|---|
| Architecture | `a475d4a62ce29a4e0692e7d9eec2c0f4b5ce408c6f5d329620f71139330eaa2d` | `1a5eeb47c2c36eb38bf79034bdd51a98519bd0cb84209a56cd3dc25675b9d603` | 9/9 showcase; 0 errors; 0 warnings | passed; 0 correction rounds |
| Workflow | `0de8e4ca9bd4444645e4dfaa825f5f8782ba31556dbc67ff6ffbb9a79084eef1` | `c2f09c59db0515d00c4b374447d45a85b3ff5efb6add3271e9e7d28ce1e5aa95` | 9/9 showcase; 0 errors; 0 warnings | passed; 1 correction round |

The architecture view shows the complete-source path, raw-source security
boundary, model/Skill route, reconciliation boundary, governed Decision path,
and atomic publication. The workflow view expands deterministic Inventory
partitioning, bounded WorkUnit execution, optional Facts, hierarchical
synthesis, selective Critic use, reconciliation, and explicit gaps.
