> 语言：**简体中文** · [English](README.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [workspace-settings, global-assets, cli, auth, agents, skills, mcp, frontend, convergence]
doc_kind: feature-discussion
created: 2026-08-28
status: converged
decision_status: operator-authorized
---

# F006 设计收敛：Workspace 能力设置

## 决策记录

co-creator 否决此前所有 F006 文档作为产品输入，要求团队从明确目标重新开始：先在全局设置账号、模型、Skill、MCP，再为 Workspace 配置一个 Main、一个或多个 Child 与项目级 Skill/MCP 管理。

三份独立方案经过对照、公开质疑和原意核验后收敛。本文保留过程；当前验收合同以 [F006 规范](../../docs/features/F006-workspace-capability-settings.zh-CN.md) 为准。

## 已确认的产品决策

| 主题 | 最终决定 | 原因 |
|---|---|---|
| 认证 | 只有 API Key、OAuth | CLI 是执行客户端，不是第三种认证。 |
| CLI OAuth | CLI 自己登录；Traqen 只检测、提示、重新检查 | Traqen 不应持有 Token 或编排客户端登录。 |
| v1 Runtime | 仅支持已安装的受支持 CLI | 自研 Agent、直接 API 执行属于未来工作，不偷渡进 v1。 |
| Child Agent | 默认且最少一个 | 满足“一个或多个”，不伪造默认分析策略。 |
| 全局 inactive | 是不可用上限 | Workspace 不能重新启用 inactive 全局 Skill/MCP。 |
| 项目能力定制 | 禁用继承资产或新增独立本地资产 | v1 不支持全局 Manifest 替换、同身份 fork 或字段 patch。 |
| 全局变更传播 | 可更新目录可选性；不自动授权 | 新资产不能静默扩大 Agent 权限。 |
| 草稿生命周期 | 自动保存草稿，显式应用产生生效版本 | 可探索而不静默影响下一次运行。 |
| 运行生命周期 | 生效版本产生不可变执行快照 | 运行中/暂停中分析可解释，不会热切换。 |
| 全局删除 | 输入能力名称确认并展示影响 | 可删除，但不隐藏跨 Workspace 后果。 |

## 前端收敛

最终体验有顶层设置中心（全局/Workspace 范围选择）和 Workspace 内直达齿轮。全局设置为账号、模型、Skill、MCP 四个独立页。

Workspace 设置有固定就绪摘要和两页：

1. **Agent 设置：** Main/Child 团队卡片，桌面端检查器、小屏抽屉；`Child 1` 默认存在但未配置完成。
2. **能力管理：** 可用全局继承、本 Workspace 禁用、Workspace 本地、全局不可用四组。此页只管理 Workspace 可用性；Agent 授权在 Agent 设置完成。

状态必须同时用文本和可执行动作表达，不能只依赖颜色。改动自动保存为草稿，应用版本必须显式。启动确认只发生在某生效版本的首次运行或该版本变更后，不在版本不变时反复打扰。

## 质疑结果

独立复核提出并纳入两处修正：

1. 全局不可用不能被写成 Workspace 主动禁用，必须单列 **全局不可用 / 需要处理**。
2. 只有生效配置仍实际授权了不可用能力时才阻断新运行；未授权的目录条目不能阻断。

复核者确认修正后仍保留各自原意。随后 co-creator 明确授权将方案写入正式设计文档并拆分实施计划。

## 排除范围

- 不复用被否决的旧模板/覆盖设计；
- 不由 Traqen 执行 OAuth 登录；
- 不允许 CLI 配置执行任意 Shell 命令；
- 不在 v1 引入直接 API 模型执行或自研 Agent；
- 不混淆项目可用性与 Agent 授权。

## 可追溯性

- 产品合同：[F006 规范](../../docs/features/F006-workspace-capability-settings.zh-CN.md)
- 实施计划：[F006 计划](../../feature-specs/2026-08-28-f006-workspace-capability-settings.md)
- 架构影响：[产品架构](../../docs/architecture/traqen-product-architecture.zh-CN.md)
- 相关消费者：[F001](../../docs/features/F001-legacy-system-understanding.zh-CN.md)
