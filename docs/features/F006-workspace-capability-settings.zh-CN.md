> 语言：**简体中文** · [English](F006-workspace-capability-settings.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [settings, models, skills, mcp, workspace-override, runtime-isolation]
doc_kind: spec
created: 2026-07-31
---

# F006：Workspace 能力设置

> **Status**: spec | **Owner**: TBD | **Priority**: P0

## Why

模型、Skill、MCP、依赖知识和项目规范会显著改变分析质量。一个全局 Active Model 与全局挂载工具既无法表达某个 Workspace 的执行策略，也无法防止能力泄漏到其他 Workspace。

## What

F006 定义：

- 模型 Profile、Main/Child 角色模板、Skill、MCP 的全局模板；
- Workspace 导入、同名覆盖、新增与移除；
- 一个 Main Agent 模型与一个或多个 Child Agent 模型槽位，默认两个；
- Workspace 依赖项、规范与约束；
- 每次运行物化不可变的 `WorkspaceExecutionProfileRevision`；
- 只暴露 Workspace 解析结果的 Runtime Mount。

## 解析规则

1. 全局条目是模板，不是 Runtime 权威。
2. 新 Workspace 导入选定模板条目。
3. 同名稳定标识的 Workspace 条目确定性覆盖模板条目。
4. 显式移除优先于继承。
5. Resolver 校验模型 Ready 状态、能力/数据边界资格、Skill 签名、MCP Permission、Secret Grant 和跨条目引用。
6. 解析成功后创建带 Digest 的不可变 Revision。
7. Main/Child Worker 只能拿到该 Revision，不能查询全局 Registry。

## 用户旅程

1. 配置可复用全局模板。
2. 打开某个 Workspace 的设置。
3. 选择 Main Model，并配置一个或多个 Child 槽位。
4. 导入、新增、覆盖或移除 Skill/MCP。
5. 记录依赖项、规范、约束、预算与数据边界策略。
6. 预览 Effective Diff 与校验失败。
7. 保存新 Revision；新 Run 使用它，已有 Run 继续固定旧 Revision。

## 验收标准

- [ ] 新 Workspace 默认两个 Child 槽位，但接受任何大于等于一的数量。
- [ ] Main 与每个 Child 槽位可以选择不同的已验证 Model Profile。
- [ ] 同名 Workspace 配置确定性覆盖全局模板。
- [ ] 已移除的全局 Skill/MCP 在该 Workspace 中不可调用。
- [ ] Runtime 测试证明 Agent 无法发现或调用 Workspace Revision 中缺失的全局能力。
- [ ] 修改全局模板不能改变既有 Workspace Revision 或活跃 Run。
- [ ] 依赖与规范 Revision 进入 Planning/Input Digest。
- [ ] Secret 只通过 Scoped Handle 引用，不能序列化到模板、Execution Profile、Prompt 或 Telemetry。
- [ ] 无效或缺失能力引用必须在 Run 启动前导致解析失败。

## 当前差距

实现提交 `1682d7d` 只有加密的全局模型 Registry、一个 Active Profile 和全局装载 Reference Skill；没有 Main/Child Role 配置、Workspace Override、项目依赖/规范设置或 Workspace 级 MCP Mount。

## 依赖

F006 是 F001 的基础依赖。后续模块可以读取当前 Workspace Revision 的 Provenance，但不能自行解析能力。

## 非目标

- 静默回退到全局能力；
- 保存设置后改变活跃 Run；
- 把成功连接模型当作能力校准。
