import { canonicalEncode, decodePathBytes, structureDigest } from "./identity.js";
import { requireValue } from "./errors.js";

const comparisons = `WITH old_entries AS (
  SELECT path_bytes,entry,disposition FROM source_truth_entry WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3
), new_entries AS (
  SELECT path_bytes,entry,disposition FROM source_truth_entry WHERE workspace_id=$1 AND run_id=$4 AND source_id=$5
), delta AS (
  SELECT COALESCE(a.path_bytes,b.path_bytes) AS path_bytes,a.entry AS before_entry,b.entry AS after_entry,
    a.disposition AS before_disposition,b.disposition AS after_disposition,
    CASE WHEN a.path_bytes IS NULL THEN 'ADDED' WHEN b.path_bytes IS NULL THEN 'DELETED'
      WHEN a.entry->>'kind' IS DISTINCT FROM b.entry->>'kind' OR a.entry->>'gitMode' IS DISTINCT FROM b.entry->>'gitMode'
        OR a.entry->>'sizeBytes' IS DISTINCT FROM b.entry->>'sizeBytes' OR a.disposition IS DISTINCT FROM b.disposition THEN 'MODIFIED'
      ELSE 'UNCHANGED' END AS change
  FROM old_entries a FULL OUTER JOIN new_entries b ON a.path_bytes=b.path_bytes
)`;

export class SourceDeltaService {
  constructor(repository) { this.repository = repository; }

  async component(tx, workspaceId, bundleId, sourceId) {
    requireValue(/^[a-f0-9]{64}$/.test(bundleId), "SOURCE_SEALED_REFERENCE_REQUIRED", "比较必须指定两个冻结版本", { status: 400 });
    const bundle = (await tx.query("SELECT payload FROM source_truth_bundle WHERE workspace_id=$1 AND id=$2", [workspaceId, bundleId])).rows[0];
    requireValue(bundle && structureDigest("bundle", bundle.payload.identity) === bundleId, "SOURCE_NOT_FOUND", "未找到该 Workspace 的冻结包", { status: 404 });
    const reference = bundle.payload.identity.components.find((component) => component.sourceId === sourceId);
    if (!reference) return null;
    const row = (await tx.query("SELECT * FROM source_truth_component WHERE workspace_id=$1 AND id=$2", [workspaceId, reference.id])).rows[0];
    requireValue(row && structureDigest("component", row.payload) === reference.id, "SOURCE_MANIFEST_CORRUPT", "组件身份校验失败");
    return row;
  }

  async compare(actor, workspaceId, input) {
    const limit = input.limit ?? 100;
    requireValue(typeof input.sourceId === "string" && Number.isInteger(limit) && limit > 0 && limit <= 1000,
      "SOURCE_INVALID_INPUT", "需要来源登记和有效分页大小", { status: 400 });
    const after = input.cursor ? decodePathBytes(input.cursor) : null;
    return this.repository.withWorkspace(actor, workspaceId, false, async (tx) => {
      const before = await this.component(tx, workspaceId, input.fromBundleId, input.sourceId);
      const afterComponent = await this.component(tx, workspaceId, input.toBundleId, input.sourceId);
      if (!before || !afterComponent || before.payload.kind !== afterComponent.payload.kind
        || canonicalEncode(before.payload.scope) !== canonicalEncode(afterComponent.payload.scope)) {
        return { comparable: false, reason: !before ? "SOURCE_ADDED" : !afterComponent ? "SOURCE_REMOVED" : "SOURCE_SCOPE_CHANGED",
          fromScope: before?.payload.scope ?? null, toScope: afterComponent?.payload.scope ?? null,
          counts: null, items: [], nextCursor: null, explanation: "来源或声明范围不同，不把范围外材料冒称为文件删除" };
      }
      const parameters = [workspaceId, before.run_id, before.source_id, afterComponent.run_id, afterComponent.source_id];
      const aggregates = await tx.query(`${comparisons} SELECT change,count(*)::text AS count FROM delta GROUP BY change`, parameters);
      const counts = { added: "0", modified: "0", deleted: "0", unchanged: "0" };
      for (const row of aggregates.rows) counts[row.change.toLowerCase()] = row.count;
      const { rows } = await tx.query(`${comparisons} SELECT * FROM delta WHERE change<>'UNCHANGED'
        AND ($6::bytea IS NULL OR path_bytes>$6) ORDER BY path_bytes LIMIT $7`, [...parameters, after, limit + 1]);
      const locator = (bundleId, component, entry, disposition) => entry ? { bundleId, componentId: component.id, pathBytes: entry.pathBytes, entry, disposition } : null;
      const items = rows.slice(0, limit).map((row) => ({ change: row.change,
        pathBytes: Buffer.from(row.path_bytes).toString("base64url"),
        before: locator(input.fromBundleId, before, row.before_entry, row.before_disposition),
        after: locator(input.toBundleId, afterComponent, row.after_entry, row.after_disposition) }));
      return { comparable: true, fromBundleId: input.fromBundleId, toBundleId: input.toBundleId, sourceId: input.sourceId,
        countUnit: "ARTIFACT_ENTRY", counts, items, nextCursor: rows.length > limit ? items.at(-1).pathBytes : null };
    });
  }
}
