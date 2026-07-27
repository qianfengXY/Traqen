import {
  localWorkspaceDerivedId,
  type LocalModelClassification,
  type LocalWorkspaceFileRecord,
} from "./local-workspace-analysis.ts";

export type WorkspaceObservationRequest = {
  workspaceName: string;
  rootName: string;
  observedAt: string;
  records: Array<{
    path: string;
    size: number;
    contentFingerprint: string;
    supported: boolean;
    candidates: Array<{
      localCandidateId: string;
      kind: "ENDPOINT" | "CODE_SYMBOL" | "COMMAND";
      name: string;
      method: string | null;
      modulePath: string;
      sourcePath: string;
      startLine: number;
      description: string;
    }>;
    configuration: { path: string; key: string; value: string } | null;
    test: { path: string; title: string } | null;
  }>;
};

export type WorkspaceObservationReceipt = {
  projectId: string;
  snapshotManifestId: string;
  sourceComponentId: string;
  factBundleId: string;
  candidateFacts: Array<{
    localCandidateId: string;
    stableNodeId: string;
    factId: string;
  }>;
};

export type ServerAnalysisRunStatus =
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "COMPLETED_WITH_GAPS"
  | "CANCELLED";

export type ServerAnalysisResult = {
  id: string;
  projectId: string;
  snapshotManifestId: string;
  status: "COMPLETED" | "COMPLETED_WITH_GAPS";
  candidates: Array<{
    candidateKey: string;
    mode: "BUSINESS" | "API";
    name: string;
    description: string;
    confidence: LocalModelClassification["confidence"];
    evidenceFactIds: string[];
    stableEvidenceNodeIds: string[];
    design: Record<string, unknown>;
    uncertainties: string[];
  }>;
  completedAt?: string;
};

export type ServerAnalysisCheckpoint = {
  request: {
    id: string;
    projectId: string;
    snapshotManifestId: string;
    sourceComponentId: string;
    profile: {
      id: string;
      mode: "DETERMINISTIC" | "HYBRID";
      model?: { enabled: boolean; profileId?: string | null };
    };
  };
  run: {
    id: string;
    projectId: string;
    snapshotManifestId: string;
    status: ServerAnalysisRunStatus;
    plannedWorkUnitCount: number;
    completedWorkUnitCount: number;
    failedWorkUnitCount: number;
    startedAt: string;
    updatedAt: string;
    completedAt?: string | null;
  };
  workUnits: Array<unknown>;
  result: ServerAnalysisResult | null;
};

export type WorkspaceRunSubscription = {
  projectId: string;
  runId: string;
  snapshotManifestId: string;
  sourceComponentId: string;
  modelProfileId: string;
  rootName: string;
  status: "SUBMITTING" | ServerAnalysisRunStatus;
  candidateFacts: WorkspaceObservationReceipt["candidateFacts"];
  createdAt: string;
  updatedAt: string;
};

export function workspaceRunSubscriptionBeforeStart(
  runId: string,
  receipt: WorkspaceObservationReceipt,
  rootName: string,
  modelProfileId: string,
  createdAt = new Date().toISOString(),
): WorkspaceRunSubscription {
  if (!runId.trim()) throw new TypeError("Workspace AnalysisRun id is required");
  return {
    projectId: receipt.projectId,
    runId: runId.trim(),
    snapshotManifestId: receipt.snapshotManifestId,
    sourceComponentId: receipt.sourceComponentId,
    modelProfileId,
    rootName,
    status: "SUBMITTING",
    candidateFacts: receipt.candidateFacts,
    createdAt,
    updatedAt: createdAt,
  };
}

function apiHeaders(apiToken: string, json = false) {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(apiToken.trim() ? { "x-traqen-api-token": apiToken.trim() } : {}),
  };
}

function baseUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

async function responseJson<T>(response: Response) {
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Traqen API returned ${response.status}`);
  return body;
}

export function buildWorkspaceObservationRequest(
  workspaceName: string,
  rootName: string,
  records: LocalWorkspaceFileRecord[],
  observedAt = new Date().toISOString(),
): WorkspaceObservationRequest {
  return {
    workspaceName: workspaceName.trim(),
    rootName: rootName.trim(),
    observedAt,
    records: records.map((record) => ({
      path: record.path,
      size: record.size,
      contentFingerprint: record.contentFingerprint ?? localWorkspaceDerivedId(
        "CONTENT-LEGACY",
        JSON.stringify({
          candidates: record.candidates,
          configuration: record.configuration,
          test: record.test,
        }),
      ),
      supported: record.supported,
      candidates: record.candidates.map((candidate) => ({
        localCandidateId: candidate.id,
        kind: candidate.kind,
        name: candidate.name,
        method: candidate.method,
        modulePath: candidate.modulePath,
        sourcePath: candidate.sourcePath,
        startLine: candidate.startLine,
        description: candidate.description,
      })),
      configuration: record.configuration
        ? {
            path: record.configuration.path,
            key: record.configuration.key,
            value: record.configuration.value,
          }
        : null,
      test: record.test
        ? {
            path: record.test.path,
            title: record.test.title,
          }
        : null,
    })),
  };
}

export async function ensureWorkspaceProject(
  apiBase: string,
  apiToken: string,
  workspaceName: string,
  projectId: string,
) {
  const projectUrl = `${baseUrl(apiBase)}/v1/projects/${encodeURIComponent(projectId)}`;
  const current = await fetch(projectUrl, { headers: apiHeaders(apiToken) });
  if (current.ok) return responseJson<Record<string, unknown>>(current);
  if (current.status !== 404) return responseJson<Record<string, unknown>>(current);
  const created = await fetch(`${baseUrl(apiBase)}/v1/projects`, {
    method: "POST",
    headers: apiHeaders(apiToken, true),
    body: JSON.stringify({
      organization: { id: "ORG-LOCAL-WORKSPACE", name: "Local Workspace" },
      tenant: { id: "TENANT-LOCAL-WORKSPACE", name: "Local browser tenant" },
      project: { id: projectId, name: workspaceName },
      principals: [{
        id: "USER-LOCAL-WORKSPACE",
        type: "USER",
        displayName: "Local Workspace owner",
      }],
    }),
  });
  return responseJson<Record<string, unknown>>(created);
}

export async function ingestWorkspaceObservations(
  apiBase: string,
  apiToken: string,
  projectId: string,
  input: WorkspaceObservationRequest,
) {
  const response = await fetch(
    `${baseUrl(apiBase)}/v1/projects/${encodeURIComponent(projectId)}/workspace-observations`,
    {
      method: "POST",
      headers: apiHeaders(apiToken, true),
      body: JSON.stringify(input),
    },
  );
  return responseJson<WorkspaceObservationReceipt>(response);
}

export async function startWorkspaceAnalysisRun(
  apiBase: string,
  apiToken: string,
  input: {
    id: string;
    projectId: string;
    snapshotManifestId: string;
    sourceComponentId: string;
    modelProfileId: string;
    mode: "FULL" | "INCREMENTAL" | "AUTO";
    baselineRunId?: string | null;
  },
) {
  const response = await fetch(
    `${baseUrl(apiBase)}/v1/projects/${encodeURIComponent(input.projectId)}/analysis-runs`,
    {
      method: "POST",
      headers: apiHeaders(apiToken, true),
      body: JSON.stringify({
        id: input.id,
        snapshotManifestId: input.snapshotManifestId,
        sourceComponentId: input.sourceComponentId,
        baselineRunId: input.baselineRunId ?? null,
        mode: input.mode,
        profile: {
          id: "workspace-hybrid",
          mode: "HYBRID",
          model: {
            enabled: true,
            profileId: input.modelProfileId,
          },
          skills: [],
          maxAttemptsPerWorkUnit: 2,
        },
      }),
    },
  );
  return responseJson<ServerAnalysisCheckpoint | ServerAnalysisResult>(response);
}

export async function getWorkspaceAnalysisRun(
  apiBase: string,
  apiToken: string,
  projectId: string,
  runId: string,
) {
  const response = await fetch(
    `${baseUrl(apiBase)}/v1/projects/${encodeURIComponent(projectId)}/analysis-runs/${encodeURIComponent(runId)}`,
    { headers: apiHeaders(apiToken) },
  );
  return responseJson<ServerAnalysisCheckpoint>(response);
}

async function mutateWorkspaceAnalysisRun(
  apiBase: string,
  apiToken: string,
  projectId: string,
  runId: string,
  action: "pause" | "resume",
) {
  const response = await fetch(
    `${baseUrl(apiBase)}/v1/projects/${encodeURIComponent(projectId)}/analysis-runs/${encodeURIComponent(runId)}/${action}`,
    {
      method: "POST",
      headers: apiHeaders(apiToken, true),
      body: "{}",
    },
  );
  return responseJson<ServerAnalysisCheckpoint>(response);
}

export function pauseWorkspaceAnalysisRun(
  apiBase: string,
  apiToken: string,
  projectId: string,
  runId: string,
) {
  return mutateWorkspaceAnalysisRun(apiBase, apiToken, projectId, runId, "pause");
}

export function resumeWorkspaceAnalysisRun(
  apiBase: string,
  apiToken: string,
  projectId: string,
  runId: string,
) {
  return mutateWorkspaceAnalysisRun(apiBase, apiToken, projectId, runId, "resume");
}

export function workspaceRunSubscriptionFromServer(
  checkpoint: ServerAnalysisCheckpoint,
  receipt: WorkspaceObservationReceipt,
  rootName: string,
  modelProfileId: string,
): WorkspaceRunSubscription {
  if (
    checkpoint.run.projectId !== receipt.projectId ||
    checkpoint.run.snapshotManifestId !== receipt.snapshotManifestId ||
    checkpoint.request.sourceComponentId !== receipt.sourceComponentId
  ) {
    throw new TypeError("Server AnalysisRun does not match the Workspace observation receipt");
  }
  return {
    projectId: checkpoint.run.projectId,
    runId: checkpoint.run.id,
    snapshotManifestId: checkpoint.run.snapshotManifestId,
    sourceComponentId: receipt.sourceComponentId,
    modelProfileId,
    rootName,
    status: checkpoint.run.status,
    candidateFacts: receipt.candidateFacts,
    createdAt: checkpoint.run.startedAt,
    updatedAt: checkpoint.run.updatedAt,
  };
}

function taxonomy(value: Record<string, unknown>) {
  const declared = value.taxonomy;
  return declared && typeof declared === "object" && !Array.isArray(declared)
    ? declared as Record<string, unknown>
    : {};
}

export function workspaceEnrichmentsFromAnalysisResult(
  result: ServerAnalysisResult,
  subscription: WorkspaceRunSubscription,
) {
  if (
    result.id !== subscription.runId ||
    result.projectId !== subscription.projectId ||
    result.snapshotManifestId !== subscription.snapshotManifestId
  ) {
    throw new TypeError("Analysis result does not match the subscribed AnalysisRun");
  }
  const localCandidatesByStableNode = new Map(
    subscription.candidateFacts.map((candidate) => [candidate.stableNodeId, candidate.localCandidateId]),
  );
  return result.candidates.flatMap((candidate) => {
    const localCandidateIds = candidate.stableEvidenceNodeIds
      .map((stableNodeId) => localCandidatesByStableNode.get(stableNodeId))
      .filter((localCandidateId): localCandidateId is string => Boolean(localCandidateId));
    const classification = taxonomy(candidate.design);
    const businessFeature = candidate.mode === "BUSINESS";
    return [...new Set(localCandidateIds)].map((id) => ({
      id,
      displayName: candidate.name,
      description: candidate.description,
      businessFeature,
      businessKey: candidate.candidateKey,
      businessModule: typeof classification.module === "string"
        ? classification.module
        : businessFeature ? "Business capabilities" : "API services",
      businessSubmodule: typeof classification.submodule === "string"
        ? classification.submodule
        : businessFeature ? "Core functions" : "API endpoints",
      domain: typeof classification.domain === "string" ? classification.domain : "Core",
      group: (businessFeature ? "BUSINESS_CAPABILITY" : "API_SERVICE") as LocalModelClassification["group"],
      confidence: candidate.confidence,
      rationale: candidate.uncertainties.length > 0
        ? candidate.uncertainties.join(" ")
        : "Validated by the server AnalysisRun against bounded Snapshot Facts.",
      evidenceFactIds: candidate.evidenceFactIds,
      reconciliationStatus: "EVIDENCE_VALIDATED" as const,
    }));
  });
}
