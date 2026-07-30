export type GraphRevision = {
  id: string;
  projectId: string;
  snapshotManifestId: string;
  analysisRunId: string;
  mode: "FULL" | "INCREMENTAL";
  baseRevisionId: string | null;
  changeSetId: string | null;
  impactAssessmentId: string | null;
  evaluationRunId: string;
  semanticDigest: string;
  status: "BUILDING" | "EVALUATING" | "PUBLISHED" | "REJECTED";
  createdAt: string;
  publishedAt: string | null;
};

export type CurrentUnderstandingGraph = {
  head: { projectId: string; graphRevisionId: string; version: number; updatedAt: string };
  revision: GraphRevision;
};

function headers(apiToken: string) {
  return apiToken.trim() ? { "x-traqen-api-token": apiToken.trim() } : {};
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `API returned ${response.status}`);
  return body;
}

export async function getCurrentUnderstandingGraph(apiBase: string, apiToken: string, projectId: string) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/graph/current`, {
    method: "GET",
    headers: headers(apiToken),
  });
  if (response.status === 404) return null;
  return json<CurrentUnderstandingGraph>(response);
}

export async function listGraphRevisions(apiBase: string, apiToken: string, projectId: string) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/graph/revisions`, {
    method: "GET",
    headers: headers(apiToken),
  });
  return (await json<{ revisions: GraphRevision[] }>(response)).revisions;
}

export async function getFeatureUnderstandingHistory(
  apiBase: string,
  apiToken: string,
  projectId: string,
  featureId: string,
) {
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/history`,
    { method: "GET", headers: headers(apiToken) },
  );
  if (response.status === 404) return null;
  return json<Record<string, unknown>>(response);
}
