import { analyzeLocalWorkspaceRecords, type LocalWorkspaceAnalysis, type LocalWorkspaceFileRecord } from "./local-workspace-analysis";

export type LocalWorkspaceProjectSummary = {
  id: string;
  name: string;
  rootName: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  supportedFileCount: number;
  featureCount: number;
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
  engine: "DETERMINISTIC";
  status: "RUNNING" | "PAUSED";
  scannerVersion: number;
  plannedFileCount: number;
  completedFileCount: number;
  records: LocalWorkspaceFileRecord[];
  currentPaths: string[];
  counters: { added: number; modified: number; unchanged: number };
  startedAt: string;
  updatedAt: string;
};

const databaseName = "traqen-local-workspaces";
const databaseVersion = 2;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("projects")) database.createObjectStore("projects", { keyPath: "id" });
      if (!database.objectStoreNames.contains("snapshots")) database.createObjectStore("snapshots", { keyPath: "projectId" });
      if (!database.objectStoreNames.contains("analysisRuns")) database.createObjectStore("analysisRuns", { keyPath: "id" });
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

export async function listLocalWorkspaceProjects() {
  const database = await openDatabase();
  try {
    const projects = await requestResult(database.transaction("projects", "readonly").objectStore("projects").getAll()) as LocalWorkspaceProjectSummary[];
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    database.close();
  }
}

export async function loadLocalWorkspaceProject(projectId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["projects", "snapshots"], "readonly");
    const [project, storedSnapshot] = await Promise.all([
      requestResult(transaction.objectStore("projects").get(projectId)) as Promise<LocalWorkspaceProjectSummary | undefined>,
      requestResult(transaction.objectStore("snapshots").get(projectId)) as Promise<{ projectId: string; scannedAt: string; records: LocalWorkspaceFileRecord[] } | undefined>,
    ]);
    if (!project || !storedSnapshot) return null;
    const analysis = analyzeLocalWorkspaceRecords({ workspaceName: project.name, projectId: project.id, records: storedSnapshot.records, now: new Date(storedSnapshot.scannedAt) });
    return { project, analysis, records: storedSnapshot.records } satisfies LocalWorkspaceProjectSnapshot;
  } finally {
    database.close();
  }
}

export async function saveLocalWorkspaceProject(snapshot: LocalWorkspaceProjectSnapshot) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["projects", "snapshots", "analysisResults"], "readwrite");
    transaction.objectStore("projects").put(snapshot.project);
    transaction.objectStore("snapshots").put({ projectId: snapshot.project.id, scannedAt: snapshot.analysis.scannedAt, records: snapshot.records });
    transaction.objectStore("analysisResults").put({
      id: `${snapshot.project.id}:${snapshot.analysis.scannedAt}`,
      projectId: snapshot.project.id,
      scannedAt: snapshot.analysis.scannedAt,
      fileCount: snapshot.analysis.fileCount,
      supportedFileCount: snapshot.analysis.supportedFileCount,
      featureCount: snapshot.analysis.features.length,
      features: snapshot.analysis.features.map((feature) => ({ id: feature.id, name: feature.name, displayName: feature.displayName, kind: feature.kind, sourcePath: feature.sourcePath, startLine: feature.startLine })),
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

export async function saveLocalWorkspaceAnalysisRun(checkpoint: LocalWorkspaceAnalysisRunCheckpoint) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("analysisRuns", "readwrite");
    transaction.objectStore("analysisRuns").put(checkpoint);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function clearLocalWorkspaceAnalysisRun(projectId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("analysisRuns", "readwrite");
    transaction.objectStore("analysisRuns").delete(`${projectId}:ACTIVE`);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function listLocalWorkspaceAnalysisHistory(projectId: string) {
  const database = await openDatabase();
  try {
    const index = database.transaction("analysisResults", "readonly").objectStore("analysisResults").index("projectId");
    const results = await requestResult(index.getAll(projectId)) as Array<{ id: string; projectId: string; scannedAt: string; fileCount: number; supportedFileCount: number; featureCount: number; features: unknown[] }>;
    return results.sort((left, right) => right.scannedAt.localeCompare(left.scannedAt));
  } finally {
    database.close();
  }
}
