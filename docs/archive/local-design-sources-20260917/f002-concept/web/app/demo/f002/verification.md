---
feature_ids: [F002]
topics: [concept-demo, verification]
doc_kind: verification-record
created: 2026-09-07
---

# F002 概念演示验证记录

## 交付范围

用户消息 `0001788767759787-000244-9ddbd51f`：「请使用concept-demo-design，演示一下F002功能。」

依照 [Demo Contract](demo-contract.md) 交付六幕、纯前端、固定样例的概念演示。不是 F002 正式实现、不是正式产品挂载验收，也不代表 co-creator 已确认方案。

- 基线：`9980807`；隔离分支：`demo/f002-concept`。
- 工作树父目录：`/Volumes/WorkSSD/projects/Traqen-worktrees/`；子路径：`f002-concept-demo`。
- 页面：`http://127.0.0.1:3182/demo/f002`。
- 既有 Feature Spec、ADR、索引与 F001 用户改动均未修改。
- 五轴：行为=演示本地交互；数据=固定非真实样例、无持久化业务写入；安全=无用户数据/密钥/鉴权改动；契约=明确 demo schema；不可逆=无发布、无迁移、无删除。

## 本轮验证

| 检查 | 实际结果 |
|---|---|
| `node --test web/tests/f002-demo.test.mjs` | 6/6 通过；初始 5 项先红后绿；对象证据完整性另见红→绿 |
| 定向 TypeScript，命令见下 | exit 0 |
| 浏览器回放，命令见 Contract | ALL CHECKS PASSED；所有对象查证、搜索、图片、两个缺口、范围隔离、下载、暂停、键盘与刷新均通过 |
| 1440×1000 / 390×844 六幕 | 12 帧截图；无页面横向溢出；图画布在窄屏内可横向滚动 |
| 页面异常/外部请求 | 0 / 0；不启动解析器或 Agent |
| `git diff --check` | exit 0 |
| Design .pen | 本工作树没有匹配设计稿；对照实际 Traqen 页面和原生组件 |

定向类型检查（工作树根目录）：

```sh
web/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --jsx react-jsx --module esnext --target es2022 --moduleResolution bundler --esModuleInterop web/app/demo/f002/page.tsx web/app/demo/f002/model.ts
```

未通过的扩大检查：`tsc --project web/tsconfig.json --noEmit --incremental false`。错误在未改动的旧页面/客户端和 worker，例如 `f006-settings-center.tsx` 类型不匹配、既有 `.ts` 导入配置、`Fetcher` 类型缺失。没有把定向通过说成全仓通过，也没有越界修复这些文件。

最终截图父目录：`/var/folders/v_/tfrh9s297v1gbxkxt1_dqtmc0000gn/T/`；子路径：`f002-demo-evidence-fOVxRx/`。文件名为 `{1440|390}-scene-{1..6}.png`。截图属于临时取证，实际交付为本目录代码、固定图片及可重放测试。

## Dogfood 发现与修正

1. 首幕原先提前显示方法/段落对象。改成真正的文件清单，明确 F001 不做语义分析。
2. 图中两个节点重叠：调整位置，并重看灵魂帧。
3. 引用校验放在长图下方不易发现：移到第五幕图谱之前。
4. API 对象没有直接证据数组：补对象级 `sourceEvidenceIds`，单测先出现缺失失败，修后 7 类对象的浏览器点击均能查证。
5. 运行时缺口错误复用了图片缺口标题：浏览器明确观察 expected=运行时配置未知 / actual=图片语义未解析；改为每个 Gap 自带标题，再验证标题与原因。
6. 冷启动图片加载是异步的：浏览器测试等待真实 image load 条件，不凭点击后的瞬时 `complete=false` 判定缺图。

## 预览托管与送达

- 默认记录目录经外置盘软链接，`launchctl bootstrap` 返回 5；同一 launcher 改用本机用户 Application Support 目录后可注册。此差异已验证；未声称查明所有 macOS 内部原因，未改 Clowder 启动器。
- vinext CLI 使用 `--hostname`，不是 `--host`；已按已安装 CLI 源码修正为 loopback IPv4 3182。
- 最终托管状态 `running`、`origin=launchd`，页面 HTTP 200。没有声称已通过“下一次 invocation 仍存活”的额外观察。
- Hub 最终回执 `queued / thread_inactive`，eventId `ba221094-5198-4d8e-aa3e-e50a5f90256b`。切回对应 thread 后应展示；不是当前已打开。

查看/停止使用同一个管理器，不操作其他服务：

```sh
env CAT_CAFE_PREVIEW_PROCESS_DIR='/Users/skybowen/Library/Application Support/Traqen/preview-processes' pnpm --dir /Volumes/WorkSSD/clowder-ai preview:process status --port 3182 --cwd /Volumes/WorkSSD/projects/Traqen-worktrees/f002-concept-demo/web --json
env CAT_CAFE_PREVIEW_PROCESS_DIR='/Users/skybowen/Library/Application Support/Traqen/preview-processes' pnpm --dir /Volumes/WorkSSD/clowder-ai preview:process stop --port 3182 --cwd /Volumes/WorkSSD/projects/Traqen-worktrees/f002-concept-demo/web --json
```

重启（仅此演示）：

```sh
env CAT_CAFE_PREVIEW_PROCESS_DIR='/Users/skybowen/Library/Application Support/Traqen/preview-processes' pnpm --dir /Volumes/WorkSSD/clowder-ai preview:process start --port 3182 --cwd /Volumes/WorkSSD/projects/Traqen-worktrees/f002-concept-demo/web -- /usr/bin/env REDIS_URL=redis://127.0.0.1:6398 npm run dev -- --port 3182 --hostname 127.0.0.1
```

## 仍需观众判断

co-creator 是否能复述“冻结材料→可核验事实数据集→F003 的受控输入”，以及界面是否符合预期。自动测试不代替这一判断；未更新 Feature 生命周期或设计批准状态。
