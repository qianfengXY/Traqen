> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [git, storage, capacity, process-lifecycle]
doc_kind: bug-report
created: 2026-09-07
---

# F001 aggregate Git cache capacity and execution lifecycle

Author diagnosis: 砚砚 / gpt-6-astra. Not independent review or F001 completion.

## Diagnosis

At `899c896`, native Git had a per-file `ulimit -f`, but no shared watermark across packs, indexes, retained failures, and source registrations. A real HTTPS regression first captured a replayable commit, then attempted another registration with a one-byte cache budget. The original gateway succeeded: RED, Missing expected rejection.

The investigation follows file B §8.4 and separates process limits, application watermarks, and filesystem hard quotas. Native regression processes have 6–10 second test deadlines; dedicated long-lived fixtures exit within 20 seconds and cleanup targets only their exact process group. No historical data deletion, relaxed pilot budget, or skipped PostgreSQL check is treated as success.

## Implementation

- Private deployment configuration accepts `resources.maxGitCacheBytes`, defaulting to a finite 4 GiB watermark. Decimal strings or safe integers are accepted; arrays, malformed strings, and imprecise numeric values are rejected. `storage.minFreeBytes` also applies to the Git filesystem.
- Before init/fetch creates source directories, a cache-wide cross-process lock protects admission. Accounting includes every registration, failed residue, index, and directory, conservatively using the larger of logical size and allocated block bytes. Admission checks occupancy, free space, and `maxPackBytes + 1 MiB` headroom.
- Traversal is bounded to 100,000 physical entries, depth 16, and 32 opendir entries per buffer. Symlinks, unsafe types, and incomplete measurements fail closed instead of becoming zero usage.
- During native writes, a 100ms timer attempts complete measurements with at most one outstanding scan. A final measurement also runs after native exit: exit 0 cannot hide aggregate exhaustion. Exceeding the watermark terminates the dedicated process group without deleting materials.
- macOS `lockf` serializes writers across the entire cache, failing contention immediately rather than waiting without bound in HTTP requests. The lock inode is retained; kernel release handles cancellation, failure, and normal exit without expiring or deleting possibly active lock files.
- Native Git never receives the private control channel. If the API owner crashes, the supervisor observes channel closure and terminates the group, preventing an orphan from holding the cache for its remaining lifetime. Public failures do not echo remote stderr, credentials, local paths, or other Workspaces' aggregate usage.
- Exhaustion is `SOURCE_CAPACITY_EXHAUSTED` / 507; contention is `SOURCE_GIT_BUSY` / 429. Both use existing retryable failure handling. Capacity rejection of new writes does not disable historical reads.

## Red–green evidence

1. The original gateway's ignored aggregate budget failed the new assertion. The implementation passes the four real HTTPS Git tests: capacity/history, moved refs and fixed commits, missing roots/redirect rejection, and verified batch reads.
2. The first supervisor passed lockf's FD 3 into the child and broke normal captures. A separate descriptor experiment showed lockf closes that descriptor on exec; Node had reused it for its event queue and spawn failed with EBADF. A distinct FD 5 duplicate of the same locked description fixed the regression.
3. The owner-crash test initially failed because native execution retained the lock after API death. Private channel-disconnect handling made the same test pass and allowed a new owner to proceed.
4. An unsafe lock path initially exposed ELOOP, and an array budget initially passed implicit string conversion. Both were reproduced RED before bounded error translation and strict value typing made them GREEN.
5. Capacity tests write two 700 KiB files, each below the 1 MiB per-file limit but jointly above 1,250,000 bytes. Both a successful native exit and a continuing writer are rejected with 507. Other cases cover admission headroom, filesystem free space, competing processes, cancellation/release, retained lock inode, owner crash, preserved historical reads, invalid configuration, symlinks, and stderr redaction.

## Scope and remaining verification

This is an application watermark and backpressure mechanism, **not a filesystem hard quota**. Timer scheduling, full-scan duration, and native writes create gaps. Admission headroom is not a proof of worst-case native write volume. A deployment requiring zero overshoot still needs a separately configured and verified filesystem quota. No host volume, system service, or production data was changed.

The locking adapter is macOS-only, like existing protected-volume validation. A configuration boolean cannot claim support for another platform. Locking and abnormal-termination tests use a trusted fixture writer; successful capture/history tests use real HTTPS Git. End-to-end recovery after killing native fetch midway, including Git's own temporary locks, and new-commit scale calibration still require verification; the fixture writer is not a substitute.

The targeted combined command `node --test test/source-truth-git-capacity.test.js test/source-truth-git.test.js test/source-truth-git-batch.test.js test/source-truth-git-target.test.js test/source-truth-configuration.test.js test/bilingual-documentation.test.js` returned exit 0: 22 passed, 0 failed, 1 skipped. `git diff --check` also returned 0.

Private configuration parsing passes. The real PostgreSQL entry test was skipped because host restart removed the isolated toolchain and must be rerun after rebuilding it. The old `bcb21ac` 100k PASSED and two earlier timeouts remain unchanged, proving only their exact prior commits, not performance of this new process topology. The full browser matrix, whole-repository type errors, two independent exact-HEAD reviews, and merged acceptance remain open.
