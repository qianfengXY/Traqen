> Language: **English** · [简体中文](ADR-0003-source-truth-boundary.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004]
related_features: [F006]
topics: [source-truth, git, directory-upload, source-bundle, incremental, source-snapshot, coverage-gap, provenance, downstream-admission]
doc_kind: adr
created: 2026-08-30
status: accepted
---

# ADR-0003: Source Truth Boundary and Downstream Admission

## Context

F001 is the evidence foundation for legacy-system analysis. Without an explicit source boundary, a scan can finish while operating on a moving branch, a live local directory, or a silently incomplete subset. Downstream facts and semantic claims would then appear traceable while actually referring to mutable or unknown input.

The operator authorized the final F001 source model on 2026-08-30: a pinned Git revision, an uploaded directory, or both may form a versioned source foundation. This ADR records the product boundary required for a source receipt to be usable by F002 and, through F002 provenance, F003–F004.

## Decision

1. A Source Truth foundation is an immutable Workspace-scoped `SourceBundleSnapshot` containing at least one component: one read-authorized Git component, one verified uploaded-directory component, or both. The first release permits at most one of each.
2. A Git component is resolved from a requested branch, tag, or ref to an exact committed revision before capture. Its declared scope is the whole committed repository by default, or one optional repository directory root.
3. A directory component is a user-selected folder transferred to Traqen-controlled storage. The upload is successful only when every selected file has been received and verified; its content-addressed manifest, not the original local path, is its immutable identity.
4. A combined bundle is a namespaced union, not an overlay. Same-named paths from distinct components remain distinct artifacts; no component is represented as another component's native identity.
5. Every sealed version is logically complete and immutable. A later Git commit or directory selection creates a new component/bundle/receipt. Unchanged verified blobs may be physically reused within the tenant/workspace policy boundary; a derived add/modify/delete Delta never replaces the full manifest as authority.
6. Capture is read-only and safe: it does not run repository-provided code, hooks, builds, dependency installation, untrusted filters, or uploaded content. It fails closed on untrusted identity, boundary, integrity, path, or policy conditions.
7. Every discovered item in declared scope receives one explicit disposition. Missing, excluded, redacted, external, unreadable, or failed material remains visible and may create a `CoverageGap`. A non-blocking Gap may be accepted only with responsible person, rationale, and expiry; it remains visible and inherited. Identity, initial-directory completeness, integrity, path-boundary, policy, and tampering failures are blocking.
8. A `SourceTruthReceipt` separately expresses component identities, scope, integrity, coverage, Gap acceptance, version lineage, and one consumability state: `READY`, `READY_WITH_ACCEPTED_GAPS`, or `BLOCKED`. F002 alone consumes only a qualifying receipt/bundle and inherits relevant gaps. F003 and F004 receive F001 provenance only through F002's persisted outputs.
9. At scale, capture freezes a manifest, streams content through bounded resources, reconciles inventory/gaps/totals, and atomically seals. Draft or partial material is never visible to F002.

## Rejected alternatives

### Live local directory or dirty-worktree source

Rejected because its contents cannot be replayed by another operator, and local edits can silently change the analytical evidence after registration. This does not reject a user-selected directory that is fully captured, verified, and sealed in Traqen-controlled storage.

### Automatic component overlay or disguised directory-as-Git identity

Rejected because a same-named file could silently hide another source, and a directory has no Git commit graph. The bundle must preserve each component's native identity and namespaced locator.

### Full re-upload or full duplicate storage for every version

Rejected because the product must retain complete comparable versions for change analysis without needlessly retransferring unchanged data. The selected directory is still fully enumerated to prove deletions; only unchanged bytes are reused, never assumed.

### Automatic continuous source synchronization in the first release

Rejected because it can create version noise, shift baselines unexpectedly, and incur uncontrolled capture cost. A user explicitly creates a new version; webhook/watcher policies can be reconsidered later with a distinct governance contract.

### Arbitrary scope rules or material-type selection

Rejected because a user can accidentally omit documentation, configuration, SQL, or tests while still receiving a successful scan. Whole Git repository or one declared root, plus one fully selected directory component, are intelligible first boundaries; a rules language is not.

### All gaps block, or every gap may be accepted

Rejected because all-blocking makes common legacy repositories unusable, while universal acceptance turns integrity and permission failures into a click-through warning. The non-blocking acceptance rule preserves both flow and truthfulness.

### Scanner success or zero gaps as the release condition

Rejected because job completion says nothing about input integrity, while zero gaps creates pressure to hide known limitations. Frozen manifests, explicit dispositions, reconciliation, and separate receipt dimensions make limitations auditable.

### Downstream direct source access

Rejected because it bypasses the sealed source and allows later capabilities to derive output from material the receipt never accounted for. F002 is the sole direct consumer; F003/F004 inherit provenance through its outputs.

## Consequences

- A product user chooses a source type or the two-source combination, Git authorization/revision/root, and a directory to upload. Platform policy owns security, integrity, and Gap-severity controls.
- A directory upload receives a clear verified-file count. It promises receipt completeness for the selected directory only; it does not assert that materials outside the selected folder exist or do not exist.
- A root-scoped Git component must never claim whole-repository coverage, and a combined bundle must never imply automatic reconciliation of colliding paths.
- Each new version has complete logical history while storage can safely reuse already verified data. Directory deletion discovery requires a complete new enumeration, even though it does not require a full byte upload.
- Non-blocking gaps remain part of every downstream fact, candidate, claim, execution result, or impact recommendation derived through F002 from the bundle.
- Support for multiple components of the same type, archives, automatic sync, local companion scanning, or cross-tenant content reuse requires a new source-identity and security contract; it cannot be added as an unlabelled option.

## Verification

- replay the same Git commit and/or verified directory manifest under the same policy and verify the same component/bundle identity and inventory integrity result;
- prove a directory receipt is withheld until all selected files are verified, and that its identity says nothing about material outside the selected folder;
- prove Git A→B and directory D1→D2 produce complete new versions, transfer only changed bytes, and derive every add/modify/delete from the two manifests;
- prove same-named Git/directory paths remain separately queryable in a combined bundle;
- prove branch movement or local-directory change does not alter a sealed version;
- prove every in-scope item receives one disposition and no sensitive raw content is emitted;
- prove an accepted non-blocking Gap remains visible to an F002 consumer;
- prove path escape, failed initial-directory completeness, failed integrity, or untrusted source identity remain `BLOCKED` and cannot become consumable; and
- prove bounded streaming/recovery never exposes a Draft snapshot and F002 rejects inputs other than a qualifying receipt.
