import { analyzeLocalWorkspaceRecords, localWorkspaceEvidencePolicyVersion, localWorkspaceScannerVersion, type LocalWorkspaceAnalysis, type LocalWorkspaceFileRecord } from "./local-workspace-analysis";
import type { WorkspaceRunSubscription } from "./workspace-analysis-run-client.ts";

export type LocalWorkspaceProjectSummary = {
  id: string;
  name: string;
  rootName: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  supportedFileCount: number;
  candidateCount: number;
  visible: boolean;
};

type PersistedLocalWorkspaceProjectSummary = Omit<LocalWorkspaceProjectSummary, "candidateCount"> & {
  candidateCount?: number;
  featureCount?: number;
};

export type LocalWorkspaceProjectSnapshot = {
  project: LocalWorkspaceProjectSummary;
  analysis: LocalWorkspaceAnalysis;
  records: LocalWorkspaceFileRecord[];
};

export type LocalWorkspaceAnalysisRunCheckpoint = {
  id: string;
  projectId: string;
  rootName: string;
  mode: "FULL" | "INCREMENTAL";
  engine: "HYBRID";
  status: "PREPARING" | "RUNNING" | "PAUSED" | "FAILED";
  phase: "SCANNING" | "MODEL_ENRICHMENT";
  modelProfileId: string;
  completedModelBatchCount: number;
  totalModelBatchCount: number;
  scannerVersion: number;
  plannedFileCount: number;
  completedFileCount: number;
  evidencePolicyVersion?: number;
  analysis?: LocalWorkspaceAnalysis;
  records: LocalWorkspaceFileRecord[];
  currentPaths: string[];
  counters: { added: number; modified: number; unchanged: number };
  startedAt: string;
  updatedAt: string;
};

const databaseName = "traqen-local-workspaces";
const databaseVersion = 5;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("projects")) database.createObjectStore("projects", { keyPath: "id" });
      if (!database.objectStoreNames.contains("snapshots")) database.createObjectStore("snapshots", { keyPath: "projectId" });
      if (!database.objectStoreNames.contains("snapshotRecords")) database.createObjectStore("snapshotRecords", { keyPath: "projectId" });
      if (!database.objectStoreNames.contains("analysisRuns")) database.createObjectStore("analysisRuns", { keyPath: "id" });
      if (!database.objectStoreNames.contains("analysisRunSummaries")) database.createObjectStore("analysisRunSummaries", { keyPath: "id" });
      if (!database.objectStoreNames.contains("analysisRunSubscriptions")) database.createObjectStore("analysisRunSubscriptions", { keyPath: "projectId" });
      if (!database.objectStoreNames.contains("directoryHandles")) database.createObjectStore("directoryHandles", { keyPath: "projectId" });
      if (!database.objectStoreNames.contains("analysisResults")) {
        const results = database.createObjectStore("analysisResults", { keyPath: "id" });
        results.createIndex("projectId", "projectId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the local Workspace database"));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local Workspace storage request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local Workspace transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local Workspace transaction was aborted"));
  });
}

function normalizedProject(project: PersistedLocalWorkspaceProjectSummary): LocalWorkspaceProjectSummary {
  const { featureCount: legacyFeatureCount, ...current } = project;
  return {
    ...current,
    candidateCount: project.candidateCount ?? legacyFeatureCount ?? 0,
    visible: project.visible !== false,
  };
}

export async function listLocalWorkspaceProjects({ includeHidden = false }: { includeHidden?: boolean } = {}) {
  const database = await openDatabase();
  try {
    const projects = await requestResult(database.transaction("projects", "readonly").objectStore("projects").getAll()) as PersistedLocalWorkspaceProjectSummary[];
    return projects.map(normalizedProject).filter((project) => includeHidden || project.visible).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    database.close();
  }
}

export async function loadLocalWorkspaceProject(projectId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["projects", "snapshots"], "readonly");
    const [project, storedSnapshot] = await Promise.all([
      requestResult(transaction.objectStore("projects").get(projectId)) as Promise<PersistedLocalWorkspaceProjectSummary | undefined>,
      requestResult(transaction.objectStore("snapshots").get(projectId)) as Promise<{ projectId: string; scannedAt: string; scannerVersion?: number; evidencePolicyVersion?: number; analysis?: LocalWorkspaceAnalysis; records?: LocalWorkspaceFileRecord[] } | undefined>,
    ]);
    if (!project || !storedSnapshot) return null;
    const normalized = normalizedProject(project);
    const cachedAnalysisIsCurrent = storedSnapshot.analysis
      && storedSnapshot.scannerVersion === localWorkspaceScannerVersion
      && storedSnapshot.evidencePolicyVersion === localWorkspaceEvidencePolicyVersion;
    if (cachedAnalysisIsCurrent) return { project: normalized, analysis: storedSnapshot.analysis, records: [] } satisfies LocalWorkspaceProjectSnapshot;
    const records = storedSnapshot.records ?? await loadLocalWorkspaceProjectRecords(projectId);
    const analysis = analyzeLocalWorkspaceRecords({ workspaceName: project.name, projectId: project.id, records, now: new Date(storedSnapshot.scannedAt) });
    const migration = database.transaction(["snapshots", "snapshotRecords"], "readwrite");
    migration.objectStore("snapshots").put({
      projectId,
      scannedAt: storedSnapshot.scannedAt,
      scannerVersion: localWorkspaceScannerVersion,
      evidencePolicyVersion: localWorkspaceEvidencePolicyVersion,
      analysis,
    });
    migration.objectStore("snapshotRecords").put({ projectId, records });
    await transactionComplete(migration);
    return { project: normalized, analysis, records } satisfies LocalWorkspaceProjectSnapshot;
  } finally {
    database.close();
  }
}

export async function setLocalWorkspaceProjectVisibility(projectId: string, visible: boolean) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("projects", "readwrite");
    const store = transaction.objectStore("projects");
    const project = await requestResult(store.get(projectId)) as PersistedLocalWorkspaceProjectSummary | undefined;
    if (!project) throw new Error(`Local Workspace project ${projectId} was not found`);
    const updated = { ...normalizedProject(project), visible };
    store.put(updated);
    await transactionComplete(transaction);
    return updated;
  } finally {
    database.close();
  }
}

export async function saveLocalWorkspaceProjectSummary(project: LocalWorkspaceProjectSummary) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("projects", "readwrite");
    transaction.objectStore("projects").put(normalizedProject(project));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function saveLocalWorkspaceProject(snapshot: LocalWorkspaceProjectSnapshot) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["projects", "snapshots", "snapshotRecords", "analysisResults"], "readwrite");
    transaction.objectStore("projects").put(snapshot.project);
    transaction.objectStore("snapshots").put({
      projectId: snapshot.project.id,
      scannedAt: snapshot.analysis.scannedAt,
      scannerVersion: localWorkspaceScannerVersion,
      evidencePolicyVersion: localWorkspaceEvidencePolicyVersion,
      analysis: snapshot.analysis,
    });
    transaction.objectStore("snapshotRecords").put({ projectId: snapshot.project.id, records: snapshot.records });
    transaction.objectStore("analysisResults").put({
      id: `${snapshot.project.id}:${snapshot.analysis.scannedAt}`,
      projectId: snapshot.project.id,
      scannedAt: snapshot.analysis.scannedAt,
      fileCount: snapshot.analysis.fileCount,
      supportedFileCount: snapshot.analysis.supportedFileCount,
      candidateCount: snapshot.analysis.features.length,
      candidates: snapshot.analysis.features.map((candidate) => ({ id: candidate.id, name: candidate.name, displayName: candidate.displayName, kind: candidate.kind, sourcePath: candidate.sourcePath, startLine: candidate.startLine })),
    });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadLocalWorkspaceAnalysisRun(projectId: string) {
  const database = await openDatabase();
  try {
    return await requestResult(database.transaction("analysisRuns", "readonly").objectStore("analysisRuns").get(`${projectId}:ACTIVE`)) as LocalWorkspaceAnalysisRunCheckpoint | undefined;
  } finally {
    database.close();
  }
}

export async function loadLocalWorkspaceAnalysisRunSummary(projectId: string) {
  const database = await openDatabase();
  try {
    const summary = await requestResult(database.transaction("analysisRunSummaries", "readonly").objectStore("analysisRunSummaries").get(`${projectId}:ACTIVE`)) as LocalWorkspaceAnalysisRunCheckpoint | undefined;
    if (summary) return summary;
  } finally {
    database.close();
  }
  const legacy = await loadLocalWorkspaceAnalysisRun(projectId);
  if (!legacy) return undefined;
  const summary = { ...legacy, records: [] };
  const migrationDatabase = await openDatabase();
  try {
    const transaction = migrationDatabase.transaction("analysisRunSummaries", "readwrite");
    transaction.objectStore("analysisRunSummaries").put(summary);
    await transactionComplete(transaction);
  } finally {
    migrationDatabase.close();
  }
  return summary;
}

export async function saveLocalWorkspaceAnalysisRun(checkpoint: LocalWorkspaceAnalysisRunCheckpoint) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["analysisRuns", "analysisRunSummaries"], "readwrite");
    transaction.objectStore("analysisRuns").put(checkpoint);
    transaction.objectStore("analysisRunSummaries").put({ ...checkpoint, records: [] });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function clearLocalWorkspaceAnalysisRun(projectId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["analysisRuns", "analysisRunSummaries"], "readwrite");
    transaction.objectStore("analysisRuns").delete(`${projectId}:ACTIVE`);
    transaction.objectStore("analysisRunSummaries").delete(`${projectId}:ACTIVE`);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadWorkspaceRunSubscription(projectId: string) {
  const database = await openDatabase();
  try {
    return await requestResult(
      database.transaction("analysisRunSubscriptions", "readonly").objectStore("analysisRunSubscriptions").get(projectId),
    ) as WorkspaceRunSubscription | undefined;
  } finally {
    database.close();
  }
}

export async function saveWorkspaceRunSubscription(subscription: WorkspaceRunSubscription) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("analysisRunSubscriptions", "readwrite");
    transaction.objectStore("analysisRunSubscriptions").put(subscription);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function clearWorkspaceRunSubscription(projectId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("analysisRunSubscriptions", "readwrite");
    transaction.objectStore("analysisRunSubscriptions").delete(projectId);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadLocalWorkspaceProjectRecords(projectId: string) {
  const database = await openDatabase();
  try {
    const stored = await requestResult(database.transaction("snapshotRecords", "readonly").objectStore("snapshotRecords").get(projectId)) as { projectId: string; records: LocalWorkspaceFileRecord[] } | undefined;
    if (stored) return stored.records;
    const legacy = await requestResult(database.transaction("snapshots", "readonly").objectStore("snapshots").get(projectId)) as { records?: LocalWorkspaceFileRecord[] } | undefined;
    return legacy?.records ?? [];
  } finally {
    database.close();
  }
}

export async function saveLocalWorkspaceDirectoryHandle(projectId: string, handle: FileSystemDirectoryHandle) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("directoryHandles", "readwrite");
    transaction.objectStore("directoryHandles").put({ projectId, handle, updatedAt: new Date().toISOString() });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadLocalWorkspaceDirectoryHandle(projectId: string) {
  const database = await openDatabase();
  try {
    const stored = await requestResult(database.transaction("directoryHandles", "readonly").objectStore("directoryHandles").get(projectId)) as { projectId: string; handle: FileSystemDirectoryHandle } | undefined;
    return stored?.handle;
  } finally {
    database.close();
  }
}

export async function listLocalWorkspaceAnalysisHistory(projectId: string) {
  const database = await openDatabase();
  try {
    const index = database.transaction("analysisResults", "readonly").objectStore("analysisResults").index("projectId");
    const results = await requestResult(index.getAll(projectId)) as Array<{ id: string; projectId: string; scannedAt: string; fileCount: number; supportedFileCount: number; candidateCount?: number; candidates?: unknown[]; featureCount?: number; features?: unknown[] }>;
    return results
      .map(({ featureCount: legacyFeatureCount, features: legacyFeatures, ...result }) => ({
        ...result,
        candidateCount: result.candidateCount ?? legacyFeatureCount ?? 0,
        candidates: result.candidates ?? legacyFeatures ?? [],
      }))
      .sort((left, right) => right.scannedAt.localeCompare(left.scannedAt));
  } finally {
    database.close();
  }
}
