---
feature_ids: [F006]
related_features: [F003, F005]
topics: [desktop-ux, settings, fixture-prototype, porcelain, graphite]
doc_kind: ux-effect-prototype
created: 2026-09-18
version: "1.0"
status: operator-review-pending-fixture-prototype
source_design: ../README.md
---

# F006 · 桌面双主题效果图与交互原型 V1.0

[返回 F006 功能与 UX 设计](../README.md) · [F005 整体布局与导航设计规范 V1.0](https://github.com/qianfengXY/Traqen/blob/f4df4bca5de81fe2af86e10db997c18dc3cbdc5d/docs/design/F005-layout-navigation/README.md) · [离线交互样稿](assets/prototype.html) · [作者验证记录](assets/verification.json)

这是 F006 设计文档 §10 的**待 operator 审查**效果图稿：一份可维护的、使用构造数据的离线 HTML 原型和实际浏览器渲染图片。它只验证视觉、交互示意与 fixture 控制流，**不是**生产前端接线、后端、CLI、凭据、MCP 或 F003 启动实现的完成声明，也不表示 operator 已批准或已合入。

## 先看 S04：同一团队，四张桌面视口图

四图保持同一团队数据、选中对象、“有未应用更改”状态和相对结构。以 1440×900 为逻辑母版：1440×900 为 1×；1920×1080 为 1.2×、左右余量 96px；2560×1440 为 1.6×、左右余量 128px。文字、控件、菜单、焦点与点击命中随同一倍率缩放。1400×860、1280×800 等小于母版的普通窗口保持 1×，以同一组件重排或滚动来保护可读性，不另造一套桌面设计。

| 14 英寸 · 1440×900 | 27 英寸 · 2560×1440 |
| --- | --- |
| [![瓷白 · 1440×900](assets/previews/04-team-laptop-light.png)](assets/previews/04-team-laptop-light.png) | [![瓷白 · 2560×1440](assets/previews/06-team-display-light.png)](assets/previews/06-team-display-light.png) |
| [![石墨 · 1440×900](assets/previews/05-team-laptop-dark.png)](assets/previews/05-team-laptop-dark.png) | [![石墨 · 2560×1440](assets/previews/07-team-display-dark.png)](assets/previews/07-team-display-dark.png) |

## Before / after

### 当前 main 的 before

![当前 main · 1440×900](assets/previews/00-before-current-main-1440x900.png)

这张图在 `c6acfe7` 的隔离前端宿主实际渲染，而不是沿用 `58113fe` 的历史截图。新宿主没有连接 Workspace 服务，因此停在“连接工作空间”页，无法在不启动产品 API、导入用户数据或伪造 Workspace 的前提下进入旧 F006 组件；它记录的是当前 main 的真实可达起点和该限制，不把它冒称为 F006 已配置页面。

### 调整的可观察点

| 对照维度 | Before 的真实可达状态 | 本交付的 F005 对齐效果 |
| --- | --- | --- |
| 入口与上下文 | 隔离宿主要求连接 Workspace，设置页不可达 | 左侧稳定导航、当前 Workspace、范围选择与草稿/生效摘要同屏可读 |
| 层级与密度 | 不能审阅 F006 的已配置态 | 32/40 页标题、13px 工作正文、24/32 区块间距，模型与状态不缩至微文字 |
| 团队任务 | 无法检查 Main / Child 配置 | 总览与详情并列，Main + 两个示例 Child 的角色、实际模型、账号与 Skill 授权分开表达 |
| 主题 | 不是 F006 双主题证据 | 完整瓷白/石墨 token；深色主要动作采用浅蓝底与深色字 |
| 保存与应用 | 没有可达的 F006 恢复状态 | 自动保存、草稿、生效版本与 Run 摘要不混同；冲突期间 Apply 阻断 |

## S01–S10 场景覆盖

| 场景 | 画面 / 交互证据 | 主题与视口 |
| --- | --- | --- |
| S01 范围与初始空态 | [真实团队配置面内的 Main + Child 1 空占位](assets/previews/01-empty-light.png) | 瓷白 · 1440×900 |
| S02 账号 | [瓷白：API 引用错误保留、OAuth 状态](assets/previews/02-accounts-light.png) / [石墨](assets/previews/02-accounts-dark.png) | 双主题 · 1440×900 |
| S03 模型与 Skill | [模型 · 瓷白](assets/previews/03-models-light.png) / [石墨](assets/previews/03-models-dark.png)；[Skill · 瓷白](assets/previews/03-skills-light.png) / [石墨](assets/previews/03-skills-dark.png) | 两个独立页面，均为双主题 · 1440×900 |
| S04 完整团队 | 上方四张主图；另有 [瓷白](assets/previews/18-team-laptop-bottom-light.png) / [石墨](assets/previews/19-team-laptop-bottom-dark.png) 的滚动到底部证据，1400×860 与 [1280×800](assets/previews/16-team-compact-light.png) 的 1×可读性检查，以及 [1920×1080](assets/previews/17-team-external-dark.png) 的 1.2×画布检查 | 双主题 · 一个逻辑画布、滚动与 4 个导出视口 |
| S05 能力管理 | [四分组与范围](assets/previews/08-capabilities-light.png)；[Child 1 详情内可撤销的 legacy-lint 历史授权](assets/previews/08-legacy-authorization-light.png) | 瓷白 · 1440×900 |
| S06 草稿冲突 | [团队详情内的恢复状态](assets/previews/09-conflict-light.png) / [石墨对照](assets/previews/10-conflict-dark.png)；技术写入证据仅在壳外 fixture 日志与验证记录中 | 双主题 · 1440×900 |
| S07 生命周期 | [已打开的名称确认弹窗 · 瓷白](assets/previews/11-lifecycle-confirm-light.png) / [石墨](assets/previews/12-lifecycle-confirm-dark.png) | 双主题 · 1440×900 |
| S08 MCP 暂停 | [瓷白：只读历史项与暂停边界](assets/previews/13-mcp-light.png) / [石墨](assets/previews/13-mcp-dark.png) | 双主题 · 1440×900 |
| S09 生效版本 | [草稿、Active、Run 版本分离](assets/previews/14-versions-light.png) | 瓷白 · 1440×900 |
| S10 F003 配置确认 | [明确未接线的确认示意](assets/previews/15-f003-dark.png) | 石墨 · 1440×900 |

错误表单（S02 与 S03 两个独立页面）、草稿恢复（S06）、**已打开的**命名确认弹窗（S07）与 MCP 暂停（S08）均有双主题浏览器截图。S06 的用户工作面只表达保留、更改与恢复选择；模拟请求版本和写入序列只留在壳外 fixture 证据中。

## 可操作范围与验证

`prototype.html` 的场景选择器、主题切换、Agent 选择、Child 2 模型编辑、409 恢复、生命周期确认/取消和 F003 提示均可操作。调试控制显式标注“设计演示数据”，位于产品壳外。

`render.mjs` 用一次性 loopback 静态服务器和临时 headless Chrome profile 生成图片，并写入 [verification.json](assets/verification.json)。本次作者验证结果：25 张截图、0 个浏览器页面错误，以及以下 14 项通过项：

1. S01–S10 渲染时都有一个页面 h1，页面与控件没有横向溢出。
2. S04 使用一个 1440×900 逻辑画布：1440×900 为 1×，1920×1080 为 1.2×且左右余量 96px，2560×1440 为 1.6×且左右余量 128px；1400×860 与 1280×800 的普通窗口保持 1×，不是第二套桌面设计。
3. 逻辑画布在 1920×1080 和 2560×1440 归一化后保持同一内容与相对布局；指针命中、焦点、导航和对话框随同一倍率缩放；1400×860 与 1280×800 均保留 13px 可读控件、可用主动作且没有水平裁切。
4. F005 AppShell 有图标导航、最近查看、帮助与账号脚；调试控制在产品壳外；Workspace 二级导航与“草稿已保存”在壳内可见，每张 Agent 卡的 Skill 数量均与其勾选授权一致。
5. S04 用文档滚动而非固定舞台裁切：滚轮和 End 键均可抵达最后一项 Skill 授权与帮助/账号脚，末项 checkbox 仍可点击。
6. 账号、模型、Skill 与 MCP 共用壳内全局二级导航；模型和 Skill 是可独立抵达的产品页。
7. S01 保持在 Agent 团队配置面，呈现 Main 与 Child 1 的真实空占位、零隐式模型/Skill 与不可用的 Apply。
8. 正常 S04 的所有 Agent 都为就绪且 Apply 可用；名单为 320px 逻辑宽度，Apply 邻近完整作用范围；legacy-lint 仅在独立的 Child 1 可撤销失效授权状态中显示。
9. 切主题与刷新都保留选中的 Child，且主题动作的模拟业务写入为零。
10. 修改 Child 2 只产生一次 fixture 草稿写入；Main 和另一 Workspace 的 sentinel 不变。
11. M2 409 → M3 本地编辑 → 重试依次得到 `M2(409)`、`M2(200)`、`M3(200)`，随后清除阻断横幅并回到可编辑、Apply 可用的团队页；采用服务器草稿会先明示丢弃 M3、清除冲突且不增加业务写入。
12. 生效版本面为只读，没有 Apply；从正常团队入口进入并返回后，保留 Child 2 选择和滚动位置、团队页仍可编辑，且全程零业务写入。
13. 取消生命周期确认会关闭具名弹窗、把焦点返还原操作行，并产生零 fixture 业务写入。
14. 原生 button/input/select/dialog 可获得键盘焦点；Escape 能关闭影响确认弹窗而不形成焦点陷阱。

复现（替换为本机 Chrome 绝对路径）：

```sh
node assets/verify-contract.mjs
node assets/render.mjs /absolute/path/to/Google\ Chrome
(cd assets && shasum -a 256 -c SHA256SUMS)
```

[SHA256SUMS](assets/SHA256SUMS) 绑定 `prototype.html` 与本次 25 张原型截图；before 图单独标识为当前 main 的隔离宿主证据，不与原型效果图混作同一渲染源。

## 明确限制

- 不修改 `web/app/f006-settings-center.tsx`、产品 API、后端、F001/F003、ADR 或 Feature 生命周期。
- 示例 Workspace、模型、账号、Skill、版本、影响列表和运行均为构造数据；不会读取或写入用户数据。
- 模拟事件日志仅证明原型的有界控制流，不能代替服务端的 409、持久化、权限或 activation 验收。
- S10 只表达 F003 应展示和确认 F006 已生效配置；不连接材料、不复活旧启动 API、不创建 Run，不代表 AC-C2 完成。
- 截图记录了视口、逻辑倍率、浏览器缩放与设备像素比；它不构成真实硬件显示、200%/400% 浏览器缩放、完整读屏或多浏览器的验收。
