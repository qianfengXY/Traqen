> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [git, capacity, concurrency, recovery]
doc_kind: bug-report
created: 2026-09-15
---

# Git 写入期间缓存计量竞争

报告人：砚砚 / gpt-6-astra。这是作者的实现诊断与回归记录，不是独立审阅或 F001 完成声明。

## 现象与复现

合入 `bb26b4fdfd0d3f340394029b346497480db9f489` 后，隔离浏览器矩阵曾完成 11/12 条，在下一条 Git 来源预检中失败；不是 Gap 到期处理失败。原 summary SHA-256 为 `6760b6565d1d78ed444a100f7fb75e4a2ad1e0937b3a1caae009f5ef688cf201`。随后 12 次原生小采集未复现，不能据此声称已修复。

同一合入代码加仓库外、只记录枚举值的观察器后再次失败：两条目录旅程通过，首个 Git `fetch` 在第 3 站返回 `SOURCE_STORAGE_NOT_READY`。私有原因是 `RUNTIME / ENTRY_STAT / ENOENT / PACK_TEMP`。本次 summary SHA-256 为 `85afb88f172a1cab015d96bcd951a36369b9942a08b17c32f59ad9707582e08a`，浏览器 report SHA 为 `2b2f44a1d0321228f3c41b8921283e19915de92a6896309da18deb35a0833cd2`。原件保留；不能倒推第一份报告丢失的 errno。

观察器原样抛出异常、未修改产品或断言。Web PID 53991（3188）与 API PID 54541（3197）均在合入后从精确 bb26 checkout 启动，HTTP 200 与 cwd 已核；退出后两端口均无监听。未使用生产或原 pilot。

## 根因与影响

`git-cache-command.js` 在可信 Git 子进程运行时每 100ms 调用容量扫描。`opendir` 缓冲的普通文件条目，到随后 `lstat(path)` 时可能已因 Git 完成 pack 而消失。原扫描将该 ENOENT 作为存储故障，监督器因此终止合法拉取。新 run 失败、未生成冻结包或回执，原历史保持；这不是磁盘已满或 100k 内存故障的证据。

主机使用 Git 2.50.1 (Apple Git-155)。对应上游 [index-pack](https://github.com/git/git/blob/v2.50.1/builtin/index-pack.c) 创建 `pack/tmp_pack_XXXXXX` 并调用 `rename_tmp_packfile`；[object-file](https://github.com/git/git/blob/v2.50.1/object-file.c) 的 `finalize_object_file_flags` 使用 link/unlink 或 rename 完成对象文件。上游源码支持此生命周期解释，不冒认 Apple 构建二进制与上游逐字节一致。回归测试在真实文件系统枚举→stat 边界确定性执行这两种转换，旧代码准确复现同一私有错误。

## 修复与保留的边界

- 只有持缓存锁的运行时监督器显式启用 `duringWrite`。对于已经枚举为普通文件、但 lstat 返回 ENOENT 的条目，丢弃部分累计值，重新从缓存根完整计量；不跳过未知字节，不只重试旧路径。
- 单次检查最多三次扫描；所有扫描共享原有 100000 条目工作量上限和深度 16 限制，不重置资源边界。持续竞争仍拒绝。每次中断均通过异步迭代器关闭目录。
- 准入、恢复后和最终检查仍为严格模式。根/目录缺失、权限/I/O 错误、符号链接或其他不安全类型、真实超额和文件系统余量不足不自动重试或放行。
- 不调整预算、预留、100ms 周期、并发数、单文件限制、超时、锁或公开错误。新扫描包括最终 pack 和其他目录，不把旧扫描部分值重复累加。
- 不采用“忽略所有 ENOENT”、只看单个 pack、增加预算、自动重试业务 run 或仅延长 UI 等待时间。

## RED → GREEN 与实际验证

`source-truth-git-cache-race.test.js` 的 rename/link-unlink 正例先以 `ENTRY_STAT/ENOENT/PACK_TEMP` 失败；有界重扫与共享工作量断言同样 RED。真实超额/不安全替换的断言细化后也先 RED，而不是只检查任意 503。

实现后，新增回归与既有 `source-truth-git-capacity.test.js` 共 23 项通过，零 skip/cancel（7.087s）。覆盖新文件计量、部分和丢弃、真实超额、不安全条目、持续竞争上限、根/目录及 EACCES/EIO、共享遍历工作量，以及既有监督器停止写入、锁竞争、宿主崩溃、历史字节保留和私有诊断脱敏。

扩展 Git/capture/pilot 集合共 47 项通过，零 skip/cancel（53.715s），日志 SHA-256 `96792fe9a1cb1677a5660ce3b19e070f0a4621a476cca995fa5a6e27a6e9c403`。其中包含真实 HTTPS、中断重试、历史保留、组合来源复用和仅传缺失变化字节的服务试点；不是重跑十万文件实验。

浏览器验证分层保留原始事实：

- 第一轮在启动 Chromium 前因共享可执行文件缺失而失败，零条浏览器用例、零次 Git 观察调用；summary SHA `8c443f114afbd264b544ae0d1927b4c0fca87e23eb4461fb9d0eb29d23e1dab3` 保持 FAILED。删除原因未知，不能归因于依赖安装。
- 从官方 Chrome for Testing 恢复独立缓存中的 mac-arm64 151.0.7922.34；记录下载元数据、包和可执行文件摘要，并验证实际启动版本。不修改 Playwright、锁文件或测试期望；同版本不冒称与缺失的旧二进制逐字节相同。
- 原 12 条矩阵实际全部 PASSED、进程 exit 0、issues 为空且没有自动启动分析；报告 SHA `c7abfdd1f56a7e13d7b48302d0d3e2ea9177f3c13dc71619751fe038db559f7b`。私有外层错误地要求所有底层 Git 调用成功，因刻意 `missing-root` 负例的 `rev-parse` 失败而退出，summary `0be85359e9e2cf4add087f3b2eb7f0d4820fd5d6228a0a99b7bc3358d9b29fd8` 仍为 FAILED。该错误经 gateway 映射为 `SOURCE_GIT_ROOT_MISSING`，零发布正是负例预期；不是缓存故障或瞬态重试注入。原报告/日志和外层失败分别保存，不改断言，不重跑已通过矩阵来美化汇总。
- 仅补外层未执行的 4 条 B-13，由搬砖工 / gpt-5.6-terra 单次执行，全部 PASSED：合法空 Git 首次版本、非空到空的完整删除、首次空目录拒绝、清空目录替换拒绝。旧包不变、目录未闭合不发布、零字节文件仍有效。报告 SHA `aa808ee9d8c645d2866da6500d26c61a29083aa23b8e59191e91c09795736c7a`；独立执行汇总 SHA `de9644816e7d71c0e87c1ed8aedeaba5b9350b2f20a888c3f4fa82326b9d2a3a`。这是取证子任务，不是正式代码审阅。

以上 47/12/4 的执行前后均核对固定的 19 项源码/锁文件指纹；归档结果仅更新这对文档，产品代码与测试不变。作者全文核对报告/日志并查看 10+6 张截图，B-13 执行者也独立查看其 6 张截图。两轮 UI 均来自本修复 feature 工作树、隔离 PostgreSQL/HTTPS/OPFS；Web 分别为 PID 33250、67349，端口 3188，API 为 3197，退出后两个端口均无监听。页面中的全局 Workspace 告警仍保留，不将隔离 fixture 的来源流程结果外推为整应用运行验收。

旧审阅仅覆盖 732970dd，不覆盖本修复；本记录不代替本修复 exact-HEAD 的独立审阅和合入后隔离验收。100k 本轮按 operator 要求暂缓，原失败保留；原生 picker 与受保护主备部署未验证。

## 风险与范围

行为：运行时计量的有界重扫。数据：无 schema/持久化写入变更，不删除来源、缓存或历史。安全：计量失败仍关闭，需重点审查重扫资格和边界。契约：不改变 File B 的容量与不可变性要求。不可逆：无。修复在独立 `fix/f001-cache-scan-race` 工作树进行，不修改共享 main 的其他功能提交。
