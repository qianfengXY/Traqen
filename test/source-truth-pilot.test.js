import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { gitFixture } from "./support/source-truth-git-fixture.js";
import { measurements, sourceTruthPilot } from "./support/source-truth-pilot.js";

test("resource samples retain exact process attribution for the observed RSS peak", async () => {
  const measured = measurements();
  try { await measured.sample(); } finally { await measured.stop(); }
  assert.equal(measured.result.samplingErrors, 0);
  const rows = measured.result.peakRssProcesses;
  assert.ok(Array.isArray(rows) && rows.some((row) => row.pid === process.pid));
  assert.equal(new Set(rows.map((row) => row.pid)).size, rows.length);
  assert.equal(rows.reduce((total, row) => total + row.rssBytes, 0), measured.result.peakObservedProcessTreeRssBytes);
  for (const row of rows) {
    assert.ok(Number.isInteger(row.rssBytes) && row.rssBytes >= 0);
    assert.equal(typeof row.executable, "string");
    assert.ok(row.executable.length > 0);
    assert.ok(row.pid === process.pid || rows.some((parent) => parent.pid === row.ppid));
  }
});

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
