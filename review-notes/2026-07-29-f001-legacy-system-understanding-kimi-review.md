# Review Result: F001 Legacy-System Understanding Engine

Review-Target-ID: F001-legacy-system-understanding
Branch: codex/f001-legacy-system-understanding
Commit: 433a2d0
Reviewer: Kimi/Kimi 3 (@kimi)

## 验证执行

| 检查项 | 结果 |
|---|---|
| Backend tests | 251/251 pass（需显式安装 devDependency `@electric-sql/pglite`） |
| Web build + tests | 41/41 pass |
| Web lint | pass |
| `git diff --check` | clean |

## 总体判断

F001 的核心**构件**（ArtifactInventory、SourceSlice、UnderstandingPlan、GraphRevision、Evaluation、WorkspaceAnalysisJob 等）已经落地为领域对象、契约、存储和单元测试，但**可运行的端到端产品流水线尚未闭合**——新的 Job Runner、提取器、能力注册表等没有被接入 `TraceabilityApplication` 与 HTTP API，Traqen-on-Traqen 验收也是把 Truth Set 作为 observed 值回填。当前交付更接近“带测试的脚手架”，而非 F001 真相源中要求的核心需求已实现。

## 按 AC 的详细 Findings

### AC-A：Scope 与确定性事实

| ID | 评级 | 说明 |
|---|---|---|
| AC-A1 | ✅ 基本满足 | `ArtifactInventoryScanner` 对所有 artifact 给出明确 disposition，`createArtifactInventory` 强制 sealed inventory 的分母完整。 |
| AC-A2 | ⚠️ 部分满足 | `ExtractorCapabilityRegistry`、`document-contract-extractor`、`test-config-result-extractor` 已实现并导出，但**没有任何生产代码调用它们**；提取能力声明与实际提取执行脱节。 |
| AC-A3 | ✅ 满足 | Fact / Inventory 使用 SHA-256 digest，artifact ID 由路径派生，同一输入可复现。 |

### AC-B：独立 Agent/Skill 理解

| ID | 评级 | 说明 |
|---|---|---|
| AC-B1 | ⚠️ 形式满足 | `createUnderstandingPlan` 从 Inventory 出发生成独立 lane 的 WorkUnit，但未接入实际运行。 |
| AC-B2 | ✅ 局部满足 | `SourceSliceBroker` 用 artifactId 而非路径授权读取，并支持 redaction/rejection；但当前契约是单 artifact，与设计文档的 `selectors: Array` 不一致。 |
| AC-B3 | ⚠️ 未闭环 | Candidate evidence 校验在 reconciliation 中检查非空，但未验证 `sourceSliceIds` 是否真正属于已授权 slices（见 AC 间问题 #4）。 |
| AC-B4 | ⚠️ 未验证 | 代码有 gap 结构，但没有测试覆盖 budget exhaustion / unsupported syntax / model failure 场景。 |
| AC-B5 | ✅ 满足 | Planner 不依赖 scanner Facts，直接从 Inventory 分区。 |
| AC-B6 | ✅ 满足 | 动态 DAG（LEAF → MODULE_SYNTHESIS → PROJECT_SYNTHESIS → FOLLOW_UP）与 stable partition ID 已验证。 |
| AC-B7 | ⚠️ 形式满足 | `routeAnalysisWorkUnit` 实现了 model/skill eligibility 与独立 producer 选择，但只在单元测试中被调用，未进入真实 WorkUnit 执行路径。 |

### AC-C：对账与治理

| ID | 评级 | 说明 |
|---|---|---|
| AC-C1 | ✅ 满足 | `reconcileCandidates` 保留 duplicate、conflict、alternative。 |
| AC-C2/C3/C4 | ✅ 满足 | 治理路径沿用旧实现，代码未自动创建 governed Feature/Claim/TestSpec。 |

代码小缺陷：`src/analysis/candidate-reconciliation.js:13` 的 `summaryEvidence` 检查是 dead code，因为前面第 10 行已经抛出了同样的前提异常。

### AC-D：正确性与增量性

| ID | 评级 | 说明 |
|---|---|---|
| AC-D1 | ⚠️ 形式满足 | `evaluateUnderstanding` 输出多维度指标与分母，但空分母时 `ratio(..., 0)` 固定返回 `1`，可能导致无真实样本时仍通过。 |
| AC-D2 | ✅ 满足 | 生产计划拒绝 Truth Set 内容，并有 leakage 检测。 |
| AC-D3 | ✅ 满足 | 相同输入产生相同 plan digest。 |
| AC-D4 | ⚠️ 部分满足 | 增量计划函数存在，但只向上失效一层：叶子变化时 Module 被重跑，而 `PROJECT_SYNTHESIS` 被列为 reused。 |
| AC-D5/D6/D7 | ✅ 基本满足 | CurrentGraphHead CAS、FULL-first、INCREMENTAL-base、EVALUATION_PASSED 门控在 Memory/PostgreSQL 中均已实现。 |
| AC-D8 | ⚠️ 形式满足 | API 返回当前 head 与 revision 历史，Feature history 接口存在，但 UI 未用这些端点展示 governed 历史。 |

### AC-E：持久生命周期与安全

| ID | 评级 | 说明 |
|---|---|---|
| AC-E1/E2 | ⚠️ 未接入 | `WorkspaceAnalysisJobRunner` 与 `WorkspaceAnalysisWorker` 存在，但 `application-bootstrap.js` 未注册，HTTP `/analysis-runs` 仍走旧 `AnalysisAgent`；pause/resume 未在真实 job runner 上测试。 |
| AC-E3 | ✅ 满足 | allowlist、symlink 隔离、secret redaction、路径逃逸检查已落地。 |
| AC-E4 | ⚠️ 未验证 | 浏览器端仍有旧扫描/分析代码，没有证据表明新管线已替换旧路径。 |

### AC-F：Traqen-on-Traqen

| ID | 评级 | 说明 |
|---|---|---|
| AC-F1 | ✅ 满足 | `traqen-self-acceptance.test.js` 验证 `docs/`、`feature-specs/`、`contracts/`、`src/`、`test/`、`web/` 均有 artifact。 |
| AC-F2 | 🔴 不满足 | 测试把 Truth Set 的 anchors/relationships 直接作为 observed 值传入，candidate 精度、source attribution、gap 也是手写；没有证明引擎从源码实际提取。 |
| AC-F3/F4/F7 | 🔴 不满足 | 新增 understanding-graph-client 只驱动一个状态卡片；Cytoscape 图仍使用旧 Workspace Candidate 图或硬编码 demo scenario，没有展示 published Candidate/governed seed graph、TraceChain 或原子切换。 |
| AC-F5 | ⚠️ 未验证 | 有 change impact API，但没有基于真实 two-Snapshot FULL→INCREMENTAL 的 impact 路径验证。 |
| AC-F6 | ✅ 满足 | build/lint/diff 通过。 |

## 关键跨 AC 问题

1. **生产链路没有接通（影响 AC-B1/B7/E1/E2/F3/F4/F7）**  
   `WorkspaceAnalysisJobRunner`、提取器、能力注册表、对账器、评估器均未被 `application-bootstrap.js` 组装，也没有对应的 HTTP 入口。现有 `/analysis-runs` 仍基于旧 `AnalysisAgent` 执行（`src/application/traceability-application.js:1309-1372`）。

2. **自分析验收是答案回填（影响 AC-F2）**  
   `test/traqen-self-acceptance.test.js:60-81` 将 truth 同时作为输入和 observed 值，无法证明 recall/precision。

3. **SourceSlice evidence 未做跨 WorkUnit 校验（影响 AC-B3）**  
   `createDirectSourceAnalysisAdapter` 直接透传模型返回的 `sourceSliceIds`，reconciliation 只检查数组非空。

4. **增量失效只传播一层（影响 AC-D4）**  
   `planIncrementalUnderstanding` 只检查 WorkUnit 自身 artifact 与直接依赖 artifact，未递归传播到 PROJECT_SYNTHESIS。

5. **“不可变 Snapshot”扫描—复制竞态（影响 AC-A3/E3）**  
   `LocalSourceSnapshotCapture.capture` 先扫描 live source 再复制，两步之间源文件变化会导致 Inventory digest 与冻结目录内容不一致。

6. **契约/设计不一致（影响可维护性）**  
   - 设计文档 `EXCLUDED_BY_POLICY` vs 实现 `EXCLUDED`；
   - 设计文档 `artifactKinds: array` + `mediaType` vs 实现单 `kind`；
   - 设计文档 SourceSlice `selectors: Array` vs 实现单 `artifactId`。  
   这些差异未在文档中解释。

7. **OpenAPI response schema 缺失**  
   `/graph/current`、`/graph/revisions`、`/analysis-runs/{id}/source-slices` 的 200 response 只有 description，无 schema 引用。

8. **数据库 schema 隐患**  
   `understanding_record` 表同时存在 `PRIMARY KEY (project_id, record_type, id)` 与 `UNIQUE (project_id, id)`，不同 record_type 的 ID 可能冲突。

## 建议修复优先级

- **P0**：把新 Job Runner / extractors / planner / router / evaluator 接入 `TraceabilityApplication` 与 HTTP API，形成可运行管线。
- **P0**：重写 Traqen self-acceptance 测试，使其真正从源码提取并评估。
- **P1**：修复增量失效传播、SourceSlice evidence 校验、空分母评估。
- **P1**：对齐设计文档、JSON Schema、OpenAPI 与实现。
- **P2**：补全 OpenAPI response schema，移除/修正 `understanding_record` 的冗余 UNIQUE。

## 遗留 Workspace 文件（保持原样，未移动）

以下文件在 review 时已在 worktree 中未跟踪，本次 review 未改动：

- `docs/SOP.md`
- `docs/features/TEMPLATE.md`
- `repro-refresh-termination.test.js`
- `traqen-refresh-running-recovery.png`

由 co-creator 决定保留/移位/删除。

---

Finding generator only; this is not an approval verdict.

[Kimi 3/Kimi🐾]
