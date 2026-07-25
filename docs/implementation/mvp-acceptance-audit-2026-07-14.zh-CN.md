> 语言：**简体中文** · [English](mvp-acceptance-audit-2026-07-14.md)

# MVP验收审核 — 2026-07-14

## 结论

存储库控制的 MVP 机制满足设计第 20 节中的所有 17 项验收能力和第 18.1 节中的技术范围。内置订单参考试点使用外部系统使用的相同通用 Scanner、Skill、治理、TestSpec、Runner、Evidence、影响、修复和显示合同来执行完整的第 18.3 节链。

这并不作为企业价值的最终证明。第 18.2 节和第 18.4 节的企业一半要求一个真正的中型试点系统、三个实际业务流程、10-20 个受控Features、实际测试infrastructure/data，并由负责的业务、开发和测试负责人确认。这些资产和人员都在这个存储库之外，并且没有被伪造。

完成审核于 2026 年 7 月 15 日刷新，存储库还添加了生产运行时引导、持久异步反向运行状态、受控业务流程模型、高风险多方 Decision 审核、Evidence retention/Legal Hold/deletion 证明、Feature 别名和merge/split 血统、持续保护策略执行、独立的产品有效性指标、平台运营观察、项目资源发现和有界交互 graph/path APIs。这些新增内容消除了超出 17 项最低验收项目的设计限制，且不改变产品北极星。

## 第 20 节 接受矩阵

| # | 结果 | 储存库证据 |
| ---: | :---: | --- |
| 1 | PASS |`JavaScriptProjectScanner` 提取代码符号、端点、文字 SQL、tables/columns、配置、依赖项和测试，而无需调用 Reverse Skill； Scanner 回归涵盖位置、诊断和源指纹。 |
| 2 | PASS | 已签名、版本固定的 `specone-reference` 和 `gsd-reference` 适配器通过一种可替换协议进行注册、选择、阻止和审核。 |
| 3 | PASS | 反向运行将有限的原始输出与标准化候选者分开；每个候选者都引用准确的输入 Facts 并且所有生产者出处都经过重复数据删除。 |
| 4 | PASS | Scope 感知相反约束创建显式开放 `Conflict`；任何分数、多数或适配器都不会覆盖另一个结论。 |
| 5 | PASS | React Feature 工作台在一个有序视图中显示 product/Claim/Scope/Decision、实现 code/data/config、TestSpec/断言、执行和 Evidence。 |
| 6 | PASS | 经过身份验证的语句级审核支持确认、例外、拒绝、不足Evidence、推迟；服务器拥有审阅者身份并保留不可变的决策历史记录。 |
| 7 | PASS | 授权的 Claim 加上其映射的端点 Fact 确定性地生成未经批准的可执行文件 TestSpec 草案；执行前需要独立批准。 |
| 8 | PASS | 参考试点针对 PostgreSQL 兼容测试环境运行真实的本地 HTTP 写入，然后通过受信任的只读查询目录验证数据库状态。 |
| 9 | PASS | Runner 签名的 Evidence 保留精确版本以及 request/response、规范化白名单 SQL、查询 parameters/rows、断言、生命周期、结构化 LOG 和 TRACE 记录。 |
| 10 | PASS |全哈希、无外壳 Git Diff 标识更改的工件； Snapshot Fact 比较产生 14 个更改，并将它们映射到受影响的 Feature、Claim 和 TestSpec。 |
| 11 | PASS | 变更影响仅使实现映射、一致性、coverage/verification、新鲜度和跟踪段失效；授权的重新分析加上回归执行修复了链条。 |
| 12 | PASS | 服务器派生的视图和产品解释使用单独的权限、一致性、验证、新鲜度和冲突维度（而不是综合分数）回答了为什么当前部署是可信的。 |
| 13 | PASS | 参考试点和产品呈现完整的已确认Claim→Scope→Decision→implementation/data/config→TestSpec→断言→当前部署执行→Evidence链。 |
| 14 | PASS | Missing/stale/conflicting 阶段产生类型化的 `TraceGap` 记录并强制 `complete=false`；改变后的部署明显暴露了修复前的三个缺陷。 |
| 15 | PASS | 仅实现的更改保留规范的 Claim、Scope、人类 Decision、历史 Facts 和历史 Evidence，而仅派生的当前状态层过期。 |
| 16 | PASS | 执行domain/tests区分`FAIL`、`ERROR`、`INCONCLUSIVE`、`SKIPPED`和`CANCELLED`；非零可信现有测试退出可能是产品断言失败而不是基础设施错误。 |
| 17 | PASS | 源使用 Scanner 字节，Build/Deployment 使用实际可运行模块文件的摘要，运行时使用有效的 schema/config/dependency 上下文。签名的任务、运行目标、存储的 Snapshot 和每个 Evidence 清单必须与所有四个 ID 和 SHA-256 摘要匹配。 |

## 第18.1节技术范围

- Node.js 是主要的后端语言； React是产品Web框架； API 是 REST ， PostgreSQL 是生产关系存储。
- 一个存储库和内置订单测试环境是完全可执行的。
- 实现了基本 Scanner、HTTP 执行器、只读数据库断言执行器、受控写入执行器和可信现有测试执行器。
- 实现了两个可更换的反向适配器以及通用的 TEST_DESIGN 功能。 Skill 输出仍然是候选知识，有待人工审查。
- 人工审查、Feature 可追溯性、有序证明链、TraceGap 显示、Snapshot 历史比较和 Git Diff/Fact 增量影响在协议、APIs 和产品界面中实现。
- 生产 API 从 PostgreSQL 迁移和环境配置开始，需要身份验证，解析审阅者身份服务器端，限制浏览器来源，并公开 project/Feature/Snapshot 发现，而无需直接数据库设置。
- 业务状态机、Feature versions/aliases/lineage、高风险多方 Decisions、Evidence 生命周期、异步作业历史记录、连续质量门、独立产品运行状况和操作遥测都保持仅附加或服务器派生的状态，而不是客户端拥有的可变状态。
- 存储库无法观察到的外部遥测数据（Runner heartbeat/resource 使用、模型代币成本和 Evidence 管道阶段持续时间）明确不可用，而不是呈现为零或正常。

## 可执行的垂直证明

`npm run pilot:order-submit` 目前证明：

- 来自第一个完整 Snapshot 的 53 个 Fact 节点和 110 个关系；
- 两个 Reverse Skills，两个关于合并后的 Claim 候选的独立来源，以及一个需要审查的候选 TestSpec；
- 经批准的 `TEST-ORDER-SUBMIT@2` 并执行 `PASS`；
- `ASSERTION`、`DATABASE`、`HTTP`、`LOG`、`OTHER` 和 `TRACE` Evidence；
- 对 `src/server.js` 的真正提交更改、更改的部署工件摘要以及 14 个与 Git 相关的 Fact 更改；
- 保留 `CONFIRMED` 权限以及修复前的 `CONFORMANCE_STALE`、`NOT_EXECUTED_ON_CURRENT_DEPLOYMENT` 和 `EVIDENCE_STALE` 间隙；
- 授权重新分析、`PASS` 回归、拒绝历史 Evidence 作为新部署的证明，以及最终的零间隙完整链。

## 外部接受边界

仅靠源代码无法真实完成以下设计成果：

1. 第18.2节：选择一个真正的中型试点、三个核心业务流程和10-20个Features。
2. 第 18.4 节：连接真实代码、测试环境、编辑数据、配置、只读数据库访问、logs/traces 和现有测试。
3. 让实际业务、开发和测试所有者确认陈述并衡量逆向分析准确性、审查成本、TestSpec 可执行性、影响质量、回归值、高价值 Feature 追踪链率、修复时间、Evidence 新鲜度和缺陷逃逸。

提供这些输入后，不需要仅模拟代码路径：生产 API、Scanner/Fact 合约、可替换 Skill 协议、审核工作流程、可信 Runner 目录、Evidence 摄取、影响服务和 UI 是预期的试点路径。在真正的试点运行之前，诚实状态是**存储库MVP机制完成；企业价值接受有待外部试点**。

## 整合决策

外部试点边界是 acceptance/deployment 依赖项，而不是未完成的存储库代码。因此，一旦完整的自动化测试套件、Web lint/build/render 测试和内置垂直试点通过集成提交，存储库控制的设计范围就可以进行集成。集成不得声称企业试点或不可用的外部基础设施已完成。
