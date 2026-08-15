import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { AnalysisModelConnectionError, AnalysisModelRegistry } from "../src/analysis/index.js";
import {
  createExecutionEvidenceBundle,
  createFactBundle,
  signExecutionEvidenceBundle,
  signFactBundle,
  signReverseSkillManifest,
} from "../src/domain/index.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";
import { createReferenceSkillSet, ReverseSkillOrchestrator } from "../src/skills/index.js";

const fixedClock = () => new Date("2026-07-14T04:00:00.000Z");

function schemaErrors(value, schema, rootSchema, location = "$") {
  if (schema.$ref) {
    const target = schema.$ref.slice(2).split("/").reduce((current, segment) => current[segment], rootSchema);
    return schemaErrors(value, target, rootSchema, location);
  }
  if (schema.oneOf) {
    return schema.oneOf.filter((option) => schemaErrors(value, option, rootSchema, location).length === 0).length === 1
      ? []
      : [`${location} must match exactly one oneOf branch`];
  }
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${location} is outside enum`);
  if (Object.hasOwn(schema, "const") && value !== schema.const) errors.push(`${location} does not match const`);
  if (schema.type === "null" && value !== null) errors.push(`${location} must be null`);
  if (schema.type === "string") {
    if (typeof value !== "string") errors.push(`${location} must be a string`);
    else {
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${location} is too short`);
      if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${location} must be a date-time`);
    }
  }
  if (schema.type === "integer" && !Number.isInteger(value)) errors.push(`${location} must be an integer`);
  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum) {
    errors.push(`${location} is below minimum`);
  }
  if (schema.type === "boolean" && typeof value !== "boolean") errors.push(`${location} must be a boolean`);
  if (schema.type === "array") {
    if (!Array.isArray(value)) errors.push(`${location} must be an array`);
    else {
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location} has too few items`);
      if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
        errors.push(`${location} items must be unique`);
      }
      if (schema.items) value.forEach((item, index) => errors.push(
        ...schemaErrors(item, schema.items, rootSchema, `${location}[${index}]`),
      ));
    }
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) errors.push(`${location} must be an object`);
    else {
      for (const required of schema.required ?? []) {
        if (!Object.hasOwn(value, required)) errors.push(`${location}.${required} is required`);
      }
      for (const [key, item] of Object.entries(value)) {
        const propertySchema = schema.properties?.[key];
        if (propertySchema) errors.push(...schemaErrors(item, propertySchema, rootSchema, `${location}.${key}`));
        else if (schema.additionalProperties === false) errors.push(`${location}.${key} is not allowed`);
        else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
          errors.push(...schemaErrors(item, schema.additionalProperties, rootSchema, `${location}.${key}`));
        }
      }
    }
  }
  return errors;
}

async function exampleInput() {
  return JSON.parse(await readFile(new URL("../examples/order-submit.json", import.meta.url), "utf8"));
}

async function startServer(t, options = {}) {
  const {
    runnerKeyResolver,
    scannerKeyResolver,
    publisherKeyResolver,
    installedSkillResolver,
    skillPolicyResolver,
    reverseOrchestrator,
    reviewerResolver,
    reviewPolicyResolver,
    implementationReviewerResolver,
    implementationPolicyResolver,
    continuousProtectionPolicyResolver,
    productMetricsPolicyResolver,
    analysisAgent,
    analysisModelRegistry,
    setup,
    ...serverOptions
  } = options;
  const store = new MemoryTraceabilityStore();
  const application = new TraceabilityApplication({
    store,
    clock: fixedClock,
    runnerKeyResolver,
    scannerKeyResolver,
    publisherKeyResolver,
    installedSkillResolver,
    skillPolicyResolver,
    reverseOrchestrator,
    reviewerResolver,
    reviewPolicyResolver,
    implementationReviewerResolver,
    implementationPolicyResolver,
    continuousProtectionPolicyResolver,
    productMetricsPolicyResolver,
    analysisAgent,
    analysisModelRegistry,
  });
  await setup?.({ store, application });
  const server = createTraceabilityHttpServer({ application, ...serverOptions });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function startStubServer(t, application) {
  const server = createTraceabilityHttpServer({ application });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("health endpoint returns a request correlation ID", async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/health`, {
    headers: { "x-request-id": "request-health-001" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), "request-health-001");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("Workspace API owns lifecycle, capability isolation, and same-batch Child execution", async (t) => {
  let workspaceStore;
  const baseUrl = await startServer(t, {
    analysisModelRegistry: new AnalysisModelRegistry({
      fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }),
    }),
    reviewerResolver: (_projectId, context) => context.authorization === "Bearer workspace-reviewer"
      ? { actorId: "REVIEWER-FROM-AUTH", actorRole: "business-owner" }
      : null,
    setup: ({ store }) => { workspaceStore = store; },
  });
  const workspaceContract = JSON.parse(await readFile(
    new URL("../contracts/workspace-product.schema.json", import.meta.url),
    "utf8",
  ));
  const openApiContract = JSON.parse(await readFile(
    new URL("../contracts/openapi.json", import.meta.url),
    "utf8",
  ));
  const assertPayloadShape = (value, definitionName) => assert.deepEqual(
    schemaErrors(value, workspaceContract.$defs[definitionName], workspaceContract),
    [],
    `${definitionName} must satisfy its executable JSON Schema`,
  );
  const created = await postJson(`${baseUrl}/v1/workspaces`, {
    organization: { id: "O-WORKSPACE", name: "Workspace Org" },
    tenant: { id: "T-WORKSPACE", name: "Workspace Tenant" },
    project: { id: "W-HTTP", name: "HTTP Workspace" },
    principals: [],
    actorId: "OWNER",
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.workspaceId, "W-HTTP");
  assertPayloadShape(created.body, "Workspace");

  const hiddenResponse = await fetch(`${baseUrl}/v1/workspaces/W-HTTP/view-preference`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "OWNER", hidden: true }),
  });
  assert.equal(hiddenResponse.status, 200);
  const listed = await fetch(`${baseUrl}/v1/workspaces?userId=OWNER`);
  assert.equal((await listed.json()).workspaces[0].hidden, true);

  assert.equal((await postJson(`${baseUrl}/v1/global-models`, {
    profileId: "main-model",
    displayName: "Main model",
    transport: "API",
    endpoint: "https://models.example/v1",
    model: "main-model",
    apiKey: "server-only-secret",
  })).response.status, 201);
  assert.equal((await fetch(`${baseUrl}/v1/global-models/main-model/verify`, { method: "POST" })).status, 200);
  const draft = await fetch(`${baseUrl}/v1/workspaces/W-HTTP/capability-draft`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedVersion: 0,
      mainAgentSlot: { modelProfileId: "main-model" },
      childAgentSlots: [
        { id: "C1", modelProfileId: "main-model", independenceGroup: "I1" },
        { id: "C2", modelProfileId: "main-model", independenceGroup: "I2" },
      ],
      projectCapabilityRevisionIds: [],
      disabledKeys: [],
    }),
  });
  assert.equal(draft.status, 200);
  const savedDraft = await draft.json();
  assert.deepEqual(
    schemaErrors(savedDraft, openApiContract.components.schemas.WorkspaceCapabilityDraft, openApiContract),
    [],
    "saved Workspace capability policy must satisfy its executable OpenAPI response contract",
  );
  const restoredDraft = await fetch(`${baseUrl}/v1/workspaces/W-HTTP/capability-draft`);
  assert.equal(restoredDraft.status, 200);
  assert.deepEqual(
    schemaErrors(await restoredDraft.json(), openApiContract.components.schemas.WorkspaceCapabilityDraftEnvelope, openApiContract),
    [],
    "restored Workspace capability policy must satisfy its executable OpenAPI response contract",
  );
  const profileResponse = await fetch(`${baseUrl}/v1/workspaces/W-HTTP/capability-draft/activate`, { method: "POST" });
  assert.equal(profileResponse.status, 201);
  const profile = await profileResponse.json();
  const listedProfiles = await fetch(`${baseUrl}/v1/workspaces/W-HTTP/execution-profile-revisions`);
  assert.equal(listedProfiles.status, 200);
  assert.deepEqual((await listedProfiles.json()).profiles.map(({ id }) => id), [profile.id]);

  const batch = await postJson(`${baseUrl}/v1/workspaces/W-HTTP/analysis-batches`, {
    snapshotManifestId: "S-HTTP",
    analysisRunId: "R-HTTP",
    profileRevisionId: profile.id,
    sequence: 1,
    sourceScope: { artifactIds: ["A-HTTP"] },
    taskStatement: "Recover bounded semantics",
    outputSchema: { type: "object" },
    sourcePolicy: { maxBytes: 1000 },
  });
  assert.equal(batch.response.status, 201);
  assert.equal(batch.body.assignments.length, 2);
  assert.equal(batch.body.assignments[0].inputDigest, batch.body.assignments[1].inputDigest);

  const earlyBarrier = await fetch(
    `${baseUrl}/v1/workspaces/W-HTTP/analysis-batches/${encodeURIComponent(batch.body.batch.id)}/barrier`,
    { method: "POST" },
  );
  assert.equal(earlyBarrier.status, 400);
  for (const assignment of batch.body.assignments) {
    const child = await postJson(
      `${baseUrl}/v1/workspaces/W-HTTP/analysis-batches/${encodeURIComponent(batch.body.batch.id)}/child-results`,
      {
        analysisRunId: "R-HTTP",
        childWorkUnitId: assignment.id,
        slotId: assignment.slotId,
        inputDigest: assignment.inputDigest,
        independenceGroup: assignment.route.independenceGroup,
        status: "COMPLETED",
        output: { candidates: [] },
      },
    );
    assert.equal(child.response.status, 201);
  }
  const opened = await fetch(
    `${baseUrl}/v1/workspaces/W-HTTP/analysis-batches/${encodeURIComponent(batch.body.batch.id)}/barrier`,
    { method: "POST" },
  );
  assert.equal(opened.status, 201);
  assert.equal((await opened.json()).opened, true);

  await workspaceStore.appendUnderstandingRecord("W-HTTP", "REVIEW_QUEUE_ITEM", {
    id: "REVIEW-HTTP-1", workspaceId: "W-HTTP", version: 1, status: "PENDING",
    severity: "REVIEW", evidenceState: "EVIDENCE_VALIDATED", source: "RECONCILIATION",
    analysisBatchId: batch.body.batch.id, createdAt: fixedClock().toISOString(),
  });
  const reviewRequest = {
    itemIds: ["REVIEW-HTTP-1"], outcome: "CONFIRMED",
    rationale: "The authorized reviewer checked the evidence.", edits: {},
  };
  assertPayloadShape(reviewRequest, "ReviewDecisionRequest");
  const reviewed = await postJson(
    `${baseUrl}/v1/workspaces/W-HTTP/review-decisions/batch`,
    reviewRequest,
    { authorization: "Bearer workspace-reviewer" },
  );
  assert.equal(reviewed.response.status, 201);
  assert.equal(reviewed.body.reviewerId, "REVIEWER-FROM-AUTH");
  assertPayloadShape(reviewed.body, "ReviewDecision");

  for (const action of ["request-deletion", "cancel-deletion", "request-deletion", "complete-deletion"]) {
    const transition = await postJson(`${baseUrl}/v1/workspaces/W-HTTP/${action}`, { actorId: "OWNER" });
    assert.equal(transition.response.status, 200);
  }
  const afterDelete = await fetch(`${baseUrl}/v1/workspaces?includeDeleted=true`);
  assert.equal((await afterDelete.json()).workspaces[0].lifecycleState, "DELETED");
});

test("Analysis Agent HTTP surface starts, checkpoints, resumes, and exposes latest/history projections", async (t) => {
  const calls = [];
  const checkpoint = { run: { id: "ANALYSIS-HTTP", status: "PAUSED" }, workUnits: [] };
  const application = {
    async submitAnalysisRun(input) { calls.push(["start", input]); return checkpoint; },
    async getAnalysisRun(projectId, runId) { calls.push(["get", projectId, runId]); return checkpoint; },
    async pauseAnalysisRun(projectId, runId) { calls.push(["pause", projectId, runId]); return checkpoint; },
    async resumeAnalysisRun(projectId, runId) { calls.push(["resume", projectId, runId]); return checkpoint; },
    async getLatestAnalysisResult(projectId) { calls.push(["latest", projectId]); return { id: "ANALYSIS-HTTP", projectId, candidates: [] }; },
    async getAnalysisCandidateHistory(projectId, candidateId) { calls.push(["history", projectId, candidateId]); return [{ runId: "ANALYSIS-HTTP" }]; },
  };
  const baseUrl = await startStubServer(t, application);
  const started = await postJson(`${baseUrl}/v1/projects/PROJECT-HTTP/analysis-runs`, {
    id: "ANALYSIS-HTTP",
    snapshotManifestId: "SNAPSHOT-HTTP",
    sourceComponentId: "SOURCE-HTTP",
    profile: { id: "deterministic", mode: "DETERMINISTIC" },
  });
  assert.equal(started.response.status, 202);
  assert.equal(calls[0][1].projectId, "PROJECT-HTTP");
  assert.equal((await fetch(`${baseUrl}/v1/projects/PROJECT-HTTP/analysis-runs/ANALYSIS-HTTP`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/v1/projects/PROJECT-HTTP/analysis-runs/ANALYSIS-HTTP/pause`, { method: "POST" })).status, 202);
  assert.equal((await fetch(`${baseUrl}/v1/projects/PROJECT-HTTP/analysis-runs/ANALYSIS-HTTP/resume`, { method: "POST" })).status, 202);
  assert.equal((await fetch(`${baseUrl}/v1/projects/PROJECT-HTTP/analysis-results/latest`)).status, 200);
  const history = await fetch(`${baseUrl}/v1/projects/PROJECT-HTTP/analysis-candidates/CANDIDATE-HTTP/history`);
  assert.deepEqual((await history.json()).history, [{ runId: "ANALYSIS-HTTP" }]);
});

test("Feature understanding history returns the complete canonical response shape", async (t) => {
  const expected = {
    feature: { id: "FEATURE-1", version: 1, name: "Checkout" },
    featureVersions: [{ id: "FEATURE-1", version: 1 }],
    decisions: [],
    implementationMappings: [],
    graphRevisions: [],
    testSpecs: [],
    testExecutions: [],
  };
  const application = {
    async getFeatureUnderstandingHistory(projectId, featureId) {
      assert.equal(projectId, "PROJECT-HTTP");
      assert.equal(featureId, "FEATURE-1");
      return expected;
    },
  };
  const baseUrl = await startStubServer(t, application);
  const response = await fetch(`${baseUrl}/v1/projects/PROJECT-HTTP/features/FEATURE-1/history`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
  const schema = JSON.parse(
    await readFile(new URL("../contracts/feature-understanding-history.schema.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    Object.keys(expected).sort(),
    Object.keys(schema.$defs.AvailableHistory.properties)
      .filter((property) => Object.hasOwn(expected, property)).sort(),
  );
  assert.ok(schema.$defs.HistoricalUnavailable.required.includes("historicalAvailability"));
});

test("F006 exposes no legacy global-active or unscoped model invocation surface", async (t) => {
  const baseUrl = await startServer(t, { analysisModelRegistry: new AnalysisModelRegistry() });
  for (const [path, method] of [
    ["/v1/analysis-model-profiles", "GET"],
    ["/v1/analysis-model-profiles/MODEL-1/select", "POST"],
    ["/v1/analysis-model-profiles/MODEL-1/workspace-enrichment", "POST"],
    ["/v1/analysis-model-profiles/MODEL-1/workspace-plan", "POST"],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
    });
    assert.equal(response.status, 404, `${method} ${path} must not bypass the Workspace execution-profile boundary`);
  }
});

test("analysis model connectivity failures use a distinct gateway error", async (t) => {
  const application = {
    async verifyGlobalModelProfile() {
      throw new AnalysisModelConnectionError("Unable to reach the configured analysis model");
    },
  };
  const baseUrl = await startStubServer(t, application);
  const response = await fetch(`${baseUrl}/v1/global-models/workspace-default/verify`, { method: "POST" });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "ANALYSIS_MODEL_UNAVAILABLE");
});

test("F006 exposes no legacy template or capability-config mutation authority", async (t) => {
  const baseUrl = await startServer(t);
  assert.equal((await fetch(`${baseUrl}/v1/capability-templates`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/v1/workspaces/W1/capability-configs`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/v1/workspaces/W1/execution-profile-revisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ configId: "LEGACY-CONFIG" }),
  })).status, 404);
});

test("global CLI model API cannot bypass the adapter executable allowlist", async (t) => {
  const baseUrl = await startServer(t, { analysisModelRegistry: new AnalysisModelRegistry() });
  const rejected = await postJson(`${baseUrl}/v1/global-models`, {
    profileId: "CLI-ESCAPE",
    displayName: "Escaped CLI",
    transport: "CLI",
    cliAdapter: "CODEX",
    executablePath: "/tmp/not-allowlisted",
  });
  assert.equal(rejected.response.status, 400);
  assert.match(rejected.body.error.message, /allowlist/);

  const accepted = await postJson(`${baseUrl}/v1/global-models`, {
    profileId: "CLI-SAFE",
    displayName: "Safe CLI",
    transport: "CLI",
    cliAdapter: "CODEX",
    executablePath: "codex",
  });
  assert.equal(accepted.response.status, 201);
  assert.equal(accepted.body.executablePath, "codex");

  const read = await fetch(`${baseUrl}/v1/global-models/CLI-SAFE`);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).profileId, "CLI-SAFE");
  const updated = await fetch(`${baseUrl}/v1/global-models/CLI-SAFE`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: accepted.body.revision, displayName: "Revised CLI", transport: "CLI", cliAdapter: "KIMI", executablePath: "kimi" }),
  });
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json();
  assert.equal(updatedBody.profileId, "CLI-SAFE");
  assert.equal(updatedBody.revision, accepted.body.revision + 1);
  assert.equal(updatedBody.displayName, "Revised CLI");
  assert.equal((await fetch(`${baseUrl}/v1/global-models/DOES-NOT-EXIST`)).status, 404);
});

test("global model GET and PUT contracts never return API credential values", async (t) => {
  const baseUrl = await startServer(t, { analysisModelRegistry: new AnalysisModelRegistry() });
  const created = await postJson(`${baseUrl}/v1/global-models`, {
    profileId: "MODEL-EDIT",
    displayName: "Original",
    transport: "API",
    endpoint: "https://models.example/v1",
    model: "original",
    apiKey: "server-only-original",
  });
  assert.equal(created.response.status, 201);
  const updated = await fetch(`${baseUrl}/v1/global-models/MODEL-EDIT`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: created.body.revision, displayName: "Updated", transport: "API", endpoint: "https://models.example/v1", model: "updated", apiKey: "" }),
  });
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json();
  const read = await fetch(`${baseUrl}/v1/global-models/MODEL-EDIT`);
  assert.equal(read.status, 200);
  const body = await read.json();
  const openApiContract = JSON.parse(await readFile(new URL("../contracts/openapi.json", import.meta.url), "utf8"));
  for (const [operation, payload] of [["PUT", updatedBody], ["GET", body]]) {
    assert.deepEqual(
      schemaErrors(payload, openApiContract.components.schemas.GlobalModelProfile, openApiContract),
      [],
      `${operation} single-model response must satisfy the exact executable GlobalModelProfile contract`,
    );
  }
  assert.equal(body.displayName, "Updated");
  assert.equal(body.model, "updated");
  assert.equal(JSON.stringify(body).includes("server-only-original"), false);
  assert.equal(Object.hasOwn(body, "apiKey"), false);
  const uncontracted = await fetch(`${baseUrl}/v1/global-models/MODEL-EDIT`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: updatedBody.revision, displayName: "Uncontracted", transport: "API", endpoint: "https://models.example/v1", model: "updated", unexpectedCredentialAlias: "bypass" }),
  });
  assert.equal(uncontracted.status, 400, "PUT must reject fields outside the executable revision contract");
});

test("global model revisions require an expected revision and reject stale writers", async (t) => {
  const baseUrl = await startServer(t, { analysisModelRegistry: new AnalysisModelRegistry() });
  const created = await postJson(`${baseUrl}/v1/global-models`, {
    profileId: "MODEL-CAS", displayName: "Original", transport: "API",
    endpoint: "https://models.example/v1", model: "original", apiKey: "server-only-secret",
  });
  assert.equal(created.response.status, 201);
  const missing = await fetch(`${baseUrl}/v1/global-models/MODEL-CAS`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Missing CAS", transport: "API", endpoint: "https://models.example/v1", model: "missing", apiKey: "" }),
  });
  assert.equal(missing.status, 400, "PUT must require the revision observed by the editor");
  const first = await fetch(`${baseUrl}/v1/global-models/MODEL-CAS`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: created.body.revision, displayName: "Writer A", transport: "API", endpoint: "https://models.example/v1", model: "writer-a", apiKey: "" }),
  });
  assert.equal(first.status, 200);
  const stale = await fetch(`${baseUrl}/v1/global-models/MODEL-CAS`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: created.body.revision, displayName: "Writer B", transport: "API", endpoint: "https://models.example/v1", model: "writer-b", apiKey: "" }),
  });
  assert.equal(stale.status, 409, "a stale writer must be reported as a concurrency conflict");
  assert.equal((await stale.json()).error.code, "PERSISTENCE_CONFLICT");
  assert.equal((await (await fetch(`${baseUrl}/v1/global-models/MODEL-CAS`)).json()).model, "writer-a");
});

test("Workspace capability Draft CAS reports its typed comparison head", async (t) => {
  const baseUrl = await startServer(t);
  assert.equal((await postJson(`${baseUrl}/v1/workspaces`, {
    id: "W-DRAFT-CONFLICT", name: "Draft conflict", actorId: "OWNER",
  })).response.status, 201);
  const save = (expectedVersion, modelProfileId) => fetch(`${baseUrl}/v1/workspaces/W-DRAFT-CONFLICT/capability-draft`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedVersion,
      mainAgentSlot: { modelProfileId },
      childAgentSlots: [],
      projectCapabilityRevisionIds: [],
      disabledKeys: [],
    }),
  });

  assert.equal((await save(0, "writer-a")).status, 200);
  const stale = await save(0, "writer-b");
  assert.equal(stale.status, 409, "a stale Draft save must be an explicit conflict rather than an invalid request");
  const staleBody = await stale.json();
  assert.equal(staleBody.error.code, "PERSISTENCE_CONFLICT");
  assert.equal(staleBody.error.message, "Workspace capability draft version conflict: expected 0, current 1");
  assert.equal(typeof staleBody.error.requestId, "string");
  assert.deepEqual(staleBody.error.details, {
    head: "WORKSPACE_CAPABILITY_DRAFT",
    expectedVersion: 0,
    currentVersion: 1,
  });
});

test("global model revision CAS permits exactly one concurrent writer", async (t) => {
  let application;
  await startServer(t, {
    analysisModelRegistry: new AnalysisModelRegistry(),
    setup: ({ application: configuredApplication }) => { application = configuredApplication; },
  });
  const created = await application.configureGlobalModelProfile({
    profileId: "MODEL-CONCURRENT-CAS", displayName: "Original", transport: "API",
    endpoint: "https://models.example/v1", model: "original", apiKey: "server-only-secret",
  });
  const revise = (displayName, model) => application.updateGlobalModelProfile("MODEL-CONCURRENT-CAS", {
      expectedRevision: created.revision,
      displayName,
      transport: "API",
      endpoint: "https://models.example/v1",
      model,
      apiKey: "",
    });
  const results = await Promise.allSettled([revise("Writer A", "writer-a"), revise("Writer B", "writer-b")]);
  assert.deepEqual(results.map(({ status }) => status).sort(), ["fulfilled", "rejected"],
    "only one simultaneous writer may advance a Global Model revision");
  const rejected = results.find(({ status }) => status === "rejected");
  assert.match(rejected.reason.message, /Global model revision conflict/);
  const current = await application.getGlobalModelProfile("MODEL-CONCURRENT-CAS");
  assert.equal(current.revision, created.revision + 1);
  assert.ok(["writer-a", "writer-b"].includes(current.model));
});

test("global model revision CAS shares its mutation boundary across Application instances", async () => {
  const store = new MemoryTraceabilityStore();
  const registry = new AnalysisModelRegistry();
  const first = new TraceabilityApplication({ store, clock: fixedClock, analysisModelRegistry: registry });
  const second = new TraceabilityApplication({ store, clock: fixedClock, analysisModelRegistry: registry });
  const created = await first.configureGlobalModelProfile({
    profileId: "MODEL-CROSS-APPLICATION-CAS", displayName: "Original", transport: "API",
    endpoint: "https://models.example/v1", model: "original", apiKey: "server-only-secret",
  });
  const revise = (application, displayName, model) => application.updateGlobalModelProfile("MODEL-CROSS-APPLICATION-CAS", {
    expectedRevision: created.revision,
    displayName,
    transport: "API",
    endpoint: "https://models.example/v1",
    model,
    apiKey: "",
  });

  const results = await Promise.allSettled([
    revise(first, "Writer A", "writer-a"),
    revise(second, "Writer B", "writer-b"),
  ]);

  assert.deepEqual(results.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.match(rejected.reason.message, /Global model revision conflict/);
  const current = await first.getGlobalModelProfile("MODEL-CROSS-APPLICATION-CAS");
  assert.equal(current.revision, created.revision + 1);
  assert.ok(["writer-a", "writer-b"].includes(current.model));
});

test("global model replacement HTTP journey atomically advances every Workspace active head", async (t) => {
  let durableStore;
  const registry = new AnalysisModelRegistry({
    fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }),
  });
  const baseUrl = await startServer(t, {
    analysisModelRegistry: registry,
    setup: ({ store }) => { durableStore = store; },
  });
  for (const profileId of ["MODEL-OLD", "MODEL-NEW"]) {
    assert.equal((await postJson(`${baseUrl}/v1/global-models`, {
      profileId,
      displayName: profileId,
      transport: "API",
      endpoint: "https://models.example/v1",
      model: profileId.toLowerCase(),
      apiKey: "server-only-secret",
    })).response.status, 201);
    assert.equal((await fetch(`${baseUrl}/v1/global-models/${profileId}/verify`, { method: "POST" })).status, 200);
  }
  for (const workspaceId of ["W-REPLACE-1", "W-REPLACE-2"]) {
    assert.equal((await postJson(`${baseUrl}/v1/workspaces`, { id: workspaceId, name: workspaceId, actorId: "OWNER" })).response.status, 201);
    const draft = await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/capability-draft`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 0,
        mainAgentSlot: { modelProfileId: "MODEL-OLD" },
        childAgentSlots: [
          { id: "C1", modelProfileId: "MODEL-OLD", independenceGroup: "I1" },
          { id: "C2", modelProfileId: "MODEL-OLD", independenceGroup: "I2" },
        ],
        projectCapabilityRevisionIds: [],
        disabledKeys: [],
      }),
    });
    assert.equal(draft.status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/capability-draft/activate`, { method: "POST" })).status, 201);
  }

  const partialCreate = await postJson(`${baseUrl}/v1/global-models/MODEL-OLD/replacement-plans`, { replacementProfileId: "MODEL-NEW", workspaceIds: ["W-REPLACE-1"] });
  assert.equal(partialCreate.response.status, 400, "the API must reject client-selected Workspace subsets");
  const createdPlan = await postJson(`${baseUrl}/v1/global-models/MODEL-OLD/replacement-plans`, { replacementProfileId: "MODEL-NEW" });
  assert.equal(createdPlan.response.status, 201);
  assert.deepEqual(createdPlan.body.changes.map(({ workspaceId }) => workspaceId).sort(), ["W-REPLACE-1", "W-REPLACE-2"]);
  const partialApply = await postJson(`${baseUrl}/v1/global-models/MODEL-OLD/replacement-plans/${createdPlan.body.id}/apply`, { expectedVersion: createdPlan.body.version, workspaceIds: ["W-REPLACE-1"] });
  assert.equal(partialApply.response.status, 400, "Apply accepts only the frozen Plan identity and version");
  const applied = await postJson(`${baseUrl}/v1/global-models/MODEL-OLD/replacement-plans/${createdPlan.body.id}/apply`, { expectedVersion: createdPlan.body.version });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.workspaces.length, 2);
  const retried = await postJson(`${baseUrl}/v1/global-models/MODEL-OLD/replacement-plans/${createdPlan.body.id}/apply`, { expectedVersion: createdPlan.body.version });
  assert.equal(retried.response.status, 200, "an interrupted client can retry the original frozen Plan version");
  assert.equal(retried.body.plan.status, "APPLIED");

  for (const workspaceId of ["W-REPLACE-1", "W-REPLACE-2"]) {
    const draft = (await (await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/capability-draft`)).json()).draft;
    assert.equal(draft.mainAgentSlot.modelProfileId, "MODEL-NEW");
    const profiles = (await (await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/execution-profile-revisions`)).json()).profiles;
    assert.equal(profiles[0].mainAgentSlot.modelProfileId, "MODEL-NEW");
  }
  const usageAfter = (await (await fetch(`${baseUrl}/v1/global-models/MODEL-OLD/usage`)).json()).references;
  assert.equal(usageAfter.filter(({ source }) => source !== "ACTIVE_RUN").length, 0, "replacement must leave zero current Workspace references");
  const models = (await (await fetch(`${baseUrl}/v1/global-models`)).json()).models;
  assert.equal(models.find(({ profileId }) => profileId === "MODEL-OLD").lifecycle, "RETIRING");
  assert.equal(
    (await durableStore.getGlobalModelLifecycle("MODEL-OLD")).lifecycle,
    "RETIRING",
    "the same durable commit that applies every Workspace head must own the replacement lifecycle",
  );
});

test("global model replacement refuses a plan after another Workspace starts using the source model", async (t) => {
  const registry = new AnalysisModelRegistry({
    fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }),
  });
  const baseUrl = await startServer(t, { analysisModelRegistry: registry });
  for (const profileId of ["MODEL-STALE-OLD", "MODEL-STALE-NEW"]) {
    assert.equal((await postJson(`${baseUrl}/v1/global-models`, {
      profileId,
      displayName: profileId,
      transport: "API",
      endpoint: "https://models.example/v1",
      model: profileId.toLowerCase(),
      apiKey: "server-only-secret",
    })).response.status, 201);
    assert.equal((await fetch(`${baseUrl}/v1/global-models/${profileId}/verify`, { method: "POST" })).status, 200);
  }
  const configureWorkspace = async (workspaceId) => {
    assert.equal((await postJson(`${baseUrl}/v1/workspaces`, { id: workspaceId, name: workspaceId, actorId: "OWNER" })).response.status, 201);
    const draft = await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/capability-draft`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 0,
        mainAgentSlot: { modelProfileId: "MODEL-STALE-OLD" },
        childAgentSlots: [
          { id: "C1", modelProfileId: "MODEL-STALE-OLD", independenceGroup: "I1" },
          { id: "C2", modelProfileId: "MODEL-STALE-OLD", independenceGroup: "I2" },
        ],
        projectCapabilityRevisionIds: [],
        disabledKeys: [],
      }),
    });
    assert.equal(draft.status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/capability-draft/activate`, { method: "POST" })).status, 201);
  };
  await configureWorkspace("W-STALE-1");
  const plan = await postJson(`${baseUrl}/v1/global-models/MODEL-STALE-OLD/replacement-plans`, { replacementProfileId: "MODEL-STALE-NEW" });
  assert.equal(plan.response.status, 201);
  await configureWorkspace("W-STALE-2");

  const applied = await postJson(`${baseUrl}/v1/global-models/MODEL-STALE-OLD/replacement-plans/${plan.body.id}/apply`, { expectedVersion: plan.body.version });
  assert.equal(applied.response.status, 400, "a frozen plan must fail rather than leave the later Workspace on the retiring model");
  for (const workspaceId of ["W-STALE-1", "W-STALE-2"]) {
    const draft = (await (await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/capability-draft`)).json()).draft;
    assert.equal(draft.mainAgentSlot.modelProfileId, "MODEL-STALE-OLD");
  }
  const source = (await (await fetch(`${baseUrl}/v1/global-models/MODEL-STALE-OLD`)).json());
  assert.equal(source.lifecycle, "ACTIVE", "the source must not enter RETIRING while current references remain");
});

test("global model replacement updates an old active profile without publishing an unrelated newer draft", async (t) => {
  const registry = new AnalysisModelRegistry({
    fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }),
  });
  const baseUrl = await startServer(t, { analysisModelRegistry: registry });
  for (const profileId of ["MODEL-HEAD-OLD", "MODEL-HEAD-NEW", "MODEL-HEAD-THIRD"]) {
    assert.equal((await postJson(`${baseUrl}/v1/global-models`, {
      profileId,
      displayName: profileId,
      transport: "API",
      endpoint: "https://models.example/v1",
      model: profileId.toLowerCase(),
      apiKey: "server-only-secret",
    })).response.status, 201);
    assert.equal((await fetch(`${baseUrl}/v1/global-models/${profileId}/verify`, { method: "POST" })).status, 200);
  }
  const workspaceId = "W-HEAD-SPLIT";
  assert.equal((await postJson(`${baseUrl}/v1/workspaces`, { id: workspaceId, name: workspaceId, actorId: "OWNER" })).response.status, 201);
  const saveDraft = async (expectedVersion, modelProfileId) => fetch(`${baseUrl}/v1/workspaces/${workspaceId}/capability-draft`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedVersion,
      mainAgentSlot: { modelProfileId },
      childAgentSlots: [
        { id: "C1", modelProfileId, independenceGroup: "I1" },
        { id: "C2", modelProfileId, independenceGroup: "I2" },
      ],
      projectCapabilityRevisionIds: [],
      disabledKeys: [],
    }),
  });
  const oldDraft = await saveDraft(0, "MODEL-HEAD-OLD");
  assert.equal(oldDraft.status, 200);
  assert.equal((await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/capability-draft/activate`, { method: "POST" })).status, 201);
  const priorProfile = (await (await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/execution-profile-revisions`)).json()).profiles[0];
  const newerDraft = await saveDraft(1, "MODEL-HEAD-THIRD");
  assert.equal(newerDraft.status, 200, "the third-model draft deliberately remains inactive");

  const plan = await postJson(`${baseUrl}/v1/global-models/MODEL-HEAD-OLD/replacement-plans`, { replacementProfileId: "MODEL-HEAD-NEW" });
  assert.equal(plan.response.status, 201);
  const applied = await postJson(`${baseUrl}/v1/global-models/MODEL-HEAD-OLD/replacement-plans/${plan.body.id}/apply`, { expectedVersion: plan.body.version });
  assert.equal(applied.response.status, 200);
  const draft = (await (await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/capability-draft`)).json()).draft;
  const profiles = (await (await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/execution-profile-revisions`)).json()).profiles;
  assert.equal(draft.mainAgentSlot.modelProfileId, "MODEL-HEAD-THIRD", "the newer unactivated draft remains a draft");
  assert.equal(profiles[0].mainAgentSlot.modelProfileId, "MODEL-HEAD-NEW", "the active old profile alone advances to the replacement model");
  assert.equal(profiles[0].draftRevisionId, null, "the derived execution profile must not claim the unrelated old draft as its source");
  assert.equal(profiles[0].replacementPlanId, plan.body.id, "the derived execution profile must name the immutable replacement authority");
  assert.equal(profiles[0].replacesExecutionProfileRevisionId, priorProfile.id, "the derived execution profile must identify the exact profile it replaced");
  assert.equal(profiles[0].configId, plan.body.id, "the legacy config reference must resolve to the replacement authority, not the unrelated draft");
});

test("durable ModelReplacementPlan remains applicable after the model Registry loses its local Plan ledger", async () => {
  const store = new MemoryTraceabilityStore();
  let persistedProfiles = { profiles: [], revisions: [], credentialHandles: [] };
  const profileStore = {
    load: () => structuredClone(persistedProfiles),
    save: (value) => { persistedProfiles = structuredClone(value); },
  };
  const fetchImpl = async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  const firstRegistry = new AnalysisModelRegistry({ clock: fixedClock, fetchImpl, profileStore });
  const first = new TraceabilityApplication({ store, clock: fixedClock, analysisModelRegistry: firstRegistry });
  await first.createProject({
    organization: { id: "ORG-PLAN-RESTART", name: "Org" },
    tenant: { id: "TENANT-PLAN-RESTART", name: "Tenant" },
    project: { id: "W-PLAN-RESTART", name: "Workspace" },
    principals: [],
    actorId: "OWNER",
  });
  for (const profileId of ["MODEL-OLD", "MODEL-NEW"]) {
    await first.configureGlobalModelProfile({ profileId, displayName: profileId, transport: "API", endpoint: "https://models.example/v1", model: profileId.toLowerCase(), apiKey: `${profileId}-secret` });
    await first.verifyGlobalModelProfile(profileId);
  }
  await first.saveWorkspaceCapabilityDraft("W-PLAN-RESTART", {
    expectedVersion: 0,
    mainAgentSlot: { modelProfileId: "MODEL-OLD" },
    childAgentSlots: [
      { id: "C1", modelProfileId: "MODEL-OLD", independenceGroup: "I1" },
      { id: "C2", modelProfileId: "MODEL-OLD", independenceGroup: "I2" },
    ],
    projectCapabilityRevisionIds: [],
    disabledKeys: [],
  });
  await first.activateWorkspaceCapabilityDraft("W-PLAN-RESTART");
  const plan = await first.createGlobalModelReplacementPlan("MODEL-OLD", { replacementProfileId: "MODEL-NEW" });

  const restartedRegistry = new AnalysisModelRegistry({
    clock: fixedClock,
    fetchImpl,
    profileStore: {
      load: () => structuredClone(persistedProfiles),
      save: profileStore.save,
    },
  });
  const restarted = new TraceabilityApplication({ store, clock: fixedClock, analysisModelRegistry: restartedRegistry });
  const applied = await restarted.applyGlobalModelReplacementPlan("MODEL-OLD", plan.id, { expectedVersion: plan.version });
  assert.equal(applied.plan.status, "APPLIED");
  assert.equal((await restarted.listGlobalModelProfiles()).find(({ profileId }) => profileId === "MODEL-OLD").lifecycle, "RETIRING");
  assert.equal((await restarted.getWorkspaceCapabilityDraft("W-PLAN-RESTART")).mainAgentSlot.modelProfileId, "MODEL-NEW");
});

test("production API authentication protects every non-health route", async (t) => {
  const baseUrl = await startServer(t, { apiBearerToken: "project-api-token" });
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);

  const unauthorized = await fetch(`${baseUrl}/v1/projects/PROJECT-001/features/FEATURE-001/baseline`);
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "API_AUTHENTICATION_REQUIRED");

  const authorized = await fetch(`${baseUrl}/v1/projects/PROJECT-001/features/FEATURE-001/baseline`, {
    headers: { authorization: "Bearer project-api-token" },
  });
  assert.equal(authorized.status, 404);
});

test("project and Snapshot bootstrap require no direct database setup", async (t) => {
  const baseUrl = await startServer(t, { apiBearerToken: "project-api-token" });
  const apiHeaders = { "x-traqen-api-token": "project-api-token" };
  const created = await postJson(`${baseUrl}/v1/projects`, {
    organization: { id: "ORG-BOOTSTRAP", name: "Bootstrap organization" },
    tenant: { id: "TENANT-BOOTSTRAP", name: "Bootstrap tenant" },
    project: { id: "PROJECT-BOOTSTRAP", name: "Bootstrap project" },
    principals: [
      { id: "OWNER-BOOTSTRAP", type: "USER", displayName: "Business owner" },
      { id: "RUNNER-BOOTSTRAP", type: "RUNNER", displayName: "Project Runner" },
    ],
  }, apiHeaders);
  assert.equal(created.response.status, 201);
  assert.equal(created.body.project.id, "PROJECT-BOOTSTRAP");
  assert.equal(created.body.principals.length, 2);

  const snapshotInput = (await exampleInput()).snapshotManifest;
  const snapshot = await postJson(
    `${baseUrl}/v1/projects/PROJECT-BOOTSTRAP/snapshots`,
    snapshotInput,
    apiHeaders,
  );
  assert.equal(snapshot.response.status, 201);
  assert.equal(snapshot.body.complete, true);

  const fetched = await fetch(`${baseUrl}/v1/projects/PROJECT-BOOTSTRAP`, { headers: apiHeaders });
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).tenant.id, "TENANT-BOOTSTRAP");

  await postJson(`${baseUrl}/v1/projects/PROJECT-BOOTSTRAP/features`, {
    id: "FEATURE-BOOTSTRAP",
    version: 1,
    name: "Discoverable feature",
  }, apiHeaders);
  const snapshots = await fetch(`${baseUrl}/v1/projects/PROJECT-BOOTSTRAP/snapshots`, { headers: apiHeaders });
  assert.equal(snapshots.status, 200);
  assert.equal((await snapshots.json()).snapshots[0].id, snapshot.body.id);
  const features = await fetch(`${baseUrl}/v1/projects/PROJECT-BOOTSTRAP/features`, { headers: apiHeaders });
  assert.equal(features.status, 200);
  assert.equal((await features.json()).features[0].feature.id, "FEATURE-BOOTSTRAP");
  const platformMetrics = await fetch(
    `${baseUrl}/v1/projects/PROJECT-BOOTSTRAP/metrics/platform-operations`,
    { headers: apiHeaders },
  );
  assert.equal(platformMetrics.status, 200);
  const platformMetricsBody = await platformMetrics.json();
  assert.equal(platformMetricsBody.scanners.bundleCount, 0);
  assert.ok(platformMetricsBody.unavailableSignals.some((item) => item.status === "UNAVAILABLE"));
});

test("business process endpoint assigns reviewer identity and returns the governed state machine", async (t) => {
  const baseUrl = await startServer(t, {
    reviewerResolver: (_projectId, context) => context.authorization === "Bearer reviewer-token"
      ? { actorId: "OWNER-PROCESS", actorRole: "business-owner" }
      : null,
    reviewPolicyResolver: () => ({ allowedProcessModelRoles: ["business-owner"] }),
  });
  await postJson(`${baseUrl}/v1/projects`, {
    organization: { id: "ORG-PROCESS", name: "Process organization" },
    tenant: { id: "TENANT-PROCESS", name: "Process tenant" },
    project: { id: "PROJECT-PROCESS", name: "Process project" },
    principals: [{ id: "OWNER-PROCESS", type: "USER", displayName: "Process owner" }],
  });
  await postJson(`${baseUrl}/v1/projects/PROJECT-PROCESS/features`, {
    id: "FEATURE-PROCESS",
    version: 1,
    name: "Submit order",
  });
  const payload = {
    id: "PROCESS-SUBMIT",
    version: 1,
    featureVersion: 1,
    name: "Submit lifecycle",
    actors: [{ id: "ACTOR-BUYER", name: "Buyer", role: "order-owner" }],
    states: [
      { id: "STATE-DRAFT", name: "Draft", kind: "INITIAL" },
      { id: "STATE-SUBMITTED", name: "Submitted", kind: "TERMINAL" },
    ],
    transitions: [{
      id: "TRANSITION-SUBMIT",
      name: "Submit",
      fromStateId: "STATE-DRAFT",
      toStateId: "STATE-SUBMITTED",
      trigger: "submit",
      actorIds: ["ACTOR-BUYER"],
      guards: ["order.status = DRAFT"],
    }],
    authority: { rationale: "The product owner confirms the normal submission lifecycle." },
  };
  const unauthorized = await postJson(
    `${baseUrl}/v1/projects/PROJECT-PROCESS/features/FEATURE-PROCESS/process-model`,
    payload,
  );
  assert.equal(unauthorized.response.status, 401);

  const created = await postJson(
    `${baseUrl}/v1/projects/PROJECT-PROCESS/features/FEATURE-PROCESS/process-model`,
    payload,
    { authorization: "Bearer reviewer-token" },
  );
  assert.equal(created.response.status, 201);
  assert.equal(created.body.authority.actorId, "OWNER-PROCESS");
  assert.equal(created.body.states[0].kind, "INITIAL");

  const found = await fetch(
    `${baseUrl}/v1/projects/PROJECT-PROCESS/features/FEATURE-PROCESS/process-model`,
  );
  assert.equal(found.status, 200);
  assert.equal((await found.json()).transitions[0].id, "TRANSITION-SUBMIT");
});

test("Feature evolution API requires a human governor and exposes aliases and lineage", async (t) => {
  const baseUrl = await startServer(t, {
    reviewerResolver: (_projectId, context) => context.authorization === "Bearer feature-owner-token"
      ? { actorId: "OWNER-FEATURE", actorRole: "product-owner" }
      : null,
    reviewPolicyResolver: () => ({ allowedFeatureGovernanceRoles: ["product-owner"] }),
  });
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-FEATURE-EVOLUTION`;
  await postJson(`${baseUrl}/v1/projects`, {
    organization: { id: "ORG-FEATURE-EVOLUTION", name: "Feature org" },
    tenant: { id: "TENANT-FEATURE-EVOLUTION", name: "Feature tenant" },
    project: { id: "PROJECT-FEATURE-EVOLUTION", name: "Feature project" },
    principals: [{ id: "OWNER-FEATURE", type: "USER", displayName: "Feature owner" }],
  });
  await postJson(`${projectUrl}/features`, { id: "FEATURE-OLD", version: 1, name: "Legacy order" });
  await postJson(`${projectUrl}/features`, { id: "FEATURE-NEW", version: 1, name: "Order management" });

  const unauthenticated = await postJson(`${projectUrl}/features/FEATURE-OLD/aliases`, {
    featureVersion: 1, alias: "Orders", rationale: "Keep an import alias.",
  });
  assert.equal(unauthenticated.response.status, 401);
  const headers = { authorization: "Bearer feature-owner-token" };
  const alias = await postJson(`${projectUrl}/features/FEATURE-OLD/aliases`, {
    featureVersion: 1, alias: "Orders", rationale: "Keep an import alias.",
  }, headers);
  assert.equal(alias.response.status, 201);
  assert.equal(alias.body.actorId, "OWNER-FEATURE");
  const lineage = await postJson(`${projectUrl}/feature-lineages`, {
    id: "LINEAGE-API-001",
    predecessorFeatureId: "FEATURE-OLD",
    successorFeatureId: "FEATURE-NEW",
    relationType: "MERGED_INTO",
    rationale: "The replacement consolidates the governed capability.",
  }, headers);
  assert.equal(lineage.response.status, 201);
  const aliases = await fetch(`${projectUrl}/features/FEATURE-OLD/aliases`);
  assert.equal((await aliases.json()).aliases[0].alias, "Orders");
  const lineages = await fetch(`${projectUrl}/feature-lineages?featureId=FEATURE-NEW`);
  assert.equal((await lineages.json()).lineages[0].id, "LINEAGE-API-001");
});

test("Decision review API keeps proposer and two approvers distinct before publishing authority", async (t) => {
  const identities = new Map([
    ["Bearer proposer-token", { actorId: "PROPOSER-API", actorRole: "business-owner" }],
    ["Bearer business-approver-token", { actorId: "APPROVER-API-1", actorRole: "business-owner" }],
    ["Bearer compliance-approver-token", { actorId: "APPROVER-API-2", actorRole: "compliance-owner" }],
  ]);
  const baseUrl = await startServer(t, {
    reviewerResolver: (_projectId, context) => identities.get(context.authorization) ?? null,
    reviewPolicyResolver: () => ({
      decisionGovernance: {
        proposerRoles: ["business-owner"],
        approvalRoles: ["business-owner", "compliance-owner"],
        businessRoles: ["business-owner"],
        complianceRoles: ["compliance-owner"],
        breakGlassRoles: ["incident-commander"],
        lifecycleRoles: ["governance-owner"],
      },
    }),
  });
  await postJson(`${baseUrl}/v1/projects`, {
    organization: { id: "ORG-DECISION-API", name: "Decision organization" },
    tenant: { id: "TENANT-DECISION-API", name: "Decision tenant" },
    project: { id: "PROJECT-DECISION-API", name: "Decision project" },
    principals: [
      { id: "PROPOSER-API", type: "USER", displayName: "Proposer" },
      { id: "APPROVER-API-1", type: "USER", displayName: "Business approver" },
      { id: "APPROVER-API-2", type: "USER", displayName: "Compliance approver" },
    ],
  });
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-DECISION-API`;
  await postJson(`${projectUrl}/features`, { id: "FEATURE-DECISION-API", version: 1, name: "Governed feature" });
  await postJson(`${projectUrl}/claim-scopes`, { id: "SCOPE-DECISION-API", version: 1, scope: { actor: "customer" } });
  await postJson(`${projectUrl}/claims`, {
    id: "CLAIM-DECISION-API",
    version: 1,
    featureId: "FEATURE-DECISION-API",
    type: "NORMATIVE_REQUIREMENT",
    statement: "The high-risk operation requires governed approval.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-DECISION-API",
    scopeVersion: 1,
    provenance: {},
  });
  const created = await postJson(`${projectUrl}/decision-review-cases`, {
    id: "CASE-DECISION-API",
    claimId: "CLAIM-DECISION-API",
    claimVersion: 1,
    scopeId: "SCOPE-DECISION-API",
    scopeVersion: 1,
    risk: "HIGH",
    approvalMode: "DUAL",
    proposedDecision: { id: "DECISION-DUAL-API", type: "CONFIRMED" },
    expiresAt: "2026-07-16T04:00:00.000Z",
  }, { authorization: "Bearer proposer-token" });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.reviewCase.proposerId, "PROPOSER-API");

  const first = await postJson(`${projectUrl}/decision-review-cases/CASE-DECISION-API/events`, {
    id: "EVENT-DECISION-API-1",
    action: "APPROVE",
    rationale: "Business approval.",
  }, { authorization: "Bearer business-approver-token" });
  assert.equal(first.body.evaluation.status, "PENDING");
  const second = await postJson(`${projectUrl}/decision-review-cases/CASE-DECISION-API/events`, {
    id: "EVENT-DECISION-API-2",
    action: "APPROVE",
    rationale: "Compliance approval.",
  }, { authorization: "Bearer compliance-approver-token" });
  assert.equal(second.response.status, 201);
  assert.equal(second.body.evaluation.status, "APPROVED");
  assert.equal(second.body.decision.id, "DECISION-DUAL-API");

  const found = await fetch(`${projectUrl}/decision-review-cases/CASE-DECISION-API`);
  assert.equal(found.status, 200);
  assert.equal((await found.json()).events.length, 2);
});

test("product-effectiveness metrics require a Snapshot and preserve independent results", async (t) => {
  const calls = [];
  const application = {
    async getProductEffectivenessMetrics(projectId, snapshotManifestId) {
      calls.push({ projectId, snapshotManifestId });
      return {
        projectId,
        snapshotManifestId,
        computedAt: "2026-07-15T00:00:00.000Z",
        highValueValidTraceChainRate: { numerator: 1, denominator: 2, ratio: 0.5 },
        claimConfirmationRate: { numerator: 2, denominator: 2, ratio: 1 },
        confirmedRuleTestCoverageRate: { numerator: 1, denominator: 2, ratio: 0.5 },
        meaningfulAssertionRate: { numerator: 1, denominator: 2, ratio: 0.5 },
        evidenceFreshness: { FRESH: 1, EXPIRING: 0, STALE: 0, INCOMPLETE: 1, UNKNOWN: 0 },
        gapBreakdown: { byType: { NO_TEST_SPEC: 1 }, bySeverity: { BLOCKING: 1 }, byOwnerRole: { QUALITY_OWNER: 1 } },
        features: [],
        unavailableMetrics: [],
      };
    },
  };
  const baseUrl = await startStubServer(t, application);
  const response = await fetch(
    `${baseUrl}/v1/projects/PROJECT-001/metrics/product-effectiveness?snapshotManifestId=SNAPSHOT-001`,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.highValueValidTraceChainRate.ratio, 0.5);
  assert.equal(body.compositeScore, undefined);
  assert.deepEqual(calls, [{ projectId: "PROJECT-001", snapshotManifestId: "SNAPSHOT-001" }]);

  const missing = await fetch(`${baseUrl}/v1/projects/PROJECT-001/metrics/product-effectiveness`);
  assert.equal(missing.status, 400);
});

test("Evidence lifecycle routes expose policy, Legal Hold state, and deletion-proof audit", async (t) => {
  const calls = [];
  const projection = {
    evidenceId: "EVIDENCE-001",
    policyRef: { id: "POLICY-001", version: 1 },
    status: "DELETION_BLOCKED_LEGAL_HOLD",
    legalHold: true,
    archived: true,
    deletionRequested: true,
    deleted: false,
    archiveDueAt: "2026-07-10T00:00:00.000Z",
    retentionEndsAt: "2026-08-01T00:00:00.000Z",
    deletionProof: null,
    accessEventCount: 1,
    events: [],
    evaluatedAt: "2026-07-15T00:00:00.000Z",
  };
  const application = {
    async appendEvidenceRetentionPolicy(projectId, input, context) {
      calls.push({ operation: "policy", projectId, input, context });
      return { ...input, actorId: "OWNER-001", actorRole: "governance-owner", createdAt: projection.evaluatedAt };
    },
    async appendEvidenceLifecycleEvent(projectId, evidenceId, input, context) {
      calls.push({ operation: "event", projectId, evidenceId, input, context });
      return projection;
    },
    async getEvidenceLifecycle(projectId, evidenceId, policyId, policyVersion) {
      calls.push({ operation: "get", projectId, evidenceId, policyId, policyVersion });
      return projection;
    },
  };
  const baseUrl = await startStubServer(t, application);
  const policy = await postJson(`${baseUrl}/v1/projects/PROJECT-001/evidence-retention-policies`, {
    id: "POLICY-001",
    version: 1,
    dataClassification: "INTERNAL",
    evidenceTypes: ["TRACE"],
    retentionDays: 30,
    archiveAfterDays: 7,
    legalHoldDefault: false,
    allowedAccessRoles: ["auditor"],
  }, { authorization: "Bearer governance-token" });
  assert.equal(policy.response.status, 201);
  const lifecycleEvent = await postJson(`${baseUrl}/v1/projects/PROJECT-001/evidence/EVIDENCE-001/lifecycle-events`, {
    id: "EVENT-HOLD-001",
    policyId: "POLICY-001",
    policyVersion: 1,
    action: "LEGAL_HOLD_PLACED",
    reason: "Active legal discovery.",
  }, { authorization: "Bearer governance-token" });
  assert.equal(lifecycleEvent.body.status, "DELETION_BLOCKED_LEGAL_HOLD");
  const lifecycle = await fetch(
    `${baseUrl}/v1/projects/PROJECT-001/evidence/EVIDENCE-001/lifecycle?policyId=POLICY-001&policyVersion=1`,
  );
  assert.equal(lifecycle.status, 200);
  assert.equal((await lifecycle.json()).legalHold, true);
  assert.deepEqual(calls.map((call) => call.operation), ["policy", "event", "get"]);
});

test("Feature graph APIs preserve bounded filters and path-query scope", async (t) => {
  const calls = [];
  const application = {
    async getFeatureGraph(projectId, featureId, snapshotManifestId, options) {
      calls.push({ operation: "graph", projectId, featureId, snapshotManifestId, options });
      return {
        center: featureId,
        snapshotManifestId,
        view: options.view,
        depth: options.depth,
        nodes: [{
          id: featureId,
          type: "FEATURE",
          label: "Submit order",
          version: 1,
          status: "ACTIVE",
          risk: null,
          provenance: "GOVERNED_BASELINE",
          source: null,
          details: {},
        }],
        edges: [],
        truncated: false,
        availableExpansions: [],
      };
    },
    async queryFeatureGraphPath(projectId, featureId, input) {
      calls.push({ operation: "path", projectId, featureId, input });
      return {
        center: featureId,
        snapshotManifestId: input.snapshotManifestId,
        view: input.view ?? "traceability",
        query: {
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          direction: input.direction ?? "ANY",
          maxDepth: input.maxDepth ?? 8,
        },
        found: false,
        nodes: [],
        edges: [],
        hopCount: null,
      };
    },
  };
  const baseUrl = await startStubServer(t, application);
  const graphResponse = await fetch(
    `${baseUrl}/v1/projects/PROJECT-001/features/FEATURE-001/graph?` +
      "snapshotManifestId=SNAPSHOT-001&graphRevisionId=REVISION-001&rootNodeId=ENDPOINT-001&view=coverage&depth=4&limit=25&nodeType=CLAIM&relation=VERIFIED_BY",
  );
  assert.equal(graphResponse.status, 200);
  assert.equal((await graphResponse.json()).view, "coverage");
  assert.deepEqual(calls[0].options, {
    view: "coverage",
    depth: 4,
    limit: 25,
    nodeTypes: ["CLAIM"],
    relations: ["VERIFIED_BY"],
    rootNodeId: "ENDPOINT-001",
    graphRevisionId: "REVISION-001",
  });

  const path = await postJson(
    `${baseUrl}/v1/projects/PROJECT-001/features/FEATURE-001/graph/paths/query`,
    {
      snapshotManifestId: "SNAPSHOT-001",
      fromNodeId: "FEATURE-001",
      toNodeId: "EVIDENCE-001",
      direction: "FORWARD",
      maxDepth: 6,
      graphRevisionId: "REVISION-001",
    },
  );
  assert.equal(path.response.status, 200);
  assert.equal(path.body.query.direction, "FORWARD");
  assert.equal(calls[1].operation, "path");
  assert.equal(calls[1].input.graphRevisionId, "REVISION-001");

  const oversized = await fetch(
    `${baseUrl}/v1/projects/PROJECT-001/features/FEATURE-001/graph?snapshotManifestId=SNAPSHOT-001&limit=101`,
  );
  assert.equal(oversized.status, 400);
});

test("GraphRevision evidence resolver route preserves immutable edge and API-root context", async (t) => {
  const calls = [];
  const application = {
    async resolveGraphEvidence(projectId, revisionId, kind, evidenceId, context) {
      calls.push({ projectId, revisionId, kind, evidenceId, context });
      return {
        resolved: true,
        status: "RESOLVED",
        kind,
        id: evidenceId,
        object: { id: evidenceId, type: "IMPLEMENTS" },
        context: { ...context, projectId, graphRevisionId: revisionId, graphArtifactId: "ARTIFACT-001", graphArtifactDigest: "DIGEST-001" },
      };
    },
  };
  const baseUrl = await startStubServer(t, application);
  const response = await fetch(
    `${baseUrl}/v1/projects/PROJECT-001/graph/revisions/REVISION-001/evidence/edges/EDGE-001?` +
      "snapshotManifestId=SNAPSHOT-001&featureId=FEATURE-001&rootNodeId=ENDPOINT-001",
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "RESOLVED");
  assert.deepEqual(calls, [{
    projectId: "PROJECT-001",
    revisionId: "REVISION-001",
    kind: "edge",
    evidenceId: "EDGE-001",
    context: {
      featureId: "FEATURE-001",
      rootNodeId: "ENDPOINT-001",
      snapshotManifestId: "SNAPSHOT-001",
      objectType: null,
      executionId: null,
    },
  }]);
});

test("continuous-protection endpoint returns the server-derived regression plan and gate", async (t) => {
  const calls = [];
  const application = {
    async getContinuousProtectionAssessment(projectId, changeSetId) {
      calls.push({ projectId, changeSetId });
      return {
        id: "CONTINUOUS-PROTECTION-001",
        projectId,
        changeSetId,
        snapshotManifestId: "SNAPSHOT-002",
        createdAt: "2026-07-15T00:00:00.000Z",
        regressionPlan: {
          selectionStrategy: "TARGETED_UNION_HIGH_RISK",
          complete: true,
          selectedTests: [],
          unresolvedTestSpecIds: [],
          changeSetWarnings: [],
        },
        featureAssessments: [],
        qualityGate: {
          status: "PASS",
          policyMode: "ADVISORY",
          enforcement: "PASS",
          reasons: [],
          requiredActions: [],
        },
      };
    },
  };
  const baseUrl = await startStubServer(t, application);
  const response = await fetch(
    `${baseUrl}/v1/projects/PROJECT-001/change-sets/CHANGESET-001/continuous-protection`,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).qualityGate.status, "PASS");
  assert.deepEqual(calls, [{ projectId: "PROJECT-001", changeSetId: "CHANGESET-001" }]);
});

test("browser product origins are explicit and preflight never grants an unknown origin", async (t) => {
  await assert.rejects(startServer(t, { corsAllowedOrigins: ["*"] }), /explicit origin/);
  await assert.rejects(startServer(t, { corsAllowedOrigins: ["https://traqen.example/path"] }), /scheme, host, and port/);
  const baseUrl = await startServer(t, { corsAllowedOrigins: ["https://traqen.example"] });
  const allowed = await fetch(`${baseUrl}/health`, {
    headers: { origin: "https://traqen.example" },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://traqen.example");
  assert.equal(allowed.headers.get("vary"), "Origin");

  const preflight = await fetch(`${baseUrl}/v1/projects/PROJECT-001/features/FEATURE-001/traceability`, {
    method: "OPTIONS",
    headers: {
      origin: "https://traqen.example",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /authorization/);
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /DELETE/);
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /PUT/);
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /PATCH/);

  const unknown = await fetch(`${baseUrl}/health`, {
    headers: { origin: "https://unknown.example" },
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.headers.get("access-control-allow-origin"), null);
});

test("evaluation endpoint returns the independent trace-chain dimensions", async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/v1/trace-chains/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await exampleInput()),
  });
  const chain = await response.json();

  assert.equal(response.status, 200);
  assert.equal(chain.complete, true);
  assert.equal(chain.dimensions.authority, "CONFIRMED");
  assert.equal(chain.dimensions.conformance, "CONFORMS");
  assert.equal(chain.dimensions.verification, "PASS");
  assert.deepEqual(chain.gaps, []);
});

test("API recomputes the snapshot manifest instead of trusting client status", async (t) => {
  const baseUrl = await startServer(t);
  const input = await exampleInput();
  input.snapshotManifest = {
    id: "SPOOFED-MANIFEST",
    components: {
      deployment: { id: "SPOOFED-DEPLOYMENT", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }
    },
    complete: true
  };

  const response = await fetch(`${baseUrl}/v1/trace-chains/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_REQUEST");
  assert.match(body.error.message, /observedFrom/);
});

test("trace chain can be evaluated, appended, and queried", async (t) => {
  const baseUrl = await startServer(t);
  const persistResponse = await fetch(`${baseUrl}/v1/projects/PROJECT-001/trace-chains`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await exampleInput()),
  });
  const persisted = await persistResponse.json();

  assert.equal(persistResponse.status, 201);
  assert.equal(persisted.persisted.revision, 1);

  const currentResponse = await fetch(
    `${baseUrl}/v1/projects/PROJECT-001/trace-chains/${encodeURIComponent(persisted.chain.id)}`,
  );
  const current = await currentResponse.json();

  assert.equal(currentResponse.status, 200);
  assert.equal(current.id, persisted.chain.id);
  assert.equal(current.revision, 1);
  assert.equal(current.snapshotManifestId, persisted.chain.snapshotManifestId);
});

test("invalid JSON and media types use the stable error envelope", async (t) => {
  const baseUrl = await startServer(t);
  const invalidJson = await fetch(`${baseUrl}/v1/trace-chains/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{broken",
  });
  const invalidJsonBody = await invalidJson.json();
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJsonBody.error.code, "INVALID_JSON");
  assert.equal(invalidJsonBody.error.requestId, invalidJson.headers.get("x-request-id"));

  const unsupported = await fetch(`${baseUrl}/v1/trace-chains/evaluate`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).error.code, "UNSUPPORTED_MEDIA_TYPE");
});

test("payload limits and missing trace chains are explicit", async (t) => {
  const baseUrl = await startServer(t, { maxBodyBytes: 32 });
  const tooLarge = await fetch(`${baseUrl}/v1/trace-chains/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(64) }),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, "PAYLOAD_TOO_LARGE");

  const missing = await fetch(`${baseUrl}/v1/projects/PROJECT-001/trace-chains/UNKNOWN`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "TRACE_CHAIN_NOT_FOUND");
});

test("feature governance appends decisions without overwriting the claim", async (t) => {
  const baseUrl = await startServer(t, {
    reviewerResolver: (_projectId, context) =>
      context.authorization === "Bearer governance-reviewer"
        ? { actorId: "USER-001", actorRole: "business-owner" }
        : null,
    reviewPolicyResolver: () => ({
      allowedRoles: ["business-owner"],
      allowedDecisionTypes: ["CONFIRMED", "EXCEPTION_RECORDED", "REJECTED", "INSUFFICIENT_EVIDENCE", "DEFERRED", "DEPRECATED"],
    }),
  });
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-001`;

  const feature = await postJson(`${projectUrl}/features`, {
    id: "FEATURE-001",
    version: 1,
    name: "Submit order",
    businessDomain: "orders",
  });
  assert.equal(feature.response.status, 201);

  const scope = await postJson(`${projectUrl}/claim-scopes`, {
    id: "SCOPE-001",
    version: 1,
    scope: { actor: "normal-user", orderType: "standard" },
  });
  assert.equal(scope.response.status, 201);

  const claimInput = {
    id: "CLAIM-001",
    version: 1,
    featureId: "FEATURE-001",
    type: "NORMATIVE_REQUIREMENT",
    statement: "A normal user may submit only a DRAFT order.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    provenance: { source: "business-owner" },
  };
  const claim = await postJson(`${projectUrl}/claims`, claimInput);
  assert.equal(claim.response.status, 201);

  const spoofedActor = await postJson(`${projectUrl}/decisions`, {
    id: "DECISION-001",
    claimId: "CLAIM-001",
    claimVersion: 1,
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    type: "CONFIRMED",
    actorId: "USER-001",
    actorRole: "business-owner",
  }, { authorization: "Bearer governance-reviewer" });
  assert.equal(spoofedActor.response.status, 400);
  assert.match(spoofedActor.body.error.message, /assigned by the server/);

  const confirmed = await postJson(`${projectUrl}/decisions`, {
    id: "DECISION-001",
    claimId: "CLAIM-001",
    claimVersion: 1,
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    type: "CONFIRMED",
  }, { authorization: "Bearer governance-reviewer" });
  assert.equal(confirmed.response.status, 201);
  assert.equal(confirmed.body.actorId, "USER-001");

  const exception = await postJson(`${projectUrl}/decisions`, {
    id: "DECISION-002",
    claimId: "CLAIM-001",
    claimVersion: 1,
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    type: "EXCEPTION_RECORDED",
    content: "Administrators may force submission during recovery.",
  }, { authorization: "Bearer governance-reviewer" });
  assert.equal(exception.response.status, 201);

  const baselineResponse = await fetch(`${projectUrl}/features/FEATURE-001/baseline`);
  const baseline = await baselineResponse.json();
  assert.equal(baselineResponse.status, 200);
  assert.equal(baseline.claims[0].claim.statement, claimInput.statement);
  assert.equal(baseline.claims[0].decisionHistory.length, 2);
  assert.equal(baseline.claims[0].latestDecision.type, "EXCEPTION_RECORDED");
});

test("governance reference conflicts return 409", async (t) => {
  const baseUrl = await startServer(t);
  const result = await postJson(`${baseUrl}/v1/projects/PROJECT-001/claims`, {
    id: "CLAIM-ORPHAN",
    version: 1,
    featureId: "FEATURE-MISSING",
    type: "NORMATIVE_REQUIREMENT",
    statement: "Orphan claim",
    sourceType: "HUMAN",
    evidenceSupport: "NONE",
    scopeId: "SCOPE-MISSING",
    scopeVersion: 1,
  });

  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, "PERSISTENCE_CONFLICT");
});

test("TestSpec API validates candidates and preserves immutable versions", async (t) => {
  const baseUrl = await startServer(t, {
    reviewerResolver: (_projectId, context) =>
      context.authorization === "Bearer quality-reviewer"
        ? { actorId: "USER-001", actorRole: "quality-owner" }
        : null,
    reviewPolicyResolver: () => ({ allowedTestSpecApproverRoles: ["quality-owner"] }),
  });
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-001`;
  await postJson(`${projectUrl}/features`, { id: "FEATURE-001", version: 1, name: "Submit order" });
  await postJson(`${projectUrl}/claim-scopes`, {
    id: "SCOPE-001",
    version: 1,
    scope: { actor: "normal-user" },
  });
  await postJson(`${projectUrl}/claims`, {
    id: "CLAIM-001",
    version: 1,
    featureId: "FEATURE-001",
    type: "NORMATIVE_REQUIREMENT",
    statement: "A normal user may submit only a DRAFT order.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-001",
    scopeVersion: 1,
  });

  const firstVersion = {
    id: "TEST-001",
    version: 1,
    name: "Submit a draft order",
    risk: "HIGH",
    approved: false,
    featureId: "FEATURE-001",
    verifiesClaims: [{ id: "CLAIM-001", version: 1 }],
    environment: { target: "sit", operationLevel: "CONTROLLED_WRITE" },
    preconditions: [{ type: "SEED", seedRef: "draft-order" }],
    variables: { accessToken: { secretRef: "accounts/normal-user/token" } },
    steps: [{ id: "submit", executor: "HTTP", method: "POST", path: "/orders/1/submit" }],
    assertions: [{ id: "status", type: "HTTP_STATUS", stepId: "submit", expected: 200 }],
    cleanup: { strategy: "SEED_RESET" },
    policy: { approvalRequired: true },
  };

  const candidate = await postJson(`${projectUrl}/test-specs/validate`, {
    ...firstVersion,
    variables: { password: "plaintext" },
  });
  assert.equal(candidate.response.status, 200);
  assert.equal(candidate.body.valid, false);
  assert.equal(candidate.body.violations[0].code, "RAW_SECRET_FORBIDDEN");

  const created = await postJson(`${projectUrl}/test-specs`, firstVersion);
  assert.equal(created.response.status, 201);
  const validation = await fetch(`${projectUrl}/test-specs/TEST-001/validate`, { method: "POST" });
  const validationBody = await validation.json();
  assert.equal(validation.status, 200);
  assert.equal(validationBody.executable, false);
  assert.equal(validationBody.violations[0].code, "APPROVAL_REQUIRED");

  const directApprovalSpoof = await postJson(`${projectUrl}/test-specs`, {
    ...firstVersion,
    version: 2,
    approved: true,
    approval: { actorId: "USER-001", actorRole: "quality-owner", approvedAt: "2026-07-14T03:59:00.000Z" },
  });
  assert.equal(directApprovalSpoof.response.status, 400);

  const secondVersion = await postJson(
    `${projectUrl}/test-specs/TEST-001/approvals`,
    { expectedVersion: 1, rationale: "The quality owner approves this bounded read scenario." },
    { authorization: "Bearer quality-reviewer" },
  );
  assert.equal(secondVersion.response.status, 201);
  assert.equal(secondVersion.body.version, 2);
  assert.equal(secondVersion.body.approval.actorId, "USER-001");

  const latestResponse = await fetch(`${projectUrl}/test-specs/TEST-001`);
  assert.equal(latestResponse.status, 200);
  assert.equal((await latestResponse.json()).version, 2);
  const firstResponse = await fetch(`${projectUrl}/test-specs/TEST-001?version=1`);
  assert.equal(firstResponse.status, 200);
  assert.equal((await firstResponse.json()).approved, false);
  const invalidVersion = await fetch(`${projectUrl}/test-specs/TEST-001?version=0`);
  assert.equal(invalidVersion.status, 400);
  assert.equal((await invalidVersion.json()).error.code, "INVALID_REQUEST");

  const baselineResponse = await fetch(`${projectUrl}/features/FEATURE-001/baseline`);
  const baseline = await baselineResponse.json();
  assert.equal(baseline.testSpecs.length, 1);
  assert.equal(baseline.testSpecs[0].version, 2);
});

test("TestSpec storage rejects raw secrets, raw SQL, and cross-feature claim links", async (t) => {
  const baseUrl = await startServer(t);
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-001`;
  await postJson(`${projectUrl}/features`, { id: "FEATURE-001", version: 1, name: "Submit order" });

  const rawSecret = await postJson(`${projectUrl}/test-specs`, {
    id: "TEST-UNSAFE",
    version: 1,
    name: "Unsafe test",
    risk: "HIGH",
    approved: false,
    featureId: "FEATURE-001",
    verifiesClaims: [{ id: "CLAIM-MISSING", version: 1 }],
    environment: { target: "sit", operationLevel: "SAFE_READ" },
    variables: { token: "plaintext" },
    steps: [{ id: "read", executor: "HTTP" }],
    assertions: [],
    policy: {},
  });
  assert.equal(rawSecret.response.status, 400);
  assert.equal(rawSecret.body.error.code, "INVALID_REQUEST");

  const rawSql = await postJson(`${projectUrl}/test-specs`, {
    id: "TEST-RAW-SQL",
    version: 1,
    name: "Unsafe database test",
    risk: "HIGH",
    approved: false,
    featureId: "FEATURE-001",
    verifiesClaims: [{ id: "CLAIM-MISSING", version: 1 }],
    environment: { target: "sit", operationLevel: "SAFE_READ" },
    steps: [{ id: "database", executor: "DATABASE", sql: "SELECT * FROM orders" }],
    assertions: [],
    policy: {},
  });
  assert.equal(rawSql.response.status, 400);
  assert.equal(rawSql.body.error.code, "INVALID_REQUEST");

  const missingClaim = await postJson(`${projectUrl}/test-specs`, {
    id: "TEST-ORPHAN",
    version: 1,
    name: "Orphan test",
    risk: "LOW",
    approved: false,
    featureId: "FEATURE-001",
    verifiesClaims: [{ id: "CLAIM-MISSING", version: 1 }],
    environment: { target: "sit", operationLevel: "SAFE_READ" },
    steps: [{ id: "read", executor: "HTTP" }],
    assertions: [],
    policy: {},
  });
  assert.equal(missingClaim.response.status, 409);
  assert.equal(missingClaim.body.error.code, "PERSISTENCE_CONFLICT");
});

test("attested execution evidence is verified, persisted, and queryable", async (t) => {
  const runnerSecret = "runner-shared-secret";
  const baseUrl = await startServer(t, {
    runnerKeyResolver: (runnerId) => (runnerId === "RUNNER-001" ? runnerSecret : null),
    reviewerResolver: (_projectId, context) =>
      context.authorization === "Bearer quality-reviewer"
        ? { actorId: "USER-001", actorRole: "quality-owner" }
        : null,
    reviewPolicyResolver: () => ({ allowedTestSpecApproverRoles: ["quality-owner"] }),
  });
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-001`;
  const traceInput = await exampleInput();
  const persistedTrace = await postJson(`${projectUrl}/trace-chains`, traceInput);
  assert.equal(persistedTrace.response.status, 201);
  const manifest = traceInput.snapshotManifest;
  const preparedManifest = persistedTrace.body.chain.snapshotManifestId;

  await postJson(`${projectUrl}/features`, { id: "FEATURE-001", version: 1, name: "Submit order" });
  await postJson(`${projectUrl}/claim-scopes`, {
    id: "SCOPE-001",
    version: 1,
    scope: { actor: "normal-user" },
  });
  await postJson(`${projectUrl}/claims`, {
    id: "CLAIM-001",
    version: 1,
    featureId: "FEATURE-001",
    type: "NORMATIVE_REQUIREMENT",
    statement: "A normal user may submit only a DRAFT order.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-001",
    scopeVersion: 1,
  });
  await postJson(`${projectUrl}/test-specs`, {
    id: "TEST-001",
    version: 1,
    name: "Read order state",
    risk: "LOW",
    approved: false,
    featureId: "FEATURE-001",
    verifiesClaims: [{ id: "CLAIM-001", version: 1 }],
    environment: { target: "sit", operationLevel: "SAFE_READ" },
    steps: [{ id: "read", executor: "HTTP", method: "GET", path: "/orders/1" }],
    assertions: [{ id: "http-status", type: "HTTP_STATUS", stepId: "read", expected: 200 }],
    cleanup: null,
    policy: { approvalRequired: true },
  });
  const approvedTestSpec = await postJson(
    `${projectUrl}/test-specs/TEST-001/approvals`,
    { expectedVersion: 1, rationale: "The bounded read scenario is ready for Runner execution." },
    { authorization: "Bearer quality-reviewer" },
  );
  assert.equal(approvedTestSpec.response.status, 201);

  const execution = {
    id: "EXEC-001",
    testSpecId: "TEST-001",
    testSpecVersion: 2,
    snapshotManifestId: preparedManifest,
    deploymentId: manifest.deployment.id,
    runner: { id: "RUNNER-001", version: "1.0.0" },
    completionReason: "COMPLETED",
    startedAt: "2026-07-14T03:50:00.000Z",
    finishedAt: "2026-07-14T03:55:00.000Z",
    attempts: [
      {
        number: 1,
        startedAt: "2026-07-14T03:50:00.000Z",
        finishedAt: "2026-07-14T03:55:00.000Z",
        phaseStatus: "PASS",
        stepResults: [{ id: "read", status: "PASS" }],
        assertionResults: [{ id: "http-status", status: "PASS", actual: 200 }],
        cleanup: { status: "SKIPPED" },
      },
    ],
  };
  const evidence = {
    id: "EVIDENCE-001",
    type: "ASSERTION",
    freshness: "FRESH",
    manifest: {
      executionId: execution.id,
      testSpecId: execution.testSpecId,
      testSpecVersion: execution.testSpecVersion,
      snapshotManifestId: execution.snapshotManifestId,
      deploymentId: execution.deploymentId,
      runnerId: execution.runner.id,
      runnerVersion: execution.runner.version,
      snapshotComponents: {
        source: manifest.source,
        build: manifest.build,
        deployment: manifest.deployment,
        runtime: manifest.runtime,
      },
      assertionResults: execution.attempts[0].assertionResults,
      redactions: [],
    },
  };
  const normalized = createExecutionEvidenceBundle({ execution, evidence: [evidence] }, fixedClock);
  const signed = signExecutionEvidenceBundle("PROJECT-001", normalized, runnerSecret);

  const ingested = await postJson(`${projectUrl}/test-executions`, signed);
  assert.equal(ingested.response.status, 201);
  assert.equal(ingested.body.execution.status, "PASS");
  assert.equal(ingested.body.evidence[0].integrity, "VERIFIED");

  const queried = await fetch(`${projectUrl}/test-executions/EXEC-001/evidence`);
  assert.equal(queried.status, 200);
  assert.equal((await queried.json()).evidence[0].contentHash, normalized.evidence[0].contentHash);
  const baseline = await fetch(`${projectUrl}/features/FEATURE-001/baseline`);
  const baselineBody = await baseline.json();
  assert.equal(baselineBody.testExecutions[0].id, "EXEC-001");
  assert.equal(baselineBody.testExecutions[0].evidenceCount, 1);

  const forged = structuredClone(signed);
  forged.attestation.signature = "0".repeat(64);
  const rejected = await postJson(`${projectUrl}/test-executions`, forged);
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.body.error.code, "RUNNER_ATTESTATION_INVALID");

  const crossProjectSignature = signExecutionEvidenceBundle("PROJECT-OTHER", normalized, runnerSecret);
  const crossProject = await postJson(`${projectUrl}/test-executions`, crossProjectSignature);
  assert.equal(crossProject.response.status, 401);
  assert.equal(crossProject.body.error.code, "RUNNER_ATTESTATION_INVALID");
});

test("attested fact scans are snapshot-bound and queryable as a one-hop graph", async (t) => {
  const scannerSecret = "scanner-shared-secret";
  const baseUrl = await startServer(t, {
    scannerKeyResolver: (scannerId) => (scannerId === "SCANNER-001" ? scannerSecret : null),
  });
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-001`;
  const persistedTrace = await postJson(`${projectUrl}/trace-chains`, await exampleInput());
  const snapshotManifestId = persistedTrace.body.chain.snapshotManifestId;
  const source = {
    artifact: "src/server.js",
    startLine: 1,
    endLine: 4,
    contentHash: `sha256:${"a".repeat(64)}`,
  };
  const unsigned = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId,
    sourceComponentId: (await exampleInput()).snapshotManifest.source.id,
    sourceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt: "2026-07-14T04:00:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [
      { type: "ARTIFACT", naturalKey: "artifact:src/server.js", name: "src/server.js", attributes: {}, source },
      { type: "ENDPOINT", naturalKey: "http:GET /orders", name: "GET /orders", attributes: { method: "GET", path: "/orders" }, source },
    ],
    edges: [],
  });
  const artifact = unsigned.nodes.find((node) => node.type === "ARTIFACT");
  const endpoint = unsigned.nodes.find((node) => node.type === "ENDPOINT");
  const withEdge = createFactBundle({
    ...unsigned,
    nodes: unsigned.nodes,
    edges: [{ subjectId: artifact.id, predicate: "CONTAINS", objectId: endpoint.id, attributes: {}, source }],
  });
  const signed = signFactBundle(withEdge, scannerSecret);

  const rejected = await postJson(`${projectUrl}/fact-scans`, signFactBundle(withEdge, "wrong-secret"));
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.body.error.code, "SCANNER_ATTESTATION_INVALID");

  const wrongDigestBundle = createFactBundle({
    ...withEdge,
    sourceDigest: `sha256:${"9".repeat(64)}`,
  });
  const wrongDigest = await postJson(
    `${projectUrl}/fact-scans`,
    signFactBundle(wrongDigestBundle, scannerSecret),
  );
  assert.equal(wrongDigest.response.status, 409);
  assert.equal(wrongDigest.body.error.code, "PERSISTENCE_CONFLICT");

  const ingested = await postJson(`${projectUrl}/fact-scans`, signed);
  assert.equal(ingested.response.status, 201);
  assert.equal(ingested.body.nodeCount, 2);
  const queried = await fetch(`${projectUrl}/facts?snapshotManifestId=${snapshotManifestId}&type=ENDPOINT&q=orders`);
  const graph = await queried.json();
  assert.equal(queried.status, 200);
  assert.deepEqual(graph.matchedNodeIds, [endpoint.id]);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges[0].predicate, "CONTAINS");
});

test("Workspace observation API persists a source-only Snapshot and server-normalized Facts", async (t) => {
  const baseUrl = await startServer(t);
  const projectId = "PROJECT-WORKSPACE-OBSERVATIONS";
  assert.equal((await postJson(`${baseUrl}/v1/projects`, {
    organization: { id: "ORG-WORKSPACE", name: "Local Workspace" },
    tenant: { id: "TENANT-WORKSPACE", name: "Local browser tenant" },
    project: { id: projectId, name: "Orders" },
    principals: [{ id: "USER-WORKSPACE", type: "USER", displayName: "Workspace owner" }],
  })).response.status, 201);

  const input = {
    workspaceName: "Orders",
    rootName: "orders-service",
    observedAt: "2026-07-14T04:00:00.000Z",
    records: [{
      path: "orders-service/src/orders.ts",
      size: 420,
      contentFingerprint: "CONTENT-FINGERPRINT-ORDERS",
      supported: true,
      candidates: [{
        localCandidateId: "CANDIDATE-GET-ORDER",
        kind: "ENDPOINT",
        name: "GET /orders/:id",
        method: "GET",
        modulePath: "orders-service",
        sourcePath: "orders-service/src/orders.ts",
        startLine: 12,
        description: "Discovered GET order endpoint.",
      }],
      configuration: null,
      test: null,
    }],
  };
  const ingested = await postJson(
    `${baseUrl}/v1/projects/${projectId}/workspace-observations`,
    input,
  );

  assert.equal(ingested.response.status, 201);
  assert.equal(ingested.body.projectId, projectId);
  assert.equal(ingested.body.candidateFacts[0].localCandidateId, "CANDIDATE-GET-ORDER");
  const facts = await fetch(
    `${baseUrl}/v1/projects/${projectId}/facts?snapshotManifestId=${ingested.body.snapshotManifestId}`,
  );
  const graph = await facts.json();
  assert.equal(facts.status, 200);
  assert.equal(graph.nodes.some((node) => node.type === "ENDPOINT"), true);
  assert.equal(graph.edges[0].predicate, "CONTAINS");

  const repeated = await postJson(
    `${baseUrl}/v1/projects/${projectId}/workspace-observations`,
    input,
  );
  assert.equal(repeated.response.status, 201);
  assert.deepEqual(repeated.body, ingested.body);
});

test("Skill API registers two attested adapters and preserves a reviewable reverse run", async (t) => {
  const scannerSecret = "scanner-shared-secret";
  const publisherSecret = "publisher-shared-secret";
  const referenceSkills = createReferenceSkillSet();
  const installed = new Map(
    referenceSkills.map(({ adapter }) => [`${adapter.id}\u0000${adapter.version}`, adapter]),
  );
  const baseUrl = await startServer(t, {
    scannerKeyResolver: (scannerId) => (scannerId === "SCANNER-001" ? scannerSecret : null),
    publisherKeyResolver: (publisher) => (publisher === "TRAQEN" ? publisherSecret : null),
    installedSkillResolver: (skillId, version) => installed.get(`${skillId}\u0000${version}`) ?? null,
    skillPolicyResolver: () => ({
      allowedSkillIds: referenceSkills.map(({ adapter }) => adapter.id),
      allowedPublishers: ["TRAQEN"],
      maxSkills: 2,
      maxAttempts: 1,
      maxInputNodes: 1,
    }),
    reverseOrchestrator: new ReverseSkillOrchestrator({
      adapters: referenceSkills.map(({ adapter }) => adapter),
      clock: fixedClock,
    }),
    reviewerResolver: (_projectId, context) =>
      context.authorization === "Bearer reviewer-token"
        ? { actorId: "USER-001", actorRole: "business-owner" }
        : null,
    reviewPolicyResolver: () => ({
      allowedRoles: ["business-owner"],
      allowedOutcomes: ["CONFIRMED", "EXCEPTION_RECORDED", "REJECTED", "INSUFFICIENT_EVIDENCE", "DEFERRED"],
      allowedTestSpecApproverRoles: ["business-owner"],
    }),
    implementationReviewerResolver: (_projectId, context) => {
      if (context.authorization === "Bearer implementation-token") {
        return { actorId: "DEV-001", actorRole: "developer" };
      }
      if (context.authorization === "Bearer reviewer-token") {
        return { actorId: "USER-001", actorRole: "business-owner" };
      }
      return null;
    },
    implementationPolicyResolver: () => ({ allowedRoles: ["developer"] }),
  });
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-001`;
  const traceInput = await exampleInput();
  const persistedTrace = await postJson(`${projectUrl}/trace-chains`, traceInput);
  const snapshotManifestId = persistedTrace.body.chain.snapshotManifestId;
  const source = {
    artifact: "src/orders.js",
    startLine: 1,
    endLine: 3,
    contentHash: `sha256:${"c".repeat(64)}`,
  };
  const bundle = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId,
    sourceComponentId: traceInput.snapshotManifest.source.id,
    sourceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt: "2026-07-14T03:55:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [{
      type: "ENDPOINT",
      naturalKey: "http:POST /orders/{id}/submit",
      name: "POST /orders/{id}/submit",
      attributes: { method: "POST", path: "/orders/{id}/submit" },
      source,
    }],
    edges: [],
  });
  assert.equal((await postJson(`${projectUrl}/fact-scans`, signFactBundle(bundle, scannerSecret))).response.status, 201);

  const forged = {
    ...signReverseSkillManifest(referenceSkills[0].manifest, publisherSecret),
    status: "ALLOWED",
  };
  forged.attestation = { ...forged.attestation, signature: "0".repeat(64) };
  const rejected = await postJson(`${baseUrl}/v1/skills`, forged);
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.body.error.code, "SKILL_ATTESTATION_INVALID");

  const clientTimestamp = await postJson(`${baseUrl}/v1/skills`, {
    ...signReverseSkillManifest(referenceSkills[0].manifest, publisherSecret),
    status: "ALLOWED",
    registeredAt: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(clientTimestamp.response.status, 400);
  assert.match(clientTimestamp.body.error.message, /assigned by the server/);

  let firstRegistration;
  for (const item of referenceSkills) {
    const registered = await postJson(`${baseUrl}/v1/skills`, {
      ...signReverseSkillManifest(item.manifest, publisherSecret),
      status: "ALLOWED",
    });
    assert.equal(registered.response.status, 201);
    firstRegistration ??= registered.body;
  }
  const observedRegistration = await postJson(`${baseUrl}/v1/skills`, {
    ...signReverseSkillManifest(referenceSkills[0].manifest, publisherSecret),
    status: "OBSERVE",
  });
  const allowedAgain = await postJson(`${baseUrl}/v1/skills`, {
    ...signReverseSkillManifest(referenceSkills[0].manifest, publisherSecret),
    status: "ALLOWED",
  });
  assert.equal(observedRegistration.response.status, 201);
  assert.equal(allowedAgain.response.status, 201);
  assert.ok(Date.parse(observedRegistration.body.registeredAt) > Date.parse(firstRegistration.registeredAt));
  assert.ok(Date.parse(allowedAgain.body.registeredAt) > Date.parse(observedRegistration.body.registeredAt));
  const skillsResponse = await fetch(`${baseUrl}/v1/skills`);
  assert.equal(skillsResponse.status, 200);
  const listedSkills = (await skillsResponse.json()).skills;
  assert.equal(listedSkills.length, 2);
  assert.equal(listedSkills.find((skill) => skill.manifest.metadata.id === referenceSkills[0].adapter.id).status, "ALLOWED");

  const runRequest = {
    id: "REVERSE-RUN-API-001",
    projectId: "PROJECT-001",
    snapshotManifestId,
    sourceComponentId: traceInput.snapshotManifest.source.id,
    factBundleIds: [bundle.id],
    skills: referenceSkills.map(({ adapter }) => ({ id: adapter.id, version: adapter.version })),
    taskScope: { nodeTypes: ["ENDPOINT"] },
  };
  const clientPolicy = await postJson(`${baseUrl}/v1/reverse-runs`, {
    ...runRequest,
    policyContext: { allowNetwork: true },
  });
  assert.equal(clientPolicy.response.status, 400);
  assert.match(clientPolicy.body.error.message, /assigned by the server/);

  const missingSkillVersion = await postJson(`${baseUrl}/v1/reverse-runs`, {
    ...runRequest,
    skills: [{ id: referenceSkills[0].adapter.id }],
  });
  assert.equal(missingSkillVersion.response.status, 400);
  assert.match(missingSkillVersion.body.error.message, /version must be a non-empty string/);

  const duplicateBundles = await postJson(`${baseUrl}/v1/reverse-runs`, {
    ...runRequest,
    factBundleIds: [bundle.id, bundle.id],
  });
  assert.equal(duplicateBundles.response.status, 400);
  assert.match(duplicateBundles.body.error.message, /must not contain duplicates/);

  const duplicateSkills = await postJson(`${baseUrl}/v1/reverse-runs`, {
    ...runRequest,
    skills: [runRequest.skills[0], runRequest.skills[0]],
  });
  assert.equal(duplicateSkills.response.status, 400);
  assert.match(duplicateSkills.body.error.message, /must not contain duplicates/);

  const raisedInputLimit = await postJson(`${baseUrl}/v1/reverse-runs`, {
    ...runRequest,
    maxInputNodes: 2,
  });
  assert.equal(raisedInputLimit.response.status, 400);
  assert.match(raisedInputLimit.body.error.message, /exceeds the server policy/);

  const executed = await postJson(`${baseUrl}/v1/reverse-runs`, runRequest);
  assert.equal(executed.response.status, 201);
  assert.equal(executed.body.status, "WAITING_REVIEW");
  assert.equal(executed.body.mergedOutput.candidateFeatures[0].sources.length, 2);

  const queried = await fetch(`${projectUrl}/reverse-runs/REVERSE-RUN-API-001`);
  assert.equal(queried.status, 200);
  assert.deepEqual(await queried.json(), executed.body);

  const asynchronous = await postJson(`${baseUrl}/v1/reverse-runs?async=true`, {
    ...runRequest,
    id: "REVERSE-RUN-API-ASYNC-001",
  });
  assert.equal(asynchronous.response.status, 202);
  assert.equal(asynchronous.body.projectId, "PROJECT-001");
  let asynchronousResult = asynchronous.body;
  for (let attempt = 0; attempt < 20 && asynchronousResult.status !== "WAITING_REVIEW"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const polled = await fetch(`${projectUrl}/reverse-runs/REVERSE-RUN-API-ASYNC-001`);
    assert.equal(polled.status, 200);
    asynchronousResult = await polled.json();
  }
  assert.equal(asynchronousResult.status, "WAITING_REVIEW");
  const cancelCompleted = await postJson(
    `${projectUrl}/reverse-runs/REVERSE-RUN-API-ASYNC-001/cancel`,
    {},
  );
  assert.equal(cancelCompleted.response.status, 409);

  const candidate = executed.body.mergedOutput.candidateClaims.find((item) => item.subjectKey.startsWith("endpoint:"));
  const candidateFeature = executed.body.mergedOutput.candidateFeatures.find(
    (item) => item.externalKey === candidate.subjectKey,
  );
  const reviewInput = {
    id: "REVIEW-API-001",
    outcome: "CONFIRMED",
    rationale: "The product owner confirms endpoint availability for the standard order flow.",
    candidateFeatureId: candidateFeature.id,
    target: {
      featureMode: "CREATE",
      featureId: "FEATURE-REVIEW-API-001",
      claimId: "CLAIM-REVIEW-API-001",
      scopeId: "SCOPE-REVIEW-API-001",
      decisionId: "DECISION-REVIEW-API-001",
    },
    normative: {
      statement: "The submit-order capability must expose its submission endpoint.",
      constraint: { dimension: "endpointExposed", operator: "EQUALS", value: true },
      scope: { actor: "normal-user", orderType: "standard" },
    },
  };
  const reviewUrl = `${projectUrl}/reverse-runs/${executed.body.id}/candidates/${candidate.id}/reviews`;
  const unauthenticated = await postJson(reviewUrl, reviewInput);
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error.code, "REVIEWER_AUTHENTICATION_REQUIRED");

  const reviewed = await postJson(reviewUrl, reviewInput, { authorization: "Bearer reviewer-token" });
  assert.equal(reviewed.response.status, 201);
  assert.equal(reviewed.body.review.actorId, "USER-001");
  assert.equal(reviewed.body.claim.type, "NORMATIVE_REQUIREMENT");
  assert.equal(reviewed.body.conformance.status, "CONFORMS");

  const reviewsResponse = await fetch(`${projectUrl}/reverse-runs/${executed.body.id}/reviews`);
  assert.equal(reviewsResponse.status, 200);
  assert.equal((await reviewsResponse.json()).reviews.length, 1);
  const baselineResponse = await fetch(`${projectUrl}/features/FEATURE-REVIEW-API-001/baseline`);
  const baseline = await baselineResponse.json();
  assert.equal(baselineResponse.status, 200);
  assert.equal(baseline.claims[0].latestDecision.type, "CONFIRMED");
  assert.equal(baseline.implementationMappings[0].sourceCandidateId, candidate.id);

  const traceabilityResponse = await fetch(
    `${projectUrl}/features/FEATURE-REVIEW-API-001/traceability?snapshotManifestId=${snapshotManifestId}`,
  );
  const traceability = await traceabilityResponse.json();
  assert.equal(traceabilityResponse.status, 200);
  assert.equal(traceability.dimensions.authority[0].status, "CONFIRMED");
  assert.equal(traceability.dimensions.conformance[0].status, "CONFORMS");
  assert.equal(traceability.dimensions.verification[0].status, "NOT_RUN");
  assert.ok(traceability.gaps.some((gap) => gap.type === "NO_TEST_SPEC"));
  assert.equal(traceability.claims[0].facts.nodes[0].type, "ENDPOINT");
  assert.ok(traceability.traceChains[0].segments.some((segment) => segment.relation === "IMPLEMENTED_BY" || segment.relation === "EXPOSED_BY"));
  assert.ok(traceability.traceChains[0].segments.some((segment) => segment.relation === "CONFIRMED_BY"));
  assert.ok(traceability.traceChains[0].segments.some((segment) => segment.relation === "CONFORMS_TO"));

  const featureDetail = await fetch(`${projectUrl}/features/FEATURE-REVIEW-API-001`);
  assert.equal(featureDetail.status, 200);
  assert.equal((await featureDetail.json()).feature.id, "FEATURE-REVIEW-API-001");
  const featureConflicts = await fetch(
    `${projectUrl}/features/FEATURE-REVIEW-API-001/conflicts?snapshotManifestId=${snapshotManifestId}`,
  );
  assert.equal(featureConflicts.status, 200);
  assert.deepEqual((await featureConflicts.json()).conflicts, []);
  const featureTraceChains = await fetch(
    `${projectUrl}/features/FEATURE-REVIEW-API-001/trace-chains?snapshotManifestId=${snapshotManifestId}`,
  );
  assert.equal(featureTraceChains.status, 200);
  const featureTraceChainsBody = await featureTraceChains.json();
  assert.equal(featureTraceChainsBody.traceChains[0].id, traceability.traceChains[0].id);
  assert.deepEqual(featureTraceChainsBody.gaps, traceability.gaps);

  const recomputed = await postJson(
    `${projectUrl}/features/FEATURE-REVIEW-API-001/trace-chains/recompute`,
    { snapshotManifestId },
  );
  assert.equal(recomputed.response.status, 201);
  assert.equal(recomputed.body.persisted[0].revision, 1);
  const storedChain = await fetch(`${projectUrl}/trace-chains/${recomputed.body.traceChains[0].id}`);
  const storedChainBody = await storedChain.json();
  assert.equal(storedChain.status, 200);
  assert.deepEqual(storedChainBody.segments, recomputed.body.traceChains[0].segments);

  const generationInput = {
    id: "TEST-GENERATED-API-001",
    snapshotManifestId,
    endpointFactId: bundle.nodes[0].factId,
    target: "sit",
    expectedHttpStatus: 200,
    preconditions: [{ type: "SEED", seedRef: "draft-order" }],
    pathParameters: { id: "${seed.orderId}" },
    variables: { accessToken: { secretRef: "accounts/normal-user/token" } },
    headers: { Authorization: "Bearer ${accessToken}" },
    body: { orderId: "${seed.orderId}" },
    cleanup: { strategy: "SEED_RESET" },
    databaseVerification: {
      queryRef: "order_by_id",
      parameters: ["${seed.orderId}"],
      assertions: [{
        id: "database-status",
        type: "DATABASE_FIELD",
        field: "status",
        expected: "SUBMITTED",
      }],
    },
  };
  const generationUrl =
    `${projectUrl}/features/FEATURE-REVIEW-API-001/claims/CLAIM-REVIEW-API-001/test-spec-drafts`;
  const generated = await postJson(generationUrl, generationInput);
  assert.equal(generated.response.status, 201);
  assert.equal(generated.body.draft.approved, false);
  assert.equal(generated.body.draft.origin.type, "CONFIRMED_CLAIM_CONVERSION");
  assert.equal(generated.body.draft.origin.decisionId, "DECISION-REVIEW-API-001");
  assert.equal(generated.body.draft.environment.operationLevel, "CONTROLLED_WRITE");
  assert.equal(generated.body.draft.steps[0].path, "/orders/${seed.orderId}/submit");
  assert.equal(generated.body.draft.steps[1].queryRef, "order_by_id");
  assert.equal(generated.body.draft.assertions[1].type, "DATABASE_FIELD");
  assert.deepEqual(generated.body.validation.violations.map((item) => item.code), ["APPROVAL_REQUIRED"]);
  const repeatedGeneration = await postJson(generationUrl, generationInput);
  assert.equal(repeatedGeneration.response.status, 201);
  assert.deepEqual(repeatedGeneration.body, generated.body);

  const approvalUrl = `${projectUrl}/test-specs/TEST-GENERATED-API-001/approvals`;
  const approvalInput = {
    expectedVersion: 1,
    rationale: "The business owner approves this mapped endpoint scenario with deterministic cleanup.",
  };
  const unauthenticatedApproval = await postJson(approvalUrl, approvalInput);
  assert.equal(unauthenticatedApproval.response.status, 401);
  const approved = await postJson(
    approvalUrl,
    approvalInput,
    { authorization: "Bearer reviewer-token" },
  );
  assert.equal(approved.response.status, 201);
  assert.equal(approved.body.version, 2);
  assert.equal(approved.body.approval.actorId, "USER-001");
  assert.equal(approved.body.origin.requestFingerprint, generated.body.generation.requestFingerprint);
  const repeatedApproval = await postJson(
    approvalUrl,
    approvalInput,
    { authorization: "Bearer reviewer-token" },
  );
  assert.equal(repeatedApproval.response.status, 201);
  assert.deepEqual(repeatedApproval.body, approved.body);
  const generatedAfterApproval = await postJson(generationUrl, generationInput);
  assert.equal(generatedAfterApproval.response.status, 201);
  assert.equal(generatedAfterApproval.body.draft.version, 1);
  assert.equal(generatedAfterApproval.body.draft.approved, false);
  assert.deepEqual(generatedAfterApproval.body.generation, generated.body.generation);

  const continuedTraceInput = structuredClone(traceInput);
  continuedTraceInput.snapshotManifest.source = {
    id: "SOURCE-REVIEW-API-CONTINUED",
    digest: `sha256:${"f".repeat(64)}`,
  };
  continuedTraceInput.snapshotManifest.build = {
    id: "BUILD-REVIEW-API-CONTINUED",
    digest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  };
  continuedTraceInput.snapshotManifest.deployment = {
    id: "DEPLOY-REVIEW-API-CONTINUED",
    digest: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
  };
  continuedTraceInput.snapshotManifest.runtime = {
    id: "RUNTIME-REVIEW-API-CONTINUED",
    digest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
  };
  continuedTraceInput.snapshotManifest.observedFrom = "2026-07-14T04:05:00.000Z";
  continuedTraceInput.snapshotManifest.observedTo = "2026-07-14T04:09:00.000Z";
  continuedTraceInput.execution.deploymentId = continuedTraceInput.snapshotManifest.deployment.id;
  const continuedTrace = await postJson(`${projectUrl}/trace-chains`, continuedTraceInput);
  assert.equal(continuedTrace.response.status, 201);
  const continuedSnapshotManifestId = continuedTrace.body.chain.snapshotManifestId;
  const continuedBundle = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId: continuedSnapshotManifestId,
    sourceComponentId: continuedTraceInput.snapshotManifest.source.id,
    sourceDigest: continuedTraceInput.snapshotManifest.source.digest,
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt: "2026-07-14T04:09:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [{
      type: "ENDPOINT",
      naturalKey: "http:POST /orders/{id}/submit",
      name: "POST /orders/{id}/submit",
      attributes: { method: "POST", path: "/orders/{id}/submit" },
      source,
    }],
    edges: [],
  });
  assert.equal(
    (await postJson(`${projectUrl}/fact-scans`, signFactBundle(continuedBundle, scannerSecret))).response.status,
    201,
  );
  const continued = await postJson(`${projectUrl}/change-sets`, {
    id: "CHANGESET-CONTINUITY-API-001",
    fromSnapshotManifestId: snapshotManifestId,
    toSnapshotManifestId: continuedSnapshotManifestId,
  });
  assert.equal(continued.response.status, 201);
  assert.deepEqual(continued.body.impact.invalidations, []);
  assert.equal(continued.body.continuities.length, 1);
  assert.deepEqual(continued.body.impact.continuedFeatureIds, ["FEATURE-REVIEW-API-001"]);
  const continuedTraceabilityResponse = await fetch(
    `${projectUrl}/features/FEATURE-REVIEW-API-001/traceability?snapshotManifestId=${continuedSnapshotManifestId}`,
  );
  const continuedTraceability = await continuedTraceabilityResponse.json();
  assert.equal(continuedTraceability.dimensions.conformance[0].status, "CONFORMS");
  assert.equal(
    continuedTraceability.claims[0].selectedImplementationMapping.snapshotManifestId,
    continuedSnapshotManifestId,
  );
  assert.ok(continuedTraceability.traceChains[0].segments.some(
    (segment) => ["IMPLEMENTED_BY", "EXPOSED_BY"].includes(segment.relation) && segment.status === "ACTIVE",
  ));

  const nextTraceInput = structuredClone(continuedTraceInput);
  nextTraceInput.snapshotManifest.source = {
    id: "SOURCE-REVIEW-API-002",
    digest: `sha256:${"1".repeat(64)}`,
  };
  nextTraceInput.snapshotManifest.build = {
    id: "BUILD-REVIEW-API-002",
    digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  };
  nextTraceInput.snapshotManifest.deployment = {
    id: "DEPLOY-REVIEW-API-002",
    digest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  };
  nextTraceInput.snapshotManifest.runtime = {
    id: "RUNTIME-REVIEW-API-002",
    digest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
  };
  nextTraceInput.snapshotManifest.observedFrom = "2026-07-14T04:10:00.000Z";
  nextTraceInput.snapshotManifest.observedTo = "2026-07-14T04:15:00.000Z";
  nextTraceInput.execution.deploymentId = nextTraceInput.snapshotManifest.deployment.id;
  const nextTrace = await postJson(`${projectUrl}/trace-chains`, nextTraceInput);
  assert.equal(nextTrace.response.status, 201);
  const nextSnapshotManifestId = nextTrace.body.chain.snapshotManifestId;
  assert.notEqual(nextSnapshotManifestId, snapshotManifestId);

  const nextSource = {
    ...source,
    contentHash: `sha256:${"e".repeat(64)}`,
  };
  const nextBundle = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId: nextSnapshotManifestId,
    sourceComponentId: nextTraceInput.snapshotManifest.source.id,
    sourceDigest: nextTraceInput.snapshotManifest.source.digest,
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt: "2026-07-14T04:15:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [{
      type: "ENDPOINT",
      naturalKey: "http:POST /orders/{id}/submit",
      name: "POST /orders/{id}/submit",
      attributes: { method: "POST", path: "/orders/{id}/submit", handlerVersion: 2 },
      source: nextSource,
    }],
    edges: [],
  });
  assert.equal(
    (await postJson(`${projectUrl}/fact-scans`, signFactBundle(nextBundle, scannerSecret))).response.status,
    201,
  );

  const comparisonInput = {
    id: "CHANGESET-REVIEW-API-001",
    fromSnapshotManifestId: continuedSnapshotManifestId,
    toSnapshotManifestId: nextSnapshotManifestId,
  };
  const compared = await postJson(`${projectUrl}/change-sets`, comparisonInput);
  assert.equal(compared.response.status, 201);
  assert.equal(compared.body.changeSet.complete, true);
  assert.ok(compared.body.changeSet.changes.some((change) => change.kind === "MODIFIED"));
  assert.deepEqual(compared.body.impact.affectedFeatureIds, ["FEATURE-REVIEW-API-001"]);
  assert.deepEqual(compared.body.impact.affectedClaimRefs, [{ id: "CLAIM-REVIEW-API-001", version: 1 }]);
  assert.ok(compared.body.impact.invalidations[0].layers.includes("CONFORMANCE"));
  assert.ok(compared.body.impact.invalidations[0].layers.includes("VERIFICATION"));
  assert.ok(compared.body.impact.invalidations[0].preserves.includes("NORMATIVE_CLAIM"));
  assert.ok(compared.body.impact.invalidations[0].preserves.includes("BUSINESS_DECISION"));

  const storedImpactResponse = await fetch(
    `${projectUrl}/change-sets/${comparisonInput.id}/impact`,
  );
  assert.equal(storedImpactResponse.status, 200);
  assert.deepEqual(await storedImpactResponse.json(), compared.body);
  const repeatedComparison = await postJson(`${projectUrl}/change-sets`, comparisonInput);
  assert.equal(repeatedComparison.response.status, 201);
  assert.deepEqual(repeatedComparison.body, compared.body);

  const nextTraceabilityResponse = await fetch(
    `${projectUrl}/features/FEATURE-REVIEW-API-001/traceability?snapshotManifestId=${nextSnapshotManifestId}`,
  );
  const nextTraceability = await nextTraceabilityResponse.json();
  assert.equal(nextTraceabilityResponse.status, 200);
  assert.equal(nextTraceability.dimensions.authority[0].status, "CONFIRMED");
  assert.equal(nextTraceability.dimensions.conformance[0].status, "STALE");
  assert.equal(
    nextTraceability.claims[0].selectedImplementationMapping.snapshotManifestId,
    continuedSnapshotManifestId,
  );
  assert.ok(nextTraceability.traceChains[0].segments.some(
    (segment) => ["IMPLEMENTED_BY", "EXPOSED_BY"].includes(segment.relation) && segment.status === "STALE",
  ));
  assert.ok(nextTraceability.gaps.some((gap) => gap.type === "CONFORMANCE_STALE"));
  assert.ok(!nextTraceability.gaps.some((gap) => gap.type === "MISSING_AUTHORITY"));

  const nextReverseRun = await postJson(`${baseUrl}/v1/reverse-runs`, {
    id: "REVERSE-RUN-REANALYSIS-API-001",
    projectId: "PROJECT-001",
    snapshotManifestId: nextSnapshotManifestId,
    sourceComponentId: nextTraceInput.snapshotManifest.source.id,
    factBundleIds: [nextBundle.id],
    skills: referenceSkills.map(({ adapter }) => ({ id: adapter.id, version: adapter.version })),
    taskScope: { nodeTypes: ["ENDPOINT"] },
  });
  assert.equal(nextReverseRun.response.status, 201);
  const nextCandidate = nextReverseRun.body.mergedOutput.candidateClaims.find(
    (item) => item.subjectKey.startsWith("endpoint:"),
  );
  const reanalysisInput = {
    id: "IMPLEMENTATION-REANALYSIS-API-001",
    sourceRunId: nextReverseRun.body.id,
    sourceCandidateId: nextCandidate.id,
    rationale: "The developer confirms the current Snapshot endpoint mapping after the changed handler was reviewed.",
  };
  const reanalysisUrl = `${projectUrl}/features/FEATURE-REVIEW-API-001/claims/CLAIM-REVIEW-API-001/implementation-reanalyses`;
  assert.equal((await postJson(reanalysisUrl, reanalysisInput)).response.status, 401);
  assert.equal(
    (await postJson(reanalysisUrl, reanalysisInput, { authorization: "Bearer reviewer-token" })).response.status,
    403,
  );
  const reanalyzed = await postJson(reanalysisUrl, reanalysisInput, {
    authorization: "Bearer implementation-token",
  });
  assert.equal(reanalyzed.response.status, 201);
  assert.equal(reanalyzed.body.conformance.status, "CONFORMS");
  assert.equal(reanalyzed.body.conformance.analysisMethod.actorId, "DEV-001");
  const repeatedReanalysis = await postJson(reanalysisUrl, reanalysisInput, {
    authorization: "Bearer implementation-token",
  });
  assert.equal(repeatedReanalysis.response.status, 201);
  assert.deepEqual(repeatedReanalysis.body, reanalyzed.body);

  const repairedResponse = await fetch(
    `${projectUrl}/features/FEATURE-REVIEW-API-001/traceability?snapshotManifestId=${nextSnapshotManifestId}`,
  );
  const repaired = await repairedResponse.json();
  assert.equal(repairedResponse.status, 200);
  assert.equal(repaired.dimensions.authority[0].status, "CONFIRMED");
  assert.equal(repaired.dimensions.conformance[0].status, "CONFORMS");
  assert.equal(repaired.claims[0].selectedImplementationMapping.snapshotManifestId, nextSnapshotManifestId);
  assert.ok(!repaired.gaps.some((gap) => gap.type === "CONFORMANCE_STALE"));
});
