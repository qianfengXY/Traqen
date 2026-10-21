import assert from "node:assert/strict";
import test from "node:test";
import { f002BrowserFixture, fixtureToken } from "./support/f002-browser-fixture.js";

// Each check owns an ephemeral loopback listener. Faults act on real committed
// rows, never manufactured receipts or another concurrently-running fixture.
test("owned request recovery faults lose real committed responses and pause only the request scheduler", async t => {
  const fixture = await f002BrowserFixture({ port: 0, requestForm: true, requestRecovery: true });
  t.after(() => fixture.close());
  const base = fixture.api;
  const call = (route, method = "GET", body, authorized = true) => fetch(base + route, {
    method, headers: { ...(authorized ? { Authorization: `Bearer ${fixtureToken}` } : {}), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
  });
  const control = async action => {
    const response = await call(`/__f002_fixture/${action}`, "POST");
    assert.equal(response.status, 200, `owned recovery control ${action}`); return response.json();
  };
  const meta = await (await call("/__f002_fixture/metadata")).json();
  assert.equal((await call("/__f002_fixture/pause-request-executor", "POST", undefined, false)).status, 401);
  assert.equal((await control("pause-request-executor")).requestRecovery.paused, true);
  const route = "/v1/workspaces/workspace/deterministic-facts";
  const input = (kind, operationId) => ({ operationId, investigationId: meta.formInvestigations[kind],
    baseVersionId: meta.noFact.graphVersionId, requestKind: kind, question: "Owned response-loss fixture check.",
    factRefs: [], materialRefs: [meta.noFact.materialId], requestedCapabilities: [] });
  await control("drop-next-request-response");
  await assert.rejects(async () => (await call(`${route}/requests`, "POST", input("TARGETED_EVIDENCE", "owned-original-submit"))).json());
  const accepted = (await (await call(`${route}/operations/owned-original-submit`)).json()).results[0].value;
  assert.equal(accepted.status, "QUEUED"); assert.equal(accepted.operationId, "owned-original-submit");
  const resumed = await control("resume-request-executor");
  assert.equal(resumed.requestRecovery.paused, false);
  assert.ok(resumed.requestRecovery.executedRequestIds.includes(accepted.id));
  assert.equal((await (await call(`${route}/requests/${accepted.id}`)).json()).request.status, "COMPLETED");
  await control("pause-request-executor");
  const second = (await (await call(`${route}/requests`, "POST", input("SUSPECTED_OMISSION", "owned-second-submit"))).json()).request;
  assert.equal(second.status, "QUEUED");
  await control("drop-next-request-cancel-response");
  await assert.rejects(async () => (await call(`${route}/requests/${second.id}/cancel`, "POST", { operationId: "owned-original-cancel", revision: second.revision })).json());
  const cancellation = (await (await call(`${route}/operations/owned-original-cancel`)).json()).results[0].value;
  assert.equal(cancellation.id, second.id); assert.equal(cancellation.status, "CANCELLED");
  assert.equal(cancellation.operationId, "owned-second-submit"); assert.equal(cancellation.cancelOperationId, "owned-original-cancel");
  const final = await control("resume-request-executor");
  assert.equal(final.requestRecovery.submissionCount, 2); assert.equal(final.requestRecovery.cancellationCount, 1);
  assert.equal(final.requestRecovery.droppedRequestResponses, 1); assert.equal(final.requestRecovery.droppedCancelResponses, 1);
  assert.equal(final.requestRecovery.executedRequestIds.includes(second.id), false);
  assert.equal(final.requestRecovery.lastDroppedRequest.status, 202); assert.equal(final.requestRecovery.lastDroppedCancel.status, 200);
  assert.equal(final.sourceStable, true); assert.equal(final.originalDigest, meta.originalDigest); assert.equal(final.startRunCount, 0);
});

test("ordinary form fixtures cannot activate recovery faults or scheduler controls", async t => {
  const fixture = await f002BrowserFixture({ port: 0, requestForm: true }); t.after(() => fixture.close());
  for (const action of ["pause-request-executor", "resume-request-executor", "drop-next-request-response", "drop-next-request-cancel-response"]) {
    const response = await fetch(`${fixture.api}/__f002_fixture/${action}`, {
      method: "POST", headers: { Authorization: `Bearer ${fixtureToken}` }, signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 404); await response.arrayBuffer();
  }
});
