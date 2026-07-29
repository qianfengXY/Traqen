> Language: **English** · [简体中文](workspace-analysis-refresh-resume.zh-CN.md)

---
feature_ids:
  - workspace-analysis
topics:
  - workspace
  - analysis-run
  - checkpoint
  - pause-resume
doc_kind: bug-report
created: 2026-07-27
---

# Workspace analysis was owned by the browser page

## Diagnosis capsule

| Field | Evidence |
|---|---|
| Symptom | Refreshing the browser destroyed the active analysis executor. The old recovery UI either showed a pause or restarted work from a browser checkpoint, even though the user never requested a lifecycle transition. |
| Minimal reproduction | Start a local Workspace analysis, wait until model WorkUnits are running, refresh the page one or more times, then compare the executor, run ID, status, and completed-unit count. |
| First bad boundary | `WorkspaceAnalysisView` owns the file loop, model batch loop, pause flag, Agent task, and `RUNNING` state inside one React component. Unmounting the page destroys the only executor. |
| Confirmed root cause | IndexedDB made data recoverable but did not make execution durable. A browser-owned Promise cannot satisfy a server-style `RUNNING` contract after the page is gone. The first patch preserved/replayed browser state, but it still treated refresh as an execution event and therefore did not meet the requirement. |
| Model-stage fix delivered on 2026-07-28 | Keep deterministic source preparation local, ingest only bounded derived observations as canonical Facts, and start the existing asynchronous server AnalysisRun. The browser stores a subscription, polls with `GET`, and sends Pause/Resume only from explicit user actions. This fixed the AnalysisRun phase but left source scanning browser-owned. |
| Remaining root cause | The page still owns source-directory access, file enumeration, extraction loops, scan cursors, and scan checkpoints. Refreshing during source scanning therefore destroys the only scan executor before a durable server job exists. |
| Safety boundary | Raw files, full source content, real `.env` values, and unredacted secrets remain local. Only bounded derived observations enter the server Fact boundary. |

## 2026-07-29 scope correction

The operator confirmed that the failing scenario is the **file-scanning phase**, not the later model/AnalysisRun phase. The previous fix and the regression list below prove only that an already-created server `AnalysisRun` survives refresh. They are not acceptance evidence for end-to-end Workspace analysis.

The authoritative P0 follow-up is the [server-owned Workspace scan and Analysis lifecycle](../features/workspace-scan-and-analysis-lifecycle.md). It moves source registration, immutable Snapshot capture, deterministic scanning, checkpointing, leases, and recovery to a server-side Local Runner, then hands the committed FactBundle to the existing Analysis Agent. Browser refresh remains read-only in both phases.

## Regression coverage

The following coverage applies to the delivered model/AnalysisRun phase only:

- Repeated mount, refresh, and reattach operations issue only `GET` and never Pause, Resume, or Start.
- Only a server response may display `RUNNING`.
- Explicitly paused checkpoints remain paused until the user calls Resume.
- Resume keeps the same server run ID and completed WorkUnits.
- The deterministic run pointer is persisted before Start, closing the refresh window around the `202 Accepted` response.
- Source content fingerprints participate in Snapshot identity even when file size and derived candidates are unchanged.
- Observation payloads reject raw code and secret-bearing configuration values.
- A completed result is projected only for the subscribed project, Snapshot, and run.
