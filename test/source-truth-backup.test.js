import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, open, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { sourceTruthServices } from "../src/source-truth/services.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { SourceRenewalService } from "../src/source-truth/renewal-service.js";
import { SourceUploadService } from "../src/source-truth/upload-service.js";
import { SourceBackupService } from "../src/source-truth/backup-service.js";
import { pathBytes } from "../src/source-truth/identity.js";

async function unfinishedDirectory(f) {
  const bytes = Buffer.from("first-tail");
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  const source = { sourceId: "upload", kind: "DIRECTORY_UPLOAD", scope: { kind: "UPLOADED_DIRECTORY" }, nativeIdentity: null };
  await f.repository.saveDraft(owner, "workspace", { expectedRevision: 1, input: { sources: [source] } });
  const run = await f.repository.startRun(owner, "workspace", { draftRevision: 2, policyRevisionId: "policy-v1" });
  const lease = await f.repository.claimRun("workspace", run.id, { workerId: "fixture-upload", leaseMs: 60000 });
  const context = { workspaceId: "workspace", runId: run.id, generation: lease.generation, sourceId: "upload" };
  const move = (from, to) => f.repository.transition("workspace", run.id, { generation: lease.generation, expectedStatus: from, status: to });
  await move("PREFLIGHTING", "ENUMERATING");
  await f.materials.addSource(context, source);
  const entry = { pathBytes: pathBytes("upload.txt"), kind: "FILE", sizeBytes: String(bytes.length), expectedContent: { algorithm: "sha256", digest: digest(bytes) }, gitMode: null };
  await f.materials.appendEntries(context, [entry]);
  await f.materials.closeEnumeration(context, { fileCount: "1", directoryCount: "0" });
  await f.materials.freezeManifest(context);
  await move("ENUMERATING", "MANIFEST_FROZEN"); await move("MANIFEST_FROZEN", "CAPTURING");
  const upload = new SourceUploadService(f.repository, f.materials, f.blobs);
  await upload.uploadChunk(owner, context, { pathBytes: entry.pathBytes, offset: "0", sizeBytes: "5", digest: digest(bytes.subarray(0, 5)) }, [bytes.subarray(0, 5)]);
  const unacknowledged = await f.blobs.putChunk({ tenantId: "tenant", workspaceId: "workspace" }, { runId: run.id,
    fileKey: `upload:${entry.pathBytes}`, offset: "5", sizeBytes: "5", digest: digest(bytes.subarray(5)) }, [bytes.subarray(5)]);
  return { context, entry, unacknowledged };
}

const nonBlockingGap = { ruleCode: "GIT_LFS_EXTERNAL", severity: "NON_BLOCKING", ruleVersion: "v1", affectedScope: "external-content", externalReference: { kind: "GIT_LFS", oid: "c".repeat(64), sizeBytes: "100" } };
test("real PostgreSQL B-12 paired backup, exact Receipt waterline, isolated restore and rejection paths", { skip: !process.env.F001_TEST_PG_BIN, timeout: 120000 }, async (t) => {
  const cluster = await isolatedPostgres(t);
  const database = await cluster.createDatabase();
  const f = await candidateFixture(t, { database: () => database, git: true, gaps: [nonBlockingGap] });
  const candidate = await f.candidates.prepare(f.context);
  await f.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(f.repository, f.candidates);
  const confirmation = await publication.confirm(owner, f.context, { candidateId: candidate.id, gapSetId: candidate.gapSetId,
    reason: "备份测试明确接受外部缺口", expiresAt: new Date(Date.now() + 60000).toISOString() });
  const result = await publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "before-backup" });
  const pendingUpload = await unfinishedDirectory(f);
  const targetRoot = await realpath(await mkdtemp(path.join(tmpdir(), "tq-f001-backup-test-")));
  let independent = false;
  // Synthetic fault domains only exercise the guard. This is NOT evidence of
  // independent physical backup media or production deployment readiness.
  const volumeProbe = async (location) => ({ encrypted: true, permissionsEnforced: true, persistent: true,
    filesystemId: location.startsWith(targetRoot) ? "backup-test-volume" : "main-test-volume",
    physicalStores: [location.startsWith(targetRoot) && independent ? "test-device-b" : "test-device-a"] });
  const config = { targetId: "isolated-backup", root: targetRoot, maxBytes: "536870912", volumeProbe,
    postgres: { binDirectory: cluster.bin, connection: cluster.connection(database.name) },
    keyRecoveryOwner: "isolated-fixture-only", recoveryKeys: Object.fromEntries(f.blobs.keys) };
  const services = sourceTruthServices({ repository: f.repository, blobs: f.blobs, policy: { id: "policy-v1" }, backupConfiguration: config });
  assert.ok(services.backup, "configured source truth must expose a real paired-backup lifecycle, not a NOT_CONFIGURED placeholder");
  await assert.rejects(services.backup.create({ requestedBy: "fixture-admin" }), { code: "SOURCE_BACKUP_SAME_FAULT_DOMAIN" });
  assert.equal((await f.db.query("SELECT count(*)::int n FROM source_truth_backup_attempt WHERE status='FAILED'")).rows[0].n, 1, "failed backup preflight is durable, not erased from user-visible history");
  independent = true;
  const completed = await services.backup.create({ requestedBy: "fixture-admin" });
  assert.equal(completed.formatVersion, 1);
  assert.equal(completed.memberCount, "1");
  assert.equal(completed.checkpointCount, "1");
  assert.equal((await services.backup.coverage(reader, "workspace", { bundleId: result.bundle.id, receiptId: result.receipt.id })).status, "COVERED");
  const externalProof = JSON.parse(await readFile(path.join(targetRoot, "sets", completed.id, "complete.json"), "utf8"));
  assert.equal(externalProof.payload.id, completed.id);
  assert.equal(JSON.stringify(externalProof).includes(Buffer.alloc(32, 12).toString("base64")), false);
  const renewal = new SourceRenewalService(f.repository, f.candidates);
  const reference = { bundleId: result.bundle.id, receiptId: result.receipt.id };
  const renewedConfirmation = await renewal.confirm(owner, "workspace", { ...reference, gapSetId: candidate.gapSetId, reason: "水位之后同包续签", expiresAt: new Date(Date.now() + 120000).toISOString() });
  const renewed = await renewal.issue(owner, "workspace", { ...reference, confirmationId: renewedConfirmation.id, clientToken: "after-waterline" });
  assert.equal((await services.backup.coverage(reader, "workspace", { bundleId: result.bundle.id, receiptId: renewed.receipt.id })).status, "NOT_COVERED");
  const destination = await cluster.createDatabase({ seed: false });
  const targetBlobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "tq-f001-restored-bytes-")), keyVersion: "test", keys: Object.fromEntries(f.blobs.keys) });
  const offlineRecovery = new SourceBackupService({ configuration: { ...config, postgres: undefined, keyVersion: f.blobs.keyVersion } });
  const restored = await offlineRecovery.restore({ backupId: completed.id, database: destination.db, blobs: targetBlobs,
    postgres: { binDirectory: cluster.bin, connection: cluster.connection(destination.name) }, requestedBy: "fixture-admin" });
  assert.equal(restored.backupId, completed.id);
  assert.equal((await destination.db.query("SELECT restore_ready FROM source_truth_workspace WHERE workspace_id='workspace'")).rows[0].restore_ready, true);
  const recovered = sourceTruthServices({ repository: new SourceTruthRepository(destination.db), blobs: targetBlobs, policy: { id: "policy-v1" } });
  assert.equal((await recovered.admission.qualify(reader, "workspace", reference)).bundleId, result.bundle.id);
  await assert.rejects(recovered.admission.qualify(reader, "workspace", { ...reference, receiptId: renewed.receipt.id }), { code: "SOURCE_RECEIPT_NOT_FOUND" });
  await assert.rejects(recovered.repository.authorize(owner, "workspace2"), { code: "SOURCE_FORBIDDEN" });
  assert.equal((await recovered.upload.checkpoint(reader, pendingUpload.context, pendingUpload.entry.pathBytes)).verifiedPrefixBytes, "5");
  assert.equal((await recovered.repository.getRun(reader, "workspace", pendingUpload.context.runId)).progress.waitingFor, "RESTORE_RECONCILIATION");
  await assert.rejects(async () => { for await (const _ of targetBlobs.readChunk({ tenantId: "tenant", workspaceId: "workspace" }, pendingUpload.unacknowledged)) {} }, { code: "ENOENT" });
  await assert.rejects(services.backup.restore({ backupId: completed.id, database: destination.db, blobs: targetBlobs,
    postgres: { binDirectory: cluster.bin, connection: cluster.connection(destination.name) }, requestedBy: "fixture-admin" }), { code: "SOURCE_RESTORE_TARGET_NOT_EMPTY" });
  const failedTarget = await cluster.createDatabase({ seed: false });
  const failedBlobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "tq-f001-failed-restore-")), keyVersion: "test", keys: Object.fromEntries(f.blobs.keys) });
  t.mock.method(failedBlobs, "put", async () => { throw new Error("injected restored-volume failure"); });
  await assert.rejects(services.backup.restore({ backupId: completed.id, database: failedTarget.db, blobs: failedBlobs,
    postgres: { binDirectory: cluster.bin, connection: cluster.connection(failedTarget.name) }, requestedBy: "fixture-admin" }), /injected restored-volume failure/);
  assert.equal((await failedTarget.db.query("SELECT restore_ready FROM source_truth_workspace WHERE workspace_id='workspace'")).rows[0].restore_ready, false);
  const failedServices = sourceTruthServices({ repository: new SourceTruthRepository(failedTarget.db), blobs: failedBlobs, policy: { id: "policy-v1" } });
  await assert.rejects(failedServices.admission.qualify(reader, "workspace", reference), { code: "SOURCE_RESTORE_UNVERIFIED" });
  const backupBytes = services.backup.targetBlobs;
  const filename = await backupBytes.location({ tenantId: "tenant", workspaceId: "workspace" }, "blobs", f.digest);
  const handle = await open(filename, "r+");
  await handle.write(Buffer.from("broken"), 0, 6, 0); await handle.close();
  await assert.rejects(services.backup.verify(completed.id), { code: "SOURCE_CONTENT_CORRUPT" });
  assert.equal((await services.backup.coverage(reader, "workspace", reference)).status, "UNAVAILABLE");
});
