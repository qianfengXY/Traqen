---
feature_ids: [F001]
related_features: [F002, F003, F007, F008]
topics: [shared-material-reading, source-reference, explicit-adoption]
doc_kind: implementation-plan
created: 2026-10-22
status: implementation-authorized
---

# F001 统一冻结材料读取改造

来源：co-creator 确认 F001 原材料版本／F002 技术证据／F003 业务图谱三层，在完整调整说明后授权“嗯，可以，把 F001 改造好吧”。[F001 详细合同](../docs/design/F001-workspace-source-truth/README.md)为本次实现和验收依据。

目标：F002、F003 能通过 F001 按精确材料版本读取同一原文，不要求 F002 先提取；保留各自显式采用的版本、权限、完整性、Gap 和旧历史。F003 Agent 及图谱的完整实现属于 F003，不在 F001 创建替代工作流。

Architecture cell: source-truth owns sealed material reading and source references; deterministic-facts owns technical evidence and its controlled presentation.
Map delta: F001 supplies F002 and F003 independently; F003 still consumes F002 technical evidence separately.
Why: F002 extraction support and fact-set membership cannot define discoverable source material.

## 工作单元与可观察结果

1. 同步 F001 §11.1 与 ADR-0003；保留采集、身份算法、八站、恢复及 F008 权限，明确采集尝试／内容版本／Receipt／分析版本分离。
2. 在 F001 的冻结读取器提供有界 `readMaterial`，按清单定位和原始字节摘要返回稳定材料引用；仅追加无正文访问事件。
3. 接入认证 HTTP 原文入口；F002 原接口改为调用同一读取方法，保留历史定位、脱敏和展示审计。
4. RED：真实目录冻结后调用新 HTTP 原文入口预期 200，当前 404。GREEN：同一路径读取精确原文，错误 Receipt／组件／权限／预算不返回材料；F002 读同源引用、脱敏不变。
5. 跑 `node --test --test-concurrency=1 test/source-truth-admission.test.js test/source-truth-http.test.js test/f002-admission.test.js test/f002-material.test.js test/f002-dotenv.test.js`；按新失败扩至相关版本／恢复／HTTP／认证测试。数据库和字节使用隔离测试存储，不连接生产。
6. 在独立分支固定提交，按仓库 SOP 做非作者 review，再本地 main 验收与同步；F007 当前独立审阅中的未提交文档不混入本分支。

本计划和设计是授权／实现合同，不是验收结果；真实执行结果在交付时报告。
