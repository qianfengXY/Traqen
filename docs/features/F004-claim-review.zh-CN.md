> 语言：**简体中文** · [English](F004-claim-review.md)

---
feature_ids: [F004]
related_features: [F001, F002]
topics: [claim-review, batch-review, evidence, governance, frontend, user-journey]
doc_kind: spec
created: 2026-07-31
---

# F004：声明审核

> **Status**: spec | **Owner**: TBD | **Priority**: P0

## Why

Traqen 必须对弱证据 Fail Closed，但不能把审核变成一次只能处理一个 ID 的诊断表单。审核人需要 Workspace 队列、批量操作，以及修正自动准入结果的能力。

## What

F004 负责以下对象的 Review Projection 与 Decision Command：

- 证据不足或存在冲突的 Candidate；
- 策略抽样对象；
- 自动准入的 Candidate Mapping；
- 增量变化后已经过期的 Outcome。

自动准入是可逆审核状态。只有授权 Decision 能创建或修改 Governed Object。

## 用户旅程

1. 打开当前 Workspace 的审核队列。
2. 按证据状态、Candidate 类型、风险、源码 Module、模型/Skill Provenance 或变化状态过滤。
3. 选择一个或多个兼容条目。
4. 检查源码证据与冲突；编辑规范化陈述、Scope、Mapping 与 Rationale。
5. 确认、驳回、延期、标记证据不足或记录例外。
6. 查看不可变 Audit Event；遇到乐观并发冲突时明确失败，不能静默覆盖。

## 前端产品体验

### Workspace 审核队列

F004 直接打开当前 Workspace 队列，不能要求输入 Run 或 Candidate ID。页面包含：

- 按证据状态、Candidate 类型、风险、源码 Module、模型/Skill Provenance 和变化状态筛选；
- 按阻断风险与陈旧程度排序的队列，并保留可恢复的选择与筛选状态；
- 具备兼容性校验的批量工具栏，解释所选条目为何能或不能共用命令；
- Detail/Decision 工作区，展示源码证据、Agent Provenance、Conflict、Confidence Cap、不可变历史，以及可编辑的规范化陈述、Scope、Mapping 与 Rationale；
- 在命令合同允许时提供明确的 Confirm、Reject、Defer、Insufficient Evidence 与 Record Exception 结果。

批量选择只是命令包络，不是一条全有或全无的 Decision。客户端在提交前校验兼容性；服务端为每项记录独立 Decision 与 Audit Event，结果视图保留成功、失败和可重试条目。

### 完整性、冲突与响应式状态

- **空队列：** 说明当前筛选或 Workspace 没有审核项，并在授权时提供已完成/历史视图。
- **Evidence 无效：** 在删除无效 Resolver 或替换为授权证据前禁用 Confirm，同时保留已编辑内容。
- **版本冲突：** 对比用户输入与服务端新版本，并要求显式提交新命令；绝不能静默覆盖任一方。
- **批次部分失败：** 保留批次回执与逐项结果，只允许重试符合条件的失败项。
- **Workspace 切换：** 有本地编辑时先提示，随后清除选择与未提交命令；绝不能把它们提交给新 Workspace。

桌面端使用 Queue/Detail 多栏；移动端改为 Queue 到 Review 的逐级导航，提交前始终显示 Decision 摘要，返回后恢复队列位置。Reviewer Identity 与 Authority 由服务端拥有，不能用自由文本冒充可信身份。

### 前端验收标准

- [ ] 队列进入、筛选、证据检查与 Decision 都不要求手工输入 Run 或 Candidate ID。
- [ ] 不兼容批量选择在提交前解释不兼容的命令或 Authority Boundary。
- [ ] 每项保留独立 Decision/Audit 结果，包括批次部分失败与重试状态。
- [ ] 编辑期间始终展示无效 Evidence、Confidence Cap、Conflict、自动准入状态和不可变历史 Decision。
- [ ] 并发编辑保留双方输入，桌面、键盘与移动端旅程均能完成同一受治理 Decision。

## 验收标准

- [ ] 队列绑定 Workspace，不要求手工输入 Run/Candidate ID。
- [ ] 批量操作会验证所选条目命令兼容，并为每项保留独立 Decision/Audit Event。
- [ ] 审核人可以在自动准入前后通过新 Decision 编辑条目，不能修改历史。
- [ ] 证据无效 Candidate 在删除无效引用或替换为授权证据前不能 Confirm。
- [ ] 审核期间始终展示 Conflict 与 Confidence Cap。
- [ ] 并发编辑返回版本冲突，并保留双方输入。
- [ ] 批量操作可恢复，并显式展示部分失败。

## 当前差距

实现提交 `1682d7d` 可以通过手工 ID 加载一个 Reverse Candidate 并提交一条 Review；没有 Workspace Queue、批量命令或自动准入编辑器。

## 依赖

F001 提供 Candidate、Ledger、Identity 与权威边界；F002 提供 Feature/API Context 与证据详情投影。

## 非目标

- 多数票审核；
- 修改历史 Decision；
- 隐藏已驳回或证据不足结果。
