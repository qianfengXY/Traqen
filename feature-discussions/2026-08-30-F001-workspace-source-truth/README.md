> Language: **English** · [简体中文](README.zh-CN.md)

---
feature_ids: [F001]
related_features: [F002, F003, F004, F006]
topics: [workspace, source-truth, git, source-snapshot, coverage-gap, convergence]
doc_kind: feature-discussion
created: 2026-08-30
status: converged
decision_status: operator-authorized
---

# F001 Design Convergence: Workspace & Source Truth

## Decision record

The operator asked the team not to use the earlier F001 proposal as product input, to redesign around the stated goal, and then authorized execution of the recommended decisions: “按推荐建议执行”. This record supersedes the 2026-07-29 F001 discussion as the current product-decision source; it preserves that discussion and Git history as historical context.

The three independent perspectives converged on one principle: F001 is not a scanner that reports success. It is the evidence boundary that tells downstream analysis exactly which source it may trust, which material it did not obtain, and whether a human accepted a non-blocking limitation.

## Confirmed product decisions

| Topic | Final decision | Reason |
| --- | --- | --- |
| Source boundary | One Workspace uses one read-authorized Git repository and a fixed committed revision per snapshot. | A commit is replayable; a live directory or dirty worktree is not. |
| Scope | Default to the full committed repository; permit one optional directory root. | It handles monorepos without becoming a configuration language. |
| Scope controls | Do not expose glob/regex, multiple roots, or “code only” material categories in the MVP. | These controls create silent, user-authored blind spots in documents, configuration, SQL, and tests. |
| Gap governance | Only non-blocking gaps may be accepted; acceptance records person, reason, and expiry, but never removes the gap. | Legacy repositories can proceed honestly while identity, integrity, and boundary failures remain fail-closed. |
| Consumption status | No-gap capture may be `READY`; an accepted non-blocking gap yields `READY_WITH_ACCEPTED_GAPS`; otherwise the result is `BLOCKED`. | A receipt shows independent dimensions instead of hiding them behind scan success or one health score. |
| Downstream admission | F002–F004 receive only a qualifying snapshot and inherited gaps. | A downstream path or branch reference would bypass the evidence boundary. |
| Pilot order | Prove the contract on a controlled Git reference repository, then use a real legacy repository. | The team can test failure cases deliberately before exposing a real system. |

## Reference-pilot slice

1. Register a controlled Git repository and resolve a selected branch to Commit A.
2. Select one service directory root; show the rest of the repository as out of scope, not analyzed.
3. Capture all discovered items in scope, including code, documentation, configuration, tests, a safely redacted sensitive fixture, and a deliberately unavailable non-blocking item.
4. Record and accept that non-blocking Gap with a reason and expiry; issue `READY_WITH_ACCEPTED_GAPS`.
5. Re-run the same Commit A and prove that the source result is replayable; move the branch and prove the old snapshot stays unchanged.
6. Let an F002 admission fixture consume only the snapshot ID and inherited Gap; direct path and branch input must be rejected.
7. Capture Commit B, which has a path-escape or integrity failure; it must remain `BLOCKED` and issue no consumable receipt.

## Scope exclusions

- No arbitrary local paths, dirty worktrees, archives, multi-repository aggregation, recursive submodules, multiple roots, or continuous listening.
- No user-defined include/exclude rules, material-type switches, security bypasses, or user-controlled integrity and Gap severity.
- No API or call-graph extraction, Agent semantics, business-function claims, test execution, change impact, repository script execution, or source mutation. Those belong to F002–F004 or a later feature.

## Traceability

- Current acceptance contract: [F001 specification](../../docs/features/F001-legacy-system-understanding.md)
- Architectural decision: [ADR-0003](../../docs/decisions/ADR-0003-source-truth-boundary.md)
- Immediate downstream consumer: [F002 specification](../../docs/features/F002-feature-api-traceability.md)
- Historical, superseded discussion: [2026-07-29 F001 discussion](../2026-07-29-F001-legacy-system-understanding/README.md)

## Convergence checks

1. Rejected alternatives → ADR? **Yes — recorded in ADR-0003.**
2. Reusable operational lesson → public lessons? **No.**
3. New repository-wide operating rule → instruction file? **No.** The decision is a product contract, not a team operating rule.
