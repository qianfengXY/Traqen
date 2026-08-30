> 语言：**简体中文** · [English](README.md)

---
feature_ids: [F001]
related_features: [F002, F003, F004, F006]
topics: [workspace, source-truth, git, source-snapshot, coverage-gap, convergence]
doc_kind: feature-discussion
created: 2026-08-30
status: converged
decision_status: operator-authorized
---

# F001 设计收敛：Workspace 与源码真相

## 决策记录

co-creator 要求团队不把早期 F001 方案作为产品输入，而是围绕已表达目标重新设计；随后以“按推荐建议执行”授权落地推荐决策。本记录取代 2026-07-29 F001 讨论作为当前产品决策来源；旧讨论与 Git 历史保留为历史上下文。

三份独立观点收敛为一个原则：F001 不是报告“扫描成功”的工具，而是证据边界。它告诉下游分析究竟可相信哪份源码、哪些材料没有取得，以及人是否接受了一个非阻断限制。

## 已确认的产品决策

| 主题 | 最终决定 | 原因 |
| --- | --- | --- |
| 来源边界 | 每个快照对应一个 Workspace 中一个已获只读授权的 Git 仓库和一个固定已提交版本。 | commit 可重放；实时目录或脏工作区不可重放。 |
| 分析范围 | 默认全量已提交仓库；允许一个可选目录根。 | 支持 monorepo，又不会变成配置语言。 |
| 范围控制 | MVP 不开放 glob/regex、多目录根或“只采代码”等材料类别。 | 这些控制会在文档、配置、SQL 和测试中制造用户自定义的静默盲区。 |
| Gap 治理 | 只有非阻断 Gap 可接受；接受记录责任人、理由和有效期，但不删除 Gap。 | 遗留仓库可诚实继续，身份、完整性和边界失败仍必须安全关闭。 |
| 可消费状态 | 无 Gap 可为 `READY`；接受非阻断 Gap 后为 `READY_WITH_ACCEPTED_GAPS`；否则为 `BLOCKED`。 | Receipt 分别展示状态维度，而不是用扫描成功或单一健康分遮蔽问题。 |
| 下游准入 | F002–F004 只接收合格快照及其继承 Gap。 | 下游直接使用路径或 branch 会绕过证据边界。 |
| 试点顺序 | 先在受控 Git 参考仓库证明合同，再接入真实存量仓库。 | 能先刻意验证失败路径，再面对真实系统。 |

## 参考试点切片

1. 登记一个受控 Git 仓库，并将所选 branch 解析为 Commit A。
2. 选择一个服务目录根；仓库其余部分显示为范围外，而不是“已分析”。
3. 采集范围内所有已发现材料：代码、文档、配置、测试、安全脱敏的敏感 fixture，以及一个故意不可得的非阻断条目。
4. 记录并以理由和有效期接受该非阻断 Gap，签发 `READY_WITH_ACCEPTED_GAPS`。
5. 重放同一 Commit A，证明来源结果可重放；移动 branch，证明旧快照不变。
6. 让 F002 准入 fixture 只使用 snapshot ID 和继承 Gap；直接输入路径或 branch 必须被拒绝。
7. 采集含路径逃逸或完整性失败的 Commit B；它必须为 `BLOCKED`，不得签发可消费 Receipt。

## 排除范围

- 不支持任意本地路径、脏工作区、归档、多仓库聚合、递归子模块、多目录根或持续监听。
- 不支持用户定义的 include/exclude 规则、材料类型开关、安全绕过，或由用户控制完整性和 Gap 严重度。
- 不做 API/调用关系提取、Agent 语义、业务功能主张、测试执行、变更影响、仓库脚本执行或源码修改；这些属于 F002–F004 或后续 Feature。

## 可追溯性

- 当前验收合同：[F001 规范](../../docs/features/F001-legacy-system-understanding.zh-CN.md)
- 架构决策：[ADR-0003](../../docs/decisions/ADR-0003-source-truth-boundary.zh-CN.md)
- 直接下游消费者：[F002 规范](../../docs/features/F002-feature-api-traceability.zh-CN.md)
- 已被取代的历史讨论：[2026-07-29 F001 讨论](../2026-07-29-F001-legacy-system-understanding/README.zh-CN.md)

## 收敛检查

1. 否决方案 → ADR？**有——已记录到 ADR-0003。**
2. 可复用踩坑 → public lessons？**没有。**
3. 新增仓库级操作规则 → 指引文件？**没有。**这是一份产品合同，不是团队操作规则。
