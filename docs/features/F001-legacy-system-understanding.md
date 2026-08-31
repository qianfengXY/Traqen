> Language: **English** · [简体中文](F001-legacy-system-understanding.zh-CN.md)

---
feature_ids: [F001]
topics: [workspace, source-truth, source-snapshot, source-bundle, directory-upload, incremental, artifact-inventory, coverage-gap, provenance, git]
doc_kind: feature-spec
created: 2026-08-29
updated: 2026-08-30
description: Establish a reproducible, permissioned source foundation from a pinned Git revision, an uploaded directory, or both, with immutable incremental versions that downstream legacy-system analysis can trust without concealing coverage gaps.
description_source: human
description_author: co-creator
description_updated_at: 2026-08-30T20:20:00-07:00
---

# F001 — Workspace & Source Truth

**Status:** Spec — operator-approved design; implementation remains unauthorized
**Owner:** CodeX
**Related:** F006 workspace capability settings

## Why

Before Traqen can explain a legacy system or assess a change, it must prove exactly which material it examined and what it could not obtain. A branch name, live checkout, directory name, or successful scanner exit is not evidence. F001 makes the input boundary reproducible and visible, so F002–F004 cannot present conclusions as complete when their input was partial or has since changed.

## Current state

The earlier F001 convergence established immutable snapshots, explicit dispositions, Gap authority, receipt states, and F002 admission. The operator has now confirmed the complete source model: a fixed Git revision, an uploaded directory, or both may form one source bundle; later updates create immutable incremental versions instead of re-uploading unchanged bytes. The detailed design is the active product-design source; the earlier convergence record remains historical context.

## Outcome

F001 creates a Workspace-scoped `SourceBundleSnapshot` from at least one source component:

- one read-authorized Git repository resolved from a selected branch, tag, or ref to an exact committed revision, optionally bounded to one declared repository directory root;
- one user-selected directory uploaded to Traqen-controlled storage; or
- both components together.

The first release permits at most one Git component and one uploaded-directory component in a bundle. A combined bundle is a **namespaced union**, not an overlay or automatic merge: two same-named paths remain distinct artifacts identified by `(componentSnapshotId, relativePath)`.

Each component is sealed and immutable. A bundle contains its component identities, `ArtifactInventory`, explicit `CoverageGap` records, and a `SourceTruthReceipt`. It is `READY`, `READY_WITH_ACCEPTED_GAPS`, or `BLOCKED`. F002 receives only a qualifying bundle and inherited gaps; it never receives a mutable path, branch name, live working tree, or upload session.

For a later source change, F001 creates a logically complete new component and bundle version while reusing unchanged, already verified data. Git compares committed trees and fetches only added or modified blobs. For a directory, the user selects the folder again; the client fully enumerates and hashes it so additions, modifications, and deletions are knowable, then uploads only bytes the server does not already hold. The server verifies transferred bytes again. The result is a new sealed source truth, never an edit to an old one.

F001 does not infer business meaning, parse APIs, run tests, or claim change impact. It supplies the trustworthy version and file-level change evidence that F002, F003, and F004 need in their respective responsibilities.

## User journey

1. An architect creates or opens a Workspace and chooses **Connect Git**, **Upload directory**, or both.
2. For Git, the architect selects a branch, tag, or commit; Traqen resolves and displays the exact commit before capture. For a directory, the architect selects one folder; Traqen shows the selected-file total and does not call the upload successful until every selected file has been received and verified.
3. Traqen automatically preflights authorization, source identity, revision/root, upload/session boundaries, paths, policy limits, and capture safety. It reports **can start**, **can start with expected gaps**, or **blocked**, with an actionable reason.
4. It freezes a manifest, captures material safely, and records one disposition for every discovered item. For a combined input it records the component identity for every item.
5. The architect reviews Source Coverage, the bundle receipt, components, artifact inventory, and gaps. Only non-blocking gaps may be accepted with a responsible person, rationale, and expiry.
6. When source material changes, the architect explicitly chooses **Create new version**. F001 creates a new Git and/or directory component as needed, assembles a new bundle, and records a file-level add/modify/delete delta from the selected baseline. It does not silently follow a moving branch or a local directory.
7. F002 receives a qualifying F001 bundle and inherited gaps. F004 later compares two versions through F002's structural evidence; F001 itself makes no impact conclusion.

## Scope

### In scope

- One Workspace and a source bundle containing one Git component, one directory-upload component, or both.
- Read-authorized Git registration; resolution of a selected ref to an exact commit before capture; whole-repository scope or one optional repository directory root.
- Full user-selected directory upload to Traqen-controlled storage, with an explicit successful-file count (for example, `20 / 20 verified`) and no successful receipt if selected files remain unverified.
- Automatic preflight for identity, permission, revision, declared boundary, path safety, policy limits, external-content boundary, and capture safety.
- Immutable component and bundle identities, including source coordinates, declared scope, manifest/integrity digests, capture time, and capture-policy revision.
- Artifact inventory records with component-qualified artifact locator, kind, size, safe content digest where captured, one disposition, and a disposition reason.
- Explicit coverage states for captured, display-redacted, policy-isolated, unavailable, unreadable, failed, and out-of-scope material.
- Non-blocking Gap acceptance with responsibility, rationale, expiry, and downstream inheritance.
- Manual incremental version creation and history: Git tree comparison; directory re-enumeration and hash comparison; file-level `add`, `modify`, and `delete` delta.
- A bounded, streaming capture pipeline that can build a trustworthy bundle at 100,000 files without holding the source tree or complete files in memory.

### Out of scope

- More than one Git component or more than one directory-upload component in one first-release bundle; automatic overlay/merge of components; ambiguity resolution for colliding paths.
- Uncommitted or dirty worktrees; archive extraction; Git hooks, filters, builds, dependency installation, repository execution, or source mutation.
- Continuous branch watching, webhooks, local directory watchers, automatic version creation, rename/move similarity detection, and an upload-delta protocol that skips re-enumerating the selected directory.
- User-defined glob/regex rules, material-category switches such as “code only,” or user-controlled security, integrity, and Gap-severity rules.
- Extracting facts or constructing an API tree (F002); LLM semantic interpretation, human review, or the business-function tree (F003); test execution evidence, impact analysis, and revalidation advice (F004).

## Required records

| Record | Minimum fields and invariant |
| --- | --- |
| `Workspace` | Workspace ID, members, source registrations, and isolation of versions, coverage, history, and permissions. |
| `GitSourceRegistration` | repository identity and credential reference, requested ref, resolved commit, and optional repository root. No bare credential; a ref is never snapshot identity. |
| `DirectoryUploadSession` | workspace, uploader, selected directory label, upload session, frozen candidate manifest, and audit metadata. It contains at least one selected file and is not a successful source until all selected files are verified. |
| `SourceCaptureRun` | one auditable preflight/capture/seal attempt, progress checkpoints, cancellation, and retry relationship. A retry is a new run. |
| `SourceManifest` | ordered, content-addressed file entries and shard digests for one component. It is the authority for coverage and add/modify/delete comparison. |
| `GitSourceSnapshot` / `DirectoryUploadSnapshot` | sealed complete state of one component, including native identity: commit/tree for Git, upload/manifest digest for directory. Neither type impersonates the other. |
| `SourceBundleSnapshot` | immutable ordered component references, bundle inventory/gaps, and bundle digest. It has at least one component; same paths from different components never overwrite one another. |
| `ArtifactInventoryItem` | bundle and component IDs, relative path, kind, size, safe content digest where captured, disposition, and reason. Every discovered item has exactly one terminal disposition. |
| `CoverageGap` / `GapAcceptance` | affected component/scope, severity, reason, downstream consequence, and follow-up; acceptance is append-only and only for a non-blocking Gap with responsible person, rationale, and expiry. |
| `SnapshotDelta` | derived comparison of two sealed manifests/bundles with `add`, `modify`, or `delete` operations. It may be cached but can always be reproduced from the manifests. |
| `SourceTruthReceipt` | separated component identities, scope, integrity, coverage, gaps, acceptance, version lineage, and `READY` / `READY_WITH_ACCEPTED_GAPS` / `BLOCKED` consumability. |

An unreadable, skipped, policy-isolated, unavailable, or failed item is not silently absent: it appears in the inventory and creates a `CoverageGap` whenever it limits subsequent analysis. Sensitive raw content is never exposed through the receipt, inventory, UI, or diagnostics. A display-redacted item may still be available to authorized downstream analysis; if redaction prevents analysis, it must create a Gap.

## Incremental version contract

Every version remains logically full and immutable, even when its physical bytes are reused. The full sealed manifest—not a delta—is the source truth. `SnapshotDelta` is a reproducible derived view.

| Source update | Discovery | Transfer/storage behavior | Version result |
| --- | --- | --- | --- |
| Git moves from commit A to B | Compare the two committed trees by path and blob identity. | Fetch only added or modified blobs absent from tenant-scoped verified storage; record deletion without fetching content. | New `GitSourceSnapshot`, new bundle, file delta. |
| Directory is selected again | The client fully enumerates and hashes the selected folder; this is necessary to prove deletions. | Server compares manifests; client transfers only added/modified missing bytes, and server re-hashes them before seal. | New `DirectoryUploadSnapshot`, new bundle, file delta. |
| Only one combined component changes | Reuse the sealed unchanged component. | No copy or re-upload of unchanged verified data. | New bundle that references the changed component and the prior unchanged component. |

First release treats a rename or move as a delete plus an add. A manual user action starts a new version; branch movement alone cannot alter a sealed version or silently become a new baseline.

## Capture safety, scale, and truthfulness

The capture pipeline is bounded and streaming: resolve or create an upload session → preflight → enumerate → freeze manifest → plan deduplication → read/hash/store through bounded queues → reconcile inventory and gaps → prepare seal → atomically publish the sealed component, bundle, and receipt. Git reads committed trees/blobs directly, never a mutable checkout. Directory upload streams directly to controlled storage; it does not require proxying all bytes through the application backend.

- No source tree or whole file is loaded solely because it is large; workers, queues, in-flight bytes, file descriptors, and metadata writes are bounded. Manifest and inventory are sharded, searchable, filterable, and paginated rather than rendered as a 100,000-row page.
- Physical content reuse is limited to the tenant/workspace policy boundary; the system does not reveal cross-tenant content existence through deduplication behavior.
- A capture run checkpoints safe staged work. A transient failure may resume or retry using already verified staged blobs, but `DRAFT` data is invisible to F002. Only atomic seal makes a component/bundle consumable.
- Seal verifies manifest shards, inventory totals, byte totals, terminal dispositions, stored blob presence, and material gaps. A worker queue becoming empty is not success.
- Security/integrity failures such as source-identity failure, path escape, tampering, or policy conflict are blocking and cannot be accepted away. For an uploaded directory, a selected file must be fully accepted and verified to satisfy the selected-file count; a policy refusal blocks the result rather than becoming a partial success. A fully verified item whose analysis is limited by size, binary/external handling, or permitted redaction may be a visible non-blocking Gap only when policy classifies it as such.

At 100,000 files, success means a fixed Git-plus-directory fixture can be captured and replayed with the same identities; memory/queue/file-descriptor bounds remain controlled; interrupted runs recover without missing or duplicate inventory entries; no partial snapshot reaches F002; and tenant isolation remains intact. Actual throughput is measured against the deployment's storage, network, and resource budgets rather than promised as a fabricated universal SLA.

## Acceptance criteria

- [ ] **AC-A1:** An architect can register a read-authorized Git source, select a ref, and see it resolved to an exact commit before capture.
- [ ] **AC-A2:** An architect can select one directory, and a success result proves every selected file was received and verified; a partial directory has no qualifying receipt.
- [ ] **AC-A3:** A bundle may contain Git only, directory only, or one of each. Component identities stay visible, and same-named paths remain separate rather than overwriting one another.
- [ ] **AC-A4:** Two captures of the same component inputs, scope, and capture policy yield the same component/bundle identity and inventory integrity result; later branch movement or a new local directory selection does not alter an older version.
- [ ] **AC-A5:** Every discovered item has exactly one disposition and reason; unreadable, redacted, excluded, unavailable, failed, or out-of-scope material is not silently omitted.
- [ ] **AC-A6:** Git commit updates and reselected directory updates create a new complete sealed version while transferring only changed bytes; the resulting manifest-derived delta records all adds, modifications, and deletions.
- [ ] **AC-A7:** Capture neither executes user-provided code nor exposes sensitive raw content through the receipt, inventory, UI, or diagnostics. A blocking condition cannot become consumable through acceptance.
- [ ] **AC-A8:** A non-blocking Gap remains visible after recorded acceptance and is inherited by F002; F002 rejects direct source locators, incomplete data, expired acceptance, and `BLOCKED` receipts.
- [ ] **AC-A9:** A 100,000-file combined capture is streaming, restart-safe, atomically sealed, inventory-reconciled, and cannot produce a false-green receipt.

## Requirements checklist

| ID | Requirement | AC | Verification | Status |
| --- | --- | --- | --- | --- |
| R1 | An architect can identify the exact Git and/or directory material used for analysis. | AC-A1–A4 | controlled source replay | [ ] |
| R2 | A later change produces a comparable full version without copying unchanged material. | AC-A4, AC-A6 | Git and directory update pilot | [ ] |
| R3 | Missing material is visible and cannot be silently accepted as complete. | AC-A2, AC-A5, AC-A8 | disposition, Gap, and blocker tests | [ ] |
| R4 | Downstream conclusions remain tied to one trustworthy input and its known limits. | AC-A3, AC-A8 | F002 admission test | [ ] |
| R5 | The foundation is safe and remains credible at 100,000 files. | AC-A7, AC-A9 | negative security and scale/recovery tests | [ ] |

## Reference pilot

The pilot uses a controlled Git fixture with commits A/B and a selected companion directory with versions D1/D2. A combined A+D1 bundle contains code, documentation, configuration, SQL, tests, a safely handled sensitive fixture, duplicate content, zero-byte files, deep paths, and one deliberate non-blocking limitation. It proves:

1. Git-only, directory-only, and combined bundles have explicit, native component identities and no path overlay.
2. The directory success receipt is issued only after its selected-file total is fully verified.
3. Updating A→B fetches only changed Git blobs; selecting D2 fully discovers its additions/modifications/deletions but transfers only changed directory bytes.
4. An unchanged D1 component is reused when only Git changes; old A+D1 and new B+D1 bundles remain independently queryable.
5. A policy/blocking fixture (such as path escape or integrity mismatch) is `BLOCKED`, has no accept path, and cannot enter F002.
6. A 100,000-file combined fixture is restart-safe, reconciliation-complete, bounded in resource use, and never exposes `DRAFT` data to F002.

## Open questions

None at the approved product-boundary level. Connector, storage engine, queue size, and deployment-budget choices belong to implementation planning and may not weaken this contract.

## Dependencies and handoff

F001 is the source-evidence boundary for F002–F004. F006 supplies related Workspace capability settings; F001 source capture does not run Agents. F002 alone converts a qualifying bundle, inventory, inherited gaps, and an optional selected F001 delta into deterministic facts and the API-structure projection. F003 uses F002 facts for reviewed business meaning. F004 performs impact analysis only from those downstream structural/semantic results and selected version provenance.

## Decision record

- [2026-08-30 F001 source-truth convergence (historical)](../../feature-discussions/2026-08-30-F001-workspace-source-truth/README.md)
- [2026-08-30 F001 approved Workspace & Source Truth design](../../feature-discussions/2026-08-30-F001-workspace-source-truth-design/README.md)
- [ADR-0003: Source Truth boundary and downstream admission](../decisions/ADR-0003-source-truth-boundary.md)

**Next:** implementation planning may turn this approved contract into ownership, storage, UI, and test plans. It must preserve source-component identity, immutable incremental versions, explicit gaps, and F002-only admission.
