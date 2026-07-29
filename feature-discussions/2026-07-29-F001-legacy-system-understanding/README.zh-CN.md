> 语言：**简体中文** · [English](README.md)

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

# F001 讨论：存量系统理解是核心需求

## operator 体验

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

## 已纠正的理解偏差

第一版 F001 把浏览器独立扫描当成 Feature 目标。operator 已明确：刷新安全只是执行约束，产品结果是正确、有证据地重建存量系统，并产生有用的 canonical graph 投影。

## 已收敛方向

1. 保留 `F001` 作为仓库内首个 Feature ID。
2. F001 重新以存量系统理解正确性为中心。
3. 确定性扫描与 Agent/Skill 分析作为独立证据通道，之后再对账。
4. 分别评估 Inventory、召回、精度、关系正确性、来源、缺口、重放和增量等价。
5. 保持 Candidate/Decision/受治理对象，以及测试线索/TestSpec/执行/Evidence 的边界。
6. 把固定 Traqen Snapshot 的自身图谱、TraceChain 和变更影响旅程设为发布门禁。
7. 服务端持久所有权作为 F001 的支撑设计保留。
8. 第一次成功运行强制 FULL；后续 Snapshot 默认 INCREMENTAL，并通过全量等价门禁。
9. 默认图谱读取最新 `CurrentGraphHead`；GraphRevision、FeatureVersion、Snapshot 实现映射、ChangeSet、ImpactAssessment、Decision 与 Evidence 作为不可变历史保留。
10. 代码或配置变化不能自动创建业务 FeatureVersion；只有 Decision 能修订业务定义。
11. 用 `traqen-self-v1` 数字阈值和 calibration/held-out/challenge 盲测协议阻断过拟合。

## 设计真相源

- `docs/architecture/traqen-system-requirements.zh-CN.md`
- `docs/features/F001-legacy-system-understanding.zh-CN.md`
- `docs/features/legacy-system-understanding-engine.zh-CN.md`
- `docs/features/workspace-scan-and-analysis-lifecycle.zh-CN.md`
- `feature-specs/2026-07-29-legacy-system-understanding-engine.md`

## Design Gate 项

- 确认多维正确性合同；
- 确认经审核、版本化的 Truth Set 权威；
- 确认 Traqen 分析 Traqen 是强制验收；
- 确认 Allowlisted Local Runner 是首个 Source Connector；
- 确认 `traqen-self-v1` 数字阈值与独立盲审；
- 确认首次 FULL、后续默认 INCREMENTAL、原子 CurrentGraphHead 与 Feature/Impact 历史语义。
