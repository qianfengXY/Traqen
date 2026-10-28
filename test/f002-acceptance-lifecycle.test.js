import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { acceptanceNativeFixture } from "./support/f002-acceptance-native-fixture.js";
import { acceptanceFilesA, acceptanceFilesB } from "./support/f002-acceptance-assets.js";
import { json, pages, freezeGit, publishFacts, original, sourcePrefix, factsPrefix, digest } from "./support/f002-acceptance-http.js";

test("normal Cookie/HTTPS Git F001 captures A and B, F002 auto-publishes immutable versions and native restart preserves exact historical evidence", { timeout: 240000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "traqen-f002-native-ab-")), stages = [], result = { scope: "NATIVE_HTTP_AB_NO_MODEL_VOLUME_MECHANISM_DOUBLE_ONLY", checks: [] };
  const stage = async (name, action) => {
    const started = performance.now(); stages.push({ name, event: "START", utc: new Date().toISOString(), monotonicMs: started });
    console.log(JSON.stringify({ stage: name, event: "START" }));
    try { const value = await action(); stages.push({ name, event: "END", utc: new Date().toISOString(), durationMs: performance.now() - started }); return value; }
    catch (e) { stages.push({ name, event: "ERROR", utc: new Date().toISOString(), durationMs: performance.now() - started, message: e.message }); throw e; }
  };
  t.after(async () => {
    await writeFile(path.join(root, "stages.json"), JSON.stringify(stages, null, 2), { mode: 0o600 });
    await writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  });
  console.log(JSON.stringify({ parentPath: root + "/", childPath: "result.json" }));
  const socket = createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const fixture = await stage("fixture.actual-dev-nativePG-identity-only", () => acceptanceNativeFixture(t, { origin: `http://127.0.0.1:${port}` }));
  result.fixture = { root: fixture.root, scope: fixture.scope, apiChildren: fixture.children };
  let client = await fixture.client();
  const a = await stage("A.F001.capture-confirm-freeze-HTTP", () => freezeGit(client, fixture, fixture.commitA));
  const ta = await stage("A.F002.default-COMPONENT-auto-SEALED", () => publishFacts(client, a));
  result.a = { ...a.reference, runId: ta.run.id, version: ta.version, profileId: ta.profileId };
  assert.equal(a.inventory.filter(item => item.entry.kind === "FILE").length, Object.keys(acceptanceFilesA).length);
  const oldDigest = digest(JSON.stringify(ta.records)), oldManifest = structuredClone(ta.manifest);
  for (const [name, content] of Object.entries(acceptanceFilesA)) await stage(`A.original.${name}`, () => original(client, a, ta, name, content));
  result.checks.push("A-normal-F001-capture-no-seeded-result-and-F002-auto-publication-every-original-exact-Bundle-Receipt");

  const facts = ta.records.filter(row => row.kind === "FACT").map(row => row.payload);
  for (const predicate of ["withinBranch", "readsBinding", "matchesConfigKey", "embedsSql", "writesTable", "matchesSqlTable", "callsDeclaration", "declaredTestBody", "declaredAssertion", "refersTo"]) {
    assert.ok(facts.some(fact => fact.predicate === predicate), predicate);
  }
  assert.equal(JSON.stringify(ta.records).includes("OWNED_FIXTURE_SECRET_NEVER_INDEX"), false);
  assert.ok(ta.records.some(row => row.kind === "GAP" && row.payload.code === "EXECUTION_BINDING_MISSING"), "declared JUnit PASS must retain missing trusted execution binding");
  assert.ok(ta.records.some(row => row.kind === "GAP" && /AMBIGUOUS/.test(row.payload.code)), "duplicate Markdown heading must not choose one target");
  result.checks.push("technical-v4-actual-native-published-code-doc-config-SQL-test-report-predicates-with-explicit-untrusted-and-ambiguous-Gaps");

  const commitB = await stage("B.owned-Git-add-modify-delete-retain", () => fixture.advanceGit());
  const b = await stage("B.F001.capture-confirm-freeze-HTTP", () => freezeGit(client, fixture, commitB, a.reference.bundleId));
  const tb = await stage("B.F002.default-COMPONENT-auto-SEALED", () => publishFacts(client, b));
  result.b = { ...b.reference, runId: tb.run.id, version: tb.version, profileId: tb.profileId };
  assert.notEqual(ta.version, tb.version); assert.notEqual(a.reference.bundleId, b.reference.bundleId);
  assert.equal(tb.profileId, ta.profileId);
  const paths = tb.records.filter(row => row.kind === "MATERIAL").map(row => Buffer.from(row.payload.pathBytes, "base64url").toString());
  assert.deepEqual(paths.toSorted(), b.inventory.map(item => Buffer.from(item.entry.pathBytes, "base64url").toString()).sort(), "MATERIAL includes the exact captured directories as well as files");
  assert.deepEqual(b.inventory.filter(item => item.entry.kind === "FILE").map(item => Buffer.from(item.entry.pathBytes, "base64url").toString()).sort(), Object.keys(acceptanceFilesB).sort());
  assert.equal(paths.includes("test/legacy.test.js"), false); assert.ok(paths.includes("src/added.ts"));
  for (const [name, content] of Object.entries(acceptanceFilesB)) await stage(`B.original.${name}`, () => original(client, b, tb, name, content));
  const rereadA = async () => {
    assert.equal(digest(JSON.stringify(await pages(client, `${factsPrefix}/versions/${ta.version}/records`))), oldDigest, "old facts, Gaps, materials and refs never rewritten");
    assert.deepEqual((await json(client, `${factsPrefix}/versions/${ta.version}/manifest`)).manifest, oldManifest);
    await original(client, a, ta, "src/orders.ts", acceptanceFilesA["src/orders.ts"]);
    await original(client, a, ta, "test/legacy.test.js", acceptanceFilesA["test/legacy.test.js"]);
  };
  await stage("A.after-B.exact-records-Gaps-and-deleted-original", rereadA);
  result.checks.push("B-added-modified-deleted-unchanged-assets-independent-version-A-records-and-deleted-original-remain-exact");

  const legacy = ta.records.find(row => row.kind === "MATERIAL" && row.payload.pathBytes === Buffer.from("test/legacy.test.js").toString("base64url"));
  const cross = await client.request(`${factsPrefix}/versions/${tb.version}/materials/${legacy.id}/content`);
  assert.equal(cross.status, 404, await cross.clone().text());
  const mismatched = await client.request(`${sourcePrefix}/bundles/${a.reference.bundleId}/material?${new URLSearchParams({
    receiptId: b.reference.receiptId, componentId: a.inventory[0].componentId, pathBytes: Buffer.from("README.md").toString("base64url") })}`);
  assert.equal(mismatched.status, 404, await mismatched.clone().text());
  result.checks.push("wrong-version-and-receipt-rejected-without-latest-substitution");

  await stage("actual-API-and-native-PG-stop-restart", () => fixture.restart()); client = await fixture.client();
  await stage("A.after-restart.same-immutable-version-original", rereadA);
  await stage("B.after-restart.same-immutable-version-original", async () => {
    assert.deepEqual((await json(client, `${factsPrefix}/runs/${tb.run.id}`)).run.scopes[0].graphVersionId, tb.version);
    await original(client, b, tb, "src/orders.ts", acceptanceFilesB["src/orders.ts"]);
    await original(client, b, tb, "README.md", acceptanceFilesB["README.md"]);
    assert.equal((await json(client, `${factsPrefix}/versions`)).versions.length, 2, "restart must not republish");
  });
  result.checks.push("nativePG-and-API-restart-retains-exact-A-B-without-duplicate-publication");

  await stage("real-current-READ-revocation", async () => {
    const reader = await fixture.client("reader"); await original(reader, a, ta, "src/orders.ts", acceptanceFilesA["src/orders.ts"]);
    const members = (await json(client, "/v1/access/spaces/workspace/members")).members;
    const member = members.find(item => item.login === "reader"); assert.ok(member, JSON.stringify(members));
    await json(client, "/v1/access/spaces/workspace/members", "PUT", { accountId: member.id, roles: [] });
    for (const route of [`${factsPrefix}/versions/${ta.version}/records`, `${factsPrefix}/versions/${ta.version}/materials/${legacy.id}/content`,
      `${sourcePrefix}/bundles/${a.reference.bundleId}/inventory?receiptId=${a.reference.receiptId}`]) {
      const denied = await reader.request(route); assert.equal(denied.status, 403, await denied.clone().text());
    }
  });
  result.checks.push("current-ACL-revokes-old-version-and-source-reads-with-no-cached-authority");
  await stage("owned-resources-close", () => fixture.close()); result.status = "PASSED";
  console.log(JSON.stringify({ ...result, parentPath: root + "/", childPath: "result.json" }));
});
