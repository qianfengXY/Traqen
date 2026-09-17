---
feature_ids: [F002]
topics: [ux, desktop, image-provenance]
doc_kind: asset-provenance
created: 2026-09-16
updated: 2026-09-17
status: historical-superseded
---

# F002 UX V0.4 及之前的历史生成记录

> **历史记录，不是当前设计。** 下文保留当时的提示词与选择理由，以便追溯。设备分档与旧图均已撤销；当前设计只以 [UX 评审稿](../../README.md) 和 [当前资产记录](../GENERATION.md) 为准。

本文记录设计资产，不是产品验收报告或独立 review 结论。用户授权的范围是仅面向 14 英寸笔记本与 27 英寸显示器的 UX 详细评审稿。V0.4 按用户裁决统一为“一套完整页面，两种显示尺寸”，不存在笔记本精简版。

## 交付清单

[manifest.json](../manifest.json) 记录八张图片的原始生成文件名、实际像素、字节数和 SHA-256，其中六张是正文图、两张是历史尺寸图，使用状态由 `usage` 明示。旧图已移入本历史目录，清单记录实际路径。文件内容与所选生成结果逐字节一致。生成图片的像素尺寸不等于 CSS 视口规格，不能作为缩放实现通过的证明。

| 资产 | 来源 | 选择说明 |
|---|---|---|
| 01-laptop-reading.png | V0.3 历史，已被替代 | 目录收起的设计不再生效，不作为验收依据 |
| 02-monitor-reading.png | V0.3 历史参考 | 原三栏视觉保留作来源，不再代表独立的大屏功能版本 |
| 03-relations.png | 前轮桌面交互场景 | 关系列表与依据 |
| 04-coverage-gaps.png | 前轮场景，本轮定点修正 | 原图可读；权限状态不混入提取 Gap，取证先回 F003 |
| 05-versions-delivery.png | 前轮桌面交互场景 | 任务、已封存版本和交付分开 |
| 06-request-validation.png | 前轮桌面交互场景的已选修正版 | 来源不匹配，输入保留；不采用任意字符数作为预算 |
| 07-request-result.png | 前轮桌面交互场景 | 四类返回，新版本不自动替换当前 |
| 08-unified-desktop-v0.4.png | 当前统一桌面参考 | 14／27 英寸共用完整三栏与全部操作，仅显示尺度不同 |

生成途径：原生 image generation。视觉参考为前轮已生成的 Traqen 桌面效果图，沿用 F005 的 porcelain／graphite 视觉方向。参考是风格输入，不证明产品已经实现，也不改变 F005 的审批状态。

旧图片保留原有图头与示例时间，未伪装成本轮全量重新生成。缺口页的局部纠偏另记于下文。前轮五张图的原始提示词未在本记录中重构。早期原件未删除或覆盖；窄屏资产未收录。

## V0.4 当前记录：统一完整桌面页面

修订授权：`0001789616427632-000054-84945b89`；裁决来源：`0001789615969247-000033-c69744e0`。仅通过原生 `image-generation` 编辑原三栏图的预览标题，不删除任何功能或改变页面结构。两种设备不再各自生成一套不同布局。

原始提示词：

```text
Use case: text-localization. Edit target: the supplied Traqen desktop UX screenshot. Make ONLY ONE exact text replacement in the dark preview strip across the very top: replace 'F002 UX v0.3 · 27英寸布局评审稿' with 'F002 UX v0.4 · 统一桌面页面'. Preserve everything else unchanged: full three inner columns (materials directory + reading panel + evidence inspector), sidebar, every tab, all controls, source code lines88-90, FACT-021/FACT-023, same-scope materials section, rule premise, IDs and source r8/f12, Chinese copy, panel positions, proportions and colors. This complete page is shared by14-inch laptop and27-inch desktop; they differ ONLY in display scale, never in functions, content, panel visibility or navigation. No laptop-only simplification, no collapsed directory, no adding or removing any UI. Keep the rightmost preview label '示例数据 · 非运行截图'. Same image size and crop. Do not invent additional text.
```

输入：`02-monitor-reading.png`。输出：`exec-faa2a08b-4dd0-4d2f-85fd-7466f6456c38.png`。归档：`08-unified-desktop-v0.4.png`。旧尺寸图仍保留；README 正文不再嵌入旧两栏图。


## V0.3 历史记录：14 英寸布局原始提示词（已被替代）

以下提示词只用于解释旧图为何收起目录，**不是当前设计规则，不应继续使用**。偏差根因是把显示尺寸适配误当成信息布局差异；当前标准是同一功能、同一内容、同一操作路径，只改变显示尺度。

```text
Use case: ui-mockup. Generate ONE polished desktop screenshot for Traqen F002 UX v0.3, not an infographic, physical laptop or collage. Input image is the exact approved STYLE reference: porcelain white, graphite typography, #F5F5F7 canvas, #EBEDF1 sidebar, white16px-radius cards, subtle dividers, restrained #0066CC blue, Chinese PingFang-like sans. Preserve Traqen branding and navigation: workspace 订单服务平台 / order-platform; 工作区概览 / 来源快照 / 技术证据 selected / 业务图谱 / 变更影响; bottom 设置中心, 帮助与快捷键, Sky. Top app breadcrumb 订单服务平台 > 技术证据; right 来源r8·已冻结 plus global search. Main H1 技术证据. Context 来源r8 | 当前事实集f12 | 范围：订单服务. Tabs 对象与事实 selected / 关系 / 覆盖与缺口 / 版本与交付. Quiet header button 取证请求.
Reading object OrderService.cancel, CODE-017 · Java方法. White main reader: path src/service/OrderService.java. A concise three-line source excerpt with exact PHYSICAL line numbers:
88 order.markCancelled();
89 inventory.release(order.getItems());
90 return repository.save(order);
Highlight ONLY89 pale blue. Include two fact rows: FACT-021 · 属性事实 · 方法名=cancel; FACT-023 · 关系事实 · 静态调用inventory.release, second selected. Fact origin “声明记录”, never business approval. Inspector heading 事实依据, selected FACT-023, direction OrderService.cancel → Inventory.release, location 来源r8 · L89, rule java-static/1.2, premise 静态符号已解析. Amber note 静态调用≠已执行. Blue primary 查看原文 and secondary 复制完整引用. Under reading area quiet “业务含义在业务图谱中另行分析与确认。” NO mobile patterns, no business classification, no fake successful live execution. All data is illustrative. Exact readable Simplified Chinese. One blue primary in active task. Do not spread paragraph lines across an ultrawide screen.
COMPACT LAPTOP LAYOUT. Wide 8:5 aspect ratio, target viewport1440x900. Thin dark preview strip “F002 UX v0.3 · 14英寸布局评审稿”, right “示例数据 · 非运行截图”. Global sidebar224px. Available content has ONLY TWO columns: large reader on left and approx300px evidence inspector on right. The MATERIAL DIRECTORY IS COLLAPSED, not an extra third inner column. Instead put a clearly visible “对象目录” outline button with folder icon immediately above reader next to small current path; a nearby subtle label “目录已收起”. Do not display a material tree in this scene. Generous working reader width and legible13-15px text; no miniature text to squeeze columns. Fit H1, source/fact context, tabs, code excerpt, facts and inspector main actions within the screen. Closing the inspector can restore directory; don't need to explain this in product copy. Show a close X on inspector. Keep code exactly aligned with evidence L89. No huge empty decorative spaces.
```

所选源文件：`exec-1fd17379-95d6-492a-b139-fc3a1387397c.png`。

## V0.3 历史记录：27 英寸布局原始提示词

```text
Use case: ui-mockup. Generate ONE polished desktop screenshot for Traqen F002 UX v0.3, not an infographic, physical laptop or collage. Input image is the exact approved STYLE reference: porcelain white, graphite typography, #F5F5F7 canvas, #EBEDF1 sidebar, white16px-radius cards, subtle dividers, restrained #0066CC blue, Chinese PingFang-like sans. Preserve Traqen branding and navigation: workspace 订单服务平台 / order-platform; 工作区概览 / 来源快照 / 技术证据 selected / 业务图谱 / 变更影响; bottom 设置中心, 帮助与快捷键, Sky. Top app breadcrumb 订单服务平台 > 技术证据; right 来源r8·已冻结 plus global search. Main H1 技术证据. Context 来源r8 | 当前事实集f12 | 范围：订单服务. Tabs 对象与事实 selected / 关系 / 覆盖与缺口 / 版本与交付. Quiet header button 取证请求.
Reading object OrderService.cancel, CODE-017 · Java方法. White main reader: path src/service/OrderService.java. A concise three-line source excerpt with exact PHYSICAL line numbers:
88 order.markCancelled();
89 inventory.release(order.getItems());
90 return repository.save(order);
Highlight ONLY89 pale blue. Include two fact rows: FACT-021 · 属性事实 · 方法名=cancel; FACT-023 · 关系事实 · 静态调用inventory.release, second selected. Fact origin “声明记录”, never business approval. Inspector heading 事实依据, selected FACT-023, direction OrderService.cancel → Inventory.release, location 来源r8 · L89, rule java-static/1.2, premise 静态符号已解析. Amber note 静态调用≠已执行. Blue primary 查看原文 and secondary 复制完整引用. Under reading area quiet “业务含义在业务图谱中另行分析与确认。” NO mobile patterns, no business classification, no fake successful live execution. All data is illustrative. Exact readable Simplified Chinese. One blue primary in active task. Do not spread paragraph lines across an ultrawide screen.
LARGE DESKTOP LAYOUT. Wide16:9 aspect ratio, aim output2560x1440. Thin dark preview strip “F002 UX v0.3 · 27英寸布局评审稿”, right “示例数据 · 非运行截图”. Global sidebar244px. Main working region centered inside remaining space and use max roughly1940px width. Three INNER columns fully visible: directory260px, comfortably wide reader, inspector344px, with24px gutters. Do NOT merely enlarge the laptop screenshot or font. Directoryheading 材料与对象; search框 搜索材料与符号. Tree: order-service > src/service > OrderService selectedblue, PaymentService; requirements > 订单需求.md, 运营流程.png withsmall 未提取; tests > 取消订单.spec.ts; config > application.yml. Footer “未提取材料也可从目录查看”. Reader body limitedcomfortableline lengths; source and facts remaincompact, extra width becomes breathing room. Under facts add modest section “当前对象的相关材料” with two rows 订单需求.md · 文档声明, 取消订单.spec.ts · 未关联执行, no asserted business equivalence. Rightinspector has closeX plus complete identity rows 工作区order-platform / 事实集f12 / 事实FACT-023. All source IDs consistent with reference. Workbench looks spacious yet professional, no charts or fakeKPIs to fill space.
```

初次生成文件：`exec-561cdd7c-b079-4bbc-9ba0-bf04b413b5a4.png`。该初稿没有收录为交付图：下方材料表写了“当前对象的相关材料”和未经证明的业务关系，超出 F002 证据边界。

## V0.3 历史记录：27 英寸布局定点纠偏

在保留布局与其他内容的前提下，只修正材料表标题和两条备注：

```text
Edit this existing Traqen desktop UX mockup with ONLY THREE exact Chinese text replacements in the small material table below the fact rows. Keep the entire visual layout, all other text, spacing, connectors, source code, panels and styles unchanged. (1) Replace section title “当前对象的相关材料” with “同一范围的材料”. (2) In the document row 订单需求.md, replace the note “与取消订单的业务需求相关” with “已登记文档”. (3) In the test row 取消订单.spec.ts replace note “相关测试用例（未进行执行关联）” with “已登记用例；未关联执行”. Do not imply verified business relationships. This is a precise text-only correction. Preserve Chinese readability and the original wide16:9 image.
```

最终选择：`exec-1df84093-b03f-4cfe-963a-be07d62efadd.png`，归档为 `02-monitor-reading.png`。修正后的表题为“同一范围的材料”；文档是“已登记文档”，测试是“已登记用例；未关联执行”。

## 缺口页的局部纠偏

前轮源文件 `exec-0c65ec7a-fa99-43da-80b0-b2250032d4d7.png` 保留。交付图更换为 `exec-03485967-09fb-4ccf-ae72-882481ad4da2.png`，仅修正限制示例与调查按钮：访问限制不计作提取 Gap；定向取证由 F003 调查发起。

```text
Precise edit of this existing Chinese Traqen UX screenshot. Preserve the entire layout, typography, all surrounding data, totals, sixGap count, colors and other text. Make ONLY these THREE text corrections: (1) In the fourth table row for 外部接口说明.pdf replace amber badge 访问受限 with 格式不支持. (2) In that same fourth row replace 查看权限说明 with 原文保留；未解析. (3) In the right detail panel, replace the secondary action 发起定向取证 with 返回业务调查. Keep primary 查看原图 unchanged. Reason: access denial must not be counted as extractionGap, and F003 investigation must be the entrypoint for a new evidence request. Do not insert any new graph, facts, panels or rows. Keep all Chinese characters crisp and exactly as specified.
```


## 使用边界

- 效果图用于评审布局、信息层级和交互状态，不承担像素级实现证明。
- 示例事实、规则、执行状态及时间均非生产数据。
- 原文位置 L89 与代码片段物理行号保持对应；不得把引用编号当作访问授权。
- 当前六张正文图以 [UX 评审稿](../../README.md) 的职责、完整页面与缩放规则为准；两张历史尺寸图不再承载当前规则。原材料读取接口、服务端协议和权限策略仍需后续联合设计。
