import assert from "node:assert/strict";
import test from "node:test";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { MemoryTraceabilityStore, PersistenceConflictError } from "../src/storage/index.js";

const clock = () => new Date("2026-07-15T10:00:00.000Z");

function application() {
  return new TraceabilityApplication({
    store: new MemoryTraceabilityStore(),
    clock,
    reviewerResolver: () => ({ actorId: "OWNER-001", actorRole: "product-owner" }),
    reviewPolicyResolver: () => ({ allowedFeatureGovernanceRoles: ["product-owner"] }),
  });
}

test("Feature evolution preserves sequential versions, aliases, and human lineage decisions", async () => {
  const app = application();
  await app.appendFeatureVersion("PROJECT-001", { id: "FEATURE-A", version: 1, name: "Old checkout" });
  await app.appendFeatureVersion("PROJECT-001", { id: "FEATURE-A", version: 2, name: "Checkout" });
  await assert.rejects(
    app.appendFeatureVersion("PROJECT-001", { id: "FEATURE-A", version: 4, name: "Skipped" }),
    PersistenceConflictError,
  );
  await app.appendFeatureVersion("PROJECT-001", { id: "FEATURE-B", version: 1, name: "Purchase" });

  const alias = await app.appendFeatureAlias("PROJECT-001", "FEATURE-A", {
    featureVersion: 2,
    alias: "  结算  ",
    rationale: "Preserve the former product label for search and imported references.",
  });
  assert.equal(alias.alias, "结算");
  assert.equal(alias.actorId, "OWNER-001");
  assert.equal((await app.listFeatureAliases("PROJECT-001", "FEATURE-A"))[0].aliasKey, "结算");

  const lineage = await app.appendFeatureLineage("PROJECT-001", {
    id: "LINEAGE-001",
    predecessorFeatureId: "FEATURE-A",
    successorFeatureId: "FEATURE-B",
    relationType: "MERGED_INTO",
    rationale: "The two legacy checkout capabilities are governed as one successor.",
  });
  assert.equal(lineage.actorRole, "product-owner");
  assert.equal((await app.listFeatureLineages("PROJECT-001", "FEATURE-A")).length, 1);
  await assert.rejects(app.appendFeatureLineage("PROJECT-001", {
    id: "LINEAGE-002",
    predecessorFeatureId: "FEATURE-B",
    successorFeatureId: "FEATURE-A",
    relationType: "PREDECESSOR_OF",
    rationale: "This would make the evolution graph cyclic.",
  }), /cycle/);
});
