const enumValues = (values) => Object.freeze(Object.fromEntries(values.map((value) => [value, value])));

export const ClaimType = enumValues([
  "NORMATIVE_REQUIREMENT",
  "IMPLEMENTATION_BEHAVIOR",
  "DESIGN_INTENT",
  "QUALITY_EXPECTATION",
]);

export const ClaimSourceType = enumValues([
  "AI_CANDIDATE",
  "HUMAN",
  "FORMAL_AUTHORITY",
  "DETERMINISTIC_DERIVATION",
]);

export const DecisionType = enumValues([
  "CONFIRMED",
  "REJECTED",
  "EXCEPTION_RECORDED",
  "INSUFFICIENT_EVIDENCE",
  "DEFERRED",
  "DEPRECATED",
]);

export const TestRisk = enumValues(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const TestOperationLevel = enumValues([
  "SAFE_READ",
  "CONTROLLED_WRITE",
  "DESTRUCTIVE",
  "EXTERNAL_SIDE_EFFECT",
]);

export const TestExecutor = enumValues(["HTTP", "DATABASE", "EXISTING_TEST"]);

export const TestSpecViolationSeverity = enumValues(["WARNING", "BLOCKING"]);

export const AssertionResultStatus = enumValues(["PASS", "FAIL", "ERROR", "INCONCLUSIVE", "SKIPPED"]);

export const ExecutionCompletionReason = enumValues(["COMPLETED", "SKIPPED", "CANCELLED"]);

export const ExecutionPhaseStatus = enumValues(["PASS", "FAIL", "ERROR", "SKIPPED"]);

export const EvidenceType = enumValues([
  "HTTP",
  "DATABASE",
  "LOG",
  "TRACE",
  "COVERAGE",
  "SCREENSHOT",
  "ASSERTION",
  "OTHER",
]);

export const FactNodeType = enumValues([
  "ARTIFACT",
  "MODULE",
  "CODE_SYMBOL",
  "ENDPOINT",
  "DATA_OBJECT",
  "CONFIGURATION",
  "EXTERNAL_DEPENDENCY",
  "TEST_ASSET",
]);

export const FactPredicate = enumValues([
  "CONTAINS",
  "IMPLEMENTED_BY",
  "CALLS",
  "READS",
  "WRITES",
  "CONTROLLED_BY",
  "DEPENDS_ON",
  "EXERCISES",
]);

export const AuthorityStatus = enumValues([
  "UNREVIEWED",
  "CONFIRMED",
  "EXCEPTION_RECORDED",
  "REJECTED",
  "DEPRECATED",
]);

export const EvidenceSupport = enumValues([
  "NONE",
  "SINGLE_SOURCE",
  "MULTI_SOURCE",
  "CONTRADICTED",
  "INCOMPLETE",
]);

export const ConformanceStatus = enumValues([
  "UNKNOWN",
  "CONFORMS",
  "DEVIATES",
  "PARTIAL",
  "CONFLICTED",
  "STALE",
]);

export const VerificationStatus = enumValues([
  "NOT_RUN",
  "PASS",
  "FAIL",
  "ERROR",
  "INCONCLUSIVE",
  "SKIPPED",
  "CANCELLED",
]);

export const EvidenceFreshness = enumValues([
  "FRESH",
  "EXPIRING",
  "STALE",
  "INCOMPLETE",
]);

export const IntegrityStatus = enumValues([
  "VERIFIED",
  "UNVERIFIED",
  "INVALID",
]);

export const TraceGapType = enumValues([
  "MISSING_NORMATIVE_CLAIM",
  "MISSING_AUTHORITY",
  "SCOPE_UNKNOWN",
  "SNAPSHOT_INCOMPLETE",
  "IMPLEMENTATION_UNMAPPED",
  "CONFORMANCE_UNKNOWN",
  "CONFORMANCE_STALE",
  "IMPLEMENTATION_DEVIATES",
  "UNRESOLVED_CONFLICT",
  "NO_TEST_SPEC",
  "TEST_SPEC_NOT_LINKED",
  "TEST_SPEC_UNAPPROVED",
  "NO_ASSERTION",
  "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT",
  "VERIFICATION_FAILED",
  "EXECUTION_ERROR",
  "VERIFICATION_INCONCLUSIVE",
  "EVIDENCE_MISSING",
  "EVIDENCE_UNVERIFIED",
  "EVIDENCE_EXPIRING",
  "EVIDENCE_STALE",
]);

export const GapSeverity = enumValues(["INFO", "WARNING", "BLOCKING"]);

export const ChangeType = enumValues([
  "SOURCE_CODE",
  "API_CONTRACT",
  "SQL",
  "DATABASE_SCHEMA",
  "CONFIGURATION",
  "FEATURE_FLAG",
  "DEPENDENCY",
  "TEST_SPEC",
  "DEPLOYMENT",
  "RUNTIME_CONTEXT",
  "BUSINESS_AUTHORITY",
  "CLAIM_SCOPE",
  "CONTRADICTORY_EVIDENCE",
]);

export function assertEnum(enumObject, value, fieldName) {
  if (!Object.hasOwn(enumObject, value)) {
    throw new TypeError(`${fieldName} must be one of: ${Object.keys(enumObject).join(", ")}`);
  }
  return value;
}

export function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

export function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

export function requireIsoTimestamp(value, fieldName) {
  requireNonEmptyString(value, fieldName);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${fieldName} must be an ISO-8601 timestamp`);
  }
  return timestamp;
}

export function requirePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return value;
}
