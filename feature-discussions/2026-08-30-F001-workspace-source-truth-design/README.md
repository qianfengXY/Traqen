> Language: **English** · [简体中文](README.zh-CN.md)

---
feature_ids: [F001]
related_features: [F002, F003, F004, F006]
topics: [workspace, source-truth, git, directory-upload, source-bundle, incremental, source-snapshot, artifact-inventory, coverage-gap, receipt, design-gate]
doc_kind: feature-discussion
created: 2026-08-30
status: approved
design_gate: operator-approved
---

# F001 design — Workspace & Source Truth

## 1. What F001 completes

F001 is complete when an architect can turn either a selected Git revision, a selected directory, or both into a **replayable Source Truth receipt**. The receipt says exactly which source components Traqen safely captured, what it could not obtain, which version it represents, and whether F002 may use it.

In practical terms, the architect can:

1. create or open a Workspace and choose **Connect Git**, **Upload directory**, or both;
2. select a Git branch/tag/ref and see its exact resolved commit, and/or select one directory and see all selected files verified;
3. let Traqen preflight the source automatically and capture it without executing user-controlled code;
4. inspect a complete component-qualified source inventory, coverage limitations, receipt, and immutable history;
5. create a later source version that compares Git commits or reselected directory manifests and transfers only changed bytes; and
6. hand F002 a qualifying immutable bundle and inherited limitations, rather than a mutable path or branch.

The first release permits one Git component, one uploaded-directory component, or the two together. A combined source is a namespaced union, not an automatic merge: same-named paths are still separate records. F001 does **not** generate the API tree, infer business functions, execute tests, or advise on change impact. Those are F002–F004. Its outcome is the trustworthy source foundation that makes their results believable.

## 2. Functions, purpose, and the problem each resolves

| Function | What the architect gets | Problem it resolves |
| --- | --- | --- |
| Workspace and source choice | A Workspace-bound choice of Git, directory upload, or both. Git credentials stay protected; directory upload has an auditable user/session. | Analysis cannot silently use an arbitrary local directory or leak a credential. |
| Exact component identity | Git ref resolves to a commit; a directory is represented by its verified manifest. Components retain native identities. | A moving branch, local directory, or directory pretending to be a commit cannot masquerade as stable evidence. |
| Automatic preflight | `can start`, `can start with expected gaps`, or `blocked`, with a reason and remediation. | Authorization, path safety, limits, and integrity problems are not discovered only after a misleading scan. |
| Safe immutable capture | Sealed component snapshots and one `SourceBundleSnapshot`; no repository script, build, hook, filter, dependency install, or uploaded content executes. | Source-controlled behavior and working-tree edits cannot alter or endanger evidence. |
| Source Coverage inventory | Every discovered item has a component-qualified locator, disposition, and reason; the UI is searchable and paginated at large scale. | Documentation, configuration, SQL, tests, binaries, failed reads, and same-named component files cannot silently vanish. |
| Coverage Gap management | Blocking failures remain blocked. A non-blocking limitation can be accepted only with a responsible person, rationale, and expiry. | A click-through warning cannot disguise an integrity failure, while ordinary legacy incompleteness remains visible and manageable. |
| Version history and file delta | A new complete immutable version after an explicit user action; add/modify/delete evidence between two sealed manifests. | Change impact cannot compare a moving source, while unchanged 50,000-file components are not copied or re-uploaded. |
| Receipt and F002 handoff | `READY` / `READY_WITH_ACCEPTED_GAPS` / `BLOCKED`, retained with history; F002 receives only a qualified bundle/input. | Later capabilities cannot derive authoritative-looking conclusions from a path, branch, partial upload, or unaccepted limitation. |

## 3. Alignment with the product vision

| Product vision | F001 contribution | Deliberate boundary |
| --- | --- | --- |
| Help an architect take over an unfamiliar legacy system. | Establishes the exact material baseline before any explanation is attempted. | It does not explain business meaning by itself. |
| Preserve a traceable chain from source to conclusions. | Creates the first durable links: source component → immutable manifest → bundle → inventory/gaps → receipt → F002 provenance. | Facts, candidates, claims, test evidence, and impact links are added by F002–F004. |
| Present a reliable API tree and reviewed business-function tree. | Prevents either tree from looking complete when its underlying source is incomplete. | F001 does not parse APIs or publish either tree. |
| Make the next change safer. | Retains comparable source versions and truthful file-level delta for later impact work. | F001 does not infer impact, run tests, or recommend revalidation. |
| Prefer an explicit incomplete answer over a persuasive unsupported answer. | Keeps exclusions, failed reads, redaction limits, external material, and accepted gaps visible and inherited. | It cannot convert a blocking safety or integrity condition into a usable result. |

F001 therefore matches the vision as its **truthful source foundation**, not as a standalone legacy-understanding product. Its success criterion is not “the scan finished”; it is “a later result can name and defend its exact input, version, and limitations.”

## 4. Design status and authority

This is the **operator-approved** F001 design. It updates and implements [ADR-0003](../../docs/decisions/ADR-0003-source-truth-boundary.md). It does not authorize implementation code.

The `source-truth` ownership boundary owns source registration, upload/capture lifecycle, component and bundle snapshots, manifests, inventory, Gap/receipt state, version comparison, and F002 admission. It does not own F002 extraction, F003 review, F004 execution/impact, or F006 settings. `SourceTruthRepository` is the sole authority; F002 receives `QualifiedSourceInput`, never a path, ref, working tree, upload session, or credential.

## 5. Overall architecture

```text
Workspace
  ├─ GitSourceRegistration ── resolve requested ref ──► committed Git tree/blob reader
  └─ DirectoryUploadSession ── selected files ───────► controlled streaming upload
                         │                                      │
                         └──────────── SourceCaptureRun ────────┘
                                                 │
              preflight → enumerate → frozen component manifest → bounded capture
                                                 │
                    GitSourceSnapshot / DirectoryUploadSnapshot (sealed components)
                                                 │
              SourceBundleSnapshot (Git only | directory only | both, namespaced)
                                  ┌──────────────┴─────────────┐
                         ArtifactInventory                 CoverageGap(s)
                                  │                               │
                                  └──────── reconciliation ───────┘
                                                 │
                                   SourceTruthReceipt + lineage
                             READY | READY_WITH_ACCEPTED_GAPS | BLOCKED
                                                 │
                                   SourceTruthAdmission → F002
                                 (qualified bundle + inherited gaps)
                                                 │
                              selected sealed versions → SnapshotDelta → F002
```

`SourceCaptureRun` records an attempt, live progress, cancellation, retry, and checkpoints. A sealed component/bundle records immutable evidence and downstream eligibility. Separating them prevents a half-finished run from looking like a source version, and prevents a retry from rewriting history.

## 6. Domain records and invariants

| Object | Responsibility | Invariant |
| --- | --- | --- |
| `Workspace` | Authorization and isolation aggregate root. | Every F001 record has one Workspace; metadata and data access obey the same tenant/workspace boundary. |
| `GitSourceRegistration` | Read-authorized repository identity and credential reference. | No bare credential; requested ref selects a commit but is not snapshot identity. |
| `DirectoryUploadSession` | One user-selected directory transfer and audit trail. | At least one selected file; a successful component requires every selected file to be verified. |
| `CapturePolicyRevision` | Platform-controlled limits, path rules, scanner/redaction, and source safety. | Users cannot edit integrity, safety, or Gap-severity rules; sealed history binds the policy revision. |
| `SourceCaptureRun` | One resolve/preflight/capture/seal attempt. | Retry creates a new run; a run never follows a moving branch or rewrites a sealed version. |
| `SourcePreflightReport` | Identity, permission, boundary, path, limit, external-content, and safety evidence. | `PASS` / `WARN` / `BLOCK` always has reason code and next action; `WARN` is not silently converted into final coverage. |
| `SourceManifest` | Ordered content-addressed entries and shard digests for one component. | It is the authority for coverage and change comparison; Delta cannot override it. |
| `GitSourceSnapshot` | Sealed Git component at resolved commit/tree and declared Git scope. | Immutable after seal; committed objects, not a checkout, are evidence authority. |
| `DirectoryUploadSnapshot` | Sealed selected-directory component at verified manifest/upload identity. | Immutable after seal; it never claims coverage outside the selected folder or represents itself as a commit. |
| `SourceBundleSnapshot` | Ordered component references and bundle-level identity. | Has one or two components; only one per kind in MVP; colliding paths remain distinct by component ID. |
| `ArtifactInventory` | Coverage denominator and per-item disposition. | Every discovered item has exactly one terminal disposition/reason; counts/bytes/shard digests reconcile before seal. |
| `CoverageGap` / `GapAcceptance` | Material analysis limitation and accountable acceptance. | Gap is append-only; only non-blocking Gap is acceptable, with owner/rationale/expiry; acceptance never claims the material was obtained. |
| `SnapshotDelta` | Add/modify/delete comparison of two sealed versions. | Derived from manifests, reproducible, and optional to cache; rename is delete plus add in MVP. |
| `SourceTruthReceipt` | Immutable source evidence and consumability decision. | `READY` has no material Gap; `READY_WITH_ACCEPTED_GAPS` has only valid accepted non-blocking gaps; `BLOCKED` is never consumable. |

`display-redacted` is deliberately narrow: content can be captured and available to an authorized downstream system while being hidden in UI/logs. If redaction makes it unavailable to analysis, it also creates a material `CoverageGap`. No record leaks source secrets or credentials.

## 7. Capture and version lifecycle

### 7.1 Initial source capture

```text
REQUESTED → PREFLIGHTING → ENUMERATING → MANIFEST_FROZEN → CAPTURING → RECONCILING → PREPARING_SEAL
  │              │              │                 │              │              │                 │
  │              └─ security/integrity block ──────┴──────────────┴──────────────┴──► BLOCKED receipt
  ├─ user cancellation before seal ─────────────────────────────────────────────────► CANCELLED run
  └─ transient failure ──────────────────────────────────────────────────────────────► FAILED_RETRYABLE run
                                                                                         │
                                                             atomic seal ──────────────┘
                                                                         │
                                                            sealed component/bundle
                                                                         │
                                    no material Gap ────────────────────┼────► READY receipt
                                    only non-blocking Gap ───────────────┼────► AWAITING_GAP_DECISION
                                                                         │           └─ valid acceptance
                                    blocking Gap ────────────────────────└────► BLOCKED receipt

                                                                                     READY_WITH_ACCEPTED_GAPS
```

- Preflight validates what can be known before capture: authorization, Git resolution, declared root, upload/session boundary, path safety, limits, and policy. It does not pretend to provide business understanding.
- Enumeration freezes a manifest with exact item/byte totals and root digest. Before that point progress may say only “discovered N”; afterward the UI may report verified items/bytes against real totals.
- For a directory input, initial success requires all selected files to arrive and verify. A broken transfer or policy refusal is not quietly downgraded to a partial-success or “source completeness unknown” Gap; a fully verified item can still carry a visible analysis-limitation Gap when policy permits it.
- `DRAFT` data stays private. Atomic seal checks manifest shards, content presence, inventory totals, dispositions, and material gaps before publishing snapshots, bundle, and receipt together.
- A cancelled/failed/blocked later run never changes a previously sealed version.

### 7.2 Incremental new version

```text
select baseline + “Create new version”
  ├─ Git: resolve new exact commit → compare committed trees → fetch only added/modified missing blobs
  ├─ Directory: reselect folder → fully enumerate/hash → server manifest comparison → send only changed bytes
  └─ unchanged component: reuse prior sealed component
             │
             ▼
new complete sealed component(s) → new SourceBundleSnapshot → reproducible SnapshotDelta → new receipt
```

Every new version has a full manifest. The optimization is physical reuse, never logical partiality. The directory client must enumerate all selected files because that is how it can credibly establish deletion; client hashes select transfer candidates, while the server verifies every transferred byte before it becomes evidence. F001 does not auto-follow branches, watch local folders, or turn ref movement into a new baseline without the architect's action.

## 8. Safe, scalable capture design

| Interface | Responsibility | Must not do |
| --- | --- | --- |
| `GitSourceGateway` | Resolve a ref using read authorization; enumerate committed tree and stream blobs. | Read a mutable working tree or execute source-controlled hooks/filters/logic. |
| `DirectoryIngestGateway` | Receive direct streaming files to controlled storage; normalize paths and verify transferred bytes. | Treat original local paths as identity, expand archives, or execute uploaded files. |
| `SourcePreflightService` | Check authorization, identity, declared root, upload boundary, path, limit, external content, and policy. | Allow a user to override an integrity/security block. |
| `ManifestDiffer` | Compare two sealed manifests and derive file-level add/modify/delete. | Infer business impact, rename similarity, or change a sealed manifest. |
| `SnapshotStore` | Tenant-scoped staging, content-addressed verified blobs, manifest/inventory shards, checkpointing, and atomic seal. | Expose Draft material, modify sealed history, or reveal cross-tenant deduplication. |
| `CoverageAssembler` | Reconcile complete inventory and material gaps. | Hide a skip, failed read, redaction limitation, or scope boundary. |
| `SourceTruthAdmission` | Revalidate consumability and issue `QualifiedSourceInput` to F002. | Return path/ref/upload/credential, omit inherited gaps, or bypass receipt state. |

The fast path is bounded rather than unbounded: fixed resource pools, bounded queues/backpressure, in-flight byte limits, streaming hashes, batched metadata writes, and sharded manifest/inventory records. Git can use committed object traversal and object identity to avoid rereading known blobs. Directory transfer can stream directly to controlled storage and resume through checkpoints. Content reuse is tenant/workspace-scoped, not a cross-tenant existence oracle.

The false-green prevention rule is strict: every frozen manifest entry must reconcile to exactly one terminal disposition; skipped/absent analysis material must link to its Gap; the queue being empty cannot decide success. Seal failure leaves a private Draft/run that may retry, never a partial version visible to F002.

## 9. User information architecture and interaction contract

The main scene is **Source Truth inside the Workspace**, not a separate dashboard. It must make three questions answerable without logs: *what is this version made of; may F002 use it; and what must be fixed or carried forward?*

| Surface | Information and action |
| --- | --- |
| Source Truth card | Current Git/directory components, latest receipt, version identity, why it is usable/blocked, **Create new version**, and receipt/history links. |
| Source setup | Choose Git, directory, or both; Git ref and resolved commit preview; directory selection and selected-file count. No credential or safety-rule editor. |
| Preflight | `可开始` / `可带预期 Gap 开始` / `已阻断`, affected component/scope, reason, and correction action. A blocker has no accept route. |
| Capture progress | Real stages and stream totals: “discovering N”, then “verified X/Y files and bytes”, policy/reconciliation/seal. Cancel before seal; retry a failed run. |
| Source Coverage | Component filter, path search, disposition/reason, counts, and Gap links. Large inventory is paginated/virtualized. |
| Receipt and history | Native component identities, source bundle, policy, inventory identity, gaps/acceptance, F002 eligibility, and earlier immutable versions. |
| New-version comparison | Baseline/target selection, which component changed, transfer reuse summary, add/modify/delete counts, and the downstream F002/F004 provenance path—not an impact verdict. |

Every error states what failed, which component/scope is affected, whether older sealed versions are still usable, and the next corrective action. Reasons are code-backed and redacted. The Workspace shell shows only the latest state for each source/bundle; detailed receipt history preserves full events.

## 10. Frontend interaction design

The screens extend the Workspace rather than introduce a new dashboard. Visual examples default to **Simplified Chinese** for the current operator; that is a design-language choice, not a runtime i18n implementation promise. The stable application shell remains identical between success and block states: only the Workspace main content changes.

### 10.1 A usable receipt with accepted limitations

![Simplified-Chinese Source Truth receipt with accepted gaps](assets/source-truth-ready-with-accepted-gaps-zh-CN.png)

`READY_WITH_ACCEPTED_GAPS` deliberately uses amber rather than green. It means the sealed bundle is usable, **not complete**: Coverage shows its denominator, the Gap remains visible with owner and expiry, and the downstream action says F002 inherits the limitation. `Display-redacted` remains distinct from an analysis-limiting redaction; the latter must create a Gap.

### 10.2 A preflight block

![Simplified-Chinese blocked Source Truth preflight](assets/source-truth-preflight-blocked-zh-CN-v2.png)

The block stays in the same Workspace journey. It identifies the failed check, affected boundary, correction action, disabled capture action, and that an earlier sealed version is unchanged. A safety/integrity blocker offers no accept or bypass path.

### 10.3 Setup and incremental-version screen contracts

| Moment | Primary information | Primary action | Required honesty |
| --- | --- | --- | --- |
| Create source foundation | Git / directory / both selection; resolved Git commit; directory selected-file total; component boundary. | Start automatic preflight. | A directory success label appears only at `verified / selected = selected / selected`; no component is silently overlaid. |
| Freeze and capture | Stage, observed count, then frozen totals; verified files/bytes; current component; cancel/retry. | Cancel before seal or retry a failed run. | No invented percentage; all 100,000 artifacts are not rendered at once. |
| Receipt | Bundle and native component IDs, coverage summary, Gap/acceptance, policy, history, F002 eligibility. | Inspect inventory/history or start F002 only if eligible. | Accepted limitation stays amber and inherited; Receipt never leaks raw secret. |
| Create new version | Baseline, target Git commit and/or reselected directory, unchanged component reuse, add/modify/delete totals. | Confirm a manual new-version capture. | This is file change evidence, not impact analysis; directory deletion requires re-enumeration. |

This design does not include a global dashboard, live log tail, raw-secret viewer, source browser, API/function tree, or production implementation. Those either bypass source decisions or belong to later features.

## 11. F002 admission and delta contracts

```ts
type QualifiedSourceComponent =
  | {
      componentSnapshotId: string;
      kind: "GIT";
      nativeIdentity: { resolvedCommit: string };
      declaredScope: { kind: "REPOSITORY" } | { kind: "DIRECTORY_ROOT"; path: string };
      manifestId: string;
    }
  | {
      componentSnapshotId: string;
      kind: "DIRECTORY_UPLOAD";
      nativeIdentity: { manifestDigest: string; uploadId: string };
      declaredScope: { kind: "UPLOADED_DIRECTORY" };
      manifestId: string;
    };

type QualifiedSourceInput = {
  workspaceId: string;
  receiptId: string;
  receiptStatus: "READY" | "READY_WITH_ACCEPTED_GAPS";
  receiptValidUntil: string | null;
  sourceBundleSnapshotId: string;
  components: ReadonlyArray<QualifiedSourceComponent>;
  inventoryId: string;
  inventoryDigest: string;
  policyRevisionId: string;
  inheritedGaps: ReadonlyArray<{
    gapId: string;
    severity: "NON_BLOCKING";
    componentSnapshotId: string;
    affectedScope: string;
    reasonCode: string;
  }>;
};

type SnapshotDeltaInput = {
  baselineBundleSnapshotId: string;
  targetBundleSnapshotId: string;
  operations: ReadonlyArray<{
    componentKind: "GIT" | "DIRECTORY_UPLOAD";
    componentSnapshotId: string;
    path: string;
    kind: "ADD" | "MODIFY" | "DELETE";
    beforeDigest: string | null;
    afterDigest: string | null;
  }>;
};
```

Admission requires Workspace access; sealed, verified component/bundle/inventory; an exactly matching currently consumable receipt; valid relevant acceptance; and no blocker or tampering signal. It rejects direct paths, Git URLs, ref-only input, dirty checkouts, upload sessions, partial snapshots, expired acceptance, and all `BLOCKED` results.

F002 persists the bundle/receipt/inventory/policy identities and the complete inherited Gap set on every derived fact. It can request a `SnapshotDeltaInput` when comparing a selected baseline/target, but must not mutate, hide, downgrade, or re-accept F001 gaps. F003/F004 receive F001 provenance through F002; F004's impact conclusion stays outside F001.

## 12. Reference pilot and scale acceptance

Use a controlled fixture with Git commits A/B plus directory versions D1/D2. The combined A+D1 case includes code, documentation, configuration, SQL, tests, safe sensitive fixture handling, duplicate content, zero-byte files, deep paths, a deliberately unavailable non-blocking item, a large-policy item, and a blocking path/integrity fixture.

| Case | Must prove |
| --- | --- |
| Git only, directory only, and A+D1 | Native component identities, selected-directory verification, no path overlay, and one disposition per item. |
| Replay A+D1 | Same component/bundle/manifest identity and inventory result; branch movement and local change do not alter it. |
| A→B, D1→D2 | Git fetches only changed missing blobs; directory re-enumerates but sends only changed bytes; deletes are explicit. |
| B+D1 after Git-only change | D1 remains referenced, not copied or re-uploaded; both versions remain queryable. |
| Blocked safety/integrity fixture | `BLOCKED`, no accept action, no F002 admission, older sealed version remains usable. |
| 100,000-file combined fixture | Bounded memory/queues/file descriptors, paginated inventory, restart after worker/storage/DB interruption, exact reconciliation, atomic seal, and no Draft F002 admission. |

The primary failure mode is a **false-green receipt**: material silently disappears while the UI says ready. Frozen manifests, terminal disposition conservation, explicit material gaps, two-stage/atomic seal, immutable receipts, and F002's compulsory gap inheritance are the defense.

## 13. Decision closure and next gate

The operator has confirmed: two source types and their combination; native component identity/no overlay; explicit manual version creation; complete logical versions with physical incremental reuse; full directory re-enumeration but changed-byte upload; manual Git updates; file-level add/modify/delete only; and bounded streaming/atomic truthfulness at 100,000 files.

Independent F001 brainstorming and design reviews by 砚砚 and Kimi supplied the object, safety, incremental, scale, and interaction constraints incorporated here. This document, the Feature Spec, and ADR-0003 are now aligned. Implementation remains a separate authorization and planning step.
