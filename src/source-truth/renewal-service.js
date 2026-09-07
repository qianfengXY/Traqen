import { randomUUID } from "node:crypto";
import { canonicalEncode, structureDigest } from "./identity.js";
import { requireValue } from "./errors.js";
import { assertAcceptance, confirmationRecord } from "./confirmation-service.js";

export class SourceRenewalService {
  constructor(repository, candidates, options = {}) { Object.assign(this, { repository, candidates, options }); }

  async frozen(tx, workspaceId, bundleId, receiptId) {
    const row = (await tx.query(`SELECT b.payload,r.payload AS receipt FROM source_truth_bundle b JOIN source_truth_receipt r
      ON r.workspace_id=b.workspace_id AND r.bundle_id=b.id WHERE b.workspace_id=$1 AND b.id=$2 AND r.id=$3`, [workspaceId, bundleId, receiptId])).rows[0];
    requireValue(row && structureDigest("bundle", row.payload.identity) === bundleId && row.receipt.gapSetId === row.payload.identity.gapSetId,
      "SOURCE_RECEIPT_NOT_FOUND", "续签必须绑定实际冻结包和原凭据，不能替换来源", { status: 404 });
    requireValue(row.payload.counts.gapCount !== "0", "SOURCE_RENEWAL_NOT_NEEDED", "此包没有需要续签的 Gap 接受");
    requireValue(!this.options.policyRevisionId || this.options.policyRevisionId === row.payload.identity.policyRevisionId,
      "SOURCE_POLICY_CHANGED", "平台策略已变化，请创建新来源候选，不能用续签替代重新核验");
    return { id: bundleId, payload: row.payload.identity, counts: row.payload.counts };
  }

  async confirm(actor, workspaceId, input) {
    return this.repository.withWorkspace(actor, workspaceId, true, async (tx) => {
      const bundle = await this.frozen(tx, workspaceId, input.bundleId, input.receiptId);
      requireValue(input.gapSetId === bundle.payload.gapSetId && typeof input.reason === "string" && input.reason.trim().length > 0 && input.reason.length <= 2000
        && typeof input.expiresAt === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.expiresAt) && Number.isFinite(Date.parse(input.expiresAt)),
      "SOURCE_ACCEPTANCE_REQUIRED", "请核对完整 Gap 集并明确理由与新的绝对期限", { status: 400 });
      const payload = { candidateId: bundle.id, priorReceiptId: input.receiptId, gapSetId: bundle.payload.gapSetId,
        policyRevisionId: bundle.payload.policyRevisionId, gapCount: bundle.counts.gapCount, reason: input.reason.trim(), expiresAt: new Date(input.expiresAt).toISOString() };
      await assertAcceptance(tx, { payload, expires_at: payload.expiresAt });
      const latest = (await tx.query("SELECT * FROM source_truth_confirmation WHERE workspace_id=$1 AND candidate_id=$2 AND run_id IS NULL ORDER BY revision DESC LIMIT 1", [workspaceId, bundle.id])).rows[0];
      if (latest?.actor_id === actor.actorId && canonicalEncode(latest.payload) === canonicalEncode(payload)) return confirmationRecord(latest);
      const next = (latest?.revision ?? 0) + 1;
      const { rows } = await tx.query(`INSERT INTO source_truth_confirmation (workspace_id,id,run_id,revision,candidate_id,actor_id,payload,expires_at)
        VALUES ($1,$2,NULL,$3,$4,$5,$6,$7) RETURNING *`, [workspaceId, randomUUID(), next, bundle.id, actor.actorId, JSON.stringify(payload), payload.expiresAt]);
      await this.repository.audit(tx, workspaceId, null, actor.actorId, "RENEWAL_CONFIRMED", { bundleId: bundle.id, confirmationId: rows[0].id, priorReceiptId: input.receiptId });
      return confirmationRecord(rows[0]);
    });
  }

  async latest(actor, workspaceId, input) {
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const exists = (await tx.query("SELECT id FROM source_truth_receipt WHERE workspace_id=$1 AND id=$2 AND bundle_id=$3", [workspaceId, input.receiptId, input.bundleId])).rows[0];
      requireValue(exists, "SOURCE_RECEIPT_NOT_FOUND", "请指定此 Workspace 的精确包与凭据", { status: 404 });
      const row = (await tx.query(`SELECT c.*,c.expires_at>clock_timestamp() AS currently_valid,o.id AS operation_id,o.status AS operation_status,o.result
        FROM source_truth_confirmation c LEFT JOIN source_truth_publication_operation o ON o.workspace_id=c.workspace_id AND o.confirmation_id=c.id
        WHERE c.workspace_id=$1 AND c.candidate_id=$2 AND c.payload->>'priorReceiptId'=$3 AND c.actor_id=$4 AND c.run_id IS NULL
        ORDER BY c.revision DESC LIMIT 1`, [workspaceId, input.bundleId, input.receiptId, actor.actorId])).rows[0];
      return row ? { confirmation: { ...confirmationRecord(row), currentlyValid: row.currently_valid },
        operation: row.operation_id ? { id: row.operation_id, status: row.operation_status } : null, result: row.result ?? null } : null;
    });
  }

  async issue(actor, workspaceId, input) {
    requireValue(typeof input.clientToken === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(input.clientToken), "SOURCE_INVALID_INPUT", "需要有效的操作重试键", { status: 400 });
    const prepared = await this.repository.withWorkspace(actor, workspaceId, true, async (tx, access) => {
      const binding = { renewalConfirmationId: input.confirmationId, bundleId: input.bundleId, priorReceiptId: input.receiptId };
      const existingToken = (await tx.query("SELECT binding FROM source_truth_publication_token WHERE workspace_id=$1 AND client_token=$2", [workspaceId, input.clientToken])).rows[0];
      requireValue(!existingToken || canonicalEncode(existingToken.binding) === canonicalEncode(binding), "SOURCE_IDEMPOTENCY_CONFLICT", "操作键已绑定其他续签确认");
      const confirmation = (await tx.query("SELECT * FROM source_truth_confirmation WHERE workspace_id=$1 AND id=$2 AND run_id IS NULL", [workspaceId, input.confirmationId])).rows[0];
      requireValue(confirmation, "SOURCE_CONFIRMATION_REQUIRED", "需要一次明确的同包续签确认");
      requireValue(confirmation.candidate_id === input.bundleId && confirmation.payload.priorReceiptId === input.receiptId,
        "SOURCE_RENEWAL_BINDING_CONFLICT", "续签必须保持原确认中的包和凭据，不能更换目标");
      let operation = (await tx.query("SELECT * FROM source_truth_publication_operation WHERE workspace_id=$1 AND confirmation_id=$2", [workspaceId, confirmation.id])).rows[0];
      if (!operation) {
        await assertAcceptance(tx, confirmation);
        operation = (await tx.query(`INSERT INTO source_truth_publication_operation (workspace_id,id,run_id,confirmation_id,actor_id,status)
          VALUES ($1,$2,NULL,$3,$4,'PREPARING') RETURNING *`, [workspaceId, randomUUID(), confirmation.id, actor.actorId])).rows[0];
      }
      await tx.query(`INSERT INTO source_truth_publication_token (workspace_id,client_token,operation_id,binding) VALUES ($1,$2,$3,$4)
        ON CONFLICT DO NOTHING`, [workspaceId, input.clientToken, operation.id, JSON.stringify(binding)]);
      if (operation.status === "COMMITTED") return { result: operation.result };
      const bundle = await this.frozen(tx, workspaceId, confirmation.candidate_id, confirmation.payload.priorReceiptId);
      return { bundle, confirmation, operation, scope: { workspaceId, tenantId: access.tenantId } };
    });
    if (prepared.result) return prepared.result;
    await this.candidates.verifyEvidence(workspaceId, prepared.bundle, { scope: prepared.scope, heartbeat: () => this.repository.authorize(actor, workspaceId, true) });
    await this.options.beforeCommit?.();
    const result = await this.repository.withWorkspace(actor, workspaceId, true, async (tx, access) => {
      const { confirmation, operation, bundle } = prepared;
      const stored = (await tx.query("SELECT * FROM source_truth_publication_operation WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, operation.id])).rows[0];
      if (stored.status === "COMMITTED") return stored.result;
      requireValue(!access.backupBarrier && access.restoreReady, "SOURCE_PUBLICATION_PAUSED", "备份水位或恢复核验期间暂缓签发");
      await this.frozen(tx, workspaceId, bundle.id, confirmation.payload.priorReceiptId);
      await assertAcceptance(tx, confirmation);
      const receipt = { id: randomUUID(), bundleId: bundle.id, status: "READY_WITH_ACCEPTED_GAPS", confirmationId: confirmation.id, operationId: operation.id,
        gapSetId: bundle.payload.gapSetId, gapCount: bundle.counts.gapCount, expiresAt: new Date(confirmation.expires_at).toISOString(),
        acceptedBy: confirmation.actor_id, policyRevisionId: bundle.payload.policyRevisionId, priorReceiptId: confirmation.payload.priorReceiptId };
      const issued = await tx.query(`INSERT INTO source_truth_receipt (workspace_id,id,bundle_id,confirmation_id,operation_id,status,payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING issued_at`, [workspaceId, receipt.id, bundle.id, confirmation.id, operation.id, receipt.status, JSON.stringify(receipt)]);
      receipt.issuedAt = new Date(issued.rows[0].issued_at).toISOString();
      const result = { bundle: { id: bundle.id, ...bundle.payload, ...bundle.counts }, receipt };
      await tx.query("UPDATE source_truth_publication_operation SET status='COMMITTED',result=$3 WHERE workspace_id=$1 AND id=$2", [workspaceId, operation.id, JSON.stringify(result)]);
      await this.repository.audit(tx, workspaceId, null, actor.actorId, "RECEIPT_RENEWED", { bundleId: bundle.id, receiptId: receipt.id, priorReceiptId: receipt.priorReceiptId });
      return result;
    });
    await this.options.afterCommit?.();
    return result;
  }
}
