import { deepFreeze } from "./canonical-json.js";
import {
  ClaimSourceType,
  ClaimType,
  ConstraintOperator,
  DecisionType,
  EvidenceSupport,
  assertEnum,
  requireIsoTimestamp,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";

function optionalString(value, fieldName) {
  if (value === undefined || value === null) return null;
  return requireNonEmptyString(value, fieldName);
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return structuredClone(value);
}

function normalizeConstraint(value, fieldName) {
  if (value === undefined || value === null) return null;
  const constraint = requireObject(value, fieldName);
  if (Object.keys(constraint).some((field) => !["dimension", "operator", "value"].includes(field))) {
    throw new TypeError(`${fieldName} contains an unsupported field`);
  }
  if (!("value" in constraint)) throw new TypeError(`${fieldName}.value is required`);
  return {
    dimension: requireNonEmptyString(constraint.dimension, `${fieldName}.dimension`),
    operator: assertEnum(ConstraintOperator, constraint.operator, `${fieldName}.operator`),
    value: structuredClone(constraint.value),
  };
}

export function createFeatureVersion(input, clock = () => new Date()) {
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "feature.id"),
    version: requirePositiveInteger(input?.version, "feature.version"),
    name: requireNonEmptyString(input?.name, "feature.name"),
    businessDomain: optionalString(input?.businessDomain, "feature.businessDomain"),
    description: optionalString(input?.description, "feature.description"),
    createdAt: input?.createdAt ?? clock().toISOString(),
  });
}

export function createClaimScope(input, clock = () => new Date()) {
  const effectiveFrom = optionalString(input?.effectiveFrom, "scope.effectiveFrom");
  const effectiveTo = optionalString(input?.effectiveTo, "scope.effectiveTo");
  if (effectiveFrom) requireIsoTimestamp(effectiveFrom, "scope.effectiveFrom");
  if (effectiveTo) requireIsoTimestamp(effectiveTo, "scope.effectiveTo");
  if (effectiveFrom && effectiveTo && Date.parse(effectiveFrom) > Date.parse(effectiveTo)) {
    throw new RangeError("scope.effectiveFrom must be earlier than or equal to scope.effectiveTo");
  }
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "scope.id"),
    version: requirePositiveInteger(input?.version, "scope.version"),
    scope: requireObject(input?.scope, "scope.scope"),
    effectiveFrom,
    effectiveTo,
    createdAt: input?.createdAt ?? clock().toISOString(),
  });
}

export function createClaim(input, clock = () => new Date()) {
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "claim.id"),
    version: requirePositiveInteger(input?.version, "claim.version"),
    featureId: requireNonEmptyString(input?.featureId, "claim.featureId"),
    type: assertEnum(ClaimType, input?.type, "claim.type"),
    statement: requireNonEmptyString(input?.statement, "claim.statement"),
    sourceType: assertEnum(ClaimSourceType, input?.sourceType, "claim.sourceType"),
    evidenceSupport: assertEnum(EvidenceSupport, input?.evidenceSupport, "claim.evidenceSupport"),
    constraint: normalizeConstraint(input?.constraint, "claim.constraint"),
    scopeId: requireNonEmptyString(input?.scopeId, "claim.scopeId"),
    scopeVersion: requirePositiveInteger(input?.scopeVersion, "claim.scopeVersion"),
    provenance: requireObject(input?.provenance ?? {}, "claim.provenance"),
    createdAt: input?.createdAt ?? clock().toISOString(),
  });
}

export function createDecision(input, clock = () => new Date()) {
  const validUntil = optionalString(input?.validUntil, "decision.validUntil");
  if (validUntil) requireIsoTimestamp(validUntil, "decision.validUntil");
  if (input?.evidenceRefs !== undefined && !Array.isArray(input.evidenceRefs)) {
    throw new TypeError("decision.evidenceRefs must be an array");
  }
  const evidenceRefs = [...new Set((input?.evidenceRefs ?? []).map((item, index) =>
    requireNonEmptyString(item, `decision.evidenceRefs[${index}]`),
  ))];
  const type = assertEnum(DecisionType, input?.type, "decision.type");
  const content = optionalString(input?.content, "decision.content");
  if (type === DecisionType.EXCEPTION_RECORDED && !content) {
    throw new TypeError("decision.content is required for EXCEPTION_RECORDED");
  }
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "decision.id"),
    claimId: requireNonEmptyString(input?.claimId, "decision.claimId"),
    claimVersion: requirePositiveInteger(input?.claimVersion, "decision.claimVersion"),
    scopeId: requireNonEmptyString(input?.scopeId, "decision.scopeId"),
    scopeVersion: requirePositiveInteger(input?.scopeVersion, "decision.scopeVersion"),
    type,
    content,
    actorId: requireNonEmptyString(input?.actorId, "decision.actorId"),
    actorRole: requireNonEmptyString(input?.actorRole, "decision.actorRole"),
    evidenceRefs,
    validUntil,
    createdAt: input?.createdAt ?? clock().toISOString(),
  });
}
