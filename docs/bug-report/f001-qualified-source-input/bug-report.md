> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [admission, expiry, provenance, recovery]
doc_kind: bug-report
created: 2026-09-07
---

# F001 准入投影与已准入读取边界

报告人：砚砚 / gpt-6-astra。这是作者实施诊断，不是正式分支审阅或 Feature 完成报告。

## 诊断胶囊

| 栏位 | 记录 |
|---|---|
| 现象 | `63383a2` 的 `qualify` 仅返回包/清单/Gap ID 与计数，缺文件 B §11 要求的来源组件、策略、期限及确切接受引用；普通分析读取每页/分片都重验到期，未区分已准入分析。 |
| 证据 | 对照文件 B §7.3、§11 与 `admission-service.js`、publication、confirmation、component 记录。两个新增投影测试实际失败：字段为 undefined；独立持久读取入口测试实际失败：入口不存在。 |
| 根因 | 汇总投影没有映射完整来源证据；新准入与历史检查虽已分开，但缺少由 F002 持久分析绑定约束的读取接口。 |
| 诊断策略 | 从不可变记录映射，不新建内容身份或另存 F001 分析登记；验证原生 Git 身份、目录审计来源、全部 Gap 页与到期时间。 |
| 超时策略 | 30 分钟内聚焦此边界；跨功能运行时接线不得凭猜测代替 F002 对分析记录的所有权。 |
| 预警策略 | 禁止移除公共准入的过期检查，禁止接受请求体的旧时间戳，禁止以内存 allowlist 证明重启恢复。 |
| 用户交互 | 准入核验返回完整证据；核验仍不启动分析、不冻结新包、不顺延接受期限。 |
| 验收 | 投影 RED 2 → GREEN；持久读取 RED 1 → GREEN；含真实 PostgreSQL 重启、权限撤回、内容损坏与公共过期拒绝的 18 项相关测试全部通过，0 跳过。 |

## 修复

- 保留原 `bundleId` 等调用字段，补齐 `sourceBundleSnapshotId`、组件、`inventoryDigest`、`policyRevisionId`、`receiptValidUntil`、服务端最终 `qualifiedAt`、`confirmationId` 与 `acceptanceRecordIds`。无需接受时期限为 null、接受引用为空；确认引用仍保留。
- Git 投影保留 SHA-1/SHA-256、精确 commit 与全仓/目录根区别。目录 `manifestDigest` 为原清单内容摘要；`provenance.uploadId` 是原 `(runId, sourceId)` 会话键的 canonical JSON/base64url 编码，只作 Workspace 内审计定位，不进入内容身份。沿用组件仍指向最初上传会话。
- Inventory 内容寻址 ID 本身就是领域分离的完整摘要，因此 `inventoryDigest=inventoryId`，不是重新生成另一个身份。完整 Gap 集继续分页，增加逻辑字段 `gapId/componentSnapshotId/reasonCode`，不把第一页伪称全部。
- 凭据绑定额外核对确认 ID、策略、期限副本与状态/Gap 数一致性；最终准入时间来自数据库，在字节复验后、当前权限锁内记录。既不接受客户端时钟，也不承诺返回后永久有效。
- `admission.forAdmittedAnalysis(resolveBinding)` 是服务端 F002 适配边界。必需的可信查询从 F002 持久分析记录加载 `{ analysisRunId, sourceInput }`；F001 每页/分片校验精确 Bundle、Receipt、确认/接受、清单、策略、Gap 集和原准入时间。没有持久绑定、错绑或撤权时拒绝；不得回显请求体充当 resolver。
- 已准入 reader 没有 `qualify`，不新增公共 HTTP 到期绕过入口。普通 `/admission`、`/inventory`、`/gaps`、`/file` 保持新准入期限检查；历史检查路径保持原语义。内容读取仍用原校验存储流。

F002 继续拥有分析记录及其原始准入证据的持久化。本次真实 PG 契约试验使用测试专用消费者表，证明接口在 DB/服务重启后不依赖内存；不把该测试表当作产品实现，也不声称已修改或验收 F002 的分析运行时接线。

## 验证与剩余范围

`F001_TEST_PG_BIN=<隔离工具链> node --test --test-concurrency=3 test/source-truth-admission.test.js test/source-truth-capture.test.js test/source-truth-http.test.js test/source-truth-renewal.test.js`：18/18，exit 0。包含真实 HTTPS Git + 目录组合/沿用、真实 HTTP 上传至冻结至准入，以及隔离 PostgreSQL 持久读取。数据库不使用生产连接。

真实 PG 用例覆盖：过期后原分析读取、无新准入能力、伪造请求字段无效、错误 Receipt/接受/策略/清单/Gap/时间拒绝、跨 Workspace 拒绝、恢复未核验拒绝、传输中撤权阻止下一分片、损坏字节拒绝。SHA-256 与目录根投影另有固定对象 fixture 验证。

本次无 UI 布局修改、无新数据库迁移、无保留期限或删除行为。全 source 回归及整仓门禁仍需核验；全仓类型错误仍保留。Git 缓存总预算、浏览器八站、独立审阅与合入验收尚未完成。旧 100k 成功及两次超时证据不变。
