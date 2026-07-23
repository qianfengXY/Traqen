import { localWorkspaceEvidencePolicyVersion, type LocalWorkspaceFileRecord, type LocalModelClassification } from "./local-workspace-analysis.ts";

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
  active: boolean;
  latencyMs?: number;
};

export type AnalysisModelSettings = {
  id: string;
  endpoint: string;
  model: string;
  apiKey?: string;
  stream: boolean;
  timeoutMs?: number;
};

export type WorkspaceModelEnrichment = {
  id: string;
  displayName: string;
  description: string;
  businessFeature: boolean;
  businessKey: string;
  businessModule: string;
  businessSubmodule: string;
  domain: string;
  group: LocalModelClassification["group"];
  confidence: LocalModelClassification["confidence"];
  rationale: string;
};

export type WorkspaceAnalysisPlan = {
  agentMessage: string;
  taskAssignments: Array<{ agentId: "SUB_AGENT_1" | "SUB_AGENT_2" | "SUB_AGENT_3"; objective: string; moduleScopes: string[] }>;
};

export type WorkspaceSourceModule = {
  name: string;
  fileCount: number;
  sourceBytes: number;
  languages: string[];
};

export type WorkspaceEvidenceAssessment = {
  observations: Array<{
    extractor: string;
    basis: string;
    sourcePath: string;
    startLine: number;
    excerpt: string;
  }>;
  corroborations: string[];
  contradictions: string[];
  diagnostics: string[];
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  confidenceCap: "LOW" | "MEDIUM" | "HIGH";
};

export type AnalysisModelTelemetryEvent = {
  type: "REQUEST_PREPARED" | "HTTP_CONNECTED" | "RESPONSE_PROGRESS" | "STRUCTURED_RESPONSE_PARSED" | "OUTPUT_VALIDATED" | "OUTPUT_REJECTED" | "REQUEST_FAILED" | "BATCH_RETRYING" | "BATCH_SKIPPED";
  at: string;
  requestId?: string;
  profileId?: string;
  model?: string;
  endpoint?: string;
  transport?: "STREAM_SSE" | "JSON";
  maxOutputTokens?: number;
  inputCharacters?: number;
  promptPreview?: string;
  promptTruncated?: boolean;
  promptOriginalCharacters?: number;
  status?: number;
  contentType?: string;
  timeToFirstByteMs?: number;
  chunkCount?: number;
  receivedCharacters?: number;
  elapsedMs?: number;
  complete?: boolean;
  outputCharacters?: number;
  outputPreview?: string;
  outputTruncated?: boolean;
  assistantMessage?: string | null;
  usage?: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
  candidateCount?: number;
  businessCandidateCount?: number;
  technicalCandidateCount?: number;
  confidence?: Record<string, number>;
  message?: string;
  retryDepth?: number;
  batchSize?: number;
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
  const requestBody = { ...normalized, ...(settings.apiKey?.trim() ? { apiKey: settings.apiKey.trim() } : {}) };
  if (!settings.apiKey?.trim()) delete requestBody.apiKey;
  try {
    const configured = await fetch(`${base}/v1/analysis-model-profiles`, {
      method: "POST",
      headers: headers(apiToken, true),
      body: JSON.stringify(requestBody),
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

export async function selectAnalysisModelProfile(apiBase: string, apiToken: string, profileId: string) {
  const response = await fetch(`${baseUrl(apiBase)}/v1/analysis-model-profiles/${encodeURIComponent(profileId)}/select`, {
    method: "POST",
    headers: headers(apiToken),
  });
  return responseJson<AnalysisModelProfile>(response);
}

export async function removeAnalysisModelProfile(apiBase: string, apiToken: string, profileId: string) {
  const response = await fetch(`${baseUrl(apiBase)}/v1/analysis-model-profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE",
    headers: headers(apiToken),
  });
  return responseJson<AnalysisModelProfile>(response);
}

export async function verifyConfiguredAnalysisModel(apiBase: string, apiToken: string, profileId: string) {
  const response = await fetch(`${baseUrl(apiBase)}/v1/analysis-model-profiles/${encodeURIComponent(profileId)}/verify`, {
    method: "POST",
    headers: headers(apiToken),
  });
  return responseJson<AnalysisModelProfile>(response);
}

function evidenceKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sourceLanguage(path: string) {
  const name = path.split("/").at(-1) ?? path;
  if (name.startsWith(".env")) return "env";
  return name.includes(".") ? name.split(".").at(-1)?.toLowerCase() ?? "other" : "other";
}

export function workspaceSourceModule(path: string) {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length <= 1) return "root";
  if (["src", "app", "lib", "packages", "services", "modules"].includes(segments[0]) && segments[1]) return `${segments[0]}/${segments[1]}`;
  return segments[0];
}

export function workspaceSourceManifest(files: Array<{ path: string; size: number }>) {
  const modules = new Map<string, { fileCount: number; sourceBytes: number; languages: Set<string> }>();
  for (const file of files) {
    const name = workspaceSourceModule(file.path);
    const current = modules.get(name) ?? { fileCount: 0, sourceBytes: 0, languages: new Set<string>() };
    current.fileCount += 1;
    current.sourceBytes += Math.max(0, file.size);
    current.languages.add(sourceLanguage(file.path));
    modules.set(name, current);
  }
  return [...modules.entries()].map(([name, summary]) => ({
    name,
    fileCount: summary.fileCount,
    sourceBytes: summary.sourceBytes,
    languages: [...summary.languages].sort(),
  })).sort((left, right) => right.sourceBytes - left.sourceBytes || left.name.localeCompare(right.name));
}

function extractorFor(candidate: LocalWorkspaceFileRecord["candidates"][number]) {
  if (/OpenAPI document/i.test(candidate.description)) return { extractor: "OPENAPI_DOCUMENT", basis: "Declared API contract operation" };
  if (candidate.sourcePath.endsWith("package.json")) return { extractor: "PACKAGE_MANIFEST", basis: "Declared package script" };
  if (candidate.sourcePath.endsWith(".java")) return { extractor: "JAVA_DECLARATION_PATTERN", basis: "Browser-side Java declaration and annotation pattern; not AST-verified" };
  return { extractor: "SOURCE_PATTERN", basis: "Browser-side language-aware source pattern" };
}

type WorkspaceEvidenceIndex = {
  candidatesByKey: Map<string, LocalWorkspaceFileRecord["candidates"]>;
  testsByKey: Map<string, Array<NonNullable<LocalWorkspaceFileRecord["test"]>>>;
};

function workspaceEvidenceIndex(records: LocalWorkspaceFileRecord[]): WorkspaceEvidenceIndex {
  const candidatesByKey = new Map<string, LocalWorkspaceFileRecord["candidates"]>();
  const testsByKey = new Map<string, Array<NonNullable<LocalWorkspaceFileRecord["test"]>>>();
  for (const record of records) {
    for (const candidate of record.candidates) {
      const key = evidenceKey(candidate.name);
      if (key) candidatesByKey.set(key, [...(candidatesByKey.get(key) ?? []), candidate]);
    }
    if (record.test) {
      for (const testKey of record.test.keys) {
        const key = evidenceKey(testKey);
        if (key.length > 2) testsByKey.set(key, [...(testsByKey.get(key) ?? []), record.test]);
      }
    }
  }
  return { candidatesByKey, testsByKey };
}

function candidateEvidenceAssessment(candidate: LocalWorkspaceFileRecord["candidates"][number], index: WorkspaceEvidenceIndex): WorkspaceEvidenceAssessment {
  const key = evidenceKey(candidate.name);
  const matches = key ? (index.candidatesByKey.get(key) ?? []).filter((item) => item.id !== candidate.id).slice(0, 4) : [];
  const relatedTests = key ? (index.testsByKey.get(key) ?? []).slice(0, 4) : [];
  const primary = extractorFor(candidate);
  const observations = [candidate, ...matches].map((item) => {
    const extraction = extractorFor(item);
    return {
      extractor: extraction.extractor,
      basis: extraction.basis,
      sourcePath: item.sourcePath,
      startLine: item.startLine,
      excerpt: item.code.slice(0, item.id === candidate.id ? 600 : 240),
    };
  });
  const corroborations = [
    ...matches.map((item) => `Matching candidate ${item.name} observed by ${extractorFor(item).extractor} at ${item.sourcePath}:${item.startLine}`),
    ...relatedTests.map((test) => `Related test clue ${test.title} at ${test.path}`),
  ];
  const independentExtractors = new Set(observations.map((observation) => observation.extractor)).size;
  const independentEvidenceKinds = independentExtractors + (relatedTests.length > 0 ? 1 : 0);
  const confidenceCap = independentEvidenceKinds >= 3 ? "HIGH" : independentEvidenceKinds >= 2 ? "MEDIUM" : "LOW";
  const diagnostics = primary.extractor.endsWith("PATTERN") || primary.extractor === "SOURCE_PATTERN"
    ? ["This browser-side observation is heuristic and must be corroborated before it can support medium or high confidence."]
    : [];
  return {
    observations,
    corroborations,
    contradictions: [],
    diagnostics,
    completeness: corroborations.length > 0 ? "PARTIAL" : "UNKNOWN",
    confidenceCap,
  };
}

export function workspaceModelCandidateBatches(records: LocalWorkspaceFileRecord[], profileId: string, batchSize = 10) {
  const evidenceIndex = workspaceEvidenceIndex(records);
  const candidates = records.flatMap((record) => record.candidates).filter((candidate) => candidate.modelClassification?.profileId !== profileId || candidate.modelClassification.evidencePolicyVersion !== localWorkspaceEvidencePolicyVersion).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    kind: candidate.kind,
    method: candidate.method,
    modulePath: candidate.modulePath,
    sourcePath: candidate.sourcePath,
    description: candidate.description,
    code: candidate.code,
    evidence: candidateEvidenceAssessment(candidate, evidenceIndex),
  }));
  const batches: typeof candidates[] = [];
  let current: typeof candidates = [];
  for (const candidate of candidates) {
    const proposed = [...current, candidate];
    if (current.length > 0 && (proposed.length > batchSize || JSON.stringify(proposed).length > 60_000)) {
      batches.push(current);
      current = [candidate];
    } else current = proposed;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function requestWorkspaceCandidateBatch(apiBase: string, apiToken: string, profileId: string, candidates: ReturnType<typeof workspaceModelCandidateBatches>[number], options: { onTelemetry?: (event: AnalysisModelTelemetryEvent) => void } = {}) {
  const response = await fetch(`${baseUrl(apiBase)}/v1/analysis-model-profiles/${encodeURIComponent(profileId)}/workspace-enrichment`, {
    method: "POST",
    headers: { ...headers(apiToken, true), accept: "application/x-ndjson, application/json" },
    body: JSON.stringify({ candidates }),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/x-ndjson") || !response.body) {
    return (await responseJson<{ profileId: string; candidates: WorkspaceModelEnrichment[] }>(response)).candidates;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: WorkspaceModelEnrichment[] | null = null;
  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as { kind: "telemetry" | "result" | "error"; event?: AnalysisModelTelemetryEvent; candidates?: WorkspaceModelEnrichment[]; error?: { message?: string } };
    if (message.kind === "telemetry" && message.event) options.onTelemetry?.(message.event);
    else if (message.kind === "result") result = message.candidates ?? [];
    else if (message.kind === "error") throw new Error(message.error?.message ?? "Analysis model interaction failed");
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      consumeLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  consumeLine(buffer);
  if (!result) throw new Error("Analysis model interaction ended without a validated result");
  return result;
}

export async function enrichWorkspaceCandidateBatch(apiBase: string, apiToken: string, profileId: string, candidates: ReturnType<typeof workspaceModelCandidateBatches>[number], options: { onTelemetry?: (event: AnalysisModelTelemetryEvent) => void } = {}, retryDepth = 0): Promise<WorkspaceModelEnrichment[]> {
  try {
    return await requestWorkspaceCandidateBatch(apiBase, apiToken, profileId, candidates, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown model error";
    const retryable = /truncated|max_(?:output_)?tokens|complete JSON object or array|invalid structured JSON response|must return exactly|preserve every input id/i.test(message);
    if (!retryable) throw error;
    if (candidates.length <= 1 || retryDepth >= 5) {
      options.onTelemetry?.({
        type: "BATCH_SKIPPED",
        at: new Date().toISOString(),
        message: "The smallest model work unit still returned invalid structured output. Scanner evidence is retained, this candidate remains pending model classification, and the Workspace run will continue.",
        retryDepth,
        batchSize: candidates.length,
      });
      return [];
    }
    const middle = Math.ceil(candidates.length / 2);
    options.onTelemetry?.({
      type: "BATCH_RETRYING",
      at: new Date().toISOString(),
      message: `The model response was incomplete; retrying this bounded task as ${middle} and ${candidates.length - middle} candidates.`,
      retryDepth: retryDepth + 1,
      batchSize: candidates.length,
    });
    const left = await enrichWorkspaceCandidateBatch(apiBase, apiToken, profileId, candidates.slice(0, middle), options, retryDepth + 1);
    const right = await enrichWorkspaceCandidateBatch(apiBase, apiToken, profileId, candidates.slice(middle), options, retryDepth + 1);
    const byId = new Map([...left, ...right].map((candidate) => [candidate.id, candidate]));
    return candidates.map((candidate) => byId.get(candidate.id)).filter((candidate): candidate is WorkspaceModelEnrichment => Boolean(candidate));
  }
}

export async function planWorkspaceAnalysis(apiBase: string, apiToken: string, profileId: string, input: { workspaceName: string; mode: "FULL" | "INCREMENTAL"; fileCount: number; modules: WorkspaceSourceModule[] }, options: { onTelemetry?: (event: AnalysisModelTelemetryEvent) => void } = {}) {
  const response = await fetch(`${baseUrl(apiBase)}/v1/analysis-model-profiles/${encodeURIComponent(profileId)}/workspace-plan`, {
    method: "POST",
    headers: { ...headers(apiToken, true), accept: "application/x-ndjson, application/json" },
    body: JSON.stringify(input),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/x-ndjson") || !response.body) {
    return (await responseJson<{ profileId: string; plan: WorkspaceAnalysisPlan }>(response)).plan;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: WorkspaceAnalysisPlan | null = null;
  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as { kind: "telemetry" | "result" | "error"; event?: AnalysisModelTelemetryEvent; plan?: WorkspaceAnalysisPlan; error?: { message?: string } };
    if (message.kind === "telemetry" && message.event) options.onTelemetry?.(message.event);
    else if (message.kind === "result") result = message.plan ?? null;
    else if (message.kind === "error") throw new Error(message.error?.message ?? "Analysis model orchestration failed");
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      consumeLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  consumeLine(buffer);
  if (!result) throw new Error("Main Agent interaction ended without a validated plan");
  return result;
}
