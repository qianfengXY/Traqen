import { TraceabilityApplication } from "../application/traceability-application.js";
import { createReferenceSkillSet, ReverseSkillOrchestrator } from "../skills/index.js";
import { AnalysisAgent, AnalysisModelRegistry, configuredAnalysisModels, createReverseSkillAnalysisAdapter } from "../analysis/index.js";

function commaSeparated(value, fallback = "") {
  return (value ?? fallback).split(",").map((item) => item.trim()).filter(Boolean);
}

function reviewerDirectory(value) {
  if (!value) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("REVIEWER_IDENTITIES_JSON must be valid JSON", { cause: error });
  }
  if (!Array.isArray(parsed)) throw new Error("REVIEWER_IDENTITIES_JSON must be an array");
  return parsed.map((entry, index) => {
    if (
      typeof entry?.token !== "string" || entry.token === "" ||
      typeof entry?.actorId !== "string" || entry.actorId === "" ||
      typeof entry?.actorRole !== "string" || entry.actorRole === ""
    ) {
      throw new Error(`REVIEWER_IDENTITIES_JSON[${index}] requires token, actorId, and actorRole`);
    }
    return { token: entry.token, actorId: entry.actorId, actorRole: entry.actorRole };
  });
}

export function createConfiguredApplication({ store, env = process.env }) {
  if (!store) throw new TypeError("store is required");
  const runnerId = env.RUNNER_ID ?? null;
  const runnerSharedSecret = env.RUNNER_SHARED_SECRET ?? null;
  const scannerId = env.SCANNER_ID ?? null;
  const scannerSharedSecret = env.SCANNER_SHARED_SECRET ?? null;
  const skillPublisher = env.SKILL_PUBLISHER ?? null;
  const skillPublisherSharedSecret = env.SKILL_PUBLISHER_SHARED_SECRET ?? null;
  const reviewerId = env.REVIEWER_ID ?? null;
  const reviewerRole = env.REVIEWER_ROLE ?? "business-owner";
  const reviewerBearerToken = env.REVIEWER_BEARER_TOKEN ?? null;
  const configuredReviewers = reviewerDirectory(env.REVIEWER_IDENTITIES_JSON);
  const implementationReviewerId = env.IMPLEMENTATION_REVIEWER_ID ?? null;
  const implementationReviewerRole = env.IMPLEMENTATION_REVIEWER_ROLE ?? "developer";
  const implementationReviewerBearerToken = env.IMPLEMENTATION_REVIEWER_BEARER_TOKEN ?? null;
  const qualityGateMode = env.QUALITY_GATE_MODE ?? "ADVISORY";
  if (!["ADVISORY", "MANUAL_APPROVAL", "ENFORCED"].includes(qualityGateMode)) {
    throw new Error("QUALITY_GATE_MODE must be ADVISORY, MANUAL_APPROVAL, or ENFORCED");
  }
  const corsAllowedOrigins = commaSeparated(env.CORS_ALLOWED_ORIGINS, "http://localhost:3000");
  const referenceSkills = createReferenceSkillSet();
  const analysisModels = configuredAnalysisModels(env.ANALYSIS_MODEL_PROFILES_JSON, env);
  const analysisModelRegistry = new AnalysisModelRegistry({ adapters: analysisModels });
  const analysisSkills = new Map(referenceSkills.map(({ adapter }) => {
    const analysisAdapter = createReverseSkillAnalysisAdapter(adapter);
    return [`${analysisAdapter.id}\u0000${analysisAdapter.version}`, analysisAdapter];
  }));
  const installedSkills = new Map(
    referenceSkills.map(({ adapter }) => [`${adapter.id}\u0000${adapter.version}`, adapter]),
  );
  const application = new TraceabilityApplication({
    store,
    runnerKeyResolver: (candidateRunnerId) =>
      runnerId && runnerSharedSecret && candidateRunnerId === runnerId ? runnerSharedSecret : null,
    scannerKeyResolver: (candidateScannerId) =>
      scannerId && scannerSharedSecret && candidateScannerId === scannerId ? scannerSharedSecret : null,
    publisherKeyResolver: (candidatePublisher) =>
      skillPublisher && skillPublisherSharedSecret && candidatePublisher === skillPublisher
        ? skillPublisherSharedSecret
        : null,
    installedSkillResolver: (skillId, version) => installedSkills.get(`${skillId}\u0000${version}`) ?? null,
    skillPolicyResolver: () => ({
      allowedSkillIds: referenceSkills.map(({ adapter }) => adapter.id),
      allowedPublishers: ["TRAQEN"],
      maxSkills: 2,
      maxAttempts: 1,
      maxTimeoutMinutes: 1,
      inputContext: { dataClassification: env.DATA_CLASSIFICATION ?? "LOCAL_DEVELOPMENT" },
    }),
    reverseOrchestrator: new ReverseSkillOrchestrator({
      adapters: referenceSkills.map(({ adapter }) => adapter),
    }),
    analysisAgent: new AnalysisAgent({
      repository: store,
      modelResolver: (profileId) => analysisModelRegistry.resolve(profileId),
      skillResolver: (skillId, version) => analysisSkills.get(`${skillId}\u0000${version}`) ?? null,
    }),
    analysisModelRegistry,
    reviewerResolver: (_projectId, context) => {
      if (configuredReviewers.length > 0) {
        const matched = configuredReviewers.find((entry) => context.authorization === `Bearer ${entry.token}`);
        return matched ? { actorId: matched.actorId, actorRole: matched.actorRole } : null;
      }
      if (!reviewerId) return null;
      if (reviewerBearerToken && context.authorization !== `Bearer ${reviewerBearerToken}`) return null;
      return { actorId: reviewerId, actorRole: reviewerRole };
    },
    implementationReviewerResolver: (_projectId, context) => {
      if (!implementationReviewerId) return null;
      if (
        implementationReviewerBearerToken &&
        context.authorization !== `Bearer ${implementationReviewerBearerToken}`
      ) return null;
      return { actorId: implementationReviewerId, actorRole: implementationReviewerRole };
    },
    implementationPolicyResolver: () => ({ allowedRoles: [implementationReviewerRole] }),
    continuousProtectionPolicyResolver: () => ({
      mode: qualityGateMode,
      highRiskFeatureIds: commaSeparated(env.HIGH_RISK_FEATURE_IDS),
      fixedHighRiskTestSpecIds: commaSeparated(env.FIXED_HIGH_RISK_TEST_SPEC_IDS),
      conservativeTestSpecIds: commaSeparated(env.CONSERVATIVE_REGRESSION_TEST_SPEC_IDS),
    }),
    productMetricsPolicyResolver: (_projectId, context) => {
      const configured = commaSeparated(env.HIGH_VALUE_FEATURE_IDS);
      return { highValueFeatureIds: configured.length > 0 ? configured : context.featureIds };
    },
    reviewPolicyResolver: () => ({
      requireDecisionReviewCases: env.ALLOW_DIRECT_DECISIONS !== "true",
      allowedRoles: [reviewerRole],
      allowedOutcomes: ["CONFIRMED", "EXCEPTION_RECORDED", "REJECTED", "INSUFFICIENT_EVIDENCE", "DEFERRED"],
      allowedDecisionTypes: [
        "CONFIRMED",
        "EXCEPTION_RECORDED",
        "REJECTED",
        "INSUFFICIENT_EVIDENCE",
        "DEFERRED",
        "DEPRECATED",
      ],
      allowedTestSpecApproverRoles: [reviewerRole],
      allowedProcessModelRoles: [reviewerRole],
      allowedFeatureGovernanceRoles: [reviewerRole],
      allowedEvidenceLifecycleRoles: commaSeparated(env.EVIDENCE_LIFECYCLE_ROLES, reviewerRole),
      decisionGovernance: {
        proposerRoles: commaSeparated(env.DECISION_PROPOSER_ROLES, reviewerRole),
        approvalRoles: commaSeparated(env.DECISION_APPROVER_ROLES, reviewerRole),
        businessRoles: commaSeparated(env.DECISION_BUSINESS_ROLES, "business-owner"),
        complianceRoles: commaSeparated(env.DECISION_COMPLIANCE_ROLES, "compliance-owner"),
        breakGlassRoles: commaSeparated(env.DECISION_BREAK_GLASS_ROLES, "incident-commander,risk-owner"),
        lifecycleRoles: commaSeparated(env.DECISION_LIFECYCLE_ROLES, "business-owner,compliance-owner,risk-owner"),
        maxBreakGlassMinutes: Number(env.MAX_BREAK_GLASS_MINUTES ?? 60),
      },
    }),
  });
  return { application, corsAllowedOrigins };
}
