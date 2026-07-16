> 语言：**简体中文** · [English](continuous-protection-validation-2026-07-15.md)

# 持续保护验证 — 2026-07-15

## 结果

该切片实现了设计阶段 5 的存储库控制核心。不可变的 ChangeSet 不再停留在“这些记录已过时”； Traqen 导出可解释的回归计划，评估目标 Snapshot 上每个受影响的 Feature 证明链，并发出策略控制的 CI/CD 结果。

```text
ChangeSet + 确定性影响
→ 映射受影响的 TestSpecs ∪ 修复高风险 TestSpecs
→ 收集不完整时的保守回退
→ 目标-Snapshot Feature 可追溯性和 TraceGaps
→ PASS / BLOCKED / UNKNOWN 评估
→ ADVISORY / MANUAL_APPROVAL / ENFORCED 动作
```

## 选择安全

- 映射的影响测试和固定的高风险集是一个联合体，而不是交集。
- 每个选定的 TestSpec 都会记录其被包含的原因：映射的变更、固定的高风险策略或保守的后备。
- 不完整的 ChangeSet 或任何收集警告会将策略更改为 `CONSERVATIVE_UNION`；它永远不会产生 `PASS`。
- 丢失的目录条目、不可用的 Feature 可追溯性以及未经批准的选定测试仍然是明确的。
- 该计划使用最新的不可变 TestSpec 版本，但不会执行它或绕过其操作级策略。

当前确定性 Fact 图提供静态 API/code/data/config/dependency 关系。稍后可以将仅运行时路径添加为单独证明的动态 Fact 输入；在它们存在之前，操作员会配置保守和高风险集，而不是允许 Traqen 猜测。

## 质量门语义

信任评估和执行选择故意分开：

| 评估 | 含义 |
| --- | --- |
| `PASS` | 影响已完成且每个评估的电流-Snapshot Feature 链已完成 |
| `BLOCKED` | 选定的测试未获批准或受影响的证明链包含间隙 |
| `UNKNOWN` | 影响、测试分辨率或 Feature 可追溯性不完整 |

| 政策 | 不通过动作 |
| --- | --- |
| `ADVISORY` | `WARN`；默认，因为设计第 22 节将第一道门的执行留给了采用者 |
| `MANUAL_APPROVAL` | `REQUIRE_APPROVAL` |
| `ENFORCED` | `FAIL` |

不计算综合分数。 API 返回每个 Feature 的权威、一致性、验证、新鲜度、冲突维度、差距和修复操作。

## 接口和证明

- `GET /v1/projects/{projectId}/change-sets/{changeSetId}/continuous-protection`
- `npm run quality-gate -- --base-url ... --project ... --change-set ...`
- 产品的变更影响屏幕显示所选的测试、原因、策略模式、门评估、CI 操作和所需的维修；
- 内置订单试点在实施更改后立即断言 `BLOCKED/WARN`，仅在授权重新分析和新的当前部署回归执行后才断言 `PASS/PASS`。

CI 退出代码为 0 表示通过或建议警告，1 表示强制失败，2 表示需要手动批准，3 表示 transport/configuration 失败。 API 令牌是从环境中读取的，而不是命令行参数。
