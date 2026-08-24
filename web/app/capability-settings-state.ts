import type {
  CapabilityKey,
  ChildCapabilityRole,
  EffectiveCapability,
  EffectiveCapabilityCatalog,
  GlobalCapabilityTemplate,
  GlobalModelProfile,
  WorkspaceCapabilityDraft,
  WorkspaceCapabilityDraftSaveInput,
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
  renderKey: string;
  source: "GLOBAL_TEMPLATE" | "WORKSPACE_OVERRIDE" | "WORKSPACE_ADDITION" | "WORKSPACE_CONFIGURATION";
  category: "CAPABILITY" | "AGENT" | "POLICY";
  change: "IMPORTED" | "OVERRIDE" | "ADDED" | "REMOVED" | "CHANGED" | "INHERITED";
  label: string;
  detail: string;
};

function effectiveDiffEntry(
  source: EffectiveDiffEntry["source"],
  entry: Omit<EffectiveDiffEntry, "renderKey" | "source">,
): EffectiveDiffEntry {
  return {
    ...entry,
    source,
    renderKey: `${source}:${entry.change}:${entry.category}:${entry.id}`,
  };
}

const typedKey = ({ kind, normalizedName }: CapabilityKey) => `${kind}:${normalizedName}`;

function canonicalValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalValue(entry)}`)
    .join(",")}}`;
}

function comparableSlot(slot: WorkspaceCapabilityDraftSaveInput["mainAgentSlot"]) {
  return {
    id: slot.id,
    role: slot.role,
    displayName: slot.displayName,
    modelProfileId: slot.modelProfileId,
    skillGrants: [...slot.skillGrants.map(typedKey)].sort(),
    mcpGrants: [...slot.mcpGrants.map(typedKey)].sort(),
    rolePolicy: slot.rolePolicy,
    independenceGroup: slot.independenceGroup,
    enabled: slot.enabled,
  };
}

function comparableDraft(input: Omit<WorkspaceCapabilityDraftSaveInput, "expectedVersion">) {
  return {
    mainAgentSlot: comparableSlot(input.mainAgentSlot),
    childAgentSlots: input.childAgentSlots.map(comparableSlot),
    projectCapabilityRevisionIds: [...input.projectCapabilityRevisionIds].sort(),
    importedKeys: [...input.importedKeys.map(typedKey)].sort(),
    disabledKeys: [...input.disabledKeys.map(typedKey)].sort(),
    dependencies: input.dependencies ?? {},
    conventions: input.conventions ?? {},
    securityPolicy: input.securityPolicy ?? {},
  };
}

export function hasUnsavedCapabilityDraftChanges(
  draft: WorkspaceCapabilityDraft | null,
  input: WorkspaceCapabilityDraftSaveInput,
): boolean {
  if (!draft || input.expectedVersion !== draft.revision) return true;
  return canonicalValue(comparableDraft(draft)) !== canonicalValue(comparableDraft(input));
}

export function buildLocalEffectiveCatalog({
  catalog,
  globalTemplates,
  importedKeys,
  disabledKeys,
}: {
  catalog: EffectiveCapabilityCatalog;
  globalTemplates: GlobalCapabilityTemplate[];
  importedKeys: CapabilityKey[];
  disabledKeys: CapabilityKey[];
}): EffectiveCapabilityCatalog {
  const availableTemplates = new Map<string, GlobalCapabilityTemplate>();
  for (const entry of catalog.entries.filter(({ source }) => source === "BUILTIN")) {
    availableTemplates.set(`${entry.kind}:${entry.normalizedName}`, {
      id: entry.id,
      kind: entry.kind,
      logicalName: entry.normalizedName,
      revision: entry.revision ?? 1,
      manifest: entry.manifest,
      credentialHandleIds: entry.credentialHandleIds ?? [],
      createdAt: "",
    });
  }
  for (const template of globalTemplates) {
    const normalizedName = template.logicalName.trim().toLowerCase();
    const key = `${template.kind}:${normalizedName}`;
    const prior = availableTemplates.get(key);
    if (!prior || template.revision > prior.revision) {
      availableTemplates.set(key, { ...template, logicalName: normalizedName });
    }
  }
  const imported = new Set(importedKeys.map(typedKey));
  const builtins = new Map<string, EffectiveCapability>();
  for (const [key, template] of availableTemplates) {
    if (!imported.has(key)) continue;
    builtins.set(key, {
      id: template.id,
      kind: template.kind,
      normalizedName: template.logicalName,
      revision: template.revision,
      source: "BUILTIN",
      disabled: false,
      effective: true,
      manifest: template.manifest,
      credentialHandleIds: template.credentialHandleIds,
    });
  }
  const projects = new Map<string, EffectiveCapability>();
  for (const entry of catalog.entries.filter(({ source }) => source === "PROJECT")) {
    const key = `${entry.kind}:${entry.normalizedName}`;
    const prior = projects.get(key);
    if (!prior || (entry.revision ?? 1) > (prior.revision ?? 1)) projects.set(key, entry);
  }
  const disabled = new Set(disabledKeys.map(typedKey));
  const merged = new Map(builtins);
  for (const [key, entry] of projects) {
    merged.set(key, {
      ...entry,
      projectRelation: availableTemplates.has(key) ? "OVERRIDE" : "ADDITION",
    });
  }
  const entries = [...merged.entries()]
    .map(([key, entry]) => ({ ...entry, disabled: disabled.has(key), effective: !disabled.has(key) }))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.normalizedName.localeCompare(right.normalizedName));
  return {
    entries,
    effective: entries.filter(({ effective }) => effective),
    summary: {
      builtinCount: [...builtins.keys()].filter((key) => !projects.has(key)).length,
      projectOverrideCount: [...projects.keys()].filter((key) => availableTemplates.has(key)).length,
      projectAdditionCount: [...projects.keys()].filter((key) => !availableTemplates.has(key)).length,
      disabledCount: entries.filter(({ disabled }) => disabled).length,
      effectiveCount: entries.filter(({ effective }) => effective).length,
    },
  };
}

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
  draft = null,
  importedKeys,
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
  draft?: WorkspaceCapabilityDraft | null;
  importedKeys?: CapabilityKey[];
  disabledKeys?: CapabilityKey[];
}): ValidationSummary[] {
  const summaries: ValidationSummary[] = [];
  const modelById = new Map(models.map((model) => [model.profileId, model]));
  const locallyDisabled = new Set(disabledKeys.map(typedKey));
  const savedImported = new Set((draft?.importedKeys ?? []).map(typedKey));
  const currentImported = new Set((importedKeys ?? draft?.importedKeys ?? []).map(typedKey));
  const locallyUnimported = new Set([...savedImported].filter((key) => !currentImported.has(key)));
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
  const locallyUnimportedGrant = [...selected].find((value) => locallyUnimported.has(value));
  if (locallyUnimportedGrant) {
    summaries.push({ field: "agentSlots.grants", title: "Capability import", message: `${locallyUnimportedGrant} is removed from this unsaved Workspace Draft.`, blocking: true });
  }
  const unavailableGrant = [...selected].find((value) => {
    const [kind, normalizedName] = value.split(":");
    return locallyDisabled.has(value) || locallyUnimported.has(value) || !catalog.entries.some((entry) => entry.kind === kind && entry.normalizedName === normalizedName && entry.effective);
  });
  if (unavailableGrant && unavailableGrant !== locallyUnimportedGrant) {
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
  dependencyNotes = "",
  conventionNotes = "",
  securityNotes = "",
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
  dependencyNotes?: string;
  conventionNotes?: string;
  securityNotes?: string;
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
      return effectiveDiffEntry("GLOBAL_TEMPLATE", {
        id,
        category: "CAPABILITY",
        change,
        label: `${template.kind} · ${template.logicalName}`,
        detail,
      });
    });
  for (const entry of catalog.entries.filter(({ source }) => source === "PROJECT")) {
    const id = `${entry.kind}:${entry.normalizedName}`;
    const change = disabled.has(id) ? "REMOVED" : entry.projectRelation === "OVERRIDE" ? "OVERRIDE" : "ADDED";
    capabilities.push(effectiveDiffEntry(
      entry.projectRelation === "OVERRIDE" ? "WORKSPACE_OVERRIDE" : "WORKSPACE_ADDITION",
      {
        id,
        category: "CAPABILITY",
        change,
        label: `${entry.kind} · ${entry.normalizedName}`,
        detail: disabled.has(id) ? "Explicitly removed from this Workspace Draft" : entry.projectRelation === "OVERRIDE" ? "Workspace override" : "Workspace addition",
      },
    ));
  }
  const slotDetail = (slot: ChildCapabilityRole | WorkspaceCapabilityDraft["mainAgentSlot"]) => {
    const skills = "skillNames" in slot ? slot.skillNames : slot.skillGrants.map(({ normalizedName }) => normalizedName);
    const mcps = "mcpNames" in slot ? slot.mcpNames : slot.mcpGrants.map(({ normalizedName }) => normalizedName);
    const model = "model" in slot ? slot.model : slot.modelProfileId;
    return `${model || "No model"} · ${slot.rolePolicy || "No role policy"} · Skills ${[...skills].sort().join(",") || "—"} · MCP ${[...mcps].sort().join(",") || "—"}`;
  };
  const savedChildren = new Map((draft?.childAgentSlots ?? []).map((slot) => [slot.id, slot]));
  const agentChanges: EffectiveDiffEntry[] = [effectiveDiffEntry("WORKSPACE_CONFIGURATION", {
    id: "main-agent",
    category: "AGENT",
    change: !draft || slotDetail(draft.mainAgentSlot) !== slotDetail({ ...draft.mainAgentSlot, modelProfileId: mainModel, rolePolicy: mainRolePolicy, skillGrants: mainSkillNames.map((normalizedName) => ({ kind: "SKILL" as const, normalizedName })), mcpGrants: mainMcpNames.map((normalizedName) => ({ kind: "MCP" as const, normalizedName })) }) ? "CHANGED" : "INHERITED",
    label: "Main Agent",
    detail: `${mainModel || "No model"} · ${mainRolePolicy || "No role policy"} · Skills ${[...mainSkillNames].sort().join(",") || "—"} · MCP ${[...mainMcpNames].sort().join(",") || "—"}`,
  })];
  for (const slot of childSlots) {
    const saved = savedChildren.get(slot.id);
    agentChanges.push(effectiveDiffEntry("WORKSPACE_CONFIGURATION", {
      id: `child-slot:${slot.id}`,
      category: "AGENT",
      change: !saved ? "ADDED" : slotDetail(saved) === slotDetail(slot) && saved.independenceGroup === slot.independenceGroup ? "INHERITED" : "CHANGED",
      label: `Child Agent ${slot.id}`,
      detail: `${slotDetail(slot)} · Group ${slot.independenceGroup || "not set"}`,
    }));
    savedChildren.delete(slot.id);
  }
  for (const slot of savedChildren.values()) {
    agentChanges.push(effectiveDiffEntry("WORKSPACE_CONFIGURATION", { id: `child-slot:${slot.id}`, category: "AGENT", change: "REMOVED", label: `Child Agent ${slot.id}`, detail: "Removed from this Workspace Draft" }));
  }
  const savedPolicy = draft?.securityPolicy ?? {};
  const securityNotesChanged = String(savedPolicy.notes ?? "") !== securityNotes;
  const policyDetail = `${security.dataBoundary} · budget ${security.budgetLimit || "not set"} · ${security.mcpPermissionMode} · ${security.telemetryPolicy} · ${security.grantedHandleIds.length} scoped grants${securityNotesChanged ? " · security notes changed" : ""}`;
  const policyChanged = !draft
    || String(savedPolicy.dataBoundary ?? "") !== security.dataBoundary
    || String(savedPolicy.budgetLimit ?? "") !== security.budgetLimit
    || String(savedPolicy.mcpPermissionMode ?? "") !== security.mcpPermissionMode
    || String(savedPolicy.telemetryPolicy ?? "") !== security.telemetryPolicy
    || securityNotesChanged
    || JSON.stringify([...(Array.isArray(savedPolicy.grantedHandleIds) ? savedPolicy.grantedHandleIds : [])].sort()) !== JSON.stringify([...security.grantedHandleIds].sort());
  const policy = [effectiveDiffEntry("WORKSPACE_CONFIGURATION", { id: "security-policy", category: "POLICY", change: policyChanged ? "CHANGED" : "INHERITED", label: "Security boundary", detail: policyDetail })];
  const draftNotes = (value: Record<string, unknown> | undefined) => String(value?.notes ?? "");
  const workspaceMetadata: EffectiveDiffEntry[] = [
    effectiveDiffEntry("WORKSPACE_CONFIGURATION", {
      id: "dependencies",
      category: "POLICY" as const,
      change: !draft || draftNotes(draft.dependencies) !== dependencyNotes ? "CHANGED" : "INHERITED",
      label: "Dependencies",
      detail: !draft || draftNotes(draft.dependencies) !== dependencyNotes ? "Workspace dependency notes changed" : "Workspace dependency notes inherited",
    }),
    effectiveDiffEntry("WORKSPACE_CONFIGURATION", {
      id: "conventions",
      category: "POLICY" as const,
      change: !draft || draftNotes(draft.conventions) !== conventionNotes ? "CHANGED" : "INHERITED",
      label: "Conventions and constraints",
      detail: !draft || draftNotes(draft.conventions) !== conventionNotes ? "Workspace convention notes changed" : "Workspace convention notes inherited",
    }),
  ];
  return [...capabilities, ...agentChanges, ...workspaceMetadata, ...policy].sort((left, right) => left.category.localeCompare(right.category) || left.id.localeCompare(right.id));
}
