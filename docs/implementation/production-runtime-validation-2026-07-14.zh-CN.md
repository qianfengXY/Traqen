> 语言：**简体中文** · [English](production-runtime-validation-2026-07-14.md)

# 生产运行时验证 — 2026-07-14

## 结果

Traqen 现在拥有 PostgreSQL 支持的生产 API 进程，而不仅仅是本地内存开发服务器。启动执行完整的存储库控制序列：

```text
验证生产配置
→ 连接一个固定的 PostgreSQL 客户端
→ 验证校验和并应用待处理的迁移
→ 构建共享追溯应用
→ 在每条非健康路线上都需要全局 API 代币
→ 服务于 REST API
→ 排空 HTTP 并关闭 SIGINT/SIGTERM 上的 PostgreSQL
```

单客户端数据库适配器是有意为之的：存储的显式 `BEGIN`/`COMMIT`/`ROLLBACK` 序列保留在一个 PostgreSQL 会话上。连接失败或迁移校验和失败导致 API 无法提供服务；迁移失败也会关闭连接。

## 配置

| 变量 | 必填 | 目的 |
| --- | --- | --- |
| `DATABASE_URL` | 生产 | PostgreSQL 连接字符串 |
| `API_BEARER_TOKEN` | 生产 | 全局 API 凭证 |
| `POSTGRES_SSL` | 不 | `require`（默认）、`no-verify` 或 `disable` |
| `HOST`, `PORT` | 不 | 监听地址；默认为 `0.0.0.0:3000` |
| `CORS_ALLOWED_ORIGINS` | 浏览器使用 | 以逗号分隔的确切来源 |
| `RUNNER_ID`, `RUNNER_SHARED_SECRET` | Evidence 摄取 | 可信本地 MVP Runner 身份 |
| `SCANNER_ID`, `SCANNER_SHARED_SECRET` | Fact 摄取 | 可信本地 MVP Scanner 身份 |
| `SKILL_PUBLISHER`, `SKILL_PUBLISHER_SHARED_SECRET` | Skill 注册 |受信任的本地 MVP 发布者身份 |
| `REVIEWER_ID`, `REVIEWER_ROLE`, `REVIEWER_BEARER_TOKEN` | 商业评论 | 失败关闭审阅者 identity/policy |
| `IMPLEMENTATION_REVIEWER_ID`, `IMPLEMENTATION_REVIEWER_ROLE`, `IMPLEMENTATION_REVIEWER_BEARER_TOKEN` | 重新分析 | 失败关闭实施审核员 identity/policy |
| `QUALITY_GATE_MODE` | 不 | `ADVISORY`（默认）、`MANUAL_APPROVAL` 或 `ENFORCED` |
| `HIGH_RISK_FEATURE_IDS`, `FIXED_HIGH_RISK_TEST_SPEC_IDS` | 不 | 逗号分隔的固定高风险回归策略 |
| `CONSERVATIVE_REGRESSION_TEST_SPEC_IDS` | 不 | 当影响不完整时使用逗号分隔的后备设置 |
| `HIGH_VALUE_FEATURE_IDS` | 不 | 以逗号分隔的北极星 Feature 人口；默认为所有受管理的 Features |

全局令牌可以作为 `Authorization: Bearer ...` 或 `x-traqen-api-token` 发送。存在第二种形式，因此审阅者端点可以独立使用 `Authorization` 作为较窄的审阅者凭证。令牌比较是恒定时间的。 `GET /health` 和 CORS 飞行前保持公开；所有其他路线在生产中都受到保护。

## API-仅限引导程序

操作员不会手动插入基础行：

1. `POST /v1/projects` 在一个幂等事务中创建组织、租户、项目和租户委托人。
2. `GET /v1/projects/{projectId}` 返回派生边界。
3. `POST /v1/projects/{projectId}/snapshots` 验证组件 SHA-256 摘要、重新计算服务器端的完整性和内容身份，并附加不可变的 Snapshot。

相同的引导程序是幂等的。重复使用具有不同不可变内容的 ID 会导致冲突并回滚整个事务。可以重新注册规范化的 Snapshot 清单，而不会丢失其组件或更改其内容 ID。

## 验证

- PostgreSQL 集成测试仅从迁移开始，通过应用程序创建一个项目，注册完整的 Snapshot，查询结果行，幂等地重复相同的请求，并拒绝冲突的基础。
- HTTP 集成测试证明 project/Snapshot 引导程序仅需要 API 调用，并证明生产身份验证可以保护每个非健康路由。
- 数据库适配器测试证明连接选项、query/exec 委托、幂等关闭以及关闭后拒绝操作。
- OpenAPI 3.1 记录了全局令牌形式和三个引导路径。

## 刻意的企业边界

运行时是可部署的，但存储库不会假装 HMAC 秘密和一个静态 API 令牌等于企业身份。生产强化仍然要求采用组织提供secret/KMS集成、基于证书的工作负载身份和mTLS、企业SSO/ABAC、持久任务租赁、backup/restore、外部Evidence对象存储和保留策略及其正常的ingress/observability控制。
