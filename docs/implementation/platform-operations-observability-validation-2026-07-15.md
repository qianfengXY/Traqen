> Language: **English** · [简体中文](platform-operations-observability-validation-2026-07-15.zh-CN.md)

# Platform operations observability validation — 2026-07-15

This increment implements the repository-controlled part of design section 17.1 without inventing measurements that the platform has not observed.

## Available observations

- Reverse Run count, state distribution, elapsed time, Skill attempts, retries, failed attempts, input Fact scale, output candidate count, and durable asynchronous queue depth.
- Scanner bundle count, incomplete scans, node/edge volume, and per-extractor totals.
- Test execution state, elapsed time, attempts, retries, and TestSpecs whose observed statuses vary across executions.
- Evidence type, integrity, freshness, external-object count, and lifecycle actions.
- Change-impact elapsed time, changed Fact count, affected Feature count, and regression-selection size.

The endpoint is `GET /v1/projects/{projectId}/metrics/platform-operations`. It is backed by the same immutable records in the memory and PostgreSQL stores, and the product metrics screen loads it alongside Snapshot-bound effectiveness metrics.

## Explicit data boundaries

Runner heartbeat/resource use, model Token cost, and Evidence upload/redaction stage duration require integrations or attestations that are not present in the local control plane. They are returned under `unavailableSignals` with reasons; missing telemetry is never displayed as zero, healthy, or a composite score.

## Verification

- Domain tests cover durations, retries, unstable execution history, lifecycle counts, impact selection, and unavailable signals.
- API and OpenAPI tests cover the project endpoint.
- PostgreSQL tests execute the complete observation query against a migrated database.
- Web lint, production build, and server-render tests cover the live operations panel.
