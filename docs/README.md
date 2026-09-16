> 语言：**简体中文（规范文本）** · [English（可选参考）](README.en.md)

# 文档

这里按 Feature 生命周期组织文档，而不是按时间堆积设计草稿。Traqen 的活动产品与工程真相源以简体中文为规范文本；既有英文译文只作可选参考。

## 活动真相源导航

- [Feature 路线图](ROADMAP.zh-CN.md) · [English](ROADMAP.md)
- [产品架构](architecture/traqen-product-architecture.zh-CN.md) · [English](architecture/traqen-product-architecture.md)
- [系统需求：存量系统理解与统一质量追溯](architecture/traqen-system-requirements.zh-CN.md) · [English](architecture/traqen-system-requirements.md)
- [已发布设计基线](design/README.md) · [English（可选参考）](design/README.en.md)
- [ADR-0001：统一追溯本体](decisions/ADR-0001-canonical-traceability-ontology.zh-CN.md) · [English](decisions/ADR-0001-canonical-traceability-ontology.md)
- [ADR-0002：Workspace 聚合与执行隔离](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.zh-CN.md) · [English](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md)
- [代码分支 Review 发布政策](policies/branch-review-publication-policy.zh-CN.md) · [English](policies/branch-review-publication-policy.md)
- [项目概览与运行指南](../README.zh-CN.md) · [English](../README.md)

## Feature 真相源

| ID | 活动 Feature 文档 | 支撑设计 |
|---|---|---|
| F001 | [工作空间与源码真相](features/F001-legacy-system-understanding.zh-CN.md) · [English](features/F001-legacy-system-understanding.md) | [已确认的 Design B](../feature-discussions/2026-08-30-F001-workspace-source-truth-design/README.zh-CN.md) |
| F002 | [当前设计入口与历史 Spec](features/F002-feature-api-traceability.zh-CN.md) · [English](features/F002-feature-api-traceability.md) | [确定性事实层：功能设计 V1.0](design/F002-deterministic-facts/README.md) |
| F003 | [当前设计入口与历史 Spec](features/F003-traceability-graph.zh-CN.md) · [English](features/F003-traceability-graph.md) | [功能全景 V2.0](design/F003-traceability-graph/README.md) · [English（可选参考）](design/F003-traceability-graph/README.en.md) |
| F004 | [变更影响分析](features/F004-change-impact-analysis.zh-CN.md) · [English](features/F004-change-impact-analysis.md) | 产品架构 |
| F006 | [Workspace 能力配置](features/F006-workspace-capability-settings.zh-CN.md) · [English](features/F006-workspace-capability-settings.md) | [能力解析图](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html) |

F001–F004 是当前存量系统理解的设计基线。F006 保留其独立实施轨道。历史工作产物可因兼容性或审计目的而保留为未链接文档，但不得与本表、路线图或活动架构文档竞争真相源。

## 待评审设计

- [F005 · 整体体验与前端设计总纲（含 16 张效果图、交互样稿与组件规范）](design-reviews/F005/README.md)

此入口供阅读完整提案；方案仍待评审，不改变上方活动设计基线。

## 可视化设计

- [Workspace 能力解析——Archify](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html)

F001–F004 重构不会把旧的可视化探索当作活动规格；只有参考试点合同被证明后，实施才会加入可视化投影。

## 基线规则

路线图、活动 `Fxxx` 文档、产品架构、ADR 和已发布设计索引共同构成唯一设计基线。被替代材料移入[归档](archive/README.md)，声明替代它的文档，并排除在本导航之外；Git 历史仍是可恢复记录。

## 文档语言

简体中文是默认且规范的文档语言。

- 新增或修改的规范文档使用普通 `.md` 文件名并直接以中文撰写；不要求英文副本、语言切换链接或同步翻译。
- 已有英文文件可保留为历史或面向读者的可选参考，但不参与规范真相源，也不产生维护义务。
- 代码、命令、API 路径、标识符、枚举值、配置键和产品模型名称保持原样，除非文档明确说明中文显示名称。
