> 语言：**简体中文（规范文本）** · [English（可选参考）](README.en.md)

---
feature_ids: [F001, F002, F003, F004, F006]
topics: [product-design, source-of-truth, publication]
doc_kind: published-design-index
created: 2026-09-15
status: active
---

# 已发布设计基线

本索引声明每个 Feature 当前采用的设计。它是发布地图，不取代接口合同或实施计划。

| Feature | 已发布基线 | 边界 |
|---|---|---|
| F001 | [工作空间与源码真相入口](../features/F001-legacy-system-understanding.zh-CN.md)与[已确认的 Design B](../../feature-discussions/2026-08-30-F001-workspace-source-truth-design/README.zh-CN.md) | 在 co-creator 的 F001 未提交材料被单独保全前，Design B 保留在工作设计路径。它是详细权威；本索引不授权移动或丢弃这些 WIP。 |
| F002 | [确定性证据与 API 结构](../features/F002-feature-api-traceability.zh-CN.md) | v4 全景图仍是讨论稿：图是内容基线，但源码访问、Schema 与验收合同尚未定稿。 |
| F003 | [功能全景 V2.0](F003-traceability-graph/README.md)与[Feature 入口](../features/F003-traceability-graph.zh-CN.md) | 八组功能和五档分流已发布；访问接口、字段合同和量化验收值仍待确定。 |
| F004 | [变更影响分析](../features/F004-change-impact-analysis.zh-CN.md) | 尚未有已确认的替代设计。 |
| F006 | [Workspace 能力配置](../features/F006-workspace-capability-settings.zh-CN.md) | Feature 文档仍是验收合同；讨论记录是决策来源，不是竞争 Spec。 |

## 发布规则

只有 Feature 文档或本索引点名的设计才是当前真相源。`feature-discussions/` 保留讨论稿、原始产物和决策来源；图稿精修不自动让讨论稿成为已发布设计。`feature-specs/` 保留有效实施计划，不能把仍有效的工作当作归档处理。

## 归档规则

历史文档放入[归档](../archive/README.md)。每份归档文档都声明 `superseded_by`；归档材料不参与活动导航。
