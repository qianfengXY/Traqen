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

## Design sources

- `docs/architecture/traqen-system-requirements.md`
- `docs/features/F001-legacy-system-understanding.md`
- `docs/features/legacy-system-understanding-engine.md`
- `docs/features/workspace-scan-and-analysis-lifecycle.md`

## Design Gate items

- approve the multi-dimensional correctness contract;
- approve the reviewed, versioned truth-set authority;
- approve Traqen-on-Traqen as required acceptance;
- approve allowlisted Local Runner as the first source connector;
- establish initial evaluation baselines before setting blocking thresholds.
