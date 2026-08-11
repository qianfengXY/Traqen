> Language: **English** · [简体中文](README.zh-CN.md)

---
feature_ids: [F001]
related_features: []
topics:
  - operator-experience
  - legacy-system-understanding
  - source-scan
  - analysis-agent
  - canonical-graph
  - dogfood
doc_kind: discussion
created: 2026-07-29
status: converged
---

# F001 Discussion: Legacy-System Understanding Is the Core Requirement

## Operator experience

> “我说的是扫描阶段，扫描文件这一步。另外将扫描文件与分析 Agent 这一步的逻辑单独列为一个需求，作为重点需求推进。”
>
> “这里还不对，我希望是扫描与分析 Agent 可能需要重新设计。不仅是刷新浏览器的问题，这个需求是我最核心的需求，怎么把存量代码的分析正确。”
>
> “通过分析存量代码或文件等，做一个需求、设计、代码、测试用例、测试结果、配置等图谱关联，便于之后做变更影响分析、内容查看、质量追溯等。”
>
> “拿我自己这个 Traqen 项目做测试验证，通过 Traqen 自己展示自己的功能图谱。”
>
> “第一次分析存量系统肯定是全量分析……需求或者代码等被修改以后进行增量分析，就应该重新更新图谱，同时还需要分析出本次变更会对原来的功能产生哪些影响以及每个功能点的历史版本变化。”
>
> “图谱本身只记录最新的，但功能点是需要记录变化过程及每次变化会影响哪些功能。”
>
> “Analysis Agent 也是从原工程目录读取所有文件，不是从扫描器的结果去分析。Inventory 分区怎么来，WorkUnit 怎么运行，要考虑用什么模型、什么 Skill；工程很大时怎么一次性分析完，是否用多个模型并行，最后一起对账。”
>
> “Workspace 空间作为项目整体的空间……如果 Workspace 切换，则其他功能全部跟随一起变化。”
>
> “主 Agent 负责分析任务规划与结果对账……各子 Agent 完成同一批次的任务后，主 Agent 负责将结果与静态扫描文件的进行参考。”

## Misunderstanding corrected

The first F001 draft made browser-independent scanning the Feature goal. The operator clarified that refresh safety is only one execution constraint. The product outcome is correct, evidence-backed reconstruction of a legacy system and useful canonical graph projections.

## Converged direction

1. Keep `F001` as the first repository-local Feature ID.
2. Reframe F001 around legacy-system understanding correctness.
3. Treat deterministic scanning and Agent/Skill analysis as independent evidence lanes that reconcile later.
4. Evaluate inventory, recall, precision, relation correctness, provenance, gaps, replay, and incremental equivalence separately.
5. Preserve Candidate/Decision/governed object and test clue/TestSpec/execution/Evidence boundaries.
6. Make a pinned Traqen-on-Traqen graph, TraceChain, and change-impact journey a release gate.
7. Retain durable server ownership as a supporting F001 design.
8. Force FULL for the first successful run, default later Snapshots to INCREMENTAL, and gate them by full equivalence.
9. Read the latest `CurrentGraphHead` by default while retaining immutable GraphRevision, FeatureVersion, implementation mapping by Snapshot, ChangeSet, ImpactAssessment, Decision, and Evidence history.
10. Never let code/configuration change create a business FeatureVersion automatically; only a Decision revises business definition.
11. Prevent overfitting with numeric `traqen-self-v1` thresholds and calibration/held-out/challenge blind review.
12. Plan Agent work from the complete immutable Snapshot, derive deterministic bounded batches, send the same batch to every configured independent Child slot, and let the Main Agent reconcile all terminal sibling outputs against static Facts without voting.
13. Make Workspace the aggregate root for analysis, traceability, graph, review, impact, and settings; a context-versioned switch must rebind every module and reject late responses from the prior Workspace.
14. Treat global model/Skill/MCP configuration as templates only. Materialize a Workspace-effective revision and prevent runtime access to the global registry.

## Design sources

- `docs/architecture/traqen-system-requirements.md`
- `docs/architecture/traqen-product-architecture.md`
- `docs/features/F001-legacy-system-understanding.md`
- `docs/features/workspace-scan-and-analysis-lifecycle.md`
- `docs/features/F002-feature-api-traceability.md` through `F006-workspace-capability-settings.md`
- `feature-specs/2026-07-31-traqen-product-foundation.md`

## 2026-07-31 GPT/Kimi cross-validation

### Independent views

- GPT produced the Workspace-rooted F001–F006 architecture, same-batch Main/Child contract, Workspace execution-profile isolation, diagrams, implementation audit at `1682d7d`, and documentation reorganization.
- Kimi independently proposed the same six product Features, Workspace-wide switching, raw-source analysis, default two Child Agents, global-template/project-runtime configuration, removal of old documents from active authority, and Excalidraw/Archify visualization.

### Confirmed consensus

1. F001–F006 are the correct product-module boundaries.
2. Workspace switching must change every module.
3. Scanner Facts and Agent source analysis are independent inputs to reconciliation.
4. Child Agents default to two and return evidence-bound results to the Main Agent.
5. Global Skills/MCPs are templates; only Workspace-selected capabilities are available at runtime.
6. Superseded design and validation material must not compete with active Feature truth; the operator's final decision removes it from the working-tree baseline.
7. F002–F005 must use the canonical graph rather than independent stores.

### Differences and resolution

| Topic | Kimi proposal | Converged decision |
|---|---|---|
| Workspace / Project | permanent Workspace → Project 1:1 model | one canonical Workspace aggregate; legacy `Project.id` is migrated or retained only as an alias, per ADR-0002 |
| F001 decomposition | create lifecycle IDs `F001a`–`F001k` | keep one F001 Feature; use Tasks 1–10 in the active implementation plan |
| F006 priority | P2 and implemented after F001 | P0 foundation before capability routing, because F001 runtime isolation depends on it |
| F002–F005 timing | wait until all F001 work completes | start only after each required canonical contract stabilizes; never build temporary truth stores |
| Main planning | Main derives the complete UnderstandingPlan | deterministic planner proves total disposition; Main owns semantic questions, tool/output contracts, follow-ups, and reconciliation |
| implementation Gap | several F001 objects reported absent | audit at `1682d7d` confirms partial ArtifactInventory, UnderstandingPlan, Capability Router, SourceSlice Broker, GraphRevision/CurrentGraphHead, and related APIs/tests; the gap is coherent integration and target behavior |
| proposed Archify JSON | three source candidates | not adopted: current Archify validation reports schema errors; the checked-in projections validate at showcase `9/9`, zero errors/warnings |

### Actions

- encoded canonical Workspace identity and capability isolation in ADR-0002;
- added F001 KD-12/KD-13 for Project migration and plan-task naming;
- retained the contract-gated delivery order in the product architecture and active Codex plan;
- retained Kimi's independently confirmed product boundaries without importing invalid or stale artifacts.

## 2026-08-11 execution-DAG and language convergence

### Operator decisions

> “七阶段需从线性状态机改为执行 DAG，然后中文术语白名单是采用‘尽量中文，仅保留标准缩写、品牌、模型名和 Agent’。”

The operator confirmed both decisions after the initial independent proposals. GPT then read Kimi's full public thread response and routed the remaining differences back to Kimi. Kimi explicitly accepted both execution semantics and supplied failure-mode checks. This section records an actual two-way validation, not parallel-answer inference.

### Resolved design differences

| Topic | Initially competing interpretations | Validated decision |
|---|---|---|
| Seven stages | retain one authoritative phase cursor; or draw parallel lanes over it | seven durable activities form a real execution DAG represented by `phaseStates`, `activePhases`, `laneProgress`, and `joinGates`; one `phase` is not scheduler authority |
| Fork point | wait for whole `SOURCE_SCAN` or final FactBundle | the internal `snapshotInventorySeal` checkpoint seals immutable source and the complete inventory, immediately unlocking `ANALYSIS` while Static extraction continues toward `FACT_COMMIT` |
| Static authority | call deterministic observations and semantic Candidates one pool | preserve `DeterministicObservationPool → StaticCandidateProjection`; the projection matches the Candidate envelope without converting inference into Fact |
| Missing facets | optional fields or `null` | all six facet arrays are required and empty without evidence; a separate coverage state distinguishes found, no evidence, not yet analyzed, unsupported, and failed |
| Real-time reconciliation | merge each arrival; or wait for the whole repository | Main may observe pools in real time, but only a complete `scopePartitionId` barrier commits a working-tree checkpoint; unrelated partitions continue concurrently |
| Cross-partition identity | treat each local checkpoint as final | cross-partition/module/project synthesis consumes lower-level checkpoints, later relation evidence, and the terminal FactBundle through append-only deltas before global evaluation |
| Missing/slow Child | wait indefinitely or ignore the slot | close with an explicit terminal Gap such as `NO_ELIGIBLE_PRODUCER`, timeout, budget Gap, or policy refusal; absence never counts as agreement |
| Interaction history | sample or expire event data to control size | keep append-only structured events durable by default; store large protected bodies content-addressably, record explicit redaction, and never store private reasoning |
| Chinese product terminology | mix familiar English product words ad hoc | use natural Chinese throughout, retaining only controlled standard abbreviations, brands, model names, and `Agent`; English mode is fully English |

### UI authority and failure-mode checks

- An unreconciled pool is a labelled technical observation view, not the working Feature/API tree.
- A committed partition checkpoint is locally valid but provisional for repository-wide identity.
- Cross-file relations discovered later produce append-only reconciliation deltas rather than rewriting old checkpoints.
- Partition granularity follows the deterministic UnderstandingPlan and cannot collapse to line-level checkpoint explosion.
- Global `EVALUATION` waits for the terminal FactBundle and every required partition and synthesis gate.

### Actions

- ADR-0003 records the accepted fork-join DAG and rejected serial alternatives.
- F001 lifecycle, Feature, product architecture, system requirements, and ADR-0001 now distinguish authority order from execution order.
- The product architecture now owns the global bilingual display contract; this discussion does not claim that backend, frontend, or schemas are already implemented.

## Convergence checks

1. Rejected alternatives → ADR? **Yes — Workspace alternatives are in ADR-0002; serial execution, final-Fact blocking, optimistic reconciliation, and collapsed Fact/Candidate authority are in ADR-0003.**
2. Reusable operational lesson → public lessons? **No separate lesson. The new material is a product architecture decision and is retained in ADR-0003 plus F001 acceptance contracts.**
3. New repository-wide operating rule → instruction file? **No. Bilingual display is a Traqen product contract, not a repository contributor rule, and belongs in product architecture and Feature acceptance.**

## Design Gate items

- approve the multi-dimensional correctness contract;
- approve the reviewed, versioned truth-set authority;
- approve Traqen-on-Traqen as required acceptance;
- approve allowlisted Local Runner as the first source connector;
- approve numeric `traqen-self-v1` thresholds and independent blind review;
- approve first-FULL/later-INCREMENTAL behavior, atomic CurrentGraphHead publication, and Feature/Impact history semantics.
- approve complete Snapshot-derived Agent planning, same-batch Child execution, and evidence-based Main reconciliation.
- approve Workspace-rooted module rebinding and Workspace-only runtime capability isolation.
- **accepted 2026-08-11:** replace the linear seven-stage cursor with the fork-join execution DAG and partition/synthesis barriers.
- **accepted 2026-08-11:** use coherent English or Chinese product copy; Chinese retains only controlled standard abbreviations, brands, model names, and `Agent`.
