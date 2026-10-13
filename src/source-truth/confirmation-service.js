import { randomUUID } from "node:crypto";
import { canonicalEncode } from "./identity.js";
import { requireValue } from "./errors.js";

export function confirmationRecord(row) {
  return { id: row.id, revision: row.revision, actorId: row.actor_id, ...row.payload,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null, confirmedAt: new Date(row.confirmed_at).toISOString() };
}

export async function assertAcceptance(tx, confirmation) {
  if (confirmation.payload.gapCount === "0") return;
  if (confirmation.id) await assertIndividualAcceptance(tx, confirmation.workspace_id, confirmation.id, confirmation.payload);
  const { rows } = await tx.query("SELECT $1::timestamptz > clock_timestamp() AS valid", [confirmation.expires_at]);
  requireValue(rows[0].valid, "SOURCE_ACCEPTANCE_EXPIRED", "Gap 接受已过期，请重新确认绝对期限；冻结不会自动顺延");
}

export async function assertIndividualAcceptance(tx, workspaceId, confirmationId, payload) {
  if (payload.gapAcceptanceMode !== "INDIVIDUAL") return;
  const row = (await tx.query(`SELECT count(a.id)::text AS total, count(DISTINCT (a.component_id,a.gap_key))::text AS unique_gaps,
    count(*) FILTER (WHERE a.candidate_id=$3 AND a.gap_set_id=$4 AND g.evidence->>'severity'='NON_BLOCKING')::text AS bound,
    min(a.expires_at) AS earliest,max(a.sequence)::text AS revision FROM source_truth_confirmation_gap_acceptance b
    JOIN source_truth_gap_acceptance a ON a.workspace_id=b.workspace_id AND a.id=b.acceptance_id
    JOIN source_truth_component_gap g ON g.workspace_id=a.workspace_id AND g.component_id=a.component_id AND g.gap_key=a.gap_key
    WHERE b.workspace_id=$1 AND b.confirmation_id=$2`, [workspaceId, confirmationId, payload.candidateId, payload.gapSetId])).rows[0];
  requireValue(row.total === payload.gapCount && row.unique_gaps === payload.gapCount && row.bound === payload.gapCount
    && row.revision === payload.gapAcceptanceRevision && row.earliest && new Date(row.earliest).toISOString() === payload.expiresAt,
  "SOURCE_RECEIPT_CORRUPT", "逐项接受与完整确认之间的绑定校验失败");
}

export const latestGapAcceptancesSql = `SELECT DISTINCT ON (component_id,gap_key) * FROM source_truth_gap_acceptance
  WHERE workspace_id=$1 AND run_id=$2 AND candidate_id=$3 ORDER BY component_id,gap_key,sequence DESC`;

export const gapAcceptanceRecord = row => ({ id: row.id, actorId: row.actor_id, reason: row.reason,
  expiresAt: new Date(row.expires_at).toISOString(), acceptedAt: new Date(row.accepted_at).toISOString(), currentlyValid: row.currently_valid });

function validateAcceptanceInput(input) {
  requireValue(typeof input.reason === "string" && input.reason.trim().length > 0 && input.reason.length <= 2000
    && typeof input.expiresAt === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.expiresAt) && Number.isFinite(Date.parse(input.expiresAt)),
  "SOURCE_ACCEPTANCE_REQUIRED", "请明确接受非阻断限制，并填写理由与绝对失效时间", { status: 400 });
}

export async function acceptCandidateGap(repository, actor, context, input) {
  return repository.withWorkspace(actor, context.workspaceId, true, async tx => {
    const run = (await tx.query("SELECT status FROM source_truth_run WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [context.workspaceId, context.runId])).rows[0];
    requireValue(run?.status === "REVIEW_REQUIRED", "SOURCE_INVALID_TRANSITION", "只能在当前候选核对阶段接受限制");
    const candidate = (await tx.query("SELECT * FROM source_truth_prepared_bundle WHERE workspace_id=$1 AND run_id=$2", [context.workspaceId, context.runId])).rows[0];
    requireValue(candidate?.id === input.candidateId && candidate?.payload.gapSetId === input.gapSetId, "SOURCE_CANDIDATE_CONFLICT", "候选或 Gap 集不同，请重新查看后确认");
    requireValue(candidate.payload.components.some(c => c.id === input.componentId), "SOURCE_NOT_FOUND", "限制不属于当前候选", { status: 404 });
    const gap = (await tx.query("SELECT evidence FROM source_truth_component_gap WHERE workspace_id=$1 AND component_id=$2 AND gap_key=$3", [context.workspaceId, input.componentId, input.gapKey])).rows[0];
    requireValue(gap, "SOURCE_NOT_FOUND", "限制不属于当前候选", { status: 404 });
    requireValue(gap.evidence.severity === "NON_BLOCKING", "SOURCE_BLOCKING_GAP", "阻断不能通过接受绕过");
    validateAcceptanceInput(input);
    const expiresAt = new Date(input.expiresAt).toISOString();
    await assertAcceptance(tx, { payload: { gapCount: "1" }, expires_at: expiresAt });
    const parameters = [context.workspaceId, context.runId, candidate.id, input.componentId, input.gapKey];
    const prior = (await tx.query("SELECT *,expires_at>clock_timestamp() AS currently_valid FROM source_truth_gap_acceptance WHERE workspace_id=$1 AND run_id=$2 AND candidate_id=$3 AND component_id=$4 AND gap_key=$5 ORDER BY sequence DESC LIMIT 1", parameters)).rows[0];
    if (prior?.actor_id === actor.actorId && prior.reason === input.reason.trim() && new Date(prior.expires_at).toISOString() === expiresAt) return gapAcceptanceRecord(prior);
    const row = (await tx.query(`INSERT INTO source_truth_gap_acceptance (workspace_id,run_id,candidate_id,component_id,gap_key,id,gap_set_id,actor_id,reason,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *,expires_at>clock_timestamp() AS currently_valid`, [...parameters, randomUUID(), input.gapSetId, actor.actorId, input.reason.trim(), expiresAt])).rows[0];
    await repository.audit(tx, context.workspaceId, context.runId, actor.actorId, "GAP_ACCEPTED", { acceptanceId: row.id, candidateId: candidate.id, componentId: input.componentId, gapKey: input.gapKey });
    return gapAcceptanceRecord(row);
  });
}

export async function confirmCandidate(repository, actor, context, input) {
  return repository.withWorkspace(actor, context.workspaceId, true, async (tx) => {
    const run = await tx.query("SELECT * FROM source_truth_run WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [context.workspaceId, context.runId]);
    requireValue(["REVIEW_REQUIRED", "PREPARING_SEAL"].includes(run.rows[0]?.status), "SOURCE_INVALID_TRANSITION", "当前任务不在用户清单确认阶段");
    const candidate = (await tx.query("SELECT * FROM source_truth_prepared_bundle WHERE workspace_id=$1 AND run_id=$2", [context.workspaceId, context.runId])).rows[0];
    requireValue(candidate && candidate.id === input.candidateId && candidate.payload.gapSetId === input.gapSetId,
      "SOURCE_CANDIDATE_CONFLICT", "清单、候选或 Gap 集已经不同，请重新查看后确认");
    const hasGaps = candidate.counts.gapCount !== "0";
    const individual = hasGaps && input.useGapAcceptances === true;
    let decision;
    if (individual) {
      // Bounded application memory: SQL checks the entire set, then snapshots
      // its references in a normalized immutable table. Never fetch all Gaps.
      decision = (await tx.query(`WITH accepted AS (${latestGapAcceptancesSql}) SELECT count(*)::text AS total,
        count(*) FILTER (WHERE expires_at>clock_timestamp())::text AS valid, min(expires_at) AS earliest,
        max(sequence)::text AS revision FROM accepted`, [context.workspaceId, context.runId, candidate.id])).rows[0];
      requireValue(decision.total === candidate.counts.gapCount && decision.valid === candidate.counts.gapCount,
        "SOURCE_ACCEPTANCE_REQUIRED", "还有未接受或已过期的限制，请逐项核对后确认", { status: 400 });
    } else if (hasGaps) validateAcceptanceInput(input);
    const expiresAt = hasGaps ? new Date(individual ? decision.earliest : input.expiresAt).toISOString() : null;
    const payload = { candidateId: candidate.id, gapSetId: candidate.payload.gapSetId, policyRevisionId: candidate.payload.policyRevisionId,
      gapCount: candidate.counts.gapCount, reason: hasGaps ? individual ? "逐项接受，完整记录随确认保留" : input.reason.trim() : null, expiresAt,
      ...(individual ? { gapAcceptanceMode: "INDIVIDUAL", gapAcceptanceRevision: decision.revision } : {}) };
    await assertAcceptance(tx, { payload, expires_at: expiresAt });
    const latest = (await tx.query("SELECT * FROM source_truth_confirmation WHERE workspace_id=$1 AND run_id=$2 ORDER BY revision DESC LIMIT 1", [context.workspaceId, context.runId])).rows[0];
    if (latest?.actor_id === actor.actorId && canonicalEncode(latest.payload) === canonicalEncode(payload)) return confirmationRecord(latest);
    const { rows } = await tx.query(`INSERT INTO source_truth_confirmation (workspace_id,id,run_id,revision,candidate_id,actor_id,payload,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [context.workspaceId, randomUUID(), context.runId, (latest?.revision ?? 0) + 1,
      candidate.id, actor.actorId, JSON.stringify(payload), expiresAt]);
    if (individual) await tx.query(`INSERT INTO source_truth_confirmation_gap_acceptance (workspace_id,confirmation_id,acceptance_id)
      SELECT workspace_id,$4,id FROM (${latestGapAcceptancesSql}) accepted`, [context.workspaceId, context.runId, candidate.id, rows[0].id]);
    await tx.query("UPDATE source_truth_run SET status='REVIEW_REQUIRED',station=7,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2", [context.workspaceId, context.runId]);
    await repository.audit(tx, context.workspaceId, context.runId, actor.actorId, "CANDIDATE_CONFIRMED", { confirmationId: rows[0].id, candidateId: candidate.id, gapSetId: payload.gapSetId });
    return confirmationRecord(rows[0]);
  });
}
