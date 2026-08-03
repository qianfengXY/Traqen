import assert from "node:assert/strict";
import test from "node:test";

import {
  getCurrentUnderstandingGraph,
  getFeatureUnderstandingHistory,
  listGraphRevisions,
} from "../app/understanding-graph-client.ts";

test("understanding graph client uses GET-only current, revision, and Feature history reads", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/graph/current")) return Response.json({ head: { version: 2 }, revision: { id: "G2" } });
    if (String(url).endsWith("/graph/revisions")) return Response.json({ revisions: [{ id: "G1" }] });
    return Response.json({
      feature: { id: "F1", version: 1, name: "Feature" },
      featureVersions: [{ id: "F1", version: 1, name: "Feature" }],
      decisions: [],
      implementationMappings: [],
      graphRevisions: [],
      testSpecs: [],
      testExecutions: [],
    });
  };
  try {
    const current = await getCurrentUnderstandingGraph("http://api/", "token", "P");
    assert.equal(current.head.version, 2);
    assert.equal(current.revision.id, "G2");
    assert.equal((await listGraphRevisions("http://api/", "token", "P")).length, 1);
    assert.equal((await getFeatureUnderstandingHistory("http://api/", "token", "P", "F1")).feature.id, "F1");
    assert.ok(calls.every(({ options }) => options.method === "GET"));
    assert.ok(calls.every(({ options }) => options.headers["x-traqen-api-token"] === "token"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
