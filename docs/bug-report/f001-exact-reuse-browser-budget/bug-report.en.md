> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [source-truth, exact-reuse, browser-capacity]
doc_kind: bug-report
created: 2026-09-09
---

# Cross-policy exact component reuse and browser capacity diagnosis

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
