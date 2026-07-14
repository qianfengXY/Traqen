import assert from "node:assert/strict";
import test from "node:test";

import { TraceGapType, evaluateTraceChain } from "../src/domain/index.js";
import { completeInput, fixedClock } from "./fixtures.js";

test("a fully evidenced current deployment produces a complete trace chain", () => {
  const chain = evaluateTraceChain(completeInput(), fixedClock);

  assert.equal(chain.complete, true);
  assert.deepEqual(chain.gaps, []);
  assert.deepEqual(chain.dimensions, {
    authority: "CONFIRMED",
    evidenceSupport: "MULTI_SOURCE",
    conformance: "CONFORMS",
    verification: "PASS",
    freshness: "FRESH",
    conflict: "NONE",
  });
  assert.equal(chain.computedAt, "2026-07-14T02:00:00.000Z");
});

test("missing links remain explicit instead of being hidden by a passing test", () => {
  const input = completeInput();
  input.claim.authorityStatus = "UNREVIEWED";
  delete input.scope;
  input.implementation = {};
  input.conformance.status = "UNKNOWN";

  const chain = evaluateTraceChain(input, fixedClock);
  const gapTypes = chain.gaps.map((item) => item.type);

  assert.equal(chain.complete, false);
  assert.ok(gapTypes.includes(TraceGapType.MISSING_AUTHORITY));
  assert.ok(gapTypes.includes(TraceGapType.SCOPE_UNKNOWN));
  assert.ok(gapTypes.includes(TraceGapType.IMPLEMENTATION_UNMAPPED));
  assert.ok(gapTypes.includes(TraceGapType.CONFORMANCE_UNKNOWN));
  assert.equal(chain.dimensions.verification, "PASS");
});

test("execution from another deployment cannot prove the selected deployment", () => {
  const input = completeInput();
  input.execution.deploymentId = "DEPLOY-OLD";

  const chain = evaluateTraceChain(input, fixedClock);

  assert.equal(chain.complete, false);
  assert.ok(
    chain.gaps.some((item) => item.type === TraceGapType.NOT_EXECUTED_ON_CURRENT_DEPLOYMENT),
  );
  assert.equal(chain.dimensions.verification, "NOT_RUN");
});

test("conformance from another manifest cannot prove the current implementation", () => {
  const input = completeInput();
  input.conformance.snapshotManifestId = "SNAPSHOT-MANIFEST-OLD";

  const chain = evaluateTraceChain(input, fixedClock);

  assert.equal(chain.dimensions.conformance, "STALE");
  assert.ok(chain.gaps.some((item) => item.type === TraceGapType.CONFORMANCE_STALE));
});

test("an unrelated TestSpec cannot close the rule-to-test link", () => {
  const input = completeInput();
  input.testSpec.verifiesClaims = [{ id: "CLAIM-OTHER", version: 1 }];

  const chain = evaluateTraceChain(input, fixedClock);

  assert.equal(chain.complete, false);
  assert.ok(chain.gaps.some((item) => item.type === TraceGapType.TEST_SPEC_NOT_LINKED));
});

test("failed verification is distinct from execution error", () => {
  const failedInput = completeInput();
  failedInput.execution.status = "FAIL";
  const failed = evaluateTraceChain(failedInput, fixedClock);

  const errorInput = completeInput();
  errorInput.execution.status = "ERROR";
  const errored = evaluateTraceChain(errorInput, fixedClock);

  assert.ok(failed.gaps.some((item) => item.type === TraceGapType.VERIFICATION_FAILED));
  assert.ok(errored.gaps.some((item) => item.type === TraceGapType.EXECUTION_ERROR));
});

test("an execution of an older TestSpec version cannot close the chain", () => {
  const input = completeInput();
  input.execution.testSpecVersion = 0;

  const chain = evaluateTraceChain(input, fixedClock);

  assert.equal(chain.dimensions.verification, "NOT_RUN");
  assert.equal(chain.dimensions.freshness, "STALE");
  assert.ok(
    chain.gaps.some((item) => item.type === TraceGapType.NOT_EXECUTED_ON_CURRENT_DEPLOYMENT),
  );
});

test("stale or unsigned evidence breaks the chain", () => {
  const input = completeInput();
  input.evidence[0].freshness = "STALE";
  input.evidence[0].integrity = "UNVERIFIED";

  const chain = evaluateTraceChain(input, fixedClock);
  const gapTypes = chain.gaps.map((item) => item.type);

  assert.ok(gapTypes.includes(TraceGapType.EVIDENCE_STALE));
  assert.ok(gapTypes.includes(TraceGapType.EVIDENCE_UNVERIFIED));
  assert.equal(chain.dimensions.freshness, "STALE");
});

test("expiring evidence remains a distinct freshness state", () => {
  const input = completeInput();
  input.evidence[0].freshness = "EXPIRING";

  const chain = evaluateTraceChain(input, fixedClock);

  assert.equal(chain.dimensions.freshness, "EXPIRING");
  assert.equal(chain.complete, true);
  assert.ok(chain.gaps.some((item) => item.type === TraceGapType.EVIDENCE_EXPIRING));
  assert.ok(chain.gaps.some((item) => item.severity === "WARNING"));
});
