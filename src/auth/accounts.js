import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword, token, digest } from "./crypto.js";
import { AuthError, demand } from "./errors.js";
import {
  publicAccount,
  audit,
  notify,
  sessionIn,
  createSession,
  rotateSession,
  revokeAccountSessions,
  validLogin,
  validText,
  position,
} from "./core.js";
const failure = () => new AuthError(401, "AUTH_INVALID_CREDENTIALS", "账号或密码不正确");
export class AccountService {
  #pendingLogins = 0;
  constructor({ repository, key, clock = Date.now, policy = {} }) {
    demand(Buffer.isBuffer(key) && key.length === 32, "AUTH_CONFIGURATION_INVALID", "需要 32 字节的部署加密密钥", 503);
    Object.assign(this, {
      repository,
      key,
      clock,
      policy: {
        businessRoles: ["business-owner"],
        complianceRoles: ["compliance"],
        reviewRoles: ["business-owner", "compliance", "developer", "break-glass"],
        implementationRoles: ["developer"],
        claimReviewRoles: ["business-owner"],
        ...policy,
      },
    });
  }
  async status() {
    const s = await this.repository.read();
    return { initialized: s.control.initialized, recovery: s.control.recovery };
  }
  async initialize({ login, displayName, password }) {
    const normalized = validLogin(login),
      passwordRecord = await hashPassword(password);
    return this.repository.change(async (s, tx) => {
      demand(
        !s.control.initialized && !s.control.recovery,
        "AUTH_ALREADY_INITIALIZED",
        "实例已初始化；需要时使用终端恢复",
        409,
      );
      const id = randomUUID();
      s.accounts[id] = {
        id,
        login: normalized,
        displayName: validText(displayName, 120),
        password: passwordRecord,
        status: "ACTIVE",
        admin: true,
        globalConfig: false,
        kind: "HUMAN",
      };
      s.control.initialized = true;
      audit(s, id, "INSTANCE_INITIALIZED");
      return publicAccount(s.accounts[id]);
    });
  }
  async login({ login, password, remember = false, device, source = null }) {
    demand(this.#pendingLogins < 18, "AUTH_BUSY", "登录繁忙，请稍后再试", 429);
    this.#pendingLogins++;
    try {
      return await this.loginAdmitted({ login, password, remember, device, source });
    } finally {
      this.#pendingLogins--;
    }
  }
  async loginAdmitted({ login, password, remember, device, source }) {
    demand(
      typeof remember === "boolean" && (device === undefined || typeof device === "string"),
      "AUTH_INVALID_INPUT",
      "设备选项无效",
      400,
    );
    const normalized = typeof login === "string" ? login.toLowerCase().slice(0, 120) : "";
    const result = await this.repository.change(async (s) => {
      demand(s.control.initialized, "AUTH_NOT_INITIALIZED", "请在部署终端完成初始化", 503);
      const now = this.clock();
      for (const [id, attempt] of Object.entries(s.attempts)) if (now >= attempt.until) delete s.attempts[id];
      const keys = [`account:${digest(normalized)}`, ...(source ? [`source:${digest(source)}`] : [])];
      for (const key of keys) {
        let attempt = s.attempts[key];
        if (!attempt || now >= attempt.until) attempt = s.attempts[key] = { count: 0, until: now + 900000 };
        if (attempt.count >= (key.startsWith("source:") ? 50 : 10))
          return {
            error: new AuthError(429, "AUTH_RATE_LIMITED", "尝试过多，请稍后再试", {
              retryAfter: Math.ceil((attempt.until - now) / 1000),
            }),
          };
        attempt.count++;
      }
      const account = Object.values(s.accounts).find((a) => a.login === normalized && a.kind !== "PROGRAM");
      // Unknown accounts pay the same scrypt cost, with a valid fixed dummy record.
      const record = account?.password ?? { algorithm: "scrypt-v1", salt: "00".repeat(16), hash: "00".repeat(64) };
      if (!(await verifyPassword(password, record)) || !account || account.status !== "ACTIVE") {
        audit(s, account?.id ?? "ANONYMOUS", "LOGIN_FAILED");
        return { error: failure() };
      }
      if (s.control.recovery && !account.recoveryAdmin)
        return { error: new AuthError(503, "AUTH_RECOVERY_REQUIRED", "实例正在恢复检查，暂不开放登录") };
      // Old restored archives may still contain a previously granted, pending
      // administrator. Activate that existing grant only after password verification.
      if (account.adminRequested === true) account.admin = true;
      delete account.adminRequested;
      delete account.totp;
      const result = createSession(s, account, now, { remember, device });
      audit(s, account.id, "LOGIN_COMPLETED");
      return result;
    });
    if (result.error) throw result.error;
    return result;
  }
  async authenticate(raw, options = {}) {
    const s = await this.repository.read();
    const { account, session } = sessionIn(s, raw, this.clock(), options);
    return {
      account: publicAccount(account),
      session: { id: session.id, device: session.device, expiresAt: session.expiresAt, phase: session.phase },
      position: account.position ?? "/",
      restrictedRestore: !!s.control.recovery,
    };
  }
  async logout(raw) {
    return this.repository.change((s) => {
      const { session, account } = sessionIn(s, raw, this.clock());
      session.revoked = true;
      audit(s, account.id, "SESSION_REVOKED");
      return { ok: true };
    });
  }
  async activity(raw) {
    return this.repository.change((s) => {
      const { session } = sessionIn(s, raw, this.clock());
      session.lastActivity = this.clock();
      return { ok: true };
    });
  }
  async sessions(raw) {
    const s = await this.repository.read(),
      { account, session } = sessionIn(s, raw, this.clock());
    return Object.values(s.sessions)
      .filter((x) => x.accountId === account.id)
      .map((x) => ({
        id: x.id,
        device: x.device,
        createdAt: x.createdAt,
        lastActivity: x.lastActivity,
        expiresAt: x.expiresAt,
        revoked: x.revoked,
        current: x.id === session.id,
      }));
  }
  async revokeSession(raw, id) {
    return this.repository.change((s) => {
      const { account, session } = sessionIn(s, raw, this.clock());
      for (const candidate of Object.values(s.sessions))
        if (candidate.accountId === account.id && (id === "others" ? candidate.id !== session.id : candidate.id === id))
          candidate.revoked = true;
      audit(s, account.id, "DEVICE_REVOKED", { target: id });
      return { ok: true };
    });
  }
  async reauthenticate(raw, { password }) {
    const result = await this.repository.change(async (s) => {
      const { account, session } = sessionIn(s, raw, this.clock());
      session.failedReauth = (session.failedReauth ?? 0) + 1;
      if (session.failedReauth > 10) {
        session.revoked = true;
        return { error: new AuthError(429, "AUTH_RATE_LIMITED", "请重新登录") };
      }
      if (!(await verifyPassword(password, account.password)))
        return { error: failure() };
      audit(s, account.id, "IDENTITY_REVERIFIED");
      return rotateSession(s, session, account, this.clock());
    });
    if (result.error) throw result.error;
    return result;
  }
  async changePassword(raw, password) {
    const record = await hashPassword(password);
    return this.repository.change((s) => {
      const { account, session } = sessionIn(s, raw, this.clock(), { recent: true });
      account.password = record;
      revokeAccountSessions(s, account.id);
      audit(s, account.id, "PASSWORD_CHANGED");
      return rotateSession(s, session, account, this.clock());
    });
  }
  async createAccount(raw, { login, displayName }) {
    const normalized = validLogin(login);
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock(), { admin: true, recent: true });
      demand(!Object.values(s.accounts).some((a) => a.login === normalized), "AUTH_LOGIN_EXISTS", "账号已存在", 409);
      const id = randomUUID();
      s.accounts[id] = {
        id,
        login: normalized,
        displayName: validText(displayName, 120),
        status: "PENDING",
        admin: false,
        globalConfig: false,
        kind: "HUMAN",
      };
      const credential = token();
      s.credentials[digest(credential)] = {
        accountId: id,
        purpose: "SET_PASSWORD",
        expiresAt: this.clock() + 86400000,
        used: false,
      };
      audit(s, account.id, "ACCOUNT_CREATED", { target: id });
      return { account: publicAccount(s.accounts[id]), credential };
    });
  }
  async setPassword({ credential, password }) {
    const record = await hashPassword(password);
    return this.repository.change((s) => {
      const entry = s.credentials[digest(credential ?? "")];
      demand(
        entry && !entry.used && this.clock() < entry.expiresAt,
        "AUTH_CREDENTIAL_INVALID",
        "设置或恢复凭据已失效",
        401,
      );
      const account = s.accounts[entry.accountId];
      demand(account && account.status !== "DISABLED", "AUTH_CREDENTIAL_INVALID", "设置或恢复凭据已失效", 401);
      account.password = record;
      account.status = "ACTIVE";
      revokeAccountSessions(s, account.id);
      for (const candidate of Object.values(s.credentials))
        if (candidate.accountId === account.id) candidate.used = true;
      audit(s, account.id, "PASSWORD_SET", { purpose: entry.purpose });
      return { ok: true };
    });
  }
  async recoverAccount(raw, targetId) {
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock(), { admin: true, recent: true });
      const target = s.accounts[targetId];
      demand(target?.kind === "HUMAN", "AUTH_ACCOUNT_NOT_FOUND", "人员账号不存在", 404);
      revokeAccountSessions(s, targetId);
      for (const c of Object.values(s.credentials)) if (c.accountId === targetId) c.used = true;
      const credential = token();
      s.credentials[digest(credential)] = {
        accountId: targetId,
        purpose: "RECOVERY",
        expiresAt: this.clock() + 900000,
        used: false,
      };
      audit(s, account.id, "ACCOUNT_RECOVERY_ISSUED", { target: targetId });
      this.notifyAdmins(s, "ACCOUNT_RECOVERY", { target: targetId });
      return { credential };
    });
  }
  protectLastAdmin(s, target, patch) {
    if (!target.admin || target.status !== "ACTIVE") return;
    if (patch.status === "DISABLED" || patch.admin === false)
      demand(
        Object.values(s.accounts).some((a) => a.id !== target.id && a.kind === "HUMAN" && a.admin && a.status === "ACTIVE"),
        "AUTH_LAST_ADMIN",
        "不能停用或移除最后一位有效系统管理员",
        409,
      );
  }
  notifyAdmins(s, type, extra) {
    for (const admin of Object.values(s.accounts))
      if (admin.admin && admin.status === "ACTIVE") notify(s, admin.id, type, extra);
  }
  async updateAccount(raw, id, patch) {
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock(), { admin: true, recent: true }),
        target = s.accounts[id];
      demand(target?.kind === "HUMAN", "AUTH_ACCOUNT_NOT_FOUND", "人员账号不存在", 404);
      demand(
        Object.keys(patch).every((k) => ["status", "admin", "globalConfig", "displayName"].includes(k)),
        "AUTH_INVALID_INPUT",
        "不支持的账号字段",
        400,
      );
      if (patch.status !== undefined)
        demand(
          ["ACTIVE", "DISABLED"].includes(patch.status) && target.password,
          "AUTH_INVALID_INPUT",
          "账号状态无效",
          400,
        );
      for (const field of ["admin", "globalConfig"])
        if (patch[field] !== undefined)
          demand(typeof patch[field] === "boolean", "AUTH_INVALID_INPUT", "资格值必须为布尔值", 400);
      this.protectLastAdmin(s, target, patch);
      if (patch.admin !== undefined) {
        target.admin = patch.admin;
        delete target.adminRequested;
      }
      for (const field of ["status", "globalConfig", "displayName"])
        if (patch[field] !== undefined)
          target[field] = field === "displayName" ? validText(patch[field], 120) : patch[field];
      if (patch.status === "DISABLED" || patch.admin !== undefined) revokeAccountSessions(s, id);
      audit(s, account.id, "ACCOUNT_UPDATED", { target: id, changes: patch });
      this.notifyAdmins(s, "ACCOUNT_UPDATED", { target: id });
      return publicAccount(target);
    });
  }
  async listAccounts(raw) {
    const s = await this.repository.read();
    sessionIn(s, raw, this.clock(), { admin: true });
    return Object.values(s.accounts).map(publicAccount);
  }
  async savePosition(raw, value) {
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock());
      account.position = position(value);
      return { position: account.position };
    });
  }
  async notifications(raw) {
    const s = await this.repository.read(),
      { account } = sessionIn(s, raw, this.clock());
    return Object.values(s.notifications).filter((n) => n.accountId === account.id);
  }
  async readNotifications(raw) {
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock());
      for (const n of Object.values(s.notifications)) if (n.accountId === account.id) n.read = true;
      return { ok: true };
    });
  }
}
