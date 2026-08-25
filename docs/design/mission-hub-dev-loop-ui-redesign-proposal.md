---
feature_ids: [F007]
topics: [cat-cafe-integration, mission-hub, desktop-development-loop, ux-review]
doc_kind: note
created: 2026-08-19
updated: 2026-08-25
status: exploratory-input
provenance: migrated-from-clowder-ai-review-notes
---

# Mission Hub · 开发闭环（Traqen）前端整改方案 v1

> **归属与权威边界（2026-08-25）**：本文件是在 Traqen 项目语境中形成的 Cat Café 集成体验分析，现作为 F007 审计输入迁回 Traqen。它保留当时观察与提案，不是 Cat Café EXT-001 的实现权威；复用任何具体代码位置、状态名或行数前必须重新核对 Clowder AI 当前源码。EXT-001 的权威设计仍位于 Clowder AI 仓库的 `docs/design/EXT-001-chatgpt-desktop-development-loop.md`。

> 分析范围：`packages/web/src/app/mission-hub` → `MissionControlPage` → `ExternalProjectTab`（默认项目 Traqen）→「开发闭环」子页（`DesktopDevelopmentPanel` + `DesktopDevelopmentWorkflowGraph`）。本方案只做分析与规划，未改动任何代码。

---

## 一、整体逻辑梳理（现状）

### 1. 页面入口链路

`/mission-hub` 路由只是一层壳，直接渲染 `MissionControlPage`。页面顶层有一排 Tab：「功能列表」「依赖全景」+ 每个已导入的外部项目各占一个 Tab。外部项目 Tab 的默认选中逻辑写死了 `name === 'traqen'` 优先（`MissionControlPage.tsx:466`），所以进页面默认落在 Traqen。

选中 Traqen 后进入 `ExternalProjectTab`，它又有 9 个子 Tab：开发闭环、需求追踪、治理健康度、功能列表、派遣进展、風險預警、澄清队列、切片計劃、经验回流。「开发闭环」子 Tab 渲染 `DesktopDevelopmentPanel`。

### 2. 开发闭环的数据流

前端主要消费两个接口（`DesktopDevelopmentPanel.loadWorks`）：

| 接口 | 内容 |
|---|---|
| `GET .../development-loop/launch-states` | 每个 backlog 功能的启动状态（未启动 / 等待 Desktop / 开发中 / CatCafe 处理中 / 验收未通过 / 已完成）+ Desktop 窗口绑定信息 |
| `GET .../development-loop/works` | 每轮交付的 `DesktopDevelopmentResumePacket`：phase、workflowNodes、openFindings、nextLegalActions、SHA/分支等 |

后端 `desktop-development-loop-service.ts` 用一个纯推导函数把持久化状态映射为 phase 状态机，前端完全被动渲染，这个契约是干净的——**整改可以只动前端，不碰任何 API**。

### 3. 状态机（后端推导，前端展示）

```
入口A 方案新增/变更 ─┐
入口B 验收未通过返工 ─┴─→ awaiting_design_branch → ready_for_desktop → implementing
    → implementation_ready →(提交精确 commit)→ independent_review → cross_review → consensus
    → 清零门(handoff)：
        ├─ fix_required ──────────────→ 回到 implementing（修复循环）
        ├─ awaiting_architecture_decision → 用户裁决（保留方案 / 方案已更新）
        ├─ awaiting_review_continuation  → 达到 Review 轮次上限，等用户批准
        └─ 清零 → approved_for_merge → auto_merge_ready / awaiting_manual_merge_confirmation
    → merged → acceptance_pending → accepted（闭环结束）/ rejected（回入口B）
```

四类角色分工明确：ChatGPT Desktop（实现/合入）、Review 猫猫（三阶段检视）、CatCafe 协调器（清零门）、用户（入口、裁决、最终验收）。

### 4. 用户在此页可做的全部动作

启动开发闭环（在「功能列表」子 Tab）、配置项目共用方案分支、配置 Review 猫猫、再次触发当前节点（retry）、架构分歧裁决、批准继续 Review、授权共识提交、最终验收（通过/不通过）、开启新交付轮次、打开 Review 会话。

**关键观察：这个页面本质是一个"审批工作台"——用户 90% 的时间只关心"哪个功能现在卡在哪、哪里需要我拍板"。但现在的 UI 是"档案陈列室"的做法：把所有状态、所有元数据、完整流程图对每个功能全量摊开。丑的根源在信息架构，不只是样式。**

---

## 二、前端问题清单（按严重度排序）

### P0 · 信息架构问题

**1. 单屏信息过载，无渐进披露。** `DesktopDevelopmentPanel` 从上到下堆了：7 项绑定信息 `<dl>`（项目 ID、仓库、默认分支、合入方式、人工试点、Push/PR、协议版本）→ Review 猫配置块 → 每个功能一张大卡片（窗口绑定框 + 交付元信息 + 完整泳道图 + findings + 决策区 + 验收按钮）。泳道图 `DesktopDevelopmentWorkflowGraph` 有 5 条泳道 + 4 个 transition + SVG 返程轨道，单个功能展开就是两三屏；功能一多页面变成无限长卷轴，且泳道图默认全部展开（`collapsed` 初始为 `false`）。

**2. "需要我处理"的事项没有聚合。** `acceptancePending`、`architectureDecisionPending`、`reviewContinuationPending`、`consensus_ready` 这四类必须用户拍板的事，散落在各功能卡片深处，用户要滚动逐个找。作为审批工作台，这是最致命的缺陷。

**3. 开发者调试信息污染主视图。** SHA 前 12 位、绑定代次（bindingEpoch）、协议版本 `v2 · policy 7`、`chatRef` 全文 break-all 展示——这些是排障信息，不该和"当前停在哪"抢注意力。

**4. 右栏错位。** `ExternalProjectTab` 的右栏（300px）固定放 `NeedAuditFrame`（六问定位），它属于「需求追踪」语境，在「开发闭环」子 Tab 下仍然占着一栏，既无关又浪费横向空间。

### P1 · 视觉层级问题

**5. 字号全面塌缩，无视觉锚点。** 整个面板几乎只有两档：`text-xs`（12px）和 `text-micro`（更小），最大的标题也只是 `text-sm`。所有内容一样小、一样灰（`text-cafe-secondary` 占绝对多数），扫一眼找不到重点。项目里其实有一套很完整的 OKLCH token 体系（`theme-tokens.css` / `console-tokens.css`），但这个页面只用了最保守的一小撮。

**6. 卡片套卡片，边界糊掉。** `bg-card` 圆角卡里嵌 `bg-shell` 圆角块再嵌 `bg-card` 圆角框，三四层嵌套，加上圆角规格混用（`rounded-lg / xl / 2xl / [10px] / [18px] / full`），层次感靠背景色微差硬撑，看起来"糊成一团"。

**7. 状态表达弱。** 当前节点靠 `ring-2 + animate-pulse`，完成/阻塞靠 2px 小圆点和文字 chip；semantic 色（success/warning/info）只用在边框浅底上，没有一眼可辨的进度语言（如整行进度条、大号阶段标签）。

**8. 泳道图工程复杂度与观感不成正比。** 返程箭头用 `ResizeObserver` 实测 DOM 几何画 SVG 折线，挤在右侧 `pr-7` 的窄槽里，视觉上是两条不起眼的虚线；节点是 `<button>` 但样式不像可点；hover tooltip 和点击 inspector 两套重叠的详情机制。花了 1398 行代码，换来的可读性有限。

### P2 · 细节与一致性

**9. 文案简繁混排**：子 Tab「風險預警」「切片計劃」是繁体，其余是简体。

**10. 操作反馈原始**：所有操作结果共用一个 `status` 字符串渲染在面板底部 `<p>`，成功/失败无颜色区分，会被推到视野外；长文案（如验收未通过的多句提示）也塞在同一行。

**11. 按钮体系不统一**：主按钮 `bg-[var(--mc-accent)]`、次按钮 `bg-shell`/`bg-hover-bg` 混用，圆角、内边距各处不同，没有沉淀成组件。

**12. 移动端**：Review 三阶段横向 snap 滚动可用，但泳道图整体在窄屏上仍然过高；`sm:pr-7` 以下 SVG 返程轨道直接隐藏，返工路径信息丢失。

---

## 三、整改方案

### 设计原则

概览优先（默认只给"每个功能现在在哪一步"）、渐进披露（细节点开再看）、行动导向（需要用户拍板的事永远浮在最上面）、调试信息降级（SHA/代次收进详情层）。

### 方案 A（推荐）：信息架构重组 + 视觉重做

**A1. 顶部改为"项目绑定摘要条"。** 现在的 7 格 `<dl>` 压缩成一行：`仓库名 · 默认分支 · 合入方式 · Review 猫猫头像组`，右侧一个「详情/设置」按钮展开原有全部字段和 Review 猫配置。协议版本、试点计数只在展开态出现。

**A2. 新增"待你处理"队列置顶。** 聚合四类 pending 决策为卡片队列，每张卡：功能号 + 一句话说明 + 直接可点的动作按钮（验收通过/不通过、保持方案/方案已更新、批准继续、授权提交）。队列为空时显示一行"当前没有需要你处理的事项"。这一块的数据全部来自现有 works 字段，零后端改动。

**A3. 功能列表改为紧凑行 + 展开详情。** 每个功能默认一行（约 56px）：`featureId + 标题 | 阶段进度条（横向 6 段：入口→实现→Review→清零门→合入→验收）| 状态徽标 | 需处理红点`。点击行展开该功能的完整卡片（窗口绑定、泳道图、findings）。多功能时页面高度从 N×3 屏降到 N 行。

**A4. 泳道图改为两级展示。**
- 默认态：横向 Stepper（一行 6 个节点，当前节点放大高亮 + 一句话"当前停在：XX · 等待 XX"），修复循环和返工用节点上的小回环箭头图标 + tooltip 表达，删掉 SVG 实测返程轨道。
- 展开态：保留现有泳道图作为"完整视图"，但默认 `collapsed = true`，并把 hover tooltip 与 click inspector 合并成一套（只留点击固定的 inspector）。
- SHA、绑定代次、协议版本统一移入 inspector 的"精确版本"区。

**A5. 视觉系统整顿。**
- 字阶：面板标题 `text-base/semibold`，功能行标题 `text-sm`，正文 `text-xs`，`text-micro` 只允许出现在 meta 行；正文色用 `text-cafe`，`text-cafe-secondary` 只给 meta。
- 容器：最多两层背景嵌套（面板 `card-bg` → 内容块 `shell-bg`），统一圆角两档（外 12px、内 8px），抽成 `Panel / SubCard` 小组件。
- 状态语言：阶段进度条直接用 semantic 色块（completed=success、active=accent 填充+脉冲、blocked=warning、pending=灰），一眼可读；状态徽标统一为一个 `PhaseBadge` 组件。
- 按钮：沉淀 `PrimaryButton / SecondaryButton / GhostButton` 三档，全面板统一。

**A6. 操作反馈。** `status` 字符串改为带 severity 的 inline Alert（success/error 两色，可关闭），出现在触发动作的就近位置（如验收按钮下方），不再沉底。

**A7. 一致性清理。** 子 Tab 文案统一简体（風險預警→风险预警、切片計劃→切片计划）；「开发闭环」子 Tab 下右栏不再渲染 `NeedAuditFrame`，让主区吃满宽度（或右栏改放"待你处理"队列）。

### 方案 B（保守）：只做视觉层修复

不动信息架构，仅执行 A5 + A6 + A7 + 泳道图默认收起。工作量约为方案 A 的 1/3，但"找不到需要拍板的事"这个核心痛点仍在。**不推荐单独采用，可作为方案 A 的第一个落地批次。**

---

## 四、落地拆分（建议按此顺序，每步可独立合入）

| 批次 | 内容 | 主要涉及文件 | 风险 |
|---|---|---|---|
| 1 | 视觉基线：字阶/容器/按钮/圆角统一，泳道图默认收起，简繁修正 | `DesktopDevelopmentPanel.tsx`、`DesktopDevelopmentWorkflowGraph.tsx`、`ExternalProjectTab.tsx` | 低，纯样式 |
| 2 | 绑定摘要条 + 调试信息降级 | `DesktopDevelopmentPanel.tsx`（顶部拆出 `BindingSummaryBar` 组件） | 低 |
| 3 | "待你处理"队列 | 新组件 `PendingDecisionQueue.tsx`，动作复用面板现有 handler | 中，需保证与卡片内按钮状态互斥（复用 `reviewDecisionKey` 等现有锁） |
| 4 | 功能行折叠 + 横向 Stepper | 新组件 `WorkflowStepper.tsx`；`DesktopDevelopmentWorkflowGraph` 降级为展开态视图 | 中 |
| 5 | 布局：开发闭环子 Tab 收起右栏 | `ExternalProjectTab.tsx` | 低 |

**约束与验收标准**：不改任何 API 契约与后端代码；保留全部 `data-testid`（`__tests__/desktop-development-workflow-graph.test.tsx` 等现有测试要么保持通过，要么同步最小修改）；保留现有 a11y 语义（aria-current/aria-expanded/dialog）；单功能默认高度 ≤ 一行，3 个功能的项目首屏能看到全部功能状态 + 待处理队列；所有用户决策入口在首屏可达。

---

## 五、待确认的问题

1. 泳道图完整视图是否必须保留？若日常几乎只看 Stepper，可以把完整泳道图降级为一个"查看完整流程"弹层，进一步减代码。
2. "待你处理"队列放主区顶部，还是常驻右栏（替换 NeedAuditFrame 的位置）？
3. 绑定信息里"人工试点 x/2 + 启用自动合入"这个引导流程还在用吗？若 Traqen 已过试点期，可整体收进设置弹层。
