---
feature_ids: [F002]
related_features: [F001, F003]
topics: [functional-diagram, review-correction, controlled-material-view]
doc_kind: image-generation-record
created: 2026-09-15
version: "v4"
status: discussion-draft
---

# F002 功能全景 v4 · 修改与生成记录

- 图片：[F002 功能全景 v4](f002-functional-panorama-v4.zh-CN.png)。
- 工具：原生 image-generation 图片编辑；没有脚本合成或后期改图。
- 编辑目标：[v3 原图](f002-functional-panorama-v3.zh-CN.png)，v3 保留不覆盖。
- 线程：`thread_mtgygk6ew4qqmz7b`。
- Review 来源：`0001789008610746-000150-a4270c5a`，宪宪的标题 P2 和两项视觉 P3。
- 本轮授权：`0001789442627373-000010-7aa2f5de`，co-creator：“宪宪是让你重新修改图片，如果你认可就改，不认可则反馈问题。”
- 原始生成文件：`exec-fd0c1b84-1fbb-484a-b71d-5e90387ad7e1.png`。
- 尺寸：1448 × 1086。
- v4 SHA-256：`8689609c2c1782f8353842aad48822f4e9708c43d3b5546b3b72d18efd164f9f`。
- v3 修改前后 SHA-256 相同：`b67bd964325768e6ef8162a3b8fef95aff173c80c5688089b8d46ef37a2d651a`。

## 修改范围与视觉自检

| 反馈 | v4 实际修改／核验 |
|---|---|
| 主框标题与横向验证要求分开 | 标题改为“F002 · 确定性处理”；页脚独立参考用例要求和补提／纠正确认中的独立验证保留。 |
| 原文访问通路待定应可见 | 黄色待对齐框与顶部 F001 之间增加外侧橙色虚线，并标注“虚线：读取接口待定，非已定直连”。不是批准新的物理读取路径。 |
| 查原文步骤应标明接口依赖 | “查原文／找反例”步骤增加同色“接口待定”角标。 |
| 防止局部编辑改变既有结论 | 六组 24 项子功能、五部分出口、未提取原文入口、F003 主分析／参考分工、双向取证箭头、四种返回、编号示例与缺口边界均保留。 |
| 保留历史 | 主标题版本升级为 v4；v3 原图校验值未变。 |

这是作者对图片的视觉自检与生成溯源，不是新的独立 Review、产品实现或 Feature 验收。没有修改 README、Spec、ADR、生命周期及访问契约；没有将短时句柄建议标为已确认。

## 本次纠偏记录

前一轮把可以直接执行的图面修改与尚待讨论的读取接口设计绑定，回复了接口分析，却未落实已经认可的图面修正。本轮按当前授权将两者拆开：执行三项图面修改，接口选型仍明确待定。核对范围同时覆盖主框标题、页脚验证要求、待定提示和调查步骤，避免只改一个位置导致同图矛盾；未据此修改共享规则或其他 Feature。

## 最终编辑提示词

```text
Use case: precise-object-edit / infographic-diagram.
Input image 1 is the EDIT TARGET: the existing Chinese Traqen F002 functional panorama v3. Make ONE polished v4 image by editing this existing infographic, not redesigning it. Preserve its entire content, 4:3 landscape composition, white background, navy/blue typography, teal evidence accents, purple F003/request arrows, amber limitations, all six cards with exactly 24 subfunctions, five-part output band, bottom bidirectional investigation loop and four response outcomes, examples, and epistemic guardrails.

Make exactly these three review corrections plus the version label:
1. Replace the large heading over the six left-hand cards “F002 · 确定性处理与独立验证” with “F002 · 确定性处理”. Leave independent validation in the bottom guardrail (“独立参考用例检查误提与漏提”) and in the confirmed correction/new-version outcome. Do NOT add a seventh capability card or delete validation requirements elsewhere.
2. Visually link the existing AMBER note in the F003 panel (“原文读取接口待联合对齐 / 现行 ADR-0003 准入边界仍有效”) with the TOP F001 frozen-source strip using a thin AMBER DASHED CALLOUT CONNECTOR. Route this connector outside the right edge of the F003 panel, with neat right-angle bends in a narrow added margin if needed. It must NOT cross or obscure any text, card, existing arrows or borders. It is an unresolved-interface annotation, NOT a deployed source-access route. Put a clearly legible amber legend along the clear horizontal gap between the F001 strip and F003 panel: “虚线：读取接口待定，非已定直连”. The connector should visibly attach to the amber note and terminate at the F001 source strip; do not turn it into a solid data-flow arrow or approved bypass path. Keep the amber note's two original lines unchanged.
3. In the right-panel three-step mini journey, attach a small AMBER badge reading “接口待定” to the SECOND step “查原文／找反例”. Use the same amber visual language as the unresolved-interface note. Place the badge at the top right of that step or just below it with enough spacing that it does not obscure “查原文／找反例” or the purple sequence arrows.
4. Change the main title's suffix from “v3” to “v4”; main title becomes “F002｜确定性事实层 · 功能全景 v4”. Keep the top-right badge “讨论稿 · 参照 F003 全景 V1.0”. It is still a discussion draft.

CRITICAL INVARIANTS:
All six function groups remain 01 定位对象, 02 提取事实, 03 确定关联, 04 追溯证据, 05 记录缺口, 06 封存交付, with all their existing four subfunctions each and output lines.
Keep F003 as “主导业务调查” with “主分析材料：F001 冻结原文与图片” and “参考与核查：F002 事实、关系、证据与 Gap”.
Keep the independent material-view access line “未提取原文也可发现、可读；不以已有 Fact 为前提”.
Keep “Agent 分析另存，不改写 F002 事实”.
Keep the bottom purple F003→F002 request arrow AND blue F002→F003 response arrow, all four outcomes, bounded scope, version references and old history.
Keep “已发现限制显式记录；零 Gap 不证明无遗漏”, “重放一致 ≠ 正确完整” and “文档声明 ≠ 已实现｜静态调用 ≠ 已执行｜测试报告 ≠ 已验证通过”.
Keep the object/property-fact/relation-fact distinctions and the unassociated DOC-004 example.
Do NOT add any decisions about signed handles, direct storage access, new auth ownership, database choices or performance. Do NOT add “不直读 F001”, “允许直连”, “完整输入”, “无遗漏”, approved-status labels, or new capabilities.
Only minimal local spacing adjustments required by the amber callout/badge are allowed. Render all unchanged Chinese labels clearly and faithfully. Keep the entire poster uncropped and crisp at high resolution.
```
