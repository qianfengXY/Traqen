import { requireValue, fail } from "./errors.js";
import { runRecord } from "./repository.js";
import { publicRun } from "./http-io.js";
import { confirmationRecord } from "./confirmation-service.js";

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
  async bundleRecord(tx, workspaceId, row) {
    const latest = (await tx.query(`SELECT r.payload,r.issued_at,c.expires_at FROM source_truth_receipt r JOIN source_truth_confirmation c
      ON c.workspace_id=r.workspace_id AND c.id=r.confirmation_id WHERE r.workspace_id=$1 AND r.bundle_id=$2 ORDER BY r.issued_at DESC,r.id DESC LIMIT 1`, [workspaceId, row.id])).rows[0];
    const components = (await tx.query(`SELECT c.id,c.payload,c.counts,s.locator FROM source_truth_bundle_component b JOIN source_truth_component c
      ON c.workspace_id=b.workspace_id AND c.id=b.component_id LEFT JOIN source_truth_registration s
      ON s.workspace_id=c.workspace_id AND s.source_id=c.payload->>'sourceId' WHERE b.workspace_id=$1 AND b.bundle_id=$2 ORDER BY c.payload->>'kind'`, [workspaceId, row.id])).rows;
    return { id: row.id, ...row.payload, publishedAt: new Date(row.published_at).toISOString(),
      components: components.map((c) => ({ id: c.id, ...c.payload, ...c.counts, sourceUrl: c.locator ?? null })), currentAdmission: "NOT_CHECKED",
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
          nativeIdentity: source.source.nativeIdentity, manifestId: source.manifest_id, enumerationClosed: source.enumeration_closed, summary });
      }
      return { run: publicRun(runRecord(row)), sources, candidate: privateCandidate(candidate), confirmation: confirmation ? { ...confirmationRecord(confirmation), currentlyValid: confirmation.currently_valid } : null,
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
    requireValue(!after || (/^[a-f0-9]{64}$/.test(after.gapKey) && /^[a-f0-9]{64}$/.test(after.componentId)), "SOURCE_INVALID_INPUT", "Gap 分页定位符无效", { status: 400 });
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      let identity, counts;
      if (reference.runId) {
        const row = (await tx.query("SELECT payload,counts FROM source_truth_prepared_bundle WHERE workspace_id=$1 AND run_id=$2", [workspaceId, reference.runId])).rows[0];
        requireValue(row, "SOURCE_NOT_FOUND", "尚未形成可审阅的完整候选", { status: 404 });
        identity = row.payload; counts = row.counts;
      } else {
        const row = (await tx.query("SELECT payload FROM source_truth_bundle WHERE workspace_id=$1 AND id=$2", [workspaceId, reference.bundleId])).rows[0];
        requireValue(row, "SOURCE_NOT_FOUND", "冻结包不存在", { status: 404 });
        identity = row.payload.identity; counts = row.payload.counts;
      }
      const { rows } = await tx.query(`SELECT component_id,evidence FROM source_truth_component_gap WHERE workspace_id=$1 AND component_id=ANY($2::text[])
        AND ($3::text IS NULL OR (gap_key,component_id)>($3,$4)) ORDER BY gap_key,component_id LIMIT $5`,
      [workspaceId, identity.components.map((component) => component.id), after?.gapKey ?? null, after?.componentId ?? null, limit + 1]);
      const items = rows.slice(0, limit).map((row) => ({ ...row.evidence, componentId: row.component_id }));
      const last = items.at(-1);
      return { gapSetId: identity.gapSetId, total: counts.gapCount, items,
        nextCursor: rows.length > limit ? cursor({ gapKey: last.gapKey, componentId: last.componentId }) : null };
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
