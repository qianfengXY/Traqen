#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TraceabilityApplication } from "../application/traceability-application.js";
import {
  createSnapshotManifest,
  signFactBundle,
  signReverseSkillManifest,
} from "../domain/index.js";
import {
  ControlledRunner,
  DatabaseExecutor,
  FixtureLifecycleExecutor,
  HttpExecutor,
  runnerPolicyHash,
  signRunnerTask,
} from "../runner/index.js";
import {
  GitDiffAnalyzer,
  JavaScriptProjectScanner,
  correlateGitDiffWithFactChanges,
} from "../scanner/index.js";
import { createReferenceSkillSet, ReverseSkillOrchestrator } from "../skills/index.js";
import { MemoryTraceabilityStore } from "../storage/index.js";
import { createOrderPlatformEnvironment } from "../../examples/order-platform/src/environment.js";
import {
  describeOrderPlatformArtifact,
  startOrderPlatform,
} from "../../examples/order-platform/src/server.js";

const projectId = "ORDER-PILOT";
const featureId = "FEATURE-ORDER-SUBMIT";
const claimId = "CLAIM-ORDER-SUBMIT-ENDPOINT";
const scannerSecret = "order-pilot-scanner-secret";
const publisherSecret = "order-pilot-publisher-secret";
const runnerSecret = "order-pilot-runner-secret";
const referenceRoot = fileURLToPath(new URL("../../examples/order-platform", import.meta.url));
const execFile = promisify(execFileCallback);
let currentTime = Date.parse("2026-07-14T08:00:00.000Z");
const clock = () => new Date(currentTime);
const advance = (milliseconds) => { currentTime += milliseconds; };

function digestSuffix(digest) {
  return digest.replace(/^sha256:/, "").slice(0, 16).toUpperCase();
}

function snapshot({ sourceDigest, artifact, runtime }) {
  const observedTo = new Date(currentTime).toISOString();
  const observedFrom = new Date(currentTime - 60_000).toISOString();
  return createSnapshotManifest({
    source: { id: `SOURCE-ORDER-${digestSuffix(sourceDigest)}`, digest: sourceDigest },
    build: { id: `BUILD-${artifact.id}`, digest: artifact.digest },
    deployment: { id: `DEPLOY-${artifact.id}`, digest: artifact.digest },
    runtime,
    observedFrom,
    observedTo,
    failedSources: [],
  }, clock);
}

function candidateFor(run) {
  const candidate = run.mergedOutput.candidateClaims.find(
    (item) => item.subjectKey === "endpoint:POST /orders/{id}/submit",
  );
  if (!candidate) throw new Error("Reference Reverse Run did not produce the submit-order endpoint candidate");
  return candidate;
}

function featureComplete(traceability) {
  return traceability.gaps.length === 0 &&
    traceability.traceChains.length > 0 &&
    traceability.traceChains.every((chain) => chain.complete === true);
}

function runnerTask({ executionId, testSpec, snapshotManifest, targetPolicy }) {
  const issuedAt = new Date(currentTime - 30_000).toISOString();
  const expiresAt = new Date(currentTime + 4 * 60_000).toISOString();
  return signRunnerTask({
    id: `TASK-${executionId}`,
    projectId,
    executionId,
    runnerId: "RUNNER-ORDER-PILOT",
    nonce: `NONCE-${executionId}`,
    policyHash: runnerPolicyHash(targetPolicy),
    issuedAt,
    expiresAt,
    testSpec,
    snapshotManifest,
  }, runnerSecret);
}

function governedOrderProcessModel({ version, snapshotManifestId, factBundle }) {
  const requireFact = (predicate, label) => {
    const fact = factBundle.nodes.find(predicate);
    if (!fact) throw new Error(`Reference scan did not expose the ${label} Fact required by the business process model`);
    return { snapshotManifestId, factId: fact.factId };
  };
  const endpoint = requireFact(
    (node) => node.type === "ENDPOINT" && node.name.includes("POST") && node.name.includes("submit"),
    "submit Endpoint",
  );
  const stateTransition = requireFact(
    (node) => node.attributes?.kind === "state-transition" && node.attributes?.toState === "SUBMITTED",
    "SUBMITTED state transition",
  );
  const stateGuard = requireFact(
    (node) => node.attributes?.kind === "condition-branch" && node.attributes?.classifications?.includes("STATE_GUARD"),
    "state guard",
  );
  const exceptionPath = requireFact(
    (node) => node.attributes?.kind === "exception-path",
    "exception path",
  );
  return {
    id: "PROCESS-ORDER-SUBMIT",
    version,
    featureVersion: 1,
    name: "Submit order lifecycle",
    description: "Authorized customer flow with explicit success and rejection outcomes.",
    actors: [{
      id: "ACTOR-ORDER-CUSTOMER",
      name: "Order customer",
      role: "customer",
      responsibilities: ["Own the order", "Request submission"],
    }],
    states: [
      { id: "STATE-ORDER-DRAFT", name: "Draft", kind: "INITIAL" },
      { id: "STATE-ORDER-SUBMITTED", name: "Submitted", kind: "TERMINAL" },
      { id: "STATE-ORDER-REJECTED", name: "Submission rejected", kind: "EXCEPTION" },
    ],
    transitions: [
      {
        id: "TRANSITION-ORDER-SUBMIT",
        name: "Submit draft order",
        fromStateId: "STATE-ORDER-DRAFT",
        toStateId: "STATE-ORDER-SUBMITTED",
        trigger: "POST /orders/{id}/submit",
        actorIds: ["ACTOR-ORDER-CUSTOMER"],
        guards: ["The actor owns the order", "The order is DRAFT", "Submission is enabled"],
        implementationFactRefs: [endpoint, stateGuard, stateTransition],
      },
      {
        id: "TRANSITION-ORDER-REJECT",
        name: "Reject invalid submission",
        fromStateId: "STATE-ORDER-DRAFT",
        toStateId: "STATE-ORDER-REJECTED",
        trigger: "A guard or dependency rejects the request",
        actorIds: ["ACTOR-ORDER-CUSTOMER"],
        exception: "The order remains DRAFT and an explicit failure is returned.",
        implementationFactRefs: [stateGuard, exceptionPath],
      },
    ],
    designElements: [{
      id: "DESIGN-ORDER-SUBMIT-TRANSACTION",
      name: "Atomic order submission",
      type: "TRANSACTION",
      description: "Persist state and idempotency outcome as one controlled operation.",
      implementationFactRefs: [endpoint, stateTransition],
    }],
    authority: {
      rationale: "The product owner confirms the customer, guards, state changes, and rejection semantics.",
      decisionRefs: ["DECISION-ORDER-SUBMIT"],
    },
  };
}

async function main() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "traqen-order-pilot-"));
  const changedRoot = path.join(temporaryRoot, "order-platform");
  const store = new MemoryTraceabilityStore();
  const referenceSkills = createReferenceSkillSet();
  const installed = new Map(
    referenceSkills.map(({ adapter }) => [`${adapter.id}\u0000${adapter.version}`, adapter]),
  );
  const application = new TraceabilityApplication({
    store,
    clock,
    scannerKeyResolver: (scannerId) => scannerId === "javascript-node-scanner" ? scannerSecret : null,
    publisherKeyResolver: (publisher) => publisher === "TRAQEN" ? publisherSecret : null,
    installedSkillResolver: (skillId, version) => installed.get(`${skillId}\u0000${version}`) ?? null,
    skillPolicyResolver: () => ({
      allowedSkillIds: referenceSkills.map(({ adapter }) => adapter.id),
      allowedPublishers: ["TRAQEN"],
      maxSkills: 2,
      maxAttempts: 1,
      maxInputNodes: 1_000,
      inputContext: { dataClassification: "SYNTHETIC_REFERENCE" },
    }),
    reverseOrchestrator: new ReverseSkillOrchestrator({
      adapters: referenceSkills.map(({ adapter }) => adapter),
      clock,
    }),
    reviewerResolver: () => ({ actorId: "PRODUCT-OWNER-ORDER", actorRole: "business-owner" }),
    reviewPolicyResolver: () => ({
      allowedRoles: ["business-owner"],
      allowedOutcomes: ["CONFIRMED", "EXCEPTION_RECORDED", "REJECTED", "INSUFFICIENT_EVIDENCE", "DEFERRED"],
      allowedTestSpecApproverRoles: ["business-owner"],
      allowedProcessModelRoles: ["business-owner"],
      allowedFeatureGovernanceRoles: ["business-owner"],
    }),
    implementationReviewerResolver: () => ({ actorId: "DEVELOPER-ORDER", actorRole: "developer" }),
    implementationPolicyResolver: () => ({ allowedRoles: ["developer"] }),
    runnerKeyResolver: (runnerId) => runnerId === "RUNNER-ORDER-PILOT" ? runnerSecret : null,
  });
  const scanner = new JavaScriptProjectScanner({ clock });
  const environment = await createOrderPlatformEnvironment();
  let platform = null;
  try {
    for (const item of referenceSkills) {
      await application.registerReverseSkill({
        ...signReverseSkillManifest(item.manifest, publisherSecret),
        status: "ALLOWED",
      });
    }

    const firstFingerprint = await scanner.fingerprint({ rootPath: referenceRoot });
    const firstArtifact = await describeOrderPlatformArtifact();
    const firstSnapshot = snapshot({
      sourceDigest: firstFingerprint.sourceDigest,
      artifact: firstArtifact,
      runtime: environment.runtime,
    });
    await store.appendSnapshotManifest(projectId, firstSnapshot);
    const firstBundle = await scanner.scan({
      projectId,
      snapshotManifestId: firstSnapshot.id,
      sourceComponentId: firstSnapshot.components.source.id,
      rootPath: referenceRoot,
    });
    if (!firstBundle.complete) throw new Error(`Reference scan is incomplete: ${JSON.stringify(firstBundle.diagnostics)}`);
    await application.ingestFactBundle(projectId, signFactBundle(firstBundle, scannerSecret));

    const firstRun = await application.executeReverseRun({
      id: "REVERSE-RUN-ORDER-V1",
      projectId,
      snapshotManifestId: firstSnapshot.id,
      sourceComponentId: firstSnapshot.components.source.id,
      factBundleIds: [firstBundle.id],
      skills: referenceSkills.map(({ adapter }) => ({ id: adapter.id, version: adapter.version })),
      taskScope: { nodeTypes: ["ARTIFACT", "ENDPOINT", "CODE_SYMBOL", "DATA_OBJECT", "CONFIGURATION"] },
    });
    const firstCandidate = candidateFor(firstRun);
    const candidateFeature = firstRun.mergedOutput.candidateFeatures.find(
      (item) => item.externalKey === firstCandidate.subjectKey,
    );
    const reviewed = await application.reviewReverseCandidate(projectId, firstRun.id, firstCandidate.id, {
      id: "REVIEW-ORDER-SUBMIT",
      outcome: "CONFIRMED",
      rationale: "The product owner confirms the submit-order endpoint for customer draft orders.",
      candidateFeatureId: candidateFeature.id,
      target: {
        featureMode: "CREATE",
        featureId,
        claimId,
        scopeId: "SCOPE-ORDER-SUBMIT",
        decisionId: "DECISION-ORDER-SUBMIT",
        featureName: "Submit order",
        businessDomain: "order-management",
      },
      normative: {
        statement: "Customers can submit a draft order through the governed submission endpoint.",
        constraint: { dimension: "endpointExposed", operator: "EQUALS", value: true },
        scope: { actorRole: "customer", orderState: "DRAFT" },
      },
    });
    await application.appendBusinessProcessModel(
      projectId,
      featureId,
      governedOrderProcessModel({ version: 1, snapshotManifestId: firstSnapshot.id, factBundle: firstBundle }),
    );

    const generated = await application.generateTestSpecDraft(projectId, featureId, claimId, {
      id: "TEST-ORDER-SUBMIT",
      snapshotManifestId: firstSnapshot.id,
      endpointFactId: reviewed.implementationMapping.factRefs[0].factId,
      target: "order-reference-sit",
      expectedHttpStatus: 200,
      name: "Submit an isolated draft order and verify database state",
      preconditions: [{ type: "SEED", seedRef: "draft-order", parameters: { orderId: "ORDER-PILOT-001" } }],
      variables: {},
      pathParameters: { id: "${seed.orderId}" },
      headers: {
        "x-actor-id": "PILOT-CUSTOMER-001",
        "x-actor-role": "customer",
        "idempotency-key": "PILOT-${seed.orderId}",
        "x-trace-id": "TRACE-${seed.orderId}",
      },
      body: {},
      databaseVerification: {
        stepId: "verify-order-row",
        queryRef: "order_by_id",
        parameters: ["${seed.orderId}"],
        assertions: [{
          id: "database-order-status",
          type: "DATABASE_FIELD",
          row: 0,
          field: "status",
          expected: "SUBMITTED",
        }],
      },
      cleanup: { strategy: "SEED_RESET" },
    });
    const approvedTestSpec = await application.approveTestSpec(projectId, generated.draft.id, {
      expectedVersion: generated.draft.version,
      rationale: "Approve the isolated Seed, API, database assertion, and cleanup protocol.",
    });

    platform = await startOrderPlatform({ ...environment, clock });
    if (platform.artifact.digest !== firstSnapshot.components.deployment.digest) {
      throw new Error("The running first deployment does not match its Snapshot artifact digest");
    }
    let targetPolicy = {
      baseUrl: platform.baseUrl,
      snapshotBinding: firstSnapshot.components,
      evidenceCollectors: [{ id: "order-telemetry", types: ["LOG", "TRACE"] }],
      allowedOperationLevels: ["CONTROLLED_WRITE"],
      maxRequestBytes: 4096,
      httpAllowlist: [{
        method: "POST",
        pathPattern: "^/orders/[^/]+/submit$",
        operationLevels: ["CONTROLLED_WRITE"],
        maxRequestBytes: 1024,
      }],
      databaseRef: "order-reference-readonly",
      queryCatalog: {
        order_by_id: {
          sql: "SELECT status, submitted_by, submitted_at FROM orders WHERE id = $1",
          safeRead: true,
          maxRows: 1,
        },
      },
      fixtureCatalog: {
        "draft-order": {
          protocolVersion: "1.0.0",
          cleanupStrategies: ["SEED_RESET"],
          compensationRef: "COMPENSATE-ORDER-PILOT",
        },
      },
    };
    const fixtureLifecycle = new FixtureLifecycleExecutor({
      handlerResolver: async (seedRef) => seedRef === "draft-order" ? {
        async setup(seed) {
          const orderId = seed.parameters.orderId;
          environment.telemetry.clear();
          await environment.database.query("DELETE FROM order_submission_idempotency WHERE order_id = $1", [orderId]);
          await environment.database.query("DELETE FROM orders WHERE id = $1", [orderId]);
          await environment.database.query("INSERT INTO orders (id, status) VALUES ($1, 'DRAFT')", [orderId]);
          return { bindings: { seed: { orderId } }, state: { orderId }, evidence: { orderId, status: "DRAFT" } };
        },
        async cleanup({ state }) {
          for (const reservation of environment.inventory.activeReservations().filter((item) => item.orderId === state.orderId)) {
            await environment.inventory.release(reservation.id);
          }
          await environment.database.query("DELETE FROM order_submission_idempotency WHERE order_id = $1", [state.orderId]);
          await environment.database.query("DELETE FROM orders WHERE id = $1", [state.orderId]);
          return { evidence: { removedOrderId: state.orderId } };
        },
      } : null,
    });
    const runner = new ControlledRunner({
      runner: { id: "RUNNER-ORDER-PILOT", version: "1.0.0" },
      runnerSecret,
      targetPolicyResolver: async () => targetPolicy,
      secretResolver: async () => null,
      executors: {
        HTTP: new HttpExecutor(),
        DATABASE: new DatabaseExecutor({ databaseResolver: async () => environment.database }),
      },
      fixtureLifecycle,
      evidenceCollectors: {
        "order-telemetry": {
          async collect() {
            const observed = environment.telemetry.snapshot();
            if (observed.logs.length === 0 || observed.traces.length === 0) {
              throw new Error("The reference deployment produced incomplete telemetry");
            }
            return [
              { id: "ORDER-LOGS", type: "LOG", payload: { records: observed.logs } },
              { id: "ORDER-TRACES", type: "TRACE", payload: { spans: observed.traces } },
            ];
          },
        },
      },
      clock,
    });
    const firstEvidence = await runner.runAndSubmit(
      runnerTask({
        executionId: "EXECUTION-ORDER-V1",
        testSpec: approvedTestSpec,
        snapshotManifest: firstSnapshot,
        targetPolicy,
      }),
      (submittedProjectId, bundle) => application.ingestExecutionEvidence(submittedProjectId, bundle),
    );
    const firstTraceability = await application.recomputeFeatureTraceChains(projectId, featureId, firstSnapshot.id);
    if (!featureComplete(firstTraceability)) {
      throw new Error(
        `The first reference Snapshot did not produce a complete trace chain: ${JSON.stringify({ dimensions: firstTraceability.dimensions, gaps: firstTraceability.gaps })}`,
      );
    }

    advance(10 * 60_000);
    await cp(referenceRoot, changedRoot, { recursive: true });
    const runGit = (args) => execFile("git", args, {
      cwd: changedRoot,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    await runGit(["init", "--quiet"]);
    await runGit(["add", "--all"]);
    await runGit([
      "-c", "user.name=Traqen Reference Pilot",
      "-c", "user.email=pilot@traqen.invalid",
      "commit", "--quiet", "-m", "reference deployment v1",
    ]);
    const fromCommit = (await runGit(["rev-parse", "HEAD"])).stdout.trim();
    const changedServerPath = path.join(changedRoot, "src/server.js");
    const changedSource = (await readFile(changedServerPath, "utf8")).replace(
      "ORDER_SUBMISSION_V1",
      "ORDER_SUBMISSION_V2",
    );
    await writeFile(changedServerPath, changedSource, "utf8");
    await runGit(["add", "--all"]);
    await runGit([
      "-c", "user.name=Traqen Reference Pilot",
      "-c", "user.email=pilot@traqen.invalid",
      "commit", "--quiet", "-m", "reference deployment v2",
    ]);
    const toCommit = (await runGit(["rev-parse", "HEAD"])).stdout.trim();
    const gitDiff = await new GitDiffAnalyzer().analyze({
      rootPath: changedRoot,
      fromCommit,
      toCommit,
    });
    const changedModule = await import(`${pathToFileURL(changedServerPath).href}?snapshot=artifact-${currentTime}`);
    const secondFingerprint = await scanner.fingerprint({ rootPath: changedRoot });
    const secondArtifact = await changedModule.describeOrderPlatformArtifact();
    const secondSnapshot = snapshot({
      sourceDigest: secondFingerprint.sourceDigest,
      artifact: secondArtifact,
      runtime: environment.runtime,
    });
    if (secondSnapshot.components.deployment.digest === firstSnapshot.components.deployment.digest) {
      throw new Error("The changed deployment did not produce a different artifact digest");
    }
    await store.appendSnapshotManifest(projectId, secondSnapshot);
    const secondBundle = await scanner.scan({
      projectId,
      snapshotManifestId: secondSnapshot.id,
      sourceComponentId: secondSnapshot.components.source.id,
      rootPath: changedRoot,
    });
    if (!secondBundle.complete) throw new Error(`Changed reference scan is incomplete: ${JSON.stringify(secondBundle.diagnostics)}`);
    await application.ingestFactBundle(projectId, signFactBundle(secondBundle, scannerSecret));
    const impact = await application.compareAndPersistSnapshots(projectId, {
      id: "CHANGESET-ORDER-V1-V2",
      fromSnapshotManifestId: firstSnapshot.id,
      toSnapshotManifestId: secondSnapshot.id,
    });
    const gitCorrelation = correlateGitDiffWithFactChanges(gitDiff, impact.changeSet.changes);
    if (gitCorrelation.factChangeIds.length === 0) {
      throw new Error("Git Diff did not correlate the changed source artifact to any Fact change");
    }
    const staleTraceability = await application.getFeatureTraceability(projectId, featureId, secondSnapshot.id);
    if (!staleTraceability.gaps.some((gap) => gap.type === "CONFORMANCE_STALE")) {
      throw new Error("The changed reference Snapshot did not expose its implementation gap");
    }
    const staleProtection = await application.getContinuousProtectionAssessment(projectId, impact.changeSet.id);
    if (staleProtection.qualityGate.status !== "BLOCKED") {
      throw new Error("The changed reference Snapshot did not block its continuous-protection assessment");
    }

    const secondRun = await application.executeReverseRun({
      id: "REVERSE-RUN-ORDER-V2",
      projectId,
      snapshotManifestId: secondSnapshot.id,
      sourceComponentId: secondSnapshot.components.source.id,
      factBundleIds: [secondBundle.id],
      skills: referenceSkills.map(({ adapter }) => ({ id: adapter.id, version: adapter.version })),
      taskScope: { nodeTypes: ["ARTIFACT", "ENDPOINT", "CODE_SYMBOL", "DATA_OBJECT", "CONFIGURATION"] },
    });
    const secondCandidate = candidateFor(secondRun);
    const reanalysis = await application.reanalyzeImplementation(projectId, featureId, claimId, {
      id: "IMPLEMENTATION-REANALYSIS-ORDER-V2",
      sourceRunId: secondRun.id,
      sourceCandidateId: secondCandidate.id,
      rationale: "The developer confirms the changed endpoint still implements the existing governed Claim.",
    });
    await application.appendBusinessProcessModel(
      projectId,
      featureId,
      governedOrderProcessModel({ version: 2, snapshotManifestId: secondSnapshot.id, factBundle: secondBundle }),
    );
    const repairedBeforeExecution = await application.getFeatureTraceability(projectId, featureId, secondSnapshot.id);
    if (repairedBeforeExecution.dimensions.conformance[0]?.status !== "CONFORMS") {
      throw new Error("Implementation reanalysis did not restore conformance");
    }
    if (!repairedBeforeExecution.gaps.some((gap) => gap.type === "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT")) {
      throw new Error("The repaired mapping incorrectly reused historical deployment Evidence");
    }

    await platform.close();
    platform = await changedModule.startOrderPlatform({ ...environment, clock });
    if (platform.artifact.digest !== secondSnapshot.components.deployment.digest) {
      throw new Error("The running second deployment does not match its Snapshot artifact digest");
    }
    targetPolicy = {
      ...targetPolicy,
      baseUrl: platform.baseUrl,
      snapshotBinding: secondSnapshot.components,
    };
    const secondEvidence = await runner.runAndSubmit(
      runnerTask({
        executionId: "EXECUTION-ORDER-V2",
        testSpec: approvedTestSpec,
        snapshotManifest: secondSnapshot,
        targetPolicy,
      }),
      (submittedProjectId, bundle) => application.ingestExecutionEvidence(submittedProjectId, bundle),
    );
    const finalTraceability = await application.recomputeFeatureTraceChains(projectId, featureId, secondSnapshot.id);
    if (!featureComplete(finalTraceability)) {
      throw new Error(
        `The repaired reference Snapshot did not return to a complete trace chain: ${JSON.stringify({ dimensions: finalTraceability.dimensions, gaps: finalTraceability.gaps })}`,
      );
    }
    const finalGraph = await application.getFeatureGraph(projectId, featureId, secondSnapshot.id, {
      view: "traceability",
      depth: 8,
      limit: 100,
    });
    const finalBusinessGraph = await application.getFeatureGraph(projectId, featureId, secondSnapshot.id, {
      view: "business",
      depth: 8,
      limit: 100,
    });
    if (!finalBusinessGraph.nodes.some((node) => node.type === "BUSINESS_STATE")) {
      throw new Error("The governed business graph did not expose BusinessState nodes");
    }
    if (!finalBusinessGraph.edges.some((edge) => edge.type === "TRANSITIONS_TO")) {
      throw new Error("The governed business graph did not expose state transitions");
    }
    const graphEvidence = finalGraph.nodes.find((node) => node.type === "EVIDENCE");
    if (!graphEvidence) throw new Error("The repaired traceability graph did not expose execution Evidence");
    const proofPath = await application.queryFeatureGraphPath(projectId, featureId, {
      snapshotManifestId: secondSnapshot.id,
      fromNodeId: featureId,
      toNodeId: graphEvidence.id,
      direction: "ANY",
      maxDepth: 12,
      view: "traceability",
    });
    if (!proofPath.found) throw new Error("The repaired traceability graph did not connect Feature to Evidence");
    const finalProtection = await application.getContinuousProtectionAssessment(projectId, impact.changeSet.id);
    if (finalProtection.qualityGate.status !== "PASS") {
      throw new Error("The repaired reference Snapshot did not restore its continuous-protection gate");
    }
    const productMetrics = await application.getProductEffectivenessMetrics(projectId, secondSnapshot.id);
    if (productMetrics.highValueValidTraceChainRate.ratio !== 1) {
      throw new Error("The repaired reference Snapshot did not restore its high-value Feature metric");
    }
    const implementationSemanticKinds = [...new Set(
      finalTraceability.claims.flatMap((item) => item.facts.nodes)
        .map((node) => node.attributes?.kind)
        .filter((kind) => ["condition-branch", "permission-check", "state-transition", "exception-path", "enum"].includes(kind)),
    )].sort();
    if (!implementationSemanticKinds.includes("condition-branch") || !implementationSemanticKinds.includes("state-transition")) {
      throw new Error("The repaired Feature mapping did not retain state and guard implementation facts");
    }

    process.stdout.write(`${JSON.stringify({
      projectId,
      featureId,
      firstSnapshot: {
        id: firstSnapshot.id,
        factNodes: firstBundle.nodes.length,
        factEdges: firstBundle.edges.length,
        reverseSkills: firstRun.skillRuns.length,
        candidateSources: firstCandidate.sources.length,
        candidateTestSpecs: firstRun.mergedOutput.candidateTestSpecs.length,
        testSpec: `${approvedTestSpec.id}@${approvedTestSpec.version}`,
        execution: firstEvidence.execution.status,
        deploymentArtifactDigest: firstSnapshot.components.deployment.digest,
        evidenceTypes: [...new Set(firstEvidence.evidence.map((item) => item.type))].sort(),
        traceComplete: featureComplete(firstTraceability),
      },
      change: {
        id: impact.changeSet.id,
        factChanges: impact.changeSet.changes.length,
        deploymentArtifactChanged:
          firstSnapshot.components.deployment.digest !== secondSnapshot.components.deployment.digest,
        gitDiffArtifacts: gitDiff.changedArtifacts,
        gitCorrelatedFactChanges: gitCorrelation.factChangeIds.length,
        affectedFeatures: impact.impact.affectedFeatureIds,
        staleGapTypes: staleTraceability.gaps.map((gap) => gap.type),
        preservedAuthority: staleTraceability.dimensions.authority[0]?.status,
      },
      repair: {
        mappingId: reanalysis.implementationMapping.id,
        conformance: reanalysis.conformance.status,
        historicalEvidenceRejected: repairedBeforeExecution.gaps.some(
          (gap) => gap.type === "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT",
        ),
        regressionExecution: secondEvidence.execution.status,
        finalTraceComplete: featureComplete(finalTraceability),
        finalGapCount: finalTraceability.gaps.length,
      },
      graph: {
        snapshotManifestId: finalGraph.snapshotManifestId,
        nodes: finalGraph.nodes.length,
        edges: finalGraph.edges.length,
        assertions: finalGraph.nodes.filter((node) => node.type === "TEST_ASSERTION").length,
        featureToEvidencePathFound: proofPath.found,
        featureToEvidenceHops: proofPath.hopCount,
        businessStates: finalBusinessGraph.nodes.filter((node) => node.type === "BUSINESS_STATE").length,
        stateTransitions: finalBusinessGraph.nodes.filter((node) => node.type === "STATE_TRANSITION").length,
      },
      continuousProtection: {
        selectionStrategy: finalProtection.regressionPlan.selectionStrategy,
        selectedTestSpecIds: finalProtection.regressionPlan.selectedTests.map((item) => item.id),
        staleStatus: staleProtection.qualityGate.status,
        staleEnforcement: staleProtection.qualityGate.enforcement,
        finalStatus: finalProtection.qualityGate.status,
        finalEnforcement: finalProtection.qualityGate.enforcement,
      },
      productMetrics: {
        validTraceChainRate: productMetrics.highValueValidTraceChainRate,
        claimConfirmationRate: productMetrics.claimConfirmationRate,
        ruleTestCoverageRate: productMetrics.confirmedRuleTestCoverageRate,
        meaningfulAssertionRate: productMetrics.meaningfulAssertionRate,
        gapTypes: productMetrics.gapBreakdown.byType,
        unavailableMetrics: productMetrics.unavailableMetrics.map((item) => item.metric),
      },
      implementationSemantics: implementationSemanticKinds,
    }, null, 2)}\n`);
  } finally {
    if (platform) await platform.close().catch(() => {});
    await environment.close().catch(() => {});
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
