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
    await this.assertReadPurpose(tx, row, { actor, workspaceId, reference });
    return { scope: { workspaceId, tenantId: access.tenantId }, bundle: { id: reference.bundleId, payload: row.bundle.identity, counts: row.bundle.counts },
      receipt: { ...row.receipt, issuedAt: new Date(row.issued_at).toISOString() } };
  }

  async assertReadPurpose() { /* Historical inspection needs no new analysis consent. */ }

  // Integrity-only internal check, not an admission endpoint. Backup/history
  // must retain expired evidence without reauthorizing a new analysis.
  async assertBinding(workspaceId, reference, tx = this.repository.database) {
    requireValue(reference && /^[a-f0-9]{64}$/.test(reference.bundleId) && typeof reference.receiptId === "string" && reference.receiptId.length > 0,
      "SOURCE_SEALED_REFERENCE_REQUIRED", "下游只接受冻结 Bundle 和精确 Receipt，不接受路径、ref 或上传会话", { status: 400 });
    const row = (await tx.query(`SELECT r.id,r.status,r.payload AS receipt,r.issued_at,r.confirmation_id,b.payload AS bundle,c.payload AS confirmation,c.expires_at
      FROM source_truth_receipt r JOIN source_truth_bundle b ON b.workspace_id=r.workspace_id AND b.id=r.bundle_id
      JOIN source_truth_confirmation c ON c.workspace_id=r.workspace_id AND c.id=r.confirmation_id
      WHERE r.workspace_id=$1 AND r.id=$2 AND r.bundle_id=$3`, [workspaceId, reference.receiptId, reference.bundleId])).rows[0];
    requireValue(row, "SOURCE_RECEIPT_NOT_FOUND", "未找到此冻结包与 Receipt 的精确绑定", { status: 404 });
    requireValue(["READY", "READY_WITH_ACCEPTED_GAPS"].includes(row.status) && row.receipt.status === row.status
      && row.receipt.bundleId === reference.bundleId && row.receipt.id === reference.receiptId
      && row.receipt.confirmationId === row.confirmation_id
      && row.receipt.policyRevisionId === row.bundle.identity.policyRevisionId
      && row.confirmation.policyRevisionId === row.bundle.identity.policyRevisionId
      && row.receipt.expiresAt === (row.expires_at ? new Date(row.expires_at).toISOString() : null)
      && row.confirmation.expiresAt === row.receipt.expiresAt
      && (row.status === "READY") === (row.receipt.gapCount === "0")
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
      const items = rows.slice(0, limit).map((row) => ({ componentId: row.component_id, ...row.evidence,
        gapId: row.gap_key, componentSnapshotId: row.component_id, reasonCode: row.evidence.ruleCode }));
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
  // Server-side F002 integration only. The resolver must load F002's durable
  // analysis binding, not echo an HTTP body or cache a prior permission result.
  // Public /admission and ordinary reads keep checking current acceptance.
  forAdmittedAnalysis(resolveBinding) {
    return new AdmittedSourceReader(this.repository, this.candidates, resolveBinding);
  }

  async assertReadPurpose(tx, row) {
    await assertAcceptance(tx, { payload: row.confirmation, expires_at: row.expires_at });
  }

  async qualify(actor, workspaceId, reference) {
    const records = await this.repository.withWorkspace(actor, workspaceId, false, (tx) => this.records(actor, workspaceId, reference, tx));
    await this.candidates.verifyEvidence(workspaceId, records.bundle, { scope: records.scope, heartbeat: () => this.records(actor, workspaceId, reference) });
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const current = await this.records(actor, workspaceId, reference, tx);
      const components = [];
      // Only the bounded source-component list is materialized, never 100k
      // inventory entries or the Gap set. Audit upload locators refer to the
      // original (run, source) session, including when the component is reused.
      for (const component of current.bundle.payload.components) {
        const row = (await tx.query("SELECT run_id,source_id,payload FROM source_truth_component WHERE workspace_id=$1 AND id=$2", [workspaceId, component.id])).rows[0];
        requireValue(row && structureDigest("component", row.payload) === component.id
          && row.payload.kind === component.kind && row.payload.sourceId === component.sourceId
          && row.payload.policyRevisionId === current.bundle.payload.policyRevisionId,
        "SOURCE_MANIFEST_CORRUPT", "组件来源、策略或身份与冻结包不符");
        const { kind, nativeIdentity, scope, manifestId } = row.payload;
        components.push({ componentSnapshotId: component.id, kind, manifestId,
          ...(kind === "GIT" ? {
            nativeIdentity: { objectFormat: nativeIdentity.objectFormat, resolvedCommit: nativeIdentity.commit },
            declaredScope: scope.root === null ? { kind: "REPOSITORY" } : { kind: "DIRECTORY_ROOT", path: scope.root },
          } : {
            nativeIdentity: { manifestDigest: manifestId }, declaredScope: { kind: "UPLOADED_DIRECTORY" },
            provenance: { uploadId: Buffer.from(canonicalEncode({ runId: row.run_id, sourceId: row.source_id })).toString("base64url") },
          }) });
      }
      // Final decision uses the database clock, after byte verification and
      // under the same permission fence. This timestamp is evidence for F002
      // to persist, not a client-presentable token to bypass fresh admission.
      const decision = (await tx.query("SELECT clock_timestamp() AS qualified_at")).rows[0];
      const qualifiedAt = new Date(decision.qualified_at).toISOString();
      const receiptValidUntil = current.receipt.expiresAt;
      requireValue(receiptValidUntil === null || Date.parse(receiptValidUntil) > Date.parse(qualifiedAt),
        "SOURCE_ACCEPTANCE_EXPIRED", "Gap 接受在核验完成前已过期，请重新确认");
      return { workspaceId, bundleId: reference.bundleId, sourceBundleSnapshotId: reference.bundleId,
        receiptId: reference.receiptId, receiptStatus: current.receipt.status, receiptValidUntil, qualifiedAt,
        confirmationId: current.receipt.confirmationId,
        acceptanceRecordIds: current.receipt.gapCount === "0" ? [] : [current.receipt.confirmationId],
        components, policyRevisionId: current.bundle.payload.policyRevisionId,
        ...current.bundle.counts, inventoryId: current.bundle.payload.inventoryId, inventoryDigest: current.bundle.payload.inventoryId,
        gapSetId: current.bundle.payload.gapSetId,
        inheritedGapSet: { id: current.bundle.payload.gapSetId, count: current.bundle.counts.gapCount, consumption: "ALL_PAGES_REQUIRED" } };
    });
  }
}

class AdmittedSourceReader extends SourceSnapshotReader {
  #resolveBinding;

  constructor(repository, candidates, resolveBinding) {
    super(repository, candidates);
    requireValue(typeof resolveBinding === "function", "SOURCE_ANALYSIS_RESOLVER_REQUIRED", "已准入读取必须配置可信的 F002 持久绑定查询", { status: 503 });
    this.#resolveBinding = resolveBinding;
  }

  async assertReadPurpose(tx, row, { actor, workspaceId, reference }) {
    const { analysisRunId } = reference;
    requireValue(typeof analysisRunId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(analysisRunId),
      "SOURCE_ANALYSIS_ADMISSION_REQUIRED", "需要 F002 已持久保存的分析准入绑定", { status: 400 });
    const binding = await this.#resolveBinding(actor, workspaceId, analysisRunId, tx);
    requireValue(binding?.sourceInput, "SOURCE_ANALYSIS_ADMISSION_REQUIRED", "此分析没有已核验的持久准入记录");
    const input = binding.sourceInput;
    const now = (await tx.query("SELECT clock_timestamp() AS now")).rows[0].now;
    const time = Date.parse(input.qualifiedAt);
    const expectedAcceptance = row.receipt.gapCount === "0" ? [] : [row.confirmation_id];
    requireValue(binding.analysisRunId === analysisRunId && input.workspaceId === workspaceId
      && input.sourceBundleSnapshotId === reference.bundleId && input.receiptId === reference.receiptId
      && input.receiptStatus === row.status && input.confirmationId === row.confirmation_id
      && input.receiptValidUntil === row.receipt.expiresAt
      && Array.isArray(input.acceptanceRecordIds) && canonicalEncode(input.acceptanceRecordIds) === canonicalEncode(expectedAcceptance)
      && input.inventoryId === row.bundle.identity.inventoryId && input.inventoryDigest === row.bundle.identity.inventoryId
      && input.policyRevisionId === row.bundle.identity.policyRevisionId
      && input.inheritedGapSet?.id === row.bundle.identity.gapSetId && input.inheritedGapSet.count === row.receipt.gapCount
      && Number.isFinite(time) && time >= new Date(row.issued_at).getTime() && time <= new Date(now).getTime()
      && (input.receiptValidUntil === null || time < Date.parse(input.receiptValidUntil)),
    "SOURCE_ANALYSIS_ADMISSION_MISMATCH", "分析准入与确切版本、凭据、接受记录或准入时间不符，不能替换为较新凭据");
  }
}
