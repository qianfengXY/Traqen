import assert from "node:assert/strict";
import test from "node:test";

import {
  createFactBundle,
  createReverseInputPackage,
  createReverseSkillManifest,
  createReverseSkillRegistration,
  signReverseSkillManifest,
} from "../src/domain/index.js";
import { createReferenceSkillSet, ReverseSkillOrchestrator } from "../src/skills/index.js";

const fixedClock = () => new Date("2026-07-14T10:00:00.000Z");

function factBundle() {
  const source = {
    artifact: "src/orders.js",
    startLine: 1,
    endLine: 8,
    contentHash: `sha256:${"a".repeat(64)}`,
  };
  const seed = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    sourceComponentId: "SOURCE-001",
    sourceDigest: `sha256:${"b".repeat(64)}`,
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt: "2026-07-14T09:55:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [
      {
        type: "ENDPOINT",
        naturalKey: "http:POST /orders/{id}/submit",
        name: "POST /orders/{id}/submit",
        attributes: { method: "POST", path: "/orders/{id}/submit" },
        source,
      },
      {
        type: "CODE_SYMBOL",
        naturalKey: "javascript:src/orders.js:submitOrder",
        name: "submitOrder",
        attributes: { kind: "function" },
        source,
      },
      {
        type: "DATA_OBJECT",
        naturalKey: "table:orders",
        name: "orders",
        attributes: { kind: "table" },
        source,
      },
    ],
    edges: [],
  });
  const symbol = seed.nodes.find((node) => node.type === "CODE_SYMBOL");
  const table = seed.nodes.find((node) => node.type === "DATA_OBJECT");
  return createFactBundle({
    ...seed,
    nodes: seed.nodes,
    edges: [{ subjectId: symbol.id, predicate: "WRITES", objectId: table.id, attributes: {}, source }],
  });
}

function inputPackage(overrides = {}) {
  return createReverseInputPackage({
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    sourceComponentId: "SOURCE-001",
    factBundles: [factBundle()],
    taskScope: {},
    policyContext: { dataClassification: "INTERNAL" },
    createdAt: "2026-07-14T09:56:00.000Z",
    ...overrides,
  }, fixedClock);
}

function registration(manifest, status = "ALLOWED", secret = "publisher-secret") {
  const signed = signReverseSkillManifest(manifest, secret);
  return createReverseSkillRegistration({ ...signed, status, registeredAt: "2026-07-14T09:50:00.000Z" }, fixedClock);
}

test("controlled input packages cannot expand beyond the selected Fact Bundles", () => {
  const bundle = factBundle();
  const endpoint = bundle.nodes.find((node) => node.type === "ENDPOINT");
  const selected = inputPackage({ taskScope: { nodeIds: [endpoint.id] } });

  assert.equal(selected.contentTrust, "UNTRUSTED_SOURCE_CONTENT");
  assert.equal(selected.facts.nodes.length, 1);
  assert.equal(selected.facts.edges.length, 0);
  assert.deepEqual(selected.allowedFactIds, [endpoint.factId]);
  assert.throws(
    () => inputPackage({ taskScope: { artifacts: ["../outside.js"] } }),
    /outside the Fact Bundles/,
  );
  const sameContentLater = inputPackage({ createdAt: "2026-07-14T10:56:00.000Z" });
  const sameContentEarlier = inputPackage({ createdAt: "2026-07-14T09:56:00.000Z" });
  assert.equal(sameContentLater.id, sameContentEarlier.id);
  assert.equal(sameContentLater.digest, sameContentEarlier.digest);
  assert.notEqual(sameContentLater.createdAt, sameContentEarlier.createdAt);
});

test("two replaceable reference adapters produce one merged candidate with full provenance", async () => {
  const referenceSkills = createReferenceSkillSet();
  const registrations = referenceSkills.map((item) => registration(item.manifest));
  const orchestrator = new ReverseSkillOrchestrator({
    adapters: referenceSkills.map((item) => item.adapter),
    clock: fixedClock,
  });
  const run = await orchestrator.execute({
    runId: "REVERSE-RUN-001",
    inputPackage: inputPackage(),
    registrations,
    policy: {
      allowedSkillIds: ["specone-reference", "gsd-reference"],
      allowedPublishers: ["TRAQEN"],
      maxSkills: 2,
      maxAttempts: 1,
    },
  });

  assert.equal(run.status, "WAITING_REVIEW");
  assert.deepEqual(run.statusHistory.map((event) => event.status), [
    "CREATED",
    "FACT_SCANNING",
    "SKILL_PLANNING",
    "SKILL_RUNNING",
    "NORMALIZING",
    "CONFLICT_ANALYSIS",
    "WAITING_REVIEW",
  ]);
  assert.equal(run.skillRuns.length, 2);
  assert.ok(run.skillRuns.every((skillRun) => skillRun.status === "COMPLETED"));
  const endpointFeature = run.mergedOutput.candidateFeatures.find(
    (candidate) => candidate.externalKey === "endpoint:POST /orders/{id}/submit",
  );
  assert.equal(endpointFeature.sources.length, 2);
  assert.equal(run.mergedOutput.candidateClaims.find((claim) => claim.subjectKey.startsWith("endpoint:")).sources.length, 2);
  assert.ok(referenceSkills[0].manifest.capabilities.includes("TEST_DESIGN"));
  assert.equal(run.mergedOutput.candidateTestSpecs.length, 1);
  assert.equal(run.mergedOutput.candidateTestSpecs[0].specification.requiresHumanReview, true);
  assert.ok(run.mergedOutput.openQuestions.length > 0);
});

test("blocked Skills and installed artifact mismatches fail before adapter execution", async () => {
  const [reference] = createReferenceSkillSet();
  let executed = false;
  const adapter = { ...reference.adapter, execute: async () => { executed = true; return {}; } };
  const orchestrator = new ReverseSkillOrchestrator({ adapters: [adapter], clock: fixedClock });

  await assert.rejects(
    orchestrator.execute({
      runId: "REVERSE-RUN-BLOCKED",
      inputPackage: inputPackage(),
      registrations: [registration(reference.manifest, "BLOCKED")],
    }),
    /is blocked/,
  );
  assert.equal(executed, false);

  const wrongDigest = createReverseSkillManifest({
    ...reference.manifest,
    metadata: { ...reference.manifest.metadata, artifactDigest: `sha256:${"f".repeat(64)}` },
  });
  await assert.rejects(
    orchestrator.execute({
      runId: "REVERSE-RUN-DIGEST",
      inputPackage: inputPackage(),
      registrations: [registration(wrongDigest)],
    }),
    /Installed adapter does not match/,
  );
  assert.equal(executed, false);

  await assert.rejects(
    orchestrator.execute({
      runId: "REVERSE-RUN-EMPTY-ALLOWLIST",
      inputPackage: inputPackage(),
      registrations: [registration(reference.manifest)],
      policy: { allowedSkillIds: [] },
    }),
    /not allowed by policy/,
  );
  assert.equal(executed, false);
});

test("incomplete Fact Bundles require an explicit server-side policy exception", async () => {
  const [reference] = createReferenceSkillSet();
  const incompleteBundle = structuredClone(factBundle());
  incompleteBundle.complete = false;
  incompleteBundle.diagnostics = [{ severity: "ERROR", artifact: "src/broken.js", message: "parse failed" }];
  const orchestrator = new ReverseSkillOrchestrator({ adapters: [reference.adapter], clock: fixedClock });

  await assert.rejects(
    orchestrator.execute({
      runId: "REVERSE-RUN-INCOMPLETE",
      inputPackage: inputPackage({ factBundles: [incompleteBundle] }),
      registrations: [registration(reference.manifest)],
    }),
    /rejects incomplete Fact Bundles/,
  );
});

test("timeouts are retried within policy and remain explicit when no Skill succeeds", async () => {
  const [reference] = createReferenceSkillSet();
  const hangingAdapter = { ...reference.adapter, execute: async () => new Promise(() => {}) };
  const orchestrator = new ReverseSkillOrchestrator({
    adapters: [hangingAdapter],
    clock: fixedClock,
    millisecondsPerMinute: 5,
  });
  const run = await orchestrator.execute({
    runId: "REVERSE-RUN-TIMEOUT",
    inputPackage: inputPackage(),
    registrations: [registration(reference.manifest)],
    policy: { maxAttempts: 2 },
  });

  assert.equal(run.status, "FAILED");
  assert.equal(run.skillRuns[0].attempts.length, 2);
  assert.ok(run.skillRuns[0].attempts.every((attempt) => attempt.status === "FAILED"));
  assert.match(run.skillRuns[0].attempts[0].error.message, /exceeded 5ms/);
});

test("Skill output content safety rejects secret-like fields before normalization", async () => {
  const [reference] = createReferenceSkillSet();
  const unsafeAdapter = {
    ...reference.adapter,
    execute: async () => ({
      candidateFeatures: [],
      candidateClaims: [],
      openQuestions: [{ localId: "question", question: "Review output", relatedLocalIds: [], evidence: [] }],
      authorizationToken: "Bearer leaked-value",
    }),
  };
  const orchestrator = new ReverseSkillOrchestrator({ adapters: [unsafeAdapter], clock: fixedClock });
  const run = await orchestrator.execute({
    runId: "REVERSE-RUN-UNSAFE",
    inputPackage: inputPackage(),
    registrations: [registration(reference.manifest)],
  });

  assert.equal(run.status, "FAILED");
  assert.match(run.skillRuns[0].attempts[0].error.message, /forbidden sensitive output field/);
});
