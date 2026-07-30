> 语言：**简体中文** · [English](branch-review-publication-policy.md)

# 代码分支 Review 发布政策

当模型或 reviewer 接到针对指定分支或 commit 的 Review 任务时，必须遵守本政策。本政策约束 Review
产物和 Finding 的发布方式，不授权实施代码修改。

## 1. 被审仓库保持只读

- 开始 Review 前，记录仓库、目标分支和被审 commit 的完整 SHA。
- Review 期间不得修改被审源码，也不得把 Review 专用产物提交到项目仓库的任何分支。
- Review 笔记、报告、收敛矩阵和共识文档都属于 Review 专用产物。
- 修复代码必须另行取得实施授权并使用独立分支。

不同 commit SHA 的 Review 不属于对同一目标的独立审查，不得合并为共识。

## 2. 先独立 Review，再进行收敛

- 至少两个不同模型或 reviewer 身份必须独立 Review 同一个 commit。
- 每个 reviewer 必须先完成并标注时间的证据化 Finding，之后才能阅读或引用其他 reviewer 的结论。
- 每份独立记录必须保留 reviewer 的真实身份和原始表述；收敛者不得冒充其他 reviewer。
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

## 4. 只通过 Issue tracker 发布

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

要求 Review 某个分支，即代表授权发布通过本政策门槛的 Finding，除非请求者明确要求仅输出草稿。
任何未通过共识门的 Finding 都不得发布。

## 5. 本地 Review 记录不得进入 Git

reviewer 可以在本地保留独立笔记和收敛记录。在可行时，应将它们放在仓库根目录之外。如果工具必须
使用仓库内相对路径，则使用：

```text
.review-local/<target-branch>/<reviewed-sha>/<reviewer-id>.md
.review-local/<target-branch>/<reviewed-sha>/consensus.md
```

`.review-local/` 已被 Git 明确忽略。本地 Review 记录不得被暂存、提交、推送、附加到 Release，或
作为仓库中正式发布的 Review 结果。结束 Review 前，必须验证 `git status --short` 不包含 Review
产物。

仓库中既有的已跟踪 Review 产物属于历史记录，不构成新的 Review 可以继续提交文档的先例。

## 6. 门槛不满足时默认不发布

出现以下任一情况时不得发布 Issue：

- 少于两个独立 reviewer 审查了目标；
- reviewer 审查的 commit SHA 不同；
- 证据无法复现或定位；
- reviewer 未形成实质共识；或
- 无法证明 reviewer 之间相互独立。

此时应说明未满足哪一道门，并把 Finding 保留在本地。发布成功时，应报告 Issue URL 或编号、被审
SHA、确认结论的 reviewer，以及本地记录位置。
