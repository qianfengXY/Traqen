import assert from "node:assert/strict";
import test from "node:test";

import { createContinuousProtectionAssessment, qualityGateExitCode } from "../src/domain/index.js";

function changeImpact(overrides = {}) {
  return {
    changeSet: {
      id: "CHANGESET-001",
      complete: true,
      warnings: [],
      ...overrides,
    },
    impact: {
      toSnapshotManifestId: "SNAPSHOT-002",
      affectedFeatureIds: ["FEATURE-001"],
      affectedTestSpecIds: ["TEST-001"],
    },
  };
}

const testSpecs = [
  { id: "TEST-001", version: 2, featureId: "FEATURE-001", name: "affected", approved: true, operationLevel: "READ_ONLY" },
  { id: "TEST-SMOKE", version: 1, featureId: "FEATURE-HIGH", name: "high-risk smoke", approved: true, operationLevel: "READ_ONLY" },
  { id: "TEST-FALLBACK", version: 1, featureId: "FEATURE-FALLBACK", name: "fallback", approved: true, operationLevel: "READ_ONLY" },
];

function traceability(featureId, complete = true) {
  return {
    feature: { id: featureId },
    dimensions: { authority: [{ status: "CONFIRMED" }], verification: [{ status: complete ? "PASS" : "NOT_RUN" }] },
    traceChains: [{ complete }],
    gaps: complete ? [] : [{ type: "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT", severity: "BLOCKING" }],
  };
}

test("targeted regression takes impacted tests union the fixed high-risk set", () => {
  const result = createContinuousProtectionAssessment({
    projectId: "PROJECT-001",
    changeImpact: changeImpact(),
    testSpecs,
    traceabilities: [traceability("FEATURE-001"), traceability("FEATURE-HIGH")],
    policy: {
      mode: "ENFORCED",
      highRiskFeatureIds: ["FEATURE-HIGH"],
      fixedHighRiskTestSpecIds: ["TEST-SMOKE"],
      conservativeTestSpecIds: ["TEST-FALLBACK"],
    },
  }, () => new Date("2026-07-15T00:00:00.000Z"));

  assert.equal(result.regressionPlan.selectionStrategy, "TARGETED_UNION_HIGH_RISK");
  assert.deepEqual(result.regressionPlan.selectedTests.map((item) => item.id), ["TEST-001", "TEST-SMOKE"]);
  assert.deepEqual(result.regressionPlan.selectedTests[1].reasons, ["FIXED_HIGH_RISK_SET"]);
  assert.equal(result.qualityGate.status, "PASS");
  assert.equal(result.qualityGate.enforcement, "PASS");
});

test("incomplete impact expands conservatively and never becomes a false PASS", () => {
  const result = createContinuousProtectionAssessment({
    projectId: "PROJECT-001",
    changeImpact: changeImpact({ complete: false, warnings: ["dynamic path unresolved"] }),
    testSpecs,
    traceabilities: [traceability("FEATURE-001"), traceability("FEATURE-FALLBACK")],
    policy: { mode: "ADVISORY", conservativeTestSpecIds: ["TEST-FALLBACK"] },
  });

  assert.equal(result.regressionPlan.selectionStrategy, "CONSERVATIVE_UNION");
  assert.deepEqual(result.regressionPlan.selectedTests.map((item) => item.id), ["TEST-001", "TEST-FALLBACK"]);
  assert.equal(result.qualityGate.status, "UNKNOWN");
  assert.equal(result.qualityGate.enforcement, "WARN");
  assert.ok(result.qualityGate.requiredActions.includes("EXPAND_REGRESSION_SCOPE"));
});

test("a broken affected proof chain blocks without hiding its independent dimensions", () => {
  const result = createContinuousProtectionAssessment({
    projectId: "PROJECT-001",
    changeImpact: changeImpact(),
    testSpecs,
    traceabilities: [traceability("FEATURE-001", false)],
    policy: { mode: "MANUAL_APPROVAL" },
  });

  assert.equal(result.qualityGate.status, "BLOCKED");
  assert.equal(result.qualityGate.enforcement, "REQUIRE_APPROVAL");
  assert.equal(result.featureAssessments[0].dimensions.authority[0].status, "CONFIRMED");
  assert.equal(result.featureAssessments[0].dimensions.verification[0].status, "NOT_RUN");
  assert.deepEqual(result.qualityGate.reasons, ["FEATURE_PROOF_CHAIN_INCOMPLETE"]);
  assert.equal(qualityGateExitCode(result), 2);
});

test("CI exit semantics follow explicit policy enforcement instead of raw color", () => {
  assert.equal(qualityGateExitCode({ qualityGate: { enforcement: "PASS" } }), 0);
  assert.equal(qualityGateExitCode({ qualityGate: { enforcement: "WARN" } }), 0);
  assert.equal(qualityGateExitCode({ qualityGate: { enforcement: "FAIL" } }), 1);
  assert.equal(qualityGateExitCode({ qualityGate: { enforcement: "REQUIRE_APPROVAL" } }), 2);
  assert.throws(() => qualityGateExitCode({ qualityGate: { enforcement: "UNKNOWN" } }), /invalid/);
});

test("a high-risk Feature without a configured regression TestSpec stays unknown", () => {
  const result = createContinuousProtectionAssessment({
    projectId: "PROJECT-001",
    changeImpact: changeImpact(),
    testSpecs,
    traceabilities: [traceability("FEATURE-001"), traceability("FEATURE-HIGH")],
    policy: { mode: "ENFORCED", highRiskFeatureIds: ["FEATURE-HIGH"] },
  });
  assert.equal(result.qualityGate.status, "UNKNOWN");
  assert.equal(result.qualityGate.enforcement, "FAIL");
  assert.ok(result.qualityGate.reasons.includes("HIGH_RISK_TEST_SET_MISSING"));
});
