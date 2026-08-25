# Traqen History Preservation and Project Relaunch Implementation Plan

**Feature:** F007 — `docs/features/F007-traqen-project-relaunch.md`
**Goal:** Preserve every recoverable Traqen history carrier, then restart product discovery under the existing repository and Mission Hub project identity.
**Acceptance Criteria:** A verified all-ref Git bundle and WIP archive exist; local-only history has named archival refs; `main@8eae0ba` is marked as the pre-relaunch baseline; active `main` contains an F007 kickoff without rewriting F001–F006; the Traqen-specific Mission Hub proposal lives in this repository; the stale Clowder AI F289 draft is removed after its reusable conclusions are carried into EXT-001.
**Architecture cell:** repository-local project governance and documentation; no runtime ownership change
**Map delta:** none
**Map delta why:** This operation preserves and reorganizes project truth without changing Traqen runtime boundaries.
**Architecture:** Use a recoverable external snapshot plus Git archival refs before changing either worktree. Keep historical product features immutable, represent the restart as a new F007 discovery feature, and migrate documents to the repository that owns their context.
**Tech Stack:** Git, Markdown, repository-local validation scripts
**前端验证:** No — no UI or runtime implementation changes

---

## Finish line

Traqen can be resumed from its existing Mission Hub identity with a clean `main`, an explicit pre-relaunch baseline, a new F007 discovery entry, and independently verifiable recovery artifacts.

Not building: a second Traqen project, a replacement repository, new product behavior, or any Mission Hub runtime mutation.

## Task 1: Capture recovery artifacts before mutation

**Files:**

- Create outside repository: `/Volumes/WorkSSD/projects/Traqen-history/2026-08-25-pre-relaunch/`
- Record: Git all-ref bundle, tracked binary patches, explicit untracked-file archives, ref/status manifest, checksums

Steps:

1. Record repository, branch, worktree, remote, status, and ref inventories.
2. Export binary patches for tracked changes in `main` and `pr-2-review`.
3. Archive all current untracked files using explicit paths.
4. Verify archive readability and record SHA-256 checksums.

## Task 2: Preserve local-only commit history

**Refs:**

- Create `archive/pre-relaunch-20260825/*` aliases for every branch with commits not reachable from current `main` and without an equivalent protected remote ref.
- Create annotated tag `traqen-pre-relaunch-2026-08-25` at `main@8eae0ba`.

Steps:

1. Create archival refs without moving existing branches.
2. Commit meaningful `main` WIP on a dedicated archive branch.
3. Commit `pr-2-review` WIP on a dedicated archive branch.
4. Create and verify the final `--all` Git bundle.
5. Return the primary checkout to `main` and confirm it matches `origin/main` before F007 changes.

## Task 3: Establish F007 project relaunch truth

**Files:**

- Create: `docs/features/F007-traqen-project-relaunch.md`
- Create: `docs/features/F007-traqen-project-relaunch.zh-CN.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/ROADMAP.zh-CN.md`
- Create: `BACKLOG.md`
- Create: `docs/SOP.md`
- Create: `docs/features/TEMPLATE.md`

Steps:

1. Add F007 as a discovery/kickoff feature; do not reinterpret or renumber F001–F006.
2. Pin the pre-relaunch baseline and recovery manifest.
3. Require current-state audit, keep/refactor/archive classification, renewed vision/user journey/MVP/non-goals, and phased implementation plan before business-code work.
4. Validate frontmatter and roadmap/backlog parseability.

## Task 4: Relocate the Traqen-specific UI proposal

**Files:**

- Create: `docs/design/mission-hub-dev-loop-ui-redesign-proposal.md`
- Remove from Clowder AI: `review-notes/mission-hub-dev-loop-ui-redesign-proposal.md`

Steps:

1. Preserve the proposal content with Traqen frontmatter and an explicit status of exploratory input.
2. State that it is not the Cat Café EXT-001 implementation authority.
3. Verify the destination before removing the source.

## Task 5: Converge the stale F289 proposal into EXT-001

**Files:**

- Modify in Clowder AI: `docs/design/EXT-001-chatgpt-desktop-development-loop.md`
- Remove in Clowder AI: `docs/design/f289-mission-hub-workflow-graph-redesign.md`

Steps:

1. Carry forward only durable information-architecture, state-visibility, interaction, responsive, and accessibility requirements.
2. Keep the existing EXT-001 state machine and server-owned Resume Packet authoritative.
3. Do not preserve stale F289 paths, invented tokens, or implementation-specific component prescriptions as contract.
4. Run strict-delta documentation validation.

## Task 6: Commit, push, and hand off kickoff

Steps:

1. Inspect staged diffs per repository and stage only authorized files.
2. Commit Traqen F007/migration separately from Clowder AI EXT-001 migration; commit bodies state Why and signer.
3. Push normal `main` commits only; keep WIP archive refs local and inside the verified bundle unless explicitly authorized for publication.
4. Create a project-bound F007 kickoff thread/task referencing the exact Traqen commit.
5. Report commit SHAs, push results, validation evidence, archive checksums, and any remaining local-only state.
