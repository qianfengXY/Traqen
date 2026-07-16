> 语言：**简体中文** · [English](high-risk-decision-governance-validation-2026-07-15.md)

# 高风险 Decision 治理验证 — 2026-07-15

## 设计义务

设计需要按项目、领域、语句类型和风险进行授权；高风险规则的双重或业务加合规性确认；职责分离；有效性、撤销、争议、重新开放、授权就绪的身份上下文；以及有时间限制的“打破玻璃”，其中包含原因、审批者和审核后截止日期。

## 实施的工作流程

`DecisionReviewCase` 是一个不可变的提案，绑定到确切的 Claim 和 Scope 版本。它声明了风险、批准模式、提议的 Decision、到期日，以及（仅适用于 Break-glass）紧急原因和审查后截止日期。提议者身份由服务器分配。

`DecisionReviewEvent` 是一个仅附加事件，具有服务器分配的参与者身份。支持的操作包括 `APPROVE`、`REJECT`、`REVOKE`、`DISPUTE`、`REOPEN` 和 `POST_REVIEW`。评估重播追加顺序并报告 `PENDING`、`APPROVED`、`REJECTED`、`REVOKED`、`DISPUTED`、`EXPIRED` 或 `POST_REVIEW_OVERDUE`，而不覆盖历史记录。

批准规则强制执行：

- 提案人不能批准该提案；
- 两次批准意味着两个不同的参与者；
- `BUSINESS_COMPLIANCE` 需要两个已配置的角色组，而不仅仅是任意两个人；
- Break-glass 仅接受配置的紧急审批者角色，并且不能超过配置的有效性最大值；
- 撤销、争议、重新开放和事后审查需要生命周期授权的角色；
- 重新打开会重置有效的审批轮次，因此之前的审批无法重复使用。

最终批准和 Decision 发布发生在一次存储事务中。撤销发布新的 `DEPRECATED` Decision；争议发布了新的 `DEFERRED` Decision。重新开放后重新批准会发布与同一审核案例相关的另一个不可变确认。现有的历史仍然可以查询。

## 身份和策略集成

配置的应用程序支持旧版单个审阅者或 `REVIEWER_IDENTITIES_JSON` 用于多个承载令牌绑定的 actor/role 身份。提议者、普通审批者、业务、合规性、紧急情况和生命周期操作的角色集是单独配置的。默认情况下，在配置的运行时中禁用直接 Decision 创建，因此客户端无法通过省略风险字段来绕过审核案例。

这个本地身份解析器展示了策略边界；它不是企业 SSO。 Organization/tenant/project 和参与者-租户完整性是持续执行的。企业身份、授权源、组生命周期和撤销传播仍然是采用者集成。

## 持久性和 API

迁移 `0009_decision_governance.sql` 使用 Claim/Scope/Principal 外键、租户和范围触发器、追加顺序标识和突变拒绝添加不可变的审核案例、事件和实现表。

- `POST /v1/projects/{projectId}/decision-review-cases`
- `GET /v1/projects/{projectId}/decision-review-cases/{caseId}`
- `POST /v1/projects/{projectId}/decision-review-cases/{caseId}/events`

OpenAPI 和 JSON Schema 从客户端请求主体中排除提议者和事件参与者身份。

## 验证

测试涵盖自我批准拒绝、不同的双重批准、business/compliance 角色组强制执行、原子 Decision 实现、撤销、重新开放和重新批准、有界打破玻璃、逾期和完成的审核后、HTTP 身份分离、PostgreSQL 交易历史、tenant/scope 完整性、合同暴露和过期Decision 权限处理。
