> 语言：**简体中文** · [English](F001-review-fixes-validation-2026-07-30.md)

# F001 Review 修复验证 — 2026-07-30

## 范围

本次验证关闭 F001 在提交 `433a2d0` 后形成的共同审查意见。

- 生产启动链路现在由一个持久 Job 负责遗留系统理解的七个阶段。
- SourceRegistration 受允许目录约束；Snapshot 字节只捕获一次，并经过暂存、校验、密封和原子发布。
- Candidate 对账使用绑定 project、Snapshot、run 和 WorkUnit 的不可变 evidence allowset。
- 任一必需分母缺失时，Evaluation 都会 fail closed。
- 增量失效沿完整反向依赖闭包传播。
- GraphRevision 引用不可变 graph artifact，并由 CurrentGraphHead 解析。
- Web 图谱在存在发布版本时默认读取 CurrentGraphHead 产物，并保持 Candidate 与受治理节点的视觉区分。
- 设计、领域模型、JSON Schema、OpenAPI、Store 和客户端统一使用同一份 ArtifactInventory 与 SourceSlice 契约。

## 验收证据

- 后端：257 项测试通过。
- Web：生产构建及 41 项测试通过。
- Web lint：通过。
- 契约 JSON 解析及契约测试：通过。
- Traqen-on-Traqen：真实源码副本完成 `FULL(snapshot-1) → INCREMENTAL(snapshot-2) → 独立 FULL(snapshot-2)`，语义图谱等价。
- 回归覆盖 foreign SourceSlice evidence、捕获期间 Snapshot 变更、零分母以及三层依赖 DAG。
- `git diff --check`：通过。

实现保留在审查分支，未合并进入 `main`。
