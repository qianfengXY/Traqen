export type CapabilityTemplate = {
  id: string;
  kind: "MODEL" | "SKILL" | "MCP";
  logicalName: string;
  revision: number;
  manifest: Record<string, unknown>;
  credentialHandleIds: string[];
  createdAt: string;
};

export type GlobalModelProfile = {
  id: string;
  profileId: string;
  currentRevisionId: string;
  revision: number;
  displayName: string;
  transport: "API" | "CLI";
  readiness: "UNVERIFIED" | "READY" | "ERROR";
  lifecycle: "ACTIVE" | "RETIRING" | "RETIRED";
  endpoint?: string;
  model?: string;
};

export type CapabilityKey = { kind: "SKILL" | "MCP"; normalizedName: string };

export type EffectiveCapability = CapabilityKey & {
  id: string;
  revision?: number;
  source: "BUILTIN" | "PROJECT";
  projectRelation?: "OVERRIDE" | "ADDITION";
  disabled: boolean;
  effective: boolean;
  manifest: Record<string, unknown>;
};

export type EffectiveCapabilityCatalog = {
  entries: EffectiveCapability[];
  effective: EffectiveCapability[];
  summary: { builtinCount: number; projectOverrideCount: number; projectAdditionCount: number; disabledCount: number; effectiveCount: number };
};

export type AgentSlotDraft = {
  id: string;
  role: "MAIN" | "CHILD";
  displayName: string;
  modelProfileId: string;
  skillGrants: CapabilityKey[];
  mcpGrants: CapabilityKey[];
  independenceGroup: string;
  enabled: boolean;
};

export type WorkspaceCapabilityDraft = {
  id: string;
  workspaceId: string;
  revision: number;
  mainAgentSlot: AgentSlotDraft;
  childAgentSlots: AgentSlotDraft[];
  disabledKeys: CapabilityKey[];
  projectCapabilityRevisionIds: string[];
  dependencyPolicyRevisionId: string;
  conventionRevisionId: string;
  securityPolicyRevisionId: string;
  dependencies: Record<string, unknown>;
  conventions: Record<string, unknown>;
  securityPolicy: Record<string, unknown>;
  createdAt: string;
};

export type CapabilityRole = {
  model: string;
  skillNames: string[];
  mcpNames: string[];
};

export type ChildCapabilityRole = CapabilityRole & {
  id: string;
  independenceGroup: string;
};

export type WorkspaceCapabilityConfig = {
  id: string;
  workspaceId: string;
  version: number;
  mainAgent: CapabilityRole;
  childSlots: ChildCapabilityRole[];
  overrides: Array<Record<string, unknown>>;
  removals: string[];
  dependencies: Record<string, unknown>;
  conventions: Record<string, unknown>;
  policies: Record<string, unknown>;
  createdAt: string;
};

export type ExecutionProfile = WorkspaceCapabilityConfig & {
  configId: string;
  configVersion: number;
  entries: Array<{ logicalName: string; kind: "MODEL" | "SKILL" | "MCP"; sourceTemplateId: string | null }>;
  profileDigest: string;
};

export type ReviewQueueItem = {
  id: string;
  workspaceId: string;
  status: string;
  version: number;
  severity?: string;
  evidenceState?: string;
  source?: string;
  analysisBatchId?: string;
  reviewerId?: string;
  rationale?: string;
  decidedAt?: string;
  [key: string]: unknown;
};

function headers(apiToken: string, json = false, reviewerToken = false) {
  const token = apiToken.trim();
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(token ? { "x-traqen-api-token": token } : {}),
    ...(reviewerToken && token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Traqen API returned ${response.status}`);
  return body;
}

function base(apiBase: string) {
  return apiBase.replace(/\/$/, "");
}

export async function getConnectionHealth(apiBase: string) {
  const response = await fetch(`${base(apiBase)}/health`, { method: "GET" });
  if (!response.ok) throw new Error(`Traqen API returned ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function listCapabilityTemplates(apiBase: string, apiToken: string) {
  const response = await fetch(`${base(apiBase)}/v1/capability-templates`, {
    method: "GET",
    headers: headers(apiToken),
  });
  return (await parseJson<{ templates: CapabilityTemplate[] }>(response)).templates;
}

export async function listGlobalModels(apiBase: string, apiToken: string) {
  const response = await fetch(`${base(apiBase)}/v1/global-models`, { method: "GET", headers: headers(apiToken) });
  return (await parseJson<{ models: GlobalModelProfile[] }>(response)).models;
}

export async function createGlobalModel(apiBase: string, apiToken: string, input: Record<string, unknown>) {
  const response = await fetch(`${base(apiBase)}/v1/global-models`, { method: "POST", headers: headers(apiToken, true), body: JSON.stringify(input) });
  return parseJson<Record<string, unknown>>(response);
}

export async function verifyGlobalModel(apiBase: string, apiToken: string, profileId: string) {
  const response = await fetch(`${base(apiBase)}/v1/global-models/${encodeURIComponent(profileId)}/verify`, { method: "POST", headers: headers(apiToken) });
  return parseJson<Record<string, unknown>>(response);
}

export type GlobalModelUsage = {
  profileId: string;
  usageCount: number;
  references: Array<{ workspaceId: string; workspaceName: string; source: "DRAFT_HEAD" | "ACTIVE_PROFILE_HEAD" | "ACTIVE_RUN"; slotId: string; profileRevisionId?: string; runId?: string }>;
};

export async function getGlobalModelUsage(apiBase: string, apiToken: string, profileId: string) {
  const response = await fetch(`${base(apiBase)}/v1/global-models/${encodeURIComponent(profileId)}/usage`, { method: "GET", headers: headers(apiToken) });
  return parseJson<GlobalModelUsage>(response);
}

export type ModelReplacementPlan = {
  id: string;
  version: number;
  status: "READY" | "APPLYING" | "APPLIED";
  sourceProfileId: string;
  replacementProfileId: string;
  references: GlobalModelUsage["references"];
  changes: Array<{ workspaceId: string; workspaceName: string }>;
};

export async function createGlobalModelReplacementPlan(apiBase: string, apiToken: string, profileId: string, replacementProfileId: string) {
  const response = await fetch(`${base(apiBase)}/v1/global-models/${encodeURIComponent(profileId)}/replacement-plans`, {
    method: "POST", headers: headers(apiToken, true), body: JSON.stringify({ replacementProfileId }),
  });
  return parseJson<ModelReplacementPlan>(response);
}

export async function applyGlobalModelReplacementPlan(apiBase: string, apiToken: string, profileId: string, planId: string, expectedVersion: number) {
  const response = await fetch(`${base(apiBase)}/v1/global-models/${encodeURIComponent(profileId)}/replacement-plans/${encodeURIComponent(planId)}/apply`, {
    method: "POST", headers: headers(apiToken, true), body: JSON.stringify({ expectedVersion }),
  });
  return parseJson<{ plan: ModelReplacementPlan; workspaces: Array<{ workspaceId: string }> }>(response);
}

export async function retireGlobalModel(apiBase: string, apiToken: string, profileId: string) {
  const response = await fetch(`${base(apiBase)}/v1/global-models/${encodeURIComponent(profileId)}/retire`, { method: "POST", headers: headers(apiToken) });
  return parseJson<GlobalModelProfile>(response);
}

export async function getEffectiveCapabilities(apiBase: string, apiToken: string, workspaceId: string) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/capabilities/effective`, { method: "GET", headers: headers(apiToken) });
  return parseJson<EffectiveCapabilityCatalog>(response);
}

export async function saveProjectCapability(apiBase: string, apiToken: string, workspaceId: string, input: { kind: "SKILL" | "MCP"; normalizedName: string; expectedVersion: number; manifest: Record<string, unknown>; credentialHandleIds?: string[] }) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/project-capabilities`, { method: "POST", headers: headers(apiToken, true), body: JSON.stringify(input) });
  return parseJson<Record<string, unknown>>(response);
}

export async function deleteProjectCapability(apiBase: string, apiToken: string, workspaceId: string, kind: "SKILL" | "MCP", normalizedName: string, expectedVersion: number) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/project-capabilities/${kind}/${encodeURIComponent(normalizedName)}?expectedVersion=${expectedVersion}`, { method: "DELETE", headers: headers(apiToken) });
  return parseJson<Record<string, unknown>>(response);
}

export async function getWorkspaceCapabilityDraft(apiBase: string, apiToken: string, workspaceId: string) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/capability-draft`, { method: "GET", headers: headers(apiToken) });
  return (await parseJson<{ draft: WorkspaceCapabilityDraft | null }>(response)).draft;
}

export async function saveWorkspaceCapabilityDraft(apiBase: string, apiToken: string, workspaceId: string, input: {
  expectedVersion: number; mainAgentSlot: AgentSlotDraft; childAgentSlots: AgentSlotDraft[];
  projectCapabilityRevisionIds: string[]; disabledKeys: CapabilityKey[];
  dependencies?: Record<string, unknown>; conventions?: Record<string, unknown>; securityPolicy?: Record<string, unknown>;
}) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/capability-draft`, {
    method: "PUT", headers: headers(apiToken, true), body: JSON.stringify(input),
  });
  return parseJson<WorkspaceCapabilityDraft>(response);
}

export async function validateWorkspaceCapabilityDraft(apiBase: string, apiToken: string, workspaceId: string) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/capability-draft/validate`, { method: "POST", headers: headers(apiToken) });
  return parseJson<{ validation: { valid: boolean; errors: Array<{ field: string; code: string; message: string }> } }>(response);
}

export async function activateWorkspaceCapabilityDraft(apiBase: string, apiToken: string, workspaceId: string) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/capability-draft/activate`, { method: "POST", headers: headers(apiToken) });
  return parseJson<ExecutionProfile>(response);
}

export async function saveWorkspaceCapabilityConfig(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
  input: Omit<WorkspaceCapabilityConfig, "id" | "workspaceId" | "version" | "createdAt">,
) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/capability-configs`, {
    method: "POST",
    headers: headers(apiToken, true),
    body: JSON.stringify(input),
  });
  return parseJson<WorkspaceCapabilityConfig>(response);
}

export async function listWorkspaceCapabilityConfigs(apiBase: string, apiToken: string, workspaceId: string) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/capability-configs`, {
    method: "GET",
    headers: headers(apiToken),
  });
  return (await parseJson<{ configs: WorkspaceCapabilityConfig[] }>(response)).configs;
}

export async function resolveWorkspaceExecutionProfile(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
  configId?: string,
) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/execution-profile-revisions`, {
    method: "POST",
    headers: headers(apiToken, true),
    body: JSON.stringify(configId ? { configId } : {}),
  });
  return parseJson<ExecutionProfile>(response);
}

export async function listWorkspaceExecutionProfiles(apiBase: string, apiToken: string, workspaceId: string) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/execution-profile-revisions`, {
    method: "GET",
    headers: headers(apiToken),
  });
  return (await parseJson<{ profiles: ExecutionProfile[] }>(response)).profiles;
}

export async function getWorkspaceReviewQueue(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
  filters: Record<string, string> = {},
) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  const suffix = query.size ? `?${query}` : "";
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/review-queue${suffix}`, {
    method: "GET",
    headers: headers(apiToken),
  });
  return (await parseJson<{ items: ReviewQueueItem[] }>(response)).items;
}

export async function decideWorkspaceReviewBatch(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
  input: { itemIds: string[]; outcome: string; rationale: string; edits?: Record<string, unknown> },
) {
  const response = await fetch(`${base(apiBase)}/v1/workspaces/${encodeURIComponent(workspaceId)}/review-decisions/batch`, {
    method: "POST",
    headers: headers(apiToken, true, true),
    body: JSON.stringify(input),
  });
  return parseJson<Record<string, unknown>>(response);
}
