> 语言：**简体中文** · [English](implementation-reanalysis-validation-2026-07-14.md)

# 实施重新分析验证 — 2026-07-14

## 结果

该切片关闭了变革影响循环的修复部分。更改后的实现已经可以仅使一致性、验证和受影响的跟踪段失效，同时保留规范的业务真相。现在可以再次对其进行分析，并将其绑定到现有的 Claim 和 Scope，而无需创建重复的 Claim 或替换其 Decision。

## 授权维修流程

`POST /v1/projects/{projectId}/features/{featureId}/claims/{claimId}/implementation-reanalyses` 接受命名分析、当前的 Snapshot 反向运行、其候选者、基本原理以及任何明确承认的冲突。

服务器：

1. 独立于请求机构确定实施审核者的身份和角色；
2. 需要允许的 developer/architect-style 角色；
3. 验证 Feature 和最新的 Claim 是否存在，并且 Claim 仍由 `CONFIRMED` 或 `EXCEPTION_RECORDED` Decision 授权；
4. 验证反向运行和候选属于目标 Snapshot 和源组件；
5. 要求明确承认每一个相关冲突；
6. 根据候选人的确切 Fact 引用创建一个新的不可变的 Snapshot 绑定的 ImplementMapping；
7. 确定性地重新计算与现有规范约束的一致性；
8. 记录分析 ID、请求指纹、审阅者、基本原理、反向运行、候选者和 `analysisMethod` 来源中的冲突。

Claim、Scope、Decision、历史Fact、历史Evidence 以及之前的映射都不会发生突变。

## 持久性和幂等性

内存和 PostgreSQL 存储以原子方式附加映射和一致性。现有数据库外键和触发器强制执行 Claim/Scope、Snapshot 源、反向运行和 Fact-Snapshot 边界。重复确切的授权请求将返回相同的记录；尝试重用具有不同分析来源的确定性映射身份会因为不可变的冲突而失败。

## 产品整合

变更影响修复队列现在包括实时实施重新分析表格。凭证保留在页面内存中，并在服务器响应成功后被清除。该页面指出该操作仅修复实施证据，不能创建或修改业务权限。

## 验证

- 未经身份验证的重新分析会被拒绝并返回 401；
- 不具有实施角色的业务审核员会被拒绝并返回 403；
- 不相关和未承认的冲突被拒绝；
- API 和 PostgreSQL 路径创建当前的 Snapshot 映射和 `CONFORMS` 记录；
- 精确重试是幂等的；
- 重新分析后，权威维度仍为`CONFIRMED`，一致性变为`CONFORMS`，`CONFORMANCE_STALE`消失；
- 产品构建、渲染合同检查和 lint 通过。
