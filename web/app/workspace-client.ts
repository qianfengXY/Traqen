import { sessionFetch } from "./auth-client.ts";
export type Workspace = {
  roles?: string[]; reviewRoles?: string[]; canManage?: boolean;
  id: string;
  workspaceId: string;
  tenantId: string;
  name: string;
  lifecycleState: "ACTIVE" | "DELETION_REQUESTED" | "DELETED";
  lifecycleVersion: number;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  deletionRequestedAt: string | null;
  deletedAt: string | null;
};

export type CurrentWorkspaceContext = {
  workspaceId: string;
  contextVersion: number;
};

function headers(_apiToken: string, extra: Record<string, string> = {}) {
  return extra;
}

export class WorkspaceApiError extends Error {
  status: number;
  code: string;
  requestId: string | null;
  constructor(message: string, status: number, code: string, requestId: string | null) {
    super(message); this.name = "WorkspaceApiError";
    this.status = status; this.code = code; this.requestId = requestId;
  }
}

async function json<T>(response: Response, signal?: AbortSignal): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: { message?: string; code?: string; requestId?: string } }) | null;
  signal?.throwIfAborted();
  if (!response.ok || body === null) throw new WorkspaceApiError(body?.error?.message ?? `API returned ${response.status}`, response.status, body?.error?.code ?? "WORKSPACE_HTTP_ERROR", body?.error?.requestId ?? response.headers.get("x-request-id"));
  return body;
}

export async function listWorkspaces(apiBase: string, apiToken: string, userId: string, signal?: AbortSignal) {
  const response = await sessionFetch(
    `${apiBase.replace(/\/$/, "")}/v1/workspaces`,
    { method: "GET", headers: headers(apiToken), signal },
  );
  return (await json<{ workspaces: Workspace[] }>(response, signal)).workspaces;
}

export async function createWorkspace(
  apiBase: string,
  apiToken: string,
  input: { id: string; name: string; userId: string },
) {
  const response = await sessionFetch(`${apiBase.replace(/\/$/, "")}/v1/workspaces`, {
    method: "POST",
    headers: headers(apiToken, { "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  return json<Workspace>(response);
}

export async function setWorkspaceVisibility(
  apiBase: string,
  apiToken: string,
  workspaceId: string,
  userId: string,
  hidden: boolean,
) {
  const response = await sessionFetch(
    `${apiBase.replace(/\/$/, "")}/v1/workspaces/${encodeURIComponent(workspaceId)}/view-preference`,
    {
      method: "PUT",
      headers: headers(apiToken, { "content-type": "application/json" }),
      body: JSON.stringify({ hidden }),
    },
  );
  return json<{ workspaceId: string; userId: string; hidden: boolean; version: number }>(response);
}

export function staleWorkspaceResponse(
  requestContext: CurrentWorkspaceContext,
  currentContext: CurrentWorkspaceContext,
) {
  return requestContext.workspaceId !== currentContext.workspaceId
    || requestContext.contextVersion !== currentContext.contextVersion;
}

export function staleWorkspaceRequestResponse(
  requestContext: CurrentWorkspaceContext,
  currentContext: CurrentWorkspaceContext,
  requestVersion: number,
  currentRequestVersion: number,
) {
  return staleWorkspaceResponse(requestContext, currentContext)
    || requestVersion !== currentRequestVersion;
}
