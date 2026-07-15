import assert from "node:assert/strict";
import test from "node:test";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { createDecisionReviewCase, evaluateDecisionReviewCase } from "../src/domain/index.js";
import { MemoryTraceabilityStore, ReviewAuthorizationError } from "../src/storage/index.js";
import { completeInput } from "./fixtures.js";

let now = Date.parse("2026-07-15T09:00:00.000Z");
const clock = () => new Date(now);

const governancePolicy = {
  proposerRoles: ["business-owner"],
  approvalRoles: ["business-owner", "compliance-owner"],
  businessRoles: ["business-owner"],
  complianceRoles: ["compliance-owner"],
  breakGlassRoles: ["incident-commander"],
  lifecycleRoles: ["governance-owner"],
  maxBreakGlassMinutes: 60,
};

async function fixture() {
  now = Date.parse("2026-07-15T09:00:00.000Z");
  const store = new MemoryTraceabilityStore();
  let reviewer = { actorId: "PROPOSER-001", actorRole: "business-owner" };
  const application = new TraceabilityApplication({
    store,
    clock,
    reviewerResolver: () => reviewer,
    reviewPolicyResolver: () => ({ decisionGovernance: governancePolicy }),
  });
  await application.createProject({
    organization: { id: "ORG-001", name: "Traqen" },
    tenant: { id: "TENANT-001", name: "Default" },
    project: { id: "PROJECT-001", name: "Orders" },
    principals: [
      { id: "PROPOSER-001", type: "USER", displayName: "Proposer" },
      { id: "APPROVER-001", type: "USER", displayName: "Business approver" },
      { id: "APPROVER-002", type: "USER", displayName: "Compliance approver" },
      { id: "INCIDENT-001", type: "USER", displayName: "Incident commander" },
      { id: "GOVERNANCE-001", type: "USER", displayName: "Governance owner" },
    ],
  });
  await application.appendFeatureVersion("PROJECT-001", { id: "FEATURE-001", version: 1, name: "Submit order" });
  await application.appendClaimScope("PROJECT-001", { id: "SCOPE-001", version: 1, scope: { actor: "customer" } });
  await application.appendClaim("PROJECT-001", {
    id: "CLAIM-001",
    version: 1,
    featureId: "FEATURE-001",
    type: "NORMATIVE_REQUIREMENT",
    statement: "Only a customer-owned draft order may be submitted.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    provenance: { source: "product-policy" },
  });
  return {
    application,
    become(actorId, actorRole) { reviewer = { actorId, actorRole }; },
  };
}

function caseInput(overrides = {}) {
  return {
    id: "DECISION-CASE-001",
    claimId: "CLAIM-001",
    claimVersion: 1,
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    risk: "HIGH",
    approvalMode: "DUAL",
    proposedDecision: {
      id: "DECISION-001",
      type: "CONFIRMED",
      evidenceRefs: ["EVIDENCE-POLICY-001"],
    },
    expiresAt: "2026-07-16T09:00:00.000Z",
    ...overrides,
  };
}

test("HIGH Decisions require distinct proposer and dual approvers, then materialize append-only authority", async () => {
  const { application, become } = await fixture();
  let result = await application.createDecisionReviewCase("PROJECT-001", caseInput());
  assert.equal(result.evaluation.status, "PENDING");

  await assert.rejects(
    application.appendDecisionReviewEvent("PROJECT-001", result.reviewCase.id, {
      id: "EVENT-SELF-APPROVE",
      action: "APPROVE",
      rationale: "Self approval must fail.",
    }),
    ReviewAuthorizationError,
  );

  become("APPROVER-001", "business-owner");
  result = await application.appendDecisionReviewEvent("PROJECT-001", result.reviewCase.id, {
    id: "EVENT-APPROVE-001",
    action: "APPROVE",
    rationale: "Business approval after evidence review.",
  });
  assert.equal(result.evaluation.status, "PENDING");
  assert.equal(result.decision, null);

  become("APPROVER-002", "compliance-owner");
  result = await application.appendDecisionReviewEvent("PROJECT-001", result.reviewCase.id, {
    id: "EVENT-APPROVE-002",
    action: "APPROVE",
    rationale: "Independent compliance approval.",
  });
  assert.equal(result.evaluation.status, "APPROVED");
  assert.equal(result.decision.id, "DECISION-001");
  assert.equal(result.decision.actorId, "APPROVER-002");

  become("GOVERNANCE-001", "governance-owner");
  result = await application.appendDecisionReviewEvent("PROJECT-001", result.reviewCase.id, {
    id: "EVENT-REVOKE-001",
    action: "REVOKE",
    rationale: "The underlying policy was withdrawn.",
  });
  assert.equal(result.evaluation.status, "REVOKED");
  assert.equal(result.decision.type, "DEPRECATED");
  assert.equal(result.decisions.length, 2);

  result = await application.appendDecisionReviewEvent("PROJECT-001", result.reviewCase.id, {
    id: "EVENT-REOPEN-001",
    action: "REOPEN",
    rationale: "A replacement authority source is available for a new review round.",
  });
  assert.equal(result.evaluation.status, "PENDING");

  become("APPROVER-001", "business-owner");
  await application.appendDecisionReviewEvent("PROJECT-001", result.reviewCase.id, {
    id: "EVENT-REAPPROVE-001",
    action: "APPROVE",
    rationale: "Business re-approval.",
  });
  become("APPROVER-002", "compliance-owner");
  result = await application.appendDecisionReviewEvent("PROJECT-001", result.reviewCase.id, {
    id: "EVENT-REAPPROVE-002",
    action: "APPROVE",
    rationale: "Compliance re-approval.",
  });
  assert.equal(result.evaluation.status, "APPROVED");
  assert.match(result.decision.id, /:REOPEN:EVENT-REOPEN-001$/);
});

test("business-and-compliance mode requires both role groups, not merely two approvals", async () => {
  const reviewCase = createDecisionReviewCase({
    ...caseInput({ approvalMode: "BUSINESS_COMPLIANCE" }),
    proposerId: "PROPOSER-001",
    proposerRole: "business-owner",
  }, clock);
  const evaluation = evaluateDecisionReviewCase(reviewCase, [
    { id: "E1", caseId: reviewCase.id, action: "APPROVE", actorId: "A1", actorRole: "business-owner", rationale: "one", createdAt: "2026-07-15T09:01:00.000Z" },
    { id: "E2", caseId: reviewCase.id, action: "APPROVE", actorId: "A2", actorRole: "business-owner", rationale: "two", createdAt: "2026-07-15T09:02:00.000Z" },
  ], governancePolicy, clock);
  assert.equal(evaluation.status, "PENDING");
  assert.equal(evaluation.mayMaterializeDecision, false);
});

test("Break-glass is time-limited and exposes an overdue post-review instead of silently staying approved", async () => {
  const { application, become } = await fixture();
  let result = await application.createDecisionReviewCase("PROJECT-001", caseInput({
    id: "DECISION-CASE-BREAK-GLASS",
    approvalMode: "BREAK_GLASS",
    proposedDecision: {
      id: "DECISION-BREAK-GLASS",
      type: "EXCEPTION_RECORDED",
      content: "Permit emergency submission recovery for 30 minutes.",
      validUntil: "2026-07-15T09:30:00.000Z",
    },
    emergencyReason: "Customer order recovery is blocked during an active incident.",
    postReviewDueAt: "2026-07-15T10:00:00.000Z",
  }));
  become("INCIDENT-001", "incident-commander");
  result = await application.appendDecisionReviewEvent("PROJECT-001", result.reviewCase.id, {
    id: "EVENT-BREAK-GLASS-APPROVE",
    action: "APPROVE",
    rationale: "Approve the bounded emergency exception.",
  });
  assert.equal(result.evaluation.status, "APPROVED");
  now = Date.parse("2026-07-15T10:01:00.000Z");
  result = await application.getDecisionReviewCase("PROJECT-001", result.reviewCase.id);
  assert.equal(result.evaluation.status, "POST_REVIEW_OVERDUE");
  const snapshot = await application.registerSnapshot("PROJECT-001", completeInput().snapshotManifest);
  const traceability = await application.getFeatureTraceability("PROJECT-001", "FEATURE-001", snapshot.id);
  assert.equal(traceability.claims[0].authorityStatus, "DEPRECATED");

  become("GOVERNANCE-001", "governance-owner");
  result = await application.appendDecisionReviewEvent("PROJECT-001", result.reviewCase.id, {
    id: "EVENT-BREAK-GLASS-POST-REVIEW",
    action: "POST_REVIEW",
    rationale: "The emergency action and Evidence were reviewed after the incident.",
  });
  assert.equal(result.evaluation.status, "APPROVED");
  assert.equal(result.evaluation.postReviewed, true);
});
