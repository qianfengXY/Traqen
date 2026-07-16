import { ChangeType, assertEnum } from "./model.js";

const rules = Object.freeze({
  [ChangeType.SOURCE_CODE]: ["IMPLEMENTATION_MAPPING", "CONFORMANCE", "VERIFICATION", "TRACE_CHAIN"],
  [ChangeType.API_CONTRACT]: ["IMPLEMENTATION_MAPPING", "CONFORMANCE", "TEST_COVERAGE", "VERIFICATION", "TRACE_CHAIN"],
  [ChangeType.SQL]: ["IMPLEMENTATION_MAPPING", "CONFORMANCE", "VERIFICATION", "TRACE_CHAIN"],
  [ChangeType.DATABASE_SCHEMA]: ["IMPLEMENTATION_MAPPING", "CONFORMANCE", "TEST_COVERAGE", "VERIFICATION", "TRACE_CHAIN"],
  [ChangeType.CONFIGURATION]: ["CONFORMANCE", "VERIFICATION", "TRACE_CHAIN"],
  [ChangeType.FEATURE_FLAG]: ["CLAIM_SCOPE_MATCH", "CONFORMANCE", "VERIFICATION", "TRACE_CHAIN"],
  [ChangeType.DEPENDENCY]: ["IMPLEMENTATION_MAPPING", "CONFORMANCE", "VERIFICATION", "TRACE_CHAIN"],
  [ChangeType.TEST_SPEC]: ["TEST_APPROVAL", "TEST_COVERAGE", "VERIFICATION", "TRACE_CHAIN"],
  [ChangeType.DEPLOYMENT]: ["VERIFICATION", "EVIDENCE_FRESHNESS", "TRACE_CHAIN"],
  [ChangeType.RUNTIME_CONTEXT]: ["CLAIM_SCOPE_MATCH", "CONFORMANCE", "VERIFICATION", "EVIDENCE_FRESHNESS", "TRACE_CHAIN"],
  [ChangeType.BUSINESS_AUTHORITY]: ["NORMATIVE_CLAIM", "DECISION", "CONFORMANCE", "TEST_COVERAGE", "TRACE_CHAIN"],
  [ChangeType.CLAIM_SCOPE]: ["NORMATIVE_CLAIM_VERSION", "DECISION", "CLAIM_SCOPE_MATCH", "CONFORMANCE", "TEST_COVERAGE", "TRACE_CHAIN"],
  [ChangeType.CONTRADICTORY_EVIDENCE]: ["CONFORMANCE", "VERIFICATION", "CONFLICT_STATUS", "TRACE_CHAIN"],
});

const alwaysPreserved = Object.freeze(["HISTORICAL_FACT", "HISTORICAL_EVIDENCE", "AUDIT_EVENT"]);

export function invalidationFor(change) {
  if (change === null || typeof change !== "object" || Array.isArray(change)) {
    throw new TypeError("change must be an object");
  }

  const type = assertEnum(ChangeType, change.type, "change.type");
  const invalidates = rules[type];
  const preserves = [...alwaysPreserved];

  if (![ChangeType.BUSINESS_AUTHORITY, ChangeType.CLAIM_SCOPE].includes(type)) {
    preserves.push("NORMATIVE_CLAIM", "BUSINESS_DECISION");
  }

  return Object.freeze({
    changeType: type,
    scope: change.scope ?? null,
    invalidates: Object.freeze([...invalidates]),
    preserves: Object.freeze(preserves),
  });
}
