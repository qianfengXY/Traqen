import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { TraceGapType } from "../src/domain/index.js";

test("trace-chain input contract is valid JSON Schema metadata", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/trace-chain-evaluation-input.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(contract.title, "TraceChainEvaluationInput");
  assert.ok(contract.required.includes("snapshotManifest"));
  assert.ok(contract.required.includes("evidence"));
});

test("trace-chain output contract stays aligned with domain gap types", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/trace-chain.schema.json", import.meta.url), "utf8"),
  );
  const contractGapTypes = contract.properties.gaps.items.properties.type.enum;

  assert.equal(contract.title, "TraceChain");
  assert.deepEqual([...contractGapTypes].sort(), Object.keys(TraceGapType).sort());
  assert.ok(contract.required.includes("segments"));
  assert.ok(contract.required.includes("conflicts"));
});

test("Workspace product schemas stay aligned with exported Web client response types", async () => {
  const [workspaceContract, jobContract, workspaceClient, jobClient] = await Promise.all([
    readFile(new URL("../contracts/workspace-product.schema.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../contracts/workspace-analysis-job.schema.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../web/app/workspace-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/server-understanding-client.ts", import.meta.url), "utf8"),
  ]);
  const workspaceType = workspaceClient.match(/export type Workspace = \{[\s\S]*?\n\};/)?.[0] ?? "";
  const jobType = jobClient.match(/export type ServerUnderstandingJob = \{[\s\S]*?\n\};/)?.[0] ?? "";
  for (const field of workspaceContract.$defs.Workspace.required) assert.match(workspaceType, new RegExp(`\\b${field}[?:]`));
  for (const field of jobContract.required) assert.match(jobType, new RegExp(`\\b${field}[?:]`));
});

test("OpenAPI contract exposes the implemented trace-chain routes", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/openapi.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.openapi, "3.1.0");
  assert.equal(contract.paths["/health"].get.operationId, "getHealth");
  assert.equal(contract.paths["/v1/analysis-model-profiles"].get.operationId, "listAnalysisModelProfiles");
  assert.equal(contract.paths["/v1/analysis-model-profiles"].post.operationId, "configureAnalysisModelProfile");
  assert.equal(contract.paths["/v1/analysis-model-profiles/{analysisModelProfileId}/verify"].post.operationId, "verifyAnalysisModelProfile");
  assert.equal(contract.paths["/v1/analysis-model-profiles/{analysisModelProfileId}/select"].post.operationId, "selectAnalysisModelProfile");
  assert.equal(contract.paths["/v1/analysis-model-profiles/{analysisModelProfileId}"].delete.operationId, "removeAnalysisModelProfile");
  assert.equal(contract.paths["/v1/analysis-model-profiles/{analysisModelProfileId}/workspace-enrichment"].post.operationId, "enrichWorkspaceCandidates");
  assert.equal(contract.paths["/v1/analysis-model-profiles/{analysisModelProfileId}/workspace-plan"].post.operationId, "planWorkspaceAnalysis");
  assert.equal(contract.paths["/v1/analysis-model-profiles"].post.requestBody.content["application/json"].schema.properties.apiKey.writeOnly, true);
  assert.equal(contract.paths["/v1/analysis-model-profiles"].post.requestBody.content["application/json"].schema.properties.stream.default, false);
  assert.ok(contract.components.schemas.AnalysisModelProfile.required.includes("active"));
  assert.deepEqual(
    contract.paths["/v1/analysis-model-profiles/{analysisModelProfileId}/workspace-enrichment"].post.requestBody.content["application/json"].schema.required,
    ["workUnit", "candidateBundle"],
  );
  assert.ok(contract.components.schemas.WorkspaceModelCandidate.required.includes("evidence"));
  assert.equal(contract.components.schemas.WorkspaceEvidenceAssessment.properties.confidenceCap.enum.includes("HIGH"), true);
  assert.ok(contract.paths["/v1/analysis-model-profiles/{analysisModelProfileId}/workspace-enrichment"].post.responses["200"].content["application/x-ndjson"]);
  assert.equal(contract.components.schemas.WorkspaceAnalysisPlan.properties.taskAssignments.minItems, 1);
  assert.equal(contract.paths["/v1/workspaces"].get.operationId, "listWorkspaces");
  const globalModelPath = contract.paths["/v1/global-models/{modelId}"];
  assert.equal(globalModelPath.get.operationId, "getGlobalModelProfile");
  assert.equal(globalModelPath.get.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/GlobalModelProfile");
  assert.equal(globalModelPath.put.operationId, "reviseGlobalModelProfile");
  assert.equal(globalModelPath.put.requestBody.content["application/json"].schema.$ref, "#/components/schemas/GlobalModelRevisionRequest");
  assert.equal(globalModelPath.put.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/GlobalModelProfile");
  assert.equal(contract.paths["/v1/workspaces"].post.operationId, "createWorkspace");
  assert.equal(contract.paths["/v1/workspaces/{workspaceId}"].patch.operationId, "renameWorkspace");
  assert.equal(
    contract.paths["/v1/workspaces/{workspaceId}/execution-profile-revisions"].post.operationId,
    "resolveWorkspaceExecutionProfileRevision",
  );
  assert.equal(
    contract.paths["/v1/workspaces/{workspaceId}/analysis-batches/{analysisBatchId}/barrier"].post.operationId,
    "openWorkspaceAnalysisBatchBarrier",
  );
  assert.equal(
    contract.paths["/v1/workspaces/{workspaceId}/review-decisions/batch"].post.operationId,
    "decideWorkspaceReviewBatch",
  );
  const workspaceOperations = [
    ["/v1/workspaces", "get", "200", false],
    ["/v1/workspaces", "post", "201", true],
    ["/v1/workspaces/{workspaceId}", "get", "200", false],
    ["/v1/workspaces/{workspaceId}", "patch", "200", true],
    ["/v1/workspaces/{workspaceId}/view-preference", "put", "200", true],
    ["/v1/workspaces/{workspaceId}/request-deletion", "post", "200", true],
    ["/v1/workspaces/{workspaceId}/cancel-deletion", "post", "200", true],
    ["/v1/workspaces/{workspaceId}/complete-deletion", "post", "200", true],
    ["/v1/capability-templates", "get", "200", false],
    ["/v1/capability-templates", "post", "201", true],
    ["/v1/workspaces/{workspaceId}/capability-configs", "post", "201", true],
    ["/v1/workspaces/{workspaceId}/execution-profile-revisions", "post", "201", true],
    ["/v1/workspaces/{workspaceId}/execution-profile-revisions/{profileRevisionId}/secret-grants", "post", "201", true],
    ["/v1/workspaces/{workspaceId}/analysis-batches", "post", "201", true],
    ["/v1/workspaces/{workspaceId}/analysis-batches/{analysisBatchId}/child-results", "post", "201", true],
    ["/v1/workspaces/{workspaceId}/analysis-batches/{analysisBatchId}/barrier", "post", "201", false],
    ["/v1/workspaces/{workspaceId}/review-queue", "get", "200", false],
    ["/v1/workspaces/{workspaceId}/review-decisions/batch", "post", "201", true],
  ];
  for (const [path, method, status, requiresBody] of workspaceOperations) {
    const operation = contract.paths[path][method];
    assert.ok(operation.responses[status].content["application/json"].schema, `${method.toUpperCase()} ${path} has a success schema`);
    if (requiresBody) assert.ok(
      operation.requestBody.$ref || operation.requestBody.content?.["application/json"]?.schema,
      `${method.toUpperCase()} ${path} has a request schema`,
    );
  }
  const reviewRequest = contract.paths["/v1/workspaces/{workspaceId}/review-decisions/batch"]
    .post.requestBody.content["application/json"].schema;
  assert.equal(reviewRequest.$ref, "./workspace-product.schema.json#/$defs/ReviewDecisionRequest");
  const workspaceProduct = JSON.parse(
    await readFile(new URL("../contracts/workspace-product.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(workspaceProduct.$defs.ReviewDecisionRequest.required.includes("reviewerId"), false);
  assert.equal(workspaceProduct.$defs.ReviewDecisionRequest.properties.reviewerId, undefined);
  assert.equal(contract.paths["/v1/projects"].post.operationId, "createProject");
  assert.equal(contract.paths["/v1/projects/{projectId}"].get.operationId, "getProject");
  assert.equal(
    contract.paths["/v1/projects/{projectId}/snapshots"].post.operationId,
    "registerSnapshot",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/snapshots"].get.operationId,
    "listSnapshotManifests",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features"].get.operationId,
    "listFeatures",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}"].get.operationId,
    "getFeature",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}/conflicts"].get.operationId,
    "getFeatureConflicts",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}/trace-chains"].get.operationId,
    "getFeatureTraceChains",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}/aliases"].post.operationId,
    "appendFeatureAlias",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/feature-lineages"].post.operationId,
    "appendFeatureLineage",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/metrics/platform-operations"].get.operationId,
    "getPlatformOperationsMetrics",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/decision-review-cases"].post.operationId,
    "createDecisionReviewCase",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/decision-review-cases/{caseId}/events"].post.operationId,
    "appendDecisionReviewEvent",
  );
  assert.equal(contract.components.securitySchemes.ApiToken.name, "x-traqen-api-token");
  assert.equal(
    contract.paths["/v1/trace-chains/evaluate"].post.operationId,
    "evaluateTraceChain",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/trace-chains/{chainId}"].get.operationId,
    "getCurrentTraceChain",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/claims"].post.operationId,
    "appendClaim",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}/baseline"].get.operationId,
    "getFeatureBaseline",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}/process-model"].post.operationId,
    "appendBusinessProcessModel",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}/traceability"].get.operationId,
    "getFeatureTraceability",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}/graph"].get.operationId,
    "getFeatureGraph",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}/graph/paths/query"].post.operationId,
    "queryFeatureGraphPath",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/graph/revisions/{revisionId}/evidence/{kind}/{evidenceId}"].get.operationId,
    "resolveGraphEvidence",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}/trace-chains/recompute"].post.operationId,
    "recomputeFeatureTraceChains",
  );
  assert.equal(
    contract.paths[
      "/v1/projects/{projectId}/features/{featureId}/claims/{claimId}/implementation-reanalyses"
    ].post.operationId,
    "reanalyzeFeatureImplementation",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/change-sets"].post.operationId,
    "compareSnapshotManifests",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/change-sets/{changeSetId}/impact"].get.operationId,
    "getChangeImpact",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/change-sets/{changeSetId}/continuous-protection"].get.operationId,
    "getContinuousProtectionAssessment",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/metrics/product-effectiveness"].get.operationId,
    "getProductEffectivenessMetrics",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/evidence/{evidenceId}/lifecycle"].get.operationId,
    "getEvidenceLifecycle",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/test-specs"].post.operationId,
    "appendTestSpec",
  );
  assert.equal(
    contract.paths[
      "/v1/projects/{projectId}/features/{featureId}/claims/{claimId}/test-spec-drafts"
    ].post.operationId,
    "generateTestSpecDraft",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/test-specs/{testSpecId}/approvals"].post.operationId,
    "approveTestSpec",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/test-specs/{testSpecId}/validate"].post.operationId,
    "validateStoredTestSpec",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/test-executions"].post.operationId,
    "ingestExecutionEvidence",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/test-executions/{executionId}/evidence"].get.operationId,
    "getExecutionEvidence",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/fact-scans"].post.operationId,
    "ingestFactBundle",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/workspace-observations"].post.operationId,
    "ingestWorkspaceObservations",
  );
  assert.equal(contract.paths["/v1/projects/{projectId}/facts"].get.operationId, "queryFacts");
  assert.equal(contract.paths["/v1/skills"].post.operationId, "registerReverseSkill");
  assert.equal(contract.paths["/v1/skills"].get.operationId, "listReverseSkills");
  assert.equal(contract.paths["/v1/projects/{projectId}/analysis-runs"].post.operationId, "startAnalysisRun");
  assert.equal(contract.paths["/v1/projects/{projectId}/analysis-runs/{analysisRunId}"].get.operationId, "getAnalysisRun");
  assert.equal(contract.paths["/v1/projects/{projectId}/analysis-runs/{analysisRunId}/pause"].post.operationId, "pauseAnalysisRun");
  assert.equal(contract.paths["/v1/projects/{projectId}/analysis-runs/{analysisRunId}/resume"].post.operationId, "resumeAnalysisRun");
  assert.equal(contract.paths["/v1/projects/{projectId}/analysis-results/latest"].get.operationId, "getLatestAnalysisResult");
  assert.equal(contract.paths["/v1/projects/{projectId}/analysis-candidates/{candidateId}/history"].get.operationId, "getAnalysisCandidateHistory");
  assert.equal(contract.paths["/v1/projects/{projectId}/graph/current"].get.operationId, "getCurrentUnderstandingGraph");
  assert.equal(contract.paths["/v1/projects/{projectId}/graph/revisions"].get.operationId, "listGraphRevisions");
  assert.equal(contract.paths["/v1/projects/{projectId}/graph/revisions/{revisionId}"].get.operationId, "getGraphRevision");
  assert.equal(contract.paths["/v1/projects/{projectId}/features/{featureId}/history"].get.operationId, "getFeatureUnderstandingHistory");
  assert.equal(contract.paths["/v1/projects/{projectId}/changes/{changeSetId}/impact"].get.operationId, "getUnderstandingChangeImpact");
  assert.equal(contract.paths["/v1/projects/{projectId}/analysis-runs/{analysisRunId}/work-units/{workUnitId}/source-slices"].post.operationId, "requestSourceSlice");
  assert.equal(contract.paths["/v1/projects/{projectId}/source-registrations"].post.operationId, "registerUnderstandingSource");
  assert.equal(contract.paths["/v1/workspaces/{workspaceId}/capability-configs"].get.operationId, "listWorkspaceCapabilityConfigs");
  assert.equal(contract.paths["/v1/workspaces/{workspaceId}/execution-profile-revisions"].get.operationId, "listWorkspaceExecutionProfileRevisions");
  assert.equal(contract.paths["/v1/projects/{projectId}/workspace-analysis-jobs"].post.operationId, "startWorkspaceUnderstandingJob");
  assert.equal(contract.paths["/v1/projects/{projectId}/workspace-analysis-jobs"].get.operationId, "listWorkspaceUnderstandingJobs");
  assert.ok(
    contract.paths["/v1/projects/{projectId}/workspace-analysis-jobs"].parameters.some(
      ({ name }) => name === "async",
    ),
  );
  assert.ok(contract.paths["/v1/projects/{projectId}/workspace-analysis-jobs"].post.responses["201"]);
  assert.ok(contract.paths["/v1/projects/{projectId}/workspace-analysis-jobs"].post.responses["202"]);
  assert.ok(contract.paths["/v1/projects/{projectId}/workspace-analysis-jobs"].post.requestBody.content["application/json"].schema.required.includes("workspaceExecutionProfileRevisionId"));
  const sourceSliceOperation = contract.paths["/v1/projects/{projectId}/analysis-runs/{analysisRunId}/work-units/{workUnitId}/source-slices"].post;
  assert.equal(
    contract.components.securitySchemes.SourceSliceWorkerCredential.name,
    "x-traqen-worker-credential",
  );
  assert.deepEqual(sourceSliceOperation.security[0], {
    ApiToken: [],
    SourceSliceWorkerCredential: [],
  });
  assert.ok(contract.paths["/v1/projects/{projectId}/graph/current"].get.responses["200"].content["application/json"].schema);
  assert.ok(contract.paths["/v1/projects/{projectId}/graph/revisions"].get.responses["200"].content["application/json"].schema);
  assert.ok(contract.paths["/v1/projects/{projectId}/graph/revisions/{revisionId}/publish"].post.responses["200"].content["application/json"].schema);
  assert.equal(contract.paths["/v1/projects/{projectId}/features/{featureId}/analysis-history"], undefined);
  assert.equal(contract.paths["/v1/reverse-runs"].post.operationId, "executeReverseRun");
  assert.equal(
    contract.paths["/v1/projects/{projectId}/reverse-runs/{runId}"].get.operationId,
    "getReverseRun",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/reverse-runs/{runId}/cancel"].post.operationId,
    "cancelReverseRun",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/reverse-runs/{runId}/resume"].post.operationId,
    "resumeReverseRun",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/reverse-runs/{runId}/candidates/{candidateId}/reviews"].post.operationId,
    "reviewReverseCandidate",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/reverse-runs/{runId}/reviews"].get.operationId,
    "listReverseCandidateReviews",
  );
});

test("Feature understanding history and SourceSlice HTTP surfaces have executable contracts", async () => {
  const [history, sourceSliceRequest, openapi] = await Promise.all([
    readFile(new URL("../contracts/feature-understanding-history.schema.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../contracts/source-slice-request.schema.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../contracts/openapi.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.deepEqual(history.$defs.AvailableHistory.required, [
    "feature",
    "featureVersions",
    "decisions",
    "implementationMappings",
    "graphRevisions",
    "testSpecs",
    "testExecutions",
  ]);
  assert.ok(history.$defs.HistoricalUnavailable.required.includes("historicalAvailability"));
  assert.equal(
    openapi.paths["/v1/projects/{projectId}/features/{featureId}/history"].get.responses["200"]
      .content["application/json"].schema.$ref,
    "./feature-understanding-history.schema.json",
  );
  assert.deepEqual(sourceSliceRequest.required, ["snapshotManifestId", "selectors", "policyDigest"]);
  assert.equal(
    openapi.paths["/v1/projects/{projectId}/analysis-runs/{analysisRunId}/work-units/{workUnitId}/source-slices"]
      .post.requestBody.content["application/json"].schema.$ref,
    "./source-slice-request.schema.json",
  );
});

test("reviewed correctness and equivalence evidence have fail-closed executable contracts", async () => {
  const [measurements, equivalence] = await Promise.all([
    readFile(new URL("../contracts/reviewed-understanding-measurement.schema.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../contracts/understanding-equivalence-evidence.schema.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.ok(measurements.required.includes("productionInputDigest"));
  assert.ok(measurements.required.includes("outputDigest"));
  assert.ok(measurements.required.includes("candidateReviews"));
  assert.equal(measurements.$defs.IndependentReview.properties.independent.const, true);
  assert.equal(measurements.$defs.LocalReferenceSynthetic.properties.independent.const, false);
  assert.equal(
    measurements.$defs.LocalReferenceSynthetic.properties.dataClassification.const,
    "LOCAL_DEVELOPMENT_REFERENCE_ONLY",
  );
  assert.equal(measurements.$defs.LocalReferenceSynthetic.properties.productionEligible.const, false);
  assert.equal(
    measurements.$defs.LocalReferenceSynthetic.properties.evaluationEvidenceType.const,
    "LOCAL_REFERENCE_SYNTHETIC",
  );
  assert.equal(measurements.oneOf.length, 2);
  const validateMeasurement = new Ajv2020({ strict: false, validateFormats: false }).compile(measurements);
  const independentMeasurement = {
    id: "MEASUREMENT-CONTRACT-1",
    projectId: "PROJECT-CONTRACT-1",
    analysisRunId: "ANALYSIS-CONTRACT-1",
    snapshotManifestId: "SNAPSHOT-CONTRACT-1",
    truthSetVersionId: "TRUTH-CONTRACT-1",
    reviewerId: "REVIEWER-CONTRACT-1",
    independent: true,
    productionInputDigest: "sha256:production",
    outputDigest: "sha256:output",
    anchorReviews: [],
    candidateReviews: [],
    relationReviews: [],
    gapReviews: [],
    reviewedAt: "2026-08-06T00:00:00.000Z",
    createdAt: "2026-08-06T00:00:00.000Z",
  };
  assert.equal(validateMeasurement(independentMeasurement), true, JSON.stringify(validateMeasurement.errors));
  const independentProductionMeasurement = {
    ...independentMeasurement,
    dataClassification: "INTERNAL",
    productionEligible: true,
    evaluationEvidenceType: "INDEPENDENT_REVIEW",
  };
  assert.equal(
    validateMeasurement(independentProductionMeasurement),
    true,
    JSON.stringify(validateMeasurement.errors),
  );
  const localSyntheticAuthority = {
    dataClassification: "LOCAL_DEVELOPMENT_REFERENCE_ONLY",
    productionEligible: false,
    evaluationEvidenceType: "LOCAL_REFERENCE_SYNTHETIC",
  };
  const localSyntheticAuthorityKeys = Object.keys(localSyntheticAuthority);
  for (let mask = 1; mask < (1 << localSyntheticAuthorityKeys.length); mask += 1) {
    const authoritySubset = Object.fromEntries(localSyntheticAuthorityKeys
      .filter((_, index) => mask & (1 << index))
      .map((key) => [key, localSyntheticAuthority[key]]));
    assert.equal(
      validateMeasurement({ ...independentMeasurement, ...authoritySubset }),
      false,
      `independent evidence must reject local synthetic authority subset ${JSON.stringify(authoritySubset)}`,
    );
  }
  assert.deepEqual(equivalence.required, [
    "analysisRunId", "snapshotManifestId", "replayAnalysisRunId", "fullAnalysisRunId",
  ]);
  assert.equal(equivalence.additionalProperties, false);
});

test("legacy GraphRevision recovery is an executable Snapshot-bound server command", async () => {
  const [availability, openapi, job] = await Promise.all([
    readFile(new URL("../contracts/historical-availability.schema.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../contracts/openapi.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../contracts/workspace-analysis-job.schema.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(availability.properties.recovery.oneOf.length, 2);
  assert.equal(availability.$defs.ExecutableRecovery.properties.executable.const, true);
  assert.equal(availability.$defs.ExecutableRecovery.properties.method.const, "POST");
  assert.equal(
    availability.$defs.ExecutableRecovery.properties.endpoint.pattern,
    "^/v1/projects/[^/]+/graph/revisions/[^/]+/reanalysis-jobs$",
  );
  assert.ok(availability.$defs.ExecutableRecovery.required.includes("sourceRegistrationId"));
  assert.ok(availability.$defs.ExecutableRecovery.required.includes("workspaceExecutionProfileRevisionId"));
  assert.equal(availability.$defs.UnavailableRecovery.properties.executable.const, false);
  assert.equal(
    availability.$defs.UnavailableRecovery.properties.action.const,
    "HISTORICAL_REANALYSIS_UNAVAILABLE",
  );
  const operation = openapi.paths["/v1/projects/{projectId}/graph/revisions/{revisionId}/reanalysis-jobs"].post;
  assert.equal(operation.operationId, "reanalyzeHistoricalGraphRevision");
  const request = operation.requestBody.content["application/json"].schema;
  assert.equal(request.required, undefined);
  assert.deepEqual(Object.keys(request.properties), ["policyDigest"]);
  assert.equal(request.additionalProperties, false);
  assert.equal(operation.responses["202"].content["application/json"].schema.$ref, "./workspace-analysis-job.schema.json");
  assert.ok(job.properties.purpose.enum.includes("HISTORICAL_REANALYSIS"));
  assert.equal(job.properties.reanalysisOfGraphRevisionId.type, "string");
  assert.deepEqual(job.allOf[0].else.not.required, ["reanalysisOfGraphRevisionId"]);
});

test("OpenAPI Workspace enrichment uses the canonical WorkUnit and CandidateBundle envelope", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/openapi.json", import.meta.url), "utf8"),
  );
  const operation = contract.paths["/v1/analysis-model-profiles/{analysisModelProfileId}/workspace-enrichment"].post;
  const request = operation.requestBody.content["application/json"].schema;
  const response = operation.responses["200"].content["application/json"].schema;

  assert.deepEqual(request.required, ["workUnit", "candidateBundle"]);
  assert.equal(request.properties.workUnit.$ref, "./candidate-bundle.schema.json#/$defs/WorkUnit");
  assert.equal(request.properties.candidateBundle.$ref, "./candidate-bundle.schema.json");
  assert.ok(response.required.includes("candidateBundle"));
  assert.equal(response.properties.candidateBundle.$ref, "./candidate-bundle.schema.json");
});

test("Analysis Agent contract makes resumability, bounded evidence, and Candidate-only projection explicit", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/analysis-agent.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.title, "AnalysisRunRequest");
  assert.ok(contract.required.includes("snapshotManifestId"));
  assert.ok(contract.$defs.WorkUnit.required.includes("boundary"));
  assert.equal(contract.$defs.WorkUnit.properties.boundary.$ref, "./candidate-bundle.schema.json#/$defs/WorkUnit");
  assert.equal(contract.$defs.WorkUnit.properties.output.oneOf[0].properties.candidateBundle.$ref, "./candidate-bundle.schema.json");
  assert.ok(contract.$defs.Checkpoint.required.includes("workUnits"));
  assert.ok(contract.$defs.Result.required.includes("candidates"));
  assert.ok(contract.$defs.Result.required.includes("candidateAbsences"));
  assert.deepEqual(contract.$defs.AnalyzedCandidate.properties.mode.enum, ["BUSINESS", "API"]);
  assert.equal(contract.$defs.AnalyzedCandidate.properties.nodeType.const, "CANDIDATE_FEATURE");
  assert.equal(contract.$defs.AnalyzedCandidate.properties.status.const, "PENDING_REVIEW");
  assert.equal(contract.$defs.AnalyzedCandidate.properties.governedFeatureId.type, "null");
  assert.equal(contract.$defs.AnalyzedCandidate.properties.authority, undefined);
});

test("FactBundle contract keeps facts locatable, snapshot-bound, and scanner-attested", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/fact-bundle.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "FactBundle");
  assert.ok(contract.required.includes("snapshotManifestId"));
  assert.ok(contract.required.includes("sourceComponentId"));
  assert.ok(contract.required.includes("attestation"));
  assert.deepEqual(contract.$defs.SourceLocation.required, ["artifact", "startLine", "endLine", "contentHash"]);
  assert.ok(contract.$defs.FactNode.properties.type.enum.includes("ENDPOINT"));
  assert.ok(contract.$defs.FactEdge.properties.predicate.enum.includes("IMPLEMENTED_BY"));
});

test("CandidateBundle contract binds every inference to one Snapshot and WorkUnit", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/candidate-bundle.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "CandidateBundle");
  assert.deepEqual(
    contract.$defs.WorkUnit.required,
    ["schemaVersion", "id", "projectId", "snapshotManifestId", "analysisRunId", "factIds", "rootFactIds"],
  );
  assert.ok(contract.required.includes("workUnitId"));
  assert.ok(contract.$defs.Candidate.required.includes("evidenceFactIds"));
  assert.equal(contract.$defs.Candidate.properties.evidenceFactIds.minItems, 1);
  assert.equal(contract.$defs.Candidate.properties.evidenceFactIds.uniqueItems, true);
  assert.deepEqual(
    contract.$defs.Candidate.properties.kind.enum,
    ["CANDIDATE_FEATURE", "CANDIDATE_CLAIM"],
  );
  assert.equal(contract.$defs.Candidate.properties.status.const, "PENDING_REVIEW");
  assert.equal(contract.$defs.Candidate.properties.proposal.$ref, "#/$defs/CandidateProposal");
  assert.equal(contract.$defs.CandidateProposal.additionalProperties, false);
  assert.equal(contract.$defs.CandidateProposal.properties.governedFeatureId, undefined);
  assert.equal(contract.$defs.CandidateProposal.properties.identityDecision, undefined);
  assert.equal(contract.$defs.CandidateProposal.properties.authority, undefined);
  assert.equal(contract.$defs.CandidateProposal.properties.design.$ref, "#/$defs/GovernanceFreeObject");
  assert.ok(contract.$defs.GovernanceFreeObject.propertyNames.not.enum.includes("governedFeatureId"));
  assert.ok(contract.$defs.GovernanceFreeObject.propertyNames.not.enum.includes("authority"));
});

test("Reverse Skill contracts bind supply-chain permissions, structured output, and audit history", async () => {
  const skill = JSON.parse(
    await readFile(new URL("../contracts/reverse-skill.schema.json", import.meta.url), "utf8"),
  );
  const run = JSON.parse(
    await readFile(new URL("../contracts/reverse-run.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(skill.title, "ReverseSkillRegistration");
  assert.ok(skill.required.includes("attestation"));
  assert.equal(skill.properties.permissions.properties.shell.const, "NONE");
  assert.ok(skill.properties.capabilities.items.$ref);
  assert.equal(run.title, "ReverseRunRequest");
  assert.ok(run.required.includes("factBundleIds"));
  assert.ok(run.$defs.ReverseRun.required.includes("statusHistory"));
  assert.ok(run.$defs.ReverseArtifactBundle.required.includes("rawOutputHash"));
});

test("asynchronous Reverse Run contract exposes durable ordered status and cancellation", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/reverse-run-job.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.title, "ReverseRunJob");
  assert.ok(contract.required.includes("cancelRequested"));
  assert.ok(contract.properties.status.enum.includes("CANCEL_REQUESTED"));
  assert.ok(contract.$defs.Event.properties.status.enum.includes("FAILED"));
});

test("governance contract defines immutable version fields", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/governance.schema.json", import.meta.url), "utf8"),
  );

  assert.ok(contract.$defs.FeatureVersion.required.includes("version"));
  assert.ok(contract.$defs.Claim.required.includes("scopeVersion"));
  assert.ok(contract.$defs.Decision.required.includes("claimVersion"));
  assert.equal(contract.$defs.DecisionRequest.properties.actorId, undefined);
  assert.ok(contract.$defs.FeatureBaseline.required.includes("testSpecs"));
  assert.ok(contract.$defs.FeatureBaseline.required.includes("testExecutions"));
  assert.ok(contract.$defs.FeatureBaseline.required.includes("implementationMappings"));
  assert.ok(contract.$defs.FeatureBaseline.required.includes("conformances"));
  assert.ok(contract.$defs.FeatureBaseline.required.includes("processModel"));
  assert.ok(contract.$defs.Claim.properties.constraint);
});

test("business process contract keeps authority server-owned and implementation links Snapshot-bound", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/business-process-model.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.title, "BusinessProcessModel");
  assert.equal(contract.$defs.Input.properties.featureId, undefined);
  assert.equal(contract.$defs.Input.properties.authority.properties.actorId, undefined);
  assert.ok(contract.$defs.Model.required.includes("featureId"));
  assert.ok(contract.$defs.Model.properties.authority.required.includes("actorId"));
  assert.ok(contract.$defs.Transition.properties.implementationFactRefs.items.$ref);
});

test("Decision governance contract makes multi-party review and Break-glass lifecycle explicit", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/decision-governance.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.title, "DecisionGovernance");
  assert.equal(contract.$defs.CaseRequest.properties.proposerId, undefined);
  assert.equal(contract.$defs.EventRequest.properties.actorId, undefined);
  assert.ok(contract.$defs.Case.properties.approvalMode.enum.includes("BREAK_GLASS"));
  assert.ok(contract.$defs.Event.properties.action.enum.includes("POST_REVIEW"));
  assert.ok(contract.$defs.Evaluation.properties.status.enum.includes("POST_REVIEW_OVERDUE"));
});

test("Evidence lifecycle contract keeps Legal Hold, deletion proof, and access audit explicit", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/evidence-lifecycle.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.title, "EvidenceLifecycle");
  assert.equal(contract.$defs.PolicyRequest.properties.actorId, undefined);
  assert.equal(contract.$defs.EventRequest.properties.actorId, undefined);
  assert.ok(contract.$defs.EventRequest.properties.action.enum.includes("LEGAL_HOLD_PLACED"));
  assert.ok(contract.$defs.Projection.properties.status.enum.includes("DELETION_BLOCKED_LEGAL_HOLD"));
  assert.ok(contract.$defs.Projection.required.includes("deletionProof"));
});

test("candidate review contract keeps reviewer identity server-side and baseline creation explicit", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/candidate-review.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "ReverseCandidateReviewRequest");
  assert.equal(contract.properties.actorId, undefined);
  assert.ok(contract.required.includes("outcome"));
  assert.ok(contract.$defs.NormativeDecision.required.includes("constraint"));
  assert.ok(contract.$defs.ReviewPackage.required.includes("implementationMapping"));
  assert.ok(contract.$defs.ImplementationConformance.required.includes("snapshotManifestId"));
});

test("Feature traceability contract exposes independent dimensions, ordered chains, and gaps", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/feature-traceability.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "FeatureTraceability");
  assert.ok(contract.$defs.AvailableTraceability.required.includes("dimensions"));
  assert.ok(contract.$defs.AvailableTraceability.required.includes("traceChains"));
  assert.ok(contract.$defs.AvailableTraceability.required.includes("gaps"));
  assert.ok(contract.$defs.AvailableTraceability.required.includes("processModel"));
  assert.ok(contract.$defs.HistoricalUnavailable.required.includes("historicalAvailability"));
  assert.ok(contract.$defs.ClaimTraceability.required.includes("facts"));
  assert.ok(contract.$defs.ClaimTraceability.required.includes("traceChain"));
});

test("Feature graph contract keeps projections bounded, typed, and path-queryable", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/feature-graph.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "FeatureGraph");
  assert.ok(contract.$defs.Projection.required.includes("availableExpansions"));
  assert.equal(contract.$defs.Projection.properties.depth.maximum, 8);
  assert.equal(contract.$defs.Node.properties.status.enum.includes("GAP"), true);
  assert.ok(contract.$defs.Edge.required.includes("snapshotManifestId"));
  assert.equal(contract.$defs.Edge.properties.evidenceResolver.pattern, "^/v1/");
  assert.equal(contract.$defs.Node.properties.evidenceResolver.pattern, "^/v1/");
  assert.ok(contract.$defs.Projection.properties.graphRevisionId);
  assert.equal(contract.$defs.PathResult.properties.query.properties.maxDepth.maximum, 12);
});

test("change-impact contract separates invalidated derived layers from preserved business truth", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/change-impact.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "ChangeImpact");
  assert.ok(contract.$defs.ChangeSet.required.includes("changes"));
  assert.ok(contract.$defs.ImpactAssessment.required.includes("invalidations"));
  assert.ok(contract.$defs.Invalidation.required.includes("layers"));
  assert.ok(contract.$defs.Invalidation.required.includes("preserves"));
  assert.ok(contract.$defs.Invalidation.required.includes("scopeId"));
  assert.ok(contract.$defs.Invalidation.required.includes("recommendedActions"));
  assert.ok(contract.required.includes("continuities"));
  assert.ok(contract.$defs.ImpactAssessment.required.includes("continuedFeatureIds"));
  assert.ok(contract.$defs.ImplementationContinuity.required.includes("factRefRebindings"));
});

test("continuous-protection contract keeps regression selection and gate enforcement explainable", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/continuous-protection.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "ContinuousProtectionAssessment");
  assert.ok(contract.required.includes("regressionPlan"));
  assert.ok(contract.required.includes("featureAssessments"));
  assert.deepEqual(contract.$defs.QualityGate.properties.status.enum, ["PASS", "BLOCKED", "UNKNOWN"]);
  assert.deepEqual(contract.$defs.QualityGate.properties.enforcement.enum, ["PASS", "WARN", "REQUIRE_APPROVAL", "FAIL"]);
  assert.ok(contract.$defs.SelectedTest.required.includes("reasons"));
});

test("product-effectiveness metrics contract exposes causes and never defines a composite score", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/product-effectiveness-metrics.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.title, "ProductEffectivenessMetrics");
  assert.ok(contract.required.includes("gapBreakdown"));
  assert.ok(contract.required.includes("unavailableMetrics"));
  assert.equal(contract.properties.compositeScore, undefined);
  assert.equal(contract.$defs.Rate.properties.ratio.maximum, 1);
  assert.ok(contract.$defs.FeatureMetric.required.includes("dimensions"));
});

test("implementation reanalysis contract keeps actor identity server-side and reuses governed records", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/implementation-reanalysis.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "ImplementationReanalysisPackage");
  assert.deepEqual(contract.$defs.ImplementationReanalysisRequest.required, [
    "id", "sourceRunId", "sourceCandidateId", "rationale",
  ]);
  assert.equal(contract.$defs.ImplementationReanalysisRequest.properties.actorId, undefined);
  assert.match(contract.properties.implementationMapping.$ref, /ImplementationMapping/);
  assert.match(contract.properties.conformance.$ref, /ImplementationConformance/);
});

test("TestSpec contract exposes traceability and execution-policy boundaries", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/test-spec.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "TestSpec");
  assert.ok(contract.required.includes("verifiesClaims"));
  assert.ok(contract.required.includes("assertions"));
  assert.ok(contract.required.includes("approval"));
  assert.ok(contract.required.includes("origin"));
  assert.ok(contract.$defs.Origin.required.includes("requestFingerprint"));
  assert.deepEqual(contract.properties.environment.properties.operationLevel.enum, [
    "SAFE_READ",
    "CONTROLLED_WRITE",
    "DESTRUCTIVE",
    "EXTERNAL_SIDE_EFFECT",
  ]);
  assert.ok(contract.$defs.ValidationResult.required.includes("executable"));
});

test("TestSpec conversion contract separates public drafts, generated provenance, and approvals", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/test-spec-generation.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "TestSpecGenerationRequest");
  assert.ok(contract.required.includes("snapshotManifestId"));
  assert.equal(contract.$defs.ManualDraftRequest.properties.approved.const, false);
  assert.equal(contract.$defs.ManualDraftRequest.properties.approval, undefined);
  assert.equal(contract.$defs.ManualDraftRequest.properties.origin, undefined);
  assert.deepEqual(contract.$defs.ApprovalRequest.required, ["expectedVersion", "rationale"]);
  assert.ok(contract.properties.databaseVerification);
  assert.ok(contract.properties.pathParameters);
  assert.equal(contract.$defs.DatabaseFieldAssertion.properties.type.const, "DATABASE_FIELD");
  assert.ok(contract.$defs.GenerationResult.required.includes("generation"));
});

test("execution Evidence contract binds results to Runner, TestSpec, manifest, and deployment", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/execution-evidence.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "ExecutionEvidenceBundle");
  assert.ok(contract.$defs.TestExecution.required.includes("snapshotManifestId"));
  assert.ok(contract.$defs.TestExecution.required.includes("deploymentId"));
  assert.ok(contract.$defs.TestExecution.required.includes("runner"));
  assert.ok(contract.$defs.Attempt.required.includes("setup"));
  assert.ok(contract.$defs.Attempt.required.includes("cleanup"));
  assert.ok(contract.$defs.EvidenceManifest.required.includes("snapshotComponents"));
  assert.equal(contract.$defs.SnapshotComponent.properties.digest.pattern, "^sha256:[a-f0-9]{64}$");
  assert.equal(contract.$defs.RunnerAttestation.properties.algorithm.const, "HMAC-SHA256");
  assert.ok(contract.$defs.StoredExecutionEvidence.allOf[1].properties.evidence.items.allOf[1].required.includes("integrity"));
});

test("Runner task contract requires replay protection, policy binding, and a target Runner", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/runner-task.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "RunnerTask");
  assert.equal(contract.$defs.SnapshotComponent.properties.digest.pattern, "^sha256:[a-f0-9]{64}$");
  assert.ok(contract.required.includes("nonce"));
  assert.ok(contract.required.includes("policyHash"));
  assert.ok(contract.required.includes("runnerId"));
  assert.ok(contract.required.includes("expiresAt"));
  assert.equal(contract.$defs.TaskAttestation.properties.algorithm.const, "HMAC-SHA256");
});

test("Feature evolution contract keeps aliases versioned and lineage human-governed", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/feature-evolution.schema.json", import.meta.url), "utf8"),
  );
  assert.ok(contract.$defs.FeatureAlias.required.includes("featureVersion"));
  assert.ok(contract.$defs.FeatureAlias.required.includes("actorId"));
  assert.deepEqual(contract.$defs.FeatureLineage.properties.relationType.enum, [
    "PREDECESSOR_OF", "SUCCESSOR_OF", "MERGED_INTO", "SPLIT_INTO",
  ]);
  assert.ok(contract.$defs.FeatureLineage.required.includes("rationale"));
});

test("platform operations metrics contract makes unavailable telemetry explicit", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/platform-operations-metrics.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.title, "PlatformOperationsMetrics");
  assert.ok(contract.required.includes("unavailableSignals"));
  assert.equal(contract.properties.unavailableSignals.items.properties.status.const, "UNAVAILABLE");
});
