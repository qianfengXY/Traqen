import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceDatabase, owner, reader } from "./support/source-truth-database.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { SourceSnapshotReader } from "../src/source-truth/admission-service.js";
import { SourceQueryService } from "../src/source-truth/query-service.js";
import { pathBytes } from "../src/source-truth/identity.js";

async function fixture(t) {
  const { repository, db } = await sourceDatabase(t);
  const sources = [
    { sourceId: "D", kind: "DIRECTORY_UPLOAD", scope: { kind: "UPLOADED_DIRECTORY" }, nativeIdentity: null },
    { sourceId: "G", kind: "GIT", scope: { kind: "GIT_TREE", root: null }, nativeIdentity: { objectFormat: "sha1", commit: "a".repeat(40), tree: "b".repeat(40) } },
  ];
  await repository.saveDraft(owner, "workspace", { expectedRevision: 0, input: { sources } });
  const run = await repository.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "v1" });
  const { generation } = await repository.claimRun("workspace", run.id, { workerId: "inventory-test", leaseMs: 60000 });
  const advance = (expectedStatus, status) => repository.transition("workspace", run.id, { generation, expectedStatus, status });
  await advance("PREFLIGHTING", "ENUMERATING");
  const materials = new SourceMaterialRepository(repository), queries = new SourceQueryService(repository, materials);
  const digest = createHash("sha256").update("").digest("hex"), oid = createHash("sha1").update("blob 0\0").digest("hex");
  const contexts = sources.map((s) => ({ workspaceId: "workspace", runId: run.id, sourceId: s.sourceId, generation }));
  const entries = sources.map((s) => ["a-unrelated", "b-orders", "c-orders", "literal%", "订单", Buffer.from([120, 255, 46, 115, 113, 108])].map((name) => ({
    pathBytes: pathBytes(name), kind: "FILE", sizeBytes: "0", gitMode: s.kind === "GIT" ? "100644" : null,
    expectedContent: s.kind === "GIT" ? { objectFormat: "sha1", oid } : { algorithm: "sha256", digest },
  })));
  // Invalid UTF-8 is legal in Git paths, but not an uploaded directory name.
  entries[0].pop();
  for (let i = 0; i < sources.length; i++) {
    await materials.addSource(contexts[i], sources[i]);
    await materials.appendEntries(contexts[i], entries[i]);
    await materials.closeEnumeration(contexts[i], { fileCount: String(entries[i].length), directoryCount: "0" });
    await materials.freezeManifest(contexts[i]);
  }
  const freeze = async () => {
    const blobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "f001-inventory-test-")), keyVersion: "test", keys: { test: Buffer.alloc(32, 31) } });
    await blobs.putBlob({ tenantId: "tenant", workspaceId: "workspace" }, { digest, sizeBytes: "0" }, []);
    await advance("ENUMERATING", "MANIFEST_FROZEN"); await advance("MANIFEST_FROZEN", "CAPTURING");
    for (let i = 0; i < contexts.length; i++) await materials.disposeBatch(contexts[i], entries[i].map((entry) => ({ pathBytes: entry.pathBytes, disposition: "VERIFIED", reasonCode: "CONTENT_VERIFIED", digest, sizeBytes: "0" })));
    await advance("CAPTURING", "RECONCILING");
    const candidates = new SourceCandidateService(repository, materials, blobs);
    const candidate = await candidates.prepare(contexts[0]); await advance("RECONCILING", "REVIEW_REQUIRED");
    const publication = new SourcePublicationService(repository, candidates);
    const confirmation = await publication.confirm(owner, contexts[0], { candidateId: candidate.id, gapSetId: candidate.gapSetId });
    const result = await publication.seal(owner, contexts[0], { confirmationId: confirmation.id, clientToken: "freeze" });
    return { inspection: new SourceSnapshotReader(repository, candidates), reference: { bundleId: result.bundle.id, receiptId: result.receipt.id } };
  };
  return { repository, db, queries, contexts, freeze };
}

test("B-09/10 inventory searches all rows, filters exact components and binds every page to the query and immutable reference", async (t) => {
  const f = await fixture(t), { inspection, reference } = await f.freeze();
  const first = await inspection.inventory(reader, "workspace", reference, { query: "orders", disposition: "VERIFIED", limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].entry.pathBytes, pathBytes("b-orders"), "filter must run before LIMIT, not on the first unfiltered page");
  assert.equal(first.matchedCount, "4");
  const seen = [...first.items]; let cursor = first.nextCursor;
  while (cursor) { const page = await inspection.inventory(reader, "workspace", reference, { query: "orders", disposition: "VERIFIED", limit: 1, cursor }); seen.push(...page.items); cursor = page.nextCursor; assert.equal(page.matchedCount, "4"); }
  assert.equal(new Set(seen.map((r) => `${r.componentId}:${r.entry.pathBytes}`)).size, 4);
  const selected = await inspection.inventory(reader, "workspace", reference, { query: "orders", componentId: seen[0].componentId });
  assert.equal(selected.matchedCount, "2"); assert.ok(selected.items.every((r) => r.componentId === seen[0].componentId));
  assert.equal((await inspection.inventory(reader, "workspace", reference, { query: "%" })).matchedCount, "2", "query is a literal byte substring, not a SQL wildcard");
  assert.equal((await inspection.inventory(reader, "workspace", reference, { query: "订单" })).matchedCount, "2");
  assert.equal((await inspection.inventory(reader, "workspace", reference, { query: ".sql" })).matchedCount, "1", "non-UTF8 Git paths remain searchable without unsafe text conversion");
  assert.equal((await inspection.inventory(reader, "workspace", reference, { disposition: "PENDING" })).matchedCount, "0");
  for (const delta of [{ query: "other" }, { disposition: "METADATA" }, { componentId: seen[0].componentId }]) {
    await assert.rejects(inspection.inventory(reader, "workspace", reference, { query: "orders", disposition: "VERIFIED", cursor: first.nextCursor, ...delta }), { code: "SOURCE_INVALID_INPUT" });
  }
  await assert.rejects(inspection.inventory(reader, "workspace", { ...reference, receiptId: "other" }, { query: "orders", disposition: "VERIFIED", cursor: first.nextCursor }), { code: "SOURCE_INVALID_INPUT" });
  for (const options of [{ query: "x".repeat(257) }, { query: "\ud800" }, { disposition: "INVALID" }, { componentId: "bad" }]) await assert.rejects(inspection.inventory(reader, "workspace", reference, options), { code: "SOURCE_INVALID_INPUT" });
  await assert.rejects(inspection.inventory(reader, "workspace2", reference, { query: "orders" }), { code: "SOURCE_FORBIDDEN" });
  await f.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "reader", role: "REVOKED" }] });
  await assert.rejects(inspection.inventory(reader, "workspace", reference, { query: "orders", disposition: "VERIFIED", cursor: first.nextCursor }), { code: "SOURCE_FORBIDDEN" });
});

test("B-09 live inventory filters pending material without changing the unfiltered manifest stream", async (t) => {
  const f = await fixture(t), context = f.contexts[0];
  const first = await f.queries.inventory(reader, "workspace", context.runId, "D", { query: "orders", disposition: "PENDING", limit: 1 });
  assert.equal(first.matchedCount, "2"); assert.equal(first.items[0].entry.pathBytes, pathBytes("b-orders"));
  const last = await f.queries.inventory(reader, "workspace", context.runId, "D", { query: "orders", disposition: "PENDING", cursor: first.nextCursor });
  assert.equal(last.nextCursor, null); assert.equal(last.items[0].entry.pathBytes, pathBytes("c-orders"));
  await assert.rejects(f.queries.inventory(reader, "workspace", context.runId, "G", { query: "orders", disposition: "PENDING", cursor: first.nextCursor }), { code: "SOURCE_INVALID_INPUT" });
  const stream = []; for await (const entry of f.queries.materials.entryStream(context)) stream.push(entry);
  assert.equal(stream.length, 5, "search must never filter capture, manifest hashing or evidence verification");
  const { inspection, reference } = await f.freeze();
  assert.equal((await inspection.inventory(reader, "workspace", reference)).items.length, 11);
});
