> 语言：**简体中文** · [English](F004-claim-review.md)

---
feature_ids: [F004]
related_features: [F001, F002]
topics: [claim-review, batch-review, evidence, governance]
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
