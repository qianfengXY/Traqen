import process from "node:process";

import { TraceabilityApplication } from "../application/traceability-application.js";
import { createTraceabilityHttpServer } from "./http-server.js";
import { MemoryTraceabilityStore } from "../storage/index.js";
import { createReferenceSkillSet, ReverseSkillOrchestrator } from "../skills/index.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}

const runnerId = process.env.RUNNER_ID ?? null;
const runnerSharedSecret = process.env.RUNNER_SHARED_SECRET ?? null;
const scannerId = process.env.SCANNER_ID ?? null;
const scannerSharedSecret = process.env.SCANNER_SHARED_SECRET ?? null;
const skillPublisher = process.env.SKILL_PUBLISHER ?? null;
const skillPublisherSharedSecret = process.env.SKILL_PUBLISHER_SHARED_SECRET ?? null;
const reviewerId = process.env.REVIEWER_ID ?? null;
const reviewerRole = process.env.REVIEWER_ROLE ?? "business-owner";
const reviewerBearerToken = process.env.REVIEWER_BEARER_TOKEN ?? null;
const referenceSkills = createReferenceSkillSet();
const installedSkills = new Map(
  referenceSkills.map(({ adapter }) => [`${adapter.id}\u0000${adapter.version}`, adapter]),
);
const application = new TraceabilityApplication({
  store: new MemoryTraceabilityStore(),
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
    inputContext: { dataClassification: "LOCAL_DEVELOPMENT" },
  }),
  reverseOrchestrator: new ReverseSkillOrchestrator({
    adapters: referenceSkills.map(({ adapter }) => adapter),
  }),
  reviewerResolver: (_projectId, context) => {
    if (!reviewerId) return null;
    if (reviewerBearerToken && context.authorization !== `Bearer ${reviewerBearerToken}`) return null;
    return { actorId: reviewerId, actorRole: reviewerRole };
  },
  reviewPolicyResolver: () => ({
    allowedRoles: [reviewerRole],
    allowedOutcomes: ["CONFIRMED", "EXCEPTION_RECORDED", "REJECTED", "INSUFFICIENT_EVIDENCE", "DEFERRED"],
    allowedDecisionTypes: ["CONFIRMED", "EXCEPTION_RECORDED", "REJECTED", "INSUFFICIENT_EVIDENCE", "DEFERRED", "DEPRECATED"],
  }),
});
const server = createTraceabilityHttpServer({ application });

server.listen(port, host, () => {
  const address = server.address();
  process.stdout.write(`Traqen development API listening on http://${host}:${address.port}\n`);
});

function shutdown(signal) {
  server.close((error) => {
    if (error) {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    }
    process.stdout.write(`Traqen development API stopped after ${signal}\n`);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
