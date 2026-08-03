export type Workspace = {
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

function headers(apiToken: string, extra: Record<string, string> = {}) {
  return {
    ...extra,
    ...(apiToken.trim() ? { "x-traqen-api-token": apiToken.trim() } : {}),
  };
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `API returned ${response.status}`);
  return body;
}

export async function listWorkspaces(apiBase: string, apiToken: string, userId: string) {
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/workspaces?userId=${encodeURIComponent(userId)}`,
    { method: "GET", headers: headers(apiToken) },
  );
  return (await json<{ workspaces: Workspace[] }>(response)).workspaces;
}

export async function createWorkspace(
  apiBase: string,
  apiToken: string,
  input: { id: string; name: string; userId: string },
) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/v1/workspaces`, {
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
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/workspaces/${encodeURIComponent(workspaceId)}/view-preference`,
    {
      method: "PUT",
      headers: headers(apiToken, { "content-type": "application/json" }),
      body: JSON.stringify({ userId, hidden }),
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
