> Language: **English** · [简体中文](traqen-product-architecture.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004, F005, F006]
related_features: []
topics:
  - product-architecture
  - workspace
  - analysis-agent
  - traceability
  - governance
  - change-impact
  - frontend
  - user-journey
doc_kind: architecture
created: 2026-07-31
updated: 2026-08-28
status: proposed
---

# Traqen Product Architecture

## 1. Mission and design boundary

Traqen understands an existing project's code and files deeply enough to construct an auditable graph across requirements, design, code, data, configuration, tests, test results, and change history. The graph supports review rather than pretending that automated analysis has recovered unquestionable business truth.

This document is the product-level architecture source of truth. It defines:

- the Workspace aggregate root and cross-module context;
- the product Feature map;
- the Main/Child Analysis Agent topology;
- global model assets, built-in/project capability catalogs, and Workspace-effective configuration;
- canonical graph authority and history;
- the verified gap between the target architecture and implementation commit `1682d7d`.

Detailed execution contracts remain in [F001 Workspace scan and Analysis Agent lifecycle](../features/workspace-scan-and-analysis-lifecycle.md). Canonical entity authority remains in [ADR-0001](../decisions/ADR-0001-canonical-traceability-ontology.md); Workspace identity, switching, and capability isolation are fixed by [ADR-0002](../decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md).

## 2. Architecture invariants

1. **Workspace is the aggregate root.** Every run, Snapshot, inventory row, Fact, Candidate, Decision, graph revision, review, impact assessment, configuration, and projection belongs to exactly one `workspaceId`.
2. **Switching Workspace switches the whole product.** Navigation can remain on the same module, but data, selections, subscriptions, settings, and current graph head must all rebind to the new Workspace.
3. **Hide is not delete.** Add/remove only changes whether a Workspace appears in the user's switcher. Delete changes the Workspace lifecycle under an audited retention policy.
4. **Raw source is the Agent task source.** A complete immutable `SourceSnapshot` and `ArtifactInventory` define analysis coverage. Scanner Facts are an independent reconciliation reference, never the Child Agent task universe.
5. **Every configured Child Agent receives the same batch.** F006 activation has one Main Agent and at least one enabled, complete Child Agent slot. For a given `AnalysisBatch`, every active Child slot receives the same source scope and output contract; a run policy may require multiple independent results when corroboration is required.
6. **Models, Skills, and MCPs are explicit runtime inputs.** Main and Child slots may select different model profiles. The run pins an immutable Workspace-effective execution profile.
7. **Configuration authorities are separate.** Global Accounts/allowlisted-CLI Models and Skill/MCP assets are reusable; Workspace availability, local capabilities, and Agent slots belong to one Workspace. Runtime workers receive only a materialized snapshot and cannot query mutable registries.
8. **Untrusted evidence never silently passes.** Invalid, out-of-scope, contradictory, or unverifiable evidence quarantines the Candidate or records a Gap. It is never discarded without a ledger entry and never promoted by vote.
9. **Live trees are projections, not authority.** The Workspace Analysis tree may stream reconciled working Candidates. Governed Feature/API trees default to the latest published `CurrentGraphHead`.
10. **History is append-only.** A new Snapshot or implementation mapping does not rewrite a business Feature version. Decisions, mappings, GraphRevisions, ChangeSets, impacts, tests, and results remain queryable.

## 3. Product Feature map

| ID | Product module | Owns | Depends on |
|---|---|---|---|
| F001 | Workspace and Analysis Foundation | Workspace lifecycle, source registration, static scan, Main/Child analysis, reconciliation, progress and working tree | F006 |
| F002 | Feature and API Traceability | latest Feature/API trees, evidence blocks, gaps, and per-Feature history | F001 |
| F003 | Traceability Graph | interactive graph projection and evidence-path exploration | F001, F002 |
| F004 | Claim Review | review queue, evidence-insufficient workflows, batch decisions, and editing automated admissions | F001, F002 |
| F005 | Change Impact | incremental change paths, affected objects, and revalidation plans | F001, F002, F003 |
| F006 | Workspace Capability Settings | global Accounts, allowlisted CLI Models, global Skill/MCP availability, Workspace-local/disabled capabilities, explicit Agent grants, durable drafts, active versions, and immutable execution snapshots | none |

The engineering `Fxxx` IDs above are delivery identifiers. They are not governed business `Feature.id` values inside a Traqen graph.

## 4. Overall functional architecture

[Open the editable Excalidraw source](../diagrams/traqen-product-architecture/traqen-product-functional-architecture.excalidraw) · [Static SVG](../diagrams/traqen-product-architecture/traqen-product-functional-architecture.svg)

The diagram follows one rule: `CurrentWorkspaceContext` fans into every product surface. No module owns an independent project selector.

```text
Workspace switcher
  └─ CurrentWorkspaceContext
       ├─ Workspace Analysis
       ├─ Feature Traceability
       ├─ Traceability Graph
       ├─ Claim Review
       ├─ Change Impact
       └─ Workspace Settings
```

All surfaces read from the same canonical ledgers but use different projections. A working Candidate tree and a published governed tree must remain visually and contractually distinct.

### 4.1 Cross-Feature product experience

The product shell exposes the six modules above as one Workspace-scoped journey rather than as unrelated administration pages:

| Navigation group | Surface | Primary user job |
|---|---|---|
| Understand | Workspace Analysis (F001) | establish or refresh system understanding |
| Understand | Feature / API (F002) | inspect governed capabilities and their evidence chains |
| Understand | Traceability Graph (F003) | explain relationships and evidence paths |
| Govern | Claim Review (F004) | decide weak, conflicting, sampled, or stale Candidates |
| Govern | Change Impact (F005) | explain change and close review/revalidation actions |
| Configure | Capability Settings (F006) | pin the Workspace execution capabilities and boundaries |

The Workspace root route is a **landing overview**, not a seventh product module. It summarizes the current published head, active job, review queue, open impact actions, configuration validity, and recent immutable activity. Its primary call to action changes with Workspace state: register source, repair configuration, start the first analysis, continue an active job, run an incremental analysis, or resolve a blocking review.

The persistent shell must show:

- the Workspace switcher and current Workspace identity;
- the current module and selected object as a breadcrumb;
- the current published `GraphRevision`, or an explicit historical read-only context;
- Workspace-scoped review and change-impact counts;
- language, theme, identity, help, and connection health.

API base URLs, tokens, raw object IDs, and other deployment diagnostics are not primary product navigation. When a development or deployment mode still needs them, they belong in an environment-scoped diagnostics drawer. Normal user journeys begin with a Workspace, Job, governed object, review queue, or latest published ChangeSet and never require typing internal IDs.

### 4.2 Authority and visual-state contract

Every product surface must preserve the same authority language:

- **Published:** solid container, `GraphRevision` identifier, and `PUBLISHED` text;
- **Working Candidate:** dashed container, `CANDIDATE` text, and a persistent non-authoritative explanation;
- **Historical:** read-only banner with the selected Revision and a direct return to Current Head;
- **Conflict, Gap, Missing, and Stale:** icon plus text plus color; color alone is insufficient;
- **Unavailable:** the missing denominator or source and its reason, never an invented zero or perfect score.

Candidate and governed projections may link to one another, but they cannot share a tree, silently merge, or reuse a visual state that hides their authority difference. Graph layout, client selection, and cached preferences never create canonical Nodes, Edges, Decisions, or progress.

### 4.3 Shared interaction and state contract

- Page mount, refresh, reconnect, and Workspace switch are read-only operations. Start, pause, resume, cancel, review, and settings-save transitions require explicit user commands. Publishing follows the governed server workflow and can never be triggered as a page-lifecycle side effect.
- Switching Workspace disables commands bound to the old context, clears old selections, rebinds subscriptions, and rejects late responses as defined in section 5.2.
- Empty states explain why no object exists and identify the next valid action. Retry preserves filters and unsaved input.
- Concurrent commands fail explicitly. Review and settings conflicts preserve both the user's input and the newer server version for comparison.
- Progress exposes independent inventory, static extraction, Agent work, review, evaluation, and publishing denominators. Traqen never compresses these into a single confidence or understanding score.
- Desktop layouts may use list/content/evidence panes. Mobile layouts preserve the same tasks through list-to-detail navigation; the graph defaults to an accessible relationship/path list with the canvas as an optional view.
- Tree navigation, batch selection, review decisions, and graph-path inspection must be keyboard operable. Live progress uses summarized announcements rather than streaming every diagnostic line.

Feature documents F001-F006 own their page-specific journeys, states, authority bindings, and frontend acceptance criteria. [Enterprise Blue](../design/enterprise-blue-theme.md) remains the visual design-system source; this architecture does not duplicate its color or component tokens.

## 5. Workspace aggregate and lifecycle

### 5.1 Canonical objects

```ts
type Workspace = {
  id: string;
  name: string;
  status: "ACTIVE" | "DELETION_PENDING" | "DELETED";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type WorkspaceViewPreference = {
  workspaceId: string;
  principalId: string;
  visible: boolean;
  lastOpenedAt: string | null;
};

type CurrentWorkspaceContext = {
  workspaceId: string;
  workspaceVersion: number;
  effectiveConfigurationRevisionId: string;
  currentGraphHeadVersion: number | null;
};
```

`WorkspaceViewPreference.visible=false` implements remove/hide while retaining data. Delete is a separate audited command. A deleted Workspace cannot start runs or accept new Decisions, but retention policy controls when its immutable artifacts may be physically purged.

The existing server `Project.id` is migrated into `Workspace.id` or retained temporarily as a compatibility alias to that same identity. It must not survive as a second 1:1 aggregate with independent lifecycle, selection, or authorization state.

### 5.2 Switch transaction

When the user selects another Workspace, the shell must:

1. replace `CurrentWorkspaceContext`;
2. cancel or detach old UI subscriptions without cancelling server jobs;
3. clear Feature/API/graph/review/impact selections from the old Workspace;
4. load the new Workspace's effective configuration and current graph head;
5. attach to that Workspace's active job and projections;
6. reject late responses whose `workspaceId` or context version no longer matches.

This prevents data from one Workspace appearing under another after a slow response.

## 6. Workspace Analysis architecture

### 6.1 Independent lanes

One immutable Snapshot feeds two independent lanes:

- **Static scan lane:** inventories files, code, configuration, documents, images, tests, results, and unsupported/binary content; extracts deterministic Facts where capability exists.
- **Agent lane:** derives deterministic `AnalysisBatch` objects from the complete inventory, then lets every configured Child Agent read policy-bounded raw `SourceSlice` inputs from the same batch.

Images and other binary artifacts remain in the inventory denominator. They are analyzed only when a declared media/OCR specialist is installed; otherwise they produce an explicit unsupported or unprocessed Gap.

### 6.2 Main and Child Agent contract

The Main Agent owns planning questions, output contracts, lifecycle control, reconciliation, follow-up requests, module/project synthesis, and user-visible summaries. It does not own coverage accounting; deterministic planning guarantees total disposition even if the Main model fails.

Each active Child Agent:

- has its own pinned model, Skill set, MCP set, and capability provenance;
- receives the same `AnalysisBatch` identity, source ranges, constraints, and output schema as every other active Child;
- analyzes independently and cannot read another Child's output or private reasoning;
- returns evidence-bound Candidate observations or explicit uncertainty.

A new Workspace starts with one empty `Child 1` slot and may add more without importing a template. F006 activation rejects fewer than one enabled, complete Child slot. A run policy records whether multiple outputs are genuinely independent through `independenceGroup`; using the same underlying model family remains valid but does not count as independent corroboration when corroboration is required.

[Open the interactive Analysis batch workflow](../diagrams/traqen-product-architecture/workspace-analysis-batch.workflow.html) · [Archify source](../diagrams/traqen-product-architecture/workspace-analysis-batch.workflow.json)

### 6.3 Batch fan-out and reconciliation

For every batch:

1. the deterministic planner seals the shared input;
2. the scheduler creates one `ChildWorkUnit` per active Child slot;
3. all ChildWorkUnits run independently and may execute concurrently;
4. evidence validation rejects references outside the Snapshot, batch, or SourceSlice allowset;
5. the Main Agent compares every valid Child result with static Facts and historical lineage;
6. exact agreement becomes corroboration only within calibrated confidence limits;
7. disagreement becomes a `ConflictLedger` entry, not a majority decision;
8. evidence-invalid output becomes a quarantined Candidate or Gap;
9. a reconciled batch projection updates the working Feature/API tree;
10. module and project synthesis consume reconciled outputs plus original evidence references, never child summaries alone.

The product can therefore process a very large repository without one whole-repository prompt. Batch count is dynamic; logical Child count is Workspace-configured.

### 6.4 Real-time progress

Progress has separate denominators:

- Snapshot and inventory: discovered, sealed, included, excluded, unsupported, failed;
- static scan: planned and completed extractor WorkUnits;
- Agent analysis: batches planned, ChildWorkUnits completed, awaiting siblings, reconciliation completed;
- quality: evidence-valid Candidates, quarantined Candidates, conflicts, gaps;
- publication: evaluation and graph revision status.

The live tree updates only after batch reconciliation. Raw model text never mutates a visible Feature/API node.

## 7. Capability configuration and isolation

### 7.1 Four authorities, one runtime snapshot

Global Settings owns Accounts, reusable allowlisted CLI Models, and global Skill/MCP assets. Workspace Settings owns a durable draft with Workspace availability choices, local capabilities, and a Main/Child roster. Agents receive explicit grants from the effective Workspace set. There is no editable global template, global active/default model, direct API model runtime, or implicit grant.

```text
Global Accounts (API-key secret reference / CLI-owned OAuth status)
                  +
Global CLI Models + active Skill/MCP assets
                  ↓ availability ceiling
Workspace draft: disabled inherited + independent local capabilities
                  +
Workspace Agent roster (one Main + Child slots 1..N)
                  ↓ auto-save, validate, explicit Apply
Workspace active configuration
                  ↓ pin at run start
Immutable non-secret execution snapshot
                  ↓ mount only this snapshot
Main Agent / Child Agents / workers
```

[The earlier interactive configuration data flow](../diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html) is historical and must be regenerated during F006 implementation; it encodes the superseded overlay model.

Capability resolution is `active global − Workspace disabled + Workspace local`, then `effective set ∩ explicit Agent grants`. A globally inactive/deleted asset cannot be re-enabled by a Workspace. A Workspace-local item is independent; it does not replace or field-patch a global manifest.

The Workspace execution revision contains:

- Main Agent model revision and planning/reconciliation Skill/MCP grants;
- ordered Child Agent slots and their model/Skill/MCP grants;
- global/local capability provenance, Workspace disabled state, and explicit grant digest;
- project dependencies;
- project conventions and constraints;
- data-boundary, budget, concurrency, retry, and calibration policies;
- a content digest and creation/validation provenance.

Runtime code receives no global registry handle. A Skill or MCP not present in the Workspace revision is unavailable even if globally installed.

Settings remain editable after a Run starts. Autosave advances a durable draft; explicit Apply creates a new immutable active configuration for later Runs. A Run remains pinned to its snapshot and never hot-swaps settings. Global Skill/MCP removal requires a server-derived impact preview and typed confirmation; it blocks a new run only when the active configuration actually grants the now-unavailable asset.

### 7.2 Secrets

Model and MCP revisions may reference credential handles, never copy plaintext secrets into a run. Resolution grants the minimum secret handles to the exact Workspace, Run, and Agent slot. Telemetry, diffs, diagnostics, logs, execution profiles, and stored prompts exclude credentials and unredacted secret material. Local CLI adapters construct argv without shell interpolation and own bounded timeout, output, cancellation, and process-tree cleanup.

## 8. Canonical graph, review, and history

The authority order is:

```text
SourceSnapshot / ArtifactInventory
  → deterministic Facts
  → Child results
  → reconciled Candidates + Conflict/Coverage/Gap ledgers
  → human Review and Decision
  → immutable GraphRevision
  → evaluated atomic CurrentGraphHead publication
```

Candidates can populate a working tree but cannot create or revise governed Features, Claims, FeatureVersions, or TestSpecs. Automated admissions are editable review outcomes, not immutable truth.

[Open the interactive graph lifecycle](../diagrams/traqen-product-architecture/graph-governance.lifecycle.html) · [Archify source](../diagrams/traqen-product-architecture/graph-governance.lifecycle.json)

The default Feature/API tree uses the latest published head. A Feature history view resolves:

- every governed FeatureVersion and its Decision;
- implementation mappings by Snapshot;
- design, requirement, data, configuration, test, and result evidence;
- ChangeSets and ImpactAssessments;
- review events, conflicts, gaps, and verification results.

Historical compatibility is fail-closed. A pre-v2 artifact can expose only nodes and edges whose ownership by the requested Feature is uniquely provable from immutable artifact content. Missing F002 snapshots expose a server-owned reanalysis command only when the original Job, source/profile bindings, sealed Snapshot, and persisted Inventory are all verified; otherwise they expose a non-executable prerequisite reason with no command endpoint. The server derives recovery bindings from the source Revision, and its new linked historical GraphRevision is published without rewriting the source Revision or changing `CurrentGraphHead`.

## 9. Implementation gap at `1682d7d`

This table describes repository implementation, not design intent.

| Vision area | Status | Verified implementation evidence | Required adjustment |
|---|---|---|---|
| Workspace root and switching | Partial | `web/app/traqen-product.tsx` keeps `workspaceProjectId` and passes `projectId` to most surfaces; `local-workspace-store.ts` persists browser projects and visibility | introduce a server-owned Workspace aggregate/context; prevent stale cross-Workspace responses |
| Create, hide/show, delete | Partial | browser UI creates and hides local records; `contracts/openapi.json` exposes only `POST /v1/projects` and `GET /v1/projects/{projectId}` | separate view preference from audited delete; add list/lifecycle APIs |
| Static scan of complete project | Partial | browser scan filters text extensions and files above 768 KiB; `LegacyUnderstandingRuntime` has a server inventory path | remove competing authoritative scan paths; keep every artifact disposition, including images/binary |
| Raw-source Agent analysis | Partial | `LegacyUnderstandingRuntime` reads Snapshot `SourceSlice`; older `AnalysisAgent` consumes only a scanner FactGraph | converge on one runtime where Child Agents read Snapshot slices and scanner Facts remain reconciliation input |
| Configurable Main + Child 1..N | Missing/conflicting | one global active model profile; capability domain permits one Child; Web renders three fixed idle Child slots; model planner requires exactly three assignments | introduce persisted role-specific Workspace Agent slots, require one complete Child for F006 activation, and remove hard-coded three |
| Same batch sent to all Child Agents | Missing | the unused planner splits modules across three assignments; server `AnalysisAgent` invokes one model per WorkUnit | create `AnalysisBatch` plus one ChildWorkUnit per configured slot |
| Main planning and multi-result reconciliation | Partial | deterministic reconciliation exists; client helper compares one enrichment set with scanner candidates | reconcile the complete sibling result set against static Facts and lineage |
| Global accounts/CLI models + Workspace Skill/MCP availability and grants | Missing | model registry exposes one active profile and API-oriented adapters; Skills/policies bootstrap globally; resolver uses name-only lookup; no project capability or Workspace MCP management exists | add account status, allowlisted CLI models, global availability, Workspace disabled/local capability records, explicit grants, draft/active heads, run snapshots, and profile-only runtime access |
| Live analysis statistics/tree | Partial | browser publishes scanner-derived progress trees; server AnalysisRun exposes WorkUnit counters | stream reconciled batch projections and independent coverage/quality denominators |
| Feature/API traceability and history | Partial | trees and APIs exist; `getFeatureUnderstandingHistory` is implemented but not used by the main product UI | bind both trees and history to published Workspace graph projections |
| Traceability graph | Partial | interactive graph and current-head APIs exist | remove demo fallback and make every path evidence-resolvable |
| Claim review queue, batch review, edit auto-pass | Missing/partial | current UI loads one Reverse Candidate by IDs and submits one review; no batch queue or auto-admission editor | add Workspace review queue, batch commands, editable automated outcomes, and optimistic concurrency |
| Change impact | Partial | domain/API and a manual Snapshot comparison UI exist, with demo fallback | drive from published incremental runs and graph paths under current Workspace |

The current implementation therefore provides reusable domain pieces, not a coherent implementation of this architecture.

## 10. Delivery order

The single active Codex implementation plan is
[`feature-specs/2026-07-31-traqen-product-foundation.md`](../../feature-specs/2026-07-31-traqen-product-foundation.md).

1. **Foundation:** F006 configuration resolution and F001 Workspace aggregate contracts.
2. **Analysis cutover:** one server-owned Snapshot/inventory/scan/Agent path with same-batch Child fan-out and reconciliation.
3. **Published projections:** F002 latest/history trees and F004 review queue.
4. **Exploration:** F003 graph paths backed only by canonical ledgers.
5. **Evolution:** F005 incremental impact and revalidation.
6. **Dogfood:** two pinned Traqen Snapshots prove full → incremental behavior, review, history, and impact.

F002–F005 do not need to wait for every F001 dogfood activity, but each may start only after its required F001 canonical contracts are stable. They may build projections and workflows over those contracts; they may not create temporary stores or authority rules while waiting for the full release gate.

No later module should invent another project selector, model registry, Candidate authority rule, or graph store.

## 11. Non-goals

- automatically declaring model consensus to be business truth;
- sending an entire repository to one model request;
- allowing a Child Agent to see sibling output before independent completion;
- using global Skills/MCPs directly at runtime;
- rewriting historical Feature versions after code changes;
- treating unsupported images, binaries, generated artifacts, or secrets as if they did not exist.
