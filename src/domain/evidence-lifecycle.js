import { deepFreeze } from "./canonical-json.js";
import {
  EvidenceType,
  assertEnum,
  requireIsoTimestamp,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";

const lifecycleActions = new Set([
  "ARCHIVED",
  "LEGAL_HOLD_PLACED",
  "LEGAL_HOLD_RELEASED",
  "DELETION_REQUESTED",
  "DELETED",
  "ACCESSED",
  "EXPORTED",
]);

function strings(value, fieldName, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new TypeError(`${fieldName} must be ${nonEmpty ? "a non-empty" : "an"} array`);
  }
  const result = value.map((item, index) => requireNonEmptyString(item, `${fieldName}[${index}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${fieldName} must not contain duplicates`);
  return result;
}

export function createEvidenceRetentionPolicy(input, clock = () => new Date()) {
  const retentionDays = requirePositiveInteger(input?.retentionDays, "evidenceRetentionPolicy.retentionDays");
  const archiveAfterDays = requirePositiveInteger(
    input?.archiveAfterDays,
    "evidenceRetentionPolicy.archiveAfterDays",
  );
  if (archiveAfterDays > retentionDays) {
    throw new RangeError("evidenceRetentionPolicy.archiveAfterDays must not exceed retentionDays");
  }
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "evidenceRetentionPolicy.id"),
    version: requirePositiveInteger(input?.version, "evidenceRetentionPolicy.version"),
    dataClassification: requireNonEmptyString(
      input?.dataClassification,
      "evidenceRetentionPolicy.dataClassification",
    ),
    evidenceTypes: strings(input?.evidenceTypes, "evidenceRetentionPolicy.evidenceTypes", { nonEmpty: true })
      .map((type) => assertEnum(EvidenceType, type, "evidenceRetentionPolicy.evidenceType")),
    retentionDays,
    archiveAfterDays,
    legalHoldDefault: input?.legalHoldDefault === true,
    allowedAccessRoles: strings(
      input?.allowedAccessRoles,
      "evidenceRetentionPolicy.allowedAccessRoles",
      { nonEmpty: true },
    ),
    actorId: requireNonEmptyString(input?.actorId, "evidenceRetentionPolicy.actorId"),
    actorRole: requireNonEmptyString(input?.actorRole, "evidenceRetentionPolicy.actorRole"),
    createdAt: input?.createdAt ?? clock().toISOString(),
  });
}

export function createEvidenceLifecycleEvent(input, clock = () => new Date()) {
  const action = requireNonEmptyString(input?.action, "evidenceLifecycleEvent.action");
  if (!lifecycleActions.has(action)) throw new TypeError(`Unsupported Evidence lifecycle action: ${action}`);
  const deletionProof = input?.deletionProof ?? null;
  if (action === "DELETED") {
    if (
      deletionProof === null || typeof deletionProof !== "object" || Array.isArray(deletionProof) ||
      !/^sha256:[a-f0-9]{64}$/.test(deletionProof.proofHash ?? "") ||
      typeof deletionProof.storageProvider !== "string" || deletionProof.storageProvider.trim() === ""
    ) {
      throw new TypeError("DELETED requires deletionProof.proofHash and storageProvider");
    }
  } else if (deletionProof !== null) {
    throw new TypeError("deletionProof is only valid for DELETED");
  }
  const occurredAt = input?.occurredAt ?? clock().toISOString();
  requireIsoTimestamp(occurredAt, "evidenceLifecycleEvent.occurredAt");
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "evidenceLifecycleEvent.id"),
    evidenceId: requireNonEmptyString(input?.evidenceId, "evidenceLifecycleEvent.evidenceId"),
    policyId: requireNonEmptyString(input?.policyId, "evidenceLifecycleEvent.policyId"),
    policyVersion: requirePositiveInteger(input?.policyVersion, "evidenceLifecycleEvent.policyVersion"),
    action,
    reason: requireNonEmptyString(input?.reason, "evidenceLifecycleEvent.reason"),
    actorId: requireNonEmptyString(input?.actorId, "evidenceLifecycleEvent.actorId"),
    actorRole: requireNonEmptyString(input?.actorRole, "evidenceLifecycleEvent.actorRole"),
    deletionProof: deletionProof ? structuredClone(deletionProof) : null,
    occurredAt,
  });
}

export function evaluateEvidenceLifecycle(evidence, policy, events, clock = () => new Date()) {
  if (!policy.evidenceTypes.includes(evidence.type)) throw new TypeError("Retention policy does not cover this Evidence type");
  const ordered = [...events];
  let legalHold = policy.legalHoldDefault;
  let archived = false;
  let deletionRequested = false;
  let deleted = false;
  for (const event of ordered) {
    if (event.action === "LEGAL_HOLD_PLACED") legalHold = true;
    if (event.action === "LEGAL_HOLD_RELEASED") legalHold = false;
    if (event.action === "ARCHIVED") archived = true;
    if (event.action === "DELETION_REQUESTED") deletionRequested = true;
    if (event.action === "DELETED") deleted = true;
  }
  const now = clock().getTime();
  const createdAt = Date.parse(evidence.createdAt);
  const archiveDueAt = new Date(createdAt + policy.archiveAfterDays * 86_400_000).toISOString();
  const retentionEndsAt = new Date(createdAt + policy.retentionDays * 86_400_000).toISOString();
  let status = "ACTIVE";
  if (deleted) status = "DELETED";
  else if (legalHold && deletionRequested) status = "DELETION_BLOCKED_LEGAL_HOLD";
  else if (deletionRequested || now >= Date.parse(retentionEndsAt)) status = "DELETION_DUE";
  else if (archived) status = "ARCHIVED";
  else if (now >= Date.parse(archiveDueAt)) status = "ARCHIVE_DUE";
  return deepFreeze({
    evidenceId: evidence.id,
    policyRef: { id: policy.id, version: policy.version },
    status,
    legalHold,
    archived,
    deletionRequested,
    deleted,
    archiveDueAt,
    retentionEndsAt,
    deletionProof: [...ordered].reverse().find((event) => event.action === "DELETED")?.deletionProof ?? null,
    accessEventCount: ordered.filter((event) => ["ACCESSED", "EXPORTED"].includes(event.action)).length,
    events: ordered,
    evaluatedAt: new Date(now).toISOString(),
  });
}
