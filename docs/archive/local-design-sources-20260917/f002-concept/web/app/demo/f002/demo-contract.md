---
feature_ids: [F002]
topics: [concept-demo, evidence-graph]
doc_kind: demo-contract
created: 2026-09-07
---

# F002：从材料到可核验的事实

## 0–1. 契约与车道

- demo_kind: concept_story
- delivery_lane: internal_product_gate
- 目标观众/操作者/裁判：co-creator；自助点击与现场讲解。
- 主判断：F002 的出口是按 Workspace 和版本隔离、带证据和未知范围的事实数据集；F003 消费其受控视图，而不是绕回源文件。
- 复述句：我看到冻结的材料变成了可引用的事实，因为每条结论都保留了明确来源、规则和边界，无法确定的内容没有被猜成事实。
- 最小证据/灵魂帧：CODE-017 → FACT-023 → CFG-008，旁边同时显示源码证据、完整引用坐标以及 F003 输入预览。
- 非目标：真实解析器、OCR/LLM、后台运行、鉴权上线、图数据库选型、正式产品集成、业务分类、跨版本对比、编辑器、Workspace 主壳改造。
- visual_source_of_truth：当前 Traqen 本机 3000 页；web/app/globals.css 的 Enterprise Blue；现有 Card/CardHeader/CardBody、Button、Badge。基础提交 9980807。
- native_elements：复用真实组件与全局主题；仅渲染 feature surface，不复制完整主壳，不宣称挂载正式产品。
- stylized_elements：可隐藏的六步讲解控制条、固定样例关系布局。
- truth_label：常驻「概念演示 · 固定样例 · 未连接解析器 / Agent」；ID、内容和数量全是演示样例。
- skill 引用的 taste vignette 本机缺失；使用实际 Traqen 页面和组件作为视觉依据，不补造引用。

## 2–4. 视角、路径与边界

架构师是唯一视角。F001 合格冻结材料 → F002 确定规则 → 源对象/事实/证据/缺口 → 封存范围 → F003 按完整坐标检索。规则只识别明确结构，不把文档声明当实现、不把测试报告当验证、不把图片看起来相连当关系。

固定数据/定时换幕是概念编排。点击事实、筛选、切换样例、组装和下载输入是实际前端原型行为。原始证据本身也为人工编写的样例，绝非已扫描用户仓库的证据。所有操作仅在内存中；刷新重置，不承诺用户数据持久化。真实产品的数据持久化边界仍由既有 ADR 定义。

## 5–6. 场景

| 场景 | 主画面 | 新增概念 | 自动验证 |
|---|---|---|---|
| 1 材料已冻结 | 六类材料与定位 | F001 给定同一版本 | 六类样例无网络解析 |
| 2 事实成图 | 对象与带类型关系 | 结论和原始材料分开 | 引用闭合、类型明确 |
| 3 每条有依据 | 默认选 FACT-023 | 事实→证据→规则 | 切事实改变证据与定位 |
| 4 未知不猜测 | 图片与缺口 | 未解析不是不存在 | 缺口进入输出、图像不造语义边 |
| 5 编号不串项目 | 两 Workspace 同短号 | 完整坐标与范围校验 | 外部引用拒绝、切换重置包 |
| 6 交给 F003 | 可读与 JSON 输入 | 输出持久化数据集的受控视图 | 完整坐标、证据、缺口、封存检查 |

## 7–8. 控场与视觉

播放/暂停、前后、左右键、空格共用单一时间轴；每幕 14 秒，不自动开播；手动查证即暂停。输入控件中的键盘操作不推进幕。隐藏控制即暂停。桌面 1440×1000、窄屏 390×844。无 emoji、无随机计数、无虚假精度和置信度。

## 9. 验证

- 单测：`node --test web/tests/f002-demo.test.mjs`。
- 浏览器：`F002_PLAYWRIGHT_MODULE=/Volumes/WorkSSD/clowder-ai/node_modules/playwright/index.mjs node web/tests/f002-demo-browser.mjs`。
- 搜索 claim：语义 search input → 查询 state → DOM 中保留用户原文及零结果；陌生 sentinel `f002-unseen-<b>probe</b>` 不作为 HTML。
- 范围 claim：前端 fixture guard 拒绝错 Workspace/版本/缺失记录；不是后端安全验收。
- 封存 claim：模拟 scope 未终态禁用组包；终态 gaps 保留；一键复位后恢复。
- 下载 claim：下载 JSON 的包与可见 JSON 一致；无上传。
- 视觉逐幕截图、窄屏溢出、浏览器异常与播放暂停由浏览器脚本验证。
- 不宣称正式集成，不写 productIntegration / documentEditor 声明。

## 10. 完成边界

交付可运行的概念原型与测试证据；观众是否理解、方案是否确认，由 co-creator 看过后判断。不得把浏览器测试通过记为 F002 完成或设计批准。既有 Feature Spec、ADR、索引保持不变。
