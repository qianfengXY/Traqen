> Language: **English** · [简体中文](SOP.zh-CN.md)

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
| 6. Independent Review | Select one non-author independent reviewer through Cat Café risk routing, covering the same exact SHA and keeping review-only records outside Git. Only an explicitly intended Issue candidate enters the publication policy's dual-independent consensus gate. | Review source, exact SHA, verdict, and evidence; when publishing an Issue, dual-independent convergence |
| 7. Merge and acceptance | Resolve blocking findings, pass the merge gate, merge the reviewed local branch into local `main`, validate on local `main`, push only `origin/main`, then clean the merged branch and worktree | Local merge receipt, acceptance evidence, `main` parity evidence, cleanup result |

## Local integration and remote synchronization

- Local `main` is the sole integration source. Side branches and their worktrees are only for
  isolated implementation, review, and acceptance; they cannot be pushed remotely or bypass local
  `main` through a remote branch or pull request.
- After review and the applicable gate cover a side branch's exact SHA, merge that branch into
  local `main`; run post-merge checks and acceptance from local `main`.
- Push `origin/main` only after local `main` acceptance passes. The remote retains only `main`.
- After local and remote `main` are confirmed at the same commit, promptly delete the merged local
  branch and remove its worktree. Preserve and report a dirty or running worktree; never force its
  cleanup.

## Repository and data boundaries

- Never rewrite or reuse an existing F-number to represent new work.
- Never commit local review records, credentials, generated browser logs, build caches, or production data.
- Local development and tests must use isolated stores and ports; Clowder AI ports `3003`, `3004`, and Redis `6399` are reserved.
- Changes to design, architecture, ADRs, Feature specs, lifecycle documents, and their indexes require the local confirmation gate in `AGENTS.md`.
- Same-individual self-review is forbidden. A normal branch review does not itself activate the
  stricter two-reviewer publication policy; only an explicit Issue-publication candidate does.

## Project relaunch rule

A relaunch creates a new Feature and baseline; it does not delete the repository, replace the Mission Hub project ID, or erase earlier Feature history. Once a redesign is approved, its active Feature documents and roadmap entries replace the relaunch entry; the former entry remains recoverable through Git history.
