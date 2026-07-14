import assert from "node:assert/strict";
import test from "node:test";

import { assertTestSpecSafeToStore, createTestSpec, validateTestSpec } from "../src/domain/index.js";

const fixedClock = () => new Date("2026-07-14T06:00:00.000Z");

function testSpecInput(overrides = {}) {
  return {
    id: "TEST-ORDER-SUBMIT-001",
    version: 1,
    name: "Submit a draft order",
    risk: "HIGH",
    approved: true,
    approval: {
      actorId: "USER-001",
      actorRole: "quality-owner",
      approvedAt: "2026-07-14T05:59:00.000Z",
    },
    featureId: "FEATURE-ORDER-001",
    verifiesClaims: [{ id: "CLAIM-ORDER-STATUS-001", version: 1 }],
    sourceSnapshotId: "SNAPSHOT-MANIFEST-001",
    environment: { target: "sit", operationLevel: "CONTROLLED_WRITE" },
    variables: {
      orderId: "${seed.order.id}",
      accessToken: { secretRef: "accounts/normal-user/token" },
    },
    steps: [{ id: "submit", executor: "HTTP", method: "POST", path: "/orders/${orderId}/submit" }],
    assertions: [{ id: "status", type: "HTTP_STATUS", expected: 200 }],
    cleanup: { strategy: "SEED_RESET" },
    policy: { approvalRequired: true, destructive: false, externalSideEffect: false },
    ...overrides,
  };
}

test("TestSpec factory creates an immutable, traceable protocol record", () => {
  const spec = createTestSpec(testSpecInput(), fixedClock);

  assert.equal(spec.createdAt, "2026-07-14T06:00:00.000Z");
  assert.equal(spec.verifiesClaims[0].version, 1);
  assert.equal(Object.isFrozen(spec.steps[0]), true);
  assert.equal(Object.isFrozen(spec.variables.accessToken), true);
});

test("approved controlled writes with assertions and cleanup are executable", () => {
  const result = validateTestSpec(testSpecInput(), fixedClock);

  assert.equal(result.valid, true);
  assert.equal(result.executable, true);
  assert.deepEqual(result.violations, []);
});

test("validation keeps approval, cleanup, and assertion gaps distinct", () => {
  const result = validateTestSpec(
    testSpecInput({ approved: false, approval: null, assertions: [], cleanup: null }),
    fixedClock,
  );

  assert.equal(result.valid, true);
  assert.equal(result.executable, false);
  assert.deepEqual(
    result.violations.map((item) => item.code),
    ["NO_ASSERTION", "APPROVAL_REQUIRED", "CLEANUP_REQUIRED"],
  );
});

test("raw secrets are invalid and cannot enter storage", () => {
  const input = testSpecInput({ variables: { password: "plaintext" } });
  const result = validateTestSpec(input, fixedClock);

  assert.equal(result.valid, false);
  assert.equal(result.executable, false);
  assert.equal(result.violations[0].code, "RAW_SECRET_FORBIDDEN");
  assert.throws(() => assertTestSpecSafeToStore(createTestSpec(input, fixedClock)), /must use secretRef/);
});

test("literal authorization headers are rejected while secret templates are allowed", () => {
  const literal = validateTestSpec(
    testSpecInput({
      steps: [{ id: "submit", executor: "HTTP", headers: { Authorization: "Bearer raw-token" } }],
    }),
    fixedClock,
  );
  const referenced = validateTestSpec(
    testSpecInput({
      steps: [{ id: "submit", executor: "HTTP", headers: { Authorization: "Bearer ${accessToken}" } }],
    }),
    fixedClock,
  );

  assert.equal(literal.valid, false);
  assert.equal(literal.violations[0].path, "/steps/0/headers/Authorization");
  assert.equal(referenced.valid, true);
});

test("destructive and external side effects remain blocked even when approved", () => {
  const destructive = validateTestSpec(
    testSpecInput({ environment: { target: "sit", operationLevel: "DESTRUCTIVE" } }),
    fixedClock,
  );
  const external = validateTestSpec(
    testSpecInput({ environment: { target: "sit", operationLevel: "EXTERNAL_SIDE_EFFECT" } }),
    fixedClock,
  );

  assert.equal(destructive.violations[0].code, "DESTRUCTIVE_BLOCKED");
  assert.equal(external.violations[0].code, "EXTERNAL_SIDE_EFFECT_BLOCKED");
});

test("step and assertion identifiers cannot be ambiguous", () => {
  const result = validateTestSpec(
    testSpecInput({
      assertions: [
        { id: "status", type: "HTTP_STATUS", expected: 200 },
        { id: "status", type: "JSON_PATH", expected: "SUBMITTED" },
      ],
    }),
    fixedClock,
  );

  assert.equal(result.valid, false);
  assert.match(result.violations[0].message, /unique ids/);
});

test("approval provenance must match the approval state", () => {
  const missingApprover = validateTestSpec(testSpecInput({ approval: null }), fixedClock);
  const unapprovedWithActor = validateTestSpec(
    testSpecInput({ approved: false }),
    fixedClock,
  );

  assert.equal(missingApprover.valid, false);
  assert.match(missingApprover.violations[0].message, /approval must be an object/);
  assert.equal(unapprovedWithActor.valid, false);
  assert.match(unapprovedWithActor.violations[0].message, /must be null/);

  const futureApproval = validateTestSpec(
    testSpecInput({
      approval: {
        actorId: "USER-001",
        actorRole: "quality-owner",
        approvedAt: "2026-07-14T06:01:00.000Z",
      },
    }),
    fixedClock,
  );
  assert.equal(futureApproval.valid, false);
  assert.match(futureApproval.violations[0].message, /must not be later/);
});
