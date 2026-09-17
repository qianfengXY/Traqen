---
feature_ids: [F003]
topics: [ux, prototype, evidence, graph]
doc_kind: ux-prototype
created: 2026-09-15
status: exploratory-not-approved
---

# F003 UX 探索 v0.1

可点击的功能内原型。**不是全项目 UX 定稿，不是正式功能实现，不替换已确认的 V2.0 功能设计。**

## 本轮尝试

- 业务图谱：功能导航 + 关系画布 + 证据检查器。支持三视图、搜索、筛选、邻接功能、原文与反向查询。
- 待审问题：按功能组织具体问题；并排原文；按单条规则记录解释、理由与适用范围，或暂缓。
- 材料覆盖：全清单保留；已关联、未归属、不支持与权限受限分别呈现。
- 分析运行：固定来源与配置摘要、预检、模拟启动、暂停、继续、取消。显式按钮推进，不假装真实 Agent 正在执行。

主线：订单提交 → 测试 / 代码证据 → 原文与反向查询 → 超时规则争议 → 单条决定。

## 诚实边界

全部业务资料为演示 fixture。没有读取项目业务源码，没有连接 Agent、数据库、F001 上传或生产环境。
演示用户的决定与运行保存在独立的浏览器 localStorage key `traqen:f003:ux:v0.1`；可用页脚重置。
这版不是完整 F003 页面清单：版本差异、局部重试、更多关系类型、质量评估报表及生产权限体验不在本轮可点击范围。
用户明确允许之后推翻重做，当前只验证四个工作面的信息组织和主交互。

## 启动与检查

在本目录运行：

```sh
node server.mjs
node --test model.test.mjs
node verify.mjs
```

访问 `http://localhost:4317/`。静态服务仅监听 loopback，仅允许 GET / HEAD，只发布四个前端文件。

跨回合预览使用家内 managed launcher。默认 state 目录位于符号链接后的外置卷，当前环境 bootstrap 返回 5；将本原型状态目录设到本机 Cache 后启动成功：

```sh
CAT_CAFE_PREVIEW_PROCESS_DIR=/Users/skybowen/Library/Caches/traqen-f003-preview \
node /Volumes/WorkSSD/clowder-ai/scripts/preview-process.mjs start \
  --port 4317 \
  --cwd /Volumes/WorkSSD/projects/Traqen-worktrees/f003-ux-v0.1/prototypes/f003-ux-v0.1 \
  -- node server.mjs
```

查询 / 停止时使用相同 `CAT_CAFE_PREVIEW_PROCESS_DIR`、`--cwd` 和 `--port`，将 `start` 改为 `status --json` 或 `stop --json`，并省去 `-- node server.mjs`。
预览默认 8 小时到期，不承诺永久在线。图稿、代码和检查截图不会因此删除。

`verify.mjs` 默认复用本机已有 Playwright 与 Chromium；异机可设 `F003_PLAYWRIGHT_MODULE`、`F003_CHROMIUM`。它创建独立 browser context，不改用户浏览器中的演示状态。

## 产物

- `demo-contract.md`：本轮授权、范围、Must-Preserve 与交付契约。
- `index.html` / `styles.css` / `app.mjs` / `model.mjs`：原型源码。
- `model.test.mjs` / `verify.mjs`：状态与端到端验证。
- `evidence/`：实际浏览器截图；不是生成式概念图片。
- `verification.md`：检查结果与边界。

独立工作树 `design/f003-ux-v0.1`，以本地 `d2ca702` 为基底；不为原型合并、推送或清理主分支的已有工作。
