> 语言：**简体中文** · [English](platform-operations-observability-validation-2026-07-15.md)

# 平台运营可观测性验证 — 2026-07-15

此增量实现了设计部分 17.1 的存储库控制部分，而没有发明平台未观察到的测量。

## 可用的观察结果

- 反向运行计数、状态分布、已用时间、Skill 尝试、重试、失败尝试、输入 Fact 规模、输出候选计数和持久异步队列深度。
- Scanner 捆绑计数、不完整扫描、node/edge 体积和每个提取器总数。
- 测试执行状态、已用时间、尝试、重试和 TestSpecs，其观察到的状态因执行而异。
- Evidence 类型、完整性、新鲜度、外部对象计数和生命周期操作。
- 更改影响经过的时间、更改的 Fact 计数、受影响的 Feature 计数以及回归选择大小。

端点是 `GET /v1/projects/{projectId}/metrics/platform-operations`。它由内存和 PostgreSQL 存储中相同的不可变记录支持，产品指标屏幕将其与 Snapshot 绑定的有效性指标一起加载。

## 显式数据边界

Runner heartbeat/resource 使用、模型代币成本和 Evidence upload/redaction 阶段持续时间需要本地控制平面中不存在的集成或证明。它们根据 `unavailableSignals` 退回，并注明原因；缺失的遥测永远不会显示为零、健康或综合分数。

## 验证

- 领域测试涵盖持续时间、重试、不稳定的执行历史记录、生命周期计数、影响选择和不可用信号。
- API 和 OpenAPI 测试覆盖项目端点。
- PostgreSQL 测试针对迁移的数据库执行完整的观察查询。
- Web lint、生产构建和服务器渲染测试涵盖了实时操作面板。
