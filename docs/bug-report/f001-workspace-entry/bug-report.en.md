> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001, F005]
topics: [workspace, authentication, source-snapshot, frontend]
doc_kind: bug-report
created: 2026-09-17
---

# Failed Workspace attachment rendered as an empty Workspace

Reporter: co-creator. Investigation and implementation: 砚砚 / gpt-6-astra.
Execution authority: operator message `0001789613646820-000011-1a02612e` in the F001 thread.
This is an implementation diagnosis, not F005 adoption, independent approval or an overall F001 completion claim.

## Diagnosis capsule

| Field | Evidence and conclusion |
|---|---|
| Symptom | The public entry receives Workspace HTTP 401 but renders creation and retired FULL-analysis onboarding. Creation failure relies mainly on global feedback and appears unresponsive. |
| Evidence | This run visited `https://traq.nas.cpolar.cn/`: same-origin `/api/health` returns 200 and Workspace listing returns 401. Web 3188/API 3100 PIDs 55489/55488 run from the local `00e9c1d` release; the gateway now proxies `/api`. The earlier localhost/CORS issue was not assumed to remain the cause. |
| Cause | `renderView` conflates null selection with unauthenticated, failed and genuinely empty states; the Workspace client discards HTTP status. F001 overview failure still renders verification-in-progress; navigation and onboarding retain the retired analysis entry. |
| Strategy | Trace actual requests through client error propagation and rendering; compare File B and published F005 references; add precise failing regressions before implementation. |
| Deadline | Browser waits are bounded. Diagnose the first failed stage rather than rerunning until green; never use production data for experiments. |
| Warning | Stop any path requiring weaker authorization, automatic source grants or a design-contract change. UI changes must not bypass authority. |
| Interaction correction | Separate connection/authentication from actual empty state; retain input and show local create errors; block duplicate submits; enter Source snapshots; replace false loading with access recovery; distinguish frozen history from current capture. |
| Acceptance | Five new RED checks failed for the intended missing behavior, then nine targeted checks passed. On 2026-09-17 UTC the full Web build and 105 tests, type, lint and fixture-origin checks passed; isolated entry 5, existing journeys 12 and empty-source 4 passed. Failed attempts, evidence scope and remaining boundaries are recorded below, not treated as overall completion. |

## Fix and reference scope

Server identity, Workspace and source membership remain distinct. No automatic provisioning or source access from a general API token. Tokens stay in page memory, not URLs, logs or browser persistence. A successfully created Workspace without source grants explicitly reports unavailable source access and its recovery route, not capture readiness.

Navigation is now Source snapshots; onboarding no longer promises FULL analysis. Eight stations, explicit review and sealing remain, with no downstream analysis start. Existing semantic colors/theme variables are preserved while title/metadata sizing, task/context layout, frozen-history summary, touch and focus presentation improve. F005 at `c2eb46a` is a published **unadopted review reference**, not wholesale adopted global design. No Spec, lifecycle or design document changed. The new desktop dual-theme proposal remains owned by its F005 thread; this fix does not implement it wholesale.

Browser fixtures now accept an explicit loopback Web origin so isolated 3190/3197 tests coexist with deployed 3188/3100. Existing assertions and immutable-history protection are not relaxed. Credentials and materials are synthetic, isolated fixtures; user source directories are not read.

## Verification and visual comparison

`npm --prefix web test` (including build) passed 105/105; `web/node_modules/.bin/tsc --noEmit --project web/tsconfig.json`, `npm --prefix web run lint`, `node --test test/source-truth-browser-origin.test.js` and `git diff --check` exited 0. The existing 100,000-entry in-memory test in the Web suite is not F001 100k-browser or 8G deployment acceptance.

The first acceptance wrapper incorrectly passed vinext `--host`: the server bound localhost while its probe used 127.0.0.1, failing before browser launch. Its FAILED summary remains intact. Local vinext source confirmed `--hostname`; only the unexecuted browser suites were then run, without weakening assertions. Product fingerprints match the successful static checks. The new entry test tightened its creation-button selector to the form to avoid a same-named sidebar button.

The second isolated run occurred at 2026-09-17 03:24–03:28 UTC: Chrome for Testing 151.0.7922.34 / macOS Darwin 25.6.0 / arm64, Web 3190, independent PostgreSQL and API 3197. Five entry checks cover authentication recovery, retained input, duplicate-submit prevention, denied source access for a new Workspace and presentation; twelve journeys and four B-13 empty-source boundaries passed. Reports exactly match their logs; all 21 source fingerprints and nine check-log hashes match. Web PID/cwd identifies this implementation checkout, and both test ports were released.

| Published F005 reference | Implementation evidence | Judgment and boundary |
|---|---|---|
| `assets/previews/04-sources.png`: Source snapshots naming and frozen/current separation | Desktop 1440×900, 2560×900 and frozen-bundle captures | Source heading, latest frozen summary, current eight stations and history are separated; not a wholesale shared-shell replacement or acceptance of the new 2560×1440 dual-theme design. |
| Primary source task with right-hand version/context, semantic states | Empty-Git review, frozen accepted Gap, rejected empty-directory replacement captures | 280px context column and clearer type/spacing; warnings remain amber, old versions survive, and admission/backup are not falsely green. |
| Connection failure is not an empty state; recovery is visible | Authentication, retained creation error and source-access denial captures | Cause and next action are explicit. The global warning from legacy analysis reads remains visible; it is neither hidden nor counted as a source-flow failure. |

The design scan found `docs/design-reviews/F005/assets/F005-layout-navigation-v2.pen`. No Pencil screenshot capability is available in this tool set, so its nodes and the same-revision published PNG were compared; no fresh `.pen` rendering is claimed. Page-overflow checks at eight widths and visibility in five existing themes are regressions, not new F005 mobile or theme commitments.

External evidence: Parent path: `/private/tmp/traqen-f001-entry-ui.GLillt/`; Child path: `summary.json`; SHA-256 `1f14ec362c570103a4de39c884e1960081c5dc334fc60b790a7465cc7d47c840`. Preserved failure and reusable static evidence: Parent path: `/private/tmp/traqen-f001-entry.XmtojP/`; Child path: `summary.json`; SHA-256 `49f3cc4fcb8a1c92ad4db97a504bfd60fbe85e13da9b66eeaf1b6833fc3d2ea7`.

## Remaining boundaries

This fix does not add a user-facing source-access administration flow. Existing administrator binding cannot be claimed as automatic after Workspace creation. Sending the local deployment credential to the public domain requires explicit authorization for that destination; a rejected attempt was not retried through another channel. Native OS picker, 100k/8G aggregate budgets and independent protected backup/restore are not covered by these green checks.

## Entry recovery revalidation (2026-09-17 UTC)

The earlier results remain historical. This addendum records implementation diagnosis on top of `b7eb0f3a6300e85e23c23553e5aa1a926663a2b2`, not an independent review verdict.

### Cause and correction

The initial fix used the aggregate outcome of seven connection reads as the Workspace entry gate. An auxiliary skills 404 blocked sources even when Workspace listing returned 200. Stale creation errors, unbounded checking and stale responses share an incomplete connection-state boundary: each attachment needs its own identity, result-commit and termination conditions.

- Workspace listing alone determines entry and 401/403 classification. Six auxiliary reads settle separately; failures name the catalog and available HTTP status, never pretend to be empty catalogs or grant source access.
- Each attachment clears the previous identity's Workspace and global catalogs, cancels its requests, and rejects late commits through a connection sequence and Workspace context. Connection GETs share a ten-second deadline; cancelled body consumption cannot publish successful data.
- Successful listing clears an old create error while retaining the name. Checking retains token and connection-settings controls. Creation writes are never automatically retried.
- Browser fixtures require an explicit localhost/127.0.0.1 origin on port 3190. Missing values, 3188, 3100, 5432, other ports and external targets fail closed before PostgreSQL creation.
- Presentation tests render actual React components. The positive SSR assertion targets the connection panel, not a same-named sidebar tooltip. Notice consumers explicitly import their stylesheet.

The failure-mode audit covered all seven reads, body cancellation, identity switches, Workspace context, creation results and source-denial rendering. This separates authoritative listing from auxiliary catalogs rather than layering guesses of success. Backend, schema, source grants and eight-station sealing contracts remain unchanged.

### Red-to-green and retained failures

On the original b7 product, four browser recovery cases completed setup and failed as expected during exercise; three of seven targeted checks also failed as expected. An additional cancelled-body regression first produced `Missing expected rejection (AbortError)` before the fix. These RED results are not evidence of a successful repair.

At 06:59 UTC, 14 targeted checks, all 111 Web tests and build, type and lint passed. The private wrapper then invoked the bilingual test deleted in `2379606`, producing `Could not find 'test/bilingual-documentation.test.js'`. This was the author's stale wrapper command, not a product or document-content failure. Its FAILED summary remains; successful static suites were not repeated. Both current Chinese-default documentation checks passed. The existing English companion is maintained voluntarily, not described as a mandatory bilingual gate.

At 07:04–07:08 UTC, the corrected wrapper passed documentation 2, recovery 6, entry 5, journeys 12 and empty-source 4. Hanging auxiliary reads and superseded-identity recovery are two supplementary checks, not claimed as original RED cases. Environment: Chrome 151.0.7922.34 / Darwin 25.6.0 / arm64, independent PG/API 3197 and Web 3190; Web PID 93889 had the implementation checkout's cwd. All 15 current source hashes, 14 unchanged static-source hashes, tracked diff, check logs, four original reports and 33 screenshot hashes matched. Ports 3190/3197 were empty afterward.

Visual inspection covered all six recovery captures, authentication/create-error/source-403 states, 1440×900 and 2560×900, accepted-Gap sealing, empty-Git review and rejected empty-directory replacement. Legacy analysis-read warnings remain visible. Screenshots support the corresponding states; timing/cancellation claims come from executed browser assertions. F005 subsequently required the same interface with scaling only: eight-width overflow checks **do not prove** uniform scaling, so this run does not claim completed F005 alignment.

Original RED: Parent path: `/private/tmp/traqen-f001-review141-red.zH261m/`; Child path: `summary.json`; SHA-256 `ab78e09c7ecf408ad12232e4ed35f50dfc0d944db4a25bf19a9e15b3e5f7c45a`.

Retained wrapper failure/static evidence: Parent path: `/private/tmp/traqen-f001-review141-green.wiDMSu/`; Child path: `summary.json`; SHA-256 `aafe31d3ef0d1e3c11a601c65ce78dfab3cbe624445b8b1be85828124272acf6`.

Current GREEN: Parent path: `/private/tmp/traqen-f001-review141-ui.gaREkm/`; Child path: `summary.json`; SHA-256 `2e45d8d02bf429b5ce650f09663be6dd86e072450193a9f37d12dc8eb973d618`. Recovery report at the same Parent; Child path: `recovery/report.json`; SHA-256 `5989db86915bd3f2a880cbd4ac64c06b37b5479efa412a86fce4a9c4d3176e1e`.

This is isolated verification of an unmerged fix. Independent quality gate and exact-commit re-review remain required. Nothing was merged or deployed; public credentials, source grants, native picker, scale/8G and backup boundaries remain open.
