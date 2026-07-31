> 语言：**简体中文** · [English](feature-traceability-design.md)

> **兼容路径：** 当前 Web 构建仍把此文件作为展示内容导入。活动合同见 [F002](F002-feature-api-traceability.zh-CN.md)；实施计划要求迁移导入后删除此路径。

# 功能追溯设计

## 目标

功能追溯需要回答一个问题，并且不能把不确定性压缩成一个分数：**当前有哪些证据能证明 Traqen 中受治理的 Feature 符合业务人工确认的规则？** 服务端针对一个不可变 Snapshot Manifest 和部署，从规范性意图开始，按顺序投影到实现、配置、TestSpec、执行和 Evidence。

## 功能边界

- 一个 Feature 可以包含多个版本化 Claim 与 Scope。只有经过授权、不可变的人工 Decision 才能确认规范性权威。
- Scanner 与反向分析 Agent 可以提出 Fact 和 Candidate，但不能创建业务事实。
- `evaluateTraceChain` 分别派生权威、实现符合、验证结果、Evidence 新鲜度、冲突和 TraceGap，不能互相抵消。
- 只有不存在阻断级 TraceGap 时追踪链才完整；警告级缺口仍然可见。
- 一次执行只能证明它绑定的 TestSpec 版本、Snapshot Manifest 和部署。代码或部署变化会保留历史，但使依赖的证明层失效。
- 浏览器只渲染服务端结果，不重新计算可信分数，也不隐藏未知状态。

## 请求与投影流程

1. 客户端针对选中的 Snapshot Manifest 请求 `GET /v1/projects/{projectId}/features/{featureId}/traceability`。
2. 应用层加载受治理的 Feature、Claim/Scope/Decision 基线、已映射的实现 Fact、TestSpec、当前执行、Evidence 和冲突。
3. 领域评估器生成有序追踪段、相互独立的可信维度，以及带责任人的明确缺口。
4. 图谱投影器补充业务过程节点，并生成有界的业务、实现、覆盖率或完整追溯视图。
5. API 将不可变身份和服务端派生结果返回给产品界面及后续 Agent。

## 不变量

- 规范性 Claim 和人工 Decision 绝不能从源代码中推断。
- 缺失、过期、不完整、冲突、失败和未执行必须保持为不同状态。
- 历史 Fact 与 Evidence 继续保留，但不能作为更新 Snapshot 或部署的当前证明。
- 每个阻断级缺口都有明确的责任角色和修复边界。
- 敏感配置只展示 Secret 引用，不能以明文渲染。

## 实现映射

| 关注点 | 源文件 |
| --- | --- |
| 追踪链评估与 TraceGap 责任人 | `src/domain/trace-chain.js` |
| 图谱投影与有界路径视图 | `src/domain/feature-graph.js` |
| Feature 追溯编排 | `src/application/traceability-application.js` |
| HTTP 契约 | `src/api/http-server.js` |
| 响应 Schema | `contracts/feature-traceability.schema.json` |

## 验证策略

- 领域测试证明完整、缺失、失败、过期、冲突和新鲜度边界等追踪链场景。
- 图谱测试证明视图过滤、有界展开、来源、缺口和路径查询。
- API 测试证明认证、Project/Feature 边界、Snapshot 选择和响应契约。
- Web 构建证明同一仓库的文档和源码能够作为 Traqen 自身 Workspace 被投影展示。

## 后续 Agent 契约

Agent 消费已批准且版本固定的 TestSpec，以及 Snapshot/部署身份；回传结构化步骤结果、断言结果、Evidence 引用和签名证明。Agent 输出可以增加执行事实，但不能编辑功能说明、人工 Decision、TestSpec 审批状态或服务端最终派生的可信维度。
