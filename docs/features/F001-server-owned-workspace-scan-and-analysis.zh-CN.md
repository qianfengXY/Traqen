> 语言：**简体中文** · [English](F001-server-owned-workspace-scan-and-analysis.md)

---
feature_ids: [F001]
related_features: []
topics:
  - workspace
  - source-scan
  - analysis-run
  - checkpoint
  - browser-refresh
doc_kind: spec
created: 2026-07-29
---

# F001：服务端拥有的 Workspace 扫描与 Analysis 生命周期

> **Status**: spec | **Owner**: CodeX | **Priority**: P0

## Why

operator 期望 Workspace 分析是 Traqen 持久任务，而不是浏览器页面活动：刷新或关闭浏览器不能终止文件扫描；人工恢复时必须从最后一个已提交扫描或 Agent 单元继续，不能重复已完成工作。

## Current State / 现状基线

- 已交付的服务端 `AnalysisRun` 可以在派生观察进入 API 后跨浏览器刷新运行。
- 源码扫描仍在 `WorkspaceAnalysisView.scanWorkspace()` 内执行，目录句柄、循环、游标和状态都由页面持有。
- 只有浏览器完成扫描后，服务端 run 才会创建。
- 扫描期间刷新会销毁唯一执行器；IndexedDB 检查点可以保存数据，但不能让任务继续运行。
- 旧实施计划明确允许 `SCANNING + refresh → INTERRUPTED`，不满足 operator 需求。

## What

### Phase A：生命周期契约与持久化

建立持久化 `SourceRegistration`、`SourceSnapshot`、`SourceScanRun` 和 `WorkspaceAnalysisJob` 契约，以及幂等键、期望状态、租约、fencing token 和内存/PostgreSQL 等价实现。

### Phase B：服务端拥有源码扫描

增加白名单 Local Runner、不可变 Snapshot spool、逐文件检查点、跨文件关系解析、原子 Fact commit 和多语言能力等价 fixture。

### Phase C：统一编排

在一个 job 下执行 `SourceScanRun → FactBundle → AnalysisRun → Candidate projection`。Pause、Resume、Cancel、重启恢复和已完成单元复用同时适用于两个子阶段。

### Phase D：浏览器所有权切换

用命令/状态客户端替代页面扫描器。浏览器挂载、刷新、重连和轮询都只读；连接状态绝不能覆盖任务状态。

### Phase E：验收与旧路径删除

在移除浏览器执行器前，证明大仓连续运行、反复刷新、关闭页面、断网重连、人工暂停/恢复、API/worker 重启、安全边界和扫描器能力等价。

## User Journey

### Primary Journey：只启动一次，持续观察一个持久任务

- **Scope unit**: workspace
- **Actor**: operator
- **Entry**: 已登记授权源码位置的 Workspace 分析页
- **Flow**:
  1. operator 选择源码和模型配置，点击“开始分析”。
  2. Traqen 立即返回稳定 `jobId`，分别展示 Source Scan 与 Analysis Agent 进度。
  3. operator 可以任意次数刷新、关闭或重新连接浏览器，服务端任务状态不变并继续执行。
  4. operator 可以在原子边界人工 Pause，稍后 Resume 同一任务。
  5. Traqen 跳过已完成扫描与 Agent WorkUnit，为固定 Snapshot 产出唯一 Candidate 投影。
- **Success evidence**: 浏览器网络轨迹、服务端 job/run ID 与进度、API/worker 重启日志、WorkUnit 调用次数，以及最多三张验收截图
- **Non-goals**: 浏览器后台 Worker、刷新触发自动 Resume、首期 Remote Git connector、Candidate 自动晋升为受治理 Feature

### Supporting Journeys

| ID | Scope unit | Actor | Flow | Evidence |
|---|---|---|---|---|
| S1 | workspace | operator | 扫描期间 Pause → 刷新 → 仍暂停 → Resume 同一 job | API 状态与扫描调用次数 |
| S2 | workspace | operator | Analysis 期间关闭 → 重新打开 → 同一 run 继续 | 浏览器轨迹与 run ID |
| S3 | workspace | operator | API/worker 重启 → 租约恢复 → 已完成单元保留 | 重启集成日志 |

## Acceptance Criteria

### Phase A：生命周期契约与持久化

- [ ] AC-A1：`WorkspaceAnalysisJob`、`SourceScanRun` 和 `AnalysisRun` 具有不同的持久化身份、状态和检查点，并保持一致的 Project/Snapshot 绑定。
- [ ] AC-A2：重复 Start、Pause、Resume 和过期 worker commit 被幂等拒绝，或返回当前权威状态。
- [ ] AC-A3：内存与 PostgreSQL store 通过相同生命周期、租约、fencing 和重启加载测试。

### Phase B：服务端拥有源码扫描

- [ ] AC-B1：扫描期间刷新或关闭唯一浏览器不会改变 job 状态、scan run ID 或服务端所有权；已完成文件进度继续增长。
- [ ] AC-B2：Resume 复用同一不可变 Snapshot，且不重新执行已完成扫描 WorkUnit，并由提取器调用次数证明。
- [ ] AC-B3：Local Runner 拒绝非白名单根目录、路径穿越、符号链接逃逸、过宽的根/home 目标、设备、socket 和非普通文件。
- [ ] AC-B4：切换前，canonical 服务端扫描达到经审核的浏览器扫描器覆盖：JavaScript、TypeScript、JSX/TSX、Java、Python、Go、C#、Rust、OpenAPI、命令、配置和测试线索。

### Phase C：统一编排

- [ ] AC-C1：只有同一 Snapshot 的 FactBundle 成功提交后才能启动 AnalysisRun。
- [ ] AC-C2：人工 Pause 与 Resume 保持 `jobId`、`sourceSnapshotId`、`scanRunId`、`analysisRunId` 和全部已提交子单元结果。
- [ ] AC-C3：运行中任务在 API/worker 重启后恢复；人工暂停和取消的任务不会自动恢复。
- [ ] AC-C4：Candidate 输出继续受 WorkUnit 证据边界约束，不能创建受治理 Feature 权威。

### Phase D：浏览器所有权切换

- [ ] AC-D1：页面挂载、刷新、重连和轮询只发送读取请求，绝不发送 Start、Pause、Resume 或 Cancel。
- [ ] AC-D2：UI 在同一 job 下独立展示 Source Scan 与 Analysis Agent 进度，并把连接状态分开显示。
- [ ] AC-D3：切换后浏览器不再包含文件扫描或模型执行循环；IndexedDB 只保存非权威 job 指针和 UI 缓存。

### Phase E：验收与安全

- [ ] AC-E1：至少 10,000 文件的仓库经受十次刷新、浏览器关闭、断网重连、人工暂停/恢复和 API/worker 重启，job 身份不变且已完成单元不重复执行。
- [ ] AC-E2：原始源码、私有绝对路径、真实 `.env` 值和未脱敏秘密不会进入浏览器请求、读取 API、日志或外部模型输入。
- [ ] AC-E3：后端测试、Web 测试/构建、lint、diff-check、浏览器验收和扫描器等价门禁全部通过。

## 需求点 Checklist

| ID | 需求点（operator 原话） | AC 编号 | 验证方式 | 状态 |
|---|---|---|---|---|
| R1 | “刷新浏览器，当前运行的任务状态未发生变化。” | AC-B1、AC-D1 | 浏览器网络 + job 进度 | [ ] |
| R2 | “需要暂停则是我人工触发。” | AC-C2、AC-D1 | API/浏览器 mutation 次数 | [ ] |
| R3 | “从我上次暂停的节点继续分析，已经分析完毕的数据不需要重复分析。” | AC-B2、AC-C2 | 提取器/模型调用次数 | [ ] |
| R4 | “我说的是扫描阶段，扫描文件这一步。” | AC-B1～B4 | 扫描集成 + 能力等价套件 | [ ] |
| R5 | “将扫描文件与分析 Agent 这一步的逻辑单独列为一个重点需求。” | AC-A1、AC-C1、AC-D2 | 契约、编排和 UI 证据 | [ ] |

### 覆盖检查

- [x] 每个需求点都映射到至少一个 AC。
- [x] 每个 AC 都有可执行验证路径。
- [ ] UI 需求→证据映射表将在验收阶段完成。

## Dependencies

- **Evolved from**: PR #5 合入的服务端 AnalysisRun 改造；它是已实现前置能力，不代表 F001 已完整交付。
- **Blocked by**: 立项不受阻；实现前必须通过 Design Gate。
- **Related**: canonical traceability ontology 与 Analysis Agent 设计。

## Risk

| 风险 | 缓解 |
|---|---|
| 服务端扫描器丢失现有浏览器多语言能力 | 切换前强制通过 100% 经审核的多语言等价门禁 |
| Local Runner 读取未授权路径 | allowlist、`realpath`、逐条目校验、符号链接 fencing、不透明读取投影 |
| worker 崩溃导致重复工作 | 确定性 WorkUnit ID、原子检查点、租约 fencing |
| 运行期间源码变化 | 使用密封不可变 Snapshot；变化属于后续 job |
| UI 把断线误判成任务失败 | 连接状态与权威 job 状态分离 |
| 迁移后仍保留两个执行权威 | 硬切换门禁和浏览器执行器移除测试 |

## Open Questions

| # | 问题 | 状态 |
|---|---|---|
| OQ-1 | 确认“服务端 Local Runner + 显式文件系统白名单”作为第一阶段源码 connector。 | Proposed — Design Gate |
| OQ-2 | Traqen UI 与 API 不在同一台机器时，Local Runner 如何部署。 | Open — 后续 connector 设计，不阻塞本地第一阶段 |

## Key Decisions

| # | 决策 | 理由 | 日期 |
|---|---|---|---|
| KD-1 | 一个 `WorkspaceAnalysisJob` 拥有独立的 `SourceScanRun` 与 `AnalysisRun` 阶段。 | 用户需要一个持久任务，工程上需要独立检查点与失败语义。 | 2026-07-29 |
| KD-2 | 浏览器生命周期事件只能观察。 | 页面进程无法成为扫描或 Agent 执行的持久 owner。 | 2026-07-29 |
| KD-3 | 扫描器能力等价是切换门禁。 | 不能用静默丢失语言能力换取刷新安全。 | 2026-07-29 |
| KD-4 | Traqen 路线图 `Fxxx` 与受治理业务 `Feature.id` 分离。 | 工程生命周期标识不能创建或暗示业务权威。 | 2026-07-29 |

## Tips Contribution

实现后计划新增一条 Workspace 分析 tip：浏览器连接状态不会控制持久服务端任务；`sourceRef` 指向 F001 设计。

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-07-29 | F001 立项并形成详细需求基线 |

## Review Gate

- 架构级 Design Gate：审查 Local Runner 数据边界和两阶段生命周期，并在实现前取得 operator 确认。
- 实现阶段：按 Phase TDD、自检门禁、独立 review、merge-gate。

## Links

| 类型 | 路径 | 说明 |
|---|---|---|
| 详细设计 | `docs/features/workspace-scan-and-analysis-lifecycle.zh-CN.md` | 对象、状态机、安全、API、UI、验收 |
| 实施计划 | `feature-specs/2026-07-29-server-owned-workspace-scan-and-analysis-lifecycle.md` | 十二个 TDD 任务与切换门禁 |
| 当前 Workspace 设计 | `docs/features/workspace-analysis-design.zh-CN.md` | 当前行为和已知生命周期缺口 |
| Analysis Agent | `docs/features/analysis-agent-design.zh-CN.md` | Agent 阶段证据与权威规则 |
| Bug 报告 | `docs/bug-report/workspace-analysis-refresh-resume.zh-CN.md` | 根因与 PR #5 范围校正 |
