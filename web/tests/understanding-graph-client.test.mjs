import assert from "node:assert/strict";
import test from "node:test";

import {
  getCurrentUnderstandingGraph,
  getFeatureGraph,
  getFeatureTraceability,
  getFeatureUnderstandingHistory,
  getGraphRevision,
  getUnderstandingChangeImpact,
  getUnderstandingTraceChain,
  listGraphRevisions,
  queryFeatureGraphPath,
} from "../app/understanding-graph-client.ts";

test("understanding graph client uses GET-only current, revision, and Feature history reads", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/graph/current")) return Response.json({ head: { version: 2 }, revision: { id: "G2" } });
    if (String(url).endsWith("/graph/revisions")) return Response.json({ revisions: [{ id: "G1" }] });
    if (String(url).endsWith("/graph/revisions/G1")) return Response.json({ revision: { id: "G1" }, graphArtifact: { id: "A1" } });
    if (String(url).endsWith("/changes/C1/impact")) return Response.json({ changeSet: { id: "C1" } });
    if (String(url).endsWith("/graph/traces/T1")) return Response.json({ id: "T1" });
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
    assert.equal((await getGraphRevision("http://api/", "token", "P", "G1")).revision.id, "G1");
    assert.equal((await getUnderstandingChangeImpact("http://api/", "token", "P", "C1")).changeSet.id, "C1");
    assert.equal((await getUnderstandingTraceChain("http://api/", "token", "P", "T1")).id, "T1");
    assert.equal((await getFeatureUnderstandingHistory("http://api/", "token", "P", "F1")).feature.id, "F1");
    assert.ok(calls.every(({ options }) => options.method === "GET"));
    assert.ok(calls.every(({ options }) => options.headers["x-traqen-api-token"] === "token"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Feature detail and graph clients preserve immutable Workspace, Snapshot, and bounded query context", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "POST") return Response.json({ found: false, nodes: [], edges: [], hopCount: null });
    if (String(url).includes("/traceability?")) return Response.json({ feature: { id: "F1" }, snapshotManifest: { id: "S1" } });
    return Response.json({ center: "F1", snapshotManifestId: "S1", depth: 2, nodes: [], edges: [], truncated: true, availableExpansions: [] });
  };
  try {
    assert.equal((await getFeatureTraceability("http://api/", "token", "WORK SPACE", "F/1", "S1")).feature.id, "F1");
    const graph = await getFeatureGraph("http://api/", "token", "WORK SPACE", "F/1", "S1", {
      view: "coverage",
      depth: 2,
      limit: 40,
      nodeTypes: ["TEST_SPEC", "EVIDENCE"],
      relations: ["VERIFIED_BY"],
    });
    assert.equal(graph.truncated, true);
    await queryFeatureGraphPath("http://api/", "token", "WORK SPACE", "F/1", {
      snapshotManifestId: "S1",
      fromNodeId: "F1",
      toNodeId: "E1",
      direction: "FORWARD",
      maxDepth: 6,
      view: "coverage",
    });

    assert.match(calls[0].url, /projects\/WORK%20SPACE\/features\/F%2F1\/traceability\?snapshotManifestId=S1$/);
    assert.match(calls[1].url, /view=coverage/);
    assert.match(calls[1].url, /depth=2/);
    assert.match(calls[1].url, /limit=40/);
    assert.match(calls[1].url, /nodeType=TEST_SPEC&nodeType=EVIDENCE/);
    assert.match(calls[1].url, /relation=VERIFIED_BY/);
    assert.deepEqual(JSON.parse(calls[2].options.body), {
      snapshotManifestId: "S1",
      fromNodeId: "F1",
      toNodeId: "E1",
      direction: "FORWARD",
      maxDepth: 6,
      view: "coverage",
    });
    assert.equal(calls[2].options.headers["content-type"], "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
