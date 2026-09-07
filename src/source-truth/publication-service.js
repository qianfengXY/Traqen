import { randomUUID } from "node:crypto";
import { canonicalEncode, structureDigest } from "./identity.js";
import { requireValue, SourceTruthError } from "./errors.js";
import { assertAcceptance, confirmCandidate } from "./confirmation-service.js";

export class SourcePublicationService {
  constructor(repository, candidates, options = {}) { Object.assign(this, { repository, candidates, options }); }
  async confirm(actor, context, input) { return confirmCandidate(this.repository, actor, context, input); }

  async begin(actor, context, input) {
    requireValue(typeof input.clientToken === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(input.clientToken), "SOURCE_INVALID_INPUT", "需要有效的操作重试键", { status: 400 });
    return this.repository.withWorkspace(actor, context.workspaceId, true, async (tx) => {
      const binding = { runId: context.runId, confirmationId: input.confirmationId };
      const token = (await tx.query("SELECT binding FROM source_truth_publication_token WHERE workspace_id=$1 AND client_token=$2", [context.workspaceId, input.clientToken])).rows[0];
      requireValue(!token || canonicalEncode(token.binding) === canonicalEncode(binding), "SOURCE_IDEMPOTENCY_CONFLICT", "该操作键已绑定其他确认，不能改变重试参数");
      const confirmation = (await tx.query("SELECT * FROM source_truth_confirmation WHERE workspace_id=$1 AND id=$2 AND run_id=$3", [context.workspaceId, input.confirmationId, context.runId])).rows[0];
      requireValue(confirmation, "SOURCE_CONFIRMATION_REQUIRED", "需要此任务的用户清单确认");
      let operation = (await tx.query("SELECT * FROM source_truth_publication_operation WHERE workspace_id=$1 AND confirmation_id=$2", [context.workspaceId, confirmation.id])).rows[0];
      if (operation?.status === "COMMITTED") {
        await tx.query(`INSERT INTO source_truth_publication_token (workspace_id,client_token,operation_id,binding) VALUES ($1,$2,$3,$4)
          ON CONFLICT DO NOTHING`, [context.workspaceId, input.clientToken, operation.id, JSON.stringify(binding)]);
        return { result: operation.result };
      }
      const run = (await tx.query("SELECT *,lease_until>clock_timestamp() AS lease_valid FROM source_truth_run WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [context.workspaceId, context.runId])).rows[0];
      requireValue(run && ["REVIEW_REQUIRED", "PREPARING_SEAL"].includes(run.status) && run.generation === context.generation && run.lease_valid,
        "SOURCE_STALE_WORKER", "任务状态或执行权已变化，请读取最新任务");
      const latest = (await tx.query("SELECT id FROM source_truth_confirmation WHERE workspace_id=$1 AND run_id=$2 ORDER BY revision DESC LIMIT 1", [context.workspaceId, context.runId])).rows[0];
      requireValue(latest.id === confirmation.id, "SOURCE_CONFIRMATION_STALE", "请使用最近一次清单确认");
      await assertAcceptance(tx, confirmation);
      const prepared = (await tx.query("SELECT * FROM source_truth_prepared_bundle WHERE workspace_id=$1 AND run_id=$2", [context.workspaceId, context.runId])).rows[0];
      requireValue(prepared?.id === confirmation.candidate_id && structureDigest("bundle", prepared.payload) === prepared.id,
        "SOURCE_CANDIDATE_CONFLICT", "冻结候选与用户确认不一致");
      if (!operation) {
        operation = (await tx.query(`INSERT INTO source_truth_publication_operation (workspace_id,id,run_id,confirmation_id,actor_id,status)
          VALUES ($1,$2,$3,$4,$5,'PREPARING') RETURNING *`, [context.workspaceId, randomUUID(), context.runId, confirmation.id, actor.actorId])).rows[0];
      }
      await tx.query(`INSERT INTO source_truth_publication_token (workspace_id,client_token,operation_id,binding) VALUES ($1,$2,$3,$4)
        ON CONFLICT DO NOTHING`, [context.workspaceId, input.clientToken, operation.id, JSON.stringify(binding)]);
      await tx.query(`UPDATE source_truth_run SET status='PREPARING_SEAL',station=8,publication_operation_id=$3,updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND id=$2`, [context.workspaceId, context.runId, operation.id]);
      return { operation, confirmation, prepared };
    });
  }

  async seal(actor, context, input) {
    const prepared = await this.begin(actor, context, input);
    if (prepared.result) return prepared.result;
    try {
      await this.candidates.verifyPrepared(context, prepared.prepared);
    } catch (error) {
      // A concurrent call may finish this exact operation while verification
      // is waiting for its lease. Recover a committed result, never a different
      // confirmation, cancelled task, integrity failure or unauthorized caller.
      if (!(error instanceof SourceTruthError) || error.code !== "SOURCE_STALE_WORKER") throw error;
      const committed = await this.repository.withWorkspace(actor, context.workspaceId, true, async (tx) => {
        const { rows } = await tx.query(`SELECT result FROM source_truth_publication_operation
          WHERE workspace_id=$1 AND id=$2 AND run_id=$3 AND confirmation_id=$4 AND status='COMMITTED'`,
        [context.workspaceId, prepared.operation.id, context.runId, prepared.confirmation.id]);
        return rows[0]?.result;
      });
      if (!committed) throw error;
      return committed;
    }
    await this.options.beforeCommit?.();
    const result = await this.repository.withWorkspace(actor, context.workspaceId, true, async (tx, access) => {
      const { operation, confirmation, prepared: candidate } = prepared;
      // Concurrent callers may have committed while content was being verified.
      const storedOperation = (await tx.query("SELECT * FROM source_truth_publication_operation WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [context.workspaceId, operation.id])).rows[0];
      if (storedOperation.status === "COMMITTED") return storedOperation.result;
      requireValue(!access.backupBarrier && access.restoreReady, "SOURCE_PUBLICATION_PAUSED", "备份水位或恢复核验期间暂缓发布，请稍后查询或重试");
      const row = (await tx.query("SELECT *,lease_until>clock_timestamp() AS lease_valid FROM source_truth_run WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [context.workspaceId, context.runId])).rows[0];
      requireValue(row && row.generation === context.generation && row.lease_valid && row.status === "PREPARING_SEAL", "SOURCE_STALE_WORKER", "任务状态或执行权已变化，请查询最新任务");
      await this.repository.authorize({ actorId: row.actor_id, tenantId: access.tenantId }, context.workspaceId, true, tx);
      const run = { status: row.status, publicationOperationId: row.publication_operation_id, policyRevisionId: row.policy_revision_id };
      requireValue(run.status === "PREPARING_SEAL" && run.publicationOperationId === operation.id, "SOURCE_CONFIRMATION_STALE", "冻结操作已被新的确认取代");
      requireValue(!this.options.policyRevisionId || this.options.policyRevisionId === run.policyRevisionId, "SOURCE_POLICY_CHANGED", "平台策略版本已变化，请创建新候选并重新确认");
      const latest = (await tx.query("SELECT id FROM source_truth_confirmation WHERE workspace_id=$1 AND run_id=$2 ORDER BY revision DESC LIMIT 1", [context.workspaceId, context.runId])).rows[0];
      requireValue(latest.id === confirmation.id, "SOURCE_CONFIRMATION_STALE", "用户确认已变化");
      await assertAcceptance(tx, confirmation);
      // FINALIZING and all public records commit together. A cancellation either
      // wins the Workspace lock first, or observes the already committed result.
      await tx.query("UPDATE source_truth_run SET status='FINALIZING' WHERE workspace_id=$1 AND id=$2", [context.workspaceId, context.runId]);
      const bundle = { id: candidate.id, ...candidate.payload, ...candidate.counts };
      const inserted = await tx.query(`INSERT INTO source_truth_bundle (workspace_id,id,payload) VALUES ($1,$2,$3)
        ON CONFLICT DO NOTHING RETURNING id`, [context.workspaceId, candidate.id, JSON.stringify({ identity: candidate.payload, counts: candidate.counts })]);
      if (inserted.rows.length) {
        for (const component of candidate.payload.components) await tx.query("INSERT INTO source_truth_bundle_component (workspace_id,bundle_id,component_id) VALUES ($1,$2,$3)", [context.workspaceId, candidate.id, component.id]);
      }
      const receiptId = randomUUID();
      const receipt = { id: receiptId, bundleId: candidate.id, status: candidate.counts.gapCount === "0" ? "READY" : "READY_WITH_ACCEPTED_GAPS",
        confirmationId: confirmation.id, operationId: operation.id, gapSetId: candidate.payload.gapSetId, gapCount: candidate.counts.gapCount,
        expiresAt: confirmation.expires_at ? new Date(confirmation.expires_at).toISOString() : null, acceptedBy: confirmation.actor_id,
        policyRevisionId: candidate.payload.policyRevisionId };
      const issued = await tx.query(`INSERT INTO source_truth_receipt (workspace_id,id,bundle_id,confirmation_id,operation_id,status,payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING issued_at`, [context.workspaceId, receiptId, candidate.id, confirmation.id, operation.id, receipt.status, JSON.stringify(receipt)]);
      receipt.issuedAt = new Date(issued.rows[0].issued_at).toISOString();
      const result = { bundle, receipt };
      await tx.query("UPDATE source_truth_publication_operation SET status='COMMITTED',result=$3 WHERE workspace_id=$1 AND id=$2", [context.workspaceId, operation.id, JSON.stringify(result)]);
      await tx.query("UPDATE source_truth_run SET status='SUCCEEDED',lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2", [context.workspaceId, context.runId]);
      await this.repository.audit(tx, context.workspaceId, context.runId, actor.actorId, "BUNDLE_PUBLISHED", { bundleId: candidate.id, receiptId, operationId: operation.id });
      return result;
    });
    await this.options.afterCommit?.();
    return result;
  }

  async result(actor, workspaceId, runId) {
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const { rows } = await tx.query(`SELECT o.result FROM source_truth_run r JOIN source_truth_publication_operation o
        ON o.workspace_id=r.workspace_id AND o.id=r.publication_operation_id WHERE r.workspace_id=$1 AND r.id=$2 AND o.status='COMMITTED'`, [workspaceId, runId]);
      return rows[0]?.result ?? null;
    });
  }
}
