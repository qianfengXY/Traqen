import { randomUUID } from "node:crypto";

import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

const capabilityKinds = new Set(["MODEL", "SKILL", "MCP"]);
const catalogKinds = new Set(["SKILL", "MCP"]);
const modelTransports = new Set(["API", "CLI"]);
const cliAdapters = new Set(["CODEX", "CLAUDE", "GEMINI", "KIMI"]);
const cliExecutables = new Map([["CODEX", "codex"], ["CLAUDE", "claude"], ["GEMINI", "gemini"], ["KIMI", "kimi"]]);
const codexReasoningEfforts = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const approvedSecretReference = /^(?:vault|secret|keychain|env):\/\/[A-Za-z0-9._~:/@+=-]+$/i;

function assertSecretFree(value, fieldName) {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:secret|password|api[_-]?key|access[_-]?token|credential[_-]?value|authorization|proxy[_-]?authorization|cookie|private[_-]?key|client[_-]?secret)/i.test(key)) {
      throw new TypeError(`${fieldName} cannot contain credential material`);
    }
    assertSecretFree(nested, `${fieldName}.${key}`);
  }
}

function uniqueStrings(values, fieldName) {
  if (!Array.isArray(values ?? [])) throw new TypeError(`${fieldName} must be an array`);
  const normalized = (values ?? []).map((value, index) => requireNonEmptyString(value, `${fieldName}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${fieldName} must be unique`);
  return normalized;
}

function normalizedCapabilityName(value, fieldName = "capability name") {
  return requireNonEmptyString(value, fieldName).trim().toLowerCase();
}

function hasPinnedModelId(model) {
  const value = model?.model ?? model?.connection?.model;
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeCodexReasoningEffort(value, cliAdapter) {
  if (value === undefined || value === null) return null;
  if (String(cliAdapter ?? "").toUpperCase() !== "CODEX") {
    throw new TypeError("reasoning effort is only supported for CODEX");
  }
  const normalized = requireNonEmptyString(value, "reasoning effort").toLowerCase();
  if (!codexReasoningEfforts.has(normalized)) {
    throw new TypeError("reasoning effort must be minimal, low, medium, high, or xhigh");
  }
  return normalized;
}

export function capabilityKey(input, fieldName = "capability") {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${fieldName} must be an object`);
  const kind = requireNonEmptyString(input.kind, `${fieldName}.kind`).toUpperCase();
  if (!catalogKinds.has(kind)) throw new TypeError(`${fieldName}.kind must be SKILL or MCP`);
  return deepFreeze({ kind, normalizedName: normalizedCapabilityName(input.normalizedName ?? input.name ?? input.logicalName, `${fieldName}.normalizedName`) });
}

function typedKey(input) {
  const key = capabilityKey(input);
  return `${key.kind}\u0000${key.normalizedName}`;
}

function uniqueCapabilityKeys(values, fieldName) {
  if (!Array.isArray(values ?? [])) throw new TypeError(`${fieldName} must be an array`);
  const result = (values ?? []).map((value, index) => capabilityKey(value, `${fieldName}[${index}]`));
  if (new Set(result.map(typedKey)).size !== result.length) throw new TypeError(`${fieldName} must be unique by typed key`);
  return result;
}

export function createGlobalAccountRevision(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("global account must be an object");
  const { secretRefId, ...nonSecretInput } = input;
  assertSecretFree(nonSecretInput, "global account");
  const accountId = requireNonEmptyString(input.accountId ?? input.id, "accountId");
  const revision = Number(input.revision ?? 1);
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError("revision must be a positive integer");
  const authMethod = requireNonEmptyString(input.authMethod, "authMethod").toUpperCase();
  if (!new Set(["API_KEY", "OAUTH"]).has(authMethod)) throw new TypeError("authMethod must be API_KEY or OAUTH");
  const lifecycle = String(input.lifecycle ?? "ACTIVE").toUpperCase();
  if (!new Set(["ACTIVE", "INACTIVE", "DELETED"]).has(lifecycle)) throw new TypeError("account lifecycle must be ACTIVE, INACTIVE, or DELETED");
  const connection = authMethod === "API_KEY"
    ? { secretRefId: requireNonEmptyString(secretRefId, "secretRefId") }
    : {
        cliAdapter: requireNonEmptyString(input.cliAdapter, "cliAdapter").toUpperCase(),
        oauthStatus: String(input.oauthStatus ?? "UNKNOWN").toUpperCase(),
      };
  if (authMethod === "OAUTH" && !cliAdapters.has(connection.cliAdapter)) throw new TypeError("unsupported CLI adapter");
  if (authMethod === "API_KEY" && !approvedSecretReference.test(connection.secretRefId)) {
    throw new TypeError("secretRefId must be an approved secret reference");
  }
  if (authMethod === "OAUTH" && !new Set(["UNKNOWN", "AUTHENTICATED", "NOT_AUTHENTICATED", "CLI_UNAVAILABLE"]).has(connection.oauthStatus)) {
    throw new TypeError("oauthStatus is invalid");
  }
  const identity = {
    accountId,
    revision,
    displayName: requireNonEmptyString(input.displayName ?? accountId, "displayName"),
    authMethod,
    lifecycle,
    ...connection,
  };
  return deepFreeze({
    id: contentId("GLOBAL-ACCOUNT-REVISION", identity),
    ...identity,
    createdAt: clock().toISOString(),
  });
}

export function createGlobalModelProfileRevision(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("global model profile must be an object");
  const profileId = requireNonEmptyString(input.profileId ?? input.id, "profileId");
  const revision = Number(input.revision ?? 1);
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError("revision must be a positive integer");
  const transport = requireNonEmptyString(input.transport, "transport").toUpperCase();
  if (!modelTransports.has(transport)) throw new TypeError("transport must be API or CLI");
  if (transport === "API" && input.reasoningEffort !== undefined && input.reasoningEffort !== null) {
    throw new TypeError("reasoning effort is only supported for CODEX");
  }
  const connection = transport === "API"
    ? {
        providerAdapter: requireNonEmptyString(input.providerAdapter, "providerAdapter"),
        endpoint: requireNonEmptyString(input.endpoint, "endpoint"),
        model: requireNonEmptyString(input.model, "model"),
        credentialHandleId: requireNonEmptyString(input.credentialHandleId, "credentialHandleId"),
      }
    : (() => {
        const cliAdapter = requireNonEmptyString(input.cliAdapter, "cliAdapter").toUpperCase();
        const reasoningEffort = normalizeCodexReasoningEffort(input.reasoningEffort, cliAdapter);
        return {
          cliAdapter,
          ...(input.model ? { model: requireNonEmptyString(input.model, "model") } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        };
      })();
  if (transport === "CLI" && !cliAdapters.has(connection.cliAdapter)) throw new TypeError("unsupported CLI adapter");
  if (transport === "CLI" && input.executablePath && requireNonEmptyString(input.executablePath, "executablePath") !== cliExecutables.get(connection.cliAdapter)) {
    throw new TypeError("CLI executable must match the adapter allowlist");
  }
  assertSecretFree(connection, "global model profile");
  const identity = {
    profileId,
    revision,
    accountId: input.accountId ? requireNonEmptyString(input.accountId, "accountId") : null,
    transport,
    connection,
  };
  return deepFreeze({
    id: contentId("GLOBAL-MODEL-PROFILE-REVISION", identity),
    ...identity,
    displayName: requireNonEmptyString(input.displayName ?? profileId, "displayName"),
    readiness: String(input.readiness ?? "UNVERIFIED").toUpperCase(),
    lifecycle: String(input.lifecycle ?? "ACTIVE").toUpperCase(),
    createdAt: clock().toISOString(),
  });
}

export function createProjectCapabilityRevision(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("project capability must be an object");
  const workspaceId = requireNonEmptyString(input.workspaceId, "workspaceId");
  const key = capabilityKey(input);
  const revision = Number(input.revision ?? 1);
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError("revision must be a positive integer");
  const manifest = structuredClone(input.manifest ?? {});
  assertSecretFree(manifest, "project capability manifest");
  const identity = { workspaceId, ...key, revision, manifest, credentialHandleIds: uniqueStrings(input.credentialHandleIds, "credentialHandleIds") };
  return deepFreeze({
    id: contentId("PROJECT-CAPABILITY-REVISION", identity),
    ...identity,
    contentDigest: contentId("PROJECT-CAPABILITY-CONTENT", { ...key, manifest }),
    createdAt: clock().toISOString(),
  });
}

export function resolveWorkspaceCapabilityCatalog({
  globalCatalog = null,
  builtinCatalog = [],
  workspaceLocalCatalog = null,
  projectCatalog = [],
  disabledKeys = [],
}) {
  const latest = (entries, source) => {
    const result = new Map();
    for (const raw of entries) {
      const key = capabilityKey(raw);
      const value = { ...structuredClone(raw), ...key, source };
      const storageKey = typedKey(key);
      const prior = result.get(storageKey);
      if (!prior || Number(value.revision ?? 1) > Number(prior.revision ?? 1)) result.set(storageKey, value);
    }
    return result;
  };
  const globals = latest(globalCatalog ?? builtinCatalog, "GLOBAL");
  const workspaceLocals = latest(workspaceLocalCatalog ?? projectCatalog, "WORKSPACE");
  const disabled = new Set(uniqueCapabilityKeys(disabledKeys, "disabledKeys").map(typedKey));
  for (const key of workspaceLocals.keys()) {
    if (globals.has(key)) throw new TypeError("Workspace-local capability cannot replace a global capability");
  }
  const globalIsAvailable = (entry) => {
    const lifecycle = String(entry.lifecycle ?? "ACTIVE").toUpperCase();
    return entry.deleted !== true && entry.active !== false && lifecycle === "ACTIVE";
  };
  const entries = [
    ...[...globals.entries()].map(([key, entry]) => {
      const available = globalIsAvailable(entry);
      const isDisabled = available && disabled.has(key);
      return deepFreeze({
        ...entry,
        source: "GLOBAL",
        availability: available ? (isDisabled ? "WORKSPACE_DISABLED" : "AVAILABLE") : "GLOBAL_UNAVAILABLE",
        disabled: isDisabled,
        effective: available && !isDisabled,
      });
    }),
    ...[...workspaceLocals.entries()].map(([key, entry]) => {
      const isDisabled = disabled.has(key);
      return deepFreeze({
        ...entry,
        source: "WORKSPACE",
        availability: isDisabled ? "WORKSPACE_DISABLED" : "AVAILABLE",
        disabled: isDisabled,
        effective: !isDisabled,
      });
    }),
  ].sort((left, right) => left.kind.localeCompare(right.kind) || left.normalizedName.localeCompare(right.normalizedName));
  return deepFreeze({
    entries,
    effective: entries.filter(({ effective }) => effective),
    summary: {
      globalAvailableCount: entries.filter(({ source, availability }) => source === "GLOBAL" && availability !== "GLOBAL_UNAVAILABLE").length,
      workspaceDisabledCount: entries.filter(({ availability }) => availability === "WORKSPACE_DISABLED").length,
      workspaceLocalCount: entries.filter(({ source }) => source === "WORKSPACE").length,
      globalUnavailableCount: entries.filter(({ availability }) => availability === "GLOBAL_UNAVAILABLE").length,
      effectiveCount: entries.filter(({ effective }) => effective).length,
    },
  });
}

function draftAgentSlot(input, role, index = 0) {
  const value = input && typeof input === "object" ? input : {};
  return {
    id: String(value.id ?? (role === "MAIN" ? "MAIN" : `CHILD-${index + 1}`)),
    role,
    displayName: String(value.displayName ?? (role === "MAIN" ? "Main Agent" : `Child Agent ${index + 1}`)),
    modelProfileId: String(value.modelProfileId ?? value.model ?? ""),
    skillGrants: uniqueCapabilityKeys(value.skillGrants ?? (value.skillNames ?? []).map((normalizedName) => ({ kind: "SKILL", normalizedName })), `${role}.skillGrants`),
    mcpGrants: uniqueCapabilityKeys(value.mcpGrants ?? (value.mcpNames ?? []).map((normalizedName) => ({ kind: "MCP", normalizedName })), `${role}.mcpGrants`),
    rolePolicy: String(value.rolePolicy ?? (role === "MAIN" ? "PRIMARY_ANALYST" : "SPECIALIST")),
    independenceGroup: String(value.independenceGroup ?? (role === "MAIN" ? "MAIN" : "")),
    enabled: value.enabled !== false,
  };
}

export function createWorkspaceCapabilityDraftRevision(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Workspace capability draft must be an object");
  const workspaceId = requireNonEmptyString(input.workspaceId, "workspaceId");
  const revision = Number(input.revision ?? 1);
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError("revision must be a positive integer");
  const mainAgentSlot = draftAgentSlot(input.mainAgentSlot ?? input.mainAgent, "MAIN");
  const childAgentSlots = (input.childAgentSlots ?? input.childSlots ?? [{}]).map((slot, index) => draftAgentSlot(slot, "CHILD", index));
  const importedKeys = uniqueCapabilityKeys(input.importedKeys, "importedKeys");
  const disabledKeys = uniqueCapabilityKeys(input.disabledKeys, "disabledKeys");
  const identity = {
    workspaceId,
    revision,
    mainAgentSlot,
    childAgentSlots,
    projectCapabilityRevisionIds: uniqueStrings(input.projectCapabilityRevisionIds, "projectCapabilityRevisionIds"),
    importedKeys,
    disabledKeys,
    dependencyPolicyRevisionId: String(input.dependencyPolicyRevisionId ?? ""),
    conventionRevisionId: String(input.conventionRevisionId ?? ""),
    securityPolicyRevisionId: String(input.securityPolicyRevisionId ?? ""),
  };
  return deepFreeze({ id: contentId("WORKSPACE-CAPABILITY-DRAFT", identity), ...identity, createdAt: clock().toISOString() });
}

export function createWorkspacePolicyRevision(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Workspace policy revision must be an object");
  const workspaceId = requireNonEmptyString(input.workspaceId, "workspaceId");
  const kind = requireNonEmptyString(input.kind, "kind").toUpperCase();
  if (!new Set(["DEPENDENCY", "CONVENTION", "SECURITY"]).has(kind)) throw new TypeError("unsupported Workspace policy kind");
  const revision = Number(input.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError("revision must be a positive integer");
  const content = structuredClone(input.content ?? {});
  assertSecretFree(content, `${kind} policy`);
  const identity = { workspaceId, kind, revision, content };
  return deepFreeze({ id: contentId("WORKSPACE-POLICY-REVISION", identity), ...identity, contentDigest: contentId("WORKSPACE-POLICY-CONTENT", { kind, content }), createdAt: clock().toISOString() });
}

export function validateWorkspaceCapabilityDraft({ draft, modelProfiles = [], effectiveCatalog = [], securityPolicy = {} }) {
  const errors = [];
  const models = new Map(modelProfiles.map((model) => [model.profileId ?? model.id, model]));
  const effectiveKeys = new Set(effectiveCatalog.filter((entry) => entry.effective !== false && entry.disabled !== true).map(typedKey));
  const enabledChildren = draft.childAgentSlots.filter(({ enabled }) => enabled);
  if (!draft.mainAgentSlot.enabled) errors.push({ field: "mainAgentSlot.enabled", code: "MAIN_REQUIRED", message: "The Main Agent slot must be enabled" });
  if (enabledChildren.length < 1) errors.push({ field: "childAgentSlots", code: "MINIMUM_CHILDREN", message: "At least one enabled Child Agent slot is required" });
  const slots = [draft.mainAgentSlot, ...draft.childAgentSlots];
  for (const [index, slot] of slots.entries()) {
    const path = index === 0 ? "mainAgentSlot" : `childAgentSlots[${index - 1}]`;
    if (!slot.enabled) continue;
    if (!slot.id.trim()) errors.push({ field: `${path}.id`, code: "REQUIRED", message: "Slot id is required" });
    if (!slot.rolePolicy.trim()) errors.push({ field: `${path}.rolePolicy`, code: "REQUIRED", message: "Role policy is required" });
    const model = models.get(slot.modelProfileId);
    if (!slot.modelProfileId || !model) errors.push({ field: `${path}.modelProfileId`, code: "MODEL_UNAVAILABLE", message: "Select a global model profile" });
    // Account context is deliberately attached only by the F006 application service.
    // This keeps historical/domain-only callers from silently changing semantics while
    // ensuring every executable F006 draft rejects legacy direct-API profiles.
    else if (model.account !== undefined && String(model.transport ?? "").toUpperCase() === "API") errors.push({ field: `${path}.modelProfileId`, code: "MODEL_NOT_F006_CLI", message: "F006 requires an account-backed CLI model" });
    else if (String(model.transport ?? "").toUpperCase() === "CLI" && !hasPinnedModelId(model)) errors.push({ field: `${path}.modelProfileId`, code: "MODEL_UNPINNED", message: "Selected CLI model must pin a non-empty model ID" });
    else if (model.account === null) errors.push({ field: `${path}.modelProfileId`, code: "MODEL_ACCOUNT_UNAVAILABLE", message: "Select a CLI model backed by an active global account" });
    // Callers that only own a historical model snapshot do not have account context.
    // F006 service paths always attach it; legacy-domain callers retain their prior
    // readiness-only validation rather than being mistaken for a missing account.
    else if (model.account !== undefined && model.account.lifecycle !== "ACTIVE") errors.push({ field: `${path}.modelProfileId`, code: "MODEL_ACCOUNT_INACTIVE", message: "Selected model account must be ACTIVE" });
    else if (model.account?.authMethod === "OAUTH" && model.account.oauthStatus !== "AUTHENTICATED") errors.push({ field: `${path}.modelProfileId`, code: "MODEL_ACCOUNT_NOT_AUTHENTICATED", message: "Selected OAuth account must be authenticated" });
    else if (model.account?.authMethod === "OAUTH" && model.account.cliAdapter !== model.cliAdapter) errors.push({ field: `${path}.modelProfileId`, code: "MODEL_ACCOUNT_ADAPTER_MISMATCH", message: "Selected OAuth account must match the CLI adapter" });
    else if (model.account?.authMethod === "API_KEY" && (!model.account.secretRefId || model.account.secretResolved === false)) errors.push({ field: `${path}.modelProfileId`, code: "MODEL_ACCOUNT_SECRET_UNRESOLVED", message: "Selected API-key account secret reference is unavailable" });
    else if ((model.readiness ?? (model.ready ? "READY" : "UNVERIFIED")) !== "READY" || (model.lifecycle ?? "ACTIVE") !== "ACTIVE") errors.push({ field: `${path}.modelProfileId`, code: "MODEL_NOT_READY", message: "Selected model must be READY and ACTIVE" });
    if (slot.role === "CHILD" && !slot.independenceGroup.trim()) errors.push({ field: `${path}.independenceGroup`, code: "REQUIRED", message: "Independence group is required" });
    for (const grant of [...slot.skillGrants, ...slot.mcpGrants]) {
      if (!effectiveKeys.has(typedKey(grant))) errors.push({ field: path, code: "CAPABILITY_UNAVAILABLE", capabilityKey: grant, message: `${grant.kind} ${grant.normalizedName} is disabled or unavailable` });
    }
  }
  const effectiveByKey = new Map(effectiveCatalog.filter((entry) => entry.effective !== false && entry.disabled !== true).map((entry) => [typedKey(entry), entry]));
  const selectedSlots = slots.filter(({ enabled }) => enabled);
  const selectedCapabilities = selectedSlots.flatMap((slot) => [...slot.skillGrants, ...slot.mcpGrants]);
  for (const grant of selectedCapabilities.filter(({ kind }) => kind === "SKILL")) {
    const capability = effectiveByKey.get(typedKey(grant));
    if (String(capability?.manifest?.signature ?? "").toUpperCase() !== "VERIFIED") {
      errors.push({ field: "agentSlots.grants", code: "SKILL_SIGNATURE_UNVERIFIED", capabilityKey: grant, message: `SKILL ${grant.normalizedName} must have a VERIFIED signature` });
    }
  }
  const boundary = String(securityPolicy?.dataBoundary ?? "").toUpperCase();
  if (!new Set(["WORKSPACE", "REPOSITORY", "EXTERNAL"]).has(boundary)) {
    errors.push({ field: "securityPolicy.dataBoundary", code: "SECURITY_DATA_BOUNDARY_INVALID", message: "Select a valid Workspace data boundary" });
  }
  const budgetLimit = Number(securityPolicy?.budgetLimit);
  if (!Number.isFinite(budgetLimit) || budgetLimit <= 0) {
    errors.push({ field: "securityPolicy.budgetLimit", code: "SECURITY_BUDGET_INVALID", message: "Budget must be a positive finite value" });
  }
  const mcpPermissionMode = String(securityPolicy?.mcpPermissionMode ?? "").toUpperCase();
  if (!new Set(["ALLOW_SELECTED_MCP", "DENY_MCP"]).has(mcpPermissionMode)) {
    errors.push({ field: "securityPolicy.mcpPermissionMode", code: "MCP_PERMISSION_INVALID", message: "Select an MCP permission mode" });
  } else if (selectedCapabilities.some(({ kind }) => kind === "MCP") && mcpPermissionMode === "DENY_MCP") {
    errors.push({ field: "securityPolicy.mcpPermissionMode", code: "MCP_PERMISSION_DENIED", message: "Selected MCP capabilities are denied by the security policy" });
  }
  const grantedHandleIds = uniqueStrings(securityPolicy?.grantedHandleIds, "securityPolicy.grantedHandleIds");
  const requiredHandleIds = [
    ...selectedCapabilities.flatMap((grant) => effectiveByKey.get(typedKey(grant))?.credentialHandleIds ?? []),
  ];
  for (const handleId of new Set(requiredHandleIds)) {
    if (!grantedHandleIds.includes(handleId)) {
      errors.push({ field: "securityPolicy.grantedHandleIds", code: "SECRET_GRANT_REQUIRED", credentialHandleId: handleId, message: `Scoped handle ${handleId} requires an explicit grant` });
    }
  }
  if (new Set(slots.map(({ id }) => id).filter(Boolean)).size !== slots.filter(({ id }) => id).length) errors.push({ field: "agentSlots", code: "DUPLICATE_SLOT_ID", message: "Agent slot ids must be unique" });
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function activateWorkspaceCapabilityDraft({ draft, modelProfiles = [], catalog, policyRevisions = [], securityPolicy = null, clock = () => new Date() }) {
  const resolvedSecurityPolicy = securityPolicy ?? policyRevisions.find(({ kind }) => kind === "SECURITY")?.content ?? {};
  const validation = validateWorkspaceCapabilityDraft({ draft, modelProfiles, effectiveCatalog: catalog.effective ?? catalog.entries ?? catalog, securityPolicy: resolvedSecurityPolicy });
  if (!validation.valid) throw new TypeError(`Workspace capability draft is invalid: ${validation.errors.map(({ field, code }) => `${field}:${code}`).join(", ")}`);
  const modelById = new Map(modelProfiles.map((model) => [model.profileId ?? model.id, model]));
  const effectiveByKey = new Map((catalog.effective ?? catalog.entries ?? catalog).filter((entry) => entry.effective !== false).map((entry) => [typedKey(entry), entry]));
  const materializeSlot = (slot) => ({
    ...slot,
    modelProfileRevisionId: modelById.get(slot.modelProfileId).id,
    skillRevisionIds: slot.skillGrants.map((grant) => effectiveByKey.get(typedKey(grant)).id),
    mcpRevisionIds: slot.mcpGrants.map((grant) => effectiveByKey.get(typedKey(grant)).id),
  });
  const identity = {
    workspaceId: draft.workspaceId,
    draftRevisionId: draft.id,
    draftRevision: draft.revision,
    mainAgentSlot: materializeSlot(draft.mainAgentSlot),
    childAgentSlots: draft.childAgentSlots.filter(({ enabled }) => enabled).map(materializeSlot),
    catalogProvenance: (catalog.effective ?? []).map(({ id, kind, normalizedName, source, contentDigest }) => ({ id, kind, normalizedName, source, contentDigest: contentDigest ?? null })),
    dependencyPolicyRevisionId: draft.dependencyPolicyRevisionId,
    conventionRevisionId: draft.conventionRevisionId,
    securityPolicyRevisionId: draft.securityPolicyRevisionId,
    policyProvenance: policyRevisions.map(({ id, kind, revision, contentDigest }) => ({ id, kind, revision, contentDigest })),
  };
  const legacyRole = (slot) => ({
    ...(slot.role === "CHILD" ? { id: slot.id, independenceGroup: slot.independenceGroup } : {}),
    model: slot.modelProfileRevisionId,
    skillNames: slot.skillGrants.map(({ normalizedName }) => normalizedName),
    mcpNames: slot.mcpGrants.map(({ normalizedName }) => normalizedName),
  });
  const usedModels = new Map();
  for (const slot of [identity.mainAgentSlot, ...identity.childAgentSlots]) {
    const model = modelById.get(slot.modelProfileId);
    usedModels.set(model.id, model);
  }
  const modelEntries = [...usedModels.values()].map((model) => ({
    logicalName: model.id,
    kind: "MODEL",
    manifest: {
      profileId: model.profileId ?? model.id,
      transport: model.transport ?? null,
      providerAdapter: model.providerAdapter ?? null,
      endpoint: model.endpoint ?? null,
      model: model.model ?? null,
      cliAdapter: model.cliAdapter ?? null,
    },
    sourceTemplateId: null,
    credentialHandleIds: model.credentialHandleId ? [model.credentialHandleId] : [],
  }));
  return deepFreeze({
    id: contentId("WORKSPACE-EXECUTION-PROFILE", identity),
    ...identity,
    configId: draft.id,
    configVersion: draft.revision,
    mainAgent: legacyRole(identity.mainAgentSlot),
    childSlots: identity.childAgentSlots.map(legacyRole),
    entries: [...modelEntries, ...(catalog.effective ?? []).map((entry) => ({
      logicalName: entry.normalizedName,
      kind: entry.kind,
      manifest: structuredClone(entry.manifest ?? {}),
      sourceTemplateId: entry.source === "GLOBAL" ? entry.id : null,
      credentialHandleIds: [...(entry.credentialHandleIds ?? [])],
    }))].sort((left, right) => left.kind.localeCompare(right.kind) || left.logicalName.localeCompare(right.logicalName)),
    dependencies: { revisionId: draft.dependencyPolicyRevisionId },
    conventions: { revisionId: draft.conventionRevisionId },
    policies: { securityPolicyRevisionId: draft.securityPolicyRevisionId },
    profileDigest: contentId("PROFILE-DIGEST", identity),
    createdAt: clock().toISOString(),
  });
}

/**
 * Advance only the active profile's references to a retiring global model.
 *
 * This deliberately does not derive a new active profile from the current
 * draft: an editor may have saved a newer Draft which has not been activated.
 * Replacing the old active profile must leave that Draft untouched.
 */
export function replaceWorkspaceExecutionProfileModel({
  profile,
  sourceProfileId,
  replacementProfile,
  replacementPlanId,
  replacementPlanVersion,
  clock = () => new Date(),
}) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new TypeError("Workspace execution profile must be an object");
  sourceProfileId = requireNonEmptyString(sourceProfileId, "sourceProfileId");
  const replacementId = requireNonEmptyString(replacementProfile?.id, "replacementProfile.id");
  const replacementProfileId = requireNonEmptyString(replacementProfile?.profileId ?? replacementProfile?.id, "replacementProfile.profileId");
  const hasReplacementAuthority = replacementPlanId !== undefined && replacementPlanId !== null;
  if (hasReplacementAuthority) {
    replacementPlanId = requireNonEmptyString(replacementPlanId, "replacementPlanId");
    if (!Number.isInteger(replacementPlanVersion) || replacementPlanVersion < 1) throw new TypeError("replacementPlanVersion must be a positive integer");
  } else if (replacementPlanVersion !== undefined && replacementPlanVersion !== null) {
    throw new TypeError("replacementPlanVersion requires replacementPlanId");
  }
  const slots = [profile.mainAgentSlot, ...(profile.childAgentSlots ?? [])].filter(Boolean);
  const sourceSlots = slots.filter(({ modelProfileId }) => modelProfileId === sourceProfileId);
  if (sourceSlots.length === 0) throw new TypeError(`Workspace execution profile does not reference source model ${sourceProfileId}`);
  const sourceRevisionIds = new Set(sourceSlots.map(({ modelProfileRevisionId }) => modelProfileRevisionId).filter(Boolean));
  const replaceSlot = (slot) => slot.modelProfileId === sourceProfileId
    ? { ...slot, modelProfileId: replacementProfileId, modelProfileRevisionId: replacementId }
    : structuredClone(slot);
  const mainAgentSlot = replaceSlot(profile.mainAgentSlot);
  const childAgentSlots = (profile.childAgentSlots ?? []).map(replaceSlot);
  const replacementEntry = {
    logicalName: replacementId,
    kind: "MODEL",
    manifest: {
      profileId: replacementProfileId,
      transport: replacementProfile.transport ?? null,
      providerAdapter: replacementProfile.providerAdapter ?? null,
      endpoint: replacementProfile.endpoint ?? null,
      model: replacementProfile.model ?? null,
      cliAdapter: replacementProfile.cliAdapter ?? null,
    },
    sourceTemplateId: null,
    credentialHandleIds: replacementProfile.credentialHandleId ? [replacementProfile.credentialHandleId] : [],
  };
  const modelEntries = new Map();
  for (const entry of profile.entries ?? []) {
    if (entry.kind !== "MODEL") continue;
    if (entry.manifest?.profileId === sourceProfileId || sourceRevisionIds.has(entry.logicalName)) continue;
    modelEntries.set(entry.logicalName, structuredClone(entry));
  }
  modelEntries.set(replacementEntry.logicalName, replacementEntry);
  const entries = [
    ...modelEntries.values(),
    ...(profile.entries ?? []).filter(({ kind }) => kind !== "MODEL").map((entry) => structuredClone(entry)),
  ].sort((left, right) => left.kind.localeCompare(right.kind) || left.logicalName.localeCompare(right.logicalName));
  const identity = {
    workspaceId: profile.workspaceId,
    draftRevisionId: null,
    draftRevision: null,
    replacementPlanId: replacementPlanId ?? null,
    replacementPlanVersion: replacementPlanVersion ?? null,
    replacesExecutionProfileRevisionId: hasReplacementAuthority ? profile.id : null,
    replacedDraftRevisionId: hasReplacementAuthority ? profile.draftRevisionId ?? null : null,
    mainAgentSlot,
    childAgentSlots,
    catalogProvenance: profile.catalogProvenance ?? [],
    dependencyPolicyRevisionId: profile.dependencyPolicyRevisionId,
    conventionRevisionId: profile.conventionRevisionId,
    securityPolicyRevisionId: profile.securityPolicyRevisionId,
    policyProvenance: profile.policyProvenance ?? [],
  };
  const legacyRole = (slot) => ({
    ...(slot.role === "CHILD" ? { id: slot.id, independenceGroup: slot.independenceGroup } : {}),
    model: slot.modelProfileRevisionId,
    skillNames: slot.skillGrants.map(({ normalizedName }) => normalizedName),
    mcpNames: slot.mcpGrants.map(({ normalizedName }) => normalizedName),
  });
  return deepFreeze({
    ...structuredClone(profile),
    id: contentId("WORKSPACE-EXECUTION-PROFILE", identity),
    ...identity,
    configId: replacementPlanId ?? profile.configId,
    configVersion: replacementPlanVersion ?? profile.configVersion,
    mainAgent: legacyRole(mainAgentSlot),
    childSlots: childAgentSlots.map(legacyRole),
    entries,
    profileDigest: contentId("PROFILE-DIGEST", identity),
    createdAt: clock().toISOString(),
  });
}

export function createCapabilityTemplateRevision(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("capability template must be an object");
  const kind = requireNonEmptyString(input.kind, "kind").toUpperCase();
  if (!capabilityKinds.has(kind)) throw new TypeError(`unsupported capability kind ${kind}`);
  const logicalName = requireNonEmptyString(input.logicalName, "logicalName");
  const revision = Number(input.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError("revision must be a positive integer");
  const lifecycle = String(input.lifecycle ?? "ACTIVE").toUpperCase();
  if (!new Set(["ACTIVE", "INACTIVE", "DELETED"]).has(lifecycle)) throw new TypeError("capability lifecycle must be ACTIVE, INACTIVE, or DELETED");
  const manifest = input.manifest && typeof input.manifest === "object" && !Array.isArray(input.manifest)
    ? structuredClone(input.manifest)
    : {};
  assertSecretFree(manifest, "capability manifest");
  return deepFreeze({
    id: contentId("CAPABILITY-TEMPLATE", { kind, logicalName, revision, lifecycle, manifest }),
    kind,
    logicalName,
    revision,
    lifecycle,
    manifest,
    credentialHandleIds: uniqueStrings(input.credentialHandleIds, "credentialHandleIds"),
    createdAt: clock().toISOString(),
  });
}

export function createWorkspaceCapabilityConfig(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Workspace capability config must be an object");
  const workspaceId = requireNonEmptyString(input.workspaceId, "workspaceId");
  const version = Number(input.version);
  if (!Number.isInteger(version) || version < 1) throw new TypeError("version must be a positive integer");
  const overrides = Array.isArray(input.overrides) ? input.overrides.map((entry, index) => ({
    logicalName: requireNonEmptyString(entry.logicalName, `overrides[${index}].logicalName`),
    kind: requireNonEmptyString(entry.kind, `overrides[${index}].kind`).toUpperCase(),
    manifest: structuredClone(entry.manifest ?? {}),
    credentialHandleIds: uniqueStrings(entry.credentialHandleIds, `overrides[${index}].credentialHandleIds`),
  })) : [];
  for (const override of overrides) {
    if (!capabilityKinds.has(override.kind)) throw new TypeError(`unsupported capability kind ${override.kind}`);
    assertSecretFree(override.manifest, `Workspace capability override ${override.logicalName}`);
  }
  const childSlots = (input.childSlots ?? [
    { id: "CHILD-1", model: input.mainAgent?.model, skillNames: [], mcpNames: [], independenceGroup: "DEFAULT-1" },
  ]).map((slot, index) => ({
    id: requireNonEmptyString(slot.id, `childSlots[${index}].id`),
    model: requireNonEmptyString(slot.model, `childSlots[${index}].model`),
    skillNames: uniqueStrings(slot.skillNames, `childSlots[${index}].skillNames`),
    mcpNames: uniqueStrings(slot.mcpNames, `childSlots[${index}].mcpNames`),
    independenceGroup: requireNonEmptyString(slot.independenceGroup, `childSlots[${index}].independenceGroup`),
  }));
  if (childSlots.length < 1) throw new TypeError("at least one Child Agent slot is required");
  if (new Set(childSlots.map(({ id }) => id)).size !== childSlots.length) throw new TypeError("Child Agent slot ids must be unique");
  return deepFreeze({
    id: contentId("WORKSPACE-CAPABILITY-CONFIG", { workspaceId, version, input }),
    workspaceId,
    version,
    mainAgent: {
      model: requireNonEmptyString(input.mainAgent?.model, "mainAgent.model"),
      skillNames: uniqueStrings(input.mainAgent?.skillNames, "mainAgent.skillNames"),
      mcpNames: uniqueStrings(input.mainAgent?.mcpNames, "mainAgent.mcpNames"),
    },
    childSlots,
    overrides,
    removals: uniqueStrings(input.removals, "removals"),
    dependencies: structuredClone(input.dependencies ?? {}),
    conventions: structuredClone(input.conventions ?? {}),
    policies: structuredClone(input.policies ?? {}),
    createdAt: clock().toISOString(),
  });
}

function materializedByName(templates, config) {
  const removed = new Set(config.removals);
  const result = new Map();
  for (const template of [...templates].sort((left, right) =>
    left.logicalName.localeCompare(right.logicalName) || right.revision - left.revision)) {
    if (!removed.has(template.logicalName) && !result.has(template.logicalName)) result.set(template.logicalName, template);
  }
  for (const override of config.overrides) {
    if (!removed.has(override.logicalName)) result.set(override.logicalName, override);
  }
  return result;
}

export function resolveWorkspaceExecutionProfile({ workspaceId, templates, config, clock = () => new Date() }) {
  if (config.workspaceId !== workspaceId) throw new TypeError("Workspace capability config scope does not match");
  const capabilities = materializedByName(templates, config);
  const requireCapability = (logicalName, kind, owner) => {
    const capability = capabilities.get(logicalName);
    if (!capability || capability.kind !== kind) throw new TypeError(`${owner} references unavailable ${kind} capability ${logicalName}`);
    return capability;
  };
  const materializeRole = (role, owner) => ({
    ...role,
    model: requireCapability(role.model, "MODEL", owner).logicalName,
    skillNames: role.skillNames.map((name) => requireCapability(name, "SKILL", owner).logicalName),
    mcpNames: role.mcpNames.map((name) => requireCapability(name, "MCP", owner).logicalName),
  });
  const mainAgent = materializeRole(config.mainAgent, "Main Agent");
  const childSlots = config.childSlots.map((slot) => materializeRole(slot, `Child slot ${slot.id}`));
  const entries = [...capabilities.values()]
    .map((entry) => ({
      logicalName: entry.logicalName,
      kind: entry.kind,
      manifest: structuredClone(entry.manifest),
      sourceTemplateId: entry.id ?? null,
      credentialHandleIds: [...(entry.credentialHandleIds ?? [])],
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.logicalName.localeCompare(right.logicalName));
  const identity = {
    workspaceId,
    configId: config.id,
    configVersion: config.version,
    mainAgent,
    childSlots,
    entries,
    dependencies: config.dependencies,
    conventions: config.conventions,
    policies: config.policies,
  };
  return deepFreeze({
    id: contentId("WORKSPACE-EXECUTION-PROFILE", identity),
    ...identity,
    profileDigest: contentId("PROFILE-DIGEST", identity),
    createdAt: clock().toISOString(),
  });
}

export function issueScopedSecretGrants(profile, { analysisRunId, expiresAt }) {
  analysisRunId = requireNonEmptyString(analysisRunId, "analysisRunId");
  const expiry = new Date(requireNonEmptyString(expiresAt, "expiresAt"));
  if (Number.isNaN(expiry.valueOf())) throw new TypeError("expiresAt must be an ISO timestamp");
  expiresAt = expiry.toISOString();
  const grants = [];
  const owners = [
    { slotId: "MAIN", role: profile.mainAgent },
    ...profile.childSlots.map((role) => ({ slotId: role.id, role })),
  ];
  const byKey = new Map(profile.entries.map((entry) => [`${entry.kind}\u0000${entry.logicalName}`, entry]));
  for (const { slotId, role } of owners) {
    const capabilities = [
      { kind: "MODEL", name: role.model },
      ...role.skillNames.map((name) => ({ kind: "SKILL", name })),
      ...role.mcpNames.map((name) => ({ kind: "MCP", name })),
    ];
    for (const { kind, name } of capabilities) {
      for (const credentialHandleId of byKey.get(`${kind}\u0000${name}`)?.credentialHandleIds ?? []) {
        grants.push({
          // Grants are server-issued bearer capabilities. Their ids must not be
          // derivable from otherwise-public scope claims.
          id: `SECRET-GRANT-${randomUUID()}`,
          workspaceId: profile.workspaceId,
          profileId: profile.id,
          analysisRunId,
          slotId,
          capabilityKind: kind,
          capabilityName: name,
          credentialHandleId,
          expiresAt,
        });
      }
    }
  }
  return deepFreeze(grants.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))));
}
