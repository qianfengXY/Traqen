import assert from "node:assert/strict";
import test from "node:test";

import {
  decideWorkspaceReviewBatch,
  getConnectionHealth,
  getWorkspaceReviewQueue,
  listCapabilityTemplates,
  listWorkspaceCapabilityConfigs,
  listWorkspaceExecutionProfiles,
  resolveWorkspaceExecutionProfile,
  saveWorkspaceCapabilityConfig,
} from "../app/product-foundation-client.ts";

test("product foundation client keeps reads GET-only and mutations explicit", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/health")) return Response.json({ status: "ok" });
    if (String(url).endsWith("/capability-templates")) return Response.json({ templates: [] });
    if (String(url).includes("/review-queue")) return Response.json({ items: [] });
    if (String(url).endsWith("/capability-configs") && options.method === "GET") return Response.json({ configs: [] });
    if (String(url).endsWith("/execution-profile-revisions") && options.method === "GET") return Response.json({ profiles: [] });
    if (String(url).endsWith("/capability-configs")) return Response.json({ id: "CONFIG-1" });
    if (String(url).endsWith("/execution-profile-revisions")) return Response.json({ id: "PROFILE-1" });
    return Response.json({ id: "DECISION-1" });
  };
  try {
    await getConnectionHealth("http://api/");
    await listCapabilityTemplates("http://api/", "secret");
    await getWorkspaceReviewQueue("http://api/", "secret", "W 1", { status: "OPEN" });
    await listWorkspaceCapabilityConfigs("http://api/", "secret", "W 1");
    await listWorkspaceExecutionProfiles("http://api/", "secret", "W 1");
    await saveWorkspaceCapabilityConfig("http://api/", "secret", "W 1", {
      mainAgent: { model: "model", skillNames: [], mcpNames: [] },
      childSlots: [{ id: "CHILD-1", model: "model", skillNames: [], mcpNames: [], independenceGroup: "A" }],
      overrides: [], removals: [], dependencies: {}, conventions: {}, policies: {},
    });
    await resolveWorkspaceExecutionProfile("http://api/", "secret", "W 1", "CONFIG-1");
    await decideWorkspaceReviewBatch("http://api/", "secret", "W 1", { itemIds: ["I1"], outcome: "CONFIRMED", rationale: "evidence checked" });

    assert.deepEqual(calls.slice(0, 5).map(({ options }) => options.method), ["GET", "GET", "GET", "GET", "GET"]);
    assert.deepEqual(calls.slice(5).map(({ options }) => options.method), ["POST", "POST", "POST"]);
    assert.match(calls[2].url, /W%201\/review-queue\?status=OPEN$/);
    assert.equal(calls[7].options.headers.authorization, "Bearer secret");
    assert.equal(calls[7].options.headers["x-traqen-api-token"], "secret");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
