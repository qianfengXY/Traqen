import { contentId, deepFreeze } from "../domain/index.js";

function contains(values, required) {
  return Array.isArray(values) && (values.includes(required) || values.includes("*"));
}

function eligible(profile, skill, request) {
  const reasons = [];
  if (profile.verificationStatus !== "VERIFIED") reasons.push("MODEL_REVISION_UNVERIFIED");
  if (!contains(profile.roles, request.role)) reasons.push("ROLE_UNSUPPORTED");
  if (!contains(profile.languages, request.language)) reasons.push("LANGUAGE_UNSUPPORTED");
  if (!contains(profile.artifactKinds, request.artifactKind)) reasons.push("ARTIFACT_UNSUPPORTED");
  if (!contains(profile.dataBoundaryClasses, request.dataBoundaryClass)) reasons.push("DATA_BOUNDARY_MISMATCH");
  if (profile.maxContextTokens < request.contextTokens) reasons.push("CONTEXT_TOO_SMALL");
  if (profile.qualityTierByRole?.[request.role] !== request.qualityTier) reasons.push("QUALITY_TIER_MISMATCH");
  if (!skill || skill.status !== "ACTIVE") reasons.push("SKILL_INACTIVE");
  if (skill && !contains(skill.roles, request.role)) reasons.push("SKILL_ROLE_UNSUPPORTED");
  if (skill && !contains(skill.languages, request.language)) reasons.push("SKILL_LANGUAGE_UNSUPPORTED");
  if (skill?.inputMode === "FACT_DEPENDENT" && !request.factBundleAvailable) reasons.push("FACT_BUNDLE_REQUIRED");
  return reasons;
}

export function routeAnalysisWorkUnit(input, clock = () => new Date()) {
  const candidates = [];
  for (const profile of input.modelCapabilityProfiles ?? []) {
    for (const skill of input.skills ?? []) {
      const rejectionReasons = eligible(profile, skill, input.request);
      candidates.push({
        modelCapabilityProfileId: profile.id,
        modelRevision: profile.modelRevision,
        skillId: skill.id,
        skillVersion: skill.version,
        independenceGroup: profile.independenceGroup,
        eligible: rejectionReasons.length === 0,
        rejectionReasons,
        costClass: profile.costClass,
      });
    }
  }
  const selectable = candidates.filter(({ eligible }) => eligible)
    .sort((left, right) => left.costClass.localeCompare(right.costClass)
      || left.modelCapabilityProfileId.localeCompare(right.modelCapabilityProfileId)
      || left.skillId.localeCompare(right.skillId));
  const primary = selectable[0] ?? null;
  const redundant = input.request.redundancyRequired && primary
    ? selectable.find(({ independenceGroup }) => independenceGroup !== primary.independenceGroup) ?? null
    : null;
  const status = primary && (!input.request.redundancyRequired || redundant)
    ? "ROUTED"
    : primary ? "ROUTED_WITH_GAP" : "NO_ELIGIBLE_PRODUCER";
  const identity = {
    projectId: input.projectId,
    analysisRunId: input.analysisRunId,
    workUnitId: input.workUnitId,
    request: input.request,
    candidates,
    selected: [primary, redundant].filter(Boolean),
  };
  return deepFreeze({
    id: contentId("ANALYSIS-ROUTE-DECISION", identity),
    ...identity,
    status,
    gap: status === "ROUTED" ? null : {
      code: status === "NO_ELIGIBLE_PRODUCER" ? "NO_ELIGIBLE_PRODUCER" : "INDEPENDENT_CRITIC_UNAVAILABLE",
    },
    decidedAt: clock().toISOString(),
  });
}

export function shouldUseIndependentCritic({ risk, confidence, conflict, challengeSample }) {
  return risk === "HIGH" || confidence === "LOW" || conflict === true || challengeSample === true;
}
