import { deepFreeze } from "./canonical-json.js";
import {
  DecisionApprovalMode,
  DecisionReviewAction,
  DecisionRisk,
  DecisionType,
  assertEnum,
  requireIsoTimestamp,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";

function optionalString(value, fieldName) {
  if (value === undefined || value === null) return null;
  return requireNonEmptyString(value, fieldName);
}

function stringArray(value, fieldName) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  const normalized = value.map((item, index) => requireNonEmptyString(item, `${fieldName}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${fieldName} must not contain duplicates`);
  return normalized;
}

function timestamp(value, fieldName, { optional = false } = {}) {
  if ((value === null || value === undefined) && optional) return null;
  requireIsoTimestamp(value, fieldName);
  return value;
}

export function createDecisionReviewCase(input, clock = () => new Date()) {
  const createdAt = input?.createdAt ?? clock().toISOString();
  const expiresAt = timestamp(input?.expiresAt, "decisionReviewCase.expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw new RangeError("decisionReviewCase.expiresAt must be later than createdAt");
  }
  const risk = assertEnum(DecisionRisk, input?.risk, "decisionReviewCase.risk");
  const approvalMode = assertEnum(
    DecisionApprovalMode,
    input?.approvalMode,
    "decisionReviewCase.approvalMode",
  );
  if ([DecisionRisk.HIGH, DecisionRisk.CRITICAL].includes(risk) && approvalMode === DecisionApprovalMode.SINGLE) {
    throw new TypeError("HIGH and CRITICAL Decisions cannot use SINGLE approval");
  }
  if ([DecisionRisk.LOW, DecisionRisk.MEDIUM].includes(risk) && approvalMode === DecisionApprovalMode.BREAK_GLASS) {
    throw new TypeError("BREAK_GLASS is reserved for HIGH or CRITICAL Decisions");
  }
  const validUntil = timestamp(input?.proposedDecision?.validUntil, "proposedDecision.validUntil", { optional: true });
  const emergencyReason = optionalString(input?.emergencyReason, "decisionReviewCase.emergencyReason");
  const postReviewDueAt = timestamp(
    input?.postReviewDueAt,
    "decisionReviewCase.postReviewDueAt",
    { optional: true },
  );
  if (approvalMode === DecisionApprovalMode.BREAK_GLASS) {
    if (!emergencyReason || !validUntil || !postReviewDueAt) {
      throw new TypeError("BREAK_GLASS requires emergencyReason, proposedDecision.validUntil, and postReviewDueAt");
    }
    if (Date.parse(validUntil) <= Date.parse(createdAt) || Date.parse(postReviewDueAt) <= Date.parse(createdAt)) {
      throw new RangeError("BREAK_GLASS validity and post-review deadline must be later than creation");
    }
  } else if (emergencyReason || postReviewDueAt) {
    throw new TypeError("emergencyReason and postReviewDueAt are only valid for BREAK_GLASS");
  }
  const decisionType = assertEnum(DecisionType, input?.proposedDecision?.type, "proposedDecision.type");
  const content = optionalString(input?.proposedDecision?.content, "proposedDecision.content");
  if (decisionType === DecisionType.EXCEPTION_RECORDED && !content) {
    throw new TypeError("proposedDecision.content is required for EXCEPTION_RECORDED");
  }
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "decisionReviewCase.id"),
    claimId: requireNonEmptyString(input?.claimId, "decisionReviewCase.claimId"),
    claimVersion: requirePositiveInteger(input?.claimVersion, "decisionReviewCase.claimVersion"),
    scopeId: requireNonEmptyString(input?.scopeId, "decisionReviewCase.scopeId"),
    scopeVersion: requirePositiveInteger(input?.scopeVersion, "decisionReviewCase.scopeVersion"),
    risk,
    approvalMode,
    proposedDecision: {
      id: requireNonEmptyString(input?.proposedDecision?.id, "proposedDecision.id"),
      type: decisionType,
      content,
      evidenceRefs: stringArray(input?.proposedDecision?.evidenceRefs, "proposedDecision.evidenceRefs"),
      validUntil,
    },
    emergencyReason,
    postReviewDueAt,
    proposerId: requireNonEmptyString(input?.proposerId, "decisionReviewCase.proposerId"),
    proposerRole: requireNonEmptyString(input?.proposerRole, "decisionReviewCase.proposerRole"),
    expiresAt,
    createdAt,
  });
}

export function createDecisionReviewEvent(input, clock = () => new Date()) {
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "decisionReviewEvent.id"),
    caseId: requireNonEmptyString(input?.caseId, "decisionReviewEvent.caseId"),
    action: assertEnum(DecisionReviewAction, input?.action, "decisionReviewEvent.action"),
    actorId: requireNonEmptyString(input?.actorId, "decisionReviewEvent.actorId"),
    actorRole: requireNonEmptyString(input?.actorRole, "decisionReviewEvent.actorRole"),
    rationale: requireNonEmptyString(input?.rationale, "decisionReviewEvent.rationale"),
    createdAt: input?.createdAt ?? clock().toISOString(),
  });
}

function configuredRoles(policy, fieldName) {
  const roles = policy?.[fieldName] ?? [];
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string" || role.trim() === "")) {
    throw new TypeError(`decision governance policy.${fieldName} must be an array of roles`);
  }
  return new Set(roles);
}

export function evaluateDecisionReviewCase(reviewCase, events, policy = {}, clock = () => new Date()) {
  if (!Array.isArray(events)) throw new TypeError("decision review events must be an array");
  const ordered = [...events];
  const lastReopen = ordered.findLastIndex((event) => event.action === DecisionReviewAction.REOPEN);
  const activeEvents = ordered.slice(lastReopen + 1);
  const terminal = [...activeEvents].reverse().find((event) => [
    DecisionReviewAction.REJECT,
    DecisionReviewAction.REVOKE,
    DecisionReviewAction.DISPUTE,
  ].includes(event.action));
  const approvals = activeEvents.filter((event) => event.action === DecisionReviewAction.APPROVE);
  const approvalActors = new Set(approvals.map((event) => event.actorId));
  const approvalRoles = new Set(approvals.map((event) => event.actorRole));
  const requirements = {
    minimumApprovals: reviewCase.approvalMode === DecisionApprovalMode.DUAL ||
      reviewCase.approvalMode === DecisionApprovalMode.BUSINESS_COMPLIANCE ? 2 : 1,
    distinctFromProposer: true,
    requiredRoleGroups: [],
  };
  let allowedRoles = configuredRoles(policy, "approvalRoles");
  if (reviewCase.approvalMode === DecisionApprovalMode.BUSINESS_COMPLIANCE) {
    const businessRoles = configuredRoles(policy, "businessRoles");
    const complianceRoles = configuredRoles(policy, "complianceRoles");
    requirements.requiredRoleGroups = [[...businessRoles], [...complianceRoles]];
    allowedRoles = new Set([...businessRoles, ...complianceRoles]);
  } else if (reviewCase.approvalMode === DecisionApprovalMode.BREAK_GLASS) {
    allowedRoles = configuredRoles(policy, "breakGlassRoles");
  }
  const validApprovals = approvals.filter(
    (event) => event.actorId !== reviewCase.proposerId && allowedRoles.has(event.actorRole),
  );
  const distinctValidActors = new Set(validApprovals.map((event) => event.actorId));
  const roleGroupsSatisfied = requirements.requiredRoleGroups.every((roles) =>
    roles.some((role) => validApprovals.some((event) => event.actorRole === role)));
  const approvalSatisfied = distinctValidActors.size >= requirements.minimumApprovals && roleGroupsSatisfied;
  const now = clock();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("clock must return a valid Date");
  let status = approvalSatisfied ? "APPROVED" : "PENDING";
  if (terminal) status = {
    REJECT: "REJECTED",
    REVOKE: "REVOKED",
    DISPUTE: "DISPUTED",
  }[terminal.action];
  if (status === "PENDING" && now.getTime() >= Date.parse(reviewCase.expiresAt)) status = "EXPIRED";
  const postReviewed = activeEvents.some((event) => event.action === DecisionReviewAction.POST_REVIEW);
  if (
    status === "APPROVED" &&
    reviewCase.approvalMode === DecisionApprovalMode.BREAK_GLASS &&
    now.getTime() >= Date.parse(reviewCase.postReviewDueAt) &&
    !postReviewed
  ) {
    status = "POST_REVIEW_OVERDUE";
  }
  return deepFreeze({
    status,
    approvals: validApprovals,
    ignoredApprovalEventIds: approvals.filter((event) => !validApprovals.includes(event)).map((event) => event.id),
    approvalActorCount: distinctValidActors.size,
    approvalRoleCount: approvalRoles.size,
    requirements,
    postReviewed,
    mayMaterializeDecision: approvalSatisfied && !terminal,
    latestEvent: ordered.at(-1) ?? null,
    eventCount: ordered.length,
    observedApprovalActorCount: approvalActors.size,
  });
}
