import assert from "node:assert/strict";
import test from "node:test";
import { f002BrowserFixture, fixtureToken } from "./support/f002-browser-fixture.js";

// Server-only checks use ephemeral loopback ports, never a resident source or
// the fixed port reserved for the separately-run browser verifier.
test("owned delivery scheduling controls preserve genuine queued, sealed, cancelled and replay receipts", async t => {
  const fixture = await f002BrowserFixture({ port: 0, deliveryLifecycle: true }); t.after(() => fixture.close());
  const api = fixture.api, route = "/v1/workspaces/workspace/deterministic-facts";
  const call = (tail, method = "GET", body, authorized = true) => fetch(api + tail, { method,
    headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: `Bearer ${fixtureToken}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
  const control = async action => {
    const response = await call(`/__f002_fixture/${action}`, "POST");
    assert.equal(response.status, 200, action); return response.json();
  };
  assert.equal((await call("/__f002_fixture/pause-delivery-executor", "POST", undefined, false)).status, 401);
  const meta = await control("pause-delivery-executor");
  assert.equal(meta.delivery.executorPaused, true);
  const input = operationId => ({ operationId, source: fixture.metadata.reference, profileId: meta.delivery.profileId,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId: meta.delivery.componentId }] }] });
  const accepted = await call(`${route}/runs`, "POST", input("owned-delivery-seal")); assert.equal(accepted.status, 202);
  const run = (await accepted.json()).run, scope = run.scopes[0]; assert.equal(scope.status, "QUEUED");
  const check = (await (await call(`${route}/runs/${run.id}/scopes/${scope.scopeId}/check`, "POST", {})).json()).check;
  assert.equal(check.ready, false);
  assert.deepEqual(check.blockers, [{ code: "F002_SCOPE_COVERAGE_INCOMPLETE", count: 0 }, { code: "F002_SCOPE_NOT_READY", status: "QUEUED" }]);
  const premature = await call(`${route}/runs/${run.id}/scopes/${scope.scopeId}/seal`, "POST", { operationId: "owned-premature-seal", revision: scope.revision });
  assert.equal(premature.status, 409); assert.equal((await premature.json()).error.code, "F002_SCOPE_COVERAGE_INCOMPLETE");
  await control("resume-delivery-executor");
  const ready = (await (await call(`${route}/runs/${run.id}`)).json()).run.scopes[0]; assert.equal(ready.status, "READY_TO_SEAL");
  const sealedResponse = await call(`${route}/runs/${run.id}/scopes/${scope.scopeId}/seal`, "POST", { operationId: "owned-delivery-sealed", revision: ready.revision });
  assert.equal(sealedResponse.status, 200); const sealed = (await sealedResponse.json()).scope; assert.equal(sealed.status, "SEALED");
  const manifest = (await (await call(`${route}/versions/${sealed.graphVersionId}/manifest`)).json()).manifest;
  await control("pause-delivery-executor");
  const second = (await (await call(`${route}/runs`, "POST", input("owned-delivery-cancel"))).json()).run;
  const cancellation = await call(`${route}/runs/${second.id}/cancel`, "POST", { operationId: "owned-delivery-cancelled", scopeId: second.scopes[0].scopeId, revision: second.scopes[0].revision });
  assert.equal(cancellation.status, 200); assert.equal((await cancellation.json()).scope.status, "CANCELLED");
  const resumed = await control("resume-delivery-executor"); assert.equal(resumed.delivery.executedScopes.some(item => item.runId === second.id), false);
  await control("pause-delivery-replays");
  const firstReplay = (await (await call(`${route}/versions/${sealed.graphVersionId}/replays`, "POST", { operationId: "owned-delivery-replay" })).json()).replay;
  assert.equal(firstReplay.status, "QUEUED"); await control("resume-delivery-replays");
  const replay = (await (await call(`${route}/replays/${firstReplay.id}`)).json()).replay;
  assert.equal(replay.status, "MATCH"); assert.equal(replay.candidateDigest, manifest.recordDigest);
  await control("pause-delivery-replays");
  const secondReplay = (await (await call(`${route}/versions/${sealed.graphVersionId}/replays`, "POST", { operationId: "owned-delivery-replay-cancel" })).json()).replay;
  const cancelledReplay = await call(`${route}/replays/${secondReplay.id}/cancel`, "POST", { operationId: "owned-delivery-replay-cancelled", revision: secondReplay.revision });
  assert.equal(cancelledReplay.status, 200); assert.equal((await cancelledReplay.json()).replay.status, "CANCELLED");
  const final = await control("resume-delivery-replays");
  assert.equal(final.delivery.executedReplayIds.includes(secondReplay.id), false);
  assert.equal(final.sourceStable, true); assert.equal(final.originalDigest, meta.originalDigest); assert.equal(final.startRunCount, 2);
  assert.deepEqual((await (await call(`${route}/versions/${sealed.graphVersionId}/manifest`)).json()).manifest, manifest);
});

test("ordinary browser fixtures cannot activate delivery scheduling controls", async t => {
  const fixture = await f002BrowserFixture({ port: 0 }); t.after(() => fixture.close());
  for (const action of ["pause-delivery-executor", "resume-delivery-executor", "pause-delivery-replays", "resume-delivery-replays"]) {
    const response = await fetch(`${fixture.api}/__f002_fixture/${action}`, { method: "POST",
      headers: { Authorization: `Bearer ${fixtureToken}` }, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 404); await response.arrayBuffer();
  }
});
