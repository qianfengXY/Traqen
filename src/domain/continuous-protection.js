import { contentId, deepFreeze } from "./canonical-json.js";
import { requireIsoTimestamp, requireNonEmptyString } from "./model.js";

export const QualityGateMode = Object.freeze({
  ADVISORY: "ADVISORY",
  MANUAL_APPROVAL: "MANUAL_APPROVAL",
  ENFORCED: "ENFORCED",
});

const gateModes = new Set(Object.values(QualityGateMode));

function stringArray(value, fieldName) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new TypeError(`${fieldName} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))].sort();
}

function normalizePolicy(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("continuous protection policy must be an object");
  }
  const mode = input.mode ?? QualityGateMode.ADVISORY;
  if (!gateModes.has(mode)) throw new TypeError("policy.mode must be ADVISORY, MANUAL_APPROVAL, or ENFORCED");
  return {
    mode,
    highRiskFeatureIds: stringArray(input.highRiskFeatureIds, "policy.highRiskFeatureIds"),
    fixedHighRiskTestSpecIds: stringArray(input.fixedHighRiskTestSpecIds, "policy.fixedHighRiskTestSpecIds"),
    conservativeTestSpecIds: stringArray(input.conservativeTestSpecIds, "policy.conservativeTestSpecIds"),
  };
}

function traceabilityComplete(traceability) {
  return Boolean(
    traceability &&
    (traceability.traceChains ?? []).length > 0 &&
    traceability.traceChains.every((chain) => chain.complete === true) &&
    (traceability.gaps ?? []).length === 0,
  );
}

function enforcementFor(status, mode) {
  if (status === "PASS") return "PASS";
  if (mode === QualityGateMode.ENFORCED) return "FAIL";
  if (mode === QualityGateMode.MANUAL_APPROVAL) return "REQUIRE_APPROVAL";
  return "WARN";
}

export function createContinuousProtectionAssessment(input, clock = () => new Date()) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("continuous protection assessment input must be an object");
  }
  const changeImpact = input.changeImpact;
  if (changeImpact === null || typeof changeImpact !== "object" || Array.isArray(changeImpact)) {
    throw new TypeError("changeImpact must be an object");
  }
  const changeSet = changeImpact.changeSet;
  const impact = changeImpact.impact;
  requireNonEmptyString(changeSet?.id, "changeImpact.changeSet.id");
  requireNonEmptyString(impact?.toSnapshotManifestId, "changeImpact.impact.toSnapshotManifestId");
  if (!Array.isArray(input.testSpecs ?? [])) throw new TypeError("testSpecs must be an array");
  if (!Array.isArray(input.traceabilities ?? [])) throw new TypeError("traceabilities must be an array");
  const policy = normalizePolicy(input.policy);
  const testSpecsById = new Map((input.testSpecs ?? []).map((testSpec) => [testSpec.id, testSpec]));
  const traceabilityByFeature = new Map(
    (input.traceabilities ?? []).filter(Boolean).map((traceability) => [traceability.feature?.id, traceability]),
  );
  const reasonsByTest = new Map();
  const select = (testSpecId, reason) => {
    requireNonEmptyString(testSpecId, "selected testSpecId");
    const reasons = reasonsByTest.get(testSpecId) ?? new Set();
    reasons.add(reason);
    reasonsByTest.set(testSpecId, reasons);
  };
  for (const id of impact.affectedTestSpecIds ?? []) select(id, "MAPPED_IMPLEMENTATION_CHANGE");
  for (const id of policy.fixedHighRiskTestSpecIds) select(id, "FIXED_HIGH_RISK_SET");
  if (changeSet.complete !== true || (changeSet.warnings ?? []).length > 0) {
    for (const id of policy.conservativeTestSpecIds) select(id, "CONSERVATIVE_FALLBACK");
  }
  const unresolvedTestSpecIds = [...reasonsByTest.keys()].filter((id) => !testSpecsById.has(id)).sort();
  const selectedTests = [...reasonsByTest]
    .filter(([id]) => testSpecsById.has(id))
    .map(([id, reasons]) => {
      const testSpec = testSpecsById.get(id);
      return {
        id: testSpec.id,
        version: testSpec.version,
        featureId: testSpec.featureId,
        name: testSpec.name,
        approved: testSpec.approved === true,
        operationLevel: testSpec.environment?.operationLevel ?? testSpec.operationLevel ?? "UNKNOWN",
        reasons: [...reasons].sort(),
      };
    })
    .sort((left, right) => left.featureId.localeCompare(right.featureId) || left.id.localeCompare(right.id));
  const featureIds = [...new Set([
    ...(impact.affectedFeatureIds ?? []),
    ...selectedTests.map((testSpec) => testSpec.featureId),
    ...policy.highRiskFeatureIds,
  ])].sort();
  const features = featureIds.map((featureId) => {
    const traceability = traceabilityByFeature.get(featureId) ?? null;
    return {
      featureId,
      highRisk: policy.highRiskFeatureIds.includes(featureId),
      available: traceability !== null,
      chainComplete: traceabilityComplete(traceability),
      dimensions: traceability?.dimensions ?? null,
      gaps: structuredClone(traceability?.gaps ?? []),
    };
  });
  const reasons = [];
  const requiredActions = new Set();
  if (changeSet.complete !== true) {
    reasons.push("CHANGESET_INCOMPLETE");
    requiredActions.add("EXPAND_REGRESSION_SCOPE");
    requiredActions.add("REPAIR_FACT_COLLECTION");
  }
  if ((changeSet.warnings ?? []).length > 0) {
    reasons.push("CHANGESET_WARNINGS");
    requiredActions.add("REVIEW_CHANGESET_WARNINGS");
  }
  if (unresolvedTestSpecIds.length > 0) {
    reasons.push("TEST_SPEC_UNRESOLVED");
    requiredActions.add("REPAIR_TEST_CATALOG");
  }
  if (selectedTests.some((testSpec) => !testSpec.approved)) {
    reasons.push("TEST_SPEC_NOT_APPROVED");
    requiredActions.add("APPROVE_SELECTED_TEST_SPECS");
  }
  if (policy.highRiskFeatureIds.some((featureId) =>
    !selectedTests.some((testSpec) => testSpec.featureId === featureId))) {
    reasons.push("HIGH_RISK_TEST_SET_MISSING");
    requiredActions.add("CONFIGURE_HIGH_RISK_REGRESSION_SET");
  }
  if (features.some((feature) => !feature.available)) {
    reasons.push("FEATURE_TRACEABILITY_UNAVAILABLE");
    requiredActions.add("RECOMPUTE_FEATURE_TRACEABILITY");
  }
  if (features.some((feature) => feature.available && !feature.chainComplete)) {
    reasons.push("FEATURE_PROOF_CHAIN_INCOMPLETE");
    requiredActions.add("REPAIR_TRACE_GAPS");
    requiredActions.add("RERUN_SELECTED_TESTS");
  }
  const unknown = reasons.some((reason) => [
    "CHANGESET_INCOMPLETE",
    "CHANGESET_WARNINGS",
    "TEST_SPEC_UNRESOLVED",
    "FEATURE_TRACEABILITY_UNAVAILABLE",
    "HIGH_RISK_TEST_SET_MISSING",
  ].includes(reason));
  const blocked = reasons.some((reason) => ["TEST_SPEC_NOT_APPROVED", "FEATURE_PROOF_CHAIN_INCOMPLETE"].includes(reason));
  const status = unknown ? "UNKNOWN" : blocked ? "BLOCKED" : "PASS";
  const selectionStrategy = changeSet.complete === true && (changeSet.warnings ?? []).length === 0
    ? "TARGETED_UNION_HIGH_RISK"
    : "CONSERVATIVE_UNION";
  const createdAt = input.createdAt ?? clock().toISOString();
  requireIsoTimestamp(createdAt, "createdAt");
  return deepFreeze({
    id: contentId("CONTINUOUS-PROTECTION", { changeSetId: changeSet.id, toSnapshotManifestId: impact.toSnapshotManifestId }),
    projectId: requireNonEmptyString(input.projectId, "projectId"),
    changeSetId: changeSet.id,
    snapshotManifestId: impact.toSnapshotManifestId,
    createdAt,
    regressionPlan: {
      selectionStrategy,
      complete: !unknown,
      selectedTests,
      unresolvedTestSpecIds,
      changeSetWarnings: [...(changeSet.warnings ?? [])],
    },
    featureAssessments: features,
    qualityGate: {
      status,
      policyMode: policy.mode,
      enforcement: enforcementFor(status, policy.mode),
      reasons: [...new Set(reasons)],
      requiredActions: [...requiredActions],
    },
  });
}

export function qualityGateExitCode(assessment) {
  const enforcement = assessment?.qualityGate?.enforcement;
  if (enforcement === "PASS" || enforcement === "WARN") return 0;
  if (enforcement === "FAIL") return 1;
  if (enforcement === "REQUIRE_APPROVAL") return 2;
  throw new TypeError("assessment.qualityGate.enforcement is invalid");
}
