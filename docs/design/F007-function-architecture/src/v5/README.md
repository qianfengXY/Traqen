---
feature_ids: [F007]
topics: [architecture, diagram-source, image-generation]
doc_kind: diagram-source
created: 2026-09-21
status: discussion-draft-not-final
---

# v5 图源与生成方法

SVG override reason：应用图原生输出 exec-b7f6c382-787c-46d8-8db9-c8a94f3019dd.png 把 S2 连到 domain、scanner 连到 analysis，第二轮 exec-d17885bf-be31-4ecc-91d6-7dc81f75e88c.png 遗漏 D3 及 S2→D3。部署图首轮 exec-e3d2fd1b-34e3-4933-882c-1bdd2e578b2b.png 把 Node 误标为 P0、备份端点错误；第二轮 exec-83ec7732-54f7-413f-ad89-b8236cf10d75.png 遗漏平台与 Runner 交互，模型出向线与备份线交汇端点不清。两轮均不采用。按 image-generation 失败降级规则，应用与部署改用独立 HTML/SVG 精确绘制；业务、系统、数据采用原生 image-generation。

此处是图源与方法登记，正式入口为上级 README；历史文件不覆盖。原生提示词见 generation-prompts.json，修订提示词分别见 app-revision-prompt.txt、deploy-revision-prompt.txt。确定性图源包含 relationship-manifest，记录节点端点便于维护；它不替代实际图片检查。

## 资产登记

正文直接嵌入 images/ 的 PNG，不依赖 Mermaid 或 HTML 执行。逐图方法、来源、尺寸和 SHA-256 见 [assets.json](assets.json)；原生提示词见 [generation-prompts.json](generation-prompts.json)。

## 重新导出

在本架构目录启动仅绑定本机的静态服务，打开 src/v5/app.html 与 src/v5/deploy.html；Chromium 视口宽度 1800 CSS 像素，等待 document.fonts.ready 后全页截图，scale=css。应用图为 1800 × 2010，部署图为 1800 × 1720。中文字体使用 PingFang SC / Microsoft YaHei / sans-serif，字体或浏览器变化可能影响结果。

应用图包含 25 个绘制节点、15 条定向关系；部署图包含 21 个绘制节点、23 条定向关系。同号职责因分区重复展示时，图源使用独立布局 ID；这不增加服务或实例。部署图蓝色模型调用穿过橙色备份通道的位置，以断线避让表示不连接。

修改时先核对节点职责、箭头端点与正文，再核查可读性；使用新文件名保留历史版本。原生图片重新生成后同样逐条检查，图片生成成功本身不证明关系正确。
