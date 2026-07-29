> Language: **English** · [简体中文](workspace-scan-and-analysis-lifecycle.zh-CN.md)

---
feature_ids: [F001]
related_features: []
topics:
  - workspace
  - source-scan
  - analysis-run
  - checkpoint
  - pause-resume
  - browser-refresh
doc_kind: feature-design
created: 2026-07-29
status: proposed
priority: P0
---

# Durable Workspace Scan and Analysis Agent Lifecycle

> Supporting execution design for [F001](F001-legacy-system-understanding.md). This document specifies durable ownership and recovery; understanding correctness, reconciliation, and evaluation are defined by the F001 engine design.

## 1. Requirement

The Workspace flow is one user-visible job with two separately checkpointed server stages:

1. **SourceScanRun** seals an immutable source Snapshot, extracts deterministic per-file facts, resolves cross-file relations, and commits a `FactBundle`.
2. **AnalysisRun** plans and executes Agent/Skill `WorkUnit`s from Facts in that same Snapshot and materializes a Candidate projection.

The parent **WorkspaceAnalysisJob** is the only task exposed to the user. The browser may create commands and observe state, but it never owns a scanner, model executor, pause flag, run clock, or authoritative status.

Refreshing, closing, reopening, disconnecting, or attaching multiple browser tabs must not change job state.

## 2. Confirmed gap

The current implementation moved only model analysis to the API. Source preparation still runs inside
`WorkspaceAnalysisView.scanWorkspace()`:

- directory handles, file lists, cursors, batches, and `scanning` state belong to the page process;
- the server `AnalysisRun` does not exist until every file has been scanned and the browser submits derived observations;
- unmounting the page destroys the only scan executor;
- IndexedDB preserves checkpoints but cannot keep execution alive;
- the previous design explicitly allowed `SCANNING + refresh → INTERRUPTED`.

The earlier acceptance covered refresh only after creation of a server `AnalysisRun`. It did not test the scan stage and is not acceptance evidence for this requirement.

## 3. Terminal architecture

```text
User
  │ Start / Pause / Resume / Cancel
  ▼
WorkspaceAnalysisJob                         ← the only user-visible task
  │
  ├─ SourceRegistration                      ← explicitly authorized source
  │    └─ SourceSnapshot                     ← immutable input for this job
  │         └─ SourceScanRun                  ← server-owned per-file work
  │              └─ FactBundle               ← Snapshot-bound Facts
  │
  └─ AnalysisRun                             ← server-owned Agent/Skill WorkUnits
       └─ CandidateBundle / AnalysisResult

BrowserSubscription                          ← non-authoritative read pointer
```

The API persists the job ID before returning `202 Accepted`. SourceScanRun and AnalysisRun have separate checkpoints and progress, but remain linked by one job and one source Snapshot.

Only an explicit user command can manually pause a job. A crashed worker or restarted API automatically re-leases work from the last committed checkpoint when `desiredState=RUNNING`.

## 4. User journey

### First run

1. Create a Workspace.
2. Register a source directory through the Local Runner. The API returns an opaque `sourceRegistrationId` and does not expose the canonical absolute path through normal reads.
3. Select a model profile and click Start.
4. Receive a stable `jobId` immediately.
5. Observe the server building a SourceSnapshot and executing SourceScanRun.
6. Observe the server transition to AnalysisRun after the FactBundle commits.
7. On the first project run, evaluate and publish the FULL GraphRevision. On later Snapshots, evaluate the INCREMENTAL revision and atomically move CurrentGraphHead only after it passes.

### Refresh and reconnect

At any stage, the user may refresh or close the browser. The server continues. Reopening the page loads the subscription and performs `GET` for the same `jobId`. Mount, refresh, reconnect, and polling never call Start, Pause, Resume, or Cancel.

### Manual pause and resume

Pause first persists `PAUSE_REQUESTED`. The worker commits the current atomic unit and transitions to `PAUSED`. Refresh preserves that state. Resume reuses the same job, source Snapshot, scan run, and analysis run, while skipping completed file and Agent WorkUnits.

## 5. Lifecycle objects

### SourceRegistration

Represents a server-authorized source locator.

```ts
type SourceRegistration = {
  id: string;
  projectId: string;
  connectorKind: "LOCAL_FILESYSTEM";
  displayName: string;
  canonicalRootRef: string; // private/encrypted; not returned by normal read APIs
  policyVersion: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  updatedAt: string;
};
```

The canonical root must resolve below an operator-configured allowlist. Revocation prevents new jobs but does not rewrite historical Snapshots.

### SourceSnapshot

```ts
type SourceSnapshot = {
  id: string;
  projectId: string;
  sourceRegistrationId: string;
  manifestDigest: string;
  scannerVersion: string;
  policyVersion: string;
  fileCount: number;
  totalBytes: number;
  status: "BUILDING" | "SEALED" | "FAILED";
  createdAt: string;
  sealedAt: string | null;
};
```

A sealed Snapshot is immutable. Source changes during the run are visible only to a later job and Snapshot.

### SourceScanRun

```ts
type SourceScanRun = {
  id: string;
  jobId: string;
  projectId: string;
  sourceSnapshotId: string;
  status:
    | "QUEUED" | "RUNNING" | "PAUSE_REQUESTED" | "PAUSED"
    | "COMPLETED" | "COMPLETED_WITH_GAPS" | "FAILED" | "CANCELLED";
  phase: "DISCOVERY" | "SNAPSHOTTING" | "EXTRACTION" | "RELATION_RESOLUTION" | "FACT_COMMIT";
  plannedFileCount: number | null;
  completedFileCount: number;
  failedFileCount: number;
  leaseOwnerId: string | null;
  leaseToken: number;
  leaseExpiresAt: string | null;
  updatedAt: string;
};
```

A scan WorkUnit has the deterministic identity:

```text
hash(sourceSnapshotId + relativePath + contentHash + scannerVersion + policyVersion)
```

Completed units are skipped on recovery.

### AnalysisRun

The canonical AnalysisRun remains the Agent owner. It may start only after a complete FactBundle exists for the same Project and Snapshot. Evidence scope, confidence caps, Candidate-only authority, and completed WorkUnit reuse remain mandatory.

### WorkspaceAnalysisJob

```ts
type WorkspaceAnalysisJob = {
  id: string;
  projectId: string;
  sourceRegistrationId: string;
  sourceSnapshotId: string | null;
  scanRunId: string | null;
  analysisRunId: string | null;
  requestedMode: "FULL" | "INCREMENTAL" | "AUTO";
  desiredState: "RUNNING" | "PAUSED" | "CANCELLED";
  status:
    | "QUEUED" | "RUNNING" | "PAUSE_REQUESTED" | "PAUSED"
    | "RECOVERING" | "COMPLETED" | "COMPLETED_WITH_GAPS"
    | "FAILED" | "CANCELLED";
  phase: "SOURCE_SCAN" | "FACT_COMMIT" | "ANALYSIS" | "EVALUATION" | "PROJECTION" | "PUBLISHING";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
```

Browser connection state is not job state. `CONNECTED / RECONNECTING / OFFLINE` is a client-only projection and may never overwrite the server job.

Mode resolution is deterministic: when the Project has no `CurrentGraphHead`, `AUTO` resolves to `FULL` and explicit `INCREMENTAL` is rejected. Once a head exists, `AUTO` resolves to `INCREMENTAL`; an operator may still force `FULL`. Mode resolution is persisted before work starts and cannot change during Resume.

### BrowserSubscription

IndexedDB stores only:

- `projectId`;
- `jobId`;
- the last observed version and timestamp.

The subscription is a non-authoritative pointer. It does not store authoritative `RUNNING` state, scan checkpoints, Facts, or Candidates.

## 6. State transitions

| Current | Event | Next | Rule |
|---|---|---|---|
| absent | Start | `QUEUED` | Persist before `202` |
| `QUEUED` | worker lease | `RUNNING` | Start SourceScanRun |
| `RUNNING` | explicit Pause | `PAUSE_REQUESTED` | Persist desired state |
| `PAUSE_REQUESTED` | atomic unit committed | `PAUSED` | Stop leasing new work |
| `PAUSED` | explicit Resume | `QUEUED` | Same job and Snapshot |
| `RUNNING` | lease expires | `RECOVERING` | Not a manual pause |
| `RECOVERING` | new worker lease | `RUNNING` | Resume from checkpoint |
| `RUNNING` | all phases finish | terminal success | Persist result |
| non-terminal | explicit Cancel | `CANCELLED` | Never auto-resume |
| any | refresh/offline/GET | unchanged | No side effect |

Stage transitions and their output references must commit atomically. A job may not enter Analysis without a committed FactBundle, or complete without a committed result.

## 7. Scan checkpoints

SourceScanRun executes:

1. **DISCOVERY** — enumerate an ordered manifest below the authorized root.
2. **SNAPSHOTTING** — write content-addressed blobs and fixed content hashes.
3. **EXTRACTION** — extract per-file deterministic Facts.
4. **RELATION_RESOLUTION** — resolve imports, calls, tests, and other cross-file links.
5. **FACT_COMMIT** — atomically persist SnapshotManifest and FactBundle.

Each file or bounded batch commits atomically. A crash may repeat at most one uncommitted unit. Deterministic IDs make retries idempotent. A `RUNNING` scan must have a valid worker lease.

Scan outcomes are classified rather than collapsed:

- `SKIPPED` for an explicit policy disposition that remains in the inventory denominator;
- retryable `FAILED` for a file/batch failure that preserves its diagnostic and attempt count;
- fatal source-root/authorization failure, which fails the scan without pretending the remaining inventory was examined.

Before the manifest is sealed, `plannedFileCount` is `null` and the UI states that the denominator is still being discovered. After seal it is exact; progress must never display an estimated count as a complete denominator.

## 8. Scanner parity gate

The current browser scanner supports more languages than the server `JavaScriptProjectScanner`. Server migration may not reduce product capability.

Before cutover, the canonical scanner must retain the current visible support for JavaScript/TypeScript/JSX/TSX, Java, Python, Go, C#, Rust, OpenAPI, commands, configuration, and test clues.

A shared multilingual fixture suite must compare:

- file coverage;
- Fact/Candidate types and counts;
- stable IDs and source locations;
- secret redaction;
- test-to-implementation links;
- diagnostics.

The browser execution path cannot be removed until required parity is 100%.

## 9. Analysis recovery

- The AnalysisRun is pinned to the job's SourceSnapshot and FactBundle.
- Pause may abort an in-flight model request, but that unit returns to `QUEUED` and is not recorded as complete.
- A committed CandidateBundle is never recomputed.
- Resume keeps the same AnalysisRun.
- Retry exhaustion follows an explicit gap/pause policy and never loops indefinitely.

## 10. Leases and idempotency

- Start uses a stable idempotency key/job ID.
- Duplicate Start returns the existing job.
- One valid worker lease exists per job.
- A monotonically increasing lease token fences stale workers.
- Repeated Pause/Resume commands are idempotent.
- Scheduling is at-least-once; result commit is exactly-once.
- After restart, running jobs auto-recover, manually paused jobs stay paused, and cancelled jobs never resume.

## 11. Security boundary

### 11.1 Deployment capability modes

| Mode | Source access | Rule |
|---|---|---|
| `LOCAL_SINGLE_TENANT` | API and Runner are co-located and read allowlisted local source | permits `LOCAL_FILESYSTEM` registration |
| `PRIVATE_RUNNER` | runner stays beside private source and receives work over mutually authenticated/outbound transport | raw source remains at the source boundary |
| `CLOUD_CONTROL_PLANE` | control plane cannot read a browser-local path | requires Private Runner or governed Remote Git Connector; direct local registration is disabled |

The first implementation delivers `LOCAL_SINGLE_TENANT`. `SourceRegistration` records connector kind, capability version, and policy version so later connectors do not change Snapshot or graph semantics.

### 11.2 Common boundaries

- `TRAQEN_ALLOWED_WORKSPACE_ROOTS` is required for local registrations.
- Canonical `realpath` checks apply to the root and every file.
- Filesystem root, home root, symlink escape, device files, sockets, FIFOs, and non-regular files are rejected.
- Normal read APIs and logs do not reveal absolute paths, source bodies, secrets, or unredacted `.env` values.
- Raw source enters only the local Snapshot spool and scanner.
- External models receive bounded, policy-filtered Facts, never raw source or unredacted secrets.
- Snapshot spool data has no implicit TTL and is deleted only through an explicit audited action that removes only blobs exclusively referenced by the target Snapshot.

Remote Git and browser source upload connectors are outside the first phase. A cloud/multi-tenant API must reject `LOCAL_FILESYSTEM` registration until a compatible Private Runner exists.

## 12. API draft

```http
POST /v1/projects/{projectId}/source-registrations
GET  /v1/projects/{projectId}/source-registrations/{registrationId}
POST /v1/projects/{projectId}/source-registrations/{registrationId}/revoke

POST /v1/projects/{projectId}/workspace-analysis-jobs
GET  /v1/projects/{projectId}/workspace-analysis-jobs/{jobId}
POST /v1/projects/{projectId}/workspace-analysis-jobs/{jobId}/pause
POST /v1/projects/{projectId}/workspace-analysis-jobs/{jobId}/resume
POST /v1/projects/{projectId}/workspace-analysis-jobs/{jobId}/cancel
GET  /v1/projects/{projectId}/workspace-analysis-jobs/{jobId}/events
```

Start references a source registration, model profile, and mode. It does not contain source bodies or browser-derived observations.

## 13. UI contract

```text
Workspace analysis · JOB-123                     [RUNNING]

1. Source scan
   Snapshot sealed · 5,240 / 12,480 files · 42%

2. Analysis Agent
   Waiting for FactBundle · 0 / 0 WorkUnits

Connection: reconnecting…
[Pause] [Cancel]
```

Connection and job status are separate. Refresh displays reconnecting, never terminated or automatically paused. Server status is the only source of `RUNNING`, `PAUSED`, and terminal states.

## 14. Failure and recovery

| Failure | Job behavior | User surface |
|---|---|---|
| browser refresh/close | unchanged | reattach to same job |
| browser offline | server continues | connection offline |
| API temporarily unreachable | do not infer failure | reconnecting |
| worker crash | lease recovery | recovering → running |
| API restart | persistent re-leasing | same job/checkpoint |
| source permission lost | pause/fail with checkpoint | explicit authorization error |
| one unreadable file | policy gap/failure | file diagnostic |
| source mutates | current Snapshot fixed | next run detects change |
| model timeout | retry current unit | completed units retained |
| explicit Pause | checkpoint then pause | requested → paused |

## 15. Invariants

- **INV-1:** Browser lifecycle events never change job state.
- **INV-2:** Only the current server lease owner executes scan or analysis units.
- **INV-3:** One job is pinned to one immutable SourceSnapshot.
- **INV-4:** AnalysisRun cannot start before SourceScanRun and Fact commit finish.
- **INV-5:** Completed scan and analysis units are never repeated.
- **INV-6:** Only explicit Pause changes desired state to paused.
- **INV-7:** Manually paused jobs remain paused through refresh and restart.
- **INV-8:** Running jobs automatically recover after worker/API restart.
- **INV-9:** Client connection and server job states remain separate.
- **INV-10:** Scan, Facts, and Analysis belong to the same Project and Snapshot.
- **INV-11:** External models never receive raw source or secrets.
- **INV-12:** Scanner capability may not regress at cutover.

## 16. Acceptance

### Scan stage

- Start a repository with at least 10,000 files and refresh ten times; job and scan run IDs remain unchanged.
- Close the browser for at least 30 seconds; server completed-file count increases.
- Pause scanning; after `PAUSED`, progress stops and refresh preserves pause.
- Resume the same Snapshot and prove completed file units were not executed again.
- Restart the API during scan and prove automatic recovery from the last committed checkpoint.

### Analysis stage

- Refresh, close, and disconnect without terminating AnalysisRun.
- Pause and resume the same analysis run.
- Prove completed Agent WorkUnits do not call model or Skill again.
- Recover running work after worker/API restart while preserving manual pause.

### Security and consistency

- Reject non-allowlisted roots, traversal, and symlink escape.
- Keep source bodies and secrets out of browser requests, API reads, logs, and external model inputs.
- Keep the current Snapshot immutable when source changes.
- Pass multilingual scanner parity fixtures before cutover.

### User experience

- Refresh changes connection state only.
- Scan and Agent progress are independently visible under one job.
- Mount, refresh, reconnect, and polling paths are GET-only.

## 17. Non-goals

- Service Worker, SharedWorker, or hidden-tab execution.
- Automatic Resume triggered by refresh.
- Remote Git or browser-upload connectors in phase one.
- Multi-datacenter scheduling.
- Automatic Candidate-to-Feature promotion.
- Exactly-once external model transport; the guarantee is idempotent result commit and no replay of completed units.

## 18. Delivery phases

1. Contracts and persistence for registrations, Snapshots, scan runs, and jobs.
2. Canonical server scanner with spool, checkpoints, relation resolution, and language parity.
3. Unified orchestration from scan through Candidate projection.
4. Worker lease, fencing, and restart recovery.
5. Browser thin client with command and read-only subscription surfaces.
6. Compatibility migration and removal of browser execution authority.
7. Large-repository, refresh, disconnect, pause/resume, restart, and visual acceptance.

The detailed TDD plan is
[`feature-specs/2026-07-29-server-owned-workspace-scan-and-analysis-lifecycle.md`](../../feature-specs/2026-07-29-server-owned-workspace-scan-and-analysis-lifecycle.md).
