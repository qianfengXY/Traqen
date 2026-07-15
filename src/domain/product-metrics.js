import { deepFreeze } from "./canonical-json.js";
import { requireIsoTimestamp, requireNonEmptyString } from "./model.js";

function rate(numerator, denominator) {
  return { numerator, denominator, ratio: denominator === 0 ? null : numerator / denominator };
}

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

function isConfirmed(decision) {
  return ["CONFIRMED", "EXCEPTION_RECORDED"].includes(decision?.type);
}

function chainComplete(traceability) {
  return (traceability.traceChains ?? []).length > 0 &&
    traceability.traceChains.every((chain) => chain.complete === true) &&
    (traceability.gaps ?? []).length === 0;
}

function featureCoverage(traceability) {
  const claims = traceability.claims ?? [];
  const facts = claims.flatMap((item) => item.facts?.nodes ?? []);
  const testSpecs = claims.flatMap((item) => item.testSpecs ?? []);
  return {
    product: Boolean(traceability.feature),
    rules: claims.length > 0,
    implementation: facts.length > 0,
    data: facts.some((fact) => fact.type === "DATA_OBJECT"),
    configuration: facts.some((fact) => fact.type === "CONFIGURATION"),
    tests: testSpecs.some((testSpec) => testSpec.approved === true),
    assertions: testSpecs.some((testSpec) => (testSpec.assertions ?? []).length > 0),
    execution: claims.some((item) => item.execution !== null),
    evidence: claims.some((item) => (item.evidence ?? []).some((evidence) => evidence.integrity === "VERIFIED")),
  };
}

export function createProductEffectivenessMetrics(input, clock = () => new Date()) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("product metrics input must be an object");
  }
  if (!Array.isArray(input.traceabilities)) throw new TypeError("traceabilities must be an array");
  const projectId = requireNonEmptyString(input.projectId, "projectId");
  const snapshotManifestId = requireNonEmptyString(input.snapshotManifestId, "snapshotManifestId");
  const computedAt = input.computedAt ?? clock().toISOString();
  requireIsoTimestamp(computedAt, "computedAt");
  if (input.highValueFeatureIds !== undefined && !Array.isArray(input.highValueFeatureIds)) {
    throw new TypeError("highValueFeatureIds must be an array");
  }
  const highValueIds = new Set(
    (input.highValueFeatureIds ?? input.traceabilities.map((item) => item.feature.id))
      .map((featureId, index) => requireNonEmptyString(featureId, `highValueFeatureIds[${index}]`)),
  );
  const gapTypes = {};
  const gapSeverities = {};
  const gapOwners = {};
  const evidenceFreshness = { FRESH: 0, EXPIRING: 0, STALE: 0, INCOMPLETE: 0, UNKNOWN: 0 };
  let confirmedClaims = 0;
  let totalClaims = 0;
  let coveredConfirmedClaims = 0;
  let totalAssertions = 0;
  let meaningfulAssertions = 0;
  const countedAssertions = new Set();
  const features = input.traceabilities.map((traceability) => {
    const featureId = requireNonEmptyString(traceability.feature?.id, "traceability.feature.id");
    for (const gap of traceability.gaps ?? []) {
      increment(gapTypes, gap.type ?? "UNKNOWN");
      increment(gapSeverities, gap.severity ?? "UNKNOWN");
      increment(gapOwners, gap.ownerRole ?? "UNASSIGNED");
    }
    for (const item of traceability.dimensions?.freshness ?? []) {
      increment(evidenceFreshness, Object.hasOwn(evidenceFreshness, item.status) ? item.status : "UNKNOWN");
    }
    for (const claimView of traceability.claims ?? []) {
      totalClaims += 1;
      const confirmed = isConfirmed(claimView.latestDecision);
      if (confirmed) confirmedClaims += 1;
      const approvedSpecs = (claimView.testSpecs ?? []).filter((testSpec) => testSpec.approved === true);
      if (confirmed && approvedSpecs.length > 0) coveredConfirmedClaims += 1;
      for (const testSpec of approvedSpecs) {
        for (const [index, assertion] of (testSpec.assertions ?? []).entries()) {
          const assertionKey = `${testSpec.id ?? testSpec.name}\u0000${testSpec.version ?? 1}\u0000${assertion.id ?? index}`;
          if (countedAssertions.has(assertionKey)) continue;
          countedAssertions.add(assertionKey);
          totalAssertions += 1;
          if (!["HTTP_STATUS", "EXISTING_TEST_EXIT_CODE"].includes(assertion.type)) meaningfulAssertions += 1;
        }
      }
    }
    return {
      featureId,
      name: traceability.feature.name,
      highValue: highValueIds.has(featureId),
      chainComplete: chainComplete(traceability),
      dimensions: structuredClone(traceability.dimensions ?? {}),
      coverage: featureCoverage(traceability),
      openGapCount: (traceability.gaps ?? []).length,
    };
  }).sort((left, right) => left.featureId.localeCompare(right.featureId));
  const highValueFeatures = features.filter((feature) => feature.highValue);
  const governedFeatureIds = new Set(features.map((feature) => feature.featureId));
  const missingHighValueFeatureIds = [...highValueIds].filter((featureId) => !governedFeatureIds.has(featureId));
  return deepFreeze({
    projectId,
    snapshotManifestId,
    computedAt,
    highValueValidTraceChainRate: rate(
      highValueFeatures.filter((feature) => feature.chainComplete).length,
      highValueFeatures.length,
    ),
    claimConfirmationRate: rate(confirmedClaims, totalClaims),
    confirmedRuleTestCoverageRate: rate(coveredConfirmedClaims, confirmedClaims),
    meaningfulAssertionRate: rate(meaningfulAssertions, totalAssertions),
    evidenceFreshness,
    gapBreakdown: { byType: gapTypes, bySeverity: gapSeverities, byOwnerRole: gapOwners },
    features,
    unavailableMetrics: [
      ...missingHighValueFeatureIds.map((featureId) => ({
        metric: `HIGH_VALUE_FEATURE_NOT_GOVERNED:${featureId}`,
        reason: "Configured high-value Feature does not have a governed Feature record in this project.",
      })),
      { metric: "TRACE_GAP_REPAIR_CYCLE", reason: "Requires longitudinal persisted gap-open and gap-close events." },
      { metric: "CHANGE_RECOVERY_TIME", reason: "Requires deployment/change event timestamps from the adopting CI/CD system." },
      { metric: "DEFECT_ESCAPE_RATE", reason: "Requires an external defect-management outcome feed." },
    ],
  });
}
