import assert from "node:assert/strict";
import test from "node:test";

import {
  createExecutionEvidenceBundle,
  createTestExecution,
  evidenceContentHash,
  signExecutionEvidenceBundle,
  verifyExecutionEvidenceAttestation,
} from "../src/domain/index.js";

const fixedClock = () => new Date("2026-07-14T06:10:00.000Z");

function executionInput(overrides = {}) {
  return {
    id: "EXEC-001",
    testSpecId: "TEST-001",
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
        stepResults: [{ id: "read", status: "PASS", durationMs: 12 }],
        assertionResults: [{ id: "http-status", status: "PASS", actual: 200 }],
        cleanup: { status: "SKIPPED" },
      },
    ],
    ...overrides,
  };
}

function assertionEvidence(execution, overrides = {}) {
  return {
    id: "EVIDENCE-ASSERTION-001",
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
      assertionResults: execution.attempts.flatMap((attempt) => attempt.assertionResults),
      redactions: [],
      ...overrides,
    },
  };
}

function passingBundle() {
  const execution = executionInput();
  return createExecutionEvidenceBundle(
    { execution, evidence: [assertionEvidence(execution)] },
    fixedClock,
  );
}

test("execution status is derived from deterministic assertion results", () => {
  const execution = createTestExecution({ ...executionInput(), status: "FAIL" });

  assert.equal(execution.status, "PASS");
  assert.equal(execution.attempts[0].setup.status, "SKIPPED");
  assert.equal(Object.isFrozen(execution.attempts[0].assertionResults[0]), true);
});

test("a failed retry remains visible and prevents a final PASS from overwriting it", () => {
  const retry = executionInput({
    finishedAt: "2026-07-14T06:06:00.000Z",
    attempts: [
      executionInput().attempts[0],
      {
        ...executionInput().attempts[0],
        number: 2,
        startedAt: "2026-07-14T06:05:00.000Z",
        finishedAt: "2026-07-14T06:06:00.000Z",
      },
    ],
  });
  retry.attempts[0].assertionResults[0].status = "FAIL";

  assert.equal(createTestExecution(retry).status, "FAIL");
});

test("evidence hashes are reproducible and runner attestations detect tampering", () => {
  const bundle = passingBundle();
  const signed = signExecutionEvidenceBundle("PROJECT-001", bundle, "runner-shared-secret");

  assert.equal(bundle.evidence[0].contentHash, evidenceContentHash(bundle.evidence[0].manifest));
  assert.equal(
    verifyExecutionEvidenceAttestation("PROJECT-001", signed, "runner-shared-secret"),
    true,
  );

  const tampered = structuredClone(signed);
  tampered.evidence[0].manifest.assertionResults[0].actual = 500;
  assert.equal(
    verifyExecutionEvidenceAttestation("PROJECT-001", tampered, "runner-shared-secret"),
    false,
  );
});

test("a PASS requires assertion evidence that exactly matches every attempt", () => {
  const execution = executionInput();
  assert.throws(
    () =>
      createExecutionEvidenceBundle(
        {
          execution,
          evidence: [
            {
              ...assertionEvidence(execution),
              type: "HTTP",
            },
          ],
        },
        fixedClock,
      ),
    /requires ASSERTION evidence/,
  );
  assert.throws(
    () =>
      createExecutionEvidenceBundle(
        {
          execution,
          evidence: [assertionEvidence(execution, { assertionResults: [] })],
        },
        fixedClock,
      ),
    /non-empty array/,
  );
});

test("evidence rejects unredacted sensitive values and wrong deployment bindings", () => {
  const execution = executionInput();
  assert.throws(
    () =>
      createExecutionEvidenceBundle(
        {
          execution,
          evidence: [assertionEvidence(execution, { Authorization: "Bearer raw-token" })],
        },
        fixedClock,
      ),
    /must be redacted/,
  );
  assert.throws(
    () =>
      createExecutionEvidenceBundle(
        {
          execution,
          evidence: [assertionEvidence(execution, { deploymentId: "DEPLOY-OTHER" })],
        },
        fixedClock,
      ),
    /deploymentId must match/,
  );
  const executionWithSecret = executionInput();
  executionWithSecret.attempts[0].stepResults[0].Authorization = "Bearer raw-token";
  assert.throws(() => createTestExecution(executionWithSecret), /execution sensitive value/);
});
