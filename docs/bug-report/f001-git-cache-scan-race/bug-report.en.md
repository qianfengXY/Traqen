> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [git, capacity, concurrency, recovery]
doc_kind: bug-report
created: 2026-09-15
---

# Cache accounting races with native Git writes

Reporter: 砚砚 / gpt-6-astra. This is author implementation diagnosis and regression evidence, not an independent review or F001 completion claim.

## Symptom and reproduction

After merge `bb26b4fdfd0d3f340394029b346497480db9f489`, an isolated browser matrix completed 11/12 journeys before the next Git preflight failed; the expiry behavior had not been reached. Original summary SHA-256: `6760b6565d1d78ed444a100f7fb75e4a2ad1e0937b3a1caae009f5ef688cf201`. Twelve subsequent tiny native captures did not reproduce it; that was not proof of a fix.

The same merged code with an external enum-only observer reproduced failure after two directory journeys, at the first Git `fetch`: station 3, `SOURCE_STORAGE_NOT_READY`, private cause `RUNTIME / ENTRY_STAT / ENOENT / PACK_TEMP`. Summary SHA-256: `85afb88f172a1cab015d96bcd951a36369b9942a08b17c32f59ad9707582e08a`; browser report SHA: `2b2f44a1d0321228f3c41b8921283e19915de92a6896309da18deb35a0833cd2`. Original artifacts remain; the missing errno of the first failure cannot be reconstructed retrospectively.

The observer rethrew every error without modifying product code or assertions. Web PID 53991 (3188) and API PID 54541 (3197) started from exact bb26 after merge; HTTP 200 and cwd were checked, and neither port had a listener after cleanup. No production or original pilot was used.

## Root cause and impact

`git-cache-command.js` samples capacity every 100ms while trusted Git writes. A regular-file entry buffered by `opendir` can disappear before `lstat(path)` when Git finalizes a pack. The original scanner treated this ENOENT as storage failure and the supervisor aborted a legal fetch. The new run failed without publishing a bundle/receipt; prior history stayed intact. This is not evidence of disk exhaustion or a 100k memory failure.

The host uses Git 2.50.1 (Apple Git-155). Matching upstream [index-pack](https://github.com/git/git/blob/v2.50.1/builtin/index-pack.c) creates `pack/tmp_pack_XXXXXX` and calls `rename_tmp_packfile`; [object-file](https://github.com/git/git/blob/v2.50.1/object-file.c) finalizes files through link/unlink or rename. This supports the lifecycle explanation without claiming the Apple binary is byte-identical to upstream. Regressions deterministically perform both transitions at the real enumeration-to-stat boundary; old code produces the exact same private error.

## Correction and retained boundaries

- Only the lock-owning runtime supervisor opts into `duringWrite`. If an enumerated regular file disappears at lstat with ENOENT, discard the partial sum and restart complete root-to-leaf accounting. Never skip unknown bytes or retry only the obsolete path.
- At most three scans per check share the original 100000-entry work bound and depth limit 16. The resource bound is not reset; persistent churn still denies. Async iterator unwinding closes interrupted directories.
- Admission, post-recovery and final checks remain strict. Missing roots/directories, permission/I/O errors, symlinks or unsafe types, actual excess and insufficient filesystem headroom are not retried or accepted automatically.
- Budgets, reservation, 100ms period, process count, per-file limit, timeout, locking and public errors are unchanged. Replacement scans include finalized packs and other directories without accumulating old partial sums twice.
- Rejected alternatives: ignoring all ENOENT, checking only an individual pack, increasing budgets, automatically retrying the business run, or extending UI waits.

## RED → GREEN and executed verification

The rename/link-unlink regressions first failed with `ENTRY_STAT/ENOENT/PACK_TEMP`; bounded-restart and shared-work assertions were also RED. The tightened excess/unsafe-replacement assertions were observed RED too, rather than accepting any 503.

After implementation, the new regressions plus existing `source-truth-git-capacity.test.js` passed 23 tests, zero skipped/cancelled (7.087s). They cover replacement-file accounting, partial-sum reset, real excess, unsafe entries, persistent churn bounds, root/directory and EACCES/EIO faults, shared traversal work, and existing supervisor termination, lock contention, owner crash, retained historical bytes and private diagnostic redaction.

The expanded Git/capture/pilot set passed 47 tests, zero skipped/cancelled (53.715s), log SHA-256 `96792fe9a1cb1677a5660ce3b19e070f0a4621a476cca995fa5a6e27a6e9c403`. It includes real HTTPS, interrupted retries, retained history, component reuse and a service pilot transmitting only missing changed bytes; it is not a rerun of the 100k experiment.

Browser evidence preserves separate execution layers:

- The first attempt failed before Chromium launch because the shared executable was missing: zero browser cases and zero observed Git calls. Summary SHA `8c443f114afbd264b544ae0d1927b4c0fca87e23eb4461fb9d0eb29d23e1dab3` remains FAILED. Its deletion cause is unknown and cannot be attributed to dependency installation.
- Official Chrome for Testing mac-arm64 151.0.7922.34 was restored into an isolated cache, retaining download metadata, archive/executable digests and actual launch-version verification. Playwright, lockfiles and test expectations were unchanged. The same version is not claimed to be byte-identical to the missing old executable.
- All original 12 matrix journeys passed, subprocess exit 0, no issues and no automatic analysis; report SHA `c7abfdd1f56a7e13d7b48302d0d3e2ea9177f3c13dc71619751fe038db559f7b`. The private outer verifier incorrectly required every underlying Git call to succeed, so the deliberate missing-root case's rev-parse error failed its summary, SHA `0be85359e9e2cf4add087f3b2eb7f0d4820fd5d6228a0a99b7bc3358d9b29fd8`, which remains FAILED. The gateway maps this error to `SOURCE_GIT_ROOT_MISSING`; zero publication is the expected negative-case outcome, not a cache failure or the transient-retry injection. Raw business reports/logs and the outer failure are retained separately; no assertion was changed and the passing matrix was not rerun to beautify the aggregate.
- Only the four unexecuted B-13 cases were subsequently run once by 搬砖工 / gpt-5.6-terra: valid first empty Git, complete nonempty-to-empty Git deletion, first empty-directory refusal and empty-directory replacement refusal all passed. Old bundles remain unchanged, incomplete directory enumeration publishes nothing, and zero-byte files remain valid. Report SHA `aa808ee9d8c645d2866da6500d26c61a29083aa23b8e59191e91c09795736c7a`; separate execution summary SHA `de9644816e7d71c0e87c1ed8aedeaba5b9350b2f20a888c3f4fa82326b9d2a3a`. This is an evidence subtask, not formal code review.

All 47/12/4 executions fenced nineteen source/lockfile fingerprints before and after execution. Recording the results changes only this document pair, not product code or tests. The author read the complete reports/logs and inspected 10+6 screenshots; the B-13 executor also independently inspected its six screenshots. Both UI runs used the fixed feature checkout and isolated PostgreSQL/HTTPS/OPFS: Web PIDs 33250 and 67349 on 3188, API on 3197, neither port listening after cleanup. The global Workspace warning stays visible; successful source flows in the limited fixture do not certify whole-application deployment acceptance.

Old reviews cover only 732970dd, not this correction. This record does not replace exact-HEAD independent review and isolated merged acceptance of the fix. The operator deferred 100k for this turn; old failures remain. Native picker and protected primary/backup deployment have not been verified.

## Risk and scope

Behavior: bounded runtime accounting restart. Data: no schema/persistence changes or deletion of sources, caches or history. Security: failure still closes the gate; restart eligibility and bounds require particular review attention. Contract: File B capacity and immutability requirements unchanged. Irreversibility: none. Implementation is isolated on `fix/f001-cache-scan-race`, preserving unrelated commits in shared main.
