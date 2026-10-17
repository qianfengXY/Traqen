import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { AuthRepository } from "./repository.js";
import { AuthService } from "./service.js";
import { AuthHttp } from "./http.js";
import { demand } from "./errors.js";
export async function privateFile(filename, { maximum = 65536 } = {}) {
  demand(
    typeof filename === "string" && filename.startsWith("/"),
    "AUTH_SECRET_FILE_REQUIRED",
    "需要受保护文件的绝对位置",
    503,
  );
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    demand(
      stat.isFile() &&
        (stat.mode & 0o077) === 0 &&
        stat.size <= maximum &&
        (typeof process.getuid !== "function" || stat.uid === process.getuid()),
      "AUTH_SECRET_FILE_UNSAFE",
      "凭据文件必须为私有普通文件",
      503,
    );
    return await file.readFile();
  } finally {
    await file.close();
  }
}
export async function authRuntime(database, env = process.env) {
  const key = await privateFile(env.TRAQEN_AUTH_KEY_FILE, { maximum: 32 });
  const service = new AuthService({ repository: new AuthRepository(database), key, policy: authPolicy(env) });
  const http = new AuthHttp({
    service,
    origin: env.TRAQEN_PUBLIC_ORIGIN,
    development: env.TRAQEN_AUTH_DEVELOPMENT === "true",
    trustedProxies: String(env.TRAQEN_AUTH_TRUSTED_PROXIES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
  return { service, http };
}

export function authPolicy(env = process.env) {
  const csv = (name, fallback) =>
    String(env[name] ?? fallback)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const businessRoles = csv("DECISION_BUSINESS_ROLES", "business-owner"),
    complianceRoles = csv("DECISION_COMPLIANCE_ROLES", "compliance-owner");
  const reviewRoles = [
    ...new Set([
      ...businessRoles,
      ...complianceRoles,
      ...csv("DECISION_APPROVER_ROLES", "business-owner"),
      ...csv("DECISION_PROPOSER_ROLES", "business-owner"),
      ...csv("DECISION_BREAK_GLASS_ROLES", "incident-commander,risk-owner"),
      ...csv("DECISION_LIFECYCLE_ROLES", "business-owner,compliance-owner,risk-owner"),
      ...csv("IMPLEMENTATION_REVIEW_ROLES", "developer"),
      ...csv("CLAIM_REVIEW_ROLES", "business-owner"),
      ...csv("TEST_SPEC_APPROVER_ROLES", "business-owner"),
      ...csv("PROCESS_MODEL_ROLES", "business-owner"),
      ...csv("FEATURE_GOVERNANCE_ROLES", "business-owner"),
      ...csv("EVIDENCE_LIFECYCLE_ROLES", "business-owner"),
    ]),
  ];
  return {
    businessRoles,
    complianceRoles,
    reviewRoles,
    implementationRoles: csv("IMPLEMENTATION_REVIEW_ROLES", "developer"),
    claimReviewRoles: csv("CLAIM_REVIEW_ROLES", "business-owner"),
  };
}
