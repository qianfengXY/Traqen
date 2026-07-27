export type LocalWorkspaceRunRecoveryCheckpoint = {
  status: "RUNNING" | "PAUSED" | "FAILED";
  phase: "SCANNING" | "MODEL_ENRICHMENT";
  completedModelBatchCount: number;
  totalModelBatchCount: number;
  completedFileCount: number;
  plannedFileCount: number;
  updatedAt: string;
};

export function planLocalWorkspaceAnalysisRunRecovery(checkpoint: LocalWorkspaceRunRecoveryCheckpoint) {
  const modelPhase = checkpoint.phase === "MODEL_ENRICHMENT";
  const completed = modelPhase ? checkpoint.completedModelBatchCount : checkpoint.completedFileCount;
  const total = modelPhase ? checkpoint.totalModelBatchCount : checkpoint.plannedFileCount;
  const shouldAutoResume = checkpoint.status === "RUNNING";
  const restoredAt = Date.parse(checkpoint.updatedAt) || Date.now();

  return {
    status: checkpoint.status,
    phase: shouldAutoResume ? checkpoint.phase : checkpoint.status,
    shouldAutoResume,
    endedAt: shouldAutoResume ? null : restoredAt,
    completed,
    total,
    overallProgress: modelPhase
      ? 55 + Math.round((completed / Math.max(1, total)) * 40)
      : Math.min(55, Math.round((completed / Math.max(1, total)) * 55)),
    restoredAt,
  } as const;
}
