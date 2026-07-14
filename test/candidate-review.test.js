import assert from "node:assert/strict";
import test from "node:test";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";

const fixedClock = () => new Date("2026-07-14T12:00:00.000Z");

function reverseRun({ id = "RUN-001", conflicted = false } = {}) {
  const candidateId = `MERGED-CLAIM-${id}`;
  const conflict = {
    id: `CONFLICT-${id}`,
    type: "CLAIM_CONTRADICTION",
    status: "OPEN",
    candidateIds: [candidateId, `OTHER-${id}`],
    reason: "Opposing endpoint exposure constraints overlap in scope",
    evidence: [{ factId: "FACT-001", relation: "SUPPORTS" }],
    detectedAt: "2026-07-14T11:30:00.000Z",
  };
  return {
    id,
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    sourceComponentId: "SOURCE-001",
    inputPackage: { digest: `sha256:${"a".repeat(64)}` },
    skillRuns: [],
    status: "WAITING_REVIEW",
    statusHistory: [{ sequence: 1, status: "WAITING_REVIEW", details: {}, occurredAt: "2026-07-14T11:30:00.000Z" }],
    mergedOutput: {
      id: `MERGE-${id}`,
      candidateFeatures: [{
        id: `MERGED-FEATURE-${id}`,
        externalKey: "endpoint:POST /orders/{id}/submit",
        name: "Submit order",
        descriptions: ["Submit an order through the observed endpoint."],
        evidence: [{ factId: "FACT-001", relation: "SUPPORTS" }],
        sources: [{ candidateId: "RAW-FEATURE-1", producer: { skillId: "specone", skillVersion: "1.0.0" } }],
      }],
      candidateClaims: [{
        id: candidateId,
        type: "IMPLEMENTATION_BEHAVIOR",
        subjectKey: "endpoint:POST /orders/{id}/submit",
        statements: ["The current implementation exposes the submit endpoint."],
        confidence: "HIGH",
        constraint: { dimension: "endpointExposed", operator: "EQUALS", value: true },
        scope: {},
        evidence: [{ factId: "FACT-001", relation: "SUPPORTS" }],
        sources: [
          { candidateId: "RAW-CLAIM-1", producer: { skillId: "specone", skillVersion: "1.0.0" } },
          { candidateId: "RAW-CLAIM-2", producer: { skillId: "gsd", skillVersion: "1.0.0" } },
        ],
      }],
      candidateTestSpecs: [],
      openQuestions: [],
      conflicts: conflicted ? [conflict] : [],
      warnings: [],
    },
  };
}

function application(store, reviewer = { actorId: "USER-001", actorRole: "business-owner" }) {
  return new TraceabilityApplication({
    store,
    clock: fixedClock,
    reviewerResolver: () => reviewer,
    reviewPolicyResolver: () => ({
      allowedRoles: ["business-owner"],
      allowedOutcomes: ["CONFIRMED", "EXCEPTION_RECORDED", "REJECTED", "INSUFFICIENT_EVIDENCE", "DEFERRED"],
    }),
  });
}

function confirmedInput(runId = "RUN-001") {
  return {
    id: `REVIEW-${runId}`,
    outcome: "CONFIRMED",
    rationale: "The business owner confirms endpoint availability in the normal-user scope.",
    candidateFeatureId: `MERGED-FEATURE-${runId}`,
    target: {
      featureMode: "CREATE",
      featureId: `FEATURE-${runId}`,
      claimId: `CLAIM-${runId}`,
      scopeId: `SCOPE-${runId}`,
      decisionId: `DECISION-${runId}`,
      businessDomain: "orders",
    },
    normative: {
      statement: "The submit-order capability must expose its submission endpoint.",
      constraint: { dimension: "endpointExposed", operator: "EQUALS", value: true },
      scope: { actor: "normal-user", orderType: "standard" },
      authorityEvidenceRefs: ["AUTHORITY-PRODUCT-001"],
    },
  };
}

test("an authorized statement-level review atomically creates a normative baseline", async () => {
  const store = new MemoryTraceabilityStore();
  const run = reverseRun();
  await store.appendReverseRun("PROJECT-001", run);
  const app = application(store);
  const input = confirmedInput();

  const result = await app.reviewReverseCandidate("PROJECT-001", run.id, run.mergedOutput.candidateClaims[0].id, input);
  assert.equal(result.review.outcome, "CONFIRMED");
  assert.equal(result.claim.type, "NORMATIVE_REQUIREMENT");
  assert.equal(result.claim.sourceType, "HUMAN");
  assert.equal(result.decision.actorId, "USER-001");
  assert.equal(result.conformance.status, "CONFORMS");
  assert.equal(result.implementationMapping.factRefs[0].factId, "FACT-001");
  assert.equal(run.mergedOutput.candidateClaims[0].type, "IMPLEMENTATION_BEHAVIOR");

  const baseline = await app.getFeatureBaseline("PROJECT-001", "FEATURE-RUN-001");
  assert.equal(baseline.claims[0].claim.statement, input.normative.statement);
  assert.equal(baseline.claims[0].latestDecision.type, "CONFIRMED");
  assert.equal(baseline.implementationMappings[0].status, "ACTIVE");
  assert.equal(baseline.conformances[0].status, "CONFORMS");
  assert.equal(baseline.candidateReviews[0].review.id, "REVIEW-RUN-001");

  const repeated = await app.reviewReverseCandidate("PROJECT-001", run.id, run.mergedOutput.candidateClaims[0].id, input);
  assert.deepEqual(repeated, result);
  await assert.rejects(
    app.reviewReverseCandidate("PROJECT-001", run.id, run.mergedOutput.candidateClaims[0].id, {
      ...input,
      id: "REVIEW-DIFFERENT",
    }),
    /already has an immutable review/,
  );
});

test("conflicts require an explicit exception and rejected candidates create no baseline", async () => {
  const store = new MemoryTraceabilityStore();
  const conflictedRun = reverseRun({ id: "RUN-CONFLICT", conflicted: true });
  const rejectedRun = reverseRun({ id: "RUN-REJECT" });
  await store.appendReverseRun("PROJECT-001", conflictedRun);
  await store.appendReverseRun("PROJECT-001", rejectedRun);
  const app = application(store);

  await assert.rejects(
    app.reviewReverseCandidate(
      "PROJECT-001",
      conflictedRun.id,
      conflictedRun.mergedOutput.candidateClaims[0].id,
      confirmedInput("RUN-CONFLICT"),
    ),
    /cannot be confirmed/,
  );
  const exceptionInput = {
    ...confirmedInput("RUN-CONFLICT"),
    outcome: "EXCEPTION_RECORDED",
    acknowledgedConflictIds: ["CONFLICT-RUN-CONFLICT"],
    normative: {
      ...confirmedInput("RUN-CONFLICT").normative,
      decisionContent: "A legacy deployment may temporarily omit the endpoint during migration.",
    },
  };
  const exception = await app.reviewReverseCandidate(
    "PROJECT-001",
    conflictedRun.id,
    conflictedRun.mergedOutput.candidateClaims[0].id,
    exceptionInput,
  );
  assert.equal(exception.conformance.status, "CONFLICTED");
  assert.equal(exception.claim.evidenceSupport, "CONTRADICTED");

  const rejected = await app.reviewReverseCandidate(
    "PROJECT-001",
    rejectedRun.id,
    rejectedRun.mergedOutput.candidateClaims[0].id,
    {
      id: "REVIEW-REJECT",
      outcome: "REJECTED",
      rationale: "This endpoint is an internal compatibility artifact, not a product rule.",
    },
  );
  assert.equal(rejected.claim, null);
  assert.equal((await app.listReverseCandidateReviews("PROJECT-001", rejectedRun.id)).length, 1);
});

test("review requires a trusted identity and an allowed role", async () => {
  const store = new MemoryTraceabilityStore();
  const run = reverseRun({ id: "RUN-AUTH" });
  await store.appendReverseRun("PROJECT-001", run);

  await assert.rejects(
    application(store, null).reviewReverseCandidate(
      "PROJECT-001",
      run.id,
      run.mergedOutput.candidateClaims[0].id,
      confirmedInput("RUN-AUTH"),
    ),
    (error) => error.name === "ReviewAuthenticationError",
  );
  await assert.rejects(
    application(store, { actorId: "DEV-001", actorRole: "developer" }).reviewReverseCandidate(
      "PROJECT-001",
      run.id,
      run.mergedOutput.candidateClaims[0].id,
      confirmedInput("RUN-AUTH"),
    ),
    (error) => error.name === "ReviewAuthorizationError",
  );
});

test("attaching a candidate to an existing Feature requires an explicit association rationale", async () => {
  const store = new MemoryTraceabilityStore();
  const firstRun = reverseRun({ id: "RUN-EXISTING-BASE" });
  const secondRun = reverseRun({ id: "RUN-EXISTING-ATTACH" });
  await store.appendReverseRun("PROJECT-001", firstRun);
  await store.appendReverseRun("PROJECT-001", secondRun);
  const app = application(store);
  await app.reviewReverseCandidate(
    "PROJECT-001",
    firstRun.id,
    firstRun.mergedOutput.candidateClaims[0].id,
    confirmedInput(firstRun.id),
  );
  const target = {
    featureMode: "EXISTING",
    featureId: "FEATURE-RUN-EXISTING-BASE",
    claimId: "CLAIM-RUN-EXISTING-ATTACH",
    scopeId: "SCOPE-RUN-EXISTING-ATTACH",
    decisionId: "DECISION-RUN-EXISTING-ATTACH",
  };
  const input = {
    ...confirmedInput(secondRun.id),
    target,
  };
  await assert.rejects(
    app.reviewReverseCandidate(
      "PROJECT-001",
      secondRun.id,
      secondRun.mergedOutput.candidateClaims[0].id,
      input,
    ),
    /associationRationale is required/,
  );

  const attached = await app.reviewReverseCandidate(
    "PROJECT-001",
    secondRun.id,
    secondRun.mergedOutput.candidateClaims[0].id,
    {
      ...input,
      target: {
        ...target,
        associationRationale: "Both candidates describe the same governed submit-order capability.",
      },
    },
  );
  assert.equal(attached.feature, null);
  assert.equal(attached.claim.featureId, "FEATURE-RUN-EXISTING-BASE");
});
