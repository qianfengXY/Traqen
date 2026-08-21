import type {
  CapabilityKey,
  ChildCapabilityRole,
  EffectiveCapabilityCatalog,
  GlobalCapabilityTemplate,
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
  disabledKeys = [],
}: {
  models: GlobalModelProfile[];
  catalog: EffectiveCapabilityCatalog;
  mainModel: string;
  mainRolePolicy: string;
  mainSkillNames: string[];
  mainMcpNames: string[];
  childSlots: ChildCapabilityRole[];
  security: SecurityBoundaryDraft;
  disabledKeys?: CapabilityKey[];
}): ValidationSummary[] {
  const summaries: ValidationSummary[] = [];
  const modelById = new Map(models.map((model) => [model.profileId, model]));
  const locallyDisabled = new Set(disabledKeys.map(typedKey));
  const selected = selectedCapabilityNames(mainSkillNames, mainMcpNames, childSlots);
  const requiredHandleIds = catalog.entries
    .filter((entry) => selected.has(`${entry.kind}:${entry.normalizedName}`) && !locallyDisabled.has(`${entry.kind}:${entry.normalizedName}`))
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
    return locallyDisabled.has(value) || !catalog.entries.some((entry) => entry.kind === kind && entry.normalizedName === normalizedName && entry.effective);
  });
  if (unavailableGrant) {
    summaries.push({ field: "agentSlots.grants", title: unavailableGrant.startsWith("SKILL:") ? "Skill signature" : "MCP permission", message: `${unavailableGrant} is not in the effective Workspace catalog.`, blocking: true });
  }
  const unsignedSkill = [...selected].find((value) => {
    const [kind, normalizedName] = value.split(":");
    const entry = catalog.entries.find((candidate) => candidate.kind === kind && candidate.normalizedName === normalizedName);
    return kind === "SKILL" && !locallyDisabled.has(value) && entry && String(entry.manifest.signature ?? "").toUpperCase() !== "VERIFIED";
  });
  if (unsignedSkill) {
    summaries.push({ field: "agentSlots.grants", title: "Skill signature", message: `${unsignedSkill} must have a VERIFIED signature.`, blocking: true });
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
  globalTemplates = [],
  draft,
  importedKeys,
  disabledKeys,
  mainModel,
  mainRolePolicy,
  mainSkillNames = [],
  mainMcpNames = [],
  childSlots,
  security,
}: {
  catalog: EffectiveCapabilityCatalog;
  globalTemplates?: GlobalCapabilityTemplate[];
  draft: WorkspaceCapabilityDraft | null;
  importedKeys?: CapabilityKey[];
  disabledKeys: CapabilityKey[];
  mainModel: string;
  mainRolePolicy: string;
  mainSkillNames?: string[];
  mainMcpNames?: string[];
  childSlots: ChildCapabilityRole[];
  security: SecurityBoundaryDraft;
}): EffectiveDiffEntry[] {
  const disabled = new Set(disabledKeys.map(typedKey));
  const latestTemplates = new Map<string, GlobalCapabilityTemplate>();
  for (const template of globalTemplates) {
    const normalizedName = template.logicalName.trim().toLowerCase();
    const id = `${template.kind}:${normalizedName}`;
    const prior = latestTemplates.get(id);
    if (!prior || template.revision > prior.revision) latestTemplates.set(id, { ...template, logicalName: normalizedName });
  }
  if (latestTemplates.size === 0) {
    for (const entry of catalog.entries.filter(({ source }) => source === "BUILTIN")) {
      latestTemplates.set(`${entry.kind}:${entry.normalizedName}`, {
        id: entry.id,
        kind: entry.kind,
        logicalName: entry.normalizedName,
        revision: entry.revision ?? 1,
        manifest: entry.manifest,
        credentialHandleIds: entry.credentialHandleIds ?? [],
        createdAt: "",
      });
    }
  }
  const templateKeys = [...latestTemplates.keys()];
  const currentImported = new Set((importedKeys ?? templateKeys.map((id) => {
    const [kind, normalizedName] = id.split(":");
    return { kind: kind as CapabilityKey["kind"], normalizedName };
  })).map(typedKey));
  const savedImported = new Set((draft?.importedKeys ?? (draft ? templateKeys.map((id) => {
    const [kind, normalizedName] = id.split(":");
    return { kind: kind as CapabilityKey["kind"], normalizedName };
  }) : [])).map(typedKey));
  const savedDisabled = new Set((draft?.disabledKeys ?? []).map(typedKey));
  const capabilities: EffectiveDiffEntry[] = templateKeys
    .filter((id) => currentImported.has(id) || savedImported.has(id))
    .sort()
    .map((id) => {
      const template = latestTemplates.get(id)!;
      const currentlyImported = currentImported.has(id);
      const currentlyDisabled = disabled.has(id);
      const wasImported = savedImported.has(id);
      const wasDisabled = savedDisabled.has(id);
      const change = !currentlyImported || currentlyDisabled
        ? "REMOVED" as const
        : !wasImported
          ? "IMPORTED" as const
          : wasDisabled
            ? "CHANGED" as const
            : "INHERITED" as const;
      const detail = !currentlyImported
        ? "Removed from this Workspace Draft"
        : currentlyDisabled
          ? "Explicitly removed after template import"
          : !wasImported
            ? `Imported global template revision ${template.revision}`
            : wasDisabled
              ? "Restored from an explicit removal"
              : `Inherited global template revision ${template.revision}`;
      return { id, category: "CAPABILITY" as const, change, label: `${template.kind} · ${template.logicalName}`, detail };
    });
  for (const entry of catalog.entries.filter(({ source }) => source === "PROJECT")) {
    const id = `${entry.kind}:${entry.normalizedName}`;
    capabilities.push({
      id,
      category: "CAPABILITY",
      change: disabled.has(id) ? "REMOVED" : entry.projectRelation === "OVERRIDE" ? "OVERRIDE" : "ADDED",
      label: `${entry.kind} · ${entry.normalizedName}`,
      detail: disabled.has(id) ? "Explicitly removed from this Workspace Draft" : entry.projectRelation === "OVERRIDE" ? "Workspace override" : "Workspace addition",
    });
  }
  const slotDetail = (slot: ChildCapabilityRole | WorkspaceCapabilityDraft["mainAgentSlot"]) => {
    const skills = "skillNames" in slot ? slot.skillNames : slot.skillGrants.map(({ normalizedName }) => normalizedName);
    const mcps = "mcpNames" in slot ? slot.mcpNames : slot.mcpGrants.map(({ normalizedName }) => normalizedName);
    const model = "model" in slot ? slot.model : slot.modelProfileId;
    return `${model || "No model"} · ${slot.rolePolicy || "No role policy"} · Skills ${[...skills].sort().join(",") || "—"} · MCP ${[...mcps].sort().join(",") || "—"}`;
  };
  const savedChildren = new Map((draft?.childAgentSlots ?? []).map((slot) => [slot.id, slot]));
  const agentChanges: EffectiveDiffEntry[] = [{
    id: "main-agent",
    category: "AGENT",
    change: !draft || slotDetail(draft.mainAgentSlot) !== slotDetail({ ...draft.mainAgentSlot, modelProfileId: mainModel, rolePolicy: mainRolePolicy, skillGrants: mainSkillNames.map((normalizedName) => ({ kind: "SKILL" as const, normalizedName })), mcpGrants: mainMcpNames.map((normalizedName) => ({ kind: "MCP" as const, normalizedName })) }) ? "CHANGED" : "INHERITED",
    label: "Main Agent",
    detail: `${mainModel || "No model"} · ${mainRolePolicy || "No role policy"}`,
  }];
  for (const slot of childSlots) {
    const saved = savedChildren.get(slot.id);
    agentChanges.push({
      id: `child-slot:${slot.id}`,
      category: "AGENT",
      change: !saved ? "ADDED" : slotDetail(saved) === slotDetail(slot) && saved.independenceGroup === slot.independenceGroup ? "INHERITED" : "CHANGED",
      label: `Child Agent ${slot.id}`,
      detail: `${slotDetail(slot)} · Group ${slot.independenceGroup || "not set"}`,
    });
    savedChildren.delete(slot.id);
  }
  for (const slot of savedChildren.values()) {
    agentChanges.push({ id: `child-slot:${slot.id}`, category: "AGENT", change: "REMOVED", label: `Child Agent ${slot.id}`, detail: "Removed from this Workspace Draft" });
  }
  const savedPolicy = draft?.securityPolicy ?? {};
  const policyDetail = `${security.dataBoundary} · budget ${security.budgetLimit || "not set"} · ${security.mcpPermissionMode} · ${security.telemetryPolicy} · ${security.grantedHandleIds.length} scoped grants`;
  const policyChanged = !draft
    || String(savedPolicy.dataBoundary ?? "") !== security.dataBoundary
    || String(savedPolicy.budgetLimit ?? "") !== security.budgetLimit
    || String(savedPolicy.mcpPermissionMode ?? "") !== security.mcpPermissionMode
    || String(savedPolicy.telemetryPolicy ?? "") !== security.telemetryPolicy
    || JSON.stringify([...(Array.isArray(savedPolicy.grantedHandleIds) ? savedPolicy.grantedHandleIds : [])].sort()) !== JSON.stringify([...security.grantedHandleIds].sort());
  const policy = [{ id: "security-policy", category: "POLICY" as const, change: policyChanged ? "CHANGED" as const : "INHERITED" as const, label: "Security boundary", detail: policyDetail }];
  return [...capabilities, ...agentChanges, ...policy].sort((left, right) => left.category.localeCompare(right.category) || left.id.localeCompare(right.id));
}
