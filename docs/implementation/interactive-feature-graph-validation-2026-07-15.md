> Language: **English** · [简体中文](interactive-feature-graph-validation-2026-07-15.zh-CN.md)

# Interactive Feature graph validation — 2026-07-15

## Product outcome

Traqen now exposes the exploratory half of the design's dual primary view. The ordered proof chain remains the default answer to “why is this Feature trusted on this deployment?”, while the graph lets a user explore branches, inspect provenance, expose conflicts and gaps, and lock a shortest path without turning the product into an unbounded code topology browser.

Both views are projections of `getFeatureTraceability`. No graph-only Feature, Claim, Fact, TestSpec, execution, Evidence, Conflict, or TraceGap record exists.

## Server contract

- `GET /v1/projects/{projectId}/features/{featureId}/graph` requires an immutable `snapshotManifestId` and accepts a preset view, depth, node limit, repeated node-type filters, and repeated relation filters.
- Depth is limited to 8, visible nodes to 100, and the default response to 30 nodes. The response reports truncation and the count/type of available expansions.
- `POST /v1/projects/{projectId}/features/{featureId}/graph/paths/query` performs bounded forward, reverse, or undirected shortest-path lookup with a maximum depth of 12.
- Every edge retains direction, typed relation, provenance, active/stale state, and Snapshot Manifest binding.
- Test assertions are first-class `TEST_ASSERTION` nodes. Conflicts and missing links are first-class `CONFLICT` and `TRACE_GAP` nodes rather than absent or cosmetically hidden data.

The JSON Schema and OpenAPI documents define the projection, node, edge, expansion, query, and path result boundaries.

## Product interface

The Feature workspace includes a dedicated **追溯图谱** surface implemented with Cytoscape.js. It provides:

- product traceability, governed business-process, implementation-dependency, and test-coverage presets;
- explicit depth, node-type, and relation filters;
- pan, zoom, node selection, provenance/version/source details, status-specific shapes and borders, and a text relation list for accessibility;
- server-backed shortest-path locking between any two visible nodes, including reverse exploration from Evidence to business rules;
- visible result bounds and possible next expansions;
- a complete/stale demonstration mode that performs no writes, plus a live API mode using the same in-memory credential boundary as the rest of the workspace.

## Executable proof

Domain, application, HTTP, contract, rendered-product, PostgreSQL integration, and built-in pilot tests cover this slice. The built-in order pilot now fails unless a complete current-Snapshot graph contains first-class assertions, a Feature-to-Evidence path, three authorized BusinessState nodes, and two StateTransition nodes. This proves both technical proof and business flow are backed by the same persisted Feature source.

## Deliberate boundary

The current graph is Feature-centered and bounded. Its governed Actor, BusinessState, StateTransition, DesignElement, and Snapshot Fact links now support the single-Feature business-process view. Cross-Feature process traversal and a ChangeSet-centered impact graph remain separate projections; neither may be inferred from labels or invented solely for visualization.
