import assert from "node:assert/strict";
import test from "node:test";
import { f002BrowserFixture, fixtureToken } from "./support/f002-browser-fixture.js";

const additionalFiles = Array.from({ length: 21 }, (_, index) => ({ entryPath: `picker-${String(index).padStart(2, "0")}.properties`, content: `name=owned-picker-${index}\n` }));
test("owned material picker fixture discovers22 genuinely sealed materials but investigation grants only its exact replacement", async t => {
  const fixture = await f002BrowserFixture({ port: 0, requestForm: true, requestMaterials: true, additionalFiles });
  t.after(() => fixture.close());
  const call = (route, body) => fetch(`${fixture.api}${route}`, { method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${fixtureToken}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
  const meta = await (await call("/__f002_fixture/metadata")).json(), route = "/v1/workspaces/workspace/deterministic-facts";
  assert.equal(meta.fileCount, 22); assert.equal(meta.requestMaterials.choices.length, 22);
  const first = await (await call(`${route}/versions/${meta.noFact.graphVersionId}/materials?limit=20`)).json();
  assert.equal(first.items.length, 20); assert.ok(first.nextCursor);
  const second = await (await call(`${route}/versions/${meta.noFact.graphVersionId}/materials?limit=20&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  assert.equal(second.items.length, 2); assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items].map(row => row.id), meta.requestMaterials.choices.map(row => row.id));
  const replacement = meta.requestMaterials.replacement.id;
  assert.ok(second.items.some(row => row.id === replacement)); assert.notEqual(replacement, meta.noFact.materialId);
  const record = await call(`${route}/versions/${meta.noFact.graphVersionId}/records/MATERIAL/${replacement}`);
  assert.equal(record.status, 200); assert.equal((await record.json()).record.payload.materialId, replacement);
  const body = { operationId: "owned-picker-accepted", investigationId: meta.formInvestigations.SUSPECTED_ERROR,
    baseVersionId: meta.noFact.graphVersionId, requestKind: "SUSPECTED_ERROR", question: "Owned replacement, not a correction.", materialRefs: [replacement], factRefs: [], requestedCapabilities: ["properties"] };
  const accepted = await call(`${route}/requests`, body); assert.equal(accepted.status, 202); await accepted.json();
  const disallowed = first.items.find(row => ![replacement, meta.noFact.materialId].includes(row.id)).id;
  const rejected = await call(`${route}/requests`, { ...body, operationId: "owned-picker-rejected", materialRefs: [disallowed] });
  assert.equal(rejected.status, 403); assert.equal((await rejected.json()).error.code, "F002_CONSUMER_REJECTED");
  const final = await (await call("/__f002_fixture/metadata")).json();
  assert.equal(final.submittedRequests.length, 1); assert.deepEqual(final.submittedRequests[0].materialRefs, [replacement]);
  assert.equal(final.sourceStable, true); assert.equal(final.additionalSourceStable, true); assert.equal(final.originalDigest, meta.originalDigest); assert.equal(final.startRunCount, 0);
});

test("material picker fixture grants cannot be enabled by ordinary form or other verification modes", async () => {
  for (const options of [{ requestMaterials: true }, { requestMaterials: true, requestForm: true },
    { requestMaterials: true, requestForm: true, additionalFiles, requestCatalog: true }]) {
    await assert.rejects(f002BrowserFixture(options), /explicit isolated22-material form fixture/);
  }
});
