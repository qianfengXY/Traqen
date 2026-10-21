import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { F002AdmissionService } from "../src/deterministic-facts/admission.js";
import { canonicalDigest, createMaterialId } from "../src/deterministic-facts/identity.js";
import { F002MaterialService } from "../src/deterministic-facts/material-service.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { F002QueryService } from "../src/deterministic-facts/queries.js";
import { F002ReplayService } from "../src/deterministic-facts/replay-service.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { F002Worker } from "../src/deterministic-facts/worker.js";
import { SourceBackupService } from "../src/source-truth/backup-service.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { sourceTruthServices } from "../src/source-truth/services.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { recoverSourceFixtureIdentity } from "./support/source-truth-recovery-identity.js";

function compose(db, blobs) {
  const sources = sourceTruthServices({ repository: new SourceTruthRepository(db), blobs, policy: { id: "policy-v1" } });
  const repository = new F002Repository(db, { authorize: (actor, workspaceId, tx, maintain) => sources.repository.authorize(actor, workspaceId, maintain, tx) });
  const admission = new F002AdmissionService(repository, sources.admission);
  return { sources, repository, admission, worker: new F002Worker(repository, { admission }),
    publication: new F002PublicationService(repository), materials: new F002MaterialService(repository, admission),
    queries: new F002QueryService(repository, { cursorSecret: "owned-recovery-cursor-secret" }),
    replays: new F002ReplayService(repository, { admission }) };
}

// Requires an explicitly selected, already installed native PG distribution.
// Each run uses a fresh private UNIX socket and owned data directory, not an
// existing service, DATABASE_URL, .env or TCP port. Inputs are synthetic only.
test("F002 native PostgreSQL crash, generation fence, exact publication and paired recovery", { skip: !process.env.F001_TEST_PG_BIN, timeout: 120_000 }, async t => {
  const cluster = await isolatedPostgres(t);
  assert.equal(typeof cluster.crash, "function", "the native fixture must support immediate owned-server loss, not only graceful restart");
  const database = await cluster.createDatabase();
  const fixture = await candidateFixture(t, { database: () => database, entryPath: "src/Caller.java", directoryPaths: ["src"],
    content: "package client;\r\nimport library.Helper;\r\npublic class Caller {\r\n String run(){return Helper.read();}\r\n}\r\n",
    additionalFiles: [{ entryPath: "src/Helper.java", content: "package library;\r\npublic class Helper {\r\n public static String read(){return \"😀\";}\r\n}\r\n" }] });
  const candidate = await fixture.candidates.prepare(fixture.context);
  await fixture.advance("RECONCILING", "REVIEW_REQUIRED");
  const sourcePublisher = compose(database.db, fixture.blobs).sources.publication;
  const confirmation = await sourcePublisher.confirm(owner, fixture.context, { candidateId: candidate.id, gapSetId: candidate.gapSetId });
  const frozen = await sourcePublisher.seal(owner, fixture.context, { confirmationId: confirmation.id, clientToken: "owned-recovery-source" });
  const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id }, componentId = frozen.bundle.components[0].id;
  const profile = structuredF002Profile();
  let db = database.db, services = compose(db, fixture.blobs);
  await services.repository.registerProfile(profile);
  const runInput = { operationId: "owned-recovery-run", reference, profile, scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] };
  const run = await services.admission.start(owner, "workspace", runInput), scopeId = run.scopes[0].scopeId;
  const callerId = createMaterialId({ workspaceId: "workspace", bundleId: reference.bundleId, componentId, pathBytes: fixture.entry.pathBytes });
  let ready, sealed, manifest, recordsDigest;
  const reconnect = () => { db = cluster.pool(database.name); services = compose(db, fixture.blobs); };
  const records = () => db.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 ORDER BY kind,id", ["workspace", sealed.graphVersionId]);

  await t.test("independent backends serialize claims; crash leaves the denominator and rejects the stale generation", async () => {
    const clients = await Promise.all([db.connect(), db.connect()]);
    try {
      const pids = await Promise.all(clients.map(c => c.query("SELECT pg_backend_pid() AS id,inet_server_addr() AS address")));
      assert.notEqual(pids[0].rows[0].id, pids[1].rows[0].id);
      assert.equal(pids[0].rows[0].address, null, "no TCP server is in use");
    } finally { clients.forEach(c => c.release()); }
    const claims = await Promise.allSettled(["left", "right"].map(workerId => services.repository.claimScope(owner, "workspace", run.id, scopeId, { workerId, leaseMs: 60_000 })));
    assert.equal(claims.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(claims.find(r => r.status === "rejected").reason.code, "F002_SCOPE_LEASE_BUSY");
    const prior = claims.find(r => r.status === "fulfilled").value;
    await services.repository.recordScopeItems(owner, { workspaceId: "workspace", runId: run.id, scopeId, generation: prior.generation,
      items: [{ materialId: callerId, capabilityId: "java", status: "PENDING" }] });
    await cluster.crash(); await cluster.restart(); reconnect();
    assert.deepEqual((await db.query("SELECT status FROM f002_scope_item WHERE run_id=$1", [run.id])).rows, [{ status: "PENDING" }]);
    assert.equal((await services.repository.getScope(owner, "workspace", run.id, scopeId)).generation, prior.generation);
    // Advance only the owned fixture's persisted lease; no wall-clock sleep or
    // alteration of a production authorization clock is involved.
    await db.query("UPDATE f002_scope SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1", [run.id]);
    const next = await services.repository.claimScope(owner, "workspace", run.id, scopeId, { workerId: "recovered", leaseMs: 60_000 });
    assert.equal(next.generation, prior.generation + 1);
    await assert.rejects(services.repository.recordScopeItems(owner, { workspaceId: "workspace", runId: run.id, scopeId, generation: prior.generation,
      items: [{ materialId: callerId, capabilityId: "java", status: "DONE" }] }), { code: "F002_STALE_SCOPE_WORKER" });
    await db.query("UPDATE f002_scope SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1", [run.id]);
    ready = await services.worker.run(owner, "workspace", run.id, scopeId, { workerId: "real-recovery-parser", leaseMs: 60_000, timeoutMs: 20_000 });
    assert.equal(ready.status, "READY_TO_SEAL");
  });

  await t.test("loss before seal commit rolls back every published row; concurrent retry commits one fixed version", async () => {
    let entered, release;
    const barrier = new Promise(r => { entered = r; }), held = new Promise(r => { release = r; });
    const maintained = services.repository.withMaintainedWorkspace.bind(services.repository);
    services.repository.withMaintainedWorkspace = (actor, workspace, work) => maintained(actor, workspace, async tx => {
      const result = await work(tx); entered(); await held; return result;
    });
    const publishing = services.publication.publish(owner, "workspace", run.id, scopeId, { revision: ready.revision, operationId: "owned-seal" });
    const rejected = assert.rejects(publishing, /connection|terminat|shutdown/i);
    await barrier;
    try {
      // Observe visibility on a distinct connection without taking the same
      // authorization lock that the intentionally suspended seal now holds.
      assert.equal((await db.query("SELECT count(*)::int AS n FROM f002_fact_set")).rows[0].n, 0);
      assert.equal((await db.query("SELECT status FROM f002_scope WHERE run_id=$1 AND scope_id=$2", [run.id, scopeId])).rows[0].status, "READY_TO_SEAL");
      await cluster.crash();
    } finally { release(); }
    await rejected; await cluster.restart(); reconnect();
    assert.equal((await db.query("SELECT count(*)::int AS n FROM f002_fact_set")).rows[0].n, 0);
    assert.equal((await services.repository.getScope(owner, "workspace", run.id, scopeId)).status, "READY_TO_SEAL");
    const results = await Promise.all([1, 2].map(() => services.publication.publish(owner, "workspace", run.id, scopeId, { revision: ready.revision, operationId: "owned-seal" })));
    assert.equal(results[0].graphVersionId, results[1].graphVersionId); sealed = results[0];
    assert.equal((await db.query("SELECT count(*)::int AS n FROM f002_fact_set")).rows[0].n, 1);
    manifest = await services.queries.manifest(reader, "workspace", sealed.graphVersionId);
    recordsDigest = canonicalDigest("RECOVERY_RECORDS", { records: (await records()).rows });
  });

  await t.test("loss after commit preserves operation, publication binding, exact records and both admitted source hashes", async () => {
    await cluster.crash(); await cluster.restart(); reconnect();
    assert.deepEqual(await services.admission.start(owner, "workspace", runInput), await services.repository.getRun(owner, "workspace", run.id));
    assert.deepEqual((await services.repository.getRun(owner, "workspace", run.id)).sourceInput, run.sourceInput);
    assert.equal((await services.publication.publish(owner, "workspace", run.id, scopeId, { revision: ready.revision, operationId: "owned-seal" })).graphVersionId, sealed.graphVersionId);
    assert.deepEqual(await services.queries.manifest(reader, "workspace", sealed.graphVersionId), manifest);
    assert.equal(canonicalDigest("RECOVERY_RECORDS", { records: (await records()).rows }), recordsDigest);
    const materialRows = (await records()).rows.filter(r => r.kind === "MATERIAL" && r.payload.contentDigest);
    assert.equal(materialRows.length, 2);
    for (const row of materialRows) {
      const read = await services.materials.read(reader, "workspace", sealed.graphVersionId, row.id);
      assert.equal(read.originalDigest, row.payload.contentDigest);
    }
    const pending = await services.replays.submit(owner, "workspace", sealed.graphVersionId, { operationId: "owned-pending-replay" });
    await cluster.crash(); await cluster.restart(); reconnect();
    assert.equal((await services.replays.submit(owner, "workspace", sealed.graphVersionId, { operationId: pending.operationId })).id, pending.id);
    assert.equal((await services.replays.execute(owner, "workspace", pending.id, { workerId: "recovered-replay" })).status, "MATCH");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM f002_event WHERE event_type='READ_COMPLETED'")).rows[0].n, 2);
  });

  await t.test("F001 paired archive includes F002 immutable history and excludes later work; restored bytes suffice without the original store", async () => {
    const backupRoot = await realpath(await mkdtemp(path.join(tmpdir(), "tq-f002-paired-backup-")));
    // This is a test double for volume protection/fault-domain checks, never
    // proof of independent physical backup media or production readiness.
    const volumeProbe = async location => ({ encrypted: true, permissionsEnforced: true, persistent: true,
      filesystemId: location.startsWith(backupRoot) ? "synthetic-backup" : "synthetic-source",
      physicalStores: [location.startsWith(backupRoot) ? "synthetic-b" : "synthetic-a"] });
    const configuration = { targetId: "owned-f002-backup", root: backupRoot, maxBytes: "536870912", volumeProbe,
      postgres: { binDirectory: cluster.bin, connection: cluster.connection(database.name) },
      keyRecoveryOwner: "synthetic-fixture-only", recoveryKeys: Object.fromEntries(fixture.blobs.keys) };
    const backup = new SourceBackupService({ repository: services.sources.repository, blobs: fixture.blobs, configuration });
    const completed = await backup.create({ requestedBy: "owned-fixture" });
    const oldProfile = standardF002Profile(); await services.repository.registerProfile(oldProfile);
    const later = await services.admission.start(owner, "workspace", { ...runInput, operationId: "after-backup-run", profile: oldProfile });
    const laterReady = await services.worker.run(owner, "workspace", later.id, later.scopes[0].scopeId, { workerId: "after-backup", leaseMs: 60_000, timeoutMs: 20_000 });
    const laterSealed = await services.publication.publish(owner, "workspace", later.id, later.scopes[0].scopeId, { revision: laterReady.revision, operationId: "after-backup-seal" });
    assert.notEqual(laterSealed.graphVersionId, sealed.graphVersionId);
    const destination = await cluster.createDatabase({ seed: false });
    const targetBlobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "tq-f002-restored-bytes-")), keyVersion: "test", keys: configuration.recoveryKeys });
    const recovery = new SourceBackupService({ configuration: { ...configuration, postgres: undefined, keyVersion: "test" } });
    await recovery.restore({ backupId: completed.id, database: destination.db, blobs: targetBlobs,
      postgres: { binDirectory: cluster.bin, connection: cluster.connection(destination.name) }, requestedBy: "owned-fixture" });
    const restored = compose(destination.db, targetBlobs); // no original blob store reference
    await assert.rejects(restored.queries.versions(reader, "workspace"), { code: "SOURCE_FORBIDDEN" }, "F008 closes restored legacy identity before explicit recovery");
    const recoveredIdentity = await recoverSourceFixtureIdentity(destination.db);
    assert.deepEqual((await restored.queries.versions(reader, "workspace")).map(v => v.graphVersionId), [sealed.graphVersionId]);
    await assert.rejects(restored.queries.manifest(reader, "workspace", laterSealed.graphVersionId), { code: "F002_VERSION_NOT_FOUND" });
    assert.deepEqual(await restored.queries.manifest(reader, "workspace", sealed.graphVersionId), manifest);
    assert.deepEqual((await restored.repository.getRun(owner, "workspace", run.id)).sourceInput, run.sourceInput);
    const recoveredRecords = (await destination.db.query("SELECT kind,id,payload FROM f002_record WHERE graph_version_id=$1 ORDER BY kind,id", [sealed.graphVersionId])).rows;
    assert.equal(canonicalDigest("RECOVERY_RECORDS", { records: recoveredRecords }), recordsDigest);
    for (const row of recoveredRecords.filter(r => r.kind === "MATERIAL" && r.payload.contentDigest)) {
      assert.equal((await restored.materials.read(reader, "workspace", sealed.graphVersionId, row.id)).originalDigest, row.payload.contentDigest);
    }
    assert.equal((await restored.replays.replay(owner, "workspace", sealed.graphVersionId)).status, "MATCH");
    await assert.rejects(destination.db.query("DELETE FROM f002_record"), /append-only|immutable/i);
    await recoveredIdentity.identity.grant(recoveredIdentity.session.token, "workspace", { accountId: recoveredIdentity.readerAccountId, roles: [] });
    await assert.rejects(restored.materials.read(reader, "workspace", sealed.graphVersionId, callerId), { code: "SOURCE_FORBIDDEN" });

    const failedDestination = await cluster.createDatabase({ seed: false });
    const failedBlobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "tq-f002-failed-restore-")), keyVersion: "test", keys: configuration.recoveryKeys });
    t.mock.method(failedBlobs, "put", async () => { throw new Error("owned byte restore failure"); });
    await assert.rejects(recovery.restore({ backupId: completed.id, database: failedDestination.db, blobs: failedBlobs,
      postgres: { binDirectory: cluster.bin, connection: cluster.connection(failedDestination.name) }, requestedBy: "owned-fixture" }), /owned byte restore failure/);
    assert.equal((await failedDestination.db.query("SELECT restore_ready FROM source_truth_workspace WHERE workspace_id='workspace'")).rows[0].restore_ready, false);
    const failed = compose(failedDestination.db, failedBlobs);
    await assert.rejects(failed.queries.manifest(reader, "workspace", sealed.graphVersionId), { code: "SOURCE_FORBIDDEN", status: 403 });
    await assert.rejects(failed.admission.start(owner, "workspace", runInput), { code: "SOURCE_FORBIDDEN", status: 403 });
    await assert.rejects(recoverSourceFixtureIdentity(failedDestination.db), { code: "AUTH_SOURCE_RESTORE_UNVERIFIED" }, "neither identity nor source recovery can be forced open after a byte restore failure");
  });
});
