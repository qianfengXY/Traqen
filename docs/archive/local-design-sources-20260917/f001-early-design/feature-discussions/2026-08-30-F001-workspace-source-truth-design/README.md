> Language: **English** · [简体中文](README.zh-CN.md)

---
feature_ids: [F001]
related_features: [F002, F003, F004, F006]
topics: [workspace, source-truth, git, directory-upload, source-bundle, incremental, source-snapshot, artifact-inventory, coverage-gap, receipt, design-gate]
doc_kind: feature-discussion
created: 2026-08-30
updated: 2026-08-31
status: approved
design_gate: operator-approved
---

# F001 design — Workspace & Source Truth

## 1. What F001 completes

F001 is complete when an architect can turn either a selected Git revision, a selected directory, or both into a **replayable Source Truth receipt**. The receipt says exactly which source components Traqen safely captured, what it could not obtain, which version it represents, and whether F002 may use it.

In practical terms, the architect can:

1. create or open a Workspace and independently add **Git source**, **directory source**, or both; at least one is required, and the two together define one analysis scope;
2. select a Git branch/tag/ref and see its exact resolved commit, and/or select one directory and see all selected files verified;
3. let Traqen preflight the source automatically and capture it without executing user-controlled code;
4. inspect a complete component-qualified source inventory, coverage limitations, receipt, and immutable history;
5. create a later source version that compares Git commits or reselected directory manifests and transfers only changed bytes; and
6. hand F002 a qualifying immutable bundle and inherited limitations, rather than a mutable path or branch.

The first release permits one Git component, one uploaded-directory component, or the two together. A combined source is a namespaced union, not an automatic merge: same-named paths are still separate records. F001 does **not** generate the API tree, infer business functions, execute tests, or advise on change impact. Those are F002–F004. Its outcome is the trustworthy source foundation that makes their results believable.

## 2. Functions, purpose, and the problem each resolves

| Function | What the architect gets | Problem it resolves |
| --- | --- | --- |
| Workspace and source choice | Two independent Workspace-bound source cards: Git may be added or omitted; directory upload may be added or omitted; at least one is required. Git credentials stay protected; directory upload has an auditable user/session. | The user never has to choose a misleading third “Git + directory” type; analysis cannot silently use an arbitrary local directory or leak a credential. |
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
                                  └── inventory and Gap verification ──┘
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
| Source setup | Two independent cards: **Add Git source** and **Select directory**. Either may remain absent; at least one enables preflight, and both become the analysis scope. Git shows ref and resolved-commit preview; directory shows its selected-file total. No credential or safety-rule editor. |
| Preflight | `可开始` / `可带预期 Gap 开始` / `已阻断`, affected component/scope, reason, and correction action. A blocker has no accept route. |
| Capture progress | Real stages and stream totals: “discovering N”, then “verified X/Y files and bytes”, policy, **verify captured results**, and seal. Cancel before seal; retry a failed run. |
| Source Coverage | Component filter, path search, disposition/reason, counts, and Gap links. Large inventory is paginated/virtualized. |
| Receipt and history | Native component identities, source bundle, policy, inventory identity, gaps/acceptance, F002 eligibility, and earlier immutable versions. |
| New-version comparison | Baseline/target selection, which component changed, transfer reuse summary, add/modify/delete counts, and the downstream F002/F004 provenance path—not an impact verdict. |

Every error states what failed, which component/scope is affected, whether older sealed versions are still usable, and the next corrective action. Reasons are code-backed and redacted. The Workspace shell shows only the latest state for each source/bundle; detailed receipt history preserves full events.

## 10. Frontend interaction design

The screens extend the current Workspace rather than introduce a new dashboard. Visual examples default to **Simplified Chinese** for the current operator; that is a design-language choice, not a runtime i18n implementation promise. The recommended design defines only the F001 source-snapshot workspace and keeps the light visual tokens from `web/app/globals.css`; it does not decide, rename, or implement global product navigation, which belongs to a separate feature. HTML design sources and PNGs live together in `assets/` for iteration.

### 10.1 Eight-station screens and transitions

This version details the approved eight-station journey. **Each station has its own screen within one persistent source snapshot workbench.** Previous evidence and the next gate remain visible. Selecting a reached station inspects evidence; selecting a future station previews conditions without advancing the run. The existing contextual rail is retained as a placeholder; F005 separately owns global navigation.

[Open the eight-station interactive design](assets/source-truth-journey-v3-zh-CN.html) · [Demo boundaries and transition contract](journey-demo-contract.md)

The prototype uses example data, with no repository reads, local file uploads, or analysis backend. Repository address, requested version, example directory name, and acceptance rationale are editable and persist into subsequent summaries and the example Receipt. Refresh restores only this browser tab's **demo state**, not a real upload. The separate design controls pause the simulation, load individual frames, or inject failures. Loading a frame replaces demo state; use the in-page product actions to walk the main journey.

#### 10.1.1 Station 1: Add sources — user action

![Station 1: independent Git and directory inputs](assets/source-truth-journey-v3-01-sources-zh-CN.png)

Choose either source card or both. Git takes an address and requested version; the prototype directory action explicitly loads example data. Continue stays disabled until at least one source is selected, then opens station 2. No enumeration or trustworthy total exists yet.

#### 10.1.2 Station 2: Configure scope — user confirmation

![Station 2: confirm sources and capture scope](assets/source-truth-journey-v3-02-scope-zh-CN.png)

Confirm the whole Git repository or one directory root, and all files under the selected directory. Components retain separate namespaces; matching paths do not overwrite one another. The system chooses initial full capture or later incremental reuse from the baseline. Users do not configure algorithms, concurrency, or exclusions. Confirming scope starts station 3; returning to source selection still permits editing.

#### 10.1.3 Station 3: Automatic preflight — system action

![Station 3: per-check preflight progress](assets/source-truth-journey-v3-03-preflight-zh-CN.png)

Checks expose read authorization, native source identity, declared scope, and safety conditions. Git resolves the requested version to an exact commit here. Passing checks automatically starts station 4. Expected risks do not become final Gaps without capture evidence. Safety blockers stop here with no acceptance bypass.

#### 10.1.4 Station 4: Enumerate materials — system action

![Station 4: separate Git and directory enumeration](assets/source-truth-journey-v3-04-enumerate-zh-CN.png)

Git enumerates the committed tree; the directory enumerates the complete selected scope. Only observed counts appear, without a total, percentage, or ETA. Once all selected components finish enumeration, station 5 starts automatically. Incremental deletion discovery also requires complete enumeration.

#### 10.1.5 Station 5: Freeze manifest — system action

![Station 5: lock scope and a trustworthy denominator](assets/source-truth-journey-v3-05-manifest-zh-CN.png)

Show component identities, completed enumeration counts, declared scope, and the manifest being frozen. Successful manifest freeze automatically starts station 6 with the same totals as its denominator. **Freezing the manifest does not freeze the Source Bundle**: content capture, verification, and per-item disposition remain necessary.

#### 10.1.6 Station 6: Capture and verify — system action

![Station 6: parallel component capture and verification](assets/source-truth-journey-v3-06-capture-zh-CN.png)

Each source track separately shows verified content, known missing items, pending items, and the fixed total. Progress counts terminal dispositions, including known missing items; it does not assert that all content was obtained. Once every item has a terminal disposition, the run automatically reaches station 7. Cancellation is available before finalization; transient failures retain verified checkpoints for a new attempt.

#### 10.1.7 Station 7: Reconcile inventory and gaps — user action

![Station 7: reconcile counts and explicitly accept non-blocking limitations](assets/source-truth-journey-v3-07-gaps-zh-CN.png)

The combined example reconciles 99,998 content-verified items + 2 known missing items = 100,000 items. The two missing Git LFS contents produce two non-blocking Gaps. All 50,000 directory items are verified. File counts and Gap counts are distinct dimensions.

The user enters a rationale for each limitation, with the current user as accountable actor and an expiry. Accepted Gaps remain amber and stay in the Receipt. Unresolved Gaps, expired acceptance, or blockers prevent freeze. A gap-free input permits reconciliation and freeze without inventing an acceptance step.

#### 10.1.8 Station 8: Freeze Source Bundle — finalizing and complete

![Station 8: atomic Source Bundle finalization](assets/source-truth-journey-v3-08-sealing-zh-CN.png)

Freeze starts disposition reconciliation, component/manifest/policy/Gap binding, atomic sealing, and Receipt issuance. Cancellation is unavailable during finalization. No consumable Receipt or downstream entry appears before success.

![Station 8 complete: frozen Source Bundle and Receipt](assets/source-truth-journey-v3-08-frozen-zh-CN.png)

Completion stays at station 8 and exposes Bundle, Git commit, directory manifest, Inventory, policy, and all limitations. The bundle with accepted Gaps remains amber. F002 admission is a destination after completion, subject to renewed authorization, Receipt, and acceptance checks; it is not station 9.

#### 10.1.9 End-to-end transitions and recovery

~~~mermaid
flowchart LR
  A["1 Add sources · user"] -->|at least one source| B["2 Configure scope · user"]
  B -->|confirm and start| C["3 Preflight · system"]
  C -->|pass, automatic| D["4 Enumerate · system"]
  D -->|complete scope, automatic| E["5 Freeze manifest · system"]
  E -->|fixed denominator, automatic| F["6 Capture and verify · system"]
  F -->|all terminal dispositions, automatic| G["7 Reconcile gaps · user"]
  G -->|valid disposition and confirm freeze| H["8 Freeze Bundle · system"]
  H -->|atomic success, remain at station 8| R["Frozen + Receipt"]
  C -->|blocked| X["Edit source or scope"]
  X --> B
  F -->|transient failure| T["New attempt reuses checkpoint"]
  T --> F
~~~

System stages advance automatically; user stages require explicit action. Demo playback drives only system simulation, never source confirmation or Gap acceptance. Pre-seal cancellation records the attempt without issuing a Receipt. Failed later attempts leave earlier versions unchanged.

![Station 3 blocked: correct input and rerun preflight](assets/source-truth-journey-v3-03-blocked-zh-CN.png)

The blocking state offers source/scope correction. Retrying unchanged blocked inputs remains blocked; changing the source version or valid scope goes through preflight again instead of jumping to capture.

![Station 6 transient failure: retry from a checkpoint](assets/source-truth-journey-v3-06-retry-zh-CN.png)

Retry creates a new attempt using locked inputs and the verified checkpoint. Verified progress and the older Receipt remain available.

![Later version at station 2: full logical manifest with incremental transfer](assets/source-truth-journey-v3-02-incremental-zh-CN.png)

Create new version returns to scope configuration using the actual selected frozen baseline. Git selects a target version; the directory is enumerated again. Only missing changed bytes transfer, while the result retains a complete logical manifest. The fixed frame illustrates r3 → r4; creating a successor to r1 in the interactive journey correctly shows r1 → r2.

[Narrow-screen example](assets/source-truth-journey-v3-mobile-zh-CN.png): the metro map scrolls within its own container and locates the current station, with the step counter remaining visible; actions and contextual evidence stack. F005 still owns the global narrow-screen navigation design.

~~~yaml
in_context_observability:
  primary_surface: "The same source snapshot workbench, with eight stations and a current-station work area"
  why_not_dashboard_only: "Actions, blockers, and the next gate remain visible within the current task"
  deep_dive_surface: "Station evidence, Inventory, Gap, and Receipt details"
  noise_dedup_policy: "Aggregate component state and expand detail on demand; show required decisions and blockers in place"
~~~

### 10.2 Core user flow

1. The user opens a Workspace and sees Source Truth home. If no source exists, two independent cards appear: `Add Git source` and `Select directory`; preflight stays disabled until one is present.
2. For Git, the user enters the repository URL, selects a branch/tag/ref and optional directory root. The frontend explains that the ref will resolve to an exact commit, then confirms the locked short SHA and commit time.
3. For a directory, the user selects a folder through the browser directory picker. The frontend enumerates all selected files and shows `N files selected`; a successful receipt is possible only after `N/N verified`.
4. If Git and directory are both present, the UI shows two component cards rather than merging them into one tree. Colliding relative paths appear as separate rows with their source component.
5. After preflight passes, capture starts. Progress first says that files are being discovered; after manifest freeze it shows verified totals. Large inputs show per-component stages.
6. After seal succeeds, the user lands on receipt details. `READY` may start F002. `READY_WITH_ACCEPTED_GAPS` stays amber and shows inherited limits. `BLOCKED` cannot start F002.
7. When source material changes, the user clicks `Create new version`. Git chooses a new commit; directory input reselects the business folder or a new folder version. The frontend previews changed files and bytes to transfer while stating that the result is a complete new logical version.

### 10.3 State, button, and copy rules

| State | Main label | Allowed actions | Forbidden actions | Copy requirement |
| --- | --- | --- | --- | --- |
| `EMPTY` | No source foundation | Add Git, upload directory | Start F002 | "Select at least one source to establish the analysis foundation." |
| `PREFLIGHT_READY` | Ready | Create snapshot, edit source | Start F002 | Show the Git commit to lock and/or directory file count. |
| `PREFLIGHT_WARN` | Ready with expected gaps | Create snapshot, view expected gaps | Green success label | Explain that the limits will enter the receipt and be inherited by F002. |
| `PREFLIGHT_BLOCKED` | Blocked | Edit source and scope | Create snapshot, accept block, start F002 | Show block reason, affected component, correction action, and old-version availability. |
| `CAPTURING` | Building snapshot | Run in background, cancel before seal | Start F002, edit active source | Show stage, file/byte progress, and current component. |
| `FAILED_RETRYABLE` | Retryable failure | Retry, cancel this run | Issue receipt | Separate network/storage transient failures from user-fixable problems. |
| `SEALED_READY` | Source Bundle frozen | Start F002, view receipt, create new version | Modify old snapshot | Explain that the version is sealed and later input cannot change it. |
| `SEALED_WITH_GAPS` | Usable with limitations | Review accepted non-blocking gaps, start F002, create new version | Present status as green complete | Keep gaps in amber with owner, reason, expiry, and inheritance scope. |

Default page copy is Simplified Chinese. English remains only for object names, status codes, commits, hashes, Receipt, Gap, and other terms that must align exactly with implementation and documentation.

### 10.4 100k-file and incremental experience

The frontend cannot treat large capture as an opaque upload. Users must see what the system is doing while the browser avoids large-list overload:

- Discovery shows observed counts only; reliable percentage appears only after manifest freeze gives a known denominator.
- Git and directory counts/stages are displayed separately, then summarized at bundle level, so a 50,000 + 50,000 combined input is not misread as one source.
- Artifact Inventory uses search, filters, pagination or virtualization; the default view shows summary, exceptions, and recent changes instead of every row.
- Creating a new directory version still enumerates every selected file to detect deletions, but uploads only new or modified bytes missing on the server. The UI shows both "enumerated total" and "bytes to transfer".
- Delta shows only file-level `add`, `modify`, and `delete`, filterable by component. Rename is shown as delete plus add in MVP.
- Failed draft runs never affect sealed versions. The page must say when the previous receipt remains usable.

### 10.5 Frontend acceptance checks

- All eight station screens, the station-8 completion state, and recovery examples come from one design source and show the same journey, Workspace identity, and F001-local position. Global navigation names, grouping, and Feature layout are not F001 acceptance criteria.
- A user can independently add Git, directory, or both from an empty Workspace within three steps and see component identity, locked commit, or directory verified count; the page never offers a third combined-source mode.
- A blocked preflight page has no continue, accept, or F002 entry point. Non-blocking gaps remain amber, not green.
- A 100,000-file combined input does not freeze the browser; Inventory is searchable, filterable, paginated or virtualized.
- The new-version page shows Git/directory add/modify/delete and reuse summary, but not impact analysis.
- Receipt details do not display credentials, raw secrets, temporary upload sessions, or local absolute paths.

This design does not include a global dashboard, live log tail, raw-secret viewer, source editor, API/function tree, or production implementation. Those either bypass source decisions or belong to later features.

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
