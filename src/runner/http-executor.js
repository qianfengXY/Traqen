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

function allowedRoute(policy, method, url) {
  return (policy.httpAllowlist ?? []).some((route) => {
    if (String(route.method).toUpperCase() !== method) return false;
    try {
      return new RegExp(route.pathPattern).test(url.pathname);
    } catch {
      throw new RunnerPolicyError(`Invalid HTTP allowlist pattern ${route.pathPattern}`);
    }
  });
}

export class HttpExecutor {
  #fetch;
  #timeoutMs;
  #maxResponseBytes;

  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 10_000, maxResponseBytes = 1024 * 1024 } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
      throw new TypeError("maxResponseBytes must be a positive integer");
    }
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
    this.#maxResponseBytes = maxResponseBytes;
  }

  async execute(step, { targetPolicy }) {
    const method = String(step.method ?? "GET").toUpperCase();
    if (!["GET", "HEAD"].includes(method)) {
      throw new RunnerPolicyError(`HTTP ${method} is not allowed by the SAFE_READ executor`);
    }
    if (typeof step.path !== "string" || step.path === "" || /^[a-z][a-z0-9+.-]*:/i.test(step.path) || step.path.startsWith("//")) {
      throw new RunnerPolicyError("HTTP step path must be a non-empty relative path");
    }
    const baseUrl = new URL(targetPolicy.baseUrl);
    const url = new URL(step.path, baseUrl);
    if (url.origin !== baseUrl.origin || url.username || url.password) {
      throw new RunnerPolicyError("HTTP target must remain within the configured base URL origin");
    }
    if (!allowedRoute(targetPolicy, method, url)) {
      throw new RunnerPolicyError(`HTTP ${method} ${url.pathname} is not allowlisted`);
    }

    const started = performance.now();
    const response = await withTimeout(
      (signal) =>
        this.#fetch(url, {
          method,
          headers: step.headers ?? {},
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
        headers: step.headers ?? {},
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
