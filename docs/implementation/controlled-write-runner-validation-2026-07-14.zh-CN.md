> 语言：**简体中文** · [English](controlled-write-runner-validation-2026-07-14.md)

# 受控写入 Runner 验证 — 2026-07-14

## 结果

该切片关闭了 MVP 验收项目 8 的可执行核心，并证明了项目 13 的受控写入部分。已确认的端点 Claim 可以生成未经批准的 TestSpec 草案，其中包含显式绑定的 API 路径、有界请求、可信数据库查询引用和确定性断言。经过独立批准后，签名的 Runner 任务可以执行完整的链：

```text
已确认 Claim 和确切的端点 Fact
→ 生成 TestSpec 草稿
→ 不变的人类认可
→ 可信种子设置
→ 列入许可名单 API 写入
→ 只读数据库查询-目录验证
→ 确定性断言
→ 保证清洁
→ Runner-签名 Evidence
→ 完整的当前部署跟踪链
```

## 执行边界

- `CONTROLLED_WRITE` 必须出现在已签署的目标策略的 `allowedOperationLevels` 中。
- 每个写路由必须独立列出`CONTROLLED_WRITE`；没有操作级别授权的 method/path 匹配将被拒绝。
- 仅启用 POST、PUT 和 PATCH。 DELETE、破坏性、外部副作用、absolute/cross-origin、带有凭据的 URL、重定向跟踪和未经允许的请求仍然被阻止。
- 请求和响应的大小是有限的。 JSON 主体由执行程序序列化，Evidence 被递归编辑。
- 端点占位符（例如 `/orders/{id}/submit`）必须在 TestSpec 生成期间显式绑定。绑定是不可变生成指纹的一部分。
- 数据库验证仅接受受信任的 `queryRef`。查询目录必须将其标记为 `safeRead`，并且执行器仍然拒绝多语句、注释或变异 SQL。 Evidence 保留规范化目录 SQL、查询引用、编辑参数和返回的行，以便可以独立审核数据库检查，而无需允许 TestSpec 创作的 SQL。
- 现有测试仅接受 `testRef`。签名的目标策略将其解析为本地可信的绝对可执行文件、工作目录、有界参数和超时； task/TestSpec 命令、shell、环境和工作目录字段被拒绝。退出代码、有界 stdout 和有界 stderr 保留用于断言，而不为任务提供命令执行原语。

## Snapshot 和遥测绑定

签名的任务携带准确的源、构建、部署和运行时组件 ID 以及来自存储的 Snapshot 清单的 SHA-256 摘要。当目标报告不同的组件时，Runner 拒绝 policy/task 漂移并拒绝执行。每个 Evidence 清单都会重复四组件绑定，并且摄取会根据存储的清单验证每个身份，而不是信任 Git 标签或部署名称。

仅当其声明出现在签署的目标保单中时，受信任的本地收集者才可以添加 `LOG`、`TRACE`、`COVERAGE`、`SCREENSHOT` 或 `OTHER` Evidence。收集器有效负载经过递归编辑，与捆绑包的其余部分有大小限制，由 Runner 签名，并绑定到相同的 Snapshot 组件。参考试点从实际运行的服务器收集结构化订单日志和跟踪。

## 夹具生命周期

TestSpec 命名 `seedRef` 和清理策略；它无法提供可执行的设置或清理代码。签名的目标策略必须允许两者，而 Runner 则解析任务负载之外的匹配本地可信处理程序。

设置和清理有单独的阶段记录。清理在成功设置、断言失败或执行程序失败后运行。清理失败会将执行结果更改为 `ERROR`，标记生命周期 Evidence `INCOMPLETE`，请求测试数据隔离，并记录策略定义的补偿参考。处理程序状态保留在本地，并且不会序列化到 Evidence 中。

## 垂直打样

集成测试使用真实的本地HTTP服务器和PGlite数据库。夹具处理程序插入 DRAFT 订单，生成的 TestSpec 调用 POST `/orders/{id}/submit`，API 将行更改为 SUBMITTED，数据库执行器通过可信目录读取该行，确定性断言通过，然后清理删除该行。生成的 Evidence 包含 HTTP 请求和响应、规范化的可信 SQL、查询引用、编辑参数、返回的行、断言结果和生命周期记录。它在 Runner HMAC 下进行验证，不包含已解析的令牌，并完成当前部署跟踪链。

## 验证

- 测试涵盖生成的路径绑定和数据库断言、精确的四组件目标匹配、签名策略漂移、路由级操作授权、请求边界、秘密URL拒绝、raw-SQL/storage-command拒绝、真实API/database/existing-test执行、LOG/TRACE收集、设置和清理Evidence、清理补偿、HMAC 验证、所有终端执行状态以及完整跟踪链完成。
- OpenAPI 和所有 JSON Schema 合约解析成功；执行合约现在将设置和清理记录为独立的阶段。

## 剩余边界

这是一个进程内 MVP Runner 协议，而不是生产工作负载身份或远程租赁实现。企业 mTLS 注册、持久任务租赁、写入和清理之间的崩溃恢复、进程外执行程序隔离以及面向操作员的补偿队列仍然是生产强化工作；当前代码记录必要的随机数、策略哈希、Snapshot 绑定、补偿引用和不可变的 Evidence 边界，而不假装这些外部系统已经存在。
