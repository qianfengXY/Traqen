import { readFileSync } from "node:fs";

import { TraceabilityApplication } from "../application/traceability-application.js";
import { createReferenceSkillSet, ReverseSkillOrchestrator } from "../skills/index.js";
import { AnalysisAgent, AnalysisModelRegistry, configuredAnalysisModels, createReverseSkillAnalysisAdapter, defaultAnalysisModelProfileStorePath, EncryptedAnalysisModelProfileStore } from "../analysis/index.js";
import { createLocalSourceSnapshotBroker } from "../application/local-source-snapshot-broker.js";
import { LegacyUnderstandingRuntime } from "../application/legacy-understanding-runtime.js";
import { createReviewedUnderstandingEvaluationResolver } from "../application/reviewed-understanding-evaluation.js";
import { SourceSliceWorkerCredentialService } from "../application/source-slice-worker-credential.js";

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

function loadRunEvidence(filePath, job, label) {
  const document = JSON.parse(readFileSync(filePath, "utf8"));
  const records = Array.isArray(document) ? document : document.records;
  if (!Array.isArray(records)) throw new TypeError(`${label} evidence file must contain a records array`);
  const record = records.find((item) => item.analysisRunId === job.id
    && item.snapshotManifestId === job.snapshotManifestId);
  if (!record) throw new TypeError(`${label} evidence is unavailable for analysis run ${job.id}`);
  return record;
}

export function createConfiguredApplication({
  store,
  env = process.env,
  workspaceMcpExecutor = null,
  developmentUnderstanding = null,
}) {
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
  const analysisModelStorePath = env.ANALYSIS_MODEL_STORE_PATH ?? (env === process.env ? defaultAnalysisModelProfileStorePath() : null);
  const analysisModelRegistry = new AnalysisModelRegistry({
    adapters: analysisModels,
    profileStore: analysisModelStorePath ? new EncryptedAnalysisModelProfileStore({ filePath: analysisModelStorePath }) : null,
  });
  const analysisSkills = new Map(referenceSkills.map(({ adapter }) => {
    const analysisAdapter = createReverseSkillAnalysisAdapter(adapter);
    return [`${analysisAdapter.id}\u0000${analysisAdapter.version}`, analysisAdapter];
  }));
  const installedSkills = new Map(
    referenceSkills.map(({ adapter }) => [`${adapter.id}\u0000${adapter.version}`, adapter]),
  );
  const sourceSliceBroker = env.SOURCE_SNAPSHOT_ROOT
    ? createLocalSourceSnapshotBroker({ store, snapshotRoot: env.SOURCE_SNAPSHOT_ROOT })
    : null;
  const sourceSliceWorkerCredentialService = env.SOURCE_SLICE_WORKER_CREDENTIAL_SECRET
    ? new SourceSliceWorkerCredentialService({ secret: env.SOURCE_SLICE_WORKER_CREDENTIAL_SECRET })
    : null;
  const allowedWorkspaceRoots = commaSeparated(env.TRAQEN_ALLOWED_WORKSPACE_ROOTS);
  if (Boolean(env.UNDERSTANDING_TRUTH_SET_PATH) !== Boolean(env.UNDERSTANDING_REVIEWED_MEASUREMENTS_PATH)) {
    throw new Error("UNDERSTANDING_TRUTH_SET_PATH and UNDERSTANDING_REVIEWED_MEASUREMENTS_PATH must be configured together");
  }
  if (!developmentUnderstanding && sourceSliceBroker && allowedWorkspaceRoots.length > 0
    && (!env.UNDERSTANDING_TRUTH_SET_PATH
      || !env.UNDERSTANDING_REVIEWED_MEASUREMENTS_PATH
      || !env.UNDERSTANDING_EQUIVALENCE_EVIDENCE_PATH)) {
    throw new Error("server-owned source analysis requires Truth Set, reviewed measurement, and equivalence evidence paths");
  }
  const measurementResolver = env.UNDERSTANDING_REVIEWED_MEASUREMENTS_PATH
    ? async ({ job }) => loadRunEvidence(
      env.UNDERSTANDING_REVIEWED_MEASUREMENTS_PATH,
      job,
      "reviewed measurement",
    )
    : null;
  const reviewedEvaluationResolver = env.UNDERSTANDING_TRUTH_SET_PATH && measurementResolver
    ? createReviewedUnderstandingEvaluationResolver({
        truthSet: JSON.parse(readFileSync(env.UNDERSTANDING_TRUTH_SET_PATH, "utf8")),
        reviewerId: env.UNDERSTANDING_TRUTH_SET_REVIEWER_ID ?? "INDEPENDENT-TRUTH-SET-REVIEWER",
        implementationAuthorId: env.UNDERSTANDING_IMPLEMENTATION_AUTHOR_ID ?? "TRAQEN-RUNTIME",
        measurementResolver,
      })
    : null;
  const equivalenceResolver = env.UNDERSTANDING_EQUIVALENCE_EVIDENCE_PATH
    ? async ({ job }) => loadRunEvidence(
      env.UNDERSTANDING_EQUIVALENCE_EVIDENCE_PATH,
      job,
      "equivalence",
    )
    : null;
  const legacyUnderstandingRuntime = sourceSliceBroker && allowedWorkspaceRoots.length > 0
    ? new LegacyUnderstandingRuntime({
      store,
      sourceSliceBroker,
      snapshotRoot: env.SOURCE_SNAPSHOT_ROOT,
      allowlistedRoots: allowedWorkspaceRoots,
      childProducer: developmentUnderstanding?.childProducer ?? (async ({ job, assignment, executionProfile, artifact, facts, sourceSlices, candidate, secretGrants }) => {
        const modelEntry = executionProfile.entries?.find((item) =>
          item.kind === "MODEL" && item.logicalName === assignment.route.model);
        if (!modelEntry) {
          return { gap: { code: "NO_ELIGIBLE_PRODUCER", message: `Pinned model ${assignment.route.model} is absent from the immutable profile` } };
        }
        const grant = secretGrants.find((candidateGrant) => candidateGrant.capabilityKind === "MODEL"
          && candidateGrant.capabilityName === assignment.route.model);
        const adapter = analysisModelRegistry.resolve(assignment.route.model, {
          grant,
          workspaceId: job.projectId,
          profileId: executionProfile.id,
          analysisRunId: job.id,
          slotId: assignment.slotId,
        });
        if (!adapter) {
          return {
            gap: {
              code: "NO_ELIGIBLE_PRODUCER",
              message: `Pinned model ${assignment.route.model} is not configured and verified`,
            },
          };
        }
        if (modelEntry.manifest?.model && adapter.model !== modelEntry.manifest.model) {
          return { gap: { code: "PINNED_PRODUCER_DRIFT", message: `Pinned model ${assignment.route.model} revision does not match the mounted adapter` } };
        }
        const modelOutput = await adapter.analyze({
          workUnit: {
            id: assignment.id,
            projectId: job.projectId,
            snapshotManifestId: job.snapshotManifestId,
            analysisRunId: job.id,
            factIds: facts.map(({ id }) => id),
            rootFactIds: facts.slice(0, 1).map(({ id }) => id),
          },
          workContext: {
            scopeKey: artifact.relativePath,
            rootNodeId: facts[0]?.id ?? artifact.id,
            inputDigest: assignment.inputDigest,
            estimatedTokens: Math.min(12_000, Math.ceil(JSON.stringify(sourceSlices).length / 4)),
          },
          deterministicCandidates: [{
            candidateKey: candidate.id,
            mode: "BUSINESS",
            name: candidate.proposal.name,
            description: candidate.proposal.statement,
            confidence: candidate.confidence,
            evidenceFactIds: candidate.evidenceFactIds,
            stableEvidenceNodeIds: candidate.evidenceFactIds,
          }],
          evidence: {
            facts,
            sourceSlices: sourceSlices.map(({ id, artifactSlices }) => ({
              id,
              excerpts: artifactSlices.map(({ redactedText }) => redactedText),
            })),
          },
          context: { maxOutputTokens: 2_048 },
        });
        const producerOutputs = [{
          kind: "MODEL",
          logicalName: assignment.route.model,
          output: modelOutput,
        }];
        for (const skillName of assignment.route.skillNames) {
          const entry = executionProfile.entries?.find((item) => item.kind === "SKILL" && item.logicalName === skillName);
          const adapterId = entry?.manifest?.adapterId ?? entry?.manifest?.id ?? entry?.manifest?.skillId ?? skillName;
          const adapterVersion = entry?.manifest?.version ?? entry?.manifest?.skillVersion ?? null;
          const skillAdapter = adapterVersion
            ? analysisSkills.get(`${adapterId}\u0000${adapterVersion}`)
            : [...analysisSkills.values()].find(({ id }) => id === adapterId);
          if (!skillAdapter) {
            return { gap: { code: "NO_ELIGIBLE_PRODUCER", message: `Pinned Skill ${skillName} is unavailable` } };
          }
          producerOutputs.push({
            kind: "SKILL",
            logicalName: skillName,
            output: await skillAdapter.analyze({
              request: {
                projectId: job.projectId,
                snapshotManifestId: job.snapshotManifestId,
                sourceComponentId: job.snapshotManifestId,
              },
              workUnit: {
                id: assignment.id,
                projectId: job.projectId,
                snapshotManifestId: job.snapshotManifestId,
                analysisRunId: job.id,
              },
              workContext: {
                scopeKey: artifact.relativePath,
                inputDigest: assignment.inputDigest,
              },
              evidence: {
                nodes: facts.map((fact) => ({ ...fact, id: fact.id, factId: fact.id })),
                edges: [],
              },
            }),
          });
        }
        for (const mcpName of assignment.route.mcpNames) {
          if (typeof workspaceMcpExecutor !== "function") {
            return { gap: { code: "NO_ELIGIBLE_PRODUCER", message: `Pinned MCP ${mcpName} has no mounted executor` } };
          }
          producerOutputs.push({
            kind: "MCP",
            logicalName: mcpName,
            output: await workspaceMcpExecutor({
              workspaceId: job.projectId,
              analysisRunId: job.id,
              assignment: structuredClone(assignment),
              capability: executionProfile.entries?.find((item) => item.kind === "MCP" && item.logicalName === mcpName),
              artifact: { id: artifact.id, relativePath: artifact.relativePath },
              facts: structuredClone(facts),
            }),
          });
        }
        const candidates = producerOutputs.flatMap(({ output }) => output.candidates ?? output.candidateFeatures ?? []);
        return candidates.length > 0
          ? { candidates, producerOutputs: producerOutputs.map(({ kind, logicalName }) => ({ kind, logicalName })) }
          : { gap: { code: "PRODUCER_RETURNED_NO_CANDIDATE", message: "Configured producers returned no candidates" } };
      }),
      mainProducer: developmentUnderstanding?.mainProducer ?? (async ({ job, batch, route, executionProfile, workUnit, artifact, facts, candidateOptions, contextCandidates, scopedArtifacts, secretGrants }) => {
        const modelEntry = executionProfile.entries?.find((item) =>
          item.kind === "MODEL" && item.logicalName === route.model);
        const grant = secretGrants.find((candidateGrant) => candidateGrant.capabilityKind === "MODEL"
          && candidateGrant.capabilityName === route.model);
        const adapter = modelEntry ? analysisModelRegistry.resolve(route.model, {
          grant,
          workspaceId: job.projectId,
          profileId: executionProfile.id,
          analysisRunId: job.id,
          slotId: "MAIN",
        }) : null;
        if (!modelEntry || !adapter) throw new TypeError(`Pinned Main model ${route.model} is unavailable`);
        if (modelEntry.manifest?.model && adapter.model !== modelEntry.manifest.model) {
          throw new TypeError(`Pinned Main model ${route.model} revision drifted`);
        }
        if (typeof adapter.reconcile !== "function") {
          throw new TypeError(`Pinned Main model ${route.model} does not implement reconciliation`);
        }
        const mainModelOutput = await adapter.reconcile({
          workUnit: {
            id: `${batch.id}:MAIN`,
            projectId: job.projectId,
            snapshotManifestId: job.snapshotManifestId,
            analysisRunId: job.id,
            factIds: facts.map(({ id }) => id),
            rootFactIds: facts.slice(0, 1).map(({ id }) => id),
          },
          workContext: {
            scopeKey: artifact?.relativePath ?? workUnit.id,
            rootNodeId: facts[0]?.id ?? artifact?.id ?? workUnit.id,
            inputDigest: batch.inputDigest,
            estimatedTokens: Math.min(12_000, Math.ceil(JSON.stringify(candidateOptions).length / 4)),
          },
          candidateOptions: structuredClone(candidateOptions),
          contextCandidates: structuredClone(contextCandidates),
          scopedArtifacts: structuredClone(scopedArtifacts),
          evidence: { facts, sourceSlices: [] },
          context: { maxOutputTokens: 2_048 },
        });
        const executedCapabilities = [{ kind: "MODEL", logicalName: route.model }];
        for (const skillName of route.skillNames) {
          const entry = executionProfile.entries?.find((item) => item.kind === "SKILL" && item.logicalName === skillName);
          const adapterId = entry?.manifest?.adapterId ?? entry?.manifest?.id ?? entry?.manifest?.skillId ?? skillName;
          const adapterVersion = entry?.manifest?.version ?? entry?.manifest?.skillVersion ?? null;
          const skillAdapter = adapterVersion
            ? analysisSkills.get(`${adapterId}\u0000${adapterVersion}`)
            : [...analysisSkills.values()].find(({ id }) => id === adapterId);
          if (!skillAdapter) throw new TypeError(`Pinned Main Skill ${skillName} is unavailable`);
          await skillAdapter.analyze({
            request: { projectId: job.projectId, snapshotManifestId: job.snapshotManifestId, sourceComponentId: job.snapshotManifestId },
            workUnit: { id: `${batch.id}:MAIN`, projectId: job.projectId, snapshotManifestId: job.snapshotManifestId, analysisRunId: job.id },
            workContext: { scopeKey: artifact?.relativePath ?? workUnit.id, inputDigest: batch.inputDigest },
            evidence: { nodes: facts.map((fact) => ({ ...fact, factId: fact.id })), edges: [] },
          });
          executedCapabilities.push({ kind: "SKILL", logicalName: skillName });
        }
        for (const mcpName of route.mcpNames) {
          if (typeof workspaceMcpExecutor !== "function") throw new TypeError(`Pinned Main MCP ${mcpName} is unavailable`);
          await workspaceMcpExecutor({
            workspaceId: job.projectId,
            analysisRunId: job.id,
            assignment: { id: `${batch.id}:MAIN`, route, sourceScope: batch.sourceScope },
            capability: executionProfile.entries?.find((item) => item.kind === "MCP" && item.logicalName === mcpName),
            artifact: artifact ? { id: artifact.id, relativePath: artifact.relativePath } : null,
            facts: structuredClone(facts),
            childCandidates: structuredClone(candidateOptions),
          });
          executedCapabilities.push({ kind: "MCP", logicalName: mcpName });
        }
        return {
          candidateDecisions: mainModelOutput.candidateDecisions,
          relations: mainModelOutput.relations ?? [],
          gaps: mainModelOutput.gaps ?? [],
          executedCapabilities,
        };
      }),
      reviewedEvaluationResolver: developmentUnderstanding?.reviewedEvaluationResolver ?? reviewedEvaluationResolver,
      equivalenceResolver: developmentUnderstanding?.equivalenceResolver ?? equivalenceResolver,
      implementationAuthorId: developmentUnderstanding?.implementationAuthorId ?? "TRAQEN-RUNTIME",
      runnerId: developmentUnderstanding?.runnerId ?? "TRAQEN-SERVER-RUNNER",
      publicationMetadata: developmentUnderstanding?.publicationMetadata ?? null,
      registerIssuedSecretGrants: (grants) => analysisModelRegistry.registerIssuedSecretGrants(grants),
      revokeIssuedSecretGrants: ({ analysisRunId }) => analysisModelRegistry.revokeIssuedSecretGrants({ analysisRunId }),
    })
    : null;
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
      // The generic AnalysisAgent surface may run deterministic work only. Model execution is
      // owned by LegacyUnderstandingRuntime, which resolves a pinned Workspace profile and scoped
      // Run/slot grants before mounting an adapter.
      modelResolver: () => null,
      skillResolver: (skillId, version) => analysisSkills.get(`${skillId}\u0000${version}`) ?? null,
    }),
    analysisModelRegistry,
    sourceSliceBroker,
    sourceSliceWorkerCredentialService,
    legacyUnderstandingRuntime,
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
  const ready = application.hydrateGlobalModelProfiles()
    .then(() => legacyUnderstandingRuntime ? legacyUnderstandingRuntime.recover() : undefined);
  return { application, corsAllowedOrigins, ready };
}
