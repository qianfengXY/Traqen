> Language: **English** · [简体中文](traqen-system-requirements.zh-CN.md)

---
feature_ids: [F001]
related_features: []
topics:
  - product-requirements
  - legacy-system-understanding
  - canonical-graph
  - traceability
  - impact-analysis
  - quality
  - dogfood
doc_kind: system-requirements
created: 2026-07-29
status: proposed
priority: P0
---

# Traqen System Requirements: Legacy-System Understanding and Canonical Quality Traceability

## 1. Product mission

Traqen is a versioned traceability knowledge system that reconstructs reviewable engineering knowledge from existing code and files, connects requirements, design, code, tests, test results, configuration, runtime context, and decisions in one canonical graph, and uses that graph for content inspection, change-impact analysis, and quality traceability.

The primary problem is not generating a plausible feature list. It is making a legacy system explainable without confusing observed implementation, inferred intent, approved business truth, and verified runtime behavior.

The system must answer, with navigable evidence:

1. What capabilities and rules appear to exist?
2. Which documents, code symbols, endpoints, data objects, and configuration implement them?
3. Which TestSpecs are intended to verify each Claim?
4. Which exact executions and results provide current Evidence?
5. What is known, inferred, approved, contradicted, missing, or stale?
6. What may be affected by a proposed change, and what must be re-reviewed or re-executed?

## 2. Operator outcome

For any important capability, an operator can open one graph-backed view and follow this chain:

```text
Source Snapshot
  → deterministic Facts
  → evidence-bound Candidates
  → human Decisions and governed objects
  → TestSpecs and TestExecutions
  → VerificationResults and Evidence
  → TraceChain / Impact / Metrics projections
```

Every visible conclusion links to its source, scope, version, producer, and trust state. Missing links remain explicit gaps; they are never filled with model prose.

## 3. Product guardrails

Traqen is not:

- a documentation generator that treats generated text as truth;
- a code search or visualization tool that equates syntax with business intent;
- an LLM that silently turns current implementation into approved requirements;
- a test generator that treats a test file, a model judgment, or a green command as the same evidence;
- a collection of independent Feature trees, API trees, dashboards, and metrics with separate truth;
- a promise to recover the one historically correct requirement from incomplete legacy artifacts.

Traqen must preserve these distinctions:

| Layer | Meaning | Authority |
|---|---|---|
| `Fact` | deterministic observation from one immutable Snapshot | extractor and source evidence |
| `Candidate` | evidence-bound inference proposed by an Agent or Skill | never business authority |
| `Decision` | explicit human acceptance, rejection, split, merge, or correction | business/governance authority |
| `FeatureVersion` / `Claim` / `TestSpec` | governed normative objects | authorized by Decision |
| `TestExecution` / `VerificationResult` / `Evidence` | what actually ran and what it showed | execution and assertion evidence |
| Projection | bounded view of the canonical graph | read-only; no independent truth |

## 4. Scope of source understanding

### 4.1 Required input classes

Traqen shall support a versioned inventory of:

- requirement, product, ADR, feature, API, schema, operating, and runbook documents;
- source code, generated code markers, build descriptors, manifests, and lockfiles;
- routes, RPC registrations, public APIs, commands, jobs, and event consumers;
- database schema, migrations, queries, data models, and external dependencies;
- configuration definitions and safe configuration presence, without ingesting secret values;
- test assets, fixtures, assertions, coverage metadata, and test plans;
- CI/build/test reports, logs, artifacts, deployment manifests, and runtime observations;
- repository history and diffs when available.

Unsupported, excluded, unreadable, generated, oversized, binary, secret-bearing, and failed artifacts remain in the inventory with an explicit reason. They must not disappear from the denominator.

### 4.2 Immutable analysis scope

Every analysis binds to a `Project`, `SourceRegistration`, and immutable `SnapshotManifest`. The manifest records the complete inventory, included content identities, exclusions, extractor versions, and environment-safe metadata.

Source changes create a new Snapshot. They never mutate the meaning of a completed run.

## 5. What “correct understanding” means

No single confidence score is sufficient. Traqen evaluates repository understanding on independent dimensions:

| Dimension | Required question | Minimum evidence |
|---|---|---|
| Inventory completeness | Did Traqen account for every artifact in scope? | manifest denominator and explicit disposition |
| Extraction validity | Do Facts match the source locations and parser semantics? | deterministic fixture and source-span assertions |
| Provenance fidelity | Can every Candidate relation be traced to allowed Facts? | `evidenceFactIds`, producer, Snapshot, source locations |
| Anchor recall | Did the engine recover the human-reviewed capabilities and relations it was expected to find? | reviewed truth-set positive assertions |
| Candidate precision | How many proposed capabilities/relations are unsupported, duplicates, or path-label noise? | reviewed candidate sample and negative assertions |
| Relation correctness | Are design, implementation, configuration, test, and dependency edges typed correctly? | reviewed edge assertions and contradiction cases |
| Uncertainty honesty | Are unsupported languages, missing evidence, conflicts, and ambiguity visible? | gap ledger; no silent success |
| Reproducibility | Does the same Snapshot and engine version produce the same deterministic Facts and stable Candidate lineage? | digest and replay tests |
| Incremental consistency | Does a new Snapshot reuse unchanged work and invalidate only affected derived knowledge? | full-versus-incremental graph equivalence |
| Governance integrity | Can inference bypass human authority or mutate governed identity? | deterministic authorization tests |
| Verification integrity | Are test clues, TestSpecs, executions, results, and Evidence kept distinct and version-bound? | execution lineage and anti-conflation tests |

Correctness is reported per dimension and per reviewed scope. “Unknown” is a valid result. An unexplained green aggregate is not.

## 6. Canonical graph

### 6.1 Core model

```text
Project
  └─ HAS_SNAPSHOT → SnapshotManifest
       └─ CONTAINS → ArtifactVersion
            └─ OBSERVED_AS → Fact

AnalysisRun
  └─ HAS_WORK_UNIT → WorkUnit
       └─ PRODUCES → CandidateFeature / CandidateClaim / CandidateRelation
            └─ SUPPORTED_BY → Fact

Decision
  ├─ ACCEPTS / REJECTS / SPLITS / MERGES → Candidate
  └─ CREATES / REVISES → FeatureVersion / Claim / TestSpec

Feature
  └─ HAS_VERSION → FeatureVersion
       ├─ HAS_CLAIM → Claim
       ├─ DESIGNED_BY → DesignElement
       ├─ IMPLEMENTED_BY → CodeSymbolFact
       ├─ EXPOSED_BY → EndpointFact
       ├─ READS / WRITES → DataObjectFact
       ├─ CONTROLLED_BY → ConfigurationFact
       └─ VERIFIED_BY → TestSpec
            └─ EXECUTED_AS → TestExecution
                 └─ HAS_RESULT → VerificationResult
                      └─ SUPPORTED_BY → Evidence
```

Taxonomy is an independent, versioned classification projection:

```text
TaxonomyVersion → TaxonomyNode → CLASSIFIES → FeatureVersion
```

Moving a Feature between domains or changing source paths must not change its opaque stable identity.

### 6.2 Required projections

All projections are generated from the same graph and expose their filters:

- Candidate discovery view;
- governed Feature view;
- combined graph with visibly distinct node states;
- Feature tree and API tree;
- TraceChain and source-content view;
- implementation dependency and data-flow views;
- TestSpec, execution, result, and Evidence views;
- change-impact and revalidation plan;
- completeness, gap, trust, and operational metrics.

## 7. Understanding pipeline

### 7.1 Independent evidence lanes

The engine runs multiple independently observable lanes:

1. **Inventory lane** — accounts for the whole Snapshot and assigns artifact kinds.
2. **Deterministic extraction lane** — parses supported artifacts into Facts and typed relations.
3. **Document and contract lane** — extracts requirement/design/API/schema candidates without treating prose as approved truth.
4. **Test, configuration, and execution lane** — distinguishes static clues from governed TestSpecs and real execution evidence.
5. **Agent/Skill lane** — examines bounded source slices and Facts, proposes business semantics, and cites only WorkUnit evidence.
6. **Reconciliation lane** — deduplicates Candidates, records conflicts, preserves alternatives, and computes lineage.

Failure or blindness in one lane must not prevent another lane from examining the source. In particular, Agent planning cannot be limited to only the nodes already discovered by one scanner.

### 7.2 Reconciliation before governance

Reconciliation may propose equivalence, hierarchy, split, merge, or contradiction. Deterministic validators enforce schema, Snapshot binding, evidence bounds, confidence caps, and stable lineage. Neither the model nor reconciliation may create a governed Feature or Claim.

### 7.3 Durable execution

Source capture, scanning, and Agent analysis are server/runner-owned persistent jobs. Browser refresh, closure, reconnect, or multiple tabs do not change authoritative state. Pause, Resume, and Cancel are explicit commands. Resume reuses committed units for the same Snapshot.

Durability is necessary for correct large-repository analysis, but it is not a substitute for correctness evaluation.

## 8. Core system requirements

| ID | Requirement |
|---|---|
| SR-001 | Register authorized sources and seal immutable, content-addressed Snapshots with a complete artifact inventory. |
| SR-002 | Keep included, excluded, unsupported, failed, and secret-redacted artifacts visible in a coverage ledger. |
| SR-003 | Produce versioned deterministic Facts with exact source locations and typed relations for supported formats. |
| SR-004 | Let independent Agents/Skills inspect bounded source slices even when deterministic extraction missed a semantic root. |
| SR-005 | Require every model conclusion and Candidate relation to cite evidence inside its WorkUnit and Snapshot. |
| SR-006 | Reconcile duplicates, conflicts, hierarchy, and lineage without hiding alternatives or creating authority. |
| SR-007 | Require explicit Decisions to create or revise governed Features, Claims, taxonomy classifications, and TestSpecs. |
| SR-008 | Link requirements, design, code, data, configuration, tests, results, Evidence, changes, and decisions in one canonical graph. |
| SR-009 | Keep TestAsset clues, TestSpecs, TestExecutions, VerificationResults, and Evidence distinct. |
| SR-010 | Generate TraceChain, content, Feature/API tree, impact, coverage, gap, and metric projections from the canonical graph. |
| SR-011 | Compare Snapshots, identify affected graph regions, invalidate derived knowledge selectively, and produce a revalidation plan. |
| SR-012 | Persist job state and committed WorkUnits independently of browser lifecycle; only explicit user commands pause or resume. |
| SR-013 | Report correctness by reviewed dimensions, with positive/negative assertions and explicit unknowns. |
| SR-014 | Protect source, paths, credentials, secrets, model inputs, logs, and evidence according to deployment data boundaries. |
| SR-015 | Dogfood Traqen against a pinned Snapshot of Traqen and display Traqen's own reviewed capability graph. |

## 9. Primary user journeys

### 9.1 Understand an existing repository

1. The operator registers a source and starts an analysis.
2. Traqen shows inventory coverage, supported/unsupported areas, and durable phase progress.
3. Deterministic Facts and independent Candidates become inspectable with source links.
4. Conflicts, suspected duplicates, missing relations, and low-evidence areas remain visible.
5. The operator reviews Candidates and creates governed Features/Claims only through Decisions.

### 9.2 Inspect a capability

The operator opens a Feature or Candidate and sees requirement/design text, implementation symbols, endpoint/data/config relations, test assets, governed TestSpecs, latest executions, results, and gaps without leaving the graph context.

### 9.3 Assess a change

The operator selects a commit, diff, artifact, configuration, or Feature. Traqen identifies potentially affected Claims, Features, tests, data, and external dependencies, explains every path, and produces a re-review/re-execution plan.

### 9.4 Trace quality

The operator distinguishes:

- no test clue discovered;
- a test asset exists but is not a governed TestSpec;
- a TestSpec exists but has not run for the current Snapshot/runtime;
- execution failed, passed, or was inconclusive;
- Evidence is missing, stale, invalid, or complete.

## 10. Traqen-on-Traqen acceptance contract

Traqen's own repository is the required realistic dogfood dataset. A small fixture remains useful for deterministic edge cases, but cannot replace this acceptance.

### 10.1 Pinned input

- analyze one explicit Traqen commit as an immutable Snapshot;
- include `docs/`, `feature-specs/`, `contracts/`, `src/`, `test/`, `web/`, configuration/manifests, and safe build/test reports;
- inventory every repository artifact and explain every exclusion;
- do not execute unreviewed repository code during static understanding.

### 10.2 Human-reviewed seed truth set

The initial truth set contains positive and negative assertions, source anchors, relation expectations, and allowed uncertainty for at least:

| Reviewed capability | Representative anchors |
|---|---|
| Project and Snapshot foundation | `src/domain/project.js`, `src/domain/snapshot-manifest.js` |
| Deterministic Facts and source observations | `src/domain/facts.js`, `src/domain/workspace-observations.js`, `src/scanner/` |
| Analysis Agent and Candidate evidence boundary | `src/analysis/analysis-agent.js`, `src/shared/candidate-bundle.js` |
| Reverse Skill orchestration | `src/domain/reverse-skill.js`, `src/skills/reverse-orchestrator.js` |
| Governance and Decisions | `src/domain/governance.js`, `src/domain/decision-governance.js`, `src/domain/review.js` |
| Feature graph and TraceChain | `src/domain/feature-graph.js`, `src/domain/trace-chain.js` |
| TestSpec, Runner, result, and Evidence | `src/domain/test-spec*.js`, `src/runner/`, `src/domain/execution-evidence.js` |
| Change impact and continuous protection | `src/domain/change-impact.js`, `src/domain/invalidation.js`, `src/domain/continuous-protection.js` |
| Product and platform metrics | `src/domain/product-metrics.js`, `src/domain/platform-operations-metrics.js` |

The truth set is reviewed data, not hard-coded scanner output. It shall evolve by Decision and retain versions.

### 10.3 Required dogfood evidence

- manifest coverage report with unsupported and excluded artifacts;
- deterministic Fact replay digest;
- Candidate precision sample and reviewed-anchor recall report;
- required and forbidden relation assertions;
- conflict and gap ledger;
- full-versus-incremental equivalence report for an unchanged region;
- generated Traqen Candidate graph and governed seed graph in the product UI;
- a TraceChain from a reviewed Traqen capability through design, code, TestSpec, current test execution, result, and Evidence;
- a controlled Traqen change whose predicted impact and required revalidation are compared with reviewed expectations.

No release may claim “Traqen understands Traqen” solely because a scan completed or produced many nodes.

## 11. Security and trust requirements

- Source access is explicitly authorized, least-privilege, and auditable.
- Paths returned to ordinary clients are workspace-relative or opaque.
- Real secret values are never persisted as Facts or sent to external models.
- External model inputs are bounded, recorded by digest and policy, and redact prohibited content.
- Execution Evidence records the exact Snapshot, build, dependency, configuration, runtime, Runner, assertions, and attempts.
- Read APIs enforce project boundaries and preserve Candidate/governed distinctions.
- Every graph mutation records actor, reason, prior state, and Decision or execution provenance.

## 12. Release gates

A system release that changes understanding or traceability behavior must pass:

1. schema and ontology compatibility;
2. deterministic extractor fixtures;
3. WorkUnit evidence-bound validation;
4. reviewed truth-set precision/recall/relationship evaluation;
5. full-versus-incremental consistency;
6. persistence and restart tests;
7. security and secret-boundary tests;
8. Traqen-on-Traqen graph and TraceChain acceptance;
9. backend, Web, build, lint, and diff checks;
10. independent review.

Thresholds are versioned in the evaluation policy. A threshold change is a governed decision, not a test edit hidden inside an implementation pull request.

## 13. Delivery sequence

1. **F001 — Legacy-system understanding and canonical graph construction**: correctness contract, inventory, independent analysis lanes, reconciliation, durable orchestration, and Traqen self-analysis.
2. **Governed baseline**: operator Decisions turn reviewed Candidates into stable FeatureVersions, Claims, taxonomy, and TestSpecs.
3. **Execution verification**: controlled Runners produce version-bound VerificationResults and Evidence.
4. **Continuous protection**: Snapshot diffs drive impact analysis, invalidation, and revalidation.
5. **Enterprise scale**: connectors, policy, distributed workers, observability, and retention without weakening the truth model.

## 14. Existing design relationship

This document is the system requirements source. It does not replace:

- `enterprise-traceable-quality-platform-design-v0.2.en.md`, which provides the detailed architecture;
- ADR-0001, which governs the canonical ontology and authority boundaries;
- F001, which delivers the first critical understanding engine;
- lifecycle, Agent, graph, TestSpec, Runner, and Evidence designs, which specify individual subsystems.

When those documents conflict with this product mission, the conflict must be resolved explicitly rather than implemented silently.

## 15. Acceptance status

This specification is **proposed**. Design Gate approval establishes the mission, correctness contract, F001 priority, and Traqen-on-Traqen release gate. It does not claim the current implementation already satisfies them.
