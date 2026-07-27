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
  assert.ok(result.candidates.some((candidate) => candidate.mode === "API" && candidate.name === "Submit order"));
  assert.ok(result.candidates.some((candidate) => candidate.mode === "BUSINESS" && candidate.name === "Submit Order"));
  assert.equal(result.candidates.filter((candidate) => candidate.mode === "BUSINESS").length, 1);
  assert.ok(result.candidates.every((candidate) =>
    candidate.nodeType === "CANDIDATE_FEATURE"
    && candidate.status === "PENDING_REVIEW"
    && candidate.governedFeatureId === null
    && candidate.reconciliation.identityDecision === "NOT_MADE"
    && !("authority" in candidate)));
  const endpoint = result.candidates.find((candidate) => candidate.mode === "API");
  assert.equal(endpoint.design.endpoint.method, "POST");
  assert.ok(endpoint.design.implementation.some((item) => item.name === "OrderService#submitOrder"));
  assert.ok(endpoint.design.configurations.some((item) => item.name === "ORDER_SUBMIT_ENABLED"));
  assert.ok(endpoint.design.tests.some((item) => item.name === "test/orders.test.js"));
  assert.ok(endpoint.evidenceFactIds.length >= 6);
  const checkpoint = await agent.getRun("PROJECT-ANALYSIS", "ANALYSIS-A");
  assert.ok(checkpoint.workUnits.every((unit) => unit.estimatedTokens <= checkpoint.request.profile.model.maxInputTokens));
  assert.ok(checkpoint.workUnits.every((unit) =>
    unit.boundary.schemaVersion === "1.0.0"
    && unit.boundary.projectId === "PROJECT-ANALYSIS"
    && unit.boundary.snapshotManifestId === "SNAPSHOT-A"
    && unit.boundary.analysisRunId === "ANALYSIS-A"
    && unit.boundary.factIds.includes(unit.boundary.rootFactIds[0])
    && unit.output.candidateBundle.workUnitId === unit.boundary.id));
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
        confidence: deterministic.confidence,
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
  assert.ok(completed.candidates.some((candidate) => candidate.provenance.some((item) => item.modelProfileId === "MODEL-LOCAL")));
});

test("incremental analysis retains Candidate lineage without inheriting Feature identity or authority", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({ repository });
  const first = await agent.execute(request("ANALYSIS-V1", "SNAPSHOT-V1"), { factGraph: commerceGraph("SNAPSHOT-V1") });

  const second = await agent.execute(request("ANALYSIS-V2", "SNAPSHOT-V2"), {
    factGraph: commerceGraph("SNAPSHOT-V2", { serviceVersion: 2 }),
    baselineResult: first,
  });
  assert.equal(second.mode, "INCREMENTAL");
  assert.ok(second.coverage.changedFacts > 0);
  for (const current of second.candidates) {
    const previous = first.candidates.find((candidate) => candidate.candidateKey === current.candidateKey);
    assert.notEqual(current.id, previous.id);
    assert.equal(current.reconciliation.previousCandidateId, previous.id);
    assert.equal(current.reconciliation.identityDecision, "NOT_MADE");
    assert.equal(current.governedFeatureId, null);
    assert.equal("authority" in current, false);
  }

  const third = await agent.execute(request("ANALYSIS-V3", "SNAPSHOT-V3"), {
    factGraph: commerceGraph("SNAPSHOT-V3", { serviceVersion: 3, includeEndpoint: false }),
    baselineResult: second,
  });
  const absentApi = third.candidateAbsences.find((item) => item.name === "Submit order");
  assert.ok(absentApi);
  assert.equal(absentApi.disposition, "NO_CURRENT_OBSERVATION");
  assert.equal("retirement" in absentApi, false);
  const currentBusiness = third.candidates.find((candidate) => candidate.mode === "BUSINESS");
  const history = await agent.getCandidateHistory("PROJECT-ANALYSIS", currentBusiness.id);
  assert.equal(history.length, 3);
  assert.equal(history.at(-1).candidate.snapshotManifestId, "SNAPSHOT-V3");
});

test("a complete code move creates a Candidate lineage suggestion without deciding Feature identity", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({ repository });
  const first = await agent.execute(request("ANALYSIS-MOVE-V1", "SNAPSHOT-MOVE-V1"), { factGraph: movedBusinessGraph("SNAPSHOT-MOVE-V1", "services/legacy-billing") });

  const second = await agent.execute(request("ANALYSIS-MOVE-V2", "SNAPSHOT-MOVE-V2"), {
    factGraph: movedBusinessGraph("SNAPSHOT-MOVE-V2", "apps/billing-v2"),
    baselineResult: first,
  });

  assert.notEqual(second.candidates[0].id, first.candidates[0].id);
  assert.equal(second.candidates[0].reconciliation.previousCandidateId, first.candidates[0].id);
  assert.equal(second.candidates[0].reconciliation.matchStatus, "SUGGESTED");
  assert.equal(second.candidates[0].reconciliation.changeType, "IMPLEMENTATION_REMAPPED");
  assert.equal(second.candidates[0].reconciliation.identityDecision, "NOT_MADE");
  assert.equal(second.candidates[0].governedFeatureId, null);
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
  assert.ok(second.candidates.some((candidate) => candidate.reconciliation.changeType === "EVIDENCE_REFRESHED"));
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

test("LLM output cannot smuggle stable Fact-node evidence from outside its WorkUnit", async () => {
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

test("LLM stable evidence must correspond exactly to its declared Fact evidence", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({
    repository,
    modelResolver: () => ({
      async analyze(input) {
        const [declaredFact, mismatchedStable] = input.evidence.nodes;
        if (!mismatchedStable) return { candidateFeatures: [] };
        return { candidateFeatures: [{
          ...input.deterministicCandidates[0],
          evidenceFactIds: [declaredFact.factId],
          stableEvidenceNodeIds: [mismatchedStable.id],
        }] };
      },
    }),
  });
  const result = await agent.execute(request("ANALYSIS-STABLE-MISMATCH", "SNAPSHOT-A", {
    id: "stable-mismatch-model",
    mode: "HYBRID",
    model: { enabled: true, profileId: "UNSAFE", contextWindow: 8_000, maxInputTokens: 4_000, maxOutputTokens: 1_000 },
    maxAttemptsPerWorkUnit: 1,
  }), { factGraph: commerceGraph("SNAPSHOT-A") });

  assert.equal(result.status, "COMPLETED_WITH_GAPS");
  assert.ok((await agent.getRun("PROJECT-ANALYSIS", "ANALYSIS-STABLE-MISMATCH")).workUnits.some((unit) =>
    unit.error?.message.includes("must correspond exactly to evidenceFactIds")));
});

test("LLM design implementation cannot influence lineage with undeclared stable evidence", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({
    repository,
    modelResolver: () => ({
      async analyze(input) {
        const [declaredFact, undeclaredDesignFact] = input.evidence.nodes;
        if (!undeclaredDesignFact) return { candidateFeatures: [] };
        return { candidateFeatures: [{
          ...input.deterministicCandidates[0],
          evidenceFactIds: [declaredFact.factId],
          stableEvidenceNodeIds: [declaredFact.id],
          design: { implementation: [{ stableId: undeclaredDesignFact.id }] },
        }] };
      },
    }),
  });
  const result = await agent.execute(request("ANALYSIS-DESIGN-STABLE-MISMATCH", "SNAPSHOT-A", {
    id: "design-stable-mismatch-model",
    mode: "HYBRID",
    model: { enabled: true, profileId: "UNSAFE", contextWindow: 8_000, maxInputTokens: 4_000, maxOutputTokens: 1_000 },
    maxAttemptsPerWorkUnit: 1,
  }), { factGraph: commerceGraph("SNAPSHOT-A") });

  assert.equal(result.status, "COMPLETED_WITH_GAPS");
  assert.ok((await agent.getRun("PROJECT-ANALYSIS", "ANALYSIS-DESIGN-STABLE-MISMATCH")).workUnits.some((unit) =>
    unit.error?.message.includes("design.implementation stable nodes must be declared evidence")));
});

test("LLM design implementation cannot duplicate stable evidence to influence lineage", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({
    repository,
    modelResolver: () => ({
      async analyze(input) {
        const [declaredFact] = input.evidence.nodes;
        return { candidateFeatures: [{
          ...input.deterministicCandidates[0],
          evidenceFactIds: [declaredFact.factId],
          stableEvidenceNodeIds: [declaredFact.id],
          design: { implementation: [{ stableId: declaredFact.id }, { stableId: declaredFact.id }] },
        }] };
      },
    }),
  });
  const result = await agent.execute(request("ANALYSIS-DESIGN-STABLE-DUPLICATE", "SNAPSHOT-A", {
    id: "design-stable-duplicate-model",
    mode: "HYBRID",
    model: { enabled: true, profileId: "UNSAFE", contextWindow: 8_000, maxInputTokens: 4_000, maxOutputTokens: 1_000 },
    maxAttemptsPerWorkUnit: 1,
  }), { factGraph: commerceGraph("SNAPSHOT-A") });

  assert.equal(result.status, "COMPLETED_WITH_GAPS");
  assert.ok((await agent.getRun("PROJECT-ANALYSIS", "ANALYSIS-DESIGN-STABLE-DUPLICATE")).workUnits.some((unit) =>
    unit.error?.message.includes("design.implementation stable nodes must not contain duplicates")));
});

test("LLM output cannot raise Candidate confidence above the deterministic evidence cap", async () => {
  const repository = new MemoryAnalysisCheckpointRepository();
  const agent = new AnalysisAgent({
    repository,
    modelResolver: () => ({
      async analyze(input) {
        const candidate = input.deterministicCandidates[0];
        return { candidateFeatures: candidate ? [{
          ...candidate,
          confidence: "HIGH",
          evidenceFactIds: [input.evidence.nodes[0].factId],
          stableEvidenceNodeIds: [input.evidence.nodes[0].id],
        }] : [] };
      },
    }),
  });
  const result = await agent.execute(request("ANALYSIS-CONFIDENCE-CAP", "SNAPSHOT-A", {
    id: "confidence-cap-model",
    mode: "HYBRID",
    model: { enabled: true, profileId: "CAP-RAISER", contextWindow: 8_000, maxInputTokens: 4_000, maxOutputTokens: 1_000 },
    maxAttemptsPerWorkUnit: 1,
  }), { factGraph: commerceGraph("SNAPSHOT-A") });

  assert.equal(result.status, "COMPLETED_WITH_GAPS");
  const checkpoint = await agent.getRun("PROJECT-ANALYSIS", "ANALYSIS-CONFIDENCE-CAP");
  assert.ok(checkpoint.workUnits.some((unit) => unit.error?.message.includes("exceeds evidence cap")));
});
