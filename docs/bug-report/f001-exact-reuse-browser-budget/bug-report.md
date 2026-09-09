> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [source-truth, exact-reuse, browser-capacity]
doc_kind: bug-report
created: 2026-09-09
---

# 跨策略沿用组件与浏览器规模预算诊断

报告人：砚砚 / gpt-6-astra。失败基线 `60374e6142d3c379964c1a1fe85c2d441d089ded`；不是独立审阅或完成声明。

## 诊断胶囊

| 栏位 | 内容 |
| --- | --- |
| 1. 现象 | 浏览器完整枚举 50,000 目录文件，只传 28 字节，显式冻结组合 100,000 文件包后，Git 精确组件相等断言失败。进程树采样 RSS 另超 1 GiB。 |
| 2. 证据 | 托管命令 673s、exit 1；pilot 2/2、0 skip、exit 0；浏览器 exit 1。原报告 [browser-60374e6-failed.json](browser-60374e6-failed.json) 保留。101 批、最大 500 条；1 个上传请求、1 次确认、1 次冻结；无页面异常。 |
| 3. 假设 / 根因 | `SourceCandidateService.component` 不区分 UPDATE / REUSE，使用新 run.policyRevisionId 重建旧组件。旧试点与浏览器 fixture 策略不同，导致组件 id 与 policyRevisionId 改变。文件 B §7.4、§8.3、§10.1 要求沿用原组件身份。RSS 根因仍未确认，不能用该身份错误解释内存。 |
| 4. 诊断策略 | 用小型真实服务回归复现策略变更下 Git / 目录 REUSE；保持旧证据完整性校验和新包策略。另补采样进程归因，区分 OPFS 生成、浏览器枚举、服务端与测试传输开销。 |
| 5. 超时策略 | 小型回归 20 分钟内不能准确复现就缩小调用链；规模测试上限仍 3600s，不盲目重跑。 |
| 6. 预警策略 | 不删除精确相等断言，不改用旧策略掩盖产品问题，不放宽 1 GiB / 1024 FD 预算，不把采样称硬配额。无法归因则保留 FAILED。 |
| 7. 用户可见修正 | “沿用精确组件”必须引用原身份、原策略及原上传来源；新包可以记录当前策略。原材料缺失仍阻断，不能自动重新抓取或静默换组件。 |
| 8. 验收 | 跨策略 Git + 目录回归已 RED → GREEN；采集、准入、真实 PG 小试点及文档 18/18、0 skip、exit 0。追加原策略不可改写 / 新容量限制仍生效的同一回归也通过。60374e6 浏览器最终旧历史、差异页及预算断言未运行，仍 FAILED；原生 picker、首次全量上传和灾备部署均未验证。 |

## 复现与独立问题

1. 在旧策略下冻结 Git + 目录包。
2. 平台策略改变后，从该精确包创建新版本，Git 选 REUSE、目录选 UPDATE。
3. 采集、显式确认并冻结。旧实现沿用材料但重建 Git 组件身份。

原 Git 组件 `ff6371d0b6574a4d39acdcd2704ca1c88a0cce0375656159dfb42c7500789c3e` 变成 `c7d43d37f66bddd5db7ba130c70225f6dd783767d264b50b04bd96e69fa1d729`；清单、覆盖、原生 commit 未变。候选阶段应验证精确基线成员和材料后返回原组件；不能只忽略 policyRevisionId 比较。

采样 658 次，Node 峰值 295,075,840 字节，全进程树峰值 1,612,595,200 字节，FD 峰值 1023，采样错误 0。原报告没有进程级归因；测试生成 OPFS 已接近预算，不能据总量推断 JS 泄漏或服务端泄漏。内存问题单独保持未解决。

## Runtime 与数据边界

诊断时 API 3197 已退出，无 LISTEN PID，不能把托管命令 PID 55792 当 API PID。Web 3188 的 LISTEN PID 16962，启动时间 Mon Sep 7 07:00:29 2026，cwd 是本 feature 的 web；HEAD 与目标均为 60374e6（提交 2026-09-09 01:11:48 -07:00）。进程早于该测试脚本提交；dev server 会热加载，不能据此断言运行旧产品。结构化报告没有 API PID 日志字段，LOG_EVIDENCE 为未提供，不伪造。

原 39d 试点的数据库与材料从未原地启动或修改；本次只写新副本。失败的截图与完整日志保留在私有临时证据目录，仓库归档原 JSON 报告。所有回归使用隔离测试存储，清除外部数据库及生产配置，不触发 CUA 审批。

## 修复与验证证据

`node --test --test-name-pattern='cross-policy REUSE' test/source-truth-capture.test.js`：修正测试 fixture 将 capture 服务实例误传进 runner 的接线错误后，实际 RED 为两类 REUSE 组件 ID 均改变（exit 1，8.246s）。只修候选阶段后，准入路径又在 `SourceAdmissionService.qualify` 的组件策略等于包策略断言失败。该断言和重新编号来自同一个错误假设，不是需要放宽的安全边界。

候选阶段现在先完整验证 manifest / coverage / blob，然后在当前权限和租约下核对精确基线成员、原结构摘要、来源 / 范围 / 原生身份和计数，返回原组件；不新建组件行或 Gap 副本。准入阶段仍验证组件结构摘要及 Workspace / 来源绑定，不再强制原组件策略等于新包策略。包、确认、Receipt 的当前策略绑定保持不变。数据库 append-only 保护原策略，新包当前容量限制仍在采集推进时执行。

同一回归 GREEN（1/1、0 skip、exit 0，8.819s）：新包使用新策略，两类组件及数据库完成行原样沿用、零新增传输、目录上传审计仍指向最初任务、不能改写原策略、缺失字节阻断、缩紧平台容量仍阻断。追加负例时对 append-only 表的直接改写被正确拒绝；测试改为断言拒绝，没有禁用数据库保护。

相关验证：`node --test --test-concurrency=3 test/source-truth-capture.test.js test/source-truth-admission.test.js test/source-truth-pilot.test.js test/bilingual-documentation.test.js`，清除外部配置并设置隔离 PG 工具链；18/18、0 skip、exit 0，42.354s。真实 PostgreSQL 准入恢复 / 撤权与小型 HTTPS Git + 目录试点均实际执行。全仓及新规模浏览器验证仍待运行，不复用旧绿灯冒称新 HEAD 已通过。

资源采样归因测试先因缺失 `peakRssProcesses` RED（exit 1，0.784s），补入当前进程树的 PID / PPID / executable / RSS 后 GREEN（exit 0，0.857s）。只保留最新与峰值进程样本，进程名不含参数或环境；峰值分项之和必须等于原进程树 RSS 指标。浏览器每阶段额外记录结束时进程树和粗粒度 JS heap / DOM 数量；没有强制 GC、排除浏览器进程或改变预算。这是诊断增强，不是内存问题已解决的证明。

归档原 JSON 的 SHA-256 与临时原件一致：`0fcd7751d49c56417bb0fa331afd19b4ce53ea433b13c49849009b94ef84c130`。本次旧 wake 的 invocation-bound `handled` 已 applied；父任务仍 doing。

五轴风险：行为是精确沿用；数据不迁移、不改写旧记录；安全保留当前权限、租约、字节完整性；契约恢复文件 B 的组件 / 包策略分层；无生产或不可逆操作。架构边界不变，没有新增服务层；未改 UI，无 `.pen` 匹配。项目未注册 Clowder 专用 pnpm gate，实际采用本仓后端全量测试与规模浏览器路径作下一道门禁。完整 F001 仍缺规模预算收敛、原生 picker、首次全量上传浏览器证据、双独立 exact-HEAD 审阅及受保护物理独立主备部署验收；未 push / merge。

## b44d3ca 整仓与浏览器返回：内存调查仍开放

exact HEAD `b44d3ca6097c225d4261b6c91e236b739dc7b51d`：三并发整仓后端 567/567、0 fail/skip/cancel、300.967s、exit 0；随后浏览器 exit 1。本轮没有再次出现 Git 503，不能据此宣布先前间歇故障的根因已修复。原始 [browser-b44d3ca-failed.json](browser-b44d3ca-failed.json) 仍是 FAILED，不改写通过标志。

代码断言顺序及两张 review / delta 截图确认：完整目录 50,000 文件、102 目录、101 批（最大 500），上传 1 文件 28 字节；显式确认及冻结各一次；新包 100,000 文件、READY、Gap 0；精确 Git 组件深相等、三份旧历史不变、Delta 单项 MODIFIED 均在 RSS 断言前通过。新包 `85d64a43970caa29a3f134cc7dded2327864a606a8939534803a1966a31c48f7`。无越界写、页面错误或 F001 HTTP 错误。FD 观测峰值 736，但其断言排在 RSS 后未执行；不能说整套资源门禁通过。

744 次采样、0 采样错误，峰值 1,944,518,656 字节：Chromium 合计 1,315,962,880，Node 368,508,928，PostgreSQL 合计 260,046,848。OPFS 生成结束已达 1,089,241,088 字节，随后完整扫描 / 增量采集结束 1,641,578,496；冻结结束 1,590,345,728。29.4 MB 的 coarse JS heap 不足以证明不存在 JS 留存。

| 诊断胶囊 | 本轮内存调查 |
| --- | --- |
| 1. 现象 | 业务链路完成，但进程树 RSS 约 1.81 GiB，超过不变的 1 GiB；测试目录准备期就已超限。 |
| 2. 证据 | 上述 exact-HEAD 原报告及阶段 / 进程分项；Web 3188 PID 16962、启动 Sep 7 07:00:29、cwd 为本 feature 的 web，HEAD 与目标均 b44d3ca；API 3197 和采集 PID 93088 / Chromium 93468 已退出，不能补造退出后的启动时间。日志中 PID 93088 的采样归因不等于启动时间。进程早于测试提交不是旧产品代码证据。 |
| 3. 假设 | 源码不保存全量 File / Handle：目录逐项读取、500 条 IDB 批次，UI 进度每 100ms 替换。待验证假设是大量异步 File API 临时对象 / 原生资源在页面生命周期内延迟回收；不能据 RSS 将其定性为产品泄漏。 |
| 4. 策略 | 隔离空页面加载原产品扫描和 IDB 模块，逐阶段测准备 / 扫描的准确 JS heap、embedder heap 与完整进程树；仅诊断阶段显式 GC 对照自然回收结果，判断可达对象与原生留存，绝不把 GC 后结果当预算绿灯。 |
| 5. 超时 | 首次诊断最多 20 分钟；先用小样本核对脚本，再一次 50k 定向观察，不克隆旧 PG 或重复全仓测试。 |
| 6. 预警 | 不能省略两次 getFile 的变动检测、空目录、全量哈希或 IDB 有界存储；不排除 Chromium / 测试准备、不放宽预算、不通过强制 GC 获得 gate PASS。 |
| 7. 用户交互 | 当前不改 UI / 设计；根因确认后再修具体资源所有者。 |
| 8. 验收 | 诊断不是交付；确定性行为回归后，仍需原规模浏览器脚本在原 1 GiB / 1024 FD 预算下自然通过。原生 picker、首次全量上传及灾备部署仍无证明。 |

诊断入口 `test/support/source-truth-browser-memory.mjs` 在新的临时 browser context 和 loopback 随机端口运行，拒绝外部网络。它编译并记录原产品 `directory` / `stream-hash` / `local-entry-store` 源码摘要；不加载工作台或数据库，不模拟 File API，也不作为完整应用预算比较。20 文件冒烟 exit 0：3 目录、1,049,252 字节、23 行，两次完整扫描得到同一个 `f2df25f292d7d96392682effb9605c991354a8b98c7706b1d3539eb6d639480a`，0 采样错误。诊断报告明确 `OBSERVED_NOT_ACCEPTANCE` / `explicitGcDiagnostic=true`；其 SHA-256 为 `e4ac6ac23f1db912c555c44a5d724647309c8a3cc007999195cde05423777de7`。精确 JS / embedder heap 来自当前 Playwright CDP 类型定义中的 `Runtime.getHeapUsage`，不再用粗粒度 `performance.memory` 推论。

定向自检：资源分项回归 1/1、0 skip（961ms）；双语文档 2/2；新脚本语法及 diff 检查通过。仅测试诊断及归档改动，生产行为 / 数据 / 鉴权 / 契约 / 架构边界均未变，无不可逆操作、无 UI 改稿，无 `.pen` 或根目录媒体增量；项目没有 Clowder 专用 hotfix/fallback/tips checker，不虚报运行。原失败报告归档哈希 `f4b606d83feb3098cdae6f5ca3d1f224b0c512496147c5a0e4f3a550ebcead3c` 与临时原件逐字节一致。原 managed wake `0001788947915564-000056-f584532f` 已由 invocation-bound handled 收口；父任务仍 doing。50k 诊断待托管运行，不是新的验收绿灯。
