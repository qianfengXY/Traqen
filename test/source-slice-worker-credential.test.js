import assert from "node:assert/strict";
import test from "node:test";

import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { SourceSliceBroker } from "../src/application/source-slice-broker.js";
import { SourceSliceWorkerCredentialService } from "../src/application/source-slice-worker-credential.js";
import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("SourceSlice HTTP requires a scoped single-use server-attested worker credential", async (t) => {
  let now = Date.parse("2026-08-03T00:00:00.000Z");
  let sequence = 0;
  const clock = () => new Date(now);
  const store = new MemoryTraceabilityStore();
  const producer = {
    modelCapabilityProfileId: "MODEL-1",
    modelRevision: "REV-1",
    skillId: "source-reader",
    skillVersion: "1",
    independenceGroup: "GROUP-1",
    eligible: true,
    rejectionReasons: [],
    costClass: "LOCAL",
  };
  const job = {
    id: "RUN-1",
    projectId: "P",
    snapshotManifestId: "SNAP-1",
    policyDigest: "POLICY-1",
    status: "RUNNING",
    phase: "ANALYSIS",
  };
  await store.appendUnderstandingRecord("P", "WORK_UNIT", {
    id: "WORK-1",
    projectId: "P",
    snapshotManifestId: "SNAP-1",
    analysisRunId: "RUN-1",
    artifactIds: ["ARTIFACT-1"],
    factIds: ["FACT-1"],
    createdAt: clock().toISOString(),
  });
  await store.appendUnderstandingRecord("P", "ANALYSIS_ROUTE_DECISION", {
    id: "ROUTE-1",
    projectId: "P",
    snapshotManifestId: "SNAP-1",
    analysisRunId: "RUN-1",
    workUnitId: "WORK-1",
    status: "ROUTED",
    selected: [producer],
    createdAt: clock().toISOString(),
  });
  const broker = new SourceSliceBroker({
    clock,
    artifactResolver: async () => ({
      disposition: "INCLUDED",
      relativePath: "src/private.js",
      contentDigest: "sha256:private",
      content: "export const privateCapability = true;",
    }),
  });
  const credentialService = new SourceSliceWorkerCredentialService({
    secret: "0123456789abcdef0123456789abcdef",
    clock,
    ttlMs: 2_000,
    nonce: () => `CREDENTIAL-${++sequence}`,
  });
  const application = new TraceabilityApplication({
    store,
    clock,
    sourceSliceBroker: broker,
    sourceSliceWorkerCredentialService: credentialService,
    legacyUnderstandingRuntime: { async get() { return job; } },
  });
  const server = createTraceabilityHttpServer({ application, apiBearerToken: "ordinary-api-token" });
  const base = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `${base}/v1/projects/P/analysis-runs/RUN-1/work-units/WORK-1/source-slices`;
  const body = JSON.stringify({
    snapshotManifestId: "SNAP-1",
    selectors: [{ artifactId: "ARTIFACT-1", startByte: 0 }],
    allowedFactIds: ["FACT-1"],
    policyDigest: "POLICY-1",
  });
  const request = (credential, extraHeaders = {}) => fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-traqen-api-token": "ordinary-api-token",
      ...(credential ? { "x-traqen-worker-credential": credential } : {}),
      ...extraHeaders,
    },
    body,
  });

  const spoofed = await request(null, { "x-traqen-service-identity": "legacy-understanding-runtime" });
  assert.equal(spoofed.status, 401);
  assert.doesNotMatch(await spoofed.text(), /privateCapability/);

  const issued = await application.issueSourceSliceWorkerCredential("P", {
    analysisRunId: "RUN-1",
    workUnitId: "WORK-1",
    routeDecisionId: "ROUTE-1",
    producer,
  });
  const allowed = await request(issued.token);
  assert.equal(allowed.status, 200);
  assert.match(JSON.stringify(await allowed.json()), /privateCapability/);

  const replay = await request(issued.token);
  assert.equal(replay.status, 403);
  assert.doesNotMatch(await replay.text(), /privateCapability/);

  const expired = await application.issueSourceSliceWorkerCredential("P", {
    analysisRunId: "RUN-1",
    workUnitId: "WORK-1",
    routeDecisionId: "ROUTE-1",
    producer,
  });
  now += 2_001;
  assert.equal((await request(expired.token)).status, 401);
  now -= 2_001;

  const unknown = `${issued.token.slice(0, -1)}${issued.token.endsWith("a") ? "b" : "a"}`;
  assert.equal((await request(unknown)).status, 401);
  const audits = await store.listUnderstandingRecords("P", "SOURCE_SLICE_AUTH_AUDIT");
  assert.ok(audits.some(({ outcome }) => outcome === "AUTHORIZED"));
  assert.ok(audits.some(({ outcome }) => outcome === "REPLAY_REJECTED"));
  assert.doesNotMatch(JSON.stringify(audits), /privateCapability|ordinary-api-token|0123456789abcdef/);
});
