> 语言：**简体中文** · [English](reference-order-pilot-validation-2026-07-14.md)

# 参考订单试点验证 — 2026-07-14

## 结果

该存储库现在包含一个可执行的内置模拟参考系统和完整 MVP 垂直循环的单命令证明。这将关闭设计第 18.3 节的存储库控制部分，并实现第 18.4 节中的内置数据集，而无需对 Traqen 核心中的订单域进行特殊处理。

运行：

```bash
npm run pilot:order-submit
```

如果任何所需的阶段、失效、修复或最终证明条件失败，则该命令将以非零值退出。

## 参考目标

`examples/order-platform/` 是一个合成节点 HTTP 和 PostgreSQL 兼容的应用程序。其提交订单流程包括：

- `POST /orders/{id}/submit`;
- `DRAFT → SUBMITTED` 状态转换；
- customer/admin角色授权；
- 提交功能标志；
- 所需的幂等性密钥和重播记录；
- 外部库存预留依赖性；
- 数据库事务的提交和回滚；
- 写入失败后的库存补偿；
- 同一订单并发提交的序列化；
- 隔离测试种子和清理。

参考测试执行成功、禁止角色、无效状态、幂等重播、禁用配置、数据库回滚、库存补偿和并发性。

## 第一个完整的Snapshot

飞行员执行这些真实的协议操作：

1. 识别实际的参考源、可运行的模块文件和有效的运行时上下文，然后从其 SHA-256 摘要创建一个不可变的 Source/Build/Deployment/Runtime Snapshot 清单；
2. 将参考存储库扫描到 53 个可定位的 Fact 节点和 110 个边；
3. 注册并执行两个带符号的引用 Reverse Skills；
4. 合并他们共享的终点结论，同时保留两个来源；
5. 获得服务器解析的人类 Decision 的最小规范 Claim 和 Scope；
6. 将已确认的 Claim 和映射的端点 Fact 转换为未经批准的受控写入 TestSpec；
7. 获得独立的TestSpec批准；
8. 播种草稿订单，调用真实的 API，执行列入许可名单的数据库断言，然后进行清理；
9. 摄取 Runner 签名的 HTTP、数据库、断言、生命周期、结构化 LOG 和 TRACE Evidence，包括规范化可信目录 SQL、查询引用、编辑参数、返回行和目标遥测；
10. 保留零间隙的完整 Feature 跟踪链。

## 变更及修理

试点将目标复制到隔离的 Git 存储库，提交第一个版本，对端点处理程序进行真正的源更改并提交，然后在两个完整提交哈希之间运行有界 Git Diff 分析器。差异标识 `src/server.js`；所有 14 个生成的 Fact 更改都与该工件相关，并且影响服务选择提交订单 Feature。 build/deployment 工件摘要也会发生变化，因为它是根据第二个服务器加载的实际文件重新计算的。

修复前：

- 权限仍然是 `CONFIRMED`；
- 实现一致性为 `STALE`；
- 新部署尚未执行；
- 历史 Evidence 被保留，但被拒绝作为新部署的证据；
- 显式 `CONFORMANCE_STALE`、`NOT_EXECUTED_ON_CURRENT_DEPLOYMENT` 和 `EVIDENCE_STALE` 间隙可见。

然后，更改后的源将作为实际的第二个 HTTP 部署加载。新的反向运行和授权实施重新分析将当前 Facts 绑定到现有 Claim。未更改的批准的 TestSpec 针对第二个 Snapshot 重新运行，生成与其实际部署绑定的 Evidence。最终的当前-Snapshot 链是完整的且零间隙。

## 跨Snapshot TestSpec语义

`TestSpec.sourceSnapshotId` 记录测试协议的生成位置；这并不是未来每次回归都必须执行的部署。已签名的 Runner 任务绑定确切的执行 Snapshot 和所有四个组件 identities/digests。正在运行的目标在执行前报告相同的 artifact/runtime 摘要，并且每个生成的 Evidence 清单都会与 Snapshot 清单、TestSpec 版本和 Runner 重复该精确绑定。仅当当前 Snapshot 一致性和当前部署 Evidence 都存在时，Feature 可追溯性才完整。

这允许未更改的批准的 TestSpec 在仅实施更改后保持有效，按照分层失效设计的要求，而不让历史 Evidence 证明新的部署。

## 验证

- 参考目标套件涵盖成功、禁止角色、无效状态、幂等性、禁用配置、回滚、补偿和同序并发；
- 自动垂直引导回归通过；
- 飞行员报告两个 Reverse Skills、两个候选来源、一个需要人工审核的候选 TestSpec、六种 Evidence 类型（`ASSERTION`、`DATABASE`、`HTTP`、`LOG`、`OTHER`、 `TRACE`)、`PASS` 在两个部署中，在变更期间保留 `CONFIRMED` 权限，在修复后保留 `CONFORMS`，拒绝新部署的历史 Evidence，以及最终的零间隙完整链。
