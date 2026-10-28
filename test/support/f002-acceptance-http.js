import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const sourcePrefix = "/v1/workspaces/workspace/source-truth";
export const factsPrefix = "/v1/workspaces/workspace/deterministic-facts";
export const digest = value => createHash("sha256").update(value).digest("hex");
export async function json(client, route, method = "GET", input, expected = 200) {
  const response = await client.request(route, method, input), text = await response.text();
  assert.equal(response.status, expected, `${method} ${route}: ${text}`);
  return JSON.parse(text);
}
export async function pages(client, route, { property = "items", limit = 100 } = {}) {
  const items = [], seen = new Set(); let cursor = null;
  do {
    const query = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
    const result = await json(client, `${route}${route.includes("?") ? "&" : "?"}${query}`);
    assert.ok(Array.isArray(result[property]), `${route}: ${JSON.stringify(result)}`);
    items.push(...result[property]); cursor = result.nextCursor;
    if (cursor) { assert.ok(!seen.has(cursor), "server cursor must advance"); seen.add(cursor); }
    assert.ok(seen.size < 100, "bounded acceptance fixture pagination");
  } while (cursor);
  return items;
}
export async function freezeGit(client, fixture, commit, baselineBundleId = null) {
  const overview = await json(client, sourcePrefix);
  const draft = await json(client, `${sourcePrefix}/draft`, "PUT", { expectedRevision: overview.draft?.revision ?? 0, input: {
    baselineBundleId, sources: [{ sourceId: "public", kind: "GIT", mode: "UPDATE", url: fixture.source.url, ref: commit, root: null }],
  } });
  let run = await json(client, `${sourcePrefix}/runs`, "POST", { draftRevision: draft.revision }, 202);
  const deadline = Date.now() + 60000;
  while (run.status !== "REVIEW_REQUIRED") {
    assert.ok(!["FAILED", "CANCELLED", "BLOCKED"].includes(run.status) && Date.now() < deadline, JSON.stringify(run));
    await delay(100); run = await json(client, `${sourcePrefix}/runs/${run.id}`);
  }
  const candidate = run.progress.candidate;
  assert.ok(candidate?.id && candidate.gapSetId, "actual capture must reach a review candidate");
  const confirmation = await json(client, `${sourcePrefix}/runs/${run.id}/confirm`, "POST", { candidateId: candidate.id, gapSetId: candidate.gapSetId });
  const frozen = await json(client, `${sourcePrefix}/runs/${run.id}/seal`, "POST", { confirmationId: confirmation.id, clientToken: randomUUID() });
  const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
  const admission = await json(client, `${sourcePrefix}/admission`, "POST", reference);
  const inventory = await pages(client, `${sourcePrefix}/bundles/${reference.bundleId}/inventory?receiptId=${reference.receiptId}`, { limit: 3 });
  return { run, frozen, reference, admission, inventory };
}
export async function publishFacts(client, frozen) {
  const profiles = (await json(client, `${factsPrefix}/profiles`)).profiles;
  const profile = profiles.find(item => item.recommended === true);
  assert.ok(profile && profile.extractionLimits.automaticPublication === "closed-scope-v1");
  const componentId = frozen.inventory.find(item => item.entry.kind === "FILE")?.componentId;
  assert.ok(componentId);
  let run = (await json(client, `${factsPrefix}/runs`, "POST", { operationId: randomUUID(), source: frozen.reference,
    profileId: profile.id, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] }, 202)).run;
  const deadline = Date.now() + 60000;
  while (run.scopes[0].status !== "SEALED") {
    assert.ok(!["FAILED", "BLOCKED", "CANCELLED"].includes(run.scopes[0].status) && Date.now() < deadline, JSON.stringify(run));
    await delay(100); run = (await json(client, `${factsPrefix}/runs/${run.id}`)).run;
  }
  const version = run.scopes[0].graphVersionId;
  const records = await pages(client, `${factsPrefix}/versions/${version}/records`);
  const manifest = (await json(client, `${factsPrefix}/versions/${version}/manifest`)).manifest;
  return { run, version, records, manifest, profileId: profile.id };
}
export async function original(client, frozen, technical, filename, expected) {
  const encoded = Buffer.from(filename).toString("base64url");
  const item = frozen.inventory.find(item => item.entry.pathBytes === encoded);
  const material = technical.records.find(row => row.kind === "MATERIAL" && row.payload.pathBytes === encoded);
  assert.ok(item && material, filename);
  const first = await client.request(`${sourcePrefix}/bundles/${frozen.reference.bundleId}/material?${new URLSearchParams({
    receiptId: frozen.reference.receiptId, componentId: item.componentId, pathBytes: encoded })}`);
  assert.equal(first.status, 200, await first.clone().text());
  const bytes = Buffer.from(await first.arrayBuffer());
  assert.deepEqual(bytes, Buffer.from(expected));
  assert.equal(first.headers.get("x-source-content-digest"), digest(bytes));
  const second = await client.request(`${factsPrefix}/versions/${technical.version}/materials/${material.id}/content`);
  assert.equal(second.status, 200, await second.clone().text());
  assert.equal(second.headers.get("x-source-bundle-id"), frozen.reference.bundleId);
  assert.equal(second.headers.get("x-source-receipt-id"), frozen.reference.receiptId);
  assert.equal(second.headers.get("x-f002-original-digest"), digest(bytes));
  const display = Buffer.from(await second.arrayBuffer());
  assert.equal(second.headers.get("x-f002-display-digest"), digest(display));
  if (filename === "config/app.properties") {
    assert.equal(second.headers.get("x-f002-redacted"), "true");
    assert.equal(display.includes("OWNED_FIXTURE_SECRET_NEVER_INDEX"), false);
  } else assert.deepEqual(display, bytes);
  return { materialId: material.id, originalDigest: digest(bytes), displayDigest: digest(display) };
}
