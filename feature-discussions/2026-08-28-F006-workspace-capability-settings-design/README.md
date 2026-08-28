> Language: **English** · [简体中文](README.zh-CN.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [workspace-settings, global-assets, cli, auth, agents, skills, mcp, frontend, convergence]
doc_kind: feature-discussion
created: 2026-08-28
status: converged
decision_status: operator-authorized
---

# F006 Design Convergence: Workspace Capability Settings

## Decision record

The operator rejected all earlier F006 documents as product input and asked the team to begin from the stated goal: a settings feature with global Accounts, Models, Skills, and MCPs; then Workspace configuration of one Main Agent, one or more Child Agents, and Workspace-specific Skill/MCP management.

Three independent design proposals were compared, followed by explicit challenge rounds and an intent-preservation check. This record preserves the decision process; [the F006 spec](../../docs/features/F006-workspace-capability-settings.md) is the current acceptance contract.

## Confirmed product decisions

| Topic | Final decision | Reason |
|---|---|---|
| Authentication | API Key and OAuth only | CLI is an execution client, not a third auth method. |
| CLI OAuth | CLI-owned login; Traqen detects, reports, and rechecks only | Traqen must not own user OAuth tokens or orchestrate client login. |
| v1 runtime | supported installed CLIs only | Self-designed Agents and direct API execution are future work, not hidden v1 scope. |
| Child Agents | default and minimum: one Child | Meets the “one or more” requirement without fabricating a default analysis policy. |
| Global inactive | unavailable upper bound | A Workspace cannot re-enable an inactive global Skill/MCP. |
| Workspace capability customization | disable inherited asset or add independent local asset | No global manifest replacement, identity fork, or field patch in v1. |
| Global change propagation | catalog availability may update; no automatic grant | New global assets cannot silently widen an Agent's authority. |
| Draft lifecycle | auto-save draft, explicit Apply creates active version | Permits exploration without silently changing the next run. |
| Run lifecycle | active version produces immutable execution snapshot | A running/paused analysis is explainable and cannot hot-swap. |
| Global removal | typed-name confirmation and impact preview | Deletion remains possible without hiding cross-Workspace consequences. |

## Frontend convergence

The final experience has a top-level Settings center with a Global/Workspace scope chooser and a direct settings gear inside a Workspace. Global Settings uses four independent pages: Accounts, Models, Skills, MCP.

Workspace Settings provides a stable readiness summary and two pages:

1. **Agent Settings:** Main and Child team cards with a desktop inspector and small-screen drawer. `Child 1` is present but incomplete until configured.
2. **Capability Management:** available global, Workspace-disabled, Workspace-local, and globally-unavailable groups. It manages Workspace availability only; Agent grants are edited in Agent Settings.

All status is textual and actionable, not color-only. Draft changes auto-save. Applying a version is explicit. Run confirmation occurs on the first start of an active version or after that version changes, not on every unchanged restart.

## Challenge outcomes

Two corrections from independent review are part of the final contract:

1. A globally unavailable capability is not a Workspace-disabled capability; it must be displayed separately as **Globally unavailable / Needs attention**.
2. A new run is blocked only when the active configuration actually grants an unavailable capability. An ungranted catalog item cannot block a run.

The reviewers confirmed that this retained their intent. The operator then explicitly authorized writing the design as formal documentation and splitting it into an implementation plan.

## Scope exclusions

- do not reuse the rejected template/overlay design from earlier F006 records;
- do not make Traqen perform OAuth login;
- do not permit arbitrary shell commands for CLI configuration;
- do not add direct API model execution or a self-designed Agent to v1; and
- do not conflate project availability with Agent authorization.

## Traceability

- Product contract: [F006 specification](../../docs/features/F006-workspace-capability-settings.md)
- Implementation plan: [F006 plan](../../feature-specs/2026-08-28-f006-workspace-capability-settings.md)
- Architecture consequence: [Product Architecture](../../docs/architecture/traqen-product-architecture.md)
- Related consumer: [F001](../../docs/features/F001-legacy-system-understanding.md)
