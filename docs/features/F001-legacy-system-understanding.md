> Language: **English** · [简体中文](F001-legacy-system-understanding.zh-CN.md)

---
feature_ids: [F001]
related_features: []
topics:
  - legacy-system-understanding
  - canonical-graph
  - source-inventory
  - analysis-agent
  - correctness-evaluation
  - traceability
  - dogfood
doc_kind: spec
created: 2026-07-29
---

# F001: Legacy-System Understanding and Canonical Graph Construction

> **Status**: spec | **Owner**: CodeX | **Priority**: P0

## Why

Traqen's primary capability is to understand existing code and files correctly enough to build a reviewable graph across requirements, design, code, data, configuration, tests, test results, Evidence, changes, and Decisions.

The previous F001 framing treated browser-independent execution as the goal. That is necessary infrastructure, but it does not answer the core question: **did Traqen reconstruct the important capabilities and relations of a legacy system accurately, with explicit evidence and gaps?**

This Feature therefore owns the entire understanding foundation:

```text
complete immutable source scope
  → deterministic observations
  → independent Agent/Skill analysis
  → evidence-bound Candidate reconciliation
  → correctness evaluation
  → canonical Candidate graph
```

Governed Features and Claims still require human Decisions. Test execution and Evidence remain separate downstream authority.

## Current state

### Capabilities already present

- Snapshot manifests, deterministic Facts, Candidate bundles, evidence-bound validation, and stable lineage;
- JavaScript scanning plus browser-side multilingual heuristics;
- Analysis Agent, Reverse Skill contracts, model adapters, and checkpoints;
- governance, Feature graph, TraceChain, impact, TestSpec, Runner, Evidence, and metrics domains;
- server-owned AnalysisRun after browser-derived observations have been submitted.

### Gaps that block this Feature

- no complete ArtifactInventory denominator for included, unsupported, excluded, failed, generated, binary, or secret-redacted content;
- browser and server scanning have different capabilities and ownership;
- some semantic planning starts from scanner-discovered roots, so a scanner miss can propagate;
- real-repository validation measures volume and noise reduction, not reviewed capability recall, Candidate precision, or relation correctness;
- no versioned truth set with positive and negative graph assertions;
- no full-versus-incremental equivalence gate;
- no required Traqen-on-Traqen product acceptance;
- source scanning still depends on the browser, so a large analysis can be interrupted before canonical Facts exist.

## What

### Phase A: Correctness contract and evaluated truth

Define multi-dimensional correctness, versioned evaluation policy, reviewed truth-set schema, positive/negative relation assertions, explicit Unknown states, and regression thresholds.

### Phase B: Immutable scope and complete inventory

Create authorized source registration, immutable Snapshot capture, complete ArtifactInventory, explicit dispositions, extractor capability registry, and safe source-slice broker.

### Phase C: Independent understanding lanes

Run deterministic extraction, document/contract, test/config/result, and Agent/Skill source analysis as independently observable lanes. Plan from the full source manifest and conventions, not only one scanner's output.

### Phase D: Reconciliation and lineage

Validate evidence bounds, reconcile duplicates and hierarchy, preserve conflicts and alternatives, link Candidates across Snapshots, and produce CandidateGraph, CoverageLedger, and ConflictLedger without creating governed authority.

### Phase E: Durable and incremental execution

Execute scan and Agent WorkUnits under one persistent server-owned job. Force `FULL` for the first Snapshot and default later Snapshots to `INCREMENTAL`; reuse committed work, selectively invalidate changed regions, prove incremental/full equivalence, and atomically update `CurrentGraphHead` only from a complete, evaluation-passing GraphRevision. The default graph shows the latest state while FeatureVersion, Snapshot mapping, ChangeSet, ImpactAssessment, Decision, and Evidence history remain durable.

### Phase F: Traqen analyzes Traqen

Analyze a pinned Traqen Snapshot, compare it with a human-reviewed seed truth set, display Traqen's Candidate and governed seed graph inside Traqen, render a complete TraceChain, and verify one controlled change-impact journey.

## User journey

### Primary journey: understand and inspect a legacy system

- **Scope unit**: one immutable repository Snapshot
- **Actor**: operator
- **Entry**: a Project with an authorized source registration
- **Flow**:
  1. Start one durable understanding job.
  2. Inspect the complete artifact denominator and unsupported/excluded reasons.
  3. Watch independent scan, document, test/config, and Agent/Skill lanes.
  4. Inspect Candidate nodes and relations with source evidence, conflicts, and gaps.
  5. Compare reviewed correctness dimensions rather than a single confidence score.
  6. Use Decisions to establish governed Features, Claims, taxonomy, and TestSpecs.
  7. Browse graph, TraceChain, source content, impact, and quality projections from the same canonical model.
- **Success evidence**: inventory report, evaluation report, graph assertions, replay/incremental reports, durable job trace, and product-visible Traqen self-graph
- **Non-goals**: automatic truth recovery, automatic Candidate approval, arbitrary source execution, or universal language support in the first release

### Supporting journeys

| ID | Journey | Required evidence |
|---|---|---|
| J1 | A parser misses an entrypoint; an independent manifest/source lane still finds and evidences it | adversarial fixture and Candidate provenance |
| J2 | Two Skills disagree about one capability boundary | ConflictLedger and both alternatives |
| J3 | A test file exists but no current execution proves a Claim | separate TestAsset/TestSpec/Execution states |
| J4 | A browser is refreshed or closed during scanning | unchanged job identity and increasing server progress |
| J5 | After the first full analysis, one changed file affects only one graph region | new Snapshot, incremental/full equivalence, atomic CurrentGraphHead update, and impact paths |
| J6 | Traqen analyzes its own pinned repository | reviewed self-graph, gaps, TraceChain, and impact report |
| J7 | Inspect a long-lived Feature | FeatureVersion Decisions, implementation mappings by Snapshot, ChangeSets, impacts, and verification timeline |
| J8 | Analyze a very large mixed-language repository | complete raw-source disposition, deterministic partitions, dynamic DAG progress, model/Skill route decisions, selective independent criticism, and explicit residual gaps |

## Acceptance criteria

### A. Scope and deterministic facts

- [ ] **AC-A1**: every artifact in the pinned Snapshot has an explicit inventory disposition and remains in the coverage denominator.
- [ ] **AC-A2**: every supported extractor declares its exact capability and passes positive, negative, source-span, and diagnostic fixtures.
- [ ] **AC-A3**: Facts are immutable, Snapshot-bound, source-locatable, and reproducible by extractor version.

### B. Independent Agent/Skill understanding

- [ ] **AC-B1**: the initial WorkUnit plan includes manifest/module/entrypoint/document/test/config roots independent of one scanner's discoveries.
- [ ] **AC-B2**: an Agent/Skill can request policy-bounded SourceSlices and recover a reviewed anchor intentionally missed by one extractor.
- [ ] **AC-B3**: every Candidate node and relation cites allowed evidence inside one Snapshot and WorkUnit; invalid IDs and overclaimed confidence are rejected.
- [ ] **AC-B4**: budget exhaustion, unsupported syntax, ambiguity, and model failure produce explicit gaps rather than fabricated completion.
- [ ] **AC-B5**: every ArtifactInventory row is directly read from the immutable Snapshot, handled by a declared specialist, or represented by an explicit Gap; scanner Facts are optional enrichment and never define the Agent task universe.
- [ ] **AC-B6**: the same Snapshot, planner/convention versions, execution policy, and source ranges produce the same complete `UnderstandingPlan` with stable partition IDs and `unassignedCount=0`; its dynamic dependency DAG handles bounded large-file, file, module, cross-module, critic, and synthesis WorkUnits without treating a child summary as sole evidence.
- [ ] **AC-B7**: every WorkUnit has a persisted, version-pinned `AnalysisRouteDecision` selected from verified model capability/calibration profiles and Skill contracts; high-risk redundancy uses independent producer groups and evidence reconciliation, while no eligible producer and unresolved disagreement remain explicit instead of falling back or becoming majority truth.

### C. Reconciliation and governance

- [ ] **AC-C1**: reconciliation identifies duplicates, hierarchy, contradictions, and alternatives while preserving their evidence.
- [ ] **AC-C2**: names, paths, domains, or hashes cannot silently create governed Feature identity.
- [ ] **AC-C3**: only Decisions create or revise FeatureVersions, Claims, taxonomy classifications, and TestSpecs.
- [ ] **AC-C4**: Candidate, governed, test clue, TestSpec, TestExecution, VerificationResult, and Evidence remain distinct in storage, API, and UI.

### D. Correctness and incrementality

- [ ] **AC-D1**: an evaluation report exposes denominators for inventory, anchor recall, Candidate precision, required/forbidden relations, provenance, gaps, replay, and incremental equivalence.
- [ ] **AC-D2**: truth-set data is versioned, reviewed, and excluded from production analysis inputs.
- [ ] **AC-D3**: repeated runs on the same Snapshot and engine produce stable Facts and Candidate lineage.
- [ ] **AC-D4**: a controlled new Snapshot produces an incremental graph equivalent to a full graph for evaluated scopes and preserves unaffected Decisions.
- [ ] **AC-D5**: when no published graph exists, only FULL is allowed; with a `CurrentGraphHead`, AUTO defaults to INCREMENTAL while the operator may force FULL.
- [ ] **AC-D6**: building, failed, or evaluation-rejected runs cannot replace `CurrentGraphHead`; publishing a GraphRevision and moving the head is one atomic transaction.
- [ ] **AC-D7**: every published Snapshot transition produces a `ChangeSet`, `ImpactAssessment`, affected Feature/Claim/TestSpec/dependency set, and revalidation plan.
- [ ] **AC-D8**: default graph views show only the latest published state, while Feature history queries each FeatureVersion's Decision, implementation mapping by Snapshot, change impact, and verification result; code change never auto-revises the business FeatureVersion.

### E. Durable lifecycle and security

- [ ] **AC-E1**: scan and Agent stages run under one persisted job; refreshing, closing, reconnecting, or attaching another browser does not change its state.
- [ ] **AC-E2**: manual Pause/Resume preserves the same Snapshot and skips committed WorkUnits; running work recovers after worker restart while manually paused work remains paused.
- [ ] **AC-E3**: Local Runner allowlists, path/symlink fencing, source-slice policy, secret redaction, and isolated evaluation stores pass security tests.
- [ ] **AC-E4**: the browser contains no authoritative scanning or model loop after cutover.

### F. Traqen-on-Traqen

- [ ] **AC-F1**: a pinned Traqen Snapshot inventories `docs/`, `feature-specs/`, `contracts/`, `src/`, `test/`, `web/`, and safe build/test artifacts with explicit exclusions.
- [ ] **AC-F2**: output is evaluated under `traqen-self-v1` against a blind truth set: 100% inventory disposition; at least 30 positive anchors across 10 capabilities with ≥90% recall; at least 60 required relations at 100%; at least 30 forbidden relations with zero violations; stratified Candidate precision ≥90%; and approval by a non-author.
- [ ] **AC-F3**: Traqen displays its own Candidate graph and visibly distinct governed seed graph, with source content and a gap report.
- [ ] **AC-F4**: at least one Traqen capability has a complete reviewed TraceChain from system requirement/design to code, TestSpec, current execution, VerificationResult, and Evidence.
- [ ] **AC-F5**: one controlled Traqen change produces a reviewed impact path and revalidation plan.
- [ ] **AC-F6**: backend, Web, build, lint, diff, evaluation, browser acceptance, and independent review gates pass.
- [ ] **AC-F7**: the Traqen UI defaults to the second Snapshot's latest graph, can open one Feature's version/implementation/impact/verification history, and proves atomic graph switching from the first FULL run to the second INCREMENTAL run.

## Requirements checklist

| ID | Operator requirement | AC | Verification | Status |
|---|---|---|---|---|
| R1 | “扫描与分析 Agent 可能需要重新设计。” | AC-B1–B7, AC-C1 | complete-source partition/DAG/router adversarial tests + reconciliation | [ ] |
| R2 | “这个需求是我最核心的需求，怎么把存量代码的分析正确。” | AC-A1–A3, AC-B5–B7, AC-D1–D8 | complete-source coverage and versioned truth-set evaluation | [ ] |
| R3 | “做一个需求、设计、代码、测试用例、测试结果、配置等图谱关联。” | AC-C4, AC-F3–F4 | canonical graph assertions and UI | [ ] |
| R4 | “便于之后做变更影响分析、内容查看、质量追溯。” | AC-D4–D8, AC-F4–F5, AC-F7 | content, TraceChain, impact, and history acceptance | [ ] |
| R5 | “拿 Traqen 项目做测试验证，通过 Traqen 自己展示自己的功能图谱。” | AC-F1–F7 | isolated Traqen-on-Traqen acceptance | [ ] |
| R6 | “刷新浏览器，当前运行的任务状态未发生变化。” | AC-E1–E2 | job identity, progress, WorkUnit calls | [ ] |
| R7 | “第一次分析会得到一个完整的图谱关系……增量分析就应该重新更新图谱……功能点是需要记录变化过程及每次变化会影响哪些功能。” | AC-D4–D8, AC-F5, AC-F7 | two-Snapshot FULL→INCREMENTAL acceptance, CurrentGraphHead, and Feature-history query | [ ] |

### Coverage check

- [x] Every stated operator requirement maps to executable ACs.
- [x] Correctness, graph value, and self-dogfood are primary outcomes.
- [x] Refresh durability is retained as infrastructure, not the Feature definition.
- [ ] UI evidence mapping will be completed during implementation acceptance.

## Dependencies

- **System requirements**: `docs/architecture/traqen-system-requirements.md`
- **Ontology authority**: ADR-0001 canonical traceability ontology
- **Existing precursor**: PR #5 server-owned AnalysisRun; it covers only the post-observation Agent stage
- **Supporting designs**: current Agent, Workspace, graph, TestSpec, Runner, Evidence, and durable lifecycle documents
- **Implementation gate**: Design Gate approval before replacing current source-scanning ownership

## Architecture ownership

- **Architecture cell**: legacy-system understanding → canonical traceability graph
- **Map delta**: update required
- **Why**: F001 expands source-understanding ownership, introduces independent evidence lanes and reconciliation, and makes correctness evaluation plus self-dogfood part of the release boundary.

## Risks

| Risk | Mitigation |
|---|---|
| Node count is mistaken for understanding quality | reviewed multi-dimensional evaluation and negative assertions |
| One scanner's blind spot becomes a pipeline blind spot | manifest-derived planning and independent source lanes |
| “Analyze all files” becomes one oversized prompt or a partial scan | deterministic Snapshot partitions, bounded hierarchical DAG execution, and `unassignedCount=0` |
| A generic or miscalibrated model silently handles every language and role | verified ModelCapabilityProfiles, version-pinned Skill contracts, persisted route decisions, and `NO_ELIGIBLE_PRODUCER` |
| Multiple models turn correlated guesses into majority truth | selective independent critics, evidence-based reconciliation, and ConflictLedger preservation |
| Agent prose fabricates relations | structured bundles, bounded source/evidence, deterministic rejection |
| Current code is frozen as business truth | Candidate/Decision/governed separation |
| Unsupported scope is hidden | complete inventory denominator and explicit dispositions |
| Truth set overfits implementation | positive/negative relation assertions, versioning, independent review |
| Incremental mode drifts from full analysis | full-versus-incremental equivalence gate |
| A failed incremental run contaminates the current graph | move CurrentGraphHead atomically only after GraphRevision evaluation passes |
| A code change is mistaken for a new business Feature version | only Decisions create FeatureVersions; implementation mappings and impact history remain separate |
| “Show only the latest graph” is interpreted as deleting history | separate the current projection from immutable Snapshot/version/impact ledgers |
| Self-analysis contaminates production data | isolated worktree, store, ports, and reviewed execution |
| Durability work dominates product correctness again | correctness and dogfood phases are release-blocking |

## Open questions

| # | Question | Recommendation | Status |
|---|---|---|---|
| OQ-1 | Who approves the initial Traqen seed truth set? | operator owns business boundaries; independent reviewer validates technical anchors | Design Gate |
| OQ-2 | What thresholds block release? | numeric `traqen-self-v1` thresholds are defined; later changes require a Decision | Resolved |
| OQ-3 | What is the first source connector? | allowlisted Local Runner, followed by remote Git without changing graph contracts | Design Gate |

## Key decisions

| # | Decision | Reason | Date |
|---|---|---|---|
| KD-1 | F001 is repository-understanding correctness, not a refresh bug. | Durability without semantic correctness does not satisfy the product mission. | 2026-07-29 |
| KD-2 | Correctness is multi-dimensional and evaluated against reviewed truth sets. | Legacy intent cannot be represented by one model confidence value. | 2026-07-29 |
| KD-3 | Analysis lanes are independent and reconcile after evidence production. | One extractor must not define what the system is allowed to discover. | 2026-07-29 |
| KD-4 | Traqen-on-Traqen is a release gate. | The product must demonstrate useful traceability on its own realistic system. | 2026-07-29 |
| KD-5 | `Fxxx` lifecycle IDs remain separate from governed `Feature.id`. | Engineering planning must not create business authority. | 2026-07-29 |
| KD-6 | First analysis is FULL, later analyses default to INCREMENTAL, and the current graph head is separate from historical ledgers. | The system must provide the latest usable graph while explaining how Features evolved and what each change affected. | 2026-07-29 |
| KD-7 | Code/configuration change cannot create a FeatureVersion by itself. | Business-version authority comes from Decisions; implementation evolution belongs to Snapshot mappings, impacts, and verification history. | 2026-07-29 |
| KD-8 | The Agent plans from the complete immutable Snapshot, executes a deterministic dynamic partition DAG through capability-routed models/Skills, and uses selective multi-model evidence reconciliation rather than scanner-only inputs, one whole-repository prompt, or majority voting. | Large repositories need auditable total disposition, bounded contexts, explicit producer fitness, and preserved disagreement without allowing either scanner blind spots or correlated model guesses to define truth. | 2026-07-29 |

## Timeline

| Date | Event |
|---|---|
| 2026-07-29 | F001 initially created around durable scan lifecycle |
| 2026-07-29 | operator correction broadened F001 to legacy-system understanding correctness and Traqen self-dogfood |
| 2026-07-29 | operator established the long-term evolution model: first full, later incremental, latest graph projection plus Feature/Impact history |
| 2026-07-29 | operator established complete raw-source Agent coverage, deterministic partition/DAG execution, explicit model/Skill routing, and selective multi-model reconciliation |

## Review gate

Design Gate must approve:

1. the system mission and canonical graph outcome;
2. the multi-dimensional correctness contract;
3. the reviewed truth-set authority;
4. independent analysis lanes and reconciliation boundary;
5. Traqen-on-Traqen as required acceptance;
6. the Local Runner data boundary for the first connector;
7. FULL→INCREMENTAL behavior, atomic CurrentGraphHead publication, and Feature-history semantics.
8. complete Snapshot-derived Agent planning, capability-routed model/Skill execution, and evidence-based multi-model reconciliation.

Implementation then follows TDD, quality gate, independent review, and merge gate.

## Links

| Type | Path | Purpose |
|---|---|---|
| System requirements | `docs/architecture/traqen-system-requirements.md` | product mission, graph, journeys, system requirements, dogfood contract |
| Core engine design | `docs/features/legacy-system-understanding-engine.md` | inventory, lanes, WorkUnits, reconciliation, evaluation, incremental behavior |
| Understanding-engine plan | `feature-specs/2026-07-29-legacy-system-understanding-engine.md` | TDD order, state machines, contracts, and Traqen dogfood for all F001 ACs |
| Durable lifecycle design | `docs/features/workspace-scan-and-analysis-lifecycle.md` | server ownership, checkpoints, Pause/Resume, worker recovery |
| Archify architecture | `docs/diagrams/f001-legacy-system-understanding/understanding-architecture.html` | complete-source path, security/authority boundaries, reconciliation, and publication |
| Archify Agent workflow | `docs/diagrams/f001-legacy-system-understanding/analysis-agent-workflow.html` | deterministic partitions, WorkUnit DAG, model/Skill routing, Critic, reconciliation, and gaps |
| Current Analysis Agent | `docs/features/analysis-agent-design.md` | implemented Agent contracts and current limitations |
| Current Workspace | `docs/features/workspace-analysis-design.md` | current browser experience and migration baseline |
| Canonical ontology | `docs/decisions/ADR-0001-canonical-traceability-ontology.md` | truth and authority boundaries |
| Existing detailed architecture | `docs/architecture/enterprise-traceable-quality-platform-design-v0.2.en.md` | subsystem-level architecture |
