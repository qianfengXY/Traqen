import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  normalizeCandidateBundle,
  normalizeWorkUnit,
} from "../shared/candidate-bundle.js";
import { canonicalJson, contentId } from "../domain/canonical-json.js";
import { createGlobalModelProfileRevision } from "../domain/workspace-execution-profile.js";

const CLI_MODEL_ADAPTERS = Object.freeze({
  CODEX: { executable: "codex", args: (prompt, model) => ["exec", "--json", ...(model ? ["--model", model] : []), prompt] },
  CLAUDE: { executable: "claude", args: (prompt, model) => ["--print", "--output-format", "json", ...(model ? ["--model", model] : []), prompt] },
  GEMINI: { executable: "gemini", args: (prompt, model) => ["--output-format", "json", ...(model ? ["--model", model] : []), "--prompt", prompt] },
  KIMI: { executable: "kimi", args: (prompt, model) => [...(model ? ["--model", model] : []), "--prompt", prompt] },
});

function allowlistedCliExecutable(cliAdapter, executablePath) {
  const expected = CLI_MODEL_ADAPTERS[cliAdapter].executable;
  if (executablePath === null || executablePath === undefined || executablePath === "") return expected;
  const supplied = requiredString(executablePath, "CLI executable path");
  if (supplied !== expected) throw new TypeError(`CLI executable path for ${cliAdapter} must be the allowlisted executable ${expected}`);
  return expected;
}

function parseCliJsonDocument(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const candidates = [value.trim()];
  for (const match of value.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1].trim());
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* Try the next bounded representation. */ }
  }
  return null;
}

function decodeCliJsonOutput(cliAdapter, raw) {
  const records = raw.split(/\r?\n/).map((line) => parseCliJsonDocument(line)).filter(Boolean);
  const payloads = [];
  if (cliAdapter === "CODEX") {
    for (const record of records) {
      if (record?.type === "item.completed" && record.item?.type === "agent_message") payloads.push(record.item.text);
    }
  } else if (cliAdapter === "CLAUDE") {
    for (const record of records) if (record?.type === "result" && record.subtype !== "error") payloads.push(record.result);
  } else if (cliAdapter === "GEMINI") {
    for (const record of records) if (Object.hasOwn(record, "response")) payloads.push(record.response);
  }
  const candidates = [...payloads].reverse();
  candidates.push(raw);
  for (const payload of candidates) {
    const decoded = parseCliJsonDocument(payload);
    if (decoded) return decoded;
  }
  throw new SyntaxError(`CLI model ${cliAdapter} did not return a JSON result`);
}

export class AllowlistedCliModelAdapter {
  constructor({ id, cliAdapter, model = null, executablePath = null, timeoutMs = 120_000, maximumOutputBytes = 1_000_000, spawnImpl = spawn }) {
    this.id = requiredString(id, "CLI model profile id");
    this.cliAdapter = requiredString(cliAdapter, "CLI adapter").toUpperCase();
    if (!CLI_MODEL_ADAPTERS[this.cliAdapter]) throw new TypeError(`unsupported CLI adapter ${this.cliAdapter}`);
    this.model = model ? requiredString(model, "CLI model name") : null;
    this.executablePath = allowlistedCliExecutable(this.cliAdapter, executablePath);
    this.timeoutMs = Number(timeoutMs);
    this.maximumOutputBytes = Number(maximumOutputBytes);
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) throw new TypeError("CLI timeoutMs must be a positive integer");
    if (!Number.isInteger(this.maximumOutputBytes) || this.maximumOutputBytes < 1) throw new TypeError("CLI maximumOutputBytes must be a positive integer");
    if (typeof spawnImpl !== "function") throw new TypeError("CLI spawnImpl must be a function");
    this.spawnImpl = spawnImpl;
  }

  #run(args, { signal = null } = {}) {
    const definition = CLI_MODEL_ADAPTERS[this.cliAdapter];
    const executable = this.executablePath;
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(executable, args, { shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let settled = false;
      const stop = (reason) => {
        if (settled) return;
        try { process.platform === "win32" ? child.kill("SIGKILL") : process.kill(-child.pid, "SIGKILL"); } catch { child.kill?.("SIGKILL"); }
        settled = true;
        reject(reason);
      };
      const timer = setTimeout(() => stop(new Error(`CLI model ${this.id} timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
      timer.unref?.();
      const append = (current, chunk) => {
        const next = Buffer.concat([current, Buffer.from(chunk)]);
        if (next.length > this.maximumOutputBytes) stop(new Error(`CLI model ${this.id} exceeded output limit`));
        return next;
      };
      child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
      child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
      child.once("error", (error) => stop(error));
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`CLI model ${this.id} exited ${code}: ${stderr.toString("utf8").slice(0, 500)}`));
        else resolve(stdout.toString("utf8"));
      });
      if (signal) {
        if (signal.aborted) stop(signal.reason ?? new Error("CLI model execution cancelled"));
        else signal.addEventListener("abort", () => stop(signal.reason ?? new Error("CLI model execution cancelled")), { once: true });
      }
    });
  }

  async verify() {
    const startedAt = Date.now();
    const challenge = randomUUID();
    const result = await this.#jsonTask("connection-verification", {
      challenge,
      responseContract: { ready: true, challenge: "copy the supplied challenge exactly" },
    });
    if (result?.ready !== true || result.challenge !== challenge) {
      throw new Error(`CLI model ${this.id} failed the verification challenge`);
    }
    return { latencyMs: Date.now() - startedAt };
  }

  async #jsonTask(task, input, options = {}) {
    const prompt = JSON.stringify({ task, input });
    const raw = await this.#run(CLI_MODEL_ADAPTERS[this.cliAdapter].args(prompt, this.model), { signal: options.signal ?? null });
    return decodeCliJsonOutput(this.cliAdapter, raw);
  }

  enrichWorkspaceCandidates(input, options = {}) { return this.#jsonTask("workspace-enrichment", input, options); }
  planWorkspaceAnalysis(input, options = {}) { return this.#jsonTask("workspace-plan", input, options); }
}

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

function telemetryTimestamp() {
  return new Date().toISOString();
}

function boundedPreview(value, maximum = 24_000) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= maximum) return { text, truncated: false, originalCharacters: text.length };
  return { text: `${text.slice(0, maximum)}\n… [truncated by Traqen]`, truncated: true, originalCharacters: text.length };
}

function emitTelemetry(callback, event) {
  if (typeof callback !== "function") return;
  try {
    callback({ at: telemetryTimestamp(), ...event });
  } catch {
    // Observability must never change model execution semantics.
  }
}

function responseUsage(value, contentType = "") {
  const payloads = [];
  if (/text\/event-stream/i.test(contentType) || /^\s*(?:event:.*\r?\n)?data:/m.test(value)) {
    for (const event of value.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n").trim();
      if (!data || data === "[DONE]") continue;
      try { payloads.push(JSON.parse(data)); } catch { /* Parsed by the strict response decoder later. */ }
    }
  } else {
    try { payloads.push(JSON.parse(value)); } catch { /* Parsed by the strict response decoder later. */ }
  }
  const usage = [...payloads].reverse().find((payload) => payload?.usage)?.usage;
  if (!usage || typeof usage !== "object") return null;
  const number = (candidate) => Number.isFinite(candidate) && candidate >= 0 ? Number(candidate) : null;
  return {
    inputTokens: number(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: number(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: number(usage.total_tokens),
  };
}

function observableStreamOutput(value, contentType = "") {
  if (!/text\/event-stream/i.test(contentType) && !/^\s*(?:event:.*\r?\n)?data:/m.test(value)) return null;
  const pieces = [];
  for (const event of value.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!data || data === "[DONE]") continue;
    try {
      const payload = JSON.parse(data);
      const delta = payload?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") pieces.push(delta);
      else if (Array.isArray(delta)) pieces.push(...delta.map((item) => typeof item?.text === "string" ? item.text : "").filter(Boolean));
      else if (typeof payload?.delta === "string" && /output_text\.delta|content_block_delta/i.test(payload?.type ?? "")) pieces.push(payload.delta);
      else if (typeof payload?.delta?.text === "string") pieces.push(payload.delta.text);
    } catch {
      // Strict parsing remains the responsibility of the final response decoder.
    }
  }
  const output = pieces.join("");
  const jsonStart = [output.indexOf("{"), output.indexOf("[")].filter((index) => index >= 0).sort((left, right) => left - right)[0];
  if (jsonStart === undefined) return null;
  return boundedPreview(output.slice(jsonStart), 8_000).text;
}

function visibleAgentMessage(value) {
  const marker = /"agentMessage"\s*:\s*"/g;
  const match = marker.exec(value);
  if (!match) return null;
  let result = "";
  let escaped = false;
  for (let index = marker.lastIndex; index < value.length && result.length < 4_000; index += 1) {
    const character = value[index];
    if (!escaped && character === '"') return result;
    if (!escaped && character === "\\") {
      escaped = true;
      continue;
    }
    if (escaped) {
      const simpleEscape = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" }[character];
      if (simpleEscape !== undefined) result += simpleEscape;
      else if (character === "u" && /^[0-9a-f]{4}$/i.test(value.slice(index + 1, index + 5))) {
        result += String.fromCharCode(Number.parseInt(value.slice(index + 1, index + 5), 16));
        index += 4;
      }
      escaped = false;
      continue;
    }
    result += character;
  }
  return result || null;
}

function observableAgentMessage(value, contentType = "") {
  if (!/text\/event-stream/i.test(contentType) && !/^\s*(?:event:.*\r?\n)?data:/m.test(value)) return null;
  const pieces = [];
  for (const event of value.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!data || data === "[DONE]") continue;
    try {
      const payload = JSON.parse(data);
      const delta = payload?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") pieces.push(delta);
      else if (Array.isArray(delta)) pieces.push(...delta.map((item) => typeof item?.text === "string" ? item.text : "").filter(Boolean));
      else if (typeof payload?.delta === "string" && /output_text\.delta|content_block_delta/i.test(payload?.type ?? "")) pieces.push(payload.delta);
      else if (typeof payload?.delta?.text === "string") pieces.push(payload.delta.text);
    } catch {
      // The strict decoder reports malformed events after the stream ends.
    }
  }
  return visibleAgentMessage(pieces.join(""));
}

async function responseBodyText(response, { onTelemetry, requestId, startedAt, contentType }) {
  const reader = response.body?.getReader?.();
  if (!reader) return response.text();
  const decoder = new TextDecoder();
  let value = "";
  let chunkCount = 0;
  let lastEmittedAt = 0;
  let lastEmittedCharacters = 0;
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    chunkCount += 1;
    value += decoder.decode(chunk, { stream: true });
    if (value.length > 2_000_000) throw new TypeError("analysis model response exceeds the bounded response size");
    const now = Date.now();
    if (value.length - lastEmittedCharacters >= 4_096 || now - lastEmittedAt >= 500) {
      lastEmittedAt = now;
      lastEmittedCharacters = value.length;
      emitTelemetry(onTelemetry, {
        type: "RESPONSE_PROGRESS",
        requestId,
        chunkCount,
        receivedCharacters: value.length,
        elapsedMs: now - startedAt,
        outputPreview: observableStreamOutput(value, contentType),
        assistantMessage: observableAgentMessage(value, contentType),
      });
    }
  }
  value += decoder.decode();
  emitTelemetry(onTelemetry, {
    type: "RESPONSE_PROGRESS",
    requestId,
    chunkCount,
    receivedCharacters: value.length,
    elapsedMs: Date.now() - startedAt,
    complete: true,
    outputPreview: observableStreamOutput(value, contentType),
    assistantMessage: observableAgentMessage(value, contentType),
  });
  return value;
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
  const parsed = payload?.choices?.[0]?.message?.parsed;
  if (parsed && typeof parsed === "object") return JSON.stringify(parsed);
  const toolArguments = payload?.choices?.[0]?.message?.tool_calls?.find?.((call) => typeof call?.function?.arguments === "string")?.function?.arguments;
  if (toolArguments) return toolArguments;
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
  let terminalReason = null;
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
    terminalReason = payload?.choices?.[0]?.finish_reason
      ?? payload?.stop_reason
      ?? payload?.incomplete_details?.reason
      ?? (payload?.type === "response.incomplete" ? payload?.response?.incomplete_details?.reason ?? "incomplete" : terminalReason);
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
  if (["length", "max_tokens", "max_output_tokens", "incomplete"].includes(terminalReason)) {
    const error = new TypeError(`analysis model output was truncated (${terminalReason})`);
    error.code = "MODEL_OUTPUT_TRUNCATED";
    throw error;
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
    if (stack.length > 0) return null;
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
    const terminalReason = payload?.choices?.[0]?.finish_reason ?? payload?.incomplete_details?.reason ?? payload?.stop_reason;
    if (["length", "max_tokens", "max_output_tokens", "incomplete"].includes(terminalReason)) {
      const truncated = new TypeError(`analysis model output was truncated (${terminalReason})`, { cause: error });
      truncated.code = "MODEL_OUTPUT_TRUNCATED";
      throw truncated;
    }
    throw new TypeError("analysis model message text does not contain a complete JSON object or array", { cause: error });
  }
}

function boundedWorkspaceCandidateBundle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("workspace enrichment input must contain a WorkUnit and CandidateBundle");
  }
  const workUnit = normalizeWorkUnit(value.workUnit);
  const candidateBundle = normalizeCandidateBundle(value.candidateBundle, workUnit);
  if (candidateBundle.candidates.length === 0 || candidateBundle.candidates.length > 24) {
    throw new TypeError("workspace model batch must contain between 1 and 24 candidates");
  }
  const candidates = candidateBundle.candidates.map((candidate, index) => {
    const proposal = candidate.proposal;
    const evidence = proposal.evidence && typeof proposal.evidence === "object" ? proposal.evidence : {};
    const allowedConfidence = new Set(["LOW", "MEDIUM", "HIGH"]);
    const confidenceCap = allowedConfidence.has(evidence.confidenceCap) ? evidence.confidenceCap : candidate.confidenceCap;
    if (confidenceCap !== candidate.confidenceCap) {
      throw new TypeError(`workspace candidate ${index} evidence confidenceCap must match its CandidateBundle`);
    }
    const stringList = (items, maximumItems, maximumLength) => Array.isArray(items)
      ? items.slice(0, maximumItems).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().slice(0, maximumLength))
      : [];
    const observations = Array.isArray(evidence.observations) ? evidence.observations.slice(0, 8).map((observation, observationIndex) => {
      if (!observation || typeof observation !== "object") throw new TypeError(`workspace candidate ${index} evidence observation ${observationIndex} must be an object`);
      return {
        extractor: requiredString(observation.extractor, `workspace candidate ${index} evidence observation ${observationIndex} extractor`).slice(0, 80),
        basis: requiredString(observation.basis, `workspace candidate ${index} evidence observation ${observationIndex} basis`).slice(0, 160),
        sourcePath: requiredString(observation.sourcePath, `workspace candidate ${index} evidence observation ${observationIndex} sourcePath`).slice(0, 800),
        startLine: Number.isSafeInteger(observation.startLine) && observation.startLine > 0 ? observation.startLine : 1,
        excerpt: typeof observation.excerpt === "string" ? observation.excerpt.slice(0, 1_200) : "",
      };
    }) : [];
    if (observations.length === 0) {
      observations.push({
        extractor: "UNDECLARED_LEGACY_EXTRACTOR",
        basis: "Legacy candidate without an explicit extraction basis",
        sourcePath: typeof proposal.sourcePath === "string" ? proposal.sourcePath.slice(0, 800) : "unknown",
        startLine: 1,
        excerpt: typeof proposal.code === "string" ? proposal.code.slice(0, 1_200) : "",
      });
    }
    return {
      id: requiredString(candidate.id, `workspace candidate ${index} id`),
      kind: requiredString(proposal.kind, `workspace candidate ${index} proposal.kind`).slice(0, 40),
      name: requiredString(proposal.name, `workspace candidate ${index} proposal.name`).slice(0, 300),
      method: typeof proposal.method === "string" ? proposal.method.slice(0, 20) : null,
      modulePath: typeof proposal.modulePath === "string" ? proposal.modulePath.slice(0, 300) : "",
      sourcePath: typeof proposal.sourcePath === "string" ? proposal.sourcePath.slice(0, 800) : "",
      description: typeof proposal.description === "string" ? proposal.description.slice(0, 1_200) : "",
      code: typeof proposal.code === "string" ? proposal.code.slice(0, 2_000) : "",
      evidenceFactIds: candidate.evidenceFactIds,
      confidenceCap: candidate.confidenceCap,
      evidence: {
        observations,
        corroborations: stringList(evidence.corroborations, 16, 800),
        contradictions: stringList(evidence.contradictions, 16, 800),
        diagnostics: stringList(evidence.diagnostics, 16, 800),
        completeness: ["COMPLETE", "PARTIAL", "UNKNOWN"].includes(evidence.completeness) ? evidence.completeness : "UNKNOWN",
        confidenceCap,
      },
    };
  });
  if (JSON.stringify(candidates).length > 72_000) throw new RangeError("workspace model batch exceeds the bounded context size");
  return { workUnit, candidateBundle, candidates };
}

function boundedWorkspacePlan(value) {
  if (!value || typeof value !== "object") throw new TypeError("workspace plan input must be an object");
  const modules = Array.isArray(value.modules) ? value.modules.slice(0, 120).map((module, index) => ({
    name: requiredString(module?.name, `workspace plan module ${index} name`).slice(0, 300),
    fileCount: Number.isSafeInteger(module?.fileCount) && module.fileCount >= 0 ? module.fileCount : 0,
    sourceBytes: Number.isSafeInteger(module?.sourceBytes) && module.sourceBytes >= 0 ? module.sourceBytes : 0,
    languages: Array.isArray(module?.languages)
      ? [...new Set(module.languages.filter((language) => typeof language === "string" && language.trim()).map((language) => language.trim().slice(0, 40)))].slice(0, 24)
      : [],
  })) : [];
  const childSlots = (Array.isArray(value.childSlots) && value.childSlots.length > 0
    ? value.childSlots
    : [
        { id: "CHILD-1", independenceGroup: "DEFAULT-1" },
        { id: "CHILD-2", independenceGroup: "DEFAULT-2" },
      ]).map((slot, index) => ({
    id: requiredString(slot?.id, `workspace plan childSlots[${index}].id`).slice(0, 100),
    independenceGroup: requiredString(
      slot?.independenceGroup,
      `workspace plan childSlots[${index}].independenceGroup`,
    ).slice(0, 100),
  }));
  if (new Set(childSlots.map(({ id }) => id)).size !== childSlots.length) {
    throw new TypeError("workspace plan Child slot ids must be unique");
  }
  return {
    workspaceName: requiredString(value.workspaceName, "workspace plan workspaceName").slice(0, 200),
    mode: value.mode === "INCREMENTAL" ? "INCREMENTAL" : "FULL",
    fileCount: Number.isSafeInteger(value.fileCount) && value.fileCount >= 0 ? value.fileCount : 0,
    modules,
    childSlots,
  };
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

  async #request({ messages, maxOutputTokens }, { signal = null, onTelemetry = null } = {}) {
    const requestId = `${this.id}:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
    const startedAt = Date.now();
    const prompt = boundedPreview(messages);
    emitTelemetry(onTelemetry, {
      type: "REQUEST_PREPARED",
      requestId,
      profileId: this.id,
      model: this.model,
      endpoint: this.endpoint,
      transport: this.stream ? "STREAM_SSE" : "JSON",
      maxOutputTokens,
      inputCharacters: JSON.stringify(messages).length,
      promptPreview: prompt.text,
      promptTruncated: prompt.truncated,
      promptOriginalCharacters: prompt.originalCharacters,
    });
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
      emitTelemetry(onTelemetry, {
        type: "HTTP_CONNECTED",
        requestId,
        status: response.status,
        contentType: response.headers?.get?.("content-type") ?? "",
        timeToFirstByteMs: Date.now() - startedAt,
      });
      if (!response.ok) {
        const detail = typeof response.text === "function" ? await response.text().catch(() => "") : "";
        throw new AnalysisModelConnectionError(`Analysis model request failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }
      try {
        const contentType = response.headers?.get?.("content-type") ?? "";
        const responseTextValue = await responseBodyText(response, { onTelemetry, requestId, startedAt, contentType });
        const result = structuredResponse(responseTextValue, contentType);
        const output = boundedPreview(result);
        emitTelemetry(onTelemetry, {
          type: "STRUCTURED_RESPONSE_PARSED",
          requestId,
          elapsedMs: Date.now() - startedAt,
          outputCharacters: JSON.stringify(result).length,
          outputPreview: output.text,
          outputTruncated: output.truncated,
          assistantMessage: typeof result?.agentMessage === "string" ? result.agentMessage.slice(0, 4_000) : null,
          usage: responseUsage(responseTextValue, contentType),
        });
        return result;
      } catch (error) {
        const reason = error instanceof TypeError && error.message.startsWith("analysis model ")
          ? error.message
          : "HTTP response body is not valid JSON";
        throw new AnalysisModelConnectionError(`Analysis model returned an invalid structured JSON response: ${reason}`, { cause: error });
      }
    } catch (error) {
      emitTelemetry(onTelemetry, {
        type: "REQUEST_FAILED",
        requestId,
        elapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Unknown analysis model error",
      });
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

  async planWorkspaceAnalysis(value, options = {}) {
    const input = boundedWorkspacePlan(value);
    const moduleNames = new Set(input.modules.map((module) => module.name));
    const expectedIds = new Set(input.childSlots.map(({ id }) => id));
    const sharedScopes = [...moduleNames];
    const result = await this.#request({
      maxOutputTokens: 2_048,
      messages: [
        {
          role: "system",
          content: [
            "You are Traqen's main Workspace orchestration agent.",
            `Create exactly ${input.childSlots.length} child-agent assignments, one for each supplied Child slot.`,
            "Every Child receives the same sealed AnalysisBatch: identical module scope, task statement, source policy, and output schema. The manifest is independent of scanner candidates.",
            "Return JSON only with agentMessage and taskAssignments.",
            "agentMessage is a concise user-visible execution update, not private reasoning. Use short lines for Goal, Plan, Evidence basis, Risks, and Next action. Do not quote prompts or source code.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Plan one bounded source-analysis batch for independent execution by every configured Child slot.",
            workspace: input,
            outputContract: {
              agentMessage: "public orchestration plan",
              taskAssignments: input.childSlots.map(({ id }) => ({
                agentId: id,
                objective: "same bounded analysis objective",
                moduleScopes: sharedScopes,
              })),
            },
          }),
        },
      ],
    }, options);
    if (typeof result?.agentMessage !== "string" || !result.agentMessage.trim()) throw new AnalysisModelConnectionError("Analysis model orchestration plan requires agentMessage");
    if (!Array.isArray(result.taskAssignments) || result.taskAssignments.length !== input.childSlots.length) {
      throw new AnalysisModelConnectionError(`Analysis model orchestration plan requires exactly ${input.childSlots.length} task assignments`);
    }
    const assignments = result.taskAssignments.map((assignment, index) => {
      const agentId = requiredString(assignment?.agentId, `task assignment ${index} agentId`);
      if (!expectedIds.delete(agentId)) throw new AnalysisModelConnectionError(`Analysis model orchestration plan returned unsupported or duplicate agent ${agentId}`);
      return {
        agentId,
        objective: requiredString(assignment.objective, `task assignment ${index} objective`).slice(0, 500),
        moduleScopes: sharedScopes,
      };
    });
    return { agentMessage: result.agentMessage.trim().slice(0, 4_000), taskAssignments: assignments };
  }

  async enrichWorkspaceCandidates(value, options = {}) {
    const input = boundedWorkspaceCandidateBundle(value);
    const { workUnit, candidateBundle, candidates } = input;
    const inputIds = new Set(candidates.map((candidate) => candidate.id));
    const result = await this.#request({
      maxOutputTokens: Math.min(8_192, Math.max(1_200, candidates.length * 480)),
      messages: [
        {
          role: "system",
          content: [
            "You are Traqen's bounded Workspace analysis agent.",
            "Classify implementation candidates using only the supplied paths, descriptions, and code excerpts.",
            "Treat extractor output as an observation, never as truth. Weigh independent corroborations, contradictions, parser diagnostics, completeness, and the supplied confidenceCap.",
            "Your confidence must never exceed each candidate evidence.confidenceCap. Keep uncertainty explicit when evidence is single-source or incomplete.",
            "Do not invent permissions, business rules, dependencies, tests, or authority.",
            "Return JSON only with agentMessage and candidates[]. Preserve every input id exactly.",
            "Every candidate conclusion must include non-empty evidenceFactIds from the supplied WorkUnit. Never cite any other Fact.",
            "agentMessage is a concise user-visible execution update, not private reasoning. Use short lines for Goal, Action, Findings, Evidence, Uncertainty, and Next action. Do not quote raw source or prompts.",
            "businessFeature is true only for a user-recognizable business capability or background business process; repositories, DTOs, adapters, configuration, utilities, and framework plumbing are false.",
            "For every candidate, return a stable businessKey plus businessModule and businessSubmodule from a product user's perspective. Use the same businessKey when multiple code observations implement the same user-recognizable behavior. These fields must describe what the product does, never source folders, packages, classes, frameworks, or code layers.",
            "For businessFeature=true, displayName must be a plain-language user-recognizable function name. Do not expose code symbols or implementation terminology in the business hierarchy.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Improve readable feature names and distinguish business capabilities from technical symbols.",
            candidates,
            outputContract: {
              agentMessage: "concise public conclusion for this bounded analysis task",
              candidates: [{
                id: "input id",
                displayName: "concise user-recognizable name",
                description: "evidence-bounded behavior description",
                businessFeature: true,
                businessKey: "stable product behavior key, such as workspace.create",
                businessModule: "product-level capability area, such as Workspace management",
                businessSubmodule: "smaller user-facing area, such as Workspace lifecycle",
                domain: "short business domain",
                group: "BUSINESS_CAPABILITY | BACKGROUND_INTEGRATION | DATA_INTEGRATION | PROJECT_OPERATION | API_SERVICE",
                confidence: "LOW | MEDIUM | HIGH",
                rationale: "short evidence-based reason",
                evidenceFactIds: ["Fact ids from this WorkUnit only"],
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
      const confidenceRank = { LOW: 1, MEDIUM: 2, HIGH: 3 };
      const validated = result.candidates.map((candidate, index) => {
        const id = requiredString(candidate?.id, `workspace response candidate ${index} id`);
        if (!inputIds.has(id) || seen.has(id)) throw new TypeError(`analysis model returned an unknown or duplicate candidate id ${id}`);
        seen.add(id);
        const group = requiredString(candidate.group, `workspace response candidate ${index} group`);
        const confidence = requiredString(candidate.confidence, `workspace response candidate ${index} confidence`);
        if (!allowedGroups.has(group)) throw new TypeError(`analysis model returned unsupported group ${group}`);
        if (!allowedConfidence.has(confidence)) throw new TypeError(`analysis model returned unsupported confidence ${confidence}`);
        const input = candidates.find((item) => item.id === id);
        if (confidenceRank[confidence] > confidenceRank[input.evidence.confidenceCap]) {
          throw new TypeError(`analysis model confidence ${confidence} exceeds evidence cap ${input.evidence.confidenceCap} for ${id}`);
        }
        if (typeof candidate.businessFeature !== "boolean") throw new TypeError(`workspace response candidate ${index} businessFeature must be boolean`);
        const evidenceFactIds = Array.isArray(candidate.evidenceFactIds)
          ? candidate.evidenceFactIds.map((factId, factIndex) =>
            requiredString(factId, `workspace response candidate ${index} evidenceFactIds[${factIndex}]`))
          : [];
        return {
          id,
          kind: "CANDIDATE_FEATURE",
          status: "PENDING_REVIEW",
          confidence,
          confidenceCap: input.confidenceCap,
          evidenceFactIds,
          proposal: {
            displayName: requiredString(candidate.displayName, `workspace response candidate ${index} displayName`).slice(0, 200),
            description: requiredString(candidate.description, `workspace response candidate ${index} description`).slice(0, 2_000),
            businessFeature: candidate.businessFeature,
            businessKey: requiredString(candidate.businessKey, `workspace response candidate ${index} businessKey`).slice(0, 160),
            businessModule: requiredString(candidate.businessModule, `workspace response candidate ${index} businessModule`).slice(0, 120),
            businessSubmodule: requiredString(candidate.businessSubmodule, `workspace response candidate ${index} businessSubmodule`).slice(0, 120),
            domain: requiredString(candidate.domain, `workspace response candidate ${index} domain`).slice(0, 120),
            group,
            rationale: requiredString(candidate.rationale, `workspace response candidate ${index} rationale`).slice(0, 1_000),
          },
          provenance: [{
            producerType: "MODEL",
            producerId: this.id,
            producerVersion: this.model,
          }],
        };
      });
      const missing = candidates.filter((candidate) => !seen.has(candidate.id)).map((candidate) => candidate.id);
      if (missing.length > 0) throw new TypeError(`analysis model omitted ${missing.length} input candidate ids`);
      emitTelemetry(options.onTelemetry, {
        type: "OUTPUT_VALIDATED",
        candidateCount: validated.length,
        businessCandidateCount: validated.filter((candidate) => candidate.proposal.businessFeature).length,
        technicalCandidateCount: validated.filter((candidate) => !candidate.proposal.businessFeature).length,
        confidence: validated.reduce((counts, candidate) => ({ ...counts, [candidate.confidence]: (counts[candidate.confidence] ?? 0) + 1 }), {}),
      });
      return normalizeCandidateBundle({
        schemaVersion: candidateBundle.schemaVersion,
        id: `${candidateBundle.id}:MODEL:${this.id}`,
        projectId: candidateBundle.projectId,
        snapshotManifestId: candidateBundle.snapshotManifestId,
        analysisRunId: candidateBundle.analysisRunId,
        workUnitId: candidateBundle.workUnitId,
        producedAt: new Date().toISOString(),
        candidates: validated,
      }, workUnit);
    } catch (error) {
      emitTelemetry(options.onTelemetry, {
        type: "OUTPUT_REJECTED",
        message: error instanceof Error ? error.message : "Unknown Workspace output validation error",
      });
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
                workUnit: input.workUnit,
                workContext: input.workContext,
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

  async reconcile(input, { signal = null } = {}) {
    return this.#request({
      maxOutputTokens: input.context.maxOutputTokens,
      messages: [
        {
          role: "system",
          content: [
            "You are Traqen's bounded Main reconciliation Agent.",
            "Return JSON only with candidateDecisions, relations, and gaps arrays.",
            "Decide every supplied candidateRef exactly once using ACCEPT, REJECT, CONFLICT, MERGE, or ALTERNATIVE.",
            "Do not use voting or byte equality. Compare semantic claims and cite only supplied Fact or SourceSlice evidence.",
            "Relations may reference only supplied Candidate refs or scoped Artifact ids.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Reconcile the complete terminal Child result set against bounded evidence and prior context.",
            workUnit: input.workUnit,
            workContext: input.workContext,
            candidateOptions: input.candidateOptions,
            contextCandidates: input.contextCandidates,
            scopedArtifacts: input.scopedArtifacts,
            evidence: input.evidence,
            outputContract: {
              candidateDecisions: [{
                candidateRef: "exact supplied ref",
                disposition: "ACCEPT | REJECT | CONFLICT | MERGE | ALTERNATIVE",
                rationale: "evidence-bounded reason",
                relatedCandidateRefs: ["optional supplied refs"],
                mergedProposal: { name: "required for MERGE", statement: "one reconciled semantic claim", subjectKey: "optional supplied scoped path", confidence: "LOW" },
              }],
              relations: [{
                sourceCandidateRef: "optional supplied ref",
                sourceArtifactId: "optional supplied Artifact id",
                predicate: "semantic relationship",
                targetCandidateRef: "optional supplied ref",
                targetArtifactId: "optional supplied Artifact id",
                evidenceFactIds: ["supplied Fact ids"],
                sourceSliceIds: ["supplied SourceSlice ids"],
              }],
              gaps: [{ code: "bounded gap code", message: "explanation" }],
            },
          }),
        },
      ],
    }, { signal });
  }
}

export class AnalysisModelRegistry {
  #profiles = new Map();
  #revisions = new Map();
  #clock;
  #fetchImpl;
  #profileStore;
  #adapters;
  #applyingReplacementProfiles = new Set();
  #credentialHandles = new Map();
  #environmentCredentialHandles = new Map();
  #issuedSecretGrants = new Map();

  constructor({ adapters = new Map(), clock = () => new Date(), fetchImpl = globalThis.fetch, profileStore = null } = {}) {
    if (!(adapters instanceof Map)) throw new TypeError("analysis model adapters must be a Map");
    if (typeof clock !== "function") throw new TypeError("analysis model registry clock must be a function");
    if (typeof fetchImpl !== "function") throw new TypeError("analysis model registry fetchImpl must be a function");
    if (profileStore && (typeof profileStore.load !== "function" || typeof profileStore.save !== "function")) throw new TypeError("analysis model profileStore requires load and save functions");
    this.#clock = clock;
    this.#fetchImpl = fetchImpl;
    this.#profileStore = profileStore;
    this.#adapters = new Map(adapters);
    const stored = this.#profileStore?.load() ?? { profiles: [], revisions: [], credentialHandles: [], environmentCredentialHandles: [] };
    for (const value of stored.credentialHandles ?? []) {
      const handleId = requiredString(value?.id, "stored model credential handle id");
      const secret = requiredString(value?.secret, `stored model credential ${handleId}`);
      this.#credentialHandles.set(handleId, secret);
    }
    for (const value of stored.environmentCredentialHandles ?? []) {
      this.#environmentCredentialHandles.set(
        requiredString(value?.profileId, "stored environment model profile id"),
        requiredString(value?.credentialHandleId, "stored environment model credentialHandleId"),
      );
    }
    let createdEnvironmentHandle = false;
    for (const [id, adapter] of this.#adapters) {
      let credentialHandleId = this.#environmentCredentialHandles.get(id);
      if (!credentialHandleId) {
        credentialHandleId = `ENV-MODEL-CREDENTIAL-${randomUUID()}`;
        this.#environmentCredentialHandles.set(id, credentialHandleId);
        createdEnvironmentHandle = true;
      }
      const profile = { id, displayName: id, transport: "API", endpoint: adapter.endpoint, model: adapter.model, timeoutMs: adapter.timeoutMs, stream: adapter.stream, source: "ENVIRONMENT", lifecycle: "ACTIVE", revision: 1, configuredAt: this.#clock().toISOString(), verifiedAt: null, credentialHandleId, legacyCredentialHandleId: `ENV-MODEL-CREDENTIAL-${id}`, adapter };
      this.#publishRevision(profile, `MODEL-REVISION-${id}-ENVIRONMENT`);
    }
    for (const value of stored.profiles) {
      const id = requiredString(value?.id, "stored analysis model profile id");
      if (this.#profiles.has(id)) continue;
      const timeoutMs = value.timeoutMs ?? 120_000;
      const transport = String(value.transport ?? "API").toUpperCase();
      const stream = transport === "API" ? value.stream ?? false : false;
      const endpoint = transport === "API" ? endpointUrl(value.endpoint) : null;
      const model = value.model ? requiredString(value.model, "stored analysis model name") : null;
      const credential = transport === "API" ? this.#storedCredential(value, id) : null;
      const adapter = transport === "API"
        ? new OpenAICompatibleAnalysisModelAdapter({ id, endpoint, model, timeoutMs, stream, fetchImpl: this.#fetchImpl, apiKeyResolver: () => this.#credentialHandles.get(credential.credentialHandleId) ?? null })
        : new AllowlistedCliModelAdapter({ id, cliAdapter: value.cliAdapter, model, executablePath: value.executablePath, timeoutMs, maximumOutputBytes: value.maximumOutputBytes });
      const profile = {
        id,
        displayName: value.displayName ?? id,
        transport,
        endpoint: adapter.endpoint ?? null,
        model,
        timeoutMs,
        stream,
        cliAdapter: adapter.cliAdapter ?? null,
        executablePath: adapter.executablePath ?? null,
        maximumOutputBytes: adapter.maximumOutputBytes ?? null,
        source: "RUNTIME",
        lifecycle: "ACTIVE",
        revision: value.revision ?? 1,
        configuredAt: typeof value.configuredAt === "string" ? value.configuredAt : this.#clock().toISOString(),
        verifiedAt: typeof value.verifiedAt === "string" ? value.verifiedAt : null,
        credentialHandleId: credential?.credentialHandleId ?? null,
        legacyCredentialHandleId: credential?.legacyCredentialHandleId ?? null,
        adapter,
      };
      this.#publishRevision(profile, value.currentRevisionId);
    }
    for (const value of stored.revisions ?? []) {
      if (this.#revisions.has(value.currentRevisionId)) continue;
      this.#hydrateHistoricalRevision(value);
    }
    if (createdEnvironmentHandle) this.#persist();
  }

  #storedCredential(value, profileId) {
    const legacySecret = typeof value.apiKey === "string" && value.apiKey.trim() !== "" ? value.apiKey.trim() : null;
    const credentialHandleId = value.credentialHandleId
      ? requiredString(value.credentialHandleId, "stored model credentialHandleId")
      : `MODEL-CREDENTIAL-${randomUUID()}`;
    const secret = this.#credentialHandles.get(credentialHandleId) ?? legacySecret;
    if (!secret) throw new TypeError(`stored analysis model credential ${credentialHandleId} is unavailable`);
    this.#credentialHandles.set(credentialHandleId, secret);
    return {
      credentialHandleId,
      legacyCredentialHandleId: value.legacyCredentialHandleId
        ? requiredString(value.legacyCredentialHandleId, "stored model legacyCredentialHandleId")
        : legacySecret ? `MODEL-CREDENTIAL-${profileId}` : null,
    };
  }

  #public(profile) {
    return {
      id: profile.id,
      endpoint: profile.endpoint,
      model: profile.model,
      displayName: profile.displayName,
      transport: profile.transport,
      cliAdapter: profile.cliAdapter,
      executablePath: profile.executablePath,
      maximumOutputBytes: profile.maximumOutputBytes,
      timeoutMs: profile.timeoutMs,
      stream: profile.stream,
      source: profile.source,
      configuredAt: profile.configuredAt,
      verifiedAt: profile.verifiedAt,
      ready: Boolean(profile.verifiedAt),
      lifecycle: profile.lifecycle,
      currentRevisionId: profile.currentRevisionId,
      revision: profile.revision,
      credentialHandleId: profile.credentialHandleId,
    };
  }

  #newRevisionId(profile) {
    return createGlobalModelProfileRevision({
      profileId: profile.id,
      revision: profile.revision,
      displayName: profile.displayName,
      transport: profile.transport,
      ...(profile.transport === "API" ? {
        providerAdapter: "OPENAI_COMPATIBLE",
        endpoint: profile.endpoint,
        model: profile.model,
        credentialHandleId: profile.credentialHandleId,
      } : {
        cliAdapter: profile.cliAdapter,
        model: profile.model,
        executablePath: profile.executablePath,
      }),
    }, this.#clock).id;
  }

  #publishRevision(profile, revisionId = null) {
    profile.currentRevisionId = revisionId ?? this.#newRevisionId(profile);
    if (this.#revisions.has(profile.currentRevisionId)) throw new TypeError(`Model revision ${profile.currentRevisionId} already exists`);
    this.#profiles.set(profile.id, profile);
    this.#revisions.set(profile.currentRevisionId, { ...profile });
    return profile;
  }

  #hydrateHistoricalRevision(value) {
    const transport = String(value.transport ?? "API").toUpperCase();
    const credential = transport === "API" ? this.#storedCredential(value, value.id) : null;
    const adapter = transport === "API"
      ? new OpenAICompatibleAnalysisModelAdapter({ id: value.id, endpoint: value.endpoint, model: value.model, timeoutMs: value.timeoutMs, stream: value.stream, fetchImpl: this.#fetchImpl, apiKeyResolver: () => this.#credentialHandles.get(credential.credentialHandleId) ?? null })
      : new AllowlistedCliModelAdapter({ id: value.id, cliAdapter: value.cliAdapter, model: value.model, executablePath: value.executablePath, timeoutMs: value.timeoutMs, maximumOutputBytes: value.maximumOutputBytes });
    const { apiKey: _apiKey, ...safeValue } = value;
    this.#revisions.set(value.currentRevisionId, { ...safeValue, transport, credentialHandleId: credential?.credentialHandleId ?? null, legacyCredentialHandleId: credential?.legacyCredentialHandleId ?? null, adapter });
  }

  #serializable(profile) {
    return {
      id: profile.id, displayName: profile.displayName, transport: profile.transport, endpoint: profile.endpoint,
      model: profile.model, timeoutMs: profile.timeoutMs, stream: profile.stream, configuredAt: profile.configuredAt,
      verifiedAt: profile.verifiedAt, credentialHandleId: profile.credentialHandleId,
      legacyCredentialHandleId: profile.legacyCredentialHandleId, cliAdapter: profile.cliAdapter,
      executablePath: profile.executablePath, maximumOutputBytes: profile.maximumOutputBytes,
      currentRevisionId: profile.currentRevisionId,
      revision: profile.revision,
      source: profile.source,
    };
  }

  #persist() {
    if (!this.#profileStore) return;
    this.#profileStore.save({
      profiles: [...this.#profiles.values()].filter((profile) => profile.source === "RUNTIME").map((profile) => this.#serializable(profile)),
      revisions: [...this.#revisions.values()].filter((profile) => profile.source === "RUNTIME").map((profile) => this.#serializable(profile)),
      credentialHandles: [...this.#credentialHandles].map(([id, secret]) => ({ id, secret })),
      environmentCredentialHandles: [...this.#environmentCredentialHandles].map(([profileId, credentialHandleId]) => ({ profileId, credentialHandleId })),
    });
  }

  persistCredentialHandles() {
    if (!this.#profileStore) return;
    const value = {
      credentialHandles: [...this.#credentialHandles].map(([id, secret]) => ({ id, secret })),
      environmentCredentialHandles: [...this.#environmentCredentialHandles].map(([profileId, credentialHandleId]) => ({ profileId, credentialHandleId })),
    };
    if (typeof this.#profileStore.saveCredentialHandles === "function") {
      this.#profileStore.saveCredentialHandles(value);
      return;
    }
    this.#persist();
  }

  refreshCredentialHandles() {
    if (!this.#profileStore) return;
    const stored = this.#profileStore.load();
    this.#credentialHandles = new Map((stored.credentialHandles ?? []).map(({ id, secret }) => [
      requiredString(id, "stored model credential handle id"),
      requiredString(secret, `stored model credential ${id}`),
    ]));
    this.#environmentCredentialHandles = new Map((stored.environmentCredentialHandles ?? []).map(({ profileId, credentialHandleId }) => [
      requiredString(profileId, "stored environment model profile id"),
      requiredString(credentialHandleId, "stored environment model credentialHandleId"),
    ]));
  }

  durableProfileSnapshot() {
    return {
      profiles: [...this.#profiles.values()].filter((profile) => profile.source === "RUNTIME").map((profile) => this.#serializable(profile)),
      revisions: [...this.#revisions.values()].filter((profile) => profile.source === "RUNTIME").map((profile) => this.#serializable(profile)),
    };
  }

  replaceDurableProfiles(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.profiles) || !Array.isArray(snapshot.revisions)) {
      throw new TypeError("durable model profile snapshot requires profiles[] and revisions[]");
    }
    const stored = {
      profiles: structuredClone(snapshot.profiles),
      revisions: structuredClone(snapshot.revisions),
      credentialHandles: [...this.#credentialHandles].map(([id, secret]) => ({ id, secret })),
      environmentCredentialHandles: [...this.#environmentCredentialHandles].map(([profileId, credentialHandleId]) => ({ profileId, credentialHandleId })),
    };
    const reloaded = new AnalysisModelRegistry({
      adapters: this.#adapters,
      clock: this.#clock,
      fetchImpl: this.#fetchImpl,
      profileStore: { load: () => stored, save: () => {} },
    });
    this.#profiles = reloaded.#profiles;
    this.#revisions = reloaded.#revisions;
    this.#credentialHandles = reloaded.#credentialHandles;
    this.#environmentCredentialHandles = reloaded.#environmentCredentialHandles;
    this.#applyingReplacementProfiles.clear();
    return this.list();
  }

  refresh() {
    if (!this.#profileStore) return this.list();
    const reloaded = new AnalysisModelRegistry({
      adapters: this.#adapters,
      clock: this.#clock,
      fetchImpl: this.#fetchImpl,
      profileStore: this.#profileStore,
    });
    this.#profiles = reloaded.#profiles;
    this.#revisions = reloaded.#revisions;
    this.#credentialHandles = reloaded.#credentialHandles;
    this.#environmentCredentialHandles = reloaded.#environmentCredentialHandles;
    this.#applyingReplacementProfiles.clear();
    return this.list();
  }

  list() {
    return [...this.#profiles.values()].map((profile) => this.#public(profile)).sort((left, right) => left.id.localeCompare(right.id));
  }

  applyDurableLifecycle(profileId, lifecycle) {
    profileId = requiredString(profileId, "analysis model profile id");
    if (!["ACTIVE", "RETIRING", "RETIRED"].includes(lifecycle)) throw new TypeError("analysis model lifecycle is invalid");
    const profile = this.#profiles.get(profileId);
    if (!profile) throw new TypeError(`Analysis model profile ${profileId} is not configured`);
    profile.lifecycle = lifecycle;
    return this.#public(profile);
  }

  #pruneIssuedSecretGrants(now = this.#clock().valueOf()) {
    for (const [id, grant] of this.#issuedSecretGrants) {
      if (Date.parse(grant.expiresAt) <= now) this.#issuedSecretGrants.delete(id);
    }
  }

  registerIssuedSecretGrants(grants) {
    if (!Array.isArray(grants)) throw new TypeError("issued secret grants must be an array");
    this.#pruneIssuedSecretGrants();
    for (const grant of grants) {
      const id = requiredString(grant?.id, "issued secret grant id");
      const expiresAt = requiredString(grant?.expiresAt, "issued secret grant expiry");
      if (Number.isNaN(Date.parse(expiresAt))) throw new TypeError("issued secret grant expiry must be an ISO timestamp");
      this.#issuedSecretGrants.set(id, {
        canonical: canonicalJson(grant),
        analysisRunId: requiredString(grant?.analysisRunId, "issued secret grant analysisRunId"),
        expiresAt,
      });
    }
  }

  revokeIssuedSecretGrants({ analysisRunId = null } = {}) {
    if (analysisRunId !== null) analysisRunId = requiredString(analysisRunId, "analysisRunId");
    this.#pruneIssuedSecretGrants();
    let revoked = 0;
    for (const [id, grant] of this.#issuedSecretGrants) {
      if (analysisRunId === null || grant.analysisRunId === analysisRunId) {
        this.#issuedSecretGrants.delete(id);
        revoked += 1;
      }
    }
    return revoked;
  }

  assertProfilesUnlocked(profileIds) {
    for (const profileId of profileIds) {
      if (typeof profileId === "string" && this.#applyingReplacementProfiles.has(profileId)) {
        throw new TypeError(`Analysis model profile ${profileId} is locked by an applying replacement plan`);
      }
    }
  }

  resolve(id, context = null) {
    this.#pruneIssuedSecretGrants();
    const profile = this.#revisions.get(id) ?? this.#profiles.get(id);
    if (!profile?.verifiedAt) return null;
    const runtimeScoped = [context?.workspaceId, context?.profileId, context?.analysisRunId, context?.slotId]
      .every((value) => typeof value === "string" && value.trim() !== "");
    if (profile.transport !== "API") return runtimeScoped ? profile.adapter : null;
    const grant = context?.grant;
    const acceptedHandles = new Set([profile.credentialHandleId].filter(Boolean));
    const unexpired = typeof grant?.expiresAt === "string" && Date.parse(grant.expiresAt) > this.#clock().valueOf();
    const registered = typeof grant?.id === "string"
      && this.#issuedSecretGrants.get(grant.id)?.canonical === canonicalJson(grant);
    const scoped = runtimeScoped
      && grant?.workspaceId === context?.workspaceId
      && grant?.profileId === context?.profileId
      && grant?.analysisRunId === context?.analysisRunId
      && grant?.slotId === context?.slotId
      && grant?.capabilityKind === "MODEL"
      && grant?.capabilityName === profile.currentRevisionId
      && acceptedHandles.has(grant?.credentialHandleId)
      && registered
      && unexpired;
    return scoped ? profile.adapter : null;
  }

  configure(input, { persist = true } = {}) {
    if (!input || typeof input !== "object") throw new TypeError("analysis model profile must be an object");
    const id = requiredString(input.id, "analysis model profile id");
    if (this.#applyingReplacementProfiles.has(id)) {
      throw new TypeError(`Analysis model profile ${id} is locked by an applying replacement plan`);
    }
    const existing = this.#profiles.get(id);
    if (existing && existing.lifecycle !== "ACTIVE") {
      throw new TypeError(`Analysis model profile ${id} is ${existing.lifecycle} and cannot be revised`);
    }
    const transport = String(input.transport ?? existing?.transport ?? "API").toUpperCase();
    if (transport === "CLI") {
      const timeoutMs = input.timeoutMs ?? 120_000;
      const adapter = new AllowlistedCliModelAdapter({ id, cliAdapter: input.cliAdapter, model: input.model, executablePath: input.executablePath, timeoutMs, maximumOutputBytes: input.maximumOutputBytes ?? 1_000_000 });
      const connectionUnchanged = existing?.source === "RUNTIME" && existing.transport === "CLI" && existing.cliAdapter === adapter.cliAdapter && existing.model === adapter.model && existing.executablePath === adapter.executablePath && existing.timeoutMs === timeoutMs && existing.maximumOutputBytes === adapter.maximumOutputBytes;
      const profile = { id, displayName: input.displayName ?? existing?.displayName ?? id, transport, endpoint: null, model: adapter.model, timeoutMs, stream: false, cliAdapter: adapter.cliAdapter, executablePath: adapter.executablePath, maximumOutputBytes: adapter.maximumOutputBytes, source: "RUNTIME", lifecycle: "ACTIVE", revision: (existing?.revision ?? 0) + 1, configuredAt: this.#clock().toISOString(), verifiedAt: connectionUnchanged ? existing.verifiedAt : null, credentialHandleId: null, legacyCredentialHandleId: null, adapter };
      this.#publishRevision(profile);
      if (persist) this.#persist();
      return this.#public(profile);
    }
    if (transport !== "API") throw new TypeError("analysis model transport must be API or CLI");
    const endpoint = endpointUrl(input.endpoint);
    const model = requiredString(input.model, "analysis model name");
    const hasNewApiKey = typeof input.apiKey === "string" && input.apiKey.trim() !== "";
    const apiKey = hasNewApiKey ? requiredString(input.apiKey, "analysis model API key") : null;
    const credentialHandleId = hasNewApiKey
      ? `MODEL-CREDENTIAL-${randomUUID()}`
      : existing?.source === "RUNTIME" && existing.transport === "API"
        ? existing.credentialHandleId
        : null;
    if (!credentialHandleId) throw new TypeError("analysis model API key is required");
    if (apiKey) this.#credentialHandles.set(credentialHandleId, apiKey);
    const timeoutMs = input.timeoutMs ?? 120_000;
    const stream = input.stream ?? false;
    const adapter = new OpenAICompatibleAnalysisModelAdapter({ id, endpoint, model, timeoutMs, stream, fetchImpl: this.#fetchImpl, apiKeyResolver: () => this.#credentialHandles.get(credentialHandleId) ?? null });
    const connectionUnchanged = existing?.source === "RUNTIME" && !hasNewApiKey && existing.endpoint === adapter.endpoint && existing.model === model && existing.timeoutMs === timeoutMs && existing.stream === stream;
    const profile = { id, displayName: input.displayName ?? existing?.displayName ?? id, transport, endpoint: adapter.endpoint, model, timeoutMs, stream, cliAdapter: null, executablePath: null, maximumOutputBytes: null, source: "RUNTIME", lifecycle: "ACTIVE", revision: (existing?.revision ?? 0) + 1, configuredAt: this.#clock().toISOString(), verifiedAt: connectionUnchanged ? existing.verifiedAt : null, credentialHandleId, legacyCredentialHandleId: existing?.legacyCredentialHandleId ?? null, adapter };
    this.#publishRevision(profile);
    if (persist) this.#persist();
    return this.#public(profile);
  }

  async verify(id, { persist = true } = {}) {
    const profile = this.#profiles.get(requiredString(id, "analysis model profile id"));
    if (!profile) throw new TypeError(`Analysis model profile ${id} is not configured`);
    const verification = await profile.adapter.verify();
    profile.verifiedAt = this.#clock().toISOString();
    this.#revisions.set(profile.currentRevisionId, { ...this.#revisions.get(profile.currentRevisionId), verifiedAt: profile.verifiedAt });
    if (persist) this.#persist();
    return { ...this.#public(profile), latencyMs: verification.latencyMs };
  }

  remove(id, { finalize = false } = {}) {
    const profileId = requiredString(id, "analysis model profile id");
    const profile = this.#profiles.get(profileId);
    if (!profile) throw new TypeError(`Analysis model profile ${profileId} is not configured`);
    if (profile.source === "ENVIRONMENT") throw new TypeError(`Environment model profile ${profileId} cannot be deleted at runtime`);
    if (profile.lifecycle === "RETIRED") return this.#public(profile);
    profile.lifecycle = profile.lifecycle === "RETIRING" && finalize ? "RETIRED" : "RETIRING";
    this.#persist();
    return this.#public(profile);
  }

  createReplacementPlan({ sourceProfileId, replacementProfileId, references = [], changes = [] }) {
    sourceProfileId = requiredString(sourceProfileId, "sourceProfileId");
    replacementProfileId = requiredString(replacementProfileId, "replacementProfileId");
    const source = this.#profiles.get(sourceProfileId);
    const replacement = this.#profiles.get(replacementProfileId);
    if (!source || source.lifecycle !== "ACTIVE") throw new TypeError(`Source model ${sourceProfileId} must be ACTIVE`);
    if (!replacement || replacement.lifecycle !== "ACTIVE" || !replacement.verifiedAt) throw new TypeError(`Replacement model ${replacementProfileId} must be READY and ACTIVE`);
    if (sourceProfileId === replacementProfileId) throw new TypeError("Replacement model must differ from the source model");
    const identity = {
      sourceProfileId,
      sourceRevisionId: source.currentRevisionId,
      replacementProfileId,
      replacementRevisionId: replacement.currentRevisionId,
      changes: changes.map(({ workspaceId, expectedDraftVersion, expectedProfileVersion, priorDraftId, priorProfileId }) => ({
        workspaceId,
        expectedDraftVersion,
        expectedProfileVersion,
        priorDraftId: priorDraftId ?? null,
        priorProfileId: priorProfileId ?? null,
      })),
    };
    const plan = {
      id: contentId("MODEL-REPLACEMENT-PLAN", identity),
      ...identity,
      version: 1,
      status: "READY",
      references: structuredClone(references),
      changes: structuredClone(changes),
      createdAt: this.#clock().toISOString(),
      appliedAt: null,
    };
    return structuredClone(plan);
  }

  beginReplacementPlan(plan, expectedVersion) {
    requiredString(plan?.id, "replacement plan id");
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new TypeError("replacement plan expectedVersion must be a positive integer");
    if (plan.status === "APPLIED" && plan.version === expectedVersion + 1) return structuredClone(plan);
    if (plan.status !== "READY" || plan.version !== expectedVersion) throw new TypeError(`Replacement plan ${plan.id} version conflict`);
    if (this.#profiles.get(plan.sourceProfileId)?.currentRevisionId !== plan.sourceRevisionId
      || this.#profiles.get(plan.replacementProfileId)?.currentRevisionId !== plan.replacementRevisionId) {
      throw new TypeError(`Replacement plan ${plan.id} is stale`);
    }
    this.#applyingReplacementProfiles.add(plan.sourceProfileId);
    this.#applyingReplacementProfiles.add(plan.replacementProfileId);
    return structuredClone(plan);
  }

  abortReplacementPlan(plan) {
    if (!plan) return null;
    this.#applyingReplacementProfiles.delete(plan.sourceProfileId);
    this.#applyingReplacementProfiles.delete(plan.replacementProfileId);
    return structuredClone(plan);
  }

  completeReplacementPlan(plan, { persist = true } = {}) {
    requiredString(plan?.id, "replacement plan id");
    if (plan.status !== "APPLIED") throw new TypeError(`Replacement plan ${plan.id} is not applied`);
    const source = this.#profiles.get(plan.sourceProfileId);
    if (!source || source.currentRevisionId !== plan.sourceRevisionId) throw new TypeError(`Replacement plan ${plan.id} is stale`);
    try {
      source.lifecycle = "RETIRING";
      if (persist) this.#persist();
      return structuredClone(plan);
    } finally {
      this.#applyingReplacementProfiles.delete(plan.sourceProfileId);
      this.#applyingReplacementProfiles.delete(plan.replacementProfileId);
    }
  }

  async enrichWorkspaceCandidates(id, input, options = {}) {
    id = requiredString(id, "analysis model profile id");
    const revision = this.#revisions.get(id);
    const profile = revision ?? this.#profiles.get(id);
    if (!profile) throw new TypeError(`Analysis model profile ${id} is not configured`);
    if (!revision && profile.lifecycle !== "ACTIVE") throw new TypeError(`Analysis model profile ${id} is not active`);
    if (!profile.verifiedAt) throw new TypeError(`Analysis model profile ${id} must be verified before analysis`);
    return profile.adapter.enrichWorkspaceCandidates(input, options);
  }

  async planWorkspaceAnalysis(id, input, options = {}) {
    id = requiredString(id, "analysis model profile id");
    const revision = this.#revisions.get(id);
    const profile = revision ?? this.#profiles.get(id);
    if (!profile) throw new TypeError(`Analysis model profile ${id} is not configured`);
    if (!revision && profile.lifecycle !== "ACTIVE") throw new TypeError(`Analysis model profile ${id} is not active`);
    if (!profile.verifiedAt) throw new TypeError(`Analysis model profile ${id} must be verified before analysis`);
    return profile.adapter.planWorkspaceAnalysis(input, options);
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
