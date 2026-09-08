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

### 9c35b9c browser evidence and assertion target correction

This real-browser run exited 1 after 18 seconds; its report and failure screenshot remain preserved. Three complete journeys were recorded: directory capture of 105 files and one empty directory, same-run refresh recovery, a lost seal response recovering one Receipt, 100/6 inventory pagination with search/disposition filtering and current-station visibility at 390px; a new directory version retaining all 105 files without changing the old bundle; and Git-only capture pinned to an exact commit with READY. Combined capture also obtained a two-component READY_WITH_ACCEPTED_GAPS Receipt with one Gap, but the rest of the matrix did not finish.

The second incorrect assertion confused the top-level process badge with the bundle qualification card. File B §6.1/§7.3/§10.1.8 separates completed freezing from current admission and requires gap-bearing bundles to remain orange. Reading journey.ts, workbench.tsx and the screenshot confirms that the blue top badge only states completed freezing and admission requiring a separate check. The actual frozen result card and historical Receipt are already orange and retain Gap=1. Requiring the process badge itself to have a warning class was a test error, not a product change turning gaps green.

Only the test is corrected: locate the result card containing the frozen-bundle heading and check its warning class, exact Receipt state and nonzero Gap count. Keep the separate-admission top-level wording assertion and add renewal assertions preserving status and Gap count. This does not remove the color requirement or alter product state mappings. The corrected assertion and unreached combined-filter, renewal, read-only and blocked journeys still require the complete browser rerun.

### Complete browser regression at 96ae098

搬砖工 / gpt-5.6-terra executed the isolated matrix at exact commit `96ae0986196008d4912e1a76f9de124564a4409a`: managed duration 24 seconds, exit 0. Command receipt: `0001788841236748-000109-e01c4515`; evidence delivery: `0001788851290923-000116-7d9bfa2c`; verification task `0001788841093084-000101-0b542db4` is done. The parent remains in implementation; execution verification is neither formal code approval nor F001 completion.

The unmodified report is archived as [browser-96ae098.json](browser-96ae098.json). Original report, execution log and five screenshots remain under parent directory `/private/tmp/`, child directory `traqen-f001-browser-journeys.LkRGn4/`. The parent owner reread the complete report and inspected the combined-gap and narrow-screen screenshots.

All seven journeys passed: directory capture with refresh/lost-response recovery; a new directory version; pinned Git; combined input preserving two independent components and one Gap; same-bundle renewal preserving the old Receipt; read-only queries without write privileges; and blocked roots without publication or acceptance bypass. The matrix also verifies no automatic downstream analysis. Every earlier failed run remains retained.

Native directory selection and 100k browser scale remain unverified (both report flags are false), as does disaster-recovery deployment acceptance. The general Workspace data warning in screenshots still lacks request/response root-cause evidence and is not closed. Current-topology 100k regression, those browser boundaries, independent review and merge acceptance remain parent responsibilities.

### Current-topology 100k regression at 39d6247

The isolated service pilot at exact commit `39d624725fa1d4ff1474b01266078bedf2c17928` exited 0 within the original 3600-second limit, with managed duration 2201 seconds. All 283 JSON log records were read and checked against the artifact report: five completed phases, zero sampling errors. The [complete report](pilot-100k-39d6247.json) preserves its original fields.

Git 50,000 plus directory 50,000 files produced three distinct frozen bundles. Git B reuses D1; D2 fully re-enumerates but transmits only 36 additional bytes. After sources go offline and database/storage reopen, the first and third versions still replay through complete pagination. One-second process-tree samples peak at 428,654,592 RSS bytes and 541 descriptors, below the unchanged 1 GiB / 1024 budgets. These are sampled assertions, not OS hard quotas. The 216,626 ms offline reopen/replay phase is not a deployment RTO.

Original log: parent directory `/private/tmp/`, child `traqen-f001-current-100k.SnDvXX/pilot.log`. Isolated artifacts/report: parent `/tmp/`, child `tq-f001-pilot-luguCt/`. The older bcb21ac 100k pass and both timeouts remain retained. This adds no runtime changes, repeats no existing repository gate, and does not substitute a service pilot for native-picker, 100k browser or disaster-recovery deployment acceptance.

### Request-level cause of the general Workspace warning

At `572c72b5728e30835934a2986af89f1b7cd5cd7d`, a fresh instance of the same `browserFixture` used isolated PostgreSQL/HTTPS Git and a synthetic member to GET all seven requests made by `refreshWorkspaceReads`. Diagnostic PID 69713, API port 3197; its own server and database were shut down normally afterward. Neither production nor the older preview process was used. Diagnostic exit 0 means evidence collection completed, not that the following 400 was fixed.

| Request (Workspace directory) | Observed result |
| --- | --- |
| `/v1/projects/directory/graph/current` | 404 `CURRENT_GRAPH_NOT_FOUND`; the client explicitly converts this to null, without rejection. |
| `/v1/projects/directory/graph/revisions` | 200, empty revisions. |
| `/v1/projects/directory/workspace-analysis-jobs` | 400 `INVALID_REQUEST`, `Legacy understanding runtime is not configured`; requestId `e8275351-2b27-48ec-8d13-c4fc7f875fd7`. |
| `/v1/workspaces/directory/review-queue` | 200, empty items. |
| `/v1/workspaces/directory/capability-draft` | 200, null draft. |
| `/v1/workspaces/directory/capabilities/effective` | 200, empty catalog and zero counts. |
| `/v1/workspaces/directory/execution-profile-revisions` | 200, empty profiles. |

The call chain is rejection aggregation in `traqen-product.tsx:refreshWorkspaceReads` → `server-understanding-client.ts:listServerWorkspaceUnderstandingJobs` → HTTP jobs GET → the unconfigured-runtime check in `TraceabilityApplication.listWorkspaceUnderstandingJobs`. `browserFixture` supplies only CORS configuration; `application-bootstrap.js` requires both `SOURCE_SNAPSHOT_ROOT` and nonempty `TRAQEN_ALLOWED_WORKSPACE_ROOTS` to create the legacy analysis runtime. This identifies missing legacy analysis configuration in this isolated F001 fixture, not corrupted source Bundle/Receipt reads; it does not establish failure in an actually configured deployment.

The error and original screenshots remain. No error suppression, fabricated empty success, automatic analysis start or expansion of F001 into analysis was added. The integration fact was sent as FYI to the F002 thread, message `0001788855692674-000149-ce2c3d2a`, without transferring implementation responsibility. Only the unknown cause is resolved; full application integration and deployment acceptance are not declared passed.

Native-picker and 100k browser acceptance remain incomplete: computer control denied access to Google Chrome for Testing because the app was not approved. Permission has been requested from the operator; no alternate control channel was used to bypass the denial. Existing OPFS and service-pilot reports cannot substitute for these two checks.
