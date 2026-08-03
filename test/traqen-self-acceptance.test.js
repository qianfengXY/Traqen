import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LegacyUnderstandingRuntime } from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { createReviewedUnderstandingEvaluationResolver } from "../src/application/reviewed-understanding-evaluation.js";
import { createUnderstandingSemanticSurface } from "../src/application/understanding-equivalence.js";
import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";
import { ArtifactInventoryScanner } from "../src/scanner/artifact-inventory-scanner.js";
import { canonicalJson, createSnapshotManifest } from "../src/domain/index.js";
import {
  deterministicFixtureMainProducer,
  fixtureReviewedMeasurementResolver,
  persistFixtureExecutionProfile,
} from "./helpers/legacy-understanding-fixture.js";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);

async function factEvidenceChildProducer(input) {
  if (input.candidate.subjectKey.startsWith("@synthesis/")
    || input.assignment.slotId !== input.executionProfile.childSlots[0].id) {
    return { candidates: [{
      name: input.candidate.proposal.name,
      subjectKey: input.candidate.subjectKey,
      statement: input.candidate.proposal.statement,
      confidence: "LOW",
    }] };
  }
  const candidates = input.scopedArtifacts
    .filter((artifact) => input.facts.some(({ artifactId }) => artifactId === artifact.id))
    .map((artifact) => ({
        name: path.basename(artifact.relativePath),
        subjectKey: artifact.relativePath,
        statement: `Deterministic extraction produced evidence for ${artifact.relativePath}`,
        confidence: "LOW",
      }));
  return candidates.length > 0 ? { candidates } : { candidates: [{
    name: input.candidate.proposal.name,
    subjectKey: input.candidate.subjectKey,
    statement: input.candidate.proposal.statement,
    confidence: "LOW",
  }] };
}

async function factReferenceMainProducer(input) {
  const base = await deterministicFixtureMainProducer(input);
  if (input.workUnit.kind !== "PROJECT_SYNTHESIS") return base;
  const artifactByPath = new Map(input.scopedArtifacts.map((artifact) => [artifact.relativePath, artifact]));
  const resolveTarget = (sourcePath, targetPath) => {
    if (typeof targetPath !== "string" || !targetPath.startsWith(".")) return null;
    const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), targetPath));
    return [normalized, ...[".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md"].map((extension) => `${normalized}${extension}`),
      ...["index.js", "index.ts", "index.tsx"].map((name) => `${normalized}/${name}`)]
      .map((candidatePath) => artifactByPath.get(candidatePath)).find(Boolean) ?? null;
  };
  const relations = [...new Map(input.facts.flatMap((fact) => {
    if (!["SOURCE_REFERENCE", "DOCUMENT_REFERENCE"].includes(fact.type)) return [];
    const source = input.scopedArtifacts.find(({ id }) => id === fact.artifactId);
    const target = source ? resolveTarget(source.relativePath, fact.targetPath) : null;
    if (!source || !target) return [];
    const relation = {
      sourceArtifactId: source.id,
      predicate: "REFERENCES",
      targetArtifactId: target.id,
      evidenceFactIds: [fact.id],
      sourceSliceIds: [],
    };
    return [[`${source.id}\u0000${target.id}`, relation]];
  })).values()];
  return { ...base, relations };
}

async function runtimeFor({ projectId, source, snapshotRoot, truth, store, profile, equivalenceState, independent = false }) {
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot });
  const runtime = new LegacyUnderstandingRuntime({
    store,
    allowlistedRoots: [source],
    snapshotRoot,
    sourceSliceBroker: broker,
    childProducer: factEvidenceChildProducer,
    mainProducer: factReferenceMainProducer,
    implementationAuthorId: independent ? "TRAQEN-INDEPENDENT-IMPLEMENTATION" : "TRAQEN-RUNTIME",
    runnerId: independent ? "TRAQEN-INDEPENDENT-RUNNER" : "TRAQEN-LOCAL-RUNNER",
    reviewedEvaluationResolver: createReviewedUnderstandingEvaluationResolver({
      truthSet: truth,
      reviewerId: "TRAQEN-SELF-INDEPENDENT-REVIEWER",
      measurementResolver: fixtureReviewedMeasurementResolver("TRAQEN-SELF-INDEPENDENT-REVIEWER", truth),
    }),
    equivalenceResolver: async () => ({
      replayAnalysisRunId: equivalenceState.replayAnalysisRunId,
      fullAnalysisRunId: equivalenceState.fullAnalysisRunId,
    }),
  });
  return runtime;
}

async function evaluationSurface(store, projectId, job) {
  const [inventory, factBundle, candidateBundle, reconciliation] = await Promise.all([
    store.getUnderstandingRecord(projectId, "ARTIFACT_INVENTORY", job.outputs.SOURCE_SCAN.inventoryId),
    store.getUnderstandingRecord(projectId, "FACT_BUNDLE", job.outputs.FACT_COMMIT.factBundleId),
    store.getUnderstandingRecord(projectId, "CANDIDATE_BUNDLE", job.outputs.ANALYSIS.candidateBundleId),
    store.getUnderstandingRecord(projectId, "RECONCILIATION", job.outputs.RECONCILIATION.reconciliationId),
  ]);
  return createUnderstandingSemanticSurface({ inventory, factBundle, candidateBundle, reconciliation });
}

async function currentArtifact(store, projectId) {
  const head = await store.getCurrentGraphHead(projectId);
  const revision = await store.getUnderstandingRecord(projectId, "GRAPH_REVISION", head.graphRevisionId);
  return {
    head,
    revision,
    artifact: await store.getUnderstandingRecord(projectId, "GRAPH_ARTIFACT", revision.graphArtifactId),
  };
}

async function traqenSnapshotManifest(source, version) {
  const digest = (character) => `sha256:${character.repeat(64)}`;
  const preview = await new ArtifactInventoryScanner({ allowlistedRoots: [source] }).scan({
    projectId: "TRAQEN-SELF",
    snapshotManifestId: `TRAQEN-CAPTURE-PREVIEW-${version}`,
    rootPath: source,
  });
  return createSnapshotManifest({
    source: { id: preview.id, digest: preview.sourceDigest },
    build: { id: "TRAQEN-BUILD", digest: digest("c") },
    deployment: { id: "TRAQEN-DEPLOYMENT", digest: digest("d") },
    runtime: { id: "TRAQEN-RUNTIME", digest: digest("e") },
    failedSources: [],
    observedFrom: `2026-08-0${version}T00:00:00.000Z`,
    observedTo: `2026-08-0${version}T00:05:00.000Z`,
  });
}

function traqenReviewedTraceInput(snapshotManifest, analyzedCandidate) {
  return {
    requirements: [{ id: "DOC-F001-REQUIREMENT", path: "docs/features/F001-legacy-system-understanding.md" }],
    designs: [{ id: "DOC-TRAQEN-ARCHITECTURE", path: "docs/architecture/traqen-product-architecture.md" }],
    feature: { id: "FEATURE-TRAQEN-LEGACY-UNDERSTANDING", name: "Legacy-system understanding" },
    claim: {
      id: "CLAIM-TRAQEN-UNDERSTANDING-PUBLICATION",
      version: 1,
      type: "NORMATIVE_REQUIREMENT",
      authorityStatus: "CONFIRMED",
      evidenceSupport: "MULTI_SOURCE",
    },
    decision: { id: `DECISION-REVIEWED-${analyzedCandidate.id}`, type: "CONFIRMED" },
    scope: { id: "SCOPE-TRAQEN-SELF", actor: "workspace-operator" },
    snapshotManifest,
    implementation: {
      endpoints: ["POST /v1/projects/{projectId}/workspace-analysis-jobs"],
      codeSymbols: [analyzedCandidate.subjectKey],
      dataObjects: ["GraphRevision", "CurrentGraphHead", analyzedCandidate.id],
      configurations: [`ANALYSIS-EVIDENCE:${analyzedCandidate.evidenceFactIds[0]}`],
      dependencies: ["WorkspaceExecutionProfileRevision"],
    },
    conformance: {
      id: "CONFORMANCE-TRAQEN-F001",
      status: "CONFORMS",
      claimId: "CLAIM-TRAQEN-UNDERSTANDING-PUBLICATION",
      claimVersion: 1,
      scopeId: "SCOPE-TRAQEN-SELF",
      snapshotManifestId: snapshotManifest.id,
      analysisMethod: { type: "REVIEWED_SELF_DOGFOOD" },
    },
    testSpec: {
      id: "TESTSPEC-TRAQEN-SELF-DOGFOOD",
      version: 1,
      approved: true,
      verifiesClaims: [{ id: "CLAIM-TRAQEN-UNDERSTANDING-PUBLICATION", version: 1 }],
      assertions: [{ id: "ASSERT-FULL-INCREMENTAL-FULL" }],
    },
    execution: {
      id: "EXECUTION-TRAQEN-SELF-DOGFOOD",
      deploymentId: snapshotManifest.components.deployment.id,
      snapshotManifestId: snapshotManifest.id,
      testSpecId: "TESTSPEC-TRAQEN-SELF-DOGFOOD",
      testSpecVersion: 1,
      status: "PASS",
    },
    evidence: [{
      id: "EVIDENCE-TRAQEN-SELF-DOGFOOD",
      executionId: "EXECUTION-TRAQEN-SELF-DOGFOOD",
      integrity: "VERIFIED",
      freshness: "FRESH",
    }],
    conflicts: [],
  };
}

async function persistTraqenReviewedTrace(store, projectId, snapshotManifest, analyzedCandidate) {
  await store.appendSnapshotManifest(projectId, snapshotManifest);
  const application = new TraceabilityApplication({ store });
  const input = traqenReviewedTraceInput(snapshotManifest, analyzedCandidate);
  const result = await application.evaluateAndPersist(projectId, input);
  assert.equal(result.chain.complete, true);
  const stale = structuredClone(input);
  stale.evidence[0].freshness = "STALE";
  assert.equal(application.evaluate(stale).complete, false);
  return result.chain;
}

test("Traqen dogfoods two real immutable Snapshots through FULL → INCREMENTAL → independent FULL", async (t) => {
  const truth = JSON.parse(await readFile(
    new URL("./fixtures/understanding/traqen-self-calibration-v1.json", import.meta.url),
    "utf8",
  ));
  const producerSource = `${factEvidenceChildProducer}\n${factReferenceMainProducer}`;
  assert.equal(producerSource.includes(truth.id), false);
  for (const { path: anchorPath } of truth.anchors) {
    assert.equal(producerSource.includes(anchorPath), false, `producer must not embed truth anchor ${anchorPath}`);
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-self-dogfood-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  const independentSnapshots = path.join(temporary, "independent-snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await mkdir(independentSnapshots);
  for (const directory of ["src", "contracts", "docs/features", "docs/architecture", "feature-specs", "test", "web/app", "web/tests", "db/migrations"]) {
    await cp(path.join(repositoryRoot, directory), path.join(source, directory), { recursive: true });
  }

  const store = new MemoryTraceabilityStore();
  const profile = await persistFixtureExecutionProfile(store, "TRAQEN-SELF");
  const equivalenceState = { replayAnalysisRunId: null, fullAnalysisRunId: null };
  const primaryRuntime = await runtimeFor({
    projectId: "TRAQEN-SELF", source, snapshotRoot: snapshots, truth, store, profile, equivalenceState,
  });
  const independentRuntime = await runtimeFor({
    projectId: "TRAQEN-SELF", source, snapshotRoot: independentSnapshots, truth, store, profile, equivalenceState, independent: true,
  });
  const registration = await primaryRuntime.registerSource({ projectId: "TRAQEN-SELF", rootPath: source, displayName: "Traqen" });
  const run = (runtime, input) => runtime.start({
    projectId: "TRAQEN-SELF",
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    ...input,
  }, { background: false });
  const snapshotOne = await traqenSnapshotManifest(source, 1);
  await store.appendSnapshotManifest("TRAQEN-SELF", snapshotOne);
  const verificationFullOne = await run(independentRuntime, {
    id: "TRAQEN-VERIFY-FULL-1", snapshotManifestId: snapshotOne.id, requestedMode: "FULL", purpose: "EQUIVALENCE_VERIFICATION",
  });
  const verificationReplayOne = await run(independentRuntime, {
    id: "TRAQEN-VERIFY-REPLAY-1", snapshotManifestId: snapshotOne.id, requestedMode: "FULL", purpose: "EQUIVALENCE_VERIFICATION",
  });
  assert.equal(verificationFullOne.outputs.PUBLISHING.published, false);
  assert.equal(await store.getCurrentGraphHead("TRAQEN-SELF"), null);
  equivalenceState.fullAnalysisRunId = verificationFullOne.id;
  equivalenceState.replayAnalysisRunId = verificationReplayOne.id;
  const fullOne = await run(primaryRuntime, {
    id: "TRAQEN-FULL-1", snapshotManifestId: snapshotOne.id, requestedMode: "FULL",
  });
  const fullOneSurface = await evaluationSurface(store, "TRAQEN-SELF", fullOne);
  const verificationOneSurface = await evaluationSurface(store, "TRAQEN-SELF", verificationFullOne);
  const fullOneInventory = await store.getUnderstandingRecord(
    "TRAQEN-SELF", "ARTIFACT_INVENTORY", fullOne.outputs.SOURCE_SCAN.inventoryId,
  );
  const fullOneArtifactPaths = new Map(fullOneInventory.artifacts.map(({ id, relativePath }) => [id, relativePath]));
  assert.equal(fullOne.status, "COMPLETED", JSON.stringify({
    error: fullOne.error,
    evaluations: await store.listUnderstandingRecords("TRAQEN-SELF", "EVALUATION_RUN"),
    measurements: (await store.listUnderstandingRecords("TRAQEN-SELF", "REVIEWED_MEASUREMENT")).map((record) => ({
      candidateReviews: record.candidateReviews.length,
      relationReviews: record.relationReviews.length,
      observedRelations: record.relationReviews.filter(({ verdict }) => verdict === "OBSERVED").length,
    })),
    currentSurfaceDigest: fullOneSurface.digest,
    verificationSurfaceDigest: verificationOneSurface.digest,
    surfaceEqual: Object.fromEntries(["artifacts", "facts", "candidates", "conflicts", "gaps", "relations"].map((key) => [
      key, canonicalJson(fullOneSurface[key]) === canonicalJson(verificationOneSurface[key]),
    ])),
    relations: fullOneSurface.relations.slice(0, 80).map(({ sourceId, predicate, targetId }) => [
      fullOneArtifactPaths.get(sourceId), predicate, fullOneArtifactPaths.get(targetId),
    ]),
  }));
  const firstEvaluation = await store.getUnderstandingRecord(
    "TRAQEN-SELF",
    "EVALUATION_RUN",
    fullOne.outputs.EVALUATION.evaluationRunId,
  );
  assert.equal(firstEvaluation.truthSetVersionId, truth.id);
  assert.equal(firstEvaluation.status, "PASSED");
  const first = await currentArtifact(store, "TRAQEN-SELF");
  assert.equal(first.revision.mode, "FULL");
  assert.ok(first.artifact.nodes.some(({ authority }) => authority === "CANDIDATE"));
  assert.ok(first.artifact.traceChains.some(({ subject, segments, analysisEvidenceNodeIds, complete }) =>
    subject?.kind === "CANDIDATE"
    && segments.some(({ type, nodeIds }) => type === "IMPLEMENTATION" && nodeIds.length > 0)
    && segments.some(({ type, nodeIds }) => type === "EVIDENCE" && nodeIds.length === 0)
    && analysisEvidenceNodeIds.length > 0
    && complete === false));

  await mkdir(path.join(source, "review-notes"), { recursive: true });
  await cp(
    path.join(repositoryRoot, "review-notes/2026-07-30-F001-kimi-codex-consensus-review.md"),
    path.join(source, "review-notes/2026-07-30-F001-kimi-codex-consensus-review.md"),
  );
  const snapshotTwo = await traqenSnapshotManifest(source, 2);
  await store.appendSnapshotManifest("TRAQEN-SELF", snapshotTwo);
  const fullTwo = await run(independentRuntime, {
    id: "TRAQEN-VERIFY-FULL-2", snapshotManifestId: snapshotTwo.id, requestedMode: "FULL", purpose: "EQUIVALENCE_VERIFICATION",
  });
  assert.equal(fullTwo.status, "COMPLETED");
  const replayTwo = await run(independentRuntime, {
    id: "TRAQEN-VERIFY-INCREMENTAL-2", snapshotManifestId: snapshotTwo.id, requestedMode: "AUTO", purpose: "EQUIVALENCE_VERIFICATION",
  });
  assert.equal(replayTwo.status, "COMPLETED", JSON.stringify({
    error: replayTwo.error,
    evaluations: (await store.listUnderstandingRecords("TRAQEN-SELF", "EVALUATION_RUN"))
      .filter(({ analysisRunId }) => analysisRunId === replayTwo.id),
    reports: (await store.listUnderstandingRecords("TRAQEN-SELF", "EQUIVALENCE_REPORT"))
      .filter(({ analysisRunId }) => analysisRunId === replayTwo.id),
  }));
  const fullSurface = await evaluationSurface(store, "TRAQEN-SELF", fullTwo);
  const replaySurface = await evaluationSurface(store, "TRAQEN-SELF", replayTwo);
  equivalenceState.fullAnalysisRunId = fullTwo.id;
  equivalenceState.replayAnalysisRunId = replayTwo.id;
  const analyzedCandidate = (await store.getUnderstandingRecord(
    "TRAQEN-SELF", "CANDIDATE_BUNDLE", replayTwo.outputs.ANALYSIS.candidateBundleId,
  )).candidates.find(({ subjectKey }) => subjectKey === "src/application/workspace-analysis-job-runner.js");
  assert.ok(analyzedCandidate?.evidenceFactIds.length > 0);
  const reviewedChain = await persistTraqenReviewedTrace(store, "TRAQEN-SELF", snapshotTwo, analyzedCandidate);
  const incremental = await run(primaryRuntime, {
    id: "TRAQEN-INCREMENTAL-2", snapshotManifestId: snapshotTwo.id, requestedMode: "AUTO",
  });
  const incrementalReports = await store.listUnderstandingRecords("TRAQEN-SELF", "EQUIVALENCE_REPORT");
  const primarySurface = await evaluationSurface(store, "TRAQEN-SELF", incremental);
  assert.equal(incremental.status, "COMPLETED", JSON.stringify({
    error: incremental.error,
    equivalence: incrementalReports.find(({ analysisRunId }) => analysisRunId === incremental.id),
    surfaceCounts: Object.fromEntries(["artifacts", "facts", "candidates", "conflicts", "gaps"].map((key) => [key, [
      primarySurface[key].length,
      fullSurface[key].length,
    ]])),
    surfaceEqual: Object.fromEntries(["artifacts", "facts", "candidates", "conflicts", "gaps"].map((key) => [
      key,
      canonicalJson(primarySurface[key]) === canonicalJson(fullSurface[key]),
    ])),
    candidateOnlyIncremental: primarySurface.candidates
      .filter((candidate) => !fullSurface.candidates.some(({ id }) => id === candidate.id))
      .slice(0, 3).map(({ id, subjectKey, evidenceFactIds }) => ({ id, subjectKey, evidenceCount: evidenceFactIds.length, firstEvidence: evidenceFactIds[0] })),
    candidateOnlyFull: fullSurface.candidates
      .filter((candidate) => !primarySurface.candidates.some(({ id }) => id === candidate.id))
      .slice(0, 3).map(({ id, subjectKey, evidenceFactIds }) => ({ id, subjectKey, evidenceCount: evidenceFactIds.length, firstEvidence: evidenceFactIds[0] })),
  }));
  const second = await currentArtifact(store, "TRAQEN-SELF");
  assert.equal(second.revision.mode, "INCREMENTAL");
  assert.equal(second.head.version, 2);
  assert.ok(second.artifact.changeSet);
  assert.ok(second.artifact.impactAssessment);
  assert.ok(second.artifact.revalidationPlan.required);
  assert.ok(second.artifact.traceChains.some(({ id, complete }) => id === reviewedChain.id && complete === true));
  assert.ok(second.artifact.traceChains.some(({ subject, segments, status, complete }) =>
    subject?.kind === "CANDIDATE"
    && subject.id === analyzedCandidate.id
    && status === "REVIEWED_COMPLETE"
    && complete === true
    && ["REQUIREMENT", "DESIGN", "GOVERNANCE", "IMPLEMENTATION", "TEST", "EXECUTION", "VERIFICATION", "EVIDENCE"]
      .every((type) => segments.some((segment) => segment.type === type && segment.nodeIds.length > 0))));
  assert.equal(canonicalJson(primarySurface), canonicalJson(replaySurface));
  assert.equal(canonicalJson(primarySurface), canonicalJson(fullSurface));
  const equivalence = await store.getUnderstandingRecord(
    "TRAQEN-SELF",
    "EQUIVALENCE_REPORT",
    incremental.outputs.EVALUATION.equivalenceReportId,
  );
  assert.equal(equivalence.full.analysisRunId, fullTwo.id);
  assert.equal(equivalence.full.equivalent, true);

  const inventory = (await store.listUnderstandingRecords("TRAQEN-SELF", "ARTIFACT_INVENTORY"))
    .find(({ snapshotManifestId }) => snapshotManifestId === second.revision.snapshotManifestId);
  assert.equal(inventory.sourceDigest, snapshotTwo.components.source.digest);
  assert.notEqual(snapshotOne.components.source.digest, snapshotTwo.components.source.digest);
  const paths = new Set(inventory.artifacts.map(({ relativePath }) => relativePath));
  assert.equal(truth.capabilities.length, 10);
  assert.equal(truth.anchors.length, 30);
  assert.equal(truth.requiredRelationships.length, 60);
  assert.equal(truth.forbiddenRelationships.length, 30);
  assert.ok(truth.anchors.filter(({ path: anchorPath }) => paths.has(anchorPath)).length / truth.anchors.length >= 0.9);
  assert.notEqual(fullOne.outputs.SOURCE_SCAN.planId, truth.id);
  assert.deepEqual(second.artifact, JSON.parse(JSON.stringify(second.artifact)));
  assert.equal(second.artifact.graphArtifactDigest, second.revision.graphArtifactDigest);
  assert.equal(second.head.graphRevisionId, second.revision.id);

  const application = new TraceabilityApplication({
    store,
    legacyUnderstandingRuntime: primaryRuntime,
  });
  const server = createTraceabilityHttpServer({ application });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browserView = await fetch(
    `http://127.0.0.1:${server.address().port}/v1/projects/TRAQEN-SELF/graph/current`,
  ).then((response) => response.json());
  assert.equal(browserView.head.version, 2);
  assert.equal(browserView.revision.id, second.revision.id);
});
