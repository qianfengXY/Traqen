---
feature_ids: [F001]
related_features: [F002, F003, F004, F005, F006]
topics: [implementation-plan, source-truth, persistence, lifecycle, recovery, frontend, security]
doc_kind: implementation-plan
created: 2026-09-06
status: in-progress
---

# F001 来源快照工作台实施计划

**Feature:** F001 — [当前中文设计（文件 B）](../feature-discussions/2026-08-30-F001-workspace-source-truth-design/README.zh-CN.md)。旧文件 A 不作实现依据。

**Goal:** 架构师在一个 Workspace 的八站工作台中，将 Git 固定提交、完整上传目录或二者建立为长期保存、可恢复、可重放的冻结来源包与 Receipt；后续手动新版本只传缺失变化字节。

**Acceptance Criteria:** 文件 B §12 的 B-01～B-13 全部适用，下文逐项映射；不是分期交付或缩减范围。

**Architecture cell:** 文件 B §4 的 `source-truth` ownership 边界。

**Map delta:** none。

**Map delta why:** 实现已确认边界，不重画架构，不改变 F005 导航或 F006 设置职责。

**Architecture:** PostgreSQL 管理任务、不可变清单分片、处置、Gap、发布操作和版本记录；专用持久化卷保存受 Workspace 隔离的暂存与内容寻址字节。私有准备与单事务公开发布分开；当前准入和备份覆盖由证据投影，不改写历史 Receipt。

**Tech Stack:** 现有 Node ESM、`node:test`、`pg`、PGlite 测试工具、React/TypeScript、vinext、现有 CSS token；生产使用 PostgreSQL，不以内存参考启动器代替持久化。新增外部依赖须另行核验必要性，不默认引入云存储、KMS 或分析 Agent。

**前端验证:** Yes — 真实浏览器完整走八站及阻断/续传/续签/新版本，记录浏览器版本；桌面、窄屏与现有主题抽样验证。HTML 示例播放不作为验收。

## 1. 授权与终态

实施授权：thread `thread_mtdpfw4ft7ngbi5f`，消息 `0001788707385838-000118-bc711ace`（2026-09-06）：“没有异议了，进行编码实现阶段吧。你可以进行开发了，按照这个方案进行，完整实现后再通知我。”之前 B 的设计审阅针对 `6ffb9d9dc13efb33a7385bf9158c5ee61a7bba2d`；该设计审阅不等于未来代码审阅。

交付终点包括真实三类输入、完整历史/增量、服务重启与故障恢复、原子发布、安全隔离、同包续签、配套备份隔离恢复、十万文件测量及同一工作台 UI。功能完成、当前下游准入、部署安全就绪和备份覆盖必须分别证明。

不做：F002 的解析/API 树、F003 语义/业务树、F004 影响推理或测试执行、F005 全局导航、自动同步、目录零文件发布、ZIP 解包、任意协议/工作树来源、多节点高可用、自动删除历史。旧本地扫描/Agent 代码可以保留兼容，但不能绕过新包合同或冒充 F001 路径。

## 2. 现状与集成接缝

- `src/api/http-server.js` 是现有 HTTP 入口；新来源路由独立分发，在解析请求正文前选择流式上传处理，避免全文件 JSON/base64。
- `src/api/production-server.js` 接入 PostgreSQL 并执行迁移；新 Source Truth repository 使用独立事务连接，不能在共享单连接上交错多个请求的 BEGIN/COMMIT。
- 现有通用 API token 和客户端 `actorId` 不能构成可信的成员身份。F001 请求必须绑定服务端认证主体及当前 Workspace 读/维护权限；未配置认证/授权时 fail closed。不得用 F006 的 Agent grants 代替人类成员权限。
- `web/app/traqen-product.tsx` 的 `workspace` 视图目前启动旧分析。仅将该内容区接入新 `SourceTruthWorkbench`；不调整导航项目、排序或选中规则，不自动启动分析。
- main 上已有未提交的导航、图稿和日志，全部保留；新实现放独立 worktree，合入时只带本次差异。旧 `f001-chatgpt-implementation` 已进入 main，不续写旧设计分支。
- 测试库与文件卷使用 `mkdtemp` 和显式隔离的数据库；不读取用户 `.env`，不连接现有生产数据库、Redis 6399 或 3003/3004。

## 3. 最终对象与编码边界

新增代码集中在 `src/source-truth/`：`identity.js`、`errors.js`、`policy.js`、`repository.js`、`blob-store.js`、`git-gateway.js`、`capture-service.js`、`publication-service.js`、`admission-service.js`、`delta-service.js`、`backup-service.js`、`http-handler.js`、`configuration.js`。拆分按生命周期所有者，不另建全局框架。

- 输入：`GitSourceRegistration` / `DirectorySourceRegistration`；登记 ID 稳定，来源选择草稿 CAS 修订；组件各自更新或引用已冻结组件。
- 执行：`SourceCaptureRun`、`SourcePreflightReport`、`DirectoryUploadSession`、有代次的执行租约及验证检查点；终态 retry 新 run，进程接管仍是原非终态 run。
- 证据：`SourceManifest` + 有序不可变分片、逐项 disposition、Coverage/Gap 稳定证据；Inventory 为同源查询索引，不能独立编辑。
- 内容：`GitSourceSnapshot` / `DirectoryUploadSnapshot`、`SourceBundleSnapshot`；内容身份不含审计时间、接受、传输或备份状态。
- 决定：追加的 `GapAcceptance`、清单确认、服务端唯一 publication operation、`SourceTruthReceipt`。BLOCKED 不产生 Bundle/Receipt；同包续签新 Receipt，不改旧凭据。
- 运维：备份尝试、不可变 `SourceBackupSet`、另记的健康/恢复证据和引用保护；当前覆盖为 `(Bundle, Receipt)` 的纯投影。

身份 v1 严格使用 B §6.2 域分离 SHA-256/JCS；路径原始字节 base64url，计数十进制字符串，非适用字段 null。子目录条目 `kind=DIRECTORY` 的大小/内容预期为 null；目录来源中的文件仍必须有大小及 SHA-256。测试向量先固定字段形状与排序；Git 原生 OID 不当作原始字节 SHA-256，分片/分页/worker 顺序不入身份。

## 4. 状态普查与唯一所有者

| 对象 / owner | 状态 × 事件 | 持久结果与禁止旁路 |
| --- | --- | --- |
| 来源草稿 / capture service | 未保存 → 显式保存 → 修订 N；编辑锁定输入 → 新修订 | CAS 保存，旧预检/确认/接受不继承；通用 GET 不懒创建、不写草稿。 |
| 授权主体与 Workspace 权限 / source repository | 授权 → 撤回/更新 → 新版本 | 每次读取/维护及最终事务验证；请求 body 的 actor/tenant 无权覆盖认证主体。 |
| Run / capture service | PREFLIGHTING → ENUMERATING → MANIFEST_FROZEN → CAPTURING/RECONCILING → REVIEW_REQUIRED → PREPARING_SEAL → FINALIZING → SUCCEEDED | 单 Workspace 单活动任务；历史 GET 不复活终态，公开版本列表只读发布记录。 |
| Run 异常 / capture service | 缺本机字节 → WAITING_FOR_CLIENT；输入/安全错 → BLOCKED；瞬态错 → FAILED_RETRYABLE；最终化前取消 → CANCELLED | 等待保留活动名额；失败/取消留审计，新 retryOf；FINALIZING 只能查询，不取消/另建。 |
| 执行租约 / recovery executor | 获取 → 心跳；失联 → 服务端接管、generation+1 | 所有推进/检查点/发布受 fencing；恢复不替用户确认或换接受责任人。 |
| 目录选择/传输 / browser + ingest gateway | 完整枚举哈希 → 闭合 → 分片接收/校验 → 全文件验证；失去文件能力 → 重选核对 | 全量重枚举才能确认删除；空目录/变化/漏项阻断；临时尾部不是已验证前缀。 |
| Manifest/处置 / repository | 准备有序条目 → 冻结；条目终态对账 → 私有 prepared revision | 冻结条目不可改；Inventory 查询索引由清单/处置产生；私有索引不得通过下游页读取。 |
| Blob / blob store | 私有暂存 → 前缀 checkpoint → 完整 hash/fsync → 受保护 verified blob | 系统键与 Workspace 隔离；复用仍检查可访问/完整；用户明确放弃才可回收无引用暂存。 |
| 确认/接受 / publication service | 用户明确确认 → 追加记录；过期 → 当前资格拒绝；重新确认 → 新记录 | 绝对期限用服务端时钟；冻结不能顺延；blocker 永远不可接受。 |
| 发布操作 / publication service | server binding → 准备 → 单事务结果；丢响应 → 查原结果 | run+确认修订唯一；不同客户端 token 同结果，同 token 异参拒绝；恢复不得换操作。 |
| Bundle/Receipt / repository | 私有准备 → 同事务发布 → 永久不可变 | generic update/delete 禁止；新 run 不改旧版本；新 Receipt 不切换旧分析绑定。 |
| 当前准入/Delta / pure selectors + integrity check | 读取版本 → 当前 ACL/expiry/完整性校验或版本比较 | 无独立可编辑 READY/覆盖 bool；F002 不接受原始路径或 draft。 |
| 备份尝试/集合 / backup service | 水位+保护 → 一致性 DB 备份+引用字节 → 校验 → 封闭成功；失败 → 诊断 | 外部目标也写完成证明；水位后新 Receipt 不被旧集合覆盖；同盘备份不能标灾备。 |
| 恢复 / backup service | 选择完成集合 → 校验/解密 → 隔离还原 → 全引用核对 → 开放 | 未闭合禁止准入；未完成任务回到核对/续传；早水位不冒充最新。 |
| UI 查询/轮询 / workbench controller | Workspace/版本切换 → 新请求世代；请求完成 → 当前世代才投影 | Abort/序号丢弃过期响应；卸载只停轮询，不取消 server run；未来站预览不推进。 |

所有用户预期可恢复的记录默认 TTL=0。租约过期只是执行权变化，不是数据删除期限。

## 5. 不变量与对抗测试矩阵

| ID | 可测不变量 | 反例 / 断言 |
| --- | --- | --- |
| INV-01 | 原始字节/路径/原生坐标决定完整身份 | 乱序、改分片、重启身份相同；大小写、Unicode、Git 模式/commit 改变身份。 |
| INV-02 | 每个声明条目恰一种处置 | 漏项、重复、未闭合、校验失败不能 seal；目录所有文件验证。 |
| INV-03 | 私有准备不能成为历史来源 | 分批索引写入中查询下游、取消、故障均零新 Bundle/Receipt。 |
| INV-04 | 发布可线性化且严格幂等 | 并发点击、换 token、事务前 crash/事务后丢响应、同键异参、取消竞态。 |
| INV-05 | 权限/租约以服务端当前事实为准 | 伪造 actor/tenant、撤权与 seal 并发、旧 worker 写入、跨 Workspace digest 查询均拒绝。 |
| INV-06 | 原生来源不执行内容且无越界网络/路径读取 | SSRF/重定向/凭据哨兵、特殊路径/链接、恶意脚本；代码和归档不执行/解包。 |
| INV-07 | 逻辑完整，物理增量 | 改动字节才传；删除需完整新清单；范围变化另记；沿用目录零重选/重传。 |
| INV-08 | 接受不改变材料，也不自动续期 | 第 7/8 站过期、客户端时钟、同包续签保持 Bundle 和旧 Receipt，完整 Gap 集继承。 |
| INV-09 | 原来源离线仍能重放 | 关闭 fixture 源并重启服务，全部内容、身份和历史仍在。 |
| INV-10 | 故障恢复不会猜成功或冒用用户 | 存储满、DB 失败、失联、重选变化、新 run 重试、恢复代次 fencing。 |
| INV-11 | 配套备份精确到版本/凭据及其依赖 | 损坏/未封闭/缺密钥/同盘目标拒绝；旧集合不覆盖后续续签；隔离恢复核对。 |
| INV-12 | 10 万文件处理有界 | 计量队列、内存、FD、在途字节；分页闭合无漏项；大文件不整段缓冲。 |
| INV-13 | 四种状态与八站 UI 诚实 | 第 6 站不绿灯、Gap 橙色、冻结与过期并列、旧包不被新失败覆盖、备份独立。 |
| INV-14 | 空来源按证据区分 | 合法空 Git 与全删除通过；缺 root/对象不通过；零文件目录无发布/删除结论。 |

## 6. TDD 执行顺序

每个任务均执行：先写具体失败断言 → 运行并确认是行为 RED（导入/环境错误不算）→ 实现 → 同一测试 GREEN → 回归/重构 → 只提交本任务文件。下列路径是预计最终文件边界；拆分可细化但不缩减合同。

### 任务 1：确定性身份与策略

创建 `src/source-truth/identity.js`、`policy.js`、`errors.js`；测试 `test/source-truth-identity.test.js`。

先固定一个零条目 Git Manifest 与一个含 Unicode 文件的目录 Manifest 的手工编码向量，再写乱序/数值/null/重复路径/无效 Unicode 与域分离断言。实现严格输入验证、原始路径字节排序、有界有序数组哈希和策略上限。

验证：`node --test test/source-truth-identity.test.js`。覆盖 INV-01/02/06/14。

### 任务 2：PostgreSQL 记录、权限与事务

创建 `db/migrations/0028_f001_source_truth.sql`、`src/source-truth/repository.js`；测试 `test/source-truth-repository.test.js`。接入 `src/storage/postgres/database.js` 的独立事务连接能力时补 `test/postgres-database.test.js`。

RED：两个并发活动 run 仅一个成功；跨 Workspace 记录读取拒绝；不可变记录 UPDATE/DELETE 被 DB 拒绝；私有 prepared 查询不到公开版本；伪造维护身份拒绝。GREEN：约束/索引、CAS、事务、append-only 记录和分片查询，禁止通用 record API 绕过公开门。

验证：`node --test test/source-truth-repository.test.js test/postgres-database.test.js test/storage-migrations.test.js`。PGlite 用于隔离合同测试，真实 PostgreSQL 补连接隔离/并发证明。覆盖 INV-03/04/05。

### 任务 3：持久化字节与恢复检查点

创建 `src/source-truth/blob-store.js`；测试 `test/source-truth-blob-store.test.js`。

RED：错误 hash、offset、截断、磁盘配额、symlink、跨 Workspace 复用拒绝；完整写入后关闭重开仍验证成功；未确认尾部可重传。GREEN：专用卷就绪检查、受限权限、流式写入/hash/fsync、分片 checkpoint、同 Workspace CAS 复用与引用保护。

验证：`node --test test/source-truth-blob-store.test.js`。覆盖 INV-02/05/09/10/12；记录安全配置不足的明确原因，不伪造加密证明。

### 任务 4：Git 固定对象采集

创建 `src/source-truth/git-gateway.js`；测试 `test/source-truth-git.test.js` 和受控 HTTPS Git fixture 支持文件。

RED：HTTP/SSH/local URL、内网实际目标、重定向、恶意 ref/路径拒绝；commit A 后 branch 移动不改变输入；空 tree、模式、LFS、gitlink、链接均正确。GREEN：在只读授权目标内取固定对象，不 checkout、不运行 hooks/filters；有限流读取并保留原生 objectFormat。

验证：`node --test test/source-truth-git.test.js`，实际 HTTPS 输入而非将本机路径当产品入口。覆盖 INV-01/06/07/14。

### 任务 5：八站执行与目录上传

创建 `src/source-truth/capture-service.js`；测试 `test/source-truth-capture.test.js`、`test/source-truth-recovery.test.js`。

RED：Git-only/目录-only/组合逐站产出；完整新目录闭合发现删除；沿用组件不再等待上传；关页/DB 故障/进程失联/旧 worker/源变化等恢复矩阵。GREEN：持久化草稿、预检、枚举、冻结 manifest、服务端受限传输校验、对账、诊断、retryOf 与 fencing。第 7 站保持等待用户，不系统代签。

验证：`node --test test/source-truth-capture.test.js test/source-truth-recovery.test.js`。覆盖 INV-02/05/07/09/10/14。

### 任务 6：Gap、原子发布及同包续签

创建 `src/source-truth/publication-service.js`；测试 `test/source-truth-publication.test.js`。

RED：第 7/8 站绝对期限、不同 token 同操作、异参拒绝、文件落盘事务失败、提交丢响应、最终化取消/撤权、续签不改 Bundle 与旧 Receipt。GREEN：prepare 摘要与保护引用、server operation binding、单事务发布、恢复查询与追加续签，所有检查在当前世代/权限下进行。

验证：`node --test test/source-truth-publication.test.js`。覆盖 INV-03/04/05/08/10。

### 任务 7：准入、历史、清单与 Delta

创建 `src/source-truth/admission-service.js`、`delta-service.js`；测试 `test/source-truth-admission.test.js`、`test/source-truth-delta.test.js`。

RED：路径/ref/draft/过期/撤权/损坏拒绝，Gap 跨多页全继承，删除定位基线、范围变化非删除，物理复用不影响完整历史。GREEN：QualifiedSourceInput、当前资格检查、不可变版本绑定分页、原始字节受权读取和 manifest 差异比较。

验证：`node --test test/source-truth-admission.test.js test/source-truth-delta.test.js`。F002 用合同消费者验证，不实现解析。覆盖 INV-05/07/08/09/14。

### 任务 8：配套备份及隔离恢复

创建 `src/source-truth/backup-service.js`、`src/cli/source-truth-backup.js`；测试 `test/source-truth-backup.test.js`。

RED：同盘/未封闭/缺密钥/损坏拒绝，旧备份不覆盖新 Receipt；源离线后同水位 DB+字节隔离恢复，检查点尾部不冒充成功。GREEN：一致性水位、发布/回收屏障、PostgreSQL 支持的备份与完成证明、精确成员/字节/密钥引用验证、恢复就绪 gate。

验证：`node --test test/source-truth-backup.test.js`；再对隔离 PostgreSQL 与独立验收卷实际备份/恢复，登记配置与实测结果。覆盖 INV-09/10/11。

### 任务 9：认证 HTTP 与部署入口

创建 `src/source-truth/http-handler.js`、`configuration.js`；修改 `src/api/http-server.js`、`production-server.js`，必要时新建隔离 Source Truth 开发入口，保留旧参考启动器说明；测试 `test/source-truth-http.test.js`、`test/source-truth-configuration.test.js`。

RED：每条端点读取/维护 ACL、body 身份伪造、路径/元数据泄露、上传限流/断流、未配置受保护存储 fail closed。GREEN：有版本绑定的分页、流式 chunk、server actor、恢复/查询/确认/冻结/续签等完整动作及脱敏四要素错误；原始 blob 不挂静态资源路由。

验证：`node --test test/source-truth-http.test.js test/source-truth-configuration.test.js test/api-http.test.js test/application-bootstrap.test.js`。覆盖 INV-03/04/05/06/10。

### 任务 10：真实浏览器目录采集与八站 UI

创建 `web/app/source-truth-client.ts`、`source-truth-directory.ts`、`source-truth-workbench.tsx` 与独立节点子组件/样式；只调整 `traqen-product.tsx` 内容接缝。测试 `web/tests/source-truth-client.test.mjs`、`source-truth-state.test.mjs`、`source-truth-journey.test.mjs`。

RED：不支持完整目录遍历时停止；空子目录、文件变化、全枚举/流式 hash、仅缺失字节发送；陈旧 Workspace 响应丢弃，刷新恢复真实 server run；future click 不推进、Gap 橙色、block 无绕过。GREEN：八站节点内容、地铁图、上一站证据/下一门槛、历史/清单/Delta/Receipt、容量与备份、同包续签都留在同一功能。

验证：`node --test web/tests/source-truth-*.test.mjs`、`npm --prefix web run lint`、`npm --prefix web run build`、`npm --prefix web exec tsc -- --noEmit`；再实际浏览器走首次与新版本、异常恢复、窄屏/主题。覆盖 INV-07/08/10/12/13/14。

### 任务 11：完整规模与故障验收

创建可复现 fixture/验收驱动 `test/support/source-truth-pilot.js`、`test/source-truth-pilot.test.js` 及 `src/cli/source-truth-pilot.js`（测试输出存隔离目录，不写入生产/仓库日志）。

先给每条 B-01～B-13 定 fixture 与失败断言，再跑 50k Git + 50k 目录及变化版本、离线/重启、故障点、配套恢复。报告真实文件/字节分布、耗时、传输/复用、内存/队列/FD、恢复点；依据显式资源预算判定，不造固定吞吐 SLA。

验证：`node --test test/source-truth-*.test.js`、`npm test`、`npm --prefix web run lint`、`npm run test:web`；生产式迁移/HTTP/浏览器/备份在隔离环境验收。没有实际部署保护与恢复输入时报告未就绪，不冒称已部署。

### 任务 12：独立审阅、合入与完成闭环

在同一精确提交上完成质量门与非作者独立审阅；遵守 `docs/policies/branch-review-publication-policy.md`，review-only 记录不入 Git。处理反馈后复核新 SHA，合入后在隔离验收环境重复关键旅程，最后核原始愿景及全部 AC。只有无必需剩余工作才更新完成状态。

命令依据为根/`web/package.json`。本仓未注册 formatter 或 `pnpm check`，不编造这些命令；空白检查使用 `git diff --check`。不因文档/示例检查绿灯而宣称生产功能完成。

## 7. AC 覆盖与部署输入

| AC | 实施任务 / 必留证据 |
| --- | --- |
| B-01 | 2～7、9～11：三类真实来源八站、原生身份、逐项处置、用户确认。 |
| B-02 | 1、2、4、11：固定向量、乱序/分片/重试/重启同身份。 |
| B-03 | 4、5、7、10、11：变化字节、完整删除证明、范围变化分列。 |
| B-04 | 5、7、10、11：目录沿用无重选/重传，历史独立。 |
| B-05 | 1～6、9、11：ACL/安全/存储保护阻断，零 Bundle/Receipt。 |
| B-06 | 1～5、7、9～11：十万文件资源与分页/计数闭合。 |
| B-07 | 2～3、7、11：原来源离线后数据库/卷重放。 |
| B-08 | 2、5、9～11：关页/重选、代次、并发、无系统代签。 |
| B-09 | 2～3、5～6、10～11：容量/DB 故障保进度、正确恢复动作。 |
| B-10 | 6～7、9～11：服务端期限、同包新凭据、旧历史。 |
| B-11 | 2、5～6、9、11：私有准备、原子、幂等/丢响应/取消竞态。 |
| B-12 | 8、10～11：完成证明、精确覆盖、配套隔离恢复。 |
| B-13 | 1、4～5、7、10～11：空 Git/全删除与目录零文件拒绝。 |

技术问题由实现核验：安全 HTTPS 对象传输的具体有界机制、Git objectFormat 支持矩阵、目录入口流式哈希、数据库连接隔离；不得以实现方便修改产品合同。部署输入仍必须实查：受保护主卷/数据库、独立故障域备份、密钥恢复责任、容量、浏览器矩阵、备份计划及恢复目标；代码默认不连接或改写生产数据。

本计划不增加价值取舍，也不将大功能拆成半成品交付。若实际发现与已定安全/权限/持久化合同无法同时满足的硬冲突，带证据及影响报告，再请求必要的范围/部署决定。
