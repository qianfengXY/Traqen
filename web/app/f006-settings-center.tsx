"use client";

import { useEffect, useMemo, useState } from "react";

import { addChildSlot, removeChildSlot } from "./capability-roster";
import type {
  CapabilityKey,
  ChildCapabilityRole,
  EffectiveCapability,
  EffectiveCapabilityCatalog,
  ExecutionProfile,
  GlobalAccount,
  GlobalCapability,
  GlobalCapabilityImpact,
  GlobalModelProfile,
  WorkspaceCapabilityDraft,
} from "./product-foundation-client";
import type { T } from "./product-surfaces";
import type { Workspace } from "./workspace-client";

type Scope = "chooser" | "global" | "workspace";
type GlobalPage = "accounts" | "models" | "skills" | "mcp";
type WorkspacePage = "agents" | "capabilities";
type AgentId = "MAIN" | string;
type LifecycleTarget = { capability: GlobalCapability; lifecycle: "INACTIVE" | "DELETED" };

type Props = {
  t: T;
  scope: Scope;
  setScope: (scope: Scope) => void;
  workspace: Workspace | null;
  accounts: GlobalAccount[];
  models: GlobalModelProfile[];
  capabilities: GlobalCapability[];
  catalog: EffectiveCapabilityCatalog;
  draft: WorkspaceCapabilityDraft | null;
  draftConflict: boolean;
  profile: ExecutionProfile | null;
  mainModel: string;
  setMainModel: (value: string) => void;
  mainSkillNames: string[];
  setMainSkillNames: (value: string[]) => void;
  mainMcpNames: string[];
  setMainMcpNames: (value: string[]) => void;
  childSlots: ChildCapabilityRole[];
  setChildSlots: (value: ChildCapabilityRole[]) => void;
  disabledKeys: CapabilityKey[];
  setDisabledKeys: (value: CapabilityKey[]) => void;
  working: boolean;
  recoveryReady: boolean;
  onAutoSave: () => void;
  onApply: () => void;
  onRetryDraftConflict: () => void;
  onUseCurrentDraft: () => void;
  onSaveLocalCapability: (input: { kind: "SKILL" | "MCP"; normalizedName: string; expectedVersion: number; manifest: Record<string, unknown> }) => void;
  onDeleteLocalCapability: (kind: "SKILL" | "MCP", normalizedName: string, expectedVersion: number) => void;
  onSaveAccount: (input: Record<string, unknown>) => Promise<boolean>;
  onRecheckAccount: (accountId: string) => void;
  onSaveCliModel: (input: Record<string, unknown>) => Promise<boolean>;
  onVerifyModel: (profileId: string) => void;
  onPreviewCapabilityImpact: (kind: "SKILL" | "MCP", normalizedName: string) => Promise<GlobalCapabilityImpact | null>;
  onSetCapabilityLifecycle: (kind: "SKILL" | "MCP", normalizedName: string, input: { expectedVersion: number; lifecycle: "ACTIVE" | "INACTIVE" | "DELETED"; confirmation?: string }) => Promise<boolean>;
  onSaveGlobalCapability: (input: Record<string, unknown>) => Promise<boolean>;
};

const ADAPTERS = ["CODEX", "CLAUDE", "GEMINI", "KIMI"] as const;

function typedKey(kind: "SKILL" | "MCP", normalizedName: string) {
  return `${kind}:${normalizedName}`;
}

function statusCopy(account: GlobalAccount) {
  if (account.authMethod === "API_KEY") return "密钥引用已保存";
  if (account.oauthStatus === "AUTHENTICATED") return "CLI 已登录";
  if (account.oauthStatus === "CLI_UNAVAILABLE") return "未检测到 CLI";
  return "等待 CLI 登录";
}

function capabilityLabel(entry: EffectiveCapability) {
  if (entry.availability === "GLOBAL_UNAVAILABLE") return "全局不可用 / 需要处理";
  if (entry.availability === "WORKSPACE_DISABLED") return "本项目已停用";
  return entry.source === "WORKSPACE" || entry.source === "PROJECT" ? "项目本地" : "全局继承";
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function F006SettingsCenter(props: Props) {
  const [globalPage, setGlobalPage] = useState<GlobalPage>("accounts");
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>("agents");
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>("MAIN");
  const [edited, setEdited] = useState(0);
  const [savedEdited, setSavedEdited] = useState(0);
  const [accountName, setAccountName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [authMethod, setAuthMethod] = useState<"API_KEY" | "OAUTH">("OAUTH");
  const [accountAdapter, setAccountAdapter] = useState<(typeof ADAPTERS)[number]>("CODEX");
  const [secretRefId, setSecretRefId] = useState("");
  const [modelName, setModelName] = useState("");
  const [modelId, setModelId] = useState("");
  const [modelAccountId, setModelAccountId] = useState("");
  const [modelAdapter, setModelAdapter] = useState<(typeof ADAPTERS)[number]>("CODEX");
  const [modelValue, setModelValue] = useState("");
  const [capabilityName, setCapabilityName] = useState("");
  const [capabilityDescription, setCapabilityDescription] = useState("");
  const [localName, setLocalName] = useState("");
  const [localKind, setLocalKind] = useState<"SKILL" | "MCP">("SKILL");
  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const [impact, setImpact] = useState<GlobalCapabilityImpact | null>(null);
  const [confirmation, setConfirmation] = useState("");

  const availableModels = useMemo(() => props.models.filter((model) => model.lifecycle === "ACTIVE" && model.readiness === "READY"), [props.models]);
  const effectiveCapabilities = useMemo(() => props.catalog.effective.filter((entry) => entry.availability !== "GLOBAL_UNAVAILABLE"), [props.catalog.effective]);
  const selected = selectedAgentId === "MAIN"
    ? { id: "MAIN", title: "Main Agent", model: props.mainModel, skills: props.mainSkillNames, mcps: props.mainMcpNames }
    : (() => {
        const slot = props.childSlots.find((candidate) => candidate.id === selectedAgentId) ?? props.childSlots[0];
        return slot ? { id: slot.id, title: `Child Agent ${slot.id.replace("CHILD-", "")}`, model: slot.model, skills: slot.skillNames, mcps: slot.mcpNames } : null;
      })();

  useEffect(() => {
    if (!edited || edited === savedEdited || !props.recoveryReady || props.working) return;
    const timer = window.setTimeout(() => {
      props.onAutoSave();
      setSavedEdited(edited);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [edited, props, savedEdited]);

  function markEdited() {
    setEdited((value) => value + 1);
  }

  function changeSelectedModel(model: string) {
    if (!selected) return;
    if (selected.id === "MAIN") props.setMainModel(model);
    else props.setChildSlots(props.childSlots.map((slot) => slot.id === selected.id ? { ...slot, model } : slot));
    markEdited();
  }

  function toggleGrant(kind: "SKILL" | "MCP", normalizedName: string) {
    if (!selected) return;
    const key = kind === "SKILL" ? "skills" : "mcps";
    const next = selected[key].includes(normalizedName)
      ? selected[key].filter((name) => name !== normalizedName)
      : [...selected[key], normalizedName];
    if (selected.id === "MAIN") {
      if (kind === "SKILL") props.setMainSkillNames(next);
      else props.setMainMcpNames(next);
    } else {
      props.setChildSlots(props.childSlots.map((slot) => slot.id === selected.id
        ? kind === "SKILL" ? { ...slot, skillNames: next } : { ...slot, mcpNames: next }
        : slot));
    }
    markEdited();
  }

  function toggleWorkspaceCapability(entry: EffectiveCapability) {
    if (entry.source !== "GLOBAL" && entry.source !== "BUILTIN") return;
    const key = typedKey(entry.kind, entry.normalizedName);
    const currentlyDisabled = props.disabledKeys.some((item) => typedKey(item.kind, item.normalizedName) === key);
    props.setDisabledKeys(currentlyDisabled
      ? props.disabledKeys.filter((item) => typedKey(item.kind, item.normalizedName) !== key)
      : [...props.disabledKeys, { kind: entry.kind, normalizedName: entry.normalizedName }]);
    markEdited();
  }

  async function addAccount() {
    const id = accountId.trim() || createId("account");
    const created = await props.onSaveAccount({
      accountId: id,
      displayName: accountName.trim() || id,
      authMethod,
      cliAdapter: accountAdapter,
      oauthStatus: authMethod === "OAUTH" ? "NOT_AUTHENTICATED" : undefined,
      secretRefId: authMethod === "API_KEY" ? secretRefId.trim() : undefined,
      expectedVersion: props.accounts.find((account) => account.accountId === id)?.revision ?? 0,
    });
    if (created) {
      setAccountName(""); setAccountId(""); setSecretRefId("");
    }
  }

  async function addModel() {
    const id = modelId.trim() || createId("cli-model");
    const created = await props.onSaveCliModel({
      profileId: id,
      displayName: modelName.trim() || id,
      accountId: modelAccountId,
      cliAdapter: modelAdapter,
      model: modelValue.trim() || undefined,
    });
    if (created) {
      setModelName(""); setModelId(""); setModelValue("");
    }
  }

  async function addGlobalCapability(kind: "SKILL" | "MCP") {
    const normalizedName = capabilityName.trim().toLowerCase();
    if (!normalizedName) return;
    const current = props.capabilities.find((entry) => entry.kind === kind && entry.normalizedName === normalizedName);
    const created = await props.onSaveGlobalCapability({
      kind,
      normalizedName,
      expectedVersion: current?.revision ?? 0,
      lifecycle: "ACTIVE",
      manifest: capabilityDescription.trim() ? { description: capabilityDescription.trim() } : {},
    });
    if (created) { setCapabilityName(""); setCapabilityDescription(""); }
  }

  async function requestLifecycle(target: LifecycleTarget) {
    const nextImpact = await props.onPreviewCapabilityImpact(target.capability.kind, target.capability.normalizedName);
    setImpact(nextImpact);
    setConfirmation("");
    setLifecycleTarget(target);
  }

  async function confirmLifecycle() {
    if (!lifecycleTarget) return;
    const capability = lifecycleTarget.capability;
    const requiresTypedConfirmation = Boolean(impact?.impacts.length);
    if (requiresTypedConfirmation && confirmation !== capability.normalizedName) return;
    const changed = await props.onSetCapabilityLifecycle(capability.kind, capability.normalizedName, {
      expectedVersion: capability.revision,
      lifecycle: lifecycleTarget.lifecycle,
      confirmation: requiresTypedConfirmation ? confirmation : undefined,
    });
    if (changed) { setLifecycleTarget(null); setImpact(null); setConfirmation(""); }
  }

  const readiness = (() => {
    const missing = [
      !props.mainModel ? "Main Agent 尚未选择模型" : "",
      ...props.childSlots.filter((slot) => !slot.model).map((slot) => `${slot.id} 尚未选择模型`),
    ].filter(Boolean);
    const unavailable = props.catalog.entries.filter((entry) => entry.availability === "GLOBAL_UNAVAILABLE");
    const actualUnavailable = unavailable.filter((entry) => {
      const hasGrant = (names: string[]) => names.includes(entry.normalizedName);
      return entry.kind === "SKILL"
        ? hasGrant(props.mainSkillNames) || props.childSlots.some((slot) => hasGrant(slot.skillNames))
        : hasGrant(props.mainMcpNames) || props.childSlots.some((slot) => hasGrant(slot.mcpNames));
    });
    if (actualUnavailable.length) return { tone: "danger", title: "需要处理", detail: "活动配置仍授予了全局不可用能力。" };
    if (missing.length) return { tone: "warning", title: "配置未完成", detail: missing.join("；") };
    return { tone: "success", title: "可以应用", detail: "Main 与所有 Child 已具备模型配置。" };
  })();

  if (props.scope === "chooser") return <section className="f006-settings-center">
    <header className="f006-heading"><p className="eyebrow">Settings center</p><h1>{props.t("设置中心", "Settings center")}</h1><p>{props.t("全局资产定义“有什么可用”；Workspace 配置定义“谁在此项目中使用什么”。", "Global assets define what is available; a Workspace decides who uses it here.")}</p></header>
    <div className="f006-scope-grid">
      <button className="f006-scope-card global" onClick={() => props.setScope("global")}><span>◉</span><strong>{props.t("全局设置", "Global settings")}</strong><small>{props.t("账号、CLI 模型、Skill 与 MCP", "Accounts, CLI models, Skills and MCPs")}</small><i>→</i></button>
      <button className="f006-scope-card workspace" disabled={!props.workspace} onClick={() => props.setScope("workspace")}><span>⌂</span><strong>{props.t("项目设置", "Workspace settings")}</strong><small>{props.workspace ? props.workspace.name : props.t("请先选择一个 Workspace", "Select a Workspace first")}</small><i>→</i></button>
    </div>
    <div className="f006-start-path"><b>{props.t("首次配置路径", "First-run path")}</b><span>{props.t("添加账号 → 创建 CLI 模型 → 启用能力 → 组建 Agent 团队", "Add account → create a CLI model → enable capabilities → assemble an Agent team")}</span></div>
  </section>;

  if (props.scope === "global") return <section className="f006-settings-center">
    <header className="f006-heading f006-heading-row"><div><p className="eyebrow">Global scope</p><h1>{props.t("全局设置", "Global settings")}</h1><p>{props.t("这里的资产可被所有 Workspace 使用；它们不会自动授予任何 Agent。", "Assets here can be used by every Workspace; they are never granted to an Agent automatically.")}</p></div><button className="button ghost" onClick={() => props.setScope("chooser")}>{props.t("返回设置中心", "Back to settings")}</button></header>
    <div className="f006-tabs" role="tablist">
      {(["accounts", "models", "skills", "mcp"] as GlobalPage[]).map((page) => <button key={page} className={globalPage === page ? "active" : ""} onClick={() => setGlobalPage(page)}>{({ accounts: props.t("账号", "Accounts"), models: props.t("模型", "Models"), skills: "Skill", mcp: "MCP" })[page]}</button>)}
    </div>
    {globalPage === "accounts" && <GlobalAccounts {...props} accountName={accountName} setAccountName={setAccountName} accountId={accountId} setAccountId={setAccountId} authMethod={authMethod} setAuthMethod={setAuthMethod} adapter={accountAdapter} setAdapter={setAccountAdapter} secretRefId={secretRefId} setSecretRefId={setSecretRefId} onAdd={() => void addAccount()} />}
    {globalPage === "models" && <GlobalModels {...props} modelName={modelName} setModelName={setModelName} modelId={modelId} setModelId={setModelId} accountId={modelAccountId} setAccountId={setModelAccountId} adapter={modelAdapter} setAdapter={setModelAdapter} modelValue={modelValue} setModelValue={setModelValue} onAdd={() => void addModel()} />}
    {(globalPage === "skills" || globalPage === "mcp") && <GlobalCapabilities {...props} kind={globalPage === "skills" ? "SKILL" : "MCP"} name={capabilityName} setName={setCapabilityName} description={capabilityDescription} setDescription={setCapabilityDescription} onAdd={() => void addGlobalCapability(globalPage === "skills" ? "SKILL" : "MCP")} onLifecycle={(target) => void requestLifecycle(target)} />}
    {lifecycleTarget && <LifecycleDialog target={lifecycleTarget} impact={impact} confirmation={confirmation} setConfirmation={setConfirmation} onCancel={() => { setLifecycleTarget(null); setImpact(null); }} onConfirm={() => void confirmLifecycle()} />}
  </section>;

  if (!props.workspace) return <section className="f006-settings-center"><header className="f006-heading"><p className="eyebrow">Workspace scope</p><h1>{props.t("先选择项目", "Select a Workspace")}</h1><p>{props.t("选择或创建 Workspace 后，才能配置 Agent 团队和项目能力。", "Choose or create a Workspace before configuring its Agent team and capabilities.")}</p></header><button className="button" onClick={() => props.setScope("chooser")}>{props.t("返回设置中心", "Back to settings")}</button></section>;

  return <section className="f006-settings-center">
    <header className="f006-heading f006-heading-row"><div><p className="eyebrow">Workspace scope · {props.workspace.name}</p><h1>{props.t("项目设置", "Workspace settings")}</h1><p>{props.t("草稿会自动保存；只有“应用配置”才会创建下一次运行使用的不可变版本。", "Edits are saved as a draft automatically. Apply creates the immutable version used by the next run.")}</p></div><button className="button ghost" onClick={() => props.setScope("chooser")}>{props.t("切换范围", "Change scope")}</button></header>
    {props.draftConflict && <div className="f006-draft-conflict" role="alert"><div><b>{props.t("草稿已在其他位置更新", "The draft changed elsewhere")}</b><span>{props.t("本地编辑仍被保留。先选择重试自己的版本，或采用服务器的新版本。", "Your edits are retained. Retry your version or adopt the newer server draft.")}</span></div><div><button className="button" disabled={props.working} onClick={props.onRetryDraftConflict}>{props.t("重试我的草稿", "Retry my draft")}</button><button className="button" disabled={props.working} onClick={props.onUseCurrentDraft}>{props.t("采用服务器草稿", "Use server draft")}</button></div></div>}
    <div className={`f006-readiness ${readiness.tone}`}><div><b>{readiness.title}</b><span>{readiness.detail}</span></div><div className="f006-readiness-actions"><small>{props.draft ? `${props.t("草稿版本", "Draft")} r${props.draft.revision}` : props.t("新草稿", "New draft")}</small><button className="button primary" disabled={props.working || !props.recoveryReady || readiness.tone === "danger" || props.draftConflict} onClick={props.onApply}>{props.t("应用配置", "Apply configuration")}</button></div></div>
    <div className="f006-tabs" role="tablist"><button className={workspacePage === "agents" ? "active" : ""} onClick={() => setWorkspacePage("agents")}>{props.t("Agent 设置", "Agent settings")}</button><button className={workspacePage === "capabilities" ? "active" : ""} onClick={() => setWorkspacePage("capabilities")}>{props.t("能力管理", "Capabilities")}</button></div>
    {workspacePage === "agents" && <AgentSettings {...props} selected={selected} selectedAgentId={selectedAgentId} setSelectedAgentId={setSelectedAgentId} availableModels={availableModels} capabilities={effectiveCapabilities} onModelChange={changeSelectedModel} onToggleGrant={toggleGrant} onAddChild={() => { props.setChildSlots(addChildSlot(props.childSlots, { model: "", skillNames: [], mcpNames: [] })); markEdited(); }} onRemoveChild={(id) => { props.setChildSlots(removeChildSlot(props.childSlots, id)); if (selectedAgentId === id) setSelectedAgentId("MAIN"); markEdited(); }} />}
    {workspacePage === "capabilities" && <WorkspaceCapabilities {...props} localKind={localKind} setLocalKind={setLocalKind} localName={localName} setLocalName={setLocalName} onToggle={toggleWorkspaceCapability} onOpenAgentSettings={(agentId) => { setWorkspacePage("agents"); setSelectedAgentId(agentId); }} onAddLocal={() => { const normalizedName = localName.trim().toLowerCase(); if (!normalizedName) return; props.onSaveLocalCapability({ kind: localKind, normalizedName, expectedVersion: 0, manifest: { description: `${props.workspace?.name ?? "Workspace"} local capability` } }); setLocalName(""); }} />}
  </section>;
}

function GlobalAccounts(props: Props & { accountName: string; setAccountName: (value: string) => void; accountId: string; setAccountId: (value: string) => void; authMethod: "API_KEY" | "OAUTH"; setAuthMethod: (value: "API_KEY" | "OAUTH") => void; adapter: (typeof ADAPTERS)[number]; setAdapter: (value: (typeof ADAPTERS)[number]) => void; secretRefId: string; setSecretRefId: (value: string) => void; onAdd: () => void }) {
  return <div className="f006-page-grid"><section className="f006-form-card"><div><p className="eyebrow">Account</p><h2>{props.t("添加全局账号", "Add a global account")}</h2><p>{props.t("OAuth 的登录状态由对应 CLI 维护；Traqen 不显示、不保存 token。", "OAuth state belongs to its CLI. Traqen neither displays nor stores a token.")}</p></div><label>{props.t("显示名称", "Display name")}<input value={props.accountName} onChange={(event) => props.setAccountName(event.currentTarget.value)} placeholder="Codex work account" /></label><label>{props.t("稳定 ID（可选）", "Stable ID (optional)")}<input value={props.accountId} onChange={(event) => props.setAccountId(event.currentTarget.value)} placeholder="codex-work" /></label><fieldset><legend>{props.t("认证方式", "Authentication")}</legend><div className="f006-choice-row"><button className={props.authMethod === "OAUTH" ? "selected" : ""} onClick={() => props.setAuthMethod("OAUTH")}>OAuth / CLI</button><button className={props.authMethod === "API_KEY" ? "selected" : ""} onClick={() => props.setAuthMethod("API_KEY")}>API Key</button></div></fieldset><label>{props.t("CLI 客户端", "CLI client")}<select value={props.adapter} onChange={(event) => props.setAdapter(event.currentTarget.value as (typeof ADAPTERS)[number])}>{ADAPTERS.map((adapter) => <option key={adapter}>{adapter}</option>)}</select></label>{props.authMethod === "API_KEY" ? <label>{props.t("安全凭据引用", "Secret reference")}<input value={props.secretRefId} onChange={(event) => props.setSecretRefId(event.currentTarget.value)} placeholder="vault://…" autoComplete="off" /><small>{props.t("只保存引用，不接受明文 API Key。", "Only a reference is stored; raw API keys are not accepted.")}</small></label> : <div className="f006-info-note"><b>{props.t("在 CLI 中登录", "Sign in in the CLI")}</b><span>{props.t("请由管理员在终端完成登录，然后回到此页点击“重新检查”。", "An administrator signs in in the terminal, then returns here to recheck.")}</span></div>}<button className="button primary" disabled={props.working || (props.authMethod === "API_KEY" && !props.secretRefId.trim())} onClick={props.onAdd}>{props.t("保存账号", "Save account")}</button></section><section className="f006-list-card"><div className="f006-list-head"><div><p className="eyebrow">Global accounts</p><h2>{props.t("账号状态", "Account status")}</h2></div><span>{props.accounts.length}</span></div>{props.accounts.length ? props.accounts.map((account) => <article className="f006-resource-row" key={account.id}><div className="f006-resource-icon">{account.authMethod === "OAUTH" ? "◌" : "◆"}</div><div><strong>{account.displayName}</strong><small>{account.cliAdapter ?? "—"} · {account.authMethod}</small><p>{statusCopy(account)}</p></div><div className={`f006-status ${account.lifecycle === "ACTIVE" && account.oauthStatus !== "CLI_UNAVAILABLE" ? "success" : "warning"}`}>{account.lifecycle === "ACTIVE" ? account.oauthStatus ?? "ACTIVE" : account.lifecycle}</div>{account.authMethod === "OAUTH" && <button className="button" disabled={props.working} onClick={() => props.onRecheckAccount(account.accountId)}>{props.t("重新检查", "Recheck")}</button>}</article>) : <EmptyList title={props.t("还没有账号", "No accounts yet")} detail={props.t("从一个 CLI 账号开始。", "Start with one CLI account.")} />}</section></div>;
}

function GlobalModels(props: Props & { modelName: string; setModelName: (value: string) => void; modelId: string; setModelId: (value: string) => void; accountId: string; setAccountId: (value: string) => void; adapter: (typeof ADAPTERS)[number]; setAdapter: (value: (typeof ADAPTERS)[number]) => void; modelValue: string; setModelValue: (value: string) => void; onAdd: () => void }) {
  const activeAccounts = props.accounts.filter((account) => account.lifecycle === "ACTIVE");
  return <div className="f006-page-grid"><section className="f006-form-card"><div><p className="eyebrow">CLI model</p><h2>{props.t("创建 CLI 模型", "Create a CLI model")}</h2><p>{props.t("v1 只允许本机 CLI。API 模式不会出现在此流程中。", "v1 only supports a local CLI. API transport is not part of this flow.")}</p></div><label>{props.t("显示名称", "Display name")}<input value={props.modelName} onChange={(event) => props.setModelName(event.currentTarget.value)} placeholder="Codex · GPT-5.6" /></label><label>{props.t("稳定 ID（可选）", "Stable ID (optional)")}<input value={props.modelId} onChange={(event) => props.setModelId(event.currentTarget.value)} placeholder="codex-gpt-5" /></label><label>{props.t("账号", "Account")}<select value={props.accountId} onChange={(event) => props.setAccountId(event.currentTarget.value)}><option value="">{props.t("选择账号", "Select account")}</option>{activeAccounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.displayName} · {account.authMethod}</option>)}</select></label><label>{props.t("CLI 客户端", "CLI client")}<select value={props.adapter} onChange={(event) => props.setAdapter(event.currentTarget.value as (typeof ADAPTERS)[number])}>{ADAPTERS.map((adapter) => <option key={adapter}>{adapter}</option>)}</select></label><label>{props.t("模型标识（可选）", "Model ID (optional)")}<input value={props.modelValue} onChange={(event) => props.setModelValue(event.currentTarget.value)} placeholder="gpt-5.6" /></label><button className="button primary" disabled={props.working || !props.accountId} onClick={props.onAdd}>{props.t("保存 CLI 模型", "Save CLI model")}</button></section><section className="f006-list-card"><div className="f006-list-head"><div><p className="eyebrow">Global models</p><h2>{props.t("模型可用性", "Model readiness")}</h2></div><span>{props.models.length}</span></div>{props.models.length ? props.models.map((model) => <article className="f006-resource-row" key={model.id}><div className="f006-resource-icon">⌘</div><div><strong>{model.displayName}</strong><small>{model.cliAdapter ?? "CLI"} · {model.accountId ?? "未关联账号"}{model.model ? ` · ${model.model}` : ""}</small><p>{model.readiness === "READY" ? props.t("可供 Agent 选择", "Available to Agents") : props.t("验证后才会进入 Agent 选择器", "Verify before it appears in Agent selectors")}</p></div><div className={`f006-status ${model.readiness === "READY" ? "success" : "warning"}`}>{model.readiness}</div><button className="button" disabled={props.working || model.lifecycle !== "ACTIVE"} onClick={() => props.onVerifyModel(model.profileId)}>{props.t("验证", "Verify")}</button></article>) : <EmptyList title={props.t("还没有模型", "No models yet")} detail={props.t("选择一个全局账号后创建本机 CLI 模型。", "Choose a global account, then create a local CLI model.")} />}</section></div>;
}

function GlobalCapabilities(props: Props & { kind: "SKILL" | "MCP"; name: string; setName: (value: string) => void; description: string; setDescription: (value: string) => void; onAdd: () => void; onLifecycle: (target: LifecycleTarget) => void }) {
  const entries = props.capabilities.filter((entry) => entry.kind === props.kind);
  return <div className="f006-page-grid"><section className="f006-form-card"><div><p className="eyebrow">{props.kind}</p><h2>{props.t(`添加全局 ${props.kind}`, `Add global ${props.kind}`)}</h2><p>{props.t("全局启用项会进入项目可选目录，但绝不自动授予 Agent。", "A global active item enters Workspace availability, but is never auto-granted to an Agent.")}</p></div><label>{props.t("名称", "Name")}<input value={props.name} onChange={(event) => props.setName(event.currentTarget.value)} placeholder={props.kind === "SKILL" ? "review" : "repository-tools"} /></label><label>{props.t("说明（可选）", "Description (optional)")}<textarea value={props.description} onChange={(event) => props.setDescription(event.currentTarget.value)} rows={4} placeholder={props.t("给其他项目管理员看的说明", "A note for administrators in other Workspaces")} /></label><button className="button primary" disabled={props.working || !props.name.trim()} onClick={props.onAdd}>{props.t("添加并启用", "Add and enable")}</button></section><section className="f006-list-card"><div className="f006-list-head"><div><p className="eyebrow">Global {props.kind}</p><h2>{props.t("能力库", "Capability library")}</h2></div><span>{entries.length}</span></div>{entries.length ? entries.map((entry) => <article className="f006-resource-row" key={entry.id}><div className="f006-resource-icon">{props.kind === "SKILL" ? "✦" : "↔"}</div><div><strong>{entry.normalizedName}</strong><small>{String(entry.manifest.description ?? props.t("没有说明", "No description"))}</small><p>{entry.lifecycle === "ACTIVE" ? props.t("可被项目继承", "Available to Workspaces") : entry.lifecycle === "INACTIVE" ? props.t("项目不能重新启用", "Workspaces cannot re-enable it") : props.t("已删除；保留历史证据", "Deleted; historical evidence remains")}</p></div><div className={`f006-status ${entry.lifecycle === "ACTIVE" ? "success" : entry.lifecycle === "DELETED" ? "danger" : "warning"}`}>{entry.lifecycle}</div>{entry.lifecycle === "ACTIVE" && <button className="button" disabled={props.working} onClick={() => props.onLifecycle({ capability: entry, lifecycle: "INACTIVE" })}>{props.t("全局停用", "Deactivate")}</button>}{entry.lifecycle === "INACTIVE" && <button className="button" disabled={props.working} onClick={() => void props.onSetCapabilityLifecycle(entry.kind, entry.normalizedName, { expectedVersion: entry.revision, lifecycle: "ACTIVE" })}>{props.t("重新启用", "Reactivate")}</button>}{entry.lifecycle !== "DELETED" && <button className="button danger" disabled={props.working} onClick={() => props.onLifecycle({ capability: entry, lifecycle: "DELETED" })}>{props.t("删除", "Delete")}</button>}</article>) : <EmptyList title={props.t(`还没有 ${props.kind}`, `No ${props.kind}s yet`)} detail={props.t("添加一个全局能力，供 Workspace 按需选择。", "Add a global capability for Workspaces to choose deliberately.")} />}</section></div>;
}

function AgentSettings(props: Props & { selected: { id: string; title: string; model: string; skills: string[]; mcps: string[] } | null; selectedAgentId: string; setSelectedAgentId: (value: string) => void; availableModels: GlobalModelProfile[]; capabilities: EffectiveCapability[]; onModelChange: (model: string) => void; onToggleGrant: (kind: "SKILL" | "MCP", name: string) => void; onAddChild: () => void; onRemoveChild: (id: string) => void }) {
  return <div className="f006-agent-layout"><aside className="f006-agent-rail"><p className="eyebrow">Team</p><button className={`f006-agent-card main ${props.selectedAgentId === "MAIN" ? "selected" : ""}`} onClick={() => props.setSelectedAgentId("MAIN")}><span>♛</span><strong>Main Agent</strong><small>{props.mainModel || props.t("待选择模型", "Model required")}</small><em>{props.mainSkillNames.length + props.mainMcpNames.length} {props.t("项授权", "grants")}</em></button>{props.childSlots.map((slot, index) => <div key={slot.id} className="f006-child-wrap"><button className={`f006-agent-card ${props.selectedAgentId === slot.id ? "selected" : ""}`} onClick={() => props.setSelectedAgentId(slot.id)}><span>◌</span><strong>{props.t(`Child ${index + 1}`, `Child ${index + 1}`)}</strong><small>{slot.model || props.t("待选择模型", "Model required")}</small><em>{slot.skillNames.length + slot.mcpNames.length} {props.t("项授权", "grants")}</em></button>{props.childSlots.length > 1 && <button className="f006-remove-child" aria-label={props.t("移除此 Child", "Remove Child")} onClick={() => props.onRemoveChild(slot.id)}>×</button>}</div>)}<button className="button f006-add-child" disabled={props.working} onClick={props.onAddChild}>＋ {props.t("添加 Child", "Add Child")}</button></aside><section className="f006-agent-inspector">{props.selected ? <><div className="f006-inspector-head"><div><p className="eyebrow">Agent configuration</p><h2>{props.selected.title}</h2><p>{props.t("模型和授权都必须显式选择。", "Both model and grants must be selected explicitly.")}</p></div><span className={`f006-status ${props.selected.model ? "success" : "warning"}`}>{props.selected.model ? props.t("已配置", "Configured") : props.t("待配置", "Incomplete")}</span></div><label>{props.t("全局 CLI 模型", "Global CLI model")}<select value={props.selected.model} onChange={(event) => props.onModelChange(event.currentTarget.value)}><option value="">{props.t("选择已验证模型", "Select a verified model")}</option>{props.availableModels.map((model) => <option key={model.profileId} value={model.profileId}>{model.displayName} · {model.cliAdapter}</option>)}</select></label><div className="f006-grant-block"><div><h3>Skill</h3><small>{props.t("只能授予项目当前有效的能力。", "Only currently effective Workspace capabilities can be granted.")}</small></div>{props.capabilities.filter((entry) => entry.kind === "SKILL").map((entry) => <label className="f006-check-row" key={entry.id}><input type="checkbox" checked={props.selected!.skills.includes(entry.normalizedName)} onChange={() => props.onToggleGrant("SKILL", entry.normalizedName)} /><span>{entry.normalizedName}</span><small>{capabilityLabel(entry)}</small></label>) || <p className="f006-empty-inline">{props.t("没有可授予的 Skill。", "No Skills can be granted.")}</p>}</div><div className="f006-grant-block"><div><h3>MCP</h3><small>{props.t("项目允许与 Agent 授权是两个独立层。", "Workspace availability and Agent grants are separate layers.")}</small></div>{props.capabilities.filter((entry) => entry.kind === "MCP").map((entry) => <label className="f006-check-row" key={entry.id}><input type="checkbox" checked={props.selected!.mcps.includes(entry.normalizedName)} onChange={() => props.onToggleGrant("MCP", entry.normalizedName)} /><span>{entry.normalizedName}</span><small>{capabilityLabel(entry)}</small></label>) || <p className="f006-empty-inline">{props.t("没有可授予的 MCP。", "No MCPs can be granted.")}</p>}</div></> : <EmptyList title={props.t("选择一个 Agent", "Select an Agent")} detail={props.t("从左侧团队中选择。", "Choose one from the team.")} />}</section></div>;
}

function WorkspaceCapabilities(props: Props & { localKind: "SKILL" | "MCP"; setLocalKind: (value: "SKILL" | "MCP") => void; localName: string; setLocalName: (value: string) => void; onToggle: (entry: EffectiveCapability) => void; onOpenAgentSettings: (agentId: string) => void; onAddLocal: () => void }) {
  const groups = [
    { key: "available", title: props.t("全局继承且可用", "Global inherited and available"), entries: props.catalog.entries.filter((entry) => (entry.source === "GLOBAL" || entry.source === "BUILTIN") && entry.availability === "AVAILABLE") },
    { key: "disabled", title: props.t("本项目主动停用", "Disabled in this Workspace"), entries: props.catalog.entries.filter((entry) => entry.availability === "WORKSPACE_DISABLED") },
    { key: "local", title: props.t("项目本地能力", "Workspace-local capabilities"), entries: props.catalog.entries.filter((entry) => entry.source === "WORKSPACE" || entry.source === "PROJECT") },
    { key: "unavailable", title: props.t("全局不可用 / 需要处理", "Global unavailable / needs attention"), entries: props.catalog.entries.filter((entry) => entry.availability === "GLOBAL_UNAVAILABLE") },
  ];
  const grantedAgents = (entry: EffectiveCapability) => [
    ...(entry.kind === "SKILL" && props.mainSkillNames.includes(entry.normalizedName) || entry.kind === "MCP" && props.mainMcpNames.includes(entry.normalizedName) ? [{ id: "MAIN", label: props.t("主 Agent", "Main Agent") }] : []),
    ...props.childSlots.flatMap((slot, index) => entry.kind === "SKILL" && slot.skillNames.includes(entry.normalizedName) || entry.kind === "MCP" && slot.mcpNames.includes(entry.normalizedName)
      ? [{ id: slot.id, label: props.t(`Child ${index + 1}`, `Child ${index + 1}`) }]
      : []),
  ];
  return <div className="f006-capability-layout"><section className="f006-capability-groups">{groups.map((group) => <article className={`f006-capability-group ${group.key}`} key={group.key}><header><h2>{group.title}</h2><span>{group.entries.length}</span></header>{group.entries.length ? group.entries.map((entry) => { const grants = grantedAgents(entry); return <div className="f006-capability-row" key={entry.id}><div><strong>{entry.normalizedName}</strong><small>{entry.kind} · {capabilityLabel(entry)}</small>{grants.length ? <button className="f006-grant-link" onClick={() => props.onOpenAgentSettings(grants[0].id)}>{props.t(`已授权给 ${grants.map(({ label }) => label).join("、")}`, `Granted to ${grants.map(({ label }) => label).join(", ")}`)}</button> : <small>{props.t("尚未授予任何 Agent", "No Agent grants")}</small>}</div>{group.key === "available" || group.key === "disabled" ? <button className="button" disabled={props.working} onClick={() => props.onToggle(entry)}>{group.key === "available" ? props.t("在本项目停用", "Disable here") : props.t("恢复继承", "Restore inheritance")}</button> : group.key === "local" ? <button className="button danger" disabled={props.working} onClick={() => props.onDeleteLocalCapability(entry.kind, entry.normalizedName, entry.revision ?? 0)}>{props.t("删除本地项", "Delete local")}</button> : <span className="f006-status danger">{props.t("不能在项目中重新启用", "Cannot re-enable here")}</span>}</div>; }) : <p className="f006-empty-inline">{props.t("没有项目。", "Nothing here.")}</p>}</article>)}</section><aside className="f006-local-form"><p className="eyebrow">Workspace-local</p><h2>{props.t("添加项目本地能力", "Add a local capability")}</h2><p>{props.t("本地能力只属于当前项目；同名全局能力不能被覆盖或替换。", "A local capability belongs only to this Workspace; it cannot replace or override a global item with the same name.")}</p><label>{props.t("类型", "Kind")}<select value={props.localKind} onChange={(event) => props.setLocalKind(event.currentTarget.value as "SKILL" | "MCP")}><option value="SKILL">Skill</option><option value="MCP">MCP</option></select></label><label>{props.t("名称", "Name")}<input value={props.localName} onChange={(event) => props.setLocalName(event.currentTarget.value)} placeholder="workspace-review-notes" /></label><button className="button primary" disabled={props.working || !props.localName.trim()} onClick={props.onAddLocal}>{props.t("添加本地能力", "Add local capability")}</button><div className="f006-grant-summary"><b>{props.t("Agent 授权摘要", "Agent grant summary")}</b><span>{props.t("要授权给 Agent，请返回“Agent 设置”。", "Return to Agent settings to grant a capability.")}</span></div></aside></div>;
}

function LifecycleDialog(props: { target: LifecycleTarget; impact: GlobalCapabilityImpact | null; confirmation: string; setConfirmation: (value: string) => void; onCancel: () => void; onConfirm: () => void }) {
  const needsConfirmation = Boolean(props.impact?.impacts.length);
  const action = props.target.lifecycle === "DELETED" ? "删除" : "全局停用";
  return <div className="modal-backdrop"><section className="confirmation-modal f006-lifecycle-dialog" role="dialog" aria-modal="true"><p className="eyebrow">Global impact</p><h2>{action} {props.target.capability.normalizedName}</h2><p>{needsConfirmation ? `此操作会影响 ${props.impact!.impacts.length} 个活动 Workspace 配置。已在运行的任务仍使用其启动快照；新的运行只有在实际授予此能力时才会被阻断。` : "没有活动 Workspace 配置授予此能力。项目目录中的未授权项不会阻断运行。"}</p>{needsConfirmation && <><ul>{props.impact!.impacts.map((item) => <li key={item.workspaceId}>{item.workspaceName ?? item.workspaceId} · {item.grantedSlotIds.join(", ")}</li>)}</ul><label>输入 <b>{props.target.capability.normalizedName}</b> 确认<input value={props.confirmation} onChange={(event) => props.setConfirmation(event.currentTarget.value)} autoComplete="off" /></label></>}<div className="modal-actions"><button className="button" onClick={props.onCancel}>取消</button><button className="button danger" disabled={needsConfirmation && props.confirmation !== props.target.capability.normalizedName} onClick={props.onConfirm}>{action}</button></div></section></div>;
}

function EmptyList(props: { title: string; detail: string }) {
  return <div className="f006-empty"><strong>{props.title}</strong><span>{props.detail}</span></div>;
}
