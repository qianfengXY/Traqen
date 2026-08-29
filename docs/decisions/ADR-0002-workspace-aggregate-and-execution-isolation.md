> Language: **English** · [简体中文](ADR-0002-workspace-aggregate-and-execution-isolation.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004, F006]
related_features: []
topics: [workspace, aggregate-root, context-switch, capability-isolation, model-registry, capability-overlay, model-retirement]
doc_kind: adr
created: 2026-07-31
updated: 2026-08-29
status: accepted
---

# ADR-0002: Workspace Aggregate and Execution Isolation

## Context

Traqen currently exposes a browser-local Workspace concept while server governance is keyed by `Project.id`. Product modules can also retain separate project selections and subscriptions. Current runtime bootstrap paths can access global model and Skill registries, and the current F006 surface presents model, Skill, and MCP entries as global templates.

The product requirement is stronger: Workspace is the overall project space, and switching it changes analysis, Feature/API traceability, graph, review, impact, settings, history, and active-task projections together. Operators need reusable model connections but project-specific Skill/MCP overlays, disable state, Agent rosters, and durable settings. Runtime must receive one replayable capability snapshot, not a handle to mutable registries.

Independent GPT and Kimi design passes agreed on the Workspace-wide product boundary and later converged on the revised F006 contract. The alternatives were:

1. keep Workspace and Project as separate objects with a permanent 1:1 mapping, or make Workspace the canonical aggregate identity;
2. treat every model/Skill/MCP definition as a global template, or separate reusable model assets from built-in and project capability catalogs;
3. filter mutable registries during execution, or resolve and pin an immutable Workspace profile before a Run starts;
4. replace a referenced model partially or in-place, or replace every current Workspace reference atomically while preserving historical Runs.

## Decision

1. **Workspace is the canonical aggregate root and tenancy boundary.** Every Snapshot, Inventory row, Fact, Run, batch, Candidate, ledger, Decision, graph revision, review, impact, configuration revision, and projection belongs to one `workspaceId`.
2. **Legacy `Project.id` does not remain a second aggregate.** It migrates into `Workspace.id` or remains temporarily as a compatibility alias to the same identity. It has no independent lifecycle, selector, authorization state, or current head.
3. **Visibility and deletion are separate.** `WorkspaceViewPreference` controls per-user show/hide. Deletion is an audited Workspace lifecycle subject to retention policy.
4. **Workspace switching is versioned.** `CurrentWorkspaceContext` carries `workspaceId` and `contextVersion`. Every module detaches old subscriptions, clears old selections, attaches the new Workspace, and rejects late responses or events from the previous context.
5. **F006 has separate configuration authorities, not an editable global template layer.** Global model profiles are reusable API/allowlisted-CLI connection assets. Built-in Skill/MCP catalogs are read-only and may be empty. Each Workspace owns project capability revisions, typed disabled keys, Agent slots, dependencies, conventions, and policy.
6. **Capability resolution is typed overlay followed by disable.** Identity is `(kind, normalizedName)`. A project entry completely overrides the same typed built-in entry. Disable applies to the merged entry; disabling an override cannot fall back to the built-in.
7. **Exactly one Main and at least two enabled, complete Child slots are required for activation.** The domain model, API, and Web client all enforce the lower bound. More Child slots are allowed.
8. **Editable settings and immutable runtime input are distinct.** Invalid drafts remain durable. Activation creates a new `WorkspaceExecutionProfileRevision`. Main Agent, Child Agents, and workers receive that revision, scoped secret grants, and bounded source/tool handles; they receive no mutable global registry handle.
9. **A Run pins its start revision.** Running and paused Runs never hot-swap settings or select a newer revision on resume. Operators may continue editing and activating the Workspace; later Runs use the newer active revision.
10. **Referenced model deletion is all-Workspace replacement followed by retirement.** The server derives all current Workspace references, freezes expected versions, and applies one transaction. Any conflict or validation failure rolls back the complete operation. Historical revisions and active Runs are not rewritten; ordinary lifecycle is `ACTIVE -> RETIRING -> RETIRED`.
11. **No module may create another project selector or graph store.** F002–F004 consume Workspace-scoped canonical contracts created by F001/F006.

### Amendment — 2026-08-28 F006 settings contract

The following amendment supersedes F006-specific portions of Decision items 5–10 above; the Workspace aggregate decision remains unchanged.

1. **Global Settings owns Accounts, allowlisted CLI Models, and global Skill/MCP assets.** Authentication is API Key through a secret reference or CLI-owned OAuth state. Traqen neither performs CLI OAuth login nor stores OAuth tokens, and v1 has no direct API model runtime.
2. **Workspace Settings owns available capability choices and an Agent team.** A Workspace may disable inherited active global assets or add independent local assets. It cannot re-enable globally inactive assets, replace a global manifest, or field-patch it.
3. **Agent grants are explicit.** Effective availability is `active global − Workspace disabled + Workspace local`; an Agent receives only its grant intersection. Global additions never auto-grant.
4. **Activation requires one Main and one-or-more complete Children.** `Child 1` is the default incomplete placeholder. A stricter analysis-run policy may require additional Children without changing F006 activation.
5. **Autosaved drafts and explicit Apply are separate.** Apply creates the immutable active configuration, and each Run pins a non-secret snapshot of that active configuration. Running/paused Runs never hot-swap.
6. **Global Skill/MCP deletion is impact-aware.** Typed-name confirmation follows a server-derived impact preview. Existing snapshots remain valid; a new run is blocked only when its active configuration actually grants an unavailable capability.

## Rejected alternatives

### Permanent Workspace -> Project 1:1 aggregation

Rejected because two lifecycles and authorization identities recreate the drift the Workspace requirement is intended to remove. A 1:1 compatibility mapping is allowed only during migration and cannot become product architecture.

### Editable global capability and role templates

Rejected because the revised product version intentionally has no template workflow. Model connection reuse, built-in catalog defaults, project overrides, and Agent configuration have different ownership and lifecycle semantics.

### Runtime fallback to global or hidden built-in capabilities

Rejected because filtering a mutable registry at call time is difficult to replay, audit, and fail closed. A disabled project override must not reveal the built-in it replaced. Missing capability produces an explicit route failure such as `NO_ELIGIBLE_PRODUCER`.

### Name-only capability identity or field-level MCP merge

Rejected because Skill and MCP may share a name, and deep-merging project MCP fields with built-in command, environment, permission, or credentials creates an unauditable composite.

### Arbitrary CLI command or user-authored argv

Rejected because shell interpolation, injected arguments, unbounded output, and incomplete process cleanup cross the intended local model-execution boundary. Only allowlisted adapters may construct argv.

### Partial Workspace selection during model replacement

Rejected because deletion could complete while current Workspace references remain. Replacement scope is server-derived and atomically covers all current references.

### Rewrite historical profiles or hot-swap an active Run

Rejected because changing a running analysis destroys provenance and replayability. Applying new settings to work in progress requires cancellation and a new Run.

### Independent module selection

Rejected because a Feature page, graph, review queue, or impact view could display data from a different project after a slow request or partial switch.

### Treat hide as delete

Rejected because sidebar preference is reversible user state while deletion changes governed data availability and retention.

## Consequences

- Existing APIs may retain `/v1/projects/{projectId}` during Workspace-identity compatibility migration, but application resolution maps the parameter to the canonical Workspace identity.
- Store rows and events require Workspace scope and cross-Workspace uniqueness/authorization tests.
- Web clients require a shared context-version stale-response guard.
- The existing global model store evolves into a revisioned reusable registry with no active/default pointer. F006 does not migrate legacy model profiles as product behavior.
- Workspace project capability, disabled-key, draft-head, active-profile, and history records require durable storage and optimistic concurrency.
- Runtime bootstrap becomes narrower: it mounts only the pinned execution revision and scoped grants.
- Normal model retirement can outlive current configuration replacement while pinned active Runs finish. Emergency credential revocation is separate and explicitly destructive.
- F006 is a P0 foundation dependency of F001 capability routing, not a final settings-only phase.

## Verification

- create, show/hide, switch, and audited Workspace deletion tests;
- delayed-response and stale-event switch tests across every module;
- stable Workspace identity with no duplicate aggregate;
- API and allowlisted-CLI model verification, persistence, cancellation, injection, and process-cleanup tests;
- typed Skill/MCP coexistence, project override, disable, no-fallback, and source-aware count tests;
- domain/API/Web negative tests for fewer than two enabled Child slots;
- durable invalid-draft recovery and immutable activation/replay tests after restart;
- negative runtime tests proving disabled, ungranted, or unmaterialized capabilities are unavailable;
- all-Workspace model replacement, CAS conflict, full rollback, zero-current-reference, retirement, and active-Run pinning tests;
- secret-leak tests covering forms, configuration, API responses, diffs, prompts, profiles, telemetry, diagnostics, and logs.
