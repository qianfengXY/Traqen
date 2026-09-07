import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceDatabase, owner } from "./support/source-truth-database.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { manifestIdentity, pathBytes } from "../src/source-truth/identity.js";

const emptyDigest = createHash("sha256").update("").digest("hex");
const entry = (name) => ({ pathBytes: pathBytes(name), kind: "FILE", sizeBytes: "0", expectedContent: { algorithm: "sha256", digest: emptyDigest }, gitMode: null });
async function materialFixture(t) {
  const { repository, db } = await sourceDatabase(t);
  const source = { sourceId: "D", kind: "DIRECTORY_UPLOAD", scope: { kind: "UPLOADED_DIRECTORY" }, nativeIdentity: null };
  await repository.saveDraft(owner, "workspace", { expectedRevision: 0, input: { sources: [source] } });
  const run = await repository.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "v1" });
  const lease = await repository.claimRun("workspace", run.id, { workerId: "worker", leaseMs: 60000 });
  await repository.transition("workspace", run.id, { generation: lease.generation, expectedStatus: "PREFLIGHTING", status: "ENUMERATING" });
  const m = new SourceMaterialRepository(repository);
  const context = { workspaceId: "workspace", runId: run.id, generation: lease.generation, sourceId: "D" };
  await m.addSource(context, source);
  return { m, context, repository, db };
}

test("B-02/06 database manifest is byte-ordered and digest does not depend on enumeration batches", async (t) => {
  const { m, context } = await materialFixture(t);
  const rows = [entry("z"), entry("a"), entry("订单")];
  const appended = await m.appendEntries(context, rows);
  assert.equal(appended?.discoveredCount, "3");
  await m.closeEnumeration(context, { fileCount: "3", directoryCount: "0" });
  const manifest = await m.freezeManifest(context, { shardSize: 2 });
  assert.equal(manifest.id, manifestIdentity("DIRECTORY_UPLOAD", rows).id);
  assert.equal(manifest.fileCount, "3");
  const first = await m.entries(context, { limit: 2 });
  assert.deepEqual(first.items.map(({ entry }) => entry.pathBytes), [pathBytes("a"), pathBytes("z")]);
  const last = await m.entries(context, { limit: 2, after: first.nextCursor });
  assert.deepEqual(last.items.map(({ entry }) => entry.pathBytes), [pathBytes("订单")]);
  assert.equal(last.nextCursor, null);
  await assert.rejects(m.appendEntries(context, [entry("late")] ), { code: "SOURCE_MANIFEST_LOCKED" });
});

test("B-05 incomplete enumeration, duplicate paths and unverified directory entries cannot reconcile", async (t) => {
  const { m, context } = await materialFixture(t);
  assert.equal((await m.appendEntries(context, [entry("a")]))?.discoveredCount, "1");
  await assert.rejects(m.freezeManifest(context), { code: "SOURCE_ENUMERATION_INCOMPLETE" });
  await assert.rejects(m.appendEntries(context, [entry("a")]), { code: "SOURCE_DUPLICATE_PATH" });
  await assert.rejects(m.closeEnumeration(context, { fileCount: "2", directoryCount: "0" }), { code: "SOURCE_ENUMERATION_INCOMPLETE" });
  await m.closeEnumeration(context, { fileCount: "1", directoryCount: "0" });
  await m.freezeManifest(context);
  assert.equal((await m.summary(context)).pendingCount, "1");
  await assert.rejects(m.dispose(context, { pathBytes: pathBytes("a"), disposition: "MISSING", reasonCode: "ignored" }), { code: "SOURCE_DIRECTORY_INCOMPLETE" });
  await m.dispose(context, { pathBytes: pathBytes("a"), disposition: "VERIFIED", digest: emptyDigest, sizeBytes: "0", reasonCode: "CONTENT_VERIFIED" });
  assert.equal((await m.summary(context)).pendingCount, "0");
  await assert.rejects(m.dispose(context, { pathBytes: pathBytes("a"), disposition: "VERIFIED", digest: "f".repeat(64), sizeBytes: "0", reasonCode: "CONTENT_VERIFIED" }), { code: "SOURCE_CONTENT_MISMATCH" });
});

test("B-13 an empty uploaded directory cannot close as an empty successful source", async (t) => {
  const { m, context } = await materialFixture(t);
  await assert.rejects(m.closeEnumeration(context, { fileCount: "0", directoryCount: "0" }), { code: "SOURCE_EMPTY_DIRECTORY_UNSUPPORTED" });
});

test("B-05 frozen membership and terminal dispositions reject direct SQL mutation", async (t) => {
  const { m, context, db } = await materialFixture(t);
  await m.appendEntries(context, [entry("a")]);
  await m.closeEnumeration(context, { fileCount: "1", directoryCount: "0" });
  await m.freezeManifest(context);
  await assert.rejects(db.query(`INSERT INTO source_truth_entry (workspace_id,run_id,source_id,path_bytes,entry)
    VALUES ('workspace',$1,'D',$2,$3)`, [context.runId, Buffer.from("late"), JSON.stringify(entry("late"))]), /immutable|closed/i);
  await m.dispose(context, { pathBytes: pathBytes("a"), disposition: "VERIFIED", digest: emptyDigest, sizeBytes: "0", reasonCode: "CONTENT_VERIFIED" });
  await assert.rejects(db.query("UPDATE source_truth_entry SET disposition=NULL WHERE workspace_id='workspace' AND run_id=$1", [context.runId]), /immutable/i);
});

test("B-05 worker writes are rejected after its initiating member loses maintenance permission", async (t) => {
  const { m, context, repository } = await materialFixture(t);
  await repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "REVOKED" }] });
  await assert.rejects(m.appendEntries(context, [entry("after-revocation")]), { code: "SOURCE_FORBIDDEN" });
});
