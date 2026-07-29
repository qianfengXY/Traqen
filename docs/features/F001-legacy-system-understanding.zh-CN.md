> 语言：**简体中文** · [English](F001-legacy-system-understanding.md)

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

# F001：存量系统理解与 Canonical Graph 构建

> **Status**: spec | **Owner**: CodeX | **Priority**: P0

## Why

Traqen 的首要能力是把存量代码和文件理解到足以构建可审核图谱的程度，在图谱中关联需求、设计、代码、数据、配置、测试、测试结果、Evidence、变更和 Decision。

此前 F001 把“执行不依赖浏览器”当成目标。它是必要基础设施，但没有回答核心问题：**Traqen 是否准确恢复了存量系统的重要能力和关系，并明确展示证据与缺口？**

因此，F001 负责完整的理解基础：

```text
完整、不可变的源码范围
  → 确定性观察
  → 独立 Agent/Skill 分析
  → 有证据边界的 Candidate 对账
  → 正确性评估
  → canonical Candidate graph
```

受治理 Feature 与 Claim 仍必须由人工 Decision 创建；测试执行与 Evidence 是独立的下游权威。

## Current state

### 已有能力

- Snapshot Manifest、确定性 Facts、Candidate Bundle、证据边界校验和稳定 lineage；
- JavaScript 扫描与浏览器侧多语言启发式扫描；
- Analysis Agent、Reverse Skill 契约、模型 Adapter 和检查点；
- 治理、Feature Graph、TraceChain、Impact、TestSpec、Runner、Evidence 和指标领域；
- 浏览器提交派生观察后，服务端拥有 AnalysisRun。

### 阻塞本 Feature 的缺口

- 没有覆盖纳入、不支持、排除、失败、生成、二进制和秘密脱敏内容的完整 ArtifactInventory 分母；
- 浏览器与服务端扫描的能力和所有权不一致；
- 部分语义规划从扫描器发现的根开始，扫描器 Miss 会继续传播；
- 真实仓库验证只测数量和降噪，没有测人工审核能力召回、Candidate 精度或关系正确性；
- 没有带正向/负向图谱断言的版本化 Truth Set；
- 没有全量/增量等价门禁；
- 没有 Traqen 分析 Traqen 的强制产品验收；
- 源码扫描仍依赖浏览器，大仓分析可能在 canonical Facts 建立前被中断。

## What

### Phase A：正确性合同与审核真相

定义多维正确性、版本化评估策略、审核 Truth Set Schema、正负关系断言、显式 Unknown 状态和回归阈值。

### Phase B：不可变范围与完整清点

建立授权 SourceRegistration、不可变 Snapshot 捕获、完整 ArtifactInventory、显式处置、提取器能力注册表与安全 SourceSlice Broker。

### Phase C：独立理解通道

把确定性提取、文档/契约、测试/配置/结果与 Agent/Skill 源码分析作为可独立观察的通道。任务从完整 Source Manifest 和约定规划，不能只依赖一个扫描器输出。

### Phase D：对账与 Lineage

校验证据边界，对重复和层级做对账，保留冲突与替代解释，跨 Snapshot 连接 Candidate，并产出 CandidateGraph、CoverageLedger 与 ConflictLedger，但不创建受治理权威。

### Phase E：持久与增量执行

在一个服务端持久 Job 下执行扫描与 Agent WorkUnit；复用已提交工作、让浏览器生命周期只读、选择性失效变化区域，并证明增量/全量等价。

### Phase F：Traqen 分析 Traqen

分析固定 Traqen Snapshot，与人工审核种子 Truth Set 对比，在 Traqen 中展示自身 Candidate 与受治理种子图，渲染完整 TraceChain，并验证一次受控变更影响旅程。

## User journey

### 主旅程：理解并查看一个存量系统

- **Scope unit**：一个不可变仓库 Snapshot
- **Actor**：operator
- **Entry**：带授权 SourceRegistration 的 Project
- **Flow**：
  1. 启动一个持久理解 Job。
  2. 查看完整 Artifact 分母及不支持/排除原因。
  3. 观察独立扫描、文档、测试/配置和 Agent/Skill 通道。
  4. 通过源码证据查看 Candidate 节点/关系、冲突和缺口。
  5. 对比分维度审核正确性，而不是单一置信度。
  6. 用 Decision 建立受治理 Feature、Claim、Taxonomy 与 TestSpec。
  7. 从同一 canonical model 查看 Graph、TraceChain、内容、Impact 与质量投影。
- **Success evidence**：Inventory 报告、评估报告、图谱断言、重放/增量报告、持久 Job 轨迹和产品可见的 Traqen 自身图谱
- **Non-goals**：自动恢复业务真相、自动批准 Candidate、执行任意源码、第一版支持所有语言

### 支撑旅程

| ID | 旅程 | 必须证据 |
|---|---|---|
| J1 | Parser 漏掉入口点，独立 Manifest/Source 通道仍发现并举证 | 对抗 Fixture 与 Candidate 来源 |
| J2 | 两个 Skill 对一个能力边界有分歧 | ConflictLedger 与双方解释 |
| J3 | 有测试文件，但没有当前执行证明 Claim | TestAsset/TestSpec/Execution 分离状态 |
| J4 | 扫描期间刷新或关闭浏览器 | Job 身份不变且服务端进度增长 |
| J5 | 一个文件变化只影响一个图谱区域 | 增量/全量等价与 Impact 路径 |
| J6 | Traqen 分析固定的自身仓库 | 审核自图谱、缺口、TraceChain 与 Impact 报告 |

## Acceptance criteria

### A. 范围与确定性 Facts

- [ ] **AC-A1**：固定 Snapshot 内每个 Artifact 都有显式 Inventory 处置并留在覆盖分母中。
- [ ] **AC-A2**：每个受支持提取器声明精确能力，并通过正向、负向、源码跨度和诊断 Fixture。
- [ ] **AC-A3**：Facts 不可变、绑定 Snapshot、可定位源码，并可按提取器版本重现。

### B. 独立 Agent/Skill 理解

- [ ] **AC-B1**：初始 WorkUnit 计划包含独立于单一扫描器发现的 Manifest/Module/入口/文档/测试/配置根。
- [ ] **AC-B2**：Agent/Skill 能请求策略约束的 SourceSlice，并恢复一个被某确定性提取器有意漏掉的审核锚点。
- [ ] **AC-B3**：每个 Candidate 节点和关系只引用同一 Snapshot 与 WorkUnit 内允许证据；拒绝非法 ID 和过高置信度。
- [ ] **AC-B4**：预算耗尽、不支持语法、歧义和模型失败产生显式 Gap，不能伪造完成。

### C. 对账与治理

- [ ] **AC-C1**：对账识别重复、层级、矛盾和替代解释并保留各自证据。
- [ ] **AC-C2**：名称、路径、Domain 或 Hash 不能静默创建受治理 Feature 身份。
- [ ] **AC-C3**：只有 Decision 能创建或修订 FeatureVersion、Claim、Taxonomy 分类和 TestSpec。
- [ ] **AC-C4**：Candidate、受治理对象、测试线索、TestSpec、TestExecution、VerificationResult 和 Evidence 在存储/API/UI 中严格区分。

### D. 正确性与增量

- [ ] **AC-D1**：评估报告为 Inventory、锚点召回、Candidate 精度、必须/禁止关系、来源、缺口、重放和增量等价提供分母。
- [ ] **AC-D2**：Truth Set 数据版本化、经审核，并排除在生产分析输入之外。
- [ ] **AC-D3**：同一 Snapshot 与引擎重复运行产生稳定 Facts 和 Candidate lineage。
- [ ] **AC-D4**：受控新 Snapshot 的增量图谱在评估范围内等价于全量图谱，并保留不受影响的 Decision。

### E. 持久生命周期与安全

- [ ] **AC-E1**：扫描与 Agent 阶段运行在一个持久 Job 下；刷新、关闭、重连或另一浏览器接入不会改变状态。
- [ ] **AC-E2**：人工 Pause/Resume 保留相同 Snapshot 并跳过已提交 WorkUnit；运行任务在 Worker 重启后恢复，人工暂停任务保持暂停。
- [ ] **AC-E3**：Local Runner Allowlist、路径/Symlink fencing、SourceSlice 策略、秘密脱敏和隔离评估 Store 通过安全测试。
- [ ] **AC-E4**：切换后浏览器不包含权威扫描或模型执行循环。

### F. Traqen 分析 Traqen

- [ ] **AC-F1**：固定 Traqen Snapshot 清点 `docs/`、`feature-specs/`、`contracts/`、`src/`、`test/`、`web/` 和安全构建/测试产物，并显式列出排除项。
- [ ] **AC-F2**：输出与覆盖 Traqen 核心子系统及必须/禁止关系的人工审核种子 Truth Set 对比。
- [ ] **AC-F3**：Traqen 展示自身 Candidate 图和视觉区分的受治理种子图，并提供源码内容与缺口报告。
- [ ] **AC-F4**：至少一项 Traqen 能力具有从系统需求/设计到代码、TestSpec、当前执行、VerificationResult 与 Evidence 的完整审核 TraceChain。
- [ ] **AC-F5**：一项受控 Traqen 变更产出经审核的 Impact 路径和重验证计划。
- [ ] **AC-F6**：后端、Web、Build、Lint、Diff、评估、浏览器验收和独立 Review 门禁通过。

## 需求点 Checklist

| ID | operator 原话 | AC | 验证方式 | 状态 |
|---|---|---|---|---|
| R1 | “扫描与分析 Agent 可能需要重新设计。” | AC-B1～B4、AC-C1 | 对抗通道 + 对账测试 | [ ] |
| R2 | “这个需求是我最核心的需求，怎么把存量代码的分析正确。” | AC-A1～A3、AC-D1～D4 | 版本化 Truth Set 评估 | [ ] |
| R3 | “做一个需求、设计、代码、测试用例、测试结果、配置等图谱关联。” | AC-C4、AC-F3～F4 | canonical graph 断言与 UI | [ ] |
| R4 | “便于之后做变更影响分析、内容查看、质量追溯。” | AC-D4、AC-F4～F5 | 内容、TraceChain、Impact 验收 | [ ] |
| R5 | “拿 Traqen 项目做测试验证，通过 Traqen 自己展示自己的功能图谱。” | AC-F1～F6 | 隔离 Traqen 自分析验收 | [ ] |
| R6 | “刷新浏览器，当前运行的任务状态未发生变化。” | AC-E1～E2 | Job 身份、进度、WorkUnit 调用 | [ ] |

### 覆盖检查

- [x] 每条 operator 需求都映射到可执行 AC。
- [x] 正确性、图谱价值和自身 Dogfood 是主要结果。
- [x] 刷新耐久性作为基础设施保留，不再定义整个 Feature。
- [ ] UI 证据映射将在实现验收阶段补全。

## Dependencies

- **系统需求**：`docs/architecture/traqen-system-requirements.zh-CN.md`
- **本体权威**：ADR-0001 canonical traceability ontology
- **已实现前置**：PR #5 服务端 AnalysisRun；只覆盖派生观察后的 Agent 阶段
- **支撑设计**：现有 Agent、Workspace、Graph、TestSpec、Runner、Evidence 与持久生命周期文档
- **实现门禁**：替换当前源码扫描所有权前必须通过 Design Gate

## Architecture ownership

- **Architecture cell**：存量系统理解 → canonical traceability graph
- **Map delta**：update required
- **Why**：F001 扩展源码理解所有权，引入独立证据通道与对账，并把正确性评估和自身 Dogfood 纳入发布边界。

## Risks

| 风险 | 缓解 |
|---|---|
| 把节点数量误当理解质量 | 人工审核多维评估与负向断言 |
| 一个扫描器盲点变成整条管线盲点 | Manifest 派生规划与独立源码通道 |
| Agent 文字虚构关系 | 结构化 Bundle、有界源码/证据、确定性拒绝 |
| 把当前代码冻结成业务真相 | Candidate/Decision/受治理对象分离 |
| 隐藏不支持范围 | 完整 Inventory 分母与显式处置 |
| Truth Set 对当前实现过拟合 | 正负关系断言、版本化、独立 Review |
| 增量模式偏离全量分析 | 全量/增量等价门禁 |
| 自分析污染生产数据 | 隔离 Worktree、Store、端口与经审核执行 |
| 耐久性工程再次挤占产品正确性 | 正确性与 Dogfood 阶段为发布阻塞项 |

## Open questions

| # | 问题 | 建议 | 状态 |
|---|---|---|---|
| OQ-1 | 谁批准初始 Traqen 种子 Truth Set？ | operator 决定业务边界；独立 Reviewer 验证技术锚点 | Design Gate |
| OQ-2 | 哪些阈值阻塞发布？ | 先建立 Baseline，再按维度版本化阈值；禁止单一总分 | Design Gate |
| OQ-3 | 第一种 Source Connector 是什么？ | Allowlisted Local Runner，随后加入 Remote Git，但图谱契约不变 | Design Gate |

## Key decisions

| # | 决策 | 理由 | 日期 |
|---|---|---|---|
| KD-1 | F001 是存量系统理解正确性，不是刷新 Bug。 | 只有耐久性、没有语义正确性，不满足产品使命。 | 2026-07-29 |
| KD-2 | 正确性按多维评估，并与人工审核 Truth Set 对比。 | 遗留意图不能由单一模型置信度表达。 | 2026-07-29 |
| KD-3 | 分析通道独立产证据，之后对账。 | 一个提取器不能决定系统允许发现什么。 | 2026-07-29 |
| KD-4 | Traqen 分析 Traqen 是发布门禁。 | 产品必须在自身真实系统上展示有用追溯。 | 2026-07-29 |
| KD-5 | `Fxxx` 生命周期 ID 与受治理 `Feature.id` 分离。 | 工程规划不能创建业务权威。 | 2026-07-29 |

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-07-29 | F001 最初按持久扫描生命周期立项 |
| 2026-07-29 | operator 纠正为存量系统理解正确性和 Traqen 自身 Dogfood |

## Review gate

Design Gate 必须确认：

1. 系统使命与 canonical graph 终态；
2. 多维正确性合同；
3. 人工审核 Truth Set 权威；
4. 独立分析通道与对账边界；
5. Traqen 分析 Traqen 是强制验收；
6. 第一阶段 Local Runner 数据边界。

实现随后执行 TDD、Quality Gate、独立 Review 与 Merge Gate。

## Links

| 类型 | 路径 | 说明 |
|---|---|---|
| 系统需求 | `docs/architecture/traqen-system-requirements.zh-CN.md` | 产品使命、图谱、旅程、系统需求、Dogfood 合同 |
| 核心理解引擎 | `docs/features/legacy-system-understanding-engine.zh-CN.md` | Inventory、通道、WorkUnit、对账、评估、增量 |
| 持久生命周期 | `docs/features/workspace-scan-and-analysis-lifecycle.zh-CN.md` | 服务端所有权、检查点、Pause/Resume、Worker 恢复 |
| 当前 Analysis Agent | `docs/features/analysis-agent-design.zh-CN.md` | 已实现 Agent 契约与当前限制 |
| 当前 Workspace | `docs/features/workspace-analysis-design.zh-CN.md` | 当前浏览器体验与迁移基线 |
| Canonical ontology | `docs/decisions/ADR-0001-canonical-traceability-ontology.zh-CN.md` | 真相与权威边界 |
| 现有详细架构 | `docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md` | 子系统级架构 |
