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
  assert.ok(result.firstSnapshot.candidateTestSpecs >= 1);
  assert.equal(result.firstSnapshot.execution, "PASS");
  assert.match(result.firstSnapshot.deploymentArtifactDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.firstSnapshot.evidenceTypes, ["ASSERTION", "DATABASE", "HTTP", "LOG", "OTHER", "TRACE"]);
  assert.equal(result.firstSnapshot.traceComplete, true);
  assert.deepEqual(result.change.affectedFeatures, ["FEATURE-ORDER-SUBMIT"]);
  assert.ok(result.change.staleGapTypes.includes("CONFORMANCE_STALE"));
  assert.equal(result.change.deploymentArtifactChanged, true);
  assert.equal(result.change.preservedAuthority, "CONFIRMED");
  assert.equal(result.repair.conformance, "CONFORMS");
  assert.equal(result.repair.historicalEvidenceRejected, true);
  assert.equal(result.repair.regressionExecution, "PASS");
  assert.equal(result.repair.finalTraceComplete, true);
  assert.equal(result.repair.finalGapCount, 0);
  assert.match(result.graph.snapshotManifestId, /^SNAPSHOT-/);
  assert.ok(result.graph.nodes >= 10);
  assert.ok(result.graph.edges >= 10);
  assert.ok(result.graph.assertions >= 2);
  assert.equal(result.graph.featureToEvidencePathFound, true);
  assert.ok(result.graph.featureToEvidenceHops >= 3);
  assert.equal(result.continuousProtection.selectionStrategy, "TARGETED_UNION_HIGH_RISK");
  assert.deepEqual(result.continuousProtection.selectedTestSpecIds, ["TEST-ORDER-SUBMIT"]);
  assert.equal(result.continuousProtection.staleStatus, "BLOCKED");
  assert.equal(result.continuousProtection.staleEnforcement, "WARN");
  assert.equal(result.continuousProtection.finalStatus, "PASS");
  assert.equal(result.continuousProtection.finalEnforcement, "PASS");
});
