---
topics: [sop, workflow, review, acceptance]
doc_kind: note
created: 2026-08-25
---

# Standard Operating Procedure

Traqen keeps product truth in this repository and uses Cat Café as its collaboration, review, and acceptance control plane. Git commits and project documents remain authoritative when chat state and repository state disagree.

## Delivery workflow

| Step | Required outcome | Evidence |
|------|------------------|----------|
| 1. Discovery | Read the current code, documents, history, and operator requirements before proposing change | Current-state report with code/document/commit anchors |
| 2. Design Gate | Record user journey, scope, non-goals, architecture, risks, and acceptance criteria; obtain the confirmation required by `.traqen-local/design-write-policy.md` | Confirmed Feature/spec and design commit |
| 3. Isolated implementation | Create a dedicated branch/worktree; never experiment against production data | Worktree path, branch, base SHA |
| 4. Red–Green–Refactor | Add observable RED evidence before behavior or regression-risk changes, then implement and refactor | Failing then passing targeted tests |
| 5. Quality Gate | Compare the exact implementation SHA with the confirmed design and run risk-matched lint, type, test, build, and user-journey checks | Exact commands, outputs, uncovered risks |
| 6. Independent Review | Follow `docs/policies/branch-review-publication-policy.md`; reviewers inspect the same exact SHA independently and keep review-only records outside Git | Independent findings and evidence-backed convergence |
| 7. Merge and acceptance | Resolve blocking findings, pass the merge gate, then validate the merged result in an isolated acceptance environment | Merge receipt, acceptance evidence, roadmap update |

## Repository and data boundaries

- Never rewrite or reuse an existing F-number to represent new work.
- Never commit local review records, credentials, generated browser logs, build caches, or production data.
- Local development and tests must use isolated stores and ports; Clowder AI ports `3003`, `3004`, and Redis `6399` are reserved.
- Changes to design, architecture, ADRs, Feature specs, lifecycle documents, and their indexes require the local confirmation gate in `AGENTS.md`.
- Same-individual self-review is forbidden. A request to review a branch or SHA also activates the stricter two-reviewer publication policy.

## Project relaunch rule

A relaunch creates a new Feature and baseline; it does not delete the repository, replace the Mission Hub project ID, or erase earlier Feature history. F007 is the current relaunch entry.
