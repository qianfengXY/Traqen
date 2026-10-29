import { randomUUID } from "node:crypto";
import { identityContext } from "../auth/context.js";
import { once } from "node:events";
import { exportFactSet } from "./export.js";

import { F002Error } from "./errors.js";
import { SourceTruthError } from "../source-truth/errors.js";
import { AuthError } from "../auth/errors.js";
import { F003Error } from "../business-knowledge/errors.js";

const responseWorkspace = new WeakMap();

function json(response, status, payload, requestId) {
  const body = JSON.stringify({ schemaVersion: 1, requestId, workspaceId: responseWorkspace.get(response), ...payload });
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body),
    "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId });
  response.end(body);
}

async function body(request, maximum = 1024 * 1024) {
  if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new F002Error("F002_INVALID_CONTENT_TYPE", "此操作需要 JSON 表单", { status: 415 });
  const chunks = []; let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maximum) throw new F002Error("F002_BODY_TOO_LARGE", "请求超过大小上限", { status: 413 });
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new F002Error("F002_REQUEST_INVALID", "JSON 表单无效", { status: 422 }); }
}

function failure(response, error, requestId) {
  if (response.headersSent) { response.destroy(); return; }
  // The actual consumer can refuse an individual investigation/result. These
  // typed, public denials retain their status; arbitrary resolver failures do not.
  const known = error instanceof F002Error || error instanceof SourceTruthError || error instanceof AuthError || error instanceof F003Error;
  json(response, known ? error.status : 500, { error: { code: known ? error.code : "F002_INTERNAL_ERROR",
    message: known ? error.message : "技术证据服务暂时不可用", requestId } }, requestId);
}

function workspace(value) {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.length > 256 || /[\u0000-\u001f\u007f]/.test(decoded)) throw new F002Error("F002_WORKSPACE_INVALID", "Workspace 定位符无效", { status: 422 });
  return decoded;
}

function limit(url) {
  const value = url.searchParams.get("limit");
  if (value === null) return 100;
  if (!/^\d+$/.test(value)) throw new F002Error("F002_PAGE_INVALID", "分页大小无效", { status: 422 });
  return Number(value);
}

function boundedNumber(url, key, fallback) {
  const value = url.searchParams.get(key);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new F002Error("F002_GRAPH_INVALID", "局部图参数无效", { status: 422 });
  return Number(value);
}

function exactKeys(value, keys, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new F002Error(code, message, { status: 422 });
  }
}

function exactQuery(url, keys) {
  for (const key of url.searchParams.keys()) {
    if (!keys.includes(key) || url.searchParams.getAll(key).length !== 1) {
      throw new F002Error("F002_REQUEST_INVALID", "调查读取包含未定义或重复的查询字段", { status: 422 });
    }
  }
}

function runInput(value) {
  exactKeys(value, ["operationId", "source", "profileId", "scopes"], "F002_RUN_INPUT_INVALID", "生成技术证据请求包含未定义字段");
  exactKeys(value.source, ["bundleId", "receiptId"], "F002_SOURCE_REFERENCE_INVALID", "来源引用必须是精确 Bundle 与 Receipt");
  if (typeof value.profileId !== "string" || !/^[a-f0-9]{64}$/.test(value.profileId) || !Array.isArray(value.scopes)) {
    throw new F002Error("F002_RUN_INPUT_INVALID", "生成技术证据请求缺少有效 profile 或范围", { status: 422 });
  }
  for (const scope of value.scopes) {
    exactKeys(scope, ["label", "selections"], "F002_SCOPE_INVALID", "范围包含未定义字段");
    if (!Array.isArray(scope.selections)) throw new F002Error("F002_SCOPE_INVALID", "范围选择无效", { status: 422 });
    for (const selection of scope.selections) {
      const keys = selection?.kind === "COMPONENT" ? ["kind", "componentId"] : ["kind", "componentId", "pathBytes"];
      exactKeys(selection, keys, "F002_SCOPE_INVALID", "范围选择包含未定义字段");
    }
  }
  return value;
}

function scopeOperationInput(value, code) {
  exactKeys(value, ["scopeId", "revision", "operationId"], code, "范围操作包含未定义字段");
  if (!/^[a-f0-9]{64}$/.test(value.scopeId ?? "") || !Number.isInteger(value.revision) || value.revision < 1
    || !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId ?? "")) {
    throw new F002Error(code, "范围操作参数无效", { status: 422 });
  }
  return value;
}

// This handler is intentionally separate from the legacy shared-token routes.
// It accepts only the F001 server-bound member identity and only service
// methods that already recheck current Workspace authorization.
export function createF002HttpHandler({ services, authenticate, allowedOrigins = [] }) {
  const { repository, admission, publication, queries, materials, requests, replays, executor = null, requestExecutor = null, replayExecutor = null } = services ?? {};
  if (!repository || !admission || !publication || !queries || !materials || !requests || !replays || typeof authenticate !== "function") {
    throw new TypeError("F002 HTTP handler requires configured deterministic-fact services and member authentication");
  }
  return async (request, response, requestId = randomUUID()) => {
    const url = new URL(request.url, "http://localhost");
    const match = /^\/v1\/workspaces\/([^/]+)\/deterministic-facts(?:\/(.*))?$/.exec(url.pathname);
    if (!match) return false;
    try {
      if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) throw new F002Error("F002_ORIGIN_FORBIDDEN", "该页面来源未获授权", { status: 403 });
      if (request.headers.origin) response.setHeader("access-control-expose-headers",
        "x-request-id, x-f002-readable-ref, x-f002-original-digest, x-f002-display-digest, x-f002-redacted, x-f002-transform");
      const actor = identityContext()?.sourceActor ?? authenticate(request);
      const workspaceId = workspace(match[1]);
      responseWorkspace.set(response, workspaceId);
      const route = match[2] ?? "";
      if (request.method === "GET" && route === "") {
        json(response, 200, { profiles: await queries.profiles(actor, workspaceId), versions: await queries.versions(actor, workspaceId),
          activeRuns: await queries.activeRuns(actor, workspaceId),
          consumer: { configured: Boolean(requests.resolver), code: requests.resolver ? null : "F002_CONSUMER_UNAVAILABLE" } }, requestId);
      } else if (request.method === "GET" && route === "profiles") {
        json(response, 200, { profiles: await queries.profiles(actor, workspaceId) }, requestId);
      } else if (request.method === "GET" && route === "versions") {
        json(response, 200, { versions: await queries.versions(actor, workspaceId) }, requestId);
      } else if (request.method === "GET" && /^investigations\/[^/]+$/.test(route)) {
        exactQuery(url, ["baseVersionId"]);
        const investigationId = workspace(route.slice("investigations/".length));
        json(response, 200, { investigation: await requests.investigation(actor, workspaceId, investigationId, url.searchParams.get("baseVersionId")) }, requestId);
      } else if (request.method === "GET" && route === "requests") {
        exactQuery(url, ["investigationId", "baseVersionId", "limit", "cursor"]);
        json(response, 200, await requests.list(actor, workspaceId, { investigationId: url.searchParams.get("investigationId"),
          baseVersionId: url.searchParams.get("baseVersionId"), limit: url.searchParams.has("limit") ? limit(url) : 20, cursor: url.searchParams.get("cursor") }), requestId);
      } else if (request.method === "POST" && route === "runs") {
        const input = runInput(await body(request));
        const profile = await repository.getProfile(actor, workspaceId, input.profileId);
        const run = await admission.start(actor, workspaceId, { operationId: input.operationId, reference: input.source, profile, scopes: input.scopes });
        if (executor) void executor.enqueue(run);
        json(response, 202, { run }, requestId);
      } else if (request.method === "POST" && route === "requests") {
        const evidenceRequest = await requests.submit(actor, workspaceId, await body(request));
        if (requestExecutor) void requestExecutor.enqueue({ ...evidenceRequest, workspaceId, actorId: actor.actorId });
        json(response, 202, { request: evidenceRequest }, requestId);
      } else {
        const previewMatch = /^runs\/([A-Za-z0-9_-]{1,128})\/scopes\/([a-f0-9]{64})\/preview\/([1-9][0-9]{0,8})(?:\/(.*))?$/.exec(route);
        const preview = previewMatch ? { runId: previewMatch[1], scopeId: previewMatch[2], revision: Number(previewMatch[3]) } : null;
        const version = /^versions\/([a-f0-9]{64})(?:\/(.*))?$/.exec(route);
        const run = /^runs\/([^/]+)(?:\/(.*))?$/.exec(route);
        const requestMatch = /^requests\/([A-Za-z0-9-]{1,128})(?:\/(cancel))?$/.exec(route);
        const replayMatch = /^replays\/([A-Za-z0-9-]{1,128})(?:\/(cancel))?$/.exec(route);
        const operationMatch = /^operations\/([A-Za-z0-9_-]{1,128})$/.exec(route);
        if (operationMatch && request.method === "GET") {
          const operationId = operationMatch[1];
          const [runResult, replayResult, requestResult, scopeResult] = await Promise.all([
            repository.findRunByOperation(actor, workspaceId, operationId), replays.findByOperation(actor, workspaceId, operationId), requests.findByOperation(actor, workspaceId, operationId),
            repository.findScopeOperation(actor, workspaceId, operationId),
          ]);
          const results = [runResult && { kind: "RUN", value: runResult }, replayResult && { kind: "REPLAY", value: replayResult }, requestResult && { kind: "REQUEST", value: requestResult },
            scopeResult && { kind: "SCOPE_OPERATION", value: scopeResult }].filter(Boolean);
          if (results.length > 1) throw new F002Error("F002_OPERATION_CONFLICT", "操作键对应多个生命周期回执，不能猜测提交结果", { status: 409 });
          if (!results.length) throw new F002Error("F002_OPERATION_NOT_FOUND", "操作不存在于当前 Workspace", { status: 404 });
          json(response, 200, { operationId, results }, requestId);
        }
        else if (requestMatch && request.method === "GET" && !requestMatch[2]) json(response, 200, { request: await requests.get(actor, workspaceId, requestMatch[1]) }, requestId);
        else if (requestMatch && request.method === "POST" && requestMatch[2] === "cancel") {
          const input = await body(request); exactKeys(input, ["revision", "operationId"], "F002_REQUEST_INPUT_INVALID", "取消取证请求包含未定义字段");
          json(response, 200, { request: await requests.cancel(actor, workspaceId, requestMatch[1], input) }, requestId);
        }
        else if (replayMatch && request.method === "GET" && !replayMatch[2]) json(response, 200, { replay: await replays.get(actor, workspaceId, replayMatch[1]) }, requestId);
        else if (replayMatch && request.method === "POST" && replayMatch[2] === "cancel") {
          const input = await body(request); exactKeys(input, ["revision", "operationId"], "F002_REPLAY_INPUT_INVALID", "取消重放请求包含未定义字段");
          json(response, 200, { replay: await replays.cancel(actor, workspaceId, replayMatch[1], input) }, requestId);
        }
        else if (version || preview && request.method === "GET") {
          const [, graphVersionId, tail = ""] = version ?? [null, preview.scopeId, previewMatch[4] ?? "manifest"];
          const read = (name, ...args) => preview
            ? queries.preview(actor, workspaceId, preview, async q => ({ ...await q[name](...args), preview: { ...preview } }))
            : queries[name](actor, workspaceId, graphVersionId, ...args);
          if (request.method === "GET" && tail === "manifest") json(response, 200, { manifest: await read("manifest") }, requestId);
          else if (request.method === "GET" && tail === "export" && !preview) {
            const controller = new AbortController();
            const closed = () => controller.abort();
            response.once("close", closed);
            try {
              for await (const chunk of exportFactSet(queries, actor, workspaceId, graphVersionId, { signal: controller.signal })) {
                if (!response.headersSent) response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
                  "x-content-type-options": "nosniff", "x-request-id": requestId, "x-f002-export-version": graphVersionId,
                  "content-disposition": `attachment; filename="f002-${graphVersionId}.json"` });
                if (!response.write(chunk)) await once(response, "drain", { signal: controller.signal });
              }
              response.end();
            } finally { response.off("close", closed); }
          }
          else if (request.method === "GET" && tail === "coverage") json(response, 200, { coverage: await read("coverage",
            { limit: limit(url), cursor: url.searchParams.get("cursor"), materialIds: url.searchParams.get("materialIds")?.split(",") ?? [] }) }, requestId);
          else if (request.method === "GET" && tail === "records") json(response, 200, await read("records", { kind: url.searchParams.get("kind"), limit: limit(url), cursor: url.searchParams.get("cursor") }), requestId);
          else if (request.method === "GET" && ["materials", "objects", "facts", "relations", "gaps"].includes(tail)) {
            json(response, 200, await read("collection", tail, { limit: limit(url), cursor: url.searchParams.get("cursor"),
              query: url.searchParams.get("q") ?? "", materialIds: url.searchParams.get("materialIds")?.split(",") ?? [] }), requestId);
          }
          else if (request.method === "GET" && tail === "vocabulary") json(response, 200, { vocabulary: await read("vocabulary") }, requestId);
          else if (request.method === "GET" && tail === "graph") {
            json(response, 200, { graph: await read("graph", {
              rootId: url.searchParams.get("rootId"), depth: boundedNumber(url, "depth", 1), limit: boundedNumber(url, "limit", 100),
            }) }, requestId);
          }
          else if (request.method === "GET" && /^records\/([A-Z_]{1,64})\/([a-f0-9]{64})$/.test(tail)) {
            const [, kind, recordId] = /^records\/([A-Z_]{1,64})\/([a-f0-9]{64})$/.exec(tail);
            json(response, 200, await read("record", kind, recordId), requestId);
          }
          else if (request.method === "GET" && tail === "replays" && !preview) json(response, 200, { replays: await replays.list(actor, workspaceId, graphVersionId) }, requestId);
          else if (request.method === "POST" && tail === "replays" && !preview) {
            const input = await body(request); exactKeys(input, ["operationId"], "F002_REPLAY_INPUT_INVALID", "重放不接受客户端记录或规则");
            const replay = await replays.submit(actor, workspaceId, graphVersionId, input);
            if (replayExecutor) void replayExecutor.enqueue({ ...replay, workspaceId, actorId: actor.actorId, replayId: replay.id });
            json(response, 202, { replay }, requestId);
          }
          else {
            const content = /^materials\/([a-f0-9]{64})\/content$/.exec(tail);
            if (request.method === "GET" && content) {
              const result = preview ? await materials.readPreview(actor, workspaceId, preview, content[1]) : await materials.read(actor, workspaceId, graphVersionId, content[1]);
              response.writeHead(200, { "content-type": result.mediaType, "content-length": result.bytes.length, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId,
                "x-f002-readable-ref": result.readableRef, "x-f002-original-digest": result.originalDigest, "x-f002-display-digest": result.displayDigest,
                ...(result.sourceMaterial ? { "x-source-material-ref": result.sourceMaterial.id,
                  "x-source-bundle-id": result.sourceMaterial.bundleId, "x-source-receipt-id": result.receiptId } : {}),
                "x-f002-redacted": String(result.redacted), "x-f002-transform": result.transform ?? "" });
              response.end(result.bytes);
            } else throw new F002Error("F002_ROUTE_NOT_FOUND", "技术证据操作不存在", { status: 404 });
          }
        } else if (run) {
          const [, runId, tail = ""] = run;
          if (request.method === "GET" && /^scopes\/([a-f0-9]{64})\/progress$/.test(tail)) {
            const scopeId = tail.split("/")[1];
            json(response, 200, { progress: await repository.scopeProgress(actor, workspaceId, runId, scopeId) }, requestId);
          }
          else if (request.method === "GET" && tail === "") json(response, 200, { run: await repository.getRun(actor, workspaceId, runId) }, requestId);
          else if (request.method === "POST" && ["retry", "cancel"].includes(tail)) {
            const input = scopeOperationInput(await body(request), "F002_SCOPE_INPUT_INVALID");
            const scope = tail === "retry"
              ? await repository.retryScope(actor, workspaceId, runId, input.scopeId, input)
              : await repository.cancelScope(actor, workspaceId, runId, input.scopeId, input);
            if (tail === "retry" && executor) void executor.enqueue(await repository.getRun(actor, workspaceId, runId));
            json(response, 200, { scope }, requestId);
          }
          else if (request.method === "POST" && /^scopes\/([a-f0-9]{64})\/(check|seal)$/.test(tail)) {
            const [, scopeId, action] = /^scopes\/([a-f0-9]{64})\/(check|seal)$/.exec(tail);
            if (action === "check") json(response, 200, { check: await publication.check(actor, workspaceId, runId, scopeId) }, requestId);
            else {
              const input = await body(request); exactKeys(input, ["revision", "operationId"], "F002_SEAL_INPUT_INVALID", "封存范围包含未定义字段");
              json(response, 200, { scope: await publication.publish(actor, workspaceId, runId, scopeId, input) }, requestId);
            }
          } else throw new F002Error("F002_ROUTE_NOT_FOUND", "技术证据操作不存在", { status: 404 });
        } else throw new F002Error("F002_ROUTE_NOT_FOUND", "技术证据操作不存在", { status: 404 });
      }
    } catch (error) { request.resume(); failure(response, error, requestId); }
    return true;
  };
}
