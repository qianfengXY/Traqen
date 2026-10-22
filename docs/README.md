> 语言：**简体中文（规范文本）** · [English（可选参考）](README.en.md)

# 文档

这里按 Feature 生命周期组织文档，而不是按时间堆积设计草稿。Traqen 的活动产品与工程真相源以简体中文为规范文本；既有英文译文只作可选参考。

## 活动真相源导航

- [Feature 路线图](ROADMAP.zh-CN.md) · [English](ROADMAP.md)
- [F007 整体功能与三层架构 v0.6](design/F007-function-architecture/v0.6/README.md)
- [系统需求：存量系统理解与统一质量追溯](architecture/traqen-system-requirements.zh-CN.md) · [English](architecture/traqen-system-requirements.md)
- [已发布设计基线](design/README.md) · [English（可选参考）](design/README.en.md)
- [ADR-0001：统一追溯本体](decisions/ADR-0001-canonical-traceability-ontology.zh-CN.md) · [English](decisions/ADR-0001-canonical-traceability-ontology.md)
- [ADR-0002：Workspace 聚合与执行隔离](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.zh-CN.md) · [English](decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md)
- [代码分支 Review 发布政策](policies/branch-review-publication-policy.zh-CN.md) · [English](policies/branch-review-publication-policy.md)
- [项目概览与运行指南](../README.zh-CN.md) · [English](../README.md)

## Feature 真相源

| ID | 活动 Feature 文档 | 支撑设计 |
|---|---|---|
| F001 | [工作空间与源码真相](features/F001-legacy-system-understanding.zh-CN.md) · [English](features/F001-legacy-system-understanding.md) | [已确认的 Design B](design/F001-workspace-source-truth/README.md) |
| F002 | [当前设计入口与历史 Spec](features/F002-feature-api-traceability.zh-CN.md) · [English](features/F002-feature-api-traceability.md) | [确定性事实层：功能设计 V1.0](design/F002-deterministic-facts/README.md) |
| F003 | [功能与 UX 统一设计文档](design/F003-traceability-graph/README.md) | 已确认功能 V2.0 + 待讨论 UX v0.2；旧 Spec 和独立 UX 入口已删除。 |
| F004 | [变更影响分析](features/F004-change-impact-analysis.zh-CN.md) · [English](features/F004-change-impact-analysis.md) | F007 整体架构中的影响与真实验证边界 |
| F005 | [整体布局与导航设计规范 V1.1](design/F005-layout-navigation/README.md) | 六入口、统一缩放与双主题；纳入七问答卷、工作会话、四类回写及回答状态；含 7 张效果图与[17 项差异](design/F005-layout-navigation/CHANGES.md)，样稿限制单列 |
| F006 | [Workspace 能力配置](features/F006-workspace-capability-settings.zh-CN.md) · [English](features/F006-workspace-capability-settings.md) | [功能与 UX 设计 V1.0（桌面双主题）](design/F006-workspace-capability-settings/README.md) |
| F007 | [整体功能与三层架构 v0.6](design/F007-function-architecture/v0.6/README.md) | 已确认整体方案：F001 原材料版本、F002 技术证据、F003 业务知识图谱；保留愿景与工作回路，列出跨层合同及后续设计／代码分解。 |

F007 v0.6 是当前整体功能架构入口；F001–F004 既有局部设计继续作为其已确认范围的依据，后续按 F007 的设计包对齐。F005 规定整体页面体验，F006 保留独立实施轨道；正式文档不等于全部页面或新架构已实现。历史工作产物可因兼容性或审计目的保留，但不得与本表、路线图或当前整体架构竞争真相源。

## 可视化设计

- [Workspace 能力解析——Archify](diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html)

F001–F004 重构不会把旧的可视化探索当作活动规格；只有参考试点合同被证明后，实施才会加入可视化投影。

## 基线规则

路线图、活动 `Fxxx` 文档、F007 当前整体架构、ADR 和已发布设计索引共同构成唯一设计基线。被替代材料声明当前入口，并排除在活动导航之外；保留原位置的历史图稿和已确认设计通过明确的历史入口查阅，Git 历史仍是可恢复记录。

历史参考：[原产品架构与图稿](architecture/traqen-product-architecture.zh-CN.md) · [F007 历史版本入口](design/F007-function-architecture/README.md)。

## 文档语言

简体中文是默认且规范的文档语言。

- 新增或修改的规范文档使用普通 `.md` 文件名并直接以中文撰写；不要求英文副本、语言切换链接或同步翻译。
- 已有英文文件可保留为历史或面向读者的可选参考，但不参与规范真相源，也不产生维护义务。
- 代码、命令、API 路径、标识符、枚举值、配置键和产品模型名称保持原样，除非文档明确说明中文显示名称。
