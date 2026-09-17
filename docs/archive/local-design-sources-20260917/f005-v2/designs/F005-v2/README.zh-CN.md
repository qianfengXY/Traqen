---
feature_ids: [F005]
topics: [design-review, delivery]
doc_kind: artifact-index
created: 2026-09-15
status: review-proposal
---

# Traqen F005 V2 评审包

首选打开 **Traqen-F005-review.html**：无需启动服务，内含六个主要页面、组件展台和完整总纲。顶栏“设计总纲”可在页面内阅读 16 节设计规范。

- gallery.html：16 张主要页面、状态与移动端效果图，可打开原尺寸。
- F005-design-charter.proposal.zh-CN.md：总纲源稿，定义视觉 token、导航、页面、组件、图谱、恢复、响应式与验收。
- charter.html：总纲阅读版，含目录和图谱效果图。
- index.html、styles.css、app.js：多文件交互样稿。
- ../F005-layout-navigation-v2.pen：Pencil 核心视觉设计板。包含概览、图谱、组件与可复用外壳；效果与完整交互以浏览器样稿为准。
- verification.json：12 项主要交互检查、35 组页面/宽度检查、代表性对比度计算、离线版本检查结果。
- verify.mjs：构造数据交互验证；capture.mjs：页面与状态渲染。
- previews/pencil/：Pencil 实际导出的三张设计板。
- previews/overview-first.png、graph-first.png：首次渲染的比较留样，不是当前交付效果。

## 评审顺序

1. 看概览的导航、留白、文字层次。
2. 打开“取消订单”，点击节点和连线，读依据；切换深色与列表。
3. 查看来源中断恢复、表单错误、命题确认与能力草稿/应用。
4. 阅读总纲的页面、组件、图谱与验收部分。

## 范围与状态

这是完整设计提案，不是正式 F005 的采用记录。没有改动产品代码、正式 Feature Spec、架构或生命周期文件。未提交或推送正式设计变更。

数据均为构造示例。来源草稿、决定说明等在离线版的专用浏览器存储中保留；内嵌聊天样稿只保证当前页面内的演示状态，不保证跨刷新保存。未连接真实仓库、采集器、模型或测试执行器。

浏览器验证使用独立 Google Chrome 会话；没有读取用户浏览器资料。静态服务仅用于生成效果和验证，离线交付不依赖服务。

作者自检按用户“高质量视觉 + UX 效果 + 完整 F005 总纲”要求完成；不将作者自检当作独立代码 review，也不宣称已完成全量无障碍认证。

当前提案由用户评审后再进入正式 F005 写回。仓库主分支中其他任务的提交和改动未在本次同步或推送。

