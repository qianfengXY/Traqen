import assert from "node:assert/strict";
import test from "node:test";

import { AnalysisAgent, MemoryAnalysisCheckpointRepository } from "../src/analysis/index.js";
import { createFactBundle } from "../src/domain/index.js";

const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function source(artifact, startLine = 1, endLine = startLine) {
  return { artifact, startLine, endLine, contentHash: digest };
}

function commerceGraph(snapshotManifestId, { serviceVersion = 1, includeEndpoint = true } = {}) {
  const nodes = [
    { type: "ARTIFACT", naturalKey: "artifact:src/orders.js", name: "src/orders.js", attributes: {}, source: source("src/orders.js", 1, 80) },
    { type: "CODE_SYMBOL", naturalKey: "javascript:src/orders.js:submitOrderHandler", name: "submitOrderHandler", attributes: { language: "javascript", kind: "route-handler" }, source: source("src/orders.js", 10, 18) },
    { type: "CODE_SYMBOL", naturalKey: "javascript:src/orders.js:OrderService#submitOrder", name: "OrderService#submitOrder", attributes: { language: "javascript", kind: "service", behaviorVersion: serviceVersion }, source: source("src/orders.js", 20, 42) },
    { type: "DATA_OBJECT", naturalKey: "table:orders", name: "orders", attributes: { kind: "table" }, source: source("src/orders.js", 33, 33) },
    { type: "CONFIGURATION", naturalKey: "env:ORDER_SUBMIT_ENABLED", name: "ORDER_SUBMIT_ENABLED", attributes: { category: "environment" }, source: source("src/orders.js", 21, 21) },
    { type: "TEST_ASSET", naturalKey: "test:test/orders.test.js", name: "test/orders.test.js", attributes: { framework: "node-test" }, source: source("test/orders.test.js", 1, 35) },
  ];
  if (includeEndpoint) nodes.push({
    type: "ENDPOINT",
    naturalKey: "http:POST /orders",
    name: "POST /orders",
    attributes: { protocol: "HTTP", method: "POST", path: "/orders", summary: "Submit order" },
    source: source("src/orders.js", 6, 6),
  });
  const bundle = createFactBundle({
    projectId: "PROJECT-ANALYSIS",
    snapshotManifestId,
    sourceComponentId: `SOURCE-${snapshotManifestId}`,
    sourceDigest: digest,
    extractor: { id: "analysis-test-scanner", version: "1.0.0" },
    observedAt: "2026-07-20T05:00:00.000Z",
    complete: true,
    diagnostics: [],
    nodes,
    edges: [],
  });
  const byNaturalKey = new Map(bundle.nodes.map((node) => [node.naturalKey, node]));
  const rawEdges = [
    ["javascript:src/orders.js:submitOrderHandler", "CALLS", "javascript:src/orders.js:OrderService#submitOrder"],
    ["javascript:src/orders.js:OrderService#submitOrder", "WRITES", "table:orders"],
    ["javascript:src/orders.js:OrderService#submitOrder", "CONTROLLED_BY", "env:ORDER_SUBMIT_ENABLED"],
    ["test:test/orders.test.js", "EXERCISES", "javascript:src/orders.js:OrderService#submitOrder"],
  ];
  if (includeEndpoint) rawEdges.unshift(["http:POST /orders", "IMPLEMENTED_BY", "javascript:src/orders.js:submitOrderHandler"]);
  return createFactBundle({
    projectId: "PROJECT-ANALYSIS",
    snapshotManifestId,
    sourceComponentId: `SOURCE-${snapshotManifestId}`,
    sourceDigest: digest,
    extractor: { id: "analysis-test-scanner", version: "1.0.0" },
    observedAt: "2026-07-20T05:00:00.000Z",
    complete: true,
    diagnostics: [],
    nodes,
    edges: rawEdges.map(([subject, predicate, object]) => ({
      subjectId: byNaturalKey.get(subject).id,
      predicate,
      objectId: byNaturalKey.get(object).id,
      attributes: {},
      source: source("src/orders.js", 1, 1),
    })),
  });
}

function request(id, snapshotManifestId, profile = { id: "deterministic", mode: "DETERMINISTIC" }) {
  return {
    id,
    projectId: "PROJECT-ANALYSIS",
    snapshotManifestId,
    sourceComponentId: `SOURCE-${snapshotManifestId}`,
    mode: "AUTO",
    profile,
  };
}

function movedBusinessGraph(snapshotManifestId, location) {
  return createFactBundle({
    projectId: "PROJECT-ANALYSIS",
    snapshotManifestId,
    sourceComponentId: `SOURCE-${snapshotManifestId}`,
    sourceDigest: digest,
    extractor: { id: "analysis-test-scanner", version: "1.0.0" },
    observedAt: "2026-07-20T05:00:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [{
      type: "CODE_SYMBOL",
      naturalKey: `javascript:${location}:BillingService#approveInvoice`,
      name: "BillingService#approveInvoice",
      attributes: { language: "javascript", kind: "service" },
      source: source(`${location}/billing.js`, 20, 40),
    }],
    edges: [],
  });
}

test("Analysis Agent builds bounded API and business projections from one deterministic Fact graph", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({ repository, clock: () => new Date("2026-07-20T05:10:00.000Z") });
  const graph = commerceGraph("SNAPSHOT-A");
  const result = await agent.execute(request("ANALYSIS-A", "SNAPSHOT-A"), { factGraph: graph });

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.mode, "FULL");
  assert.ok(result.features.some((feature) => feature.mode === "API" && feature.name === "Submit order"));
  assert.ok(result.features.some((feature) => feature.mode === "BUSINESS" && feature.name === "Submit Order"));
  assert.equal(result.features.filter((feature) => feature.mode === "BUSINESS").length, 1);
  const endpoint = result.features.find((feature) => feature.mode === "API");
  assert.equal(endpoint.design.endpoint.method, "POST");
  assert.ok(endpoint.design.implementation.some((item) => item.name === "OrderService#submitOrder"));
  assert.ok(endpoint.design.configurations.some((item) => item.name === "ORDER_SUBMIT_ENABLED"));
  assert.ok(endpoint.design.tests.some((item) => item.name === "test/orders.test.js"));
  assert.ok(endpoint.evidenceFactIds.length >= 6);
  const checkpoint = await agent.getRun("PROJECT-ANALYSIS", "ANALYSIS-A");
  assert.ok(checkpoint.workUnits.every((unit) => unit.estimatedTokens <= checkpoint.request.profile.model.maxInputTokens));
});

test("Analysis Agent checkpoints every WorkUnit and resumes without repeating completed model work", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  let modelCalls = 0;
  const model = {
    async analyze(input) {
      modelCalls += 1;
      const deterministic = input.deterministicCandidates[0];
      const cited = input.evidence.nodes[0].factId;
      return { candidateFeatures: deterministic ? [{
        candidateKey: deterministic.candidateKey,
        mode: deterministic.mode,
        name: deterministic.mode === "API" ? "Submit order" : deterministic.name,
        description: `${deterministic.description} Semantically reviewed.`,
        confidence: "HIGH",
        evidenceFactIds: [cited],
        stableEvidenceNodeIds: [input.evidence.nodes[0].id],
      }] : [] };
    },
  };
  const agent = new AnalysisAgent({ repository, modelResolver: (id) => id === "MODEL-LOCAL" ? model : null });
  const graph = commerceGraph("SNAPSHOT-A");
  const hybrid = request("ANALYSIS-RESUME", "SNAPSHOT-A", {
    id: "hybrid-local",
    mode: "HYBRID",
    model: { enabled: true, profileId: "MODEL-LOCAL", contextWindow: 32_000, maxInputTokens: 16_000, maxOutputTokens: 4_000 },
  });

  const paused = await agent.execute(hybrid, { factGraph: graph, maximumCompletedWorkUnits: 1 });
  assert.equal(paused.run.status, "PAUSED");
  assert.equal(paused.run.completedWorkUnitCount, 1);
  assert.equal(modelCalls, 1);

  const completed = await agent.execute(hybrid, { factGraph: graph });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(modelCalls, completed.coverage.plannedWorkUnits);
  assert.ok(completed.features.some((feature) => feature.provenance.some((item) => item.modelProfileId === "MODEL-LOCAL")));
});

test("incremental and near-full analysis inherit stable Feature identity and human authority", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({ repository });
  const first = await agent.execute(request("ANALYSIS-V1", "SNAPSHOT-V1"), { factGraph: commerceGraph("SNAPSHOT-V1") });
  const confirmed = structuredClone(first);
  confirmed.features = confirmed.features.map((feature) => ({
    ...feature,
    authority: { status: "CONFIRMED", confirmedAt: "2026-07-20T06:00:00.000Z", actorId: "OWNER-1", actorRole: "business-owner", inheritance: "NONE", review: "NONE" },
  }));

  const second = await agent.execute(request("ANALYSIS-V2", "SNAPSHOT-V2"), {
    factGraph: commerceGraph("SNAPSHOT-V2", { serviceVersion: 2 }),
    baselineResult: confirmed,
  });
  assert.equal(second.mode, "INCREMENTAL");
  assert.ok(second.coverage.changedFacts > 0);
  for (const current of second.features) {
    const previous = confirmed.features.find((feature) => feature.candidateKey === current.candidateKey);
    assert.equal(current.id, previous.id);
    assert.equal(current.authority.status, "CONFIRMED");
    assert.equal(current.authority.inheritance, "INHERITED");
    assert.equal(current.authority.review, "NONE");
  }

  const third = await agent.execute(request("ANALYSIS-V3", "SNAPSHOT-V3"), {
    factGraph: commerceGraph("SNAPSHOT-V3", { serviceVersion: 3, includeEndpoint: false }),
    baselineResult: second,
  });
  const retiredApi = third.retiredFeatures.find((item) => item.name === "Submit order");
  assert.ok(retiredApi);
  assert.equal(retiredApi.authority.status, "CONFIRMED");
  const history = await agent.getFeatureHistory("PROJECT-ANALYSIS", second.features.find((feature) => feature.mode === "BUSINESS").id);
  assert.equal(history.length, 3);
  assert.equal(history.at(-1).feature.snapshotManifestId, "SNAPSHOT-V3");
});

test("an unambiguous business capability keeps its Feature identity across a complete code move", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({ repository });
  const first = await agent.execute(request("ANALYSIS-MOVE-V1", "SNAPSHOT-MOVE-V1"), { factGraph: movedBusinessGraph("SNAPSHOT-MOVE-V1", "services/legacy-billing") });
  const confirmed = structuredClone(first);
  confirmed.features[0].authority = { status: "CONFIRMED", confirmedAt: "2026-07-20T06:00:00.000Z", actorId: "OWNER-1", actorRole: "business-owner", inheritance: "NONE", review: "NONE" };

  const second = await agent.execute(request("ANALYSIS-MOVE-V2", "SNAPSHOT-MOVE-V2"), {
    factGraph: movedBusinessGraph("SNAPSHOT-MOVE-V2", "apps/billing-v2"),
    baselineResult: confirmed,
  });

  assert.equal(second.features[0].id, first.features[0].id);
  assert.equal(second.features[0].authority.status, "CONFIRMED");
  assert.equal(second.features[0].authority.inheritance, "INHERITED");
  assert.equal(second.features[0].change.type, "IMPLEMENTATION_REMAPPED");
});

test("incremental planning follows changed graph relations even though stable IDs contain colons", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({ repository });
  const firstGraph = commerceGraph("SNAPSHOT-EDGE-V1");
  const first = await agent.execute(request("ANALYSIS-EDGE-V1", "SNAPSHOT-EDGE-V1"), { factGraph: firstGraph });
  const secondGraph = commerceGraph("SNAPSHOT-EDGE-V2");
  const removed = secondGraph.edges.find((edge) => edge.predicate === "CONTROLLED_BY");
  const graphWithRelationOnlyChange = { ...secondGraph, edges: secondGraph.edges.filter((edge) => edge.id !== removed.id) };

  const second = await agent.execute(request("ANALYSIS-EDGE-V2", "SNAPSHOT-EDGE-V2"), {
    factGraph: graphWithRelationOnlyChange,
    baselineResult: first,
  });

  assert.equal(second.mode, "INCREMENTAL");
  assert.ok(second.coverage.changedFacts >= 2);
  assert.ok(second.coverage.plannedWorkUnits > 0);
  assert.ok(second.features.some((feature) => feature.change.type === "EVIDENCE_REFRESHED"));
});

test("LLM and Skill outputs cannot cite evidence outside their bounded WorkUnit", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({
    repository,
    modelResolver: () => ({
      async analyze(input) {
        return { candidateFeatures: [{
          candidateKey: "business:invented",
          mode: "BUSINESS",
          name: "Invented feature",
          description: "No bounded evidence supports this.",
          confidence: "HIGH",
          evidenceFactIds: ["FACT-OUTSIDE-WORK-UNIT"],
          stableEvidenceNodeIds: [input.evidence.nodes[0].id],
        }] };
      },
    }),
  });
  const result = await agent.execute(request("ANALYSIS-UNSAFE", "SNAPSHOT-A", {
    id: "unsafe-model",
    mode: "HYBRID",
    model: { enabled: true, profileId: "UNSAFE", contextWindow: 8_000, maxInputTokens: 4_000, maxOutputTokens: 1_000 },
    maxAttemptsPerWorkUnit: 1,
  }), { factGraph: commerceGraph("SNAPSHOT-A") });

  assert.equal(result.status, "COMPLETED_WITH_GAPS");
  assert.equal(result.coverage.completedWorkUnits, 0);
  assert.ok((await agent.getRun("PROJECT-ANALYSIS", "ANALYSIS-UNSAFE")).workUnits.every((unit) => unit.error.message.includes("outside the bounded WorkUnit")));
});

test("LLM output cannot smuggle stable Feature evidence from outside its WorkUnit", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({
    repository,
    modelResolver: () => ({
      async analyze(input) {
        return { candidateFeatures: [{
          ...input.deterministicCandidates[0],
          evidenceFactIds: [input.evidence.nodes[0].factId],
          stableEvidenceNodeIds: ["sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"],
        }] };
      },
    }),
  });
  const result = await agent.execute(request("ANALYSIS-STABLE-ESCAPE", "SNAPSHOT-A", {
    id: "stable-escape-model",
    mode: "HYBRID",
    model: { enabled: true, profileId: "UNSAFE", contextWindow: 8_000, maxInputTokens: 4_000, maxOutputTokens: 1_000 },
    maxAttemptsPerWorkUnit: 1,
  }), { factGraph: commerceGraph("SNAPSHOT-A") });

  assert.equal(result.status, "COMPLETED_WITH_GAPS");
  assert.ok((await agent.getRun("PROJECT-ANALYSIS", "ANALYSIS-STABLE-ESCAPE")).workUnits.every((unit) => unit.error.message.includes("stable nodes outside")));
});
