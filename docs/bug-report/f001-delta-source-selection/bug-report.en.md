> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [source-truth, version-delta, regression]
doc_kind: bug-report
created: 2026-09-09
---

# Version comparison omits removed sources

[简体中文](bug-report.md)

Reporter: Yanyan / gpt-6-astra. Diagnosis baseline: `29b9568eba8dc8dde4d12f28d3614a0048acb255`. This is an F001 implementation bug record, not an independent review verdict.

## Diagnosis capsule

| Field | Evidence / decision |
| --- | --- |
| 1. Symptom | The delta selector lists only target components. A directory removed from a Git + directory baseline is unavailable. File B §§7.4, 10.4, 11 require distinct source-removal reporting, not a claim that all files were deleted. |
| 2. Evidence | `SourceForm` supports removing a source. `SourceVersionView` maps only `version.components`. `SourceDeltaService.compare` already distinguishes `SOURCE_ADDED`, `SOURCE_REMOVED`, and `SOURCE_SCOPE_CHANGED`. This is a static call-chain diagnosis, not a native-browser reproduction claim. |
| 3. Root cause | The selector uses a one-sided target projection instead of the selected pair's union keyed by sourceId. Different registrations of the same kind must remain separate. |
| 4. Strategy | Extract the existing projection unchanged and wire it into the real view; reproduce removal, replacement, a new component for the same registration, and baseline changes. Preserve the backend contract. |
| 5. Timeout | If the test cannot reproduce the behavior in 20 minutes, narrow to source projection and actual view wiring; do not return to Chrome permission retries. |
| 6. Warning | Import/environment errors are not RED. If publication, admission, or backend Delta semantics need changes, stop expanding and investigate again. |
| 7. User-visible correction | Both added and removed sources are selectable with baseline-only / target-only labels; baseline changes clear invalid selection and results. |
| 8. Acceptance | Three source-projection failures and one stale-selection failure → the same five frontend checks plus one backend test GREEN (exit 0, zero skips, 8.85s). At `00e19ea`, Web build and 91/91 tests, strict types, lint, 2/2 bilingual checks, and eight real browser journeys all exited 0. |

## Reproduction and fix boundary

1. Freeze a complete baseline containing directory D and Git G.
2. Create a new complete version, removing D and retaining G.
3. Open the new version's file-level comparison and select the old baseline.
4. The old selector offers only G, making D's `SOURCE_REMOVED` result unreachable.

The fix covers selection and regression tests only. It does not modify materials, immutable history, authorization, or backend verdicts. OPFS and service-scale evidence do not establish native-picker, 100k UI, or deployment acceptance.

## Reproducible verification

RED: `node --test web/tests/source-truth-delta.test.mjs`. The unchanged old projection, extracted and wired into the real view, returned only `[git]` instead of `[git, directory]`; replacement registration returned only `[new-directory]`, omitting the old registration; changing the baseline retained `old-directory` instead of selecting the available `git`. Four of five checks failed, with the wiring check passing; exit 1. These were behavioral assertions, not syntax or environment errors.

GREEN: `env -u DATABASE_URL -u SOURCE_TRUTH_CONFIG -u REDIS_URL -u TRAQEN_DATA_DIR node --test web/tests/source-truth-delta.test.mjs test/source-truth-delta.test.js`. All six passed. The backend fixture uses isolated PGlite: removal and reverse addition are non-comparable with empty items and null counts; existing file modification/addition/deletion and exact pagination locators still pass.

The browser script adds actual page interactions: remove the directory from a combined bundle, retain Git, and freeze a complete new version; select the old directory and see `SOURCE_REMOVED`; clear the baseline and observe selection/result reset; reverse the pair and see `SOURCE_ADDED`; assert zero comparison writes. The journey passed; the complete original report is [browser-00e19ea.json](browser-00e19ea.json).

## New-commit gate and Dogfood

Verified code: `00e19ea69601f7224e3397c21c7c4d71b583e711`. The managed command took 123s and exited 0. All full logs in `/private/tmp/traqen-f001-delta-gate.MqDhEq/` (`web.log/types.log/lint.log/docs.log/browser.log`) were read; every check actually exited 0, none was unrun. Web's 91 and documentation's two tests had zero skips. Build warnings about the proxy environment and unclassified vinext static routes are retained, not reported as warning-free.

Dogfood required: `test/support/source-truth-browser-matrix.mjs` uses real PostgreSQL, HTTPS Git, and browser OPFS at `http://127.0.0.1:3188/`. The Web process cwd was verified as this feature checkout's `f001-source-truth/web`. Only isolated services and fixture credentials were used. All eight journeys and six screenshots were inspected. The new delta view visibly presents the selected baseline, removed-source label, and non-deletion warning. The mobile screenshot is a full-page composite and does not prove the sticky actions never obscure content at every scroll position; its no-horizontal-overflow and current-station visibility assertions passed.

New screenshot `browser/delta-removed-source.png` SHA-256: `327780a391dc5ef060cec603eda53161330330e7c9ca6a1f9c609c6df03dd706`. Original report SHA-256: `1f5b08510f56c7041a3ee1256184c4a4ad7902b1fed60799c98bf8adfc0af7f0`.

Risk axes: observable comparison selection; read-only projection and no migration; unchanged security/authorization; existing backend Delta contract; no irreversible operation. Architecture boundaries are unchanged. Design discovery found no `.pen` in this checkout, so Pencil comparison is not claimed. Clowder-specific commands not registered by Traqen are not fabricated passes.

Outstanding: native picker, 100k browser UI/capture load, protected and physically independent primary/backup deployment acceptance, two independent exact-HEAD reviews, and integration. The current 39d 100k service pilot and older success/failure records remain intact and do not replace these remaining checks.
