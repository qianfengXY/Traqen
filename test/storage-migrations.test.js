import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { evaluateTraceChain } from "../src/domain/index.js";
import { applyMigrations } from "../src/storage/postgres/migrations.js";
import { PostgresTraceabilityStore } from "../src/storage/postgres/postgres-traceability-store.js";
import { completeInput, fixedClock } from "./fixtures.js";

const migrationsDirectory = fileURLToPath(new URL("../db/migrations", import.meta.url));

async function migratedDatabase() {
  const database = await PGlite.create();
  const applied = await applyMigrations(database, migrationsDirectory);
  assert.deepEqual(applied, ["0001_core_traceability", "0002_governance_integrity"]);
  return database;
}

async function insertProjectFoundation(database) {
  await database.query("INSERT INTO organization (id, name) VALUES ($1, $2)", ["ORG-001", "Traqen"]);
  await database.query(
    "INSERT INTO tenant (id, organization_id, name) VALUES ($1, $2, $3)",
    ["TENANT-001", "ORG-001", "Default tenant"],
  );
  await database.query(
    "INSERT INTO principal (id, tenant_id, principal_type, display_name) VALUES ($1, $2, $3, $4)",
    ["USER-001", "TENANT-001", "USER", "Business owner"],
  );
  await database.query(
    "INSERT INTO project (id, tenant_id, name) VALUES ($1, $2, $3)",
    ["PROJECT-001", "TENANT-001", "Order service"],
  );
}

async function insertSnapshot(database) {
  const components = [
    ["SOURCE-001", "SOURCE", "sha256:source"],
    ["BUILD-001", "BUILD", "sha256:build"],
    ["DEPLOY-001", "DEPLOYMENT", "sha256:deployment"],
    ["RUNTIME-001", "RUNTIME", "sha256:runtime"],
  ];
  for (const [id, componentType, digest] of components) {
    await database.query(
      `INSERT INTO snapshot_component (project_id, id, component_type, digest)
       VALUES ($1, $2, $3, $4)`,
      ["PROJECT-001", id, componentType, digest],
    );
  }

  await database.query(
    `INSERT INTO snapshot_manifest (
       project_id, id, observed_from, observed_to, complete, content_hash
     ) VALUES ($1, $2, $3, $4, true, $5)`,
    [
      "PROJECT-001",
      "SNAPSHOT-MANIFEST-001",
      "2026-07-14T01:00:00.000Z",
      "2026-07-14T01:05:00.000Z",
      "sha256:manifest",
    ],
  );

  for (const [componentId, componentType] of components) {
    await database.query(
      `INSERT INTO snapshot_manifest_component (project_id, manifest_id, component_id, component_type)
       VALUES ($1, $2, $3, $4)`,
      ["PROJECT-001", "SNAPSHOT-MANIFEST-001", componentId, componentType],
    );
  }
}

async function insertTraceabilityChain(database) {
  await database.query("INSERT INTO feature (project_id, id) VALUES ($1, $2)", ["PROJECT-001", "FEATURE-001"]);
  await database.query(
    `INSERT INTO feature_version (project_id, feature_id, version, name)
     VALUES ($1, $2, 1, $3)`,
    ["PROJECT-001", "FEATURE-001", "Submit order"],
  );
  await database.query(
    `INSERT INTO claim_scope (project_id, id, version, scope)
     VALUES ($1, $2, 1, $3::jsonb)`,
    ["PROJECT-001", "SCOPE-001", JSON.stringify({ actor: "normal-user" })],
  );
  await database.query(
    `INSERT INTO claim (
       project_id, id, version, feature_id, claim_type, statement, source_type,
       evidence_support, scope_id, scope_version
     ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, 1)`,
    [
      "PROJECT-001",
      "CLAIM-001",
      "FEATURE-001",
      "NORMATIVE_REQUIREMENT",
      "A normal user may submit only a DRAFT order.",
      "HUMAN",
      "MULTI_SOURCE",
      "SCOPE-001",
    ],
  );
  await database.query(
    `INSERT INTO human_decision (
       project_id, id, claim_id, claim_version, scope_id, scope_version,
       decision_type, actor_id, actor_role
     ) VALUES ($1, $2, $3, 1, $4, 1, 'CONFIRMED', $5, 'business-owner')`,
    ["PROJECT-001", "DECISION-001", "CLAIM-001", "SCOPE-001", "USER-001"],
  );
  await database.query(
    `INSERT INTO implementation_conformance (
       project_id, id, claim_id, claim_version, scope_id, scope_version,
       snapshot_manifest_id, status
     ) VALUES ($1, $2, $3, 1, $4, 1, $5, 'CONFORMS')`,
    ["PROJECT-001", "CONFORMANCE-001", "CLAIM-001", "SCOPE-001", "SNAPSHOT-MANIFEST-001"],
  );
  await database.query(
    `INSERT INTO test_spec (project_id, id, version, name, approved, specification)
     VALUES ($1, $2, 1, $3, true, $4::jsonb)`,
    ["PROJECT-001", "TEST-001", "Draft order submission", JSON.stringify({ assertions: ["status"] })],
  );
  await database.query(
    `INSERT INTO test_spec_claim (project_id, test_spec_id, test_spec_version, claim_id, claim_version)
     VALUES ($1, $2, 1, $3, 1)`,
    ["PROJECT-001", "TEST-001", "CLAIM-001"],
  );
  await database.query(
    `INSERT INTO test_execution (
       project_id, id, test_spec_id, test_spec_version, snapshot_manifest_id,
       deployment_component_id, status, started_at, finished_at
     ) VALUES ($1, $2, $3, 1, $4, $5, 'PASS', $6, $7)`,
    [
      "PROJECT-001",
      "EXEC-001",
      "TEST-001",
      "SNAPSHOT-MANIFEST-001",
      "DEPLOY-001",
      "2026-07-14T01:10:00.000Z",
      "2026-07-14T01:11:00.000Z",
    ],
  );
  await database.query(
    `INSERT INTO evidence (
       project_id, id, execution_id, evidence_type, integrity_status,
       freshness_status, content_hash, manifest
     ) VALUES ($1, $2, $3, 'ASSERTION', 'VERIFIED', 'FRESH', $4, $5::jsonb)`,
    ["PROJECT-001", "EVIDENCE-001", "EXEC-001", "sha256:evidence", JSON.stringify({ signed: true })],
  );
  await database.query(
    `INSERT INTO trace_chain_revision (
       project_id, chain_id, revision, feature_id, claim_id, claim_version,
       scope_id, scope_version, snapshot_manifest_id, deployment_component_id,
       dimensions, stages, complete, computed_at
     ) VALUES ($1, $2, 1, $3, $4, 1, $5, 1, $6, $7, $8::jsonb, $9::jsonb, true, $10)`,
    [
      "PROJECT-001",
      "TRACE-CHAIN-001",
      "FEATURE-001",
      "CLAIM-001",
      "SCOPE-001",
      "SNAPSHOT-MANIFEST-001",
      "DEPLOY-001",
      JSON.stringify({ authority: "CONFIRMED", verification: "PASS" }),
      JSON.stringify([{ name: "BUSINESS_INTENT", status: "CONFIRMED" }]),
      "2026-07-14T01:12:00.000Z",
    ],
  );
}

async function insertClaimFoundation(database) {
  await database.query("INSERT INTO feature (project_id, id) VALUES ($1, $2)", ["PROJECT-001", "FEATURE-001"]);
  await database.query(
    `INSERT INTO feature_version (project_id, feature_id, version, name)
     VALUES ($1, $2, 1, $3)`,
    ["PROJECT-001", "FEATURE-001", "Submit order"],
  );
  await database.query(
    `INSERT INTO claim_scope (project_id, id, version, scope)
     VALUES ($1, $2, 1, $3::jsonb)`,
    ["PROJECT-001", "SCOPE-001", JSON.stringify({ actor: "normal-user" })],
  );
  await database.query(
    `INSERT INTO claim (
       project_id, id, version, feature_id, claim_type, statement, source_type,
       evidence_support, scope_id, scope_version
     ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, 1)`,
    [
      "PROJECT-001",
      "CLAIM-001",
      "FEATURE-001",
      "NORMATIVE_REQUIREMENT",
      "A normal user may submit only a DRAFT order.",
      "HUMAN",
      "MULTI_SOURCE",
      "SCOPE-001",
    ],
  );
}

test("core PostgreSQL migration applies once and exposes all required tables", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());

  const secondRun = await applyMigrations(database, migrationsDirectory);
  assert.deepEqual(secondRun, []);

  const result = await database.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const tables = new Set(result.rows.map((row) => row.table_name));

  for (const table of [
    "snapshot_manifest",
    "claim",
    "human_decision",
    "implementation_conformance",
    "test_spec",
    "test_execution",
    "evidence",
    "trace_chain_revision",
    "trace_gap",
    "audit_event",
  ]) {
    assert.ok(tables.has(table), `missing table: ${table}`);
  }
});

test("migration runner rejects an applied migration whose checksum changed", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await database.query(
    "UPDATE schema_migration SET checksum = 'tampered' WHERE id = '0001_core_traceability'",
  );

  await assert.rejects(applyMigrations(database, migrationsDirectory), /has changed/);
});

test("a complete traceability chain can be persisted and queried", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);
  await insertSnapshot(database);
  await insertTraceabilityChain(database);

  const result = await database.query(
    "SELECT chain_id, complete, dimensions FROM trace_chain_current WHERE project_id = $1",
    ["PROJECT-001"],
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].chain_id, "TRACE-CHAIN-001");
  assert.equal(result.rows[0].complete, true);
  assert.equal(result.rows[0].dimensions.verification, "PASS");
});

test("immutable evidence and decisions reject updates and deletes", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);
  await insertSnapshot(database);
  await insertTraceabilityChain(database);

  await assert.rejects(
    database.query(
      "UPDATE human_decision SET decision_type = 'REJECTED' WHERE project_id = $1 AND id = $2",
      ["PROJECT-001", "DECISION-001"],
    ),
    /append-only/,
  );
  await assert.rejects(
    database.query("DELETE FROM evidence WHERE project_id = $1 AND id = $2", ["PROJECT-001", "EVIDENCE-001"]),
    /append-only/,
  );
});

test("a complete manifest cannot contain failed sources", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);

  await assert.rejects(
    database.query(
      `INSERT INTO snapshot_manifest (
         project_id, id, observed_from, observed_to, complete, failed_sources, content_hash
       ) VALUES ($1, $2, $3, $4, true, $5::jsonb, $6)`,
      [
        "PROJECT-001",
        "SNAPSHOT-MANIFEST-BROKEN",
        "2026-07-14T01:00:00.000Z",
        "2026-07-14T01:05:00.000Z",
        JSON.stringify(["trace-collector"]),
        "sha256:broken",
      ],
    ),
    /check constraint/,
  );
});

test("PostgreSQL store appends immutable trace-chain revisions and returns the latest", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);
  await insertClaimFoundation(database);

  const store = new PostgresTraceabilityStore(database);
  const input = completeInput();
  await store.appendSnapshotManifest("PROJECT-001", input.snapshotManifest);

  const firstChain = evaluateTraceChain(input, fixedClock);
  const firstRevision = await store.appendTraceChainRevision("PROJECT-001", firstChain);
  assert.deepEqual(firstRevision, { chainId: firstChain.id, revision: 1 });

  input.execution.status = "FAIL";
  const secondChain = evaluateTraceChain(input, () => new Date("2026-07-14T02:01:00.000Z"));
  const secondRevision = await store.appendTraceChainRevision("PROJECT-001", secondChain);
  assert.deepEqual(secondRevision, { chainId: firstChain.id, revision: 2 });

  const current = await store.getCurrentTraceChain("PROJECT-001", firstChain.id);
  assert.equal(current.revision, 2);
  assert.equal(current.complete, false);
  assert.equal(current.dimensions.verification, "FAIL");
  assert.equal(current.gaps[0].type, "VERIFICATION_FAILED");

  const history = await database.query(
    `SELECT revision, complete
     FROM trace_chain_revision
     WHERE project_id = $1 AND chain_id = $2
     ORDER BY revision`,
    ["PROJECT-001", firstChain.id],
  );
  assert.deepEqual(history.rows, [
    { revision: 1, complete: true },
    { revision: 2, complete: false },
  ]);
});

test("PostgreSQL store is idempotent for identical manifests and rejects ID collisions", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);
  const store = new PostgresTraceabilityStore(database);
  const manifest = completeInput().snapshotManifest;

  assert.equal(await store.appendSnapshotManifest("PROJECT-001", manifest), manifest.id);
  assert.equal(await store.appendSnapshotManifest("PROJECT-001", manifest), manifest.id);

  const tampered = {
    ...manifest,
    components: {
      ...manifest.components,
      source: { ...manifest.components.source, digest: "sha256:tampered" },
    },
  };
  await assert.rejects(
    store.appendSnapshotManifest("PROJECT-001", tampered),
    /conflicts with an existing immutable record/,
  );
});

test("PostgreSQL store persists a governed feature baseline without mutating claims", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);
  const application = new TraceabilityApplication({
    store: new PostgresTraceabilityStore(database),
    clock: () => new Date("2026-07-14T05:00:00.000Z"),
  });

  await application.appendFeatureVersion("PROJECT-001", {
    id: "FEATURE-GOV-001",
    version: 1,
    name: "Submit order",
    businessDomain: "orders",
  });
  await application.appendClaimScope("PROJECT-001", {
    id: "SCOPE-GOV-001",
    version: 1,
    scope: { actor: "normal-user" },
  });
  const originalStatement = "A normal user may submit only a DRAFT order.";
  await application.appendClaim("PROJECT-001", {
    id: "CLAIM-GOV-001",
    version: 1,
    featureId: "FEATURE-GOV-001",
    type: "NORMATIVE_REQUIREMENT",
    statement: originalStatement,
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-GOV-001",
    scopeVersion: 1,
  });
  await application.appendDecision("PROJECT-001", {
    id: "DECISION-GOV-001",
    claimId: "CLAIM-GOV-001",
    claimVersion: 1,
    scopeId: "SCOPE-GOV-001",
    scopeVersion: 1,
    type: "CONFIRMED",
    actorId: "USER-001",
    actorRole: "business-owner",
  });
  await application.appendDecision("PROJECT-001", {
    id: "DECISION-GOV-002",
    claimId: "CLAIM-GOV-001",
    claimVersion: 1,
    scopeId: "SCOPE-GOV-001",
    scopeVersion: 1,
    type: "EXCEPTION_RECORDED",
    content: "Administrators may force submission during recovery.",
    actorId: "USER-001",
    actorRole: "business-owner",
  });

  const baseline = await application.getFeatureBaseline("PROJECT-001", "FEATURE-GOV-001");
  assert.equal(baseline.feature.name, "Submit order");
  assert.equal(baseline.claims[0].claim.statement, originalStatement);
  assert.equal(baseline.claims[0].decisionHistory.length, 2);
  assert.equal(baseline.claims[0].latestDecision.type, "EXCEPTION_RECORDED");

  const claimRows = await database.query(
    "SELECT statement FROM claim WHERE project_id = $1 AND id = $2",
    ["PROJECT-001", "CLAIM-GOV-001"],
  );
  assert.deepEqual(claimRows.rows, [{ statement: originalStatement }]);
});

test("PostgreSQL rejects decisions that escape the claim scope or project tenant", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);
  const application = new TraceabilityApplication({
    store: new PostgresTraceabilityStore(database),
    clock: () => new Date("2026-07-14T05:00:00.000Z"),
  });

  await application.appendFeatureVersion("PROJECT-001", {
    id: "FEATURE-GOV-001",
    version: 1,
    name: "Submit order",
  });
  await application.appendClaimScope("PROJECT-001", {
    id: "SCOPE-BOUND",
    version: 1,
    scope: { actor: "normal-user" },
  });
  await application.appendClaimScope("PROJECT-001", {
    id: "SCOPE-ESCAPED",
    version: 1,
    scope: { actor: "administrator" },
  });
  await application.appendClaim("PROJECT-001", {
    id: "CLAIM-GOV-001",
    version: 1,
    featureId: "FEATURE-GOV-001",
    type: "NORMATIVE_REQUIREMENT",
    statement: "A normal user may submit only a DRAFT order.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-BOUND",
    scopeVersion: 1,
  });

  await assert.rejects(
    application.appendDecision("PROJECT-001", {
      id: "DECISION-WRONG-SCOPE",
      claimId: "CLAIM-GOV-001",
      claimVersion: 1,
      scopeId: "SCOPE-ESCAPED",
      scopeVersion: 1,
      type: "CONFIRMED",
      actorId: "USER-001",
      actorRole: "business-owner",
    }),
    (error) => error.name === "PersistenceConflictError",
  );

  await database.query("INSERT INTO organization (id, name) VALUES ($1, $2)", ["ORG-002", "Other org"]);
  await database.query(
    "INSERT INTO tenant (id, organization_id, name) VALUES ($1, $2, $3)",
    ["TENANT-002", "ORG-002", "Other tenant"],
  );
  await database.query(
    "INSERT INTO principal (id, tenant_id, principal_type, display_name) VALUES ($1, $2, $3, $4)",
    ["USER-OTHER", "TENANT-002", "USER", "Other tenant owner"],
  );

  await assert.rejects(
    application.appendDecision("PROJECT-001", {
      id: "DECISION-WRONG-TENANT",
      claimId: "CLAIM-GOV-001",
      claimVersion: 1,
      scopeId: "SCOPE-BOUND",
      scopeVersion: 1,
      type: "CONFIRMED",
      actorId: "USER-OTHER",
      actorRole: "business-owner",
    }),
    (error) => error.name === "PersistenceConflictError",
  );

  const decisions = await database.query(
    "SELECT id FROM human_decision WHERE project_id = $1 ORDER BY append_sequence",
    ["PROJECT-001"],
  );
  assert.deepEqual(decisions.rows, []);
});
