> 语言：**简体中文** · [English](asynchronous-reverse-run-validation-2026-07-15.md)

# 异步反向运行验证 — 2026-07-15

## 设计义务

逆向分析可能比 HTTP 请求的寿命更长。该设计要求其阶段可查询和可审计，并且需要超时、重试、取消和恢复，而不是单个不透明的阻塞调用。

## 实施的工作边界

现有的同步端点仍然兼容。调用者选择使用 `Prefer: respond-async` 或 `?async=true` 进行异步执行；服务器在返回 `202` 之前保留不可变请求和 `QUEUED` 事件。

作业投影重播有序事件：

```text
QUEUED → STARTED → COMPLETED | FAILED | CANCELLED
                    ↑
             CANCEL_REQUESTED
```

最终的 ReverseRun 保留其详细设计状态（`CREATED` 到 `WAITING_REVIEW`、`FAILED` 或 `CANCELLED`）和每次 Skill 尝试。作业层回答 transport/worker 生命周期，而不替换该域审核。

## 取消和恢复

一个活动的作业拥有一个 AbortController。取消首先保留 `CANCEL_REQUESTED`，然后发出用于 Skill 超时的相同有界执行边界信号；最终结果附加在后面。终端作业拒绝重复取消，而不是假装工作已停止。

该请求是持久的，因此可以显式恢复进程中断留下的非终端作业。恢复附加一个新的 `STARTED` 事件并完成或记录有界故障。如果已请求取消，则恢复将完成取消而不是开始工作。

该存储库实现了具有持久 PostgreSQL 作业历史记录的单进程工作人员。多实例租赁、心跳、工作窃取和企业队列需要部署基础设施，并且不是由内存锁模拟的。

## API 和坚持

- `POST /v1/reverse-runs?async=true`
- `GET /v1/projects/{projectId}/reverse-runs/{runId}`
- `POST /v1/projects/{projectId}/reverse-runs/{runId}/cancel`
- `POST /v1/projects/{projectId}/reverse-runs/{runId}/resume`

迁移 `0010_reverse_run_job.sql` 存储不可变的请求和身份排序事件。 Update/delete 触发器保护两个表。

## 验证

测试涵盖投影语义、持久孤儿取消、显式失败恢复、真正的异步 HTTP 反向运行达到 `WAITING_REVIEW`、终端取消冲突、PostgreSQL 事件顺序、突变拒绝、OpenAPI/JSON Schema 以及预先存在的 per-Skill timeout/retry/AbortSignal 测试。
