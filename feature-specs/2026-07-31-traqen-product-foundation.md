# Traqen Workspace-Rooted Product Foundation — Implementation Plan

> **For Codex:** implement from the current integration branch, not from this documentation branch's older code snapshot. Read the active truth sources below before editing. Use TDD, one independently reviewable slice at a time.

**Status:** active implementation plan
**Created:** 2026-07-31
**Features:** F001, F002, F003, F004, F005, F006
**Design branch:** `design/f001-legacy-system-understanding`

## 1. Goal

Turn the existing collection of project, scanner, Agent, graph, review, and impact capabilities into one coherent Workspace-rooted product:

- Workspace is the aggregate root and switching it rebinds every module;
- a complete immutable source inventory feeds static scanning and direct-source Agent work as independent evidence paths;
- one Main Agent plans and reconciles; one or more Child Agents, default two, receive the same bounded batch and return independent results;
- runtime models, Skills, and MCPs come only from an immutable Workspace-effective profile;
- evidence-untrusted Candidates are quarantined or surfaced as Gaps;
- the latest governed Feature/API graph and immutable history drive traceability, review, graph exploration, and change impact.

## 2. Authority and prerequisites

Read in this order:

1. `docs/architecture/traqen-system-requirements.md`
2. `docs/architecture/traqen-product-architecture.md`
3. `docs/features/F006-workspace-capability-settings.md`
4. `docs/features/F001-legacy-system-understanding.md`
5. `docs/features/workspace-scan-and-analysis-lifecycle.md`
6. `docs/features/F002-feature-api-traceability.md`
7. `docs/features/F004-claim-review.md`
8. `docs/features/F003-traceability-graph.md`
9. `docs/features/F005-change-impact.md`
10. `docs/decisions/ADR-0001-canonical-traceability-ontology.md`
11. `docs/decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md`

The editable overall design is
`docs/diagrams/traqen-product-architecture/traqen-product-functional-architecture.excalidraw`.
The three Archify projections define analysis execution, capability resolution, and graph governance.

The implementation audit used commit `1682d7d`. Before coding:

1. create a new implementation branch from the latest integration commit;
2. verify whether the implementation still has the recorded gaps;
3. map renamed files without changing the contracts;
4. keep this design branch documentation-only.

Superseded documents and plans are absent from the working-tree baseline. Use Git history only when historical recovery is necessary; it is not implementation authority.

## 3. Non-negotiable invariants

1. Every persisted and user-visible object resolves to exactly one `workspaceId`.
2. `WorkspaceViewPreference.hidden=true` does not delete data.
3. deletion is an audited lifecycle; no hard-delete shortcut is allowed.
4. every Workspace switch advances `contextVersion`; stale requests and events cannot mutate the new context.
5. `SourceSnapshot` and `ArtifactInventory` define complete analysis coverage. Scanner output does not define the Child task universe.
6. every active Child slot receives the same `analysisBatchId`, input digest, source scope, task statement, and output schema.
7. sibling outputs are isolated until the completion barrier.
8. the Main Agent reconciles evidence; vote count never creates governed truth.
9. runtime receives `WorkspaceExecutionProfileRevision`, scoped secret grants, and bounded source access. It receives no global registry handle.
10. invalid or unverifiable evidence is retained in quarantine, ConflictLedger, or CoverageLedger; it is never silently discarded or promoted.
11. working Candidate projections and published governed projections are separate.
12. only an authorized Decision creates or changes governed Feature, Claim, FeatureVersion, or TestSpec authority.

## 4. Delivery order

The dependency order is deliberate:

```text
Workspace aggregate/context
  -> Workspace capability isolation
  -> complete Snapshot/Inventory + static scan
  -> same-batch Main/Child orchestration
  -> reconciliation + working projections
  -> Feature/API traceability + review
  -> traceability graph
  -> change impact + historical acceptance
```

Do not build new UI behavior on the fixed-three-slot or demo-fallback paths. Do not implement F002–F005 as independent stores.

## 5. Task 1 — Workspace aggregate and context switch

### RED

Add domain, API, persistence, and Web tests proving:

- create, list, rename, hide, show, request deletion, cancel deletion, and complete deletion;
- hiding is per user and does not remove runs, Snapshots, graph revisions, or settings;
- all scoped routes reject a mismatched `workspaceId`;
- switching Workspace resets selected Feature/API/review/impact state, changes subscriptions, and discards a delayed response from the previous `contextVersion`;
- no page owns an independent project selector.

### GREEN

- introduce canonical `Workspace`, `WorkspaceViewPreference`, and lifecycle events;
- add list and audited lifecycle commands to the application/store/API layers;
- replace split `projectId` / `workspaceProjectId` UI authority with one `CurrentWorkspaceContext`;
- require Workspace scope in module clients and event subscriptions;
- add a stale-response guard using `{workspaceId, contextVersion}`.

### Gate

Run focused domain/API/Web tests. Capture one browser acceptance showing that the user can switch Workspace while a delayed request from the prior Workspace completes without changing the new page.

## 6. Task 2 — F006 capability templates and Workspace-effective execution profile

### RED

Add tests for:

- global model/Skill/MCP entries are templates only;
- Workspace entries with the same logical name override the template;
- Workspace removals prevent inherited capabilities from materializing;
- dependency and convention configuration are Workspace-scoped and revisioned;
- resolver output is deterministic for the same inputs;
- a worker cannot discover a global capability absent from the pinned revision;
- credentials are represented by scoped secret grants, never embedded in the profile or logs.

### GREEN

- introduce versioned template manifests, Workspace overrides/removals, dependencies, and conventions;
- implement a deterministic `WorkspaceExecutionProfileResolver`;
- persist immutable `WorkspaceExecutionProfileRevision` and route decisions;
- issue least-privilege secret grants for the selected run/slot;
- pass only the revision, grants, and source broker handle into Main/Child runtimes;
- migrate existing model profiles without granting implicit global runtime visibility.

### Gate

Validate the capability-resolution Archify diagram against contract tests. Include a negative test where a globally installed MCP is unavailable to a Workspace that did not materialize it.

## 7. Task 3 — complete SourceSnapshot, ArtifactInventory, and static scan

### RED

Add fixtures covering code, documents, configuration, schemas, migrations, images/binaries, tests, results, generated files, oversized files, secrets, unsupported files, symlinks, and read failures.

Prove:

- every in-scope path has exactly one inventory disposition;
- `unassignedCount=0` after inventory seal;
- the denominator includes non-text and non-extracted artifacts;
- source changes create a new Snapshot and do not mutate the current one;
- SourceSlice broker enforces root, digest, range, policy, and data boundary;
- scanner failure does not remove an artifact from later Agent planning.

### GREEN

- consolidate browser/local scanning into a server-owned snapshot and inventory pipeline;
- store content-addressed immutable source metadata and bounded blobs where policy allows;
- run versioned deterministic extractors as an independent path;
- checkpoint discovery, snapshotting, extraction, relation resolution, and Fact commit;
- retain explicit excluded/unsupported/failed dispositions and Gaps.

### Gate

Close the browser during scanning and prove progress continues. Restart the API/worker and prove recovery without replaying completed units.

## 8. Task 4 — same-batch Main/Child analysis orchestration

### RED

Add contract and scheduler tests proving:

- default roster is one Main plus two Child slots;
- one or more Child slots are valid; a hard-coded count of three is invalid;
- deterministic partitioning produces stable IDs and bounded batches;
- every active Child receives an identical batch digest, scope, task, schema, and source policy;
- slots may use different pinned model/Skill/MCP routes;
- sibling output is unreadable before the barrier;
- retries are at-least-once transport with idempotent result commit by input digest;
- missing capability creates `NO_ELIGIBLE_PRODUCER`;
- the Main cannot reconcile an incomplete required terminal set;
- large files and repositories complete through hierarchical leaf/file/module/cross-module synthesis without a whole-repository prompt.

### GREEN

- implement deterministic partitioning from `ArtifactInventory` and structural manifests;
- persist `UnderstandingPlan`, `AnalysisBatch`, slot assignments, route decisions, attempts, outputs, and checkpoints;
- replace decorative Child counters with real slot execution;
- route each slot through the pinned Workspace profile and bounded SourceSlice broker;
- implement the completion barrier and Main reconciliation input envelope;
- expose phase, batch, artifact, slot, token/cost, retry, Gap, conflict, and elapsed progress.

### Gate

Run the same Snapshot with two independently routed Child slots and prove both receive the same batch while producing separately attributable outputs. Pause/resume and worker restart must not repeat a completed result commit.

## 9. Task 5 — evidence reconciliation, ledgers, and working tree

### RED

Add adversarial tests for fabricated spans, digest mismatch, out-of-scope paths, correlated agreement, conflicting Child semantics, missing scanner Facts, duplicate Candidates, and lineage absence.

Prove:

- invalid evidence is quarantined and visible;
- disagreement survives in `ConflictLedger`;
- complete disposition is recorded in `CoverageLedger`;
- exact and historical lineage matching is deterministic;
- no majority vote creates governed identity;
- working-tree updates occur only after a valid batch reconciliation checkpoint;
- a failed evaluation does not move `CurrentGraphHead`.

### GREEN

- validate schema, provenance, scope, digest, and evidence reachability before semantic merge;
- reconcile Child results against static Facts and prior lineage;
- materialize CandidateGraph, ConflictLedger, CoverageLedger, CandidateLineage, and quarantine records;
- stream a clearly labeled working Candidate Feature/API projection;
- evaluate and publish an immutable GraphRevision atomically only when policy passes.

### Gate

Use challenge fixtures where both Child models agree on an unsupported claim. The result must remain quarantined or conflicted, not admitted.

## 10. Task 6 — F002 traceability and F004 claim review

### RED

Add API and UI tests proving:

- Feature/API trees default to the latest published head;
- working Candidates never appear as governed Features;
- one selected object shows requirement, design, code range, data, configuration, test asset, TestSpec, execution, result, Decision, conflict, and Gap states;
- history distinguishes business FeatureVersion from Snapshot implementation mapping;
- review queue filters by Workspace, evidence state, severity, source, and batch;
- batch decisions are atomic per selected item and auditable;
- an authorized reviewer can edit an automatically admitted item;
- no live Workspace falls back to demo data.

### GREEN

- connect the current history and traceability services to the main UI;
- implement Workspace-scoped queue/query commands and batch review;
- preserve original Agent output, reviewer edits, Decision, and resulting graph revision;
- remove live/demo ambiguity.

### Gate

Demonstrate one Feature with complete evidence, one Gap, one quarantined Candidate, one edited auto-admission, and at least two historical Snapshot mappings.

## 11. Task 7 — F003 traceability graph

### RED

Prove:

- graph selection follows the Feature/API selection and Workspace context;
- graph nodes/edges resolve to canonical IDs and evidence;
- view filters are projections over one graph, not duplicate stores;
- current and historical revisions are labeled;
- bounded path queries cannot cross Workspace;
- empty live data shows an empty/error state, never demo nodes.

### GREEN

- drive the existing graph renderer only from canonical Workspace graph APIs;
- add bounded expansion, evidence inspection, gap/conflict overlays, revision comparison, and accessible table fallback;
- remove preset/demo fallback from live routes.

### Gate

Open the same selected Feature from the tree and graph, verify identical IDs and evidence, then switch Workspace and prove the graph fully rebinds.

## 12. Task 8 — F005 change impact and history

### RED

Prove:

- Snapshot comparison creates immutable ChangeSet and ImpactAssessment;
- code/config/data/design/test changes map through the canonical graph;
- affected Features/APIs, confidence, evidence, unresolved paths, and required revalidation are explicit;
- a code-only change does not create a business FeatureVersion;
- latest projections and historical records remain consistent;
- incomplete impact cannot become a passing quality result.

### GREEN

- connect automatic Snapshot diffs to the existing change-impact domain;
- replace manual/demo identifiers with Workspace and graph selections;
- persist impact paths and revalidation plans;
- expose history from Feature/API detail and the impact module.

### Gate

Run FULL on Snapshot A and INCREMENTAL on Snapshot B. Prove graph equivalence against a fresh FULL B run, atomic head movement, preserved A history, and an evidence-backed B impact path.

## 13. Task 9 — migration, cutover, and deletion of duplicate authority

### RED

Add migration and compatibility tests for existing projects, local Workspace visibility, model profiles, analysis runs, Candidate projections, graph heads, and history.

### GREEN

- migrate `Project` records into Workspace identity without changing stable external IDs unless a governed migration requires it;
- materialize initial Workspace profile revisions from existing configuration;
- remove browser execution authority, split project selectors, fixed-three planner assumptions, unused orchestration paths, and live demo fallback;
- keep temporary compatibility reads only when they have an owner, metric, and deletion condition.

### Gate

Repository-wide search must find no runtime assumptions that exactly three Child Agents are required and no live module with an independent Workspace selector.

## 14. Task 10 — Traqen-on-Traqen release acceptance

Use isolated development/test storage and a pinned Traqen source Snapshot.

Required evidence:

1. complete inventory census and disposition totals;
2. scanner Facts and independent same-batch Child outputs;
3. Main reconciliation with conflicts, quarantine, and coverage;
4. latest Feature/API tree plus one complete trace detail;
5. graph path across requirement/design/code/config/test/result;
6. batch review and edit of an auto-admitted item;
7. Snapshot A→B change impact and historical Feature view;
8. Workspace switch during an in-flight request;
9. proof that an unmaterialized global Skill/MCP is unavailable;
10. backend tests, storage tests, Web tests, production build, lint, diff check, and independent review.

Do not claim release readiness from synthetic happy-path counts alone. The reviewed truth set, negative controls, and challenge cases are part of the gate.

## 15. Pull-request slicing

Use independently reviewable PRs in this order:

1. Workspace aggregate/context;
2. capability templates and Workspace profile resolver;
3. complete Snapshot/Inventory and server scan;
4. Main/Child batch orchestration;
5. reconciliation and working projections;
6. Feature/API traceability and review;
7. graph and impact;
8. migration, cleanup, and Traqen-on-Traqen acceptance.

Each PR must update its `Fxxx` status/evidence, pass quality gate, receive independent review, and preserve the single truth hierarchy. Do not merge later slices around a blocked earlier invariant.
