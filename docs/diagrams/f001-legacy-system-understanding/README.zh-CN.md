> 语言：**简体中文** · [English](README.md)

---
feature_ids: [F001]
related_features: []
topics:
  - legacy-system-understanding
  - architecture-diagram
  - analysis-agent
  - archify
doc_kind: design-artifact
created: 2026-07-30
status: proposed
priority: P0
---

# F001 Archify 图

这些图是已批准 F001 设计的视觉投影。设计文档仍是权威真相源；仓库中的
Archify JSON 是可复现的制图源。

| 图 | 静态预览 | 可交互产物 | Archify 源 |
|---|---|---|---|
| 存量系统理解架构 | [PNG](understanding-architecture.png) | [HTML](understanding-architecture.html) | [JSON](understanding-architecture.architecture.json) |
| Analysis Agent 执行工作流 | [PNG](analysis-agent-workflow.png) | [HTML](analysis-agent-workflow.html) | [JSON](analysis-agent-workflow.workflow.json) |

## 交付回执

| 图 | Specification SHA-256 | Artifact SHA-256 | 校验 | 视觉审核 |
|---|---|---|---|---|
| 架构 | `a475d4a62ce29a4e0692e7d9eec2c0f4b5ce408c6f5d329620f71139330eaa2d` | `1a5eeb47c2c36eb38bf79034bdd51a98519bd0cb84209a56cd3dc25675b9d603` | showcase 9/9；0 error；0 warning | 通过；0 轮修正 |
| 工作流 | `0de8e4ca9bd4444645e4dfaa825f5f8782ba31556dbc67ff6ffbb9a79084eef1` | `c2f09c59db0515d00c4b374447d45a85b3ff5efb6add3271e9e7d28ce1e5aa95` | showcase 9/9；0 error；0 warning | 通过；1 轮修正 |

架构图展示完整源码主路径、原始源码安全边界、模型/Skill 路由、对账边界、
受治理 Decision 路径与原子发布。工作流图展开确定性 Inventory 分区、有界
WorkUnit 执行、可选 Facts、层级汇总、选择性 Critic、对账与显式 Gap。
