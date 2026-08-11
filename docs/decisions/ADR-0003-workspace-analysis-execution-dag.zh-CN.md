> 语言：**简体中文** · [English](ADR-0003-workspace-analysis-execution-dag.md)

---
feature_ids: [F001]
related_features: [F002, F003, F004, F005, F006]
topics:
  - workspace-analysis
  - execution-dag
  - source-scan
  - analysis-agent
  - reconciliation
  - observability
doc_kind: adr
created: 2026-08-11
---

# ADR-0003：工作空间分析采用分叉—汇合执行 DAG

## 状态

operator 已于 2026-08-11 接受。

## 背景

F001 定义七项持久活动：`SOURCE_SCAN`、`FACT_COMMIT`、`ANALYSIS`、`RECONCILIATION`、`EVALUATION`、`PROJECTION` 与 `PUBLISHING`。当前合同把它们建模为单值 `phase`，当前 Runner 也依次等待每个 Handler。页面即使画出静态与 Agent 两条通道，后端执行仍然是串行的，产品会展示实际上不存在的并发。

目标行为是两条真正独立的证据生产通道。静态语法分析产生确定性观察与静态候选投影；每个已配置子 Agent 从同一不可变源码读取有界切片，独立产生自己的候选池；主 Agent 实时观察这些池，但只对完整、已校验的分区输入执行对账。

## 决策

### 不可变分叉点

`SOURCE_SCAN` 先执行发现和内容寻址的源码快照捕获。Agent 不能读取仍在变化的源码目录。`SourceSnapshot` 与完整 `ArtifactInventory` 密封后，任务分叉：

```text
SourceRegistration
  → SourceSnapshot + ArtifactInventory 密封
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
静态通道                    Agent 通道
SOURCE_SCAN 提取            ANALYSIS
  → 关系解析                  ├─ 子 Agent A 候选池
  → FACT_COMMIT               ├─ 子 Agent B 候选池
                               └─ 子 Agent N 候选池
          └─────────┬─────────┘
                    ▼
               RECONCILIATION
                    ▼
       EVALUATION → PROJECTION → PUBLISHING
```

因此，`ANALYSIS` 不等待最终 `FactBundle`。Scanner Fact 只是可选增强；使用 Fact 的 WorkUnit 必须固定引用不可变 `factCheckpointId`，不能读取无版本的“最新 Facts”视图。

### 分离候选池的权威层次

静态通道保留两层：

```text
DeterministicObservationPool → StaticCandidateProjection
```

前者保存精确的解析器、符号、API、数据、配置、测试资产、结果资产与关系观察；后者把这些观察组织成与子 Agent 相同的六维候选封装：业务、设计、代码、测试用例、测试结果与配置。每个维度都是数组，无证据时为空。独立覆盖状态区分 `FOUND`、`NO_EVIDENCE`、`NOT_YET_ANALYZED`、`UNSUPPORTED` 与 `FAILED`。候选本身必须至少包含一条合法证据；没有证据的断言是 Gap。

静态分组不能把推断出的业务名称变成 Fact。业务或设计维度没有明确源码证据时必须为空。

### 分区对账屏障

主 Agent 可以实时观察已提交的候选池条目和进度，但只有共享 `scopePartitionId` 门禁打开后，才能更新已对账工作投影：

```text
静态分区终态（成功或显式 Gap）
AND 每个必需子 Agent 槽位终态
AND Schema、Snapshot、SourceSlice 与证据校验终态
```

身份冲突保留为不同候选节点。维度或描述冲突可以附着在同一证据簇上，但必须以未解决状态进入 `ConflictLedger`。两种情况都不能在没有授权 Decision 时创建或修改受治理 Feature。

基础分区检查点不是仓库级身份的最终结论。确定性计划还会创建跨分区、跨模块和项目汇总批次；它们的汇合门禁消费所需的下层对账检查点与新提交的静态关系检查点，最终全局门禁还必须等待终态 `FactBundle`。迟到的跨文件证据因此产生追加式对账增量，不能静默重写早期检查点。`scopePartitionId` 按稳定理解计划的局部性划分，不能细化到单行或任意页面。

无法执行的必需子 Agent 必须以 `NO_ELIGIBLE_PRODUCER`、超时、预算缺口或策略拒绝等显式终态关闭。它不能算作一致，也不能让门禁无限等待。

### Job 状态合同

权威 Job 状态使用：

- `phaseStates`：每个 DAG 节点的状态与输出引用；
- `activePhases`：零个或多个同时运行的节点；
- `laneProgress`：源码快照、Inventory、静态分析、Agent、质量与发布工作的类型化分母；
- `joinGates`：分区级与全局对账就绪状态；
- `completedPhases`：只作为派生兼容投影，不能驱动 Scheduler。

单值 `phase` 不再是权威状态。暂停、恢复、取消、租约与恢复作用于父 Job；每条通道分别提交幂等检查点。

### 可观测性

结构化进度与交互事件默认追加写入并长期保存。提示、响应与工具结果的大正文进入受保护的内容寻址追踪存储，事件只引用其摘要。策略脱敏必须显式可见，产品不保存或展示模型私有推理。如果页面开放未对账候选池，必须标记为“技术观测视图”；只有已提交对账检查点能进入“已对账工作树”。

## 影响

- 服务端 Runner 必须从顺序阶段循环改为依赖感知的 DAG Scheduler。
- Job API 与 Web Client 必须支持多个活动阶段和独立通道进度。
- Snapshot/Inventory 密封与最终 Fact 提交成为两个独立的持久门禁。
- Working 功能/API 树只能由已提交的对账检查点更新。
- 现有完整 sibling 屏障继续有效，并成为分区 Join Gate 的输入之一。
- 分层汇总门禁防止早期局部检查点被误当成仓库级身份结论。

## 被拒绝的替代方案

- **在串行后端上画两条通道：** 视觉上声称并发，执行上并不存在。
- **所有 Agent 工作都等待最终 FactBundle：** Scanner 延迟和盲点会定义 Agent 的关键路径。
- **让 Agent 读取变化中的源码目录：** 破坏重放、证据身份与对账。
- **每到一条结果就乐观对账：** 结果依赖完成顺序，并暴露不完整 sibling 集。
- **把确定性观察与语义 Candidate 使用同一个名字：** 抹除 Fact/Candidate 权威边界。
