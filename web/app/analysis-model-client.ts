import type { LocalWorkspaceFileRecord, LocalModelClassification } from "./local-workspace-analysis";

export type AnalysisModelProfile = {
  id: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
  stream: boolean;
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
  stream: boolean;
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
  const body = await response.json().catch(() => ({})) as T & { error?: { code?: string; message?: string } };
  if (response.status === 404 && body.error?.code === "ROUTE_NOT_FOUND") {
    throw new Error("当前 Traqen API 版本不支持模型配置。请确保 Web 与 API 使用同一代码版本，并重启 npm run dev。 / This Traqen API version does not support model configuration. Run Web and API from the same revision, then restart npm run dev.");
  }
  if (!response.ok) throw new Error(body.error?.message ?? `Traqen API returned ${response.status}`);
  return body;
}

function baseUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

export function normalizeChatCompletionsEndpoint(value: string) {
  const input = value.trim();
  const url = new URL(input);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path) url.pathname = "/v1/chat/completions";
  else if (/\/v1$/i.test(path)) url.pathname = `${path}/chat/completions`;
  return url.toString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function listAnalysisModelProfiles(apiBase: string, apiToken: string) {
  const response = await fetch(`${baseUrl(apiBase)}/v1/analysis-model-profiles`, { headers: headers(apiToken) });
  return (await responseJson<{ profiles: AnalysisModelProfile[] }>(response)).profiles;
}

export async function configureAndVerifyAnalysisModel(apiBase: string, apiToken: string, settings: AnalysisModelSettings) {
  const base = baseUrl(apiBase);
  const normalized = { ...settings, endpoint: normalizeChatCompletionsEndpoint(settings.endpoint) };
  try {
    const configured = await fetch(`${base}/v1/analysis-model-profiles`, {
      method: "POST",
      headers: headers(apiToken, true),
      body: JSON.stringify(normalized),
    });
    await responseJson<AnalysisModelProfile>(configured);
  } catch (error) {
    throw new Error(`Traqen 保存模型配置失败 / Failed to save the model profile: ${errorMessage(error)}`, { cause: error });
  }
  try {
    const verified = await fetch(`${base}/v1/analysis-model-profiles/${encodeURIComponent(settings.id)}/verify`, {
      method: "POST",
      headers: headers(apiToken),
    });
    return await responseJson<AnalysisModelProfile>(verified);
  } catch (error) {
    throw new Error(`配置已保存，但模型连接验证失败。实际请求地址：${normalized.endpoint}。请确认供应商支持 OpenAI-compatible Chat Completions。 / Profile saved, but model verification failed at ${normalized.endpoint}: ${errorMessage(error)}`, { cause: error });
  }
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
