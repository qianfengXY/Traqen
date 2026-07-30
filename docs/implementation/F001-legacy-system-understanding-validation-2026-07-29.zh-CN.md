> 语言：**简体中文** · [English](F001-legacy-system-understanding-validation-2026-07-29.md)

# F001 存量系统理解实施验证

**状态：** 已实现
**Feature 真相：** `docs/features/F001-legacy-system-understanding.zh-CN.md`
**实施计划：** `feature-specs/2026-07-29-legacy-system-understanding-engine.md`

## 已交付

- 完整且封存的 `ArtifactInventory`，显式区分纳入、排除、不支持、生成、二进制、超大、秘密脱敏和读取失败。
- Allowlist 本地不可变 Snapshot 捕获、Symlink/路径围栏、秘密安全捕获，以及只接受 Artifact ID 的 `SourceSlice` 访问。
- 从 Inventory 派生的确定性 `UnderstandingPlan`、稳定分区、零未分配 Artifact、有界动态 WorkUnit DAG 和显式预算 Gap。
- 版本化提取器与模型能力合同、Direct-source/Fact-dependent Skill 模式、持久 Route Decision、无合格 Producer 时失败关闭，以及独立 Producer/Critic 路由。
- 六条可独立观测的理解通道、文档/契约与测试/配置/结果提取器、证据有界 Candidate 对账、ConflictLedger 行为和显式 Candidate 缺失。
- 带分母的多维审核评估、Truth Set 泄漏拒绝、重放/增量维度和 `traqen-self-v1` calibration Fixture。
- 首次 FULL、后续 AUTO→INCREMENTAL、受影响/复用 WorkUnit 选择、等价检查、不可变 GraphRevision 历史、评估门禁发布，以及 Memory/PostgreSQL 中的 CurrentGraphHead 原子 CAS。
- 从源码扫描到发布的一条服务端持久 Job 阶段序列、Pause/Resume 语义与带 fencing 的 Worker 支持。
- 当前图谱、GraphRevision 历史、Feature 历史、Impact、发布和 SourceSlice API。
- Web 仅通过 GET 读取 CurrentGraphHead 与 Revision 历史，并与治理前本地 Candidate 做视觉区分。

## 验证

- 后端：251/251 测试通过，覆盖回环 HTTP、PostgreSQL 迁移、受控 Runner、参考 Pilot、F001 对抗场景和 Traqen 两 Snapshot 自分析。
- Web：生产构建和 41/41 测试通过。
- Web Lint：通过。
- Diff 空白检查：通过。
- Traqen 自校准：30 个锚点、10 项能力、60 条必须关系、30 条禁止关系、100% Inventory 处置、FULL→INCREMENTAL 图谱头移动。

仓库中提交的 Truth Set 是 calibration 材料。生产发布可注入单独受控的 held-out Truth Set 与独立 Reviewer 身份，无需修改运行时合同。
