> 语言：**简体中文** · [English](workspace-analysis-refresh-resume.md)

---
feature_ids:
  - workspace-analysis
topics:
  - workspace
  - analysis-run
  - checkpoint
  - pause-resume
doc_kind: bug-report
created: 2026-07-27
---

# Workspace 分析刷新后被改成暂停

## 诊断胶囊

| 字段 | 证据 |
|---|---|
| 现象 | Workspace 分析运行时刷新浏览器，任务会显示为已暂停；点击继续后又出现一套新的 Agent 会话，并重复主 Agent 规划。 |
| 最小复现 | 启动本地 Workspace 分析，等待至少写入一个检查点，刷新页面，然后查看任务状态并点击“继续分析”。 |
| 首个错误边界 | `WorkspaceAnalysisView` 不管 IndexedDB 中持久化的是 `RUNNING` 还是 `PAUSED`，恢复时都无条件改成 `PAUSED`。 |
| 根因 | 执行器属于浏览器页面生命周期，刷新会结束旧页面的 JavaScript 调用；恢复 Effect 随后丢弃持久状态并要求人工重启。续跑虽然会过滤已持久化的模型分类，但会重新生成可见任务会话和模型规划，因此看起来、并且部分行为上都像新运行。 |
| 修复 | 先持久化 `RUNNING` 再展示“暂停”控制；保留全部持久运行状态；只有 `RUNNING` 自动接续；在当前工作单元边界前先持久化明确的暂停意图；区分 `PAUSED` 与 `FAILED`；沿用同一运行 ID；只重建剩余队列；跳过已完成文件记录和模型分类。 |
| 安全边界 | 原始源码仍然只留在浏览器。刷新恢复使用已保存的目录句柄和 IndexedDB 检查点；如果目录权限不可用，任务保留持久运行状态并要求重新授权，而不是声称仍在推进。 |

## 回归覆盖

- `RUNNING` 检查点恢复后仍为 `RUNNING`，自动接续且没有伪造结束时间。
- 新任务或人工恢复的任务只有在 `RUNNING` 检查点确认落盘后才开放“暂停”操作。
- 人工暂停的检查点保持暂停，必须人工点击继续。
- 失败检查点保持失败，不冒充用户暂停。
- 同一模型与证据策略下已完成分类的候选不会再次入队。
- 源码契约测试要求自动接续、显式暂停持久化、稳定运行身份与仅剩余工作规划。
