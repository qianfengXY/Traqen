import { deepFreeze } from "./canonical-json.js";
import {
  ClaimSourceType,
  ClaimType,
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
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "decision.id"),
    claimId: requireNonEmptyString(input?.claimId, "decision.claimId"),
    claimVersion: requirePositiveInteger(input?.claimVersion, "decision.claimVersion"),
    scopeId: requireNonEmptyString(input?.scopeId, "decision.scopeId"),
    scopeVersion: requirePositiveInteger(input?.scopeVersion, "decision.scopeVersion"),
    type: assertEnum(DecisionType, input?.type, "decision.type"),
    content: optionalString(input?.content, "decision.content"),
    actorId: requireNonEmptyString(input?.actorId, "decision.actorId"),
    actorRole: requireNonEmptyString(input?.actorRole, "decision.actorRole"),
    evidenceRefs: [...new Set(input?.evidenceRefs ?? [])],
    validUntil,
    createdAt: input?.createdAt ?? clock().toISOString(),
  });
}
