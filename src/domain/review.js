import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import {
  CandidateReviewOutcome,
  ConformanceStatus,
  ImplementationMappingStatus,
  assertEnum,
  requireIsoTimestamp,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";

function requireObject(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function optionalString(value, fieldName) {
  return value === undefined || value === null ? null : requireNonEmptyString(value, fieldName);
}

function uniqueStrings(value, fieldName, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${fieldName} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const result = value.map((item, index) => requireNonEmptyString(item, `${fieldName}[${index}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${fieldName} must not contain duplicates`);
  return result;
}

function evidenceRefs(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${fieldName} must be a non-empty array`);
  const result = value.map((item, index) => {
    const ref = requireObject(item, `${fieldName}[${index}]`);
    if (Object.keys(ref).some((field) => !["factId", "relation"].includes(field))) {
      throw new TypeError(`${fieldName}[${index}] contains an unsupported field`);
    }
    return {
      factId: requireNonEmptyString(ref.factId, `${fieldName}[${index}].factId`),
      relation: requireNonEmptyString(ref.relation, `${fieldName}[${index}].relation`),
    };
  });
  return [...new Map(result.map((item) => [canonicalJson(item), item])).values()];
}

export function createImplementationMapping(input, clock = () => new Date()) {
  const createdAt = input?.createdAt ?? clock().toISOString();
  requireIsoTimestamp(createdAt, "implementationMapping.createdAt");
  const identity = {
    claimId: requireNonEmptyString(input?.claimId, "implementationMapping.claimId"),
    claimVersion: requirePositiveInteger(input?.claimVersion, "implementationMapping.claimVersion"),
    scopeId: requireNonEmptyString(input?.scopeId, "implementationMapping.scopeId"),
    scopeVersion: requirePositiveInteger(input?.scopeVersion, "implementationMapping.scopeVersion"),
    snapshotManifestId: requireNonEmptyString(
      input?.snapshotManifestId,
      "implementationMapping.snapshotManifestId",
    ),
    sourceComponentId: requireNonEmptyString(input?.sourceComponentId, "implementationMapping.sourceComponentId"),
    sourceRunId: requireNonEmptyString(input?.sourceRunId, "implementationMapping.sourceRunId"),
    sourceCandidateId: requireNonEmptyString(input?.sourceCandidateId, "implementationMapping.sourceCandidateId"),
  };
  return deepFreeze({
    id: input?.id ?? contentId("IMPLEMENTATION-MAPPING", identity),
    ...identity,
    status: assertEnum(
      ImplementationMappingStatus,
      input?.status ?? ImplementationMappingStatus.ACTIVE,
      "implementationMapping.status",
    ),
    factRefs: evidenceRefs(input?.factRefs, "implementationMapping.factRefs"),
    createdAt,
  });
}

function normalizeConstraint(value, fieldName) {
  if (value === null || value === undefined) return null;
  const constraint = requireObject(value, fieldName);
  if (!("dimension" in constraint) || !("operator" in constraint) || !("value" in constraint)) {
    throw new TypeError(`${fieldName} must contain dimension, operator, and value`);
  }
  return {
    dimension: requireNonEmptyString(constraint.dimension, `${fieldName}.dimension`),
    operator: requireNonEmptyString(constraint.operator, `${fieldName}.operator`),
    value: structuredClone(constraint.value),
  };
}

export function assessImplementationConformance(normativeConstraint, observedConstraint) {
  const normative = normalizeConstraint(normativeConstraint, "normativeConstraint");
  const observed = normalizeConstraint(observedConstraint, "observedConstraint");
  if (!normative || !observed || normative.dimension !== observed.dimension) return ConformanceStatus.UNKNOWN;
  if (canonicalJson(normative) === canonicalJson(observed)) return ConformanceStatus.CONFORMS;

  const sameValue = canonicalJson(normative.value) === canonicalJson(observed.value);
  const opposites = [
    ["EQUALS", "NOT_EQUALS"],
    ["ALLOWS", "FORBIDS"],
  ];
  if (
    opposites.some(([left, right]) =>
      sameValue &&
      ((normative.operator === left && observed.operator === right) ||
        (normative.operator === right && observed.operator === left)),
    ) ||
    (normative.operator === "EQUALS" && observed.operator === "EQUALS" && !sameValue)
  ) {
    return ConformanceStatus.DEVIATES;
  }
  return ConformanceStatus.UNKNOWN;
}

export function createImplementationConformance(input, clock = () => new Date()) {
  const computedAt = input?.computedAt ?? clock().toISOString();
  requireIsoTimestamp(computedAt, "conformance.computedAt");
  const identity = {
    claimId: requireNonEmptyString(input?.claimId, "conformance.claimId"),
    claimVersion: requirePositiveInteger(input?.claimVersion, "conformance.claimVersion"),
    scopeId: requireNonEmptyString(input?.scopeId, "conformance.scopeId"),
    scopeVersion: requirePositiveInteger(input?.scopeVersion, "conformance.scopeVersion"),
    snapshotManifestId: requireNonEmptyString(input?.snapshotManifestId, "conformance.snapshotManifestId"),
    mappingId: requireNonEmptyString(input?.mappingId, "conformance.mappingId"),
  };
  return deepFreeze({
    id: input?.id ?? contentId("IMPLEMENTATION-CONFORMANCE", identity),
    ...identity,
    status: assertEnum(ConformanceStatus, input?.status, "conformance.status"),
    evidenceRefs: uniqueStrings(input?.evidenceRefs ?? [], "conformance.evidenceRefs"),
    analysisMethod: structuredClone(requireObject(input?.analysisMethod, "conformance.analysisMethod")),
    computedAt,
  });
}

export function createReverseCandidateReview(input, clock = () => new Date()) {
  const outcome = assertEnum(CandidateReviewOutcome, input?.outcome, "candidateReview.outcome");
  const reviewedAt = input?.reviewedAt ?? clock().toISOString();
  requireIsoTimestamp(reviewedAt, "candidateReview.reviewedAt");
  const baselineRequired = [CandidateReviewOutcome.CONFIRMED, CandidateReviewOutcome.EXCEPTION_RECORDED].includes(outcome);
  const baselineRefs = input?.baselineRefs === null || input?.baselineRefs === undefined
    ? null
    : structuredClone(requireObject(input.baselineRefs, "candidateReview.baselineRefs"));
  if (baselineRequired !== Boolean(baselineRefs)) {
    throw new TypeError(`candidateReview.baselineRefs must be ${baselineRequired ? "present" : "absent"} for ${outcome}`);
  }
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "candidateReview.id"),
    requestFingerprint: requireNonEmptyString(input?.requestFingerprint, "candidateReview.requestFingerprint"),
    runId: requireNonEmptyString(input?.runId, "candidateReview.runId"),
    candidateId: requireNonEmptyString(input?.candidateId, "candidateReview.candidateId"),
    candidateType: "CLAIM",
    outcome,
    rationale: requireNonEmptyString(input?.rationale, "candidateReview.rationale"),
    actorId: requireNonEmptyString(input?.actorId, "candidateReview.actorId"),
    actorRole: requireNonEmptyString(input?.actorRole, "candidateReview.actorRole"),
    acknowledgedConflictIds: uniqueStrings(
      input?.acknowledgedConflictIds ?? [],
      "candidateReview.acknowledgedConflictIds",
    ),
    baselineRefs,
    reviewedAt,
  });
}
