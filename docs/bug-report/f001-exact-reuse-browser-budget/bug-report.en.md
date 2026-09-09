> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [source-truth, exact-reuse, browser-capacity]
doc_kind: bug-report
created: 2026-09-09
---

# Cross-policy exact component reuse and browser capacity diagnosis

## 75e5d44 full-path allocation observation: RSS cause remains unknown

One full-path diagnostic at exact HEAD `75e5d441425c35c96d784c941ad3adbbc5c880fc` took 696s and exited 1 at the unchanged 1 GiB RSS assertion, script line 209. The [original report](memory-75e5d44-failed.json) has SHA-256 `3cff2ee0a3d7479cd2785a59708aa127339509d594d8493c71a41b8a37089b8a`, `acceptanceGate=false`, `allocationSamplingDiagnostic=true`, and `explicitGcDiagnostic=false`. It is neither a new acceptance run nor a replacement for b44's failure.

Execution order, original report and the inspected review / delta screenshots agree: 101 batches of at most 500 entries, full enumeration of 50,000 files / 102 directories, one uploaded file of 28 bytes, and one creation, explicit confirmation and seal each. The new bundle remains `85d64a43970caa29a3f134cc7dded2327864a606a8939534803a1966a31c48f7`. Exact Git component deep equality, three unchanged old bundles and database history, and a single MODIFIED Delta for `materials/g0000/f000003.txt` passed before the RSS assertion. No out-of-scope writes, F001 HTTP errors or page exceptions occurred. Peak FDs were 729, but the FD assertion follows RSS and did not execute.

| Observation | Tree RSS | Chromium browser / renderer RSS | JS used / total | Embedder / backing |
| --- | ---: | ---: | ---: | ---: |
| Browser start | 549765120 | 82313216 / 75317248 | 531956 / 1048576 | 1386752 / 0 |
| Workbench ready | 836861952 | 95076352 / 265748480 | 13815508 / 16859136 | 6992968 / 6382986 |
| OPFS generation end | 876347392 | 225951744 / 297484288 | 17310976 / 34160640 | 6408536 / 6398739 |
| Full enumeration and incremental capture end | 1324269568 | 315768832 / 428032000 | 37171620 / 80297984 | 7816616 / 6461358 |
| Explicit confirmation and freeze end | 1286619136 | 319291392 / 379092992 | 16014628 / 18694144 | 5971384 / 6642428 |
| Failure observation | 1313718272 | 319586304 / 387645440 | 12984028 / 19480576 | 4749968 / 6359836 |

Units are bytes; browser / renderer exclude the GPU / network processes separately listed in the report. Across 700 error-free samples, peak tree RSS was 1,481,310,208 bytes: Chromium 878,477,312, Node 397,688,832 and PG 205,144,064 (including transient `(postgres)` names). JS figures are stage observations, not whole-run peaks. DOM counts were 8 → 1112 → 723 → 3258 → 697 → 883, with non-monotonic listener counts too; neither proves the absence of leaks.

All six original allocation profiles were traversed. The [derived summary](memory-75e5d44-allocations.json) preserves original SHA-256 hashes, sample counts and allocation-location groups. Nonempty profiles contain only 66–80 samples, with estimated live allocation totals of 4,829,640–5,930,884 bytes, dominated by V8 API, React development runtime and anonymous calls. At capture end, `transfer.ts` has only one approximately 64 KiB sample. No JS allocation group proportional to all files was observed, but sparse coverage cannot rule out transient large allocations or native retention. Allocation stacks are not retaining paths and do not measure Chromium native heaps. Profiling may itself affect reclamation, so lower RSS than b44 is not evidence of an improvement.

Capsule continuation: (1) the full business path still exceeds RSS; (2) evidence comprises the original report, six profiles, the complete 88-line JSON log and two screenshots; log SHA-256 `bcca57f25358d256cb041a112ddc5ffedb2b9c69202e5bcb6ae53e8bd01ec5f2`; (3) no attributable root cause yet: workbench startup, OPFS generation, enumeration and server work all increase RSS, and current JS evidence cannot explain the excess; (4) next, ask a non-author peer to examine the same raw evidence and accounting, then select one controlled experiment separating native allocation, allocator high-water marks and development-runtime costs, without repeating full-path sampling; (5) bound one diagnostic round to 20 minutes and return hypotheses/open questions if no new evidence emerges; (6) preserve full enumeration, hashing, both getFile change checks and IDB backpressure; no forced-GC acceptance, browser/preparation exclusions or relaxed budgets; (7) no UX change yet; (8) only after establishing ownership, perform behavioral RED → GREEN and rerun the original natural-reclamation full gate. The intermittent Git 503 cause also remains unproven.

This round archives evidence only, changing neither product nor observer. API 3197 and diagnostic PID 11808 / Chromium 12255 / PG 12238 have exited. Web 3188 LISTEN PID 16962 started Mon Sep 7 07:00:29 2026, with cwd in this feature's web checkout. Target and worktree HEAD are 75e5d44, committed 2026-09-09 03:31:47 -07:00; PROCESS_AFTER_TARGET=no does not establish stale code in a hot-reloading dev server. No separate API startup log is available; LOG_EVIDENCE is not invented. Original pilot / PG remain unopened and unchanged; no backend rerun, CUA or production operation. Current wake `0001788950717036-000067-44ad64d3` received applied invocation-bound handled disposition. Parent remains doing, workflow v12 unchanged. F001 is unfinished; no push or merge.

Archive checks: bilingual documentation 2/2, zero skips, exit 0 (426ms); the byte-for-byte report SHA-256, all six original profile hashes, stage/peak process RSS sums and each allocation-group sum agree; `git diff --check` passed. No behavior changed, so the TDD risk entry does not call for an artificial duplicate RED. Neither the green backend suite nor the failed scale gate was rerun. Archiving and diagnostic discussion are not independent formal review and publish no Issue.

## cb8bccb isolated scanner observation: not acceptance

The 50k diagnostic exited 0 in 281s. Original [memory-cb8bccb-observed.json](memory-cb8bccb-observed.json): `OBSERVED_NOT_ACCEPTANCE`, `acceptanceGate=false`, `explicitGcDiagnostic=true`. Both scans returned 50,000 files / 102 directories / 50,102 rows / 3,087,392 bytes with manifest `516fddfe191fb89759f2a2e6bb3319fa4d174678038eb34bfedb4cdcf2bb32b6`. There were 283 error-free samples, a sampled peak of 840,695,808 bytes and 105 FDs. This page has neither the full workbench nor PostgreSQL and includes explicit GC. None of its low values replaces b44's FAILED result or the 1 GiB gate.

| Stage | Tree RSS | Chromium RSS | JS used / total | Embedder / backing |
| --- | ---: | ---: | ---: | ---: |
| Before generation | 487456768 | 274055168 | 1666724 / 2686976 | 1386752 / 12933 |
| After generation, natural | 612646912 | 378585088 | 5008692 / 21299200 | 2976440 / 42137 |
| After first scan, natural | 727842816 | 603537408 | 14250188 / 58785792 | 1388896 / 888016 |
| First GC, diagnostic only | 680165376 | 554549248 | 1331240 / 2162688 | 322360 / 12992 |
| After rescan, natural | 798818304 | 678313984 | 21506004 / 54591488 | 2303168 / 2708679 |
| Second GC, diagnostic only | 744849408 | 624132096 | 1321436 / 2162688 | 334480 / 12983 |

All units are bytes. JS/embedder/backing sizes fall after both GCs; listeners return from 34 / 64 to 15. This does not support a scanner retaining the complete 50k file set as reachable JS. After the two GCs, the Chromium main process still uses 344,457,216 / 385,761,280 bytes and the renderer uses 171,606,016 / 199,278,592. Native delayed reclamation, allocator high-water marks and leaks remain indistinguishable from these observations.

Updated capsule: symptom, b44 failure and budgets unchanged; evidence adds the original report and complete 33-line log (SHA-256 `d7a6b512858e8b29ddfef6100ca51b36f94b9c01688e83ffbee9a2898f44900c`). The remaining hypotheses concern additional full-workbench runtime, progress/polling or File API native resources; no root cause is established. Client, read observer and workbench inspection show no unbounded history array. Next, instrument the original full capture path with exact heap, process roles and live allocation stacks at browser start, application start, generation, capture and freeze boundaries. Allocation profiling is diagnostic and cannot produce an acceptance PASS. Timeout remains 3600s; retain failures and do not reopen or modify the original pilot/PG. If ownership is still unknown, narrow the variable instead of patching product logic or budgets. UX is unchanged; acceptance still requires the original natural-GC full gate. Current managed wake `0001788949046335-000061-f79d4c13` has applied handled disposition; the parent remains doing.

Reporter: 砚砚 / gpt-6-astra. Failed baseline: `60374e6142d3c379964c1a1fe85c2d441d089ded`. This is not an independent review or completion claim.

## Diagnosis capsule

| Field | Evidence and action |
| --- | --- |
| 1. Symptom | The browser enumerated 50,000 directory files, sent only 28 bytes, and explicitly froze a combined 100,000-file bundle. Exact Git component equality failed. Sampled tree RSS separately exceeded 1 GiB. |
| 2. Evidence | Managed command 673s / exit 1; pilot 2/2, zero skips, exit 0; browser exit 1. The original [browser-60374e6-failed.json](browser-60374e6-failed.json) is retained. 101 batches, at most 500 entries; one upload, one confirmation and one seal; no page errors. |
| 3. Hypothesis / cause | `SourceCandidateService.component` rebuilds both UPDATE and REUSE components with the new run.policyRevisionId. The retained pilot and browser fixture use different policies, changing component identity. File B §§7.4, 8.3 and 10.1 require original component identity on REUSE. The RSS cause is not yet established and is independent of that identity error. |
| 4. Strategy | Reproduce Git and directory REUSE under a changed policy using a small real service fixture. Preserve evidence verification and current bundle policy. Add process attribution to separate OPFS generation, browser enumeration, server and test transport costs. |
| 5. Timeout | If the small regression cannot reproduce within 20 minutes, narrow the call chain. The scale run remains bounded to 3600s; no blind retries. |
| 6. Red flags | Do not remove deep equality, force the old policy to hide the bug, relax the 1 GiB / 1024 FD budgets, or call sampling a hard quota. Keep FAILED when attribution is incomplete. |
| 7. UX correction | Exact reuse retains the original identity, policy and upload provenance; the new bundle can record current policy. Missing bytes still block; no silent recapture or replacement. |
| 8. Acceptance | Cross-policy Git and directory regression is RED → GREEN; capture, admission, real-PG small pilot and documentation passed 18/18, zero skips, exit 0. The extended regression also checks immutable old policy and current capacity limits. Final old-history, delta and budget assertions in the 60374e6 browser run did not execute; it remains FAILED. Native picker, initial full upload and disaster deployment remain unverified. |

## Reproduction and separate findings

Freeze Git plus directory under the old policy. After the platform policy changes, create a version from that exact bundle, keeping Git in REUSE and directory in UPDATE. Capture, explicitly confirm and seal. The old implementation reuses bytes but rebuilds Git identity.

The original component `ff6371d0b6574a4d39acdcd2704ca1c88a0cce0375656159dfb42c7500789c3e` becomes `c7d43d37f66bddd5db7ba130c70225f6dd783767d264b50b04bd96e69fa1d729`; manifest, coverage and native commit stay unchanged. Preparation must verify exact baseline membership and material before returning the original component, not merely omit policyRevisionId from comparison.

658 samples: Node peak 295,075,840 bytes, total tree peak 1,612,595,200 bytes, peak FDs 1023, zero sampling errors. The original report lacks per-process attribution. OPFS generation already approached the budget; these totals cannot establish a JS or server leak. Memory remains a separate open issue.

## Runtime and data boundaries

API port 3197 had exited by diagnosis: no LISTEN PID. Managed command PID 55792 is not evidence of the API PID. Web port 3188 LISTEN PID 16962 started Mon Sep 7 07:00:29 2026, with cwd in this feature's web checkout. Runtime HEAD and target are 60374e6 (committed 2026-09-09 01:11:48 -07:00). The dev process predates this test-only commit and hot-reloads; this does not establish stale product code. The structured report provides no API PID log field; LOG_EVIDENCE is unavailable rather than fabricated.

The original 39d database and materials were never reopened or modified in place. Only the new isolated copy received writes. Screenshots and complete logs remain in the private temporary evidence directory, and the original JSON is archived here. Tests clear external database/production configuration and do not trigger CUA approval.

## Correction and verification evidence

`node --test --test-name-pattern='cross-policy REUSE' test/source-truth-capture.test.js`: after correcting a test-fixture wiring error that passed a capture service instance into the runner, the actual RED showed changed IDs for both reused components (exit 1, 8.246s). Fixing only preparation then exposed `SourceAdmissionService.qualify` requiring component policy to equal bundle policy. Both checks shared the same incorrect assumption; this was not a security boundary to relax.

Preparation now fully verifies manifest, coverage and blobs, then checks exact baseline membership, original structural digest, source/scope/native identity and counts under current permission and lease fences before returning the original component. It creates no new component or Gap copy. Admission still verifies the component digest and Workspace/source bindings but no longer equates its original policy with the new bundle policy. Current policy bindings across bundle, confirmation and Receipt remain unchanged. Database append-only protection retains original policy, while current bundle capacity limits still apply during capture advancement.

The same regression is GREEN (1/1, zero skips, exit 0, 8.819s): current bundle policy, exact original components and database rows, no new transfer, original directory upload provenance, rejected original-policy rewrite, blocked missing bytes, and enforced tighter capacity. During negative-test development the append-only table correctly rejected direct modification; the test now asserts that rejection instead of disabling database protection.

Related verification: `node --test --test-concurrency=3 test/source-truth-capture.test.js test/source-truth-admission.test.js test/source-truth-pilot.test.js test/bilingual-documentation.test.js`, with external configuration cleared and isolated PG binaries selected: 18/18, zero skips, exit 0, 42.354s. Real PostgreSQL admission recovery/revocation and the small HTTPS Git plus directory pilot actually ran. Whole-repository and updated scale-browser checks remain pending; previous green results are not new-HEAD verification.

Resource attribution first failed because `peakRssProcesses` was absent (exit 1, 0.784s), then passed after recording owned PID/PPID/executable/RSS (exit 0, 0.857s). Only latest and peak process samples are retained, without command arguments or environment. Peak details must sum to the unchanged tree RSS metric. Each browser phase also records final tree details and coarse JS heap/DOM measurements. No forced GC, excluded browser processes or relaxed budgets were introduced. This improves diagnosis and does not resolve the memory issue.

Archived and original report SHA-256 match: `0fcd7751d49c56417bb0fa331afd19b4ce53ea433b13c49849009b94ef84c130`. The old wake's invocation-bound `handled` was applied; the parent task remains doing.

Five-axis risk: exact-reuse behavior; no migration or rewriting historical data; current authority, lease and content integrity retained; file B's component/bundle policy distinction restored; no production or irreversible actions. Architecture boundaries and UI are unchanged, with no matching `.pen`. This repository does not register Clowder's pnpm gate; its full backend suite and scale-browser path are the next checks. F001 still lacks resolved scale budgets, native picker, initial full-upload browser evidence, dual independent exact-HEAD review and protected physically independent primary/backup deployment acceptance. Nothing has been pushed or merged.

## b44d3ca whole-repository and browser return: memory diagnosis remains open

Exact HEAD `b44d3ca6097c225d4261b6c91e236b739dc7b51d`: backend at concurrency three passed 567/567, no failures/skips/cancellations, 300.967s, exit 0; the subsequent browser exited 1. Git 503 did not recur, which does not establish a fix for its intermittent cause. The original [browser-b44d3ca-failed.json](browser-b44d3ca-failed.json) remains FAILED with its original flags.

Assertion ordering and the review/delta screenshots establish the following before the RSS failure: all 50,000 directory files and 102 directories enumerated in 101 batches (maximum 500); one 28-byte file upload, one explicit confirmation and one seal; 100,000-file READY bundle with zero Gaps; exact Git component deep equality, all three prior histories unchanged, and a single MODIFIED delta. New bundle: `85d64a43970caa29a3f134cc7dded2327864a606a8939534803a1966a31c48f7`. No out-of-scope writes, page errors or F001 HTTP errors. Observed peak FDs were 736, but the FD assertion follows RSS and was not executed; the resource gate did not pass.

744 samples and zero sampling errors: peak 1,944,518,656 bytes, comprising Chromium 1,315,962,880, Node 368,508,928 and PostgreSQL 260,046,848. OPFS generation already ended at 1,089,241,088 bytes; scan/incremental capture ended at 1,641,578,496 and freezing at 1,590,345,728. The coarsened 29.4 MB JS heap cannot establish an absence of retained JS objects.

| Capsule field | Current memory investigation |
| --- | --- |
| 1. Symptom | The business path completed, but tree RSS reached about 1.81 GiB against the unchanged 1 GiB limit. Fixture preparation alone already exceeded it. |
| 2. Evidence | Exact-HEAD report and phase/process attribution above. Web 3188 PID 16962 started Sep 7 07:00:29 with cwd in this feature web checkout; HEAD and target are b44d3ca. API 3197 and capture PID 93088 / Chromium 93468 have exited; their start times cannot be invented. PID 93088 samples are not start-time evidence. A dev process predating a test commit does not prove stale product code. |
| 3. Hypothesis | Source inspection shows no whole-tree File/Handle array: sequential file reads, 500-entry IDB batches, UI progress replaced at most every 100ms. Hypothesis: asynchronous File API temporaries/native resources are reclaimed late within the page lifetime. RSS alone does not prove a product leak. |
| 4. Strategy | In an isolated blank page, load the actual product scanner and IDB modules; measure generation and scanning with exact JS/embedder heap and the full process tree. Use explicit GC only as a labeled diagnostic comparison, never as budget-pass evidence. |
| 5. Timeout | Bound diagnosis to 20 minutes. Smoke-test a small fixture, then one 50k targeted observation without cloning the old PG or repeating the backend suite. |
| 6. Red flags | Do not omit the second getFile mutation check, empty directories, full hashing or bounded IDB storage. Do not exclude Chromium/preparation, loosen budgets or force GC to obtain a gate PASS. |
| 7. UX | No UI/design change yet; identify the resource owner before implementing a correction. |
| 8. Acceptance | Diagnosis is not delivery. After a deterministic regression, the original browser-scale gate must naturally pass its original 1 GiB / 1024 FD limits. Native picker, initial full upload and disaster deployment remain unverified. |

Diagnostic entry point `test/support/source-truth-browser-memory.mjs` uses a fresh temporary browser context and a random loopback port, blocking external network access. It compiles and records source hashes for the actual product directory scanner, streaming hash and local-entry store. It loads neither the workbench nor a database, does not simulate File APIs, and is not a whole-application budget comparison. The 20-file smoke exited 0: three directories, 1,049,252 bytes, 23 rows; both full scans produced `f2df25f292d7d96392682effb9605c991354a8b98c7706b1d3539eb6d639480a` with zero sampling errors. The report is explicitly `OBSERVED_NOT_ACCEPTANCE` / `explicitGcDiagnostic=true`, SHA-256 `e4ac6ac23f1db912c555c44a5d724647309c8a3cc007999195cde05423777de7`. Exact JS/embedder heap comes from `Runtime.getHeapUsage`, checked against the installed Playwright CDP definitions, rather than conclusions based on coarsened `performance.memory`.

Targeted self-checks: process-attribution regression 1/1, zero skips (961ms); bilingual documentation 2/2; new-script syntax and diff checks passed. This delta only adds test diagnosis and retained evidence: no production behavior/data/authority/contract/architecture changes, irreversible actions or UI changes; no matching `.pen` or root media delta. This repository has no Clowder hotfix/fallback/tips checker, so none is claimed to have run. Archived failure SHA-256 `f4b606d83feb3098cdae6f5ca3d1f224b0c512496147c5a0e4f3a550ebcead3c` matches the temporary original byte for byte. Managed wake `0001788947915564-000056-f584532f` has an applied invocation-bound handled disposition; the parent remains doing. The 50k diagnosis is next, not a new acceptance PASS.
### Current diagnostic-tool self-check

Two regressions first failed because the full-browser allocation observer was absent (two failures, 349ms), then passed after implementation (2/2, 345ms); static imports were subsequently restored and rechecked. A real isolated blank-page smoke with Chromium 151.0.7922.34 exited 0, returning 52 allocation samples, JS used 3,822,964 / total 7,815,168 bytes and all four browser process types, without GC. The full capture now accepts optional `--heap-diagnostic`, saving exact heap and raw sampled profiles at browser start, workbench readiness, generation, capture and freezing. Sampled allocations are neither a precise retaining-path graph nor RSS; an allocation function alone does not establish a leak. This mode has `acceptanceGate=false` and can only return `OBSERVED_NOT_ACCEPTANCE` even when budgets pass; failures remain FAILED. The original non-diagnostic enumeration, exact reuse, old history, Delta and 1 GiB / 1024 FD assertions are unchanged.

Diagnostic tests 2/2 and docs 2/2 (4/4 total, 348ms); original process-sampling regression 1/1 (916ms), syntax and diff passed. Original cb8 report and archive share SHA-256 `9625f7dff590dbcbc1a9cdbbcf105d0a40ca3b20cf0723ecd17c6bd42f13a0b7`. Five-axis risk is confined to test diagnostics and evidence: no production behavior, data migration, authority, contract, irreversible or design changes; no new architecture boundary, matching `.pen` or root media. Clowder-specific checkers are absent here. The full browser budget failure remains open; this is not F001 completion or formal review, and independent review still follows successful verification. No push or merge.
