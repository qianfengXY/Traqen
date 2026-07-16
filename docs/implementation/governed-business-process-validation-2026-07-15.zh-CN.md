> 语言：**简体中文** · [English](governed-business-process-validation-2026-07-15.md)

# 受控业务流程验证 — 2026-07-15

## 设计义务

产品愿景需要相同的以 Feature 为中心的源来显示业务参与者、生命周期状态、转换、防护、异常、设计元素和当前实现，而不是从标签推断的图表。该设计还禁止将人工智能或代码推理直接推广到规范的商业真理中。

## 实施边界

- `BusinessProcessModel` 是不可变的，并且绑定到确切的 Feature 版本。
- 经过身份验证的审阅者必须具有 `allowedProcessModelRoles` 中列出的角色；参与者ID、角色、确认时间和创建时间都是服务器拥有的。
- 每个模型都有一个 `INITIAL` 状态，至少一个 `TERMINAL` 状态，无自转换，有效的 actor/state 引用，并且没有无法到达的状态。
- 演员承担角色和责任。转换携带触发器、防护、异常行为、可选的 next-Feature 引用和实现 Fact 引用。设计元素区分模块、序列、事务和异常处理程序意图。
- 实现参考包含 `snapshotManifestId` 和 `factId`。提交在持久化之前验证 Snapshot 和 Fact。历史映射仍然可见，如 `STALE`；它不能默默地证明更新的Snapshot。
- 业务图是根据相同的 Feature 可追溯性响应预测的。它使用 Actor/Role、BusinessState、StateTransition、DesignElement 和确定性 Fact 节点，而不是单独的可视化数据库。

## 持久性和 API

- PostgreSQL 迁移：`0008_business_process_model.sql`。
- 内存中和 PostgreSQL 存储公开相同的 append/latest-read 行为。
- API: `POST/GET /v1/projects/{projectId}/features/{featureId}/process-model`.
- Feature 基线和 Snapshot 可追溯性响应包括最新的流程模型；可追溯性还包括引用的 Fact 子图。
- OpenAPI 和 JSON Schema 将审阅者身份保留在请求合同之外，并保留 Snapshot 对每个实现参考的约束力。

## 展示垂直流动

内置订单试点现在确认三态客户流（`DRAFT`、`SUBMITTED`、拒绝）、两个转换、state/ownership 防护、异常行为和交易设计元素。版本 1 映射到第一个 Snapshot 的端点、状态保护、状态转换和异常路径 Facts。实现更改后，版本 2 单独授权，并将相同的业务语义映射到第二个 Snapshot 的 Facts。最终的业务图断言三个 BusinessState 节点和两个 StateTransition 节点。

## 验证

有针对性的测试涵盖域不变量、授权失败、HTTP 身份分配、内存持久性、PostgreSQL migration/persistence、图形投影、OpenAPI/JSON Schema、web lint/build/rendering 和更改的-Snapshot 参考试点。完整的存储库测试套件仍然是此增量的发布入口。

## 真理边界

Scanner Facts 例如 `condition-branch`、`permission-check`、`state-transition` 和 `exception-path` 仅是实施证据。他们可能与授权的业务转换相关联，但他们从不自己创建、确认或修改业务流程模型。企业SSO/ABAC、授权、两人确认、撤销、dispute/reopen、打破玻璃仍然是单独的治理强化工作。
