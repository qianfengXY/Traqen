import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { largeStorageFixture } from "./support/f003-large-storage-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { InvestigationWorker } from "../src/business-knowledge/worker.js";
import { createF003Runtime } from "../src/business-knowledge/runtime.js";
import { InvestigationService } from "../src/business-knowledge/investigation-service.js";
import { F003PublicationService } from "../src/business-knowledge/publication-service.js";
import { PublicationAuthority } from "../src/business-knowledge/publication-authority.js";
import { canonicalEncode } from "../src/source-truth/identity.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";

// Test-only measurement units for exercising the publication kernel. This is
// neither the legacy policy nor a selected contract for real business graphs.
const policy = { id: "isolated-mechanism-only", version: "test", minimumDenominators: { inventory: 1, candidateSample: 1 },
  thresholds: { candidatePrecision: 0.9, requiredRelationshipRate: 1, forbiddenRelationshipViolations: 0, gapHonestyRate: 1 } };

async function serve(t, db, repository, admission) {
  const runtime = await createF003Runtime({ publicationAuthorityFile: null, sourceRuntime: { pool: db, services: { repository, admission },
    configuration: { members: [{ ...owner, tokenDigest: createHash("sha256").update("isolated-owner-token").digest("hex") },
      { ...reader, tokenDigest: createHash("sha256").update("isolated-reader-token").digest("hex") }], origins: [] } },
    application: { createBusinessKnowledgeModelExecutor: () => async () => { throw new Error("no external model in publication tests"); } } });
  t.after(() => runtime.close());
  const server = createServer(async (req, res) => { if (!await runtime.businessKnowledgeHandler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { runtime, root: `http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/business-knowledge` };
}

async function fixture(t, { rich = false, large = false, implementationVersion = null, database } = {}) {
  if (large) {
    const f = await largeStorageFixture(t, { database, implementationVersion });
    await f.worker.run(owner, "workspace", f.run.id, { workerId: "large-publication-mechanism" });
    return { ...f, graph: await f.service.graph(owner, "workspace", f.run.id), ...await serve(t, f.db, f.repository, f.sourceAdmission) };
  }
  const f = await investigationFixture(t, database ? { database } : {});
  if (implementationVersion) f.service = new InvestigationService({ sources: f.repository, sourceAdmission: f.sourceAdmission, profiles: f.profiles, implementationVersion });
  const run = await f.service.start(owner, "workspace", f.request);
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: async c => {
    const reservation = await f.service.reserveModelCall(owner, "workspace", c.investigationId, c), { input } = c;
    const result = input.phase === "PLAN" ? { assignments: [{ slotId: "child-1", obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "explain original rule", materialKeys: input.inventory.map(m => m.key) }] }
      : input.phase === "INVESTIGATE" ? { candidates: Array.from({ length: rich ? 30 : 1 }, (_, i) => ({ key: `cancel-${i}`, kind: "FUNCTION", name: `取消订单-${i}`, statement: "用户可取消未支付订单", scope: "合成机制样本，不是业务质量证据", uncertainties: [],
        evidence: [{ materialId: input.materials[0].id, startLine: 1, endLine: 1, quote: "用户可以取消未支付的订单。" }] })),
        relations: rich ? Array.from({ length: 60 }, (_, i) => ({ key: `rel-${i}`, sourceKey: "cancel-0", targetKey: `cancel-${i % 29 + 1}`,
          predicate: `TEST_RELATION_${i}`, scope: "仅合成CAS机制", uncertainties: [], evidence: [{ materialId: input.materials[0].id, startLine: 1, endLine: 1, quote: "用户可以取消未支付的订单。" }] })) : [] }
        : input.stage === "CONSOLIDATE_PROPOSALS" ? { mergeSuggestions: [], conflictGroups: [] }
          : { reviews: [...input.candidates, ...input.relations].map(p => ({ key: p.key, support: "SUPPORTED", rationale: "test-double review, not independent quality", premises: ["仅隔离机制"], unresolvedConflicts: [] })) };
    return { result, reservationId: reservation.id };
  } });
  await worker.run(owner, "workspace", run.id, { workerId: "analysis-only" });
  const graph = await f.service.graph(owner, "workspace", run.id);
  // Runtime's real legacy authenticator consumes token digests, not caller ids.
  return { ...f, run, graph, worker, ...await serve(t, f.db, f.repository, f.sourceAdmission) };
}

test("F003 HTTP distinguishes immutable collected graph from server-computed blocked publication and current head", async t => {
  const f = await fixture(t), headers = { authorization: "Bearer isolated-owner-token", "content-type": "application/json" }, root = f.root;
  const ready = await fetch(`${root}/investigations/${f.run.id}/publication-readiness`, { headers });
  assert.equal(ready.status, 200);
  const readiness = (await ready.json()).readiness;
  assert.equal(readiness.status, "BLOCKED"); assert.equal(readiness.binding.graphDigest, f.graph.digest);
  assert.equal(readiness.binding.investigationId, f.run.id); assert.equal(readiness.binding.profileId, f.graph.profileId);
  assert.deepEqual(readiness.binding.sourceInput, (await f.service.get(owner, "workspace", f.run.id)).sourceInput);
  for (const code of ["F003_INDEPENDENT_QUALITY_MISSING", "F003_PAIRED_RECOVERY_MISSING", "F003_IMPLEMENTATION_UNVERIFIED"])
    assert.ok(readiness.missing.some(m => m.code === code), code);
  const publishBody = { operationId: "publish-real", expectedGraphDigest: f.graph.digest, expectedHeadVersion: 0 };
  const publish = await fetch(`${root}/investigations/${f.run.id}/publish`, { method: "POST", headers, body: JSON.stringify(publishBody) });
  assert.equal(publish.status, 409); assert.equal((await publish.json()).error.code, "F003_PUBLICATION_BLOCKED");
  const forged = await fetch(`${root}/investigations/${f.run.id}/publish`, { method: "POST", headers,
    body: JSON.stringify({ ...publishBody, qualityPassed: true, restorePassed: true, implementationVersion: createHash("sha256").update("self-report").digest("hex") }) });
  assert.equal(forged.status, 422);
  assert.equal((await (await fetch(`${root}/current`, { headers })).json()).head, null);
  assert.deepEqual((await (await fetch(`${root}/versions`, { headers })).json()).versions, []);
  assert.equal((await f.service.graph(owner, "workspace", f.run.id)).digest, f.graph.digest);
  assert.equal((await f.service.graph(owner, "workspace", f.run.id)).published, false);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM current_graph_head")).rows[0].n, 0);
  const queued = await f.service.start(owner, "workspace", { ...f.request, operationId: "not-analyzed-yet" });
  const notCollected = await fetch(`${root}/investigations/${queued.id}/publication-readiness`, { headers });
  assert.equal(notCollected.status, 404); assert.equal((await notCollected.json()).error.code, "F003_GRAPH_NOT_FOUND");
});

async function isolatedPublicationPorts(t, { database, importEvidence = true, large = false } = {}) {
  const version = { status: "VERIFIED", commitSha: "0".repeat(40), sourceDigest: "d".repeat(64) };
  const f = await fixture(t, { rich: true, large, implementationVersion: version, database });
  const directory = await mkdtemp(join(tmpdir(), "traqen-f003-publication-mechanism-")), reportFile = join(directory, "reports.json");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reviewers = ["isolated-reviewer", "isolated-recovery-observer"].map(id => ({ id, ...generateKeyPairSync("ed25519") }));
  const authority = new PublicationAuthority({ implementationAuthors: ["isolated-implementation-author"], artifactFiles: [reportFile],
    issuers: reviewers.map((r, i) => ({ id: r.id, kind: i ? "RECOVERY" : "QUALITY", publicKey: r.publicKey.export({ type: "spki", format: "pem" }) })) });
  // ONLY these two external ports are synthetic. This is not a protected-volume,
  // independent quality or real paired-recovery acceptance test.
  const backup = { config: { targetId: "isolated-target" }, async ready() {},
    async verify() { return { included: true, waterline: { capturedAt: "2090-01-01T00:00:00.000Z" } }; },
    async coverage() { throw new Error("readiness must not call F001's health-writing coverage method"); } };
  await f.db.query("INSERT INTO source_truth_backup_attempt(id,target_id,requested_by,status,finished_at) VALUES ('isolated-backup','isolated-target','test-only','COMPLETED',clock_timestamp())");
  await f.db.query("INSERT INTO source_truth_backup_set(id,target_id,payload,completed_at) VALUES ('isolated-backup','isolated-target','{}',clock_timestamp())");
  await f.db.query("INSERT INTO source_truth_backup_member(backup_id,workspace_id,bundle_id,receipt_id) VALUES ('isolated-backup','workspace',$1,$2)", [f.reference.bundleId, f.reference.receiptId]);
  const service = f.runtime.services.publications;
  Object.assign(service, { authority, backup, qualityPolicy: policy, implementationResolver: async () => version });
  const initial = await service.readiness(owner, "workspace", f.run.id), binding = initial.binding;
  const payloads = [{ version: 1, kind: "QUALITY", issuerId: reviewers[0].id, evidenceClass: "REAL_PROJECT", binding,
    observedAt: "2026-01-01T00:00:00Z", quality: { measurementKind: "INDEPENDENT_REVIEW", truthSetDigest: "e".repeat(64), measurementRefs: ["isolated-test-measurement"],
      denominators: policy.minimumDenominators, metrics: policy.thresholds, equivalence: { kind: "MEASURED_REPLAY_AND_INCREMENTAL" } } },
  { version: 1, kind: "RECOVERY", issuerId: reviewers[1].id, evidenceClass: "REAL_PROJECT", binding, observedAt: "2026-01-01T00:00:00Z",
    recovery: { kind: "REAL_NATIVE_PAIRED_RESTORE", backupId: "isolated-backup", waterline: "2090-01-01T00:00:00.000Z",
      restoredGraphDigest: f.graph.digest, restoreReportDigest: "f".repeat(64), restoreEventId: "isolated-restore-event" } }];
  const writeReports = async () => writeFile(reportFile, JSON.stringify({ artifacts: payloads.map((payload, i) => ({ issuerId: payload.issuerId, payload,
    signature: sign(null, Buffer.from(canonicalEncode(payload)), reviewers[i].privateKey).toString("base64url") })) }), { mode: 0o600 });
  await writeReports();
  if (importEvidence) await service.importEvidence(owner, "workspace", f.run.id);
  return { ...f, investigations: f.service, service, version, authority, backup, payloads, writeReports };
}

test("F003 chunked large graph publishes, reads exact current/history and passes the real session write gate only with mechanism-qualified ports", { skip: !process.env.F001_TEST_PG_BIN, timeout: 60000 }, async t => {
  const cluster = await isolatedPostgres(t);
  const f = await isolatedPublicationPorts(t, { large: true, database: async () => cluster.createDatabase() });
  assert.ok(Buffer.byteLength(JSON.stringify(f.graph)) > 2 * 1024 * 1024);
  const root = (await f.db.query("SELECT payload FROM f003_checkpoint WHERE investigation_id=$1 AND checkpoint_key='graph'", [f.run.id])).rows[0].payload;
  assert.equal(root.storageKind, "F003_CHECKPOINT_MANIFEST"); assert.equal(root.logicalGraphDigest, f.graph.digest);
  const readiness = await f.service.readiness(owner, "workspace", f.run.id);
  assert.equal(readiness.status, "READY", JSON.stringify(readiness.missing));
  const beforeCalls = f.calls.length;
  const published = await f.service.publish(owner, "workspace", f.run.id,
    { operationId: "large-mechanism-publish", expectedGraphDigest: f.graph.digest, expectedHeadVersion: 0 });
  const revision = published.head.graphRevisionId;
  const current = await f.service.current(reader, "workspace"), exact = await f.service.version(reader, "workspace", revision);
  for (const view of [current, exact]) {
    assert.deepEqual(view.graph, f.graph);
    assert.deepEqual(view.publication.binding, readiness.binding);
    assert.deepEqual(view.publication.binding.sourceInput, (await f.investigations.get(owner, "workspace", f.run.id)).sourceInput);
    assert.equal(view.publication.binding.profileId, f.graph.profileId);
    assert.deepEqual(view.publication.binding.implementationVersion, f.version);
  }
  assert.equal((await f.service.versions(reader, "workspace"))[0].graphDigest, f.graph.digest);
  // This is the actual owning-transaction gate (conversationAdmission in this
  // implementation), not a test substitute for assert-published-write behavior.
  const admission = await f.service.withPublishedVersion(owner, "workspace", revision, true,
    tx => f.service.conversationAdmission(tx, owner, "workspace", revision));
  assert.deepEqual(admission.binding, readiness.binding);
  const headers = { authorization: "Bearer isolated-owner-token", "content-type": "application/json" };
  const created = await fetch(`${f.root}/versions/${revision}/work-sessions`, { method: "POST", headers,
    body: JSON.stringify({ operationId: "large-session", expectedGraphDigest: f.graph.digest, title: "mechanism-only large graph session" }) });
  assert.equal(created.status, 201, await created.clone().text());
  const { session } = await created.json();
  assert.equal(session.binding.graphRevisionId, revision); assert.equal(session.binding.graphDigest, f.graph.digest);
  assert.deepEqual(session.binding.sourceInput, readiness.binding.sourceInput);
  assert.deepEqual(session.admission.binding, readiness.binding);
  assert.deepEqual((await f.runtime.services.workSessions.get(reader, "workspace", session.id)).session.binding, session.binding);
  // Removing test-only qualification blocks subsequent writes, never historical
  // graph/session reads. No production policy is enabled by this fixture.
  f.service.qualityPolicy = null;
  await assert.rejects(f.runtime.services.workSessions.create(owner, "workspace", revision,
    { operationId: "unqualified-large-session", expectedGraphDigest: f.graph.digest, title: "must remain blocked" }), { code: "F003_SESSION_WRITE_BLOCKED" });
  assert.deepEqual((await f.service.version(reader, "workspace", revision)).graph, f.graph);
  assert.equal((await f.runtime.services.workSessions.get(reader, "workspace", session.id)).session.id, session.id);
  assert.equal(f.calls.length, beforeCalls);
  assert.equal((await f.investigations.graph(owner, "workspace", f.run.id)).published, false);
  console.log(JSON.stringify({ kind: "LARGE_GRAPH_PUBLICATION_SESSION_MECHANISM_ONLY", graphBytes: Buffer.byteLength(JSON.stringify(f.graph)),
    graphDigest: f.graph.digest, exactBindingPreserved: true, realQuality: false, realProtectedMedia: false, additionalModelCalls: 0 }));
});

test("F003 isolated publication kernel atomically adopts one head, retains immutable history and rejects stale or foreign writes", async t => {
  const f = await isolatedPublicationPorts(t), readiness = await f.service.readiness(owner, "workspace", f.run.id);
  assert.equal(readiness.status, "READY", JSON.stringify(readiness.missing));
  const input = { operationId: "explicit-adopt", expectedGraphDigest: f.graph.digest, expectedHeadVersion: 0 };
  const results = await Promise.allSettled([f.service.publish(owner, "workspace", f.run.id, input),
    f.service.publish(owner, "workspace", f.run.id, { ...input, operationId: "concurrent-adopt" })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "F003_HEAD_CONFLICT");
  const published = results.find(r => r.status === "fulfilled").value;
  assert.equal(published.head.version, 1);
  assert.equal((await f.service.current(reader, "workspace")).graph.digest, f.graph.digest);
  assert.equal((await f.service.versions(reader, "workspace")).length, 1);
  assert.equal((await f.service.version(reader, "workspace", published.head.graphRevisionId)).publication.graphDigest, f.graph.digest);
  assert.equal((await f.service.publish(owner, "workspace", f.run.id, { ...input, operationId: published.publication.operationId ?? (results[0].status === "fulfilled" ? "explicit-adopt" : "concurrent-adopt") })).replayed, true);
  await assert.rejects(f.service.publish(reader, "workspace", f.run.id, { ...input, operationId: "read-only" }), { status: 403 });
  await assert.rejects(f.service.current(owner, "workspace2"), { status: 403 });
  const original = await f.runtime.services.investigations.graph(owner, "workspace", f.run.id);
  assert.equal(original.published, false); assert.equal(original.digest, f.graph.digest);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM current_graph_head_event")).rows[0].n, 1);
  for (const table of ["f003_publication", "f003_publication_evidence"]) await assert.rejects(f.db.query(`DELETE FROM ${table}`), /append-only/);
  const draft = await f.investigations.start(owner, "workspace", { ...f.request, operationId: "new-unpublished-analysis" });
  await f.worker.run(owner, "workspace", draft.id, { workerId: "new-analysis" });
  const nextGraph = await f.investigations.graph(owner, "workspace", draft.id), nextInput = { operationId: "adopt-next", expectedGraphDigest: nextGraph.digest, expectedHeadVersion: 1 };
  assert.equal((await f.service.current(reader, "workspace")).head.version, 1);
  await assert.rejects(f.service.publish(owner, "workspace", draft.id, nextInput), { code: "F003_PUBLICATION_BLOCKED" });
  const nextBinding = (await f.service.readiness(owner, "workspace", draft.id)).binding;
  for (const p of f.payloads) p.binding = nextBinding;
  f.payloads[1].recovery.restoredGraphDigest = nextGraph.digest;
  await f.writeReports();
  await f.service.importEvidence(owner, "workspace", draft.id);
  const headers = { authorization: "Bearer isolated-owner-token", "content-type": "application/json" };
  const response = await fetch(`${f.root}/investigations/${draft.id}/publish`, { method: "POST", headers, body: JSON.stringify(nextInput) });
  assert.equal(response.status, 200);
  const adopted = await response.json();
  assert.equal(adopted.head.version, 2); assert.equal((await f.service.current(reader, "workspace")).graph.digest, nextGraph.digest);
  assert.equal((await f.service.version(reader, "workspace", published.head.graphRevisionId)).graph.digest, f.graph.digest);
  assert.equal((await f.service.versions(reader, "workspace")).length, 2);
  assert.equal((await (await fetch(`${f.root}/current`, { headers })).json()).graph.digest, nextGraph.digest);
  assert.equal((await (await fetch(`${f.root}/versions?limit=1`, { headers })).json()).versions.length, 1);
  assert.equal((await (await fetch(`${f.root}/versions/${published.head.graphRevisionId}`, { headers })).json()).graph.digest, f.graph.digest);
  const artifactId = (await f.service.version(reader, "workspace", adopted.head.graphRevisionId)).revision.graphArtifactId;
  await f.db.query("UPDATE understanding_record SET record_payload=jsonb_set(record_payload,'{businessGraph,candidates,0,statement}','\"tampered\"'::jsonb) WHERE project_id=$1 AND record_type='GRAPH_ARTIFACT' AND id=$2", ["workspace", artifactId]);
  await assert.rejects(f.service.current(reader, "workspace"), { code: "F003_VERSION_CORRUPT" });
});

test("F003 backup barrier permits readiness reads but blocks explicit evidence import until current maintenance permission is valid", async t => {
  const f = await isolatedPublicationPorts(t, { importEvidence: false });
  const count = async () => (await f.db.query("SELECT count(*)::int AS n FROM f003_publication_evidence")).rows[0].n;
  assert.equal(await count(), 0);
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=true WHERE workspace_id='workspace'");
  assert.equal((await f.service.readiness(owner, "workspace", f.run.id)).status, "BLOCKED");
  assert.equal(await count(), 0);
  const headers = { authorization: "Bearer isolated-owner-token", "content-type": "application/json" };
  assert.equal((await fetch(`${f.root}/investigations/${f.run.id}/publication-readiness`, { headers })).status, 200);
  const importUrl = `${f.root}/investigations/${f.run.id}/import-publication-evidence`;
  const blocked = await fetch(importUrl, { method: "POST", headers, body: "{}" });
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error.code, "F003_BACKUP_BARRIER");
  assert.equal(await count(), 0);
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=false WHERE workspace_id='workspace'");
  assert.equal((await fetch(importUrl, { method: "POST", headers: { ...headers, authorization: "Bearer isolated-reader-token" }, body: "{}" })).status, 403);
  assert.equal((await fetch(importUrl, { method: "POST", headers, body: '{"issuerId":"self"}' })).status, 422);
  const imported = await fetch(importUrl, { method: "POST", headers, body: "{}" });
  assert.equal(imported.status, 200); assert.equal((await imported.json()).importedEvidenceRefs.length, 2); assert.equal(await count(), 2);
  assert.equal((await f.service.readiness(owner, "workspace", f.run.id)).status, "READY");
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=true WHERE workspace_id='workspace'");
  const duringBackup = await f.service.readiness(owner, "workspace", f.run.id);
  assert.equal(duringBackup.canPublish, false); assert.ok(duringBackup.missing.some(m => m.code === "F003_BACKUP_BARRIER"));
  assert.equal(await count(), 2);
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=false WHERE workspace_id='workspace'");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_backup_health")).rows[0].n, 0);
  await f.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: owner.actorId, role: "READ" }] });
  await assert.rejects(f.service.importEvidence(owner, "workspace", f.run.id), { status: 403 });
  const readOnly = await f.service.readiness(owner, "workspace", f.run.id);
  assert.equal(readOnly.canPublish, false); assert.ok(readOnly.missing.some(m => m.code === "F003_PUBLICATION_ROLE_REQUIRED"));
  assert.equal(await count(), 2);
});

test("F003 imported evidence survives approved-file removal, but revoked trust and synthetic volume probes never open publication", async t => {
  const f = await isolatedPublicationPorts(t);
  assert.equal((await f.service.readiness(owner, "workspace", f.run.id)).status, "READY");
  f.authority.artifactFiles = [];
  assert.equal((await f.service.readiness(owner, "workspace", f.run.id)).status, "READY", "authorized evidence is durable, not an in-memory file flag");
  f.backup.config = { volumeProbe: async () => ({ encrypted: true }) };
  const simulated = await f.service.readiness(owner, "workspace", f.run.id);
  assert.equal(simulated.status, "BLOCKED"); assert.ok(simulated.missing.some(m => m.code === "F003_SYNTHETIC_PROTECTION_NOT_ACCEPTED"));
  f.authority.issuers.delete("isolated-reviewer");
  assert.ok((await f.service.readiness(owner, "workspace", f.run.id)).missing.some(m => m.code === "F003_INDEPENDENT_QUALITY_MISSING"));
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM f003_publication_evidence")).rows[0].n, 2);
});

test("F003 cannot use legacy v1 quantities as the unconfirmed business-graph measurement contract", async t => {
  const f = await isolatedPublicationPorts(t);
  // Even a signed, otherwise complete mechanism fixture cannot select the
  // measurement contract. No business-graph contract is confirmed yet.
  f.service.qualityPolicy = null;
  const ready = await f.service.readiness(owner, "workspace", f.run.id);
  assert.equal(ready.status, "BLOCKED");
  assert.equal(ready.policy, null);
  assert.ok(ready.missing.some(m => m.code === "F003_QUALITY_POLICY_UNCONFIRMED"));
  await assert.rejects(f.service.publish(owner, "workspace", f.run.id,
    { operationId: "legacy-numbers-not-authority", expectedGraphDigest: f.graph.digest, expectedHeadVersion: 0 }),
  { code: "F003_PUBLICATION_BLOCKED" });
  assert.equal((await f.service.current(owner, "workspace")).head, null);
});

test("F003 native restart preserves the exact published head and history offline (quality/recovery ports remain synthetic)", { skip: !process.env.F001_TEST_PG_BIN, timeout: 60000 }, async t => {
  const cluster = await isolatedPostgres(t); let name;
  const f = await isolatedPublicationPorts(t, { database: async () => { const created = await cluster.createDatabase(); name = created.name; return created; } });
  const published = await f.service.publish(owner, "workspace", f.run.id, { operationId: "restart-head", expectedGraphDigest: f.graph.digest, expectedHeadVersion: 0 });
  const before = await f.service.current(reader, "workspace"), versions = await f.service.versions(reader, "workspace");
  await cluster.restart();
  const db = cluster.pool(name), sources = new SourceTruthRepository(db), recovered = new F003PublicationService({ sources });
  assert.deepEqual(await recovered.current(reader, "workspace"), before);
  assert.deepEqual(await recovered.versions(reader, "workspace"), versions);
  assert.equal((await recovered.version(reader, "workspace", published.head.graphRevisionId)).graph.digest, f.graph.digest);
  const candidates = new SourceCandidateService(sources, new SourceMaterialRepository(sources), f.blobs), admission = new SourceAdmissionService(sources, candidates);
  const restarted = await serve(t, db, sources, admission), headers = { authorization: "Bearer isolated-reader-token" };
  assert.deepEqual((await (await fetch(`${restarted.root}/current`, { headers })).json()).publication, published.publication);
  assert.deepEqual((await (await fetch(`${restarted.root}/versions`, { headers })).json()).versions, versions);
  await sources.provision("workspace", { tenantId: "tenant", grants: [{ actorId: reader.actorId, role: "REVOKED" }] });
  await assert.rejects(recovered.current(reader, "workspace"), { status: 403 });
});

test("F003 final CAS cannot overwrite a concurrent canonical-head writer outside its Workspace lock", { skip: !process.env.F001_TEST_PG_BIN, timeout: 60000 }, async t => {
  const cluster = await isolatedPostgres(t);
  const f = await isolatedPublicationPorts(t, { database: async () => cluster.createDatabase() });
  await f.service.publish(owner, "workspace", f.run.id, { operationId: "initial", expectedGraphDigest: f.graph.digest, expectedHeadVersion: 0 });
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.backup.ready = async () => { entered.resolve(); await release.promise; };
  const publishing = f.service.publish(owner, "workspace", f.run.id, { operationId: "must-lose-cas", expectedGraphDigest: f.graph.digest, expectedHeadVersion: 1 });
  const rejected = assert.rejects(publishing, { code: "F003_HEAD_CONFLICT" });
  await entered.promise;
  // Stand in only for another already-authorized canonical-head writer's row
  // update, which does not acquire F001's Workspace lock. This is a CAS race
  // mechanism test, not a second publication or recovery acceptance claim.
  await f.db.query("UPDATE current_graph_head SET version=version+1 WHERE project_id='workspace'");
  release.resolve(); await rejected;
  assert.equal((await f.service.versions(owner, "workspace")).length, 1);
  assert.equal((await f.service.current(owner, "workspace")).head.version, 2);
});
