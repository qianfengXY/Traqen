import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

test("built-in order pilot executes, invalidates, repairs, and re-proves one complete vertical chain", async () => {
  const { stdout, stderr } = await run(
    process.execPath,
    [new URL("../src/cli/run-order-submit-pilot.js", import.meta.url).pathname],
    { cwd: new URL("../", import.meta.url), timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.firstSnapshot.reverseSkills, 2);
  assert.equal(result.firstSnapshot.candidateSources, 2);
  assert.equal(result.firstSnapshot.execution, "PASS");
  assert.equal(result.firstSnapshot.traceComplete, true);
  assert.deepEqual(result.change.affectedFeatures, ["FEATURE-ORDER-SUBMIT"]);
  assert.ok(result.change.staleGapTypes.includes("CONFORMANCE_STALE"));
  assert.equal(result.change.preservedAuthority, "CONFIRMED");
  assert.equal(result.repair.conformance, "CONFORMS");
  assert.equal(result.repair.historicalEvidenceRejected, true);
  assert.equal(result.repair.regressionExecution, "PASS");
  assert.equal(result.repair.finalTraceComplete, true);
  assert.equal(result.repair.finalGapCount, 0);
});
