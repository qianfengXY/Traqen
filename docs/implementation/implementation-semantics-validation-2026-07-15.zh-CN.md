> 语言：**简体中文** · [English](implementation-semantics-validation-2026-07-15.md)

# 实现语义验证 — 2026-07-15

## 结果

JavaScript Scanner 现在涵盖了状态枚举、关键分支、权限保护、状态转换和异常路径的明确第一版本设计要求。这些仍然是确定性实现Facts；如果没有单独的 Skill 候选人和授权人员 Decision，他们不会晋升到规范业务 Claims。

## 提取的事实

- `enumValues([...])` 符号保留其字面值；
- 每个 `if` 条件都成为具有有限源文本的可定位 `condition-branch` CodeSymbol；
- 静态可识别的状态、权限和配置条件接收确定性分类；
- 显式 role/permission-check 调用保留其操作和文字声明的参数；
- JavaScript 状态赋值和文字 SQL `UPDATE ... SET status/state/...` 语句成为 `state-transition` 符号；
- 每个显式抛出都会变成 `exception-path` ，并带有错误类型和文字消息（如果可用）。

每个事实都带有正常的工件、行范围、内容哈希、提取器、Snapshot 和不可变的事实身份。分类仅表示观察到的实现包含该语法；除非单独证明，否则分支可达性、推断源状态、动态授权和业务正确性仍然未知。

## Feature 映射

内置参考 Skills 现在将有界实现上下文附加到候选端点。上下文遵循最多两个级别和最多 50 个组合事实的确定性 endpoint/handler 关系和本地工件依赖性。因此，State/permission/exception 符号在候选者审查中幸存下来，进入精确的实现映射，并在 Feature 可追溯性图中显示为可定位的 CodeSymbol 节点。

这是上下文 Evidence，而不是额外的规范性权威。端点 Fact 仍然是对候选人的直接支持，而相关语义事实则使用 `CONTEXT` 出处。

## 可执行的证明

Scanner 测试涵盖枚举值、权限和状态条件分类、显式权限检查、JavaScript 状态转换和异常路径。内置订单试点在反向运行中包括 Artifact 和 CodeSymbol 事实，并且会失败，除非修复的 Feature 映射通过最终当前的 Snapshot 可追溯性视图保留条件分支、状态转换和异常路径事实。
