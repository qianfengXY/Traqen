> 语言：**简体中文** · [English](fact-scanner-validation-2026-07-14.md)

# Fact 扫描仪验证 — 2026-07-14

## Scope 和结果

该报告根据 Traqen 本身验证了确定性事实基础片段：

```bash
npm run scan:self
```

当前扫描涵盖 123 个工件并生成 2,875 个可定位节点和 6,677 个关系。每个发出的节点都包含源工件、正行范围和 SHA-256 内容哈希。该捆绑包故意为 `complete: false`，因为六个 TypeScript/TSX 产品文件超出了此 Scanner 版本声明的 JavaScript 功能；每个都被报告为显式错误诊断，而不是默默地跳过。

| 节点类型 | 计数 |
| --- | ---: |
| 神器 | 123 |
| 模块 | 1 |
| 代码符号 | 2,273 |
| 端点 | 38 |
| 数据对象 | 363 |
| 配置 | 25 |
| 外部依赖 | 22 |
| 测试资产 | 30 |

| 谓词 | 计数 |
| --- | ---: |
| CONTAINS | 5,789 |
| DEPENDS_ON | 254 |
| CALLS | 441 |
| IMPLEMENTED_BY | 1 |
| READS | 58 |
| WRITES | 69 |
| CONTROLLED_BY | 16 |
| EXERCISES | 49 |

确切的包 ID 和源摘要有意不被视为永久报告标识符：当符合条件的源文件更改时，两者都会更改。 `npm run scan:self` 是可重现的当前结果。

## 确定性抽查

根据其源位置检查了以下样本：

- OpenAPI 提取在 `contracts/openapi.json` 中找到了 `GET /health` 和 `GET /v1/projects/{projectId}/facts`。
- SQL 提取在 `db/migrations/0001_core_traceability.sql` 中找到了 `audit_event` 表及其列，包括确切的声明行。
- 环境提取发现生产 PostgreSQL、API-token、CORS、Runner、Scanner、Skill-publisher 和审阅者配置引用，但未记录其运行时值。
- JavaScript AST 提取发现`createTraceabilityHttpHandler`、`createTraceabilityHttpServer`，以及它们内部的调用关系。
- 状态枚举保留文字值；状态分配成为可定位的转换符号；条件分支保留有界条件文本和确定性 `STATE_GUARD`、`PERMISSION_GUARD` 或 `CONFIGURATION_GUARD` 分类；显式角色检查调用和抛出的异常路径仍然是单独的可定位实现事实。
- 文字 SQL 分析在 PostgreSQL 存储和迁移测试中发现 read/write 关系。
- 静态命名导入将测试资产连接到导入的代码符号；未解决的或副作用的导入会在目标工件处停止，并使用导入基础进行标记，而不是声明符号级执行。

自动化测试还执行 Express 样式的路由并验证 `Endpoint IMPLEMENTED_BY CodeSymbol`、`CodeSymbol CALLS CodeSymbol`、`CodeSymbol READS DataObject` 和 `TestAsset EXERCISES CodeSymbol` 关系，以及枚举值、permission/state 防护、状态转换、显式权限检查和异常路径。

## 完整性和查询边界

- Fact 实体具有稳定的 project/type/natural-key ID；他们的事实记录仍然是 Snapshot 清单特定的。
- 捆绑包已标准化，并且 HMAC-SHA256 由名为 Scanner 的人证明； Scanner 公开用于源组件摘要的相同确定性存储库指纹。
- 摄取拒绝未知 Scanner、无效签名、项目不匹配、缺少 Snapshot 清单、源组件 ID 不匹配或源 SHA-256 摘要不匹配。包不能仅仅将源命名为 Snapshot，同时携带来自不同源字节的事实。
- Fact Bundles，节点和边仅在 PostgreSQL 中追加；更新和删除触发器拒绝突变。
- 事实查询是参数化的，上限为 500 个匹配节点，并返回带有显式截断标志的有界一跳邻居。
- 过大的合格文件和不受支持的源或 OpenAPI 格式会产生 `ERROR` 诊断并强制 `complete: false`，而不是默默地暗示完全覆盖。

## 声明的能力边界

此 Scanner 版本涵盖 JavaScript ES modules/CommonJS、包元数据、状态枚举、静态可见 condition/permission/configuration 防护、文字状态分配、引发异常路径、Express 样式文字路由、OpenAPI JSON、PostgreSQL `CREATE TABLE` DDL、文字 SQL 传递给 `query`、`.env`/YAML/properties 顶级键和节点样式测试资产。

它尚未声明 TypeScript/JSX 或其他语言、OpenAPI YAML、动态构造的 routes/SQL/configuration 键、框架依赖项注入、仅运行时调用、分支可达性、推断的转换源状态、数据库 views/indexes/triggers 或实际测试覆盖率的语义覆盖率。防护分类描述了观察到的实现语法，并且不会提升为规范业务Claims。遇到不受支持的源语言和 OpenAPI YAML 使捆绑包不完整。保持有效的 JavaScript 动态构造不会转换为事实，除非它们的值在静态上是明确的；因此，不存在关系并不能证明该关系不存在。
