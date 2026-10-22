import { canonicalDigest } from "./identity.js";
import { F002Error, requireF002 } from "./errors.js";
import { assertSafeMediaType, CURRENT_DISPLAY_POLICY_REVISION, digestBytes, displayFormatForPathBytes, redactDisplayBytes } from "./policy.js";
import { rasterImageHeader } from "./raster-image.js";
import { decodePathBytes } from "../source-truth/identity.js";

function requireVersion(value) {
  requireF002(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "F002_VERSION_INVALID", "事实集版本定位符无效", { status: 422 });
}

function displayMediaType(mediaType, bytes) {
  if (mediaType.startsWith("image/")) {
    requireF002(rasterImageHeader(bytes)?.mediaType === mediaType,
      "F002_CONTENT_TYPE_RESTRICTED", "图片类型、头部或尺寸不满足受控展示条件", { status: 415 });
    return mediaType;
  }
  if (mediaType !== "application/octet-stream") return mediaType;
  // The admitted loader deliberately has no trusted MIME metadata. Classify
  // only the already controlled display copy, never rewrite sealed records or
  // use a filename to turn arbitrary binary bytes into a text document.
  const raster = rasterImageHeader(bytes);
  if (raster) return raster.mediaType;
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return mediaType; }
  // Allow physical text separators (including Properties form feed), but not
  // NUL or binary control bytes. Markup stays inert text, not HTML/XML/SVG.
  return /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(text) ? mediaType : "text/plain";
}

export class F002MaterialService {
  constructor(repository, admission, { maxReadBytes = 8 * 1024 * 1024, policyRevision = CURRENT_DISPLAY_POLICY_REVISION } = {}) {
    if (!repository?.withAuthorizedWorkspace || !repository?.appendEvent) throw new TypeError("F002 material service requires an authorized repository");
    if (!admission || typeof admission.readMaterial !== "function") throw new TypeError("F002 material service requires F001 controlled material reads");
    if (!Number.isInteger(maxReadBytes) || maxReadBytes < 1 || maxReadBytes > 64 * 1024 * 1024) throw new TypeError("F002 maxReadBytes is invalid");
    this.repository = repository;
    this.admission = admission;
    this.maxReadBytes = maxReadBytes;
    this.policyRevision = policyRevision;
  }

  async read(actor, workspaceId, graphVersionId, materialId) {
    requireVersion(graphVersionId);
    requireF002(typeof materialId === "string" && /^[a-f0-9]{64}$/.test(materialId), "F002_MATERIAL_INVALID", "材料定位符无效", { status: 422 });
    const material = await this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const row = (await tx.query(`SELECT f.run_id,f.scope_id,r.payload FROM f002_fact_set f JOIN f002_record r
        ON r.workspace_id=f.workspace_id AND r.graph_version_id=f.graph_version_id
        WHERE f.workspace_id=$1 AND f.graph_version_id=$2 AND r.kind='MATERIAL' AND r.id=$3`, [workspaceId, graphVersionId, materialId])).rows[0];
      requireF002(row, "F002_MATERIAL_NOT_FOUND", "当前事实集没有该材料", { status: 404 });
      const payload = row.payload;
      requireF002(payload && payload.materialId === materialId && typeof payload.componentId === "string" && typeof payload.pathBytes === "string",
        "F002_MATERIAL_CORRUPT", "材料记录缺少受控读取定位", { status: 409 });
      return { runId: row.run_id, scopeId: row.scope_id, payload };
    });
    const readableRef = canonicalDigest("READABLE_REF", { workspaceId, graphVersionId, materialId });
    await this.repository.appendEvent(actor, workspaceId, material.runId, material.scopeId, "READ_INTENT", { graphVersionId, materialId, readableRef, policyRevision: this.policyRevision });
    try {
      const source = await this.admission.readMaterial(actor, workspaceId, material.runId,
        { componentId: material.payload.componentId, pathBytes: material.payload.pathBytes }, { maxBytes: this.maxReadBytes });
      const original = source.bytes;
      const originalDigest = source.originalDigest;
      requireF002(!material.payload.contentDigest || material.payload.contentDigest === originalDigest,
        "F002_SOURCE_CONTENT_MISMATCH", "读取到的来源字节不匹配封存材料证据", { status: 409 });
      let mediaType;
      try { mediaType = assertSafeMediaType(material.payload.mediaType ?? "application/octet-stream"); }
      catch (error) { throw new F002Error(error.code ?? "F002_CONTENT_TYPE_RESTRICTED", "不安全的内容类型不能直接展示", { status: 415 }); }
      const format = displayFormatForPathBytes(decodePathBytes(material.payload.pathBytes));
      const display = redactDisplayBytes(original, { revision: this.policyRevision, format });
      mediaType = displayMediaType(mediaType, display.bytes);
      const displayDigest = digestBytes(display.bytes);
      await this.repository.appendEvent(actor, workspaceId, material.runId, material.scopeId, "READ_COMPLETED", {
        graphVersionId, materialId, readableRef, originalDigest, displayDigest, redacted: display.redacted, policyRevision: this.policyRevision,
      });
      return { readableRef, mediaType, bytes: display.bytes, originalDigest, displayDigest, redacted: display.redacted,
        transform: display.transform, policyRevision: this.policyRevision, sourceMaterial: source.sourceMaterial, receiptId: source.receiptId };
    } catch (error) {
      if (error?.code === "SOURCE_READ_BUDGET_EXCEEDED") error = new F002Error("F002_READ_BUDGET_EXCEEDED", "材料内容超过受控读取上限", { status: 413 });
      await this.repository.appendEvent(actor, workspaceId, material.runId, material.scopeId, "READ_INTERRUPTED", {
        graphVersionId, materialId, readableRef, code: error?.code ?? "F002_READ_FAILED", policyRevision: this.policyRevision,
      }).catch(() => {});
      throw error;
    }
  }
}

export { F002Error, rasterImageHeader };
