> Language: **English** · [简体中文](F006-workspace-capability-settings.zh-CN.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [settings, workspace, cli, oauth, api-key, models, skills, mcp, agents, runtime-isolation, frontend]
doc_kind: spec
created: 2026-07-31
updated: 2026-08-28
description: Global capability assets and Workspace-scoped Agent configuration with draft-to-active execution snapshots.
description_source: human
description_author: cat-4v94tazw
description_updated_at: 2026-08-28T14:53:00Z
---

# F006: Workspace Capability Settings

> **Status:** spec · **Priority:** P2 · **Owner:** TBD
> **Product truth:** this document supersedes the earlier F006 specification and its template/override model.

## 1. Purpose

Traqen must let an administrator define reusable, global execution assets once, then configure each Workspace with an explicit Agent team and only the capabilities that team may use. A setting change must be recoverable, understandable, durable, and unable to silently alter a running analysis.

F006 is a settings feature, not an Agent runtime: v1 uses installed model CLIs. It does not implement a self-designed Agent or direct API model execution.

## 2. Product model and authority

There are three deliberately separate scopes:

| Scope | Contains | Does not decide |
|---|---|---|
| Global Settings | accounts, CLI-backed models, Skills, MCPs | which Workspace or Agent may use an asset |
| Workspace Settings | one Main Agent, one or more Child Agents, the Workspace-effective capability set | global asset availability |
| Agent configuration | the model and explicit Skill/MCP grants for one Agent | the Workspace-wide capability catalog |

An executable configuration is derived, never inferred:

```text
workspace effective capabilities = active global capabilities
                               − capabilities disabled by this Workspace
                               + Workspace-local capabilities

agent actual capabilities = workspace effective capabilities ∩ explicit Agent grants
```

No global asset is implicitly granted to an Agent. The Global capability state is an upper bound: a globally inactive, deleted, or administratively unavailable Skill/MCP cannot be re-enabled from a Workspace.

## 3. Global Settings

The Settings center has four global pages: **Accounts**, **Models**, **Skills**, and **MCP**. They share a left navigation shell on desktop and a compact navigation control on narrow screens.

### 3.1 Accounts and authentication

Only two authentication modes exist:

1. **API Key.** The key is written only to the approved secret store; UI, API responses, logs, revisions, audit records, and run snapshots contain a non-secret reference and status only.
2. **OAuth.** OAuth belongs to the installed CLI client. Traqen detects and reports its local login state but never performs a CLI login, launches arbitrary authentication commands, reads a token, or stores a token.

When an OAuth-backed CLI is not logged in, Traqen displays an actionable instruction for the administrator to complete the CLI's own login flow and then use **Recheck status**. The model remains unavailable until the check succeeds.

### 3.2 Models

Each global Model pairs a supported, allowlisted local CLI client (such as Codex, Claude, or Kimi) with an Account and an optional client-supported model selection. The model card reports CLI installation, account/authentication readiness, and last verification result.

The CLI adapter must construct only fixed, allowlisted executable-and-argument forms. User-provided shell strings, interpolation, and arbitrary arguments are prohibited. A model is selectable only when it is ready; there is no global active/default model.

### 3.3 Skills and MCPs

Global Skills and MCPs are reusable asset records with separate identity, metadata, validation, lifecycle, and active/inactive state. Empty states must be normal: v1 does not invent a required built-in inventory. API-key references inside an MCP are secret references, never manifest plaintext.

## 4. Workspace Settings

### 4.1 Agent team

Every Workspace has exactly one non-deletable **Main Agent** and at least one **Child Agent**. A new Workspace visibly contains an unconfigured `Child 1`; it is a required configuration placeholder, not an implicit ready Agent. Additional Child Agents are optional and use the explicit **Add Child** action.

Each Agent selects one ready global Model and receives explicit Skill/MCP grants from the Workspace-effective capability set. Creating a Child must not silently copy grants; any model copy is a user-confirmed choice. A Workspaces's F006 activation minimum is one Child. A future analysis policy may require more independent Children for a particular run without changing this setting-level minimum.

### 4.2 Capability management

The Workspace Capability Management page governs **availability**, while Agent Settings governs **grants**. The capability page shows, separately:

1. available global inherited capabilities;
2. capabilities disabled by this Workspace;
3. Workspace-local capabilities; and
4. **Globally unavailable / Needs attention** capabilities.

The fourth group is not labelled as a Workspace disable: the Workspace did not cause the global state. Each row exposes its source, health, effective state, and a read-only summary of granted Agents with a link to edit grants in Agent Settings.

A Workspace may disable an inherited capability or add an independent Workspace-local one. In v1 it cannot replace, fork under the same identity, or field-patch a global Skill/MCP manifest. This preserves provenance and prevents a global update from producing an unexplainable merge.

### 4.3 Draft, apply, and run snapshot

Edits auto-save as a durable **draft** and may remain incomplete. **Apply configuration** validates the draft and creates a new immutable active configuration version; only the active version is eligible for a new run.

Starting a run records an immutable execution snapshot containing the active configuration, exact model/capability provenance, and non-secret identifiers. A first run or a changed active version opens a compact confirmation showing the Main model, Child models, capability count, and account readiness. Repeated starts with the unchanged active version do not repeat the confirmation. Running and paused analyses never hot-swap to later drafts or active versions.

## 5. Deactivation and deletion

Before globally disabling or deleting a Skill/MCP, Traqen shows a server-derived impact preview: affected Workspaces, Agents, active configurations, and existing/future runs. Deletion requires typing the capability name.

Affected Workspaces enter **Needs attention** and can repair by removing a grant, choosing another available capability, or creating an independent Workspace-local alternative. Existing runs retain their pinned snapshot. A new run is blocked only when its active configuration still grants an unavailable capability; a catalog item that is not granted must not block a run.

## 6. Frontend journeys

### Settings entry and orientation

The top-level **Settings** entry opens a scope chooser: **Global Settings** or **Workspace Settings** with a Workspace picker. A settings gear inside a Workspace goes directly to that Workspace. Header, breadcrumb, icon, and text always make the scope explicit; color alone never carries scope meaning.

### Workspace settings shell

A persistent readiness summary lists `Ready`, `Incomplete`, or `Needs attention` plus concrete repair links. The shell has two pages:

- **Agent Settings:** team cards/list and persistent detail inspector on desktop; the inspector becomes a full-screen drawer on small screens.
- **Capability Management:** Skill/MCP segmented catalog and a read-only per-Agent grant summary linked back to Agent Settings.

Object-level errors are shown on the relevant account, model, capability, or Agent card and also summarized at the page level. Every failure names a next action. The experience must provide loading, empty, error, and recovery states; it must not use color as the sole status signal.

## 7. Security and invariants

| ID | Invariant |
|---|---|
| F006-INV-01 | API-key material never crosses the secret boundary; OAuth tokens never enter Traqen. |
| F006-INV-02 | CLI invocation is allowlisted and never accepts a user-supplied shell command. |
| F006-INV-03 | A globally unavailable capability cannot be activated or granted by a Workspace. |
| F006-INV-04 | Agent grants are a subset of the effective Workspace capability set. |
| F006-INV-05 | Activation requires exactly one complete Main and at least one complete Child. Drafts may be incomplete. |
| F006-INV-06 | A run consumes only its pinned active snapshot, not mutable global or Workspace state. |
| F006-INV-07 | Missing global assets block only active configurations that actually grant them. |

## 8. Acceptance criteria

### Global assets

- **AC-A1:** The UI separates Accounts, Models, Skills, and MCPs, including normal empty and recovery states.
- **AC-A2:** Accounts support API Key through a secret reference and CLI-owned OAuth status detection; Traqen cannot initiate or store OAuth credentials.
- **AC-A3:** Models are reusable CLI-backed global assets, require readiness, and cannot be a global default.
- **AC-A4:** Global Skill/MCP active state is an availability ceiling for every Workspace.

### Workspace and Agents

- **AC-B1:** A Workspace persists exactly one Main, a default incomplete Child 1, and any additional Children.
- **AC-B2:** A Workspace can activate only with one complete Main and one or more complete Children.
- **AC-B3:** A Workspace can disable inherited capabilities or create independent local capabilities, but cannot override/patch global manifests.
- **AC-B4:** Capability availability and Agent grants are rendered and edited in their respective pages with source-aware summaries.
- **AC-B5:** Drafts auto-save; Apply creates a durable active version; reloading restores draft and active heads.

### Runtime safety and UX

- **AC-C1:** A run pins an immutable non-secret snapshot and is unaffected by later edits.
- **AC-C2:** A configuration change receives start confirmation once; an unchanged active version does not repeatedly prompt.
- **AC-C3:** Global capability removal shows impact, requires typed confirmation, preserves current runs, and blocks only newly started active configurations that still grant the unavailable capability.

## 9. Relationship to F001

F001 consumes the immutable active execution snapshot that F006 publishes. F001 may add a run-specific redundancy policy, but it must not mutate settings or redefine the F006 minimum Child count.

## 10. Explicit non-goals for v1

- a third authentication category called “CLI”;
- Traqen-driven CLI OAuth login or OAuth token handling;
- direct API model execution;
- self-designed Agents;
- project replacement or field-level merging of global Skill/MCP manifests; and
- any ungranted capability available to runtime discovery or invocation.
