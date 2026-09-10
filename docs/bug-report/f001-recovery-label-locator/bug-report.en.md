> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [browser-test, recovery, locator]
doc_kind: bug-report
created: 2026-09-10
---

# Reason locator failure during expired-acceptance recovery

Reporter: 砚砚 / gpt-6-astra, functional self-test, not independent review.

## Diagnostic capsule

| Field | Evidence |
| --- | --- |
| Symptom | Eleven of twelve small browser journeys completed. Refilling the reason after expiry timed out after 30 seconds with exact `getByLabel`; the screenshot and ARIA still show the textbox. |
| Evidence | HEAD `9c05518aee28c22b1d05bc0e33d0863c847c8a7f` plus three uncommitted test files; matrix line 63, recovery line 127. macOS 25.6, Chromium 151.0.7922.34, Playwright 1.61.1. Failed report SHA-256 `5a4dbeed1f6de5765e3d00b596b1a0afffa005caf93b7c17252f571a665fe129`; parsed log equals report. |
| Root cause | Confirmed in isolation: React renders a nonempty textarea as child text inside the implicit label. Playwright 1.61.1 `getElementLabels → elementText → createTextMatcher` compares normalized full label text; exact-label matching fails while the textbox accessible name stays correct. This is a test locator defect, not a disabled product control or erroneous expiry rejection. |
| Strategy | Read local Playwright engine, product JSX and React rendering; compare empty/nonempty exact-label and exact-role matching and fillability in the same browser, without network or API access. |
| Timeout | Limit the micro-reproduction to five minutes; inspect real DOM if inconclusive, without repeating the full journey. |
| Warning | If role filling also fails or the control is disabled, investigate product state instead; do not extend timeouts or remove expiry assertions. |
| User behavior | No product, expiry or gate change. Server rejection (409), zero publication, return to station seven and unchanged candidate already passed. Only the test locator changes to the exact textbox accessible name. |
| Acceptance | Same-browser offline React markup reproduction: empty textarea matches both label/role once; nonempty textarea matches label zero times and role once, remaining editable. Old fill fails at the expected 500ms timeout; role filling succeeds for both initial values. The full twelve-journey rerun exited 0 in 120s. Recovery explicitly reconfirms the same candidate without recapture or automatic extension. |

## Runtime and boundaries

Port 3188 LISTEN PID 16962 started 2026-09-07 07:00:29 in this feature worktree's web directory. Runtime/target HEAD match 9c05518. The dev/HMR process predates the target; HTTP is 200. No current-PID log count is available, so this is not evidence of stale code. Test API 3197 and command PID 19961 have exited; do not reopen the failed fixture.

Evidence parent: `/private/tmp/`; child: `traqen-f001-recovery-ui.LGWOBP/`. Source fingerprints are in `source-evidence.json`; screenshots are `failure.png` and `expired-acceptance-returns-review.png`.

This is test/interaction diagnosis, not 100k or deployment acceptance. Prior scale failures and original pilot/PG remain untouched.

## Correction scope

The micro-reproduction uses local React 19.2.6 `renderToStaticMarkup` with the product's label/textarea structure and empty/previous reason values on an offline page. No API or existing data is accessed. Remounting the populated input after leaving station seven explains why initial filling worked but recovery failed. The three complete functions in local Playwright `coreBundle.js` agree with the reproduction. Exact accessible naming is preserved; no loose selector, extra delay, increased timeout or removed business assertion is used.

## Functional evidence (test delta, not F001 completion)

The scoped `quality-gate` checks a test-only delta: no product source changed. Baseline 9c05518 already passed backend 571/571, Web 91/91, build/types/lint; these full suites are not repeated. All three current test fingerprints match the [GREEN source record](green-source-evidence.json). The original [RED report](red-report.json) and [source record](red-source-evidence.json) remain intact: a locator failure is not presented as a product-business RED.

The complete [GREEN report](green-report.json), SHA-256 `09c35db9c65ad222e452100392bde39f1f1c39b6f2049c85d26a6cc0534914be`, reaches all twelve journeys with no issues. The parsed full log equals the report (log SHA-256 `e51c74a75b028601e0663c1f92bc2f92eb27d697beae20f66b1434b81e10eeb8`). Four added small-fixture paths exercise document B §7.2/§7.3 and B-08/B-10/B-11:

| Path | Durable result and visible behavior |
| --- | --- |
| Cancel before finalization | Dismissing the dialog causes no write; accepting retains CANCELLED without new publication or baseline changes. Editing starts again at station one. |
| Retry a transient failure | One fixture-gateway 503 is persisted by the real runner as FAILED_RETRYABLE. A new retryOf run preserves the locked input; the failed attempt remains after success. |
| Reselect changed directory | Same paths/sizes with different bytes are rejected before any write. The manifest and WAITING state stay unchanged; restoring original bytes completes the same two-file run. |
| Acceptance expires before seal | Transport waits for real server absolute expiry; seal returns 409 with zero publication. Explicit reconfirmation at station seven uses only confirm/seal writes, preserving the candidate without recapture. |

All four new screenshots were individually inspected. GREEN evidence parent: `/private/tmp/`; child: `traqen-f001-recovery-green.7T4Z9K/`. Files: `cancelled-preserves-baseline.png`, `retry-retains-original-attempt.png`, `changed-reselection-rejected.png`, and `expired-acceptance-returns-review.png`. Runtime screenshots are not copied into design assets.

Native OS directory picking, 100k browser scale, deployment and backup acceptance remain unverified; original scale failures remain. The global partial-Workspace-data alert visible in screenshots still needs separate investigation and is not covered up by passing business assertions. This delta changes no design, deadline, budget, production data or product logic, and is neither independent review, APPROVE nor whole-feature acceptance.

### Global-alert investigation addendum

After 1dd9e29, the [isolated per-route GET report](shell-read-diagnostic.json), SHA-256 `2212c16ca9047ab72b374789c185220fbea762cba81703251e14f3c445bce56a`, confirms the [previous diagnosis](../f001-inventory-query/bug-report.en.md): only legacy-analysis jobs return 400, `Legacy understanding runtime is not configured`. The absent current graph returns 404, correctly normalized to null by the client; all six other reads, including the source overview, return 200. This is not new source-data damage. No swallowed error, fake empty jobs response or automatic analysis is introduced. The existing F002 FYI stands without duplicate handoff. Only the unknown cause is resolved, not full application deployment readiness.
