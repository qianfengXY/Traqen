import assert from "node:assert/strict";
import test from "node:test";

import { AnalysisModelConnectionError, AnalysisModelRegistry, OpenAICompatibleAnalysisModelAdapter, configuredAnalysisModels } from "../src/analysis/index.js";

test("configured Analysis Agent models resolve secrets at call time without serializing them into input", async () => {
  const profiles = configuredAnalysisModels(JSON.stringify([{
    id: "private-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "semantic-source-model",
    apiKeyEnvironment: "PRIVATE_MODEL_KEY",
  }]), { PRIVATE_MODEL_KEY: "server-only-secret" });
  const adapter = profiles.get("private-model");
  let request;
  adapter.fetchImpl = async (_url, options) => {
    request = options;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ candidateFeatures: [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const input = {
    workUnit: { id: "UNIT-1", scopeKey: "orders", rootNodeId: "NODE-1" },
    deterministicCandidates: [],
    evidence: { nodes: [], edges: [] },
    context: { maxOutputTokens: 1_000 },
  };

  assert.deepEqual(await adapter.analyze(input), { candidateFeatures: [] });
  assert.equal(request.headers.authorization, "Bearer server-only-secret");
  assert.equal(JSON.stringify(input).includes("server-only-secret"), false);
  assert.equal(request.body.includes("server-only-secret"), false);
});

test("Analysis Agent model endpoints require HTTPS except for loopback development", () => {
  assert.throws(() => new OpenAICompatibleAnalysisModelAdapter({ id: "unsafe", endpoint: "http://models.example/v1", model: "x" }), /must use HTTPS/);
  assert.doesNotThrow(() => new OpenAICompatibleAnalysisModelAdapter({ id: "local", endpoint: "http://127.0.0.1:11434/v1/chat/completions", model: "x" }));
});

test("stream profiles send stream true and merge OpenAI-compatible SSE deltas before validation", async () => {
  let request;
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "stream-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    stream: true,
    apiKeyResolver: () => "secret",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      const events = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "{\"ok\":" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "true}" } }] })}`,
        "data: [DONE]",
      ].join("\n\n");
      return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  assert.equal((await adapter.verify()).ok, true);
  assert.equal(request.stream, true);
});

test("stream profiles accept Responses-style output_text delta events", async () => {
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "responses-stream-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    stream: true,
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response([
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "{\"ok\":" })}`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "true}" })}`,
      "data: [DONE]",
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  assert.equal((await adapter.verify()).ok, true);
});

test("runtime model profiles keep API keys private, require verification, and enrich bounded Workspace candidates", async () => {
  const requests = [];
  const registry = new AnalysisModelRegistry({
    clock: () => new Date("2026-07-21T01:00:00.000Z"),
    fetchImpl: async (_url, options) => {
      requests.push(options);
      const input = JSON.parse(options.body);
      const verify = input.messages.at(-1).content.includes("exactly");
      const content = verify ? { ok: true } : {
        candidates: [{
          id: "FEATURE-ORDER",
          displayName: "Submit order",
          description: "Submits an order through the discovered service method.",
          businessFeature: true,
          domain: "Orders",
          group: "BUSINESS_CAPABILITY",
          confidence: "HIGH",
          rationale: "The method and source path identify an order submission capability.",
        }],
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    },
  });

  const configured = registry.configure({
    id: "workspace-default",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-analysis-model",
    apiKey: "runtime-secret",
  });
  assert.equal(configured.ready, false);
  assert.equal(registry.resolve("workspace-default"), null);
  assert.equal(JSON.stringify(configured).includes("runtime-secret"), false);
  await assert.rejects(() => registry.enrichWorkspaceCandidates("workspace-default", []), /must be verified/);

  const verified = await registry.verify("workspace-default");
  assert.equal(verified.ready, true);
  assert.equal(JSON.parse(requests[0].body).max_tokens, 512);
  assert.ok(registry.resolve("workspace-default"));
  const enriched = await registry.enrichWorkspaceCandidates("workspace-default", [{
    id: "FEATURE-ORDER",
    name: "submitOrder",
    kind: "CODE_SYMBOL",
    method: null,
    modulePath: "src/orders",
    sourcePath: "src/orders/service.ts",
    description: "Discovered source capability.",
    code: "export function submitOrder() {}",
  }]);
  assert.equal(enriched[0].businessFeature, true);
  assert.equal(enriched[0].displayName, "Submit order");
  assert.equal(requests.every((request) => request.headers.authorization === "Bearer runtime-secret"), true);
  assert.equal(JSON.stringify(registry.list()).includes("runtime-secret"), false);
});

test("model transport and structured output failures are reported as model availability errors", async () => {
  const failing = new OpenAICompatibleAnalysisModelAdapter({
    id: "failing-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response("upstream unavailable", { status: 503 }),
  });
  await assert.rejects(() => failing.verify(), AnalysisModelConnectionError);

  const malformed = new OpenAICompatibleAnalysisModelAdapter({
    id: "malformed-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: false }) } }] }), { status: 200 }),
  });
  await assert.rejects(() => malformed.verify(), AnalysisModelConnectionError);
});

test("model verification accepts compatible text arrays, reasoning prefixes, and Responses-style output text", async () => {
  const arrayContent = new OpenAICompatibleAnalysisModelAdapter({
    id: "array-content-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: "output_text", text: { value: "<think>done</think>\n```json\n{\"ok\":true}\n```" } }] } }],
    }), { status: 200 }),
  });
  assert.equal((await arrayContent.verify()).ok, true);

  const responsesStyle = new OpenAICompatibleAnalysisModelAdapter({
    id: "responses-style-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response(JSON.stringify({ output_text: "Result: {\"ok\":true}" }), { status: 200 }),
  });
  assert.equal((await responsesStyle.verify()).ok, true);
});

test("invalid model structures report the unsupported response shape without echoing response content", async () => {
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "unsupported-shape",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response(JSON.stringify({ result: { privateContent: "do-not-echo" } }), { status: 200 }),
  });
  await assert.rejects(
    () => adapter.verify(),
    (error) => error instanceof AnalysisModelConnectionError
      && /top-level fields: result/.test(error.message)
      && !error.message.includes("do-not-echo"),
  );
});
