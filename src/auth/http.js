import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { token, equal, digest } from "./crypto.js";
import { demand } from "./errors.js";
import { authContext } from "./context.js";
const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const cookies = (request) =>
  Object.fromEntries(
    String(request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s))
      .filter((part) => part[0])
      .map(([k, v]) => [k, v ?? ""]),
  );
export function authJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}
async function body(request) {
  demand(
    String(request.headers["content-type"] ?? "").split(";")[0] === "application/json",
    "AUTH_JSON_REQUIRED",
    "需要 JSON 请求",
    415,
  );
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    demand(bytes <= 65536, "AUTH_BODY_TOO_LARGE", "请求过大", 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    demand(value && typeof value === "object" && !Array.isArray(value), "AUTH_INVALID_INPUT", "请求无效", 400);
    for (const field of ["actorId", "userId", "tenant", "tenantId", "organization", "organizationId", "principals"])
      demand(!Object.hasOwn(value, field), "AUTH_CALLER_FIELD_REJECTED", "调用者身份由服务端确定", 400);
    return value;
  } catch (error) {
    if (error.code) throw error;
    demand(false, "AUTH_INVALID_INPUT", "JSON 无效", 400);
  }
}
export class AuthHttp {
  constructor({ service, origin, development = false, trustedProxies = [] }) {
    const url = new URL(origin);
    demand(
      url.origin === origin &&
        !url.username &&
        !url.password &&
        (development
          ? url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          : url.protocol === "https:"),
      "AUTH_CONFIGURATION_INVALID",
      "需要精确的同源 HTTPS 地址；HTTP 仅用于显式本地开发",
      503,
    );
    demand(
      Array.isArray(trustedProxies) && trustedProxies.every((ip) => isIP(ip)),
      "AUTH_CONFIGURATION_INVALID",
      "可信代理必须为明确的 IP 地址",
      503,
    );
    Object.assign(this, { service, origin, development, host: url.host, trustedProxies });
    this.cookieName = development ? "traqen_dev_session" : "__Host-traqen_session";
    this.csrfName = development ? "traqen_dev_csrf" : "__Host-traqen_csrf";
  }
  cookie(response, name, value, { maxAge = 43200, httpOnly = true } = {}) {
    const header = `${name}=${value}; Path=/; SameSite=Lax${this.development ? "" : "; Secure"}${httpOnly ? "; HttpOnly" : ""}; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
    response.setHeader("set-cookie", [...(response.getHeader("set-cookie") ?? []), header]);
  }
  source(request) {
    const peer = request.socket.remoteAddress;
    if (this.trustedProxies.includes(peer)) {
      const source = request.headers["x-traqen-client-ip"];
      return typeof source === "string" && isIP(source) ? source : null;
    }
    return peer && isIP(peer) && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) ? peer : null;
  }
  csrfFor(raw) {
    return createHmac("sha256", this.service.key).update(`Traqen.CSRF.v1:${raw}`).digest("base64url");
  }
  preCsrf() {
    const raw = `${Date.now() + 600000}.${token()}`;
    return `${raw}.${this.csrfFor(raw)}`;
  }
  validPre(value) {
    if (typeof value !== "string") return false;
    const [expires, nonce, mac, ...extra] = value.split(".");
    return (
      !extra.length &&
      /^\d+$/.test(expires) &&
      Number(expires) > Date.now() &&
      Number(expires) <= Date.now() + 600000 &&
      equal(mac, this.csrfFor(`${expires}.${nonce}`))
    );
  }
  credential(request) {
    const jar = cookies(request),
      cookie = jar[this.cookieName],
      authorization = request.headers.authorization;
    demand(!request.headers["x-traqen-api-token"], "AUTH_LEGACY_TOKEN_REJECTED", "共享部署令牌不再用于业务访问", 401);
    demand(!(cookie && authorization), "AUTH_AMBIGUOUS_CREDENTIALS", "不能混用会话与程序凭据", 400);
    if (authorization) {
      demand(/^Bearer tp_[a-zA-Z0-9_-]{43}$/.test(authorization), "AUTH_PROGRAM_INVALID", "需要已登记的程序凭据", 401);
      return { raw: authorization.slice(7), program: true };
    }
    return { raw: cookie ?? "", program: false };
  }
  checkWrite(request, raw, { program = false, pre = false } = {}) {
    if (!writeMethods.has(request.method) || program) return;
    const proof = request.headers["x-traqen-csrf"],
      jar = cookies(request);
    demand(
      request.headers.origin === this.origin &&
        typeof proof === "string" &&
        (pre ? equal(proof, jar[this.csrfName] ?? "") && this.validPre(proof) : equal(proof, this.csrfFor(raw))),
      "AUTH_CSRF_REJECTED",
      "页面来源或防伪校验失败，请刷新后重试",
      403,
    );
  }
  async sessionResponse(response, result) {
    this.cookie(response, this.cookieName, result.token, {
      maxAge: (result.session.expiresAt - this.service.clock()) / 1000,
    });
    const { token: _token, session: _session, ...visible } = result;
    return { ...visible, csrfToken: this.csrfFor(result.token) };
  }
  async prepare(request, response) {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/health") return { health: true };
    demand(request.headers.host === this.host, "AUTH_HOST_REJECTED", "请求主机不匹配", 403);
    if (url.pathname === "/v1/auth/csrf" && request.method === "GET") {
      const csrfToken = this.preCsrf();
      this.cookie(response, this.csrfName, csrfToken, { httpOnly: false, maxAge: 600 });
      authJson(response, 200, { csrfToken });
      return null;
    }
    if (url.pathname === "/v1/auth/status" && request.method === "GET") {
      authJson(response, 200, await this.service.status());
      return null;
    }
    const publicWrite = ["/v1/auth/login", "/v1/auth/set-password"].includes(url.pathname);
    if (publicWrite) {
      demand(request.method === "POST", "AUTH_ROUTE_NOT_FOUND", "接口不存在", 404);
      this.checkWrite(request, "", { pre: true });
      const input = await body(request);
      if (url.pathname.endsWith("/login")) {
        const result = await this.service.login({ ...input, source: this.source(request) });
        authJson(response, 200, await this.sessionResponse(response, result));
      } else authJson(response, 200, await this.service.setPassword(input));
      return null;
    }
    const status = await this.service.status();
    demand(status.initialized, "AUTH_NOT_INITIALIZED", "请在部署终端完成初始化", 503);
    // These routes verify their existing attestation/task credential in the application.
    const signed =
      (request.method === "POST" && /^\/v1\/projects\/[^/]+\/(test-executions|fact-scans)$/.test(url.pathname)) ||
      (request.method === "POST" &&
        /^\/v1\/projects\/[^/]+\/analysis-runs\/[^/]+\/(?:work-units\/[^/]+\/)?source-slices$/.test(url.pathname));
    if (signed && !request.headers.cookie && !request.headers.authorization && !request.headers["x-traqen-api-token"]) {
      demand(!status.recovery, "AUTH_RECOVERY_REQUIRED", "恢复检查中，程序访问暂停", 503);
      return { signed: true, workspaceId: /^\/v1\/projects\/([^/]+)/.exec(url.pathname)?.[1] };
    }
    const credential = this.credential(request);
    this.checkWrite(request, credential.raw, credential);
    if (
      url.pathname.startsWith("/v1/auth/") ||
      url.pathname.startsWith("/v1/me") ||
      url.pathname.startsWith("/v1/admin/") ||
      url.pathname.startsWith("/v1/access/")
    ) {
      demand(!credential.program, "AUTH_HUMAN_REQUIRED", "此操作需要人员账号");
      await this.routes(request, response, url, credential.raw);
      return null;
    }
    const workspace = /^\/v1\/(?:workspaces|projects)\/([^/]+)/.exec(url.pathname);
    if (workspace) {
      const workspaceId = decodeURIComponent(workspace[1]);
      let operation = request.method === "GET" ? "READ" : "MAINTAIN";
      if (
        /\/(?:request-deletion|cancel-deletion|complete-deletion)$/.test(url.pathname) ||
        (request.method === "PATCH" && /^\/v1\/workspaces\/[^/]+$/.test(url.pathname))
      )
        operation = "OWNER";
      if (/\/view-preference$/.test(url.pathname)) operation = "READ";
      if (
        /\/(?:decisions|review-decisions|decision-review-cases|candidate-reviews|approvals|reviews|implementation-reanalyses|process-model|aliases|feature-lineages|lifecycle-events|evidence-retention-policies)(?:\/|$)/.test(
          url.pathname,
        ) &&
        request.method !== "GET"
      )
        operation = request.headers["x-traqen-review-role"] ?? "REVIEW_ROLE_REQUIRED";
      await this.service.authorize(credential.raw, workspaceId, operation);
      const actor = await this.service.resolveActor(credential.raw, workspaceId);
      return {
        ...actor,
        raw: credential.raw,
        workspaceId,
        operation,
        reviewRole: request.headers["x-traqen-review-role"],
        sourceActor: { actorId: actor.actorId, tenantId: actor.tenantId },
      };
    }
    if (url.pathname === "/v1/workspaces" && request.method === "GET") {
      const actor = await this.service.resolveActor(credential.raw);
      return { ...actor, raw: credential.raw, operation: "READ" };
    }
    if (["/v1/workspaces", "/v1/projects"].includes(url.pathname) && request.method === "POST")
      demand(false, "AUTH_APPLICATION_REQUIRED", "请提交创建空间申请，经系统管理员批准", 403);
    if (/^\/v1\/(?:global-|capability-templates|skills)/.test(url.pathname))
      await this.service.globalAccess(credential.raw);
    else if (["/v1/workspace-executable-skills", "/v1/trace-chains/evaluate"].includes(url.pathname))
      await this.service.authenticate(credential.raw);
    else demand(false, "AUTH_UNMAPPED_OPERATION", "此入口尚无授权规则", 403);
    const actor = await this.service.resolveActor(credential.raw);
    return {
      ...actor,
      raw: credential.raw,
      global: true,
      operation: request.method === "GET" ? "READ" : "MAINTAIN",
      reviewRole: request.headers["x-traqen-review-role"],
    };
  }
  async routes(request, response, url, raw) {
    const method = request.method,
      path = url.pathname;
    const input = writeMethods.has(method) ? await body(request) : {};
    let result;
    if (method === "GET" && path === "/v1/auth/session")
      result = { ...(await this.service.authenticate(raw, { pending: true })), csrfToken: this.csrfFor(raw) };
    else if (method === "POST" && path === "/v1/auth/logout") {
      result = await this.service.logout(raw);
      this.cookie(response, this.cookieName, "", { maxAge: 0 });
    } else if (method === "POST" && path === "/v1/auth/activity") result = await this.service.activity(raw);
    else if (method === "POST" && path === "/v1/auth/totp/begin") result = await this.service.beginTotp(raw);
    else if (method === "POST" && path === "/v1/auth/totp/confirm")
      result = await this.sessionResponse(response, await this.service.confirmTotp(raw, input.code));
    else if (method === "POST" && path === "/v1/auth/totp/verify")
      result = await this.sessionResponse(response, await this.service.secondFactor(raw, input.code));
    else if (method === "POST" && path === "/v1/auth/reauthenticate")
      result = await this.sessionResponse(response, await this.service.reauthenticate(raw, input));
    else if (method === "POST" && path === "/v1/auth/password")
      result = await this.sessionResponse(response, await this.service.changePassword(raw, input.password));
    else if (method === "GET" && path === "/v1/auth/sessions") result = { sessions: await this.service.sessions(raw) };
    else if (method === "POST" && path === "/v1/auth/sessions/revoke")
      result = await this.service.revokeSession(raw, input.id);
    else if (method === "PUT" && path === "/v1/me/position")
      result = await this.service.savePosition(raw, input.position);
    else if (method === "GET" && path === "/v1/me/notifications")
      result = { notifications: await this.service.notifications(raw) };
    else if (method === "POST" && path === "/v1/me/notifications/read")
      result = await this.service.readNotifications(raw);
    else if (method === "GET" && path === "/v1/access/context") result = await this.service.accessContext(raw);
    else if (method === "GET" && path === "/v1/access/spaces")
      result = { spaces: await this.service.listSpaces(raw, { all: url.searchParams.get("all") === "true" }) };
    else if (method === "GET" && path === "/v1/access/directory")
      result = { spaces: await this.service.directory(raw, url.searchParams.get("entry")) };
    else if (method === "GET" && path === "/v1/access/applications")
      result = {
        applications: await this.service.applications(raw, {
          pending: url.searchParams.get("pending") === "true",
          workspaceId: url.searchParams.get("workspaceId"),
        }),
      };
    else if (method === "POST" && path === "/v1/access/applications") result = await this.service.apply(raw, input);
    else if (method === "POST" && /^\/v1\/access\/applications\/[^/]+\/(decide|withdraw)$/.test(path)) {
      const [, id, action] = /applications\/([^/]+)\/(decide|withdraw)$/.exec(path);
      result = action === "decide" ? await this.service.decide(raw, id, input) : await this.service.withdraw(raw, id);
    } else if (path === "/v1/admin/accounts" && method === "GET")
      result = { accounts: await this.service.listAccounts(raw) };
    else if (path === "/v1/admin/accounts" && method === "POST") result = await this.service.createAccount(raw, input);
    else if (/^\/v1\/admin\/accounts\/[^/]+$/.test(path) && method === "PATCH")
      result = await this.service.updateAccount(raw, decodeURIComponent(path.split("/").at(-1)), input);
    else if (/^\/v1\/admin\/accounts\/[^/]+\/recover$/.test(path) && method === "POST")
      result = await this.service.recoverAccount(raw, decodeURIComponent(path.split("/").at(-2)), input);
    else if (path === "/v1/admin/programs" && method === "GET")
      result = { programs: await this.service.listPrograms(raw) };
    else if (path === "/v1/admin/programs" && method === "POST") result = await this.service.createProgram(raw, input);
    else if (/^\/v1\/admin\/programs\/[^/]+\/rotate$/.test(path) && method === "POST")
      result = await this.service.rotateProgram(raw, decodeURIComponent(path.split("/").at(-2)));
    else if (/^\/v1\/admin\/programs\/[^/]+\/revoke$/.test(path) && method === "POST")
      result = await this.service.revokeProgram(raw, decodeURIComponent(path.split("/").at(-2)));
    else if (
      /^\/v1\/access\/spaces\/[^/]+\/(members|candidates|settings|intervene|entry|transfer|designate|audit)$/.test(path)
    ) {
      const [, encoded, action] = /spaces\/([^/]+)\/([^/]+)$/.exec(path),
        id = decodeURIComponent(encoded);
      if (action === "members" && method === "GET") result = { members: await this.service.members(raw, id) };
      else if (action === "candidates" && method === "GET")
        result = { accounts: await this.service.memberCandidates(raw, id, url.searchParams.get("query")) };
      else if (action === "members" && method === "PUT") result = await this.service.grant(raw, id, input);
      else if (action === "settings" && method === "PUT") result = await this.service.spaceSettings(raw, id, input);
      else if (action === "intervene" && method === "POST") result = await this.service.intervene(raw, id, input.roles);
      else if (action === "entry" && method === "POST") result = await this.service.applicationEntry(raw, id);
      else if (action === "transfer" && method === "POST")
        result = await this.service.transfer(raw, id, input.accountId, input);
      else if (action === "designate" && method === "POST")
        result = await this.service.designateOwner(raw, id, input.accountId);
      else if (action === "audit" && method === "GET") {
        await this.service.authorize(raw, id, "MANAGE");
        result = { events: await this.service.repository.audit(id) };
      }
    }
    demand(result !== undefined, "AUTH_ROUTE_NOT_FOUND", "接口不存在", 404);
    authJson(response, 200, result);
  }
  run(identity, work) {
    return authContext.run(identity, work);
  }
}
