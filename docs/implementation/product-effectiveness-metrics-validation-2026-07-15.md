> Language: **English** · [简体中文](product-effectiveness-metrics-validation-2026-07-15.zh-CN.md)

# Product effectiveness metrics validation — 2026-07-15

## Outcome

Traqen now derives the repository-controlled portion of design section 17.2 from governed records for one immutable Snapshot Manifest. The endpoint and product dashboard answer whether the platform is establishing trustworthy, repairable Feature proof chains—not how many documents or tests it generated.

## Metrics

- high-value Features with a complete current-Snapshot chain;
- normative Claim confirmation;
- confirmed Claims linked to an approved TestSpec;
- approved assertions that check a business value or state beyond only HTTP success/underlying test exit code;
- Evidence freshness distribution;
- TraceGap counts by type, severity, and responsible role;
- per-Feature presence of product, rules, implementation, data, configuration, tests, assertions, execution, and verified Evidence;
- every Feature's unchanged authority/conformance/verification/freshness/conflict dimensions.

Every ratio returns numerator, denominator, and nullable ratio. There is deliberately no composite score. Empty populations return `ratio: null`, not a misleading zero or pass.

The high-value population comes from `HIGH_VALUE_FEATURE_IDS`; when no policy is configured, every governed Feature participates. A configured ID without a governed Feature is reported as an unavailable metric input instead of being silently dropped.

## Honest external boundaries

Three design metrics cannot be truthfully derived from the repository alone:

- TraceGap repair cycle requires persisted longitudinal gap-open/gap-close events;
- change recovery time requires adopting CI/CD and deployment event timestamps;
- defect escape rate requires a defect-management outcome feed.

They are returned in `unavailableMetrics` with the missing input. Traqen does not invent proxy values.

## Interfaces and verification

`GET /v1/projects/{projectId}/metrics/product-effectiveness?snapshotManifestId=...` is globally authenticated in production and rejects an unknown Snapshot. The application enumerates governed Feature IDs through both memory and PostgreSQL stores, derives each Feature traceability view from the requested Snapshot, and then computes metrics.

Domain, HTTP, OpenAPI/JSON Schema, PostgreSQL, rendered UI, and built-in pilot tests cover the result. The pilot requires a 1/1 valid high-value chain after repair, full Claim confirmation and rule coverage, one meaningful database assertion out of two total assertions, no remaining gaps, and an explicit unavailable defect-escape metric.
