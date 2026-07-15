> 语言：**简体中文** · [English](product-effectiveness-metrics-validation-2026-07-15.md)

# 产品有效性指标验证 — 2026-07-15

## 结果

Traqen 现在从一个不可变的 Snapshot 清单的受管记录中派生出设计第 17.2 节的存储库控制部分。端点和产品仪表板回答平台是否正在建立值得信赖、可修复的 Feature 证明链，而不是它生成了多少文档或测试。

## 指标

- 高价值Features，具有完整的当前-Snapshot链；
- 规范性Claim确认；
- 确认 Claims 与已批准的 TestSpec 相关联；
- 经批准的断言，检查业务价值或状态，仅超出 HTTP success/underlying 测试退出代码；
- Evidence 新鲜度分布；
- TraceGap 按类型、严重性和责任角色进行计数；
- per-Feature 产品、规则、实施、数据、配置、测试、断言、执行和验证的 Evidence 的存在；
- 每个 Feature 未更改的 authority/conformance/verification/freshness/conflict 尺寸。

每个比率都会返回分子、分母和可为空的比率。故意没有综合分数。空填充返回 `ratio: null`，而不是误导性的零或通过。

高价值人群来自`HIGH_VALUE_FEATURE_IDS`；当未配置策略时，每个受管理的 Feature 都会参与。没有受管控 Feature 的配置 ID 会被报告为不可用的指标输入，而不是被静默删除。

## 诚实的外部界限

仅从存储库中无法真实得出三个设计指标：

- TraceGap 修复周期需要持续的纵向 gap-open/gap-close 事件；
- 更改恢复时间需要采用 CI/CD 和部署事件时间戳；
- 缺陷逃逸率需要缺陷管理结果反馈。

它们在 `unavailableMetrics` 中返回，且缺少输入。 Traqen 并没有发明代理值。

## 接口和验证

`GET /v1/projects/{projectId}/metrics/product-effectiveness?snapshotManifestId=...` 在生产中经过全球验证，并拒绝未知的 Snapshot。应用程序通过内存和 PostgreSQL 存储枚举受管控的 Feature ID，从请求的 Snapshot 派生每个 Feature 可追溯性视图，然后计算指标。

域、HTTP、OpenAPI/JSON Schema、PostgreSQL、渲染的 UI 和内置试点测试涵盖了结果。该试点项目需要修复后的 1/1 有效高价值链、完整的 Claim 确认和规则覆盖、两个断言中的一个有意义的数据库断言、没有剩余间隙以及明确不可用的缺陷逃逸指标。
