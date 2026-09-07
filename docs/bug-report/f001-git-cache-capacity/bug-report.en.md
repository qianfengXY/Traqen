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

The locking adapter is macOS-only, like existing protected-volume validation. A configuration boolean cannot claim support for another platform. Locking and API-owner crash tests use a trusted fixture writer; successful capture/history and the interrupted-fetch test below use real HTTPS Git. The fixture writer is not a substitute for native download recovery evidence.

The targeted combined command `node --test test/source-truth-git-capacity.test.js test/source-truth-git.test.js test/source-truth-git-batch.test.js test/source-truth-git-target.test.js test/source-truth-configuration.test.js test/bilingual-documentation.test.js` returned exit 0: 22 passed, 0 failed, 1 skipped. `git diff --check` also returned 0.

Those are the initial targeted results. At that time, the real PostgreSQL entry test was skipped because host restart removed the isolated toolchain.

## Fixed-commit verification at `59a7b51`

The isolated PostgreSQL 16.15 toolchain was rebuilt from its SHA256-verified official archive. The managed command completed in 320 seconds with exit 0; build, source regression, and 2,000-file calibration each returned 0, and their complete logs were read. Source regression passed **128/128 with no skips**, including real PostgreSQL multi-connection/transaction/restart, paired backup, and isolated production-entry checks. This is not the whole-repository gate.

The real service report `tq-f001-pilot-d0bjAv/report.json` is PASSED: Git 1,000 + directory 1,000, three sealed versions; directory bytes 1,083,540 → 1,083,576, a 36-byte increment; database/storage reopen and historical replay with sources offline passed. Phase times: generation 2,107ms, initial capture 33,600ms, Git update with directory reuse 3,884ms, directory update 2,406ms, offline replay 4,081ms. Across 54 samples, peak Node RSS was 229,703,680 bytes, process-tree RSS 304,021,504 bytes, FD 424, and sampling errors 0. Budgets remained 1 GiB / 1024 FD. Both `browserVerified` and `disasterDeploymentVerified` are false.

## Real fetch interruption and recovery

- Reproduction: the `59a7b51` feature checkout plus a new regression; random-port loopback HTTPS, real `/usr/bin/git`, and private temporary repositories, without production ports, data, credentials, or an old deployed runtime. Capture A, then commit a 512 KiB random file as B. Apply test-only backpressure to the real pack response and cancel only after native Git creates its own `shallow.lock`.
- RED: `node --test --test-name-pattern='interrupted real HTTPS' test/source-truth-git.test.js` returned exit 1, one failure. A fresh gateway retry of the same B failed at fetch with `SOURCE_GIT_TRANSFER_FAILED`. No Git writer remained, and the outer cache lock was released, but `shallow.lock` and `tmp_pack_*` remained. Native `fetch --dry-run --depth=1` against that isolated repository returned 128 and specifically reported `shallow.lock: File exists`. SIGKILL releases kernel locks but cannot run Git's temporary-lock cleanup; outer-lock release alone does not prove resumability.
- Fix: only the trusted write supervisor, while holding the exclusive kernel cache lock, recovers known metadata locks: `HEAD.lock`, `config.lock`, `packed-refs.lock`, `shallow.lock`, and exact capture-ref OID locks owned by this service. Only private single-link regular files owned by the service user qualify. Symlinks, hardlinks, directories, public permissions, and unsafe recovery directories are rejected. No age/PID heuristic substitutes for exclusive ownership.
- Retention: rename preserves the original inode/bytes under `.interrupted-locks/recovery-*/original-relative-path` in the same repository. Directories are synced, then aggregate capacity is checked again before Git starts. There is no TTL, automatic deletion, or interpretation/publication of interrupted lock contents. Existing refs, packs, indexes, unfinished packs, and unknown lock names stay in place. Recovery directories still count toward capacity.
- GREEN: the same real HTTPS regression passes, including a contender that cannot move the active native lock, a fresh gateway obtaining the intended B after cancellation, preserved lock inode/bytes, and replay of A. Combined capacity/process/metadata-safety tests pass 14/14 with no skips. The interruption test has a 20-second deadline and a five-second pack-start deadline; cancellation targets only its own fixture download.

The old `bcb21ac` 100k PASSED and two earlier timeouts remain unchanged, proving only their exact prior commits, not performance of this new process topology. The recovery delta still needs full source regression. The full browser matrix, whole-repository type errors, two independent exact-HEAD reviews, and merged acceptance remain open.
