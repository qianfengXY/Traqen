import { contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

const lifecycleStates = new Set(["ACTIVE", "DELETION_REQUESTED", "DELETED"]);
const eventTypes = new Set([
  "WORKSPACE_CREATED",
  "WORKSPACE_RENAMED",
  "DELETION_REQUESTED",
  "DELETION_CANCELLED",
  "DELETION_COMPLETED",
]);

function timestamp(value, fieldName) {
  const parsed = new Date(requireNonEmptyString(value, fieldName));
  if (Number.isNaN(parsed.valueOf())) throw new TypeError(`${fieldName} must be an ISO timestamp`);
  return parsed.toISOString();
}

export function createWorkspace(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("workspace must be an object");
  const id = requireNonEmptyString(input.id, "workspace.id");
  const name = requireNonEmptyString(input.name, "workspace.name");
  const createdAt = clock().toISOString();
  return deepFreeze({
    id,
    workspaceId: id,
    tenantId: requireNonEmptyString(input.tenantId, "workspace.tenantId"),
    name,
    lifecycleState: "ACTIVE",
    lifecycleVersion: 1,
    createdAt,
    updatedAt: createdAt,
    deletionRequestedAt: null,
    deletedAt: null,
  });
}

export function createWorkspaceLifecycleEvent(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("workspace event must be an object");
  const workspaceId = requireNonEmptyString(input.workspaceId, "workspaceId");
  const type = requireNonEmptyString(input.type, "type").toUpperCase();
  if (!eventTypes.has(type)) throw new TypeError(`unsupported Workspace event ${type}`);
  const version = Number(input.version);
  if (!Number.isInteger(version) || version < 1) throw new TypeError("version must be a positive integer");
  const occurredAt = input.occurredAt ? timestamp(input.occurredAt, "occurredAt") : clock().toISOString();
  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
    ? structuredClone(input.payload)
    : {};
  return deepFreeze({
    id: contentId("WORKSPACE-EVENT", { workspaceId, type, version, occurredAt, payload }),
    workspaceId,
    type,
    version,
    actorId: requireNonEmptyString(input.actorId, "actorId"),
    payload,
    occurredAt,
  });
}

export function evolveWorkspace(workspace, event) {
  if (!workspace || !lifecycleStates.has(workspace.lifecycleState)) throw new TypeError("valid workspace is required");
  if (event.workspaceId !== workspace.id) throw new TypeError("Workspace event scope does not match");
  if (event.version !== workspace.lifecycleVersion + 1) throw new TypeError("Workspace event version is stale");
  if (workspace.lifecycleState === "DELETED") throw new TypeError("deleted Workspace is immutable");
  const next = structuredClone(workspace);
  if (event.type === "WORKSPACE_RENAMED") {
    next.name = requireNonEmptyString(event.payload.name, "payload.name");
  } else if (event.type === "DELETION_REQUESTED") {
    if (workspace.lifecycleState !== "ACTIVE") throw new TypeError("only an ACTIVE Workspace can request deletion");
    next.lifecycleState = "DELETION_REQUESTED";
    next.deletionRequestedAt = event.occurredAt;
  } else if (event.type === "DELETION_CANCELLED") {
    if (workspace.lifecycleState !== "DELETION_REQUESTED") throw new TypeError("Workspace deletion is not pending");
    next.lifecycleState = "ACTIVE";
    next.deletionRequestedAt = null;
  } else if (event.type === "DELETION_COMPLETED") {
    if (workspace.lifecycleState !== "DELETION_REQUESTED") throw new TypeError("Workspace deletion must be requested first");
    next.lifecycleState = "DELETED";
    next.deletedAt = event.occurredAt;
  } else {
    throw new TypeError(`event ${event.type} cannot evolve an existing Workspace`);
  }
  next.lifecycleVersion = event.version;
  next.updatedAt = event.occurredAt;
  return deepFreeze(next);
}

export function createWorkspaceViewPreference(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("WorkspaceViewPreference must be an object");
  const workspaceId = requireNonEmptyString(input.workspaceId, "workspaceId");
  const userId = requireNonEmptyString(input.userId, "userId");
  const version = Number(input.version ?? 1);
  if (!Number.isInteger(version) || version < 1) throw new TypeError("version must be a positive integer");
  return deepFreeze({
    id: contentId("WORKSPACE-VIEW", { workspaceId, userId, version }),
    workspaceId,
    userId,
    hidden: input.hidden === true,
    version,
    updatedAt: clock().toISOString(),
  });
}

export function assertWorkspaceContext(context, expectedWorkspaceId, expectedContextVersion = null) {
  if (!context || typeof context !== "object") throw new TypeError("Workspace context is required");
  if (context.workspaceId !== expectedWorkspaceId) throw new TypeError("Workspace context does not match the requested Workspace");
  const version = Number(context.contextVersion);
  if (!Number.isInteger(version) || version < 1) throw new TypeError("contextVersion must be a positive integer");
  if (expectedContextVersion !== null && version !== expectedContextVersion) {
    throw new TypeError("Workspace context version is stale");
  }
  return true;
}
