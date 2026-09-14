> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [inventory, pagination, browser, source-truth]
doc_kind: bug-report
created: 2026-09-08
---

# 材料清单缺少全量搜索与筛选

报告人：砚砚 / gpt-6-astra。基线 `8ea0ef9cb21b8de1664e164f2e0cccc399419bdc`。这是 F001 实施中的缺口修复记录，不是完整交付或独立审阅结论。

## 诊断胶囊

| 栏位 | 内容 |
| --- | --- |
| 现象 | 文件 B §9、§10.5 要求组件筛选、路径搜索和分页；现有材料表只有翻页。底层查询传入 orders 仍返回不匹配的首行。 |
| 证据 | ArtifactTable 无搜索输入；HTTP 仅透传 limit/cursor；SnapshotReader 查询仅做 keyset；实时 SourceQueryService 无 inventory 方法。新增 2 项后端测试实际 exit 1，新增 2 项 Web 测试实际 exit 1。 |
| 根因 | 检视查询与内部全量 manifest 读取共用无筛选入口；界面到 SQL 均缺少检视条件，不能靠前端过滤当前页补足。 |
| 诊断策略 | 沿 UI → HTTP → 读取服务 → entry 表追踪；同路径双组件、分页前筛选、字面百分号、中文和非 UTF-8 Git 路径分别验证。 |
| 超时策略 | 定向真实 PG 测试秒级。浏览器步骤 30～45 秒超时后保留失败报告，先查就绪条件和真实 DOM，不延长到无限等待。 |
| 预警策略 | 搜索影响 manifest 摘要、过滤采集流、改变授权/过期规则、把当前页数当匹配总数或加载完整清单到浏览器，均为错误方向。 |
| 用户交互 | 明确提交搜索/清除筛选；组件与处置选择；展示当前筛选匹配总数及本页数量；切换条件回首页，过期响应不覆盖新条件。 |
| 验收 | 后端 2 项 RED→GREEN；Web 2 项 RED→GREEN；真实 PG 包含 HTTP 的 3 项定向测试通过、零跳过。6af6611 整仓后端 562/562、含构建 Web 86/86、整仓严格类型与零警告 lint 均 exit 0；浏览器 exit 1，不能报整组全绿。 |

## 实现边界

- SQL 在 LIMIT 前按路径原始字节的字面子串、处置、精确组件筛选。搜索区分大小写，限制为合法文本且最多 256 UTF-8 字节，不用 LIKE 通配符，也不强制将 Git 路径转为 UTF-8。
- 游标绑定 Workspace、任务/来源或冻结 Bundle/Receipt，以及三个筛选条件；改变条件必须重新分页。匹配计数保持十进制字符串。
- 原 SourceMaterialRepository.entries/entryStream 保持完整、不筛选；manifest、采集、字节校验和冻结证据不使用检视条件。正常授权、当前接受期限与历史只读边界不变。
- 没有新增迁移、依赖或存储层。查询使用现有 entry/component 表；尚未声明当前 100k 搜索性能或索引加速。

## 验证与未闭合范围

`node --test test/source-truth-inventory-search.test.js`：2 失败 → 2 通过。
`node --test web/tests/source-truth-inventory.test.mjs`：2 失败 → 2 通过。
真实 PG 的 inventory 两项与 HTTP directory journey 共 3 通过、零跳过。HTTP 测试最初误用了 QualifiedSourceInput 的组件字段 id，实读契约后改为 componentSnapshotId；该 400 是测试输入错误，不是放宽服务端校验。

新浏览器矩阵第一次以 exit 1 在诊断连接前结束，未覆盖任何来源旅程；原因是 SSR 按钮出现早于 React 事件就绪。对照已有 rail 浏览器脚本补等待条件。原 FAILED 报告保留，新运行不得覆盖它。浏览器使用真实 PG、隔离 HTTPS Git、OPFS FileSystemHandle；不会将 OPFS 注入视为操作系统原生目录选择器验收。

### 浏览器测试定位诊断

6af6611 的整组托管执行耗时 193 秒，外层 exit 1。逐项日志确认后端 562/562、Web 86/86、整仓类型和 lint 均 exit 0，唯一红灯是浏览器：历史材料翻页和路径搜索之后，精确标签查询 `处置筛选` 等待 30 秒超时。原始失败报告保留，不用之前的搜索步骤推定整条旅程通过。

隔离 Chromium 151.0.7922.34 使用同样的包裹式 label/select HTML 重现：`getByLabel(..., exact: true)` 命中 0，但可访问性树明确有名为 `处置筛选` 的 combobox。按角色与精确可访问名称查询命中 1，实际 selectOption 后值为 METADATA。根因是测试定位方式，不是产品控件缺失；处置和组件下拉框均改用角色定位，产品代码不变。

矩阵补充失败截图/可访问性树、逐旅程结果落盘，并补目录新版本、同包续签和只读成员旅程。续签前后比较同一 Receipt 历史接口的记录，避免把 Bundle 的 latestReceipt 展示投影与历史记录误作相同结构。这些新增旅程尚待实际执行，不因脚本存在而算通过。

本次尚不声明完整 quality gate：浏览器矩阵、当前 Git 拓扑 100k、两位独立 exact-HEAD 审阅、合入与隔离运行验收仍未闭合。旧 100k 通过和两次超时均保留。主工作区设计文档及旧素材未改。

### 9c35b9c 浏览器结果与断言对象纠正

该次真实浏览器执行 exit 1、18 秒，报告和失败截图保留。三条完整旅程已记录：目录 105 文件和 1 空目录、刷新恢复同一任务、冻结响应丢失恢复唯一 Receipt、历史 100/6 分页及搜索/处置筛选、390px 当前站定位；目录新版本保留全部 105 文件且旧包不变；纯 Git 锁定精确 commit 并取得 READY。组合来源已经取得含两个组件、1 Gap 的 READY_WITH_ACCEPTED_GAPS Receipt，但后续矩阵未执行完。

第二处断言错误是把顶部流程标识当作整包资格卡。文件 B §6.1/§7.3/§10.1.8 区分冻结完成与当前准入，并要求带 Gap 的包保持橙色。实读 journey.ts、workbench.tsx 和截图：顶部蓝色“包已冻结 · 当前准入另行核验”仅表达流程完成；实际冻结结果卡与历史 Receipt 已为橙色，且保留 Gap=1。测试错误地要求前者的 class 为 warning，并非产品把 Gap 变绿。

因此只修测试：准确定位含“冻结包已建立”标题的结果卡，核验 warning、确切 Receipt 状态和非零 Gap；保留顶部准入待核验文案，并增加续签后状态及 Gap 数不变断言。不删除颜色要求、不改变产品状态映射。新断言与尚未到达的组合筛选、续签、只读、阻断旅程仍需完整浏览器重验。

### 96ae098 完整浏览器回归回传

搬砖工 / gpt-5.6-terra 在精确提交 `96ae0986196008d4912e1a76f9de124564a4409a` 执行隔离矩阵，托管命令耗时 24 秒、exit 0；回执 `0001788841236748-000109-e01c4515`，证据交付消息 `0001788851290923-000116-7d9bfa2c`，验证子任务 `0001788841093084-000101-0b542db4` 已完成。父任务仍在实施，不能把这次执行验证当作正式代码审阅或 F001 完成。

原样报告归档为 [browser-96ae098.json](browser-96ae098.json)。原始报告、运行日志和五张截图保留在父目录 `/private/tmp/`、子目录 `traqen-f001-browser-journeys.LkRGn4/`。父任务负责人重新读取完整报告，并复核组合缺口与窄屏截图。

七类旅程实际通过：目录捕获及刷新/丢响应恢复、目录新版本、精确 Git、双组件且保留一个 Gap 的组合输入、同包续签不改旧 Receipt、只读查询无写权限、阻断根目录不生成包或接受绕过；同时验证不自动启动后续分析。原先失败的运行记录全部保留。

仍未覆盖原生目录选择器与十万文件浏览器规模（报告两项均为 false），也不证明灾难恢复部署验收。截图中的通用 Workspace 数据提示尚无请求/响应根因证据，不能关闭。当前拓扑十万文件回归、上述界面边界、独立审阅与合入验收继续属于父任务。

### 39d6247 当前拓扑十万文件回归

精确提交 `39d624725fa1d4ff1474b01266078bedf2c17928` 的隔离服务试点在 3600 秒时限内以 exit 0 完成，托管耗时 2201 秒。完整读取 283 条 JSON 日志并对照产物报告，五阶段全部结束、无采样错误；[完整报告](pilot-100k-39d6247.json)保留原字段。

Git 50,000 + 目录 50,000 文件生成三个独立冻结包；Git 更新沿用 D1，D2 完整重新枚举且只新增传输 36 字节；原来源离线、数据库和存储重开后，首版与第三版仍完整分页重放。进程树每秒采样的 RSS 峰值为 428,654,592 字节、文件描述符 541，低于原 1 GiB / 1024 预算；这是采样断言，不是 OS 硬配额。离线重开/重放阶段耗时 216,626 毫秒，不应解释为部署 RTO。

原日志保留在父目录 `/private/tmp/`、子目录 `traqen-f001-current-100k.SnDvXX/pilot.log`；隔离材料及报告在父目录 `/tmp/`、子目录 `tq-f001-pilot-luguCt/`。旧 bcb21ac 十万文件通过及两次超时均保留。本次不修改运行时代码，不重复已有整仓门禁，不将服务试点等同于原生 picker、十万文件浏览器或灾难恢复部署验收。

### Workspace 通用提示的实际请求根因

在 `572c72b5728e30835934a2986af89f1b7cd5cd7d` 新建同一 `browserFixture`，使用隔离 PostgreSQL/HTTPS Git 和合成成员，以 GET 逐一核验 `refreshWorkspaceReads` 的七条请求；诊断进程 PID 69713、API 3197，完成后正常关闭本次服务与数据库，未连接生产或旧预览进程。诊断命令 exit 0 表示完成取证，不表示下面的 400 已修复。

| 请求（Workspace 为 directory） | 实际结果 |
| --- | --- |
| `/v1/projects/directory/graph/current` | 404 `CURRENT_GRAPH_NOT_FOUND`；客户端明确转为 null，不产生 rejection。 |
| `/v1/projects/directory/graph/revisions` | 200，空 revisions。 |
| `/v1/projects/directory/workspace-analysis-jobs` | 400 `INVALID_REQUEST`，`Legacy understanding runtime is not configured`；requestId `e8275351-2b27-48ec-8d13-c4fc7f875fd7`。 |
| `/v1/workspaces/directory/review-queue` | 200，空 items。 |
| `/v1/workspaces/directory/capability-draft` | 200，draft 为 null。 |
| `/v1/workspaces/directory/capabilities/effective` | 200，空目录和零计数。 |
| `/v1/workspaces/directory/execution-profile-revisions` | 200，空 profiles。 |

调用链是 `traqen-product.tsx:refreshWorkspaceReads` 汇总 Promise rejection → `server-understanding-client.ts:listServerWorkspaceUnderstandingJobs` → HTTP jobs GET → `TraceabilityApplication.listWorkspaceUnderstandingJobs` 的未配置检查。`browserFixture` 仅传 CORS 配置；`application-bootstrap.js` 要求 `SOURCE_SNAPSHOT_ROOT` 和非空 `TRAQEN_ALLOWED_WORKSPACE_ROOTS` 才创建旧分析运行时。因此已定位为本次 F001 隔离夹具缺少旧分析运行时，而非来源 Bundle/Receipt 读取损坏；不能据此推定真实已配置部署也失败。

保留错误及原截图，不吞错、不伪造空成功响应、不自动启动分析，也不为消除提示扩大 F001 到分析功能。该接入事实已以 FYI 同步 F002 thread，消息 `0001788855692674-000149-ce2c3d2a`，不转移实现责任。这里只关闭“警告原因未知”，不宣称完整应用集成或部署验收通过。

原生 picker 与十万文件浏览器验收仍未完成：电脑控制工具拒绝使用尚未获准的 Google Chrome for Testing，已向 operator 请求该应用权限，未改用其他控制通道绕过。现有 OPFS 和服务试点报告不能替代这两项证据。

### 38a9e5c 三个十万文件版本的只读浏览器验收

精确提交 `38a9e5c8575c27e76298da9a300c90c756c76e2d` 的托管执行耗时 130 秒、exit 0。完整日志、报告及两张实际视口截图已核验；[原样报告](browser-history-100k-38a9e5c.json) SHA-256 为 `363a2b9edb507bb919abaf3165ba9d141a3f3e35d5e966e98b0e69a2a3858bf4`。原证据父目录 `/private/tmp/`、子目录 `traqen-f001-history-100k.4PG3br/`。

先确认 39d6247 原试点 PG 已 shut down、没有 PID 或表空间链接，再把数据库与受管字节完整复制到新临时目录。只启动副本，通过原报告哈希和三个精确 Bundle ID 绑定它们；没有原地重开或改写原件，没有联网访问 Git。原报告 SHA-256 为 `d5ddb665968675099fef9d96afd35f1fbd1ceefbaa7e828daba8936a82ab8a67`。服务身份只有 READ，浏览器另行拒绝非 GET/OPTIONS 请求。

三个版本各有 Git 50,000 + 目录 50,000 文件。每版均核验全量计数、100 行首/次页以及末尾路径 `f049999.txt` 的全量搜索；最新版本按组件筛选，第二版到第三版正确展示新增/修改/删除各一项。首版搜索新增路径为零，刷新重连后最新版本仍能搜到；前后三个旧包的完整数据库 payload 与 HTTP 历史一致，无写请求、无 pageerror。17 次材料请求都限制 limit=100。390px 实际视口无横向溢出。

三版“分页并搜索”耗时分别 2143、2604、3258 毫秒，差异查询 1197 毫秒。搜索后的 DOM 为 360 个节点/1 行，差异为 343 个节点/3 行；这些是步骤结束的观察值，不是整程峰值。浏览器粗粒度 heap 观察值 24,500,000 字节也不是内存硬配额或峰值证明。完整首/次页另有各 100 行断言。

本次补足的是十万文件**历史 UI**，不证明浏览器采集、原生 picker 或灾备部署。此前未完成声明按时间保留；原生 picker 和规模采集仍分别未证实。遵循 operator 不重复审批的要求，不重试 CUA、不改审批配置。父任务继续实施，独立审阅、合入和受保护主备部署验收尚未闭合。
