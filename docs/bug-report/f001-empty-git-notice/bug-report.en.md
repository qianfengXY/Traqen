> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [source-truth, empty-git, browser-regression]
doc_kind: bug-report
created: 2026-09-11
---

# Missing explicit verified-empty Git notice

[中文](bug-report.md)

Reporter: 砚砚 / gpt-6-astra. Author self-check against document B §8.2 and B-13, not formal review.

## Diagnosis capsule

| Field | Evidence |
| --- | --- |
| Symptom | Valid empty Git versions seal and pass admission, but stations 7/8 and the historical view lack the explicit verified-empty notice. Generic zero counters do not satisfy the requirement. |
| Evidence | Base HEAD 7865227. Original four-case report SHA256 `3e88b71bc6c9ec860f7b13e18cd7313a33cf45d4e55f9ce8815c8c6282a0b889`; full report/log, both script fingerprints and all four screenshots checked. Its assertions did not cover the notice. |
| Root cause | The run read model exposes nativeIdentity, manifestId, enumerationClosed and summary. The workbench only renders generic identity/counts; the historical view also lacks an empty-Git explanation. This is not a backend empty-tree failure or an outdated runtime claim. |
| Strategy | Trace specification → screenshots → query model → real rendering. Add exact-text browser assertions before confirmation and in the historical view. |
| Timeout | Bound the new visibility assertion to 1.5 seconds; investigate a different failure at its real call site instead of blind retries. |
| Warning signals | Open enumeration, missing commit/manifest, directory input, nonempty or blocked evidence must not be called verified empty. Zero is insufficient. |
| User interaction | Preserve existing styling; explain verified-empty Git with its exact commit, scope and manifest. No automatic analysis or new admission authority. |
| Verification | Observe browser RED, then the same assertions GREEN plus negative regression cases and Web build/types/lint. Original four-case PASS remains valid only for its original assertions. |

## Scope

Implement the already-approved requirement without changing design, resource budgets or permission contracts. This report is not native-picker, scale-capture, formal-review or deployment acceptance. Operator `0001789020316461-000158-b51cf784` deferred 100k testing; prior failures remain retained.

## Observed RED

With the exact notice assertion added, isolated B-13 exited 1 after 23 seconds. Station 7 already displayed an exact commit, zero file/directory/byte counts, a prepared candidate and an unchecked human confirmation. The notice alone was missing. The failing call was `source-truth-browser-empty.mjs:59`, not enumeration, authorization or environment setup.

The [complete RED report](red-report.json) has SHA-256 `1d97aaecdca6f2334837bdbae773e9b46af6f16094c46e07543a86fad1f3782f`. Its full parsed log equals the report; log SHA-256 is `5767f8e8882502ebc00e2ae69fd7122a2b9dbe49a44641dedb036e6245e0eb59`. The RED script fingerprint is `a46337e9f48c6fe27b9baf393c846d77ae8ecd780de7a0f39da917d5ffb4867a`. The earlier four-case report did not assert this text and cannot replace this regression.

## Implementation boundary

`empty-git.ts` only projects server evidence: native Git commit/tree, a closed manifest, and strictly zero entries/bytes. A live source additionally requires no pending dispositions, a component binding in the current candidate and a review/sealing state. Missing source/object/manifest, open enumeration, failed/cancelled runs, directory input and nonempty data do not receive the notice. Combined bundles are evaluated per component: one empty Git component does not mean the whole bundle has no materials.

Stations 7/8 retain human confirmation and existing actions. Historical components display the exact commit, scope and empty manifest digest, explicitly distinguishing historical sealing from current admission. Backend, storage, Receipt, budgets, authorization and admission paths are unchanged.

## GREEN and author quality gate

On 2026-09-11 the managed isolated run exited 0 after 204 seconds. Checkout parent `/Volumes/WorkSSD/projects/Traqen-worktrees/`, child `f001-source-truth`; Web was that checkout at `http://127.0.0.1:3188/`, not Clowder runtime. PostgreSQL, HTTPS Git and OPFS used isolated fixtures; the original pilot and production data were untouched.

- `npm --prefix web test`: build succeeded, 94/94 with no skips. `tsc --noEmit --project web/tsconfig.json` and Web lint exited 0. npm environment-key, proxy and vinext static route-classification warnings remain recorded, not hidden or reported as compilation errors.
- [B-13 GREEN](green-report.json): 4/4, SHA-256 `79fc6e34a2ce10b36c334f44ec45e6c76f0dc8b63ba21b0ff6e7f0f023e9014c`. Actual assertions cover the notice at stations 7/8 and in history, exact commit/scope/manifest, three deletion pages, unchanged prior history, both empty-directory rejections and a valid zero-byte file.
- [Existing twelve journeys](recovery-report.json): 12/12, SHA-256 `51330975d25d04a0de868cbcfa48dcbf832194f8eeea9675e9b5555dc5093d5c`, no issues. Cancellation, retry, changed reselection and explicit reconfirmation of the same candidate after absolute expiry remain covered.
- Both complete parsed browser logs equal their reports. Log SHA-256 values are `aafc671bb7b16191ba40d2aca30862deec4b406b56654a8fb7bc80097b25564b` and `d67a87ad0c25064cd8d1e759d81b4de10e4f14ab4b533942e456ad5c14d79b84`. All six source fingerprints in the GREEN report match the current files.
- The author inspected all six B-13 screenshots: two station-7 views, empty first version, full deletion and both directory rejections. The notice is visible, confirmation stays disabled before explicit checking, and unpublished directories are not labelled empty Git. The known fixture-level legacy jobs configuration warning was not hidden.
- Bilingual documentation 2/2 and `git diff --check` pass. No `.pen` files were found; existing workbench styling was checked against document B without changing the design. No root-level media artifacts appeared in the worktree or committed diff.

Five axes: behavior=low-risk evidence presentation; data/security/contract/irreversible=unchanged by this correction. Architecture location is the existing source-truth Web projection, map delta=none, with no new store, router or authorization layer. Clowder-specific hotfix/fallback/ownership/tips scripts are absent from this external project; no home-project toolchain was copied and no pass was fabricated. This is author verification, not an independent review verdict or deployment completion claim.

Raw evidence parent `/private/tmp/`, child `traqen-f001-empty-notice-green.r3hshI/`; screenshots are under its `empty/` directory and build/types/lint logs at its root. Both original RED and the earlier four-case PASS remain retained rather than overwritten by GREEN.
