> 语言：**简体中文** · [English](analysis-agent-design.md)

# 分析 Agent 设计

## 产品定位

分析 Agent 是 Traqen 的核心源码理解能力，也是原平面扫描器的进阶形态。它把不可变、可定位的源码 Fact 转换成两种最新视图：用户可理解的纯业务能力和 API 接口。其结果会供功能追溯、配置与测试关联、影响分析、人工审核以及后续自动化测试 Agent 使用。它只能提出有证据支撑的候选，不能创建业务权威。

## 不可破坏的约束

1. 先冻结同一份 Source Snapshot，再并行运行互不依赖的确定性提取和源码分析 Skill。扫描候选不能成为 Skill 的输入答案，也不能决定 Skill 看哪些业务能力；两路结论只能在后续对账阶段相遇。
2. 每个 WorkUnit 的上下文有上限。即使工程包含十万或更多文件，也不能把整个项目一次性塞进模型上下文。
3. 服务端每完成一个 WorkUnit 就持久化检查点。本地浏览器流程按有界文件批次保存检查点，重新选择同一目录后可以复用。
4. 第一次分析为全量。后续 `AUTO` 分析以最新完成结果为增量基线；调用方也可以显式指定 `FULL` 或 `INCREMENTAL`。
5. Feature 身份先按精确候选键匹配，再按稳定证据重合度与语义名称相似度匹配。接近全量的重扫本身不能使人工确认失效。
6. 业务语义变化必须复核。实现重新映射和证据刷新会继承业务权威，同时以独立变化类型展示。
7. 当前功能树只包含最新且仍存在的 Feature。已移除实现进入不可变退役/历史事件，不继续占据当前树。
8. 模型凭据通过服务端环境变量引用解析，或静态加密保存在设备本地的 Traqen Profile 存储中。API 不会返回密钥，密钥也绝不写入运行、结果、提示词记录、Workspace 或浏览器数据库。
9. 提取器输出只是观察，不是真相。每个候选都必须携带提取器、提取依据、源码范围、旁证、矛盾、诊断、完整性和置信度上限。模型不能把置信度提高到证据上限以上，只有受治理的人工审核才能形成业务权威。

## 处理流水线

`Source Snapshot → [确定性 Fact 提取 || 直接源码 Skills] → 多源候选对账 → 初步结论 → 证据校验 → 稳定 Feature 对账 → 最新结果 + 不可变历史`

主 Agent 的任务地图只能来自与扫描结果无关的 Source Manifest：路径、模块、语言、文件体积、依赖清单和增量变化集。不能先从扫描器得到“候选功能”，再按这些候选给 Skill 分任务，因为这会让扫描器的漏报同时变成 Agent 的盲区。确定性扫描器、ECC 类仓库理解 Skill、Specone 类规格逆向 Skill 必须从同一 Snapshot 独立出发；主 Agent 随后把结果标为 `CORROBORATED`、`SCANNER_ONLY`、`SKILL_ONLY`、`CONFLICT` 或 `INSUFFICIENT_EVIDENCE`。

直接源码 Skill 不获得任意文件系统权限。平台先给出有界 Source Manifest，Skill 再通过受控读取协议申请具体 `SourceSlice`；每个切片都有路径、行号、内容摘要、预算和 Snapshot 绑定。这样既能分析扫描器没有识别出的代码，也不会把十万文件一次性塞进上下文。多个 Skill 使用同一模型或同一提示词家族时，不视为真正独立旁证，必须在来源元数据中保留这种相关性。

服务端确定性扫描目前支持 JavaScript/Node 与 Java。Java 通过 ast-grep 使用 Tree-sitter 兼容 AST，识别 Spring 和 JAX-RS 接口、Controller/Service/Repository 角色、方法、DTO/Entity 类型、安全与校验注解、方法调用和配置引用。JavaScript 提取路由、符号、保护条件、状态变化、SQL 关系、配置和测试。两者统一输出语言无关的 Fact 契约。浏览器直接选择目录属于另一条轻量路径：当前 Java 与多语言发现中仍包含声明规则匹配，因此必须标明为启发式观察，不能宣称已经过 AST 验证。

Traqen 不会因为“解析器返回了节点”就判断 AST 结果正确。平台会记录解析诊断和源码位置，并寻找 OpenAPI 操作、入口实现、调用边、配置引用和关联测试等独立观察。只有单一启发式观察时，置信度上限为 `LOW`；存在不同类型的独立证据后，上限才可能提高到 `MEDIUM` 或 `HIGH`。矛盾或解析不完整必须持续展示，候选保持待确认。LLM 会收到完整证据评估并保留不确定性；输出校验会拒绝遗漏 ID、虚构 ID、字段结构错误以及超过证据上限的置信度。

WorkUnit 以接口和有意义的业务实现根节点为入口。图邻域采用广度优先方式，并受输入 token 预算和深度限制。Agent 至少预留模型上下文窗口的 20%，超过边界的配置会直接被拒绝。

## 分析模式

- `DETERMINISTIC`：不调用外部模型，适合私有/离线环境和可复现基线。
- `HYBRID`：先运行确定性分析，再调用已配置的 OpenAI-compatible 模型和可选 Skills。扩展可以优化聚合与说明，但不能引用当前 WorkUnit 之外的 Fact 或稳定节点。

开始分析前，可以在全局“配置分析模型”面板中添加多个 Profile，编辑时无需重复输入未变化的密钥，可删除运行时 Profile，并选择一个已验证 Profile 作为当前分析模型。Traqen 会先发起一次真实的结构化输出验证请求，只有成功后才把 Profile 标记为可分析。流式 Profile 会发送 `stream: true`，在服务端合并有界文本增量，并执行与非流式响应相同的最终 JSON 与证据校验。运行时 Profile 使用 AES-256-GCM 加密保存在设备本地 Traqen 配置目录，独立密钥文件只允许当前用户访问；可通过 `ANALYSIS_MODEL_STORE_PATH` 覆盖加密存储位置。

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

内置的 `specone-reference` / `gsd-reference` 只用于验证通用协议，而且仍消费确定性 Fact 包；它们不是外部 Specone/GSD，也不构成独立源码分析。真正的 ECC、Specone 或其他仓库分析能力必须以签名、版本固定的外部 Skill/Agent Runtime 适配器注册，声明源码读取、模型、网络和增量能力。未安装或未授权时界面必须显示 `NOT_CONFIGURED`，不能退化后仍冒充该 Skill 已执行。其输出始终是带来源的候选知识，不是 Claim 或人工确认。

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
- `POST /v1/analysis-model-profiles/{profileId}/select` —— 选择一个已验证 Profile 作为当前模型。
- `DELETE /v1/analysis-model-profiles/{profileId}` —— 删除持久化的运行时 Profile；环境变量 Profile 仍由部署配置管理。
- `POST /v1/analysis-model-profiles/{profileId}/workspace-enrichment` —— 每个模型批次最多接收 24 个已评估证据的候选；使用 `Accept: application/x-ndjson` 时会先流式返回不含密钥的交互遥测，最后返回已校验结果。
- `POST /v1/analysis-model-profiles/{profileId}/workspace-plan` —— 主 Agent 向模型请求一条公开规划消息和恰好三个子 Agent 任务；NDJSON 会先流式返回公开消息，再返回已校验规划。

每次运行严格绑定一个项目、Snapshot Manifest 和 Source component。没有确定性 Fact 图或 Source component 不匹配时，应用会拒绝分析。

## 本地 Workspace 体验

浏览器必须先取得一个已验证模型配置，才能开始新的 Workspace 分析。它先完成有界本地提取，标明真实提取器依据并计算证据评估，再通过 Traqen API 发送候选名称、路径、说明、必要代码片段、独立旁证、诊断、完整性和置信度上限。API 契约单次最多允许 24 个候选，本地编排器默认每批 10 个，并继续按序列化体积拆分。如果供应商返回 `length`、`max_tokens` 或其他输出未完成状态，客户端会把它识别为截断，并在固定重试深度内递归二分有界批次；绝不会通过臆造字段修复缺失 JSON。如果最小原子单元仍不包含完整有效的对象或数组，编排器会发出 `BATCH_SKIPPED`，保留其确定性证据但不附加模型分类，将该单元记录为待处理并继续 Workspace 分析。这表示“证据不完整”，不是成功的模型结论，也不是整轮运行失败。每个成功完成或明确跳过的模型工作单元都会保存检查点；增量分析时，使用同一模型配置且未变化的已分类候选不会再次消耗模型调用，待处理候选仍可以在后续运行中重试。项目原始文件不会持久化，IndexedDB 只保存提取后的候选记录、必要代码/测试片段、脱敏配置线索、活动检查点和紧凑历史摘要。

模型分类会记录证据策略版本。当置信度或校验规则发生变化时，即使源码文件和模型 Profile 未变化，旧分类也会重新执行模型增强；历史结果不能静默绕过当前证据策略。

Workspace 项目身份与首次分析是两个明确阶段。用户必须先创建并持久化项目记录，再选择目录并启动首次全量分析；目录选择不再隐式创建或改名项目。当前项目运行分析时，创建另一个项目只新增轻量项目记录，不会切换当前上下文；打开其他项目或隐藏当前项目等会改变上下文的操作，会等任务完成或暂停后才允许执行。

分析界面是真实的有界 Agent 会话，而不是给顺序日志换名称。顶部固定一个流式主 Agent 对话窗口，下面固定三个子 Agent 对话窗口；四个窗口都有固定可视高度，消息只在窗口内部滚动，不随运行时间无限撑长页面。用户进入功能追溯、图谱、审核、影响或指标页面时，Workspace 分析界面继续保持挂载，因此活动任务、对话、耗时和进度不会因导航丢失。页面刷新、暂停或进程失败后，系统会把 IndexedDB 中最近一次持久化检查点恢复为可续跑会话，并展示已完成/总进度。在支持 File System Access API 的浏览器中，Traqen 会按 Workspace 持久化所选目录句柄；点击“继续分析”时如有必要只请求该已保存目录的读取权限，随后重建文件清单并继续任务，不再要求用户重新选择目录。不支持该 API 的浏览器仍使用目录输入兼容方案，无法保存可复用句柄；在该能力上线前创建的旧项目需要做一次迁移授权。匹配的文件记录始终复用；继续使用同一模型配置时复用已完成模型分类，更换模型配置时复用提取结果并用新模型重新分类候选。每个持久化文件或模型检查点还会同步生成阶段性功能树投影，因此已经完成的发现和分层统计会在分析期间逐步出现，并在暂停或刷新后继续可见，不必等整轮任务结束。项目快照与活动检查点会把当前分析投影和大体量扫描记录分开持久化；刷新时优先读取投影和任务摘要，只有真正启动增量分析或继续任务时才延迟读取完整文件记录。公开消息采用紧凑的 Codex 风格工作契约：主 Agent 展示目标、计划、证据基础、风险、任务分配、对账发现和下一步；子 Agent 展示真实的当前任务名称、目标、有界输入、动作、发现、证据、不确定性、检查点和下一步。模型返回的原始结构化 JSON 不作为普通对话展示；校验后，界面把结果投影为包含观察、判断方法、反证检查、不确定性、阶段结论和下一步的可审计公开推理摘要。这是基于证据的过程透明，不是模型私有思维链。当前浏览器编排从同一份独立 Source Manifest 划分三个有界语义分析队列，确定性提取在三个队列启动前执行。ECC 类仓库理解与 Specone 类规格逆向仍属于可选外部分析源；没有真实配置时必须标记为不可用。主 Agent 负责队列分配、暂停、换代和最终对账，不用扫描候选冒充缺失 Skill 的输出。

页面展示的功能树是 Agent 结果投影，不是扫描代码符号的浏览器。扫描候选只作为内部证据输入；只有配置的 Agent 完成分类，并且结果通过候选 ID、源码范围、证据置信度和结构校验后，候选才能进入业务树或 API 树。业务树严格使用 Agent 给出的**业务大模块 → 业务小模块 → 用户可识别功能点**三级结构，源码目录、包名、类名、框架名和原始代码符号不得成为层级名称。具有相同已校验稳定业务标识的多个扫描候选会合并成一个功能点，同时保留全部源码、配置、测试和实现证据引用。旧层级策略生成的分类会保持隐藏并重新进入待模型分析队列，不会把旧扫描标签泄漏回功能树。Workspace 统计页面默认展开当前全部层级，并提供明确的“全部展开”和“收起”控制。

每个子 Agent 槽位都有代次和上下文字符安全预算。达到本地预算的 70% 后，Worker 不再领取新工作，但会先完成当前原子工作单元、保存紧凑交接摘要和检查点、结束当前代次，再在同一可视槽位启动下一代。已完成工作单元保留模型分类，不会重复调用。该编排是 Traqen 原生能力；未来可以把 Claude Code 或 Codex CLI 接在同一运行时/事件边界后面，但实现这种交互不依赖它们。

底层传输遥测保留在默认关闭的“技术诊断”中，可按需查看请求 ID、输入/输出规模、网关耗时、流式进度、有界提示词/证据预览、结构化输出预览、供应商返回的 Token 用量（若有）和校验数据，但这些信息不再作为主界面。API Key、Authorization Header 和模型私有思维链绝不展示。

可以保留多个已扫描项目，同时只在侧栏展示选中的项目。从展示中移出是非破坏操作：Workspace 管理仍会读取其轻量摘要，但不会加载源码索引、功能树和追溯快照；重新勾选即可按需打开，无需重扫。

功能树提供两种投影。纯业务模式会过滤接口、命令、Repository、Adapter、Interface、Utils、配置代码和其他技术支持符号；API 模式展示接口设计数据以及匹配到的入口/调用实现代码块。两种投影都来自同一个 Workspace 最新分析结果。

## 明确边界

分析 Agent 不批准 Claim、不执行测试，也不会把 LLM 说法转成业务事实。浏览器只编排 Hybrid 进度，所有模型调用和凭据仍位于带认证的 Traqen API 后面。模型生成的名称、业务分组、置信度和依据在受治理的人工确认前都只是候选元数据。多实例 Worker 租约和分布式队列属于部署基础设施。OpenAPI YAML 与更多语言的确定性 AST 适配器仍是明确的后续扩展，不会伪装成“已完整分析”。
