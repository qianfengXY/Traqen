import assert from "node:assert/strict";
import test from "node:test";

import { ChangeType, invalidationFor } from "../src/domain/index.js";

test("source code changes preserve normative claims and business decisions", () => {
  const result = invalidationFor({ type: ChangeType.SOURCE_CODE, scope: "OrderService.submit" });

  assert.ok(result.invalidates.includes("CONFORMANCE"));
  assert.ok(result.invalidates.includes("VERIFICATION"));
  assert.ok(result.preserves.includes("NORMATIVE_CLAIM"));
  assert.ok(result.preserves.includes("BUSINESS_DECISION"));
  assert.ok(!result.invalidates.includes("DECISION"));
});

test("TestSpec changes invalidate verification but not conformance or business intent", () => {
  const result = invalidationFor({ type: ChangeType.TEST_SPEC });

  assert.deepEqual(result.invalidates, ["TEST_APPROVAL", "TEST_COVERAGE", "VERIFICATION", "TRACE_CHAIN"]);
  assert.ok(!result.invalidates.includes("CONFORMANCE"));
  assert.ok(result.preserves.includes("NORMATIVE_CLAIM"));
});

test("business authority changes create a new normative decision boundary", () => {
  const result = invalidationFor({ type: ChangeType.BUSINESS_AUTHORITY });

  assert.ok(result.invalidates.includes("NORMATIVE_CLAIM"));
  assert.ok(result.invalidates.includes("DECISION"));
  assert.ok(!result.preserves.includes("BUSINESS_DECISION"));
});
