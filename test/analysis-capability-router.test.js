import assert from "node:assert/strict";
import test from "node:test";

import { routeAnalysisWorkUnit, shouldUseIndependentCritic } from "../src/analysis/analysis-capability-router.js";

const request = {
  role: "SOURCE_READER", language: "javascript", artifactKind: "SOURCE", contextTokens: 2000,
  dataBoundaryClass: "RAW_SOURCE_LOCAL", qualityTier: "A", factBundleAvailable: false, redundancyRequired: false,
};
const skill = { id: "SKILL-1", version: "1", status: "ACTIVE", roles: ["SOURCE_READER"], languages: ["javascript"], inputMode: "DIRECT_SOURCE" };
const profile = (overrides = {}) => ({
  id: "MODEL-1", modelRevision: "rev-1", verificationStatus: "VERIFIED", roles: ["SOURCE_READER"],
  languages: ["javascript"], artifactKinds: ["SOURCE"], dataBoundaryClasses: ["RAW_SOURCE_LOCAL"],
  maxContextTokens: 8000, qualityTierByRole: { SOURCE_READER: "A" }, independenceGroup: "GROUP-A", costClass: "LOW",
  ...overrides,
});

test("router fails closed for unverified or ineligible producers", () => {
  const routed = routeAnalysisWorkUnit({
    projectId: "P", analysisRunId: "R", workUnitId: "W", request,
    modelCapabilityProfiles: [profile()], skills: [skill],
  });
  assert.equal(routed.status, "ROUTED");
  const failed = routeAnalysisWorkUnit({
    projectId: "P", analysisRunId: "R", workUnitId: "W", request,
    modelCapabilityProfiles: [profile({ verificationStatus: "UNVERIFIED" })], skills: [skill],
  });
  assert.equal(failed.status, "NO_ELIGIBLE_PRODUCER");
  assert.ok(failed.candidates[0].rejectionReasons.includes("MODEL_REVISION_UNVERIFIED"));
});

test("high-risk redundancy requires a distinct independence group", () => {
  const result = routeAnalysisWorkUnit({
    projectId: "P", analysisRunId: "R", workUnitId: "W", request: { ...request, redundancyRequired: true },
    modelCapabilityProfiles: [profile(), profile({ id: "MODEL-2", independenceGroup: "GROUP-B" })], skills: [skill],
  });
  assert.equal(result.status, "ROUTED");
  assert.equal(new Set(result.selected.map(({ independenceGroup }) => independenceGroup)).size, 2);
  assert.equal(shouldUseIndependentCritic({ risk: "HIGH" }), true);
  assert.equal(shouldUseIndependentCritic({ risk: "LOW", confidence: "HIGH" }), false);
});
