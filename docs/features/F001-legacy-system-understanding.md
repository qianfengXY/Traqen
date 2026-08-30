> Language: **English** · [简体中文](F001-legacy-system-understanding.zh-CN.md)

---
feature_ids: [F001]
topics: [workspace, source-truth, source-snapshot, artifact-inventory, coverage-gap, provenance, git]
doc_kind: feature-spec
created: 2026-08-29
updated: 2026-08-30
description: Establish a reproducible, permissioned Git-source receipt that downstream legacy-system analysis can trust without concealing coverage gaps.
description_source: human
description_author: co-creator
description_updated_at: 2026-08-30T06:44:00Z
---

# F001 — Workspace & Source Truth

**Status:** Spec
**Owner:** CodeX
**Related:** F006 workspace capability settings

## Why

Before Traqen can explain a legacy system, it must prove exactly which source it examined and what it could not obtain. A branch name, live checkout, or successful scanner exit is not evidence. F001 makes that source boundary reproducible and visible, so F002–F004 cannot present conclusions as complete when their input was partial.

## Current state

The prior F001 baseline already named immutable snapshots, artifact inventory, and explicit dispositions. It left the first source type, scope controls, Gap authority, readiness status, and downstream admission ambiguous. The operator has now approved those product choices in the [2026-08-30 convergence record](../../feature-discussions/2026-08-30-F001-workspace-source-truth/README.md).

## Outcome

F001 creates one Workspace-scoped, read-only source foundation for one Git repository pinned to one committed revision. The architect registers a read-authorized source, selects a branch, tag, or commit, and Traqen resolves it to an exact commit before capture. Scope is the full committed repository by default, or one explicitly selected directory root—not a file-type selector or rule language.

A sealed `SourceSnapshot` contains an `ArtifactInventory`, explicit `CoverageGap` records, and a `SourceTruthReceipt`. Re-capture creates a new snapshot and never rewrites an old one. Capture does not run repository scripts, hooks, builds, dependency installation, or untrusted filters, and sensitive raw content never bypasses approved access controls.

A receipt is `READY`, `READY_WITH_ACCEPTED_GAPS`, or `BLOCKED`. A no-Gap snapshot may become `READY` automatically. A snapshot with only non-blocking gaps requires a recorded human acceptance before it can become `READY_WITH_ACCEPTED_GAPS`. A blocking condition can never be accepted away. F002 consumes only a qualifying receipt and its snapshot, never a filesystem path, branch name, dirty checkout, or incomplete snapshot.

F001 does not infer business meaning, parse APIs, run tests, or claim change impact. Those are later capabilities.

## User journey

1. An architect creates or opens a Workspace, selects a read-authorized Git repository and a branch, tag, or commit; Traqen shows the resolved commit.
2. The architect keeps the default whole-repository scope or selects one directory root.
3. Traqen automatically preflights source identity, read permission, revision, boundary, external content, and capture safety; it reports **can start**, **can start with expected gaps**, or **blocked** with an actionable reason.
4. Traqen captures an immutable snapshot and accounts for every discovered item in the declared scope.
5. The architect reviews Source Coverage: captured material, policy isolation, redaction, unavailable external material, failures, and gaps.
6. If only non-blocking gaps remain, the architect records a responsible person, reason, and expiry. Blocking conditions must be resolved.
7. F002 receives the qualifying snapshot ID and inherited gaps, rather than a mutable source reference.

## Scope

### In scope

- One Workspace, one read-authorized Git repository, and one exact committed revision per snapshot.
- Automatic source preflight for source identity, read permission, revision resolution, scope boundary, external-content boundary, and capture safety.
- Immutable snapshot identity: repository identity, exact commit, declared scope, content/integrity digest, capture time, and scanner version.
- Artifact inventory records with path, kind, size, safe content digest where captured, one disposition, and a disposition reason.
- Explicit coverage states for captured, policy-isolated, redacted, unavailable, unreadable, failed, and out-of-scope material.
- Full-repository default scope with one optional directory root; a root-scoped receipt visibly states that the rest of the repository is out of scope.
- Non-blocking Gap acceptance with responsibility, rationale, expiry, and downstream inheritance.
- Manual re-capture and history; a new source revision always creates a new snapshot.

### Out of scope

- Arbitrary paths, non-Git archives, uncommitted or dirty worktrees, multi-repository aggregation, multiple directory roots, and continuous source listening.
- User-defined glob/regex rules, material-category switches such as “code only,” or user-controlled security, integrity, and Gap-severity rules.
- Extracting facts or constructing an API tree (F002); LLM semantic interpretation, human review, or the business-function tree (F003); test execution evidence, impact analysis, and revalidation advice (F004).
- Repository script execution, builds, dependency installation, source mutation, CI gating, and production deployment enforcement.

## Required records

| Record | Minimum fields |
| --- | --- |
| `Workspace` | workspace ID, read-authorized source registration, owner, and isolation of snapshots, coverage, history, and permissions |
| `SourceSnapshot` | snapshot ID, repository identity, exact commit, declared scope, integrity identity, capture time, and scanner/policy version |
| `ArtifactInventoryItem` | snapshot ID, artifact locator, kind, size, safe content digest where captured, disposition, and disposition reason |
| `CoverageGap` | affected scope, severity, reason, downstream consequence, and follow-up state |
| `GapAcceptance` | non-blocking gap ID, responsible person, rationale, expiry, and immutable acceptance record |
| `SourceTruthReceipt` | separated source identity, scope, integrity, coverage, gaps, acceptance, and `READY` / `READY_WITH_ACCEPTED_GAPS` / `BLOCKED` consumability |

An unreadable file is not silently absent: it produces an inventory disposition and, where it limits analysis, a `CoverageGap`. Content digests exist only where content was safely captured. Blocking conditions include unverified repository or revision identity, inaccessible or untrusted source boundary, failed integrity verification, path escape, policy conflict, and suspected tampering; they cannot be overridden by a Gap acceptance.

## Acceptance criteria

- [ ] **AC-A1:** A controlled Git repository can be registered read-only, and a selected branch or tag is resolved to an exact commit before capture.
- [ ] **AC-A2:** The only MVP scopes are whole repository and one directory root; a directory-root receipt visibly states that repository material outside the root is out of scope.
- [ ] **AC-A3:** Two captures of the same repository commit, scope, and capture policy yield the same snapshot identity and inventory integrity result; later branch movement does not alter the old snapshot.
- [ ] **AC-A4:** Every discovered item in the declared scope has exactly one disposition and reason; unreadable, redacted, excluded, unavailable, or failed material is not silently omitted.
- [ ] **AC-A5:** Capture neither executes repository-provided code nor exposes sensitive raw content through the receipt, inventory, UI, or diagnostic output.
- [ ] **AC-A6:** A non-blocking Gap remains visible after recorded acceptance and is inherited by downstream consumers; a blocking condition cannot become consumable through acceptance.
- [ ] **AC-A7:** F002 accepts only a `READY` or `READY_WITH_ACCEPTED_GAPS` snapshot and rejects direct source paths, branch names, dirty worktrees, and `BLOCKED` or incomplete snapshots.
- [ ] **AC-A8:** The reference pilot proves replay, explicit coverage, non-blocking-gap inheritance, and a blocking path that cannot issue a consumable receipt.

## Requirements Checklist

| ID | Requirement | AC | Verification | Status |
| --- | --- | --- | --- | --- |
| R1 | An architect can identify the exact source used for analysis. | AC-A1, AC-A3 | controlled Git replay | [ ] |
| R2 | A monorepo can be bounded without hiding what was excluded from the boundary. | AC-A2, AC-A4 | directory-root pilot | [ ] |
| R3 | Missing material is visible and cannot be silently accepted as complete. | AC-A4, AC-A6 | Gap acceptance and blocking tests | [ ] |
| R4 | Downstream conclusions remain tied to one trustworthy input. | AC-A7 | F002 admission test | [ ] |
| R5 | The foundation does not execute or leak the source it is meant to protect. | AC-A5 | negative security tests | [ ] |

## Reference pilot

The pilot uses a controlled Git reference repository with two commits and a named service directory. Commit A contains code, documentation, configuration, tests, a safely handled sensitive fixture, and one deliberately unavailable non-blocking external item. Commit B introduces a path-escape or integrity failure.

The pilot captures Commit A with the service directory as the sole root, proves the other repository material is visibly out of scope, accepts the non-blocking gap with a rationale and expiry, and proves F002 can consume only the resulting receipt. Replaying Commit A yields the same source result; moving the selected branch does not change it. Capturing Commit B is `BLOCKED` and cannot issue a consumable receipt.

## Open questions

None at the product-boundary level. Connector and storage mechanics belong to implementation planning and may not weaken this contract.

## Dependencies and handoff

F001 is the evidence boundary for F002–F004. F006 supplies related Workspace capability settings; F001's source capture does not run Agents. F002 consumes only a qualifying F001 receipt, immutable snapshot, complete inventory, and inherited gaps.

## Decision record

- [2026-08-30 F001 source-truth convergence](../../feature-discussions/2026-08-30-F001-workspace-source-truth/README.md)
- [ADR-0003: Source Truth boundary and downstream admission](../decisions/ADR-0003-source-truth-boundary.md)

**Next:** F002 consumes a qualifying receipt, snapshot, inventory, and inherited gaps to create deterministic evidence facts and the API-structure projection.
