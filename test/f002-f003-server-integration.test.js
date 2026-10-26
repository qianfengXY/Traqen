import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { knowledgeServerFixture, syntheticPassword } from "./support/f002-f003-server-fixture.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { standardF002Profile } from "../src/deterministic-facts/runtime.js";
import { createProfileId, createProfileConfigDigest } from "../src/deterministic-facts/identity.js";
import { owner } from "./support/source-truth-database.js";
import { createHash } from "node:crypto";

async function login(f, name = "owner") {
  const csrf = await fetch(`${f.runtime.origin}/v1/auth/csrf`), proof = await csrf.json();
  const response = await fetch(`${f.runtime.origin}/v1/auth/login`, { method: "POST", headers: { origin: f.runtime.origin, "content-type": "application/json",
    "x-traqen-csrf": proof.csrfToken, cookie: csrf.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") },
    body: JSON.stringify({ login: name, password: syntheticPassword }) });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
  return { cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "), csrf: body.csrfToken };
}

async function request(f, session, route, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${f.runtime.origin}${route}`, { method, headers: { cookie: session.cookie, origin: f.runtime.origin,
    ...(body ? { "content-type": "application/json", "x-traqen-csrf": session.csrf } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000) });
  return { response, body: await response.json() };
}
async function ok(f, session, route, options) {
  const result = await request(f, session, route, options);
  assert.ok(result.response.ok, `${result.response.status}: ${JSON.stringify(result.body)}`); return result.body;
}
async function until(read, accepts, label) {
  const deadline = Date.now() + 20000; let value;
  do { value = await read(); if (accepts(value)) return value; await delay(25); } while (Date.now() < deadline);
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}
const facts = "/v1/workspaces/workspace/deterministic-facts";
const business = "/v1/workspaces/workspace/business-knowledge/investigations";

test("real F008 HTTP composes F001/F002/F003/F006, C03 history/adoption and native restart without legacy jobs", { timeout: 120000 }, async t => {
  assert.ok(process.env.F001_TEST_PG_BIN, "This integration must run with owned native PostgreSQL; no silent skip");
  const cluster = await isolatedPostgres(t); let databaseName;
  const f = await knowledgeServerFixture(t, { database: async () => { const db = await cluster.createDatabase(); databaseName = db.name; return db; } });
  let session = await login(f);
  const reader = await login(f, "reader");
  assert.strictEqual(f.runtime.knowledge.facts.services.requests.resolver, f.runtime.knowledge.business.services.investigations);
  // A narrow, real historical-compatible extraction enables a meaningful
  // expansion. The expanded standard profile is installed by the runtime.
  const profile = standardF002Profile();
  for (const field of ["id", "configDigest", "name", "startable"]) delete profile[field];
  profile.capabilityIds = ["javascript"]; profile.ruleVersions = ["javascript@1"];
  profile.extractionLimits = { ...profile.extractionLimits, automaticPublication: "closed-scope-v1" };
  const extraction = { ...profile, id: createProfileId(profile), configDigest: createProfileConfigDigest(profile), startable: true };
  await f.runtime.knowledge.facts.services.repository.registerProfile(extraction);
  const componentId = f.componentId;
  assert.ok(componentId);
  await t.test("current password session and exact F001 source produce an automatic technical version", async () => {
    const absent = await fetch(`${f.runtime.origin}${business}`); assert.equal(absent.status, 401);
    assert.equal((await request(f, session, business, { headers: { cookie: "", authorization: "Bearer old-shared-token" } })).response.status, 401);
    const denied = await request(f, session, business, { method: "POST", body: {}, headers: { "x-traqen-csrf": "wrong" } });
    assert.equal(denied.response.status, 403); assert.equal(denied.body.error.code, "AUTH_CSRF_REJECTED");
    assert.equal((await request(f, session, business, { headers: { origin: "http://evil.test" } })).response.status, 403);
    const overview = await ok(f, session, facts); assert.equal(overview.consumer.configured, true);
    const created = await ok(f, session, `${facts}/runs`, { method: "POST", body: { operationId: "http-integration-base", source: f.reference,
      profileId: extraction.id, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] } });
    const run = await until(() => ok(f, session, `${facts}/runs/${created.run.id}`), r => r.run.scopes[0].status === "SEALED", "automatic scope publication");
    f.baseVersionId = run.run.scopes[0].graphVersionId;
    f.originalManifest = (await ok(f, session, `${facts}/versions/${f.baseVersionId}/manifest`)).manifest;
    assert.equal(f.originalManifest.graphVersionId, f.baseVersionId);
  });
  if (!f.baseVersionId) return; // Do not turn one failed checkpoint into four unrelated errors.
  const create = async operationId => {
    const created = await ok(f, session, business, { method: "POST", body: { operationId, reference: f.reference, expectedProfileId: f.profile.id,
      question: "Find technical evidence for orders", technicalVersionId: f.baseVersionId, scope: { componentIds: [componentId] },
      budget: { maxReadBytes: 65536, maxModelCalls: 10, deadline: "2099-01-01T00:00:00Z" },
      supplementBudget: { maxMaterials: 10, maxBytes: 65536, maxRuleApplications: 100, maximumAttempts: 10, deadline: "2099-01-01T00:00:00Z" } } });
    const run = await until(() => ok(f, session, `${business}/${created.investigation.id}`), r => r.investigation.state === "RUNNING" && r.investigation.usage.modelCalls >= 1, "actual F006 model port");
    return run.investigation;
  };
  const submit = async (investigation, operationId, requestKind = "LOOKUP") => {
    const refs = (await f.runtime.db.query("SELECT id FROM f002_record WHERE graph_version_id=$1 AND kind='MATERIAL' ORDER BY id", [f.baseVersionId])).rows.map(r => r.id);
    const factRefs = requestKind === "LOOKUP" ? (await f.runtime.db.query("SELECT id FROM f002_record WHERE graph_version_id=$1 AND kind='FACT' ORDER BY id LIMIT 1", [f.baseVersionId])).rows.map(r => r.id) : [];
    if (requestKind === "LOOKUP") assert.equal(factRefs.length, 1, "lookup must locate an actual existing fact, not expect material-only requests to prove one");
    const created = await ok(f, session, `${facts}/requests`, { method: "POST", body: { operationId, investigationId: investigation.id, baseVersionId: f.baseVersionId,
      requestKind, question: "Inspect frozen material only", materialRefs: refs, factRefs, requestedCapabilities: requestKind === "CAPABILITY_EXPANSION" ? ["json"] : [] } });
    const receipt = await until(() => ok(f, session, `${facts}/requests/${created.request.id}`), r => ["COMPLETED", "FAILED", "CANCELLED"].includes(r.request.status), "real C03 completion");
    assert.equal(receipt.request.status, "COMPLETED", JSON.stringify(receipt)); return receipt.request;
  };
  let cancelled, historical, adopted, expansion;
  await t.test("real supplementation, individual history after stop and refusal of late/foreign requests", async () => {
    const run = await create("http-investigate-stop"); historical = await submit(run, "http-lookup");
    assert.equal(historical.outcome, "EXISTING_EVIDENCE");
    const current = (await ok(f, session, `${business}/${run.id}`)).investigation;
    cancelled = (await ok(f, session, `${business}/${run.id}/cancel`, { method: "POST", body: { expectedRevision: current.revision } })).investigation;
    assert.equal(cancelled.state, "CANCELLED");
    assert.equal((await ok(f, session, `${facts}/requests/${historical.id}`)).request.id, historical.id);
    assert.equal((await request(f, reader, `${facts}/requests/${historical.id}`)).response.status, 403);
    assert.ok([403, 404].includes((await request(f, session, `/v1/workspaces/workspace2/deterministic-facts/requests/${historical.id}`)).response.status));
    const late = await request(f, session, `${facts}/requests`, { method: "POST", body: { operationId: "late", investigationId: run.id,
      baseVersionId: f.baseVersionId, requestKind: "LOOKUP", question: "late", factRefs: [], materialRefs: ["invented"], requestedCapabilities: [] } });
    assert.equal(late.response.status, 409); assert.equal(late.body.error.code, "F003_STALE_WORKER");
  });
  await t.test("NEW_VERSION is a receipt, never implicit adoption; explicit adoption preserves old baseline and budget", async () => {
    const run = await create("http-investigate-expand"); expansion = await submit(run, "http-expand", "CAPABILITY_EXPANSION");
    assert.equal(expansion.outcome, "NEW_VERSION");
    const before = (await ok(f, session, `${business}/${run.id}`)).investigation;
    assert.deepEqual(before.adoptedVersionIds, [f.baseVersionId]);
    adopted = (await ok(f, session, `${business}/${run.id}/adopt-technical-version`, { method: "POST", body: {
      requestId: expansion.id, versionId: expansion.result.graphVersionId, expectedRevision: before.revision } })).investigation;
    assert.deepEqual(adopted.adoptedVersionIds, [f.baseVersionId, expansion.result.graphVersionId]);
    assert.equal(adopted.technicalVersionId, f.baseVersionId); assert.deepEqual(adopted.budget, before.budget);
    assert.ok(adopted.generation > before.generation);
    assert.equal((await ok(f, session, `${facts}/requests/${expansion.id}`)).request.baseVersionId, f.baseVersionId);
    assert.deepEqual((await ok(f, session, `${facts}/versions/${f.baseVersionId}/manifest`)).manifest, f.originalManifest);
  });
  await t.test("restart recovers queued work through actual start(), preserves immutable results and current ACL", async () => {
    const interrupted = await create("http-investigate-crash-window");
    // A real STARTED-unknown call is no longer an auto-retry fixture: the
    // separate root780 regression proves it is blocked without a refund.
    // Settle this held synthetic call as ABORTED through actual HTTP pause,
    // then explicitly authorize a new generation before testing C03 recovery.
    const held=(await ok(f,session,`${business}/${interrupted.id}`)).investigation;
    await ok(f,session,`${business}/${held.id}/pause`,{method:'POST',body:{expectedRevision:held.revision}});
    await until(async()=>f.runtime.knowledge.business.services.executor.running.has(`workspace\0${held.id}`),active=>!active,'paused invocation settled without waiting for unrelated held jobs');
    const outcomes=await f.runtime.knowledge.business.services.investigations.events(owner,'workspace',held.id);
    assert.ok(outcomes.some(e=>e.event_type==='MODEL_CALL_FINISHED'&&e.payload.outcome==='ABORTED'));
    const paused=await f.runtime.knowledge.business.services.investigations.get(owner,'workspace',held.id);
    await f.runtime.knowledge.business.services.investigations.control(owner,'workspace',held.id,{action:'RESUME',expectedRevision:paused.revision});
    await f.runtime.knowledge.business.services.investigations.claim(owner,'workspace',held.id,{workerId:'accepted-c03-before-crash',leaseMs:60000});
    const factId = (await f.runtime.db.query("SELECT id FROM f002_record WHERE graph_version_id=$1 AND kind='FACT' LIMIT 1", [f.baseVersionId])).rows[0].id;
    // Real acceptance transaction; emulate process loss after commit but before
    // the HTTP adapter's enqueue. No fake consumer, request rows or results.
    const pending = await f.runtime.knowledge.facts.services.requests.submit(owner, "workspace", { operationId: "accepted-before-dispatch-crash",
      investigationId: interrupted.id, baseVersionId: f.baseVersionId, requestKind: "LOOKUP", question: "Recover this accepted request", factRefs: [factId], materialRefs: [], requestedCapabilities: [] });
    assert.equal(pending.status, "QUEUED");
    await cluster.crash(); await f.stop(); await cluster.restart();
    const db = cluster.pool(databaseName);
    // Advancing only the owned fixture's lease avoids a real minute-long wait.
    await db.query("UPDATE f003_investigation SET lease_until=clock_timestamp()-interval '1 second' WHERE state='RUNNING'");
    const restored = await f.start(db); session = await login(f);
    await restored.knowledge.start();
    assert.strictEqual(restored.knowledge.start(), restored.knowledge.start(), "start is idempotent");
    const recovered = (await ok(f, session, `${business}/${adopted.id}`)).investigation;
    assert.deepEqual(recovered.adoptedVersionIds, adopted.adoptedVersionIds);
    assert.equal((await ok(f, session, `${facts}/requests/${historical.id}`)).request.id, historical.id);
    assert.equal((await ok(f, session, `${facts}/requests/${expansion.id}`)).request.result.graphVersionId, expansion.result.graphVersionId);
    const recoveredRequest = await until(() => ok(f, session, `${facts}/requests/${pending.id}`), r => ["COMPLETED", "FAILED"].includes(r.request.status), "accepted C03 request after native crash");
    assert.equal(recoveredRequest.request.status, "COMPLETED", JSON.stringify(recoveredRequest));
    assert.equal(recoveredRequest.request.outcome, "EXISTING_EVIDENCE");
    assert.equal((await restored.db.query("SELECT count(*)::int AS n FROM understanding_record WHERE record_type='WORKSPACE_ANALYSIS_JOB'")).rows[0].n, 0);
    f.model.release();
    const completed = await until(() => ok(f, session, `${business}/${adopted.id}`), r => r.investigation.state !== "RUNNING" && r.investigation.state !== "QUEUED", "recovered F006 execution");
    assert.equal(completed.investigation.state, "COMPLETED", JSON.stringify(completed));
    const graph = (await ok(f, session, `${business}/${adopted.id}/graph?view=COVERAGE`)).graph;
    assert.ok(graph.coverage.length > 0);
    const materialId = graph.coverage[0].materialId;
    const original = await fetch(`${restored.origin}${business}/${adopted.id}/materials/${materialId}`, { headers: { cookie: session.cookie } });
    assert.equal(original.status, 200);
    assert.equal(original.headers.get("x-source-material-ref"), materialId);
    const bytesDigest = createHash("sha256").update(Buffer.from(await original.arrayBuffer())).digest("hex");
    assert.ok([f.source.digest, ...f.source.additional.map(m => m.digest)].includes(bytesDigest), "HTTP original bytes must match one of the actual admitted source bodies");
    assert.deepEqual((await ok(f, session, `${facts}/versions/${f.baseVersionId}/manifest`)).manifest, f.originalManifest);
    assert.deepEqual((await ok(f, session, `${business}/${cancelled.id}`)).investigation.state, "CANCELLED");
    const admin = await restored.identity.login({ login: "admin", password: syntheticPassword });
    await restored.identity.grant(admin.token, "workspace", { accountId: f.accounts.owner.id, roles: [] });
    assert.equal((await request(f, session, `${facts}/requests/${historical.id}`)).response.status, 403);
    assert.equal((await request(f, session, `${business}/${adopted.id}/graph`)).response.status, 403);
    await restored.knowledge.close();
    assert.equal(restored.knowledge.business.services.executor.timer, null);
    assert.equal(restored.knowledge.facts.services.executor.timer, null);
    await assert.rejects(restored.knowledge.start(), /closed/);
    assert.ok(f.model.calls.some(c => c.phase === "PLAN") && f.model.calls.some(c => c.phase === "INVESTIGATE"));
    assert.ok(f.model.calls.every(c => c.toolsDisabled && c.hasPrivateCwd));
  });
});
