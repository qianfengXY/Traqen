> Language: **English** · [简体中文](ADR-0002-workspace-aggregate-and-execution-isolation.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004, F005, F006]
related_features: []
topics: [workspace, aggregate-root, context-switch, capability-isolation, migration]
doc_kind: adr
created: 2026-07-31
status: accepted
---

# ADR-0002: Workspace Aggregate and Execution Isolation

## Context

Traqen currently exposes a browser-local Workspace concept while server governance is keyed by `Project.id`. Product modules can also retain separate project selections and subscriptions. Global model and Skill registries are available to current runtime bootstrap paths.

The product requirement is stronger: Workspace is the overall project space, and switching it changes analysis, Feature/API traceability, graph, review, impact, settings, history, and active task projections together. Runtime Skills and MCPs must be limited to the selected Workspace configuration.

Independent GPT and Kimi design passes agreed on the Workspace-wide product boundary but exposed two alternatives:

1. keep Workspace and Project as separate objects with a permanent 1:1 mapping;
2. make Workspace the canonical aggregate identity and migrate the legacy Project identity into it.

They also exposed two capability alternatives:

1. let runtime read global registries and apply Workspace filtering dynamically;
2. resolve templates and Workspace overrides before execution, then give runtime only an immutable Workspace revision.

## Decision

1. **Workspace is the canonical aggregate root and tenancy boundary.** Every Snapshot, Inventory row, Fact, run, batch, Candidate, ledger, Decision, graph revision, review, impact, configuration revision, and projection belongs to one `workspaceId`.
2. **Legacy `Project.id` does not remain a second aggregate.** It migrates into `Workspace.id` or remains temporarily as a compatibility alias to the same identity. It has no independent lifecycle, selector, authorization state, or current head.
3. **Visibility and deletion are separate.** `WorkspaceViewPreference` controls per-user show/hide. Deletion is an audited Workspace lifecycle subject to retention policy.
4. **Workspace switching is versioned.** `CurrentWorkspaceContext` carries `workspaceId` and `contextVersion`. Every module detaches old subscriptions, clears old selections, attaches the new Workspace, and rejects late responses or events from the previous context.
5. **Global capabilities are templates, not runtime authority.** A deterministic resolver combines template revisions with Workspace overrides, additions, removals, dependencies, conventions, policy, and slot configuration.
6. **Execution pins an immutable Workspace profile.** Main Agent, Child Agents, and workers receive `WorkspaceExecutionProfileRevision`, scoped secret grants, and bounded source/tool handles. They receive no global model/Skill/MCP registry handle.
7. **No module may create another project selector or graph store.** F002–F005 consume Workspace-scoped canonical contracts created by F001/F006.

## Rejected alternatives

### Permanent Workspace → Project 1:1 aggregation

Rejected because two lifecycles and authorization identities recreate the drift the Workspace requirement is intended to remove. A 1:1 compatibility mapping is allowed only during migration and cannot become product architecture.

### Runtime fallback to global Skills or MCPs

Rejected because filtering a mutable global registry at call time is difficult to replay, audit, and fail closed. Missing Workspace capability must produce an explicit route failure such as `NO_ELIGIBLE_PRODUCER`.

### Independent module selection

Rejected because a Feature page, graph, review queue, or impact view could display data from a different project after a slow request or partial switch.

### Treat hide as delete

Rejected because sidebar preference is reversible user state while deletion changes governed data availability and retention.

## Consequences

- Existing APIs may retain `/v1/projects/{projectId}` during compatibility migration, but application resolution must map the parameter to the canonical Workspace identity.
- Store rows and events require Workspace scope and cross-Workspace uniqueness/authorization tests.
- Web clients require a shared context-version stale-response guard.
- Existing global model profiles require migration into template revisions plus Workspace selections.
- Runtime bootstrap becomes narrower: it mounts only the pinned execution revision and scoped grants.
- F006 is a P0 foundation dependency of F001 capability routing, not a final settings-only phase.

## Verification

- create, show/hide, switch, and audited deletion tests;
- delayed-response and stale-event switch tests across every module;
- migration tests proving stable identity and no duplicate aggregate;
- negative runtime test proving an unmaterialized global Skill/MCP is unavailable;
- replay test proving a run resolves the same capability revision after restart.
