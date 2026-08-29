> Language: **English** · [简体中文](F003-traceability-graph.zh-CN.md)

---
feature_ids: [F003]
topics: [agent-analysis, semantic-candidates, human-review, business-function-tree, provenance]
doc_kind: feature-spec
created: 2026-08-29
updated: 2026-08-29
description: Produce traceable semantic candidates and a human-approved business-function tree over deterministic workspace evidence.
description_source: human
description_author: co-creator
description_updated_at: 2026-08-29T03:18:18Z
---

# F003 — Agent Candidates & Reviewed Business Function Tree

**Status:** Spec
**Owner:** TBD
**Depends on:** F001, F002, F006

## Why

Facts and API routes do not by themselves explain what a system does for its users. That interpretation requires a model-assisted investigation across documents, code, tests, configuration, and human domain knowledge. The result is useful only when uncertainty remains visible and a person—not model consensus—has authority to publish it.

## Outcome

F003 runs one or more authorized analysis agents over the F001/F002 evidence boundary and stores their outputs as `Candidate` records. A candidate can propose a business function, an API-to-function association, a design intent, or a missing-evidence hypothesis. Only a human `ReviewDecision` may promote a candidate to a published `Claim` in the business-function tree.

The business tree is a projection of reviewed claims. It is distinct from the deterministic API-structure tree in F002, while both trace back to the same versioned evidence graph.

## Safety and truth boundary

- Agent access is bounded by the F001 source policy and explicit F006 configuration.
- Each candidate records `inferenceProvenance`, `evidenceBoundary`, `confidenceKind`, `uncertaintyNotes`, `reproducibilityToken`, and `reviewState`.
- Agent agreement is corroborating evidence only. It never converts a candidate into a claim.
- Raw prompts, source excerpts, and model output follow the workspace retention and egress policy; the published tree stores traceable evidence references, not an unbounded transcript.
- A rejected, superseded, or stale candidate remains auditable and cannot silently rewrite a reviewed claim.

## Scope

### In scope

- Authorized single-agent and multi-agent analysis runs with run-level provenance.
- Candidate creation from deterministic facts, source-bound evidence, and declared assumptions.
- Human review decisions: approve, reject, request-evidence, supersede, and mark-stale.
- A reviewed business-function tree, including links to related APIs, code, documents, tests, and configuration evidence.
- First-class uncertainty and `CoverageGap` display in review and tree views.

### Out of scope

- Treating a model answer, vote, or confidence score as truth without human review.
- Replacing the deterministic API tree or rewriting F002 facts.
- Automatically blocking a merge or deployment on an inferred impact result (F004 remains advisory initially).

## User journey

1. The architect selects an F001 snapshot and F002 evidence set permitted for analysis.
2. Traqen runs the configured analysis agent or agents and shows bounded, traceable candidates.
3. The architect reviews the evidence, uncertainty, and coverage gaps for each candidate.
4. Approved candidates become reviewed claims and appear in the business-function tree; all other outcomes remain explicit.

## Acceptance criteria

- [ ] Every candidate names its agent/run provenance, source snapshot, evidence boundary, uncertainty, and review state.
- [ ] A candidate cannot appear in the published business-function tree before a human approval decision.
- [ ] Every published business-function node traces to one or more reviewed claims and their evidence links.
- [ ] The UI distinguishes deterministic facts, unreviewed candidates, approved claims, and coverage gaps.
- [ ] A multi-agent run preserves each agent's independent output; agreement is displayed as corroboration, not a truth rule.
- [ ] Rejected, superseded, and stale candidates remain auditable without appearing as current claims.

## Open questions

- Which review roles can approve which claim classes?
- How will the first pilot calibrate `confidenceKind` without disguising uncertainty as a numeric score?
- Which analysis-agent strategies best expose competing interpretations instead of collapsing them early?

## Dependencies and handoff

F003 consumes F001 snapshots, F002 facts/gaps, and F006 agent authorization. Its reviewed claims and tree nodes are inputs to F004 impact analysis, but F004 must retain the originating evidence and uncertainty rather than treating a tree edge as exhaustive proof.

**Next:** F004 combines reviewed meaning, deterministic evidence, and execution results into bounded change-impact and revalidation advice.
