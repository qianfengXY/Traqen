import { createHash } from "node:crypto";
import { decodePathBytes, structureDigest } from "./identity.js";
import { requireValue, fail } from "./errors.js";

// Both technical extraction and business investigation read this source-owned
// reference. It deliberately contains no fact-set, graph or Receipt identity.
export async function readSourceMaterial(reader, actor, workspaceId, reference, locator, { maxBytes = 8 * 1024 * 1024 } = {}) {
  requireValue(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 64 * 1024 * 1024,
    "SOURCE_INVALID_INPUT", "材料读取预算必须在 1 字节至 64 MiB 之间", { status: 400 });
  await reader.records(actor, workspaceId, reference);
  requireValue(/^[a-f0-9]{64}$/.test(locator?.componentId ?? ""), "SOURCE_INVALID_INPUT", "材料组件定位符无效", { status: 400 });
  try { decodePathBytes(locator?.pathBytes); }
  catch { fail("SOURCE_INVALID_INPUT", "材料路径必须为规范的相对路径字节", { status: 400 }); }
  const page = await reader.inventory(actor, workspaceId, reference, { ...locator, limit: 1 });
  const item = page.items[0];
  requireValue(item?.componentId === locator.componentId && item.entry.pathBytes === locator.pathBytes
    && /^[a-f0-9]{64}$/.test(item.disposition?.digest ?? ""),
  "SOURCE_CONTENT_UNAVAILABLE", "该冻结版本的条目没有已采集正文，请查看材料清单和缺口", { status: 404 });
  const sourceMaterial = { workspaceId, bundleId: reference.bundleId, componentId: locator.componentId,
    pathBytes: locator.pathBytes, contentDigest: item.disposition.digest };
  sourceMaterial.id = structureDigest("material", sourceMaterial);
  const auditReference = { materialId: sourceMaterial.id, bundleId: reference.bundleId, receiptId: reference.receiptId,
    analysisRunId: reference.analysisRunId ?? null, maxBytes };
  const audit = (type, extra = {}) => reader.repository.withWorkspace(actor, workspaceId, false, async tx => {
    await reader.records(actor, workspaceId, reference, tx);
    await reader.repository.audit(tx, workspaceId, null, actor.actorId, type, { ...auditReference, ...extra });
  });
  await audit("MATERIAL_READ_INTENT");
  try {
    requireValue(/^\d+$/.test(item.disposition.sizeBytes ?? "") && BigInt(item.disposition.sizeBytes) <= BigInt(maxBytes),
      "SOURCE_READ_BUDGET_EXCEEDED", "材料超过受控读取上限，请使用有界流式读取", { status: 413 });
    const chunks = [], hash = createHash("sha256");
    let size = 0;
    for await (const chunk of reader.readFile(actor, workspaceId, reference, locator)) {
      size += chunk.length;
      requireValue(size <= maxBytes, "SOURCE_READ_BUDGET_EXCEEDED", "材料超过受控读取上限", { status: 413 });
      chunks.push(Buffer.from(chunk));
      hash.update(chunk);
    }
    const originalDigest = hash.digest("hex");
    requireValue(String(size) === item.disposition.sizeBytes && originalDigest === sourceMaterial.contentDigest,
      "SOURCE_CONTENT_MISMATCH", "读取字节与冻结材料的长度或摘要不符");
    // This final fence prevents a revoked or unrestored reader from receiving
    // a buffered result even when its last chunk was read before the change.
    await audit("MATERIAL_READ_COMPLETED", { originalDigest, sizeBytes: String(size) });
    return { bytes: Buffer.concat(chunks, size), originalDigest, sourceMaterial, receiptId: reference.receiptId };
  } catch (error) {
    await audit("MATERIAL_READ_INTERRUPTED", { code: error?.code ?? "SOURCE_READ_FAILED" }).catch(() => {});
    throw error;
  }
}
