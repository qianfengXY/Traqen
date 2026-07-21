import assert from "node:assert/strict";
import test from "node:test";

import { configureAndVerifyAnalysisModel, normalizeChatCompletionsEndpoint, removeAnalysisModelProfile, selectAnalysisModelProfile } from "../app/analysis-model-client.ts";

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
