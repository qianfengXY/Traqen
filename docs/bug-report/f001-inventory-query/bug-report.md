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
