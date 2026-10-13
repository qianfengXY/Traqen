import { requireValue, fail } from "./errors.js";
import { runRecord } from "./repository.js";
import { publicRun } from "./http-io.js";
import { confirmationRecord, latestGapAcceptancesSql, gapAcceptanceRecord } from "./confirmation-service.js";
import { inventoryOptions, inventoryResult } from "./inventory-query.js";
import { SourceSnapshotReader } from "./admission-service.js";
import { createHash } from "node:crypto";
import { decodePathBytes } from "./identity.js";
import { contentAvailabilitySql } from "./content-state.js";

function page(input = {}) {
  const limit = input.limit ?? 100;
  requireValue(Number.isInteger(limit) && limit > 0 && limit <= 500, "SOURCE_INVALID_INPUT", "分页大小必须为 1～500", { status: 400 });
  let after = null;
  if (input.cursor) {
    try {
      requireValue(typeof input.cursor === "string" && input.cursor.length < 16384 && /^[A-Za-z0-9_-]+$/.test(input.cursor), "SOURCE_INVALID_INPUT", "分页定位符无效");
      after = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
      requireValue(after && typeof after === "object" && !Array.isArray(after), "SOURCE_INVALID_INPUT", "分页定位符无效");
    } catch { fail("SOURCE_INVALID_INPUT", "分页定位符无效", { status: 400 }); }
  }
  return { limit, after };
}
const cursor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const privateCandidate = (row) => row ? { id: row.id, ...row.payload, ...row.counts } : null;

// Read models never grant admission: expired acceptances and cancelled attempts
// remain inspectable by current Workspace readers. No private cache locator,
// lease, raw credential or unsealed file content is exposed here.
export class SourceQueryService {
  constructor(repository, materials) { Object.assign(this, { repository, materials }); }
  async inventory(actor, workspaceId, runId, sourceId, options) {
    const selected = inventoryOptions(options, { workspaceId, runId, sourceId });
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const context = await this.materials.readContext({ workspaceId, runId, sourceId }, tx);
      const from = `FROM source_truth_entry WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3
        AND position($4::bytea IN path_bytes)>0 AND ($5::text IS NULL OR COALESCE(disposition->>'disposition','PENDING')=$5)
        AND ($6::text IS NULL OR (${contentAvailabilitySql()})=$6)
        AND ($7::bytea IS NULL OR path_bytes=$7)`;
      const parameters = [workspaceId, context.runId, context.sourceId, selected.queryBytes, selected.disposition, selected.availability, selected.exactPath];
      const count = (await tx.query(`SELECT count(*)::text AS n ${from}`, parameters)).rows[0].n;
      const { rows } = await tx.query(`SELECT entry,disposition ${from} AND ($8::bytea IS NULL OR path_bytes>$8)
        ORDER BY path_bytes LIMIT $9`, [...parameters, selected.after?.path ?? null, selected.limit + 1]);
      return inventoryResult(rows, selected, count);
    });
  }
  async bundleRecord(tx, workspaceId, row) {
    const latest = (await tx.query(`SELECT r.payload,r.issued_at,c.expires_at FROM source_truth_receipt r JOIN source_truth_confirmation c
      ON c.workspace_id=r.workspace_id AND c.id=r.confirmation_id WHERE r.workspace_id=$1 AND r.bundle_id=$2 ORDER BY r.issued_at DESC,r.id DESC LIMIT 1`, [workspaceId, row.id])).rows[0];
    const components = (await tx.query(`SELECT c.id,c.run_id,c.source_id,c.payload,c.counts,s.locator FROM source_truth_bundle_component b JOIN source_truth_component c
      ON c.workspace_id=b.workspace_id AND c.id=b.component_id LEFT JOIN source_truth_registration s
      ON s.workspace_id=c.workspace_id AND s.source_id=c.payload->>'sourceId' WHERE b.workspace_id=$1 AND b.bundle_id=$2 ORDER BY c.payload->>'kind'`, [workspaceId, row.id])).rows;
    const projectedComponents = [];
    for (const component of components) projectedComponents.push({ id: component.id, ...component.payload, ...component.counts, sourceUrl: component.locator ?? null,
      fileCoverage: await this.materials.fileCoverage({ workspaceId, runId: component.run_id, sourceId: component.source_id }, tx) });
    const first = (await tx.query("SELECT payload FROM source_truth_receipt WHERE workspace_id=$1 AND bundle_id=$2 ORDER BY issued_at,id LIMIT 1", [workspaceId, row.id])).rows[0];
    return { id: row.id, ...row.payload, publishedAt: new Date(row.published_at).toISOString(), publishedBy: first?.payload.acceptedBy ?? null,
      components: projectedComponents, currentAdmission: "NOT_CHECKED",
      latestReceipt: latest ? { ...latest.payload, issuedAt: new Date(latest.issued_at).toISOString(), expiresAt: latest.expires_at ? new Date(latest.expires_at).toISOString() : null } : null };
  }
  async bundle(actor, workspaceId, bundleId) {
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const row = (await tx.query("SELECT * FROM source_truth_bundle WHERE workspace_id=$1 AND id=$2", [workspaceId, bundleId])).rows[0];
      requireValue(row, "SOURCE_NOT_FOUND", "冻结包不存在", { status: 404 });
      return this.bundleRecord(tx, workspaceId, row);
    });
  }
  async run(actor, workspaceId, runId) {
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const row = (await tx.query("SELECT * FROM source_truth_run WHERE workspace_id=$1 AND id=$2", [workspaceId, runId])).rows[0];
      requireValue(row, "SOURCE_NOT_FOUND", "任务不存在", { status: 404 });
      const candidate = (await tx.query("SELECT * FROM source_truth_prepared_bundle WHERE workspace_id=$1 AND run_id=$2", [workspaceId, runId])).rows[0];
      const confirmation = (await tx.query("SELECT *,expires_at IS NULL OR expires_at>clock_timestamp() AS currently_valid FROM source_truth_confirmation WHERE workspace_id=$1 AND run_id=$2 ORDER BY revision DESC LIMIT 1", [workspaceId, runId])).rows[0];
      const operation = row.publication_operation_id ? (await tx.query("SELECT id,status,result FROM source_truth_publication_operation WHERE workspace_id=$1 AND id=$2", [workspaceId, row.publication_operation_id])).rows[0] : null;
      const sources = [];
      for (const source of (await tx.query("SELECT * FROM source_truth_run_source WHERE workspace_id=$1 AND run_id=$2 ORDER BY kind", [workspaceId, runId])).rows) {
        const summary = await this.materials.summary({ workspaceId, runId, sourceId: source.source_id }, tx);
        sources.push({ sourceId: source.source_id, kind: source.kind, mode: source.source.mode ?? "UPDATE", scope: source.source.scope,
          nativeIdentity: source.source.nativeIdentity, manifestId: source.manifest_id, enumerationClosed: source.enumeration_closed, summary,
          fileCoverage: await this.materials.fileCoverage({ workspaceId, runId, sourceId: source.source_id }, tx) });
      }
      const abandoned = Boolean((await tx.query("SELECT 1 FROM source_truth_staging_release WHERE workspace_id=$1 AND run_id=$2", [workspaceId, runId])).rows.length);
      return { run: { ...publicRun(runRecord(row)), abandoned }, sources, candidate: privateCandidate(candidate), confirmation: confirmation ? { ...confirmationRecord(confirmation), currentlyValid: confirmation.currently_valid } : null,
        operation: operation ? { id: operation.id, status: operation.status } : null, result: operation?.result ?? null };
    });
  }

  async receipts(actor, workspaceId, bundleId, options) {
    const { limit, after } = page(options);
    requireValue(!after || (after.bundleId === bundleId && typeof after.id === "string" && after.id.length <= 128 && Number.isFinite(Date.parse(after.at))), "SOURCE_INVALID_INPUT", "凭据分页必须保持精确包绑定", { status: 400 });
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      requireValue((await tx.query("SELECT id FROM source_truth_bundle WHERE workspace_id=$1 AND id=$2", [workspaceId, bundleId])).rows[0], "SOURCE_NOT_FOUND", "冻结包不存在", { status: 404 });
      const { rows } = await tx.query(`SELECT payload,issued_at,issued_at::text AS cursor_time,id FROM source_truth_receipt
        WHERE workspace_id=$1 AND bundle_id=$2 AND ($3::timestamptz IS NULL OR (issued_at,id)<($3::timestamptz,$4::text))
        ORDER BY issued_at DESC,id DESC LIMIT $5`, [workspaceId, bundleId, after?.at ?? null, after?.id ?? null, limit + 1]);
      const last = rows[limit - 1];
      return { items: rows.slice(0, limit).map((row) => ({ ...row.payload, issuedAt: new Date(row.issued_at).toISOString(), currentAdmission: "NOT_CHECKED" })),
        nextCursor: rows.length > limit ? cursor({ bundleId, at: last.cursor_time, id: last.id }) : null };
    });
  }

  async gaps(actor, workspaceId, reference, options) {
    const { limit, after } = page(options);
    const selectedComponent = options?.componentId || null, selectedPath = options?.pathBytes || null;
    requireValue(!selectedComponent || /^[a-f0-9]{64}$/.test(selectedComponent), "SOURCE_INVALID_INPUT", "Gap 组件筛选无效", { status: 400 });
    if (selectedPath) { try { decodePathBytes(selectedPath); } catch { fail("SOURCE_INVALID_INPUT", "Gap 路径筛选无效", { status: 400 }); } }
    const queryId = createHash("sha256").update(JSON.stringify({ workspaceId, reference, selectedComponent, selectedPath })).digest("hex");
    requireValue(!after || (after.queryId === queryId && /^[a-f0-9]{64}$/.test(after.gapKey) && /^[a-f0-9]{64}$/.test(after.componentId)), "SOURCE_INVALID_INPUT", "Gap 分页必须保持精确引用与筛选", { status: 400 });
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      let identity, counts, candidateId, confirmation;
      if (reference.runId) {
        const row = (await tx.query("SELECT id,payload,counts FROM source_truth_prepared_bundle WHERE workspace_id=$1 AND run_id=$2", [workspaceId, reference.runId])).rows[0];
        requireValue(row, "SOURCE_NOT_FOUND", "尚未形成可审阅的完整候选", { status: 404 });
        identity = row.payload; counts = row.counts; candidateId = row.id;
      } else {
        const row = (await tx.query("SELECT payload FROM source_truth_bundle WHERE workspace_id=$1 AND id=$2", [workspaceId, reference.bundleId])).rows[0];
        requireValue(row, "SOURCE_NOT_FOUND", "冻结包不存在", { status: 404 });
        identity = row.payload.identity; counts = row.payload.counts;
        confirmation = (await tx.query(`SELECT c.*,c.expires_at>clock_timestamp() AS currently_valid FROM source_truth_receipt r
          JOIN source_truth_confirmation c ON c.workspace_id=r.workspace_id AND c.id=r.confirmation_id
          WHERE r.workspace_id=$1 AND r.bundle_id=$2 AND ($3::text IS NULL OR r.id=$3)
          ORDER BY r.issued_at DESC,r.id DESC LIMIT 1`, [workspaceId, reference.bundleId, reference.receiptId ?? null])).rows[0];
        requireValue(confirmation, "SOURCE_NOT_FOUND", "指定的包与 Receipt 绑定不存在", { status: 404 });
        const receiptId = reference.receiptId ?? (await tx.query("SELECT id FROM source_truth_receipt WHERE workspace_id=$1 AND bundle_id=$2 AND confirmation_id=$3", [workspaceId, reference.bundleId, confirmation.id])).rows[0]?.id;
        await new SourceSnapshotReader(this.repository).assertBinding(workspaceId, { bundleId: reference.bundleId, receiptId }, tx);
      }
      requireValue(!selectedComponent || identity.components.some(component => component.id === selectedComponent), "SOURCE_INVALID_INPUT", "Gap 组件不属于所选来源包", { status: 400 });
      const { rows } = await tx.query(`SELECT component_id,evidence FROM source_truth_component_gap WHERE workspace_id=$1 AND component_id=ANY($2::text[])
        AND ($3::text IS NULL OR (gap_key,component_id)>($3,$4))
        AND ($6::text IS NULL OR component_id=$6) AND ($7::text IS NULL OR evidence->>'pathBytes'=$7)
        ORDER BY gap_key,component_id LIMIT $5`,
      [workspaceId, identity.components.map((component) => component.id), after?.gapKey ?? null, after?.componentId ?? null, limit + 1, selectedComponent, selectedPath]);
      const items = rows.slice(0, limit).map((row) => ({ ...row.evidence, componentId: row.component_id }));
      // Each page is bounded. Never collect the entire acceptance set in JS.
      for (const item of items) {
        let acceptance;
        if (reference.runId) acceptance = (await tx.query(`SELECT *,expires_at>clock_timestamp() AS currently_valid FROM source_truth_gap_acceptance
          WHERE workspace_id=$1 AND run_id=$2 AND candidate_id=$3 AND component_id=$4 AND gap_key=$5 ORDER BY sequence DESC LIMIT 1`, [workspaceId, reference.runId, candidateId, item.componentId, item.gapKey])).rows[0];
        else if (confirmation.payload.gapAcceptanceMode === "INDIVIDUAL") acceptance = (await tx.query(`SELECT a.*,a.expires_at>clock_timestamp() AS currently_valid FROM source_truth_gap_acceptance a
          JOIN source_truth_confirmation_gap_acceptance b ON b.workspace_id=a.workspace_id AND b.acceptance_id=a.id
          WHERE b.workspace_id=$1 AND b.confirmation_id=$2 AND a.component_id=$3 AND a.gap_key=$4`, [workspaceId, confirmation.id, item.componentId, item.gapKey])).rows[0];
        else if (counts.gapCount !== "0") item.acceptance = { id: confirmation.id, actorId: confirmation.actor_id, reason: confirmation.payload.reason,
          expiresAt: new Date(confirmation.expires_at).toISOString(), acceptedAt: new Date(confirmation.confirmed_at).toISOString(), currentlyValid: confirmation.currently_valid, mode: "COMPLETE_SET" };
        if (acceptance) item.acceptance = gapAcceptanceRecord(acceptance);
      }
      const acceptedCount = reference.runId ? (await tx.query(`WITH accepted AS (${latestGapAcceptancesSql})
        SELECT count(*) FILTER (WHERE expires_at>clock_timestamp())::text AS n FROM accepted`, [workspaceId, reference.runId, candidateId])).rows[0].n : counts.gapCount;
      const last = items.at(-1);
      const matchedCount = selectedComponent || selectedPath ? (await tx.query(`SELECT count(*)::text AS n FROM source_truth_component_gap
        WHERE workspace_id=$1 AND component_id=ANY($2::text[]) AND ($3::text IS NULL OR component_id=$3)
        AND ($4::text IS NULL OR evidence->>'pathBytes'=$4)`, [workspaceId, identity.components.map(component => component.id), selectedComponent, selectedPath])).rows[0].n : counts.gapCount;
      return { gapSetId: identity.gapSetId, total: counts.gapCount, matchedCount, acceptedCount, items,
        nextCursor: rows.length > limit ? cursor({ queryId, gapKey: last.gapKey, componentId: last.componentId }) : null };
    });
  }

  async history(actor, workspaceId, kind, options) {
    const { limit, after } = page(options);
    const config = { runs: ["source_truth_run", "created_at"], bundles: ["source_truth_bundle", "published_at"], receipts: ["source_truth_receipt", "issued_at"] }[kind];
    requireValue(config, "SOURCE_INVALID_INPUT", "历史视图无效", { status: 400 });
    requireValue(!after || (after.kind === kind && typeof after.id === "string" && after.id.length <= 128 && typeof after.at === "string" && Number.isFinite(Date.parse(after.at))), "SOURCE_INVALID_INPUT", "历史分页定位符无效", { status: 400 });
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const [table, timestamp] = config;
      const { rows } = await tx.query(`SELECT *,${timestamp}::text AS cursor_time FROM ${table} WHERE workspace_id=$1
        AND ($2::timestamptz IS NULL OR (${timestamp},id)<($2::timestamptz,$3::text)) ORDER BY ${timestamp} DESC,id DESC LIMIT $4`,
      [workspaceId, after?.at ?? null, after?.id ?? null, limit + 1]);
      const items = [];
      for (const row of rows.slice(0, limit)) {
        if (kind === "runs") items.push(publicRun(runRecord(row)));
        else if (kind === "receipts") items.push({ ...row.payload, issuedAt: new Date(row.issued_at).toISOString(), currentAdmission: "NOT_CHECKED" });
        else items.push(await this.bundleRecord(tx, workspaceId, row));
      }
      const last = rows[limit - 1];
      return { items, nextCursor: rows.length > limit ? cursor({ kind, at: last.cursor_time, id: last.id }) : null };
    });
  }
}
