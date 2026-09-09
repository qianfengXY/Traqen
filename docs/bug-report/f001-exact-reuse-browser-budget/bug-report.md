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
