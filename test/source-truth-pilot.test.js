import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { gitFixture } from "./support/source-truth-git-fixture.js";
import { measurements, sourceTruthPilot } from "./support/source-truth-pilot.js";

const childPid = process.pid + 1000000;
const samplerPid = process.pid + 2000000;
const otherPid = process.pid + 3000000;
const processListing = () => `${process.pid} 1 100 node\n${childPid} ${process.pid} 50 postgres\n${samplerPid} ${process.pid} 20 ps\n${otherPid} 1 900 unrelated\n`;
const descriptorListing = () => `p${process.pid}\nf0\nf1\np${childPid}\nf0\n`;
function samplerFixture({ ps = () => ({ stdout: processListing() }), lsof = () => ({ stdout: descriptorListing() }), probePid = () => {} } = {}) {
  return { probePid, phase: () => "capture-and-freeze-A-D1", execute(command, args) {
    assert.ok(["/bin/ps", "/usr/sbin/lsof"].includes(command));
    if (command.endsWith("lsof")) assert.equal(args[2], `${process.pid},${childPid}`);
    const promise = Promise.resolve().then(command.endsWith("ps") ? ps : lsof);
    promise.child = { pid: samplerPid };
    return promise;
  } };
}
const failure = (code) => Object.assign(new Error("PRIVATE credential SQL source environment"), {
  code, stdout: "PRIVATE command arguments", stderr: "PRIVATE credential SQL", signal: "PRIVATE"
});
function diagnostic(measured, code, stage) {
  assert.equal(measured.result.samplingErrors, 1);
  assert.equal(measured.result.sampleCount, 0);
  assert.equal(measured.result.samplingErrorDetails.length, 1);
  const detail = measured.result.samplingErrorDetails[0];
  assert.equal(detail.code, code);
  assert.equal(detail.stage, stage);
  assert.equal(detail.phase, "capture-and-freeze-A-D1");
  assert.equal(detail.rootPid, process.pid);
  assert.ok(Number.isFinite(Date.parse(detail.at)));
  assert.doesNotMatch(JSON.stringify(measured.result), /PRIVATE|unrelated|command arguments/);
  return detail;
}

test("resource sampler records safe ps failure without losing the cumulative error", async () => {
  let broken = true;
  const measured = measurements(samplerFixture({ ps: () => { if (broken) throw failure("EACCES"); return { stdout: processListing() }; } }));
  try {
    await measured.sample();
    assert.equal(diagnostic(measured, "PS_EXEC_FAILED", "ps-exec").errno, "EACCES");
    broken = false; await measured.sample();
    assert.equal(measured.result.sampleCount, 1);
    assert.equal(measured.result.samplingErrors, 1, "later successful samples must not erase the failure gate");
  } finally { await measured.stop(); }
});

test("resource sampler diagnoses malformed attribution without exposing another process line", async () => {
  const measured = measurements(samplerFixture({ ps: () => ({ stdout: `${processListing()}PRIVATE other user command\n` }) }));
  try { await measured.sample(); diagnostic(measured, "PS_OUTPUT_INVALID", "ps-parse"); }
  finally { await measured.stop(); }
});

test("resource sampler requires unique RSS attribution including its live root", async () => {
  for (const stdout of [`${childPid} 1 50 postgres\n`, processListing() + `${process.pid} 1 100 node\n`]) {
    const measured = measurements(samplerFixture({ ps: () => ({ stdout }) }));
    try { await measured.sample(); diagnostic(measured, "RSS_ATTRIBUTION_INVALID", "ownership"); }
    finally { await measured.stop(); }
  }
});

test("resource sampler preserves bounded lsof execution diagnostics", async () => {
  for (const code of ["ENOENT", "PRIVATE errno", 1, 2]) {
    const measured = measurements(samplerFixture({ lsof: () => { throw failure(code); } }));
    try {
      await measured.sample(); const detail = diagnostic(measured, "LSOF_EXEC_FAILED", "lsof-exec");
      if (code === "ENOENT") assert.equal(detail.errno, code);
      else if (typeof code === "number") assert.equal(detail.exitCode, code);
      else assert.equal(detail.errno, undefined);
    } finally { await measured.stop(); }
  }
});

test("resource sampler restricts phase and signal diagnostics to safe vocabulary", async () => {
  const measured = measurements({ ...samplerFixture({ ps: () => {
    throw Object.assign(failure("PRIVATE errno"), { signal: "SIGTERM" });
  } }), phase: () => "PRIVATE environment" });
  await measured.sample(); await measured.stop();
  assert.equal(measured.result.samplingErrors, 2);
  for (const detail of measured.result.samplingErrorDetails) {
    assert.equal(detail.phase, "unknown"); assert.equal(detail.signal, "SIGTERM");
    assert.equal(detail.errno, undefined); assert.equal(detail.exitCode, undefined);
  }
  assert.doesNotMatch(JSON.stringify(measured.result), /PRIVATE/);
});

test("resource sampler rejects live processes missing from successful or partial lsof output", async () => {
  for (const partial of [false, true]) {
    const measured = measurements(samplerFixture({ lsof: () => {
      const output = { stdout: `p${process.pid}\nf0\n`, stderr: "" };
      if (partial) throw Object.assign(new Error("PRIVATE"), output, { code: 1 });
      return output;
    } }));
    try {
      await measured.sample();
      assert.equal(diagnostic(measured, "LSOF_MISSING_LIVE_PROCESS", "lsof-coverage").pid, childPid);
    } finally { await measured.stop(); }
  }
});

test("resource sampler accepts only confirmed exited owned children, not permission failures", async () => {
  for (const code of ["ESRCH", "EPERM"]) {
    const measured = measurements(samplerFixture({
      lsof: () => { throw Object.assign(new Error("PRIVATE"), { code: 1, stderr: "", stdout: `p${process.pid}\nf0\n` }); },
      probePid: (pid) => { assert.equal(pid, childPid); throw failure(code); }
    }));
    try {
      await measured.sample();
      if (code === "ESRCH") {
        assert.equal(measured.result.samplingErrors, 0); assert.equal(measured.result.exitedDuringSample, 1);
        assert.equal(measured.result.sampleCount, 1);
      } else {
        assert.equal(diagnostic(measured, "PID_PROBE_FAILED", "pid-probe").errno, "EPERM");
        assert.equal(measured.result.exitedDuringSample, 0);
      }
    } finally { await measured.stop(); }
  }
});

test("resource sampler does not accept an absent root or foreign descriptor attribution", async () => {
  for (const stdout of [`p${childPid}\nf0\n`, `${descriptorListing()}p${otherPid}\nf0\n`]) {
    const measured = measurements(samplerFixture({ lsof: () => ({ stdout }) }));
    try {
      await measured.sample();
      diagnostic(measured, "LSOF_ATTRIBUTION_INVALID", "lsof-coverage");
    } finally { await measured.stop(); }
  }
});

test("resource sampler caps stored error details but never caps or resets the error count", async () => {
  const measured = measurements(samplerFixture({ ps: () => { throw failure("EIO"); } }));
  for (let i = 0; i < 35; i++) await measured.sample();
  await measured.stop();
  assert.equal(measured.result.samplingErrors, 36);
  assert.equal(measured.result.sampleCount, 0);
  assert.equal(measured.result.samplingErrorDetailLimit, 32);
  assert.equal(measured.result.samplingErrorDetails.length, 32);
  assert.equal(measured.result.samplingErrorDetailsDropped, 4);
  assert.doesNotMatch(JSON.stringify(measured.result), /PRIVATE/);
});

test("resource sampler keeps exact owned RSS and numeric descriptor accounting", async () => {
  const measured = measurements(samplerFixture());
  await measured.sample(); await measured.stop();
  assert.equal(measured.result.samplingErrors, 0);
  assert.deepEqual(measured.result.samplingErrorDetails, []);
  assert.equal(measured.result.sampleCount, 2);
  assert.deepEqual(measured.result.peakRssProcesses.map(({ pid }) => pid), [process.pid, childPid]);
  assert.equal(measured.result.peakObservedProcessTreeRssBytes, 150 * 1024);
  assert.equal(measured.result.peakObservedProcessTreeFileDescriptors, 3);
});

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

test("B-01/03/04/07 isolated real service pilot preserves history and transmits only missing new-version bytes", { skip: !process.env.F001_TEST_PG_BIN, timeout: 120000 }, async (t) => {
  // The whole tree includes PostgreSQL's relation/index descriptors; the
  // calibrated small fixture used 421, independently of the content read cap.
  const progress = [];
  const report = await sourceTruthPilot({ filesPerSource: 10, postgresBin: process.env.F001_TEST_PG_BIN, maxTreeRssBytes: 1024 * 1024 * 1024, maxTreeFileDescriptors: 1024,
    onProgress: (event) => progress.push(event) });
  assert.equal(report.status, "PASSED");
  assert.equal(report.totalFiles, 20);
  assert.equal(report.bundleIds.length, 3);
  assert.equal(new Set(report.bundleIds).size, 3);
  assert.equal(report.browserVerified, false);
  assert.equal(report.disasterDeploymentVerified, false);
  const finalMeasurement = progress.find((event) => event.phase === "resource-measurements");
  assert.ok(finalMeasurement.sampleCount > 0);
  assert.equal(finalMeasurement.samplingErrors, 0);
  assert.deepEqual(finalMeasurement.samplingErrorDetails, []);
  assert.equal(finalMeasurement.sampleCount, report.resources.sampleCount);
  assert.equal(report.phases.length, 5);
  t.diagnostic(JSON.stringify({ scope: "NATIVE_20_FILE_PILOT_NOT_100K", sampleCount: report.resources.sampleCount,
    samplingErrors: report.resources.samplingErrors, samplingErrorDetails: report.resources.samplingErrorDetails,
    peakObservedProcessTreeRssBytes: report.resources.peakObservedProcessTreeRssBytes,
    peakObservedProcessTreeFileDescriptors: report.resources.peakObservedProcessTreeFileDescriptors, budgets: report.budgets }));
});
