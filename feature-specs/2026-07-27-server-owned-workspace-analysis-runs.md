---
feature_ids: [F001]
topics:
  - workspace
  - analysis-run
  - server-owned-lifecycle
  - pause-resume
  - browser-refresh
doc_kind: implementation-plan
created: 2026-07-27
---

# Server-owned Workspace Analysis Runs Implementation Plan

> **Scope correction — 2026-07-29:** This implemented plan covers the server `AnalysisRun` after browser-owned source preparation has completed. It does not meet the requirement that file scanning continue independently of browser refresh or closure. The proposed P0 [server-owned Workspace scan and Analysis lifecycle](../docs/features/workspace-scan-and-analysis-lifecycle.md) and its [implementation plan](2026-07-29-server-owned-workspace-scan-and-analysis-lifecycle.md) are authoritative for the complete two-stage lifecycle.

**Feature:** Workspace analysis — `docs/features/workspace-analysis-design.md`
**Goal:** A Workspace analysis accepted by the API continues independently of browser refreshes, and only an explicit user command pauses or resumes the same checkpointed server run.
**Acceptance Criteria:** (1) Refreshing or reopening the page never pauses, resumes, restarts, or duplicates a running analysis; (2) only the server may report `RUNNING`; (3) Pause and Resume are explicit API mutations; (4) Resume keeps the same run ID and does not repeat completed WorkUnits; (5) raw project files are not uploaded or persisted; (6) completed server results update the local Candidate projection for the exact Snapshot; (7) the deterministic run pointer is persisted before Start, while stale pointers fail explicitly without inventing progress.
**Architecture cell:** N/A — this repository does not yet contain `docs/architecture/ownership/README.md`; ownership remains in the existing browser Workspace, application AnalysisRun, and Fact-store modules.
**Map delta:** none
**Map delta why:** No ownership map exists to update. This plan removes browser ownership of the run lifecycle and reuses the existing server AnalysisRun owner rather than creating a parallel queue.
**Architecture:** The browser performs bounded deterministic source preparation locally and sends only validated derived observations. The API normalizes those observations into Snapshot-bound Facts, then the existing asynchronous Analysis Agent owns execution, checkpointing, pause, resume, and results. The browser persists only a run subscription and performs read-only polling after start.
**Tech Stack:** Next.js/React, IndexedDB, Node HTTP API, TraceabilityApplication, AnalysisAgent, memory/PostgreSQL traceability stores, JSON Schema/OpenAPI.
**前端验证:** Yes — reviewer must refresh the page repeatedly during a real server run and verify that the server run ID/status/progress are unchanged except for work completed by the server.

---

## Finish line and exclusions

The finish line is one server-owned `AnalysisRun` whose status remains authoritative while zero, one, or many browser pages observe it.

This change does not:

- upload complete source files or real `.env` values;
- add a distributed multi-instance worker lease;
- make IndexedDB authoritative;
- automatically resume a run on refresh;
- promote Candidates into governed Features.

## Terminal schemas

```ts
type WorkspaceObservationRequest = {
  workspaceName: string;
  rootName: string;
  observedAt: string;
  records: Array<{
    path: string;
    size: number;
    contentFingerprint: string;
    supported: boolean;
    candidates: Array<{
      localCandidateId: string;
      kind: "ENDPOINT" | "CODE_SYMBOL" | "COMMAND";
      name: string;
      method: string | null;
      modulePath: string;
      sourcePath: string;
      startLine: number;
      description: string;
    }>;
    configuration: { path: string; key: string; value: string } | null;
    test: { path: string; title: string } | null;
  }>;
};

type WorkspaceObservationReceipt = {
  projectId: string;
  snapshotManifestId: string;
  sourceComponentId: string;
  factBundleId: string;
  candidateFacts: Array<{
    localCandidateId: string;
    stableNodeId: string;
    factId: string;
  }>;
};

type WorkspaceRunSubscription = {
  projectId: string;
  runId: string;
  snapshotManifestId: string;
  sourceComponentId: string;
  modelProfileId: string;
  rootName: string;
  status: "SUBMITTING" | "RUNNING" | "PAUSED" | "COMPLETED" | "COMPLETED_WITH_GAPS" | "CANCELLED";
  candidateFacts: WorkspaceObservationReceipt["candidateFacts"];
  createdAt: string;
  updatedAt: string;
};
```

## Lifecycle census

### 1. WorkspaceSourcePreparation

Unique owner: the active browser page.

| Current state | Event | Next state | Side effect |
|---|---|---|---|
| `IDLE` | user selects Start | `SCANNING` | Read supported local files in bounded batches |
| `SCANNING` | local scan checkpoint | `SCANNING` | Persist derived records in IndexedDB |
| `SCANNING` | observations accepted by API | `SUBMITTED` | Persist receipt and server run subscription |
| `SCANNING` | refresh/close | `INTERRUPTED` | No server run status is changed |
| `INTERRUPTED` | user starts preparation again | `SCANNING` | Reuse compatible local records |
| `SUBMITTED` | any browser event | `SUBMITTED` | No lifecycle mutation; server owns the run |

Generic pause/resume APIs are forbidden for this object. Before API acceptance the UI says `PREPARING`, never `RUNNING`.

### 2. AnalysisRun

Unique owner: `TraceabilityApplication` + `AnalysisAgent` on the API server.

| Current state | Event | Next state | Side effect |
|---|---|---|---|
| absent | `POST analysis-runs` | `RUNNING` | Plan WorkUnits, persist checkpoint, launch server execution |
| `RUNNING` | server completes WorkUnit | `RUNNING` | Persist completed unit and result fragment |
| `RUNNING` | explicit Pause API | `PAUSED` | Abort after bounded unit boundary and persist pause |
| `PAUSED` | explicit Resume API | `RUNNING` | Launch only non-completed WorkUnits under the same run ID |
| `RUNNING` | all units complete | `COMPLETED` / `COMPLETED_WITH_GAPS` | Persist immutable result |
| terminal | pause/resume/start with same ID | terminal / conflict | Never create a replacement run |
| any | browser refresh/poll/offline | unchanged | No mutation |

Generic project/snapshot deletion or replacement may not silently resurrect or clone an AnalysisRun.

### 3. WorkspaceRunSubscription

Unique owner: browser IndexedDB as a non-authoritative pointer; server response is the only status source.

| Current state | Event | Next state | Side effect |
|---|---|---|---|
| absent | observations accepted | submitting | Save deterministic run ID and Fact mapping before Start |
| submitting | server accepts run | attached | Replace local pointer status with server checkpoint |
| attached | page mount/refresh | attached | `GET` current checkpoint only |
| attached | poll response | attached | Replace cached projection with server fields |
| attached | explicit Pause click | attached | `POST pause`, then save returned server status |
| attached | explicit Resume click | attached | `POST resume`, then save returned server status |
| attached | terminal response | terminal-attached | Materialize exact Snapshot result locally |
| attached | 404 | stale | Stop polling and show server-truth error |

The subscription has no independent `RUNNING` transition and no timer-owned mutation.

## Invariants and test matrix

- **INV-1:** Only a server response may set a run status to `RUNNING`. Test: source contract and client unit test reject local promotion.
- **INV-2:** Mount, refresh, reconnect, and polling are read-only. Test: repeated attachment calls issue only `GET`.
- **INV-3:** Pause and Resume mutations occur only from explicit handlers. Test: client unit tests count mutation calls.
- **INV-4:** Resume preserves `runId`, Snapshot, WorkUnits, and completed count. Test: existing AnalysisAgent checkpoint test plus HTTP integration.
- **INV-5:** Completed WorkUnits are never re-executed. Test: resume adapter call count remains unchanged for completed units.
- **INV-6:** Browser preparation never displays `RUNNING`. Test: rendered source contract and browser acceptance.
- **INV-7:** Observation payloads contain no raw file content, candidate code excerpt, test code, or secret-bearing configuration value. Test: schema rejection and payload builder test.
- **INV-8:** A completed result is materialized only when project, Snapshot, and run IDs match the subscription. Test: projection adapter rejects mismatches.
- **INV-9:** The run pointer is durable before Start and multiple tabs cannot create a duplicate run with the same ID. Test: pre-Start subscription plus idempotent `submitAnalysisRun`.
- **INV-10:** A pause racing terminal completion resolves to the persisted terminal server state, never a fabricated pause. Test: application concurrency case.

## Adversarial scenarios

1. Refresh ten times while the server is between WorkUnits: all pages observe the same run ID and non-decreasing completed count.
2. Browser closes immediately after `202`: reopening uses the saved subscription and only `GET`s.
3. Browser goes offline: server continues; reconnect observes later progress.
4. Pause double-click: one server transition, second response is idempotent/current or a documented conflict.
5. Resume double-click: active-controller guard launches only one executor.
6. Pause races final completion: terminal state wins.
7. Stale subscription points to deleted/missing run: UI stops polling and reports stale state.
8. Source changes during local preparation: a new source digest/Snapshot is required before start.
9. Model failure: failed WorkUnit remains checkpointed and completed units remain reusable.
10. API process restart: persisted checkpoint remains queryable; automatic worker re-leasing is explicitly outside this browser-refresh change.

## Implementation tasks

### Task 1: Derived-observation contract and normalization

**Files:**
- Create: `contracts/workspace-observation.schema.json`
- Create: `src/domain/workspace-observations.js`
- Modify: `src/domain/index.js`
- Test: `test/workspace-observations.test.js`

1. Write failing tests for bounded, code-free observation inputs and deterministic Fact mapping.
2. Verify RED because the normalizer does not exist.
3. Implement validation and FactBundle creation with server-normalized provenance.
4. Verify exact node/Fact mappings and raw-source rejection.

### Task 2: API persistence boundary

**Files:**
- Modify: `src/application/traceability-application.js`
- Modify: `src/api/http-server.js`
- Modify: `contracts/openapi.json`
- Test: `test/api-http.test.js`
- Test: `test/contracts.test.js`

1. Write failing API and OpenAPI tests for `POST /v1/projects/{projectId}/workspace-observations`.
2. Verify RED.
3. Persist a source-only Snapshot and derived FactBundle so an AnalysisRun can immediately reference it.
4. Return the receipt with local Candidate to stable Fact mapping.
5. Verify wrong project, malformed input, and duplicate idempotent ingestion cases.

### Task 3: Server-run browser client and subscription store

**Files:**
- Create: `web/app/workspace-analysis-run-client.ts`
- Modify: `web/app/local-workspace-store.ts`
- Test: `web/tests/workspace-analysis-run-client.test.mjs`

1. Write failing tests for observation payload redaction, run start, read-only reattachment, explicit pause/resume, and result identity checks.
2. Verify RED.
3. Implement the client and `WorkspaceRunSubscription`.
4. Verify repeated attachment performs only `GET`.

### Task 4: WorkspaceAnalysisView ownership transfer

**Files:**
- Modify: `web/app/traqen-product.tsx`
- Modify: `web/app/local-workspace-analysis.ts`
- Test: `web/tests/rendered-html.test.mjs`
- Test: `web/tests/analysis-model-client.test.mjs`

1. Replace browser model WorkUnit execution with observation ingestion and server run start.
2. Render local scanning as preparation, not `RUNNING`.
3. Poll the stored server run on mount and while it is running.
4. Route Pause and Resume only to server mutation endpoints.
5. Materialize completed server candidates into the existing local projection using the receipt mapping.
6. Remove automatic browser resume and page-owned run status writes.

### Task 5: Documentation, gates, and acceptance

**Files:**
- Modify: `docs/features/workspace-analysis-design.md`
- Modify: `docs/features/workspace-analysis-design.zh-CN.md`
- Modify: `docs/bug-report/workspace-analysis-refresh-resume.md`
- Modify: `docs/bug-report/workspace-analysis-refresh-resume.zh-CN.md`
- Modify: `review-notes/2026-07-27-refresh-safe-workspace-runs-review-request.md`

1. Run targeted RED/GREEN tests after every task.
2. Run `env -u NODE_ENV npm test`.
3. Run `env -u NODE_ENV npm run test:web`.
4. Run `env -u NODE_ENV npm --prefix web run lint`.
5. Run `git diff --check`.
6. Start isolated API/Web ports and verify repeated browser refresh, explicit Pause, explicit Resume, and same-run progress.
7. Commit, push, and request cross-individual review while PR #5 remains Draft until approval.
