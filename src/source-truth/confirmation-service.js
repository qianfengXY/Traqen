import { randomUUID } from "node:crypto";
import { canonicalEncode } from "./identity.js";
import { requireValue } from "./errors.js";

export function confirmationRecord(row) {
  return { id: row.id, revision: row.revision, actorId: row.actor_id, ...row.payload,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null, confirmedAt: new Date(row.confirmed_at).toISOString() };
}

export async function assertAcceptance(tx, confirmation) {
  if (confirmation.payload.gapCount === "0") return;
  const { rows } = await tx.query("SELECT $1::timestamptz > clock_timestamp() AS valid", [confirmation.expires_at]);
  requireValue(rows[0].valid, "SOURCE_ACCEPTANCE_EXPIRED", "Gap 接受已过期，请重新确认绝对期限；冻结不会自动顺延");
}

export async function confirmCandidate(repository, actor, context, input) {
  return repository.withWorkspace(actor, context.workspaceId, true, async (tx) => {
    const run = await tx.query("SELECT * FROM source_truth_run WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [context.workspaceId, context.runId]);
    requireValue(["REVIEW_REQUIRED", "PREPARING_SEAL"].includes(run.rows[0]?.status), "SOURCE_INVALID_TRANSITION", "当前任务不在用户清单确认阶段");
    const candidate = (await tx.query("SELECT * FROM source_truth_prepared_bundle WHERE workspace_id=$1 AND run_id=$2", [context.workspaceId, context.runId])).rows[0];
    requireValue(candidate && candidate.id === input.candidateId && candidate.payload.gapSetId === input.gapSetId,
      "SOURCE_CANDIDATE_CONFLICT", "清单、候选或 Gap 集已经不同，请重新查看后确认");
    const hasGaps = candidate.counts.gapCount !== "0";
    requireValue(!hasGaps || (typeof input.reason === "string" && input.reason.trim().length > 0 && input.reason.length <= 2000
      && typeof input.expiresAt === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.expiresAt) && Number.isFinite(Date.parse(input.expiresAt))),
    "SOURCE_ACCEPTANCE_REQUIRED", "请明确接受完整的非阻断 Gap 集，并填写理由与绝对失效时间", { status: 400 });
    const expiresAt = hasGaps ? new Date(input.expiresAt).toISOString() : null;
    const payload = { candidateId: candidate.id, gapSetId: candidate.payload.gapSetId, policyRevisionId: candidate.payload.policyRevisionId,
      gapCount: candidate.counts.gapCount, reason: hasGaps ? input.reason.trim() : null, expiresAt };
    await assertAcceptance(tx, { payload, expires_at: expiresAt });
    const latest = (await tx.query("SELECT * FROM source_truth_confirmation WHERE workspace_id=$1 AND run_id=$2 ORDER BY revision DESC LIMIT 1", [context.workspaceId, context.runId])).rows[0];
    if (latest?.actor_id === actor.actorId && canonicalEncode(latest.payload) === canonicalEncode(payload)) return confirmationRecord(latest);
    const { rows } = await tx.query(`INSERT INTO source_truth_confirmation (workspace_id,id,run_id,revision,candidate_id,actor_id,payload,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [context.workspaceId, randomUUID(), context.runId, (latest?.revision ?? 0) + 1,
      candidate.id, actor.actorId, JSON.stringify(payload), expiresAt]);
    await tx.query("UPDATE source_truth_run SET status='REVIEW_REQUIRED',station=7,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2", [context.workspaceId, context.runId]);
    await repository.audit(tx, context.workspaceId, context.runId, actor.actorId, "CANDIDATE_CONFIRMED", { confirmationId: rows[0].id, candidateId: candidate.id, gapSetId: payload.gapSetId });
    return confirmationRecord(rows[0]);
  });
}
