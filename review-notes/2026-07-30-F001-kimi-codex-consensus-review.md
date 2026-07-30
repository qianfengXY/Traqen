---
feature_ids: [F001]
topics:
  - legacy-system-understanding
  - implementation-review
  - consensus
  - correctness
  - security
  - incremental-analysis
  - dogfood
doc_kind: review
created: 2026-07-30
reviewers:
  - Kimi / Kimi 3
  - CodeX / GPT-5
convergence_prepared_by: CodeX / GPT-5
reviewed_sha: 433a2d043f3f9f6bff77a0768d67e063b32173b9
design_sha: 0855e39c2de565bf2031aebdcc733e7453187bb6
verdict: REQUEST_CHANGES
---

# F001 实现共同 Review 意见

> 审查目标：`codex/f001-legacy-system-understanding` @ `433a2d0`
> 设计基线：`design/f001-legacy-system-understanding` @ `0855e39`
> 审查方式：Kimi 与 CodeX 先独立审查，再只收敛双方均确认的交集；本文不混入单方 Finding。

## 共同结论

当前实现已经提供 ArtifactInventory、SourceSlice、UnderstandingPlan、路由、对账、Evaluation、
GraphRevision、CurrentGraphHead 和 WorkspaceAnalysisJob 等基础构件，并通过现有后端、Web、Lint
与 Diff 门禁；但 F001 的核心产品链路仍未闭合，现有 Traqen-on-Traqen 测试也没有证明 Traqen
能从真实源码生成并展示可发布的理解图谱。

因此，双方共同给出 **`REQUEST_CHANGES`**：不能把 `433a2d0` 视为 F001 核心需求完成。

## 独立意见互证矩阵

| ID | 共同 Finding | Kimi 独立证据 | CodeX 独立证据 | 影响 |
|---|---|---|---|---|
| CR-1 | 新理解引擎未接入生产端到端链路 | Job Runner、Worker、提取器和能力注册表未由 bootstrap/HTTP 组装，`/analysis-runs` 仍走旧 AnalysisAgent | 全仓调用点检查显示 `LocalSourceSnapshotCapture`、Planner、Router、Reconciliation、Evaluator、Job Runner 在 `src/` 中只有定义，没有生产调用方 | AC-B1～B7、AC-E1～E4 无可运行产品路径 |
| CR-2 | Traqen 自分析验收把 Truth Set 回填成 observed 值 | `traqen-self-acceptance.test.js` 直接使用 Truth Set anchors/relationships，没有真实提取 | 第二 Snapshot 仅修改 Inventory digest，测试没有运行真实 Snapshot、WorkUnit、CandidateGraph、TraceChain、Impact 或 UI 路径 | AC-F2、AC-F4、AC-F5、AC-F7 未被证明 |
| CR-3 | Evaluation 空分母会被当作满分 | `ratio(..., 0)` 返回 `1`，空 Candidate/来源/Gap 分母可能通过 | 聚焦反例中只有 30 anchors/60 required relations，其他四类分母均为 0，结果仍是 `PASSED` | 不完整或未评估图谱可越过发布门 |
| CR-4 | 增量失效只向上传播一层 | 叶子变化会重跑 Module，但错误复用 `PROJECT_SYNTHESIS` | 使用真实 Planner 的反例得到 `affected=[LEAF,MODULE_SYNTHESIS]`、`reused=[PROJECT_SYNTHESIS]` | 增量图可能携带过期项目级结论，破坏 FULL/INCREMENTAL 等价 |
| CR-5 | SourceSlice evidence 可越过 WorkUnit/Snapshot 边界 | Adapter 透传模型返回的 `sourceSliceIds`，Reconciliation 只检查非空 | Broker 返回 `SLICE-ALLOWED`、Producer 引用 `SLICE-FOREIGN` 的反例被 Adapter 与 Reconciliation 接受 | Candidate 可引用不存在或不属于当前授权范围的证据 |
| CR-6 | Snapshot 扫描与复制之间存在竞态 | 先扫描 live root、后复制文件，Inventory digest 与冻结内容可能分离 | 在 scan 后、copy 前修改文件的确定性反例得到旧 Inventory digest 与新 Snapshot bytes | Snapshot、Inventory、SourceSlice 不再代表同一不可变输入 |
| CR-7 | CurrentGraphHead 与 UI 没有承载真实发布图谱 | Web 新 client 只驱动状态卡；Cytoscape 仍读取旧 Workspace Candidate 或硬编码 demo | `/graph/current` 只返回 head/revision 元数据，GraphRevision 无图谱 payload/ref，UI 不解析发布图谱 | AC-F3、AC-F4、AC-F7 的“最新图谱、历史与原子切换”没有实现 |
| CR-8 | 设计、JSON Schema 与 OpenAPI 契约漂移 | 发现 disposition、Artifact 字段、SourceSlice selector 与 response schema 不一致 | 复核确认设计使用 `EXCLUDED_BY_POLICY`、`artifactKinds`/`mediaType`、`selectors[]`，实现分别使用 `EXCLUDED`、`kind`、单 `artifactId`；多个成功响应无 schema | 实现方、客户端和验收方没有同一个可执行契约 |

## 必须修改

### CR-1 — 接通唯一的服务端理解流水线

在 `src/api/application-bootstrap.js` 中组装真实 F001 runtime，并让一个持久 Job 实际执行：

```text
SOURCE_SCAN
  → FACT_COMMIT
  → ANALYSIS
  → RECONCILIATION
  → EVALUATION
  → PROJECTION
  → PUBLISHING
```

每个阶段必须读取上一阶段持久化的类型化输出，而不是测试中的 dummy handler。HTTP/API 要提供同一
Job 的 start/read/pause/resume；浏览器切换后不得继续拥有权威扫描或模型循环。ExtractorCapability
和实际执行的 extractor/Skill 必须由 Planner/Router 使用并产生持久 RouteDecision。

验收证据：

- 从 allowlisted SourceRegistration 启动后，可观察同一 Job 完成上述全部阶段；
- 刷新、关闭页面、重启 Worker 后 Job 状态和已提交 WorkUnit 保持；
- 没有合格 Producer、预算耗尽、模型失败和不支持语法均形成显式 Gap；
- `rg` 不再显示核心 F001 runtime 只有定义、没有生产调用方。

### CR-2 — 用真实生产链路重写 Traqen-on-Traqen 验收

删除从 Truth Set 向 observed 结果的任何复制。固定真实 Traqen Snapshot，经生产管线生成 observed
Inventory、Candidates、relations、provenance 和 gaps；Truth Set 只能由独立验收器在生产分析完成后
读取。

第二次验收必须捕获真实受控变更后的 Snapshot，运行 `FULL(snapshot-1) → INCREMENTAL(snapshot-2)`，
并对 snapshot-2 再跑一次 FULL 比较。至少断言：

- `traqen-self-v1` 所有非零分母和阈值；
- CandidateGraph 与 visually distinct governed seed graph；
- 一条完整 TraceChain；
- ChangeSet、ImpactAssessment 和 revalidation plan；
- INCREMENTAL 与 FULL 在评估范围内等价；
- UI 默认解析第二个 Snapshot 的 CurrentGraphHead。

### CR-3 — Evaluation 对未评估维度 fail closed

`ratio(n, 0)` 不能表达“满分”。EvaluationPolicy 应版本化每个必需维度的最小分母，并区分
`NOT_EVALUATED`、`FAILED`、`PASSED`。`traqen-self-v1` 未提供 Candidate precision、forbidden
relations、source attribution、gaps、replay 或 incremental equivalence 的所需分母时必须拒绝发布。

发布门不能只检查 `evaluation.status === "PASSED"`；还要校验 policy/version 及完整 denominator
contract。

### CR-4 — 按 DAG 反向依赖闭包计算增量失效

从所有 changed/removed Artifact 对应的 WorkUnit 出发，沿 reverse dependencies 递归计算传递闭包。
`affectedWorkUnitIds`、`reusedWorkUnitIds` 与 revalidation plan 都必须由该闭包生成。新增至少三层
`LEAF → MODULE_SYNTHESIS → PROJECT_SYNTHESIS` 回归测试，并用最终 FULL 比较证明等价。

### CR-5 — 在对账前绑定不可伪造的 evidence allowset

Adapter 只能接受 Broker 为当前 `projectId + snapshotManifestId + analysisRunId + workUnitId`
实际返回的 Fact/SourceSlice。进入 Reconciliation 前逐项校验 Candidate identity、Snapshot、WorkUnit、
Fact IDs、SourceSlice IDs、confidence cap、producer route 和 route decision；unknown、foreign、
cross-Snapshot、cross-WorkUnit 或重复 ID 必须 fail closed。

### CR-6 — 从同一批捕获 bytes 生成 Snapshot 与 Inventory

不要对 live source 先扫描、后重新打开复制。通过受边界约束的 descriptor/handle 读取一次 bytes，
从这批 bytes 计算 digest 并写入 staging Snapshot；验证完整 Inventory 后再原子 seal/rename。必须覆盖
内容替换、symlink 替换、删除和新增文件的竞态测试。

### CR-7 — 让 CurrentGraphHead 真正指向不可变图谱产物

GraphRevision 需要引用不可变 graph artifact，或自身包含可验证的 graph content reference。
`/graph/current`、revision/history/trace/impact 读取都从 head 解析该产物。Web graph/tree/trace/history
视图必须消费这些 API，不再以 demo scenario 或浏览器本地推导结果作为已发布真相。

### CR-8 — 冻结一份可执行契约

明确选择“更新设计”或“修改实现”，并同步双语设计、JSON Schema、domain model、Store、OpenAPI
和客户端。至少解决：

- `EXCLUDED_BY_POLICY` 与 `EXCLUDED`；
- `artifactKinds[] + mediaType` 与 `kind`；
- SourceSlice `selectors[]` 与单 `artifactId`；
- `/graph/current`、`/graph/revisions`、publish、Feature history、SourceSlice response 的成功响应 schema。

增加 contract tests，避免文档、schema 与 runtime 再次各自演进。

## 修复顺序

1. **先闭合 CR-1/CR-7**：没有真实 runtime 与可解析 graph artifact，其他验收仍会停留在孤立构件。
2. **再封闭 CR-5/CR-6**：确保分析读取与引用的是同一份不可变、授权证据。
3. **修复 CR-3/CR-4**：让 Evaluation 与 INCREMENTAL 对错误 fail closed。
4. **完成 CR-2**：用真实双 Snapshot 自分析作为核心完成门，而非单元测试自证。
5. **收尾 CR-8**：冻结契约并让 OpenAPI/客户端/测试共同验证。

## 已验证且应保留的基础

- `ArtifactInventory` 有完整 disposition 分母，Planner 保证 `unassignedCount=0`；
- WorkUnit 动态 DAG、稳定 partition ID、RouteDecision、CAS 发布原语已有良好单元基础；
- Memory/PostgreSQL 的 CurrentGraphHead 更新使用原子版本检查；
- governed Feature/Claim/TestSpec 与 Candidate authority 仍保持分离；
- 被审提交的后端测试 251/251、Web 测试 41/41、Web build/lint、`git diff --check` 均通过。

这些结果说明底层构件可继续复用，但不能替代上述端到端与正确性门禁。

## 共同完成标准

只有在以下证据同时存在时，双方才建议重新请求 Review：

- 一条通过 HTTP 启动、服务端持久执行并发布 graph artifact 的真实 F001 journey；
- CR-3～CR-6 的反例先红后绿；
- 两个真实 Traqen Snapshot 的 FULL→INCREMENTAL→FULL 等价验收；
- CurrentGraphHead-backed graph、TraceChain、impact、history 浏览器证据；
- 双语设计、schema、OpenAPI、runtime 与客户端契约一致；
- 后端、Web、build、lint、diff、evaluation、browser acceptance 全绿。

## 收敛检查

- 否决理由需要 ADR：无；本文没有引入新的架构备选，只核对已批准 F001 设计与实现差距。
- 踩坑教训需要回流家规：无；本次证据属于 Traqen 项目审查，不回流项目数据。
- 操作规则需要 Guide：无；没有形成新的跨项目操作流程。

---

本文件由 CodeX 根据 Kimi 与 CodeX 各自独立提交的 Review 结果整理；只有两份 Review
共同确认的 Finding 才进入本文。整理动作不代替 Kimi 的身份或签名。

[CodeX/GPT-5🐾]
