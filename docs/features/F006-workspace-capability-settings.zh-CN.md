> 语言：**简体中文** · [English](F006-workspace-capability-settings.md)

---
feature_ids: [F006]
related_features: [F001]
topics: [settings, global-model-registry, cli-model-runtime, skills, mcp, project-capabilities, runtime-isolation, persistence, frontend, user-journey]
doc_kind: spec
created: 2026-07-31
updated: 2026-08-11
---

# F006：Workspace 能力设置

> **Status**: spec | **Owner**: TBD | **Priority**: P0

## Why

模型、Skill、MCP、依赖知识和项目规范会显著改变分析质量。一个全局 Active Model 与全局挂载工具既无法表达某个 Workspace 的执行策略，也无法防止能力泄漏到其他 Workspace。

operator 必须能够一次配置 Workspace，重新打开时无需重复配置，并且之后仍可持续修改。同时，每次正在运行的分析必须可解释：设置变化不能静默替换该 Run 已经固定的模型或能力集合。

## 范围与权威边界

F006 定义四类协同权威，不再提供可编辑的全局模板层：

1. 支持 API 与受控本机 CLI 执行的全局可复用模型 Profile Registry；
2. 只读的内置 Skill/MCP Catalog，两类目录都允许零条目；
3. 每个 Workspace 一份持久化的项目能力注册表与禁用键集合；
4. 每个 Workspace 一份可编辑 Draft Head，通过校验后生成不可变 Execution Profile Revision。

Workspace 就是项目 Scope。系统不存在全局 Active Model、可编辑 Role Template、隐式能力继承或 Runtime 回退到全局 Registry 的通路。

## 全局模型库

模型是全局可复用的连接资产。Workspace Agent 槽位必须显式引用模型；模型不是 Skill/MCP Catalog 条目，也不会复制到每个 Workspace。

```ts
type GlobalModelProfile = {
  id: string;
  displayName: string;
  transport: "API" | "CLI";
  readiness: "UNVERIFIED" | "READY" | "ERROR";
  lifecycle: "ACTIVE" | "RETIRING" | "RETIRED";
  currentRevisionId: string;
};

type GlobalModelProfileRevision =
  | {
      id: string;
      profileId: string;
      transport: "API";
      providerAdapter: string;
      endpoint: string;
      model: string;
      credentialHandleId: string;
      createdAt: string;
    }
  | {
      id: string;
      profileId: string;
      transport: "CLI";
      cliAdapter: "CODEX" | "CLAUDE" | "GEMINI" | "KIMI";
      model?: string;
      executablePath?: string;
      createdAt: string;
    };
```

- API 模式记录显示名称、Provider Adapter、Endpoint、Model 和加密 Credential Handle。
- CLI 模式通过 Allowlist Adapter 使用本机 CLI 已有的登录状态执行。
- CLI Adapter 直接构造 argv；禁止用户填写 Shell 命令、Shell 插值和任意参数字符串。
- Verify 对 API Profile 检查 Endpoint/认证，对 CLI Profile 检查可执行文件、登录状态和模型可用性。
- 修改 Profile 会创建新的不可变 Revision。既有 Execution Profile 与 Run 继续固定旧 Revision，直到某个 Workspace 显式校验并激活新配置。
- 连接 Ready 只证明传输可用，不证明该模型适合所有分析角色或已经完成能力校准。

## Workspace Skill 与 MCP 来源

只有 Skill 和 MCP 进入能力 Catalog。

### 内置 Catalog

- 内置 Skill 与 MCP Catalog 是只读产品输入。
- 本版定义 Catalog 和解析机制，但不规定具体内置清单，也不添加占位条目。
- 任一 Catalog 都允许为空，并提供正常空状态。

### 项目能力

- 每个 Workspace 拥有持久化的项目 Skill/MCP 注册表。
- operator 可以显式新增、编辑、删除能力，或从已授权项目路径导入能力。
- Traqen 为每个导入或编辑条目保存不可变 Artifact Revision 与内容 Digest。
- Traqen 不会静默扫描项目并改变当前设置，也不会因为配置操作而改写用户仓库。
- 项目 MCP 定义可以引用 Credential Handle；明文凭据不能进入 Manifest 或 Artifact Revision。

### Typed Identity、覆盖与禁用

```ts
type CapabilityKey = {
  kind: "SKILL" | "MCP";
  normalizedName: string;
};

type WorkspaceCapabilityCatalogState = {
  projectCapabilityRevisionIds: string[];
  disabledKeys: CapabilityKey[];
};
```

解析顺序固定且确定：

```text
merged = overlayByTypedKey(builtinCatalog, projectCatalog)
effective = merged - disabledKeys
agentCapabilities = effective intersect agentGrants
```

1. `kind` 属于身份，因此同名 Skill 与 MCP 可以共存。
2. 项目条目完整替换相同 Typed Key 的内置条目，不做字段深层合并。
3. 禁用发生在覆盖之后，因此内置、项目新增和项目覆盖都能禁用。
4. 禁用项目覆盖项时，不得暴露或回退到被覆盖的内置条目。
5. 删除项目覆盖后，只有 Typed Key 未禁用时才重新显示内置条目；禁用状态一直保留到 operator 显式启用。
6. 未授权或已禁用能力不会出现在 Agent 选择器、Execution Profile、Runtime Discovery 或 Runtime Invocation 中。

后端 Resolver 返回 Effective Catalog 与来源感知数量：

```ts
type EffectiveCatalogSummary = {
  builtinCount: number;
  projectOverrideCount: number;
  projectAdditionCount: number;
  disabledCount: number;
  effectiveCount: number;
};
```

Web Client 只展示这些结果，不重新实现数量或覆盖算法。

## Workspace Agent Roster

```ts
type AgentSlot = {
  id: string;
  role: "MAIN" | "CHILD";
  displayName: string;
  modelProfileId: string;
  skillGrants: CapabilityKey[];
  mcpGrants: CapabilityKey[];
  independenceGroup: string;
  enabled: boolean;
};

type WorkspaceCapabilityDraftRevision = {
  id: string;
  workspaceId: string;
  revision: number;
  mainAgentSlot: AgentSlot;
  childAgentSlots: AgentSlot[];
  projectCapabilityRevisionIds: string[];
  disabledKeys: CapabilityKey[];
  dependencyPolicyRevisionId: string;
  conventionRevisionId: string;
  securityPolicyRevisionId: string;
  createdAt: string;
};
```

- 一个 Workspace 恰好有一个 Main 槽位，并至少有两个已启用且配置完整的 Child 槽位。
- 领域模型、API 与 Web Client 共同守住两个 Child 的硬下限；可以继续增加 Child，不设固定产品上限。
- Main 和每个 Child 分别选择一个 `READY` 的全局模型 Profile，并独立配置 Skill、MCP、Role Policy 与 Independence Group。
- 新 Workspace 创建一个空 Main 槽位和两个空 Child 槽位，不导入 Role Template。
- 不完整或无效 Draft 可以持久化，但不能成为 Active Execution Profile。

## 持久化、激活与 Run 固定

可编辑设置与不可变运行输入分离：

```text
WorkspaceCapabilityDraftRevision
        | Save：始终持久化
        v
校验当前全局模型 Revision + Effective Capability + Policy
        | Activate：仅校验通过后执行
        v
WorkspaceExecutionProfileRevision
        | Run 启动时选择
        v
AnalysisRun.pinnedProfileRevisionId
```

- 每次保存都创建不可变 Draft Revision，并通过 ETag/版本号 CAS 推进 `WorkspaceCapabilityHead`。
- 校验失败不能丢弃用户输入；字段级失败会继续附着在已保存 Draft 上。
- 激活会创建新的不可变 `WorkspaceExecutionProfileRevision`，记录精确模型、Skill、MCP、Policy、Convention、Dependency、Catalog Provenance 与 Digest。
- 分析启动以后，Workspace 仍可继续编辑并激活新 Revision。
- 正在运行或暂停的 Run 始终固定启动时选择的 Revision；Resume 不能选择更新后的设置。
- 新建 Run 使用 Workspace 当前 Active Profile Revision。
- 如果要让进行中的工作使用新设置，operator 必须取消该 Run，再启动新 Run；禁止在 Run 内热切换模型或能力。
- 服务重启、浏览器刷新、页面导航和 Workspace 切换都是只读恢复路径，必须从持久层恢复当前 Draft Head、Active Profile Head、历史和 Run 固定关系。

## 模型替换与退役

删除正在被引用的全局模型必须走依赖感知的退役流程。

1. Usage Preview 列出所有当前 Workspace 引用，包括 Main、全部 Child、Draft Head、Active Profile Head 和 Active Run。
2. operator 选择一个 `READY` 的替代 Profile。
3. 服务端创建 `ModelReplacementPlan`，固定所有受影响 Workspace 的版本；影响范围由服务端计算。
4. UI 不提供 Workspace 勾选框，Apply API 也不接受 `workspaceIds`。
5. Apply 在一个事务中为所有受影响 Workspace 创建并激活替代 Revision。
6. 任一 Workspace 并发变化或替代 Profile 校验失败时，整个事务回滚并要求刷新 Preview。
7. 成功后，所有当前 Workspace 配置对旧 Profile 的引用数必须为零。
8. 旧 Profile 进入 `RETIRING` 并从新配置选择器中消失；历史 Revision 不改写。
9. Active Run 继续使用固定的旧 Model Revision 和 Scoped Secret Grant，直到完成或取消；之后 Profile 才能进入 `RETIRED`。

紧急撤销凭据是单独的显式操作。它必须列出会失败的 Active Run，不能伪装成普通模型删除。

## User Journey

### 主旅程：配置并分析一个 Workspace

**Scope unit：** 一个 Workspace，对应一个项目。

1. operator 打开全局设置，新增 API 或受支持的本机 CLI 模型 Profile，并完成验证。
2. operator 打开 Workspace 设置页；之前保存的 Draft 与 Active Revision 自动恢复。
3. operator 在 Skill/MCP 中查看内置、项目和生效 Catalog，新增或导入项目条目，并禁用不需要的内置或项目能力。
4. operator 在 Agents 中配置一个 Main 和至少两个 Child，为每个槽位显式选择模型与 Effective Capability Grant。
5. operator 记录依赖、约定、安全边界、预算与 Policy。
6. “保存 Draft”持久化所有输入；“验证并激活”展示解析 Diff，并且只在全部校验通过后创建新的不可变 Profile。
7. 新 Analysis Run 固定该 Active Profile。重新打开 Workspace 时无需重新配置。
8. operator 之后仍可以修改并激活新 Revision；旧 Run 继续使用原 Revision，后续 Run 使用新 Revision。

### 支撑旅程：替换正在被引用的模型

1. operator 请求删除一个全局模型 Profile。
2. Impact Drawer 列出全部受影响 Workspace、Main/Child 槽位、当前 Profile 与 Active Run。
3. operator 选择一个替代 Profile，并确认一次覆盖全部 Workspace 的操作。
4. 服务端要么替换并激活所有当前引用，要么一个也不改变。
5. 旧 Profile 进入退役流程，不改写历史 Revision 或 Active Run。

## 前端产品体验

### 全局设置：模型库

模型列表展示显示名称、API/CLI Transport、Adapter、Model、Readiness、Lifecycle、使用数量、Verify、Edit 与 Delete/Retire。API Form 接收 Endpoint、Model 和 Token；Token 进入 Credential Handle 后绝不返回。CLI Form 选择 Allowlist Adapter 和可选 Executable Path，不接受任意命令字符串。

删除影响抽屉展示全部 Workspace/Slot 引用、替代模型选择、原子性提示、Active Run 行为，以及阻断性的校验或并发错误。

### Workspace 设置

新版页面替换现有模板入口，不与旧模板 UI 并存。页面包含：

- **Agents：** 一个 Main 卡片和至少两个 Child 卡片，使用结构化模型与能力选择器；
- **Skills：** 内置、项目、生效视图，展示来源、覆盖/新增、禁用、校验和被哪些 Agent 使用；
- **MCP：** 同样的三个视图，并展示 Transport、Permission、Credential Handle 状态与健康；
- **依赖与约定：** 项目知识、约束及其 Revision；
- **安全与边界：** 数据类别、预算、Permission、Secret Grant 与 Telemetry Policy；
- **Revision 历史：** Draft/Execution Revision、Diff、Digest、创建者、校验结果和固定到 Revision 的 Run。

桌面端使用 Section Navigation 和 Summary/Diff 侧栏。窄屏与移动端退化为设置分区列表，再进入单一分区，并保留 Sticky Validation/Action Summary。结构化选择器替换逗号分隔的能力输入框。

### 现场状态与恢复

- Model Verify 状态显示在模型行，以及所有引用它的 Agent Selector 上。
- Capability 校验、禁用状态和来源显示在 Capability Row 与受影响 Agent Card 上，而不是只放到汇总 Dashboard。
- Dirty 或 Invalid Draft 保留用户输入并显示准确阻断字段。
- Save Conflict 保留本地 Draft，并在显式重试前与更新的 Workspace Head 对比。
- Active Run 同时显示它固定的旧 Revision 与新的 Active Revision，使 operator 理解为什么当前执行没有变化。
- 等价的重复校验错误按 Typed Key 与 Reason 聚合；Revision History 是深度审计入口。

## 后端与 API 合同

持久对象包括 `GlobalModelProfileRevision`、加密 `CredentialHandle`、`ProjectCapabilityRevision`、`WorkspaceCapabilityDraftRevision`、`WorkspaceCapabilityHead`、`WorkspaceExecutionProfileRevision` 与 `ModelReplacementPlan`。

```http
GET    /v1/global-models
POST   /v1/global-models
GET    /v1/global-models/{modelId}
PUT    /v1/global-models/{modelId}
POST   /v1/global-models/{modelId}/verify
GET    /v1/global-models/{modelId}/usage
POST   /v1/global-models/{modelId}/replacement-plans
POST   /v1/global-models/{modelId}/replacement-plans/{planId}/apply
POST   /v1/global-models/{modelId}/retire

GET    /v1/workspaces/{workspaceId}/project-capabilities
POST   /v1/workspaces/{workspaceId}/project-capabilities
PUT    /v1/workspaces/{workspaceId}/project-capabilities/{kind}/{name}
DELETE /v1/workspaces/{workspaceId}/project-capabilities/{kind}/{name}
GET    /v1/workspaces/{workspaceId}/capabilities/effective

GET    /v1/workspaces/{workspaceId}/capability-draft
PUT    /v1/workspaces/{workspaceId}/capability-draft
POST   /v1/workspaces/{workspaceId}/capability-draft/validate
POST   /v1/workspaces/{workspaceId}/capability-draft/activate
```

所有 Workspace 写操作都要求 Workspace Scope、授权与 Expected-version CAS。Capability Path 同时携带 `kind` 和规范化 `name`。Replacement Apply 只接受 Plan ID 与 Expected Plan Version，不接受客户端指定的 Workspace 子集。

## 安全边界

- 明文 API Token 和 MCP Secret 只存在于 Secret Ingress Boundary 与加密 Secret Store。
- Form、普通配置记录、API Response、Diff、Prompt、Execution Profile、Telemetry、Diagnostic 和 Log 都不能出现明文 Secret。
- CLI 通过直接 Spawn、Adapter 生成 argv、有界 Timeout/Output、Cancel 与 Process-tree Cleanup 执行；禁止 Shell 插值。
- Runtime 只接收固定的 Execution Profile、最小权限 Run/Slot Secret Grant 与有界源码/工具 Handle，不能拿到可变全局 Registry Handle。
- 跨 Workspace 的能力读取、Grant 使用、Revision 读取和模型替换全部拒绝并留审计记录。

## 验收标准

### 模型库

- [ ] API 与受支持本机 CLI Profile 可以持久化、验证、修订并由 Agent 槽位显式选择。
- [ ] CLI 测试覆盖参数注入、Timeout、Cancel、Output Limit 和 Process-tree Cleanup，且不调用 Shell。
- [ ] 系统不存在能启动 Run 的全局 Active Model 或隐式 Fallback Model。
- [ ] 配置、API Response、Diff、Log、Prompt、Telemetry 和 Revision 均不包含明文凭据。

### 能力解析

- [ ] 同名 Skill 与 MCP 可以共存并独立配置。
- [ ] 项目条目完整覆盖相同 Typed Key 的内置条目；删除覆盖后，仅在未禁用时恢复内置条目。
- [ ] 内置条目、项目新增和项目覆盖均可禁用及重新启用。
- [ ] 禁用项目覆盖项时不能回退内置条目。
- [ ] Effective Count 区分项目覆盖与项目新增，并由后端 Resolver 返回。
- [ ] 已禁用和未授权条目不出现在选择器、Execution Profile、Runtime Discovery 或 Invocation 中。

### Roster、持久化与 Revision

- [ ] 激活 Profile 必须恰好有一个 Main 和至少两个已启用且完整的 Child；领域、API 与 Web 负向测试拒绝少于两个 Child。
- [ ] Main 与每个 Child 可以选择不同的已验证模型、Skill 和 MCP。
- [ ] Invalid Draft 带字段级校验持久保存，并在服务重启、浏览器刷新和 Workspace 切换后恢复。
- [ ] 激活 Valid Draft 会创建新的不可变 Execution Profile，不修改之前的 Draft 或 Profile Revision。
- [ ] Active/Paused Run 在设置变化与 Resume 后仍固定原 Profile；后续 Run 使用新的 Active Revision。
- [ ] Runtime 无法发现固定 Profile 中不存在的全局或项目能力。

### 模型替换与退役

- [ ] Usage Preview 列出所有当前 Workspace、Agent Slot 引用及 Active Run。
- [ ] UI 与 API 都不存在“部分 Workspace”替换模式。
- [ ] 任一版本冲突或校验失败都会回滚全部 Workspace 改动。
- [ ] 成功替换后所有当前 Workspace 对旧模型的引用数为零。
- [ ] 普通退役保留历史 Revision 与 Active Run；紧急凭据撤销是独立动作并披露受影响 Run。

### 用户体验与隔离

- [ ] 全局模型库与 Workspace 设置覆盖空态、Loading、Invalid、Conflict、Activated、Replacing 和 Active Run 固定旧 Revision 状态，并支持桌面、键盘与窄屏布局。
- [ ] Capability 的来源、覆盖/新增、禁用、校验和被哪些 Agent 使用在配置现场可见。
- [ ] 两个 Workspace 可以使用不同项目能力与 Agent Roster，且不存在数据、能力或凭据泄漏。
- [ ] Dependency 与 Convention Revision 进入 Planning/Input Digest。

## 依赖

F006 是 F001 的基础依赖。F001 只消费已激活 `WorkspaceExecutionProfileRevision` 及其 Provenance，不独立解析或修改 F006 设置。

## 非目标

- 可编辑的全局能力模板或 Role Template；
- 在本版规定具体内置 Skill/MCP 清单；
- 迁移旧模型 Profile；
- 任意 Shell 命令或用户自定义 CLI argv；
- 静默扫描或改写用户项目仓库；
- 在 Active/Paused Run 内热切换设置；
- 静默回退到全局能力或被覆盖的内置能力；
- 把成功连接模型当作能力校准。
