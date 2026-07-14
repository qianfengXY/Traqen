import { TraceabilityApplication } from "../application/traceability-application.js";
import { createReferenceSkillSet, ReverseSkillOrchestrator } from "../skills/index.js";

function commaSeparated(value, fallback = "") {
  return (value ?? fallback).split(",").map((item) => item.trim()).filter(Boolean);
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
  const implementationReviewerId = env.IMPLEMENTATION_REVIEWER_ID ?? null;
  const implementationReviewerRole = env.IMPLEMENTATION_REVIEWER_ROLE ?? "developer";
  const implementationReviewerBearerToken = env.IMPLEMENTATION_REVIEWER_BEARER_TOKEN ?? null;
  const corsAllowedOrigins = commaSeparated(env.CORS_ALLOWED_ORIGINS, "http://localhost:3000");
  const referenceSkills = createReferenceSkillSet();
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
    reviewerResolver: (_projectId, context) => {
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
    reviewPolicyResolver: () => ({
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
    }),
  });
  return { application, corsAllowedOrigins };
}
