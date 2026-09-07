import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { gitFixture } from "./support/source-truth-git-fixture.js";
import { sourceTruthPilot } from "./support/source-truth-pilot.js";

test("scale pilot Git fixture commits do not buffer a per-file change summary", async (t) => {
  const fixture = await gitFixture(t, { maxOutputBytes: 1024 });
  for (let i = 0; i < 100; i++) await writeFile(path.join(fixture.work, `${String(i).padStart(3, "0")}-${"x".repeat(100)}.txt`), "fixture\n", { flag: "wx" });
  await fixture.git("add", ".");
  assert.equal(await fixture.git("commit", "-m", "large fixture summary"), "");
  assert.match(await fixture.git("rev-parse", "HEAD"), /^[0-9a-f]{40}$/);
});

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
