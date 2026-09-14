> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [web, cutover, documentation, regression, validation]
doc_kind: bug-report
created: 2026-09-07
---

# F001 entry cutover and repository-gate diagnosis

Reporter: 砚砚 / gpt-6-astra. Author implementation diagnosis, not formal branch review or Feature completion.

## Diagnostic capsule

| Field | Record |
|---|---|
| Symptom | At `2db1f77`, 543/544 backend tests passed, with documentation failing. The web build and 80 tests passed, but typechecking failed and lint reported three warnings. |
| Evidence | Managed task `hold-ball-1788774469777-t2syo9`, exit 1 after 335 seconds. Each command recorded its own exit status; `set -e` did not hide unexecuted checks. |
| Root cause | New diagnostic reports lacked language links; authoritative Chinese designs lacked backlinks to historical English versions; the generic template already lacked a counterpart. `staging.ts` used `0n` under an ES2017 target. The entry cutover orphaned the old source/start/control callbacks, while static tests still required that code to exist. |
| Diagnosis | Enumerate all documentation-link defects, compare branch and main, trace callback/state/modal references, and separate regressions from unchanged-module errors. |
| Timebox | If cross-feature ownership remains unclear after ten minutes, notify a verified thread with evidence rather than guessing at settings or graph contracts. |
| Warning | Do not raise the compile target, disable lint, call existing type errors a pass, or restore the superseded analysis entry to suppress unused warnings. |
| User interaction | Retain the source-snapshot workbench within one Workspace. Freezing does not start analysis; existing historical reads and explicit historical reanalysis remain. No new layout or navigation design. |
| Acceptance | Current-entry assertion RED → GREEN; source web behavior tests, targeted types, zero-warning lint, and documentation checks. Record repository-wide typechecking separately and do not claim a full pass while it fails. |

## Fix and verification

- Repair only language navigation and diagnostic counterparts. Chinese designs remain authoritative and English designs historical; bilingual design maintenance is not resumed. The generic template gains an equivalent Chinese counterpart and reciprocal links only, without changing its original text, fields, or acceptance semantics.
- Replace `0n` with `BigInt(0)`, preserving the compile target and counter behavior.
- Remove unreachable legacy callbacks, state, imports, and modal. Retain service clients, F006 settings/Active Profile, historical reanalysis, and their behavior tests.
- Replace obsolete source-presence assertions with protection of the Workspace-bound `SourceTruthWorkbench` and rejection of superseded raw-source start wiring. The updated assertion failed first (1/1), then passed unchanged after cleanup (1/1).
- `node --test web/tests/source-truth-*.test.mjs`: 15/15 passed, zero skips. Strict targeted ES2017 `tsc --noEmit` for `source-truth/workbench.tsx` and its transitive dependencies exited 0.
- `node --test test/bilingual-documentation.test.js`: 2/2 passed. `npm --prefix web run lint -- --max-warnings 0` exited 0. The documentation checker was not weakened.
- Repository-wide tsc still reports unchanged settings, graph, legacy local-analysis, and Worker type errors. Source-module and removed-start-callback errors are gone, but this is not a passing full typecheck.

The existing F006 repair thread received settings-error evidence and the shared-host cleanup scope; the parallel F002 thread received graph-error evidence. Notifications do not replace ownership validation or F001 integration responsibility. Aggregate Git-cache budgeting, the browser eight-station journey, admission timing checks, and independent review remain outstanding. All previous 100k success and failure evidence is retained.
