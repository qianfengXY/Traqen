---
feature_ids: [F006]
related_features: [F001]
topics: [implementation-plan, workspace-settings, global-assets, agents, skills, mcp, frontend]
doc_kind: implementation-plan
created: 2026-08-28
status: planned
---

# F006 — Workspace Capability Settings Implementation Plan

**Feature:** F006 — `docs/features/F006-workspace-capability-settings.md`

**Goal:** Deliver a safe, durable settings experience in which global Account/Model/Skill/MCP assets are explicitly selected by each Workspace and then explicitly granted to each Agent, with drafts, active versions, and immutable run snapshots.

**Acceptance Criteria:** AC-A1 through AC-A4, AC-B1 through AC-B5, and AC-C1 through AC-C3 in the F006 specification.

**Architecture cell:** Product Architecture §7: Capability configuration and isolation.

**Map delta:** required.

**Map delta why:** The existing code and diagrams encode a global template/project-override model, two default Children, and API-or-CLI model revisions. F006 replaces those semantics with account-owned CLI models, global availability, Workspace-local additions, explicit grants, and one-or-more Children.

**Architecture:** Global asset records are independent from Workspace drafts. A Workspace draft owns its agent roster, capability availability selections, and grants. Applying it validates the product invariants and materializes an immutable active execution-profile revision. Run creation copies the active revision into a non-secret snapshot. Runtime receives only that snapshot.

**Tech Stack:** Node 20 ESM, current domain/application/API modules, PGlite/Postgres and memory stores, React 19 + TypeScript web client, Node `node:test`, ESLint, current web build tests.

**前端验证:** Yes — Desktop and narrow-screen settings journeys must be verified with the browser preview after implementation, including empty/error/recovery states, scope switching, draft/apply, and a blocked-run repair path.

## 1. Scope and terminal model

### 1.1 Canonical entities

| Entity | Owned by | Required fields / lifecycle |
|---|---|---|
| `GlobalAccount` | Global Settings | `API_KEY` secret reference or `OAUTH_CLI` non-secret status; readiness; audit timestamps. |
| `GlobalCliModel` | Global Settings | allowlisted CLI kind, account reference, optional client model selector, readiness and verification result. |
| `GlobalCapability` | Global Settings | `SKILL`/`MCP`, versioned manifest metadata, validation, `ACTIVE`/`INACTIVE`/`DELETED`. |
| `WorkspaceCapabilityDraft` | Workspace | exactly one Main; one-or-more Child records; Workspace disabled inherited keys; Workspace-local capabilities; explicit grants; version/CAS. |
| `WorkspaceActiveConfiguration` | Workspace | validated immutable materialization of a draft. |
| `AnalysisRunSnapshot` | Run | non-secret copy of exactly one active configuration; immutable. |

### 1.2 State census

| State | Owner | Entering event | Leaving event | Durable consequence |
|---|---|---|---|---|
| Global account/model `UNVERIFIED` | global asset service | create/edit | verification succeeds/fails | cannot be selected until ready. |
| Global capability `INACTIVE`/`DELETED` | global asset service | deactivate/delete | activate (not for deleted) | cannot enter a Workspace effective set or grant. |
| Workspace draft `INCOMPLETE` | Workspace settings service | auto-save edit | valid Apply | persisted and recoverable, but not runnable. |
| Workspace active `READY` | Workspace settings service | Apply valid draft | next Apply | source for new run snapshots. |
| Workspace `NEEDS_ATTENTION` | derived by service | global asset becomes unavailable | repair and Apply | block only if active grants include unavailable capability. |
| Run snapshot `PINNED` | analysis runner | start run | never mutated | remains executable/auditable even after later configuration edits. |

### 1.3 Non-negotiable invariants

| ID | Assertion | Adversarial proof |
|---|---|---|
| INV-001 | API-key values and OAuth tokens do not serialize outside the secret provider/CLI. | Feed a sentinel secret through create, read, audit, snapshot, and error paths; assert it is absent. |
| INV-002 | Only an allowlisted CLI invocation may execute. | Supply shell metacharacters/custom argv; expect validation failure and no process attempt. |
| INV-003 | A Workspace cannot grant a globally inactive/deleted capability. | Deactivate after a draft is saved, then attempt grant and Apply. |
| INV-004 | Exactly one Main and at least one complete Child are required for Apply. | Delete/change roles or leave `Child 1` incomplete; draft saves but activation fails. |
| INV-005 | Global assets never implicitly become Agent grants. | Add/activate global capability and assert every existing Agent's grants are unchanged. |
| INV-006 | A Run cannot observe mutable post-start state. | Apply version N, start run, apply N+1/deactivate a capability, assert run retains N. |
| INV-007 | Global unavailability blocks only actual active grants. | Keep an ungranted inactive catalog item; assert run start remains allowed. |

### 1.4 Migration rules

The migration must be explicit and auditable, not a silent reinterpretation:

- legacy global model profiles become candidate CLI-model records only when their CLI configuration maps to a supported client; API transport records are retained as history and marked unsupported-for-v1 rather than executed;
- legacy built-in/project capability templates and overlay keys are converted to global or independent Workspace-local assets only with a recorded source mapping;
- no imported/legacy capability becomes an Agent grant implicitly;
- legacy two-Child defaults become `Child 1` plus a preserved extra Child only when it has meaningful data; empty extra placeholders are not treated as required configuration;
- ambiguous identity, missing referenced model, and disabled/overridden conflicts become `NEEDS_ATTENTION` with a repair reason.

## 2. Implementation tasks

Each task is Red → Green → Refactor: add the specified failing test first, run it to prove the failure, implement the smallest coherent product behavior, rerun the focused test, then run the named regression set. Commit only a reviewed, passing task boundary.

### Task 1 — Replace domain contracts and validate configuration resolution

**Files:**

- `src/domain/workspace-execution-profile.js`
- `src/domain/index.js`
- `test/workspace-product-foundation.test.js`
- new `test/workspace-capability-settings.test.js`

**Red:** Specify account auth modes, allowlisted CLI models, global capability lifecycle, one-Main/one-or-more-Child validation, effective capability calculation, and grant-subset validation. Include a failing test for a global inactive capability appearing as a grant.

**Green:** Replace template overlay and API-runtime assumptions with typed global-asset and Workspace-local records. Keep domain functions pure and return source-aware effective catalog data that distinguishes `WORKSPACE_DISABLED` from `GLOBAL_UNAVAILABLE`.

**Verification:** `node --test test/workspace-product-foundation.test.js test/workspace-capability-settings.test.js`.

### Task 2 — Persist heads, immutable versions, and migration receipts

**Files:**

- `src/storage/memory-traceability-store.js`
- `src/storage/postgres/postgres-traceability-store.js`
- `src/storage/postgres/migrations/`
- `test/storage-migrations.test.js`
- `test/postgres-database.test.js`
- new `test/workspace-capability-settings-storage.test.js`

**Red:** Add tests for secret-reference-only persistence, CAS draft saves, active-version creation, migration receipts, restart recovery, and a legacy two-Child/template state with ambiguous records.

**Green:** Add tables/records and repository methods for global assets, drafts, active configurations, snapshots, impacts, and migration audit facts. Ensure Postgres and memory implementations share ordering/CAS semantics.

**Verification:** `node --test test/storage-migrations.test.js test/postgres-database.test.js test/workspace-capability-settings-storage.test.js`.

### Task 3 — Introduce application services and HTTP contracts

**Files:**

- `src/application/workspace-product-foundation.js`
- `src/api/http-server.js`
- `test/api-http.test.js`
- new `test/workspace-capability-settings-api.test.js`

**Red:** Write contract tests for global Accounts/Models/Capabilities; Workspace draft read/save/apply; grant validation; OAuth status recheck; and capability impact preview/delete confirmation.

**Green:** Implement server-authoritative routes such as `/v1/global-accounts`, `/v1/global-models`, `/v1/global-capabilities`, `/v1/workspaces/:workspaceId/capability-draft`, `/apply`, and impact/repair routes. APIs must never accept arbitrary CLI commands, cleartext credentials, client-supplied impact Workspace lists, or agent grants outside the effective set.

**Verification:** `node --test test/api-http.test.js test/workspace-capability-settings-api.test.js`.

### Task 4 — Adapt CLI readiness and analysis-run snapshot construction

**Files:**

- `src/analysis/model-adapters.js`
- `src/analysis/model-profile-store.js`
- `src/analysis/analysis-capability-router.js`
- `src/application/workspace-analysis-job-runner.js`
- `test/analysis-model-adapters.test.js`
- `test/analysis-model-profile-store.test.js`
- `test/analysis-capability-router.test.js`
- `test/workspace-analysis-job-runner.test.js`

**Red:** Add tests that OAuth status does not trigger login, shell-like values are rejected, an ungranted capability cannot route, and an existing run remains pinned after Apply/deactivation.

**Green:** Limit adapters to allowlisted installed CLI protocols and produce only non-secret readiness/error status. Build the run input exclusively from the persisted active snapshot, not from live global registries or current drafts.

**Verification:** `node --test test/analysis-model-adapters.test.js test/analysis-model-profile-store.test.js test/analysis-capability-router.test.js test/workspace-analysis-job-runner.test.js`.

### Task 5 — Build typed web client state and selectors

**Files:**

- `web/app/product-foundation-client.ts`
- `web/app/capability-settings-state.ts`
- `web/app/capability-roster.ts`
- new `web/app/workspace-capability-settings-client.ts`
- `web/tests/capability-settings-state.test.mjs`
- `web/tests/capability-roster.test.mjs`
- new `web/tests/workspace-capability-settings-client.test.mjs`

**Red:** Test `Child 1` as the only default placeholder, scope-aware DTO mapping, four capability groups, auto-saved draft status, active-version state, and the distinction between availability and grants.

**Green:** Remove fixed two/three-child assumptions and old project-override projection. Keep grant mutation behind Agent settings state, preserve unresolved errors, and prevent stale responses from overwriting newer drafts.

**Verification:** `node --test web/tests/capability-settings-state.test.mjs web/tests/capability-roster.test.mjs web/tests/workspace-capability-settings-client.test.mjs`.

### Task 6 — Deliver Global Settings UI

**Files:**

- `web/app/product-surfaces.tsx`
- `web/app/traqen-product.tsx`
- `web/app/globals.css`
- `web/tests/rendered-html.test.mjs`
- new `web/tests/global-settings-rendering.test.mjs`

**Red:** Test a Settings-center scope chooser, the four independent global pages, empty states, API-key secrecy, OAuth-instruction/recheck state, CLI missing state, and status labels that are not color-only.

**Green:** Implement shared settings shell, desktop left navigation/narrow-screen navigation, asset cards, validation/recovery affordances, and a direct route from a Workspace settings gear. Do not expose an OAuth “login” action.

**Verification:** `npm --prefix web run lint && npm --prefix web test`.

### Task 7 — Deliver Workspace Agent and Capability pages

**Files:**

- `web/app/product-surfaces.tsx`
- `web/app/traqen-product.tsx`
- `web/app/globals.css`
- `web/tests/rendered-html.test.mjs`
- new `web/tests/workspace-settings-rendering.test.mjs`

**Red:** Test scope labels, fixed readiness summary, Main/Child cards plus inspector, mobile drawer behavior, `Child 1` incompleteness, Add Child behavior, capability grouping, and read-only grant summary/link.

**Green:** Implement two Workspace pages—Agent Settings and Capability Management. Capability controls change Workspace availability only; grant controls live in Agent Settings. Rendering must explicitly identify globally unavailable items as needs attention rather than Workspace-disabled.

**Verification:** `npm --prefix web run lint && npm --prefix web test`.

### Task 8 — Apply, confirmation, impact repair, and blocked-run UX

**Files:**

- `web/app/traqen-product.tsx`
- `web/app/workspace-analysis-run-client.ts`
- `web/app/local-workspace-analysis.ts`
- `web/tests/workspace-analysis-run-client.test.mjs`
- `web/tests/rendered-html.test.mjs`
- new `web/tests/workspace-capability-safety.test.mjs`

**Red:** Cover autosave without activation, Apply failures, first-start/version-change confirmation, no repeated confirmation for unchanged active version, typed delete confirmation, affected Workspace repair paths, ungranted unavailable capability, and existing pinned run behavior.

**Green:** Wire the active version to run creation and present direct repair actions. Do not block unrelated Workspaces; only active configurations with actual unavailable grants fail the new-run preflight.

**Verification:** `npm --prefix web test` and the focused root runner tests from Task 4.

### Task 9 — Migration, integration, and visual acceptance

**Files:** migration fixtures and tests from Tasks 2–8; update generated architecture map only after implementation behavior is verified.

**Red:** Create representative old-state fixtures: global API model, CLI model, builtin/project override collision, disabled key, empty second/third Child placeholder, and an active run. Assert migration receipts and post-migration repair state.

**Green:** Run the migration in isolated development data, repair defects before production consideration, then use browser preview to inspect desktop and narrow layouts:

1. first-use empty Global Settings;
2. OAuth-not-logged-in instruction and recheck;
3. Workspace `Child 1` incomplete → valid Apply;
4. four capability groups and Agent grant navigation;
5. global capability deletion impact/repair; and
6. snapshot stability after a run has started.

**Verification:**

```text
node --test test/workspace-product-foundation.test.js test/workspace-capability-settings.test.js test/storage-migrations.test.js test/postgres-database.test.js test/api-http.test.js test/workspace-capability-settings-api.test.js test/analysis-model-adapters.test.js test/analysis-model-profile-store.test.js test/analysis-capability-router.test.js test/workspace-analysis-job-runner.test.js
npm --prefix web run lint
npm --prefix web test
```

No checked-in formatter command is currently exposed by the repository; ESLint is the formatting/style authority for this plan. Any formatter introduced during implementation must be documented and added to the verification contract.

## 3. Delivery order and review gates

1. Tasks 1–4 establish the durable, safe backend boundary and migration proof.
2. Tasks 5–8 build the UI only against the server-authoritative contracts.
3. Task 9 validates migration, visual behavior, and snapshot safety in an isolated environment.
4. Before each merge: run quality-gate, fresh-context review, independent cross-individual review, receive-review, then merge-gate. Reviewers must not review their own implementation.

## 4. Explicit non-goals

This implementation does not add a direct API model runtime, self-designed Agent runtime, Traqen-driven OAuth login, field-level/global-manifest overrides, implicit Agent grants, or any production-data migration without a separately authorized data plan.
