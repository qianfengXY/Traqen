import type { LocalWorkspaceFileRecord, LocalModelClassification } from "./local-workspace-analysis";

export type AnalysisModelProfile = {
  id: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
  source: "ENVIRONMENT" | "RUNTIME";
  configuredAt: string;
  verifiedAt: string | null;
  ready: boolean;
  latencyMs?: number;
};

export type AnalysisModelSettings = {
  id: string;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
};

export type WorkspaceModelEnrichment = {
  id: string;
  displayName: string;
  description: string;
  businessFeature: boolean;
  domain: string;
  group: LocalModelClassification["group"];
  confidence: LocalModelClassification["confidence"];
  rationale: string;
};

function headers(apiToken: string, json = false) {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(apiToken.trim() ? { "x-traqen-api-token": apiToken.trim() } : {}),
  };
}

async function responseJson<T>(response: Response) {
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Traqen API returned ${response.status}`);
  return body;
}

function baseUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

export async function listAnalysisModelProfiles(apiBase: string, apiToken: string) {
  const response = await fetch(`${baseUrl(apiBase)}/v1/analysis-model-profiles`, { headers: headers(apiToken) });
  return (await responseJson<{ profiles: AnalysisModelProfile[] }>(response)).profiles;
}

export async function configureAndVerifyAnalysisModel(apiBase: string, apiToken: string, settings: AnalysisModelSettings) {
  const base = baseUrl(apiBase);
  const configured = await fetch(`${base}/v1/analysis-model-profiles`, {
    method: "POST",
    headers: headers(apiToken, true),
    body: JSON.stringify(settings),
  });
  await responseJson<AnalysisModelProfile>(configured);
  const verified = await fetch(`${base}/v1/analysis-model-profiles/${encodeURIComponent(settings.id)}/verify`, {
    method: "POST",
    headers: headers(apiToken),
  });
  return responseJson<AnalysisModelProfile>(verified);
}

export async function verifyConfiguredAnalysisModel(apiBase: string, apiToken: string, profileId: string) {
  const response = await fetch(`${baseUrl(apiBase)}/v1/analysis-model-profiles/${encodeURIComponent(profileId)}/verify`, {
    method: "POST",
    headers: headers(apiToken),
  });
  return responseJson<AnalysisModelProfile>(response);
}

export function workspaceModelCandidateBatches(records: LocalWorkspaceFileRecord[], profileId: string, batchSize = 24) {
  const candidates = records.flatMap((record) => record.candidates).filter((candidate) => candidate.modelClassification?.profileId !== profileId).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    kind: candidate.kind,
    method: candidate.method,
    modulePath: candidate.modulePath,
    sourcePath: candidate.sourcePath,
    description: candidate.description,
    code: candidate.code,
  }));
  const batches: typeof candidates[] = [];
  for (let offset = 0; offset < candidates.length; offset += batchSize) batches.push(candidates.slice(offset, offset + batchSize));
  return batches;
}

export async function enrichWorkspaceCandidateBatch(apiBase: string, apiToken: string, profileId: string, candidates: ReturnType<typeof workspaceModelCandidateBatches>[number]) {
  const response = await fetch(`${baseUrl(apiBase)}/v1/analysis-model-profiles/${encodeURIComponent(profileId)}/workspace-enrichment`, {
    method: "POST",
    headers: headers(apiToken, true),
    body: JSON.stringify({ candidates }),
  });
  return (await responseJson<{ profileId: string; candidates: WorkspaceModelEnrichment[] }>(response)).candidates;
}
