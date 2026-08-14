import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkspaceObservationRequest,
  ensureWorkspaceProject,
  getWorkspaceAnalysisRun,
  ingestWorkspaceObservations,
  pauseWorkspaceAnalysisRun,
  resumeWorkspaceAnalysisRun,
  startWorkspaceAnalysisRun,
  workspaceEnrichmentsFromAnalysisResult,
  workspaceRunSubscriptionBeforeStart,
  workspaceRunSubscriptionFromServer,
} from "../app/workspace-analysis-run-client.ts";
import {
  getServerWorkspaceUnderstanding,
  registerServerWorkspaceSource,
  startHistoricalRevisionReanalysis,
  startServerWorkspaceUnderstanding,
} from "../app/server-understanding-client.ts";

const apiBase = "http://127.0.0.1:3100";
const projectId = "PROJECT-WEB";

function records() {
  return [{
    scannerVersion: 6,
    path: "workspace/src/orders.ts",
    size: 200,
    lastModified: 10,
    contentFingerprint: "CONTENT-123",
    supported: true,
    candidates: [{
      id: "LOCAL-CANDIDATE-1",
      name: "GET /orders",
      kind: "ENDPOINT",
      method: "GET",
      modulePath: "workspace",
      sourcePath: "workspace/src/orders.ts",
      startLine: 3,
      description: "Discovered endpoint.",
      code: "router.get('/orders', secretHandler)",
    }],
    configuration: {
      path: "workspace/application.yml",
      key: "application.yml",
      value: "apiKey: <redacted>",
    },
    test: {
      path: "workspace/test/orders.test.ts",
      title: "GET orders",
      code: "test source body",
      keys: ["orders"],
    },
  }];
}

function checkpoint(status = "RUNNING") {
  return {
    request: {
      id: "ANALYSIS-WEB-1",
      projectId,
      snapshotManifestId: "SNAPSHOT-WEB-1",
      sourceComponentId: "SOURCE-WEB-1",
      profile: { id: "workspace-hybrid", mode: "HYBRID", model: { enabled: true, profileId: "model-a" } },
    },
    run: {
      id: "ANALYSIS-WEB-1",
      projectId,
      snapshotManifestId: "SNAPSHOT-WEB-1",
      status,
      completedWorkUnitCount: 2,
      plannedWorkUnitCount: 5,
      failedWorkUnitCount: 0,
      startedAt: "2026-07-27T12:00:00.000Z",
      updatedAt: "2026-07-27T12:00:02.000Z",
    },
    workUnits: [],
    result: null,
  };
}

test("builds a bounded observation request without raw candidate or test code", () => {
  const body = buildWorkspaceObservationRequest("Orders", "workspace", records(), "2026-07-27T12:00:00.000Z");

  assert.equal(body.records[0].contentFingerprint, "CONTENT-123");
  assert.equal(body.records[0].candidates[0].localCandidateId, "LOCAL-CANDIDATE-1");
  assert.equal(Object.hasOwn(body.records[0].candidates[0], "code"), false);
  assert.equal(Object.hasOwn(body.records[0].test, "code"), false);
  assert.doesNotMatch(JSON.stringify(body), /secretHandler|test source body/);
});

test("refresh attachment is read-only while pause and resume are explicit mutations", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? "GET" });
    return new Response(JSON.stringify(checkpoint(
      String(url).endsWith("/pause") ? "PAUSED" : "RUNNING",
    )), { status: String(url).endsWith("/pause") || String(url).endsWith("/resume") ? 202 : 200 });
  };
  try {
    await getWorkspaceAnalysisRun(apiBase, "", projectId, "ANALYSIS-WEB-1");
    await getWorkspaceAnalysisRun(apiBase, "", projectId, "ANALYSIS-WEB-1");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);

    await pauseWorkspaceAnalysisRun(apiBase, "", projectId, "ANALYSIS-WEB-1");
    await resumeWorkspaceAnalysisRun(apiBase, "", projectId, "ANALYSIS-WEB-1");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "POST", "POST"]);
    assert.match(calls[2].url, /\/pause$/);
    assert.match(calls[3].url, /\/resume$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bootstraps the API project, ingests observations, then starts one server AnalysisRun", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : null });
    if (calls.length === 1) return new Response(JSON.stringify({ error: { code: "PROJECT_NOT_FOUND" } }), { status: 404 });
    if (calls.length === 2) return new Response(JSON.stringify({ project: { id: projectId } }), { status: 201 });
    if (calls.length === 3) {
      return new Response(JSON.stringify({
        projectId,
        snapshotManifestId: "SNAPSHOT-WEB-1",
        sourceComponentId: "SOURCE-WEB-1",
        factBundleId: "FACT-BUNDLE-WEB-1",
        candidateFacts: [{ localCandidateId: "LOCAL-CANDIDATE-1", stableNodeId: "FACT-NODE-WEB-1", factId: "FACT-WEB-1" }],
      }), { status: 201 });
    }
    return new Response(JSON.stringify(checkpoint()), { status: 202 });
  };
  try {
    await ensureWorkspaceProject(apiBase, "", "Orders", projectId);
    const receipt = await ingestWorkspaceObservations(
      apiBase,
      "",
      projectId,
      buildWorkspaceObservationRequest("Orders", "workspace", records(), "2026-07-27T12:00:00.000Z"),
    );
    const started = await startWorkspaceAnalysisRun(apiBase, "", {
      id: "ANALYSIS-WEB-1",
      projectId,
      snapshotManifestId: receipt.snapshotManifestId,
      sourceComponentId: receipt.sourceComponentId,
      modelProfileId: "model-a",
      mode: "FULL",
    });

    assert.equal(started.run.id, "ANALYSIS-WEB-1");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "POST", "POST", "POST"]);
    assert.match(calls[2].url, /workspace-observations$/);
    assert.match(calls[3].url, /analysis-runs$/);
    assert.equal(calls[3].body.profile.model.profileId, "model-a");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creates subscriptions only from server checkpoints and rejects mismatched results", () => {
  const receipt = {
    projectId,
    snapshotManifestId: "SNAPSHOT-WEB-1",
    sourceComponentId: "SOURCE-WEB-1",
    factBundleId: "FACT-BUNDLE-WEB-1",
    candidateFacts: [{ localCandidateId: "LOCAL-CANDIDATE-1", stableNodeId: "FACT-NODE-WEB-1", factId: "FACT-WEB-1" }],
  };
  const subscription = workspaceRunSubscriptionFromServer(
    checkpoint(),
    receipt,
    "workspace",
    "model-a",
  );
  assert.equal(subscription.status, "RUNNING");
  assert.equal(subscription.runId, "ANALYSIS-WEB-1");

  assert.throws(
    () => workspaceEnrichmentsFromAnalysisResult({
      id: "ANALYSIS-OTHER",
      projectId,
      snapshotManifestId: "SNAPSHOT-WEB-1",
      status: "COMPLETED",
      candidates: [],
    }, subscription),
    /does not match the subscribed AnalysisRun/,
  );

  const enrichments = workspaceEnrichmentsFromAnalysisResult({
    id: "ANALYSIS-WEB-1",
    projectId,
    snapshotManifestId: "SNAPSHOT-WEB-1",
    status: "COMPLETED",
    candidates: [{
      candidateKey: "api:get:/orders",
      mode: "API",
      name: "List orders",
      description: "Evidence-bounded order listing.",
      confidence: "HIGH",
      evidenceFactIds: ["FACT-WEB-1"],
      stableEvidenceNodeIds: ["FACT-NODE-WEB-1"],
      design: {},
      uncertainties: [],
    }],
  }, subscription);
  assert.equal(enrichments[0].id, "LOCAL-CANDIDATE-1");
  assert.equal(enrichments[0].displayName, "List orders");
});

test("persists a non-authoritative run pointer before Start can create server work", () => {
  const receipt = {
    projectId,
    snapshotManifestId: "SNAPSHOT-WEB-1",
    sourceComponentId: "SOURCE-WEB-1",
    factBundleId: "FACT-BUNDLE-WEB-1",
    candidateFacts: [{ localCandidateId: "LOCAL-CANDIDATE-1", stableNodeId: "FACT-NODE-WEB-1", factId: "FACT-WEB-1" }],
  };

  const subscription = workspaceRunSubscriptionBeforeStart(
    "ANALYSIS-WEB-1",
    receipt,
    "workspace",
    "model-a",
    "2026-07-27T12:00:00.000Z",
  );

  assert.equal(subscription.status, "SUBMITTING");
  assert.equal(subscription.runId, "ANALYSIS-WEB-1");
  assert.equal(subscription.snapshotManifestId, receipt.snapshotManifestId);
});

test("registers and follows a server-owned source job without browser scan payloads", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/source-registrations")) {
      return new Response(JSON.stringify({ id: "SOURCE-1", projectId, displayName: "repo", status: "ACTIVE" }), { status: 201 });
    }
    return new Response(JSON.stringify({
      id: "JOB-1",
      projectId,
      sourceRegistrationId: "SOURCE-1",
      snapshotManifestId: "SNAPSHOT-1",
      workspaceExecutionProfileRevisionId: "PROFILE-1",
      requestedMode: "AUTO",
      resolvedMode: "FULL",
      phase: "SOURCE_SCAN",
      status: "RUNNING",
      completedPhases: [],
      outputs: {},
    }), { status: String(url).includes("workspace-analysis-jobs/JOB-1") ? 200 : 202 });
  };
  try {
    const registration = await registerServerWorkspaceSource(apiBase, "", projectId, "/srv/repos/orders");
    const started = await startServerWorkspaceUnderstanding(apiBase, "", projectId, {
      sourceRegistrationId: registration.id,
      requestedMode: "AUTO",
      expectedWorkspaceExecutionProfileRevisionId: "PROFILE-1",
    });
    const current = await getServerWorkspaceUnderstanding(apiBase, "", projectId, started.id);
    await startHistoricalRevisionReanalysis(apiBase, "", projectId, "GRAPH-LEGACY-1");
    assert.equal(current.status, "RUNNING");
    assert.equal(calls.length, 4);
    assert.equal(JSON.parse(calls[0].options.body).rootPath, "/srv/repos/orders");
    assert.equal(JSON.parse(calls[1].options.body).sourceRegistrationId, "SOURCE-1");
    assert.equal(JSON.parse(calls[1].options.body).expectedWorkspaceExecutionProfileRevisionId, "PROFILE-1");
    assert.equal(Object.hasOwn(JSON.parse(calls[1].options.body), "workspaceExecutionProfileRevisionId"), false);
    assert.equal(calls[2].options.body, undefined);
    assert.match(calls[3].url, /graph\/revisions\/GRAPH-LEGACY-1\/reanalysis-jobs$/);
    assert.deepEqual(JSON.parse(calls[3].options.body), {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});
