> 语言：**简体中文** · [English](ADR-0001-canonical-traceability-ontology.md)

---
feature_ids:
  - UNNUMBERED-CANONICAL-TRACEABILITY
topics:
  - canonical-graph
  - ontology
  - authority
  - identity
  - evidence
doc_kind: adr
created: 2026-07-25
---

# ADR-0001：Canonical Traceability Ontology

## 状态

已接受并进入实现。

## 背景

Traqen 当前同时存在服务端确定性 Fact 图谱和浏览器本地 Workspace 索引。两者都能发现实现观察，并让模型改善语义分组，但它们使用的消息封装和投影并不一致。浏览器可能把推断分组显示成类似 Feature 的 ID，把测试文件线索显示成类似 TestSpec 的节点，还会把“没有执行结果”显示成类似 TestExecution 的节点。这些形状混淆了发现、权威与验证。

Traqen 需要让扫描、推断、治理、执行、图谱视图、功能树、影响分析与指标共享同一套真相模型。

## 决策

Traqen 是一个版本化的追溯知识系统：

- Snapshot-bound Fact 是事实基础。
- Agent 和 Skill 的输出是候选推断。
- 人工 Decision 是业务 Claim、Feature 身份与治理晋升的权威来源。
- 可信执行 Evidence 通过 TestSpec 和 TestExecution 支撑 Claim 的 VerificationResult。
- Feature Tree、API Tree、TraceChain、Impact 与 Metrics 都是同一 canonical graph 的有界只读投影。

规范处理链路为：

```text
Snapshot/源码
  → 确定性 Fact
  → Agent/Skill Candidate
  → 人工 Decision 与治理对象
  → 执行结果和 Evidence
  → 功能树、图谱、TraceChain、Impact 与 Metrics 投影
```

这条链路定义权威与来源顺序，不代表串行执行顺序。根据 [ADR-0003](ADR-0003-workspace-analysis-execution-dag.zh-CN.md)，确定性观察与 Agent 候选可以从同一份已密封源码快照并行产生，在进入治理前通过已校验的对账检查点汇合。

### 规范实体与关系

```text
Project
  └─ HAS_SNAPSHOT → SnapshotManifest
       └─ CONTAINS → ArtifactVersion
            └─ OBSERVED_AS → Fact

AnalysisRun
  └─ HAS_WORK_UNIT → WorkUnit
       └─ PRODUCES → CandidateFeature / CandidateClaim
            └─ SUPPORTED_BY → Fact

Decision
  ├─ ACCEPTS / REJECTS → CandidateFeature / CandidateClaim
  └─ CREATES → Claim / FeatureVersion / TestSpec

Feature
  └─ HAS_VERSION → FeatureVersion
       ├─ HAS_CLAIM → Claim
       │    └─ AUTHORIZED_BY → Decision
       ├─ DESIGNED_BY → DesignElement
       │    └─ SUPPORTED_BY → DocumentSectionFact
       ├─ IMPLEMENTED_BY → CodeSymbolFact
       ├─ EXPOSED_BY → EndpointFact
       ├─ CONFIGURED_BY → ConfigurationFact
       └─ VERIFIED_BY → TestSpec
            └─ EXECUTED_AS → TestExecution
                 └─ HAS_RESULT → VerificationResult
                      └─ SUPPORTED_BY → Evidence

TaxonomyVersion
  └─ CONTAINS → TaxonomyNode
       └─ CLASSIFIES → FeatureVersion / CandidateFeature
```

### 身份

`Feature.id` 是治理链路分配的不透明稳定 ID，在 Feature 的整个生命周期内保持不变。它不能由 `businessKey`、名称、domain、scope、源码路径或 taxonomy 位置计算得到。

`FeatureVersion` 保存 `businessKey`、名称、domain 和 scope 等可变业务属性。这些属性与当前证据仅作为匹配输入。无法可靠匹配时，Candidate 必须进入身份审查；Traqen 不得静默分配或合并治理 Feature 身份。

Fact 节点把稳定实体身份与 Snapshot-specific 不可变 Fact 身份分开。Candidate ID 可以由内容派生，因为它标识的是一次观察或推断，而不是受治理的业务对象。

### 权威与生命周期

- Candidate 的接受和拒绝是 `ReviewDisposition` 事件。被拒绝的 Candidate 永久保留，而且从未成为 Feature。
- `FeatureRetirement` 或 `NO_CURRENT_IMPLEMENTATION` 只适用于已经受治理的 FeatureVersion。
- 模型可以建议对账、拆分、合并或 taxonomy 位置，但确定性校验与人工治理拥有最终状态转换权。
- 浏览器 IndexedDB 是可恢复的本地缓存与检查点，不是独立真相存储。

### Evidence 语义

检测到测试文件只产生 `TEST_ASSET` Fact，不产生 `TestSpec`。候选说明不是 Claim。缺少可信结果是 TraceGap，不是 `TestExecution`。

验证链路为：

```text
Claim
  └─ VERIFIED_BY → TestSpec
       └─ EXECUTED_AS → TestExecution
            └─ HAS_RESULT → VerificationResult
                 └─ SUPPORTED_BY → Evidence
```

Evidence 证明一次执行或观察的完整性。`VerificationResult` 针对关联 Claim 给出 `PASS`、`FAIL` 或 `INCONCLUSIVE`。业务权威仍然来自 Decision。

### 确定性模型边界

每条 Candidate 结论都必须包含非空 `evidenceFactIds`。确定性代码拒绝：

- 引用生产 WorkUnit 之外的证据；
- 属于另一个 Snapshot 或项目的 Fact；
- 缺失或重复的 evidence ID；
- 与所引用 Fact ID 不精确对应的稳定 evidence node ID；
- 超出声明词汇的 Candidate proposal 字段，包括嵌套的身份或治理字段；
- 不完整的 Schema；
- 超过确定性 evidence cap 的置信度；
- WorkUnit 契约要求输入输出一一对应时出现的重复或遗漏 Candidate。

LLM 可以报告语义矛盾，但不能验证自身输出的可信性。

### 投影

Candidate 发现视图、治理 Feature 视图和综合视图可以共享 UI 结构，但必须保留节点类型与状态。Taxonomy 是版本化分类关系，不是 Feature 身份。功能树不拥有真相。

## 影响

- 浏览器与服务端分析必须共享一套 `WorkUnit`/`CandidateBundle` 契约。
- 现有类似 Feature 的浏览器 ID 必须重新标注为 Candidate 身份。
- 本地图谱节点不能再把测试线索或缺少执行显示成 `TestSpec` 或 `TestExecution`。
- 现有受治理的 Feature、Claim、Decision、TestSpec、execution 与 Evidence 存储继续作为权威来源，并逐步投影进 canonical graph。
- 未来的本地 Runtime 可以签名派生证据包；原始源码隐私策略与 Candidate 权威相互独立。

## 被拒绝的替代方案

- 用业务字段哈希生成 `Feature.id`：输入可变，身份不稳定。
- 让 Validation Agent 批准模型输出：生产者不能成为自己的信任边界。
- 把被拒绝的 Candidate 当作 retired Feature：这会制造虚假的业务历史。
- 维护独立权威的 Feature Tree：taxonomy 变化会改写身份并分裂真相。
- 把 Evidence 当成业务 Claim 的直接权威：测试观察不能替代人工 Decision。
