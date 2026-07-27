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

# Workspace 分析错误地由浏览器页面持有

## 诊断胶囊

| 字段 | 证据 |
|---|---|
| 现象 | 刷新浏览器会销毁正在执行的分析器。旧恢复界面要么显示暂停，要么从浏览器检查点重启工作，尽管用户没有触发生命周期迁移。 |
| 最小复现 | 启动本地 Workspace 分析，等待模型 WorkUnit 执行，连续刷新页面，然后比较执行器、run ID、状态和已完成单元数。 |
| 首个错误边界 | `WorkspaceAnalysisView` 在一个 React 组件内同时拥有文件循环、模型批次循环、暂停标志、Agent 任务和 `RUNNING` 状态；页面卸载会销毁唯一执行器。 |
| 已确认根因 | IndexedDB 只能让数据可恢复，不能让执行持久化。浏览器 Promise 在页面消失后无法兑现服务端式 `RUNNING` 契约。第一版补丁只是保留/重放浏览器状态，仍把刷新当成执行事件，因此不满足需求。 |
| 正确修复 | 确定性源码准备留在本地，只把有界派生观察归一化为 canonical Facts，然后启动已有的服务端异步 AnalysisRun。浏览器只保存订阅、执行只读轮询，并且只在用户显式操作时发送 Pause/Resume。 |
| 安全边界 | 完整源码、原始文件、真实 `.env` 和未脱敏秘密仍留在本地；只有有界派生观察进入服务端 Fact 边界。 |

## 回归覆盖

- 反复挂载、刷新和重连只发送 `GET`，绝不发送 Pause、Resume 或 Start。
- 只有服务端响应能够展示 `RUNNING`。
- 人工暂停的检查点保持暂停，直到用户显式调用 Resume。
- Resume 保持同一服务端 run ID 和已完成 WorkUnit。
- 确定性的 run 指针先于 Start 持久化，关闭 `202 Accepted` 响应前后的刷新竞态窗口。
- 即使文件大小与派生候选未变化，源码内容指纹仍参与 Snapshot 身份计算。
- 观察 payload 拒绝原始代码和含秘密的配置值。
- 完成结果只允许投影到订阅绑定的 project、Snapshot 和 run。
