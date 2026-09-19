> 语言：**简体中文（规范文本）** · [English（可选参考）](README.en.md)

---
feature_ids: [F001, F002, F003, F004, F005, F006]
topics: [product-design, source-of-truth, publication]
doc_kind: published-design-index
created: 2026-09-15
status: active
---

# 已发布设计基线

本索引声明每个 Feature 当前采用的设计。每个 Feature 的功能说明与 UX 效果图统一在 `docs/design/F00X-*/README.md`，配套图片和样稿放在其 `assets/` 下。它是发布地图，不取代接口合同或实施计划。

| Feature | 已发布基线 | 边界 |
|---|---|---|
| F001 | [工作空间与来源真相：功能与 UX 设计](F001-workspace-source-truth/README.md) | 已确认的 Design B，按授权迁入统一目录；PR #44 的新图文修订仍按其独立发布流程处理，不提前采纳。 |
| F002 | [确定性事实层：功能设计 V1.0](F002-deterministic-facts/README.md)与[Feature 入口](../features/F002-feature-api-traceability.zh-CN.md) | 六组 24 项功能、五部分出口和双向取证回路已定稿，采用 v4 风格版图；具体读取接口、Schema、首期能力、存储与量化验收值仍待确定，不代表实现完成。 |
| F003 | [功能设计 V2.0（2026-09-17 发布版）](F003-traceability-graph/README.md) | 八组功能逐项说明、五档分流与主活动；沿用已验收 V2.0 原图。访问接口、字段合同和量化验收值仍待确定，UX 探索不属于已确认设计。 |
| F004 | [变更影响分析](../features/F004-change-impact-analysis.zh-CN.md) | 尚未有已确认的替代设计。 |
| F005 | [整体布局与导航设计规范 V1.0](F005-layout-navigation/README.md) | 六入口、统一桌面画布与整体缩放、瓷白/石墨主题、组件及验收规范；取代 V2.1 提案中的双尺寸规则。文档发布不表示产品全部实现或 Feature 完成。 |
| F006 | [功能与 UX 设计 V1.0](F006-workspace-capability-settings/README.md)与[Feature 入口](../features/F006-workspace-capability-settings.zh-CN.md) | 三层配置范围、草稿到生效版本、F005 桌面双主题 UX；MCP 暂停，F003 启动接线未完成。文档发布不等于效果图或 Feature 完成。 |

## 发布规则

只有 Feature 文档或本索引点名的设计才是当前真相源。`feature-discussions/` 保留讨论稿、原始产物和决策来源；图稿精修不自动让讨论稿成为已发布设计。`feature-specs/` 保留有效实施计划，不能把仍有效的工作当作归档处理。

## 归档规则

历史文档放入[归档](../archive/README.md)。每份归档文档都声明 `superseded_by`；归档材料不参与活动导航。
