import { once } from "node:events";
import { requireValue, SourceTruthError } from "./errors.js";

export function sourceJson(response, status, payload, requestId) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body),
    "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId });
  response.end(body);
}

export async function sourceBody(request, maxBytes = 8 * 1024 * 1024) {
  requireValue((request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() === "application/json", "SOURCE_INVALID_CONTENT_TYPE", "此操作需要 JSON 表单", { status: 415 });
  if (request.headers["content-length"] !== undefined) requireValue(/^\d+$/.test(request.headers["content-length"]) && BigInt(request.headers["content-length"]) <= BigInt(maxBytes), "SOURCE_BODY_TOO_LARGE", "表单超过平台限制，请分批发送清单", { status: 413 });
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) { request.resume(); throw new SourceTruthError("SOURCE_BODY_TOO_LARGE", "表单超过平台限制，请分批发送清单", { status: 413 }); }
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new SourceTruthError("SOURCE_INVALID_INPUT", "JSON 表单无效", { status: 400 }); }
  requireValue(input && typeof input === "object" && !Array.isArray(input), "SOURCE_INVALID_INPUT", "需要对象表单", { status: 400 });
  return input;
}

export function sourceFailure(response, error, requestId) {
  if (response.headersSent) { response.destroy(); return; }
  const known = error instanceof SourceTruthError;
  sourceJson(response, known ? error.status : 500, { error: { code: known ? error.code : "SOURCE_INTERNAL_ERROR",
    message: known ? error.message : "来源服务暂时不可用，请查询原任务并重试；既有冻结版本不受影响", requestId,
    details: known ? error.details : null } }, requestId);
}

export async function sourceBytes(response, stream, requestId) {
  let opened = false;
  for await (const chunk of stream) {
    if (!opened) {
      response.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId });
      opened = true;
    }
    if (!response.write(chunk)) await once(response, "drain");
  }
  if (!opened) response.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end();
}

export function publicRun(run) {
  if (!run) return null;
  const { id, workspaceId, actorId, draftRevision, input, policyRevisionId, status, station, retryOf, progress, diagnostic, createdAt, updatedAt } = run;
  return { id, workspaceId, actorId, draftRevision, input, policyRevisionId, status, station, retryOf, progress, diagnostic, createdAt, updatedAt };
}
