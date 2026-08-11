> Language: **English** · [简体中文](F006-workspace-capability-settings.zh-CN.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [settings, global-model-registry, cli-model-runtime, skills, mcp, project-capabilities, runtime-isolation, persistence, frontend, user-journey]
doc_kind: spec
created: 2026-07-31
updated: 2026-08-11
---

# F006: Workspace Capability Settings

> **Status**: spec | **Owner**: TBD | **Priority**: P0

## Why

Analysis quality changes materially with the selected model, Skill, MCP, dependency knowledge, and project conventions. A global active model and globally mounted tools cannot represent one Workspace's execution policy or protect another Workspace from capability leakage.

Operators must be able to configure a Workspace once, reopen it without repeating that work, and continue revising it later. At the same time, a running analysis must remain explainable: changing settings cannot silently replace the model or capability set already pinned to that run.

## Scope and authority

F006 defines four cooperating authorities rather than an editable global template layer:

1. a reusable global model-profile registry for API and allowlisted local CLI execution;
2. read-only built-in Skill/MCP catalogs, which may contain zero entries;
3. one persisted project-capability registry and disabled-key set per Workspace;
4. one editable Workspace draft head that validates into immutable execution-profile revisions.

Workspace is the project scope. There is no global active model, editable role template, implicit capability inheritance, or runtime fallback to a global registry.

## Global model registry

Models are reusable global connection assets. Workspace Agent slots reference them explicitly; they are not Skill/MCP catalog entries and are never copied into each Workspace.

```ts
type GlobalModelProfile = {
  id: string;
  displayName: string;
  transport: "API" | "CLI";
  readiness: "UNVERIFIED" | "READY" | "ERROR";
  lifecycle: "ACTIVE" | "RETIRING" | "RETIRED";
  currentRevisionId: string;
};

type GlobalModelProfileRevision =
  | {
      id: string;
      profileId: string;
      transport: "API";
      providerAdapter: string;
      endpoint: string;
      model: string;
      credentialHandleId: string;
      createdAt: string;
    }
  | {
      id: string;
      profileId: string;
      transport: "CLI";
      cliAdapter: "CODEX" | "CLAUDE" | "GEMINI" | "KIMI";
      model?: string;
      executablePath?: string;
      createdAt: string;
    };
```

- API mode records display name, provider adapter, endpoint, model, and an encrypted credential handle.
- CLI mode executes through an allowlisted adapter using the CLI's existing local login state.
- A CLI adapter constructs argv directly. User-supplied shell commands, shell interpolation, and arbitrary argument strings are forbidden.
- Verification checks endpoint/authentication for API profiles and executable/login/model readiness for CLI profiles.
- Editing a profile creates a new immutable revision. Existing execution profiles and runs continue to pin the previous revision until a Workspace explicitly validates and activates a newer configuration.
- Connection readiness proves transport availability, not semantic capability or calibration for every analysis role.

## Workspace Skill and MCP sources

Only Skill and MCP entries participate in the capability catalog.

### Built-in catalogs

- Built-in Skill and MCP catalogs are read-only product inputs.
- This version defines their catalog and resolution mechanics but does not prescribe a concrete built-in inventory or add placeholder entries.
- Either catalog may be empty and must have a normal empty state.

### Project capabilities

- Each Workspace owns a persisted project Skill/MCP registry.
- Operators may explicitly add, edit, delete, or import a capability from an authorized project path.
- Traqen stores an immutable artifact revision and content digest for every imported or edited entry.
- Traqen does not silently scan a project and mutate current settings, and it does not rewrite the user's repository as a side effect of configuration.
- Project MCP definitions may reference credential handles; plaintext credentials cannot enter the manifest or artifact revision.

### Typed identity, override, and disable

```ts
type CapabilityKey = {
  kind: "SKILL" | "MCP";
  normalizedName: string;
};

type WorkspaceCapabilityCatalogState = {
  projectCapabilityRevisionIds: string[];
  disabledKeys: CapabilityKey[];
};
```

Resolution is deterministic and ordered:

```text
merged = overlayByTypedKey(builtinCatalog, projectCatalog)
effective = merged - disabledKeys
agentCapabilities = effective intersect agentGrants
```

1. Skill and MCP with the same normalized name coexist because `kind` is part of identity.
2. A project entry completely replaces a built-in entry with the same typed key; fields are not deep-merged.
3. Disable applies after overlay, so built-ins, project additions, and project overrides can all be disabled.
4. Disabling a project override does not reveal or fall back to the hidden built-in entry.
5. Removing a project override reveals the built-in entry only when the typed key is not disabled. A disabled key remains disabled until the operator explicitly enables it.
6. An ungranted or disabled capability is absent from Agent selectors, the execution profile, runtime discovery, and runtime invocation.

The backend resolver returns the effective catalog and source-aware counts:

```ts
type EffectiveCatalogSummary = {
  builtinCount: number;
  projectOverrideCount: number;
  projectAdditionCount: number;
  disabledCount: number;
  effectiveCount: number;
};
```

The Web client displays these values and never reimplements the count or overlay algorithm.

## Workspace Agent roster

```ts
type AgentSlot = {
  id: string;
  role: "MAIN" | "CHILD";
  displayName: string;
  modelProfileId: string;
  skillGrants: CapabilityKey[];
  mcpGrants: CapabilityKey[];
  independenceGroup: string;
  enabled: boolean;
};

type WorkspaceCapabilityDraftRevision = {
  id: string;
  workspaceId: string;
  revision: number;
  mainAgentSlot: AgentSlot;
  childAgentSlots: AgentSlot[];
  projectCapabilityRevisionIds: string[];
  disabledKeys: CapabilityKey[];
  dependencyPolicyRevisionId: string;
  conventionRevisionId: string;
  securityPolicyRevisionId: string;
  createdAt: string;
};
```

- A Workspace has exactly one Main slot and at least two enabled, complete Child slots.
- The lower bound of two is enforced by the domain model, API, and Web client. More Child slots are allowed without a fixed product maximum.
- Main and every Child independently select one `READY` global model profile plus Skills, MCPs, role policy, and independence group.
- A new Workspace starts with an empty Main slot and two empty Child slots. It does not import a role template.
- A draft may be persisted while incomplete or invalid, but it cannot become an active execution profile.

## Persistence, activation, and run pinning

Editable settings and immutable runtime inputs are separate:

```text
WorkspaceCapabilityDraftRevision
        | save: always persisted
        v
validate current global model revisions + effective capabilities + policies
        | activate: only when valid
        v
WorkspaceExecutionProfileRevision
        | selected when a run starts
        v
AnalysisRun.pinnedProfileRevisionId
```

- Every draft save creates an immutable draft revision and advances `WorkspaceCapabilityHead` using ETag/version CAS.
- Validation never discards invalid user input. Field-level failures remain attached to the saved draft.
- Activation creates a new immutable `WorkspaceExecutionProfileRevision` with exact model, Skill, MCP, policy, convention, dependency, and catalog provenance plus a digest.
- A Workspace may continue to edit and activate new revisions after analysis has started.
- A running or paused Run remains pinned to the revision selected at start. Resume cannot select newer settings.
- A newly created Run uses the Workspace's current active profile revision.
- To apply new settings to work already in progress, the operator must cancel that Run and start a new one; hot-swapping a model or capability inside a Run is forbidden.
- Service restart, browser refresh, navigation, and Workspace switching are read-only recovery paths and must restore the current draft head, active profile head, history, and run pinning from durable storage.

## Model replacement and retirement

Deleting a referenced global model is a dependency-aware retirement workflow.

1. Usage preview lists every current Workspace reference, including Main slots, all Child slots, draft heads, active profile heads, and active Runs.
2. The operator selects one `READY` replacement profile.
3. The server creates a `ModelReplacementPlan` that freezes every affected Workspace version. The affected Workspace set is server-derived.
4. The UI has no Workspace selection checkboxes, and the apply API does not accept `workspaceIds`.
5. Apply creates and activates replacement revisions for every affected Workspace in one transaction.
6. If any Workspace changed concurrently or any replacement profile fails validation, the complete transaction rolls back and the preview must be refreshed.
7. Success requires zero current Workspace configuration references to the old profile.
8. The old profile enters `RETIRING` and disappears from new selectors. Historical revisions are not rewritten.
9. Active Runs continue with their pinned old model revision and scoped secret grant until completion or cancellation; only then may the profile become `RETIRED`.

Emergency credential revocation is a separate explicit action. It identifies the active Runs that will fail and never masquerades as ordinary model deletion.

## User Journey

### Primary journey: configure and analyze one Workspace

**Scope unit:** one Workspace, representing one project.

1. The operator opens Global Settings, adds an API or supported local CLI model profile, and verifies it.
2. The operator opens the Workspace Settings page. The previously saved draft and active revision are restored automatically.
3. In Skills and MCP, the operator views built-in, project, and effective catalogs; adds or imports project entries; and disables any unwanted built-in or project capability.
4. In Agents, the operator configures one Main and at least two Child slots with explicit models and effective capability grants.
5. The operator records dependencies, conventions, security boundaries, budgets, and policies.
6. Save Draft persists all input. Validate and Activate shows the resolved diff and creates a new immutable profile only when all checks pass.
7. A new analysis Run pins that active profile. Reopening the Workspace does not require reconfiguration.
8. The operator may later change and activate a new revision while the old Run continues with its original revision; later Runs use the new revision.

### Supporting journey: replace a referenced model

1. The operator requests deletion of a global model profile.
2. The impact drawer lists every affected Workspace, Main/Child slot, current profile, and active Run.
3. The operator selects one replacement profile and confirms one all-Workspace operation.
4. The server either replaces and activates every current reference or changes none.
5. The old profile retires without mutating historical revisions or an active Run.

## Frontend product experience

### Global Settings: Model Library

The model table exposes display name, API/CLI transport, adapter, model, readiness, lifecycle, usage count, Verify, Edit, and Delete/Retire. API forms accept endpoint, model, and token; the token becomes a credential handle and is never returned. CLI forms select an allowlisted adapter and optional executable path, never an arbitrary command string.

A deletion-impact drawer shows all Workspace/slot references, the replacement selector, atomicity warning, active-Run behavior, and blocking validation or concurrency errors.

### Workspace Settings

The existing template-centric surface is replaced, not duplicated. Sections are:

- **Agents:** one Main card and two-or-more Child cards with structured model and capability selectors;
- **Skills:** Built-in, Project, and Effective views with source, override/addition, disabled, validation, and used-by-Agent state;
- **MCP:** the same views plus transport, permissions, credential-handle state, and health;
- **Dependencies and Conventions:** project knowledge and constraints with revisions;
- **Security and Boundaries:** data class, budget, permission, secret-grant, and telemetry policy;
- **Revision History:** draft and execution revisions, diffs, digests, creators, validation results, and pinned Runs.

Desktop uses section navigation with a summary/diff side panel. Narrow and mobile layouts collapse to a section list, then one section with a sticky validation/action summary. Structured selectors replace comma-separated capability inputs.

### In-context status and recovery

- Model verification status appears on the model row and in any Agent selector that references it.
- Capability validation, disabled state, and source appear on the capability row and affected Agent card, not only in an aggregate dashboard.
- A dirty or invalid draft retains user input and shows exact blocking fields.
- Save conflict retains the local draft and compares it with the newer Workspace head before explicit retry.
- An active Run shows its pinned revision beside the new active revision so the operator can understand why current execution did not change.
- Repeated equivalent validation errors are grouped by typed key and reason; the Revision History remains the deep audit surface.

## Backend and API contracts

Durable records include `GlobalModelProfileRevision`, encrypted `CredentialHandle`, `ProjectCapabilityRevision`, `WorkspaceCapabilityDraftRevision`, `WorkspaceCapabilityHead`, `WorkspaceExecutionProfileRevision`, and `ModelReplacementPlan`.

```http
GET    /v1/global-models
POST   /v1/global-models
GET    /v1/global-models/{modelId}
PUT    /v1/global-models/{modelId}
POST   /v1/global-models/{modelId}/verify
GET    /v1/global-models/{modelId}/usage
POST   /v1/global-models/{modelId}/replacement-plans
POST   /v1/global-models/{modelId}/replacement-plans/{planId}/apply
POST   /v1/global-models/{modelId}/retire

GET    /v1/workspaces/{workspaceId}/project-capabilities
POST   /v1/workspaces/{workspaceId}/project-capabilities
PUT    /v1/workspaces/{workspaceId}/project-capabilities/{kind}/{name}
DELETE /v1/workspaces/{workspaceId}/project-capabilities/{kind}/{name}
GET    /v1/workspaces/{workspaceId}/capabilities/effective

GET    /v1/workspaces/{workspaceId}/capability-draft
PUT    /v1/workspaces/{workspaceId}/capability-draft
POST   /v1/workspaces/{workspaceId}/capability-draft/validate
POST   /v1/workspaces/{workspaceId}/capability-draft/activate
```

All Workspace writes require Workspace scope, authorization, and expected-version CAS. Capability paths carry both `kind` and normalized `name`. Replacement Apply accepts a plan ID and expected plan version, not a client-provided Workspace subset.

## Security boundaries

- Plaintext API tokens and MCP secrets exist only at the secret-ingress boundary and encrypted secret store.
- Forms, ordinary configuration rows, API responses, diffs, prompts, execution profiles, telemetry, diagnostics, and logs expose no plaintext secret.
- CLI execution uses direct process spawning with adapter-generated argv, bounded timeout/output, cancellation, and process-tree cleanup; no shell interpolation is allowed.
- Runtime receives the pinned execution profile, least-privilege run/slot secret grants, and bounded source/tool handles. It receives no mutable global registry handle.
- Cross-Workspace capability lookup, grant use, revision access, and replacement are denied and audited.

## Acceptance criteria

### Model registry

- [ ] API and supported local CLI profiles can be persisted, verified, revised, and explicitly selected by Agent slots.
- [ ] CLI tests cover argument injection, timeout, cancellation, output limits, and process-tree cleanup without invoking a shell.
- [ ] No global active or implicit fallback model can start a Run.
- [ ] Plaintext credentials are absent from configuration, API responses, diffs, logs, prompts, telemetry, and revisions.

### Capability resolution

- [ ] Skill and MCP with the same normalized name coexist and are independently configurable.
- [ ] A project entry completely overrides a built-in entry with the same typed key; removing the override reveals the built-in only when enabled.
- [ ] Built-in entries, project additions, and project overrides can all be disabled and re-enabled.
- [ ] Disabling a project override does not fall back to the built-in entry.
- [ ] Effective counts distinguish project overrides from additions and are returned by the backend resolver.
- [ ] Disabled and ungranted entries are absent from selectors, execution profiles, runtime discovery, and invocation.

### Roster, persistence, and revisions

- [ ] Exactly one Main and at least two enabled, complete Child slots are required to activate a profile; domain, API, and Web negative tests reject fewer than two.
- [ ] Main and every Child can select different verified models, Skills, and MCPs.
- [ ] Invalid drafts are durably saved with field-level validation and survive service restart, browser refresh, and Workspace switching.
- [ ] Activating a valid draft creates a new immutable execution profile without mutating earlier draft or profile revisions.
- [ ] Active and paused Runs remain pinned to their original profile on settings changes and resume; later Runs use the newly active revision.
- [ ] Runtime cannot discover a global or project capability absent from the pinned profile.

### Model replacement and retirement

- [ ] Usage preview lists all current Workspace and Agent-slot references plus active Runs.
- [ ] Replacement has no partial-Workspace mode in either UI or API.
- [ ] Any version conflict or validation failure rolls back every Workspace change.
- [ ] A successful replacement leaves zero current Workspace references to the old model.
- [ ] Ordinary retirement preserves historical revisions and active Runs; emergency credential revocation is separate and discloses affected Runs.

### User experience and isolation

- [ ] Global Model Library and Workspace Settings expose the described empty, loading, invalid, conflict, activated, replacing, and pinned-old-Run states on desktop, keyboard, and narrow layouts.
- [ ] Source, override/addition, disabled state, validation, and used-by-Agent information are visible where the capability is configured.
- [ ] Two Workspaces can use different project capabilities and Agent rosters without data, capability, or credential leakage.
- [ ] Dependency and convention revisions enter planning/input digests.

## Current gap

Implementation commit `1682d7d` provides an encrypted API-oriented model registry with one global active profile, a globally bootstrapped reference Skill, a draft/profile domain skeleton, and a template-centric Web surface. Current resolution uses name-only lookup, the UI stores Skill/MCP names as comma-separated text, Child validation permits one slot, project capability management and Workspace MCP mounts are absent, and current persistence does not prove restart recovery for this complete contract. There is no supported local CLI runtime adapter or all-Workspace model replacement/retirement workflow.

## Dependencies

F006 is a foundation dependency of F001. F001 consumes an activated `WorkspaceExecutionProfileRevision` and its provenance; it does not independently resolve or mutate F006 settings.

## Non-goals

- editable global capability or role templates;
- prescribing a concrete built-in Skill/MCP inventory in this version;
- migrating legacy model profiles;
- arbitrary shell commands or user-authored CLI argv;
- silently scanning or rewriting the user's project repository;
- hot-swapping settings inside an active or paused Run;
- silently falling back to a global or hidden built-in capability;
- treating a successful connection check as model capability calibration.
