---
feature_ids: [F001]
related_features: []
topics:
  - workspace
  - source-scan
  - analysis-run
  - server-owned-lifecycle
  - checkpoint
  - worker-lease
doc_kind: implementation-plan
created: 2026-07-29
status: proposed
priority: P0
---

# Server-owned Workspace Scan and Analysis Lifecycle Implementation Plan

**Feature:** Workspace scan and Analysis Agent lifecycle — `docs/features/workspace-scan-and-analysis-lifecycle.md`
**Goal:** Once a Workspace analysis job is accepted, source scanning and Agent analysis continue under server ownership across browser refresh, closure, disconnect, and API/worker restart, while explicit Pause and Resume reuse the same checkpointed job without repeating completed work.
**Acceptance Criteria:** (1) Browser lifecycle events are read-only and never alter the job; (2) SourceScanRun and AnalysisRun have separate durable checkpoints under one job ID; (3) Pause and Resume are explicit and reuse the same Snapshot and child runs; (4) completed scan and analysis WorkUnits are not repeated; (5) running jobs recover after worker/API restart while manually paused jobs stay paused; (6) local source access is allowlisted and cannot escape by traversal or symlink; (7) raw source and secrets do not enter browser responses, logs, or external model inputs; (8) the canonical server scanner reaches current browser-scanner language parity before cutover; (9) the UI separates connection state from task state and shows both phases.
**Architecture cell:** N/A — Traqen does not yet have `docs/architecture/ownership/README.md`.
**Map delta:** update required
**Map delta why:** Execution ownership changes from a mixed browser/server pipeline to SourceRegistration → WorkspaceAnalysisJob → SourceScanRun → AnalysisRun on the API/worker side. The architecture design documents are the current ownership map and must be updated in the same delivery.
**Architecture:** A server-side Local Runner registers an allowlisted source root, seals an immutable SourceSnapshot, and executes checkpointed scan work before handing the committed FactBundle to the existing Analysis Agent. A persistent job orchestrator owns desired state, child-run references, leases, fencing, and recovery. The browser becomes a command/read client with a non-authoritative job pointer.
**Tech Stack:** Node.js filesystem APIs, canonical scanner, Node HTTP API, TraceabilityApplication, memory/PostgreSQL stores, JSON Schema/OpenAPI, React/Vinext, IndexedDB subscription pointer.
**前端验证:** Yes — acceptance must refresh/close/reopen the browser during both scan and Analysis phases and compare job IDs, child-run IDs, server progress, HTTP methods, and visual state.

---

## 1. Straight-line finish line

```text
Start command
  → durable WorkspaceAnalysisJob
  → immutable SourceSnapshot
  → checkpointed SourceScanRun
  → canonical FactBundle
  → checkpointed AnalysisRun
  → Candidate projection
```

Every implementation task below leaves a final production object or invariant in place. Browser background execution, automatic Resume on refresh, and a second temporary scanning authority are explicitly rejected.

## 2. Scope and non-goals

### In scope

- Local filesystem source registration for local/private deployments.
- Immutable Snapshot spool and manifest.
- Per-file or bounded-batch scan WorkUnits.
- Cross-file relation resolution and atomic Fact commit.
- Unified job orchestration across scanning and Analysis Agent.
- Pause, Resume, Cancel, worker lease, fencing, and restart recovery.
- Browser command/status client and dual-phase UI.
- Migration from browser-owned scanning.
- Capability parity across current supported languages.

### Non-goals

- Remote Git or code-hosting connectors in the first delivery.
- Browser source upload.
- Service Worker, SharedWorker, or hidden-tab execution.
- Multi-region distributed scheduling.
- Automatic Candidate promotion to governed Feature.
- Exactly-once external model network delivery.

## 3. Lifecycle census

| Object | Unique owner | Persistent authority | Recovery key |
|---|---|---|---|
| `SourceRegistration` | API | store | registration ID |
| `SourceSnapshot` | scan worker + store | store/spool | Snapshot ID |
| `ScanWorkUnit` | leased scan worker | store | deterministic WorkUnit ID |
| `SourceScanRun` | job orchestrator | store | scan run ID |
| `AnalysisRun` | Analysis Agent | store | analysis run ID |
| `WorkspaceAnalysisJob` | job orchestrator | store | job ID/idempotency key |
| `BrowserSubscription` | browser | no | project ID → job ID pointer |
| `ConnectionState` | browser projection | no | none |

No generic restore, project reload, page mount, or IndexedDB migration may set a server lifecycle status.

## 4. Terminal contracts

Create schemas for:

- `source-registration.schema.json`
- `source-snapshot.schema.json`
- `source-scan-run.schema.json`
- `workspace-analysis-job.schema.json`

Required state relationships:

```text
WorkspaceAnalysisJob.projectId
  = SourceRegistration.projectId
  = SourceSnapshot.projectId
  = SourceScanRun.projectId
  = FactBundle.projectId
  = AnalysisRun.projectId

WorkspaceAnalysisJob.sourceSnapshotId
  = SourceScanRun.sourceSnapshotId
  = FactBundle.snapshotManifestId
  = AnalysisRun.snapshotManifestId
```

Job status and browser connection status are distinct types and fields.

## 5. State/event matrix

### WorkspaceAnalysisJob

| State | Event | Next | Persistent action |
|---|---|---|---|
| absent | Start | `QUEUED` | insert job and idempotency key |
| `QUEUED` | acquire lease | `RUNNING` | write owner/token/expiry |
| `RUNNING` | explicit Pause | `PAUSE_REQUESTED` | set desired state |
| `PAUSE_REQUESTED` | unit boundary | `PAUSED` | commit checkpoint |
| `PAUSED` | explicit Resume | `QUEUED` | set desired running |
| `RUNNING` | lease expiry | `RECOVERING` | invalidate old token |
| `RECOVERING` | acquire lease | `RUNNING` | continue checkpoint |
| `RUNNING` | final projection committed | terminal success | write completion refs |
| non-terminal | explicit Cancel | `CANCELLED` | fence worker |
| any | GET/refresh/offline | unchanged | none |

### Scan WorkUnit

| State | Event | Next | Rule |
|---|---|---|---|
| `QUEUED` | lease | `RUNNING` | current fencing token |
| `RUNNING` | output commit | `COMPLETED` | deterministic idempotent result |
| `RUNNING` | retryable error | `QUEUED` | increment attempt |
| `RUNNING` | policy gap | `FAILED` | preserve diagnostic |
| `RUNNING` | Pause/lease loss | `QUEUED` | no completed marker |
| `COMPLETED` | recovery | `COMPLETED` | never execute |

Analysis WorkUnits retain the existing equivalent rules.

## 6. Invariants and corresponding tests

| Invariant | Verification |
|---|---|
| INV-1: refresh/mount/reconnect are GET-only | browser network assertion |
| INV-2: one active lease per job | concurrent repository test |
| INV-3: stale fencing token cannot commit | repository conflict test |
| INV-4: job uses one immutable Snapshot | source mutation integration test |
| INV-5: scan completes before Analysis starts | orchestrator ordering test |
| INV-6: completed scan units never rerun | extractor call-count test |
| INV-7: completed Analysis units never rerun | model/Skill call-count test |
| INV-8: only explicit Pause changes desired state | HTTP + browser test |
| INV-9: paused survives refresh and restart | API restart integration test |
| INV-10: running auto-recovers after restart | lease-expiry integration test |
| INV-11: raw source/secrets stay within local scanner | payload/log/model-adapter tests |
| INV-12: scanner capability does not regress | multilingual parity suite |

## 7. Adversarial matrix

1. Refresh ten times during manifest discovery.
2. Close the only browser during extraction.
3. Start twice with the same idempotency key.
4. Pause while a file is being extracted.
5. Pause while a model request is in flight.
6. Resume twice from two tabs.
7. Kill a worker after output generation but before checkpoint commit.
8. Restart the API after checkpoint commit but before phase transition.
9. Let a stale worker attempt to commit after a newer lease.
10. Change a source file while Snapshot creation is in progress.
11. Revoke the source registration during a running historical Snapshot.
12. Replace an allowlisted path with a symlink after registration.
13. Make one file unreadable.
14. Disconnect the browser while Pause is pending.
15. Reconnect with a stale IndexedDB pointer.

## 8. Implementation tasks

### Task 1: Contract RED — server-owned job and source objects

**Files:**
- Create: `contracts/source-registration.schema.json`
- Create: `contracts/source-snapshot.schema.json`
- Create: `contracts/source-scan-run.schema.json`
- Create: `contracts/workspace-analysis-job.schema.json`
- Modify: `contracts/openapi.json`
- Test: `test/contracts.test.js`

1. Write failing schema tests for all terminal states, IDs, progress counters, child references, desired state, lease token, and additional-property rejection.
2. Run `node --test test/contracts.test.js` and record expected RED.
3. Add the schemas and OpenAPI resource paths.
4. Re-run until GREEN.
5. Commit contract truth before application implementation.

### Task 2: Persistence RED — lifecycle objects, idempotency, and fencing

**Files:**
- Modify: `src/storage/memory-traceability-store.js`
- Modify: `src/storage/postgres/postgres-traceability-store.js`
- Create: `db/migrations/00x_workspace_analysis_jobs.sql`
- Test: `test/storage-migrations.test.js`
- Create: `test/workspace-analysis-job-store.test.js`

1. Write failing tests for atomic job creation, idempotent Start, scan checkpoints, lease compare-and-set, stale-token rejection, child reference consistency, and restart reload.
2. Verify RED.
3. Implement memory and PostgreSQL parity.
4. Verify the migration is forward-only and does not rewrite existing AnalysisRun history.
5. Run storage tests and commit.

### Task 3: Source registration security RED

**Files:**
- Create: `src/domain/source-registration.js`
- Modify: `src/domain/index.js`
- Modify: `src/application/traceability-application.js`
- Modify: `src/api/http-server.js`
- Test: `test/source-registration.test.js`
- Test: `test/api-http.test.js`

1. Write failing cases for allowlisted root, non-allowlisted root, traversal, symlink escape, root/home broad target, device/non-file entries, revoke, and hidden canonical path.
2. Verify RED.
3. Implement `TRAQEN_ALLOWED_WORKSPACE_ROOTS` parsing and canonical path validation.
4. Ensure logs and read projections expose display name and opaque ID only.
5. Re-run targeted tests and commit.

### Task 4: Immutable Snapshot and spool RED

**Files:**
- Create: `src/scanner/source-snapshot-store.js`
- Create: `src/domain/source-snapshot.js`
- Test: `test/source-snapshot.test.js`

1. Write failing tests for ordered manifest, content-addressed blobs, atomic seal, source mutation during capture, duplicate content reuse, explicit deletion, and crash recovery.
2. Verify RED.
3. Implement spool with restrictive permissions and exact-target deletion.
4. Prove a sealed Snapshot cannot change.
5. Commit.

### Task 5: Canonical scanner checkpoint RED

**Files:**
- Create: `src/scanner/checkpointed-workspace-scanner.js`
- Refactor: `src/scanner/javascript-project-scanner.js`
- Create: `test/fixtures/workspace-scanner-parity/`
- Create: `test/checkpointed-workspace-scanner.test.js`
- Create: `test/workspace-scanner-parity.test.js`

1. Build fixtures for JavaScript, TypeScript, JSX/TSX, Java, Python, Go, C#, Rust, OpenAPI, config, commands, and test clues.
2. Capture current browser-scanner expected projections as reviewed fixtures, not as a second runtime authority.
3. Write failing parity and checkpoint call-count tests.
4. Implement per-file extraction outputs and a separate cross-file relation pass.
5. Add signal/desired-state checks only at atomic boundaries.
6. Verify completed file units are skipped after restart.
7. Do not cut over while any required parity fixture differs.
8. Commit scanner parity.

### Task 6: Job orchestrator RED

**Files:**
- Create: `src/application/workspace-analysis-job-runner.js`
- Modify: `src/application/traceability-application.js`
- Modify: `src/api/application-bootstrap.js`
- Test: `test/workspace-analysis-job-runner.test.js`

1. Write failing tests for SourceSnapshot → SourceScanRun → FactBundle → AnalysisRun → projection ordering.
2. Add pause at scan boundary, pause at model boundary, resume, cancellation, gap policy, and phase-transition crash windows.
3. Verify RED.
4. Implement the orchestrator with transactional child references.
5. Prove Analysis cannot start without the exact FactBundle.
6. Commit.

### Task 7: Lease and restart recovery RED

**Files:**
- Create: `src/application/workspace-analysis-worker.js`
- Modify: `src/api/dev-server.js`
- Modify: `src/api/production-server.js`
- Test: `test/workspace-analysis-worker.test.js`

1. Write failing tests using two worker identities and a controllable clock.
2. Cover heartbeat, expiry, fencing, stale commit, auto-recovery, manual pause preservation, and graceful shutdown.
3. Verify RED.
4. Implement the worker loop without arbitrary fixed sleeps in tests.
5. Commit.

### Task 8: HTTP lifecycle RED

**Files:**
- Modify: `src/api/http-server.js`
- Modify: `contracts/openapi.json`
- Test: `test/api-http.test.js`

1. Write failing route tests for registration, Start, GET, Pause, Resume, Cancel, and events.
2. Verify Start returns persisted `QUEUED/RUNNING` job, never a fabricated browser state.
3. Verify repeated commands are idempotent and terminal conflicts are explicit.
4. Implement the routes and run contract/API tests.
5. Commit.

### Task 9: Browser thin client RED

**Files:**
- Create: `web/app/workspace-analysis-job-client.ts`
- Modify: `web/app/local-workspace-store.ts`
- Test: `web/tests/workspace-analysis-job-client.test.mjs`

1. Write failing tests proving mount/refresh/reconnect perform only GET.
2. Test command methods separately.
3. Test stale pointers, connection-state projection, and monotonic job versions.
4. Implement the client and minimal IndexedDB pointer.
5. Commit.

### Task 10: Workspace UI ownership cutover RED

**Files:**
- Modify: `web/app/traqen-product.tsx`
- Modify: `web/app/components/layout/sidebar.tsx`
- Modify: `web/app/globals.css`
- Test: `web/tests/rendered-html.test.mjs`

1. Write failing source/render tests forbidding page-owned file loops, scanner status writes, and automatic Resume.
2. Add a two-stage task card and separate connection indicator.
3. Wire Start/Pause/Resume/Cancel to the job API.
4. Restore only by job GET.
5. Remove the browser scanner execution path only after Task 5 parity is GREEN.
6. Commit.

### Task 11: Compatibility and truth migration

**Files:**
- Modify: `web/app/local-workspace-store.ts`
- Modify: `docs/features/workspace-analysis-design.md`
- Modify: `docs/features/workspace-analysis-design.zh-CN.md`
- Modify: `docs/features/analysis-agent-design.md`
- Modify: `docs/features/analysis-agent-design.zh-CN.md`
- Modify: `docs/bug-report/workspace-analysis-refresh-resume.md`
- Modify: `docs/bug-report/workspace-analysis-refresh-resume.zh-CN.md`

1. Treat old browser checkpoints as historical preparation records, not resumable active jobs.
2. Do not invent a server job for an old checkpoint.
3. Preserve completed local projections.
4. Mark the old `/workspace-observations` browser execution flow as compatibility-only, then remove it when migration criteria pass.
5. Update both languages together and commit.

### Task 12: Acceptance

**Automated gates:**

```bash
env -u NODE_ENV npm test
env -u NODE_ENV npm run test:web
env -u NODE_ENV npm --prefix web run lint
git diff --check
```

**Runtime acceptance:**

1. Use isolated, non-reserved API/Web ports.
2. Register an allowlisted test repository with at least 10,000 files.
3. Record job, Snapshot, scan run, and AnalysisRun IDs.
4. Refresh ten times during scanning and inspect the HTTP method log.
5. Close the browser for at least 30 seconds and prove server progress increases.
6. Pause and refresh; prove progress does not change.
7. Resume and prove completed file extractor call counts do not increase.
8. Restart the API/worker during scan and during Analysis.
9. Repeat browser lifecycle checks in Analysis phase.
10. Capture screenshots outside the repository root and map every acceptance criterion to evidence.

## 9. Cutover gates

The browser scanner may be deleted only when all are true:

- multilingual scanner parity is GREEN;
- scan refresh/close acceptance is GREEN;
- pause/resume call-count tests are GREEN;
- restart recovery is GREEN;
- path security suite is GREEN;
- old checkpoint migration is documented and tested;
- a non-author reviewer verifies both scan and Analysis phases in a real browser.

## 10. Decision record

Chosen direction: server-owned Local Runner with explicit allowlisted filesystem access.

Rejected:

- browser automatic resume, because it changes state on refresh and still depends on a page executor;
- Service Worker/SharedWorker, because browser scheduling is not a durable job owner;
- immediate raw source upload, because it changes the source privacy and transport boundary and still leaves upload continuity browser-dependent;
- direct reuse of the current Node scanner without parity work, because it would regress supported languages.
