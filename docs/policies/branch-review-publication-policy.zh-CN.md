> 语言：**简体中文** · [English](branch-review-publication-policy.md)

# 代码分支 Review 发布政策

本政策分为两层：通用审阅保障适用于任何被请求的分支或 commit Review；发布门只约束准备发布为
Traqen Issue 的候选 Finding。它不授权实施代码修改，也不单独定义分支合入本地 `main` 的 reviewer
数量或合入职责。普通分支 Review 的非作者审阅、精确 SHA 覆盖、反馈处理和合入门禁遵从《标准操作流程》
及 Cat Café 的风险路由。

普通分支 Review 不会自动进入本发布门：它只需满足本地合入所选的风险匹配审阅来源。只有 operator
或 Review 请求明确要把某条候选 Finding 发布为 Traqen Issue 时，才适用本政策的双独立 Review 与共识要求。

## 1. 所有被审仓库保持只读

以下通用审阅保障适用于任何被请求的分支或 commit Review，包括没有 Issue 发布意图的普通本地合入审阅。

- 开始 Review 前，记录仓库、目标分支和被审 commit 的完整 SHA。
- Review 期间不得修改被审源码，也不得把 Review 专用产物提交到项目仓库的任何分支。
- Review 笔记、报告、收敛矩阵和共识文档都属于 Review 专用产物。
- 修复代码必须另行取得实施授权并使用独立分支。
- 每份 Review 记录必须保留 reviewer 的真实身份和原始表述；任何 reviewer 或收敛者不得冒充他人。

不同 commit SHA 的 Review 不属于对同一目标的独立审查，不得合并为共识。

## 2. 发布前先独立 Review，再进行收敛

- 准备发布 Issue 的候选 Finding，至少两个不同模型或 reviewer 身份必须独立 Review 同一个 commit。
- 每个 reviewer 必须先完成并标注时间的证据化 Finding，之后才能阅读或引用其他 reviewer 的结论。
- reviewer 看过他人 Review 后才产生的一致意见属于补充核验，不能单独满足独立确认门槛。

## 3. 共识必须由证据支撑

Finding 只有在至少两个独立 reviewer 同时满足以下条件时才可发布：

1. 针对同一个 commit 识别出相同的底层缺陷或风险；
2. 提供可验证的代码锚点、测试、日志、契约不一致或可复现反例；
3. 对实质影响达成一致；并且
4. 对必须修改的方向或验收条件达成一致。

表述相似、多数表决或重复猜测都不等于证据。仅由一方提出、存在争议或未经验证的 Finding 必须留在
本地，不得发布为项目 Issue。

收敛记录必须把每条可发布 Finding 映射回各份独立 Review，并保留有实质意义的分歧或范围差异。

## 4. Review 描述使用简体中文

用于发布门的每条正式独立 Finding，以及收敛或共识描述，都必须使用简体中文。

- 应描述问题、严重级别、证据、影响、建议修改、验收条件和分歧。
- 代码符号、路径、命令、日志、标识符、commit SHA 和引用的源文本保持原样；必要时补充中文解释。
- 补充译文可选，且不得遗漏、削弱、强化或以其他方式改变结论。
- 非正式草稿笔记可以使用其他语言，但在必需的简体中文描述完成前，不能作为独立确认或共识记录。

## 5. 只通过 Issue tracker 发布内容

共识门通过后，对已确认 Finding 去重，并且只通过项目的 Issue tracker 发布。不得以向仓库提交
Review 报告或共识文档的方式发布结果。

除非仓库的 Issue 约定要求合并报告，否则每个可独立执行的 Finding 应建立一个 Issue。每个发布的
Issue 必须包含：

- 目标分支和被审 commit 的完整 SHA；
- 问题说明和严重级别；
- 受影响的代码或契约位置；
- 验证或复现证据；
- 影响；
- 建议修改和可观察的验收条件；
- 确认该 Finding 的 reviewer 身份；以及
- 尚未解决的分歧或开放问题（如有）。

Issue 的标题和正文必须使用简体中文。补充译文可选，但不得替代上述任何必填字段。

进入发布门必须由 operator 或 Review 请求明确说明“发布 Issue”；普通分支 Review 的 Finding 应先交由
作者在本地分支合入流程中处置，不得自动发布。任何未通过共识门的 Finding 都不得发布。

## 6. 本地分支合入和远端同步

- 本地 `main` 是唯一合入真相源；所有实现和文档分支都必须先完成本地 Review 与门禁，再合入本地 `main`。
- 侧分支及其 Review/验收 worktree 只留在本地，不得推送侧分支，也不得通过远端分支或远端 PR 绕过本地 `main`。
- 合入后在本地 `main` 上完成适用的验收，再仅从本地 `main` 推送到 `origin/main`；远端仓库仅保留 `main` 分支。
- 远端 `main` 与本地 `main` 确认为同一提交后，立即删除已合入的本地分支并移除对应 worktree；有未提交内容或仍被运行任务占用时，先保全并报告，不得强制清理。
- 本发布门不为分支合入本地 `main` 增加第二位 reviewer；第二份独立 Review 只在发布 Issue 的候选 Finding 需要共识时触发。

## 7. 本地 Review 记录不得进入 Git

任何 Review 的 reviewer 都可以在本地保留独立笔记；进入发布门时还可以保留收敛记录。在可行时，应
将它们放在仓库根目录之外。如果工具必须使用仓库内相对路径，则使用：

```text
.review-local/<target-branch>/<reviewed-sha>/<reviewer-id>.md
.review-local/<target-branch>/<reviewed-sha>/consensus.md
```

`.review-local/` 已被 Git 明确忽略。本地 Review 记录不得被暂存、提交、推送、附加到 Release，或
作为仓库中正式发布的 Review 结果。结束 Review 前，必须验证 `git status --short` 不包含 Review
产物。

仓库中既有的已跟踪 Review 产物属于历史记录，不构成新的 Review 可以继续提交文档的先例。

## 8. 发布门门槛不满足时默认不发布

对于准备发布 Issue 的候选 Finding，出现以下任一情况时不得发布：

- 少于两个独立 reviewer 审查了目标；
- reviewer 审查的 commit SHA 不同；
- 证据无法复现或定位；
- reviewer 未形成实质共识；
- 必需的 Review 或 Issue 内容缺失；或
- 无法证明 reviewer 之间相互独立。

此时应说明未满足哪一道门，并把 Finding 保留在本地。发布成功时，应报告 Issue URL 或编号、被审
SHA、确认结论的 reviewer，以及本地记录位置。
