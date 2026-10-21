import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { createF002HttpHandler } from "../src/deterministic-facts/http-handler.js";
import { createProfileId } from "../src/deterministic-facts/identity.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { F002QueryService } from "../src/deterministic-facts/queries.js";
import { F002RequestService } from "../src/deterministic-facts/request-service.js";
import { F002Error } from "../src/deterministic-facts/errors.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { sourceTruthAuthenticator } from "../src/source-truth/authentication.js";
import { owner, sourceDatabase } from "./support/source-truth-database.js";
import { verifiedF002Records } from "./support/f002-records.js";

const token = "f002-http-owner-credential";
const componentId = "a".repeat(64), bundleId = "b".repeat(64);
const profileInput = { version: "1", schemaVersion: 1, capabilityIds: ["javascript"], ruleVersions: ["javascript@1"], canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024, maxRecords: 10 }, redactionPolicyRevision: "policy-v1" };
const profile = { ...profileInput, id: createProfileId(profileInput), startable: true };
const sourceInput = { workspaceId: "workspace", bundleId, sourceBundleSnapshotId: bundleId, receiptId: "receipt-1", receiptStatus: "READY", confirmationId: "confirmation-1", acceptanceRecordIds: [], receiptValidUntil: null, qualifiedAt: "2026-09-17T00:00:00.000Z", inventoryId: "inventory-1", inventoryDigest: "inventory-1", policyRevisionId: "policy-v1", inheritedGapSet: { id: "gaps-1", count: "0", consumption: "ALL_PAGES_REQUIRED" } };

test("F002 investigation boundary and request list HTTP reads bind member identity and exact query references", async t => {
  const calls = [], version = "a".repeat(64);
  let denied = false;
  const handler = createF002HttpHandler({ services: { repository: {}, admission: {}, publication: {}, queries: {}, materials: {}, replays: {}, requests: {
    investigation: async (...args) => { calls.push(["investigation", ...args]); if (denied) throw new F002Error("F002_CONSUMER_REJECTED", "denied", { status: 403 }); return { investigationId: args[2], baseVersionId: args[3], budget: { maximumAttempts: 3 } }; },
    list: async (...args) => { calls.push(["list", ...args]); return { items: [], nextCursor: null }; },
  } }, authenticate: sourceTruthAuthenticator([{ tokenDigest: createHash("sha256").update(token).digest("hex"), ...owner }]) });
  const server = createTraceabilityHttpServer({ application: {}, deterministicFactsHandler: handler });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/deterministic-facts`;
  const call = suffix => fetch(base + suffix, { headers: { authorization: `Bearer ${token}` } });
  const context = await call(`/investigations/investigation-1?baseVersionId=${version}`);
  assert.equal(context.status, 200); assert.equal(context.headers.get("cache-control"), "no-store");
  assert.equal((await context.json()).investigation.budget.maximumAttempts, 3);
  assert.equal((await call(`/requests?investigationId=investigation-1&baseVersionId=${version}&limit=2&cursor=request-1`)).status, 200);
  assert.deepEqual(calls, [["investigation", owner, "workspace", "investigation-1", version], ["list", owner, "workspace", {
    investigationId: "investigation-1", baseVersionId: version, limit: 2, cursor: "request-1",
  }]]);
  for (const suffix of [`/investigations/investigation-1?baseVersionId=${version}&budget=999`, `/requests?investigationId=i&investigationId=j&baseVersionId=${version}`]) {
    assert.equal((await call(suffix)).status, 422);
  }
  assert.equal(calls.length, 2, "undefined or duplicate query fields are not admitted to services");
  denied = true;
  assert.equal((await call(`/investigations/investigation-1?baseVersionId=${version}`)).status, 403);
  assert.equal((await fetch(`${base}/requests?investigationId=i&baseVersionId=${version}`)).status, 401);
});

test("F002 HTTP reads use only bound source-member identity, not the legacy shared API token", async (t) => {
  const { db, repository: sources } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "http-run", sourceInput, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scope = run.scopes[0], claimed = await repository.claimScope(owner, "workspace", run.id, scope.scopeId, { workerId: "http-worker", leaseMs: 60_000 });
  const publication = new F002PublicationService(repository);
  const verified = verifiedF002Records({ workspaceId: "workspace", bundleId, componentId, profile });
  await publication.prepare(owner, "workspace", run.id, scope.scopeId, { generation: claimed.generation, records: verified.records });
  await repository.recordScopeItems(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation, items: [{ materialId: verified.materialId, capabilityId: "javascript", status: "DONE" }] });
  const ready = await repository.readyToSeal(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation });
  const sealed = await publication.publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.revision, operationId: "seal-http" });
  const f002Handler = createF002HttpHandler({ services: { repository, admission: { start: async () => { throw new Error("not used"); } }, publication,
    queries: new F002QueryService(repository, { cursorSecret: "f002-http-cursor-secret" }), materials: { read: async () => { throw new Error("not used"); } }, requests: new F002RequestService(repository),
    replays: { list: async () => [], replay: async () => { throw new Error("not used"); }, findByOperation: async () => null } },
  authenticate: sourceTruthAuthenticator([{ tokenDigest: createHash("sha256").update(token).digest("hex"), actorId: "owner", tenantId: "tenant" }]) });
  const server = createTraceabilityHttpServer({ application: {}, apiBearerToken: "legacy-api-token", deterministicFactsHandler: f002Handler });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/deterministic-facts`;
  const call = async (suffix, credential = token) => {
    const response = await fetch(base + suffix, { headers: { authorization: `Bearer ${credential}` } });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call("/profiles")).status, 200);
  const records = await call(`/versions/${sealed.graphVersionId}/records?limit=10`);
  assert.equal(records.status, 200);
  assert.ok(records.body.items.some((item) => item.id === verified.factIds[0]));
  const materials = await call(`/versions/${sealed.graphVersionId}/materials?limit=10`);
  assert.equal(materials.status, 200);
  assert.deepEqual(materials.body.items.map((item) => item.kind), ["MATERIAL"]);
  const vocabulary = await call(`/versions/${sealed.graphVersionId}/vocabulary`);
  assert.equal(vocabulary.status, 200);
  assert.equal(vocabulary.body.vocabulary.schemaVersion, 1);
  const detail = await call(`/versions/${sealed.graphVersionId}/records/FACT/${verified.factIds[0]}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.record.id, verified.factIds[0]);
  const graph = await call(`/versions/${sealed.graphVersionId}/graph?rootId=${detail.body.record.payload.subjectId}&depth=2&limit=20`);
  assert.equal(graph.status, 200);
  assert.ok(graph.body.graph.nodes.some((node) => node.id === detail.body.record.payload.subjectId));
  const operation = await call("/operations/http-run");
  assert.equal(operation.status, 200);
  assert.deepEqual(operation.body.results.map((item) => item.kind), ["RUN"]);
  const scopeOperation = await call("/operations/seal-http");
  assert.equal(scopeOperation.status, 200);
  assert.equal(scopeOperation.body.results[0].kind, "SCOPE_OPERATION");
  assert.equal(scopeOperation.body.results[0].value.scopeId, scope.scopeId);
  assert.equal(scopeOperation.body.results[0].value.operationId, "seal-http");
  assert.equal((await call("/profiles", "legacy-api-token")).status, 401, "a legacy token is never a F002 source-member identity");
  const hostileOrigin = await fetch(`${base}/profiles`, { headers: { authorization: `Bearer ${token}`, origin: "https://hostile.example.test" } });
  assert.equal(hostileOrigin.status, 403, "F002 origin policy is independent from the legacy API route");
  const forbiddenRunField = await fetch(`${base}/runs`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({
    operationId: "forbidden-field", source: { bundleId, receiptId: "receipt-1" }, profileId: profile.id, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }], rootPath: "/not-a-source-selector",
  }) });
  assert.equal(forbiddenRunField.status, 422, "F002 never accepts caller filesystem selectors beside F001 references");
  assert.equal((await forbiddenRunField.json()).error.code, "F002_RUN_INPUT_INVALID");
});

test("an unconfigured production surface returns F002_NOT_CONFIGURED instead of a memory fallback", async (t) => {
  const server = createTraceabilityHttpServer({ application: {}, apiBearerToken: "legacy-api-token" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/deterministic-facts/profiles`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "F002_NOT_CONFIGURED");
});

test("F002 run creation immediately hands its durable run to the configured executor", async (t) => {
  const scheduled = [];
  const run = { id: "scheduled-run", workspaceId: "workspace", actorId: owner.actorId, scopes: [{ scopeId: "c".repeat(64), status: "QUEUED" }] };
  const handler = createF002HttpHandler({
    services: {
      repository: { getProfile: async () => profile },
      admission: { start: async () => run }, publication: {}, queries: {}, materials: {}, requests: {}, replays: {},
      executor: { enqueue: async (value) => { scheduled.push(value); } },
    },
    authenticate: sourceTruthAuthenticator([{ tokenDigest: createHash("sha256").update(token).digest("hex"), actorId: owner.actorId, tenantId: owner.tenantId }]),
  });
  const server = createTraceabilityHttpServer({ application: {}, apiBearerToken: "legacy-api-token", deterministicFactsHandler: handler });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/deterministic-facts/runs`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ operationId: "schedule-run", source: { bundleId, receiptId: "receipt-1" }, profileId: profile.id,
      scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] }),
  });
  assert.equal(response.status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(scheduled, [run]);
});

test("F002 overview exposes current activities and an explicit unconfigured consumer without inventing results", async (t) => {
  const runs = [{ id: "actual-run", scopes: [{ scopeId: "c".repeat(64), status: "RUNNING" }] }];
  const handler = createF002HttpHandler({ services: { repository: {}, admission: {}, publication: {}, materials: {}, replays: {},
    queries: { profiles: async () => [], versions: async () => [], activeRuns: async () => runs }, requests: { resolver: null } },
  authenticate: () => owner });
  const server = createTraceabilityHttpServer({ application: {}, deterministicFactsHandler: handler });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/deterministic-facts`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.workspaceId, "workspace");
  assert.deepEqual(result.activeRuns, runs);
  assert.deepEqual(result.consumer, { configured: false, code: "F002_CONSUMER_UNAVAILABLE" });
});

test("F002 controlled material HTTP response exposes the actual refusal transform", async (t) => {
  const bytes = Buffer.from("[展示受限]"), digest = createHash("sha256").update(bytes).digest("hex");
  const handler = createF002HttpHandler({ services: { repository: {}, admission: {}, publication: {}, queries: {}, replays: {}, requests: {},
    materials: { read: async () => ({ bytes, mediaType: "text/plain", originalDigest: "a".repeat(64), displayDigest: digest,
      readableRef: "b".repeat(64), redacted: true, transform: "CONFIG_SECRET_PRESENTATION_REFUSAL" }) } }, authenticate: () => owner });
  const server = createTraceabilityHttpServer({ application: {}, deterministicFactsHandler: handler });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/deterministic-facts/versions/${"a".repeat(64)}/materials/${"b".repeat(64)}/content`);
  assert.equal(response.headers.get("x-f002-transform"), "CONFIG_SECRET_PRESENTATION_REFUSAL");
  assert.equal(response.headers.get("x-f002-display-digest"), digest);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});
