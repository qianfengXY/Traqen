import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

const capabilityKinds = new Set(["MODEL", "SKILL", "MCP"]);

function assertSecretFree(value, fieldName) {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:secret|password|api[_-]?key|access[_-]?token|credential[_-]?value)/i.test(key)) {
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

export function createCapabilityTemplateRevision(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("capability template must be an object");
  const kind = requireNonEmptyString(input.kind, "kind").toUpperCase();
  if (!capabilityKinds.has(kind)) throw new TypeError(`unsupported capability kind ${kind}`);
  const logicalName = requireNonEmptyString(input.logicalName, "logicalName");
  const revision = Number(input.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError("revision must be a positive integer");
  const manifest = input.manifest && typeof input.manifest === "object" && !Array.isArray(input.manifest)
    ? structuredClone(input.manifest)
    : {};
  assertSecretFree(manifest, "capability manifest");
  return deepFreeze({
    id: contentId("CAPABILITY-TEMPLATE", { kind, logicalName, revision, manifest }),
    kind,
    logicalName,
    revision,
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
    { id: "CHILD-2", model: input.mainAgent?.model, skillNames: [], mcpNames: [], independenceGroup: "DEFAULT-2" },
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
  const byName = new Map(profile.entries.map((entry) => [entry.logicalName, entry]));
  for (const { slotId, role } of owners) {
    for (const name of [role.model, ...role.skillNames, ...role.mcpNames]) {
      for (const credentialHandleId of byName.get(name)?.credentialHandleIds ?? []) {
        grants.push({
          id: contentId("SECRET-GRANT", { profileId: profile.id, analysisRunId, slotId, name, credentialHandleId }),
          workspaceId: profile.workspaceId,
          profileId: profile.id,
          analysisRunId,
          slotId,
          capabilityName: name,
          credentialHandleId,
          expiresAt,
        });
      }
    }
  }
  return deepFreeze(grants.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))));
}
