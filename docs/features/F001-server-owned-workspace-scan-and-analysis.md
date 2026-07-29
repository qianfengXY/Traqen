> Language: **English** · [简体中文](F001-server-owned-workspace-scan-and-analysis.zh-CN.md)

---
feature_ids: [F001]
related_features: []
topics:
  - workspace
  - source-scan
  - analysis-run
  - checkpoint
  - browser-refresh
doc_kind: spec
created: 2026-07-29
---

# F001: Server-owned Workspace Scan and Analysis Lifecycle

> **Status**: spec | **Owner**: CodeX | **Priority**: P0

## Why

The operator expects a Workspace analysis to be a durable Traqen task, not a browser-page activity: refreshing or closing the browser must not terminate file scanning, and explicit Resume must continue from the last committed scan or Agent unit without repeating completed work.

## Current State / Baseline

- The delivered server-owned `AnalysisRun` survives browser refresh after derived observations have reached the API.
- Source scanning still runs inside `WorkspaceAnalysisView.scanWorkspace()` with page-owned directory handles, loops, cursors, and state.
- The server run is created only after browser scanning completes.
- Refresh during scanning destroys the only executor; an IndexedDB checkpoint can preserve data but cannot keep work running.
- The previous implementation plan explicitly allowed `SCANNING + refresh → INTERRUPTED`, which does not meet the operator requirement.

## What

### Phase A: Lifecycle contracts and persistence

Create persistent `SourceRegistration`, `SourceSnapshot`, `SourceScanRun`, and `WorkspaceAnalysisJob` contracts, idempotency keys, desired state, leases, fencing tokens, and memory/PostgreSQL parity.

### Phase B: Server-owned source scanning

Add an allowlisted Local Runner, immutable Snapshot spool, checkpointed per-file extraction, cross-file relation resolution, atomic Fact commit, and multilingual parity fixtures.

### Phase C: Unified orchestration

Run `SourceScanRun → FactBundle → AnalysisRun → Candidate projection` under one job. Pause, Resume, Cancel, restart recovery, and completed-unit reuse apply to both child phases.

### Phase D: Browser ownership cutover

Replace page-owned scanning with a command/status client. Browser mount, refresh, reconnect, and polling are read-only; connection state never overwrites job state.

### Phase E: Acceptance and legacy-path removal

Prove large-repository continuity, repeated refresh, closure, offline/reconnect, explicit pause/resume, API/worker restart, security boundaries, and scanner parity before removing the browser executor.

## User Journey

### Primary Journey: Start once and observe a durable analysis

- **Scope unit**: workspace
- **Actor**: operator
- **Entry**: Workspace analysis page with an authorized source registration
- **Flow**:
  1. The operator selects the source and model profile, then clicks Start.
  2. Traqen immediately returns a stable `jobId` and shows separate Source Scan and Analysis Agent progress.
  3. The operator refreshes, closes, or reconnects the browser any number of times; the server job continues unchanged.
  4. The operator may explicitly Pause at an atomic boundary and later Resume the same job.
  5. Traqen skips completed scan and Agent WorkUnits and finishes one Candidate projection for the pinned Snapshot.
- **Success evidence**: browser network trace, server job/run IDs and progress, API/worker restart logs, WorkUnit call counts, and up to three acceptance screenshots
- **Non-goals**: browser background workers, automatic Resume caused by refresh, remote Git connector in the first delivery, or automatic Candidate promotion to governed Feature

### Supporting Journeys

| ID | Scope unit | Actor | Flow | Evidence |
|---|---|---|---|---|
| S1 | workspace | operator | Pause during scan → refresh → still paused → Resume same job | API state and scan call counts |
| S2 | workspace | operator | Close during Analysis → reopen → same run progresses | browser trace and run ID |
| S3 | workspace | operator | API/worker restart → lease recovery → completed units retained | restart integration log |

## Acceptance Criteria

### Phase A: Lifecycle contracts and persistence

- [ ] AC-A1: `WorkspaceAnalysisJob`, `SourceScanRun`, and `AnalysisRun` have distinct persisted identities, states, checkpoints, and one consistent Project/Snapshot binding.
- [ ] AC-A2: duplicate Start, Pause, Resume, and stale worker commits are idempotently rejected or return the current authoritative state.
- [ ] AC-A3: memory and PostgreSQL stores pass the same lifecycle, lease, fencing, and restart-reload tests.

### Phase B: Server-owned source scanning

- [ ] AC-B1: refreshing or closing the only browser during scan does not change job state, scan run ID, or server ownership; completed-file progress continues.
- [ ] AC-B2: Resume reuses the same immutable Snapshot and does not re-execute completed scan WorkUnits, proven by extractor call counts.
- [ ] AC-B3: Local Runner rejects non-allowlisted roots, traversal, symlink escape, broad root/home targets, devices, sockets, and non-regular files.
- [ ] AC-B4: canonical server scanning reaches the reviewed browser-scanner coverage for JavaScript, TypeScript, JSX/TSX, Java, Python, Go, C#, Rust, OpenAPI, commands, configuration, and test clues before cutover.

### Phase C: Unified orchestration

- [ ] AC-C1: AnalysisRun starts only after the same Snapshot's FactBundle commits successfully.
- [ ] AC-C2: explicit Pause and Resume preserve `jobId`, `sourceSnapshotId`, `scanRunId`, `analysisRunId`, and all committed child-unit results.
- [ ] AC-C3: running work recovers after API/worker restart, while manually paused and cancelled jobs do not auto-resume.
- [ ] AC-C4: Candidate outputs remain WorkUnit evidence-bound and cannot create governed Feature authority.

### Phase D: Browser ownership cutover

- [ ] AC-D1: mount, refresh, reconnect, and polling perform only read requests and never Start, Pause, Resume, or Cancel.
- [ ] AC-D2: UI displays Source Scan and Analysis Agent phase progress independently under one job and displays connection state separately.
- [ ] AC-D3: the browser contains no file-scan or model execution loop after cutover; IndexedDB stores only a non-authoritative job pointer and UI cache.

### Phase E: Acceptance and security

- [ ] AC-E1: a repository with at least 10,000 files survives ten refreshes, browser closure, offline/reconnect, explicit pause/resume, and API/worker restart without changing job identity or repeating completed units.
- [ ] AC-E2: raw source, absolute private paths, real `.env` values, and unredacted secrets stay out of browser requests, read APIs, logs, and external model inputs.
- [ ] AC-E3: backend tests, Web tests/build, lint, diff-check, browser acceptance, and scanner parity gates all pass.

## Requirements Checklist

| ID | Operator requirement | AC | Verification | Status |
|---|---|---|---|---|
| R1 | “Refreshing the browser must not change the current running task.” | AC-B1, AC-D1 | browser network + job progress | [ ] |
| R2 | “Pause only when I trigger it manually.” | AC-C2, AC-D1 | API/browser mutation counts | [ ] |
| R3 | “Resume from the last paused node; do not analyze completed data again.” | AC-B2, AC-C2 | extractor/model call counts | [ ] |
| R4 | “This specifically includes the file-scanning stage.” | AC-B1–B4 | scan integration + parity suite | [ ] |
| R5 | “List file scanning and Analysis Agent as a separate priority requirement.” | AC-A1, AC-C1, AC-D2 | contracts, orchestration, UI evidence | [ ] |

### Coverage check

- [x] Every stated requirement maps to at least one AC.
- [x] Every AC has an executable verification path.
- [ ] UI requirement-to-evidence mapping will be completed during acceptance.

## Dependencies

- **Evolved from**: the server-owned AnalysisRun change merged in PR #5; it is an implemented precursor, not a complete F001 delivery.
- **Blocked by**: none for kickoff; Design Gate approval is required before implementation.
- **Related**: canonical traceability ontology and Analysis Agent design.

## Risk

| Risk | Mitigation |
|---|---|
| Server scanner loses current browser language coverage | 100% reviewed multilingual parity gate before cutover |
| Local Runner can read an unintended path | allowlist, `realpath`, per-entry checks, symlink fencing, opaque read projection |
| Worker crash duplicates work | deterministic WorkUnit IDs, atomic checkpoints, lease fencing |
| Source mutates during a run | immutable sealed Snapshot; changes belong to a later job |
| UI confuses disconnect with failure | separate connection status from authoritative job status |
| Migration leaves two execution authorities | hard cutover gate and removal test for browser executor |

## Open Questions

| # | Question | Status |
|---|---|---|
| OQ-1 | Confirm the server-side Local Runner with explicit allowlisted filesystem access as the phase-one source connector. | Proposed — Design Gate |
| OQ-2 | Define deployment packaging for the Local Runner when Traqen UI and API are not on the same machine. | Open — later connector design, not required for local phase one |

## Key Decisions

| # | Decision | Reason | Date |
|---|---|---|---|
| KD-1 | One `WorkspaceAnalysisJob` owns separate `SourceScanRun` and `AnalysisRun` phases. | Users need one durable task while engineering needs separate checkpoints and failure semantics. | 2026-07-29 |
| KD-2 | Browser lifecycle events are observation-only. | A page process cannot be the durable owner of scan or Agent execution. | 2026-07-29 |
| KD-3 | Scanner parity is a cutover gate. | Refresh safety cannot be purchased by silently losing language coverage. | 2026-07-29 |
| KD-4 | Traqen roadmap `Fxxx` IDs are separate from governed business `Feature.id`. | Engineering lifecycle identifiers must not create or imply business authority. | 2026-07-29 |

## Tips Contribution

Plan one Workspace-analysis tip after implementation: explain that browser connection status does not control the durable server job, with the F001 design as `sourceRef`.

## Timeline

| Date | Event |
|---|---|
| 2026-07-29 | F001 kickoff and detailed requirement baseline |

## Review Gate

- Architecture-level Design Gate: review the Local Runner data boundary and two-stage lifecycle, then obtain operator confirmation before implementation.
- Implementation: TDD by phase, quality gate, independent review, and merge gate.

## Links

| Type | Path | Purpose |
|---|---|---|
| Detailed design | `docs/features/workspace-scan-and-analysis-lifecycle.md` | Objects, state machines, security, API, UI, acceptance |
| Implementation plan | `feature-specs/2026-07-29-server-owned-workspace-scan-and-analysis-lifecycle.md` | Twelve TDD tasks and cutover gates |
| Current Workspace design | `docs/features/workspace-analysis-design.md` | Current behavior and known lifecycle gap |
| Analysis Agent | `docs/features/analysis-agent-design.md` | Agent-phase evidence and authority rules |
| Bug report | `docs/bug-report/workspace-analysis-refresh-resume.md` | Root cause and PR #5 scope correction |
