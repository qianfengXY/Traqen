# Review Request: F001 Legacy-System Understanding and Traqen System Requirements

Review-Target-ID: refresh-independent-workspace-runs
Branch: codex/refresh-independent-workspace-runs
Review range: 84e94f3..aedffec

Round: 5 — specifies complete raw-source Agent planning, deterministic partition/DAG execution, model/Skill capability routing, and selective multi-model reconciliation after the Round-4 approval.

## What

Reframed F001 from a browser-refresh/durable-scan task into Traqen's P0 legacy-system understanding and canonical graph capability. Added bilingual system requirements and a detailed understanding-engine design covering complete inventory, independent evidence lanes, bounded Agent/Skill analysis, reconciliation, multi-dimensional correctness evaluation, incremental equivalence, and Traqen-on-Traqen acceptance. The durable lifecycle remains a supporting design.

Round 2 adds:

- first-run FULL, later AUTO→INCREMENTAL, immutable GraphRevision, and atomic CurrentGraphHead;
- FeatureVersion/implementation/ChangeSet/Impact/verification history semantics;
- a concrete SourceSlice schema/API/error/policy boundary;
- six lane names aligned across system and engine design;
- Manifest/convention-derived Agent planning with adversarial missed-entrypoint recovery;
- calibration/held-out/challenge blind review and numeric `traqen-self-v1` thresholds;
- Local/Private Runner/Cloud deployment capability modes;
- the complete TDD plan `feature-specs/2026-07-29-legacy-system-understanding-engine.md`;
- English lifecycle safety/failure/denominator parity.

Round 2 follow-up after Kimi's second review adds:

- removal of the eight whitespace violations in the F001 implementation plan;
- one explicit orchestration contract shared by both lifecycle translations:
  `SOURCE_SCAN → FACT_COMMIT → ANALYSIS → RECONCILIATION → EVALUATION → PROJECTION → PUBLISHING`;
- atomic output references for CandidateGraph, EvaluationRun, GraphRevision, and CurrentGraphHead publication;
- English SourceRegistration, AnalysisRun, job-read, and UI rules that match the Chinese contract;
- a repository test that requires both translations to keep the same complete phase set and happy-path edges.

Round 4 adds to both lifecycle translations:

- one authority table separating deterministic observation, semantic inference, reconciliation, human governance, evaluation, and publication;
- one end-to-end Mermaid object-flow diagram and one reconciliation/publication decision diagram;
- a concrete order-service example from ArtifactInventory and Facts through CandidateTestIntent;
- the two-pass Manifest/convention plus Fact-enrichment Agent planner and bounded SourceSlice Broker;
- the six reconciliation gates, including explicit `candidateAbsences.NO_CURRENT_OBSERVATION`;
- fail-closed GraphRevision publication, atomic CurrentGraphHead movement, and FULL→INCREMENTAL evolution;
- an explicit current-implementation boundary so the target design is not misrepresented as shipped behavior.

Round 5 adds:

- the complete immutable SourceSnapshot/ArtifactInventory as the Agent task universe; scanner Facts are parallel optional enrichment, not the plan input boundary;
- one audited base disposition for every Inventory row: direct SourceSlice reading, a declared specialist, or an explicit exclusion/Gap;
- a deterministic `UnderstandingPlan` derived through project boundaries, artifact lanes, locality groups, budget shards, and cross-cutting roots, with stable Partition IDs and `unassignedCount=0`;
- a new Mermaid diagram for the dynamic Leaf→File/Module→Cross-module→Critic→Project CandidateBundle dependency DAG;
- persisted WorkUnit dependencies, inputs, routes, budgets, attempts, checkpoints, and digests, with bounded follow-up and summary-only evidence rejection;
- separation of credential/transport readiness from versioned `ModelCapabilityProfile`, plus persisted `AnalysisRouteDecision`;
- an explicit SOURCE_READER/MODULE_SYNTHESIS/CROSS_MODULE_REASONING/CRITIC routing matrix mapped to the existing Reverse Skill capability vocabulary;
- versioned per-role/language/artifact/risk calibration gates; vendor name and connectivity never prove model fitness, and each new model revision starts unverified;
- Direct-source versus Fact-dependent Skill input contracts, and explicit acknowledgement that current Reverse Skills require both Snapshot and FactBundle;
- raw SourceSlice routing only to `RAW_SOURCE_LOCAL` or `RAW_SOURCE_PRIVATE_RUNNER` producers; `FACTS_ONLY_EXTERNAL` models still receive only policy-filtered Facts;
- partition parallelism by default and selective independent multi-model Producer/Critic execution for high-risk, low-confidence, conflicting, or challenge-sampled scopes;
- evidence reconciliation and ConflictLedger preservation instead of majority voting or correlated-model corroboration inflation;
- F001 AC-B5–B7, J8, KD-8, engine-level acceptance, lifecycle invariants/acceptance, implementation schemas, persistence census, adversarial cases, and Task-6 RED tests for the same contract;
- system requirements SR-021–SR-023 for deterministic complete planning, fail-closed capability routing, and selective evidence-based multi-model execution;
- the operator's detailed Agent-partition/model/large-repository requirement in both discussion documents.

## Round-5 Review Outcome

- **Reviewer:** Kimi 3 / Kimi
- **Reviewed range:** `84e94f3..aedffec`
- **Verdict:** `APPROVE`
- **Independent verification:** backend 232/232; Web production build + 40/40; Web lint; diff check; bilingual contract tests; relative-link audit.
- **Decision:** `aedffec` is the approved F001 design baseline for subsequent implementation.
- **Implementation-detail notes:** Task 6 owns the concrete `ConventionRegistry` and `ExecutionProfile` schemas/fixtures. The unrelated untracked files in the main worktree remain outside this design range and require the co-creator's explicit disposition.

## Second-Review Findings

| Finding | Resolution |
|---|---|
| P1 implementation-plan trailing whitespace | Removed all eight instances. `git diff --check a5f8b08` now exits 0. |
| P2 English lifecycle semantics | The cited root/home rejection, secret-safe logging, scan outcome classes, and pre-seal unknown denominator were already present in English. The remaining real deltas—SourceRegistration local rules, AnalysisRun evidence rules, job-read fields, and UI command rules—are now explicit in English. Line count is not used as a translation gate. |
| P2 lifecycle phase mismatch | Added `RECONCILIATION`, completed both phase-transition tables, added downstream output references, and added a bilingual contract regression test. |
| P2 ownerless main-worktree artifacts | Outside this branch and review range. They remain untouched pending the co-creator's explicit archive/ignore/commit/delete decision; tracked separately rather than smuggled into F001. |

## First-Review Findings Closed

| Finding | Resolution |
|---|---|
| P1 understanding-engine TDD plan missing | Added `feature-specs/2026-07-29-legacy-system-understanding-engine.md` with terminal contracts, lifecycle census, state/event matrices, invariants, adversarial scenarios, exact files, RED/GREEN order, cutover, and two-Snapshot dogfood. |
| P1 Agent redesign not executable | Added Manifest/ConventionRegistry initial planning wave, Fact-enriched second wave, missed-entrypoint SourceSlice fixture, and production Truth Set input prohibition. |
| P1 Truth Set overfit process missing | Added stable stratification, 60/30/10 calibration/held-out/challenge partitions, blind reviewer classifications, author/reviewer separation, rotation, immutable results, and leakage test. |
| P1 dogfood thresholds not decidable | Added `traqen-self-v1` numeric counts/rates, sample size, blocking cases, operator authority, and independent technical approval. |
| P1 SourceSlice contract missing | Added request/response schema, two API routes, service-identity restriction, budgets, policy/digest rules, and deterministic HTTP/error codes. |
| P2 English lifecycle parity | Added scan outcome classes, pre-seal unknown denominator, root/home rejection, `.env`/secret log boundary, ref-safe deletion, and deployment modes. |
| P2 lane mismatch | Engine now names the same six lanes as system requirements. |
| P2 Local Runner deployment unclear | Added `LOCAL_SINGLE_TENANT`, `PRIVATE_RUNNER`, and `CLOUD_CONTROL_PLANE` capability modes and rejection behavior. |

## Why

Durable execution can keep a wrong or noisy analysis running. The operator's core requirement is that Traqen correctly and transparently reconstruct existing systems and connect requirements, design, code, configuration, tests, results, and Evidence for inspection, impact, and quality traceability.

## Original Requirements

> “扫描与分析 Agent 可能需要重新设计……这个需求是我最核心的需求，怎么把存量代码的分析正确。”
>
> “做一个需求、设计、代码、测试用例、测试结果、配置等图谱关联，便于之后做变更影响分析、内容查看、质量追溯等。”
>
> “拿 Traqen 项目做测试验证，通过 Traqen 自己展示自己的功能图谱。”
>
> “第一次分析会得到一个完整的图谱关系……增量分析就应该重新更新图谱……功能点是需要记录变化过程及每次变化会影响哪些功能。”
>
> “Analysis Agent 也是从原工程目录读取所有文件，不是从扫描器的结果去分析。Inventory 分区怎么来，WorkUnit 怎么运行，要考虑用什么模型、什么 Skill；工程很大时怎么一次性分析完，是否用多个模型并行，最后一起对账。”

- Source: `feature-discussions/2026-07-29-F001-legacy-system-understanding/README.md`
- Please judge the design against these outcomes, not only against its stated ACs.

## Tradeoff

- Rejected one model or one scanner as the repository-understanding authority.
- Rejected node count and one confidence score as correctness.
- Kept human Decisions as business authority, which means self-analysis requires a reviewed seed truth set.
- Kept the first connector local and allowlisted; remote Git is an extension, not a different graph model.
- Separated the latest graph projection from immutable history; this avoids forcing every query to replay history while preserving long-term traceability.
- Rejected automatic FeatureVersion creation from code/configuration changes; business-version authority remains governed.
- Rejected one repository-sized prompt and a fixed child-Agent count; scale comes from deterministic bounded hierarchy.
- Rejected scanner Facts as the Agent task universe; raw source is visited independently inside the permitted source boundary.
- Rejected one unverified generic model for every language/role and hidden fallback when no producer is eligible.
- Rejected running every file through every model and rejected majority vote; independent redundancy is selective and evidence-based.

## Architecture Ownership

Architecture cell: legacy-system understanding → canonical traceability graph
Map delta: update required
Why: the change expands the source-understanding boundary, defines independent analysis lanes and reconciliation, and makes evaluation plus self-dogfood release gates part of the system requirements.

Please check:

- whether the diff matches `Map delta`;
- whether any proposed object duplicates an existing Store/Queue/Router/Adapter/Dispatcher/Binding;
- whether the new system requirements conflict with ADR-0001 or the detailed architecture;
- whether lifecycle durability has correctly become supporting infrastructure.

## Open Questions

### Technical OQ

1. Does the complete Snapshot/Inventory plan guarantee direct source visitation or explicit disposition without turning scanner Facts into the task universe?
2. Are the five deterministic partition steps, stable IDs, coverage equation, bounded Range overlap, and `unassignedCount=0` sufficient to make `UnderstandingPlan` reproducible?
3. Can the dynamic WorkUnit DAG handle very large repositories while preserving raw SourceSlice evidence and rejecting summary-only conclusions?
4. Does `ModelCapabilityProfile` correctly separate model fitness/calibration from current `AnalysisModelProfile` credential/transport readiness?
5. Are Direct-source/Fact-dependent Skill contracts, the three data-boundary classes, and `NO_ELIGIBLE_PRODUCER` fail-closed behavior consistent with the existing security boundary?
6. Does selective Producer/Critic redundancy provide useful independent challenge without treating correlated agreement or majority count as truth?
7. Do the proposed `UnderstandingPlan`, `ModelCapabilityProfile`, `AnalysisRouteDecision`, and Capability Router duplicate an existing object or violate ADR-0001 authority boundaries?
8. Are English and Chinese lifecycle, engine, Feature, and discussion documents semantically equivalent?

### Value OQ

No new value choice for reviewer. The operator has specified the latest-graph plus Feature/Impact-history outcome. The Design Gate confirms the documented authority, thresholds, and first connector.

## Next Action

Perform an independent read-only review of `84e94f3..HEAD`, compare both languages with F001, the understanding-engine design, current Analysis Agent/model/Skill contracts, and ADR-0001, then return `APPROVE` or prioritized findings. Do not implement changes.

## Review Sandbox

- Path: `/tmp/cat-cafe-review/refresh-independent-workspace-runs/kimi`
- Start Command: not required for this docs-only review
- Ports: web=N/A, api=N/A
- Bootstrap: `unset NODE_ENV && npm ci`

## Self-check evidence

### Spec compliance

- operator's correctness, graph, impact/content/quality, and Traqen self-analysis requirements map to F001 ACs;
- operator's first-FULL/later-INCREMENTAL, latest graph, Feature history, and per-change impact requirement maps to AC-D4–D8 and AC-F7;
- refresh durability is retained as AC-E infrastructure rather than the Feature goal;
- system requirements and engine design have equivalent English/Chinese section structures;
- docs-only Dogfood-Your-Slice is explicitly exempt; `.pen` glob returned no matching design.

### Tests

```text
node --test test/bilingual-documentation.test.js → 1/1 pass
npm test → 231/231 pass
npm run test:web → production build + 40/40 pass
npm --prefix web run lint → exit 0
git diff --check → exit 0
relative-link audit → 21 changed/new Markdown files, all links resolve
root media artifact audit in the feature worktree → no findings
```

Current Round-2 delta recheck:

```text
node --test test/bilingual-documentation.test.js → 2/2 pass
npm test → 232/232 pass
npm run test:web → production build + 40/40 pass
npm --prefix web run lint → exit 0
git diff --check a5f8b08 → exit 0
relative-link audit → 12 changed Markdown files, all links resolve
root media artifact audit in the feature worktree → no findings
designs/**/*.pen glob → no findings
```

Current Round-4 delta recheck:

```text
node --test test/bilingual-documentation.test.js → 2/2 pass
npm test → 232/232 pass
npm run test:web → production build + 40/40 pass
npm --prefix web run lint → exit 0
git diff --check a5f8b08 → exit 0
logic-token audit → all required scanner/Agent/reconciliation/publication terms present in both languages
Mermaid audit → exactly 2 diagrams in each language
relative-link audit → all links in both lifecycle documents resolve
root media artifact audit in the feature worktree and committed range → no findings
designs/**/*.pen glob → no findings
```

Current Round-5 delta recheck:

```text
node --test test/bilingual-documentation.test.js → 2/2 pass
npm test → 232/232 pass
npm run test:web → production build + 40/40 pass
npm --prefix web run lint → exit 0
git diff --check 84e94f3 → exit 0
contract-token audit → lifecycle, engine, F001, and discussion pairs contain their required planning/routing/reconciliation terms
Mermaid audit → exactly 3 diagrams in each lifecycle language
engine heading parity → 42/42 headings
relative-link audit → all changed Markdown files, 0 unresolved
root media artifact audit in the feature worktree and committed range → no findings
designs/**/*.pen glob → no findings
```

### Dogfood-Your-Slice

Scope verdict: docs-only target design and implementation-plan refinement; no runtime or user-visible implementation changed, so runtime dogfood is exempt. The bilingual phase test and focused contract-token/diagram/link audit exercise the documentation contract.

### Architecture ownership

- Architecture cell: legacy-system understanding → canonical traceability graph
- Map delta: update required
- Updated map truth: bilingual system requirements, F001, engine design, lifecycle design, discussion, and implementation plan
- `Capability Router` and three new contracts are proposed target objects and are explicit review focuses; no runtime Store/Queue/Router was implemented in this docs-only round.

### Relevant documents

- Discussion: `feature-discussions/2026-07-29-F001-legacy-system-understanding/README.md`
- System requirements: `docs/architecture/traqen-system-requirements.md`
- Feature: `docs/features/F001-legacy-system-understanding.md`
- Engine: `docs/features/legacy-system-understanding-engine.md`
- F001 TDD plan: `feature-specs/2026-07-29-legacy-system-understanding-engine.md`
- ADR: `docs/decisions/ADR-0001-canonical-traceability-ontology.md`
