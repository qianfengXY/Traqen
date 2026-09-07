import assert from "node:assert/strict";
import { open } from "node:fs/promises";
import test from "node:test";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";

async function fixture(t, { acceptance = {}, ...options } = {}) {
  const f = await candidateFixture(t, options);
  const prepared = await f.candidates.prepare(f.context);
  await f.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(f.repository, f.candidates);
  const confirmation = await publication.confirm(owner, f.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId,
    ...(typeof acceptance === "function" ? acceptance() : acceptance) });
  const result = await publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "freeze" });
  const admission = new SourceAdmissionService(f.repository, f.candidates);
  return { ...f, result, confirmation, admission, reference: { bundleId: result.bundle.id, receiptId: result.receipt.id } };
}

test("B-07 qualification carries immutable directory provenance and exact server-timed admission bindings", async (t) => {
  const f = await fixture(t);
  const before = (await f.db.query("SELECT clock_timestamp() AS now")).rows[0].now;
  const qualified = await f.admission.qualify(reader, "workspace", { ...f.reference, qualifiedAt: "2000-01-01T00:00:00.000Z" });
  const after = (await f.db.query("SELECT clock_timestamp() AS now")).rows[0].now;
  const component = (await f.db.query("SELECT * FROM source_truth_component WHERE workspace_id='workspace'")).rows[0];
  assert.equal(qualified.sourceBundleSnapshotId, f.reference.bundleId);
  assert.equal(qualified.inventoryDigest, f.result.bundle.inventoryId);
  assert.equal(qualified.policyRevisionId, "policy-v1");
  assert.equal(qualified.receiptValidUntil, null);
  assert.equal(qualified.confirmationId, f.confirmation.id);
  assert.deepEqual(qualified.acceptanceRecordIds, []);
  assert.ok(Date.parse(qualified.qualifiedAt) >= new Date(before).getTime());
  assert.ok(Date.parse(qualified.qualifiedAt) <= new Date(after).getTime());
  assert.deepEqual(qualified.components, [{ componentSnapshotId: component.id, kind: "DIRECTORY_UPLOAD",
    nativeIdentity: { manifestDigest: component.payload.manifestId }, declaredScope: { kind: "UPLOADED_DIRECTORY" },
    manifestId: component.payload.manifestId,
    provenance: { uploadId: Buffer.from(JSON.stringify({ runId: component.run_id, sourceId: component.source_id })).toString("base64url") } }]);
  const reopened = new SourceAdmissionService(f.repository, f.candidates);
  assert.deepEqual((await reopened.qualify(reader, "workspace", f.reference)).components, qualified.components, "audit locator survives service recreation");
});

test("B-07/10 durable F002 admission resumes expired reads without allowing fresh admission or bypassing revocation", { skip: !process.env.F001_TEST_PG_BIN }, async (t) => {
  const cluster = await isolatedPostgres(t);
  const database = await cluster.createDatabase();
  const f = await fixture(t, { database: () => database, git: true,
    gaps: [{ ruleCode: "GIT_LFS_EXTERNAL", severity: "NON_BLOCKING", ruleVersion: "v1", affectedScope: "external-content" }],
    acceptance: () => ({ reason: "known limitation", expiresAt: new Date(Date.now() + 1500).toISOString() }) });
  assert.equal(typeof f.admission.forAdmittedAnalysis, "function", "an already admitted read must have a separate trusted binding boundary");
  const qualified = await f.admission.qualify(reader, "workspace", f.reference);
  // Consumer-owned persistence: this table simulates F002's analysis record,
  // not a second source authority or a production F001 admission store.
  await f.db.query("CREATE TABLE f002_test_admission (workspace_id text,run_id text,source_input jsonb,PRIMARY KEY(workspace_id,run_id))");
  await f.db.query("INSERT INTO f002_test_admission VALUES ($1,$2,$3)", ["workspace", "analysis-1", JSON.stringify(qualified)]);
  const ref = { ...f.reference, analysisRunId: "analysis-1" };
  const ordinaryPage = await f.admission.inventory(reader, "workspace", f.reference);
  const locator = { componentId: ordinaryPage.items[0].componentId, pathBytes: f.entry.pathBytes };
  await cluster.restart();
  const db = cluster.pool(database.name);
  // Recreated services have no in-memory allowlist of earlier qualification.
  const repository = new SourceTruthRepository(db);
  const candidates = new SourceCandidateService(repository, new SourceMaterialRepository(repository), f.blobs);
  const admission = new SourceAdmissionService(repository, candidates);
  assert.throws(() => admission.forAdmittedAnalysis(), { code: "SOURCE_ANALYSIS_RESOLVER_REQUIRED" });
  const resolveBinding = async (_actor, workspaceId, analysisRunId, tx) => {
    const row = (await tx.query("SELECT source_input FROM f002_test_admission WHERE workspace_id=$1 AND run_id=$2", [workspaceId, analysisRunId])).rows[0];
    return row ? { analysisRunId, sourceInput: row.source_input } : null;
  };
  const admitted = admission.forAdmittedAnalysis(resolveBinding);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(qualified.receiptValidUntil) - Date.now() + 10)));
  await assert.rejects(admission.qualify(reader, "workspace", { ...ref, qualifiedAt: qualified.qualifiedAt }), { code: "SOURCE_ACCEPTANCE_EXPIRED" });
  await assert.rejects(admission.inventory(reader, "workspace", ref), { code: "SOURCE_ACCEPTANCE_EXPIRED" });
  assert.equal(typeof admitted.qualify, "undefined", "resuming a binding cannot qualify a new analysis");
  assert.deepEqual(await admitted.inventory(reader, "workspace", ref), ordinaryPage);
  assert.equal((await admitted.inheritedGaps(reader, "workspace", ref)).items[0].reasonCode, "GIT_LFS_EXTERNAL");
  const read = async () => { const chunks = []; for await (const bytes of admitted.readFile(reader, "workspace", ref, locator)) chunks.push(bytes); return Buffer.concat(chunks); };
  assert.deepEqual(await read(), f.bytes);
  await assert.rejects(admitted.inventory(reader, "workspace", { ...ref, analysisRunId: "unregistered", sourceInput: qualified }), { code: "SOURCE_ANALYSIS_ADMISSION_REQUIRED" });
  await assert.rejects(admitted.inventory(reader, "workspace2", ref), { code: "SOURCE_FORBIDDEN" });
  for (const delta of [{ receiptId: "different-receipt" }, { confirmationId: "different-acceptance" }, { acceptanceRecordIds: [] },
    { receiptValidUntil: null }, { policyRevisionId: "other-policy" }, { inventoryDigest: "other-inventory" },
    { qualifiedAt: qualified.receiptValidUntil }, { qualifiedAt: "2000-01-01T00:00:00.000Z" }, { inheritedGapSet: { id: "other-gaps", count: "0" } }]) {
    await db.query("UPDATE f002_test_admission SET source_input=$1", [JSON.stringify({ ...qualified, ...delta })]);
    await assert.rejects(admitted.inventory(reader, "workspace", ref), { code: "SOURCE_ANALYSIS_ADMISSION_MISMATCH" });
  }
  await db.query("UPDATE f002_test_admission SET source_input=$1", [JSON.stringify(qualified)]);
  await db.query("UPDATE source_truth_workspace SET restore_ready=false WHERE workspace_id='workspace'");
  await assert.rejects(read(), { code: "SOURCE_RESTORE_UNVERIFIED" });
  await db.query("UPDATE source_truth_workspace SET restore_ready=true WHERE workspace_id='workspace'");
  const readBlob = f.blobs.readBlob.bind(f.blobs);
  f.blobs.readBlob = async function* (...args) { for await (const chunk of readBlob(...args)) { yield chunk.subarray(0, 1); yield chunk.subarray(1); } };
  const stream = admitted.readFile(reader, "workspace", ref, locator);
  assert.deepEqual((await stream.next()).value, f.bytes.subarray(0, 1));
  await repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "reader", role: "REVOKED" }] });
  await assert.rejects(stream.next(), { code: "SOURCE_FORBIDDEN" }, "revocation fences the next chunk, not only initial access");
  await assert.rejects(read(), { code: "SOURCE_FORBIDDEN" });
  await repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "reader", role: "READ" }] });
  const location = await f.blobs.location({ tenantId: "tenant", workspaceId: "workspace" }, "blobs", f.digest);
  const file = await open(location, "r+");
  const stat = await file.stat(), byte = Buffer.alloc(1);
  await file.read(byte, 0, 1, stat.size - 1); byte[0] ^= 1;
  await file.write(byte, 0, 1, stat.size - 1); await file.close();
  await assert.rejects(read(), { code: "SOURCE_CONTENT_CORRUPT" });
});

test("B-07 qualification retains a selected Git directory root and SHA-256 commit identity", async (t) => {
  const f = await fixture(t, { git: true, objectFormat: "sha256", root: "services/orders" });
  const qualified = await f.admission.qualify(reader, "workspace", f.reference);
  assert.deepEqual(qualified.components[0].nativeIdentity, { objectFormat: "sha256", resolvedCommit: "a".repeat(64) });
  assert.deepEqual(qualified.components[0].declaredScope, { kind: "DIRECTORY_ROOT", path: "services/orders" });
});

test("B-07 qualification projects Git scope and a complete paged Gap contract without extending acceptance", async (t) => {
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const gaps = ["GIT_LFS_EXTERNAL", "GIT_SUBMODULE_EXTERNAL"].map((ruleCode) => ({ ruleCode, severity: "NON_BLOCKING", ruleVersion: "v1", affectedScope: "external-content" }));
  const f = await fixture(t, { git: true, gaps, acceptance: { reason: "keep known limits", expiresAt } });
  const qualified = await f.admission.qualify(reader, "workspace", f.reference);
  assert.equal(qualified.receiptValidUntil, expiresAt);
  assert.equal(qualified.confirmationId, f.confirmation.id);
  assert.deepEqual(qualified.acceptanceRecordIds, [f.confirmation.id]);
  const component = (await f.db.query("SELECT * FROM source_truth_component WHERE workspace_id='workspace'")).rows[0];
  assert.deepEqual(qualified.components, [{ componentSnapshotId: component.id, kind: "GIT",
    nativeIdentity: { objectFormat: "sha1", resolvedCommit: "a".repeat(40) }, declaredScope: { kind: "REPOSITORY" }, manifestId: component.payload.manifestId }]);
  const first = await f.admission.inheritedGaps(reader, "workspace", f.reference, { limit: 1 });
  const second = await f.admission.inheritedGaps(reader, "workspace", f.reference, { limit: 1, cursor: first.nextCursor });
  assert.ok(first.nextCursor);
  assert.equal(second.nextCursor, null);
  assert.equal(first.gapSetId, qualified.inheritedGapSet.id);
  assert.equal(first.total, "2");
  assert.equal(qualified.inheritedGapSet.consumption, "ALL_PAGES_REQUIRED");
  for (const gap of [...first.items, ...second.items]) {
    assert.equal(gap.gapId, gap.gapKey);
    assert.equal(gap.componentSnapshotId, component.id);
    assert.equal(gap.reasonCode, gap.ruleCode);
    assert.equal(gap.severity, "NON_BLOCKING");
    assert.equal(gap.affectedScope, "external-content");
  }
});

test("B-07 F002 consumes only exact sealed Bundle and Receipt with complete paged inventory", async (t) => {
  const f = await fixture(t);
  const qualified = await f.admission.qualify(reader, "workspace", f.reference);
  assert.equal(qualified?.bundleId, f.reference.bundleId);
  assert.equal(qualified.receiptId, f.reference.receiptId);
  assert.equal(qualified.fileCount, "1");
  assert.equal(qualified.gapCount, "0");
  const page = await f.admission.inventory(reader, "workspace", f.reference, { limit: 1 });
  assert.equal(page.items[0].entry.pathBytes, f.entry.pathBytes);
  assert.equal(page.nextCursor, null);
  const content = [];
  for await (const bytes of f.admission.readFile(reader, "workspace", f.reference, { componentId: page.items[0].componentId, pathBytes: f.entry.pathBytes })) content.push(bytes);
  assert.deepEqual(Buffer.concat(content), f.bytes);
  assert.deepEqual((await f.admission.inheritedGaps(reader, "workspace", f.reference)).items, []);
});

test("B-05 direct locators and cross-Workspace references are not admitted", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.admission.qualify(reader, "workspace", { url: "https://example.test/repo" }), { code: "SOURCE_SEALED_REFERENCE_REQUIRED" });
  await assert.rejects(f.admission.qualify(reader, "workspace2", f.reference), { code: "SOURCE_FORBIDDEN" });
  await assert.rejects(f.admission.qualify(reader, "workspace", { ...f.reference, receiptId: "nonexistent" }), { code: "SOURCE_RECEIPT_NOT_FOUND" });
});

test("B-05 corruption rejects current admission without rewriting the historical READY Receipt", async (t) => {
  const f = await fixture(t);
  const location = await f.blobs.location({ tenantId: "tenant", workspaceId: "workspace" }, "blobs", f.digest);
  const handle = await open(location, "r+");
  const stat = await handle.stat();
  const last = Buffer.alloc(1);
  await handle.read(last, 0, 1, stat.size - 1);
  last[0] ^= 1;
  await handle.write(last, 0, 1, stat.size - 1);
  await handle.close();
  await assert.rejects(f.admission.qualify(reader, "workspace", f.reference), { code: "SOURCE_CONTENT_CORRUPT" });
  const receipt = await f.db.query("SELECT status FROM source_truth_receipt WHERE workspace_id='workspace' AND id=$1", [f.reference.receiptId]);
  assert.equal(receipt.rows[0].status, "READY");
});
