import { requireValue } from "./errors.js";

const releasable = new Set(["CANCELLED", "BLOCKED", "FAILED_RETRYABLE"]);
// All decisions and outcomes are durable. An interrupted request is continued
// by an authorized member on this exact run, not by repeating a cancellation or
// silently deleting a user's recoverable attempt. No full CAS blob is removed.
export class SourceStagingService {
  constructor(repository, blobs) { Object.assign(this, { repository, blobs }); }

  async inspect(actor, workspaceId, runId) {
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const run = (await tx.query("SELECT status FROM source_truth_run WHERE workspace_id=$1 AND id=$2", [workspaceId, runId])).rows[0];
      requireValue(run, "SOURCE_NOT_FOUND", "任务不存在", { status: 404 });
      const request = (await tx.query("SELECT actor_id,requested_at FROM source_truth_staging_release WHERE workspace_id=$1 AND run_id=$2", [workspaceId, runId])).rows[0];
      const counts = (await tx.query(`SELECT count(*)::text AS total,
        count(*) FILTER (WHERE done.chunk_id IS NOT NULL)::text AS released,
        COALESCE(sum(c.size_bytes) FILTER (WHERE done.chunk_id IS NOT NULL),0)::text AS released_bytes,
        count(*) FILTER (WHERE p.decision LIKE 'RETAIN_%')::text AS retained,
        COALESCE(sum(c.size_bytes) FILTER (WHERE p.decision LIKE 'RETAIN_%'),0)::text AS retained_bytes,
        count(*) FILTER (WHERE p.decision='RETAIN_UNVERIFIED_BACKUP')::text AS unverified_backup
        FROM (SELECT DISTINCT chunk_id,size_bytes FROM source_truth_upload_checkpoint WHERE workspace_id=$1 AND run_id=$2) c
        LEFT JOIN source_truth_chunk_release p ON p.workspace_id=$1 AND p.run_id=$2 AND p.chunk_id=c.chunk_id
        LEFT JOIN source_truth_chunk_release_result done ON done.workspace_id=$1 AND done.run_id=$2 AND done.chunk_id=c.chunk_id`, [workspaceId, runId])).rows[0];
      const pending = BigInt(counts.total) - BigInt(counts.released) - BigInt(counts.retained);
      return { runId, abandoned: Boolean(request), canAbandon: releasable.has(run.status),
        requestedBy: request?.actor_id ?? null, requestedAt: request ? new Date(request.requested_at).toISOString() : null,
        totalChunks: counts.total, releasedChunks: counts.released, releasedBytes: counts.released_bytes,
        retainedChunks: counts.retained, retainedBytes: counts.retained_bytes, unverifiedBackupChunks: counts.unverified_backup,
        remainingChunks: String(pending), status: !request ? "RETAINED" : pending > 0n ? "RELEASING" : BigInt(counts.retained) > 0n ? "COMPLETED_WITH_PROTECTED_BYTES" : "COMPLETED",
        boundary: "仅处置本任务的私有上传分片。草稿、清单、审计、完整已验证内容、历史包及备份继续保留；放弃后不再续传或重试此任务。" };
    });
  }

  assertWritable(state) {
    requireValue(state.restoreReady, "SOURCE_RESTORE_UNVERIFIED", "恢复尚未校验，不能释放暂存");
    requireValue(!state.backupBarrier, "SOURCE_BACKUP_BUSY", "正在建立备份一致性水位；完成后再处理暂存");
  }

  async protection(tx, workspaceId, chunkId) {
    if ((await tx.query(`SELECT 1 FROM source_truth_upload_checkpoint c WHERE c.workspace_id=$1 AND c.chunk_id=$2
      AND NOT EXISTS (SELECT 1 FROM source_truth_staging_release a WHERE a.workspace_id=c.workspace_id AND a.run_id=c.run_id) LIMIT 1`, [workspaceId, chunkId])).rows.length) return "RETAIN_RUN_REFERENCE";
    if ((await tx.query("SELECT 1 FROM source_truth_backup_object WHERE workspace_id=$1 AND kind='chunks' AND object_id=$2 LIMIT 1", [workspaceId, chunkId])).rows.length) return "RETAIN_BACKUP_REFERENCE";
    // A failed/interrupted backup can have a sealed target not yet imported.
    // Only a fully indexed authenticated target proves its precise membership.
    if ((await tx.query(`SELECT 1 FROM source_truth_backup_attempt a WHERE (a.status='RUNNING' OR a.target_seal_attempted) AND NOT EXISTS
      (SELECT 1 FROM source_truth_backup_index_complete i WHERE i.backup_id=a.id) LIMIT 1`)).rows.length) return "RETAIN_UNVERIFIED_BACKUP";
    // Restoring an older database can lose knowledge of later backups. Do not
    // reclaim restored chunks on the assumption that the selected restore point
    // was the only extant target; new post-restore uploads are unaffected.
    if ((await tx.query(`SELECT 1 FROM source_truth_upload_checkpoint c WHERE c.workspace_id=$1 AND c.chunk_id=$2
      AND EXISTS (SELECT 1 FROM source_truth_restore_event e WHERE e.occurred_at>=c.verified_at) LIMIT 1`, [workspaceId, chunkId])).rows.length) return "RETAIN_UNVERIFIED_BACKUP";
    return "RELEASE";
  }

  async release(actor, workspaceId, runId, { confirmRelease } = {}) {
    requireValue(confirmRelease === true, "SOURCE_RELEASE_CONFIRMATION_REQUIRED", "必须明确确认放弃续传并释放无引用的私有上传分片", { status: 400 });
    await this.repository.withWorkspace(actor, workspaceId, true, async (tx, state) => {
      this.assertWritable(state);
      const run = (await tx.query("SELECT status FROM source_truth_run WHERE workspace_id=$1 AND id=$2", [workspaceId, runId])).rows[0];
      requireValue(run, "SOURCE_NOT_FOUND", "任务不存在", { status: 404 });
      requireValue(releasable.has(run.status), run.status === "SUCCEEDED" ? "SOURCE_FROZEN_HISTORY_PROTECTED" : "SOURCE_RUN_ACTIVE", "先取消未完成任务；成功的历史包不属于暂存释放范围");
      const child = (await tx.query(`SELECT 1 FROM source_truth_run r WHERE r.workspace_id=$1 AND r.retry_of=$2
        AND NOT EXISTS (SELECT 1 FROM source_truth_staging_release a WHERE a.workspace_id=r.workspace_id AND a.run_id=r.id) LIMIT 1`, [workspaceId, runId])).rows[0];
      requireValue(!child, "SOURCE_STAGING_REFERENCED", "已有重试任务依赖此检查点；先处理其引用，不能放弃原续传材料");
      const added = await tx.query("INSERT INTO source_truth_staging_release (workspace_id,run_id,actor_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING run_id", [workspaceId, runId, actor.actorId]);
      if (added.rows.length) await this.repository.audit(tx, workspaceId, runId, actor.actorId, "STAGING_RELEASE_REQUESTED", { scope: "PRIVATE_UPLOAD_CHUNKS", retryDisabled: true, recordsRetained: true });
    });
    // Bounded batches. Closing the page or losing the response leaves a visible
    // RELEASING operation, never a false completed cleanup.
    const { rows } = await this.repository.database.query(`SELECT DISTINCT c.chunk_id,c.digest,c.size_bytes::text AS size_bytes FROM source_truth_upload_checkpoint c
      LEFT JOIN source_truth_chunk_release p ON p.workspace_id=c.workspace_id AND p.run_id=c.run_id AND p.chunk_id=c.chunk_id
      LEFT JOIN source_truth_chunk_release_result d ON d.workspace_id=c.workspace_id AND d.run_id=c.run_id AND d.chunk_id=c.chunk_id
      WHERE c.workspace_id=$1 AND c.run_id=$2 AND (p.chunk_id IS NULL OR (p.decision='RELEASE' AND d.chunk_id IS NULL)) ORDER BY c.chunk_id LIMIT 100`, [workspaceId, runId]);
    for (const row of rows) {
      // Commit the exact deletion authority before filesystem mutation. A crash
      // after unlink is distinguishable from bytes disappearing without intent.
      const planned = await this.repository.withWorkspace(actor, workspaceId, true, async (tx, state) => {
        this.assertWritable(state);
        const decision = await this.protection(tx, workspaceId, row.chunk_id);
        await tx.query(`INSERT INTO source_truth_chunk_release (workspace_id,run_id,chunk_id,digest,size_bytes,decision)
          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [workspaceId, runId, row.chunk_id, row.digest, row.size_bytes, decision]);
        return (await tx.query("SELECT decision FROM source_truth_chunk_release WHERE workspace_id=$1 AND run_id=$2 AND chunk_id=$3", [workspaceId, runId, row.chunk_id])).rows[0].decision;
      });
      if (planned !== "RELEASE") continue;
      await this.repository.withWorkspace(actor, workspaceId, true, async (tx, state) => {
        this.assertWritable(state);
        if ((await tx.query("SELECT 1 FROM source_truth_chunk_release_result WHERE workspace_id=$1 AND run_id=$2 AND chunk_id=$3", [workspaceId, runId, row.chunk_id])).rows.length) return;
        requireValue(await this.protection(tx, workspaceId, row.chunk_id) === "RELEASE", "SOURCE_STAGING_REFERENCED", "引用保护已变化；停止释放，保留原处置记录");
        const result = await this.blobs.releaseChunk({ workspaceId, tenantId: state.tenantId }, row.chunk_id);
        await tx.query("INSERT INTO source_truth_chunk_release_result (workspace_id,run_id,chunk_id,result) VALUES ($1,$2,$3,$4)", [workspaceId, runId, row.chunk_id, result]);
        await this.repository.audit(tx, workspaceId, runId, actor.actorId, "STAGING_CHUNK_RELEASED", { chunkId: row.chunk_id, sizeBytes: row.size_bytes, result });
      });
    }
    return this.inspect(actor, workspaceId, runId);
  }
}
