import { randomUUID } from "node:crypto";
import { digest, token, safeDestination } from "./crypto.js";
import { demand } from "./errors.js";
export const publicAccount = (a) => ({
  id: a.id,
  login: a.login,
  displayName: a.displayName,
  status: a.status,
  admin: !!a.admin,
  globalConfig: !!a.globalConfig,
  kind: a.kind ?? "HUMAN",
});
export const audit = (s, actorId, type, extra = {}) => s.audit.push({ actorId, type, ...extra });
export function notify(s, accountId, type, extra = {}) {
  const id = randomUUID();
  s.notifications[id] = { id, accountId, type, read: false, createdAt: new Date().toISOString(), ...extra };
}
export function sessionIn(s, raw, now, { recent = false, admin = false } = {}) {
  demand(s.control.initialized, "AUTH_NOT_INITIALIZED", "请在部署终端完成初始化", 503);
  const session = s.sessions[digest(raw ?? "")];
  demand(session, "AUTH_REQUIRED", "请先登录", 401);
  demand(
    !session.revoked && session.epoch === Number(s.control.epoch),
    "AUTH_SESSION_REVOKED",
    "会话已撤销，请重新登录",
    401,
  );
  const account = s.accounts[session.accountId];
  demand(account?.status === "ACTIVE", "AUTH_ACCOUNT_DISABLED", "账号已停用，请联系系统管理员", 401);
  demand(
    now < session.expiresAt && now - session.lastActivity < session.idleMs,
    "AUTH_SESSION_EXPIRED",
    "会话已过期，请重新登录",
    401,
  );
  demand(!s.control.recovery || account.recoveryAdmin, "AUTH_RECOVERY_REQUIRED", "实例正在恢复检查，暂不开放登录", 503);
  demand(session.phase === "AUTHENTICATED", "AUTH_SESSION_REVOKED", "请重新使用账号密码登录", 401);
  if (recent)
    demand(
      session.phase === "AUTHENTICATED" && now - session.verifiedAt <= 600000,
      "AUTH_REAUTH_REQUIRED",
      "请重新验证身份",
      403,
    );
  if (admin)
    demand(
      account.admin && session.phase === "AUTHENTICATED",
      "AUTH_ADMIN_REQUIRED",
      "需要系统管理员资格",
      403,
    );
  return { session, account };
}
export function createSession(s, account, now, { remember = false, device = "浏览器" } = {}) {
  const raw = token(),
    id = digest(raw);
  s.sessions[id] = {
    id,
    accountId: account.id,
    phase: "AUTHENTICATED",
    device: String(device).slice(0, 160),
    createdAt: now,
    lastActivity: now,
    verifiedAt: now,
    expiresAt: now + (remember ? 30 * 86400000 : 43200000),
    idleMs: remember ? 7 * 86400000 : 7200000,
    epoch: Number(s.control.epoch),
    revoked: false,
  };
  return { token: raw, state: "AUTHENTICATED", account: publicAccount(account), session: s.sessions[id] };
}
export function rotateSession(s, session, account, now) {
  session.revoked = true;
  return createSession(s, account, now, { remember: session.idleMs > 7200000, device: session.device });
}
export function revokeAccountSessions(s, accountId) {
  for (const session of Object.values(s.sessions)) if (session.accountId === accountId) session.revoked = true;
}
export function validLogin(value) {
  demand(
    typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._@-]{1,119}$/.test(value),
    "AUTH_INVALID_LOGIN",
    "账号使用 2 至 120 个字母、数字或 . _ @ -",
    400,
  );
  return value.toLowerCase();
}
export function validText(value, max = 1000) {
  demand(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    "AUTH_INVALID_INPUT",
    "请输入有效内容",
    400,
  );
  return value.trim();
}
export function position(value) {
  return safeDestination(value);
}
