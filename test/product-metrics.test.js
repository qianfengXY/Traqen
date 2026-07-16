import assert from "node:assert/strict";
import test from "node:test";

import { createProductEffectivenessMetrics } from "../src/domain/index.js";

function traceability({ id, complete, gap = null }) {
  return {
    feature: { id, name: id },
    claims: [{
      latestDecision: { type: "CONFIRMED" },
      facts: { nodes: [{ type: "ENDPOINT" }, { type: "DATA_OBJECT" }] },
      testSpecs: [{ id: `TEST-${id}`, version: 1, approved: true, assertions: [
        { type: "HTTP_STATUS" },
        { type: "DATABASE_FIELD" },
      ] }],
      execution: complete ? { id: `EXEC-${id}` } : null,
      evidence: complete ? [{ integrity: "VERIFIED" }] : [],
    }],
    dimensions: { freshness: [{ status: complete ? "FRESH" : "INCOMPLETE" }] },
    traceChains: [{ complete }],
    gaps: gap ? [gap] : [],
  };
}

test("product metrics preserve ratios, independent dimensions, gap causes, and unavailable inputs", () => {
  const metrics = createProductEffectivenessMetrics({
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    highValueFeatureIds: ["FEATURE-001", "FEATURE-002"],
    traceabilities: [
      traceability({ id: "FEATURE-001", complete: true }),
      traceability({ id: "FEATURE-002", complete: false, gap: { type: "NO_CURRENT_EXECUTION", severity: "BLOCKING", ownerRole: "QUALITY_OWNER" } }),
    ],
  }, () => new Date("2026-07-15T00:00:00.000Z"));

  assert.deepEqual(metrics.highValueValidTraceChainRate, { numerator: 1, denominator: 2, ratio: 0.5 });
  assert.deepEqual(metrics.claimConfirmationRate, { numerator: 2, denominator: 2, ratio: 1 });
  assert.deepEqual(metrics.confirmedRuleTestCoverageRate, { numerator: 2, denominator: 2, ratio: 1 });
  assert.deepEqual(metrics.meaningfulAssertionRate, { numerator: 2, denominator: 4, ratio: 0.5 });
  assert.equal(metrics.evidenceFreshness.FRESH, 1);
  assert.equal(metrics.evidenceFreshness.INCOMPLETE, 1);
  assert.equal(metrics.gapBreakdown.byType.NO_CURRENT_EXECUTION, 1);
  assert.equal(metrics.features[0].coverage.configuration, false);
  assert.equal(metrics.features[1].dimensions.freshness[0].status, "INCOMPLETE");
  assert.ok(metrics.unavailableMetrics.some((item) => item.metric === "DEFECT_ESCAPE_RATE"));
  assert.equal(metrics.compositeScore, undefined);
});
