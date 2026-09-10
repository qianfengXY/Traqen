> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [browser-test, recovery, locator]
doc_kind: bug-report
created: 2026-09-10
---

# 到期恢复旅程的理由定位失败

报告人：砚砚 / gpt-6-astra；功能自测发现，非独立 review。

## 诊断胶囊

| 栏位 | 记录 |
| --- | --- |
| 现象 | 12 项小样本浏览器旅程完成 11 项；接受过期后，重新填写理由的 `getByLabel(..., exact: true).fill()` 超时 30 秒。截图和 ARIA 中输入框仍存在。 |
| 证据 | HEAD `9c05518aee28c22b1d05bc0e33d0863c847c8a7f` 加三项未提交测试增量；`source-truth-browser-matrix.mjs:63` → `source-truth-browser-recovery.mjs:127`。macOS 25.6 / Chromium 151.0.7922.34 / Playwright 1.61.1。失败报告 SHA-256 `5a4dbeed1f6de5765e3d00b596b1a0afffa005caf93b7c17252f571a665fe129`；完整日志与报告结构相等。 |
| 根因 | 已隔离复现：React 渲染的非空 textarea 子文本进入隐式 label 的全文。Playwright 1.61.1 的 `getElementLabels → elementText → createTextMatcher` 用 normalized 全文相等匹配，故精确 label 不再命中；textbox 可访问名称仍正确。属于测试定位错误，非产品禁用或过期拒绝错误。 |
| 诊断策略 | 对照本地 Playwright 标签引擎、产品 JSX 和 React 渲染；同版无网络空页面比较空值/已有值的精确 label 与精确 role 匹配、填写能力。 |
| 超时策略 | 小复现限 5 分钟；未复现就回读真实 DOM，不重复整套旅程。 |
| 预警策略 | 若 role 也不能填或控件真实禁用，停止定位器修复，调查产品状态；不延长超时、不删除到期断言。 |
| 用户交互 | 不改产品、期限或门禁。服务端 409、零发布、回到第 7 站及候选不变已先通过。仅将理由输入定位为精确 textbox 可访问名称。 |
| 验收 | 同版 Chromium 无网络 React 静态标记复现：空值 label/role 均命中 1；已有值 label 命中 0、role 命中 1 且可编辑。旧 fill 按预期超时 500ms，role 填写后值一致，两种初值均绿。完整 12 项旅程复验 exit 0 / 120s；到期后显式重新确认同一候选，无重采集或自动延期。 |

## 运行时核验与边界

3188 的 LISTEN PID 16962，启动于 2026-09-07 07:00:29，cwd 为本功能 worktree 的 web；HEAD 与目标同为 9c05518。进程早于目标，使用 dev/HMR；HTTP 200。无当前 PID 专属日志计数，不能据此断言运行旧代码。测试 API 3197 与原命令 PID 19961 已退出，原失败 fixture 不重开。

原始证据：父路径 `/private/tmp/`；子路径 `traqen-f001-recovery-ui.LGWOBP/`。源码指纹在 `source-evidence.json`，截图在 `failure.png` 和 `expired-acceptance-returns-review.png`。

这是测试/交互诊断，不是 100k 或部署验收。原规模失败、原始 pilot/PG 保持不变。

## 修复范围

微复现使用本地 React 19.2.6 的 `renderToStaticMarkup` 生成与产品相同的 label/textarea 结构，在无网络页面分别赋空值及原理由；没有连接 API 或旧数据。产品 JSX 在离开第 7 站后重新挂载有值输入，解释了“第一次填可以、过期后重填失败”的差异。Playwright 本地 `coreBundle.js` 的上述三个完整函数与复现一致。测试仍采用精确名称，不用宽松匹配、固定等待、延长超时或删减业务断言。

## 功能回归证据（测试增量，不是 F001 完成声明）

本次 `quality-gate` 按测试增量核验：产品源码未改；基线 9c05518 的后端 571/571、Web 91/91、build/types/lint 已通过，不重复整仓。新增三份测试源码的指纹与 [GREEN 源码记录](green-source-evidence.json) 一致。原 [RED 报告](red-report.json) 与 [源码记录](red-source-evidence.json) 保留；它是定位器失败，不冒充产品业务 RED。

完整 [GREEN 报告](green-report.json) SHA-256 `09c35db9c65ad222e452100392bde39f1f1c39b6f2049c85d26a6cc0534914be`，12 项全部到达、issues 为空，完整日志解析后与报告相等（日志 SHA-256 `e51c74a75b028601e0663c1f92bc2f92eb27d697beae20f66b1434b81e10eeb8`）。新增四条对应文件 B §7.2、§7.3 及 B-08/B-10/B-11 的小样本路径：

| 路径 | 真实持久化结果与用户状态 |
| --- | --- |
| 最终化前取消 | 取消对话框关闭不写入；确认后留下 CANCELLED 记录，不发布新包，旧基线不变；编辑重启第 1 站。 |
| 瞬态错误重试 | 隔离 gateway 单次注入 503，真实执行器持久化 FAILED_RETRYABLE；重试新 run 绑定原输入和 retryOf，成功后仍保留失败记录。 |
| 变化目录重新选择 | 同路径/大小但不同字节在任何写入前拒绝，旧 manifest 与 WAITING 状态不变；恢复原字节后同一 run 完成 2 文件。 |
| 接受先于冻结到期 | 等真实服务端绝对期限到期再发送 seal，409 且零发布；回第 7 站显式重新接受，仅 confirm/seal 写入，同 candidate 产生新 confirmation，不重采集。 |

四张新增截图已逐张核对。GREEN 证据父路径 `/private/tmp/`；子路径 `traqen-f001-recovery-green.7T4Z9K/`。截图文件依次为 `cancelled-preserves-baseline.png`、`retry-retains-original-attempt.png`、`changed-reselection-rejected.png`、`expired-acceptance-returns-review.png`。未将运行截图混入设计资产。

仍未证明：原生系统目录选择器、100k 浏览器规模、部署与备份验收；原规模 FAILED 保留。截图中的全局“部分 Workspace 数据暂时不可用”提示仍需独立查证，不能用本次业务断言全绿掩盖。此提交不改设计、期限、预算、生产数据或产品逻辑；不是独立 review、APPROVE 或整个功能验收。

### 全局提示查证补记

提交 1dd9e29 后逐路 GET 的[隔离报告](shell-read-diagnostic.json)（SHA-256 `2212c16ca9047ab72b374789c185220fbea762cba81703251e14f3c445bce56a`）与[此前已记录的原因](../f001-inventory-query/bug-report.md#workspace-通用提示的实际请求根因)一致：仅旧分析 jobs 返回 400 `Legacy understanding runtime is not configured`；无已发布图的 404 被客户端正确转为 null，其余六路（含来源概览）200。不是新的来源数据损坏；不吞错、伪造 jobs 空列表或为消除提示启动分析。已有 F002 FYI 保持，不重复交接。当前运行只关闭原因未知，不证明完整应用部署就绪。
