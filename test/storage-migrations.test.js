import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import {
  createExecutionEvidenceBundle,
  createFactBundle,
  createSnapshotManifest,
  evaluateTraceChain,
  signExecutionEvidenceBundle,
  signFactBundle,
  signReverseSkillManifest,
} from "../src/domain/index.js";
import { applyMigrations } from "../src/storage/postgres/migrations.js";
import { PostgresTraceabilityStore } from "../src/storage/postgres/postgres-traceability-store.js";
import { createReferenceSkillSet, ReverseSkillOrchestrator } from "../src/skills/index.js";
import { completeInput, fixedClock } from "./fixtures.js";

const migrationsDirectory = fileURLToPath(new URL("../db/migrations", import.meta.url));

async function migratedDatabase() {
  const database = await PGlite.create();
  const applied = await applyMigrations(database, migrationsDirectory);
  assert.deepEqual(applied, [
    "0001_core_traceability",
    "0002_governance_integrity",
    "0003_runner_attestation",
    "0004_fact_graph",
    "0005_reverse_skill_framework",
    "0006_candidate_review_baseline",
    "0007_change_impact",
  ]);
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
    "fact_bundle",
    "fact_node",
    "fact_edge",
    "reverse_skill_registration",
    "reverse_run",
    "reverse_skill_execution",
    "reverse_conflict",
    "reverse_open_question",
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
  const store = new PostgresTraceabilityStore(database);
  const application = new TraceabilityApplication({
    store,
    clock: () => new Date("2026-07-14T05:00:00.000Z"),
    reviewerResolver: () => ({ actorId: "USER-001", actorRole: "business-owner" }),
    reviewPolicyResolver: () => ({
      allowedRoles: ["business-owner"],
      allowedDecisionTypes: ["CONFIRMED", "EXCEPTION_RECORDED"],
    }),
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
  });
  await application.appendDecision("PROJECT-001", {
    id: "DECISION-GOV-002",
    claimId: "CLAIM-GOV-001",
    claimVersion: 1,
    scopeId: "SCOPE-GOV-001",
    scopeVersion: 1,
    type: "EXCEPTION_RECORDED",
    content: "Administrators may force submission during recovery.",
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
  let reviewer = { actorId: "USER-001", actorRole: "business-owner" };
  const application = new TraceabilityApplication({
    store: new PostgresTraceabilityStore(database),
    clock: () => new Date("2026-07-14T05:00:00.000Z"),
    reviewerResolver: () => reviewer,
    reviewPolicyResolver: () => ({
      allowedRoles: ["business-owner"],
      allowedDecisionTypes: ["CONFIRMED"],
    }),
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

  reviewer = { actorId: "USER-OTHER", actorRole: "business-owner" };
  await assert.rejects(
    application.appendDecision("PROJECT-001", {
      id: "DECISION-WRONG-TENANT",
      claimId: "CLAIM-GOV-001",
      claimVersion: 1,
      scopeId: "SCOPE-BOUND",
      scopeVersion: 1,
      type: "CONFIRMED",
    }),
    (error) => error.name === "PersistenceConflictError",
  );

  const decisions = await database.query(
    "SELECT id FROM human_decision WHERE project_id = $1 ORDER BY append_sequence",
    ["PROJECT-001"],
  );
  assert.deepEqual(decisions.rows, []);
});

test("PostgreSQL store preserves TestSpec versions and authoritative Claim links", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);
  const application = new TraceabilityApplication({
    store: new PostgresTraceabilityStore(database),
    clock: () => new Date("2026-07-14T06:00:00.000Z"),
    reviewerResolver: async () => ({ actorId: "USER-001", actorRole: "quality-owner" }),
    reviewPolicyResolver: async () => ({ allowedTestSpecApproverRoles: ["quality-owner"] }),
  });

  await application.appendFeatureVersion("PROJECT-001", {
    id: "FEATURE-TEST-001",
    version: 1,
    name: "Submit order",
  });
  await application.appendClaimScope("PROJECT-001", {
    id: "SCOPE-TEST-001",
    version: 1,
    scope: { actor: "normal-user" },
  });
  await application.appendClaim("PROJECT-001", {
    id: "CLAIM-TEST-001",
    version: 1,
    featureId: "FEATURE-TEST-001",
    type: "NORMATIVE_REQUIREMENT",
    statement: "A normal user may submit only a DRAFT order.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-TEST-001",
    scopeVersion: 1,
  });

  const firstVersion = {
    id: "TEST-SPEC-001",
    version: 1,
    name: "Submit a draft order",
    risk: "HIGH",
    approved: false,
    featureId: "FEATURE-TEST-001",
    verifiesClaims: [{ id: "CLAIM-TEST-001", version: 1 }],
    environment: { target: "sit", operationLevel: "CONTROLLED_WRITE" },
    preconditions: [{ type: "SEED", seedRef: "draft-order" }],
    variables: { accessToken: { secretRef: "accounts/normal-user/token" } },
    steps: [{ id: "submit", executor: "HTTP", method: "POST", path: "/orders/1/submit" }],
    assertions: [{ id: "status", type: "HTTP_STATUS", stepId: "submit", expected: 200 }],
    cleanup: { strategy: "SEED_RESET" },
    policy: { approvalRequired: true },
  };
  await application.appendTestSpecDraft("PROJECT-001", firstVersion);
  const approved = await application.approveTestSpec("PROJECT-001", "TEST-SPEC-001", {
    expectedVersion: 1,
    rationale: "The isolated draft-order fixture and cleanup protocol are ready for execution.",
  });
  assert.equal(approved.approval.actorId, "USER-001");
  assert.equal(approved.approval.actorRole, "quality-owner");
  assert.ok(approved.approval.requestFingerprint);

  const latest = await application.getTestSpec("PROJECT-001", "TEST-SPEC-001");
  const original = await application.getTestSpec("PROJECT-001", "TEST-SPEC-001", 1);
  assert.equal(latest.version, 2);
  assert.equal(latest.approved, true);
  assert.equal(original.approved, false);
  assert.equal((await application.validateStoredTestSpec("PROJECT-001", "TEST-SPEC-001")).executable, true);
  const baseline = await application.getFeatureBaseline("PROJECT-001", "FEATURE-TEST-001");
  assert.equal(baseline.testSpecs.length, 1);
  assert.equal(baseline.testSpecs[0].version, 2);

  const links = await database.query(
    `SELECT test_spec_version, claim_id, claim_version
     FROM test_spec_claim
     WHERE project_id = $1 AND test_spec_id = $2
     ORDER BY test_spec_version`,
    ["PROJECT-001", "TEST-SPEC-001"],
  );
  assert.deepEqual(links.rows, [
    { test_spec_version: 1, claim_id: "CLAIM-TEST-001", claim_version: 1 },
    { test_spec_version: 2, claim_id: "CLAIM-TEST-001", claim_version: 1 },
  ]);

  await assert.rejects(
    application.appendTestSpec("PROJECT-001", { ...firstVersion, version: 2, name: "Collision" }),
    /conflicts with an existing record/,
  );

  await database.query("INSERT INTO organization (id, name) VALUES ($1, $2)", ["ORG-OTHER", "Other org"]);
  await database.query(
    "INSERT INTO tenant (id, organization_id, name) VALUES ($1, $2, $3)",
    ["TENANT-OTHER", "ORG-OTHER", "Other tenant"],
  );
  await database.query(
    "INSERT INTO principal (id, tenant_id, principal_type, display_name) VALUES ($1, $2, $3, $4)",
    ["USER-OTHER-APPROVER", "TENANT-OTHER", "USER", "Other approver"],
  );
  await assert.rejects(
    application.appendTestSpec("PROJECT-001", {
      ...firstVersion,
      version: 3,
      approved: true,
      approval: {
        actorId: "USER-OTHER-APPROVER",
        actorRole: "quality-owner",
        approvedAt: "2026-07-14T05:59:00.000Z",
      },
    }),
    /approver must belong to the project tenant/,
  );
});

test("PostgreSQL atomically persists attested execution evidence for the exact deployment", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);
  await insertSnapshot(database);
  const runnerSecret = "runner-shared-secret";
  const application = new TraceabilityApplication({
    store: new PostgresTraceabilityStore(database),
    clock: () => new Date("2026-07-14T06:10:00.000Z"),
    runnerKeyResolver: (runnerId) => (runnerId === "RUNNER-001" ? runnerSecret : null),
  });

  await application.appendFeatureVersion("PROJECT-001", {
    id: "FEATURE-EXEC-001",
    version: 1,
    name: "Read order",
  });
  await application.appendClaimScope("PROJECT-001", {
    id: "SCOPE-EXEC-001",
    version: 1,
    scope: { actor: "normal-user" },
  });
  await application.appendClaim("PROJECT-001", {
    id: "CLAIM-EXEC-001",
    version: 1,
    featureId: "FEATURE-EXEC-001",
    type: "NORMATIVE_REQUIREMENT",
    statement: "A normal user may read an order.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-EXEC-001",
    scopeVersion: 1,
  });
  await application.appendTestSpec("PROJECT-001", {
    id: "TEST-EXEC-001",
    version: 1,
    name: "Read order",
    risk: "LOW",
    approved: true,
    approval: {
      actorId: "USER-001",
      actorRole: "quality-owner",
      approvedAt: "2026-07-14T05:50:00.000Z",
    },
    featureId: "FEATURE-EXEC-001",
    verifiesClaims: [{ id: "CLAIM-EXEC-001", version: 1 }],
    environment: { target: "sit", operationLevel: "SAFE_READ" },
    steps: [{ id: "read", executor: "HTTP", method: "GET", path: "/orders/1" }],
    assertions: [{ id: "http-status", type: "HTTP_STATUS", stepId: "read", expected: 200 }],
    cleanup: null,
    policy: { approvalRequired: true },
  });

  const execution = {
    id: "EXEC-ATTESTED-001",
    testSpecId: "TEST-EXEC-001",
    testSpecVersion: 1,
    snapshotManifestId: "SNAPSHOT-MANIFEST-001",
    deploymentId: "DEPLOY-001",
    runner: { id: "RUNNER-001", version: "1.0.0" },
    completionReason: "COMPLETED",
    startedAt: "2026-07-14T06:00:00.000Z",
    finishedAt: "2026-07-14T06:05:00.000Z",
    attempts: [
      {
        number: 1,
        startedAt: "2026-07-14T06:00:00.000Z",
        finishedAt: "2026-07-14T06:05:00.000Z",
        phaseStatus: "PASS",
        stepResults: [{ id: "read", status: "PASS" }],
        assertionResults: [{ id: "http-status", status: "PASS", actual: 200 }],
        cleanup: { status: "SKIPPED" },
      },
    ],
  };
  const normalized = createExecutionEvidenceBundle(
    {
      execution,
      evidence: [
        {
          id: "EVIDENCE-ATTESTED-001",
          type: "ASSERTION",
          freshness: "FRESH",
          manifest: {
            executionId: execution.id,
            testSpecId: execution.testSpecId,
            testSpecVersion: execution.testSpecVersion,
            snapshotManifestId: execution.snapshotManifestId,
            deploymentId: execution.deploymentId,
            runnerId: execution.runner.id,
            runnerVersion: execution.runner.version,
            assertionResults: execution.attempts[0].assertionResults,
            redactions: [],
          },
        },
      ],
    },
    () => new Date("2026-07-14T06:10:00.000Z"),
  );
  const signed = signExecutionEvidenceBundle("PROJECT-001", normalized, runnerSecret);
  const stored = await application.ingestExecutionEvidence("PROJECT-001", signed);

  assert.equal(stored.execution.status, "PASS");
  assert.equal(stored.evidence[0].integrity, "VERIFIED");
  assert.equal(stored.evidence[0].contentHash, normalized.evidence[0].contentHash);
  assert.deepEqual(await application.ingestExecutionEvidence("PROJECT-001", signed), stored);
  const baseline = await application.getFeatureBaseline("PROJECT-001", "FEATURE-EXEC-001");
  assert.equal(baseline.testExecutions[0].id, "EXEC-ATTESTED-001");
  assert.equal(baseline.testExecutions[0].evidenceCount, 1);

  const wrongDeploymentExecution = {
    ...execution,
    id: "EXEC-WRONG-DEPLOYMENT",
    deploymentId: "DEPLOY-OTHER",
  };
  const wrongDeployment = createExecutionEvidenceBundle(
    {
      execution: wrongDeploymentExecution,
      evidence: [
        {
          id: "EVIDENCE-WRONG-DEPLOYMENT",
          type: "ASSERTION",
          manifest: {
            ...normalized.evidence[0].manifest,
            executionId: wrongDeploymentExecution.id,
            deploymentId: wrongDeploymentExecution.deploymentId,
          },
        },
      ],
    },
    () => new Date("2026-07-14T06:10:00.000Z"),
  );
  await assert.rejects(
    application.ingestExecutionEvidence(
      "PROJECT-001",
      signExecutionEvidenceBundle("PROJECT-001", wrongDeployment, runnerSecret),
    ),
    /Persistence constraints rejected|deployment/,
  );

  const evidenceRows = await database.query(
    "SELECT id FROM evidence WHERE project_id = $1 ORDER BY id",
    ["PROJECT-001"],
  );
  assert.deepEqual(evidenceRows.rows, [{ id: "EVIDENCE-ATTESTED-001" }]);
});

test("PostgreSQL persists signed fact graphs as immutable snapshot evidence", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);
  await insertSnapshot(database);
  const scannerSecret = "scanner-shared-secret";
  const application = new TraceabilityApplication({
    store: new PostgresTraceabilityStore(database),
    scannerKeyResolver: (scannerId) => (scannerId === "SCANNER-001" ? scannerSecret : null),
  });
  const source = {
    artifact: "src/orders.js",
    startLine: 2,
    endLine: 7,
    contentHash: `sha256:${"c".repeat(64)}`,
  };
  const seed = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-MANIFEST-001",
    sourceComponentId: "SOURCE-001",
    sourceDigest: `sha256:${"d".repeat(64)}`,
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt: "2026-07-14T07:00:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [
      { type: "CODE_SYMBOL", naturalKey: "javascript:src/orders.js:getOrder", name: "getOrder", attributes: {}, source },
      { type: "DATA_OBJECT", naturalKey: "table:orders", name: "orders", attributes: { kind: "table" }, source },
    ],
    edges: [],
  });
  const getOrder = seed.nodes.find((node) => node.name === "getOrder");
  const orders = seed.nodes.find((node) => node.name === "orders");
  const bundle = createFactBundle({
    ...seed,
    nodes: seed.nodes,
    edges: [{ subjectId: getOrder.id, predicate: "READS", objectId: orders.id, attributes: {}, source }],
  });
  const signed = signFactBundle(bundle, scannerSecret);

  const stored = await application.ingestFactBundle("PROJECT-001", signed);
  assert.deepEqual(stored, {
    bundleId: bundle.id,
    snapshotManifestId: "SNAPSHOT-MANIFEST-001",
    sourceComponentId: "SOURCE-001",
    nodeCount: 2,
    edgeCount: 1,
    complete: true,
  });
  assert.deepEqual(await application.ingestFactBundle("PROJECT-001", signed), stored);

  const wrongSourceBundle = createFactBundle({
    ...bundle,
    sourceComponentId: "BUILD-001",
    observedAt: "2026-07-14T07:01:00.000Z",
    nodes: bundle.nodes.map((node) => ({
      ...node,
      observedAt: "2026-07-14T07:01:00.000Z",
      validFrom: "2026-07-14T07:01:00.000Z",
    })),
    edges: bundle.edges.map((edge) => ({ ...edge, observedAt: "2026-07-14T07:01:00.000Z" })),
  });
  await assert.rejects(
    application.ingestFactBundle("PROJECT-001", signFactBundle(wrongSourceBundle, scannerSecret)),
    /source component|Persistence constraints rejected/,
  );

  const graph = await application.queryFacts("PROJECT-001", {
    snapshotManifestId: "SNAPSHOT-MANIFEST-001",
    types: ["CODE_SYMBOL"],
    predicates: ["READS"],
    query: "getOrder",
  });
  assert.deepEqual(graph.matchedNodeIds, [getOrder.id]);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges[0].predicate, "READS");

  await assert.rejects(
    database.query("UPDATE fact_node SET name = 'tampered' WHERE project_id = $1", ["PROJECT-001"]),
    /append-only; UPDATE and DELETE are forbidden/,
  );
  await assert.rejects(
    database.query("DELETE FROM fact_bundle WHERE project_id = $1", ["PROJECT-001"]),
    /append-only; UPDATE and DELETE are forbidden/,
  );
});

test("PostgreSQL preserves Skill registrations, raw outputs, normalized candidates, and run audit", async (t) => {
  const database = await migratedDatabase();
  t.after(() => database.close());
  await insertProjectFoundation(database);
  await insertSnapshot(database);
  const scannerSecret = "scanner-secret";
  const publisherSecret = "publisher-secret";
  const referenceSkills = createReferenceSkillSet();
  let applicationNow = "2026-07-14T10:00:00.000Z";
  const installed = new Map(
    referenceSkills.map(({ adapter }) => [`${adapter.id}\u0000${adapter.version}`, adapter]),
  );
  const store = new PostgresTraceabilityStore(database);
  const application = new TraceabilityApplication({
    store,
    clock: () => new Date(applicationNow),
    scannerKeyResolver: (scannerId) => (scannerId === "SCANNER-001" ? scannerSecret : null),
    publisherKeyResolver: (publisher) => (publisher === "TRAQEN" ? publisherSecret : null),
    installedSkillResolver: (skillId, version) => installed.get(`${skillId}\u0000${version}`) ?? null,
    skillPolicyResolver: () => ({
      allowedSkillIds: referenceSkills.map(({ adapter }) => adapter.id),
      allowedPublishers: ["TRAQEN"],
      maxSkills: 2,
      maxAttempts: 1,
    }),
    reverseOrchestrator: new ReverseSkillOrchestrator({
      adapters: referenceSkills.map(({ adapter }) => adapter),
      clock: () => new Date("2026-07-14T10:00:00.000Z"),
    }),
    reviewerResolver: () => ({ actorId: "USER-001", actorRole: "business-owner" }),
    reviewPolicyResolver: () => ({
      allowedRoles: ["business-owner"],
      allowedOutcomes: ["CONFIRMED", "EXCEPTION_RECORDED", "REJECTED", "INSUFFICIENT_EVIDENCE", "DEFERRED"],
    }),
  });
  const source = {
    artifact: "src/orders.js",
    startLine: 1,
    endLine: 4,
    contentHash: `sha256:${"e".repeat(64)}`,
  };
  const bundle = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-MANIFEST-001",
    sourceComponentId: "SOURCE-001",
    sourceDigest: `sha256:${"f".repeat(64)}`,
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt: "2026-07-14T09:55:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [{
      type: "ENDPOINT",
      naturalKey: "http:POST /orders/{id}/submit",
      name: "POST /orders/{id}/submit",
      attributes: { method: "POST", path: "/orders/{id}/submit" },
      source,
    }],
    edges: [],
  });
  await application.ingestFactBundle("PROJECT-001", signFactBundle(bundle, scannerSecret));

  for (const item of referenceSkills) {
    await application.registerReverseSkill({
      ...signReverseSkillManifest(item.manifest, publisherSecret),
      status: "ALLOWED",
    });
  }
  const run = await application.executeReverseRun({
    id: "REVERSE-RUN-DB-001",
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-MANIFEST-001",
    sourceComponentId: "SOURCE-001",
    factBundleIds: [bundle.id],
    skills: referenceSkills.map(({ adapter }) => ({ id: adapter.id, version: adapter.version })),
    taskScope: { nodeTypes: ["ENDPOINT"] },
  });

  assert.equal(run.status, "WAITING_REVIEW");
  assert.equal(run.mergedOutput.candidateFeatures[0].sources.length, 2);
  assert.deepEqual(await application.getReverseRun("PROJECT-001", run.id), run);
  const executionRows = await database.query(
    `SELECT skill_id, status, raw_output IS NOT NULL AS has_raw,
            normalized_output IS NOT NULL AS has_normalized
     FROM reverse_skill_execution
     WHERE project_id = $1 AND run_id = $2
     ORDER BY skill_id`,
    ["PROJECT-001", run.id],
  );
  assert.equal(executionRows.rows.length, 2);
  assert.ok(executionRows.rows.every((row) => row.status === "COMPLETED" && row.has_raw && row.has_normalized));
  const eventRows = await database.query(
    "SELECT status FROM reverse_run_event WHERE project_id = $1 AND run_id = $2 ORDER BY sequence",
    ["PROJECT-001", run.id],
  );
  assert.deepEqual(eventRows.rows.map((row) => row.status), run.statusHistory.map((event) => event.status));

  const candidate = run.mergedOutput.candidateClaims.find((item) => item.subjectKey.startsWith("endpoint:"));
  const candidateFeature = run.mergedOutput.candidateFeatures.find((item) => item.externalKey === candidate.subjectKey);
  const reviewed = await application.reviewReverseCandidate("PROJECT-001", run.id, candidate.id, {
    id: "REVIEW-DB-001",
    outcome: "CONFIRMED",
    rationale: "The business owner confirms endpoint availability for the standard order flow.",
    candidateFeatureId: candidateFeature.id,
    target: {
      featureMode: "CREATE",
      featureId: "FEATURE-REVIEW-DB-001",
      claimId: "CLAIM-REVIEW-DB-001",
      scopeId: "SCOPE-REVIEW-DB-001",
      decisionId: "DECISION-REVIEW-DB-001",
    },
    normative: {
      statement: "The submit-order capability must expose its submission endpoint.",
      constraint: { dimension: "endpointExposed", operator: "EQUALS", value: true },
      scope: { actor: "normal-user", orderType: "standard" },
      authorityEvidenceRefs: ["AUTHORITY-PRODUCT-001"],
    },
  });
  assert.equal(reviewed.claim.type, "NORMATIVE_REQUIREMENT");
  assert.equal(reviewed.conformance.status, "CONFORMS");
  assert.deepEqual(
    await application.reviewReverseCandidate("PROJECT-001", run.id, candidate.id, {
      id: "REVIEW-DB-001",
      outcome: "CONFIRMED",
      rationale: "The business owner confirms endpoint availability for the standard order flow.",
      candidateFeatureId: candidateFeature.id,
      target: {
        featureMode: "CREATE",
        featureId: "FEATURE-REVIEW-DB-001",
        claimId: "CLAIM-REVIEW-DB-001",
        scopeId: "SCOPE-REVIEW-DB-001",
        decisionId: "DECISION-REVIEW-DB-001",
      },
      normative: {
        statement: "The submit-order capability must expose its submission endpoint.",
        constraint: { dimension: "endpointExposed", operator: "EQUALS", value: true },
        scope: { actor: "normal-user", orderType: "standard" },
        authorityEvidenceRefs: ["AUTHORITY-PRODUCT-001"],
      },
    }),
    reviewed,
  );
  const reviewRows = await database.query(
    `SELECT outcome, actor_id FROM reverse_candidate_review WHERE project_id = $1 AND run_id = $2`,
    ["PROJECT-001", run.id],
  );
  assert.deepEqual(reviewRows.rows, [{ outcome: "CONFIRMED", actor_id: "USER-001" }]);
  const mappingRows = await database.query(
    `SELECT mapping_status, source_candidate_id FROM implementation_mapping WHERE project_id = $1`,
    ["PROJECT-001"],
  );
  assert.deepEqual(mappingRows.rows, [{ mapping_status: "ACTIVE", source_candidate_id: candidate.id }]);
  const traceability = await application.getFeatureTraceability(
    "PROJECT-001",
    "FEATURE-REVIEW-DB-001",
    "SNAPSHOT-MANIFEST-001",
  );
  assert.equal(traceability.claims[0].facts.nodes[0].type, "ENDPOINT");
  assert.equal(traceability.dimensions.authority[0].status, "CONFIRMED");
  assert.equal(traceability.dimensions.conformance[0].status, "CONFORMS");
  assert.ok(traceability.gaps.some((gap) => gap.type === "NO_TEST_SPEC"));
  const recomputed = await application.recomputeFeatureTraceChains(
    "PROJECT-001",
    "FEATURE-REVIEW-DB-001",
    "SNAPSHOT-MANIFEST-001",
  );
  const currentChain = await application.getCurrentTraceChain(
    "PROJECT-001",
    recomputed.traceChains[0].id,
  );
  assert.deepEqual(currentChain.segments, recomputed.traceChains[0].segments);
  assert.deepEqual(currentChain.conflicts, []);

  const continuedManifest = createSnapshotManifest({
    source: { id: "SOURCE-CONTINUED", digest: "sha256:source-continued" },
    build: { id: "BUILD-CONTINUED", digest: "sha256:build-continued" },
    deployment: { id: "DEPLOY-CONTINUED", digest: "sha256:deployment-continued" },
    runtime: { id: "RUNTIME-CONTINUED", digest: "sha256:runtime-continued" },
    observedFrom: "2026-07-14T10:02:00.000Z",
    observedTo: "2026-07-14T10:04:00.000Z",
    failedSources: [],
  }, () => new Date("2026-07-14T10:04:00.000Z"));
  await store.appendSnapshotManifest("PROJECT-001", continuedManifest);
  const continuedBundle = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId: continuedManifest.id,
    sourceComponentId: continuedManifest.components.source.id,
    sourceDigest: `sha256:${"f".repeat(64)}`,
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt: "2026-07-14T10:04:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [{
      type: "ENDPOINT",
      naturalKey: "http:POST /orders/{id}/submit",
      name: "POST /orders/{id}/submit",
      attributes: { method: "POST", path: "/orders/{id}/submit" },
      source,
    }],
    edges: [],
  });
  await application.ingestFactBundle("PROJECT-001", signFactBundle(continuedBundle, scannerSecret));
  const continuityImpact = await application.compareAndPersistSnapshots("PROJECT-001", {
    id: "CHANGESET-CONTINUITY-DB-001",
    fromSnapshotManifestId: "SNAPSHOT-MANIFEST-001",
    toSnapshotManifestId: continuedManifest.id,
  });
  assert.deepEqual(continuityImpact.impact.invalidations, []);
  assert.equal(continuityImpact.continuities.length, 1);
  const continuityRows = await database.query(
    `SELECT from_mapping_id, to_mapping_id
     FROM implementation_continuity_event
     WHERE project_id = $1 AND change_set_id = $2`,
    ["PROJECT-001", "CHANGESET-CONTINUITY-DB-001"],
  );
  assert.equal(continuityRows.rows.length, 1);
  const continuedTraceability = await application.getFeatureTraceability(
    "PROJECT-001",
    "FEATURE-REVIEW-DB-001",
    continuedManifest.id,
  );
  assert.equal(continuedTraceability.dimensions.conformance[0].status, "CONFORMS");

  const nextManifest = createSnapshotManifest({
    source: { id: "SOURCE-002", digest: "sha256:source-002" },
    build: { id: "BUILD-002", digest: "sha256:build-002" },
    deployment: { id: "DEPLOY-002", digest: "sha256:deployment-002" },
    runtime: { id: "RUNTIME-002", digest: "sha256:runtime-002" },
    observedFrom: "2026-07-14T10:05:00.000Z",
    observedTo: "2026-07-14T10:10:00.000Z",
    failedSources: [],
  }, () => new Date("2026-07-14T10:10:00.000Z"));
  await store.appendSnapshotManifest("PROJECT-001", nextManifest);
  const nextBundle = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId: nextManifest.id,
    sourceComponentId: nextManifest.components.source.id,
    sourceDigest: `sha256:${"1".repeat(64)}`,
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt: "2026-07-14T10:10:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [{
      type: "ENDPOINT",
      naturalKey: "http:POST /orders/{id}/submit",
      name: "POST /orders/{id}/submit",
      attributes: { method: "POST", path: "/orders/{id}/submit", handlerVersion: 2 },
      source: { ...source, contentHash: `sha256:${"2".repeat(64)}` },
    }],
    edges: [],
  });
  await application.ingestFactBundle("PROJECT-001", signFactBundle(nextBundle, scannerSecret));
  const changeImpact = await application.compareAndPersistSnapshots("PROJECT-001", {
    id: "CHANGESET-DB-001",
    fromSnapshotManifestId: continuedManifest.id,
    toSnapshotManifestId: nextManifest.id,
  });
  assert.deepEqual(changeImpact.impact.affectedFeatureIds, ["FEATURE-REVIEW-DB-001"]);
  assert.ok(changeImpact.impact.invalidations[0].layers.includes("CONFORMANCE"));
  assert.ok(changeImpact.impact.invalidations[0].preserves.includes("NORMATIVE_CLAIM"));
  assert.deepEqual(
    await application.getChangeImpact("PROJECT-001", "CHANGESET-DB-001"),
    changeImpact,
  );
  const impactRows = await database.query(
    `SELECT invalidated_layers, preserved_layers
     FROM trace_invalidation_event
     WHERE project_id = $1 AND change_set_id = $2`,
    ["PROJECT-001", "CHANGESET-DB-001"],
  );
  assert.equal(impactRows.rows.length, 1);
  assert.ok(impactRows.rows[0].invalidated_layers.includes("TRACE_CHAIN"));
  assert.ok(impactRows.rows[0].preserved_layers.includes("BUSINESS_DECISION"));
  await assert.rejects(
    database.query("DELETE FROM change_set WHERE project_id = $1", ["PROJECT-001"]),
    /append-only; UPDATE and DELETE are forbidden/,
  );
  await assert.rejects(
    database.query("DELETE FROM reverse_candidate_review WHERE project_id = $1", ["PROJECT-001"]),
    /append-only; UPDATE and DELETE are forbidden/,
  );

  applicationNow = "2026-07-14T10:01:00.000Z";
  await application.registerReverseSkill({
    ...signReverseSkillManifest(referenceSkills[0].manifest, publisherSecret),
    status: "BLOCKED",
  });
  const currentSkills = await application.listReverseSkills();
  assert.equal(
    currentSkills.find((registration) => registration.manifest.metadata.id === referenceSkills[0].adapter.id).status,
    "BLOCKED",
  );
  await assert.rejects(
    application.executeReverseRun({
      id: "REVERSE-RUN-BLOCKED-DB",
      projectId: "PROJECT-001",
      snapshotManifestId: "SNAPSHOT-MANIFEST-001",
      sourceComponentId: "SOURCE-001",
      factBundleIds: [bundle.id],
      skills: [{ id: referenceSkills[0].adapter.id, version: referenceSkills[0].adapter.version }],
      taskScope: { nodeTypes: ["ENDPOINT"] },
    }),
    /is blocked/,
  );
  await assert.rejects(
    database.query("DELETE FROM reverse_skill_execution WHERE project_id = $1", ["PROJECT-001"]),
    /append-only; UPDATE and DELETE are forbidden/,
  );
});
