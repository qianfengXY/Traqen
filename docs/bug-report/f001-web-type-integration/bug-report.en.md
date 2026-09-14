> Language: [简体中文](bug-report.md) · **English**

---
feature_ids: [F001, F002, F006]
topics: [typescript, integration, validation]
doc_kind: bug-report
created: 2026-09-07
---

# F001 whole-Web type gate

Reporter: Yanyan / gpt-6-astra. F001 author-side integration diagnosis, not independent review or feature completion.

## Diagnosis capsule

| Field | Record |
| --- | --- |
| Symptom | Build, 84 Web tests and the F001-only typecheck pass, but the whole-Web strict typecheck has 29 errors. |
| Evidence | Fixed `b222cda7fd0459b05414699beec43a8fd3499954`; `./web/node_modules/.bin/tsc --project web/tsconfig.json --noEmit` exits 2. Managed aggregate exits 1; backend 560/560, Web 84/84, source types, lint, the 2000-file pilot and diff-check individually exit 0. |
| Root causes | Effective and global capability Props are intersected; raw candidates require evidence fields produced only during normalization; a property alias does not establish non-null narrowing; map literals and dynamic Gap fields lose contextual types; autosave has one bare return; header inference includes optional undefined; Worker references an unavailable ambient Fetcher. |
| Diagnosis | Read all 29 compiler diagnostics and trace input, normalization and rendering boundaries; compare existing RawCandidate, working header helpers and Terra's F006 commit `0b1ce852b9a14b7c0f5e83385c39a84b0ebc3252`. |
| Timeout | Typecheck should finish within seconds. Read any remaining failing boundary rather than excluding files or disabling strict checking. |
| Warnings | No any, ts-ignore or fabricated evidence; do not import additional F006 CLI/Skill behavior or wholesale changes from another unmerged feature. |
| Interaction | No UI or API data change. A stale autosave response explicitly returns false, matching other failure paths without displaying success. |
| Acceptance | Existing whole-Web typecheck is RED; after repair the same command exits 0, as do Web build/84 tests, zero-warning lint and both bilingual documentation tests, with no skips. |

## Ownership and scope

This is an integration repair on the F001 feature branch. Exact-scope Claims were sent to the F006 owner thread and the parallel F002 owner thread, without transferring their design or implementation custody. Shared architecture and file B remain unchanged.

Retain the `b222cda` type failure. The 2000-file calibration does not replace the historical `bcb21ac` 100k pass or erase the two earlier 100k timeouts.

## Repair and verification

- AgentSettings uses Omit to replace capabilities from its parent Props, instead of requiring each item to satisfy both global and effective capability types.
- Raw scanning, file records and the accumulator Map use the existing RawCandidate. Normalization still produces the real nodeType, governedFeatureId and evidenceFactIds. The merging map has a LocalCandidate contextual type.
- The cache-hit condition directly narrows analysis; Gap retains unknown Record fields plus known id/status; headers declare a string dictionary; Worker declares only the Request → Promise<Response> binding it uses.
- Stale autosave returns false without changing other failure, CAS or state-update rules. No tsconfig, dependency, API protocol or runtime authorization changes.

`tsc --project web/tsconfig.json --noEmit`: 29 errors / exit 2 → no errors / exit 0. `npm --prefix web test` rebuilt and passed 84/84 with no skips; zero-warning lint exits 0; bilingual checks pass 2/2. This targeted check of static boundaries is not completion of F001 browser or independent-review acceptance.

This turn read all 576 lines of the b222cda backend log and the Web, types, pilot and lint logs. Empty source-types/diff logs were interpreted with their individual exit 0 results. The final 2000-file report is archived in the adjacent Git capacity report directory as `pilot-2000-b222cda.json`: three frozen versions, 36 incremental directory bytes and offline replay; 44 samples, process-tree RSS 306,429,952 bytes, 424 FDs and no sampling errors. browserVerified and disasterDeploymentVerified remain false. Backend code is unchanged by this static repair; its 560/560 evidence belongs to b222cda, not a claimed new-commit full rerun.
