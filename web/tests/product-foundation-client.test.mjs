import assert from "node:assert/strict";
import test from "node:test";

import {
  decideWorkspaceReviewBatch,
  createGlobalModelReplacementPlan,
  applyGlobalModelReplacementPlan,
  getGlobalModel,
  updateGlobalModel,
  getConnectionHealth,
  getEffectiveCapabilities,
  getWorkspaceCapabilityDraft,
  loadWorkspaceCapabilitySettings,
  listGlobalCapabilityTemplates,
  getWorkspaceReviewQueue,
  listWorkspaceExecutionProfiles,
  activateWorkspaceCapabilityDraft,
  ProductFoundationApiError,
  saveWorkspaceCapabilityDraft,
  saveGlobalCapabilityTemplate,
} from "../app/product-foundation-client.ts";

test("global Skill and MCP template client uses explicit list and revision writes", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return Response.json(options.method === "GET" ? { templates: [] } : { id: "T-1", kind: "SKILL", logicalName: "review", revision: 1, manifest: {}, credentialHandleIds: [], createdAt: "2026-08-20T00:00:00.000Z" });
  };
  try {
    await listGlobalCapabilityTemplates("http://api", "secret");
    await saveGlobalCapabilityTemplate("http://api", "secret", { kind: "SKILL", logicalName: "review", revision: 1, manifest: {}, credentialHandleIds: ["HANDLE-REVIEW"] });
    assert.deepEqual(calls.map(({ options }) => options.method), ["GET", "POST"]);
    assert.ok(calls.every(({ url }) => url.endsWith("/v1/capability-templates")));
    assert.deepEqual(JSON.parse(calls[1].options.body), { kind: "SKILL", logicalName: "review", revision: 1, manifest: {}, credentialHandleIds: ["HANDLE-REVIEW"] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("capability settings recovery is all-or-nothing when the catalog cannot be restored", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/capability-draft")) return Response.json({ draft: { id: "DRAFT-1", workspaceId: "W1", revision: 1 } });
    if (String(url).endsWith("/capabilities/effective")) return Response.json({ error: { message: "catalog temporarily unavailable" } }, { status: 503 });
    if (String(url).endsWith("/execution-profile-revisions")) return Response.json({ profiles: [] });
    throw new Error(`unexpected request ${url}`);
  };
  try {
    await assert.rejects(
      loadWorkspaceCapabilitySettings("http://api", "secret", "W1"),
      /catalog temporarily unavailable/,
      "a partially restored catalog must not be returned as an editable empty catalog",
    );
    assert.deepEqual(calls.map(({ options }) => options.method), ["GET", "GET", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("single global model client uses GET for reads and PUT for immutable revisions", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return Response.json({ profileId: "MODEL/1", revision: calls.length });
  };
  try {
    await getGlobalModel("http://api/", "secret", "MODEL/1");
    await updateGlobalModel("http://api/", "secret", "MODEL/1", { expectedRevision: 1, displayName: "Revision 2", apiKey: "" });
    assert.deepEqual(calls.map(({ options }) => options.method), ["GET", "PUT"]);
    assert.ok(calls.every(({ url }) => url.endsWith("/v1/global-models/MODEL%2F1")));
    assert.deepEqual(JSON.parse(calls[1].options.body), { expectedRevision: 1, displayName: "Revision 2", apiKey: "" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("product foundation client keeps reads GET-only and mutations explicit", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/health")) return Response.json({ status: "ok" });
    if (String(url).endsWith("/capabilities/effective")) return Response.json({ entries: [], effective: [], summary: {} });
    if (String(url).endsWith("/capability-draft") && options.method === "GET") return Response.json({ draft: null });
    if (String(url).includes("/review-queue")) return Response.json({ items: [] });
    if (String(url).endsWith("/execution-profile-revisions") && options.method === "GET") return Response.json({ profiles: [] });
    if (String(url).endsWith("/capability-draft")) return Response.json({ id: "DRAFT-1" });
    if (String(url).endsWith("/capability-draft/activate")) return Response.json({ id: "PROFILE-1" });
    return Response.json({ id: "DECISION-1" });
  };
  try {
    await getConnectionHealth("http://api/");
    await getEffectiveCapabilities("http://api/", "secret", "W 1");
    await getWorkspaceCapabilityDraft("http://api/", "secret", "W 1");
    await getWorkspaceReviewQueue("http://api/", "secret", "W 1", { status: "OPEN" });
    await listWorkspaceExecutionProfiles("http://api/", "secret", "W 1");
    await saveWorkspaceCapabilityDraft("http://api/", "secret", "W 1", {
      expectedVersion: 0,
      mainAgentSlot: { modelProfileId: "model" },
      childAgentSlots: [],
      projectCapabilityRevisionIds: [],
      disabledKeys: [],
    });
    await activateWorkspaceCapabilityDraft("http://api/", "secret", "W 1");
    await decideWorkspaceReviewBatch("http://api/", "secret", "W 1", { itemIds: ["I1"], outcome: "CONFIRMED", rationale: "evidence checked" });

    assert.deepEqual(calls.slice(0, 5).map(({ options }) => options.method), ["GET", "GET", "GET", "GET", "GET"]);
    assert.deepEqual(calls.slice(5).map(({ options }) => options.method), ["PUT", "POST", "POST"]);
    assert.match(calls[3].url, /W%201\/review-queue\?status=OPEN$/);
    assert.equal(calls[7].options.headers.authorization, "Bearer secret");
    assert.equal(calls[7].options.headers["x-traqen-api-token"], "secret");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workspace Draft client preserves the typed conflict comparison state", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: {
      code: "PERSISTENCE_CONFLICT",
      message: "Workspace capability draft version conflict: expected 1, current 2",
      requestId: "REQ-1",
      details: { head: "WORKSPACE_CAPABILITY_DRAFT", expectedVersion: 1, currentVersion: 2 },
    },
  }, { status: 409 });
  try {
    await assert.rejects(
      saveWorkspaceCapabilityDraft("http://api", "secret", "W1", {
        expectedVersion: 1,
        mainAgentSlot: { modelProfileId: "model" },
        childAgentSlots: [],
        projectCapabilityRevisionIds: [],
        disabledKeys: [],
      }),
      (error) => error instanceof ProductFoundationApiError
        && error.status === 409
        && error.code === "PERSISTENCE_CONFLICT"
        && error.details?.head === "WORKSPACE_CAPABILITY_DRAFT"
        && error.details.currentVersion === 2,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("model replacement client sends only the server plan identity and expected version", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return Response.json(calls.length === 1
      ? { id: "PLAN-1", version: 1, status: "READY", sourceProfileId: "OLD", replacementProfileId: "NEW", references: [], changes: [] }
      : { plan: { id: "PLAN-1", version: 3, status: "APPLIED" }, workspaces: [] });
  };
  try {
    const plan = await createGlobalModelReplacementPlan("http://api", "secret", "OLD", "NEW");
    await applyGlobalModelReplacementPlan("http://api", "secret", "OLD", plan.id, plan.version);
    assert.match(calls[0].url, /\/v1\/global-models\/OLD\/replacement-plans$/);
    assert.deepEqual(JSON.parse(calls[0].options.body), { replacementProfileId: "NEW" });
    assert.match(calls[1].url, /\/replacement-plans\/PLAN-1\/apply$/);
    assert.deepEqual(JSON.parse(calls[1].options.body), { expectedVersion: 1 });
    assert.equal("workspaceIds" in JSON.parse(calls[1].options.body), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
