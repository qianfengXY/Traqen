#!/usr/bin/env node

import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
import { JavaScriptProjectScanner } from "../scanner/index.js";
import { createReferenceSkillSet, ReverseSkillOrchestrator } from "../skills/index.js";
import { MemoryTraceabilityStore } from "../storage/index.js";
import { createOrderPlatformEnvironment } from "../../examples/order-platform/src/environment.js";
import { startOrderPlatform } from "../../examples/order-platform/src/server.js";

const projectId = "ORDER-PILOT";
const featureId = "FEATURE-ORDER-SUBMIT";
const claimId = "CLAIM-ORDER-SUBMIT-ENDPOINT";
const scannerSecret = "order-pilot-scanner-secret";
const publisherSecret = "order-pilot-publisher-secret";
const runnerSecret = "order-pilot-runner-secret";
const referenceRoot = fileURLToPath(new URL("../../examples/order-platform", import.meta.url));
let currentTime = Date.parse("2026-07-14T08:00:00.000Z");
const clock = () => new Date(currentTime);
const advance = (milliseconds) => { currentTime += milliseconds; };

function snapshot(label) {
  const observedTo = new Date(currentTime).toISOString();
  const observedFrom = new Date(currentTime - 60_000).toISOString();
  return createSnapshotManifest({
    source: { id: `SOURCE-ORDER-${label}`, digest: `sha256:source-order-${label.toLowerCase()}` },
    build: { id: `BUILD-ORDER-${label}`, digest: `sha256:build-order-${label.toLowerCase()}` },
    deployment: { id: `DEPLOY-ORDER-${label}`, digest: `sha256:deployment-order-${label.toLowerCase()}` },
    runtime: { id: `RUNTIME-ORDER-${label}`, digest: `sha256:runtime-order-${label.toLowerCase()}` },
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

    const firstSnapshot = snapshot("V1");
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
      taskScope: { nodeTypes: ["ENDPOINT", "DATA_OBJECT", "CONFIGURATION"] },
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
    let targetPolicy = {
      baseUrl: platform.baseUrl,
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
    const changedServerPath = path.join(changedRoot, "src/server.js");
    const changedSource = (await readFile(changedServerPath, "utf8")).replace(
      "ORDER_SUBMISSION_V1",
      "ORDER_SUBMISSION_V2",
    );
    await writeFile(changedServerPath, changedSource, "utf8");
    const secondSnapshot = snapshot("V2");
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
    const staleTraceability = await application.getFeatureTraceability(projectId, featureId, secondSnapshot.id);
    if (!staleTraceability.gaps.some((gap) => gap.type === "CONFORMANCE_STALE")) {
      throw new Error("The changed reference Snapshot did not expose its implementation gap");
    }

    const secondRun = await application.executeReverseRun({
      id: "REVERSE-RUN-ORDER-V2",
      projectId,
      snapshotManifestId: secondSnapshot.id,
      sourceComponentId: secondSnapshot.components.source.id,
      factBundleIds: [secondBundle.id],
      skills: referenceSkills.map(({ adapter }) => ({ id: adapter.id, version: adapter.version })),
      taskScope: { nodeTypes: ["ENDPOINT", "DATA_OBJECT", "CONFIGURATION"] },
    });
    const secondCandidate = candidateFor(secondRun);
    const reanalysis = await application.reanalyzeImplementation(projectId, featureId, claimId, {
      id: "IMPLEMENTATION-REANALYSIS-ORDER-V2",
      sourceRunId: secondRun.id,
      sourceCandidateId: secondCandidate.id,
      rationale: "The developer confirms the changed endpoint still implements the existing governed Claim.",
    });
    const repairedBeforeExecution = await application.getFeatureTraceability(projectId, featureId, secondSnapshot.id);
    if (repairedBeforeExecution.dimensions.conformance[0]?.status !== "CONFORMS") {
      throw new Error("Implementation reanalysis did not restore conformance");
    }
    if (!repairedBeforeExecution.gaps.some((gap) => gap.type === "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT")) {
      throw new Error("The repaired mapping incorrectly reused historical deployment Evidence");
    }

    await platform.close();
    const changedModule = await import(`${pathToFileURL(changedServerPath).href}?snapshot=${secondSnapshot.id}`);
    platform = await changedModule.startOrderPlatform({ ...environment, clock });
    targetPolicy = { ...targetPolicy, baseUrl: platform.baseUrl };
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

    process.stdout.write(`${JSON.stringify({
      projectId,
      featureId,
      firstSnapshot: {
        id: firstSnapshot.id,
        factNodes: firstBundle.nodes.length,
        factEdges: firstBundle.edges.length,
        reverseSkills: firstRun.skillRuns.length,
        candidateSources: firstCandidate.sources.length,
        testSpec: `${approvedTestSpec.id}@${approvedTestSpec.version}`,
        execution: firstEvidence.execution.status,
        traceComplete: featureComplete(firstTraceability),
      },
      change: {
        id: impact.changeSet.id,
        factChanges: impact.changeSet.changes.length,
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
