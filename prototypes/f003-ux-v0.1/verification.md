---
feature_ids: [F003]
topics: [ux, verification, prototype]
doc_kind: verification-record
created: 2026-09-15
status: author-verified-exploration
---

# UX v0.1 自检记录

时间：2026-09-15T08:54Z。执行者：砚砚 / gpt-6-astra。
这是作者自检，不是跨猫 review、不标为已批准 UX 或正式 F003 实现。

## 原始需求与范围

用户消息 `0001789460706075-000369-eea08c71` 要求独立做首版 F003 前端 UX 看效果，允许之后推翻，整体项目 UX 另行设计。
交付四个工作面及主交互，使用 Traqen 现有颜色与字体，但不绑定全局壳、不替换功能设计。
`concept-demo-design` 用于冻结探索范围；`tdd` 用于模拟状态的行为约束；`browser-preview` 用于独立托管与线程内展示。
没有新增后端、真实 Agent、源文件读取或生产数据访问。

## 本轮命令证据

| 检查 | 结果 |
|---|---|
| `node --test model.test.mjs` | 6 / 6 PASS；初始 stub 阶段 0 / 5，补“暂缓不可撤销已确认”回归时 5 / 6，修复后 6 / 6。 |
| `node verify.mjs` | 11 组浏览器检查 PASS，0 console / page errors。 |
| 浏览器宽度 | 1440、1100、768、390；四个页面均无整页横向溢出。 |
| 静态服务边界 | 仅前端白名单；请求契约文档 404，POST 405。 |
| 功能基线 | `git diff --quiet d2ca702 -- feature-discussions/2026-09-09-F003-traceability-graph-design` → exit 0。 |
| `.pen` 对照 | 本工作树无 `designs/`，无可对应设计稿；本轮本身是独立 UX 探索。 |

## Dogfood

1. 选择订单提交 → 测试材料 → 展开原文 → 反查库存预占，确认不是只换一个标题的静态图。
2. 切换三视图；实现视图展示共享材料的邻接功能，覆盖视图保留未归属 / 不支持 / 受限项。
3. 输入 fixture 外理由 `QA-sentinel-范围83：采用默认实现，生产覆盖值仍待证。`，确认单条命题；刷新仍能读到相同理由。根功能仍为 Agent 分析，不整张子图批准。
4. 暂缓另一问题：留队，不成为人工确认。已确认命题不能被后续“暂缓”静默撤销。
5. 权限受限材料可查看原因，无伪造原文。
6. 输入 `QA-sentinel-run-27`，V11 参考 / V12 来源时阻断；改回一致才可创建。暂停后没有推进入口，恢复可推进，取消与名称在刷新后保留，取消不能完成。
7. 首次进入空态具有创建分析入口。

浏览器测试使用独立 context，没写用户的实际浏览器 localStorage。
视觉检查覆盖主屏、审核页、共享材料连线与窄屏。过程中修正了共享连线穿越节点、手机导航高度和已决定规则的旧描述。

## 预览交付

- URL：`http://localhost:4317/`；cwd 为本探索目录。
- 默认 managed state 目录启动失败（bootstrap 5）；切换 `CAT_CAFE_PREVIEW_PROCESS_DIR` 到本机 Cache 后启动成功，无改动 launcher 源码或系统安全设置。
- 已验证 `status=running`、`origin=launchd`、HTTP 200。
- 本轮租约截止：2026-09-15T16:47:43.211Z。
- typed `cat_cafe_preview_open` 回执 `queued / client_inactive`，事件 `25439467-b5a4-47c8-869c-7d5a41500bfa`。不能写成“已在用户屏幕打开”。
- 额外截图发布 helper 被 runtime 保护 hook 拦截，未改写保护目录；不声称已上传截图。截图留在 `evidence/`，主交付是 Browser Preview。

## 五轴风险与非目标

- behavior：仅原型浏览器交互；单元与真实浏览器覆盖。
- data：全是合成材料；隔离 localStorage 可显式重置。
- security：loopback 静态白名单、无网络后端调用、文本插值转义。
- contract：不改 F001–F006 契约或正式 V2.0 设计。
- irreversible：无删除、无生产写入、无 push / merge。

版本对比、局部重试、完整审核操作与质量报表不冒充已经实现；见 README 与 demo contract 的首版探索边界。
不运行 Clowder AI 自身全仓 gate / tips / hotfix 工具：这是外部项目的隔离 UX 原型，不是该运行时的功能发布。
