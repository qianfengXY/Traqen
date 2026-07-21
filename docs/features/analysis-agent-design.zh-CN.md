> 语言：**简体中文** · [English](analysis-agent-design.md)

# 分析 Agent 设计

## 产品定位

分析 Agent 是 Traqen 的核心源码理解能力，也是原平面扫描器的进阶形态。它把不可变、可定位的源码 Fact 转换成两种最新视图：用户可理解的纯业务能力和 API 接口。其结果会供功能追溯、配置与测试关联、影响分析、人工审核以及后续自动化测试 Agent 使用。它只能提出有证据支撑的候选，不能创建业务权威。

## 不可破坏的约束

1. 先确定性提取，再做语义推断。模型或 Skill 的每个结论都必须引用当前有界 WorkUnit 中的 Fact。
2. 每个 WorkUnit 的上下文有上限。即使工程包含十万或更多文件，也不能把整个项目一次性塞进模型上下文。
3. 服务端每完成一个 WorkUnit 就持久化检查点。本地浏览器流程按有界文件批次保存检查点，重新选择同一目录后可以复用。
4. 第一次分析为全量。后续 `AUTO` 分析以最新完成结果为增量基线；调用方也可以显式指定 `FULL` 或 `INCREMENTAL`。
5. Feature 身份先按精确候选键匹配，再按稳定证据重合度与语义名称相似度匹配。接近全量的重扫本身不能使人工确认失效。
6. 业务语义变化必须复核。实现重新映射和证据刷新会继承业务权威，同时以独立变化类型展示。
7. 当前功能树只包含最新且仍存在的 Feature。已移除实现进入不可变退役/历史事件，不继续占据当前树。
8. 模型凭据通过服务端环境变量引用解析，或仅由运行时配置保存在服务端进程内存中。API 不会返回密钥，密钥也绝不写入运行、结果、提示词记录或浏览器数据库。

## 处理流水线

`Source Snapshot → 确定性 Fact 图 → 有界 WorkUnit → 确定性候选 → 可选模型/Skills → 证据校验 → 稳定 Feature 对账 → 最新结果 + 不可变历史`

确定性扫描目前支持 JavaScript/Node 与 Java。Java 通过 ast-grep 使用 Tree-sitter 兼容 AST，识别 Spring 和 JAX-RS 接口、Controller/Service/Repository 角色、方法、DTO/Entity 类型、安全与校验注解、方法调用和配置引用。JavaScript 提取路由、符号、保护条件、状态变化、SQL 关系、配置和测试。两者统一输出语言无关的 Fact 契约。

WorkUnit 以接口和有意义的业务实现根节点为入口。图邻域采用广度优先方式，并受输入 token 预算和深度限制。Agent 至少预留模型上下文窗口的 20%，超过边界的配置会直接被拒绝。

## 分析模式

- `DETERMINISTIC`：不调用外部模型，适合私有/离线环境和可复现基线。
- `HYBRID`：先运行确定性分析，再调用已配置的 OpenAI-compatible 模型和可选 Skills。扩展可以优化聚合与说明，但不能引用当前 WorkUnit 之外的 Fact 或稳定节点。

开始分析前，可以在全局“配置分析模型”面板中设置 Profile ID、OpenAI-compatible API Base 或 Chat Completions 地址、模型名称、API Key，以及可选的 Stream/SSE 策略。Traqen 会先发起一次真实的结构化输出验证请求，只有成功后才把该配置标记为可分析。流式 Profile 会发送 `stream: true`，在服务端合并有界文本增量，并执行与非流式响应相同的最终 JSON 与证据校验。运行时输入的 API Key 只保存在 Traqen API 进程内存中，API 进程重启后需要重新配置。

对于托管部署，仍可通过 `ANALYSIS_MODEL_PROFILES_JSON` 配置服务端模型。每项包含 `id`、HTTPS `endpoint`（HTTP 仅允许回环地址）、`model`、可选 `timeoutMs`、可选 `stream` 和 `apiKeyEnvironment`；真正密钥保存在后者指定的环境变量中。

示例：

```json
[
  {
    "id": "private-model",
    "endpoint": "https://model-gateway.example/v1/chat/completions",
    "model": "source-analysis-model",
    "timeoutMs": 120000,
    "stream": true,
    "apiKeyEnvironment": "PRIVATE_MODEL_API_KEY"
  }
]
```

内置的 Specone/GSD 兼容参考适配器可以作为有界分析 Skill 使用。其输出仍是带来源的候选知识，不是 Claim 或人工确认。

## 增量与权威继承

结果会保存节点和关系的语义指纹。增量运行只规划有界邻域与变化 Fact 相交的 WorkUnit；未变化候选直接继承。当前 Feature 的变化类型为：

- `NEW`
- `BUSINESS_SEMANTICS_CHANGED`
- `IMPLEMENTATION_REMAPPED`
- `EVIDENCE_REFRESHED`
- `UNCHANGED`

没有当前实现的 Feature 以 `NO_CURRENT_IMPLEMENTATION` 写入 `retiredFeatures`。稳定匹配会继承已确认权威。业务语义变化把 `authority.review` 设为 `REQUIRED`；仅实现或证据变化不会让所有已确认 Feature 被静默退回重新审核。

## 持久化与 API

PostgreSQL 将可更新的运行检查点与不可变的完成结果分开存储。公开 API 包括：

- `POST /v1/projects/{projectId}/analysis-runs` —— 默认异步；`?async=false` 等待有界完成。
- `GET /v1/projects/{projectId}/analysis-runs/{analysisRunId}`
- `POST .../{analysisRunId}/pause`
- `POST .../{analysisRunId}/resume`
- `GET /v1/projects/{projectId}/analysis-results/latest`
- `GET /v1/projects/{projectId}/features/{featureId}/analysis-history`
- `GET/POST /v1/analysis-model-profiles` —— 获取不含密钥的配置，或配置运行时模型。
- `POST /v1/analysis-model-profiles/{profileId}/verify`
- `POST /v1/analysis-model-profiles/{profileId}/workspace-enrichment` —— 每个模型批次最多接收 24 个确定性候选。

每次运行严格绑定一个项目、Snapshot Manifest 和 Source component。没有确定性 Fact 图或 Source component 不匹配时，应用会拒绝分析。

## 本地 Workspace 体验

浏览器必须先取得一个已验证模型配置，才能开始新的 Workspace 分析。它先在本地完成确定性提取，再通过 Traqen API 按每批最多 24 个候选发送候选名称、路径、说明和必要代码片段。每个模型批次完成后都会保存检查点；增量分析时，使用同一模型配置且未变化的已分类候选不会再次消耗模型调用。项目原始文件不会持久化，IndexedDB 只保存提取后的候选记录、必要代码/测试片段、脱敏配置线索、活动检查点和紧凑历史摘要。

可以保留多个已扫描项目，同时只在侧栏展示选中的项目。从展示中移出是非破坏操作：Workspace 管理仍会读取其轻量摘要，但不会加载源码索引、功能树和追溯快照；重新勾选即可按需打开，无需重扫。

功能树提供两种投影。纯业务模式会过滤接口、命令、Repository、Adapter、Interface、Utils、配置代码和其他技术支持符号；API 模式展示接口设计数据以及匹配到的入口/调用实现代码块。两种投影都来自同一个 Workspace 最新分析结果。

## 明确边界

分析 Agent 不批准 Claim、不执行测试，也不会把 LLM 说法转成业务事实。浏览器只编排 Hybrid 进度，所有模型调用和凭据仍位于带认证的 Traqen API 后面。模型生成的名称、业务分组、置信度和依据在受治理的人工确认前都只是候选元数据。多实例 Worker 租约和分布式队列属于部署基础设施。OpenAPI YAML 与更多语言的确定性 AST 适配器仍是明确的后续扩展，不会伪装成“已完整分析”。
