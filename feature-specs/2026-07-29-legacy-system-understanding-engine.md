---
feature_ids: [F001]
related_features: []
topics:
  - legacy-system-understanding
  - artifact-inventory
  - analysis-agent
  - source-slice
  - canonical-graph
  - incremental-analysis
  - change-impact
  - truth-set
  - dogfood
doc_kind: implementation-plan
created: 2026-07-29
status: proposed
priority: P0
---

# F001 存量系统理解引擎实施计划

> 本文是 F001 的主实施计划。持久扫描/Agent 生命周期的详细执行机制由
> [`2026-07-29-server-owned-workspace-scan-and-analysis-lifecycle.md`](2026-07-29-server-owned-workspace-scan-and-analysis-lifecycle.md)
> 支撑，但生命周期门禁不能替代理解正确性、增量等价、图谱发布和 Traqen 自分析门禁。

**Feature truth:** `docs/features/F001-legacy-system-understanding.zh-CN.md`
**System truth:** `docs/architecture/traqen-system-requirements.zh-CN.md`
**Engine design:** `docs/features/legacy-system-understanding-engine.zh-CN.md`
**Goal:** 从存量代码/文档/契约/配置/测试/结果建立可审核的 canonical graph；第一次 FULL 形成完整当前图谱，后续 INCREMENTAL 更新当前图谱并保留 Feature 版本、实现映射、每次变更影响和验证历史。
**Architecture cell:** legacy-system understanding → canonical traceability graph
**Map delta:** update required
**Map delta why:** F001 新增完整 Inventory、Snapshot 派生 UnderstandingPlan、动态 WorkUnit DAG、模型/Skill 能力路由、六条独立证据通道、SourceSlice Broker、盲测评估、GraphRevision/CurrentGraphHead 和长期 Feature/Impact 历史。
**Tech stack:** Node.js ESM、JSON Schema/OpenAPI、Memory/PostgreSQL stores、server scanner/runner、Analysis Agent/Skills、React/Vinext、Node test runner。
**前端验证:** Yes；必须用 Traqen 分析两个固定的 Traqen Snapshot，在产品内验证最新图谱、Feature 历史、Impact 和 TraceChain。

---

## 1. 直线终态

```text
首次分析
  SourceRegistration
    → SnapshotManifest(FULL)
    → ArtifactInventory
    → deterministic UnderstandingPlan(unassignedCount=0)
    → 六条独立证据通道
    → capability-routed dynamic WorkUnit DAG
    → Candidate reconciliation
    → EvaluationRun
    → GraphRevision(PUBLISHED)
    → CurrentGraphHead

后续变化
  New SnapshotManifest(INCREMENTAL)
    → Artifact/Fact delta
    → affected WorkUnits only
    → Candidate lineage
    → ChangeSet + ImpactAssessment
    → full/incremental equivalence
    → GraphRevision(PUBLISHED)
    → atomic CurrentGraphHead move

历史
  Feature.id
    → FeatureVersion + Decision
    → implementation mapping by Snapshot
    → ChangeSet / ImpactAssessment
    → VerificationResult / Evidence
```

失败或评估未通过的 GraphRevision 永远不能替换当前图谱。默认 UI 只展示最新已发布图谱，但历史账本不删除、不覆盖。

## 2. 范围与明确非目标

### 范围

- 完整 ArtifactInventory 与 ExtractorCapability 注册表。
- 文档/契约、代码、数据、配置、测试/结果的类型化 Facts。
- 从完整 Snapshot/ArtifactInventory 独立于 Scanner Facts 派生确定性 `UnderstandingPlan`，保证每条记录直接读取、专用处理或形成显式 Gap。
- 用动态依赖 DAG 执行大文件、文件、Module、跨 Module、Critic 与汇总 WorkUnit，不把整仓塞入单 Prompt。
- 版本化 `ModelCapabilityProfile`、Direct-source/Fact-dependent Skill 输入合同与持久 `AnalysisRouteDecision`。
- 选择性使用相互独立的多模型 Producer/Critic，并按证据对账而非多数票。
- SourceSlice Broker、证据边界、预算、脱敏和可判定错误。
- 六条独立通道与治理前 Candidate 对账。
- TruthSetVersion、EvaluationPolicy、EvaluationRun 和盲测协议。
- 首次 FULL、后续 AUTO→INCREMENTAL、全量等价门禁。
- GraphRevision、CurrentGraphHead、Feature history、ChangeSet 与 ImpactAssessment。
- 两个 Traqen Snapshot 的自分析验收。

### 非目标

- 自动把 Candidate 晋升为 Feature/Claim/TestSpec。
- 从代码变化自动创建业务 FeatureVersion。
- 静态理解阶段执行任意仓库代码。
- 用一个总分、节点数量或模型自评分代表正确性。
- 让一个通用模型静默处理所有语言/Artifact/角色，或在无合格 Producer 时隐藏 Fallback。
- 默认让每个文件经过所有模型，或按模型票数创建业务真相。
- 第一版支持所有语言或所有 Connector。
- 删除历史 Revision/Facts/Impact 以“只保留最新图谱”。
- 把 held-out Truth Set 答案提供给生产 Agent。

## 3. 终态契约

### 3.1 新增 Schema

- `contracts/artifact-inventory.schema.json`
- `contracts/extractor-capability.schema.json`
- `contracts/source-slice.schema.json`
- `contracts/understanding-plan.schema.json`
- `contracts/understanding-work-unit.schema.json`
- `contracts/model-capability-profile.schema.json`
- `contracts/analysis-route-decision.schema.json`
- `contracts/candidate-reconciliation.schema.json`
- `contracts/understanding-evaluation.schema.json`
- `contracts/graph-revision.schema.json`

`contracts/openapi.json` 只通过这些 Schema 暴露稳定资源，不在路由内复制匿名对象。

### 3.2 新增/扩展领域对象

```ts
type GraphRevision = {
  id: string;
  projectId: string;
  snapshotManifestId: string;
  analysisRunId: string;
  mode: "FULL" | "INCREMENTAL";
  baseRevisionId: string | null;
  changeSetId: string | null;
  impactAssessmentId: string | null;
  evaluationRunId: string;
  semanticDigest: string;
  status: "BUILDING" | "EVALUATING" | "PUBLISHED" | "REJECTED";
  createdAt: string;
  publishedAt: string | null;
};

type CurrentGraphHead = {
  projectId: string;
  graphRevisionId: string;
  version: number;
  updatedAt: string;
};
```

FeatureVersion 继续使用现有稳定 `Feature.id + version`。新增的是按 Snapshot 查询实现映射和影响历史，而不是复制第二套 Feature 身份。

## 4. 生命周期对象普查

| 对象 | 权威 Owner | 可变字段 | 历史策略 |
|---|---|---|---|
| `SourceRegistration` | API/治理 | status | REVOKED 不删历史 Snapshot |
| `SnapshotManifest` | Scanner/store | BUILDING→SEALED/FAILED | SEALED 后不可变 |
| `ArtifactInventory` | Scanner/store | seal 前构建 | seal 后不可变、处置率 100% |
| `ExtractorCapability` | policy registry | 新版本替换默认指针 | 旧版本保留 |
| `UnderstandingPlan` | planner/store | none | 按 Snapshot/planner/convention/policy 版本不可变；基础覆盖 `unassignedCount=0` |
| `UnderstandingWorkUnit` | planner/runtime | execution state/attempt | 稳定 ID，完成结果不重放 |
| `ModelCapabilityProfile` | capability registry | 新版本替换默认指针 | 凭据分离；旧 Revision/Calibration 保留 |
| `AnalysisRouteDecision` | capability router/store | none | 每个 WorkUnit append-only，记录候选/选中/拒绝原因 |
| `SourceSliceRequest/SourceSlice` | broker | request state | 按 Snapshot/WorkUnit 审计保留 |
| `CandidateBundle` | producer/store | none | append-only、跨 Snapshot lineage |
| `ReconciliationResult` | reconciler/store | none | append-only |
| `TruthSetVersion` | operator + independent reviewer | DRAFT→SEALED→RETIRED | SEALED 内容不可变 |
| `EvaluationRun` | acceptance harness | QUEUED→RUNNING→PASSED/FAILED | append-only |
| `GraphRevision` | graph publisher | BUILDING→EVALUATING→PUBLISHED/REJECTED | 终态不可改 |
| `CurrentGraphHead` | graph publisher | revision pointer/version | 原子 CAS；指针历史审计 |
| `FeatureVersion` | Decision governance | none | 顺序 append-only |
| `ChangeSet` | impact engine | none | 每个发布转换 append-only |
| `ImpactAssessment` | impact engine | none | append-only |

## 5. 状态/事件矩阵

### GraphRevision

| 当前状态 | 事件 | 下一状态 | 持久动作 |
|---|---|---|---|
| absent | run output committed | `BUILDING` | 写入 Snapshot/base/mode refs |
| `BUILDING` | graph materialized | `EVALUATING` | 写 semanticDigest |
| `EVALUATING` | policy passes | `PUBLISHED` | 同事务 CAS CurrentGraphHead |
| `EVALUATING` | policy fails | `REJECTED` | 保留 report/diagnostics |
| `PUBLISHED` | later Snapshot published | `PUBLISHED` | 对象不变，仅 head 移动 |
| `REJECTED` | retry | 不变 | 新建 GraphRevision |

### 分析模式

| 当前项目状态 | 请求 | 解析模式 | 结果 |
|---|---|---|---|
| 无 CurrentGraphHead | `AUTO` | `FULL` | 允许 |
| 无 CurrentGraphHead | `FULL` | `FULL` | 允许 |
| 无 CurrentGraphHead | `INCREMENTAL` | — | 409 |
| 有 CurrentGraphHead | `AUTO` | `INCREMENTAL` | 允许 |
| 有 CurrentGraphHead | `INCREMENTAL` | `INCREMENTAL` | 允许 |
| 有 CurrentGraphHead | `FULL` | `FULL` | 允许、用于审计/重建 |

### TruthSetVersion

| 当前状态 | 事件 | 下一状态 | 规则 |
|---|---|---|---|
| absent | create | `DRAFT` | 业务/技术断言可编辑 |
| `DRAFT` | independent approval + partition | `SEALED` | 固定 digest/seed/60-30-10 分区 |
| `SEALED` | threshold change | 不变 | 新建 policy/TruthSetVersion |
| `SEALED` | supersede | `RETIRED` | 旧 EvaluationRun 仍引用旧版 |

## 6. 不变量与对应 RED

| 不变量 | 首个失败测试 |
|---|---|
| INV-1：Inventory 每个范围内 Artifact 都有处置 | `test/artifact-inventory.test.js` |
| INV-2：Agent 任务全集来自完整 Snapshot；相同输入得到稳定分区且 `unassignedCount=0` | `test/understanding-planner.test.js` |
| INV-3：SourceSlice 不接受路径/Glob/跨 Snapshot ID | `test/source-slice-broker.test.js` |
| INV-4：Candidate 证据不越 WorkUnit | `test/candidate-reconciliation.test.js` |
| INV-5：Truth Set 不进入生产输入 Digest | `test/understanding-evaluation.test.js` |
| INV-6：首个发布 Revision 来自 FULL | `test/graph-revision.test.js` |
| INV-7：失败 Revision 不移动 CurrentGraphHead | `test/graph-revision-store.test.js` |
| INV-8：发布 Revision 与移动 Head 原子 | `test/storage-migrations.test.js` |
| INV-9：增量未变区域语义等价 | `test/incremental-understanding.test.js` |
| INV-10：每个发布转换都有 ChangeSet/Impact | `test/incremental-understanding.test.js` |
| INV-11：代码变化不自动创建 FeatureVersion | `test/feature-evolution.test.js` |
| INV-12：Candidate 消失不自动退役 Feature | `test/feature-evolution.test.js` |
| INV-13：默认图谱读 Head，历史 API 读不可变账本 | `test/api-http.test.js` |
| INV-14：浏览器无 scanner/Agent 权威循环 | `web/tests/rendered-html.test.mjs` |
| INV-15：Direct-source Skill 无 FactBundle 仍能读取授权 SourceSlice | `test/understanding-planner.test.js` |
| INV-16：每个 WorkUnit Route 来自已验证模型能力/Skill 合同；无交集时显式失败 | `test/analysis-capability-router.test.js` |
| INV-17：超大工程由有界动态 DAG 完整处置，Summary 不能成为唯一证据 | `test/understanding-planner.test.js` |
| INV-18：多模型只做选择性独立冗余；相关输出不算独立票，分歧进入 ConflictLedger | `test/analysis-capability-router.test.js` |

## 7. 对抗场景

1. 入口文件名误导，AST extractor 故意漏掉入口；Manifest/约定 WorkUnit 仍发现它。
2. 文档声明 A、代码实现 B；保留 Conflict，不自动选择。
3. 路径叫 `payments` 但内容无支付能力；禁止生成高置信 Feature Candidate。
4. 测试文件含 `passed` 字样但无真实执行；不能生成 VerificationResult。
5. `.env`、凭据样式、二进制和超大文件；Inventory 有处置，SourceSlice 拒绝/脱敏。
6. Agent 请求绝对路径、任意 Glob、其他 Snapshot Artifact、WorkUnit 外 Fact。
7. 实现者让 production planner 读取 calibration/held-out Truth Set；边界测试必须失败。
8. 第二 Snapshot 只改注释；未变语义图谱等价，CurrentGraphHead 可更新但 FeatureVersion 不变。
9. 第二 Snapshot 改代码行为；生成 Impact/失效/重验证，但不自动修订业务 FeatureVersion。
10. 第二 Snapshot 改受治理业务定义并有 Decision；顺序创建 FeatureVersion。
11. 增量 Evaluation 失败；旧 Head 仍为默认查询结果。
12. Head CAS 时并发两个 Revision；仅一个发布成功。
13. Candidate 在新 Snapshot 消失；显示 `NO_CURRENT_OBSERVATION`，不产生 retirement。
14. Worker/API/浏览器在扫描、Agent、Evaluation、Publishing 各阶段中断。
15. held-out Reviewer 与实现者对边界分歧；结果保持 UNKNOWN/CONFLICT。
16. Scanner 对某语言产生零 Fact；该语言每个 eligible Artifact 仍在 Direct-source WorkUnit 中被读取或形成显式 Gap。
17. 十万文件工程与超大单文件；Planner 稳定分区、DAG 有界运行、所有基础 Artifact 处置且 `unassignedCount=0`。
18. 唯一可用模型不支持某语言/数据边界；Router 记录 `NO_ELIGIBLE_PRODUCER`，不能换通用模型。
19. 两个同源模型同意但独立 Critic 反对；相关输出不算两票，证据分歧进入 ConflictLedger。

## 8. TDD 实施任务

### Task 1：契约 RED — Inventory、SourceSlice、Evaluation、GraphRevision

**Files**

- Create: `contracts/artifact-inventory.schema.json`
- Create: `contracts/extractor-capability.schema.json`
- Create: `contracts/source-slice.schema.json`
- Create: `contracts/understanding-plan.schema.json`
- Create: `contracts/understanding-work-unit.schema.json`
- Create: `contracts/model-capability-profile.schema.json`
- Create: `contracts/analysis-route-decision.schema.json`
- Create: `contracts/candidate-reconciliation.schema.json`
- Create: `contracts/understanding-evaluation.schema.json`
- Create: `contracts/graph-revision.schema.json`
- Modify: `contracts/openapi.json`
- Modify: `test/contracts.test.js`

1. 先写 additional-properties、Project/Snapshot refs、Plan 覆盖恒等式、Partition/Route/模型能力枚举、预算上限、GraphRevision 状态和 Evaluation 分母的失败断言。
2. 运行 `node --test test/contracts.test.js`，记录 RED。
3. 添加 Schema/OpenAPI `$ref`，不把未定字段塞入 generic metadata。
4. GREEN 后提交契约真相。

### Task 2：持久化 RED — 不可变账本与原子 CurrentGraphHead

**Files**

- Create: `db/migrations/0014_legacy_understanding_engine.sql`
- Modify: `src/storage/traceability-store.js`
- Modify: `src/storage/memory-traceability-store.js`
- Modify: `src/storage/postgres/postgres-traceability-store.js`
- Create: `test/graph-revision-store.test.js`
- Modify: `test/storage-migrations.test.js`

1. RED：append-only Inventory/ExtractorCapability/UnderstandingPlan/ModelCapabilityProfile/RouteDecision/WorkUnit/Slice/Evaluation/Revision、重复 ID 幂等、终态不可改。
2. RED：`publishGraphRevision(expectedHeadVersion)` 同事务验证 Evaluation=PASSED、Revision→PUBLISHED、Head CAS。
3. RED：失败/并发/旧 fencing token 不移动 Head。
4. 实现 Memory/Postgres 行为等价；迁移只前进，不重写既有 Feature/Impact 历史。

### Task 3：完整清点与能力注册表 RED

**Files**

- Create: `src/domain/artifact-inventory.js`
- Create: `src/scanner/extractor-capability-registry.js`
- Modify: `src/scanner/index.js`
- Create: `test/artifact-inventory.test.js`
- Create: `test/extractor-capability-registry.test.js`
- Create: `test/fixtures/understanding/inventory/`

1. 为 INCLUDED/EXCLUDED/UNSUPPORTED/GENERATED/BINARY/OVERSIZED/SECRET_REDACTED/READ_FAILED 写 RED。
2. 覆盖 Manifest seal 前分母未知、seal 后 100% 处置。
3. 每个提取器声明语言/版本/节点边/已知缺口/fixture status。
4. Regex fallback 以独立 capability 暴露，不能冒充 AST。

### Task 4：SourceSlice Broker RED

**Files**

- Create: `src/domain/source-slice.js`
- Create: `src/application/source-slice-broker.js`
- Modify: `src/application/traceability-application.js`
- Modify: `src/api/http-server.js`
- Create: `test/source-slice-broker.test.js`
- Modify: `test/api-http.test.js`

1. RED：同 Project/Snapshot/Run/WorkUnit/Artifact/Fact 边界。
2. RED：禁止路径/Glob，拒绝二进制、秘密、越界预算、过期 Run。
3. RED：64 KiB/12,000 token policy cap、确定性裁剪/脱敏、请求/响应 Digest。
4. 实现仅 Runtime service identity 可 POST；浏览器身份得到 403。
5. 拒绝/截断写 Diagnostic/Gap，不提供直接读取 fallback。

### Task 5：六条证据通道与确定性提取 RED

**Files**

- Refactor: `src/scanner/javascript-project-scanner.js`
- Create: `src/scanner/document-contract-extractor.js`
- Create: `src/scanner/test-config-result-extractor.js`
- Create: `src/analysis/understanding-lanes.js`
- Create: `test/understanding-lanes.test.js`
- Create: `test/fixtures/understanding/lanes/`

1. 分别测试 Inventory、deterministic、document/contract、test/config/result、Agent/Skill、reconciliation 输出。
2. 文档陈述只能生成 Fact/Candidate，不能生成 Governed Claim。
3. TestAsset/ExecutionArtifact 不能关闭 TestExecution/Evidence 缺口。
4. 配置只记录 Key/存在性/消费者，真实值进入脱敏/拒绝路径。
5. 所有通道有独立状态、诊断、覆盖分母和 producer version。

### Task 6：Agent 完整源码规划、能力路由与动态 DAG RED

**Files**

- Create: `src/analysis/understanding-planner.js`
- Create: `src/analysis/analysis-capability-router.js`
- Modify: `src/analysis/analysis-agent.js`
- Modify: `src/analysis/skill-adapters.js`
- Modify: `src/domain/reverse-skill.js`
- Create: `test/understanding-planner.test.js`
- Create: `test/analysis-capability-router.test.js`
- Create: `test/fixtures/understanding/adversarial-missed-entrypoint/`
- Create: `test/fixtures/understanding/large-mixed-language-project/`
- Create: `test/fixtures/understanding/model-calibration/`

1. RED：没有任何 Fact 时，完整 ArtifactInventory 仍按工程边界→Artifact 通道→局部性分组→预算分片→横切根任务生成稳定 `UnderstandingPlan`；每条记录恰好直接读取、专用处理或形成 Gap，且 `unassignedCount=0`。
2. RED：相同 Snapshot/planner/convention/execution policy/source ranges 重规划产生相同 Partition ID；任一版本、Range 或 Policy Digest 改变都会改变 Input Digest。
3. RED：Scanner 故意漏入口，Direct-source Skill 在没有 FactBundle 时仍通过 Artifact ID + SourceSlice 恢复 Candidate；Fact-dependent Skill 缺少 FactBundle 时拒绝。
4. RED：超大文件按版本化语法/文档边界分 Range 并追加文件汇总；超大多语言工程展开为 Leaf→File/Module→Cross-module→Critic→Project synthesis 动态 DAG，不受当前三个 UI Child Slot 限制。
5. RED：Candidate 必须落到原始 SourceSlice 和/或允许 Fact；只有子任务 Summary 时校验失败。Fact-enriched/FOLLOW_UP WorkUnit 只能追加，不能删除基础覆盖。
6. RED：Model Revision 初始未验证；只有按 Role/语言/Artifact/Risk Cell 通过 Schema、Grounding、关系正负断言、Context 退化、Gap 诚实度与数据边界 Fixture 的 Profile 才能进入候选，厂商名或凭据连通不能替代 Calibration。
7. RED：Capability Router 按 Role/Capability/语言/Artifact/Context/Data Boundary/Quality/Cost/Deadline/Concurrency 与已验证 ModelCapabilityProfile、版本固定 Skill 求交集，并持久化候选、选中、拒绝原因、精确版本、Calibration、Independence Group 与预算。
8. RED：无合格 Route 产生 `NO_ELIGIBLE_PRODUCER`，不允许隐藏 Fallback；高风险/低置信/冲突才触发不同 Independence Group 的冗余 Producer/Critic。
9. RED：同源模型/Prompt Family 输出不能累计独立票；多模型分歧保留 Evidence 与 ConflictLedger，不能按多数创建 Feature 身份。
10. RED：Truth Set Digest/答案出现在 production plan/input 时拒绝；Follow-up 深度/总预算触顶形成 `UNEXPLORED_BUDGET_LIMIT`。
11. 每个 WorkUnit ID 与结果提交绑定 Snapshot/Partition/Dependency/Producer Route/Skill/Policy Input Digest；调度可 at-least-once，但相同 Digest 结果只能提交一次。

### Task 7：Candidate 对账、Lineage 与冲突 RED

**Files**

- Create: `src/analysis/candidate-reconciliation.js`
- Modify: `src/shared/candidate-bundle.js`
- Create: `test/candidate-reconciliation.test.js`
- Modify: `test/candidate-bundle.test.js`

1. 覆盖相同、疑似重复、父子、冲突、替代解释与跨 Snapshot lineage。
2. 非法 evidenceFactIds、SourceSlice refs、confidence cap 在对账前确定性拒绝。
3. 名称/路径/domain/hash 不创建 stable Feature ID。
4. 新 Snapshot Candidate 消失只产生 observation gap，不产生 Feature retirement。

### Task 8：Truth Set 与评估 Harness RED

**Files**

- Create: `src/domain/understanding-evaluation.js`
- Create: `src/application/understanding-evaluator.js`
- Create: `test/fixtures/understanding/traqen-self-calibration-v1.json`
- Create: `test/understanding-evaluation.test.js`
- Create: `test/traqen-self-acceptance.test.js`

1. RED：固定 Seed 的 60/30/10 分层保持关键节点/边/通道/正负断言覆盖。
2. held-out 从 `TRAQEN_ACCEPTANCE_TRUTH_SET_PATH` 注入，不提交隐藏答案；缺失时 acceptance 明确 SKIP/FAIL，不能回退 calibration。
3. RED：production input digest 与 TruthSet digest/anchor answer 相交即失败。
4. 实现 `traqen-self-v1` 全部数字阈值、分母、Reviewer identity 和不可追溯改阈值。
5. 失败报告包含 Miss/Violation/Sample classification，不泄露 held-out 全量答案给实现日志。

### Task 9：FULL/INCREMENTAL、ChangeImpact 与图谱发布 RED

**Files**

- Create: `src/domain/graph-revision.js`
- Create: `src/application/incremental-understanding.js`
- Modify: `src/domain/change-impact.js`
- Modify: `src/domain/feature-graph.js`
- Modify: `src/application/traceability-application.js`
- Create: `test/graph-revision.test.js`
- Create: `test/incremental-understanding.test.js`
- Modify: `test/change-impact.test.js`
- Modify: `test/feature-evolution.test.js`

1. RED：无 Head 的 AUTO→FULL、INCREMENTAL→409；有 Head 的 AUTO→INCREMENTAL。
2. RED：Artifact/Fact delta、依赖前沿、WorkUnit reuse、Candidate lineage。
3. RED：每个发布转换必须有 ChangeSet、ImpactAssessment 和 revalidation plan。
4. RED：未变区域 100% semantic equivalence；变化区域只允许 expected/explained deltas。
5. RED：Evaluation 失败保留旧 Head；成功原子发布新 Head。
6. RED：代码变化不增 FeatureVersion；带 Decision 的业务变化按顺序增版本。

### Task 10：接入持久 Job 与 Worker

**Files**

- Modify: `src/application/workspace-analysis-job-runner.js`
- Modify: `src/application/workspace-analysis-worker.js`
- Modify: `contracts/workspace-analysis-job.schema.json`
- Modify: `test/workspace-analysis-job-runner.test.js`
- Modify: `test/workspace-analysis-worker.test.js`

1. 把 lifecycle 终点扩展为 Analysis→Reconciliation→Evaluation→Projection→Publishing。
2. Job 在 Start 时持久化 resolvedMode/baseRevisionId；Resume 不重算模式。
3. 每阶段输出引用和阶段前进原子提交。
4. 浏览器/API/worker 中断矩阵在 EVALUATION/PUBLISHING 阶段也通过。

### Task 11：API 与最新/历史 UI RED

**Files**

- Modify: `contracts/openapi.json`
- Modify: `src/api/http-server.js`
- Create: `web/app/understanding-graph-client.ts`
- Modify: `web/app/traqen-product.tsx`
- Modify: `web/app/globals.css`
- Modify: `test/api-http.test.js`
- Create: `web/tests/understanding-graph-client.test.mjs`
- Modify: `web/tests/rendered-html.test.mjs`

新增读取面：

```http
GET /v1/projects/{projectId}/graph/current
GET /v1/projects/{projectId}/graph/revisions
GET /v1/projects/{projectId}/graph/revisions/{revisionId}
GET /v1/projects/{projectId}/features/{featureId}/history
GET /v1/projects/{projectId}/changes/{changeSetId}/impact
```

1. 默认 Graph/Tree/TraceChain 读取 CurrentGraphHead。
2. Feature History 展示 FeatureVersion Decision、Snapshot 实现、ChangeSet/Impact、Verification。
3. Candidate 与 Governed Feature 继续视觉区分。
4. Evaluation/Rejected Revision 只在历史/诊断页可见，不能伪装为当前。
5. 页面 mount/refresh 仍为 GET-only，不在浏览器运行 scanner/Agent/evaluator。

### Task 12：Traqen-on-Traqen 两 Snapshot 验收

**Artifacts**

- Create: `test/fixtures/understanding/traqen-self-calibration-v1.json`
- Create outside repo: held-out Truth Set artifact
- Create outside repo: browser screenshots, evaluation reports, graph digests
- Update: `docs/features/F001-legacy-system-understanding.md`
- Update: `docs/features/F001-legacy-system-understanding.zh-CN.md`

1. 在隔离 worktree、隔离 Store、非 3003/3004/6399 端口固定 Traqen Snapshot A。
2. FULL 分析 A，验证 Inventory、六通道、`traqen-self-v1`、TraceChain，发布 Head A。
3. 制造一项经审核的 Traqen 受控变化得到 Snapshot B。
4. INCREMENTAL 分析 B；另跑策略要求的 FULL 对照。
5. 验证未变区域 100% 等价、变化区域解释完整、Impact 与人工预期一致。
6. 验证 Head 从 A 原子切到 B，失败演练不移动 Head。
7. 在 UI 默认查看 B，并打开一项 Feature 的完整历史。
8. 由非实现作者审查 held-out、源码锚点、关系、浏览器证据和最终结果。

## 9. 全量门禁

```bash
env -u NODE_ENV npm test
env -u NODE_ENV npm run test:web
env -u NODE_ENV npm --prefix web run lint
git diff --check
```

额外 F001 门禁：

- `traqen-self-v1` EvaluationRun = PASSED；
- production input/Truth Set 泄漏测试 = GREEN；
- scanner/Agent independent-root adversarial fixture = GREEN；
- FULL/INCREMENTAL semantic equivalence = 100%；
- GraphRevision/CurrentGraphHead 原子失败注入 = GREEN；
- Feature history 与 Candidate/Feature 视觉区分通过浏览器验收；
- 独立 Reviewer 签署。

## 10. 切换顺序

1. 先落契约与不可变存储，不切 UI。
2. 落 Inventory/Capability/SourceSlice，保持旧路径仅作对账基线。
3. 落六通道和新 planner，跑对抗 Fixture。
4. 落评估 Harness，先 calibration GREEN，再由独立 Reviewer 跑 held-out。
5. 落 GraphRevision/CurrentGraphHead 和 FULL/INCREMENTAL。
6. 接入持久 Job，确认失败不污染当前图谱。
7. 切默认读取到 CurrentGraphHead，增加历史视图。
8. Traqen-on-Traqen 两 Snapshot 通过后删除浏览器权威扫描/分析旧路径。

任何一步未通过都停留在旧的已发布 CurrentGraphHead；不得以“节点已经很多”或“刷新已经不断”宣称 F001 完成。
