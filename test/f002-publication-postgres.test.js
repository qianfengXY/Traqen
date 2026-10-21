import assert from "node:assert/strict";
import test from "node:test";

import { createProfileId } from "../src/deterministic-facts/identity.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { owner } from "./support/source-truth-database.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { verifiedF002Records } from "./support/f002-records.js";

const componentId = "a".repeat(64);
const bundleId = "b".repeat(64);
const sourceInput = { workspaceId: "workspace", bundleId, sourceBundleSnapshotId: bundleId, receiptId: "receipt-1", receiptStatus: "READY", confirmationId: "confirmation-1", acceptanceRecordIds: [], receiptValidUntil: null, qualifiedAt: "2026-09-17T00:00:00.000Z", inventoryId: "inventory-1", inventoryDigest: "inventory-1", policyRevisionId: "policy-v1", inheritedGapSet: { id: "gaps-1", count: "0", consumption: "ALL_PAGES_REQUIRED" } };
const profileInput = { version: "1", schemaVersion: 1, capabilityIds: ["javascript"], ruleVersions: ["javascript@1"], canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024, maxRecords: 10 }, redactionPolicyRevision: "policy-v1" };
const profile = { ...profileInput, id: createProfileId(profileInput), startable: true };

async function prepareReady(repository, publisher, run, scope) {
  const claimed = await repository.claimScope(owner, "workspace", run.id, scope.scopeId, { workerId: `worker-${scope.label}`, leaseMs: 60_000 });
  const verified = verifiedF002Records({ workspaceId: "workspace", bundleId, componentId, profile, path: `src/${scope.label}.js` });
  await publisher.prepare(owner, "workspace", run.id, scope.scopeId, {
    generation: claimed.generation, records: verified.records,
  });
  await repository.recordScopeItems(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation,
    items: [{ materialId: verified.materialId, capabilityId: "javascript", status: "DONE" }] });
  return { scope: await repository.readyToSeal(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation }), records: verified.records };
}

test("F002 real PostgreSQL serializes scope seals and preserves atomic recovery across restart", { skip: !process.env.F001_TEST_PG_BIN, timeout: 120000 }, async (t) => {
  const cluster = await isolatedPostgres(t);
  const initial = await cluster.createDatabase();
  let sources = initial.repository;
  let repository = new F002Repository(initial.db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  await repository.registerProfile(profile);
  const run = await repository.createAdmittedRun(owner, "workspace", { operationId: "real-pg-publication", sourceInput, profile, scopes: [
    { label: "A", selections: [{ kind: "COMPONENT", componentId }] },
    { label: "B", selections: [{ kind: "ENTRY", componentId, pathBytes: Buffer.from("src/b.js").toString("base64url") }] },
  ] });
  let publisher = new F002PublicationService(repository);
  const scopeA = run.scopes.find((scope) => scope.label === "A");
  const scopeB = run.scopes.find((scope) => scope.label === "B");
  assert.ok(scopeA); assert.ok(scopeB);
  const readyA = await prepareReady(repository, publisher, run, scopeA);
  const results = await Promise.all(["first", "second"].map(() => publisher.publish(owner, "workspace", run.id, scopeA.scopeId, { revision: readyA.scope.revision, operationId: "seal-a" })));
  assert.equal(results[0].graphVersionId, results[1].graphVersionId);
  assert.equal((await repository.getScope(owner, "workspace", run.id, scopeB.scopeId)).status, "QUEUED");

  await cluster.restart();
  const db = cluster.pool(initial.name);
  sources = new SourceTruthRepository(db);
  repository = new F002Repository(db, { authorize: (actor, workspaceId, tx) => sources.authorize(actor, workspaceId, false, tx) });
  publisher = new F002PublicationService(repository);

  const readyB = await prepareReady(repository, publisher, run, scopeB);
  await db.query(`CREATE FUNCTION f002_test_factset_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected f002 fact set failure'; END $$;
    CREATE TRIGGER f002_test_factset_failure BEFORE INSERT ON f002_fact_set FOR EACH ROW EXECUTE FUNCTION f002_test_factset_failure();`);
  await assert.rejects(publisher.publish(owner, "workspace", run.id, scopeB.scopeId, { revision: readyB.scope.revision, operationId: "seal-b" }), /injected f002 fact set failure/);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM f002_fact_set WHERE workspace_id=$1 AND run_id=$2 AND scope_id=$3", ["workspace", run.id, scopeB.scopeId])).rows[0].count, 0);
  assert.equal((await repository.getScope(owner, "workspace", run.id, scopeB.scopeId)).status, "READY_TO_SEAL");
  await db.query("DROP TRIGGER f002_test_factset_failure ON f002_fact_set");
  assert.equal((await publisher.publish(owner, "workspace", run.id, scopeB.scopeId, { revision: readyB.scope.revision, operationId: "seal-b" })).status, "SEALED");
});
