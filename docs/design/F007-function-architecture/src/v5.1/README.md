---
feature_ids: [F007]
topics: [architecture, diagram-source, cross-view-identifiers]
doc_kind: diagram-source
created: 2026-09-21
status: discussion-draft-not-final
---

# v5.1 部署图编号修订

基于 [v5 部署图源](../v5/deploy.html)修订标签和身份引用，延续 [v5 的 HTML/SVG 绘制方法](../v5/README.md)。未重新生成其他四张概览图；所有历史图源与 PNG 保留。

外部编号对齐系统图：E6 为 Runner／CI，E9 为 Cloudflare 边缘；来源框组合展示 E1 Git 与 E2 上传，其内部布局 ID 为 `sources-E1-E2`。E7 模型服务、E8 被测系统不变。C06／O11 标明外部传输待定；未改变节点职责、箭头端点对应的业务对象或网络候选。

[deploy.html](deploy.html)保留 21 个布局节点、23 条关系。绘制 DOM、SVG 端点与 relationship-manifest 同步；节点名称变化不增加运行单元。

在本架构目录启动仅绑定本机的静态服务，打开 `src/v5.1/deploy.html`。Chromium 视口宽 1800 CSS 像素，等待 document.fonts.ready，全页截图、scale=css，输出 1800 × 1720 PNG。中文字体延续 PingFang SC / Microsoft YaHei / sans-serif。成图、尺寸与哈希见 [assets.json](assets.json)。

正式文档内嵌 [v5.1 PNG](../../images/traqen-architecture-v5.1-deploy.png)，[v5 PNG](../../images/traqen-architecture-v5-deploy.png)仅作对照。修改后同时核对系统图编号、正文节点表和实际图片。
