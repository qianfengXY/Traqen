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
| 8. Acceptance | Three source-projection failures and one stale-selection failure → the same five frontend checks plus one backend test GREEN (exit 0, zero skips, 8.85s). Web build/full tests, strict types, lint, bilingual checks, and the extended browser journey are pending. |

## Reproduction and fix boundary

1. Freeze a complete baseline containing directory D and Git G.
2. Create a new complete version, removing D and retaining G.
3. Open the new version's file-level comparison and select the old baseline.
4. The old selector offers only G, making D's `SOURCE_REMOVED` result unreachable.

The fix covers selection and regression tests only. It does not modify materials, immutable history, authorization, or backend verdicts. OPFS and service-scale evidence do not establish native-picker, 100k UI, or deployment acceptance.

## Reproducible verification

RED: `node --test web/tests/source-truth-delta.test.mjs`. The unchanged old projection, extracted and wired into the real view, returned only `[git]` instead of `[git, directory]`; replacement registration returned only `[new-directory]`, omitting the old registration; changing the baseline retained `old-directory` instead of selecting the available `git`. Four of five checks failed, with the wiring check passing; exit 1. These were behavioral assertions, not syntax or environment errors.

GREEN: `env -u DATABASE_URL -u SOURCE_TRUTH_CONFIG -u REDIS_URL -u TRAQEN_DATA_DIR node --test web/tests/source-truth-delta.test.mjs test/source-truth-delta.test.js`. All six passed. The backend fixture uses isolated PGlite: removal and reverse addition are non-comparable with empty items and null counts; existing file modification/addition/deletion and exact pagination locators still pass.

The browser script adds actual page interactions: remove the directory from a combined bundle, retain Git, and freeze a complete new version; select the old directory and see `SOURCE_REMOVED`; clear the baseline and observe selection/result reset; reverse the pair and see `SOURCE_ADDED`; assert zero comparison writes. This journey has not run yet.
