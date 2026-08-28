> 语言：**简体中文** · [English](README.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [workspace-settings, global-models, cli-runtime, skills, mcp, capability-overlay, persistence, model-retirement]
doc_kind: discussion
created: 2026-08-11
status: superseded
superseded_by: feature-discussions/2026-08-28-F006-workspace-capability-settings-design/README.md
---

# F006 讨论：不依赖模板的持久化 Workspace 能力设置

> **历史记录，不是产品真相。** 本文已被 [2026-08-28 F006 设计收敛](../2026-08-28-F006-workspace-capability-settings-design/README.zh-CN.md) 与当前 F006 规范取代；其中 API Runtime、项目覆盖、模型退役、至少两个 Child 等假设不可用于实施。

## 操作者诉求

F006 需要支持全局模型管理、内置与项目 Skill/MCP 管理，并为每个 Workspace 配置一个 Main Agent 和至少两个 Child Agent。配置必须持久化；启动分析以后仍可编辑，但运行中的分析固定原来的不可变执行 Profile，不能热切换。

## 对旧方案的修正

旧方案以“全局模型/角色/Skill/MCP 模板”为中心，无法满足本轮要求：

1. 本版不提供可编辑模板；
2. 模型是可复用连接资产，不属于 Skill/MCP 目录；
3. Child Agent 的硬下限是两个；
4. 必须定义项目能力禁用、本地 CLI、持久化草稿、不可变激活和跨 Workspace 模型替换。

## 收敛后的权威边界

```text
全局模型注册表（API / allowlist 本地 CLI）
                         +
只读内置 Skill/MCP 目录（允许为空）
                         +
Workspace 项目能力注册表 + disabled typed keys
                         v
有效目录 -> Main + Child slots 2..N
                         v
持久化草稿 -> 验证并激活
                         v
不可变 WorkspaceExecutionProfileRevision -> 新 Run
```

系统不存在全局活动模型、角色模板、隐式导入或运行时全局回退。

## 能力解析

```text
merged = overlayByTypedKey(builtin, project)
effective = merged - disabledKeys
runtime = effective intersect agentGrants
```

- 能力身份是 `(kind, normalizedName)`，所以同名 Skill 与 MCP 可以共存。
- 项目条目对同 typed key 的内置条目执行完整替换，不进行字段级合并。
- 禁用发生在覆盖以后；禁用项目 override 不会暴露被覆盖的内置条目。
- 删除 override 仅在 typed key 未禁用时重新暴露内置条目。

## 草稿、激活与运行固定

无效草稿也必须持久化并保留字段级错误。验证成功后生成不可变执行 Profile，包含精确模型 revision、Skill/MCP artifact revision、策略、约定、依赖和目录来源摘要。运行开始时固定 Profile；暂停、恢复和设置修改都不能替换它。新激活的 revision 仅供后续 Run 使用。

## 模型与 CLI 安全

- API 模型保存 endpoint、model 和加密 credential handle；明文 token 不进入返回、diff、日志或 revision。
- CLI 只允许 CODEX、CLAUDE、GEMINI、KIMI adapter；adapter 直接构造 argv，禁止 shell、插值和任意命令字符串。
- CLI 执行必须限制超时和输出，支持取消并清理进程树。
- 验证只证明连接就绪，不代表该模型胜任所有分析角色。

## 模型替换与退休

删除被引用模型前，服务端生成覆盖所有当前 Workspace 引用的替换计划。Apply 不接受客户端 Workspace 子集；任何版本冲突或验证失败都必须整体回滚。成功后旧模型进入 `RETIRING`，历史 revision 和活动 Run 不被改写。活动 Run 结束后才可进入 `RETIRED`。紧急撤销凭据是单独的显式破坏性动作。

## 产品界面

- Global Settings 提供 Model Library、验证、编辑和替换影响抽屉。
- Workspace Settings 分为 Agents、Skills、MCP、Dependencies and Conventions、Security and Boundaries、Revision History。
- Agent 能力使用结构化 selector，不使用逗号文本框。
- 能力行与相关 Agent 卡片原位显示来源、override/addition、disabled、validation 和 used-by-Agent 状态。
- 桌面端使用分区导航和摘要侧栏；窄屏使用单分区视图与固定操作摘要。

## 明确拒绝的方案

- 可编辑全局模板或全局活动/回退模型；
- 任意 shell 命令或用户自定义 argv；
- 仅以名称作为能力身份；
- 内置与项目 MCP 的字段级合并；
- 禁用 override 后静默回退内置条目；
- 模型替换时选择部分 Workspace；
- 改写历史 revision 或热切换活动 Run；
- 静默扫描或改写用户仓库。

完整的独立观点、分歧处理、设计上下文和收敛检查保留在 [English](README.md) 记录中；本页提供与实现决策一致的中文权威摘要。
