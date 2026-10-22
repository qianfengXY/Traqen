---
feature_ids: [F007]
topics: [architecture-diagrams, visual-style, svg, diagram-sources]
doc_kind: diagram-source
created: 2026-10-22
updated: 2026-10-22
---

# F007 v0.6 图稿与风格依据

两张图使用 [v0.6 已确认内容](../README.md)，视觉参考历史图稿：[v0.4 总图](../../v0.4/images/0-overview-v2.2.png)和 [v0.5 内部架构](../../v0.5/images/0-internal-architecture.png)。用户在当前远程会话明确要求参考旧版图片展示风格，内容采用新方案。

沿用浅灰蓝背景、白色圆角卡片、深蓝标题、蓝绿关系线及橙色待细化说明；绿色用于强调业务知识及其持续使用。新图以 SVG 原生绘制，文字和关系可编辑，再导出两倍尺寸 PNG。旧图原文件保留。

| 图稿 | 可编辑源 | 正文图片 | PNG 尺寸 |
|---|---|---|---|
| 整体功能与三层主线 | [SVG](01-functional-architecture.svg) | [PNG](01-functional-architecture.png) | 3200 × 2500 |
| 运行职责与持久化 | [SVG](02-runtime-architecture.svg) | [PNG](02-runtime-architecture.png) | 3200 × 2440 |

图中的目标职责、读取合同同步和实现状态遵循正文，不以图片中的连线代替运行接线或验收证据。Mermaid 关系定义在正文折叠保留。

PNG 使用仓库现有 Web 依赖中的 `sharp` 从对应 SVG 转换：输入密度 144 DPI、PNG 格式；图源以 1600 单位宽度绘制。中文字体使用 `PingFang SC`，并声明其他中文无衬线字体回退；不同系统重导出时需复查字体、文字边界和连线。图源有 SVG 标题与描述，正文图片带替代文本。
