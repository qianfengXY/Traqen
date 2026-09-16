---
feature_ids: [F002]
related_features: [F001, F003]
topics: [functional-diagram, deterministic-facts, controlled-material-view, evidence-feedback]
doc_kind: image-generation-record
created: 2026-09-10
version: "v3"
status: discussion-draft
---

# F002 功能全景 v3 · 生成记录

- 图片：[F002 功能全景 v3](f002-functional-panorama-v3.zh-CN.png)。
- 使用原生 image-generation 工具生成；未使用脚本合成或修改图片。
- 来源线程：`thread_mtgygk6ew4qqmz7b`。
- 反馈回路决定：`0001789004687536-000113-c9b9f8c7`。
- 重绘授权：`0001789005669469-000128-c60201b3`，co-creator：“按修改建议重新生成一份图”。
- 参考原图：[二级功能 v2](f002-functional-breakdown-v2.zh-CN.png)，仅作为内容与风格参考；v1、v2 未覆盖。
- 参照 F003 功能全景 V1.0；不声明访问接口已定稿，不改变现行 ADR-0003。
- 原始生成文件：`exec-f46dc369-a3fa-4f0d-a627-9cd787399b2f.png`。
- 图片尺寸：1448 × 1086；SHA-256：`b67bd964325768e6ef8162a3b8fef95aff173c80c5688089b8d46ef37a2d651a`。
- 人工式视觉自检：六组共 24 项子功能可见；紫色请求箭头 F003 → F002，蓝色返回箭头 F002 → F003；四种返回结果、受控未提取原文入口、属性/关系事实示例、独立验证与零 Gap 边界可见。
- 此为新图稿交付记录，不是非作者 Review、功能定稿、代码完成或验收记录。既有讨论稿 README、Spec 和 ADR 本轮未修改。

## 最终生成提示词

```text
Use case: infographic-diagram.
Create ONE polished, high-resolution Chinese enterprise functional infographic for Traqen, a fully redrawn v3 successor to the supplied v2 reference. The supplied image is a STYLE and six-capability CONTENT reference, NOT an immutable layout. Preserve white background, navy/royal-blue typography, teal evidence accents, amber gap accents, delicate rounded rectangles and restrained line icons. Add purple for F003 and its request arrows. No photography, no mascot, no 3D, no handdrawn text. Landscape 4:3 canvas, generous margins, crisp Chinese sans-serif, readable hierarchy. Prefer high-resolution text over ornamental detail. A single integrated poster, not two separate pages. All rendered text must be the exact Chinese labels below (English identifiers are intentional).

TITLE: “F002｜确定性事实层 · 功能全景 v3”
SUBTITLE: “不依赖 AI 提取事实｜原材料可查 · 技术事实可核 · 调查可回流”
Small top badge: “讨论稿 · 参照 F003 全景 V1.0”
Brand: “Traqen”

COMPOSITION: top source strip; main field with six capability cards arranged 3 columns × 2 rows on the left about 70% width, a substantial F003 investigation panel on the right about 27%; a clearly visible F002 output band below its six cards; a full-width two-way evidence-request loop underneath; compact evidence/identity examples and guardrails at the bottom. This is a functional relationship view, NOT a rigid waterfall or a finalized physical API topology. Do not draw a direct bypass API from F001 to F003.

TOP SOURCE STRIP:
“F001 · 合格 Receipt + 冻结来源版本”
Six neat icons with labels: “文档” “图片／图表” “代码” “测试用例” “测试报告” “配置”
Small text: “材料清单与已知缺口随版本继承”
A downward arrow into the F002 capability field labelled “已准入材料”.

SIX CAPABILITY CARDS under heading “F002 · 确定性处理与独立验证”. Each card has numbered title, exactly FOUR short subfunction rows, and an output line. Keep numbers 01–06 and row groupings exact:
01 “定位对象”
“材料登记｜来源、格式与处置”
“结构切分｜章节、符号、键、用例”
“原位定位｜行列、页码、图片区域”
“对象编号｜Workspace、组件与版本”
Output “产出：对象目录与材料入口”
02 “提取事实”
“代码声明｜类型、方法、导入、路由”
“文档与图｜原文与可解析显式结构”
“测试与配置｜断言、报告、配置声明”
“事实分型｜属性、关系与推导依据”
Output “产出：有类型、有编号的事实”
03 “确定关联”
“内部结构｜包含与声明绑定”
“代码关联｜可解析引用与调用”
“跨材料链接｜显式引用、作用域匹配”
“歧义处理｜同名不强并、不猜关系”
Output “产出：带前提的关系事实”
04 “追溯证据”
“原文回查｜从目录读未提取原文”
“证据保留｜获准片段、原图与校验”
“推导回查｜规则版本与成立前提”
“受控访问｜权限、范围与脱敏”
Output “产出：受控材料视图与证据”
05 “记录缺口”
“原因分类｜失败、不支持、歧义”
“未知标记｜动态行为、图片语义”
“影响定位｜对象、范围与缺失依据”
“覆盖跟踪｜处理处置、能力与待办”
Output “产出：已发现限制与覆盖说明”
06 “封存交付”
“范围封存｜全终态、跨范围边界”
“持久保存｜数据集、检查点与历史”
“重放校验｜固定材料、规则与配置”
“按需读取｜目录、原文、事实与缺口”
Output “产出：版本固定、范围明确的交付物”
Small note near 06: “全终态可有 Gap；待处理不能封存”

F002 OUTPUT BAND (not a second truth source):
Title “持久化、版本化的事实数据集”
Exactly FIVE clearly separated components, with two-line first item:
1 “对象与编号” / “材料目录＋受控材料视图”
2 “事实与关系”
3 “证据与前提”
4 “缺口与覆盖”
5 “清单与词义”
A prominent teal annotation beneath the FIRST component: “未提取原文也可发现、可读；不以已有 Fact 为前提”
Do not hide this annotation in fine print.

RIGHT F003 PANEL:
Title “F003 · 主导业务调查”
Inside make two clearly distinct information cards:
larger first card “主分析材料” / “F001 冻结原文与图片”
second card “参考与核查” / “F002 事实、关系、证据与 Gap”
Then a mini-sequence “提出假设 → 查原文／找反例 → 修正解释”
Strong boundary note “Agent 分析另存，不改写 F002 事实”
An amber outlined interface note: “原文读取接口待联合对齐” / “现行 ADR-0003 准入边界仍有效”
This must NOT say “不直读 F001”, “已允许直连”, or assert a newly finalized topology. Readers must see which CONTENT is primary and which is reference without assuming the unselected API route.
A short teal arrow from the F002 output band into F003 labelled “按范围读取”, with meaning of allowed output consumption only.

FULL-WIDTH TWO-WAY LOOP (visually important; do NOT omit return arrow):
Heading “定向取证／疑似漏提反馈”
On left a blue terminal “F002 · 结构化取证处理”
On right a purple terminal “F003 · 调查请求”
Draw two distinct parallel arrows between these terminals, separated by ample whitespace:
UPPER PURPLE ARROW pointing RIGHT TO LEFT, from F003 to F002, label “定向取证／疑似漏提＋材料位置”
LOWER BLUE/TEAL ARROW pointing LEFT TO RIGHT, from F002 to F003, label “处理结果＋依据＋版本／范围”
Under them show four compact outcome tiles, all clearly F002 returns:
“已有依据｜返回事实与证据”
“补提／纠正确认｜独立验证后发新版本”
“仍不确定／不支持｜返回限制与 Gap”
“越权／版本不符｜拒绝并说明原因”
Thin note: “请求绑定 Workspace、来源版本与范围｜预算与停止条件有界｜旧版本保留”
Never show Agent directly writing facts, a request automatically proving a fact, or an AI extracting F002 facts.

BOTTOM MINI EXAMPLE LEGEND (illustrative identifiers, not actual product records):
blue outlined capsule “对象 CODE-017”
teal rectangular fact card “属性事实 FACT-021：方法名 = loadConfig”
separate teal relationship tag “关系事实 FACT-023：CODE-017 引用 CFG-008”
neutral document icon “DOC-004｜已登记、未关联，原文仍可读”
Blue pill style identifies OBJECTS, teal distinct rectangular style identifies FACTS. Facts exist on attributes as well as relationships. Keep evidence semantics: each fact has source and rule/premises; no need for a large graph of sample entities.
Qualified identifier strip: “完整事实引用：workspaceId + graphVersionId + factId”
Small explanation: “graphVersionId 指 F002 数据集版本｜跨 Workspace 隔离，短号只展示，读取仍鉴权”

BOTTOM GUARDRAILS, legible 3 short blocks:
“已发现限制显式记录；零 Gap 不证明无遗漏”
“重放一致 ≠ 正确完整｜独立参考用例检查误提与漏提”
“文档声明 ≠ 已实现｜静态调用 ≠ 已执行｜测试报告 ≠ 已验证通过”
Footer “功能编号不是事实编号 · 图由 AI 辅助绘制，F002 事实提取不依赖 AI”

NEGATIVE CONSTRAINTS:
Do not copy obsolete v2 text “稳定、完整的输入”, “无法确定就保留缺口”, or “不直读 F001”.
Do not reduce the output to an API tree or only existing Fact-linked snippets.
Do not present F003 as a passive final step waiting for full-repository extraction.
Do not imply every detected uncertain item in arbitrary scope creates a gap: gaps are declared-scope limitations, while unseen omissions remain possible.
Do not introduce database brands, model names, implementation-complete badges, business classification in F002, all-format guarantees, raw-source bypass arrows, fabricated statistics, or extra functional groups.
All six groups and 24 subfunctions must be present. Source/output/loop/limitations should each be distinct. Keep arrows out of text and avoid unlabelled crossings.
```
