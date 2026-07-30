export class WorkspaceAnalysisWorker {
  constructor({ runner, leaseStore, workerId, leaseMilliseconds = 30_000 }) {
    if (!runner || !leaseStore) throw new TypeError("runner and leaseStore are required");
    this.runner = runner;
    this.leaseStore = leaseStore;
    this.workerId = workerId;
    this.leaseMilliseconds = leaseMilliseconds;
  }

  async process(jobId, { signal } = {}) {
    const lease = await this.leaseStore.acquire(jobId, this.workerId, this.leaseMilliseconds);
    if (!lease) return null;
    try {
      const job = await this.leaseStore.get(jobId);
      if (!job || job.status === "PAUSED" || job.status === "COMPLETED") return job;
      const result = await this.runner.run(job, { signal });
      await this.leaseStore.commit(jobId, lease.fencingToken, result);
      return result;
    } finally {
      await this.leaseStore.release(jobId, lease.fencingToken);
    }
  }
}
