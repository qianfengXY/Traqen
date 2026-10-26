import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { independentNativeFixture, loginIndependentFixture, independentHttp } from "./support/f002-independent-native-fixture.js";

test("actual isolated development entry mounts F001/F008/F002, auto seals, restarts native PG and rereads the exact version", { timeout: 240000 }, async t => {
  const fixture = await independentNativeFixture(t, { origin: "http://127.0.0.1:61827", queuedOnStart: true, holdWorker: true });
  await fixture.waitForHeldWorker();
  let request = await loginIndependentFixture(fixture);
  const prefix = "/v1/workspaces/workspace/deterministic-facts";
  const catalog = await request(prefix); assert.equal(catalog.status, 200);
  const catalogBody = await catalog.json();
  assert.equal(catalogBody.consumer.configured, false);
  const profile = catalogBody.profiles.find(item => item.id === fixture.metadata.profileId);
  assert.equal(profile.extractionLimits.functionInitialization, "local-sequence-v1");
  assert.equal(profile.extractionLimits.automaticPublication, "closed-scope-v1");
  const sourceVersions = await request("/v1/workspaces/workspace/source-truth/history/bundles");
  assert.equal(sourceVersions.status, 200);
  // Use the actual F001 inventory rather than a guessed component identity.
  const reference = { bundleId: fixture.metadata.bundleId, receiptId: fixture.metadata.receiptId };
  const inventoryResponse = await request(`/v1/workspaces/workspace/source-truth/bundles/${reference.bundleId}/inventory?receiptId=${reference.receiptId}`);
  assert.equal(inventoryResponse.status, 200);
  const inventory = await inventoryResponse.json();
  assert.equal(inventory.items.length, 2);
  const progressWhileHeld = await request(`${prefix}/runs/${fixture.metadata.queuedRun.id}`);
  assert.equal(progressWhileHeld.status, 200, "actual login and current progress reads must work before the old worker completes");
  let run = (await progressWhileHeld.json()).run;
  assert.equal(run.scopes[0].status, "QUEUED");
  await fixture.releaseWorker();
  const deadline = Date.now() + 60000;
  while (run.scopes[0].status !== "SEALED") {
    assert.ok(Date.now() < deadline, JSON.stringify(run)); await delay(50);
    const response = await request(`${prefix}/runs/${run.id}`); assert.equal(response.status, 200); run = (await response.json()).run;
    assert.ok(!["FAILED", "BLOCKED", "CANCELLED"].includes(run.scopes[0].status), JSON.stringify(run));
  }
  const version = run.scopes[0].graphVersionId;
  const materialResponse = await request(`${prefix}/versions/${version}/materials`); assert.equal(materialResponse.status, 200);
  const materials = (await materialResponse.json()).items;
  const material = materials.find(row => row.payload.pathBytes === Buffer.from("evidence-sentinel.js").toString("base64url"));
  assert.ok(material, JSON.stringify(materials));
  const materialId = material.id;
  const read = async () => {
    const response = await request(`${prefix}/versions/${version}/materials/${materialId}/content`);
    assert.equal(response.status, 200, await response.clone().text());
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.metadata.originalDigest);
    assert.equal(response.headers.get("x-source-bundle-id"), reference.bundleId);
    assert.equal(response.headers.get("x-source-receipt-id"), reference.receiptId);
  };
  await read();
  const factsBeforeRestart = Number((await fixture.pool().query("SELECT count(*) AS n FROM f002_fact_set")).rows[0].n);
  await fixture.restart();
  request = await loginIndependentFixture(fixture);
  const restored = await request(`${prefix}/runs/${run.id}`); assert.equal(restored.status, 200);
  assert.equal((await restored.json()).run.scopes[0].graphVersionId, version);
  await read();
  assert.equal(Number((await fixture.pool().query("SELECT count(*) AS n FROM f002_fact_set")).rows[0].n), factsBeforeRestart);
  const wrongCsrf = await independentHttp(fixture, `${prefix}/runs`, { method: "POST", headers: {
    origin: fixture.origin, "content-type": "application/json" }, body: "{}" });
  assert.equal(wrongCsrf.status, 403);
  assert.equal((await wrongCsrf.json()).error.code, "AUTH_CSRF_REJECTED");
  console.log(JSON.stringify({ scope: "ACTUAL_DEV_ENTRY_COOKIE_NATIVE_PG_RESTART_VOLUME_MECHANISM_DOUBLE_ONLY", graphVersionId: version,
    profileId: profile.id, apiLaunches: fixture.launches, authenticatedProgressWhileWorkerHeld: true,
    nativePgRestartWithoutDuplicatePublication: true, modelCalls: 0, protectedMedia: false, parentPath: fixture.root + "/", childPath: "api.log" }));
});

test("actual development startup queue failure rejects the listener and closes identity/source PG sessions", { timeout: 120000 }, async t => {
  const fixture = await independentNativeFixture(t, { origin: "http://127.0.0.1:61828", failInitialScan: true });
  assert.equal(fixture.base, undefined);
  assert.doesNotMatch(fixture.log, /development API listening/);
  const sessions = await fixture.pool().query("SELECT application_name FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND application_name <> 'f001-isolated-test'");
  assert.equal(sessions.rows.length, 0, JSON.stringify(sessions.rows));
  console.log(JSON.stringify({ scope: "OWNED_NATIVE_STARTUP_SCAN_FAULT", listenerOpened: false, survivingApplicationPgSessions: 0,
    parentPath: fixture.root + "/", childPath: "api.log" }));
});
