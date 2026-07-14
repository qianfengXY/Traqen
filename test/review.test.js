import assert from "node:assert/strict";
import test from "node:test";

import {
  assessImplementationConformance,
  createImplementationConformance,
  createImplementationMapping,
  createReverseCandidateReview,
} from "../src/domain/index.js";

const fixedClock = () => new Date("2026-07-14T11:00:00.000Z");

test("candidate review keeps the human decision separate from observed implementation", () => {
  const mapping = createImplementationMapping({
    claimId: "CLAIM-001",
    claimVersion: 1,
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    snapshotManifestId: "SNAPSHOT-001",
    sourceComponentId: "SOURCE-001",
    sourceRunId: "RUN-001",
    sourceCandidateId: "CANDIDATE-001",
    factRefs: [{ factId: "FACT-001", relation: "SUPPORTS" }],
  }, fixedClock);
  const conformance = createImplementationConformance({
    claimId: "CLAIM-001",
    claimVersion: 1,
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    snapshotManifestId: "SNAPSHOT-001",
    mappingId: mapping.id,
    status: "CONFORMS",
    evidenceRefs: ["FACT-001"],
    analysisMethod: { type: "DETERMINISTIC_CONSTRAINT_COMPARISON", version: "1.0.0" },
  }, fixedClock);
  const review = createReverseCandidateReview({
    id: "REVIEW-001",
    requestFingerprint: "CANDIDATE-REVIEW-REQUEST-001",
    runId: "RUN-001",
    candidateId: "CANDIDATE-001",
    outcome: "CONFIRMED",
    rationale: "The product owner confirms this rule for the stated scope.",
    actorId: "USER-001",
    actorRole: "business-owner",
    baselineRefs: {
      featureId: "FEATURE-001",
      claimId: "CLAIM-001",
      claimVersion: 1,
      mappingId: mapping.id,
      conformanceId: conformance.id,
    },
  }, fixedClock);

  assert.equal(mapping.status, "ACTIVE");
  assert.equal(conformance.mappingId, mapping.id);
  assert.equal(review.outcome, "CONFIRMED");
  assert.equal(Object.isFrozen(review.baselineRefs), true);
});

test("constraint comparison never invents conformance across unrelated dimensions", () => {
  assert.equal(
    assessImplementationConformance(
      { dimension: "endpointExposed", operator: "EQUALS", value: true },
      { dimension: "endpointExposed", operator: "EQUALS", value: true },
    ),
    "CONFORMS",
  );
  assert.equal(
    assessImplementationConformance(
      { dimension: "requiredState", operator: "EQUALS", value: "DRAFT" },
      { dimension: "requiredState", operator: "EQUALS", value: "APPROVED" },
    ),
    "DEVIATES",
  );
  assert.equal(
    assessImplementationConformance(
      { dimension: "requiredState", operator: "EQUALS", value: "DRAFT" },
      { dimension: "endpointExposed", operator: "EQUALS", value: true },
    ),
    "UNKNOWN",
  );
});

test("non-baselining outcomes cannot smuggle baseline references", () => {
  assert.throws(
    () => createReverseCandidateReview({
      id: "REVIEW-REJECT",
      requestFingerprint: "CANDIDATE-REVIEW-REQUEST-REJECT",
      runId: "RUN-001",
      candidateId: "CANDIDATE-001",
      outcome: "REJECTED",
      rationale: "This describes an obsolete compatibility endpoint.",
      actorId: "USER-001",
      actorRole: "business-owner",
      baselineRefs: { claimId: "CLAIM-001" },
    }, fixedClock),
    /must be absent/,
  );
});
