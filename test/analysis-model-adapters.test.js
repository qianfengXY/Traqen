import assert from "node:assert/strict";
import test from "node:test";

import { AnalysisModelConnectionError, AnalysisModelRegistry, OpenAICompatibleAnalysisModelAdapter, configuredAnalysisModels } from "../src/analysis/index.js";

function workspaceCandidateEnvelope(overrides = {}) {
  const workUnit = {
    schemaVersion: "1.0.0",
    id: "WORK-UNIT-WORKSPACE-001",
    projectId: "PROJECT-WORKSPACE",
    snapshotManifestId: "SNAPSHOT-WORKSPACE-001",
    analysisRunId: "ANALYSIS-WORKSPACE-001",
    factIds: ["FACT-WORKSPACE-001", "FACT-WORKSPACE-002"],
    rootFactIds: ["FACT-WORKSPACE-001"],
  };
  return {
    workUnit,
    candidateBundle: {
      schemaVersion: "1.0.0",
      id: "CANDIDATE-BUNDLE-WORKSPACE-001",
      projectId: workUnit.projectId,
      snapshotManifestId: workUnit.snapshotManifestId,
      analysisRunId: workUnit.analysisRunId,
      workUnitId: workUnit.id,
      producedAt: "2026-07-25T10:00:00.000Z",
      candidates: [{
        id: "CANDIDATE-WORKSPACE-001",
        kind: "CANDIDATE_FEATURE",
        status: "PENDING_REVIEW",
        confidence: "LOW",
        confidenceCap: "HIGH",
        evidenceFactIds: ["FACT-WORKSPACE-001"],
        proposal: {
          name: "submitOrder",
          kind: "CODE_SYMBOL",
          method: null,
          modulePath: "src/orders",
          sourcePath: "src/orders/service.ts",
          description: "Discovered source capability.",
          code: "export function submitOrder() {}",
          evidence: {
            observations: [
              { extractor: "TYPESCRIPT_AST", basis: "exported function", sourcePath: "src/orders/service.ts", startLine: 1, excerpt: "export function submitOrder() {}" },
            ],
            corroborations: [],
            contradictions: [],
            diagnostics: [],
            completeness: "PARTIAL",
            confidenceCap: "HIGH",
          },
        },
        provenance: [{ producerType: "DETERMINISTIC", producerId: "TRAQEN_BROWSER_SCANNER", producerVersion: "4" }],
      }],
    },
    ...overrides,
  };
}

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
    workUnit: {
      schemaVersion: "1.0.0",
      id: "UNIT-1",
      projectId: "PROJECT-1",
      snapshotManifestId: "SNAPSHOT-1",
      analysisRunId: "RUN-1",
      factIds: ["FACT-1"],
      rootFactIds: ["FACT-1"],
    },
    workContext: { scopeKey: "orders", rootNodeId: "NODE-1", inputDigest: "DIGEST-1", estimatedTokens: 10 },
    deterministicCandidates: [],
    evidence: { nodes: [], edges: [] },
    context: { maxOutputTokens: 1_000 },
  };

  assert.deepEqual(await adapter.analyze(input), { candidateFeatures: [] });
  assert.equal(request.headers.authorization, "Bearer server-only-secret");
  assert.equal(JSON.stringify(input).includes("server-only-secret"), false);
  assert.equal(request.body.includes("server-only-secret"), false);
});

test("Main model reconciliation returns its structured decisions instead of an accept-all projection", async () => {
  const expected = {
    candidateDecisions: [
      { candidateRef: "CHILD-A:0", disposition: "CONFLICT", rationale: "The claims disagree.", relatedCandidateRefs: ["CHILD-B:0"] },
      { candidateRef: "CHILD-B:0", disposition: "REJECT", rationale: "The evidence is weaker." },
    ],
    relations: [],
    gaps: [{ code: "SEMANTIC_CONFLICT", message: "Human review is required." }],
  };
  let request;
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "main-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "main-reconciler",
    apiKeyResolver: () => "secret",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(expected) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const output = await adapter.reconcile({
    workUnit: { id: "MAIN", projectId: "P", snapshotManifestId: "S", analysisRunId: "R", factIds: ["F"], rootFactIds: ["F"] },
    workContext: { scopeKey: "orders", rootNodeId: "F", inputDigest: "D", estimatedTokens: 10 },
    candidateOptions: [{ ref: "CHILD-A:0" }, { ref: "CHILD-B:0" }],
    contextCandidates: [],
    scopedArtifacts: [{ id: "A", relativePath: "src/orders.js" }],
    evidence: { facts: [{ id: "F" }], sourceSlices: [] },
    context: { maxOutputTokens: 1_000 },
  });
  assert.deepEqual(output, expected);
  assert.equal(request.messages[0].content.includes("ACCEPT, REJECT, CONFLICT, MERGE, or ALTERNATIVE"), true);
  assert.deepEqual(JSON.parse(request.messages[1].content).candidateOptions.map(({ ref }) => ref), ["CHILD-A:0", "CHILD-B:0"]);
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

test("stream profiles report output-token truncation instead of a generic incomplete JSON error", async () => {
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "truncated-stream-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    stream: true,
    fetchImpl: async () => new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "{\"ok\":" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}`,
      "data: [DONE]",
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  await assert.rejects(() => adapter.verify(), /output was truncated \(length\)/);
});

test("Main Agent creates the configured evidence-bounded child assignments with a public streamed message", async () => {
  const telemetry = [];
  const plan = {
    agentMessage: "I will send one sealed batch to two independent Child slots and validate each result.",
    taskAssignments: [
      { agentId: "CHILD-1", objective: "Analyze the sealed batch independently", moduleScopes: ["orders", "billing", "api"] },
      { agentId: "CHILD-2", objective: "Analyze the sealed batch independently", moduleScopes: ["orders", "billing", "api"] },
    ],
  };
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "main-agent-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    stream: true,
    fetchImpl: async () => new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(plan) } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  const result = await adapter.planWorkspaceAnalysis({
    workspaceName: "Traqen",
    mode: "FULL",
    fileCount: 100,
    modules: [
      { name: "orders", fileCount: 10, sourceBytes: 12_000, languages: ["java"] },
      { name: "billing", fileCount: 10, sourceBytes: 16_000, languages: ["java", "xml"] },
      { name: "api", fileCount: 10, sourceBytes: 9_000, languages: ["ts"] },
    ],
  }, { onTelemetry: (event) => telemetry.push(event) });
  assert.equal(result.taskAssignments.length, 2);
  assert.equal(result.agentMessage, plan.agentMessage);
  assert.ok(telemetry.some((event) => event.type === "RESPONSE_PROGRESS" && event.assistantMessage === plan.agentMessage));
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
          id: "CANDIDATE-WORKSPACE-001",
          displayName: "Submit order",
          description: "Submits an order through the discovered service method.",
          businessFeature: true,
          businessKey: "order.submit",
          businessModule: "Order management",
          businessSubmodule: "Order submission",
          domain: "Orders",
          group: "BUSINESS_CAPABILITY",
          confidence: "HIGH",
          rationale: "The method and source path identify an order submission capability.",
          evidenceFactIds: ["FACT-WORKSPACE-001"],
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
  await assert.rejects(() => registry.enrichWorkspaceCandidates("workspace-default", workspaceCandidateEnvelope()), /must be verified/);

  const verified = await registry.verify("workspace-default");
  assert.equal(verified.ready, true);
  assert.equal(JSON.parse(requests[0].body).max_tokens, 512);
  assert.ok(registry.resolve("workspace-default"));
  const enriched = await registry.enrichWorkspaceCandidates("workspace-default", workspaceCandidateEnvelope());
  assert.equal(enriched.candidates[0].proposal.businessFeature, true);
  assert.equal(enriched.candidates[0].proposal.displayName, "Submit order");
  assert.deepEqual(enriched.candidates[0].evidenceFactIds, ["FACT-WORKSPACE-001"]);
  assert.equal(requests.every((request) => request.headers.authorization === "Bearer runtime-secret"), true);
  assert.equal(JSON.stringify(registry.list()).includes("runtime-secret"), false);
});

test("Workspace model telemetry exposes the auditable request lifecycle and enforces evidence confidence caps", async () => {
  const telemetry = [];
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "observable-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    stream: true,
    fetchImpl: async () => new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ candidates: [{ id: "CANDIDATE-WORKSPACE-001", displayName: "Candidate", description: "Observed candidate.", businessFeature: false, businessKey: "platform.runtime-support", businessModule: "Platform operations", businessSubmodule: "Runtime support", domain: "Technical", group: "PROJECT_OPERATION", confidence: "HIGH", rationale: "Single heuristic observation.", evidenceFactIds: ["FACT-WORKSPACE-001"] }] }) } }] })}`,
      "data: [DONE]",
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  const boundedInput = workspaceCandidateEnvelope();
  boundedInput.candidateBundle.candidates[0].confidenceCap = "LOW";
  boundedInput.candidateBundle.candidates[0].proposal.evidence.confidenceCap = "LOW";
  await assert.rejects(() => adapter.enrichWorkspaceCandidates(
    boundedInput,
    { onTelemetry: (event) => telemetry.push(event) },
  ), /invalid Workspace enrichment response/);
  assert.deepEqual(telemetry.slice(0, 3).map((event) => event.type), ["REQUEST_PREPARED", "HTTP_CONNECTED", "RESPONSE_PROGRESS"]);
  assert.ok(telemetry.some((event) => event.type === "STRUCTURED_RESPONSE_PARSED"));
  assert.ok(telemetry.some((event) => event.type === "OUTPUT_REJECTED"));
  assert.match(telemetry.find((event) => event.type === "RESPONSE_PROGRESS").outputPreview, /^\{"candidates"/);
  assert.equal(telemetry[0].promptPreview.includes("TYPESCRIPT_AST"), true);
  assert.equal(JSON.stringify(telemetry).includes("authorization"), false);
});

test("Workspace model output must cite Facts from its supplied WorkUnit", async () => {
  for (const evidenceFactIds of [undefined, ["FACT-OUTSIDE"]]) {
    const adapter = new OpenAICompatibleAnalysisModelAdapter({
      id: "bounded-model",
      endpoint: "https://models.example/v1/chat/completions",
      model: "source-model",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              candidates: [{
                id: "CANDIDATE-WORKSPACE-001",
                displayName: "Submit order",
                description: "Submits a customer order.",
                businessFeature: true,
                businessKey: "order.submit",
                businessModule: "Order management",
                businessSubmodule: "Order submission",
                domain: "Orders",
                group: "BUSINESS_CAPABILITY",
                confidence: "MEDIUM",
                rationale: "The bounded source Fact describes order submission.",
                ...(evidenceFactIds ? { evidenceFactIds } : {}),
              }],
            }),
          },
        }],
      }), { status: 200 }),
    });

    await assert.rejects(
      () => adapter.enrichWorkspaceCandidates(workspaceCandidateEnvelope()),
      /invalid Workspace enrichment response/,
    );
  }
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
