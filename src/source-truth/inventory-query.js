import { createHash } from "node:crypto";
import { canonicalEncode, decodePathBytes } from "./identity.js";
import { fail, requireValue } from "./errors.js";

// Inspection-only query state. Never used by manifest/capture entryStream.
export function inventoryOptions(input = {}, binding) {
  const { limit = 100, cursor = null } = input;
  const query = input.query ?? "", disposition = input.disposition || null, componentId = input.componentId || null;
  requireValue(Number.isInteger(limit) && limit > 0 && limit <= 1000, "SOURCE_INVALID_INPUT", "分页大小必须为 1～1000", { status: 400 });
  requireValue(typeof query === "string" && query.isWellFormed() && Buffer.byteLength(query) <= 256 && !/[\u0000-\u001f\u007f]/.test(query), "SOURCE_INVALID_INPUT", "路径搜索须为不超过 256 UTF-8 字节的文本", { status: 400 });
  requireValue(disposition === null || ["PENDING", "VERIFIED", "METADATA", "EXTERNAL_GAP"].includes(disposition), "SOURCE_INVALID_INPUT", "处置筛选无效", { status: 400 });
  requireValue(componentId === null || (binding.bundleId && typeof componentId === "string" && /^[a-f0-9]{64}$/.test(componentId)), "SOURCE_INVALID_INPUT", "组件筛选无效", { status: 400 });
  const queryId = createHash("sha256").update(canonicalEncode({ binding, query, disposition, componentId })).digest("hex");
  let after = null;
  if (cursor !== null) {
    try {
      requireValue(typeof cursor === "string" && cursor.length <= 16384 && /^[A-Za-z0-9_-]+$/.test(cursor), "SOURCE_INVALID_INPUT", "分页定位符无效");
      after = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      requireValue(after?.queryId === queryId && (binding.bundleId ? /^[a-f0-9]{64}$/.test(after.componentId) : after.componentId === null), "SOURCE_INVALID_INPUT", "分页必须保持版本、来源与筛选绑定");
      after.path = decodePathBytes(after.pathBytes);
    } catch { fail("SOURCE_INVALID_INPUT", "分页定位符与当前版本、来源或筛选不符，请回到首页", { status: 400 }); }
  }
  return { limit, after, queryId, queryBytes: Buffer.from(query), disposition, componentId };
}

export function inventoryResult(rows, options, matchedCount) {
  const items = rows.slice(0, options.limit).map((row) => ({ ...(row.component_id ? { componentId: row.component_id } : {}), entry: row.entry, disposition: row.disposition }));
  const last = items.at(-1);
  return { items, matchedCount, nextCursor: rows.length > options.limit ? Buffer.from(canonicalEncode({
    queryId: options.queryId, componentId: last.componentId ?? null, pathBytes: last.entry.pathBytes,
  })).toString("base64url") : null };
}
