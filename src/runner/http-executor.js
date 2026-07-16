import { RunnerExecutionError, RunnerPolicyError } from "./errors.js";
import { withTimeout } from "./timeout.js";

async function readLimitedBody(response, maxResponseBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel();
      throw new RunnerExecutionError(`HTTP response exceeds ${maxResponseBytes} bytes`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function headersObject(headers) {
  return Object.fromEntries([...headers.entries()].map(([name, value]) => [name.toLowerCase(), value]));
}

function allowedRoute(policy, method, url, operationLevel) {
  return (policy.httpAllowlist ?? []).find((route) => {
    if (String(route.method).toUpperCase() !== method) return false;
    if (
      Array.isArray(route.operationLevels) &&
      !route.operationLevels.includes(operationLevel)
    ) {
      return false;
    }
    if (operationLevel === "CONTROLLED_WRITE" && !Array.isArray(route.operationLevels)) {
      return false;
    }
    try {
      return new RegExp(route.pathPattern).test(url.pathname);
    } catch {
      throw new RunnerPolicyError(`Invalid HTTP allowlist pattern ${route.pathPattern}`);
    }
  });
}

function hasHeader(headers, targetName) {
  return Object.keys(headers).some((name) => name.toLowerCase() === targetName);
}

function serializeRequestBody(body, headers) {
  if (body === undefined) return { body: undefined, recordedBody: null };
  if (typeof body === "string") return { body, recordedBody: body };
  if (body === null || typeof body === "number" || typeof body === "boolean" || typeof body === "object") {
    if (!hasHeader(headers, "content-type")) headers["content-type"] = "application/json";
    return { body: JSON.stringify(body), recordedBody: structuredClone(body) };
  }
  throw new RunnerPolicyError("HTTP request body must be JSON-compatible or a string");
}

export class HttpExecutor {
  #fetch;
  #timeoutMs;
  #maxRequestBytes;
  #maxResponseBytes;

  constructor({
    fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
    maxRequestBytes = 256 * 1024,
    maxResponseBytes = 1024 * 1024,
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
    if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 1) {
      throw new TypeError("maxRequestBytes must be a positive integer");
    }
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
      throw new TypeError("maxResponseBytes must be a positive integer");
    }
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
    this.#maxRequestBytes = maxRequestBytes;
    this.#maxResponseBytes = maxResponseBytes;
  }

  async execute(step, { targetPolicy, operationLevel = "SAFE_READ", secretValues = new Set() }) {
    const method = String(step.method ?? "GET").toUpperCase();
    if (operationLevel === "SAFE_READ" && !["GET", "HEAD"].includes(method)) {
      throw new RunnerPolicyError(`HTTP ${method} is not allowed for SAFE_READ execution`);
    }
    if (operationLevel === "CONTROLLED_WRITE" && !["POST", "PUT", "PATCH"].includes(method)) {
      throw new RunnerPolicyError(`HTTP ${method} is not allowed for CONTROLLED_WRITE execution`);
    }
    if (!["SAFE_READ", "CONTROLLED_WRITE"].includes(operationLevel)) {
      throw new RunnerPolicyError(`HTTP execution is blocked for operation level ${operationLevel}`);
    }
    if (["GET", "HEAD"].includes(method) && step.body !== undefined) {
      throw new RunnerPolicyError(`HTTP ${method} must not include a request body`);
    }
    if (typeof step.path !== "string" || step.path === "" || /^[a-z][a-z0-9+.-]*:/i.test(step.path) || step.path.startsWith("//")) {
      throw new RunnerPolicyError("HTTP step path must be a non-empty relative path");
    }
    if ([...secretValues].some((secret) => secret && step.path.includes(secret))) {
      throw new RunnerPolicyError("Resolved secrets must not be placed in an HTTP URL");
    }
    const baseUrl = new URL(targetPolicy.baseUrl);
    const url = new URL(step.path, baseUrl);
    if (url.origin !== baseUrl.origin || url.username || url.password) {
      throw new RunnerPolicyError("HTTP target must remain within the configured base URL origin");
    }
    const route = allowedRoute(targetPolicy, method, url, operationLevel);
    if (!route) {
      throw new RunnerPolicyError(
        `HTTP ${method} ${url.pathname} is not allowlisted for ${operationLevel}`,
      );
    }
    const requestHeaders = structuredClone(step.headers ?? {});
    if (requestHeaders === null || typeof requestHeaders !== "object" || Array.isArray(requestHeaders)) {
      throw new RunnerPolicyError("HTTP step headers must be an object");
    }
    const requestBody = serializeRequestBody(step.body, requestHeaders);
    const maxRequestBytes = Math.min(
      route.maxRequestBytes ?? targetPolicy.maxRequestBytes ?? this.#maxRequestBytes,
      this.#maxRequestBytes,
    );
    if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 1) {
      throw new RunnerPolicyError("HTTP maxRequestBytes must be a positive integer");
    }
    if (requestBody.body !== undefined && new TextEncoder().encode(requestBody.body).byteLength > maxRequestBytes) {
      throw new RunnerPolicyError(`HTTP request exceeds ${maxRequestBytes} bytes`);
    }

    const started = performance.now();
    const response = await withTimeout(
      (signal) =>
        this.#fetch(url, {
          method,
          headers: requestHeaders,
          body: requestBody.body,
          redirect: "manual",
          signal,
        }),
      this.#timeoutMs,
      `HTTP ${method} ${url.pathname}`,
    );
    const body = await readLimitedBody(response, this.#maxResponseBytes);
    const responseHeaders = headersObject(response.headers);
    let json = null;
    if (responseHeaders["content-type"]?.toLowerCase().includes("application/json") && body !== "") {
      try {
        json = JSON.parse(body);
      } catch {
        json = null;
      }
    }
    return {
      id: step.id,
      executor: "HTTP",
      status: "PASS",
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      request: {
        method,
        url: url.toString(),
        headers: requestHeaders,
        body: requestBody.recordedBody,
      },
      response: {
        status: response.status,
        headers: responseHeaders,
        body,
        json,
      },
    };
  }
}
