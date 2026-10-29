import { evidenceResultKey, type EvidenceLocation } from "./model.ts";
import { sessionFetch } from "../auth-client.ts";

export class FactsClientError extends Error {
  code: string;
  status: number;
  requestId: string | null;
  constructor(message: string, code = "F002_NETWORK_UNCONFIRMED", status = 0, requestId: string | null = null) {
    super(message); this.name = "FactsClientError"; this.code = code; this.status = status; this.requestId = requestId;
  }
}

export function isDefiniteWriteRejection(error: unknown) {
  // A proxy's error, timeout, authorization change, or ambiguous operation
  // lookup is not evidence that the original write was never accepted.
  return error instanceof FactsClientError && error.status >= 400 && error.status < 500
    && ![401, 403, 408, 425, 429].includes(error.status) && /^F002_/.test(error.code)
    && !["F002_HTTP_ERROR", "F002_OPERATION_CONFLICT"].includes(error.code);
}

export type DisplayMaterial = {
  bytes: Uint8Array; mediaType: string; readableRef: string; originalDigest: string; displayDigest: string;
  redacted: boolean; transform: string | null;
};

const digestPattern = /^[a-f0-9]{64}$/;
const MAX_DISPLAY_BYTES = 8 * 1024 * 1024;

export class DeterministicFactsClient {
  private base: string;
  private token: string;
  private apiBase: string;
  private workspaceId: string;
  signal?: AbortSignal;
  private preview?: EvidenceLocation["preview"];
  constructor(apiBase: string, token: string, workspaceId: string, signal?: AbortSignal) {
    this.base = `${apiBase.replace(/\/$/, "")}/v1/workspaces/${encodeURIComponent(workspaceId)}/deterministic-facts`;
    this.apiBase = apiBase; this.workspaceId = workspaceId;
    this.token = token; this.signal = signal;
  }

  withSignal(signal: AbortSignal) { const next = new DeterministicFactsClient(this.apiBase, this.token, this.workspaceId, signal); next.preview = this.preview; return next; }
  withPreview(preview: NonNullable<EvidenceLocation["preview"]>) { const next = this.withSignal(this.signal!); next.preview = preview; return next; }

  private async response(route: string, method: string, body?: object): Promise<Response> {
    const signal = this.signal;
    signal?.throwIfAborted();
    if (route !== "" && (!route.startsWith("/") || route.startsWith("//") || /(?:^|\/)\.\.(?:\/|$)/.test(route))) {
      throw new FactsClientError("技术证据路由无效", "F002_ROUTE_INVALID");
    }
    if (this.preview) {
      const prefix = `/versions/${evidenceResultKey({ preview: this.preview })}/`;
      if (method !== "GET" || !route.startsWith(prefix) || /^(export|replays)(?:[?\/]|$)/.test(route.slice(prefix.length)))
        throw new FactsClientError("未封存成果只能在当前修订内读取；正式引用及导出需先封存", "F002_PREVIEW_READ_ONLY");
      route = `/runs/${this.preview.runId}/scopes/${this.preview.scopeId}/preview/${this.preview.revision}/${route.slice(prefix.length)}`;
    }
    let response: Response;
    try {
      response = await sessionFetch(this.base + route, { method, credentials: "same-origin", cache: "no-store", redirect: "error", signal,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      signal?.throwIfAborted();
      throw new FactsClientError("连接中断，操作未确认。请查询同一操作键；不会自动重试或创建新任务。");
    }
    signal?.throwIfAborted();
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      signal?.throwIfAborted();
      throw new FactsClientError(result?.error?.message ?? "技术证据读取未完成", result?.error?.code ?? "F002_HTTP_ERROR", response.status, result?.error?.requestId ?? null);
    }
    return response;
  }

  async request<T>(route = "", method = "GET", body?: object): Promise<T> {
    const signal = this.signal;
    const response = await this.response(route, method, body);
    const result = await response.json().catch(() => null);
    signal?.throwIfAborted();
    if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || result?.schemaVersion !== 1) {
      throw new FactsClientError("未收到可验证的技术证据 JSON 响应，操作状态未确认");
    }
    return result as T;
  }

  async exportVersion(graphVersionId: string): Promise<Blob> {
    if (!digestPattern.test(graphVersionId)) throw new FactsClientError("导出必须引用精确事实集", "F002_REFERENCE_INVALID");
    const response = await this.response(`/versions/${graphVersionId}/export`, "GET");
    if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
      || response.headers.get("x-f002-export-version") !== graphVersionId) {
      await response.body?.cancel();
      throw new FactsClientError("未收到固定版本导出响应", "F002_EXPORT_INCOMPLETE");
    }
    // Browser-native Blob consumption avoids a giant JSON string/object graph.
    // A destroyed/truncated HTTP stream rejects before any download is offered.
    const blob = await response.blob();
    this.signal?.throwIfAborted();
    return blob;
  }

  async material(graphVersionId: string, materialId: string): Promise<DisplayMaterial> {
    if (!(digestPattern.test(graphVersionId) || this.preview && graphVersionId === evidenceResultKey({ preview: this.preview })) || !digestPattern.test(materialId)) throw new FactsClientError("材料必须引用精确事实集和材料 ID", "F002_REFERENCE_INVALID");
    const signal = this.signal;
    const response = await this.response(`/versions/${graphVersionId}/materials/${materialId}/content`, "GET");
    const mediaType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    // Images use inert image decoders, never HTML/SVG/PDF/object/embed. Text is
    // rendered only as React text, not interpreted as a document or script.
    if (!(mediaType.startsWith("text/") && !["text/html", "text/javascript"].includes(mediaType))
      && !["application/json", "application/xml", "application/octet-stream", "image/png", "image/jpeg", "image/gif", "image/webp"].includes(mediaType)) {
      await response.body?.cancel();
      throw new FactsClientError("此内容类型不允许直接展示", "F002_CONTENT_TYPE_RESTRICTED");
    }
    const originalDigest = response.headers.get("x-f002-original-digest") ?? "";
    const displayDigest = response.headers.get("x-f002-display-digest") ?? "";
    const readableRef = response.headers.get("x-f002-readable-ref") ?? "";
    const redacted = response.headers.get("x-f002-redacted");
    if (![originalDigest, displayDigest, readableRef].every(value => digestPattern.test(value)) || !["true", "false"].includes(redacted ?? "")) {
      await response.body?.cancel();
      throw new FactsClientError("受控材料响应缺少完整摘要和策略记录", "F002_DISPLAY_METADATA_INVALID");
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new FactsClientError("材料响应没有正文", "F002_DISPLAY_METADATA_INVALID");
    try {
      while (true) {
        signal?.throwIfAborted();
        const chunk = await reader.read();
        signal?.throwIfAborted();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > MAX_DISPLAY_BYTES) throw new FactsClientError("材料超过受控展示上限", "F002_READ_BUDGET_EXCEEDED");
        chunks.push(chunk.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    signal?.throwIfAborted();
    if (actual !== displayDigest) throw new FactsClientError("实际展示字节与策略摘要不符，不展示局部或改写内容", "F002_DISPLAY_DIGEST_MISMATCH");
    return { bytes, mediaType, readableRef, originalDigest, displayDigest, redacted: redacted === "true", transform: response.headers.get("x-f002-transform") || null };
  }
}
