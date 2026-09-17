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
