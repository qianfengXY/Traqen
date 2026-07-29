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

## Design sources

- `docs/architecture/traqen-system-requirements.md`
- `docs/features/F001-legacy-system-understanding.md`
- `docs/features/legacy-system-understanding-engine.md`
- `docs/features/workspace-scan-and-analysis-lifecycle.md`
- `feature-specs/2026-07-29-legacy-system-understanding-engine.md`

## Design Gate items

- approve the multi-dimensional correctness contract;
- approve the reviewed, versioned truth-set authority;
- approve Traqen-on-Traqen as required acceptance;
- approve allowlisted Local Runner as the first source connector;
- approve numeric `traqen-self-v1` thresholds and independent blind review;
- approve first-FULL/later-INCREMENTAL behavior, atomic CurrentGraphHead publication, and Feature/Impact history semantics.
