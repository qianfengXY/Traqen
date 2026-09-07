import { requireValue, SourceTruthError } from "./errors.js";
import { terminalRunStates, transaction } from "./repository.js";

export class SourceTruthWorker {
  constructor(services, { maxConcurrent = 2, pollMs = 1000, onError = () => {} } = {}) {
    requireValue(Number.isInteger(maxConcurrent) && maxConcurrent > 0 && maxConcurrent <= 8 && Number.isInteger(pollMs) && pollMs >= 50 && pollMs <= 60000,
      "SOURCE_WORKER_CONFIGURATION_INVALID", "后台任务并发或轮询配置无效", { status: 503 });
    Object.assign(this, { services, maxConcurrent, pollMs, onError });
    this.controller = new AbortController();
    this.services.capture.shutdownSignal = this.controller.signal;
    this.pending = null; this.timer = null;
  }

  start() {
    requireValue(!this.controller.signal.aborted, "SOURCE_WORKER_STOPPED", "任务执行器已停止");
    if (this.timer) return;
    this.timer = setInterval(() => this.dispatch(), this.pollMs);
    this.timer.unref(); this.dispatch();
  }
  dispatch() {
    if (!this.controller.signal.aborted) void this.tick().catch(() => this.onError({ code: "SOURCE_WORKER_UNAVAILABLE", message: "后台任务暂不可用，持久化记录保留，等待恢复" }));
  }
  async tick() {
    if (this.controller.signal.aborted) return;
    if (this.pending) return this.pending;
    const work = this.cycle(); this.pending = work;
    try { return await work; } finally { if (this.pending === work) this.pending = null; }
  }

  async cycle() {
    await this.services.ensureReady?.();
    const { repository, capture } = this.services;
    const { rows } = await repository.database.query(`SELECT r.*,w.tenant_id FROM source_truth_run r JOIN source_truth_workspace w USING(workspace_id)
      WHERE NOT w.backup_barrier AND w.restore_ready
      AND (r.worker_id=$1 OR r.lease_until IS NULL OR r.lease_until<=clock_timestamp())
      AND (r.status IN ('PREFLIGHTING','ENUMERATING','MANIFEST_FROZEN','CAPTURING','RECONCILING','PREPARING_SEAL')
        OR (r.status='WAITING_FOR_CLIENT' AND (
          (r.progress->>'waitingFor'='DIRECTORY_ENUMERATION'
            AND EXISTS (SELECT 1 FROM source_truth_run_source s WHERE s.workspace_id=r.workspace_id AND s.run_id=r.id)
            AND NOT EXISTS (SELECT 1 FROM source_truth_run_source s WHERE s.workspace_id=r.workspace_id AND s.run_id=r.id AND NOT s.enumeration_closed))
          OR (r.progress->>'waitingFor'='DIRECTORY_BYTES'
            AND NOT EXISTS (SELECT 1 FROM source_truth_entry e WHERE e.workspace_id=r.workspace_id AND e.run_id=r.id AND e.disposition IS NULL)))))
      ORDER BY r.updated_at,r.id LIMIT $2`, [capture.workerId, this.maxConcurrent]);
    await Promise.all(rows.map((run) => this.execute(run)));
  }

  async execute(row) {
    const { repository, capture, publication } = this.services;
    if (this.controller.signal.aborted) return;
    let generation = row.generation;
    try {
      const actor = { actorId: row.actor_id, tenantId: row.tenant_id };
      if (row.status !== "PREPARING_SEAL") {
        generation = (await capture.context(actor, row.workspace_id, row.id)).context.generation;
        await capture.advance(actor, row.workspace_id, row.id); return;
      }
      const operation = (await repository.database.query("SELECT * FROM source_truth_publication_operation WHERE workspace_id=$1 AND id=$2 AND run_id=$3", [row.workspace_id, row.publication_operation_id, row.id])).rows[0];
      requireValue(operation, "SOURCE_PUBLICATION_BINDING_MISSING", "冻结操作缺少原始用户授权绑定");
      // Recovery resumes only an already requested freeze operation, using its
      // persisted member and confirmation; REVIEW_REQUIRED is never auto-signed.
      const publishingActor = { actorId: operation.actor_id, tenantId: row.tenant_id };
      const { context } = await capture.context(publishingActor, row.workspace_id, row.id);
      generation = context.generation;
      await capture.withHeartbeat(context, () => publication.seal(publishingActor, context, {
        confirmationId: operation.confirmation_id, clientToken: `recover-${operation.id}`,
      }));
    } catch (error) {
      if (this.controller.signal.aborted || ["SOURCE_LEASE_BUSY", "SOURCE_STALE_WORKER", "SOURCE_PUBLICATION_PAUSED"].includes(error.code)) return;
      await this.recordFailure({ ...row, generation }, error);
    }
  }

  async recordFailure(observed, error) {
    const { repository, capture } = this.services;
    const known = error instanceof SourceTruthError;
    const code = known ? error.code : "SOURCE_WORKER_RETRY_REQUIRED";
    const message = known ? error.message : "执行中断，持久化材料保留，请重试原输入";
    // Trusted execution-plane recovery only, not an HTTP mutation. A revoked
    // initiating member must not leave an apparently running task forever.
    await transaction(repository.database, async (tx) => {
      await tx.query("SELECT id FROM project WHERE id=$1 FOR UPDATE", [observed.workspace_id]);
      await tx.query("SELECT workspace_id FROM source_truth_workspace WHERE workspace_id=$1 FOR UPDATE", [observed.workspace_id]);
      const row = (await tx.query("SELECT *,lease_until>clock_timestamp() AS lease_valid FROM source_truth_run WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [observed.workspace_id, observed.id])).rows[0];
      if (!row || row.generation !== observed.generation || terminalRunStates.has(row.status) || row.status === "FINALIZING"
        || (observed.status === "PREPARING_SEAL" && row.publication_operation_id !== observed.publication_operation_id)
        || (row.worker_id !== capture.workerId && row.lease_valid)) return;
      const needsDecision = code === "SOURCE_ACCEPTANCE_EXPIRED";
      const status = needsDecision ? "REVIEW_REQUIRED" : !known || error.status >= 500 || error.status === 429 ? "FAILED_RETRYABLE" : "BLOCKED";
      const diagnostic = { code, message, priorVersionsUnchanged: true, recovery: needsDecision ? "重新核对缺口并指定新的绝对失效时间" : status === "FAILED_RETRYABLE" ? "恢复服务或存储后重试原输入" : "修复权限、来源或完整性问题后创建新尝试" };
      await tx.query(`UPDATE source_truth_run SET status=$3,station=CASE WHEN $3='REVIEW_REQUIRED' THEN 7 ELSE station END,
        generation=generation+1,lease_until=NULL,diagnostic=$4,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2`, [row.workspace_id, row.id, status, JSON.stringify(diagnostic)]);
      await repository.audit(tx, row.workspace_id, row.id, capture.workerId, "EXECUTION_STOPPED", { code, status });
    });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.controller.abort();
    await this.pending?.catch(() => {});
    await Promise.allSettled([...this.services.capture.advancing.values()]);
    await this.services.repository.database.query(`UPDATE source_truth_run SET lease_until=NULL
      WHERE worker_id=$1 AND status NOT IN ('SUCCEEDED','BLOCKED','FAILED_RETRYABLE','CANCELLED','FINALIZING')`, [this.services.capture.workerId]);
  }
}
