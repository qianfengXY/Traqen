> Language: **English** · [简体中文](feature-evolution-validation-2026-07-15.zh-CN.md)

# Feature evolution validation — 2026-07-15

This increment implements the design requirement that a Feature must survive renames, aliases, merges, and splits without relying on display names or code locations for identity.

## Governed behavior

- A new stable Feature ID starts at version 1; later names and descriptions advance exactly one immutable version at a time.
- An alias binds to an exact Feature version. Unicode-normalized, case-insensitive alias keys are unique inside a project so imports and search cannot resolve one label to two Features.
- `PREDECESSOR_OF`, `SUCCESSOR_OF`, `MERGED_INTO`, and `SPLIT_INTO` lineage edges retain their authenticated human actor, role, rationale, and timestamp.
- Both lineage endpoints must already exist in the same project. Self-links, duplicate immutable edges, dangling endpoints, and cycles are rejected.
- Actor identity and time are assigned by the server. The configured `allowedFeatureGovernanceRoles` policy fails closed for alias and lineage writes.

## Persistence and API

- Migration `0012_feature_evolution.sql` extends the existing `feature_lineage` relation and adds the version-bound `feature_alias` table.
- Memory and PostgreSQL stores implement the same append-only semantics.
- `POST/GET /v1/projects/{projectId}/features/{featureId}/aliases` manages governed aliases.
- `POST/GET /v1/projects/{projectId}/feature-lineages` appends or queries the evolution graph; GET accepts an optional `featureId` filter.

## Verification

- Domain/application tests cover sequential versioning, alias normalization, human attribution, and cycle rejection.
- HTTP tests cover authentication and both read collections.
- PostgreSQL tests apply every migration and round-trip aliases and lineage.
- OpenAPI and JSON Schema contracts expose all four lineage relations and server-owned governance fields.
