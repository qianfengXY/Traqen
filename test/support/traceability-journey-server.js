import { createTraceabilityHttpServer } from "../../src/api/http-server.js";
import { TraceabilityApplication } from "../../src/application/traceability-application.js";
import {
  createClaim,
  createClaimScope,
  createDecision,
  createFactBundle,
  createFeatureVersion,
  createImplementationConformance,
  createImplementationMapping,
  createReverseCandidateReview,
} from "../../src/domain/index.js";
import { MemoryTraceabilityStore } from "../../src/storage/index.js";
import { completeInput } from "../fixtures.js";

const fixedClock = () => new Date("2026-08-05T00:00:00.000Z");

function publicationDenominators() {
  return {
    inventory: 1,
    anchors: 1,
    candidateSample: 1,
    requiredRelationships: 1,
    forbiddenRelationships: 1,
    sourceAttributions: 1,
    gaps: 1,
    replaySamples: 1,
    incrementalComparisons: 1,
  };
}

export async function startTraceabilityJourneyServer(t) {
  const projectId = "WORKSPACE-JOURNEY";
  const featureId = "FEATURE-JOURNEY";
  const graphRevisionId = "GRAPH-REVISION-JOURNEY";
  const graphArtifactId = "GRAPH-ARTIFACT-JOURNEY";
  const graphArtifactDigest = `sha256:${"9".repeat(64)}`;
  const fixture = completeInput();
  const snapshotManifest = fixture.snapshotManifest;
  const store = new MemoryTraceabilityStore();
  const application = new TraceabilityApplication({ store, clock: fixedClock });

  await store.appendSnapshotManifest(projectId, snapshotManifest);
  const factBundle = createFactBundle({
    projectId,
    snapshotManifestId: snapshotManifest.id,
    sourceComponentId: snapshotManifest.components.source.id,
    sourceDigest: snapshotManifest.components.source.digest,
    extractor: { id: "JOURNEY-SCANNER", version: "1.0.0" },
    observedAt: fixedClock().toISOString(),
    complete: true,
    diagnostics: [],
    nodes: [{
      type: "ENDPOINT",
      naturalKey: "http:POST /orders",
      name: "POST /orders",
      attributes: { method: "POST", path: "/orders" },
      source: {
        artifact: "src/orders.js",
        startLine: 10,
        endLine: 18,
        contentHash: `sha256:${"8".repeat(64)}`,
      },
    }],
    edges: [],
  });
  await store.appendFactBundle(projectId, factBundle);
  const endpoint = factBundle.nodes[0];

  const feature = createFeatureVersion({ id: featureId, version: 1, name: "Submit order" }, fixedClock);
  const scope = createClaimScope({ id: "SCOPE-JOURNEY", version: 1, scope: { actor: "customer" } }, fixedClock);
  const claim = createClaim({
    id: "CLAIM-JOURNEY",
    version: 1,
    featureId,
    type: "NORMATIVE_REQUIREMENT",
    statement: "A customer can submit an order.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: scope.id,
    scopeVersion: scope.version,
    provenance: { kind: "REAL_APPLICATION_JOURNEY" },
  }, fixedClock);
  const decision = createDecision({
    id: "DECISION-JOURNEY",
    claimId: claim.id,
    claimVersion: claim.version,
    scopeId: scope.id,
    scopeVersion: scope.version,
    type: "CONFIRMED",
    actorId: "PRODUCT-OWNER-JOURNEY",
    actorRole: "product-owner",
    evidenceRefs: [endpoint.factId],
  }, fixedClock);
  const mapping = createImplementationMapping({
    id: "MAPPING-JOURNEY",
    claimId: claim.id,
    claimVersion: claim.version,
    scopeId: scope.id,
    scopeVersion: scope.version,
    snapshotManifestId: snapshotManifest.id,
    sourceComponentId: snapshotManifest.components.source.id,
    sourceRunId: "REVERSE-RUN-JOURNEY",
    sourceCandidateId: "CANDIDATE-JOURNEY",
    factRefs: [{ factId: endpoint.factId, relation: "EXPOSED_BY" }],
  }, fixedClock);
  const conformance = createImplementationConformance({
    id: "CONFORMANCE-JOURNEY",
    claimId: claim.id,
    claimVersion: claim.version,
    scopeId: scope.id,
    scopeVersion: scope.version,
    snapshotManifestId: snapshotManifest.id,
    mappingId: mapping.id,
    status: "CONFORMS",
    evidenceRefs: [endpoint.factId],
    analysisMethod: { type: "JOURNEY", version: "1" },
  }, fixedClock);
  const baselineRefs = {
    featureId,
    featureVersion: feature.version,
    scopeId: scope.id,
    scopeVersion: scope.version,
    claimId: claim.id,
    claimVersion: claim.version,
    decisionId: decision.id,
    implementationMappingId: mapping.id,
    conformanceId: conformance.id,
  };
  const review = createReverseCandidateReview({
    id: "REVIEW-JOURNEY",
    requestFingerprint: "JOURNEY-FINGERPRINT",
    runId: "REVERSE-RUN-JOURNEY",
    candidateId: "CANDIDATE-JOURNEY",
    outcome: "CONFIRMED",
    rationale: "Exercise the real governed application journey.",
    actorId: "PRODUCT-OWNER-JOURNEY",
    actorRole: "product-owner",
    baselineRefs,
  }, fixedClock);
  await store.appendReverseRun(projectId, {
    id: review.runId,
    projectId,
    snapshotManifestId: snapshotManifest.id,
    status: "WAITING_REVIEW",
  });
  await store.appendReverseCandidateReview(projectId, {
    review,
    feature,
    scope,
    claim,
    decision,
    implementationMapping: mapping,
    conformance,
  });

  const minimumDenominators = publicationDenominators();
  await store.appendUnderstandingRecord(projectId, "EVALUATION_RUN", {
    id: "EVALUATION-JOURNEY",
    status: "PASSED",
    policyVersion: "journey-v1",
    minimumDenominators,
    denominators: minimumDenominators,
    completedAt: fixedClock().toISOString(),
  });
  await store.appendUnderstandingRecord(projectId, "GRAPH_ARTIFACT", {
    id: graphArtifactId,
    projectId,
    snapshotManifestId: snapshotManifest.id,
    analysisRunId: "ANALYSIS-RUN-JOURNEY",
    graphArtifactDigest,
    nodes: [
      { id: featureId, type: "FEATURE", label: feature.name, authority: "GOVERNED_BASELINE" },
      { id: endpoint.id, type: "ENDPOINT", label: endpoint.name, authority: "DETERMINISTIC_FACT" },
    ],
    edges: [],
    traceChains: [],
    createdAt: fixedClock().toISOString(),
  });
  await store.appendUnderstandingRecord(projectId, "GRAPH_REVISION", {
    id: graphRevisionId,
    projectId,
    evaluationRunId: "EVALUATION-JOURNEY",
    mode: "FULL",
    baseRevisionId: null,
    snapshotManifestId: snapshotManifest.id,
    analysisRunId: "ANALYSIS-RUN-JOURNEY",
    graphArtifactId,
    graphArtifactDigest,
    status: "EVALUATING",
    createdAt: fixedClock().toISOString(),
  });
  await store.publishGraphRevision(projectId, graphRevisionId, 0);

  const server = createTraceabilityHttpServer({ application });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    projectId,
    featureId,
    endpointId: endpoint.id,
    snapshotManifestId: snapshotManifest.id,
    graphRevisionId,
  };
}
