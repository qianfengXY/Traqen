---
feature_ids: [F007]
topics: [architecture, diagram-source, visual-verification]
doc_kind: diagram-source
created: 2026-09-20
status: discussion-draft-not-final
source_message: 0001789894667228-000356-83a09c63
---

# F007 展开图 v1 · 生成与核对记录

本次仅调整图形呈现。正文保持讨论稿；功能、接口及部署候选项没有借此次重绘定稿。原关系定义见 [flow-definitions-v0.1.md](flow-definitions-v0.1.md)。

## 产物与方法

| 图 | 方法 | 最终资产 |
|---|---|---|
| 运行单元与信任边界 | 原生 image-generation 两轮失败后，按已有架构风格绘制确定性 HTML/SVG，浏览器截图为 PNG | [图源](runtime-boundaries-v1.html)、[PNG](../images/traqen-runtime-boundaries-v1.png) |
| 调查、核查与分流入图 | 原生 image-generation，参考既有图稿；首轮后修订连接关系 | [PNG](../images/traqen-analysis-flow-v1.png) |

**SVG override reason：** 系统展开图首轮 `exec-5b1baeca-359c-4aec-ad1f-4621a7033ccc.png` 及第二轮 `exec-03c64336-d382-4fef-9b67-73d31d19c57f.png` 均把模型 CLI 与测试 Runner 的调用混接；第二轮仍存在模型 CLI 脱离编排、Runner 返回关联错误、结构化记录到投影方向未保留等问题。两轮均不采用。依据 image-generation 技能的失败降级条款，改用 HTML/SVG 保证原始关系可逐条核对；并非 image-generation 成功生成的系统图。

调查图首轮 `exec-7ba6f1ba-4e80-4634-8875-f1f88d1d28f7.png` 将 A5 运行创建连到了 B4 核查，跳过账本与调查。第二轮 `exec-e17ee865-94a9-4669-8413-f3e1765944eb.png` 已修正为 A5 → B1，作为最终成品。工具原始输出不是项目的长期交付入口；采用版本已归入本目录的 images/。

## 语义与可读性核对

- 系统图按五个协作区域拆线，同号节点表示同一职责。原定义 24 条关系与 SVG 中显式端点逐条比对，无缺失、无新增、双向关系一致；17 个语义节点均有落点。
- 操作 CLI、授权模型 CLI、测试 Runner 分开；模型链为调查编排 ↔ 模型 CLI ↔ 模型服务；测试链为平台 → Runner ↔ 被测环境，签名证据返回平台内验签入口。
- 读取入口仍为待对齐接口，测试传输仍为待定，不按节点外观暗示已实现或已部署。
- 调查图保留首次／配置变化确认、Head 冲突回流、账本→调查→归并→核查、五档分流、两条独立入图通路和人工补证／否决出口。自动收录不经过人工审核，也不取得人工权威。
- 系统图中文与编号经浏览器渲染，节点文字边界检查无溢出；两张 PNG 均目视核对文字和箭头，正文用标准 Markdown 图片及完整尺寸链接。
- v2／v3／v4 的 15 张历史 PNG 保留。产品验收、部署接线与功能定稿不属于此次图形检查。

## 本次呈现偏差与维护判据

此前只交付了 Mermaid 定义，没有验证阅读端能否看见中文节点；有图形源码不等于已有可读图稿。本次扫描正文所有 Mermaid 区域，共两处，已统一替换并保存原定义。后续同类交付应同时核对“关系是否正确”与“嵌入文档后是否可读”；图片清晰但箭头错、源码正确但阅读端空白，都不能算交付完成。

## 重新导出系统图

在本设计目录启动仅绑定本机的静态服务，用 Chromium 打开 src/runtime-boundaries-v1.html，视口宽度 1800 CSS 像素，等待 document.fonts.ready 后全页截图，scale=css。输出为 1800 × 2185。字体为 PingFang SC / Microsoft YaHei / sans-serif；不同平台的字体可能改变换行和尺寸，须再次检查边界。不要覆盖已有历史版本。

## 交付校验值

| 图片 | 像素尺寸 | SHA-256 |
|---|---|---|
| traqen-runtime-boundaries-v1.png | 1800 × 2185 | `bf9d5ae5e0fa84048d95fd910efa10906047af54eeeda58e40e9f2c37db507f6` |
| traqen-analysis-flow-v1.png | 1199 × 1312 | `97bc1c862b27386d3633afe48de93ce2247bf3f5d3c32c418dc9ccab3dffe3d8` |

浏览器在约 1000 CSS 像素内容宽度下加载两图（实测 985 像素），均完成解码并显示；这是隔离的文档图片呈现检查，不宣称已经核验 Hub 阅读器。README 共 85 个链接检查无缺失目标；旧版 15 张图片 SHA-256 与修改前一致。没有运行产品业务测试。

## 原生生成提示词

以下为实际发送的提示词，保留生成过程与修订理由。参考图的绝对位置只是当次执行输入，长期图稿入口是本目录。

### 系统展开图 · 初次

```text
Use case: infographic-diagram.
Create ONE finished Chinese enterprise software architecture diagram for the Traqen documentation. This is a new diagram in the SAME visual family as the supplied reference: pale slate background #f8fafc, white rounded rectangular nodes, fine blue #2563eb outlines and blue circular node-number badges, dark navy titles, muted slate descriptions, restrained orange for external trust boundaries and undecided transport, strong horizontal blue title rule. Flat consulting architecture drawing, no illustration, no 3D, no shadows, no decorative icons. Chinese sans serif, every label fully legible, at least 30px body text at 2400px width. Landscape canvas about 2400 x 1700, sufficient margins, no clipping.
Title exactly: “Traqen 运行单元与信任边界”
Subtitle exactly: “F007 · 候选组织 · 表达职责与信息交换，不代表独立服务或已部署”
Main central enclosing rectangle labelled “Traqen 平台逻辑边界”. Outside it: LEFT U1 授权用户, U2 Web 工作台 / 操作 CLI, E1 Git / 受托目录. RIGHT M1 授权模型 CLI, M2 模型服务, R1 受控测试 Runner, R2 被测环境. Place external model pair in upper right and test runner pair lower right, clearly separate.
Inside central platform, organize coherent lanes with sufficient spacing:
S1 接入与授权 [top access node]
S2 F001 来源治理
S3 受控材料读取 [small grey badge “接口待对齐”]
S4 F002 确定性事实
S5 持久作业 / F003 调查编排
S6 命题与关系核查 / 人工决定
S7 执行证据验签入库
S8 图谱 / 追溯 / 影响投影
D1 结构化记录 [database cylinder allowed]
D2 不可变来源字节 [storage cylinder allowed]
Arrange source handling left, knowledge processing centre, execution evidence right, storage below, view projection near user access. Do not crowd text. Max 2 lines in each node title.
Draw only the following real relationships. Use arrowheads at destination; bidirectional relationships have both arrowheads. Route orthogonally in whitespace, no wires across text or node bodies. Label key edges briefly in Chinese.
U1 -> U2; U2 <-> S1 labelled “操作 / 结果”.
E1 -> S2 labelled “来源材料”.
S1 -> S2; S1 -> S5; S1 -> S6.
S2 -> D2; S2 -> D1.
S2 -> S3.
S3 -> S4 and S3 -> S5 labelled “受控材料”.
S4 <-> S5 labelled “定向取证 / 依据与限制”.
S5 -> S6.
S4 -> D1 labelled “事实版本”; S5 -> D1 labelled “任务记录”; S6 -> D1 labelled “图谱修订”; S7 -> D1 labelled “执行与证据”.
D1 -> S8 -> S1 labelled “查询投影”.
S5 <-> M1 labelled “固定配置 / 有界任务”; M1 <-> M2 labelled “获准上下文 / 模型输出”.
S1 -> R1 with ORANGE DASHED arrow labelled “任务传输待定”.
R1 -> S7 labelled “签名证据”.
R1 <-> R2 labelled “白名单内执行与观察”.
All external runtime components outside platform rectangle. S7 is INSIDE, R1 and R2 OUTSIDE. Do not route execution task from database or F003 analysis runner. Do not merge CLI model execution with test Runner.
Bottom legend strip, exactly these four short items: “蓝线：调用与材料流” “灰线：持久化与查询” “橙虚线：待定传输” “读取入口仍遵守来源准入，不能据图认定直连已获授权”.
Do not add any extra facts, states or systems. Include all specified nodes and flows. Text must be accurate simplified Chinese, never empty boxes.
```

### 系统展开图 · 修订

```text
Correct only the connection semantics of this Chinese architecture image; preserve its excellent typography, colors, numbered boxes, titles and overall style. The following wires are wrong and must be replaced with unambiguous correctly routed arrowheads, using extra whitespace by increasing canvas size if needed.
1. The orange dashed “任务传输待定” MUST start at S1 “接入与授权” and END at R1 “受控测试 Runner”, NOT M1. This is a ONE WAY arrow S1 -> R1. Route far outside right edge if needed.
2. The blue two-way line labeled “固定配置 / 有界任务” MUST connect S5 “持久作业 / F003 调查编排” directly to M1 “授权模型 CLI”. It currently connects S6 to R1; delete that wrong S6-R1 wire. Do NOT connect S6 to R1 at all.
3. S3 “受控材料读取” must have two separate arrows: S3 -> S4, and S3 -> S5. Currently both point to S5. Correct the upper one to S4. Keep S4 <-> S5 as a separate two-way “定向取证 / 依据与限制” link.
4. Add a grey arrow S4 -> D1 “结构化记录” labelled “事实版本”. Remove any S4-S6 wire, which is not specified.
5. Query projection must be D1 -> S8 -> S1. Remove the grey S7 -> S8 wire and replace it with a grey D1 -> S8 arrow. S7 must still point LEFT into D1 labelled “执行与证据”.
6. Keep R1 -> S7 (signed evidence), R1 <-> R2 (whitelisted tests), M1 <-> M2 (model call), U2 <-> S1 (human operations), S2 -> S3, S2 -> D1, S2 -> D2, S5 -> S6, S5 -> D1, S6 -> D1, S1 -> S2/S5/S6.
The model CLI is a DIFFERENT execution unit from the test Runner. Do not connect test tasks to the model CLI. Keep S7 inside and R1/R2 outside platform boundary. Avoid all edge-label and node overlaps. Do not introduce extra edges.
```

### 调查流程图 · 初次

```text
Use case: infographic-diagram.
Create ONE finished highly readable Chinese enterprise FLOWCHART for Traqen, styled to match the supplied architecture reference: very light slate #f8fafc page, white rounded rectangular cards, blue #2563eb top borders and circular numbered badges, dark navy headings, grey body labels, orange decision/exception paths, thin orthogonal connectors with arrowheads, white footer legend. No illustrations, icons, 3D, neon, gradient or drop shadows. This is for documentation at 1000-1400 CSS px width. Large accurate simplified Chinese text is essential, no empty boxes. Generous spacing, no wire intersects text. Portrait-ish canvas about 2200 x 2400 so ALL flow branches are legible.
Title exactly “Traqen 调查、核查与分流入图”
Subtitle exactly “F007 · 流程图 v1 · F003 V2.0 与 F006 配置确认 · 功能未定稿部分仍保留边界”
Organize FOUR clearly named horizontal sections: “01 分析准备” “02 调查与核查” “03 五档分流” “04 图谱与人工回流”. Use left narrow blue section tabs similar to reference architecture layers.
Section 01:
A1 “选择输入” second line “合格来源 / F002 参考版本 / 调查重点”
A2 “读取生效配置” second line “预检 / F006 摘要”
diamond A3 “首次或生效版本变化？”
A4 “用户确认配置”
A5 “复验并创建 Run” second line “固定来源、参考与配置版本”
Edges A1->A2->A3. A3 YES ->A4->A5. A3 NO ->A5 (clearly bypass only confirmation, NOT preflight). A5->A2 ORANGE returning arrow labelled “配置 Head 冲突：保留调查输入并重确认”. A5 success down to B1.
Section 02:
B1 “材料与覆盖账本” -> B2 “主子 Agent 调查” second line “Main 规划与回读 / Child 取证” -> B3 “候选归并” second line “具体命题 / 去重 / 冲突编组” -> B4 “证据核查” second line “引用 / 权限 / 版本 / 条件 / 语义”.
Section 03: five separate columns or clear separate branches from B4 with visible condition labels:
C1 blue “自动收录” second line “Agent 分析态” CONDITION “支撑充分、条件明确、无未决冲突”.
C2 orange “有界补证” second line “预算与停止条件” CONDITION “关键证据不足”.
C3 orange “人工审核” second line “一问题一卡” CONDITION “规则或归属歧义”.
C4 grey “保留材料 / 待调查” CONDITION “尚无可靠解释”.
C5 grey-orange “隔离与修复” second line “按条件重试” CONDITION “无效引用 / 越权 / 版本混用”.
C4 is a legitimate waiting destination, not automatically human approval. C5 cannot flow directly to graph.
Draw C2->B2 return clearly labelled “补证回调查” and C2->C3 labelled “仍不确定”.
Section 04:
D1 “限定命题或关系的图谱修订”
D2 “否决或暂缓留痕” second line “不强制创建成立主张”
G “同一图谱” with three equal chips “业务视图”“实现视图”“覆盖视图”.
C3->D1 labelled “确认或修正 / 校验通过”.
C3->D2 labelled “否决 / 暂缓”.
C3->B2 return arrow labelled “补证或回答”.
C1->G DIRECT BLUE path that bypasses C3 and D1 entirely, labelled “自动收录”.
D1->G labelled “人工决定落实”.
Keep TWO distinct graph-entry routes visibly separate. Never route all candidates through approval. Preserve both return-to-investigation paths.
Footer concise exact notes: “自动收录 ≠ 人工确认” “无效输出不进入有效图谱” “运行与恢复固定版本，迟到结果隔离” “确认消费与原子建 Run 接口待联合确定”.
No added entities, no swapped arrows, no invented approvals. All text and connections readable with ample space.
```

### 调查流程图 · 修订

```text
Edit this flowchart with ONE required connector correction, preserving all other text, styling, boxes and edges. The blue arrow from A5 “复验并创建 Run” currently goes straight down into B4 “证据核查”. THIS IS WRONG. Erase that A5-to-B4 arrow completely. Draw the success path from A5 down into the whitespace BETWEEN section 01 and section 02, turn LEFT across the horizontal gap, then turn DOWN with an arrowhead into the TOP of B1 “材料与覆盖账本” (the LEFTMOST box in section 02). Label this routed path “Run 创建成功”. The second row must ALWAYS execute B1 -> B2 -> B3 -> B4, starting at B1. There must be NO direct A5 -> B4 arrow. Do not change the orange return-to-configuration arrow. Retain all five C1-C5 branches, all their conditions, both investigation return paths and both independent graph-entry paths. Keep exact simplified Chinese typography and the same blue, slate and orange style. Increase resolution if possible without changing contents.
```
