> Language: [简体中文](bug-report.md) · **English**

---
feature_ids: [F001]
topics: [inventory, pagination, browser, source-truth]
doc_kind: bug-report
created: 2026-09-08
---

# Missing full-inventory search and filtering

Reporter: 砚砚 / gpt-6-astra. Baseline: `8ea0ef9cb21b8de1664e164f2e0cccc399419bdc`. This records an implementation gap in F001, not complete delivery or independent approval.

## Diagnostic capsule

| Field | Evidence |
| --- | --- |
| Symptom | File B §9/§10.5 requires component filtering, path search and pagination; the existing table only pages. Querying orders still returns the unrelated first row. |
| Evidence | ArtifactTable has no search input; HTTP forwards only limit/cursor; SnapshotReader only uses keyset pagination; the live query service lacks inventory. Two new backend tests and two Web tests each produced exit 1. |
| Cause | Inspection and the internal full manifest reader share an unfiltered entry point. Every layer lacks inspection conditions; filtering the current browser page is insufficient. |
| Investigation | Trace UI → HTTP → reader → entry table; test same paths in two components, filtering before LIMIT, literal percent, Chinese text and non-UTF8 Git paths. |
| Timeout policy | Targeted real-PG checks should take seconds. Preserve browser failures after bounded 30–45 second steps and inspect readiness/DOM rather than extending waits indefinitely. |
| Warning policy | Changing manifest hashes, filtering capture streams, relaxing authorization/expiry, confusing page counts with match totals, or loading the full inventory into the browser is the wrong direction. |
| Interaction | Explicit search/reset, component and disposition selectors, total matches and page size; filter changes reset pagination and stale responses cannot overwrite the new selection. |
| Acceptance | Backend 2 RED→GREEN; Web 2 RED→GREEN; real-PG inventory and HTTP targeted checks 3/3, zero skipped. At 6af6611, backend 562/562, Web including build 86/86, full strict typecheck and zero-warning lint each exit 0. Browser exits 1; the combined gate is not green. |

## Implementation boundaries

- SQL filters before LIMIT using a literal raw-byte path substring, disposition and exact component. Search is case-sensitive, valid text of at most 256 UTF-8 bytes. There are no LIKE wildcards or forced UTF-8 conversions of Git paths.
- Cursors bind Workspace, run/source or frozen Bundle/Receipt, and all three filters. Changed conditions require a new first page. Match counts remain decimal strings.
- SourceMaterialRepository.entries/entryStream remains unfiltered for manifests, capture, byte verification and publication. Existing authorization, current acceptance expiry and historical read-only boundaries remain intact.
- No migration, dependency or storage layer was added. Queries use existing entry/component tables; current 100k search performance or index acceleration is not claimed.

## Verification and remaining scope

`node --test test/source-truth-inventory-search.test.js`: 2 failures → 2 passes.
`node --test web/tests/source-truth-inventory.test.mjs`: 2 failures → 2 passes.
The two inventory checks and HTTP directory journey passed against real PG, zero skipped. The HTTP test initially used id instead of QualifiedSourceInput.componentSnapshotId; reading the contract corrected the test input, without weakening server validation.

The first new browser matrix exited 1 before diagnostic connection and covered no source journey. SSR exposed the button before React handlers attached. The existing rail browser script provided the readiness condition now added. Its FAILED report is preserved, never overwritten by retries. The matrix uses real PG, isolated HTTPS Git and OPFS FileSystemHandle; injected OPFS handles do not establish native operating-system directory picker acceptance.

### Browser test locator diagnosis

The 6af6611 managed gate took 193 seconds and exited 1 overall. Individual logs establish backend 562/562, Web 86/86, full typecheck and lint exit 0. The only failure is the browser: after historical inventory paging and path search, the exact label locator for the disposition filter times out after 30 seconds. The original failure report remains preserved; earlier search steps do not establish completion of the entire journey.

Isolated Chromium 151.0.7922.34 reproduces the problem with the same wrapping label/select markup: `getByLabel(..., exact: true)` matches zero controls, while the accessibility tree exposes the correctly named combobox. Querying its role and exact accessible name matches one control, and selectOption sets METADATA successfully. This is a test locator issue, not a missing product control. Both disposition and component selectors now use role locators; product code is unchanged.

The matrix now captures failure screenshots/accessibility trees and persists completed journeys incrementally. It also adds directory new-version, same-bundle renewal and read-only member journeys. Renewal compares the same Receipt history resource before and after, rather than mistaking the Bundle latestReceipt display projection for that resource. These added journeys still require execution; script presence is not passing evidence.

Full quality gate is not claimed: browser matrix, 100k with current Git topology, two independent exact-HEAD reviews, merge and isolated runtime acceptance remain open. The older 100k pass and two timeouts are retained. Shared design documents and old materials are unchanged.
