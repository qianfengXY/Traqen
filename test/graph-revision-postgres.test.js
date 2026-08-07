import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../src/storage/postgres/migrations.js";
import { PostgresTraceabilityStore } from "../src/storage/postgres/postgres-traceability-store.js";

const migrationsDirectory = fileURLToPath(new URL("../db/migrations", import.meta.url));

test("PostgreSQL publishes GraphRevision and CurrentGraphHead in one CAS transaction", async () => {
  const database = await PGlite.create();
  await applyMigrations(database, migrationsDirectory);
  await database.query("INSERT INTO organization (id, name) VALUES ('O', 'Org')");
  await database.query("INSERT INTO tenant (id, organization_id, name) VALUES ('T', 'O', 'Tenant')");
  await database.query("INSERT INTO project (id, tenant_id, name) VALUES ('P', 'T', 'Project')");
  const store = new PostgresTraceabilityStore(database);
  const minimumDenominators = { inventory: 1, anchors: 1, candidateSample: 1, requiredRelationships: 1, forbiddenRelationships: 1, sourceAttributions: 1, gaps: 1, replaySamples: 1, incrementalComparisons: 1 };
  await store.appendUnderstandingRecord("P", "EVALUATION_RUN", {
    id: "E1", projectId: "P", analysisRunId: "R1", status: "PASSED", policyVersion: "v1",
    minimumDenominators, denominators: minimumDenominators, completedAt: "2026-07-29T00:00:00.000Z",
  });
  await store.appendUnderstandingRecord("P", "GRAPH_ARTIFACT", {
    id: "A1", projectId: "P", snapshotManifestId: "S1", analysisRunId: "R1",
    graphArtifactDigest: "D1", createdAt: "2026-07-29T00:00:00.000Z",
  });
  await store.appendUnderstandingRecord("P", "GRAPH_REVISION", {
    id: "G1", projectId: "P", snapshotManifestId: "S1", analysisRunId: "R1", mode: "FULL",
    baseRevisionId: null, evaluationRunId: "E1", graphArtifactId: "A1", graphArtifactDigest: "D1",
    status: "EVALUATING", createdAt: "2026-07-29T00:00:00.000Z",
  });
  const head = await store.publishGraphRevision("P", "G1", 0);
  assert.equal(head.version, 1);
  assert.equal(head.graphRevisionId, "G1");
  assert.equal((await store.getUnderstandingRecord("P", "GRAPH_REVISION", "G1")).status, "PUBLISHED");
  await assert.rejects(store.publishGraphRevision("P", "G1", 0), /version 1 does not match 0/);

  await store.appendUnderstandingRecord("P", "EVALUATION_RUN", {
    id: "E2", projectId: "P", analysisRunId: "R2", status: "PASSED", policyVersion: "v1",
    minimumDenominators, denominators: minimumDenominators, completedAt: "2026-07-29T00:01:00.000Z",
  });
  await store.appendUnderstandingRecord("P", "GRAPH_ARTIFACT", {
    id: "A2", projectId: "P", snapshotManifestId: "S1", analysisRunId: "R2",
    graphArtifactDigest: "D2", createdAt: "2026-07-29T00:01:00.000Z",
  });
  await store.appendUnderstandingRecord("P", "GRAPH_REVISION", {
    id: "G2", projectId: "P", snapshotManifestId: "S1", analysisRunId: "R2", mode: "FULL",
    baseRevisionId: null, evaluationRunId: "E2", graphArtifactId: "A2", graphArtifactDigest: "D2",
    reanalysisOfGraphRevisionId: "G1", status: "EVALUATING", createdAt: "2026-07-29T00:01:00.000Z",
  });
  await assert.rejects(
    store.publishGraphRevision("P", "G2", 1),
    /must use historical publication/,
  );
  const historical = await store.publishHistoricalGraphRevision("P", "G2", "G1");
  const unchangedHead = await store.getCurrentGraphHead("P");
  assert.equal(historical.status, "PUBLISHED");
  assert.equal(historical.reanalysisOfGraphRevisionId, "G1");
  assert.equal(unchangedHead.graphRevisionId, "G1");
  assert.equal(unchangedHead.version, 1);
  await assert.rejects(
    store.publishHistoricalGraphRevision("P", "G2", "G1"),
    /must be EVALUATING/,
  );
  await database.close();
});
