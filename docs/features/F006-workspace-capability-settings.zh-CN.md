> 语言：**简体中文** · [English](F006-workspace-capability-settings.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [settings, workspace, cli, oauth, api-key, models, skills, mcp, agents, runtime-isolation, frontend]
doc_kind: spec
created: 2026-07-31
updated: 2026-08-28
description: 全局能力资产与 Workspace 范围内 Agent 配置，并通过草稿到生效版本固定运行快照。
description_source: human
description_author: cat-4v94tazw
description_updated_at: 2026-08-28T14:53:00Z
---

# F006：Workspace 能力设置

> **状态：** spec · **优先级：** P2 · **Owner：** TBD
> **产品真相：** 本文取代此前 F006 规范及其模板/覆盖模型。

## 1. 目的

Traqen 让管理员一次配置可复用的全局执行资产，再为每个 Workspace 配置明确的 Agent 团队和可用能力。配置必须可恢复、可解释、可持久化，且不能静默改变正在运行的分析。

F006 是设置功能，而不是 Agent Runtime：v1 使用已安装的模型 CLI，不实现自研 Agent 或直接 API 模型执行。

## 2. 产品模型与权威边界

三层范围刻意分离：

| 范围 | 管理什么 | 不决定什么 |
|---|---|---|
| 全局设置 | 账号、CLI 模型、Skill、MCP | 哪个 Workspace 或 Agent 可以使用该资产 |
| Workspace 设置 | 一个 Main、一个或多个 Child、Workspace 生效能力集 | 全局资产是否可用 |
| Agent 配置 | 单个 Agent 的模型和显式 Skill/MCP 授权 | Workspace 范围内的能力目录 |

可执行配置只能推导，不能猜测：

```text
Workspace 生效能力 = 全局 active 能力
                   − 本 Workspace 禁用能力
                   + Workspace 本地能力

Agent 实际能力 = Workspace 生效能力 ∩ Agent 显式授权
```

全局资产不会隐式授予 Agent。全局 inactive、删除或管理员置为不可用的 Skill/MCP 是上限，Workspace 不可重新启用。

## 3. 全局设置

设置中心包含 **账号**、**模型**、**Skill**、**MCP** 四个独立页面；桌面端共用左侧导航，窄屏使用紧凑导航。

### 3.1 账号与认证

认证只有两种：

1. **API Key：** 密钥只进入批准的 Secret Store；界面、API 响应、日志、版本、审计记录和运行快照只保存非敏感引用与状态。
2. **OAuth：** OAuth 属于已安装的 CLI 客户端。Traqen 只检测、展示本地登录状态；不执行 CLI 登录、不启动任意认证命令、不读取也不保存 Token。

OAuth CLI 未登录时，Traqen 显示管理员应在 CLI 自身完成登录的操作指引，完成后点击“重新检查状态”。检查成功前模型不可用。

### 3.2 模型

每个全局模型绑定受支持、白名单化的本地 CLI（如 Codex、Claude、Kimi）和一个账号，可选该客户端支持的模型选择。模型卡展示 CLI 安装、账号/认证就绪性和最近校验结果。

CLI Adapter 只能构造固定、白名单化的可执行文件与参数组合，严禁用户提供 Shell 字符串、插值或任意参数。只有 Ready 模型可被选择；系统没有全局 active/default 模型。

### 3.3 Skill 与 MCP

全局 Skill/MCP 是有独立身份、元数据、校验、生命周期及 active/inactive 状态的可复用资产。空状态是正常产品状态；v1 不伪造必须存在的内置清单。MCP 内的 API Key 只能是 Secret 引用，绝不能是 Manifest 明文。

## 4. Workspace 设置

### 4.1 Agent 团队

每个 Workspace 恰有一个不可删除的 **Main Agent**，以及至少一个 **Child Agent**。新建 Workspace 会明确显示未完成配置的 `Child 1`：它是必填占位，而非隐式可运行 Agent。第二个及之后的 Child 通过“添加 Child”显式创建。

每个 Agent 选择一个 Ready 的全局模型，并从 Workspace 生效能力集获取显式 Skill/MCP 授权。创建 Child 不得静默复制授权；复制模型也必须由用户确认。F006 的生效下限是一个 Child；未来分析策略可以针对某次运行要求更多独立 Child，但不改变设置层下限。

### 4.2 能力管理

Workspace 的“能力管理”只治理**可用性**；“Agent 设置”只治理**授权**。能力页分组显示：

1. 可用的全局继承能力；
2. 本 Workspace 禁用能力；
3. Workspace 本地能力；
4. **全局不可用 / 需要处理**能力。

第四组不得写成 Workspace 禁用，因为状态并非由该 Workspace 造成。每一项展示来源、健康度、生效状态及已授权 Agent 的只读摘要，并链接至 Agent 设置编辑授权。

Workspace 可以禁用继承能力或新增独立本地能力；v1 不可替换、同身份 fork 或字段级 patch 全局 Skill/MCP Manifest。这样可保持 Provenance 清晰，避免全局更新产生无法解释的合并结果。

### 4.3 草稿、生效与运行快照

编辑自动保存为可持久化的**草稿**，草稿可以不完整。“应用配置”会校验草稿并创建不可变的生效配置版本；只有生效版本可启动新运行。

启动运行时会记录生效配置、精确模型/能力 Provenance 及非敏感标识构成的不可变执行快照。首次运行或生效版本变更后，显示紧凑确认（Main 模型、Child 模型、能力数量、账号状态）；生效版本不变时重复启动不再打扰。运行中或暂停的分析绝不热切换到后续草稿/生效版本。

## 5. 停用与删除

全局停用或删除 Skill/MCP 前，Traqen 显示由服务端计算的影响预览：受影响 Workspace、Agent、生效配置及现有/未来运行。删除必须输入能力名称确认。

受影响 Workspace 进入“需要处理”，可移除授权、选择其他可用能力，或创建独立的 Workspace 本地替代。既有运行继续保留固定快照。只有生效配置仍授权了不可用能力时才阻断新运行；仅出现在目录但未授权的条目不得阻断运行。

## 6. 前端旅程

### 设置入口与范围定位

顶层“设置”进入范围选择器：**全局设置** 或带 Workspace 选择器的 **Workspace 设置**。Workspace 内的齿轮直接进入当前 Workspace。Header、面包屑、图标和文本始终明确范围；不得只靠颜色表达范围。

### Workspace 设置外壳

固定的就绪摘要展示 `Ready`、`Incomplete` 或 `Needs attention` 以及直接修复链接。包含两页：

- **Agent 设置：** 桌面端团队卡片/列表与持久详情检查器；小屏检查器变为全屏抽屉。
- **能力管理：** Skill/MCP 分段目录与只读的每个 Agent 授权摘要，跳转回 Agent 设置。

账号、模型、能力或 Agent 的对象级错误显示在相应卡片，也汇总到页面层。每个失败都说明下一动作；界面必须具备 loading、empty、error、recovery 状态，不能仅以颜色传达状态。

## 7. 安全与不变量

| ID | 不变量 |
|---|---|
| F006-INV-01 | API Key 永不越过 Secret 边界；OAuth Token 永不进入 Traqen。 |
| F006-INV-02 | CLI 调用是白名单化的，不接受用户提供的 Shell 命令。 |
| F006-INV-03 | 全局不可用能力不能被 Workspace 激活或授予。 |
| F006-INV-04 | Agent 授权必为 Workspace 生效能力集的子集。 |
| F006-INV-05 | 生效要求一个完整 Main 与至少一个完整 Child；草稿可以不完整。 |
| F006-INV-06 | 运行只消费其固定的生效快照，不消费可变的全局或 Workspace 状态。 |
| F006-INV-07 | 缺失全局资产只阻断仍实际授权它的生效配置。 |

## 8. 验收标准

### 全局资产

- **AC-A1：** UI 分离账号、模型、Skill、MCP，并具备正常的 empty 与 recovery 状态。
- **AC-A2：** 账号通过 Secret 引用支持 API Key、通过状态检测支持 CLI-owned OAuth；Traqen 不能发起或保存 OAuth 凭据。
- **AC-A3：** 模型是可复用的 CLI 全局资产，必须 Ready，不得成为全局默认模型。
- **AC-A4：** 全局 Skill/MCP active 状态是每个 Workspace 的可用性上限。

### Workspace 与 Agent

- **AC-B1：** Workspace 持久化恰一个 Main、默认未完成 Child 1 与任意新增 Child。
- **AC-B2：** Workspace 只能在一个完整 Main 和一个或多个完整 Child 时生效。
- **AC-B3：** Workspace 能禁用继承能力或创建独立本地能力，但不能覆盖/patch 全局 Manifest。
- **AC-B4：** 能力可用性与 Agent 授权在各自页面展示和编辑，并带来源摘要。
- **AC-B5：** 草稿自动保存；应用产生持久化生效版本；重新加载恢复草稿与生效 Head。

### 运行安全与体验

- **AC-C1：** 运行固定不可变、非敏感快照，后续编辑不影响该运行。
- **AC-C2：** 配置变更仅确认一次启动；生效版本不变时不重复提示。
- **AC-C3：** 全局删除展示影响、要求输入确认、保留现有运行，且只阻断仍授权不可用能力的新运行。

## 9. 与 F001 的关系

F001 消费 F006 发布的不可变生效执行快照。F001 可加入运行级冗余策略，但不能修改设置，也不能重定义 F006 的 Child 下限。

## 10. v1 明确不做

- 名为“CLI”的第三种认证方式；
- Traqen 发起 CLI OAuth 登录或处理 OAuth Token；
- 直接 API 模型执行；
- 自研 Agent；
- 项目替换或字段级合并全局 Skill/MCP Manifest；
- 让未授权能力进入 Runtime 发现或调用。
