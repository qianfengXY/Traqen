> 语言：**简体中文** · [English](README.md)

# Traqen

Traqen 是一个企业可追溯质量平台，适用于没有值得信赖的产品、设计或测试资产的遗留系统。

实施遵循一个不可协商的产品愿景：

> 对于每个纳入治理的高价值 Feature，展示一条从已确认业务意图到实际部署 Evidence 的可解释追踪链，并显式暴露每个缺失、陈旧、冲突或失败的环节。

## 实施基础

第一个可执行切片是框架中立域内核。它提供：

- 不可变的复合快照清单；
- 独立权威、一致性、验证、新鲜度、冲突状态；
- 确定性端到端追踪链评估；
- 显式 `TraceGap` 检测；
- 分层失效规则不会在代码更改时使业务意图失效；
- JSON 命令行界面和自动化测试。

PostgreSQL 存储片添加：

- 快照、功能、声明、决策、一致性、测试、证据和跟踪链的版本化表；
- 对事实、决策、执行、证据和追踪链历史的仅附加保护；
- 确定性、受校验和保护的迁移；
- 用于清单和跟踪链修订的存储端口和 PostgreSQL 适配器；
- 通过嵌入式仅供开发的数据库进行真正的 PostgreSQL 迁移测试。

最小的 API 切片添加：

- 框架中立的应用程序服务；
- API-仅限组织、租户、项目、主体和 Snapshot 引导程序，无需直接数据库设置；
- HTTP 用于评估、附加和查询跟踪链的端点；
- 稳定的错误包络、请求相关 ID、JSON 媒体检查和正文限制；
- OpenAPI 3.1 合同；
- 由内存中仅附加存储支持的开发服务器；
- PostgreSQL 生产流程，具有校验和保护的自动迁移、全局 API 令牌身份验证、TLS 策略和正常关闭。

治理切片添加：

- 仅附加 Feature、ClaimScope、Claim 和人类 Decision 记录；
- 编写用于构建受管业务基线的端点；
- Feature 基线查询，将原始声明、完整决策历史记录、最新决策和相关跟踪链保存在一起；
- 数据库强制执行决定不能取代其 Claim 的约束范围或跨越项目的租户边界；
- 当不可变 ID 或受控引用发生冲突时，稳定的冲突响应。

受治理的业务流程切片添加了：

- 不可变、Feature-版本绑定 Actor/Role、BusinessState、StateTransition、guard、异常和 DesignElement 记录；
- 对一个初始状态、最终结果、有效的 actor/state 引用、无自转换和无无法到达的状态进行结构检查；
- 经过身份验证的策略控制的人类权威，参与者身份和确认时间由服务器分配，而不是从客户端或 Skill 接受；
- 从转换和设计元素到现有确定性实现 Facts 的 Snapshot 绑定链接，拒绝缺失的 Facts 而不是发明映射；
- 预设有 `HAS_ROLE`、`HAS_STATE`、`HAS_TRANSITION`、`TRANSITIONS_TO`、`PERFORMS`、`DESIGNED_BY` 和 `IMPLEMENTED_BY` 关系的真实业务流程图；
- PostgreSQL 迁移 `0008_business_process_model`、内存奇偶校验、HTTP/OpenAPI 合约、UI 演示以及更改后的 Snapshots 的参考试点覆盖范围。

高风险 Decision-治理切片添加：

- 仅附加 Decision 审核 `SINGLE`、`DUAL`、`BUSINESS_COMPLIANCE` 和有界 `BREAK_GLASS` 批准模式的案例和事件；
- 提议者和批准者身份严格分离、不同人员计数、所需的 business/compliance 角色组、拒绝、撤销、争议以及通过新批准明确重新开放；
- 有时间限制的紧急例外、政策上限的有效性、指定的紧急原因、审查后截止日期以及可见的 `POST_REVIEW_OVERDUE` 状态；
- 仅在满足配置的批准规则后才原子发布正常的 Decision ，以及用于撤销和争议的仅附加 `DEPRECATED`/`DEFERRED` 权限记录；
- 用于 local/production 集成的多审阅者承载目录，同时将企业 SSO、授权目录和组织 ABAC 留给采用的身份边界；
- PostgreSQL 迁移 `0009_decision_governance`、HTTP/OpenAPI 合约和 memory/PostgreSQL 多人实现测试。

TestSpec 验证片添加：

- 一个不可变的、Feature- 和 Claim- 链接的 TestSpec v1alpha1 协议；
- 将授权端点 Claim 及其精确映射的端点 Fact 确定性转换为具有不可变来源的未经批准的 TestSpec 草案；
- 一个单独的经过身份验证、策略检查的批准工作流程，其参与者、角色、时间、基本原理和幂等性指纹由服务器分配；
- 确定性候选和存储规范验证端点；
- 单独的结构有效性和执行资格结果；
- 审批来源、租户约束的审批人、明确的操作安全级别；
- 拒绝字面秘密、令牌、凭证和授权值的存储；
- 消除因断言缺失、批准缺失、受控写入种子协议缺失和清理缺失造成的政策差距；
- Feature 业务基线中的最新 TestSpec 版本。

可信执行-摄取切片添加：

- 从保留的尝试和断言结果中得出确定性 TestExecution 状态；
- 经过证明的 Evidence 捆绑包绑定到确切的 TestSpec 版本、快照清单、部署和 Runner 版本；
- 规范 SHA-256 Evidence 哈希值和 HMAC-SHA256 Runner 证明验证；
- TestExecution 的原子仅附加持久性并经过验证 Evidence；
- 拒绝伪造状态、修改的 Evidence、未编辑的敏感值、错误部署和跨项目签名；
- Feature 基线和按需完整 Evidence 端点中的最新执行摘要。

Evidence-生命周期切片添加：

- 不可变的、版本化的保留策略，按数据分类和 Evidence 类型划分，具有单独的归档和保留期限；
- 仅附加存档、合法保留 placement/release、删除请求、删除证明、访问和导出事件；
- 明确 `DELETION_BLOCKED_LEGAL_HOLD` 和 `DELETION_DUE` 声明而不是默默删除或无限期保留内容；
- 角色过滤的 access/export 审计、生命周期治理授权，以及所需的不可逆外部对象删除证明，同时保留哈希值和审计历史记录；
- PostgreSQL 迁移 `0011_evidence_lifecycle`、内存奇偶校验、HTTP/OpenAPI 合约和 domain/API/PostgreSQL 测试。

受控的 Runner 切片添加：

- 签名的 Runner 任务具有最长五分钟的有效期窗口、抗重放随机数、本地策略哈希、目标 Runner 绑定和可注入随机数注册表；
- 明确的目标和路由白名单、响应大小限制、超时和重定向阻止；
- 仅本地 `secretRef` 解析，具有递归请求、响应、行、断言和错误编辑；
- 用于 GET/HEAD 的 SAFE_READ HTTP 执行器，加上用于有界 POST/PUT/PATCH 请求的明确允许的 CONTROLLED_WRITE 执行器；
- 只读数据库执行器，仅接受受信任的查询目录引用，从不接受 TestSpec SQL，同时将执行的规范化目录 SQL 保留在签名的 Evidence 中；
- 现有测试执行器，仅接受受信任的本地 `testRef` 目录条目，在没有 shell 或任务提供的环境的情况下运行，限制输出和时间，并保留退出 code/stdout/stderr 以确定性断言；
- 通过签名的装置目录选择可信的目标本地种子和清理处理程序，并单独保存 setup/cleanup 结果；
- 由签署的策略声明选择的可信目标本地 LOG、TRACE、COVERAGE、SCREENSHOT 或 OTHER 收集器，具有编辑和 Snapshot 绑定；
- 确定性行计数和字段断言，然后是带符号的 Evidence 捆绑包生成；
- 在设置、步骤或断言失败后保证清理，以及清理失败时的隔离和补偿元数据；
- 明显的产品故障、执行错误、Evidence 不足、跳过和取消状态；
- 签名任务、存储的 Snapshot 清单、运行目标和每个 Evidence 清单之间的确切源、构建、部署和运行时组件 identity/digest 匹配。

确定性事实基础切片添加：

- 具有稳定实体 ID 和快照特定事实 ID 的语言中立、不可变的 `FactNode`/`FactEdge`/`FactBundle` 合约；
- 用于模块、符号、状态 enums/transitions、条件和权限保护、异常路径、Express 样式路由、OpenAPI JSON、PostgreSQL DDL 和文字查询、配置引用、依赖项和测试资产的有界 JavaScript/Node 扫描器；
- 每个事实和关系的源工件、线路范围和 SHA-256 位置数据；
- 解析器失败、文件过大、源语言不受支持以及 OpenAPI 格式不受支持的显式不完整结果；
- 用作源 Snapshot 摘要的确定性源指纹 API；
- HMAC-SHA256 Scanner 证明加上准确的 Snapshot 清单、源组件 ID 和摄取前的源组件摘要绑定；
- 仅附加内存和 PostgreSQL 存储以及经过过滤的一跳事实图 API；
- 自扫描命令和签入的扫描仪验证报告。

Reverse Skill 框架切片添加：

- 已签名、版本化的 Skill 清单，具有声明的兼容性、结构化 input/output 类型、最低特权权限、模型配置文件、超时和输出上限；
- 仅附加 `ALLOWED`/`OBSERVE`/`BLOCKED` 供应链注册事件绑定到已安装的适配器工件摘要；
- 受控、可重复散列且受服务器大小限制的 Fact 输入包，其任务范围无法转义所选的 Snapshot 清单和源 Snapshot；
- 两个可替换的内置 Specone 和 GSD 兼容参考适配器，仅从确定性事实中发出候选实现知识；
- 通用 TEST_DESIGN 功能，可从端点 Facts 提出需要人工审核的 TestSpec 候选，而无需批准或执行它们；
- 超时、重试、取消信号、敏感输出、未声明输出、不完整事实、发布者、模型和策略检查；
- 规范的结构化候选输出，具有强制性事实来源和单独保存的原始输出；
- 精确的确定性重复数据删除，保留每个来源，加上范围感知的明确冲突和开放问题，而不是多数投票；
- 仅附加 PostgreSQL 运行事件、每次 Skill 尝试、原始和标准化输出、冲突和开放问题；
- APIs 用于 Skill registration/listing、同步有界反向运行以及选择持久异步作业。

异步反向运行切片添加：

- `Prefer: respond-async` 或 `?async=true` 立即提交 `202` 和可查询的工作预测；
- 仅追加 `QUEUED`、`STARTED`、`CANCEL_REQUESTED`、`COMPLETED`、`FAILED` 和 `CANCELLED` 事件，而不是覆盖任务行；
- 通过现有的 Skill 超时边界、终端状态冲突保护和确定性错误摘要主动取消 AbortSignal；
- 通过显式恢复操作持久恢复中断的非终端请求，同时保留每个先前的尝试事件；
- PostgreSQL 迁移 `0010_reverse_run_job`、内存奇偶校验、HTTP/OpenAPI 合约，以及有序持久性、取消、恢复和不可变作业历史记录的测试。

受管理的 Feature-可追溯性切片添加了：

- 经过验证、经过政策检查、声明级候选人审核，结果为 `CONFIRMED`、`EXCEPTION_RECORDED`、`REJECTED`、`INSUFFICIENT_EVIDENCE` 和 `DEFERRED`；
- 将已批准的候选实现原子转换为不同的人类编写的规范性Claim、绑定Scope、仅附加Decision、精确Fact映射和确定性一致性结果；
- 明确保护客户提供的审稿人身份、候选人重述、不相关的冲突确认、交叉Scope决策以及将Skill输出直接提升为业务真相；
- 服务器派生的 Feature 可追溯性视图，其权威性、一致性、验证性、新鲜度和冲突维度保持独立；
- 有界 Cytoscape Feature 图和最短路径 API 从同一可追溯源投影，具有类型断言、冲突、TraceGaps、出处、Snapshot 绑定和渐进扩展；
- 有序跟踪段涵盖Feature、Claim、Decision、Scope、一致性、实现Facts、TestSpec、执行和Evidence，具有显式`TraceGap`记录而不是复合绿色分数；
- 不可变的 Snapshot 至 Snapshot `ChangeSet`、影响、失效和语义连续性记录以及受影响的 Feature/Claim/TestSpec 选择、Scope、原因和建议的操作；
- 确定性地将未更改的 Fact 映射和一致性结转到新的 Snapshot 中，而更改后的实现仅使其派生层无效并保留规范性 Claims、业务 Decisions、历史 Facts、Evidence 和审核历史记录；
- 无外壳 Git Diff 分析器，仅接受完整提交哈希值，保留 add/delete/modify/rename 路径，并确定性地将更改的工件与 Snapshot Fact 更改相关联；
- 经过身份验证的实施再分析工作流程，将已审查的当前Snapshot反向候选者绑定回现有规范Claim，在不可变的一致性分析中记录审查者出处，并关闭过时的实施部分，而不创建替代业务Decision；
- 使用顺序不可变版本、版本绑定别名和拒绝悬空或循环边缘的人类归因的 merge/split 谱系来控制 Feature 演化；
- 通过 `0012_feature_evolution` 进行仅附加 PostgreSQL 迁移，以及等效的内存中行为和 HTTP/OpenAPI 合约。

产品界面切片添加：

- `web/` 下的响应式 Feature 可追溯性工作台，以“为什么当前部署值得信赖”而不是综合质量评分为主导；
- 独立权威、一致性、验证、新鲜度、冲突状态卡；
- 针对反向运行、Scanner 数量、测试执行、Evidence 和影响分析的实时平台操作观察，并明确显示不可用的外部遥测；
- 面向业务用户的五段式投影——功能描述、设计实现、配置、测试用例和测试结果——把功能说明和测试策略分别呈现为一个连续文档，而不是嵌套字段卡片；设计实现绑定仓库中的 Markdown 文件，并支持设计文档、原始 Markdown、业务代码块和完整源文件四种视图；同时提供 DEV/SIT/UAT/PROD 配置矩阵、可展开的版本化用例，以及按场景组织并支持失败下钻的执行结果；
- 参考 Apple 桌面显示风格、针对 27 英寸工作区优化的响应式视觉系统：放大字体、使用克制的系统色彩和舒适的文档行宽，并统一导航、面板、表单、图谱、审核、影响与指标页面的间距和层级；
- 稳定的未来 Agent 边界：Agent 只能消费已批准、版本固定的 TestSpec，并回传结构化步骤、断言、Evidence、Runner 身份与证明数据；Agent 不得改写业务确认，也不能自行决定最终可信状态；
- 明确的 TraceGap 所有权、经过验证的语句级人工审核流程以及 API 支持的 Snapshot 历史记录与变更影响修复指南的比较；
- 由本仓库真实设计、源码、配置契约、测试和结果支撑的 Traqen `SELF WORKSPACE` 投影，以及加载服务端派生 Feature 追溯 API 的连接面板；客户端不会重新解释可信状态；
- 仅保存在页面内存中并通过 `x-traqen-api-token` 发送的 API 令牌字段，使审阅者授权凭证保持独立；
- 用于将浏览器产品连接到 Traqen API 的显式 CORS 来源允许列表。

内置参考导频切片添加了：

- 一个可运行的合成订单平台，具有真正的 HTTP 端点、PostgreSQL 兼容状态、配置、角色和状态保护、幂等性、库存依赖性、事务回滚和同订单并发序列化；
- 一个命令扫描参考源，运行可替换的 Reverse Skills，执行授权语句审查，生成并批准受控写入 TestSpec，执行 API 加上数据库断言，存储签名的 Evidence，并证明完整的跟踪链；
- 由通用 Scanner 计算的源摘要、根据实际可运行模块文件计算的 Deployment/Build 摘要、根据有效 schema/config/inventory 上下文计算的运行时摘要以及从运行目标收集的 LOG/TRACE 遥测数据；
- 独立副本中的真实源修改、Snapshot 比较、受影响的Feature 失效、显式过时差距、授权实施重新分析、新部署上的回归执行以及完整链的恢复；
- 在 Snapshots 中重用未更改的批准的 TestSpec：其 `sourceSnapshotId` 保留生成来源，而签名的 Runner 任务和 Evidence 绑定实际执行 Snapshot 和部署。
- 有界端点实现上下文，通过审查、映射、更改影响、图形探索和修复保留 state/permission 防护、状态转换和异常路径 Facts，而不将它们视为业务权限。

连续保护切片添加：

- 服务器导出的回归计划，选择映射受影响的 TestSpecs 联合操作员配置的固定高风险集；
- 每当 Fact 比较不完整或发出警告时，保守的后备扩展；
- 明确的未解决的测试、每个Feature独立尺寸、TraceGaps、选择原因和所需的维修操作；
- 将 `PASS`、`BLOCKED` 和 `UNKNOWN` 评估与 `ADVISORY`、`MANUAL_APPROVAL` 和 `ENFORCED` 政策执行分开；
- API、CI 退出代码 CLI、产品门面板和垂直试点证明，在重新分析和当前部署执行后从更改后的阻止转变为通过。

产品有效性指标切片添加了 Snapshot 绑定仪表板和 API 用于高价值有效链率、Claim 确认、确认规则 TestSpec 覆盖范围、有意义的断言、Evidence 新鲜度、TraceGap type/severity/owner 和每 Feature 层的存在。每个比率都保留其分子和分母，每个 Feature 都保留其独立的信任维度，并且需要外部纵向、CI/CD 或缺陷数据的指标明确不可用，而不是估计。 `HIGH_VALUE_FEATURE_IDS` 可选择缩小北极星数量；如果没有它，所有受管理的 Features 都将包括在内。

开发服务器仍然位于本地且位于内存中。生产过程需要 PostgreSQL 和全局 API 代币。除非配置了审阅者身份，否则 Decision 审阅、候选人审阅、TestSpec-批准和业务流程确认路由也会无法关闭。将旧版 `REVIEWER_ID`/`REVIEWER_ROLE` 与可选的 `REVIEWER_BEARER_TOKEN` 或 `REVIEWER_IDENTITIES_JSON` 结合使用以获取多个令牌绑定的 actor/role 身份；默认情况下禁用直接 Decision 创建，并且需要审查用例 API ，除非显式设置 `ALLOW_DIRECT_DECISIONS=true` 。 Decision proposer/approver/business/compliance/Break-glass/lifecycle 角色和最长紧急分钟数可独立配置。实现重新分析具有明显的 `IMPLEMENTATION_REVIEWER_*` 边界。将 `RUNNER_ID` 和 `RUNNER_SHARED_SECRET` 设置为摄取匹配 Runner 签名的捆绑包，将 `SCANNER_ID` 和 `SCANNER_SHARED_SECRET` 设置为 Scanner 签名的 Fact Bundles，将 `SKILL_PUBLISHER=TRAQEN` 加上 `SKILL_PUBLISHER_SHARED_SECRET` 设置为Skill 注册。 HMAC 是本地 MVP 信任机制，不能替代企业工作负载身份和 mTLS。 CONTROLLED_WRITE 保持禁用状态，除非签名的目标策略明确允许操作和路由、绑定每个 Snapshot 组件、命名受信任的固定装置和清理协议，并且 Runner 具有匹配的本地处理程序。 DELETE、破坏性执行、任务编写的 commands/SQL/fixture 代码、外部副作用和跨源重定向仍然被阻止。仅编译后的、摘要匹配的参考 Skill 适配器在进程内执行；官方外部 Specone/GSD 集成、模型支持或第三方 Skills、独立的 Skill 工作人员、其他语言扫描程序和 OpenAPI YAML 提取仍然位于存储库控制的 MVP 之外。

## 快速启动

完整的本地环境需要 Node.js 22.13 或更高版本。首次检出代码或锁文件发生变化后，只需安装一次根目录和 Web 依赖：

```bash
npm run setup
```

此后使用一个命令即可同时启动本地 API 和 Web 应用：

```bash
npm run dev
```

打开 `http://127.0.0.1:3000` 即可访问页面。该命令会在 `http://127.0.0.1:3100` 启动内存 API，自动配置精确的本地 CORS 来源，并在按下 `Ctrl+C` 时一起关闭两个进程。它不会启用生产凭据，也不会弱化任何治理边界。

仍可通过 `npm run api:dev` 在默认端口单独启动 API；此路径只要求 Node.js 20 或更高版本。其他专项命令保持可用：

```bash
npm test
npm run test:storage
npm run test:web
npm run test:reference
npm run example
npm run pilot:order-submit
npm run quality-gate -- --base-url http://127.0.0.1:3100 --project PROJECT-001 --change-set CHANGESET-001
npm run scan:self
npm run api:serve
```

开发 API 仍然只绑定本机回环地址并使用内存存储。它不是生产认证边界，不得暴露到本地开发环境之外；除非配置了受信任的本地审核者，否则治理审核操作仍会安全失败。

生产 API 默认绑定到 `0.0.0.0:3000`，并且需要 `DATABASE_URL` 加上 `API_BEARER_TOKEN`。默认情况下，`POSTGRES_SSL` 是 `require`，并且对于显式控制环境也接受 `no-verify` 或 `disable`。 `CORS_ALLOWED_ORIGINS` 是一个以逗号分隔的精确来源允许列表。启动时，该进程通过固定的 `pg` 客户端进行连接，验证并应用挂起的迁移，然后为 PostgreSQL 支持的应用程序提供服务。通过 `POST /v1/projects` 创建初始边界，通过 `POST /v1/projects/{projectId}/snapshots` 注册不可变执行上下文，并通过 `Authorization: Bearer ...` 或 `x-traqen-api-token` 发送 API 令牌。 API和产品UI可以通过`GET /v1/projects/{projectId}/features`和`GET /v1/projects/{projectId}/snapshots`发现可用资源； Snapshot 结果首先是最新的，因此服务验证不需要从存储中复制不透明 ID。

`QUALITY_GATE_MODE` 默认为 `ADVISORY`，可以设置为 `MANUAL_APPROVAL` 或 `ENFORCED`。 `HIGH_RISK_FEATURE_IDS`、`FIXED_HIGH_RISK_TEST_SPEC_IDS` 和 `CONSERVATIVE_REGRESSION_TEST_SPEC_IDS` 是逗号分隔的策略输入。质量门CLI从`TRAQEN_API_TOKEN`（或`API_BEARER_TOKEN`）读取其凭证，对于pass/advisory警告返回0，对于强制失败返回1，当需要手动批准时返回2，对于API/配置失败返回3。

评估另一个跟踪链输入：

```bash
node src/cli/evaluate-trace-chain.js path/to/input.json
```

发出完整签名的 Fact Bundle 以供摄取：

```bash
SCANNER_ID=javascript-node-scanner \
SCANNER_SHARED_SECRET=local-development-secret \
node src/cli/scan-facts.js --root . --project PROJECT-001 \
  --snapshot SNAPSHOT-MANIFEST-001 --source-component SOURCE-SNAPSHOT-001
```

Fact API 接受 `POST /v1/projects/{projectId}/fact-scans` 处的签名包，并从 `GET /v1/projects/{projectId}/facts` 返回过滤后的一跳图。其 `type`、`predicate`、`q`、`snapshotManifestId` 和 `limit` 查询参数是可选的。

`npm run pilot:order-submit` 是可复制的存储库内 MVP 证明。它仅使用合成数据以及真实飞行员使用的相同通用Scanner、Skill、审查、TestSpec、Runner、Evidence、影响和修复路径； Traqen 核心中不存在特定于订单的行为。

Reverse Skill 清单在 `POST/GET /v1/skills` 中注册和列出。有界运行按 ID 和确切版本固定每个 Skill，提交到 `POST /v1/reverse-runs`，并从 `GET /v1/projects/{projectId}/reverse-runs/{runId}` 查询。原始 Skill 输出永远不会被视为 Claim 或业务基线：运行在 `WAITING_REVIEW` 处停止，包含候选人、冲突和悬而未决的问题，直到单独的授权审核流程记录结果。

对于长时间运行的工作，请发送 `Prefer: respond-async` 或 `?async=true`。轮询相同的运行 URL；使用 `POST .../cancel` 取消，或在进程恢复后使用 `POST .../resume` 恢复持久的非终端作业。作业状态仅在 PostgreSQL 中追加。存储库并不声称这个单进程工作人员是分布式租赁协调员；多实例所有权和队列基础设施仍然是部署集成。

使用 `POST /v1/projects/{projectId}/reverse-runs/{runId}/candidates/{candidateId}/reviews` 审查一个候选者，然后从 `GET /v1/projects/{projectId}/features/{featureId}` 和 `GET /v1/projects/{projectId}/features/{featureId}/traceability?snapshotManifestId=...` 读取其受管理的基线和服务器派生的证明链。兼容性 `/baseline` 路线公开相同的受控基线。 Snapshot 绑定的冲突和链集合可在 `/features/{featureId}/conflicts` 和 `/features/{featureId}/trace-chains` 处获得；两者都是相同可追溯性计算的投影。授权 product/business 审阅者在 `POST/GET /v1/projects/{projectId}/features/{featureId}/process-model` 处附加或读取 Feature 状态机。通过 `GET /v1/projects/{projectId}/features/{featureId}/graph?snapshotManifestId=...&view=business` 和有界路径查询端点探索相同的数据。使用 `POST /v1/projects/{projectId}/change-sets` 比较两个清单；不可变的影响记录可在 `GET /v1/projects/{projectId}/change-sets/{changeSetId}/impact` 处找到。

使用 `POST /v1/projects/{projectId}/decision-review-cases` 创建高风险或紧急权限提案，在 `POST /v1/projects/{projectId}/decision-review-cases/{caseId}/events` 处附加独立的 approval/lifecycle 事件，并在 `GET /v1/projects/{projectId}/decision-review-cases/{caseId}` 处检查当前重播状态。在满足配置的角色和分离规则之前，不会发布 Decision。

从 `GET /v1/projects/{projectId}/change-sets/{changeSetId}/continuous-protection` 得出其增量回归和策略控制 CI 结果。此端点永远不会将不完整的影响转变为通过，也永远不会用一个综合分数替换单个 Feature 信任维度。

阅读 `GET /v1/projects/{projectId}/metrics/product-effectiveness?snapshotManifestId=...` 中当前 Snapshot 的产品有效性观点。响应有意没有综合分数。

使用 `POST /v1/projects/{projectId}/evidence-retention-policies` 控制 Evidence 保留，在 `POST /v1/projects/{projectId}/evidence/{evidenceId}/lifecycle-events` 处附加 archive/Legal Hold/deletion/access 事件，并从 `GET .../lifecycle?policyId=...` 读取重播状态。 `DELETED` 事件证明外部原始内容被删除；它永远不会删除不可变的哈希值和审计证明。采用企业仍然提供加密对象存储并执行物理对象操作。

在新的反向运行中分析更改的实现后，授权开发人员或架构师可以使用 `POST /v1/projects/{projectId}/features/{featureId}/claims/{claimId}/implementation-reanalyses` 修复过时的实现部分。这将为现有 Claim 和 Scope 创建新的 Snapshot 绑定映射和一致性记录；它从不编辑或替换规范的 Decision。

详细设计见 [docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md](docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md)。当前仓库的验收结果和明确的外部试点边界记录在 [docs/implementation/mvp-acceptance-audit-2026-07-14.md](docs/implementation/mvp-acceptance-audit-2026-07-14.md)；生产启动与引导由 [docs/implementation/production-runtime-validation-2026-07-14.md](docs/implementation/production-runtime-validation-2026-07-14.md) 说明。完整约定见[文档导航与双语维护策略](docs/README.zh-CN.md)。
