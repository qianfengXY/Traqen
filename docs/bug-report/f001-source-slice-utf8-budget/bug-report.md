---
feature_ids: [F001]
topics: [source-slice, utf8, byte-budget, regression]
doc_kind: bug-report
created: 2026-10-15
---

# SourceSlice UTF-8 截断超出字节预算

## 报告人及范围

搬砖工 / gpt-6.1-sol。F002 并行线程报告完整自验在 `FACT_COMMIT` 失败，随后 `PUBLISHING` 未产生；本 F001 线程独立核实共享 Broker 缺陷。只修复文本切边，不改变权限、领域校验、64 KiB / 12,000 token 上限或分析发布规则。

## 诊断胶囊

| 栏位 | 内容 |
|---|---|
| 现象 | 有效 Unicode 原文经字节裁切后生成替换字符，重新编码超过预算，触发 `RangeError: SourceSlice exceeds request byte budget`。 |
| 证据 | 基线 `dbec513ef71a88925dff0ea89516ee6e34bbb736`；`content="中"`、`maxBytes=1` 稳定复现。源线程原样自验的首错在 `FACT_COMMIT → SourceSliceBroker.read → createSourceSlice`，不是后续缺少 `PUBLISHING` 的 TypeError。 |
| 根因 | Broker 对原文字节窗口直接 `toString("utf8")`，半个字符被解码为 U+FFFD（3 字节）；脱敏扩张后的第二次字节裁切重复此问题。领域总预算拒绝是正确防线。 |
| 诊断策略 | 独立合成反例；与流式 UTF-8 清单解码对照；测试 oracle 按 Unicode 字符累计字节，独立于拟修复的字节边界算法。追踪两个截断点与跨 selector 的剩余预算。 |
| 超时策略 | 精确回归超过一分钟或出现非预期错误时先定位环境／测试，不重复跑整仓；完整回归单次托管，保留真实失败。 |
| 预警策略 | 不增加预算、不吞 RangeError、不改发布断言、不跳过材料；三次无效修复则停止叠加，重新分析调用链。 |
| 用户可见修正 | 在预算内返回完整 Unicode 字符，真实标注截断，不因字符切边使整个分析任务失败。 |
| 验收 | 先观察新增测试的行为 RED；随后验证中文／emoji／BOM／原有 U+FFFD 的所有边界、脱敏二次裁切、多个 selector 的合计预算，以及 scope／Fact／领域严格校验。相关适配器与原样仓库自验另验，不能把来源线程的原完整 gate 冒认通过。 |

## 复现与根因

旧实现的 1 字节窗口不是一个完整 UTF-8 字符，`Buffer.from("中").subarray(0, 1).toString("utf8")` 得到 U+FFFD，再编码为 3 字节。即使没有增加材料数量，该合成输入也足以复现。

源线程另有一份 72,548 字节中文架构文档，在第 65,536 字节切开字符，解码后为 65,537 字节。该文档与源线程冻结基线一致，但不同于当前主线文档；不将它描述为当前主线输入。Broker 与领域校验字节则一致。

本次是进程内 CLI／纯内存复现，没有连接在线 API；监听端口、在线 PID 和进程重启先后不适用，不作“运行态未更新”的推断。F008 文档发布导致的 main 同步前置已独立核验解除；与此 Unicode 缺陷无因果关系。

## 修复与验证记录

使用同一个完整 UTF-8 窗口函数处理原文选择和脱敏后的二次限额：开头跳过落在 selector 外的字符尾部，结尾丢弃预算内尚未完整的字符；两端都只向内收拢。原始字节范围仍作选择与审计依据，不把脱敏后的字符数冒充原文偏移。发生收拢时记录 `truncated`；预算不足以容纳一个字符时允许该材料文本为空，未用字节可留给下一 selector。

未采用扩大预算、改变领域 validator、吞异常、向外扩展范围或为每段强行填 U+FFFD 的方案。正常 ASCII、完整 Unicode（包括原有 BOM 和 U+FFFD）、既有脱敏与授权入口保持原义。

实际执行 `node --test --test-reporter=tap test/source-slice-broker.test.js`：实现前 9 项中 5 通过、4 项以预期的同一 `RangeError` 失败；仅修改 Broker 后同一命令 9/9 通过，0 skip。基线既有三项也已单独通过。领域预算上限与超预算拒绝仍由新增守护测试验证，领域实现文件未改。

2026-10-15 单次隔离回归（07:23:08Z–07:28:53Z）另取得：

- Broker、Worker 凭据和可执行契约合计 40/40 通过，0 skip。
- 源线程固定材料 SHA-256 `93a9990b78e651e66342c5f0bca377a04169ac8dc673d032cc0530966c247d53`，72,548 字节；旧半字符截断再编码为 65,537 字节，新 Broker→Direct-source 适配器实际传递 65,534 字节，`TRUNCATED`，保留一次审计与材料摘要。
- 原样 `test/traqen-self-acceptance.test.js`：1/1 通过，0 skip，覆盖两个真实不可变快照的 FULL→INCREMENTAL→独立 FULL。
- `node --test --test-reporter=tap --test-concurrency=3` 枚举运行 `test/*.test.js` 与 `examples/order-platform/tests/*.test.js` 全部 101 文件，604/604 通过，0 fail、0 skip；真实 PostgreSQL 使用每 fixture 新私有 socket 集群。
- `git diff --check` 通过；运行前后产品与测试指纹一致，领域实现 SHA-256 仍为 `304a363c4db818a8b284318dc65612ba8eaf979c333656d48b7047f0e2b85dad`。完整日志和可追溯摘要保存在仓库外，不把运行工件提交到项目。

上述是本 F001 独立修复工作区的作者证据，不是非作者审阅、合入验收或源线程未提交 F002 树的完整 gate。来源线程原有失败不被改写；其 owner 仍须消费最终修复提交并复验自己的原始检查。本次无前端、设计、认证或权限改动，不作 F001 整体关闭或部署声明。
