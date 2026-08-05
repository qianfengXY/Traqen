> Language: **English** · [简体中文](F006-workspace-capability-settings.zh-CN.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [settings, models, skills, mcp, workspace-override, runtime-isolation, frontend, user-journey]
doc_kind: spec
created: 2026-07-31
---

# F006: Workspace Capability Settings

> **Status**: spec | **Owner**: TBD | **Priority**: P0

## Why

Analysis quality changes materially with the selected model, Skill, MCP, dependency knowledge, and project conventions. A global active model and globally mounted tools cannot represent one Workspace's execution policy or protect another Workspace from capability leakage.

## What

F006 defines:

- global templates for model profiles, Main/Child role templates, Skills, and MCPs;
- Workspace imports, same-name overrides, additions, and removals;
- one Main Agent model and one or more Child Agent model slots, default two;
- Workspace dependencies, conventions, and constraints;
- immutable `WorkspaceExecutionProfileRevision` materialized for each run;
- runtime mounts that expose only the resolved Workspace capabilities.

## Resolution rules

1. Global entries are templates, not runtime authority.
2. A Workspace initially imports selected template entries.
3. A Workspace entry with the same stable name replaces the template entry.
4. Explicit removal wins over inheritance.
5. The resolver validates model readiness, capability/data-boundary eligibility, Skill signatures, MCP permissions, secret grants, and cross-entry references.
6. A successful resolution creates an immutable revision with a digest.
7. Main/Child workers receive only that revision and cannot query the global registry.

## User journey

1. Configure reusable global templates.
2. Open one Workspace's settings.
3. Select a Main model and configure one or more Child slots.
4. Import, add, override, or remove Skills/MCPs.
5. Record dependencies, conventions, constraints, budgets, and data-boundary policies.
6. Preview the effective diff and validation failures.
7. Save a new revision; new runs use it while existing runs remain pinned to their previous revision.

## Frontend product experience

### Workspace configuration workspace

F006 distinguishes four layers in the interface: read-only global templates, the Workspace draft, the resolved effective diff, and immutable execution-profile revisions. The page is divided into:

- **Agents and capabilities:** one Main slot and one or more Child slots, model profile, Skills, MCP grants, role policy, and independence group;
- **Dependencies and conventions:** project dependencies, framework/domain conventions, constraints, and their revisions;
- **Security and boundaries:** data boundary, budget, permissions, Secret handles, and telemetry policy;
- **Revision history:** effective diff, digest, creator, validation result, and Runs pinned to each revision.

Global templates appear only as import sources. A Workspace draft explicitly imports, overrides, adds, or removes entries and previews the resulting effective diff before Save. Secret values are never displayed; the UI shows only a scoped handle, grant status, and affected capability.

### Validation, conflict, and run pinning

- **No effective revision / invalid draft:** show blocking Model readiness, Skill signature, MCP permission, Secret grant, data-boundary, and cross-reference errors at their exact fields; new Runs remain disabled.
- **Dirty draft:** show added, changed, removed, inherited, and explicitly removed entries without changing the active effective revision.
- **Save conflict:** preserve the draft and compare it with the newer Workspace configuration version before an explicit retry.
- **Saved:** create and display a new immutable `WorkspaceExecutionProfileRevision`; do not mutate the previous revision.
- **Active Run pinned to an older revision:** identify the pinned revision and state that the new settings apply only to a new Run.

Desktop may use section navigation and an effective-diff side pane. Mobile uses a settings-section list followed by one section and its validation summary; Save always shows the complete effective diff and blocking count first.

### Frontend acceptance

- [ ] Users can distinguish global template, Workspace draft, effective configuration, and immutable revision without inspecting raw configuration JSON.
- [ ] Main and every Child slot expose independent model, Skill, MCP, role, and independence settings; the default of two Children does not imply a fixed maximum.
- [ ] Effective Diff deterministically shows imports, overrides, additions, and removals before Save.
- [ ] Secret values never appear in forms, diffs, prompts, serialized revisions, or diagnostics; only scoped handles and grant status are visible.
- [ ] Invalid drafts, save conflicts, historical revisions, and active Runs pinned to older revisions preserve user input and authority context on desktop, keyboard, and mobile.

## Acceptance criteria

- [ ] A new Workspace defaults to two Child slots but accepts any count greater than or equal to one.
- [ ] Main and each Child slot can select different verified model profiles.
- [ ] Same-name Workspace configuration overrides the global template deterministically.
- [ ] Removed global Skills/MCPs cannot be invoked in that Workspace.
- [ ] Runtime tests prove an Agent cannot discover or invoke a globally installed capability absent from its Workspace revision.
- [ ] Updating global templates does not mutate existing Workspace revisions or active runs.
- [ ] Dependency and convention revisions are included in planning/input digests.
- [ ] Secrets are referenced by scoped handles and never serialized into templates, execution profiles, prompts, or telemetry.
- [ ] Invalid or missing capability references fail resolution before a run starts.

## Current gap

Implementation commit `1682d7d` has an encrypted global model registry with one active profile and globally bootstrapped reference Skills. It has no Main/Child role configuration, Workspace override model, project dependency/convention settings, or Workspace-scoped MCP mount.

## Dependencies

F006 is a foundation dependency of F001. Later modules read the current Workspace revision for provenance but must not independently resolve capabilities.

## Non-goals

- silently falling back to a global capability;
- changing an active run after settings are saved;
- treating a successful model connection check as capability calibration.
