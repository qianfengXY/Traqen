> 语言：**简体中文** · [English](F006-workspace-capability-settings.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [settings, models, skills, mcp, workspace-override, runtime-isolation, frontend, user-journey]
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

## 前端产品体验

### Workspace 配置工作区

F006 在界面中区分四层：只读全局模板、Workspace Draft、解析后的 Effective Diff，以及不可变 Execution Profile Revision。页面分为：

- **Agent 与能力：** 一个 Main 槽位和一个或多个 Child 槽位，以及 Model Profile、Skill、MCP Grant、Role Policy 与 Independence Group；
- **依赖与规范：** 项目依赖、Framework/Domain 约定、约束及其 Revision；
- **安全与边界：** 数据边界、预算、Permission、Secret Handle 与 Telemetry 策略；
- **Revision 历史：** Effective Diff、Digest、创建者、校验结果，以及固定到每个 Revision 的 Run。

全局模板只作为导入来源展示。Workspace Draft 必须显式导入、覆盖、新增或移除条目，并在 Save 前预览解析后的 Effective Diff。界面绝不能显示 Secret Value，只显示 Scoped Handle、Grant 状态与受影响能力。

### 校验、冲突与 Run 固定

- **无 Effective Revision / Draft 无效：** 在准确字段展示 Model Ready、Skill Signature、MCP Permission、Secret Grant、数据边界与跨引用阻断；新 Run 保持禁用。
- **Dirty Draft：** 展示新增、修改、移除、继承与显式移除条目，但不能改变当前 Effective Revision。
- **Save Conflict：** 保留 Draft，并在显式重试前与较新的 Workspace 配置版本对比。
- **Saved：** 创建并展示新的不可变 `WorkspaceExecutionProfileRevision`，不能修改旧 Revision。
- **Active Run 固定旧 Revision：** 标明固定 Revision，并说明新设置只对新 Run 生效。

桌面端可以使用 Section Navigation 与 Effective Diff 侧栏；移动端先进入设置分区列表，再进入单个 Section 及其 Validation Summary；Save 前始终展示完整 Effective Diff 与阻断数量。

### 前端验收标准

- [ ] 用户无需检查原始配置 JSON，即可区分全局模板、Workspace Draft、Effective Configuration 与不可变 Revision。
- [ ] Main 和每个 Child 槽位分别展示独立 Model、Skill、MCP、Role 与 Independence 设置；默认两个 Child 不代表固定上限。
- [ ] Effective Diff 在 Save 前确定性展示导入、覆盖、新增与移除。
- [ ] Secret Value 绝不能出现在 Form、Diff、Prompt、序列化 Revision 或 Diagnostic 中，只能显示 Scoped Handle 与 Grant 状态。
- [ ] 无效 Draft、Save Conflict、历史 Revision 与固定旧 Revision 的 Active Run 在桌面、键盘和移动端都保留用户输入与 Authority Context。

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
