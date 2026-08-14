export type ServerUnderstandingJob = {
  id: string;
  projectId: string;
  sourceRegistrationId: string;
  snapshotManifestId: string;
  workspaceExecutionProfileRevisionId: string;
  policyDigest: string;
  baseRevisionId: string | null;
  implementationAuthorId: string;
  runnerId: string;
  purpose: "PUBLICATION" | "EQUIVALENCE_VERIFICATION" | "HISTORICAL_REANALYSIS";
  reanalysisOfGraphRevisionId?: string;
  requestedMode: "AUTO" | "FULL" | "INCREMENTAL";
  resolvedMode: "FULL" | "INCREMENTAL";
  phase: string;
  desiredState: "RUNNING" | "PAUSED" | "CANCELLED";
  status: "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED";
  version: number;
  completedPhases: string[];
  outputs: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean };
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  dataClassification?: string;
  productionEligible?: boolean;
  evaluationEvidenceType?: string;
};

function headers(apiToken: string, json = false) {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(apiToken.trim() ? { "x-traqen-api-token": apiToken.trim() } : {}),
  };
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Traqen API returned ${response.status}`);
  return body;
}

export async function registerServerWorkspaceSource(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
  rootPath: string,
) {
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(workspaceId)}/source-registrations`,
    {
      method: "POST",
      headers: headers(apiToken, true),
      body: JSON.stringify({ rootPath, displayName: rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace source" }),
    },
  );
  return json<{ id: string; projectId: string; displayName: string; status: "ACTIVE" }>(response);
}

export async function startServerWorkspaceUnderstanding(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
  input: {
    sourceRegistrationId: string;
    requestedMode: "AUTO" | "FULL" | "INCREMENTAL";
  },
) {
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(workspaceId)}/workspace-analysis-jobs`,
    {
      method: "POST",
      headers: headers(apiToken, true),
      body: JSON.stringify(input),
    },
  );
  return json<ServerUnderstandingJob>(response);
}

export async function startHistoricalRevisionReanalysis(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
  graphRevisionId: string,
) {
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(workspaceId)}/graph/revisions/${encodeURIComponent(graphRevisionId)}/reanalysis-jobs`,
    {
      method: "POST",
      headers: headers(apiToken, true),
      body: JSON.stringify({}),
    },
  );
  return json<ServerUnderstandingJob>(response);
}

export async function getServerWorkspaceUnderstanding(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
  jobId: string,
) {
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(workspaceId)}/workspace-analysis-jobs/${encodeURIComponent(jobId)}`,
    { headers: headers(apiToken) },
  );
  return json<ServerUnderstandingJob>(response);
}

export async function listServerWorkspaceUnderstandingJobs(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
) {
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(workspaceId)}/workspace-analysis-jobs`,
    { headers: headers(apiToken) },
  );
  return (await json<{ jobs: ServerUnderstandingJob[] }>(response)).jobs;
}

export async function controlServerWorkspaceUnderstanding(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
  jobId: string,
  action: "pause" | "resume" | "cancel",
) {
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(workspaceId)}/workspace-analysis-jobs/${encodeURIComponent(jobId)}/${action}`,
    { method: "POST", headers: headers(apiToken) },
  );
  return json<ServerUnderstandingJob>(response);
}
