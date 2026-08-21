import type {
  CapabilityKey,
  ChildCapabilityRole,
  EffectiveCapabilityCatalog,
  GlobalModelProfile,
  WorkspaceCapabilityDraft,
} from "./product-foundation-client";

export type SecurityBoundaryDraft = {
  dataBoundary: "WORKSPACE" | "REPOSITORY" | "EXTERNAL";
  budgetLimit: string;
  mcpPermissionMode: "ALLOW_SELECTED_MCP" | "DENY_MCP";
  grantedHandleIds: string[];
  telemetryPolicy: "METADATA_ONLY" | "DISABLED";
};

export type ValidationSummary = {
  field: string;
  title: string;
  message: string;
  blocking: boolean;
};

export type EffectiveDiffEntry = {
  id: string;
  category: "CAPABILITY" | "AGENT" | "POLICY";
  change: "IMPORTED" | "OVERRIDE" | "ADDED" | "REMOVED" | "CHANGED" | "INHERITED";
  label: string;
  detail: string;
};

const typedKey = ({ kind, normalizedName }: CapabilityKey) => `${kind}:${normalizedName}`;

function selectedCapabilityNames(mainSkillNames: string[], mainMcpNames: string[], childSlots: ChildCapabilityRole[]) {
  return new Set([
    ...mainSkillNames.map((normalizedName) => `SKILL:${normalizedName}`),
    ...mainMcpNames.map((normalizedName) => `MCP:${normalizedName}`),
    ...childSlots.flatMap((slot) => [
      ...slot.skillNames.map((normalizedName) => `SKILL:${normalizedName}`),
      ...slot.mcpNames.map((normalizedName) => `MCP:${normalizedName}`),
    ]),
  ]);
}

export function buildDraftValidation({
  models,
  catalog,
  mainModel,
  mainRolePolicy,
  mainSkillNames,
  mainMcpNames,
  childSlots,
  security,
}: {
  models: GlobalModelProfile[];
  catalog: EffectiveCapabilityCatalog;
  mainModel: string;
  mainRolePolicy: string;
  mainSkillNames: string[];
  mainMcpNames: string[];
  childSlots: ChildCapabilityRole[];
  security: SecurityBoundaryDraft;
}): ValidationSummary[] {
  const summaries: ValidationSummary[] = [];
  const modelById = new Map(models.map((model) => [model.profileId, model]));
  const selected = selectedCapabilityNames(mainSkillNames, mainMcpNames, childSlots);
  const requiredHandleIds = catalog.entries
    .filter((entry) => selected.has(`${entry.kind}:${entry.normalizedName}`))
    .flatMap((entry) => entry.credentialHandleIds ?? []);
  const readyModel = (id: string) => {
    const model = modelById.get(id);
    return Boolean(model && model.readiness === "READY" && model.lifecycle === "ACTIVE");
  };

  if (!readyModel(mainModel)) {
    summaries.push({ field: "mainAgentSlot.modelProfileId", title: "Model Ready", message: "Main Agent must select a READY and ACTIVE model.", blocking: true });
  }
  if (!mainRolePolicy.trim()) {
    summaries.push({ field: "mainAgentSlot.rolePolicy", title: "Role policy", message: "Main Agent role policy is required.", blocking: true });
  }
  if (childSlots.length < 1) {
    summaries.push({ field: "childAgentSlots", title: "Child slots", message: "At least one enabled Child slot is required.", blocking: true });
  }
  childSlots.forEach((slot, index) => {
    if (!readyModel(slot.model)) {
      summaries.push({ field: `childAgentSlots[${index}].modelProfileId`, title: "Model Ready", message: `${slot.id} must select a READY and ACTIVE model.`, blocking: true });
    }
    if (!slot.rolePolicy.trim()) {
      summaries.push({ field: `childAgentSlots[${index}].rolePolicy`, title: "Role policy", message: `${slot.id} role policy is required.`, blocking: true });
    }
    if (!slot.independenceGroup.trim()) {
      summaries.push({ field: `childAgentSlots[${index}].independenceGroup`, title: "Independence group", message: `${slot.id} needs an independence group.`, blocking: true });
    }
  });
  const unavailableGrant = [...selected].find((value) => {
    const [kind, normalizedName] = value.split(":");
    return !catalog.entries.some((entry) => entry.kind === kind && entry.normalizedName === normalizedName && entry.effective);
  });
  if (unavailableGrant) {
    summaries.push({ field: "agentSlots.grants", title: unavailableGrant.startsWith("SKILL:") ? "Skill signature" : "MCP permission", message: `${unavailableGrant} is not in the effective Workspace catalog.`, blocking: true });
  }
  if (mainMcpNames.length + childSlots.reduce((total, slot) => total + slot.mcpNames.length, 0) > 0 && security.mcpPermissionMode === "DENY_MCP") {
    summaries.push({ field: "securityPolicy.mcpPermissionMode", title: "MCP permission", message: "Selected MCP grants are denied by the current boundary policy.", blocking: true });
  }
  const missingGrant = requiredHandleIds.find((id) => !security.grantedHandleIds.includes(id));
  if (missingGrant) {
    summaries.push({ field: "securityPolicy.grantedHandleIds", title: "Secret Grant", message: `Scoped handle ${missingGrant} requires an explicit grant.`, blocking: true });
  }
  if (!security.dataBoundary) {
    summaries.push({ field: "securityPolicy.dataBoundary", title: "Data boundary", message: "Select the data boundary for this Workspace.", blocking: true });
  }
  if (!security.budgetLimit.trim()) {
    summaries.push({ field: "securityPolicy.budgetLimit", title: "Budget", message: "Set a bounded execution budget.", blocking: true });
  }
  if (summaries.length === 0) {
    summaries.push({ field: "validation", title: "Validation summary", message: "Model readiness, capability signatures, MCP permissions, scoped grants, boundaries, and references are ready for server validation.", blocking: false });
  }
  return summaries;
}

export function buildEffectiveDiff({
  catalog,
  draft,
  disabledKeys,
  mainModel,
  mainRolePolicy,
  childSlots,
  security,
}: {
  catalog: EffectiveCapabilityCatalog;
  draft: WorkspaceCapabilityDraft | null;
  disabledKeys: CapabilityKey[];
  mainModel: string;
  mainRolePolicy: string;
  childSlots: ChildCapabilityRole[];
  security: SecurityBoundaryDraft;
}): EffectiveDiffEntry[] {
  const disabled = new Set(disabledKeys.map(typedKey));
  const capabilities = catalog.entries.map((entry) => ({
    id: `${entry.kind}:${entry.normalizedName}`,
    category: "CAPABILITY" as const,
    change: disabled.has(`${entry.kind}:${entry.normalizedName}`)
      ? "REMOVED" as const
      : entry.source === "PROJECT"
        ? entry.projectRelation === "OVERRIDE" ? "OVERRIDE" as const : "ADDED" as const
        : "IMPORTED" as const,
    label: `${entry.kind} · ${entry.normalizedName}`,
    detail: disabled.has(`${entry.kind}:${entry.normalizedName}`)
      ? "Explicitly removed from this Workspace Draft"
      : entry.source === "PROJECT"
        ? entry.projectRelation === "OVERRIDE" ? "Workspace override" : "Workspace addition"
        : "Imported from the global template catalog",
  }));
  const agentChanges: EffectiveDiffEntry[] = [];
  if (!draft || draft.mainAgentSlot.modelProfileId !== mainModel || draft.mainAgentSlot.rolePolicy !== mainRolePolicy) {
    agentChanges.push({ id: "main-agent", category: "AGENT", change: "CHANGED", label: "Main Agent", detail: `${mainModel || "No model"} · ${mainRolePolicy || "No role policy"}` });
  }
  if (!draft || draft.childAgentSlots.length !== childSlots.length) {
    agentChanges.push({ id: "child-slots", category: "AGENT", change: childSlots.length > (draft?.childAgentSlots.length ?? 0) ? "ADDED" : "REMOVED", label: "Child Agent slots", detail: `${childSlots.length} configured` });
  }
  const policyChanged = !draft
    || String(draft.securityPolicy?.dataBoundary ?? "") !== security.dataBoundary
    || String(draft.securityPolicy?.budgetLimit ?? "") !== security.budgetLimit
    || String(draft.securityPolicy?.mcpPermissionMode ?? "") !== security.mcpPermissionMode
    || String(draft.securityPolicy?.telemetryPolicy ?? "") !== security.telemetryPolicy;
  const policy = policyChanged
    ? [{ id: "security-policy", category: "POLICY" as const, change: "CHANGED" as const, label: "Security boundary", detail: `${security.dataBoundary} · budget ${security.budgetLimit || "not set"} · ${security.telemetryPolicy}` }]
    : [];
  return [...capabilities, ...agentChanges, ...policy];
}
