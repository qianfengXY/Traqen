> 语言：**简体中文** · [English](workspace-candidate-terminology.md)

---
feature_ids:
  - canonical-traceability-ontology
topics:
  - candidate-projection
  - workspace
  - ontology
  - test-execution
doc_kind: bug-report
created: 2026-07-27
---

# Workspace 候选术语泄漏

## 诊断胶囊

| 字段 | 证据 |
|---|---|
| 症状 | Workspace 本地导航、统计、任务文案和图谱图例使用了受治理的 `Feature` 或 `Execution results` 术语来描述 Candidate 与测试文件观察。 |
| 首个错误边界 | 本地统计契约暴露了 `featureCount`、`testCaseCount`、`executedFeatureCount` 和执行结果分布，但本地分析无法创建受治理的 Feature、TestSpec、TestExecution 或 VerificationResult。 |
| 最小复现 | 打开已分析的本地 Workspace，查看候选追溯或分层统计。界面把 Candidate 视图标为“功能追溯”，并根据字面量 `NOT_RUN` 占位状态展示执行结果分布。 |
| 证据 | Kimi 审查指出 `traqen-product.tsx:1645`、`:1679`、`:1926`、`:1946`、`:2027` 和 `:3045`；同模式扫描还发现 `:1892`、`:2001`、`:2028`、`:2550`、`:3002` 和 `:3408`。 |
| 已排除假设 | 这不只是翻译错误：中英文和 TypeScript 统计模型都携带了同样的受治理词汇。它也不是真实执行状态，因为本地分析没有已批准的 TestSpec、Runner 结果或签名 Evidence。 |
| 根因假设 | Workspace 界面复用了受治理 Feature 视图的命名，而本地统计模型把证据缺失编码成了合成的执行结果分布。共享词汇使新界面持续重复同一分类错误。 |
| 修复 | 将本地类型、组件、计数和测试观察统一为 Candidate/Test Asset；用 `executionEvidenceGapCount` 替换合成执行结果；将验证状态表达为 `UNAVAILABLE`；根据 Candidate 与受治理上下文切换导航和图例；只在 IndexedDB 读取边界保留显式旧字段兼容。 |
| 预防 | 源码契约测试拒绝旧的本地标识符和可见文案，统计测试要求 Candidate/Test Asset/执行证据缺口字段，扫描器版本 6 使旧本地结构的缓存分析失效。 |

## 同类失效模式扫描

搜索模式：

- 本地 Workspace 把 Candidate 标成 Feature；
- 把测试文件观察标成 TestSpec/测试用例；
- 把可信执行证据缺失表达为 TestExecution 状态或结果分布；
- 容易诱发上述替换的本地类型与计数器命名。

已扫描界面：

- 全局导航和面包屑；
- 候选树、详情区块、分层统计与子层级表；
- 分析任务标题与初始化动作；
- 本地图谱工具栏、错误状态和图例；
- 本地分析、统计、图谱、存储和未启用布局组件契约。

有意保留：

- 确实展示 Feature、TestSpec、TestExecution 或执行结果的受治理服务端/演示视图；
- 明确表达“Candidate → 可信 Feature”的晋升文案；
- 仅用于兼容的 `analysis.features` 和旧 IndexedDB `featureCount/features` 读取。新存储摘要写入 `candidateCount/candidates`。

