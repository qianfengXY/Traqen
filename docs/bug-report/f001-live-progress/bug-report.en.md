> Language: [简体中文](bug-report.md) · **English**

---
feature_ids: [F001]
topics: [browser, progress, bounded-polling, source-truth]
doc_kind: bug-report
created: 2026-09-07
---

# F001 observation during long uploads

Reporter: CodeX / gpt-6-astra. Author implementation diagnosis, not independent review or complete browser acceptance.

## Diagnosis capsule

| Field | Record |
|---|---|
| Symptom | The actual HTTP upload was at server station 6 while the browser remained at station 4. After fixing the parent observer, its material table still showed zero rows. The first file request retained the manifest-submission phase label. |
| Evidence | Target `d1f47bb` committed at 03:33:03; API port 3187/PID 9879 started at 03:33:05; Web port 3188/PID 11825 at 03:33:50, all 2026-09-07 America/Los_Angeles. Both processes followed the target commit. Fixture logs have no PID field: zero PID matches are not process-start evidence. |
| Cause | The command `inFlight` fence disabled polling throughout upload. The child table read only on route/cursor changes. UPLOAD events began after the first file completed; UI throttling could also swallow phase changes. |
| Strategy | Real browser OPFS directory handles substituted only for the picker result; actual scanning, IndexedDB, HTTP and server byte verification remained. Delay the complete-file request without fabricating API results, compare an independent server GET with the DOM, and inspect related live queries. |
| Timeout | Six-second station and five-second table observation windows. Release the barrier and settle the original upload; failures do not create duplicate runs. |
| Warning | No optimistic stations or false verified counts; retain command fencing, stale-response/session guards and the selected page. Bound pending reads. |
| UX | Observe the current station and material page during upload. Do not poll immutable history. Announce UPLOAD before the first response while verified counts remain zero. |
| Acceptance | Browser station RED (server 6/UI 4) → GREEN (6/6); table RED (0 rows) → GREEN (4 rows); phase regression RED (MANIFEST) → GREEN (UPLOAD). All 17 source Web tests, targeted ES2017 types and zero-warning lint passed. |

## Fix and protection

`observeSourceReads` separates read observation from command exclusion, permits at most one pending polling read, and stops on cleanup/abort. Existing session, selection and response-sequence fences remain. Active material tables refresh their current cursor without returning users to page one; immutable history remains demand-driven. Phase changes bypass the 100ms UI throttle; file/byte totals remain acknowledgement-based.

Scheduler tests cover stalled reads, recovery after read failures, abort/cleanup, and suppression of errors from stopped observers. Existing tests still reject malformed write acknowledgements and prohibit automatic write retries.

## Browser reproduction and limits

Connect the real workbench to the isolated preview fixture through deployment diagnostics, then select its Workspace. A directory containing three files and one empty child produces counts 3/1 and 34 bytes. Reload still waits at station 7 for explicit confirmation; previewing station 8 cannot seal. Explicit confirmation and seal create a bundle without starting F002. A new version uses the selected immutable baseline.

Change one 13-byte file and hold its complete-file request. The server reports WAITING_FOR_CLIENT at station 6. Before releasing the barrier, the UI must display station 6 and four material rows. After release it returns to station 7, reporting 13 bytes transferred and 34 bytes not retransferred. Assertions inspect actual DOM/HTTP responses, not injected React state.

The local probe and screenshots remain in temporary evidence directory `traqen-f001-browser-check.ut3cwp`; failed assertions remain in tool outputs. This run used Chromium headless shell 1234, Playwright 1.61.1, PGlite and private temporary encrypted content storage. It does not establish native OS-picker permissions, browser 100k capacity, the Git browser path, the full failure matrix, real PostgreSQL deployment or disaster recovery. Hub preview delivery was unconfirmed/no_matching_client, not visibly applied. Aggregate Git-cache protection and repository-wide type failures remain open. F001 is not complete.
