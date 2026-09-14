> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [source-truth, exact-reuse, browser-capacity]
doc_kind: bug-report
created: 2026-09-09
---

# Cross-policy exact component reuse and browser capacity diagnosis

## 5de50f6 path-cardinality and context-disposal control: resource owner still unknown

One isolated experiment at exact HEAD `5de50f659a29a8eaa725945e1c02f24565554ad0` exited 0 in 22s. Each arm executed 2,000 `getFileHandle → createWritable → write(empty) → close` cycles, varying path reuse: actual file counts were 1 / 2,000, with zero payload bytes. No product scanner, IDB, workbench, API / PG or forced GC; `acceptanceGate=false`. Internal creation / update work and final enumeration cardinality also differ, so this is not a precise causal estimate of file count on RSS.

The [derived evidence](memory-5de50f6-cardinality-control.json) records original report SHA-256 `da6656fc3d2b72cf6ac9afff1b84943487108f4cce755d188be780533beb5969`, script and two diagnostic-source hashes, all six trace hashes / byte counts and role details; it is not an original-artifact copy. Individual checks matched: six loss-free windows, one malloc dump for each of ten present browser / renderer observations, and 13 / 12 resource samples with zero errors. Immediately after `await context.close()` and again after five seconds, `Target.getBrowserContexts` no longer contained the original context IDs; renderers exited while browsers remained.

| Browser field (bytes) | Same path: baseline → after writes → closed 5s | Distinct paths: baseline → after writes → closed 5s |
| --- | ---: | ---: |
| OS RSS | 85049344 → 153714688 → 162267136 | 85262336 → 153845760 → 169705472 |
| Allocator allocated_size | 5407488 → 20036528 → 7743056 | 5490576 → 32833104 → 9421168 |
| Allocator virtual_committed_size | 13090816 → 28639232 → 22429696 | 13680640 → 42663936 → 28393472 |
| 80-byte bucket allocated_objects_size | 459200 → 2263600 → 1733600 | 459280 → 3080800 → 2062720 |
| Direct-map sizes (not object identity) | None → 1130496 → 1130496 | None → 2244608 → 2244608 |

Repeated writes to a single empty file also produce growth and post-disposal residual, so many distinct live files are not necessary for this observation. After closure, allocated_size drops substantially while RSS rises. This does not establish a leak, identity of surviving objects, completed asynchronous release, or attribution to a still-live context. No allocation types / native stacks are available, and the original 71,319,552-byte block was not reproduced; do not extrapolate to 50k. RSS precedes allocator dumps, instrumentation adds a tracing service, and hierarchical counters cannot be summed.

This round ends with evidence archival, without another aggregate-only experiment or an unsupported product patch. A subsequent memory experiment first needs a new capability that distinguishes a specific owner / lifetime. Under TDD / debugging constraints, there is no product-logic change or resource RED → GREEN claim. Original b44 / 75e5 FAILED results, 1-GiB / 1024-FD / 3600s budgets and original pilot / PG remain unchanged. Intermittent Git 503, Node / PG attribution and complete F001 delivery remain unresolved. Parent stays doing; this is not formal review / APPROVE, and nothing is pushed or merged.

## a649c05 storage-context control: switching environments is not a supported fix

One isolated control at exact HEAD `a649c0502be50480424d63264327b7032c80b2ba` exited 0 in 31s. The same Chromium `151.0.7922.34`, revision `782af9cb30a53f54487e5d2e44738645a8ec457c`, performed identical real OPFS generation and product scanning in a fresh off-the-record context and a fresh disk profile. Both arms returned 2,000 files / 6 directories / 1,127,392 bytes / 2,006 rows and manifest `c38b9081c93881205e172966f9aadb6d4020770a10b4590f7f670f989c6757fd`. Both getFile calls, full hashing, 500-row IDB batches and manifest traversal were preserved. Blank page, random loopback, no API / PG or forced GC; `acceptanceGate=false`.

The [derived evidence](memory-a649-storage-control.json) retains original report SHA-256 `e51e1d421a900cb6a042ba007225bb889e39e53f33aceaaed6d859605bdb3e1e`, diagnostic-script and three product-source hashes, and hashes and byte counts for all six traces. Original artifacts were checked individually: equal counts and manifests, six loss-free windows, and exactly one malloc dump for each of twelve browser / renderer role observations. Both resource samplers had zero errors. This file is a derived summary, not a byte-for-byte copy of the original report.

| Browser process field (bytes) | Off-the-record: baseline → fixture → scan | Disk profile: baseline → fixture → scan |
| --- | ---: | ---: |
| OS RSS | 85016576 → 146702336 → 190758912 | 83935232 → 154566656 → 205307904 |
| Allocator allocated_size | 5434896 → 12658544 → 17841568 | 5007632 → 31372480 → 30758352 |
| Allocator virtual_committed_size | 13025280 → 24150016 → 43040768 | 12206080 → 52690944 → 63275008 |
| 80-byte bucket allocated_objects_size | 454000 → 2418640 → 3445440 | 454080 → 4740080 → 3432880 |

The off-the-record arm has a 2,244,608-byte block after fixture generation and a 4,472,832-byte block after scanning, plus a 1,064,960-byte block. The disk arm has a 17,842,176-byte block at both observations. **Both storage contexts produce large allocations**, but this control did not reproduce the original 71,319,552-byte block; its absence cannot be extrapolated to 50k. Post-scan disk-arm RSS and allocated bytes are higher, so this result does not support switching to a disk context as a memory reduction. One sequential control does not establish that disk mode is generally worse. Browser PIDs differ; the same Node process has different baselines, so whole-tree differences are not a causal storage-mode effect. RSS precedes native dumps, hierarchical allocator counters cannot be added together, and dump-local labels are not object identities.

Terra's read-only return `0001789004893601-000121-8eb35860` also checked Playwright 1.61.1: `page.close()` closes the `_ownedContext` created by `browser.newPage()`. The earlier teardown therefore cannot be explained as merely closing a page while leaving that context open. This does not identify the native allocator owner and is not formal review / APPROVE. This control has no new teardown observation; it does not verify context-ID disappearance or completed resource release.

Disposition: no acceptance-browser switch, product change or repeat of the same 50k collection. Original b44 / 75e5 FAILED results and 1-GiB / 1024-FD / 3600s budgets remain. The next useful evidence must distinguish a specific allocation owner or lifetime rather than repeat aggregate measurements; a product correction still requires reproducible RED first. Current managed wake received applied invocation-bound handled disposition; parent remains doing. Original pilot / PG were not reopened or modified, with no CUA / production operation, push or merge. Intermittent Git 503, Node / PG attribution and complete F001 delivery remain unresolved.

## f55ddf9 native categories: residual bytes do not identify surviving objects

The live task store marks 搬砖工 / gpt-5.6-terra's task `0001788953562561-000085-cee318d6` done. Return `0001788954104918-000096-4ad5d064` is diagnostic delivery, not formal review or APPROVE. The managed command checked exact HEAD `f55ddf963920be06ffc2e73bccc3cd5442c2372e` before one 50k native-category run: 212s / exit 0. The [original report](memory-f55ddf9-native.json) is archived byte-for-byte, SHA-256 `fb15846b9169e334a895693a649a8118485e38d5d81fd03cb58b4d91f68c6866`; all six scanner / diagnostic source hashes match that HEAD. The [derived evidence](memory-f55ddf9-providers.json) preserves all four raw trace hashes and byte counts, per-PID providers and large allocation buckets. Hashes match the originals; each window reports no data loss and exactly one malloc dump per present browser / renderer.

This is an empty page with the real OPFS scanner, without the workbench, API or PG: 50,000 files / 102 directories, 3,087,392 bytes, 50,102 rows and manifest `516fddfe191fb89759f2a2e6bb3319fa4d174678038eb34bfedb4cdcf2bb32b6` match. Both getFile calls, streaming hashes, 500-row IDB write / read batches and manifest traversal remain. `acceptanceGate=false`, no forced GC; 213 error-free resource samples with peak 991,526,912 bytes / FD 115 are not acceptance. The separate tracing service consumes 77,529,088 bytes RSS after scan and 81,543,168 after closure. Diagnostics change the runtime, and RSS is observed before the allocator dump rather than simultaneously.

| Browser PID 35338, same field (bytes except count row) | After fixture | After scan | 5s after page closure |
| --- | ---: | ---: | ---: |
| OS RSS | 178192384 | 397901824 | 450592768 |
| malloc/partitions/allocator allocated_size | 151743936 | 207024928 | 207658288 |
| Same allocator allocated_objects_count | 1061283 | 1498660 | 959182 |
| Same allocator virtual_committed_size | 163446784 | 252903424 | 249593856 |
| Same allocator wasted | 11702848 | 45878496 | 41935568 |
| leveldatabase size | 1525592 | 11745013 | 1458647 |
| shared_memory size | 2064384 | 18661376 | 4538368 |

Expanding the original providers and buckets adds three important limits:

- After scan, `site_storage/indexed_db` reports 10,219,421 bytes; this category is absent after closure. Every observed blob_storage blob_count is zero. This does not exclude all IDB / File API related native costs, but the reported IDB / Blob categories alone cannot explain about 207.7 MB of allocated space.
- Allocator object count after closure is **below the post-fixture count**, not continually increasing. Similar allocated byte totals before and after closure do not prove the same objects remain referenced. The 80-byte bucket reports allocated_objects_size 48,645,040 → 72,778,640 → 49,087,840. Large 71,319,552-byte (68.015625 MiB) blocks increase from one after fixture / scan to two after closure. `directMap_N` labels change between dumps; they are not stable addresses or object identities. The traces do not provide native allocation stacks for these blocks.
- Renderer PID 35345 RSS increases from 108,134,400 to 259,424,256 bytes, then disappears with the process, including its prior baseline. Browser residual bytes, allocator capacity and renderer exit do not independently establish a product leak, nor justify forced GC or page closure as a product fix.

Capsule: (1) original b44 / 75e5 full-path RSS excess remains; (2) evidence adds the complete report, four raw trace hashes and derived buckets; (3) the hypothesis narrows to browser large allocations plus small-object buckets, with the owner unknown; aggregate residual is not identity of surviving scan objects; (4) first establish a capability that can identify allocation stacks or mappings for these blocks before choosing another bounded experiment; (5) stop repeated 50k collection at this archive, not rerunning the same categories when capability is missing; (6) no product changes, weaker scan completeness, expanded 1-GiB / 1024-FD / 3600s budgets or process exclusions to manufacture green; (7) no UX changes; (8) product RED → GREEN requires a proven resource owner and reproducible behavior, followed by the original natural-reclamation complete gate.

Current target / feature HEAD is f55ddf9; old tsbuildinfo is preserved. API 3197 has no listener, and diagnostic Node 35336 / browser 35338 / renderer 35345 have exited. Web 3188 LISTEN PID 16962 started Mon Sep 7 07:00:29 2026, with cwd in this feature's web checkout. Its start precedes the target commit; hot-reloading process age does not establish stale code, and no new API startup log exists to cite. Original pilot / PG remain unopened and unchanged; no new scale / backend run, production operation or CUA. Current invocation-bound A2A handled was applied, without attempting to sign Terra's managed-hold carrier. Parent remains doing / workflow v12; intermittent Git 503 cause, Node / PG attribution and overall F001 delivery remain unfinished.

### Empty-page observer control (no scan)

To test whether repeated observation unconditionally creates the large blocks, a separate temporary Chromium / about:blank blocked all page requests and called the existing native observer ten times. No file APIs, OPFS generation, scanner, API / PG or forced GC were used. The [archived command output](memory-f55ddf9-empty-control.json) records ten loss-free windows and eleven error-free resource samples. Browser PID 45312 RSS increased from 116,801,536 to 135,708,672 bytes between first and last windows; allocator allocated_size increased from 5,174,320 to 5,747,856 bytes, and the 80-byte bucket from 429,840 to 487,200 bytes. No allocator directMap block appeared in any window. This control did not reproduce the 71,319,552-byte blocks or approximately one million objects, so observation count alone does not explain them. It does not exclude an interaction between instrumentation and extensive file operations, identify a product function owner, or provide scale acceptance. The browser was closed in finally.

## 97dda60 teardown verification and native-category capability probes

The live task store now marks 搬砖工 / gpt-5.6-terra's diagnostic subtask done; return message `0001788952344367-000079-79ffcb2c` is not a formal review or APPROVE. The [original report](memory-97dda60-teardown.json) is archived byte-for-byte, SHA-256 `101ce588a5ad91b0e30d2742efb1a2b12f341384e697196f0d6c7d9c44da3775`. Its managed command checked exact HEAD `97dda60d0c33c00a6529a10d790b951a712da83f` before running: 207s, exit 0, 207 error-free samples, `acceptanceGate=false`, no forced GC, API or database.

| Process | Pre-scan RSS | Post-scan RSS | RSS 5s after page closure | Scan increase | Residual versus pre-scan |
| --- | ---: | ---: | ---: | ---: | ---: |
| Browser, PID 22424 | 202555392 | 372277248 | 354107392 | 169721856 | 151552000 |
| Renderer, PID 22427 | 251805696 | 367607808 | 0 (exited) | 115802112 | -251805696 |

Units are bytes: browser residual is **144.53 MiB / 151.552 MB**, not 151.6 MiB. Chromium's total reclaimed 388,808,704 bytes exceeds its scan increase of 290,455,552 because closing the renderer also removes its 251,805,696-byte baseline. Preserve the original automatic `HYPOTHESIS_SUPPORTED_PAGE_RENDERER_SCOPED` label without adopting it as a root-cause verdict. Both processes contribute; this does not establish a React, IDB, OPFS or specific native allocator leak.

This experiment opened the port-3188 development page and blocked other origins, unlike cb8's empty page; application initialization overlaps fixture preparation. It preserves 50,000 files / 102 directories, both getFile calls, streaming hashes, 500-row IDB batches and traversal of 50,102 rows. However, its 3,013,514-byte fixture and manifest `219cea08b139412474fea7e57b0946d4cddfeb73118abcdbbd57a03376640582` differ from b44's D3. Peak tree RSS 948,731,904 / FD 109 cannot replace the failed complete-workbench gate including Node and PG.

Parent-side capability probes used Chromium 151.0.7922.34 with separate temporary profiles. Browser-session `Memory.startSampling` is unavailable. Renderer sampling returned zero samples after retaining 64 64-KiB buffers and operating on 20 OPFS files; browser profiles were also empty before and after. This is missing evidence, not zero allocation. `vmmap -summary` exposed VM categories but explicitly warned it could not inspect the PartitionAlloc zone, so its malloc table cannot explain that allocator's usage. No startup flags, browser installation or privileges were changed.

A short Memory-infra trace provides an alternative. A real 2-MiB trace probe reported `dataLossOccurred=true` and was rejected as complete attribution evidence. A separate 16-MiB diagnostic trace reported false and covered malloc object and allocator categories for both browser and renderer. This is only the new diagnostic trace buffer, **not a change to the 1-GiB RSS / 1024-FD acceptance budgets**. This exporter reports trace dump id `0x0` versus request GUID `0x1`; preserve both and claim only one dump per PID in a single trace window, not GUID equality. These are overlapping allocator counters, not stacks; parent and child nodes must not be summed into RSS. Requests explicitly use `deterministic=false`, avoiding the deterministic option that forces GC; see the [CDP Tracing API](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/#method-requestMemoryDump).

Capsule continuation: (1) b44 / 75e5 full-path RSS remains excessive; (2) new evidence is teardown plus capability probes; (3) the hypothesis is that surviving allocations or allocator-resident space can explain browser scan-associated residual, not yet established; (4) reuse cb8's isolated empty page with actual scanner, hashing and IDB, recording per-role RSS and allocator counters before fixture, after fixture, after scan and after page closure, preserving raw traces; (5) one 50k diagnostic, at most 20 minutes, failing on missing roles, data loss or ambiguous multiple dumps rather than blindly rerunning; (6) tracing affects the runtime, so `acceptanceGate=false`, no forced GC, omitted scan steps, changed acceptance budgets or excluded processes; (7) no UX changes; (8) fix the product only after identifying its resource owner, then rerun the original natural-reclamation complete gate.

Observer protection first produced 2 RED failures (missing new capability, 324ms), then 4/4 GREEN including the two prior observer tests (350ms). A real 20-file OPFS smoke exited 0: 20 files / 3 directories / 23 rows / 1,049,252 bytes; four trace windows without data loss, browser and renderer coverage in the first three and browser alone after closure; `explicitGcDiagnostic=false`, zero resource sampling errors. Related observer and documentation checks passed 6/6 in 601ms, and syntax passed. No product changes or new acceptance green; original pilot / PG remain unopened and unchanged. Parent invocation-bound A2A handled was applied; parent remains doing / workflow v12, with no push or merge.

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
