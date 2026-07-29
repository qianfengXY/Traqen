> Language: **English** · [简体中文](ROADMAP.zh-CN.md)

# Traqen Feature Roadmap

Traqen uses a repository-local `Fxxx` sequence for engineering Feature lifecycle tracking.

- IDs are zero-padded, monotonically increasing, and never reused.
- `docs/features/Fxxx-*.md` is the stable aggregation entry for one Feature.
- Active Features appear here; completed Features remain permanently addressable from their aggregation document.
- An `Fxxx` roadmap ID is an engineering-delivery identifier. It is **not** a governed business `Feature.id` in Traqen's traceability ontology.
- Historical documents may retain topic-style `feature_ids` until they are associated with an `Fxxx`; new formal Features use `Fxxx`.

## Active

| ID | Priority | Feature | Status | Owner | Source | Spec |
|---|---|---|---|---|---|---|
| F001 | P0 | Server-owned Workspace scan and Analysis lifecycle | spec | CodeX | operator requirement | [F001](features/F001-server-owned-workspace-scan-and-analysis.md) |
