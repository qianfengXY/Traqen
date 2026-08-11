> 语言：**简体中文** · [English](README.md)

---
feature_ids: [F001]
related_features: []
topics:
  - operator-experience
  - legacy-system-understanding
  - source-scan
  - analysis-agent
  - canonical-graph
  - dogfood
doc_kind: discussion
created: 2026-07-29
status: converged
---

# F001 讨论：存量系统理解是核心需求

## operator 体验

> “我说的是扫描阶段，扫描文件这一步。另外将扫描文件与分析 Agent 这一步的逻辑单独列为一个需求，作为重点需求推进。”
>
> “这里还不对，我希望是扫描与分析 Agent 可能需要重新设计。不仅是刷新浏览器的问题，这个需求是我最核心的需求，怎么把存量代码的分析正确。”
>
> “通过分析存量代码或文件等，做一个需求、设计、代码、测试用例、测试结果、配置等图谱关联，便于之后做变更影响分析、内容查看、质量追溯等。”
>
> “拿我自己这个 Traqen 项目做测试验证，通过 Traqen 自己展示自己的功能图谱。”
>
> “第一次分析存量系统肯定是全量分析……需求或者代码等被修改以后进行增量分析，就应该重新更新图谱，同时还需要分析出本次变更会对原来的功能产生哪些影响以及每个功能点的历史版本变化。”
>
> “图谱本身只记录最新的，但功能点是需要记录变化过程及每次变化会影响哪些功能。”
>
> “Analysis Agent 也是从原工程目录读取所有文件，不是从扫描器的结果去分析。Inventory 分区怎么来，WorkUnit 怎么运行，要考虑用什么模型、什么 Skill；工程很大时怎么一次性分析完，是否用多个模型并行，最后一起对账。”
>
> “Workspace 空间作为项目整体的空间……如果 Workspace 切换，则其他功能全部跟随一起变化。”
>
> “主 Agent 负责分析任务规划与结果对账……各子 Agent 完成同一批次的任务后，主 Agent 负责将结果与静态扫描文件的进行参考。”

## 已纠正的理解偏差

第一版 F001 把浏览器独立扫描当成 Feature 目标。operator 已明确：刷新安全只是执行约束，产品结果是正确、有证据地重建存量系统，并产生有用的 canonical graph 投影。

## 已收敛方向

1. 保留 `F001` 作为仓库内首个 Feature ID。
2. F001 重新以存量系统理解正确性为中心。
3. 确定性扫描与 Agent/Skill 分析作为独立证据通道，之后再对账。
4. 分别评估 Inventory、召回、精度、关系正确性、来源、缺口、重放和增量等价。
5. 保持 Candidate/Decision/受治理对象，以及测试线索/TestSpec/执行/Evidence 的边界。
6. 把固定 Traqen Snapshot 的自身图谱、TraceChain 和变更影响旅程设为发布门禁。
7. 服务端持久所有权作为 F001 的支撑设计保留。
8. 第一次成功运行强制 FULL；后续 Snapshot 默认 INCREMENTAL，并通过全量等价门禁。
9. 默认图谱读取最新 `CurrentGraphHead`；GraphRevision、FeatureVersion、Snapshot 实现映射、ChangeSet、ImpactAssessment、Decision 与 Evidence 作为不可变历史保留。
10. 代码或配置变化不能自动创建业务 FeatureVersion；只有 Decision 能修订业务定义。
11. 用 `traqen-self-v1` 数字阈值和 calibration/held-out/challenge 盲测协议阻断过拟合。
12. Agent 从完整不可变 Snapshot 规划，派生确定性有界批次，把同一批次发送给所有已配置且相互独立的子 Agent slot，再由主 Agent 对照静态 Facts 对全部终态 sibling 输出进行对账，禁止投票。
13. Workspace 是分析、追溯、图谱、审核、影响与设置的聚合根；带版本的上下文切换必须重绑全部模块并拒绝旧 Workspace 的迟到响应。
14. 全局模型/Skill/MCP 配置只作为模板；系统物化 Workspace 有效修订，运行时不能访问全局 Registry。

## 设计真相源

- `docs/architecture/traqen-system-requirements.zh-CN.md`
- `docs/architecture/traqen-product-architecture.zh-CN.md`
- `docs/features/F001-legacy-system-understanding.zh-CN.md`
- `docs/features/workspace-scan-and-analysis-lifecycle.zh-CN.md`
- `docs/features/F002-feature-api-traceability.zh-CN.md` 至 `F006-workspace-capability-settings.zh-CN.md`
- `feature-specs/2026-07-31-traqen-product-foundation.md`

## 2026-07-31 GPT/Kimi 相互印证

### 独立观点

- GPT 独立产出 Workspace 根驱动的 F001～F006 架构、同批次主/子 Agent 合同、Workspace 执行 Profile 隔离、图示、`1682d7d` 实现审计和文档重组。
- Kimi 独立提出相同的六个产品 Feature、Workspace 全局联动切换、原始源码分析、默认两个子 Agent、全局模板/项目运行配置、从活动权威中移除旧文档与 Excalidraw/Archify 可视化。

### 已确认共识

1. F001～F006 是正确的产品模块边界。
2. Workspace 切换必须改变全部模块。
3. Scanner Facts 与 Agent 源码分析是进入对账的独立输入。
4. 子 Agent 默认两个，向主 Agent 返回有证据约束的结果。
5. 全局 Skill/MCP 只是模板；Runtime 只能使用 Workspace 选择的能力。
6. 被替代设计和验证资料不能继续与活动 Feature 真相源竞争；operator 最终决定将其从工作树基线删除。
7. F002～F005 必须使用 Canonical Graph，不能另建 Store。

### 分歧与裁决

| 主题 | Kimi 方案 | 收敛决策 |
|---|---|---|
| Workspace / Project | 永久 Workspace → Project 1:1 模型 | 只有一个 Canonical Workspace 聚合；旧 `Project.id` 迁移或仅作为别名，见 ADR-0002 |
| F001 分解 | 新增 `F001a`～`F001k` 生命周期 ID | 保持一个 F001；使用活动实施计划 Task 1～10 |
| F006 优先级 | P2，在 F001 后实现 | P0 基础，先于 Capability Routing，因为 F001 Runtime 隔离依赖它 |
| F002～F005 时机 | 等 F001 全部结束 | 各自依赖的 Canonical Contract 稳定后才开始；禁止临时 Truth Store |
| 主 Agent 规划 | 主 Agent 派生完整 UnderstandingPlan | 确定性 Planner 证明完整处置；主 Agent 负责语义问题、工具/输出合同、Follow-up 与对账 |
| 实现 Gap | 多个 F001 对象被判定不存在 | `1682d7d` 审计确认已有部分 ArtifactInventory、UnderstandingPlan、Capability Router、SourceSlice Broker、GraphRevision/CurrentGraphHead 及相关 API/测试；缺口是连贯集成与目标行为 |
| Archify JSON 草案 | 三份候选源 | 不采用：当前 Archify 校验报告 Schema Error；已入库三份投影达到 showcase `9/9`、零错误/警告 |

### 行动

- 用 ADR-0002 固化 Canonical Workspace 身份与能力隔离；
- 增加 F001 KD-12/KD-13，明确 Project 迁移和计划任务命名；
- 在产品架构与活动 Codex 计划中保留按合同门禁的交付顺序；
- 吸收 Kimi 独立确认的产品边界，但不导入无效或过时产物。

## 2026-08-11 执行 DAG 与语言合同收敛

### operator 决策

> “七阶段需从线性状态机改为执行 DAG，然后中文术语白名单是采用‘尽量中文，仅保留标准缩写、品牌、模型名和 Agent’。”

operator 在两份初始独立方案后确认了这两项决定。随后 GPT 读取 Kimi 在本 thread 的完整公开回复，把剩余差异反向投递给 Kimi；Kimi 明确接受两个执行语义并补充故障模式检查。本节记录的是真实双向印证，不是从并行回答推断共识。

### 已裁决的设计差异

| 主题 | 初始竞争解释 | 经印证的决定 |
|---|---|---|
| 七项活动 | 保留单一权威阶段游标，或只在页面画双通道 | 七项持久活动组成真实执行 DAG，以 `phaseStates`、`activePhases`、`laneProgress` 和 `joinGates` 表示；单值 `phase` 不能驱动调度器 |
| 分叉点 | 等整个 `SOURCE_SCAN` 或最终 FactBundle | `SOURCE_SCAN` 内部的 `snapshotInventorySeal` 检查点密封不可变源码与完整清单，立即解锁 `ANALYSIS`；静态提取继续运行到 `FACT_COMMIT` |
| 静态权威 | 把确定性观察与语义候选称为同一个池 | 保留“确定性观察池 → 静态候选投影”；投影使用统一候选封装，但不能把推断变成 Fact |
| 缺失维度 | 可选字段或 `null` | 六个维度数组全部必填，无证据时为空；独立覆盖状态区分已发现、没有证据、尚未分析、不支持与失败 |
| 实时对账 | 每到一条就合并，或等待全仓结束 | 主 Agent 可以实时观察候选池，但只有完整 `scopePartitionId` 屏障能提交工作树检查点；无关分区继续并发 |
| 跨分区身份 | 把局部检查点当最终结论 | 跨分区/模块/项目汇总通过追加式增量消费下层检查点、后续关系证据与终态 FactBundle，全局评估后才能收敛 |
| 缺失或缓慢的子 Agent | 无限等待或忽略槽位 | 以 `NO_ELIGIBLE_PRODUCER`、超时、预算缺口或策略拒绝等显式终态关闭；缺失永远不能算作一致 |
| 交互历史 | 为控制体量而采样或自动过期 | 结构化事件默认追加写入并长期保存；大正文进入内容寻址的受保护存储，明确记录脱敏，永不保存私有推理 |
| 中文产品术语 | 按组件临时混用熟悉的英文 | 全面使用自然中文，只保留受控标准缩写、品牌、模型名和 `Agent`；英文模式全部使用英文 |

### 页面权威与故障模式检查

- 未对账候选池是明确标注的技术观测视图，不是工作中的功能/API 树。
- 已提交分区检查点在本地范围有效，但对仓库级身份仍是暂定结果。
- 后续发现的跨文件关系形成追加式对账增量，不能重写旧检查点。
- 分区粒度遵循确定性理解计划，不能退化成逐行检查点爆炸。
- 全局 `EVALUATION` 必须等待终态 FactBundle 与所有必需分区和汇总门禁。

### 行动

- ADR-0003 记录已接受的分叉—汇合 DAG 及被拒绝的串行方案。
- F001 生命周期、功能文档、产品架构、系统需求与 ADR-0001 现在区分权威顺序和执行顺序。
- 产品架构负责全局双语展示合同；本讨论不声称后端、前端或 Schema 已经实现。

## 收敛检查

1. 否决方案 → ADR？**有——Workspace 备选方案记录在 ADR-0002；串行执行、等待最终 Fact、乐观对账以及混淆 Fact/Candidate 权威记录在 ADR-0003。**
2. 可复用操作教训 → public lessons？**无独立教训；新增内容是产品架构决策，保留在 ADR-0003 与 F001 验收合同中。**
3. 新增仓库级操作规则 → 指引文件？**无；双语展示是 Traqen 产品合同，不是仓库贡献规则，应保留在产品架构与功能验收中。**

## Design Gate 项

- 确认多维正确性合同；
- 确认经审核、版本化的 Truth Set 权威；
- 确认 Traqen 分析 Traqen 是强制验收；
- 确认 Allowlisted Local Runner 是首个 Source Connector；
- 确认 `traqen-self-v1` 数字阈值与独立盲审；
- 确认首次 FULL、后续默认 INCREMENTAL、原子 CurrentGraphHead 与 Feature/Impact 历史语义。
- 确认完整 Snapshot 派生的 Agent 规划、同批次子 Agent 执行与主 Agent 证据对账。
- 确认 Workspace 根驱动的模块重绑与仅限 Workspace 的运行能力隔离。
- **已于 2026-08-11 接受：**用分叉—汇合执行 DAG 与分区/汇总屏障取代线性七阶段游标。
- **已于 2026-08-11 接受：**产品文案在英文或中文下保持一致；中文只保留受控标准缩写、品牌、模型名和 `Agent`。
