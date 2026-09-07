import { canonicalEncode, decodePathBytes, structureDigest } from "./identity.js";
import { requireValue, fail } from "./errors.js";
import { assertAcceptance } from "./confirmation-service.js";

function pageOptions({ limit = 100, cursor = null } = {}) {
  requireValue(Number.isInteger(limit) && limit > 0 && limit <= 1000, "SOURCE_INVALID_INPUT", "分页大小必须为 1～1000", { status: 400 });
  let after = null;
  if (cursor !== null) {
    try {
      requireValue(typeof cursor === "string" && cursor.length <= 16384 && /^[A-Za-z0-9_-]+$/.test(cursor), "SOURCE_INVALID_INPUT", "分页定位符无效");
      after = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      requireValue(/^[a-f0-9]{64}$/.test(after.componentId), "SOURCE_INVALID_INPUT", "分页组件定位符无效");
    } catch { fail("SOURCE_INVALID_INPUT", "分页定位符无效", { status: 400 }); }
  }
  return { limit, after };
}
const cursor = (value) => Buffer.from(canonicalEncode(value)).toString("base64url");

// Human inspection of an immutable historical version. There is deliberately
// no qualify method here: a readable historical Receipt is not analysis consent.
export class SourceSnapshotReader {
  constructor(repository, candidates) { Object.assign(this, { repository, candidates }); }

  async records(actor, workspaceId, reference, tx = this.repository.database) {
    const access = await this.repository.authorize(actor, workspaceId, false, tx);
    requireValue(access.restoreReady, "SOURCE_RESTORE_UNVERIFIED", "恢复尚未完整校验，暂不允许下游消费");
    const row = await this.assertBinding(workspaceId, reference, tx);
    await this.assertReadPurpose(tx, row);
    return { scope: { workspaceId, tenantId: access.tenantId }, bundle: { id: reference.bundleId, payload: row.bundle.identity, counts: row.bundle.counts },
      receipt: { ...row.receipt, issuedAt: new Date(row.issued_at).toISOString() } };
  }

  async assertReadPurpose() { /* Historical inspection needs no new analysis consent. */ }

  // Integrity-only internal check, not an admission endpoint. Backup/history
  // must retain expired evidence without reauthorizing a new analysis.
  async assertBinding(workspaceId, reference, tx = this.repository.database) {
    requireValue(reference && /^[a-f0-9]{64}$/.test(reference.bundleId) && typeof reference.receiptId === "string" && reference.receiptId.length > 0,
      "SOURCE_SEALED_REFERENCE_REQUIRED", "下游只接受冻结 Bundle 和精确 Receipt，不接受路径、ref 或上传会话", { status: 400 });
    const row = (await tx.query(`SELECT r.id,r.status,r.payload AS receipt,r.issued_at,b.payload AS bundle,c.payload AS confirmation,c.expires_at
      FROM source_truth_receipt r JOIN source_truth_bundle b ON b.workspace_id=r.workspace_id AND b.id=r.bundle_id
      JOIN source_truth_confirmation c ON c.workspace_id=r.workspace_id AND c.id=r.confirmation_id
      WHERE r.workspace_id=$1 AND r.id=$2 AND r.bundle_id=$3`, [workspaceId, reference.receiptId, reference.bundleId])).rows[0];
    requireValue(row, "SOURCE_RECEIPT_NOT_FOUND", "未找到此冻结包与 Receipt 的精确绑定", { status: 404 });
    requireValue(["READY", "READY_WITH_ACCEPTED_GAPS"].includes(row.status) && row.receipt.status === row.status
      && row.receipt.bundleId === reference.bundleId && row.receipt.id === reference.receiptId
      && row.confirmation.candidateId === reference.bundleId && structureDigest("bundle", row.bundle.identity) === reference.bundleId
      && row.bundle.identity.gapSetId === row.receipt.gapSetId && row.confirmation.gapSetId === row.receipt.gapSetId
      && row.bundle.counts.gapCount === row.receipt.gapCount && row.confirmation.gapCount === row.receipt.gapCount,
    "SOURCE_RECEIPT_CORRUPT", "包、确认或凭据之间的绑定校验失败");
    return row;
  }

  async inventory(actor, workspaceId, reference, options) {
    const { limit, after } = pageOptions(options);
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      await this.records(actor, workspaceId, reference, tx);
      const { rows } = await tx.query(`SELECT c.id AS component_id,e.entry,e.disposition FROM source_truth_bundle_component b
        JOIN source_truth_component c ON c.workspace_id=b.workspace_id AND c.id=b.component_id
        JOIN source_truth_entry e ON e.workspace_id=c.workspace_id AND e.run_id=c.run_id AND e.source_id=c.source_id
        WHERE b.workspace_id=$1 AND b.bundle_id=$2 AND ($3::text IS NULL OR c.id>$3 OR (c.id=$3 AND e.path_bytes>$4))
        ORDER BY c.id,e.path_bytes LIMIT $5`, [workspaceId, reference.bundleId, after?.componentId ?? null, after ? decodePathBytes(after.pathBytes) : null, limit + 1]);
      const items = rows.slice(0, limit).map((row) => ({ componentId: row.component_id, entry: row.entry, disposition: row.disposition }));
      const last = items.at(-1);
      return { items, nextCursor: rows.length > limit ? cursor({ componentId: last.componentId, pathBytes: last.entry.pathBytes }) : null };
    });
  }

  async inheritedGaps(actor, workspaceId, reference, options) {
    const { limit, after } = pageOptions(options);
    requireValue(!after || /^[a-f0-9]{64}$/.test(after.gapKey), "SOURCE_INVALID_INPUT", "Gap 分页定位符无效", { status: 400 });
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const records = await this.records(actor, workspaceId, reference, tx);
      const { rows } = await tx.query(`SELECT g.component_id,g.gap_key,g.evidence FROM source_truth_bundle_component b
        JOIN source_truth_component_gap g ON g.workspace_id=b.workspace_id AND g.component_id=b.component_id
        WHERE b.workspace_id=$1 AND b.bundle_id=$2 AND ($3::text IS NULL OR g.gap_key>$3 OR (g.gap_key=$3 AND g.component_id>$4))
        ORDER BY g.gap_key,g.component_id LIMIT $5`, [workspaceId, reference.bundleId, after?.gapKey ?? null, after?.componentId ?? null, limit + 1]);
      const items = rows.slice(0, limit).map((row) => ({ componentId: row.component_id, ...row.evidence }));
      const last = items.at(-1);
      return { gapSetId: records.receipt.gapSetId, total: records.receipt.gapCount, items,
        nextCursor: rows.length > limit ? cursor({ componentId: last.componentId, gapKey: last.gapKey }) : null };
    });
  }

  async *readFile(actor, workspaceId, reference, locator) {
    const { scope, disposition } = await this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const records = await this.records(actor, workspaceId, reference, tx);
      const row = (await tx.query(`SELECT e.disposition FROM source_truth_bundle_component b
        JOIN source_truth_component c ON c.workspace_id=b.workspace_id AND c.id=b.component_id
        JOIN source_truth_entry e ON e.workspace_id=c.workspace_id AND e.run_id=c.run_id AND e.source_id=c.source_id
        WHERE b.workspace_id=$1 AND b.bundle_id=$2 AND c.id=$3 AND e.path_bytes=$4`, [workspaceId, reference.bundleId, locator.componentId, decodePathBytes(locator.pathBytes)])).rows[0];
      requireValue(row?.disposition?.digest, "SOURCE_CONTENT_UNAVAILABLE", "该条目没有已采集正文；请查看明确缺口或元数据", { status: 404 });
      return { scope: records.scope, disposition: row.disposition };
    });
    for await (const chunk of this.candidates.blobs.readBlob(scope, { digest: disposition.digest, sizeBytes: disposition.sizeBytes })) {
      await this.records(actor, workspaceId, reference);
      yield chunk;
    }
  }
}

export class SourceAdmissionService extends SourceSnapshotReader {
  async assertReadPurpose(tx, row) {
    await assertAcceptance(tx, { payload: row.confirmation, expires_at: row.expires_at });
  }

  async qualify(actor, workspaceId, reference) {
    const records = await this.repository.withWorkspace(actor, workspaceId, false, (tx) => this.records(actor, workspaceId, reference, tx));
    await this.candidates.verifyEvidence(workspaceId, records.bundle, { scope: records.scope, heartbeat: () => this.records(actor, workspaceId, reference) });
    await this.repository.withWorkspace(actor, workspaceId, false, (tx) => this.records(actor, workspaceId, reference, tx));
    return { workspaceId, bundleId: reference.bundleId, receiptId: reference.receiptId, receiptStatus: records.receipt.status,
      ...records.bundle.counts, inventoryId: records.bundle.payload.inventoryId, gapSetId: records.bundle.payload.gapSetId,
      inheritedGapSet: { id: records.bundle.payload.gapSetId, count: records.bundle.counts.gapCount, consumption: "ALL_PAGES_REQUIRED" } };
  }
}
