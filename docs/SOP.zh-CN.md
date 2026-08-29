> 语言：**简体中文** · [English](SOP.md)

---
topics: [sop, workflow, review, acceptance]
doc_kind: note
created: 2026-08-25
updated: 2026-08-29
---

# 标准操作流程

Traqen 在本仓库中维护产品真相源，并把 Cat Café 用作协作、Review 和验收控制平面。聊天状态与仓库状态不一致时，以 Git 提交和项目文档为准。

## 交付工作流

| 步骤 | 必需结果 | 证据 |
|------|----------|------|
| 1. 发现 | 在提出变更前阅读当前代码、文档、历史和 operator 需求 | 带代码/文档/提交锚点的现状报告 |
| 2. 设计门 | 记录用户旅程、范围、非目标、架构、风险和验收标准；取得 `.traqen-local/design-write-policy.md` 所要求的确认 | 已确认 Feature/规格和设计提交 |
| 3. 隔离实施 | 创建专用分支/worktree；绝不对生产数据实验 | Worktree 路径、分支、基准 SHA |
| 4. Red–Green–Refactor | 对行为或回归风险变更先提供可观察的 RED 证据，再实现并重构 | 先失败后通过的针对性测试 |
| 5. 质量门 | 将准确实现 SHA 与已确认设计比较，并运行匹配风险的 lint、type、test、build 和用户旅程检查 | 准确命令、输出、未覆盖风险 |
| 6. 独立 Review | 遵从 `docs/policies/branch-review-publication-policy.md`；Review 者独立检查同一准确 SHA，并把仅 Review 记录留在 Git 之外 | 独立发现和有证据支撑的收敛 |
| 7. 合入和验收 | 解决阻断发现、通过合入门，再在隔离验收环境验证已合入结果 | 合入回执、验收证据、路线图更新 |

## 仓库与数据边界

- 不得重写或复用已有 F 编号来代表新工作。
- 不得提交本地 Review 记录、凭据、生成的浏览器日志、构建缓存或生产数据。
- 本地开发和测试必须使用隔离存储与端口；Clowder AI 端口 `3003`、`3004` 和 Redis `6399` 已保留。
- 对设计、架构、ADR、Feature 规格、生命周期文档及其索引的变更，需要满足 `AGENTS.md` 中的本地确认门。
- 禁止同一人自审。请求 Review 一个分支或 SHA 时，也会触发更严格的双 Review 发布政策。

## 项目重启规则

项目重启会创建新的 Feature 和基线；它不会删除仓库、替换 Mission Hub 项目 ID，也不会抹除早期 Feature 历史。重构获批后，其活动 Feature 文档和路线图条目会替代重启条目；原条目仍可通过 Git 历史恢复。
