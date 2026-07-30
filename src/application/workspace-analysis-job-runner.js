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
    const currentGraphHead = await this.store.getCurrentGraphHead(input.projectId);
    const resolvedMode = input.requestedMode === "AUTO"
      ? currentGraphHead ? "INCREMENTAL" : "FULL"
      : input.requestedMode;
    if (!currentGraphHead && resolvedMode === "INCREMENTAL") {
      throw new TypeError("The first WorkspaceAnalysisJob must be FULL");
    }
    const identity = {
      projectId: input.projectId,
      snapshotManifestId: input.snapshotManifestId,
      requestedMode: input.requestedMode,
      resolvedMode,
      baseRevisionId: resolvedMode === "INCREMENTAL" ? currentGraphHead.graphRevisionId : null,
      policyDigest: input.policyDigest,
    };
    const job = deepFreeze({
      id: input.id ?? contentId("WORKSPACE-ANALYSIS-JOB", identity),
      ...identity,
      phase: WorkspaceAnalysisPhase.SOURCE_SCAN,
      status: "RUNNING",
      completedPhases: [],
      outputs: {},
      createdAt: this.clock().toISOString(),
      updatedAt: this.clock().toISOString(),
    });
    await this.#persist(job);
    return job;
  }

  async #persist(job) {
    const existing = await this.store.listUnderstandingRecords(job.projectId, "WORK_UNIT");
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
    await this.store.appendUnderstandingRecord(job.projectId, "WORK_UNIT", checkpoint);
    return job;
  }

  async get(projectId, jobId) {
    const checkpoints = await this.store.listUnderstandingRecords(projectId, "WORK_UNIT");
    return checkpoints
      .filter((checkpoint) => checkpoint.jobId === jobId)
      .sort((left, right) => right.checkpointSequence - left.checkpointSequence)[0]?.state ?? null;
  }

  async run(job, { signal } = {}) {
    let state = structuredClone(job);
    if (state.status === "PAUSED") return deepFreeze(state);
    for (const phase of orderedPhases.slice(0, -1)) {
      if (state.completedPhases.includes(phase)) continue;
      if (signal?.aborted) return deepFreeze({ ...state, status: "PAUSED", updatedAt: this.clock().toISOString() });
      const handler = this.handlers[phase];
      if (typeof handler !== "function") throw new TypeError(`No handler configured for ${phase}`);
      const output = await handler(deepFreeze(structuredClone(state)), { signal });
      state = {
        ...state,
        phase: orderedPhases[orderedPhases.indexOf(phase) + 1],
        completedPhases: [...state.completedPhases, phase],
        outputs: { ...state.outputs, [phase]: output },
        updatedAt: this.clock().toISOString(),
      };
      await this.#persist(deepFreeze(structuredClone(state)));
    }
    const completed = deepFreeze({ ...state, phase: "COMPLETED", status: "COMPLETED", updatedAt: this.clock().toISOString() });
    await this.#persist(completed);
    return completed;
  }

  async pause(job) {
    if (job.status !== "RUNNING") throw new TypeError("only a RUNNING job can be paused");
    const paused = deepFreeze({ ...structuredClone(job), status: "PAUSED", updatedAt: this.clock().toISOString() });
    await this.#persist(paused);
    return paused;
  }

  async resume(job) {
    if (job.status !== "PAUSED") throw new TypeError("only a PAUSED job can be resumed");
    const resumed = deepFreeze({ ...structuredClone(job), status: "RUNNING", updatedAt: this.clock().toISOString() });
    await this.#persist(resumed);
    return resumed;
  }
}
