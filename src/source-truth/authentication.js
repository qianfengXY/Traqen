import { createHash, timingSafeEqual } from "node:crypto";
import { requireValue } from "./errors.js";

export function sourceTruthAuthenticator(members) {
  requireValue(Array.isArray(members) && members.length > 0 && members.length <= 1000,
    "SOURCE_AUTH_CONFIGURATION_REQUIRED", "必须配置服务端成员身份绑定，不能从请求正文推断用户", { status: 503 });
  const digests = new Set();
  const bindings = members.map((member) => {
    requireValue(/^[a-f0-9]{64}$/.test(member.tokenDigest) && !digests.has(member.tokenDigest)
      && typeof member.actorId === "string" && member.actorId.length > 0 && typeof member.tenantId === "string" && member.tenantId.length > 0,
    "SOURCE_AUTH_CONFIGURATION_REQUIRED", "服务端成员凭据绑定无效或重复", { status: 503 });
    digests.add(member.tokenDigest);
    return { digest: Buffer.from(member.tokenDigest, "hex"), actor: Object.freeze({ actorId: member.actorId, tenantId: member.tenantId }) };
  });
  return (request) => {
    const header = request.headers.authorization;
    requireValue(typeof header === "string" && /^Bearer [\x21-\x7e]{16,4096}$/.test(header),
      "SOURCE_AUTHENTICATION_REQUIRED", "请使用已绑定服务端成员的来源访问凭据", { status: 401 });
    const digest = createHash("sha256").update(header.slice(7)).digest();
    let actor = null;
    for (const binding of bindings) if (timingSafeEqual(binding.digest, digest)) actor = binding.actor;
    requireValue(actor, "SOURCE_AUTHENTICATION_REQUIRED", "来源访问凭据无效", { status: 401 });
    return actor;
  };
}
