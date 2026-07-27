---
feature_ids:
  - UNNUMBERED-CANONICAL-TRACEABILITY
topics:
  - canonical-graph
  - candidate-bundle
  - evidence-bounds
  - workspace-analysis
doc_kind: implementation-plan
created: 2026-07-25
---

# Canonical Traceability Ontology Implementation Plan

**Feature:** Unnumbered dispatch mission — canonical traceability ontology and browser/server convergence
**Goal:** Make the browser and server exchange one Snapshot-bound `WorkUnit`/`CandidateBundle` contract so every inferred conclusion is evidence-bounded and every local tree or graph is an honest projection of candidate state.
**Acceptance Criteria:** AC-1 canonical entity, relation, identity, authority, and projection semantics are recorded in an ADR; AC-2 browser and server use one runtime contract and one JSON Schema for `WorkUnit` and `CandidateBundle`; AC-3 every candidate conclusion contains non-empty `evidenceFactIds` and deterministic code rejects missing, cross-WorkUnit, cross-Snapshot, duplicate, or unknown evidence; AC-4 local scanning creates immutable Snapshot-specific Fact references while keeping stable observation identity separate; AC-5 browser projections distinguish `CANDIDATE_FEATURE`, `CANDIDATE_CLAIM`, and `TEST_ASSET` from governed `FEATURE`, `CLAIM`, `TEST_SPEC`, and `TEST_EXECUTION`; AC-6 no analysis path creates a governed Feature ID from `businessKey`, domain, scope, taxonomy, source location, or model reconciliation; AC-7 the server Analysis Agent emits canonical CandidateBundles and Candidate-only result projections with no inherited authority or Feature retirement semantics; AC-8 root tests, API tests, Web tests, and the production Web build pass.
**Architecture cell:** none — this repository has no `docs/architecture/ownership/` map
**Map delta:** none
**Map delta why:** This slice establishes a cross-boundary data contract inside the existing analysis ownership boundary; it does not add a runtime or deployment owner.
**Architecture:** A browser-safe shared module normalizes `WorkUnit` and `CandidateBundle` values and performs fail-closed evidence validation. The browser derives Snapshot-specific Fact IDs from a deterministic local scan manifest, sends a complete bounded bundle, and renders candidates as candidates; the server validates the same envelope before and after model execution.
**Tech Stack:** JavaScript ESM, TypeScript, JSON Schema, Node test runner, Vinext/Vite
**前端验证:** Yes — Web build and browser-side model/local-analysis tests are mandatory.

---

## Finish Line

Traqen can demonstrate one complete local analysis unit whose Facts are bound to one Snapshot, whose candidate conclusions cannot cite evidence outside that unit, and whose UI never presents inference or test clues as governed truth.

Not in this slice:

- migrating every existing governance, reverse-run, execution, and metrics table to a new physical graph store;
- creating the human identity-resolution UI that accepts a Candidate into an existing Feature or creates a new opaque Feature ID;
- replacing browser scanning with a signed native local Runtime;
- introducing more LLM roles.

Those are downstream consumers of this terminal contract. Nothing in this slice is throwaway scaffolding.

## Terminal Schema

```text
SnapshotManifest
  └─ CONTAINS → ArtifactVersion
       └─ OBSERVED_AS → Fact

AnalysisRun
  └─ HAS_WORK_UNIT → WorkUnit
       └─ PRODUCES → CandidateFeature / CandidateClaim
            └─ SUPPORTED_BY → Fact

Decision
  ├─ ACCEPTS / REJECTS → CandidateFeature / CandidateClaim
  └─ CREATES → FeatureVersion / Claim / TestSpec
```

`Feature.id` is an opaque identifier created by governance and never recomputed. `businessKey`, domain, scope, source location, and taxonomy are matching inputs or versioned attributes, not identity.

## Stateful Object Census

| Object | Lifecycle owner | Persisted in this slice | Derived-only |
|---|---|---:|---:|
| SnapshotManifest | deterministic scanner/checkpoint writer | yes, inside local analysis checkpoint | no |
| Fact | deterministic scanner | yes, as compact Fact refs | no |
| WorkUnit | analysis orchestrator | yes, inside model request/checkpoint | no |
| CandidateBundle | deterministic validator after producer output | yes, inside response/checkpoint | no |
| Candidate review disposition | governance service | no | no |
| Feature / FeatureVersion | governance Decision materializer | existing server path only | no |
| Taxonomy projection | projection builder | no | yes |

### State × Event Transitions

| Object | State | Event | Next state | Enforced by |
|---|---|---|---|---|
| SnapshotManifest | BUILDING | all selected records fingerprinted | SEALED | local deterministic scanner |
| SnapshotManifest | SEALED | record content changes | new SnapshotManifest | immutable identity; never mutate old snapshot |
| WorkUnit | PLANNED | CandidateBundle validated | COMPLETED | shared validator |
| WorkUnit | PLANNED | missing/foreign evidence | REJECTED | shared validator |
| Candidate | PENDING_REVIEW | governance accepts identity/claim | ACCEPTED | existing governance service, outside this slice |
| Candidate | PENDING_REVIEW | governance rejects | REJECTED | existing governance service, outside this slice |
| Candidate | REJECTED | rescan/retry | unchanged; a new Candidate may be produced | rejected Candidate is immutable history |
| FeatureVersion | CURRENT | implementation disappears | NO_CURRENT_IMPLEMENTATION event | existing governed lifecycle, not Candidate rejection |

Generic restore/delete/list APIs may restore or remove local cache/checkpoint records only. They must not promote a Candidate, allocate a Feature identity, or rewrite a sealed Snapshot.

### Invariants

- **INV-1:** Every Fact reference belongs to exactly one `projectId` and `snapshotManifestId`.
- **INV-2:** Every `WorkUnit.factIds` entry is unique and non-empty.
- **INV-3:** Every Candidate has at least one unique `evidenceFactId`.
- **INV-4:** Every Candidate evidence ID is a member of its producing WorkUnit.
- **INV-5:** CandidateBundle project, Snapshot, run, and WorkUnit identities match the supplied WorkUnit.
- **INV-6:** A model may lower confidence but cannot exceed deterministic evidence caps.
- **INV-7:** Candidate IDs identify observations/inferences; they are never governed Feature IDs.
- **INV-8:** `businessKey`, domain, scope, source location, and taxonomy never produce `Feature.id`.
- **INV-9:** test-file observations project as `TEST_ASSET`; absent execution projects as a TraceGap, never a fabricated `TestExecution`.
- **INV-10:** taxonomy nodes classify candidates or FeatureVersions but do not own their identity.

### Adversarial Matrix

| Scenario | Expected test |
|---|---|
| model cites a Fact from another WorkUnit | deterministic rejection naming the escaped Fact |
| model omits `evidenceFactIds` | deterministic rejection before persistence |
| request mixes Snapshot IDs | deterministic rejection before model invocation |
| duplicate evidence attempts to inflate support | deterministic rejection |
| browser resumes a checkpoint after files changed | creates a new Snapshot ID and re-plans affected units |
| business key/domain/taxonomy changes | Candidate proposal changes; no governed Feature ID is allocated |
| test clue exists but no trusted run exists | graph contains `TEST_ASSET` plus execution gap and no `TEST_SPEC`/`TEST_EXECUTION` |
| model output raises confidence beyond cap | deterministic rejection |

## Task 1: Canonical Ontology Decision

**Files:**

- Create: `docs/decisions/ADR-0001-canonical-traceability-ontology.md`

1. Record authority, identity, graph, relation direction, and projection rules.
2. Record Candidate rejection versus Feature retirement.
3. Record Evidence → VerificationResult → Claim semantics.
4. Record browser IndexedDB as cache/checkpoint only.

## Task 2: Shared Candidate Contract

**Files:**

- Create: `contracts/candidate-bundle.schema.json`
- Create: `src/shared/candidate-bundle.js`
- Create: `test/candidate-bundle.test.js`
- Modify: `test/contracts.test.js`

1. Write failing tests for INV-1 through INV-6 and duplicate/escaped evidence.
2. Run `node --test test/candidate-bundle.test.js test/contracts.test.js`.
3. Implement `normalizeWorkUnit`, `normalizeCandidateBundle`, and deterministic evidence-bound checks.
4. Re-run the focused tests and commit the contract.

## Task 3: Server Workspace Enrichment Boundary

**Files:**

- Modify: `src/analysis/model-adapters.js`
- Modify: `src/application/traceability-application.js`
- Modify: `contracts/openapi.json`
- Modify: `test/analysis-model-adapters.test.js`
- Modify: `test/api-http.test.js`

1. Write failing tests proving the model is not called for a malformed or cross-unit CandidateBundle.
2. Require `evidenceFactIds` in every model conclusion and reject omissions/escapes.
3. Return a normalized CandidateBundle instead of an unscoped list.
4. Verify focused model and HTTP tests.

## Task 4: Browser Snapshot Facts and WorkUnits

**Files:**

- Modify: `web/app/local-workspace-analysis.ts`
- Modify: `web/app/analysis-model-client.ts`
- Modify: `web/app/traqen-product.tsx`
- Modify: `web/tests/local-workspace-analysis.test.mjs`
- Modify: `web/tests/analysis-model-client.test.mjs`

1. Write failing tests for deterministic Snapshot IDs, Snapshot-specific Fact IDs, non-empty Candidate evidence, and resume changes.
2. Replace misleading `stableId` naming with explicit Candidate/Fact identity helpers.
3. Build one WorkUnit and CandidateBundle per bounded model batch.
4. Validate returned bundles with the shared module before reconciliation/checkpointing.
5. Verify browser tests and build.

## Task 5: Honest Read-only Projections

**Files:**

- Modify: `web/app/local-workspace-analysis.ts`
- Modify: `web/app/traqen-product.tsx`
- Modify: `web/tests/local-workspace-analysis.test.mjs`
- Modify: `web/tests/rendered-html.test.mjs`

1. Write failing assertions for Candidate node kinds and test-clue semantics.
2. Project business/API classifications as versioned read-only taxonomy groupings.
3. Render `CANDIDATE_FEATURE`, `CANDIDATE_CLAIM`, `TEST_ASSET`, and TraceGap nodes.
4. Remove fabricated local `TEST_EXECUTION` nodes.

## Task 6: Remove Feature Authority from Analysis Results

**Files:**

- Modify: `src/analysis/analysis-agent.js`
- Modify: `src/analysis/model-adapters.js`
- Modify: `src/analysis/skill-adapters.js`
- Modify: `src/application/traceability-application.js`
- Modify: `src/api/http-server.js`
- Modify: `contracts/analysis-agent.schema.json`
- Modify: `contracts/openapi.json`
- Modify: `test/analysis-agent.test.js`
- Modify: `test/api-http.test.js`

1. Embed the canonical WorkUnit in each server analysis work unit and store a validated CandidateBundle as its output.
2. Reject model or Skill confidence above the deterministic evidence cap.
3. Replace analyzed `features` and `retiredFeatures` with `candidates` and `candidateAbsences`.
4. Make reconciliation an explicit non-authoritative suggestion with `identityDecision: NOT_MADE`.
5. Remove the Feature analysis-history route and expose Candidate suggestion history under an Analysis Candidate route.

## Task 7: Verification and Review

1. Run `npm test`.
2. Run `npm run test:web`.
3. Run `npm --prefix web run lint`.
4. Inspect `git diff --check` and the exact changed-file set.
5. Run the repository quality gate.
6. Request cross-individual review from Kimi with What / Why / Tradeoff / Open Questions / Next Action.
