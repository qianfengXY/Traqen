---
feature_ids: [F001]
topics: [source-truth, journey, frontend-design]
doc_kind: design-contract
created: 2026-09-06
status: draft
---

# F001 八站逐页设计：演示契约

上级：[中文方案](README.zh-CN.md#101-八站逐节点界面与流转) · [English](README.md#101-eight-station-screens-and-transitions)

本轮由 co-creator 在 thread_mtdpfw4ft7ngbi5f 消息 0001788654871677-000032-ebe8af79 授权细化八个节点。目标是审核每站界面及节点之间的因果；F005 独立拥有全局导航。

## 判题与视觉来源

- demo_kind: journey_validation
- delivery_lane: internal_product_gate
- 观众与裁决：co-creator 判断是否看得懂当前站、需要做的动作、自动流转门槛和失败恢复位置。
- 画面层级：一个 F001 feature surface；不声称已挂载正式产品或提供多对象 Workspace。
- visual_source_of_truth：已确认的 assets/source-truth-snapshot-workbench-v2-zh-CN.html 与其采集中截图。
- native_elements：沿用其 Traqen 标识、侧栏上下文、浅色 token、八站地铁图、主操作区、上一站证据、下一站条件。
- stylized_elements：底部“设计稿控制”可跳看预设画面、播放/暂停系统步骤、注入失败、重置示例；可隐藏。它不属于产品按钮，不构成准入证据。
- truth_label：全程标注“交互设计稿 · 演示数据 · 无上传或后端连接”。
- 信号路径：选择示例来源 → 确认范围 → 模拟预检/枚举/冻结清单/采集 → 人工处置示例 Gap → 模拟原子冻结 → 示例 Receipt。
- 灵魂画面：第 5 站同时给出 Git/目录的固定清单、完整枚举结果和下一站分母；第 6 站沿用相同总数，缺失项仍在分母内。
- 非目标：真实仓库访问、真实上传/哈希/性能测量、F002–F004 分析、F005 导航、产品实现或上线授权。

## Journey ledger

| 站点 | 状态拥有者（目标产品） | 进入/离开事件 | 用户与屏幕 | 失败与恢复 |
| --- | --- | --- | --- | --- |
| 1 添加来源 | Workspace 来源登记 / 上传选择 | 至少一个来源已选择 → 2 | 两个独立输入；目录选择在原型中明确载入示例 | 未选择时继续禁用；真实目录字节不被读取 |
| 2 配置范围 | 待开始的 SourceCaptureRun | 确认来源、Git 版本和全仓/目录根 → 3 | 全量/增量由系统判断；列出两条来源及基线 | 编辑返回 1；当前执行开始后锁定输入 |
| 3 自动预检 | SourcePreflightReport | 模拟检查通过 → 自动进入 4 | 权限/身份/声明范围/安全检查逐项出现 | blocker 停在 3；编辑来源/范围后重新预检；无接受绕过 |
| 4 枚举材料 | SourceCaptureRun | 所选范围枚举闭合 → 自动进入 5 | 仅显示已发现数，无总数、百分比和 ETA | 失败不能将部分枚举当完整输入；本演示用取消展示未完成终止 |
| 5 冻结清单 | SourceManifest | 清单身份与范围固定 → 自动进入 6 | 固定总数、组件身份、全量/增量计划；仍无 sealed 来源包 | 输入变化需新尝试；不能凭文件数签发 Receipt |
| 6 采集与校验 | SourceCaptureRun / 私有 checkpoint | 所有清单项均有终态处置 → 自动进入 7 | 内容已验证、明确缺失与待处理分开显示 | 可重试失败创建新 run、沿已验证 checkpoint 继续；seal 前可取消 |
| 7 核对清单与缺口 | ArtifactInventory / GapAcceptance | 无 blocker；全部非阻断 Gap 已明确接受 → 用户点击冻结进入 8 | 每项理由、责任人、有效期；接受仍有橙色限制 | 未处置无法冻结；返回修复新建尝试；Gap 不因接受消失 |
| 8 冻结来源包 | SourceBundleSnapshot / SourceTruthReceipt | 模拟原子最终化 → 同站展示冻结完成 | 执行中无 Receipt/下游入口；完成后才显示身份和 inherited Gap | 最终化期间不取消；失败不得暴露半包；本演示验证未完成时无 Receipt |

## 示例一致性

组合场景声明 100,000 个文件条目：Git 50,000，目录 50,000。目录文件全部验证。Git 有两个不可得的 LFS 内容条目，对应两个策略允许接受的非阻断 Gap。结果为 99,998 内容已验证 + 2 明确缺失 = 100,000 终态处置。Gap 数与文件数是不同维度，分别展示。

仅 Git 为 50,000 项、两个 Gap；仅目录为 50,000 项且无 Gap。增量场景仍完整枚举：Git 新增 12 / 修改 23 / 删除 12；目录新增 4 / 修改 6 / 删除 4，未变化内容复用。这个示例的新增与删除数相等，因此基线与新版都保持各 50,000 项；不代表实际变更的数量总是相等。演示数字仅表达计数关系，不代表性能或真实材料。所有身份带 demo 前缀。

## 交互与证据

Git 地址、ref、目录示例名、范围、Gap 理由和日期采用真实表单控件。提交后输入保留到当前摘要和示例 Receipt。按 Tab/Enter 可操作；完成站打开证据，未来站仅打开条件说明；回看不改变当前站。底部跳站显式载入演示 fixture，与业务继续按钮分开。

自动阶段可由讲者暂停，暂停期间所有计数和站点固定。默认主线会在第 1、2、7 站等待用户；第 3、4、5、6、8 站通过定时模拟自动流转。自动播放不替用户接受 Gap。左右键只在设计稿控制上下文跳看，空格在非输入控件处暂停系统模拟。

仅保存当前浏览器 tab 的模拟草稿到 sessionStorage；刷新恢复相同演示输入和站点，并暂停便于核对。不保存文件内容或真实上传资格。重新载入 fixture 是重置演示，不改变真实历史。

验证脚本见 verify-journey-demo.mjs。以项目已安装的 Playwright 模块运行：
`F001_PLAYWRIGHT_MODULE=<playwright/index.mjs> node feature-discussions/2026-08-30-F001-workspace-source-truth-design/verify-journey-demo.mjs`

脚本以陌生来源名/ref/Gap 理由走主线，检查门禁、刷新恢复、未来站不推进、暂停、blocker、重试新 run、取消和单来源无 Gap 路径；另外渲染各节点/异常态并检查桌面与窄屏溢出，以及窄屏当前站与站次计数保持可见。

## 审核边界

可验证的是浏览器原型的输入、状态、计数关系、按钮门槛与恢复演示。真实授权、Git object 权威、哈希校验、原子持久化和 10 万文件吞吐仍需产品实现与参考仓库验收。本轮供 operator 审核逐站交互，不标记 F001 实现完成。

## 本轮验证记录

2026-09-06：上述浏览器验证脚本执行退出码 0，输出 `ALL CHECKS PASSED`。生成 12 张桌面稿和 1 张窄屏稿；无浏览器运行错误、无网络读取或上传。两份 README 的八站结构与 13 张图片链接一致，所有本节相对链接存在。窄屏当前站及站次计数不可见的问题先得到复现，再通过专门断言验证修正。该结果仅证明设计原型，不替代产品验收或 operator 的交互方案确认。
