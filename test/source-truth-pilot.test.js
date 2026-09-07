import assert from "node:assert/strict";
import test from "node:test";
import { sourceTruthPilot } from "./support/source-truth-pilot.js";

test("B-01/03/04/07 isolated real service pilot preserves history and transmits only missing new-version bytes", { skip: !process.env.F001_TEST_PG_BIN, timeout: 120000 }, async () => {
  // The whole tree includes PostgreSQL's relation/index descriptors; the
  // calibrated small fixture used 421, independently of the content read cap.
  const report = await sourceTruthPilot({ filesPerSource: 10, postgresBin: process.env.F001_TEST_PG_BIN, maxTreeRssBytes: 1024 * 1024 * 1024, maxTreeFileDescriptors: 1024 });
  assert.equal(report.status, "PASSED");
  assert.equal(report.totalFiles, 20);
  assert.equal(report.bundleIds.length, 3);
  assert.equal(new Set(report.bundleIds).size, 3);
  assert.equal(report.browserVerified, false);
  assert.equal(report.disasterDeploymentVerified, false);
});
