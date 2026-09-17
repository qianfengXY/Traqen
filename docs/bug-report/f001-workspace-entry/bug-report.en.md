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
