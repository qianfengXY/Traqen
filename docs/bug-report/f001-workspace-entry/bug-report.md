> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001, F005]
topics: [workspace, authentication, source-snapshot, frontend]
doc_kind: bug-report
created: 2026-09-17
---

# Workspace 连接失败被误呈为空状态

报告人：co-creator；调查与实现：砚砚 / gpt-6-astra。
执行授权：F001 thread 的 operator 消息 `0001789613646820-000011-1a02612e`。
这是实现诊断记录，不是 F005 提案采纳、独立审阅或 F001 整体完成声明。

## 诊断胶囊

| 栏位 | 调查结果 |
|---|---|
| 现象 | 公网入口的 Workspace 请求返回 401，但主区域仍显示创建 Workspace 的空态与旧 FULL 分析引导。创建失败主要靠全局提示，用户容易理解成“没有反应”。 |
| 证据 | 本轮实际浏览 `https://traq.nas.cpolar.cn/`：同源 `/api/health` 200、Workspace 列表 401。Web 3188/API 3100 的 PID 为 55489/55488，均从本机 `00e9c1d` 发布目录运行；网关现已代理 `/api`。没有把先前 localhost/CORS 问题当作本轮根因。 |
| 根因 | `renderView` 用 `activeWorkspace === null` 同时表达未认证、连接失败与真实空列表；Workspace client 丢掉 HTTP status。F001 overview 失败后仍显示“正在验证”，导航及首次引导残留旧分析入口。 |
| 策略 | 真实请求 → client 错误传播 → 页面状态分支；对照当前 File B 与已发布 F005 参考稿，先补精确失败回归。 |
| 超时策略 | 浏览器各等待有界；按首失败日志定位，不以重复重跑换取绿色，不接触生产数据。 |
| 预警 | 需要放宽鉴权、自动赋予来源权限或改变设计契约时停止该方向；不能用 UI 修补绕过权限边界。 |
| 用户交互修正 | 连接/认证页与真实空态分开；创建错误留在输入旁、保留名称、禁重复提交；进入来源快照；来源权限失败不再装作持续加载；冻结版本与本次采集分层显示。 |
| 验收 | 五条新 RED 均因目标行为缺失而失败，随后九条定向检查通过。2026-09-17 UTC 完整 Web build 与 105 条测试、type、lint、fixture origin 检查通过；隔离浏览器入口 5 条、既有旅程 12 条、空来源 4 条通过。以下记录失败尝试、证据范围与剩余边界，不作为整体完成声明。 |

## 修复与对照范围

保留服务端身份、Workspace 与来源成员的独立权限绑定，不自动 provision、不把通用 API 令牌当来源权限。连接令牌仅在页面内存，不写 URL、日志或浏览器持久存储。新建 Workspace 成功后若未绑定来源权限，明确显示不可访问及恢复办法，不虚报采集就绪。

F001 导航命名为“来源快照”，首次引导不再承诺 FULL 分析；保留八站、明确复核与冻结，不启动下游分析。来源页沿用既有语义色和主题变量，调整标题/信息字号、主任务与上下文宽度、冻结历史摘要、触控与焦点状态。F005 `c2eb46a` 是已发布的**待评审参考稿**，不是已采纳的完整全局设计；本次没有修改其 Spec、生命周期或设计文档。F005 新的桌面双主题提案仍由该 thread 处理，不由本修复代为全面实施。

测试 fixture 的 Web origin 改为可明确选择的 loopback 地址，使隔离 3190/3197 不占用部署中的 3188/3100；原断言与历史不可变性保护不降低。测试凭据与材料均为新建隔离 fixture，不读取用户来源。

## 本轮验证与画面对照

`npm --prefix web test`（含 build）105/105；`web/node_modules/.bin/tsc --noEmit --project web/tsconfig.json`、`npm --prefix web run lint`、`node --test test/source-truth-browser-origin.test.js` 与 `git diff --check` 均 exit 0。完整 Web 集合中的旧 100,000 条内存测试不是本次 F001 的十万文件浏览器或 8G 部署验收。

首次验收包装脚本误传 vinext `--host`，服务绑定 localhost 而探针访问 127.0.0.1，因此在浏览器启动前失败；原 FAILED summary 保留。读本地 vinext 实现确认参数应为 `--hostname` 后，仅补跑未执行的浏览器集合，未放宽断言。产品代码与已通过静态检查的指纹一致；新增入口用例的按钮选择器收紧到创建表单，避免命中同名侧栏按钮。

第二次隔离验证运行于 2026-09-17 03:24–03:28 UTC：Chrome for Testing 151.0.7922.34 / macOS Darwin 25.6.0 / arm64，Web 3190、独立 PostgreSQL 与 API 3197。5 条入口检查覆盖认证恢复、输入保留、防重复提交、新 Workspace 来源拒绝及展示；12 条旅程和 B-13 四条空来源边界通过。报告与日志逐字匹配，21 个源文件指纹及 9 份检查日志哈希一致，Web PID/cwd 对应本实现 checkout，结束后两个测试端口均无监听。

| F005 已发布参考 | 本轮实现证据 | 判断与边界 |
|---|---|---|
| `assets/previews/04-sources.png`：来源快照命名、冻结版本与新采集分层 | 桌面 1440×900、2560×900 与冻结包截图 | 来源标题、最近冻结摘要、当前八站及历史已分层；不是整套共享壳替换，也不是新 2560×1440 双主题设计的验收。 |
| 来源主任务与右侧版本/上下文栏、语义状态 | 复核空 Git、带 Gap 冻结、拒绝空目录替换截图 | 280px 上下文栏、较清晰的字号与间距；警告保持橙色，旧版本保留，当前准入与备份不冒称绿色。 |
| 连接失败不等于空态，错误可恢复 | 认证、创建失败保留名称、来源权限拒绝截图 | 操作原因与下一步明确；旧分析读取产生的全局告警仍可见，未掩盖或计为来源流程失败。 |

设计文件扫描命中 `docs/design-reviews/F005/assets/F005-layout-navigation-v2.pen`。当前工具没有 Pencil 截图能力，故读取其节点并使用同 revision 已发布 PNG 作视觉对照；不宣称本轮重新渲染过 `.pen`。八种宽度的无横向页面溢出与五个既有主题可见性是回归检查，不增加 F005 新移动端或新主题承诺。

证据（仓库外）：Parent path: `/private/tmp/traqen-f001-entry-ui.GLillt/`；Child path: `summary.json`；SHA-256 `1f14ec362c570103a4de39c884e1960081c5dc334fc60b790a7465cc7d47c840`。原失败及可复用静态证据：Parent path: `/private/tmp/traqen-f001-entry.XmtojP/`；Child path: `summary.json`；SHA-256 `49f3cc4fcb8a1c92ad4db97a504bfd60fbe85e13da9b66eeaf1b6833fc3d2ea7`。

## 保留事项

此修复尚未提供用户级来源权限配置入口；管理员绑定是已有边界，不能用“新建成功”冒充全流程授权就绪。公网提交本机部署令牌需要对应目的域的明确使用授权；本轮安全层拒绝的操作没有通过替代渠道重试。原生 OS picker、十万文件/8G 整体预算与独立主备恢复不属于本次绿色证据。

## 入口恢复再验证（2026-09-17 UTC）

上文保留首次实现的历史结果；以下是基于 `b7eb0f3a6300e85e23c23553e5aa1a926663a2b2` 的追加实现诊断，不是独立审阅结论。

### 根因与修正

初次修复把七路连接读取的聚合结果当成 Workspace 入口判据。只要辅助 skills 接口返回 404，即使 Workspace 列表为 200，也会挡住来源页面。创建错误、无限 checking 与旧响应问题同属连接状态边界不完整：新一轮连接需要独立的身份、结果提交和结束条件。

- Workspace 列表单独决定入口及 401/403 分类；六路辅助读取独立汇总，失败显示具体目录与可得的 HTTP 状态，不伪装为空目录，也不授予来源权限。
- 每次连接先清除旧身份的 Workspace 与全局目录，取消上一轮请求，并用连接序号及 Workspace context 拒绝迟到提交。连接 GET 共用 10 秒期限；响应体读取取消后也不得发布成功数据。
- 成功刷新列表后清除旧创建错误，保留名称；checking 时保留令牌及连接设置入口。创建写请求不自动重试。
- 浏览器 fixture 必须显式指定 localhost/127.0.0.1 的 3190 端口；缺失、3188、3100、5432、其他端口或外网地址一律拒绝，并在创建 PostgreSQL 前校验。
- 展示回归直接渲染实际 React 组件；SSR 正向断言绑定连接面板，不再被侧栏同名 tooltip 满足。通知使用方显式导入样式。

同型审计覆盖连接的七路读取、响应体取消、身份切换、Workspace context、创建结果与来源拒绝展示。这里拆分的是权威列表与辅助目录的职责，没有增加失败后逐层猜测成功的 fallback。后端、schema、来源授权与八站冻结契约未改。

### 红→绿与保留失败

原 b7 产品上，四条浏览器恢复用例均在 setup 成功后于 exercise 阶段预期失败；七条定向检查中三条预期失败。随后另补“响应体被取消仍返回成功”单测，先见 `Missing expected rejection (AbortError)` 再修复。不得把这些 RED 当成已修复证据。

06:59 UTC：14 条定向、111 条完整 Web 测试及 build、type、lint 全通过。包装脚本随后调用了已在 `2379606` 删除的双语测试，报 `Could not find 'test/bilingual-documentation.test.js'`；这是作者私有包装脚本沿用旧命令的错误，不是产品或文档内容失败。原 FAILED summary 保留，未复跑已通过的静态集合。现行中文默认文档的两条检查通过；本文已有英文伴文继续同步，不把双语误称强制门。

07:04–07:08 UTC：纠正包装命令后，文档 2、恢复 6、入口 5、旅程 12、空来源 4 全通过。新增的“辅助读取挂起不延迟入口”和“被取代的请求不能恢复旧身份”两条是补充验证，不冒称原 RED。Chrome 151.0.7922.34 / Darwin 25.6.0 / arm64，独立 PG/API 3197、Web 3190；Web PID 93889 的 cwd 属于本实现 checkout。15 个当前源码指纹、14 个未变静态源码、tracked diff、全部检查日志、四份原报告和 33 张截图哈希逐项一致，结束后 3190/3197 无监听。

亲读六张恢复截图、认证/创建失败/来源 403、1440×900 与 2560×900，以及带 Gap 冻结、空 Git 复核、空目录替换拒绝截图；全局旧分析读取警告仍诚实保留。截图只是相关状态证据，时间/取消断言来自浏览器执行。F005 后续要求同一界面仅缩放，八宽度无溢出**不能证明**该统一缩放要求，本轮不据此宣布 F005 对齐完成。

原 RED：Parent path: `/private/tmp/traqen-f001-review141-red.zH261m/`；Child path: `summary.json`；SHA-256 `ab78e09c7ecf408ad12232e4ed35f50dfc0d944db4a25bf19a9e15b3e5f7c45a`。

保留的包装失败/静态证据：Parent path: `/private/tmp/traqen-f001-review141-green.wiDMSu/`；Child path: `summary.json`；SHA-256 `aafe31d3ef0d1e3c11a601c65ce78dfab3cbe624445b8b1be85828124272acf6`。

本次 GREEN：Parent path: `/private/tmp/traqen-f001-review141-ui.gaREkm/`；Child path: `summary.json`；SHA-256 `2e45d8d02bf429b5ce650f09663be6dd86e072450193a9f37d12dc8eb973d618`。恢复报告同 Parent；Child path: `recovery/report.json`；SHA-256 `5989db86915bd3f2a880cbd4ac64c06b37b5479efa412a86fce4a9c4d3176e1e`。

以上只证明未合入修复的隔离验证；仍需独立质量门与精确提交复审，未合入、未部署，也未解除上文的公网凭据、来源 grant、原生 picker、规模/8G 与备份边界。
