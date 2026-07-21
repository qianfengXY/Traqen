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
    const joined = content.map((item) => {
      if (typeof item === "string") return item;
      if (typeof item?.text === "string") return item.text;
      if (typeof item?.text?.value === "string") return item.text.value;
      if (typeof item?.content === "string") return item.content;
      return "";
    }).filter(Boolean).join("\n");
    if (joined) return joined;
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  if (typeof payload?.choices?.[0]?.text === "string") return payload.choices[0].text;
  if (typeof payload?.output_text === "string") return payload.output_text;
  const outputText = payload?.output?.flatMap?.((item) => item?.content ?? [])
    ?.map?.((item) => typeof item?.text === "string" ? item.text : typeof item?.text?.value === "string" ? item.text.value : "")
    ?.filter?.(Boolean)
    ?.join?.("\n");
  if (outputText) return outputText;
  const fields = payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8).join(", ") : "none";
  throw new TypeError(`analysis model response does not contain supported message text (top-level fields: ${fields || "none"})`);
}

function sseResponseText(value) {
  if (value.length > 2_000_000) throw new TypeError("analysis model stream exceeds the bounded response size");
  const pieces = [];
  const fields = new Set();
  for (const event of value.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch (error) {
      throw new TypeError("analysis model stream contains a non-JSON data event", { cause: error });
    }
    if (payload && typeof payload === "object") Object.keys(payload).slice(0, 8).forEach((field) => fields.add(field));
    const delta = payload?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") pieces.push(delta);
    else if (Array.isArray(delta)) pieces.push(...delta.map((item) => typeof item?.text === "string" ? item.text : "").filter(Boolean));
    else if (typeof payload?.delta === "string" && /output_text\.delta|content_block_delta/i.test(payload?.type ?? "")) pieces.push(payload.delta);
    else if (typeof payload?.delta?.text === "string") pieces.push(payload.delta.text);
    else {
      try {
        pieces.push(responseText(payload));
      } catch {
        // Metadata-only stream events do not contribute output text.
      }
    }
  }
  if (pieces.length === 0) throw new TypeError(`analysis model stream does not contain supported text deltas (event fields: ${[...fields].join(", ") || "none"})`);
  return pieces.join("");
}

function structuredResponse(value, contentType = "") {
  const stream = /text\/event-stream/i.test(contentType) || /^\s*(?:event:.*\r?\n)?data:/m.test(value);
  if (stream) return jsonResponse({ choices: [{ message: { content: sseResponseText(value) } }] });
  let payload;
  try {
    payload = JSON.parse(value);
  } catch (error) {
    throw new TypeError("analysis model HTTP response body is not valid JSON", { cause: error });
  }
  return jsonResponse(payload);
}

function firstJsonFragment(value) {
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== "{" && value[start] !== "[") continue;
    const stack = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const opening = stack.pop();
        if ((opening === "{" && character !== "}") || (opening === "[" && character !== "]")) break;
        if (stack.length === 0) {
          const candidate = value.slice(start, index + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function jsonResponse(payload) {
  const value = responseText(payload).trim();
  const unfenced = value.startsWith("```")
    ? value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : value;
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    const fragment = firstJsonFragment(unfenced);
    if (fragment !== null) return fragment;
    throw new TypeError("analysis model message text does not contain a complete JSON object or array", { cause: error });
  }
}

function boundedWorkspaceCandidates(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    throw new TypeError("workspace model batch must contain between 1 and 24 candidates");
  }
  const candidates = value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") throw new TypeError(`workspace candidate ${index} must be an object`);
    return {
      id: requiredString(candidate.id, `workspace candidate ${index} id`),
      name: requiredString(candidate.name, `workspace candidate ${index} name`).slice(0, 300),
      kind: requiredString(candidate.kind, `workspace candidate ${index} kind`).slice(0, 40),
      method: typeof candidate.method === "string" ? candidate.method.slice(0, 20) : null,
      modulePath: typeof candidate.modulePath === "string" ? candidate.modulePath.slice(0, 300) : "",
      sourcePath: typeof candidate.sourcePath === "string" ? candidate.sourcePath.slice(0, 800) : "",
      description: typeof candidate.description === "string" ? candidate.description.slice(0, 1_200) : "",
      code: typeof candidate.code === "string" ? candidate.code.slice(0, 2_000) : "",
    };
  });
  if (JSON.stringify(candidates).length > 72_000) throw new RangeError("workspace model batch exceeds the bounded context size");
  return candidates;
}

export class AnalysisModelConnectionError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "AnalysisModelConnectionError";
  }
}

export class OpenAICompatibleAnalysisModelAdapter {
  constructor({ id, endpoint, model, apiKeyResolver = () => null, fetchImpl = globalThis.fetch, timeoutMs = 120_000, stream = false }) {
    this.id = requiredString(id, "analysis model profile id");
    this.endpoint = endpointUrl(endpoint);
    this.model = requiredString(model, "analysis model name");
    if (typeof apiKeyResolver !== "function") throw new TypeError("apiKeyResolver must be a function");
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new TypeError("timeoutMs must be between 1 and 600000");
    if (typeof stream !== "boolean") throw new TypeError("analysis model stream must be a boolean");
    this.apiKeyResolver = apiKeyResolver;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.stream = stream;
  }

  async #request({ messages, maxOutputTokens }, { signal = null } = {}) {
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
          max_tokens: maxOutputTokens,
          response_format: { type: "json_object" },
          ...(this.stream ? { stream: true } : {}),
          messages,
        }),
      });
      if (!response.ok) {
        const detail = typeof response.text === "function" ? await response.text().catch(() => "") : "";
        throw new AnalysisModelConnectionError(`Analysis model request failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }
      try {
        return structuredResponse(await response.text(), response.headers?.get?.("content-type") ?? "");
      } catch (error) {
        const reason = error instanceof TypeError && error.message.startsWith("analysis model ")
          ? error.message
          : "HTTP response body is not valid JSON";
        throw new AnalysisModelConnectionError(`Analysis model returned an invalid structured JSON response: ${reason}`, { cause: error });
      }
    } catch (error) {
      if (error instanceof AnalysisModelConnectionError) throw error;
      if (controller.signal.aborted) throw new AnalysisModelConnectionError("Analysis model request timed out or was cancelled", { cause: error });
      throw new AnalysisModelConnectionError("Unable to reach the configured analysis model", { cause: error });
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abort);
    }
  }

  async verify(options = {}) {
    const startedAt = Date.now();
    const result = await this.#request({
      maxOutputTokens: 512,
      messages: [
        { role: "system", content: "Return JSON only." },
        { role: "user", content: "Reply with exactly {\"ok\":true}." },
      ],
    }, options);
    if (result?.ok !== true) throw new AnalysisModelConnectionError("Analysis model verification returned an unexpected structured response");
    return { ok: true, latencyMs: Date.now() - startedAt };
  }

  async enrichWorkspaceCandidates(value, options = {}) {
    const candidates = boundedWorkspaceCandidates(value);
    const inputIds = new Set(candidates.map((candidate) => candidate.id));
    const result = await this.#request({
      maxOutputTokens: Math.min(4_096, Math.max(800, candidates.length * 160)),
      messages: [
        {
          role: "system",
          content: [
            "You are Traqen's bounded Workspace analysis agent.",
            "Classify implementation candidates using only the supplied paths, descriptions, and code excerpts.",
            "Do not invent permissions, business rules, dependencies, tests, or authority.",
            "Return JSON only with candidates[]. Preserve every input id exactly.",
            "businessFeature is true only for a user-recognizable business capability or background business process; repositories, DTOs, adapters, configuration, utilities, and framework plumbing are false.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Improve readable feature names and distinguish business capabilities from technical symbols.",
            candidates,
            outputContract: {
              candidates: [{
                id: "input id",
                displayName: "concise user-recognizable name",
                description: "evidence-bounded behavior description",
                businessFeature: true,
                domain: "short business domain",
                group: "BUSINESS_CAPABILITY | BACKGROUND_INTEGRATION | DATA_INTEGRATION | PROJECT_OPERATION | API_SERVICE",
                confidence: "LOW | MEDIUM | HIGH",
                rationale: "short evidence-based reason",
              }],
            },
          }),
        },
      ],
    }, options);
    try {
      if (!Array.isArray(result?.candidates)) throw new TypeError("analysis model workspace response requires candidates[]");
      const allowedGroups = new Set(["BUSINESS_CAPABILITY", "BACKGROUND_INTEGRATION", "DATA_INTEGRATION", "PROJECT_OPERATION", "API_SERVICE"]);
      const allowedConfidence = new Set(["LOW", "MEDIUM", "HIGH"]);
      const seen = new Set();
      return result.candidates.map((candidate, index) => {
        const id = requiredString(candidate?.id, `workspace response candidate ${index} id`);
        if (!inputIds.has(id) || seen.has(id)) throw new TypeError(`analysis model returned an unknown or duplicate candidate id ${id}`);
        seen.add(id);
        const group = requiredString(candidate.group, `workspace response candidate ${index} group`);
        const confidence = requiredString(candidate.confidence, `workspace response candidate ${index} confidence`);
        if (!allowedGroups.has(group)) throw new TypeError(`analysis model returned unsupported group ${group}`);
        if (!allowedConfidence.has(confidence)) throw new TypeError(`analysis model returned unsupported confidence ${confidence}`);
        if (typeof candidate.businessFeature !== "boolean") throw new TypeError(`workspace response candidate ${index} businessFeature must be boolean`);
        return {
          id,
          displayName: requiredString(candidate.displayName, `workspace response candidate ${index} displayName`).slice(0, 200),
          description: requiredString(candidate.description, `workspace response candidate ${index} description`).slice(0, 2_000),
          businessFeature: candidate.businessFeature,
          domain: requiredString(candidate.domain, `workspace response candidate ${index} domain`).slice(0, 120),
          group,
          confidence,
          rationale: requiredString(candidate.rationale, `workspace response candidate ${index} rationale`).slice(0, 1_000),
        };
      });
    } catch (error) {
      throw new AnalysisModelConnectionError("Analysis model returned an invalid Workspace enrichment response", { cause: error });
    }
  }

  async analyze(input, { signal = null } = {}) {
    return this.#request({
      maxOutputTokens: input.context.maxOutputTokens,
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
    }, { signal });
  }
}

export class AnalysisModelRegistry {
  #profiles = new Map();
  #clock;
  #fetchImpl;
  #profileStore;
  #activeProfileId = null;

  constructor({ adapters = new Map(), clock = () => new Date(), fetchImpl = globalThis.fetch, profileStore = null } = {}) {
    if (!(adapters instanceof Map)) throw new TypeError("analysis model adapters must be a Map");
    if (typeof clock !== "function") throw new TypeError("analysis model registry clock must be a function");
    if (typeof fetchImpl !== "function") throw new TypeError("analysis model registry fetchImpl must be a function");
    if (profileStore && (typeof profileStore.load !== "function" || typeof profileStore.save !== "function")) throw new TypeError("analysis model profileStore requires load and save functions");
    this.#clock = clock;
    this.#fetchImpl = fetchImpl;
    this.#profileStore = profileStore;
    for (const [id, adapter] of adapters) {
      this.#profiles.set(id, { id, endpoint: adapter.endpoint, model: adapter.model, timeoutMs: adapter.timeoutMs, stream: adapter.stream, source: "ENVIRONMENT", configuredAt: this.#clock().toISOString(), verifiedAt: null, apiKey: null, adapter });
    }
    const stored = this.#profileStore?.load() ?? { activeProfileId: null, profiles: [] };
    for (const value of stored.profiles) {
      const id = requiredString(value?.id, "stored analysis model profile id");
      if (this.#profiles.has(id)) continue;
      const endpoint = endpointUrl(value.endpoint);
      const model = requiredString(value.model, "stored analysis model name");
      const apiKey = requiredString(value.apiKey, "stored analysis model API key");
      const timeoutMs = value.timeoutMs ?? 120_000;
      const stream = value.stream ?? false;
      const adapter = new OpenAICompatibleAnalysisModelAdapter({ id, endpoint, model, timeoutMs, stream, fetchImpl: this.#fetchImpl, apiKeyResolver: () => apiKey });
      this.#profiles.set(id, {
        id,
        endpoint: adapter.endpoint,
        model,
        timeoutMs,
        stream,
        source: "RUNTIME",
        configuredAt: typeof value.configuredAt === "string" ? value.configuredAt : this.#clock().toISOString(),
        verifiedAt: typeof value.verifiedAt === "string" ? value.verifiedAt : null,
        apiKey,
        adapter,
      });
    }
    if (stored.activeProfileId && this.#profiles.get(stored.activeProfileId)?.verifiedAt) this.#activeProfileId = stored.activeProfileId;
  }

  #public(profile) {
    return {
      id: profile.id,
      endpoint: profile.endpoint,
      model: profile.model,
      timeoutMs: profile.timeoutMs,
      stream: profile.stream,
      source: profile.source,
      configuredAt: profile.configuredAt,
      verifiedAt: profile.verifiedAt,
      ready: Boolean(profile.verifiedAt),
      active: profile.id === this.#activeProfileId,
    };
  }

  #persist() {
    if (!this.#profileStore) return;
    this.#profileStore.save({
      activeProfileId: this.#activeProfileId,
      profiles: [...this.#profiles.values()].filter((profile) => profile.source === "RUNTIME").map((profile) => ({
        id: profile.id,
        endpoint: profile.endpoint,
        model: profile.model,
        timeoutMs: profile.timeoutMs,
        stream: profile.stream,
        configuredAt: profile.configuredAt,
        verifiedAt: profile.verifiedAt,
        apiKey: profile.apiKey,
      })),
    });
  }

  list() {
    return [...this.#profiles.values()].map((profile) => this.#public(profile)).sort((left, right) => left.id.localeCompare(right.id));
  }

  active() {
    const profile = this.#profiles.get(this.#activeProfileId);
    return profile ? this.#public(profile) : null;
  }

  resolve(id) {
    const profile = this.#profiles.get(id ?? this.#activeProfileId);
    return profile?.verifiedAt ? profile.adapter : null;
  }

  configure(input) {
    if (!input || typeof input !== "object") throw new TypeError("analysis model profile must be an object");
    const id = requiredString(input.id, "analysis model profile id");
    const existing = this.#profiles.get(id);
    const endpoint = endpointUrl(input.endpoint);
    const model = requiredString(input.model, "analysis model name");
    const hasNewApiKey = typeof input.apiKey === "string" && input.apiKey.trim() !== "";
    const apiKey = hasNewApiKey
      ? requiredString(input.apiKey, "analysis model API key")
      : existing?.source === "RUNTIME"
        ? existing.apiKey
        : requiredString(input.apiKey, "analysis model API key");
    const timeoutMs = input.timeoutMs ?? 120_000;
    const stream = input.stream ?? false;
    const adapter = new OpenAICompatibleAnalysisModelAdapter({ id, endpoint, model, timeoutMs, stream, fetchImpl: this.#fetchImpl, apiKeyResolver: () => apiKey });
    const connectionUnchanged = existing?.source === "RUNTIME" && !hasNewApiKey && existing.endpoint === adapter.endpoint && existing.model === model && existing.timeoutMs === timeoutMs && existing.stream === stream;
    const profile = { id, endpoint: adapter.endpoint, model, timeoutMs, stream, source: "RUNTIME", configuredAt: this.#clock().toISOString(), verifiedAt: connectionUnchanged ? existing.verifiedAt : null, apiKey, adapter };
    this.#profiles.set(id, profile);
    if (this.#activeProfileId === id && !profile.verifiedAt) this.#activeProfileId = null;
    this.#persist();
    return this.#public(profile);
  }

  async verify(id) {
    const profile = this.#profiles.get(requiredString(id, "analysis model profile id"));
    if (!profile) throw new TypeError(`Analysis model profile ${id} is not configured`);
    const verification = await profile.adapter.verify();
    profile.verifiedAt = this.#clock().toISOString();
    if (!this.#activeProfileId) this.#activeProfileId = profile.id;
    this.#persist();
    return { ...this.#public(profile), latencyMs: verification.latencyMs };
  }

  select(id) {
    const profile = this.#profiles.get(requiredString(id, "analysis model profile id"));
    if (!profile) throw new TypeError(`Analysis model profile ${id} is not configured`);
    if (!profile.verifiedAt) throw new TypeError(`Analysis model profile ${id} must be verified before selection`);
    this.#activeProfileId = profile.id;
    this.#persist();
    return this.#public(profile);
  }

  remove(id) {
    const profileId = requiredString(id, "analysis model profile id");
    const profile = this.#profiles.get(profileId);
    if (!profile) throw new TypeError(`Analysis model profile ${profileId} is not configured`);
    if (profile.source === "ENVIRONMENT") throw new TypeError(`Environment model profile ${profileId} cannot be deleted at runtime`);
    this.#profiles.delete(profileId);
    if (this.#activeProfileId === profileId) {
      this.#activeProfileId = this.list().find((candidate) => candidate.ready)?.id ?? null;
    }
    this.#persist();
    return this.#public(profile);
  }

  async enrichWorkspaceCandidates(id, candidates, options = {}) {
    const profile = this.#profiles.get(requiredString(id, "analysis model profile id"));
    if (!profile) throw new TypeError(`Analysis model profile ${id} is not configured`);
    if (!profile.verifiedAt) throw new TypeError(`Analysis model profile ${id} must be verified before analysis`);
    return profile.adapter.enrichWorkspaceCandidates(candidates, options);
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
      stream: profile.stream ?? false,
      apiKeyResolver: () => secretEnvironment ? env[secretEnvironment] ?? null : null,
    }));
  }
  return result;
}
