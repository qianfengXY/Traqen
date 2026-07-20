function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${fieldName} must be a non-empty string`);
  return value.trim();
}
function endpointUrl(value) {
  const url = new URL(requiredString(value, "analysis model endpoint"));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    throw new TypeError("analysis model endpoint must use HTTPS unless it is local");
  }
  return url.toString();
}

function responseText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const joined = content.filter((item) => item?.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n");
    if (joined) return joined;
  }
  throw new TypeError("analysis model response does not contain message content");
}

export class OpenAICompatibleAnalysisModelAdapter {
  constructor({ id, endpoint, model, apiKeyResolver = () => null, fetchImpl = globalThis.fetch, timeoutMs = 120_000 }) {
    this.id = requiredString(id, "analysis model profile id");
    this.endpoint = endpointUrl(endpoint);
    this.model = requiredString(model, "analysis model name");
    if (typeof apiKeyResolver !== "function") throw new TypeError("apiKeyResolver must be a function");
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new TypeError("timeoutMs must be between 1 and 600000");
    this.apiKeyResolver = apiKeyResolver;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async analyze(input, { signal = null } = {}) {
    const apiKey = await this.apiKeyResolver(this.id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Analysis model request timed out")), this.timeoutMs);
    const abort = () => controller.abort(signal.reason);
    if (signal) signal.addEventListener("abort", abort, { once: true });
    try {
      const headers = { "content-type": "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: input.context.maxOutputTokens,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "You are Traqen's bounded source-analysis engine.",
                "Return JSON only with candidateFeatures[].",
                "Every conclusion must cite evidenceFactIds present in the supplied WorkUnit.",
                "Do not invent business authority, permissions, preconditions, or behavior absent from evidence.",
                "Prefer grouping implementation symbols into user-recognizable business capabilities.",
              ].join(" "),
            },
            {
              role: "user",
              content: JSON.stringify({
                task: "Refine deterministic feature candidates and recover business meaning from this bounded evidence graph.",
                workUnit: { id: input.workUnit.id, scopeKey: input.workUnit.scopeKey, rootNodeId: input.workUnit.rootNodeId },
                deterministicCandidates: input.deterministicCandidates,
                evidence: input.evidence,
                outputContract: {
                  candidateFeatures: [{
                    candidateKey: "stable semantic key",
                    mode: "BUSINESS or API",
                    name: "readable name",
                    description: "evidence-bounded explanation",
                    confidence: "LOW, MEDIUM, or HIGH",
                    evidenceFactIds: ["Fact ids from this input only"],
                    stableEvidenceNodeIds: ["stable node ids from this input only"],
                    design: {},
                    uncertainties: [],
                  }],
                },
              }),
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Analysis model request failed with HTTP ${response.status}`);
      const payload = await response.json();
      let parsed;
      try {
        parsed = JSON.parse(responseText(payload));
      } catch (error) {
        throw new TypeError("analysis model response is not valid JSON", { cause: error });
      }
      return parsed;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abort);
    }
  }
}

export function configuredAnalysisModels(value, env = process.env) {
  if (!value) return new Map();
  let profiles;
  try {
    profiles = JSON.parse(value);
  } catch (error) {
    throw new TypeError("ANALYSIS_MODEL_PROFILES_JSON must be valid JSON", { cause: error });
  }
  if (!Array.isArray(profiles)) throw new TypeError("ANALYSIS_MODEL_PROFILES_JSON must be an array");
  const result = new Map();
  for (const [index, profile] of profiles.entries()) {
    const id = requiredString(profile?.id, `analysisModels[${index}].id`);
    const secretEnvironment = profile.apiKeyEnvironment
      ? requiredString(profile.apiKeyEnvironment, `analysisModels[${index}].apiKeyEnvironment`)
      : null;
    if (result.has(id)) throw new TypeError(`Duplicate analysis model profile ${id}`);
    result.set(id, new OpenAICompatibleAnalysisModelAdapter({
      id,
      endpoint: profile.endpoint,
      model: profile.model,
      timeoutMs: profile.timeoutMs ?? 120_000,
      apiKeyResolver: () => secretEnvironment ? env[secretEnvironment] ?? null : null,
    }));
  }
  return result;
}
