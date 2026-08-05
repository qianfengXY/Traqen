> Language: **English** · [简体中文](F004-claim-review.zh-CN.md)

---
feature_ids: [F004]
related_features: [F001, F002]
topics: [claim-review, batch-review, evidence, governance, frontend, user-journey]
doc_kind: spec
created: 2026-07-31
---

# F004: Claim Review

> **Status**: spec | **Owner**: TBD | **Priority**: P0

## Why

Traqen must fail closed on weak evidence without turning review into a one-ID-at-a-time diagnostic form. Reviewers need a Workspace queue, batch actions, and the ability to correct outcomes that automation previously admitted.

## What

F004 owns the review projection and Decision commands for:

- evidence-insufficient or conflicting Candidates;
- policy-selected samples;
- automatically admitted Candidate mappings;
- stale outcomes after an incremental change.

Automated admission is a reversible review state. Only an authorized Decision creates or revises governed objects.

## User journey

1. Open the current Workspace review queue.
2. Filter by evidence state, Candidate type, risk, source module, model/Skill provenance, or change status.
3. Select one or multiple compatible items.
4. Inspect source evidence and conflicts; edit normalized statements, scope, mappings, and rationale.
5. Confirm, reject, defer, mark insufficient evidence, or record an exception.
6. See immutable audit events and optimistic-concurrency failures instead of silent overwrites.

## Frontend product experience

### Workspace review queue

F004 opens the current Workspace queue without asking for Run or Candidate IDs. The page contains:

- filters for evidence state, Candidate type, risk, source module, model/Skill provenance, and change state;
- a queue ordered by blocking risk and staleness, with recoverable selection and filter state;
- a compatibility-aware batch toolbar that explains why selected entries can or cannot share a command;
- a detail/decision workspace showing source evidence, Agent provenance, conflicts, confidence caps, immutable history, and editable normalized statement, Scope, Mapping, and Rationale;
- explicit Confirm, Reject, Defer, Insufficient Evidence, and Record Exception outcomes where the command contract permits them.

Batch selection is a command envelope, not one all-or-nothing Decision. The client validates compatibility before submission; the server records a separate Decision and Audit Event per item, and the result view preserves successes, failures, and retryable items.

### Integrity, conflict, and responsive states

- **Empty queue:** confirm that the current filters or Workspace have no review items and expose completed/history views where authorized.
- **Invalid evidence:** disable Confirm until the invalid resolver is removed or replaced by authorized evidence, while preserving the proposed edits.
- **Version conflict:** compare the user's input with the newer server version and require an explicit new command; never silently overwrite either side.
- **Partial batch failure:** retain the batch receipt and per-item outcome, then allow retry only for eligible failures.
- **Workspace switch:** clear selection and unsaved commands only after warning about local edits; never submit them to the new Workspace.

Desktop uses queue/detail panes. Mobile uses queue-to-review navigation, keeps the decision summary visible before submission, and returns to the same queue position. Reviewer identity and authority are server-owned and cannot be entered as trusted free text.

### Frontend acceptance

- [ ] Queue entry, filtering, evidence inspection, and decisions never require manual Run or Candidate IDs.
- [ ] Incompatible batch selections explain the incompatible command or authority boundary before submission.
- [ ] Every item retains an independent Decision/Audit result, including partial batch failure and retry state.
- [ ] Invalid evidence, confidence caps, conflicts, automated-admission status, and immutable prior Decisions remain visible during editing.
- [ ] Concurrent edits preserve both inputs, and desktop, keyboard, and mobile journeys can complete the same governed Decision.

## Acceptance criteria

- [ ] The queue is Workspace-scoped and never requires manually entering Run/Candidate IDs.
- [ ] Batch actions validate that selected items use a compatible command and retain one Decision/audit event per item.
- [ ] Reviewers can edit an automatically admitted item before or after admission through a new Decision, never by mutating history.
- [ ] Evidence-invalid Candidates cannot be confirmed until the invalid references are removed or replaced with authorized evidence.
- [ ] Conflicts and confidence caps remain visible during review.
- [ ] Concurrent edits fail with a version conflict and preserve both users' inputs.
- [ ] Bulk operations are resumable and expose partial failure explicitly.

## Current gap

Implementation commit `1682d7d` can load one Reverse Candidate by manually entered IDs and submit one review. It has no Workspace queue, batch command, or editor for automated admissions.

## Dependencies

F001 provides Candidates, ledgers, identity, and authority boundaries. F002 provides the Feature/API context and evidence detail projection.

## Non-goals

- majority-vote approval;
- mutating past Decisions;
- hiding rejected or insufficient-evidence outcomes.
