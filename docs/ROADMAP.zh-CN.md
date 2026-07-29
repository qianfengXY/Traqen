> 语言：**简体中文** · [English](ROADMAP.md)

# Traqen Feature 路线图

Traqen 使用仓库内独立的 `Fxxx` 序列跟踪工程 Feature 生命周期。

- ID 使用三位补零、单调递增且永不复用。
- `docs/features/Fxxx-*.md` 是一个 Feature 的稳定聚合入口。
- 活跃 Feature 出现在本路线图；完成后的 Feature 聚合文档永久保留并可追溯。
- `Fxxx` 路线图编号是工程交付标识，**不是** Traqen 追溯本体中受治理的业务 `Feature.id`。
- 历史文档在归入某个 `Fxxx` 前可以保留主题式 `feature_ids`；新正式 Feature 使用 `Fxxx`。

## 活跃 Feature

| ID | 优先级 | Feature | 状态 | Owner | 来源 | Spec |
|---|---|---|---|---|---|---|
| F001 | P0 | 存量系统理解与 Canonical Graph 构建 | spec | CodeX | operator 核心需求 | [F001](features/F001-legacy-system-understanding.zh-CN.md) |
