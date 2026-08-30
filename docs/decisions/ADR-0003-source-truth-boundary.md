> Language: **English** · [简体中文](ADR-0003-source-truth-boundary.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004]
related_features: [F006]
topics: [source-truth, git, source-snapshot, coverage-gap, provenance, downstream-admission]
doc_kind: adr
created: 2026-08-30
status: accepted
---

# ADR-0003: Source Truth Boundary and Downstream Admission

## Context

F001 is the evidence foundation for legacy-system analysis. Without an explicit source boundary, a scan can finish while operating on a moving branch, a local uncommitted directory, or a silently incomplete subset. Downstream facts and semantic claims would then appear traceable while actually referring to mutable or unknown input.

The operator authorized the 2026-08-30 F001 convergence. This ADR records the product boundary needed for a source receipt to be usable by F002–F004.

## Decision

1. A Source Truth MVP snapshot represents exactly one Workspace-scoped, read-authorized Git repository at one resolved, committed revision.
2. The declared scope is the whole committed repository by default, or one optional directory root. The MVP provides no multiple roots, glob/regex rules, or material-category switches.
3. Capture is read-only and safe: it does not run repository-provided code, hooks, builds, dependency installation, or untrusted filters; it fails closed on untrusted boundary or integrity conditions.
4. Every discovered item in the declared scope receives one explicit disposition. Missing, excluded, redacted, external, unreadable, or failed material remains visible and may create a `CoverageGap`.
5. Only non-blocking gaps may be accepted. Acceptance records a responsible person, rationale, and expiry; it neither removes the gap nor changes the source coverage claim. Identity, integrity, path-boundary, policy, and tampering failures are blocking.
6. A `SourceTruthReceipt` separately expresses identity, scope, integrity, coverage, Gap acceptance, and one consumability state: `READY`, `READY_WITH_ACCEPTED_GAPS`, or `BLOCKED`.
7. F002–F004 consume only a `READY` or `READY_WITH_ACCEPTED_GAPS` snapshot and inherit relevant gaps. They reject direct filesystem paths, branch names, dirty worktrees, incomplete snapshots, and blocked receipts.

## Rejected alternatives

### Live local directory or dirty-worktree source

Rejected because its contents cannot be replayed by another operator, and local edits can silently change the analytical evidence after registration.

### Arbitrary scope rules or material-type selection

Rejected because a user can accidentally omit documentation, configuration, SQL, or tests while still receiving a successful scan. One directory root is an intelligible boundary; a rules language is not a trustworthy first boundary.

### All gaps block, or every gap may be accepted

Rejected because all-blocking makes common legacy repositories unusable, while universal acceptance turns integrity and permission failures into a click-through warning. The non-blocking acceptance rule preserves both flow and truthfulness.

### Scanner success or zero gaps as the release condition

Rejected because job completion says nothing about input integrity, while zero gaps creates pressure to hide known limitations. Separate receipt dimensions make limitations auditable.

### Downstream direct source access

Rejected because it bypasses the pinned source and allows F002–F004 to derive output from material that the receipt never accounted for.

## Consequences

- A product user makes only source, authorization, revision, and optional directory-root choices; platform policy owns safety and integrity controls.
- A root-scoped receipt must never claim whole-repository coverage.
- Non-blocking gaps remain part of every downstream fact, candidate, claim, execution result, or impact recommendation derived from the snapshot.
- Support for a local sealed file set, archives, multiple repositories, multiple roots, or continuous monitoring requires a new source-identity contract; it cannot be added as an unlabelled option.

## Verification

- replay the same repository commit, scope, and policy twice and verify the same source identity and inventory integrity result;
- prove branch movement does not change a sealed snapshot;
- prove every in-scope item receives one disposition and no sensitive raw content is emitted;
- prove an accepted non-blocking Gap remains visible to an F002 consumer;
- prove path escape, failed integrity, or untrusted source identity remain `BLOCKED` and cannot become consumable; and
- prove F002 rejects source references other than a qualifying receipt.
