> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [source-truth, performance, transactions, validation]
doc_kind: bug-report
created: 2026-09-07
---

# F001 scale pilot: per-file disposition transaction overhead

## 1. Reporter and reproduction

Reported by 砚砚 / gpt-6-astra during implementation acceptance, using isolated PostgreSQL 16.15, a controlled HTTPS Git repository, and a generated directory:

```sh
node src/cli/source-truth-pilot.js --files-per-source 50000 --postgres-bin <isolated-toolchain-bin> --max-tree-rss-mib 1024 --max-tree-fds 1024
```

Expected: verify three complete versions, transfer only changed bytes, and replay historical evidence after moving the sources away and restarting the database within the declared 3600-second managed-command and resource budgets. This is a local acceptance budget, not a product performance commitment.

Actual: `a1292a3` timed out during the first capture. After optimizing single-write ingestion for small files, `3552b16eac1d578ca6286fcdba0bc0ade6904a52` froze all three versions but still reached 3600 seconds during offline replay, without a final `PASSED`. Freezing versions, finishing byte transfer, or passing a smaller pilot does not constitute complete 100k acceptance.

Sampled peaks in the second timeout: Node RSS 276512768 bytes, process-tree RSS 433586176 bytes, and 621 process-tree file descriptors, with zero sampling errors. These observations do not exclude peaks between samples. Preserve the failures rather than increasing budgets to hide the problem.

## 2. Root-cause evidence

Call chain: `SourceCaptureRunner.capture/captureGitFiles → SourceMaterialRepository.dispose → withLease → current authority/lease/source/item validation → UPDATE → COMMIT`.

Contents were already verified file by file, but each Git file and reusable directory file also committed a separate disposition transaction. Manifest enumeration already used bounded bulk writes; disposition did not use the same transaction granularity.

Measurements from `test/support/source-truth-profile.js 100` on the same isolated toolchain, with 100 Git files and 100 directory files through three complete versions (nested timings overlap and must not be added):

| Capture measurement | Before | Batched disposition |
|---|---:|---:|
| Disposition calls | 310 individual calls | 11 batches |
| Cumulative disposition time | 1346 ms | 107 ms |
| SQL BEGIN, including transitions | 315 | 16 |
| SQL SELECT | 1936 | 142 |
| CAS verification calls | 501 | 501 |
| Total capture time | 3757 ms | 2203 ms |

Single-run timings depend on host load and only support diagnosis. Regression tests protect the reduction in transaction count and unchanged verification count; these timings are not extrapolated to 100k files or deployment performance. Other phases still require content I/O, full manifest traversal, and admission revalidation.

## 3. Fix and safety constraints

- At most 500 metadata dispositions per transaction. Capture keeps its existing pages of at most 100 items, and Git retains its existing batch-byte ceiling.
- Each batch enters the original `withLease`, validating current maintainer authority, run generation, lease, and recovery state, and locking the exact items in the frozen manifest.
- Validate the whole batch before the bulk UPDATE. Duplicate paths, missing items, content mismatches, terminal rewrites, or database errors cannot leave partial dispositions.
- Individual upload publication retains its original transaction path. Both paths share one disposition validator; no new endpoint lets a client claim VERIFIED.
- Preserve native Git object verification, full-byte CAS verification, and cancellation checks. A later corrupted native frame or cancellation prevents all dispositions in that batch from being confirmed. Written but unconfirmed CAS objects are not a frozen Bundle.
- Receipt, Gap, explicit confirmation, and F002 admission contracts remain unchanged. Timeout, concurrency, memory, and FD limits are not increased.

## 4. Verification

- RED: 205 directory files already present in CAS required 206 lease transactions during capture, failing the expected three disposition batches plus one transition.
- GREEN: the same test uses four transactions, still verifies each file, completes every disposition, and does not automatically publish a Bundle.
- Invalid batches, duplicate retries, database-trigger rollback, tenant isolation, authority revocation, stale generations, and refusal after cancellation pass.
- Real PostgreSQL multi-connection checks show no disposition visible before commit. When a revocation transaction acquires the authority fence first, the subsequent batch is refused after revocation commits.
- The material, capture, postgres, git-batch, and upload suites passed 31 targeted tests with zero skips. A separate four-test git-batch run includes the new later-frame corruption/cancellation regression.
- The modified 100 Git + 100 directory pilot passed three-version freezing, incremental transfer, and source-offline replay. Syntax checks and `git diff --check` passed.

## 5. Full-scale rerun on 2026-09-07

Exact commit `bcb21acf54a7fb82e4bbac4edd8bd6da1d8a36d6` used the command and budgets in section 1. Managed task `hold-ball-1788769575273-cwutbs` exited 0 after 3596 seconds and produced a final `PASSED`. The original report is preserved field for field in [pilot-100k-bcb21ac.json](pilot-100k-bcb21ac.json); success is not inferred from a progress tail.

| Phase | Measured duration (ms) |
|---|---:|
| Generate 50,000 Git + 50,000 directory files | 188000 |
| Capture and freeze A + D1 | 2324228 |
| Git B reusing D1 | 316124 |
| Fully enumerate D2, transfer incrementally, and freeze | 360695 |
| Move sources away, restart database, and replay history | 402307 |

- The report retains the exact identities of all three frozen Bundles. The Git update directly reuses D1; D2 verifies one addition, one modification, and one deletion while retaining complete version history.
- Initial directory transfer was `2883540` bytes; cumulative transfer was `2883576`, so the increment was only `36` bytes. Directory reuse was `3143414` bytes. Two complete enumerations still read and hashed `6026990` bytes; incremental transfer does not mean no scanning.
- After moving sources away and restarting PostgreSQL, fresh services fully revalidated admission evidence and counted paginated inventory for the first and third versions, rather than merely checking for Receipt fields. The second version passed freezing and component-reuse validation but was not independently replayed during this offline phase.
- Across 3597 one-second samples: peak Node RSS `293896192` bytes, peak process-tree RSS `473268224` bytes, peak process-tree FD count `523`, and zero sampling errors. Original budgets remained `1073741824` bytes and `1024` FDs. Sampling is not proof of continuous hard enforcement.
- Environment: macOS `25.5.0`, Node `v25.6.0`, isolated PostgreSQL `16.15`, and controlled HTTPS Git. The dataset is predominantly small files, and this single run nearly reaches the 3600-second limit. It does not establish a deployment SLA or large-file/concurrent-workload performance.
- The full source regression, frontend build, web source tests, and 1,000 Git + 1,000 directory calibration had previously exited 0 on the same commit. This full-scale result does not erase the two timeouts in section 1.

## 6. Acceptance still open

The 100k service-path rerun passed. Aggregate Git-cache budgeting, the browser eight-station journey, repository-wide gates, and two independent reviews are still outstanding. The report explicitly records `browserVerified=false` and `disasterDeploymentVerified=false`; an isolated service pilot is not browser or independent-failure-domain deployment acceptance. This is neither a Feature completion claim nor a formal branch review.
