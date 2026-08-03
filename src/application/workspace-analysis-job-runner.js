import { contentId, deepFreeze } from "../domain/index.js";

export const WorkspaceAnalysisPhase = Object.freeze({
  SOURCE_SCAN: "SOURCE_SCAN",
  FACT_COMMIT: "FACT_COMMIT",
  ANALYSIS: "ANALYSIS",
  RECONCILIATION: "RECONCILIATION",
  EVALUATION: "EVALUATION",
  PROJECTION: "PROJECTION",
  PUBLISHING: "PUBLISHING",
  COMPLETED: "COMPLETED",
});

const orderedPhases = Object.values(WorkspaceAnalysisPhase);

export class WorkspaceAnalysisJobRunner {
  constructor({ store, handlers, clock = () => new Date() }) {
    if (!store) throw new TypeError("store is required");
    this.store = store;
    this.handlers = handlers ?? {};
    this.clock = clock;
  }

  async start(input) {
    if (typeof input.sourceRegistrationId !== "string" || input.sourceRegistrationId.trim() === "") {
      throw new TypeError("sourceRegistrationId is required");
    }
    if (
      typeof input.workspaceExecutionProfileRevisionId !== "string"
      || input.workspaceExecutionProfileRevisionId.trim() === ""
    ) {
      throw new TypeError("workspaceExecutionProfileRevisionId is required");
    }
    const currentGraphHead = await this.store.getCurrentGraphHead(input.projectId);
    const resolvedMode = input.requestedMode === "AUTO"
      ? currentGraphHead ? "INCREMENTAL" : "FULL"
      : input.requestedMode;
    if (!currentGraphHead && resolvedMode === "INCREMENTAL") {
      throw new TypeError("The first WorkspaceAnalysisJob must be FULL");
    }
    const identity = {
      projectId: input.projectId,
      sourceRegistrationId: input.sourceRegistrationId,
      snapshotManifestId: input.snapshotManifestId,
      requestedMode: input.requestedMode,
      resolvedMode,
      baseRevisionId: resolvedMode === "INCREMENTAL" ? currentGraphHead.graphRevisionId : null,
      policyDigest: input.policyDigest,
      workspaceExecutionProfileRevisionId: input.workspaceExecutionProfileRevisionId,
      implementationAuthorId: input.implementationAuthorId ?? "TRAQEN-RUNTIME",
      runnerId: input.runnerId ?? "TRAQEN-LOCAL-RUNNER",
    };
    const job = deepFreeze({
      id: input.id ?? contentId("WORKSPACE-ANALYSIS-JOB", identity),
      ...identity,
      phase: WorkspaceAnalysisPhase.SOURCE_SCAN,
      desiredState: "RUNNING",
      status: "RUNNING",
      version: 1,
      completedPhases: [],
      outputs: {},
      createdAt: this.clock().toISOString(),
      updatedAt: this.clock().toISOString(),
    });
    return this.#persist(job);
  }

  async #persist(job) {
    const existing = await this.store.listUnderstandingRecords(job.projectId, "WORKSPACE_ANALYSIS_JOB");
    const authoritativeTerminal = existing
      .filter((record) => record.jobId === job.id && ["CANCELLED", "FAILED", "COMPLETED"].includes(record.state?.status))
      .sort((left, right) => left.checkpointSequence - right.checkpointSequence
        || ({ CANCELLED: 0, FAILED: 1, COMPLETED: 2 }[left.state.status]
          - { CANCELLED: 0, FAILED: 1, COMPLETED: 2 }[right.state.status]))[0];
    if (authoritativeTerminal) return deepFreeze(structuredClone(authoritativeTerminal.state));
    const checkpointSequence = Math.max(
      0,
      ...existing.filter((record) => record.jobId === job.id).map((record) => record.checkpointSequence ?? 0),
    ) + 1;
    const checkpoint = {
      id: contentId("WORKSPACE-ANALYSIS-JOB-CHECKPOINT", {
        jobId: job.id,
        checkpointSequence,
        status: job.status,
        phase: job.phase,
        completedPhases: job.completedPhases,
        outputs: job.outputs,
      }),
      jobId: job.id,
      checkpointSequence,
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      artifactIds: [],
      state: structuredClone(job),
      createdAt: job.updatedAt,
    };
    await this.store.appendUnderstandingRecord(job.projectId, "WORKSPACE_ANALYSIS_JOB", checkpoint);
    return this.get(job.projectId, job.id);
  }

  async get(projectId, jobId) {
    const checkpoints = await this.store.listUnderstandingRecords(projectId, "WORKSPACE_ANALYSIS_JOB");
    const matching = checkpoints.filter((checkpoint) => checkpoint.jobId === jobId);
    const terminal = matching
      .filter(({ state }) => ["CANCELLED", "FAILED", "COMPLETED"].includes(state.status))
      .sort((left, right) => left.checkpointSequence - right.checkpointSequence
        || ({ CANCELLED: 0, FAILED: 1, COMPLETED: 2 }[left.state.status]
          - { CANCELLED: 0, FAILED: 1, COMPLETED: 2 }[right.state.status]))[0];
    return terminal?.state ?? matching
      .sort((left, right) => right.checkpointSequence - left.checkpointSequence)[0]?.state ?? null;
  }

  async run(job, { signal } = {}) {
    let state = structuredClone(job);
    if (state.status === "PAUSED") return deepFreeze(state);
    for (const phase of orderedPhases.slice(0, -1)) {
      const latestBeforePhase = await this.get(state.projectId, state.id);
      if (latestBeforePhase && latestBeforePhase.version > state.version) state = structuredClone(latestBeforePhase);
      if (["CANCELLED", "FAILED", "COMPLETED"].includes(state.status)) return deepFreeze(state);
      if (state.completedPhases.includes(phase)) continue;
      if (signal?.aborted || state.desiredState === "PAUSED") {
        const paused = deepFreeze({
          ...state,
          desiredState: "PAUSED",
          status: "PAUSED",
          version: state.version + 1,
          updatedAt: this.clock().toISOString(),
        });
        return this.#persist(paused);
      }
      const handler = this.handlers[phase];
      if (typeof handler !== "function") throw new TypeError(`No handler configured for ${phase}`);
      const output = await handler(deepFreeze(structuredClone(state)), { signal });
      const latestAfterPhase = await this.get(state.projectId, state.id);
      if (latestAfterPhase && latestAfterPhase.version > state.version) {
        if (["CANCELLED", "FAILED"].includes(latestAfterPhase.status)) return deepFreeze(latestAfterPhase);
        if (latestAfterPhase.desiredState === "PAUSED") {
          const paused = deepFreeze({
            ...structuredClone(latestAfterPhase),
            status: "PAUSED",
            version: latestAfterPhase.version + 1,
            updatedAt: this.clock().toISOString(),
          });
          return this.#persist(paused);
        }
        state = structuredClone(latestAfterPhase);
      }
      state = {
        ...state,
        phase: orderedPhases[orderedPhases.indexOf(phase) + 1],
        completedPhases: [...state.completedPhases, phase],
        outputs: { ...state.outputs, [phase]: output },
        version: state.version + 1,
        updatedAt: this.clock().toISOString(),
      };
      state = structuredClone(await this.#persist(deepFreeze(structuredClone(state))));
      if (["CANCELLED", "FAILED", "COMPLETED"].includes(state.status)) return deepFreeze(state);
    }
    const latestBeforeCompletion = await this.get(state.projectId, state.id);
    if (latestBeforeCompletion && latestBeforeCompletion.version > state.version
      && ["CANCELLED", "FAILED"].includes(latestBeforeCompletion.status)) {
      return deepFreeze(latestBeforeCompletion);
    }
    const completed = deepFreeze({
      ...state,
      phase: "COMPLETED",
      status: "COMPLETED",
      version: state.version + 1,
      completedAt: this.clock().toISOString(),
      updatedAt: this.clock().toISOString(),
    });
    return this.#persist(completed);
  }

  async pause(job) {
    if (job.status !== "RUNNING") throw new TypeError("only a RUNNING job can be paused");
    const paused = deepFreeze({
      ...structuredClone(job),
      desiredState: "PAUSED",
      status: "PAUSED",
      version: job.version + 1,
      updatedAt: this.clock().toISOString(),
    });
    return this.#persist(paused);
  }

  async resume(job) {
    if (job.status !== "PAUSED") throw new TypeError("only a PAUSED job can be resumed");
    const resumed = deepFreeze({
      ...structuredClone(job),
      desiredState: "RUNNING",
      status: "RUNNING",
      version: job.version + 1,
      updatedAt: this.clock().toISOString(),
    });
    return this.#persist(resumed);
  }

  async fail(job, error) {
    const latest = await this.get(job.projectId, job.id);
    if (latest && ["CANCELLED", "COMPLETED"].includes(latest.status)) return latest;
    if (latest && latest.version > job.version) job = latest;
    const failed = deepFreeze({
      ...structuredClone(job),
      status: "FAILED",
      version: job.version + 1,
      error: {
        code: error?.code ?? "WORKSPACE_ANALYSIS_FAILED",
        message: error?.message ?? "Workspace analysis failed",
        retryable: error?.retryable === true,
      },
      updatedAt: this.clock().toISOString(),
    });
    return this.#persist(failed);
  }

  async cancel(job) {
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
      throw new TypeError("a terminal job cannot be cancelled");
    }
    const cancelled = deepFreeze({
      ...structuredClone(job),
      desiredState: "CANCELLED",
      status: "CANCELLED",
      version: job.version + 1,
      completedAt: this.clock().toISOString(),
      updatedAt: this.clock().toISOString(),
    });
    return this.#persist(cancelled);
  }
}
