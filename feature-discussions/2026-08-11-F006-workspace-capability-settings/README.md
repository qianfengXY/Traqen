> Language: **English** · [简体中文](README.zh-CN.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [workspace-settings, global-models, cli-runtime, skills, mcp, capability-overlay, persistence, model-retirement]
doc_kind: discussion
created: 2026-08-11
status: converged
---

# F006 Discussion: Persistent Workspace Capability Settings Without Templates

## Operator experience

> “Traqen项目下F006这块功能方案需要调整。1、模型管理（配置模型的名字、api、token或者走CLI方式，参考catcafe）2、skill管理参考catcafe（区分默认内置skill与项目skill，如果存在相同的skill以项目的skill为准） 3、mcp（区分默认内置mcp与项目mcp，如果存在相同的以项目的为准）。 Workspace与项目对应，要为每个WorkSpace可配置主Agent的能力，至少2个子Agent的能力，这一版先不提供模板吧，但是这些配置需要保存下来，不能下一次对这个WorkSpace操作时又重新配置。本次需要基于原有的方案输出新的方案，前后端都涉及。”

> “一键替换是全部的Workspace都替换，然后禁用mcp、skill。不管是内置还是项目层面，都支持禁用。”

> “对于Workspace的配置，当我skill、mcp、模型第一次配置好，然后启动了分析。接下来我这个Workspace这些配置就不能改了吗？”

The final clarification is that Workspace settings remain editable. An active or paused Run pins its original immutable profile; saving and activating a later revision affects later Runs. Applying new settings to work already in progress requires cancellation and a new Run, never a hot swap.

On 2026-08-11 the operator confirmed the complete proposal and explicitly authorized writing it into the design documents.

## Previous baseline and correction

The previous F006 baseline used one generic model:

```text
global model/role/Skill/MCP templates
        -> Workspace import/override/removal
        -> immutable execution profile
```

That baseline conflicts with the revised requirement in four ways:

1. it presents editable global templates although this version intentionally has no template feature;
2. it treats models, Skills, and MCPs as one capability-entry family although models are reusable connection assets;
3. it allows one Child although the operator requires a hard lower bound of two;
4. it does not define project-capability disable, local CLI execution, durable draft/active revision behavior, or all-Workspace model replacement.

Kimi initially wrote a candidate into the design documents before discussion completed. After the operator corrected the process, those changes were reverted and all subsequent exploration remained read-only until explicit authorization.

## Independent views

### Shared direction

Kimi and CodeX independently converged on:

- no editable global template layer;
- one reusable global model registry;
- read-only built-in Skill/MCP catalogs plus Workspace project entries;
- project same-name entries overriding built-ins;
- one Main and at least two Child Agent slots;
- persisted Workspace configuration and immutable run profiles;
- credential handles instead of plaintext secrets;
- frontend and backend changes as one contract.

### Differences resolved

| Topic | Kimi candidate | CodeX concern | Converged decision |
|---|---|---|---|
| CLI | store command/args | arbitrary shell/argv creates injection and process-control ambiguity | only allowlisted CLI adapters; the adapter generates argv and owns timeout, cancellation, output limits, and process-tree cleanup |
| Disable identity | logical capability name | Skill and MCP may share a name | use `(kind, normalizedName)` |
| Effective catalog | set-union shorthand | project overrides would be double-counted and source behavior was underspecified | typed overlay first, then disabled keys, then Agent grants; backend returns source-aware counts |
| Disabling an override | not specified | falling back to the built-in would silently re-enable a deliberately closed capability | no fallback; the typed key remains disabled until explicit enable |
| Model deletion | replace references, then delete | active Runs already pin immutable model/profile revisions | replace every current Workspace reference atomically, then retire; active Runs keep the old revision unless credentials are explicitly revoked |
| Project capability source | Workspace registry | silent scanning or repository mutation would make configuration authority unstable | persisted Traqen project-capability revisions with explicit import from authorized paths; no silent scan or repository rewrite |

## Converged product contract

### Configuration authorities

```text
Global Model Registry (API / allowlisted local CLI)
                         +
Read-only Built-in Skill/MCP Catalogs (may be empty)
                         +
Workspace Project Capability Registry + disabled typed keys
                         v
Effective Catalog -> Main + Child slots 2..N
                         v
Persisted Draft Revision -> Validate + Activate
                         v
Immutable WorkspaceExecutionProfileRevision -> new Run
```

There is no global active model, role template, implicit import, or runtime global-registry fallback.

### Draft, active profile, and Run lifecycle

```text
Profile R1 active -> Run A pins R1
        |
        +-> operator saves Draft D2 -> Run A still uses R1
        |
        +-> D2 validates and activates as R2
                         |
                         +-> later Run B pins R2
```

Invalid drafts remain durable. A running or paused Run never selects a newer revision on resume. The UI shows both the Run's pinned revision and the Workspace's newer active revision.

### Capability resolution

```text
merged = overlayByTypedKey(builtin, project)
effective = merged - disabledKeys
runtime = effective intersect agentGrants
```

Project override is complete replacement rather than field-level merge. Built-ins, project additions, and project overrides can all be disabled. Disabling an override does not reveal the built-in. Removing an override reveals the built-in only when the typed key is enabled.

### Model replacement and retirement

- The server derives every current Workspace reference to the old model.
- The impact UI is preview-only and has no Workspace checkboxes.
- Apply uses expected versions and one transaction; any conflict or validation failure rolls back all Workspace changes.
- Success requires zero current Workspace configuration references to the old model.
- Historical revisions and active Runs are not rewritten.
- Ordinary deletion is represented by `ACTIVE -> RETIRING -> RETIRED`.
- Immediate credential revocation is a separate destructive action that discloses affected Runs.

## User journeys captured in the Feature spec

1. Configure and verify global API/CLI model profiles.
2. Reopen a Workspace and recover its saved draft and active profile.
3. View built-in, project, and effective Skill/MCP catalogs.
4. Add/import project entries and disable any built-in or project capability.
5. Configure one Main and at least two Child slots.
6. Save an incomplete draft without losing work; validate and activate only when complete.
7. Start a Run pinned to the active revision.
8. Continue editing settings while the Run keeps its old revision; later Runs use the new revision.
9. Replace one referenced global model across every Workspace atomically before retirement.

## Design-in-context record

The current `CapabilitySettings` surface in `web/app/product-surfaces.tsx` shows a four-step Global Templates -> Workspace Draft -> Effective Diff -> Immutable Revision header, one Main form, Child cards, comma-separated Skill/MCP inputs, and a summary sidebar. State wiring in `web/app/traqen-product.tsx` also derives defaults from template entries. Domain validation in `src/domain/workspace-execution-profile.js` currently permits one Child.

- **Change type:** replace the template-centric surface; do not add a parallel settings system.
- **Primary placement:** Global Model Library under Global Settings; Agents/Skills/MCP remain inside the current Workspace settings route because that is where users already configure execution behavior.
- **Alternative considered:** one giant combined settings form. Rejected because global model lifecycle and Workspace-local capability authority become indistinguishable, and replacement impact spans multiple Workspaces.
- **Density:** desktop uses section navigation plus a summary/diff sidebar; narrow layouts show a section list and then one section with a sticky validation/action summary.
- **State coverage:** empty catalogs, dirty/invalid draft, save conflict, activation, replacement conflict, model error, disabled capability, and active Run pinned to an older revision.
- **Visual fit:** preserve the existing Enterprise Blue design system and authority/status language; structured selectors replace comma text inputs without adding a competing visual hierarchy.

## Architecture decision

```text
Architecture cell: Product Architecture section 7, Capability Configuration and Isolation
Map delta: update required
Why: F006 replaces the old global-template boundary with separate global model, built-in catalog, project catalog, draft, and immutable runtime-profile authorities.
```

This is a coordinate change rather than a patch stack: models, capability sources, editable intent, and immutable runtime input each receive one authority. The result removes global-template special cases instead of adding fallback layers.

## In-context observability

```yaml
in_context_observability:
  primary_surface: "model/capability rows and affected Agent cards inside Global Model Library or Workspace Settings"
  why_not_dashboard_only: "readiness, disabled state, validation, or a pinned-old-Run mismatch changes the operator's next action at the configuration site"
  deep_dive_surface: "Revision History and model usage/impact drawer for audit and cross-Workspace diagnosis"
  noise_dedup_policy: "group equivalent errors by typed capability key or model profile plus reason; show one field/card state and an expandable affected-item list"
```

## Rejected alternatives

- editable global model/role/Skill/MCP templates;
- a global active or implicit fallback model;
- arbitrary shell commands or user-authored CLI argv;
- name-only capability identity;
- field-level merge of built-in and project MCP definitions;
- source-bound disable state that changes meaning when an override is removed;
- partial Workspace selection during model replacement;
- rewriting historical revisions or hot-swapping active Runs;
- silent project scanning or repository mutation;
- legacy model-profile migration in this version.

## Priority and scope

F006 remains P0 because F001 capability routing must consume an immutable, Workspace-scoped execution profile. This discussion changes the F006 contract and its F001 integration points; it does not implement backend, frontend, or persistence code.

## Convergence checks

1. Rejected alternatives -> ADR? **Yes.** The durable authority, runtime-isolation, replacement, and retirement decisions are recorded in ADR-0002.
2. Reusable operational lesson -> public lesson? **No.** The premature-write correction is enforced by the repository-local design-write policy and is not product architecture.
3. New repository-wide operating rule -> instruction file? **No.** No additional rule is required.

## Design sources

- `docs/features/F006-workspace-capability-settings.md`
- `docs/features/F006-workspace-capability-settings.zh-CN.md`
- `docs/architecture/traqen-product-architecture.md`
- `docs/decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md`
- `feature-specs/2026-07-31-traqen-product-foundation.md`
- thread `thread_msmv2ouxvf98ljiq`
