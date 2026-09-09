> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [source-truth, exact-reuse, browser-capacity]
doc_kind: bug-report
created: 2026-09-09
---

# 跨策略沿用组件与浏览器规模预算诊断

## f55ddf9 原生分类取证：残余字节不等于相同对象留存

搬砖工 / gpt-5.6-terra 的任务 `0001788953562561-000085-cee318d6` 已在实时 task store 为 done；回传 `0001788954104918-000096-4ad5d064` 是诊断交付，不是正式 review / APPROVE。托管命令核对 exact HEAD `f55ddf963920be06ffc2e73bccc3cd5442c2372e` 后执行一次 50k 原生分类诊断，212s / exit 0。[原报告](memory-f55ddf9-native.json) 逐字节归档，SHA-256 `fb15846b9169e334a895693a649a8118485e38d5d81fd03cb58b4d91f68c6866`；6 项 scanner / diagnostic 源哈希均与该 HEAD 匹配。四个原 trace 的 SHA、字节数、逐 PID 分类及大块分配记录见[派生证据](memory-f55ddf9-providers.json)，均核对原件，无丢样且每个在场 browser / renderer 各一份 malloc dump。

这是空页面 / 真实 OPFS 扫描器，不含工作台、API 或 PG；50,000 文件 / 102 目录、3,087,392 bytes、50,102 行及 manifest `516fddfe191fb89759f2a2e6bb3319fa4d174678038eb34bfedb4cdcf2bb32b6` 均匹配。两次 getFile、流式哈希、500 条 IDB 写入 / 读取批和清单遍历保留。`acceptanceGate=false`、无强制 GC；213 次资源采样无错误，峰值 991,526,912 bytes / FD 115 不是验收通过。扫描时另有 tracing service RSS 77,529,088 bytes，关页后 81,543,168 bytes；诊断改变运行时，且 RSS 观察先于 allocator dump，不能混为同步值。

| browser PID 35338，同一字段（bytes，count 行除外） | fixture 后 | scan 后 | 关页 5s 后 |
| --- | ---: | ---: | ---: |
| OS RSS | 178192384 | 397901824 | 450592768 |
| malloc/partitions/allocator allocated_size | 151743936 | 207024928 | 207658288 |
| 同 allocator allocated_objects_count | 1061283 | 1498660 | 959182 |
| 同 allocator virtual_committed_size | 163446784 | 252903424 | 249593856 |
| 同 allocator wasted | 11702848 | 45878496 | 41935568 |
| leveldatabase size | 1525592 | 11745013 | 1458647 |
| shared_memory size | 2064384 | 18661376 | 4538368 |

展开原始 provider / bucket 后有三个新的限制：

- scan 后 `site_storage/indexed_db` 为 10,219,421 bytes，关页后该分类不在 dump 中；各观察点 blob_storage 的 blob_count 均为 0。这不能排除一切 IDB / File API 关联 native 开销，但不能仅用这里的 IDB / Blob 分类解释约 207.7 MB allocator 已分配量。
- 关页后的 allocator 对象数 **低于 fixture 后**，并非对象数持续增长；字节总量接近 scan 后不证明相同对象仍被引用。80-byte bucket 的 allocated_objects_size 为 48,645,040 → 72,778,640 → 49,087,840。大块分配中，71,319,552-byte（68.015625 MiB）块的数量从 fixture / scan 后各一块变为关页后两块。`directMap_N` 标签在各 dump 中变化，不能将编号当稳定地址或同一对象身份；原 trace 没有这些分配的 native 调用栈。
- renderer PID 35345 的 108,134,400 → 259,424,256 bytes RSS 在关页后整体消失，包含原有基线。browser 字节残余、allocator 容量或 renderer 退出均不能单独证明产品泄漏，也不能据此选择强制 GC / 关闭页面作为产品修复。

本轮诊断胶囊：① 原 b44 / 75e5 全链路 RSS 超额不变；② 新增完整原报告、4 份原 trace 哈希和派生 bucket 证据；③ 假设收敛为 browser 大块分配与小对象桶共同贡献，具体所有者未知，不能把总量残余等同于相同扫描对象留存；④ 下一步必须先确认可取得这些大块分配的调用栈或映射来源，再决定是否值得新的有界实验；⑤ 本次到归档即停止重复 50k，能力不足不重跑相同分类采集；⑥ 不改产品、不降低扫描完整性、不放宽 1 GiB / 1024 FD / 3600s、不排除诊断或浏览器进程制造绿灯；⑦ 用户交互不变；⑧ 只有资源所有者和可复现行为已证实才做产品 RED → GREEN，最终仍是原自然回收完整 gate。

当前 target / feature HEAD 为 f55ddf9，旧 tsbuildinfo 保留；API 3197 无 LISTEN，诊断 Node 35336 / browser 35338 / renderer 35345 已退出。Web 3188 LISTEN PID 16962、启动 Mon Sep 7 07:00:29 2026、cwd 为本 feature 的 web；其启动早于目标提交，不据热加载进程年龄推断代码过时，没有新增 API 启动日志可引用。原 pilot / PG 不重开不改，未跑新规模或后端测试，未触碰生产或 CUA。本次 A2A 已以 invocation-bound handled 收口（applied），不代签 Terra 的 managed-hold carrier；父仍 doing / workflow v12，Git 间歇 503 原因、Node / PG 归因和 F001 整体交付仍未完成。

### 空页面观察器对照（不跑扫描）

为检验“大块分配是否由重复取证无条件产生”，另开临时 Chromium / about:blank，阻断全部页面请求，连续调用现有 native observer 10 次；没有任何文件 API、OPFS 生成、扫描、API / PG 或强制 GC。[命令输出归档](memory-f55ddf9-empty-control.json) 中 10 窗均无丢样，11 次资源采样无错误。browser PID 45312 从首窗到末窗 RSS 为 116,801,536 → 135,708,672 bytes；allocator allocated_size 为 5,174,320 → 5,747,856 bytes，80-byte bucket 为 429,840 → 487,200 bytes，全部窗口均没有 allocator directMap 块。故此次对照未复现 71,319,552-byte 大块或约百万对象，不能把它们归咎于观察器调用次数本身；也不能排除取证与大量文件操作的交互。该对照不是规模验收，也没有识别产品函数所有者。浏览器在 finally 关闭。

## 97dda60 teardown 核验与原生分类能力预检

搬砖工 / gpt-5.6-terra 的诊断子任务已在实时 task store 标记 done，回传消息 `0001788952344367-000079-79ffcb2c`；不是正式 review 或 APPROVE。[原报告](memory-97dda60-teardown.json) 逐字节归档，SHA-256 `101ce588a5ad91b0e30d2742efb1a2b12f341384e697196f0d6c7d9c44da3775`。托管命令预先核对 exact HEAD `97dda60d0c33c00a6529a10d790b951a712da83f`，207s / exit 0，207 次采样无错误，`acceptanceGate=false`，没有强制 GC、API 或数据库。

| 进程 | 扫描前 RSS | 扫描后 RSS | 关页 5s 后 RSS | 扫描增量 | 关页后相对扫描前残余 |
| --- | ---: | ---: | ---: | ---: | ---: |
| browser，PID 22424 | 202555392 | 372277248 | 354107392 | 169721856 | 151552000 |
| renderer，PID 22427 | 251805696 | 367607808 | 0（已退出） | 115802112 | -251805696 |

单位为 bytes：browser 残余是 **144.53 MiB / 151.552 MB**，不是 151.6 MiB。总 Chromium 回收 388,808,704 bytes 超过扫描增量 290,455,552，是因为关闭 renderer 同时移除了 251,805,696 bytes 原有基线。原报告自动 `HYPOTHESIS_SUPPORTED_PAGE_RENDERER_SCOPED` 标签保留原样，但不能作为根因结论。只能确认两个进程都有贡献，尚不能证明 React、IDB、OPFS 或某个 native 分配器泄漏。

该实验打开了 3188 开发页面并屏蔽非该 origin 请求，不是 cb8 的空页面；页面初始化与 fixture 准备存在时间重叠。50,000 文件 / 102 目录、两次 getFile、流式哈希、500 条 IDB 批、50,102 条遍历保留，但 fixture 为 3,013,514 bytes、manifest `219cea08b139412474fea7e57b0946d4cddfeb73118abcdbbd57a03376640582`，不等于 b44 的 D3。其树 RSS 峰值 948,731,904 / FD 109 不能替换完整工作台含 Node / PG 的失败门禁。

父侧小型能力预检（当前 Chromium 151.0.7922.34、独立临时 profile）得到：browser 会话 `Memory.startSampling` 不存在；renderer 启动采样后，64 个 64 KiB 保留缓冲及 20 个 OPFS 文件操作仍返回 0 样本，browser 前后也为 0；这是未取得证据，不是零分配。`vmmap -summary` 能读 VM 分类，但明确警告无法检查 PartitionAlloc zone，不能用其 malloc 表解释该分配器占用。没有更改启动 flags、重新安装浏览器或提升权限。

替代证据入口是短时 Memory-infra trace。2 MiB trace 的真实预检报告 `dataLossOccurred=true`，不消费为完整归因；独立的 16 MiB 诊断 trace 返回 false，并同时覆盖 browser / renderer 的 malloc 对象与分配器分类。这个容量只属于新增诊断缓冲，**不修改验收的 1 GiB RSS / 1024 FD 预算**。当前 exporter 的 trace dump id 为 `0x0`、request GUID 为 `0x1`；原值均保存，只声明单个 trace window 内每 PID 的单份 dump，不伪称 GUID 一致。计数是分配器分类，不是调用栈；父子节点有重叠，不相加成 RSS。请求显式 `deterministic=false`，不使用会强制 GC 的 deterministic 选项，见 [CDP Tracing API](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/#method-requestMemoryDump)。

诊断胶囊续项：① 现象仍是 b44 / 75e5 完整链路 RSS 超额；② 证据新增上述 teardown 与小型探针；③ 当前假设是 browser 扫描关联残余可由存活分配或分配器驻留空间解释，尚未证实；④ 在 cb8 的隔离空页面复用原扫描、哈希、IDB，记录生成前 / 生成后 / 扫描后 / 关页后各角色 RSS 和分类计数，保留完整原 trace；⑤ 一次 50k 定向观察最多 20 分钟，缺角色、丢样或多份歧义 dump 就失败，不盲目重跑；⑥ trace 本身影响运行时，`acceptanceGate=false`，无强制 GC、不删扫描步骤、不换预算或排除进程；⑦ 不修改用户交互；⑧ 只有确认产品资源所有者后才修产品，再运行原自然回收完整 gate。

诊断器保护先 2 RED（新能力不存在，324ms），后 4/4 GREEN（350ms，含旧观察器两项）。20 文件真实 OPFS 冒烟 exit 0：20 文件 / 3 目录 / 23 行 / 1,049,252 bytes，四个 trace window 均不丢样，前三个有 browser / renderer、关页后仅 browser；`explicitGcDiagnostic=false`、0 资源采样错误。相关观察器与文档 6/6、601ms，语法通过。没有产品代码改动或新的验收绿灯，原 pilot / PG 不重开不改。父 A2A invocation-bound handled 已 applied；父仍 doing / workflow v12，未 push / merge。

## 75e5d44 完整链路分配观察：仍未定位 RSS 根因

exact HEAD `75e5d441425c35c96d784c941ad3adbbc5c880fc` 的一次完整链路诊断耗时 696s、exit 1，仍在脚本第 209 行的原 1 GiB RSS 断言失败。[原报告](memory-75e5d44-failed.json) SHA-256 为 `3cff2ee0a3d7479cd2785a59708aa127339509d594d8493c71a41b8a37089b8a`；`acceptanceGate=false`、`allocationSamplingDiagnostic=true`、`explicitGcDiagnostic=false`。这不是新的验收运行，也不是 b44 失败的替代证据。

代码执行顺序、原报告及已查看的 review / delta 截图相互核对：101 批、每批最多 500 条，完整枚举 50,000 文件 / 102 目录，1 个文件上传 28 字节；创建、显式确认和冻结各一次；新包仍为 `85d64a43970caa29a3f134cc7dded2327864a606a8939534803a1966a31c48f7`。精确 Git 组件深相等、三份旧包及数据库历史不变、Delta 只有 `materials/g0000/f000003.txt` MODIFIED 均已通过，位于 RSS 断言之前。没有越界写、F001 HTTP 错误或页面异常。FD 峰值 729，但 FD 断言在 RSS 后，未执行。

| 观察点 | 树 RSS | Chromium browser / renderer RSS | JS used / total | embedder / backing |
| --- | ---: | ---: | ---: | ---: |
| 浏览器启动 | 549765120 | 82313216 / 75317248 | 531956 / 1048576 | 1386752 / 0 |
| 工作台就绪 | 836861952 | 95076352 / 265748480 | 13815508 / 16859136 | 6992968 / 6382986 |
| OPFS 生成结束 | 876347392 | 225951744 / 297484288 | 17310976 / 34160640 | 6408536 / 6398739 |
| 完整枚举及增量采集结束 | 1324269568 | 315768832 / 428032000 | 37171620 / 80297984 | 7816616 / 6461358 |
| 显式确认及冻结结束 | 1286619136 | 319291392 / 379092992 | 16014628 / 18694144 | 5971384 / 6642428 |
| 失败观察点 | 1313718272 | 319586304 / 387645440 | 12984028 / 19480576 | 4749968 / 6359836 |

单位为字节；browser / renderer 不含另列在原报告中的 GPU / network 进程。700 次无错误采样的树 RSS 峰值 1,481,310,208 字节，由 Chromium 878,477,312、Node 397,688,832、PG 205,144,064 组成（包含瞬时进程名 `(postgres)`）。JS 数字是阶段采样，不是全过程峰值；DOM 观察为 8 → 1112 → 723 → 3258 → 697 → 883，监听器也非单调增长，不能用它们宣称没有泄漏。

完整遍历六份原始分配 profile 后，[派生汇总](memory-75e5d44-allocations.json) 保存各原件 SHA-256、样本数与分配位置汇总。非空 profile 只有 66–80 个样本，估计存活分配总量 4,829,640–5,930,884 字节，主要是 V8 API、React 开发运行时及匿名调用。采集结束时 `transfer.ts` 只有一个约 64 KiB 样本；没有看到与全部文件数相称的 JS 分配组，但低采样覆盖不能证明不存在瞬时大分配或原生资源留存。采样调用栈不是 retaining path，也不测 Chromium native heap。诊断时的分配采样本身还可能改变回收行为，不能将相对 b44 较低的 RSS 称为改善。

诊断胶囊续项：① 现象仍是完整业务链路结束后 RSS 超额；② 原报告、六份 profile、完整 88 行 JSON 日志及两张截图是证据，日志 SHA-256 `bcca57f25358d256cb041a112ddc5ffedb2b9c69202e5bcb6ae53e8bd01ec5f2`；③ 尚无可归因的根因，工作台启动、OPFS 生成、枚举及服务端共同增加 RSS，现有 JS 证据不足以解释超额；④ 下一步先让非作者伙伴基于相同原件核对统计口径及资源所有者，再选一个可区分原生分配 / 分配器高水位 / 开发运行时开销的受控实验，不重复完整链路采样；⑤ 一轮诊断最多 20 分钟，无新证据则返回假设与未决点；⑥ 不省略全枚举、哈希、两次 getFile 变动检测、IDB 背压，不强制 GC 获得验收通过，不排除浏览器或准备期，不改变预算；⑦ 尚无用户交互修改；⑧ 根因确认后才作行为 RED → GREEN，再跑原自然回收完整门禁。Git 间歇 503 根因依然未证实。

本轮只归档证据，不改产品或诊断器。API 3197 和诊断进程 11808 / Chromium 12255 / PG 12238 已退出；Web 3188 LISTEN PID 16962、启动 Mon Sep 7 07:00:29 2026，cwd 为本 feature 的 web。目标 / worktree HEAD 均为 75e5d44，提交 2026-09-09 03:31:47 -07:00；PROCESS_AFTER_TARGET=no，但 dev 热加载使其不能用于判定代码过时；没有独立 API 启动日志，不补造 LOG_EVIDENCE。原 pilot / PG 未重开或修改，没有重跑后端、CUA 或生产操作。当前 wake `0001788950717036-000067-44ad64d3` 的 invocation-bound handled 已 applied；父任务仍 doing，workflow v12 未变。F001 未完成，未 push / merge。

报告人：砚砚 / gpt-6-astra。失败基线 `60374e6142d3c379964c1a1fe85c2d441d089ded`；不是独立审阅或完成声明。

本轮归档校验：双语文档 2/2、0 skip、exit 0（426ms）；原报告逐字节 SHA-256、六份原 profile SHA-256、各阶段及峰值进程 RSS 加总、每份分配组加总均一致；`git diff --check` 通过。没有行为改动，按 TDD 风险入口不人为补同义 RED；没有重跑已绿的后端或失败的规模 gate。归档与讨论不是独立正式审阅，也没有发布 Issue。

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
## cb8bccb 独立扫描观察：不是验收

50k 诊断 exit 0、281s，原始 [memory-cb8bccb-observed.json](memory-cb8bccb-observed.json) 标记 `OBSERVED_NOT_ACCEPTANCE`、`acceptanceGate=false`、`explicitGcDiagnostic=true`。两遍都是 50,000 文件 / 102 目录 / 50,102 行 / 3,087,392 字节，清单同为 `516fddfe191fb89759f2a2e6bb3319fa4d174678038eb34bfedb4cdcf2bb32b6`。283 次采样无错误，观测峰值 840,695,808 字节 / 105 FD。这个页面没有完整工作台或数据库，而且经过显式 GC；任何低值都不能替代 b44 的 FAILED 或 1 GiB 门禁。

| 阶段 | 树 RSS | Chromium RSS | JS used / total | embedder / backing |
| --- | ---: | ---: | ---: | ---: |
| 生成前 | 487456768 | 274055168 | 1666724 / 2686976 | 1386752 / 12933 |
| 生成后，自然 | 612646912 | 378585088 | 5008692 / 21299200 | 2976440 / 42137 |
| 首遍扫描后，自然 | 727842816 | 603537408 | 14250188 / 58785792 | 1388896 / 888016 |
| 首次 GC，仅诊断 | 680165376 | 554549248 | 1331240 / 2162688 | 322360 / 12992 |
| 再扫描后，自然 | 798818304 | 678313984 | 21506004 / 54591488 | 2303168 / 2708679 |
| 再次 GC，仅诊断 | 744849408 | 624132096 | 1321436 / 2162688 | 334480 / 12983 |

单位均为字节。两次 GC 后 JS / embedder / backing 均回落，事件监听器从 34 / 64 回到 15；不支持“扫描器可达 JS 保留完整 50k 文件集合”的假设。Chromium 主进程在两次 GC 后仍为 344,457,216 / 385,761,280，renderer 为 171,606,016 / 199,278,592；这还不能区分原生资源延迟释放、分配器高水位与泄漏。

本轮诊断胶囊更新：现象与 b44 失败、预算不变；证据增加上述原报告和完整 33 行日志（SHA-256 `d7a6b512858e8b29ddfef6100ca51b36f94b9c01688e83ffbee9a2898f44900c`）。当前假设缩小为完整工作台运行时 / 进度与轮询 / File API 原生资源的额外占用，尚无已证实根因。客户端请求、只读 observer 与工作台源码未显示无界历史数组。下一次只在原完整采集链路补准确 heap、进程角色和存活分配调用栈，测浏览器启动、页面启动、生成、采集和冻结边界；分配采样运行必须标为诊断，不得返回验收 PASS。最多 3600s，失败记录和原 pilot / PG 不改；若仍无资源所有者证据，进一步缩小变量而不是改产品或放宽预算。用户交互不变；验收仍要求原自然回收完整门禁。当前 managed wake `0001788949046335-000061-f79d4c13` 已 handled / applied，父任务继续 doing。
### 当前诊断工具自检

两条新回归先因完整浏览器分配观察器不存在 RED（2 fail，349ms），实现后 GREEN（2/2，345ms）；静态导入整理后复验。真实 Chromium 151.0.7922.34 隔离空页面冒烟 exit 0，取得 52 个分配样本、JS used 3,822,964 / total 7,815,168、完整四类浏览器进程；不调用 GC。完整捕获新增可选 `--heap-diagnostic`，浏览器启动 / 工作台就绪 / 生成 / 采集 / 冻结分别保存准确堆和原始采样 profile；采样值不是精确可达对象图或 RSS，不能据某个分配函数直接断定泄漏。该模式 `acceptanceGate=false`，即便预算通过也只能是 `OBSERVED_NOT_ACCEPTANCE`；失败仍保留 FAILED。原非诊断运行的完整枚举、精确沿用、旧历史、Delta、1 GiB / 1024 FD 断言都不变。

测试诊断工具 2/2、文档 2/2（合计 4/4、348ms）；原进程采样回归 1/1（916ms）、语法和 diff 通过。原 cb8 报告与归档 SHA-256 同为 `9625f7dff590dbcbc1a9cdbbcf105d0a40ca3b20cf0723ecd17c6bd42f13a0b7`。五轴风险仅测试诊断 / 原报告归档，无生产行为、数据迁移、权限、契约、不可逆及设计修改；无新增架构边界、无 `.pen` 或根目录媒体；项目没有 Clowder 专用 checker。既有完整浏览器预算失败仍开放，不声明 F001 完成或正式 review，通过后才会提交独立审阅。未 push / merge。
