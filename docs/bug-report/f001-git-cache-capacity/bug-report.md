> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [git, storage, capacity, process-lifecycle]
doc_kind: bug-report
created: 2026-09-07
---

# F001 Git 缓存累计容量与执行生命周期

报告人：砚砚 / gpt-6-astra。作者诊断，不是独立审阅或 F001 完成报告。

## 诊断胶囊

| 栏位 | 记录 |
| --- | --- |
| 现象 | `899c896` 的原生 Git 只有单文件 `ulimit -f`；累积的多份 pack、索引和不同来源缓存没有共同的容量水位。 |
| 证据 | 新增真实 HTTPS 测试：先取得可重放的 commit，再把缓存总量预算设为 1 字节，采集另一登记仍成功；RED 为 Missing expected rejection。 |
| 根因 | `GitSourceGateway.capture` 在创建目录及运行 init/fetch 前，没有累计计量；单文件限制不限制文件总和。 |
| 诊断策略 | 对照文件 B §8.4；区分进程资源限制、应用容量水位和操作系统硬配额，逐一测试不同进程、取消及宿主退出。 |
| 超时策略 | 定向原生进程测试有 6–10 秒上限；异常写入的专用测试进程最迟 20 秒退出，清理只终止该测试的精确进程组。 |
| 预警策略 | 不调大旧试点预算，不删除旧内容，不把测量间隔当成绝对容量保证，不把跳过的 PostgreSQL 测试记作通过。 |
| 用户交互 | 容量不足返回脱敏的 `SOURCE_CAPACITY_EXHAUSTED` / 507；竞争返回 `SOURCE_GIT_BUSY` / 429，沿用可重试失败路径，历史读取不因新写入容量不足而禁用。 |

## 实现

- 私有部署配置增加 `resources.maxGitCacheBytes`，缺省为 4 GiB 的有限水位；字节值接受十进制字符串或安全整数，拒绝数组、非法字符串和不精确数值。`storage.minFreeBytes` 同样作用于 Git 所在文件系统。
- init/fetch 前，在整个 Git 缓存的跨进程锁内核验累计占用、剩余空间及 `maxPackBytes + 1 MiB` 准入余量，成功后才分配来源目录。累计占用包含所有登记、失败残留、索引和目录；每项保守取逻辑大小与已分配块字节的较大值。
- 有界递归扫描最多 100,000 个物理条目、16 层，单次 opendir 缓冲 32 项；拒绝符号链接及不可安全计量的类型。扫描不能完整完成时拒绝写入，不把漏项当成零字节。
- 原生写入期间每 100ms 尝试一次完整扫描，同一时刻只允许一个扫描，不积压计量队列；进程退出后再次核验，原生 exit 0 不能掩盖已超量事实。超过水位会终止专用原生进程组，材料不自动删除。
- macOS 原生 `lockf` 为整个缓存串行化写入，竞争立即退回，不在 HTTP 请求中无界等待。锁文件保持原 inode，取消/容量失败/正常退出由内核释放，不使用会误判活跃执行者的定时锁文件删除。
- 原生命令不继承私有控制通道。API 执行进程崩溃时，监督进程检测通道关闭并停止整组写入；不留下无人负责、占锁直至超时的孤儿进程。公开诊断不复制源服务器 stderr、凭据或其他 Workspace 的累计字节。

## 红绿证据

1. 原网关超过累计水位仍继续采集：RED；实现后真实 HTTPS Git 4/4 通过，含 ref 移动、旧 commit 重放、目录根缺失及禁止重定向。
2. 首轮监督器将 lockf 使用的 FD 3 传给子进程，原正常测试均返回存储错误。独立 FD 检查确认 lockf 在 exec 时关闭该描述符，Node 已把 FD 3 用作事件队列，spawn 因 EBADF 失败。改用独立 FD 5 副本承接同一锁后恢复通过。
3. 首轮宿主退出测试 RED：API 进程已死，原生执行者仍占锁。增加私有通道的断开处理后，同一测试 GREEN；新的执行者能接续。
4. 非法锁路径最初暴露 ELOOP，数组预算最初通过隐式字符串转换；两项各自先 RED，随后统一为安全错误和严格值类型检查。
5. 定向测试覆盖两个各 700 KiB 的文件分别低于 1 MiB 单文件上限、合计超过 1,250,000 字节；包括原生命令正常退出与继续写入两种路径，均以 507 拒绝。还覆盖准入余量、文件系统剩余空间、跨进程竞争、取消释放、不删除锁 inode、宿主崩溃、历史可读、非法配置、符号链接及 stderr 脱敏。

## 验证边界与后续

这是应用层累计水位和背压，**不是操作系统硬配额**。100ms 调度、完整扫描耗时及原生写入存在间隙；准入余量不是原生 Git 最坏写入量证明。需要零超量硬界限的部署仍须配置并验证专用文件系统配额，本次未改主机卷、系统服务或生产数据。

当前锁适配与既有卷保护适配一样限定 macOS；不以布尔配置伪称支持其他主机。锁保持、宿主异常终止的测试使用受信任的测试写入器，正常采集/历史读取和下文的中断重试用真实 HTTPS Git；本记录不把测试写入器替代原生下载恢复证据。

定向组合命令 `node --test test/source-truth-git-capacity.test.js test/source-truth-git.test.js test/source-truth-git-batch.test.js test/source-truth-git-target.test.js test/source-truth-configuration.test.js test/bilingual-documentation.test.js`：22 通过、0 失败、1 跳过，exit 0；`git diff --check` exit 0。

以上是首次定向验证的历史结果。当时真实 PostgreSQL 入口测试因重启后隔离工具链消失而跳过。

## `59a7b51` 固定提交补验

已从校验过 SHA256 的官方 PostgreSQL 16.15 归档重建隔离工具链。托管命令 320 秒、exit 0；构建、来源整组和 2000 文件校准各自 exit 0，完整日志已实读。来源整组 **128/128、零跳过**，含真实 PostgreSQL 多连接/事务/重启、配套备份和生产入口的隔离测试；不是整仓门禁。

`tq-f001-pilot-d0bjAv/report.json` 的真实服务报告为 PASSED：Git 1000 + 目录 1000，三版冻结；目录发送 1,083,540 → 1,083,576 字节，增量 36；来源下线后数据库/存储重开与历史重放通过。阶段耗时为生成 2,107ms、初版 33,600ms、Git 更新复用目录 3,884ms、目录更新 2,406ms、离线重放 4,081ms。54 次采样，Node 峰值 RSS 229,703,680 字节，进程树 RSS 304,021,504 字节，FD 424，采样错误 0；预算仍为 1 GiB / 1024 FD。报告的 `browserVerified`、`disasterDeploymentVerified` 均为 false。

## 真实 fetch 中断与恢复

- 复现环境：`59a7b51` feature checkout 加新增回归测试；随机端口 loopback HTTPS fixture、真实 `/usr/bin/git`、私有临时仓库，不使用生产端口、库、凭据或旧运行时。先捕获 A，再提交 512 KiB 随机文件生成 B；测试对真实 pack 响应施加背压，观察客户端原生 Git 自己创建 `shallow.lock` 后取消。
- RED：`node --test --test-name-pattern='interrupted real HTTPS' test/source-truth-git.test.js`，1 失败、exit 1；新的网关重试同一 B 在 fetch 阶段返回 `SOURCE_GIT_TRANSFER_FAILED`。进程检查无残留 Git 写入者，缓存外层锁已释放，但 `shallow.lock` 与 `tmp_pack_*` 仍在。对这一隔离仓库运行原生 `fetch --dry-run --depth=1`，exit 128 明确指出 `shallow.lock: File exists`。根因是 SIGKILL 能释放内核锁，却不执行 Git 内部临时锁清理；只证明外层锁释放不能证明任务可恢复。
- 修复：仅可信写入监督器在持有缓存独占内核锁时恢复已知元数据锁：`HEAD.lock`、`config.lock`、`packed-refs.lock`、`shallow.lock` 及本服务 capture ref 的精确 OID 锁。只接受当前服务用户的私有、单链接普通文件；拒绝符号链接、硬链接、目录、公开权限及异常恢复目录。没有基于时间/PID 判断活跃性的捷径。
- 保留语义：原 inode/字节通过 rename 保存在同仓库 `.interrupted-locks/recovery-*/原相对路径`，目录同步后重新核验累计水位才启动 Git。没有 TTL、自动删除或解释/发布中断锁内容；既有 refs、pack、索引、未完成 pack 和未知命名的锁保持原处。恢复目录仍计入容量。
- GREEN：同一真实 HTTPS 回归通过，包含竞争执行者拿不到外层锁时不得移动活跃的原生锁、取消后新网关取得原定 B、恢复目录保留原锁 inode/字节、A 可重放。连同容量/进程/元数据安全测试 14/14、零跳过。中断测试有 20 秒总上限及 5 秒 pack 起始上限；只有测试创建的精确下载被取消。

旧 `bcb21ac` 的 100k PASSED 及两次 timeout 保留，只证明其固定旧提交；不外推为本次新进程拓扑的性能结论。本次恢复增量仍需整组回归；完整浏览器矩阵、整仓类型红灯、两位独立 exact-HEAD 审阅和合入验收仍未收束。
