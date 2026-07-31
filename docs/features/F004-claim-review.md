> Language: **English** · [简体中文](F004-claim-review.zh-CN.md)

---
feature_ids: [F004]
related_features: [F001, F002]
topics: [claim-review, batch-review, evidence, governance]
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
