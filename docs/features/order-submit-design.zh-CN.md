> 语言：**简体中文** · [English](order-submit-design.md)

# 订单提交功能设计

- 文档 ID：`DESIGN-ORDER-SUBMIT-001`
- 版本：`2.1`
- 状态：`APPROVED`
- 负责人：`order-platform-architect`

## 设计目标

订单提交能力允许具备权限的订单所有者，将标准草稿订单从 `DRAFT` 安全地转换为 `SUBMITTED`。设计必须同时保证权限边界、状态机约束、幂等、订单与库存的一致性，以及可回溯的执行证据。

## 请求入口与校验顺序

1. 接收 `POST /orders/{id}/submit`，建立请求关联 ID。
2. 检查 `order.submit.enabled`，开关关闭时返回 `FEATURE_DISABLED`。
3. 校验身份、`order:submit` 权限和订单归属关系。
4. 要求幂等键；相同订单和幂等键只返回已保存结果，不重复写入。
5. 在事务中锁定订单并校验当前状态必须为 `DRAFT`。
6. 预留库存，更新订单状态并保存幂等响应。
7. 提交事务，输出结构化日志、Trace 和 Evidence 引用。

## 一致性与失败处理

- 订单状态只允许 `DRAFT → SUBMITTED`，其他状态返回稳定的业务冲突。
- 库存预留和订单状态更新属于同一受控业务生命周期。
- 任意数据库操作失败时回滚事务；已产生的库存预留必须释放。
- Cleanup 或补偿失败不能被普通业务失败覆盖，必须形成独立 `ERROR` Evidence。
- 历史失败执行永久保留；修复后的 PASS 作为新的 Execution 追加。

## 权限与安全边界

- 普通用户只能提交属于自己的订单，并且必须具有 `order:submit` 权限。
- 管理员强制提交属于独立 Feature、Claim、Scope 和审批流程，本功能不隐式包含该权限。
- 页面、Agent 和 Runner 都不能自行提升权限或修改业务确认。
- 敏感配置只通过密钥引用解析，不能进入页面、日志或 Evidence 明文。

## 配置与环境

- `order.submit.enabled`：提交能力总开关。
- `order.submit.idempotencyTtlSeconds`：幂等结果保留时间。
- `inventory.reserve.timeoutMs`：库存预留调用超时。
- `database.orders.connection`：订单数据库密钥引用。

每个配置值必须绑定 DEV、SIT、UAT 或 PROD 的具体 Snapshot，不能跨环境推断。

## 可观测性与证据

请求关联 ID 必须贯穿 API、订单服务、数据库操作、库存调用、日志和 Trace。成功执行至少产生 HTTP、DATABASE、ASSERTION、LOG、TRACE 和 LIFECYCLE Evidence；任何缺失都形成明确的 `TraceGap`。

## 实现定位

- 订单提交业务逻辑：`examples/order-platform/src/order-service.js`
- HTTP 路由：`examples/order-platform/src/router.js`
- 环境配置：`examples/order-platform/src/environment.js`
- 端到端测试：`examples/order-platform/tests/order-submit.test.js`

## 验收条件

- 当前部署全部 P0 TestSpec 通过。
- 不存在未解释的 `ERROR` 或 `INSUFFICIENT_EVIDENCE`。
- Fixture 与 Cleanup 生命周期完整。
- Evidence 绑定当前 TestSpec 版本、Snapshot、部署和 Runner 身份。
- 业务确认、实现符合性、验证结果、新鲜度和冲突维度保持独立。
