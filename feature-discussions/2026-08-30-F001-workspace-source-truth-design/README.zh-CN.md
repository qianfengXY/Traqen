> Language: [English](README.md) · **简体中文**

---
feature_ids: [F001]
related_features: [F002, F003, F004, F006]
topics: [workspace, source-truth, git, source-snapshot, artifact-inventory, coverage-gap, receipt, design-gate]
doc_kind: feature-discussion
created: 2026-08-30
status: proposed
design_gate: operator-review-pending
---

# F001 方案设计 — Workspace & Source Truth

## 状态与边界

本文件是对已确认 F001 产品边界的**方案设计提案**，等待 co-creator 审阅；它不授权写实现代码，也不重新讨论 [ADR-0003](../../docs/decisions/ADR-0003-source-truth-boundary.zh-CN.md) 已经确定的边界。

在任何存量系统推理开始前，F001 必须先回答：**这一次精确采集了哪份 Git 内容、哪些内容没有获得、F002 能否使用它。**

```text
Architecture cell: source-truth（需要新建）
Map delta: new cell required
Why: 来源身份、采集权威、密封证据、下游准入现在没有唯一运行时 owner。
```

未来的 `source-truth` cell 只拥有来源登记、采集生命周期、快照、清单、Gap、Receipt 与 F002 准入；不拥有 F002 提取、F003 审核、F004 执行/影响或 F006 设置。这是 F303 的 authority/consumer 变化：`SourceTruthRepository` 是唯一权威，F002 只收到 `QualifiedSourceInput`，绝不收到路径、ref、working tree 或凭据；合同测试必须证明这点。

## 总体架构

```text
Workspace
  │ 来源、请求版本、可选目录根
  ▼
SourceRegistration → SourceCaptureRun → SourcePreflight
                                            │
                     BLOCKED receipt ◄──────┘ 通过 / 有预期 Gap
                                            ▼
GitSourceGateway → committed tree/blob reader → staged SourceSnapshot
                                                  │        │
                                                  ▼        ▼
                                          ArtifactInventory  CoverageGap(s)
                                                                  │
                                                   GapAcceptance（仅非阻断）
                                                                  ▼
                                                         SourceTruthReceipt
                                               READY | READY_WITH_ACCEPTED_GAPS
                                                                  │
                                                                  ▼
                                                SourceTruthAdmission → F002
                                              （snapshot + inventory + inherited gaps）
```

`SourceCaptureRun` 记录操作进度、取消和重试；密封来源结果记录不可变证据和下游资格。二者分开，避免半成品运行伪装成半成品快照，也避免重试改写历史。

## 领域对象与不变量

| 对象 | 职责 | 不变量 |
| --- | --- | --- |
| `Workspace` | 授权与隔离聚合根。 | 每条 F001 记录只属于一个 Workspace；元数据与内容遵守同一访问边界。 |
| `SourceRegistration` | 已获只读授权的 Git 身份与凭据引用。 | 不存裸凭据；branch/tag 只选择 commit，不作为 snapshot 身份。 |
| `CapturePolicyRevision` | 平台拥有的扫描器、脱敏、大小、Git 安全规则。 | 用户不能编辑完整性/安全规则；历史结果永久绑定原 policy。 |
| `SourceCaptureRun` | 一次 resolve/preflight/capture/seal 尝试。 | 重试新建 run；失败/取消可审计；一个 run 不会跟随移动 branch。 |
| `SourcePreflightReport` | 自动的来源、授权、commit、root、边界、外部内容与安全证据。 | `PASS`/`WARN`/`BLOCK` 都有 reason code 和下一步；WARN 不等于最终 Gap。 |
| `SourceSnapshot` | repository identity + resolved commit + scope + policy 的不可变结果。 | identity 不含采集时间，包含排序 inventory digest；sealed 后不能变。 |
| `ArtifactInventory` | 覆盖率分母和逐项 disposition。 | 每条已发现、范围内条目恰有一种 disposition/reason；汇总等于明细。目录根结果必须明确不是全仓。 |
| `CoverageGap` | 已知分析限制。 | append-only，不能编辑为已覆盖；只有新 snapshot 能证明解决。 |
| `GapAcceptance` | 对非阻断 Gap 的人类负责确认。 | append-only，必须有负责人、理由、有效期；阻断 Gap 没有 accept 操作。 |
| `SourceTruthReceipt` | 不可变证据/资格决策。 | `READY`=密封来源且无相关 Gap；`READY_WITH_ACCEPTED_GAPS`=密封来源且接受有效；`BLOCKED` 永不可消费。 |
| `QualifiedSourceInput` | F002 专属的准入结果。 | 包含 receipt、snapshot、inventory、policy 与完整 inherited Gap；没有直接 source locator 或凭据。 |

用户至少必须能看出：安全采集、平台策略隔离、敏感脱敏、外部不可得、不可读/失败、不支持/二进制、目录根外。disposition 说明“对条目发生了什么”，Gap 说明“这会怎样限制后续结论”；有实质限制时两者都必须存在。两种记录都不得泄露原始敏感内容或凭据。

## 采集状态机

对外 Receipt 始终只有 `READY`、`READY_WITH_ACCEPTED_GAPS`、`BLOCKED` 三种状态；`AWAITING_GAP_DECISION` 只是 Capture Run 状态。

```text
REQUESTED → PREFLIGHTING
  ├─ blocked ───────────────────────────────► BLOCKED receipt
  └─ READY_TO_CAPTURE → CAPTURING
       ├─ cancellation requested ───────────► CANCELLED
       ├─ read/integrity failure ───────────► CAPTURE_FAILED
       └─ SEALING（原子边界，不能再取消）
            ├─ safety/integrity block ──────► BLOCKED receipt
            └─ SEALED
                 ├─ 无相关 Gap ─────────────► READY receipt
                 └─ 非阻断 Gap ─────────────► AWAITING_GAP_DECISION
                                                └─ 有效接受
                                                   ► READY_WITH_ACCEPTED_GAPS receipt
```

- 先将 branch/tag/commit 解析到完整 commit ID，再采集；身份、授权、边界、完整性、路径安全或篡改信号不可信时，提前阻断。
- 遍历 resolved Git tree、读取 immutable Git blob；解析之后绝不读取用户可变 working tree；不得执行 hook、filter、仓库脚本、构建或依赖安装。
- 私有 staging，只有一次原子 seal 才能让 snapshot/inventory 可见；半成品从不可列出、不可消费。
- 取消只保留 run 审计，不产生可消费 snapshot；重试必须新建 run，默认仍锁定原 commit。若要采集移动后的 branch，必须显式新开请求。
- receipt append-only。Gap 接受过期只会让 receipt 不能用于新的 F002 准入，不会抹去历史证据或历史分析。
- 后续 failed/cancelled/blocked run 不得使更早 READY snapshot 失效。

## 安全采集、迁移边界

| 接口 | 职责 | 禁止 |
| --- | --- | --- |
| `GitSourceGateway` | 用只读凭据引用 resolve ref、检查 committed tree、读取 blob。 | 解析后读 mutable working tree，或执行 source-controlled logic。 |
| `SourcePreflightService` | 授权、commit/root、外部对象、symlink/path、policy 检查。 | 让用户覆盖完整性/安全 block。 |
| `SnapshotStore` | Workspace 边界中的 staging、hash、原子 seal、校验、留存。 | 暴露 staging 或修改 sealed package。 |
| `CoverageAssembler` | 完整 inventory 与 material Gap。 | 从 coverage 中隐藏失败/脱敏/不可用/范围外证据。 |
| `SourceTruthAdmission` | 重验资格，签发 `QualifiedSourceInput`。 | 返回 path/ref，或静默遗漏 inherited Gap。 |

`LocalSourceSnapshotCapture` 只可复用 staging/seal/digest/path-escape 的安全经验。它现在的本地 allowlisted-root reader、逐项强制 digest、直接连接 `WorkspaceAnalysisJob` 均与新合同不符。新 F001 必须以 resolved Git objects 为证据权威；服务器 cache/checkout 至多是性能优化。F001 变成 `SourceCaptureRun`，F002 及后续工作只能在准入后启动。

## 用户界面与现场可观测性

**Workspace 内的 Source Truth 卡** 是用户判断“来源能不能用”的主现场；不能只放在仪表盘，因为来源、范围和 Gap 接受正是在该 Workspace 上决定。

| 界面 | 信息与动作 |
| --- | --- |
| Source Truth 卡 | 规范仓库、resolved commit、root、授权、最新 receipt、为何可用/阻断；登记来源、新建采集、打开 receipt。 |
| 采集设置 | 已授权来源、ref、resolved commit 预览、全仓/单目录根；没有安全规则编辑器。 |
| 预检 | `可开始` / `可带预期 Gap 开始` / `已阻断`，每条含范围和修复动作。 |
| 采集 | 阶段条：预检 → 采集 → 最终化 → receipt；条目计数、当前操作、取消/重试；禁止假百分比。 |
| Source Coverage | scope 横幅、树/列表、disposition、理由、计数、Gap 链接；目录根明确“非全仓”。 |
| Coverage Gaps | 阻断、等待决策、已接受但仍存在；只有非阻断项可接受。 |
| Receipt & History | 来源、commit、范围、完整性 identity、policy、inventory、Gap、接受有效性、F002 资格、历史结果。 |

每个错误必须说明：失败了什么、哪段范围没获得、旧 snapshot 是否仍可用、下一步是什么。进度默认聚合为每个 source 的最新状态，深层界面保留完整历史；诊断使用 reason code 并脱敏。

## F002 准入合同

```ts
type QualifiedSourceInput = {
  workspaceId: string;
  receiptId: string;
  receiptStatus: "READY" | "READY_WITH_ACCEPTED_GAPS";
  receiptValidUntil: string | null;
  sourceSnapshotId: string;
  repositoryIdentity: string;
  resolvedCommit: string;
  declaredScope: { kind: "REPOSITORY" } | { kind: "DIRECTORY_ROOT"; path: string };
  inventoryId: string;
  inventoryDigest: string;
  policyRevisionId: string;
  inheritedGaps: ReadonlyArray<{ gapId: string; severity: "NON_BLOCKING"; affectedScope: string; reasonCode: string }>;
};
```

准入要求：调用者有 Workspace 权限；snapshot/inventory 已密封并验真；receipt 精确匹配且当前可消费；相关接受未过期；不存在 blocker/篡改。它拒绝 direct path、Git URL、单独 ref/commit、dirty checkout、partial snapshot、过期接受和全部 BLOCKED 结果。

F002 的每个派生结果固化 receipt/snapshot/inventory/policy 身份与**完整 inherited Gap 集**。F002 可创建独立的解析层 Gap 并链接 F001 Gap，但不得修改、隐藏、降级或重新接受 F001 Gap。F003/F004 只能经由 F002 得到来源 provenance。

## 参考试点

使用由 order-platform 参考产物播种的一次性 Git fixture，含固定 commit A/B，不使用开发者 working tree。

| 用例 | 必须证明 |
| --- | --- |
| 全仓 commit A | code/docs/config/SQL/tests 每项恰有一个 disposition。 |
| A 的 `services/orders/` 根 | receipt 命名 root，并显式标示其他仓库内容范围外。 |
| A 有不可得 LFS-like object | 非阻断 Gap 要理由/有效期；`READY_WITH_ACCEPTED_GAPS` 后 F002 能看到它。 |
| 重放 A 后移动 branch | snapshot/inventory identity 不变；老结果不变。 |
| 取消后重试 A | cancelled run 只有审计；重试是新 run，旧 READY 仍可用。 |
| B 有 path-escape symlink/integrity mismatch | `BLOCKED`，没有 accept，F002 不能准入。 |
| package script + sensitive fixture | 不执行代码，也不泄露原始秘密。 |
| F002 receipt 与 direct input | 只有合格 receipt 能启动 F002，Gap 进入其输出。 |

首要失效模式是 **false-green receipt**：材料静默消失却被宣称 READY。防线是 Git-object capture、inventory 守恒、显式 disposition、material Gap、原子 seal、不可变 receipt 和强制下游继承。

## 审阅结论与下一门

砚砚与 Kimi 的独立审阅在对象、旅程、状态机、F002 继承和负向试点上达成一致。两项收敛为：

- `SourceRegistration` 与 `Workspace` 分离，以便来源授权和 snapshot 历史独立审计；Workspace 保持访问聚合根。
- capture 后立即 seal snapshot/inventory；人类 Gap 接受只产生后续资格 receipt，绝不改写来源证据。

ADR-0003 已包含相关 rejected alternatives，不需要新 ADR；本轮没有新的通用 operating rule/lesson。

**下一步：** co-creator 审阅本方案；获批后先建立 `source-truth` ownership map 与可交互、在上下文中的 Source Truth 设计 demo。在这两个 gate 之前不开始实现。
