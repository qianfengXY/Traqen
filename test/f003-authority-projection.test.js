import assert from "node:assert/strict";
import test from "node:test";
import { authorityFixture } from "./support/f003-authority-fixture.js";
import { completeInput } from "./fixtures.js";
import { createExecutionEvidenceBundle, signExecutionEvidenceBundle } from "../src/domain/index.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { SourceBackupService } from "../src/source-truth/backup-service.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { F003PublicationService } from "../src/business-knowledge/publication-service.js";
import { F003AuthorityService } from "../src/business-knowledge/authority-service.js";
import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { MemoryTraceabilityStore } from "../src/storage/memory-traceability-store.js";
import { recoverSourceFixtureIdentity } from "./support/source-truth-recovery-identity.js";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const actor = { actorId: "owner", tenantId: "tenant" };
const routeFor = f => `${f.root}/versions/${f.published.publication.graphRevisionId}/authority-bindings`;
async function bind(f, overrides = {}) {
  const response = await fetch(routeFor(f), { method: "POST", headers: f.headers, body: JSON.stringify({ ...f.bindingRequest, ...overrides }) });
  return { status: response.status, body: await response.json() };
}
async function project(f) {
  const response = await fetch(`${routeFor(f)}?objectKey=${f.bindingRequest.objectKey}`, { headers: f.headers });
  assert.equal(response.status, 200, await response.clone().text()); return response.json();
}
async function executionFixture(f) {
  const snapshot = await f.application.registerSnapshot("workspace", completeInput().snapshotManifest);
  await f.application.appendTestSpecDraft("workspace", { id: "test-cancel", version: 1, name: "取消规则的隔离摄取机制", risk: "LOW", approved: false,
    featureId: f.claim.featureId, verifiesClaims: [{ id: f.claim.id, version: f.claim.version }], environment: { target: "sit", operationLevel: "SAFE_READ" },
    steps: [{ id: "read", executor: "HTTP", method: "GET", path: "/isolated-order" }],
    assertions: [{ id: "rule-check", type: "HTTP_STATUS", stepId: "read", expected: 200 }], cleanup: null, policy: { approvalRequired: true } });
  const spec = await f.application.approveTestSpec("workspace", "test-cancel", { expectedVersion: 1, rationale: "isolated mechanism only" });
  const ref = { testSpecId: spec.id, testSpecVersion: spec.version, snapshotManifestId: snapshot.id, deploymentId: snapshot.components.deployment.id };
  async function ingest(id, status, { signature = true } = {}) {
    const execution = { id, ...ref, runner: { id: "isolated-runner", version: "1" }, completionReason: "COMPLETED",
      startedAt: "2026-10-23T06:00:00.000Z", finishedAt: "2026-10-23T06:01:00.000Z", attempts: [{ number: 1,
        startedAt: "2026-10-23T06:00:00.000Z", finishedAt: "2026-10-23T06:01:00.000Z", phaseStatus: status,
        stepResults: [{ id: "read", status }], assertionResults: [{ id: "rule-check", status, actual: status === "PASS" ? 200 : 500 }], cleanup: { status: "SKIPPED" } }] };
    const normalized = createExecutionEvidenceBundle({ execution, evidence: [{ id: `evidence-${id}`, type: "ASSERTION", freshness: "FRESH", manifest: {
      executionId: id, testSpecId: spec.id, testSpecVersion: spec.version, snapshotManifestId: snapshot.id, deploymentId: ref.deploymentId,
      runnerId: "isolated-runner", runnerVersion: "1", snapshotComponents: Object.fromEntries(Object.entries(snapshot.components).map(([key, value]) => [key, { id: value.id, digest: value.digest }])),
      assertionResults: execution.attempts[0].assertionResults, redactions: [] } }] }, f.clock);
    return f.application.ingestExecutionEvidence("workspace", signature ? signExecutionEvidenceBundle("workspace", normalized, "isolated-test-runner-secret") : normalized);
  }
  return { ref, ingest };
}

test("F003 HTTP explicitly binds an authority version without changing the analysis graph and reads independent human decisions", async t => {
  const f = await authorityFixture(t);
  const route = `${f.root}/versions/${f.published.publication.graphRevisionId}/authority-bindings`;
  const response = await fetch(route, { method: "POST", headers: f.headers, body: JSON.stringify(f.bindingRequest) });
  assert.equal(response.status, 201, await response.text());
  const first = await (await fetch(`${route}?objectKey=${f.bindingRequest.objectKey}`, { headers: f.headers })).json();
  assert.equal(first.projection.targets[0].authority.status, "UNREVIEWED", "an explicit mapping is not human confirmation");
  await f.decide("CONFIRMED", "2026-10-23T09:00:00Z");
  const current = await (await fetch(`${route}?objectKey=${f.bindingRequest.objectKey}`, { headers: f.headers })).json();
  assert.equal(current.projection.targets[0].authority.status, "CONFIRMED");
  assert.equal(current.projection.targets[0].authority.history.length, 1);
  assert.equal(current.projection.analysisState, "ANALYSIS_ACCEPTED");
  assert.deepEqual(await f.investigations.graph({ actorId: "owner", tenantId: "tenant" }, "workspace", f.run.id), f.graph);
  assert.equal((await f.runtime.services.publications.current({ actorId: "owner", tenantId: "tenant" }, "workspace")).head.version, 1);
});

test("F003 expiry is a pure independent projection: the same material, analysis digest, head and decision history do not change", async t => {
  const f = await authorityFixture(t); assert.equal((await bind(f)).status, 201);
  await f.decide("CONFIRMED", "2026-10-23T09:00:00Z");
  assert.equal((await project(f)).projection.targets[0].authority.status, "CONFIRMED");
  const before = await f.db.query("SELECT (SELECT count(*) FROM f003_authority_binding_set) AS bindings,(SELECT count(*) FROM human_decision) AS decisions,(SELECT count(*) FROM source_truth_event) AS events");
  const head = await f.runtime.services.publications.current(actor, "workspace");
  f.setTime("2026-10-23T10:00:00Z");
  const expired = (await project(f)).projection.targets[0].authority;
  assert.equal(expired.status, "DEPRECATED"); assert.equal(expired.applies, false); assert.equal(expired.history.length, 1);
  assert.equal(expired.latestDecision.type, "CONFIRMED");
  assert.deepEqual(await f.db.query("SELECT (SELECT count(*) FROM f003_authority_binding_set) AS bindings,(SELECT count(*) FROM human_decision) AS decisions,(SELECT count(*) FROM source_truth_event) AS events"), before);
  assert.deepEqual(await f.investigations.graph(actor, "workspace", f.run.id), f.graph);
  assert.deepEqual(await f.runtime.services.publications.current(actor, "workspace"), head);
});

test("F003 consumes only attested execution for the selected TestSpec/version/environment, and later FAIL cannot be hidden by an old PASS", async t => {
  const f = await authorityFixture(t), x = await executionFixture(f);
  const targets = structuredClone(f.bindingRequest.targets); targets[0].verificationTargets = [x.ref];
  for (const override of [{ testSpecVersion: 1 }, { snapshotManifestId: "foreign-snapshot" }, { deploymentId: "foreign-deployment" }]) {
    const wrong = structuredClone(targets); wrong[0].verificationTargets = [{ ...x.ref, ...override }];
    assert.equal((await bind(f, { targets: wrong })).body.error.code, "F003_EXECUTION_TARGET_MISMATCH");
  }
  assert.equal((await bind(f, { targets })).status, 201);
  assert.equal((await project(f)).projection.targets[0].verification[0].status, "NOT_RUN");
  await assert.rejects(x.ingest("unsigned", "PASS", { signature: false }), /attestation/i);
  assert.equal((await project(f)).projection.targets[0].verification[0].status, "NOT_RUN");
  await f.decide("CONFIRMED");
  await x.ingest("pass", "PASS");
  const passed = (await project(f)).projection.targets[0];
  assert.equal(passed.verification[0].status, "PASS");
  await x.ingest("fail", "FAIL");
  const failed = (await project(f)).projection.targets[0];
  assert.equal(failed.verification[0].status, "FAIL");
  assert.deepEqual(failed.verification[0].history.map(e => e.status), ["FAIL", "PASS"]);
  assert.equal(failed.authority.status, "CONFIRMED"); assert.equal(failed.authority.history.length, 1);
  assert.deepEqual(await f.investigations.graph(actor, "workspace", f.run.id), f.graph);
  f.runtime.services.authorityBindings.verifyExecution = null;
  assert.equal((await project(f)).projection.targets[0].verification[0].status, "UNKNOWN");
});

test("F003 mapping revisions stay immutable and explicitly historical; a superseded binding cannot leak to another graph/version", async t => {
  const f = await authorityFixture(t);
  assert.equal((await bind(f)).status, 201);
  assert.equal((await bind(f, { operationId: "clear-binding", expectedVersion: 1, targets: [] })).status, 201);
  assert.equal((await project(f)).projection.targets.length, 0);
  const historical = await (await fetch(`${routeFor(f)}?objectKey=${f.bindingRequest.objectKey}&bindingVersion=1`, { headers: f.headers })).json();
  assert.equal(historical.bindingSet.version, 1); assert.equal(historical.currentBindingVersion, 2);
  assert.equal(historical.projection.targets[0].claimVersion, 1);
  const foreign = await fetch(routeFor(f).replace('/workspaces/workspace/', '/workspaces/workspace2/'), { method: 'POST', headers: f.headers, body: JSON.stringify(f.bindingRequest) });
  assert.equal(foreign.status, 403);
  const unknownGraph = await fetch(routeFor(f).replace(f.published.publication.graphRevisionId, "F003-REVISION-unpublished"), { method: 'POST', headers: f.headers, body: JSON.stringify(f.bindingRequest) });
  assert.equal(unknownGraph.status, 404);
  await assert.rejects(f.db.query("DELETE FROM f003_authority_binding_set"), /append-only/);
});

test("F003 explicitly maps directed relations, retains human rejection history and never inherits a mapping into another published revision", async t => {
  const f = await authorityFixture(t, { includeRelation: true }), relation = f.graph.relations[0];
  assert.equal(relation.state, "ANALYSIS_ACCEPTED");
  assert.equal((await bind(f, { objectKey: relation.key })).status, 201);
  await f.decide("CONFIRMED"); await f.decide("REJECTED");
  const oldId = f.published.publication.graphRevisionId, pubs = f.runtime.services.publications;
  const previous = await f.runtime.services.authorityBindings.project(actor, "workspace", oldId, relation.key);
  assert.equal(previous.projection.targets[0].authority.status, "REJECTED");
  assert.equal(previous.projection.targets[0].authority.applies, false);
  assert.deepEqual(previous.projection.targets[0].authority.history.map(d => d.type), ["CONFIRMED", "REJECTED"]);
  assert.ok(previous.projection.targets[0].authority.history.every(d => d.actorId === "reader" && d.actorRole === "business-owner"));
  const next = await pubs.publish(actor, "workspace", f.run.id, {
    operationId: "explicit-next-revision", expectedGraphDigest: f.graph.digest, expectedHeadVersion: 1 });
  assert.notEqual(next.publication.graphRevisionId, oldId);
  const newView = await f.runtime.services.authorityBindings.project(actor, "workspace", next.publication.graphRevisionId, relation.key);
  assert.equal(newView.bindingSet, null, "even the same digest/key does not inherit another revision's human mapping");
  assert.equal(newView.currentBindingVersion, 0); assert.deepEqual(newView.projection.targets, []);
  assert.deepEqual(await f.runtime.services.authorityBindings.project(actor, "workspace", oldId, relation.key), previous);
  assert.deepEqual(await f.investigations.graph(actor, "workspace", f.run.id), f.graph);
  assert.equal((await pubs.current(actor, "workspace")).head.graphRevisionId, next.publication.graphRevisionId);
});

test("F003 binding CAS, idempotency, explicit versions, scopes and Workspace/backup/current-permission boundaries cannot be forged", async t => {
  const f = await authorityFixture(t), target = f.bindingRequest.targets[0];
  for (const [label, overrides] of [["digest", { expectedGraphDigest: "f".repeat(64) }], ["object", { objectKey: "same-name-is-not-a-key" }],
    ["claim-version", { targets: [{ ...target, claimVersion: 2 }] }], ["scope-version", { targets: [{ ...target, scopeVersion: 2 }] }],
    ["feature", { targets: [{ ...target, featureId: "foreign-feature" }] }], ["actor", { actorId: "reader" }], ["authority", { approved: true }]]) {
    const result = await bind(f, overrides); assert.ok(result.status >= 400, `${label}: ${JSON.stringify(result.body)}`);
  }
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=true WHERE workspace_id='workspace'");
  assert.equal((await bind(f)).body.error.code, "F003_BACKUP_BARRIER");
  assert.equal((await project(f)).bindingSet, null);
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=false WHERE workspace_id='workspace'");
  const concurrent = await Promise.all([bind(f), bind(f, { operationId: "concurrent" })]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
  const winner = concurrent.find(r => r.status === 201), operationId = concurrent[0].status === 201 ? "bind-1" : "concurrent";
  const replay = await bind(f, { operationId });
  assert.equal(replay.body.replayed, true); assert.deepEqual(replay.body.bindingSet, winner.body.bindingSet);
  assert.equal((await bind(f, { operationId, rationale: "different request" })).body.error.code, "F003_OPERATION_CONFLICT");
  await f.application.appendClaim("workspace", { ...f.claim, version: 2, statement: "新版规则必须重新映射" });
  assert.equal((await project(f)).projection.targets[0].authority.versionCurrent, false);
  assert.equal((await bind(f, { operationId: "stale-claim", expectedVersion: 1 })).body.error.code, "F003_AUTHORITY_VERSION_CONFLICT");
  await f.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "REVOKED" }] });
  assert.equal((await bind(f, { operationId })).status, 403);
  const count = await f.db.query("SELECT count(*)::int AS n FROM f003_authority_binding_set"); assert.equal(count.rows[0].n, 1);
});

test("F003 actual native restart and paired database/material archive preserve authority mappings, decisions, execution references and audit offline", { skip: !process.env.F001_TEST_PG_BIN, timeout: 120000 }, async t => {
  const cluster = await isolatedPostgres(t); let databaseName;
  const f = await authorityFixture(t, { database: async () => { const d = await cluster.createDatabase(); databaseName = d.name; return d; } });
  const x = await executionFixture(f), targets = structuredClone(f.bindingRequest.targets); targets[0].verificationTargets = [x.ref];
  assert.equal((await bind(f, { targets })).status, 201);
  await f.decide("EXCEPTION_RECORDED", "2026-10-23T09:00:00Z");
  await x.ingest("before-restart-pass", "PASS");
  const before = await project(f), revisionId = f.published.publication.graphRevisionId, objectKey = f.bindingRequest.objectKey;
  const audit = (await f.db.query("SELECT event_type,payload FROM source_truth_event WHERE event_type='F003_AUTHORITY_BOUND' ORDER BY sequence")).rows;
  const approvals = (await f.db.query("SELECT event_payload FROM decision_review_event WHERE project_id='workspace' ORDER BY append_sequence")).rows;
  assert.equal(approvals.length, 1);
  await f.closeHttp();
  await cluster.restart();
  const db = cluster.pool(databaseName), sources = new SourceTruthRepository(db);
  const publications = new F003PublicationService({ sources });
  const verifier = new TraceabilityApplication({ store: new MemoryTraceabilityStore(),
    runnerKeyResolver: id => id === "isolated-runner" ? "isolated-test-runner-secret" : null }).createBusinessKnowledgeExecutionVerifier();
  const authority = new F003AuthorityService({ sources, publications, verifyExecution: verifier, clock: f.clock });
  const restarted = await authority.project(actor, "workspace", revisionId, objectKey);
  assert.deepEqual(restarted.projection, before.projection);
  assert.deepEqual((await db.query("SELECT event_payload FROM decision_review_event WHERE project_id='workspace' ORDER BY append_sequence")).rows, approvals);
  assert.equal((await publications.current(actor, "workspace")).graph.digest, f.graph.digest);
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "traqen-f003-authority-paired-")));
  // Actual pg_dump + encrypted material catalogue + new empty-database restore.
  // This volume probe is SYNTHETIC: it does not attest physical protection.
  const configuration = { targetId: "authority-paired-mechanism", root, maxBytes: "536870912",
    postgres: { binDirectory: cluster.bin, connection: cluster.connection(databaseName) },
    keyRecoveryOwner: "fixture-only", recoveryKeys: Object.fromEntries(f.blobs.keys),
    volumeProbe: async p => ({ encrypted: true, permissionsEnforced: true, persistent: true, filesystemId: p.startsWith(root) ? "test-backup" : "test-main",
      physicalStores: [p.startsWith(root) ? "SYNTHETIC-B" : "SYNTHETIC-A"] }) };
  const backup = new SourceBackupService({ repository: sources, blobs: f.blobs, configuration });
  const completed = await backup.create({ requestedBy: "fixture-only" });
  const destination = await cluster.createDatabase({ seed: false });
  const restoredBlobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "traqen-f003-authority-restored-")),
    keyVersion: "test", keys: Object.fromEntries(f.blobs.keys) });
  await backup.restore({ backupId: completed.id, database: destination.db, blobs: restoredBlobs,
    postgres: { binDirectory: cluster.bin, connection: cluster.connection(destination.name) }, requestedBy: "fixture-only" });
  const recoveredSources = new SourceTruthRepository(destination.db), recoveredPublications = new F003PublicationService({ sources: recoveredSources });
  const recoveredAuthority = new F003AuthorityService({ sources: recoveredSources, publications: recoveredPublications, verifyExecution: verifier, clock: f.clock });
  await assert.rejects(recoveredAuthority.project(actor, "workspace", revisionId, objectKey), { status: 403 });
  await recoverSourceFixtureIdentity(destination.db);
  const restored = await recoveredAuthority.project(actor, "workspace", revisionId, objectKey);
  assert.deepEqual(restored, restarted);
  assert.deepEqual((await destination.db.query("SELECT event_type,payload FROM source_truth_event WHERE event_type='F003_AUTHORITY_BOUND' ORDER BY sequence")).rows, audit);
  assert.deepEqual((await destination.db.query("SELECT event_payload FROM decision_review_event WHERE project_id='workspace' ORDER BY append_sequence")).rows, approvals);
  assert.equal((await recoveredPublications.current(actor, "workspace")).graph.digest, f.graph.digest);
  assert.equal(restored.projection.targets[0].authority.status, "EXCEPTION_RECORDED");
  assert.equal(restored.projection.targets[0].verification[0].status, "PASS");
  console.log(JSON.stringify({ kind: "ISOLATED_AUTHORITY_PAIRED_RESTORE_MECHANISM_ONLY", graphDigest: f.graph.digest, bindingId: restored.bindingSet.id,
    backupId: completed.id, modelCalls: 0, realQuality: false, realPhysicalProtection: false }));
});
