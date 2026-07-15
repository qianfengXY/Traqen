> 语言：**简体中文** · [English](feature-traceability-validation-2026-07-14.md)

# 受监管 Feature 可追溯性验证 — 2026-07-14

## 产品边界

该切片实现了以下设计规则：观察到的实现、推断的意图、人类业务权限、验证和 Evidence 是不同种类的知识。 Reverse Skill 候选人仍然保留实施知识。只有经过认证、政策授权的声明级审查才能创建单独的规范性Claim和Decision；候选人本身永远不会被重新贴上商业真理的标签。

服务器派生的证明链在没有综合置信度评分的情况下回答了产品的核心问题：

```text
Feature
→ HAS_RULE → 规范性 Claim
→ CONFIRMED_BY → 授权 Decision
→ APPLIES_IN → 版本化 ClaimScope
→ ASSESSED_BY / CONFORMS_TO → 实现一致性
→ EXPOSED_BY / IMPLEMENTED_BY / USES_DATA / CONTROLLED_BY / DEPENDS_ON → 确定性 Facts
→ VERIFIED_BY → 批准 TestSpec
→ EXECUTED_AS → 准确的部署执行
→ PROVED_BY → 已验证 Evidence
```

每个段都带有类型端点、来源和 `ACTIVE`、`PENDING` 或 `STALE` 状态。缺少权限、映射、一致性、TestSpec、断言、当前执行、已验证的 Evidence 或冲突解决仍然是可见的 `TraceGap` 并阻止完整的链。

## 语句级审查和完整性

- 审阅者身份和角色来自受信任的服务器解析器，而不是请求正文。
- 项目策略单独控制允许的角色、Decision 类型和候选人审核结果。
- 身份验证发生在 ReverseRun/candidate 查找之前，减少未经身份验证的枚举。
- 服务器从不可变运行中找到候选者及其 Fact 证据；客户不能重述候选人内容或 Fact 链接。
- 禁止确认有冲突的候选人。记录异常需要明确确认每个相关冲突和非空异常内容。
- `REJECTED`、`INSUFFICIENT_EVIDENCE` 和 `DEFERRED` 创建审阅历史记录，但不能走私 Feature、Claim、Scope、映射或一致性记录。
- 成功的基线附加在内存和 PostgreSQL 中是原子的：Feature（当请求时）、Scope、规范性 Claim、Decision、映射、一致性以及审查所有提交或不提交。
- PostgreSQL 验证租户绑定的审阅者、准确的 Claim/Scope 引用、准确的源 Snapshot 成员资格，以及引用的 Snapshot 清单中每个映射的 Fact 的存在。这些记录拒绝更新和删除操作。
- 幂等重试使用服务器计算的指纹，其中包括路由身份、审阅者身份和已接受的请求。

## Snapshot 比较和分层有效性

`POST /v1/projects/{projectId}/change-sets` 比较两个不可变清单的最新完整 Fact 观察结果。稳定的实体身份与 Snapshot 特定的事实身份分开，独立的 Scanner 观察结果不会相互覆盖。

对于映射的更改，仅附加影响记录包含：

- 受影响的 Feature、Claim 版本、ClaimScope 版本、实现映射和 TestSpec ID；
- 准确更改 Fact ID 并更改类别；
- 无效层；
- 保留层；
- 原因和建议的补救措施。

代码、API、SQL、Schema、配置、依赖项和测试资产更改使用单独的失效规则。实施变更保留了规范性 Claim、业务 Decision、历史性 Fact、历史性 Evidence 和审计记录。然后，可追溯性查询将旧的实施和一致性部分显示为 `STALE`，同时授权仍然得到确认。

如果每个映射的 Fact 在下一个清单中在语义上相同，则 Traqen 创建一个不可变的连续性事件，将映射重新绑定到新的 Snapshot 特定的 Fact ID，并派生出具有 `SEMANTIC_FACT_CONTINUITY` 出处的新一致性记录。这可以防止例行部署或观察时间戳使每个 Feature 过时。连续性和失效路径对于 ChangeSet 来说都是原子的。

不完整的 Fact 图永远不会默默地暗示完整的比较：ChangeSet 被标记为不完整并记录哪一侧不完整。无法安全反弹的映射仍然是过时的，而不是被猜测为当前的。

## 验证结果

完整的测试套件已通过 105 项测试：

```bash
npm test
```

覆盖范围包括授权确认、异常、不创建基线的拒绝、身份欺骗、幂等性、独立维度、Decision 和一致性跟踪段、仅过时影响的路径、未更改的语义连续性、多Scanner 比较、精确PostgreSQL Fact 引用、事务回滚约束、不可变impact/continuity 历史记录、 OpenAPI/JSON Schema 解析，以及之前实现的 Scanner、Skill、TestSpec、Runner 和 Evidence 边界。

存储库自扫描也无需诊断即可完成：

```text
完整：真实
符合条件的文物：78
可定位节点：1,004
关系：2,719
```

对于该源状态，计数是可重现的，并且会随着实现工件的变化而变化。

## 刻意的限制

- 低级 `/v1/trace-chains/evaluate` 端点仍然是所提供输入的确定性诊断评估器。产品真相是从服务器派生的 Feature 可追溯性端点读取的。
- 开发身份是环境配置的本地审核者和可选的承载令牌。企业SSO，授权、两人审批、打破玻璃、撤销、全生产路线授权，仍待后期基础设施工作。
- 更改比较对摄取的确定性 Fact 图表进行操作。仅动态运行时行为需要运行时 Facts 和跟踪关联才能参与影响选择。
- 有序的证明链和交互式 React/Cytoscape 图现在投影相同的服务器衍生的 Feature 可追溯性对象。该图由视图、深度、节点数、节点类型和关系过滤器界定；它不维护第二个真理模型。
