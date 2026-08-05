export type CapabilityTemplate = {
  id: string;
  kind: "MODEL" | "SKILL" | "MCP";
  logicalName: string;
  revision: number;
  manifest: Record<string, unknown>;
  credentialHandleIds: string[];
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
