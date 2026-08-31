> 语言：**简体中文** · [English](README.md)

# 文档

这里按 Feature 生命周期组织文档，而不是按时间堆积设计草稿。Traqen 的活动产品与工程真相源同时维护英文和简体中文版本。

## 活动真相源导航

- [Feature 路线图](ROADMAP.zh-CN.md) · [English](ROADMAP.md)
- [产品架构](architecture/traqen-product-architecture.zh-CN.md) · [English](architecture/traqen-product-architecture.md)
- [系统需求：存量系统理解与统一质量追溯](architecture/traqen-system-requirements.zh-CN.md) · [English](architecture/traqen-system-requirements.md)
- [ADR-0001：统一追溯本体](decisions/ADR-0001-canonical-traceability-ontology.zh-CN.md) · [English](decisions/ADR-0001-canonical-traceability-ontology.md)
- [ADR-0002：Workspace 聚合与执行隔离](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.zh-CN.md) · [English](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md)
- [代码分支 Review 发布政策](policies/branch-review-publication-policy.zh-CN.md) · [English](policies/branch-review-publication-policy.md)
- [项目概览与运行指南](../README.zh-CN.md) · [English](../README.md)

## Feature 真相源

| ID | 活动 Feature 文档 | 支撑设计 |
|---|---|---|
| F001 | [工作空间与源码真相](features/F001-legacy-system-understanding.zh-CN.md) · [English](features/F001-legacy-system-understanding.md) | 产品架构 |
| F002 | [确定性证据与 API 结构](features/F002-feature-api-traceability.zh-CN.md) · [English](features/F002-feature-api-traceability.md) | 产品架构 |
| F003 | [Agent 候选与审阅后的业务功能树](features/F003-traceability-graph.zh-CN.md) · [English](features/F003-traceability-graph.md) | 产品架构 |
| F004 | [变更影响分析](features/F004-change-impact-analysis.zh-CN.md) · [English](features/F004-change-impact-analysis.md) | 产品架构 |
| F006 | [Workspace 能力配置](features/F006-workspace-capability-settings.zh-CN.md) · [English](features/F006-workspace-capability-settings.md) | [能力解析图](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html) |

F001–F004 是当前存量系统理解的设计基线。F006 保留其独立实施轨道。历史工作产物可因兼容性或审计目的而保留为未链接文档，但不得与本表、路线图或活动架构文档竞争真相源。

## 可视化设计

- [Workspace 能力解析——Archify](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html)

F001–F004 重构不会把旧的可视化探索当作活动规格；只有参考试点合同被证明后，实施才会加入可视化投影。

## 基线规则

路线图、活动 `Fxxx` 文档、产品架构和 ADR 构成唯一设计基线。被替代材料要么移除，要么明确取消链接并标为历史；Git 历史仍是可恢复记录。

## 双语文档策略

任何新增或修改文档的拉取请求，都必须在同一次变更中新增或更新中英文两个版本。

- 新文档优先使用英文规范文件名，例如 `guide.md`，对应的简体中文文件命名为 `guide.zh-CN.md`。
- 如果现有中文文档已经占用稳定的规范路径，则保留该路径，并添加名为 `guide.en.md` 的英文版本。当前架构设计文档采用此兼容规则。
- 每对文档开头都必须提供语言切换链接，并指向另一语言版本。
- 代码、命令、API 路径、标识符、枚举值、配置键和产品模型名称保持不变，除非文档明确说明本地化显示名称。
- 产品愿景、产品护栏、安全边界、验收状态和已知限制在两个版本中的含义必须等价；翻译不得削弱或扩大要求。
- 两个版本必须同步更新。如果其中一个版本无法准确更新，则该文档变更不得合并。

自动化测试 `test/bilingual-documentation.test.js` 会检查 `docs/` 下的 Markdown 文件和仓库 README 文件是否成对存在，并验证语言切换链接。
