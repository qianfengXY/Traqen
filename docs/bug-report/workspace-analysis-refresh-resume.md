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

# Workspace analysis changed to paused after refresh

## Diagnosis capsule

| Field | Evidence |
|---|---|
| Symptom | Refreshing the browser while a Workspace analysis was running displayed the task as paused. Continuing it created a new-looking Agent session and repeated Main-Agent planning. |
| Minimal reproduction | Start a local Workspace analysis, wait for at least one persisted checkpoint, refresh, then inspect the task status and select Continue analysis. |
| First bad boundary | `WorkspaceAnalysisView` restored every IndexedDB checkpoint as `PAUSED`, regardless of the persisted `RUNNING` or `PAUSED` status. |
| Root cause | The executor belongs to the browser page lifecycle, so refresh ends that JavaScript invocation. The recovery effect then discarded the durable status and required a manual restart. Resume already filtered persisted model classifications, but it regenerated the visible task session and model plan, making checkpoint recovery look and partly behave like a new run. |
| Fix | Persist `RUNNING` before exposing the Pause control; preserve all persisted run states; automatically reattach only `RUNNING`; persist an explicit pause request before the current unit boundary; keep `PAUSED` and `FAILED` distinct; reuse the same run ID; reconstruct only remaining queues; skip persisted file records and model classifications. |
| Safety boundary | Raw source still stays in the browser. Refresh recovery uses the retained directory handle and IndexedDB checkpoint; if permission is unavailable, the run remains durable and requires reauthorization rather than claiming work is progressing. |

## Regression coverage

- Running checkpoints recover as `RUNNING`, with automatic continuation and no artificial end time.
- A new or manually resumed run makes its `RUNNING` checkpoint durable before Pause becomes available.
- Explicitly paused checkpoints remain paused until manual resume.
- Failed checkpoints remain failed instead of being mislabeled as user pauses.
- Candidates already enriched under the same model/evidence policy are not enqueued again.
- Source-contract checks require automatic reattachment, explicit pause persistence, stable run identity, and remaining-only planning.
