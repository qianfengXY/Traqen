import { deepFreeze } from "./canonical-json.js";
import { requireIsoTimestamp, requireNonEmptyString } from "./model.js";

const statuses = new Set(["QUEUED", "STARTED", "CANCEL_REQUESTED", "COMPLETED", "FAILED", "CANCELLED"]);

function jsonClone(value, fieldName) {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new TypeError(`${fieldName} must contain only cloneable values`, { cause: error });
  }
}

export function createReverseRunJob(input, clock = () => new Date()) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("reverse run job input must be an object");
  }
  const request = jsonClone(input, "reverseRunJob.request");
  const id = requireNonEmptyString(request.id, "reverseRunJob.id");
  const projectId = requireNonEmptyString(request.projectId, "reverseRunJob.projectId");
  requireNonEmptyString(request.snapshotManifestId, "reverseRunJob.snapshotManifestId");
  requireNonEmptyString(request.sourceComponentId, "reverseRunJob.sourceComponentId");
  if (!Array.isArray(request.factBundleIds) || request.factBundleIds.length === 0) {
    throw new TypeError("reverseRunJob.factBundleIds must be a non-empty array");
  }
  if (!Array.isArray(request.skills) || request.skills.length === 0) {
    throw new TypeError("reverseRunJob.skills must be a non-empty array");
  }
  return deepFreeze({ id, projectId, request, createdAt: clock().toISOString() });
}

export function createReverseRunJobEvent(input, clock = () => new Date()) {
  const occurredAt = input?.occurredAt ?? clock().toISOString();
  requireIsoTimestamp(occurredAt, "reverseRunJobEvent.occurredAt");
  const status = requireNonEmptyString(input?.status, "reverseRunJobEvent.status");
  if (!statuses.has(status)) throw new TypeError(`Unsupported reverse run job status: ${status}`);
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "reverseRunJobEvent.id"),
    jobId: requireNonEmptyString(input?.jobId, "reverseRunJobEvent.jobId"),
    status,
    details: jsonClone(input?.details ?? {}, "reverseRunJobEvent.details"),
    occurredAt,
  });
}

export function projectReverseRunJob(job, events, run = null) {
  if (!Array.isArray(events) || events.length === 0) throw new TypeError("reverse run job events must be non-empty");
  const latest = events.at(-1);
  const terminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(latest.status);
  return deepFreeze({
    id: job.id,
    projectId: job.projectId,
    status: latest.status,
    terminal,
    cancelRequested: events.some((event) => event.status === "CANCEL_REQUESTED"),
    request: job.request,
    events,
    run,
    createdAt: job.createdAt,
    updatedAt: latest.occurredAt,
  });
}
