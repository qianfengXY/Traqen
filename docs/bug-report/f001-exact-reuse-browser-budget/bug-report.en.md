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
