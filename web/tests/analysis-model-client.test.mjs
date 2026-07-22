import assert from "node:assert/strict";
import test from "node:test";

import { configureAndVerifyAnalysisModel, enrichWorkspaceCandidateBatch, normalizeChatCompletionsEndpoint, removeAnalysisModelProfile, selectAnalysisModelProfile, workspaceModelCandidateBatches } from "../app/analysis-model-client.ts";

test("normalizes common OpenAI-compatible API base URLs without changing full endpoints", () => {
  assert.equal(normalizeChatCompletionsEndpoint("https://api.example.com/v1"), "https://api.example.com/v1/chat/completions");
  assert.equal(normalizeChatCompletionsEndpoint("http://127.0.0.1:11434"), "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(normalizeChatCompletionsEndpoint("https://api.example.com/custom/chat/completions"), "https://api.example.com/custom/chat/completions");
});

test("selects and removes persisted model profiles through explicit routes", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options?.method });
    return new Response(JSON.stringify({ id: "model-a", ready: true, active: options?.method === "POST" }), { status: 200 });
  };
  try {
    assert.equal((await selectAnalysisModelProfile("http://127.0.0.1:3100", "", "model-a")).active, true);
    assert.equal((await removeAnalysisModelProfile("http://127.0.0.1:3100", "", "model-a")).active, false);
    assert.deepEqual(calls, [
      { url: "http://127.0.0.1:3100/v1/analysis-model-profiles/model-a/select", method: "POST" },
      { url: "http://127.0.0.1:3100/v1/analysis-model-profiles/model-a", method: "DELETE" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("distinguishes a saved profile from a model endpoint verification failure", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) return new Response(JSON.stringify({ id: "workspace-default", ready: false }), { status: 201 });
    return new Response(JSON.stringify({ error: { code: "ANALYSIS_MODEL_UNAVAILABLE", message: "Analysis model request failed with HTTP 404: route not found" } }), { status: 502 });
  };
  try {
    await assert.rejects(
      () => configureAndVerifyAnalysisModel("http://127.0.0.1:3100", "", {
        id: "workspace-default",
        endpoint: "https://api.example.com/v1",
        model: "source-model",
        apiKey: "secret",
        stream: true,
      }),
      /配置已保存，但模型连接验证失败.*https:\/\/api\.example\.com\/v1\/chat\/completions/s,
    );
    assert.equal(JSON.parse(requests[0].options.body).endpoint, "https://api.example.com/v1/chat/completions");
    assert.equal(JSON.parse(requests[0].options.body).stream, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("builds explicit evidence assessments and streams each observable LLM interaction event", async () => {
  const candidate = {
    id: "FEATURE-JAVA-1", name: "Submit order", kind: "CODE_SYMBOL", method: null, modulePath: "src/orders", sourcePath: "src/orders/OrderService.java", startLine: 12,
    description: "Discovered Java service capability submitOrder.", code: "public Order submitOrder() {}",
  };
  const records = [{ scannerVersion: 4, path: candidate.sourcePath, size: 100, lastModified: 1, supported: true, candidates: [candidate], configuration: null, test: null }];
  const batches = workspaceModelCandidateBatches(records, "model-a");
  assert.equal(batches[0][0].evidence.observations[0].extractor, "JAVA_DECLARATION_PATTERN");
  assert.equal(batches[0][0].evidence.confidenceCap, "LOW");
  assert.match(batches[0][0].evidence.diagnostics[0], /heuristic/i);

  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = options;
    const lines = [
      { kind: "telemetry", event: { type: "REQUEST_PREPARED", at: "2026-07-22T01:00:00.000Z", requestId: "REQ-1", promptPreview: "bounded prompt" } },
      { kind: "telemetry", event: { type: "RESPONSE_PROGRESS", at: "2026-07-22T01:00:01.000Z", requestId: "REQ-1", chunkCount: 2, receivedCharacters: 120 } },
      { kind: "result", profileId: "model-a", candidates: [{ id: candidate.id, displayName: "Submit order", description: "Candidate", businessFeature: true, domain: "Orders", group: "BUSINESS_CAPABILITY", confidence: "LOW", rationale: "Single heuristic source" }] },
    ].map((message) => `${JSON.stringify(message)}\n`).join("");
    return new Response(lines, { status: 200, headers: { "content-type": "application/x-ndjson" } });
  };
  try {
    const telemetry = [];
    const result = await enrichWorkspaceCandidateBatch("http://127.0.0.1:3100", "", "model-a", batches[0], { onTelemetry: (event) => telemetry.push(event) });
    assert.equal(result[0].confidence, "LOW");
    assert.deepEqual(telemetry.map((event) => event.type), ["REQUEST_PREPARED", "RESPONSE_PROGRESS"]);
    assert.match(request.headers.accept, /application\/x-ndjson/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("indexes evidence once and keeps large model batches bounded by count and serialized size", () => {
  const records = Array.from({ length: 5_000 }, (_, index) => {
    const candidate = {
      id: `FEATURE-${index}`, name: `Capability ${index}`, kind: "CODE_SYMBOL", method: null, modulePath: "src", sourcePath: `src/capability-${index}.ts`, startLine: 1,
      description: "Discovered exported capability.", code: `export function capability${index}() { return ${index}; }`,
    };
    return { scannerVersion: 4, path: candidate.sourcePath, size: 100, lastModified: 1, supported: true, candidates: [candidate], configuration: null, test: null };
  });
  const batches = workspaceModelCandidateBatches(records, "model-a");
  assert.equal(batches.flat().length, 5_000);
  assert.equal(batches.every((batch) => batch.length <= 24 && JSON.stringify(batch).length <= 60_000), true);
});
