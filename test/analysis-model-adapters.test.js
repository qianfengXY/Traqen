import assert from "node:assert/strict";
import test from "node:test";

import { OpenAICompatibleAnalysisModelAdapter, configuredAnalysisModels } from "../src/analysis/index.js";

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
