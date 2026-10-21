import { requireF002 } from "./errors.js";

const supported = [
  "inventory@1", "javascript@1", "java@1", "markdown@1", "json@1", "yaml@1", "properties@1", "junit-xml@1",
  "image-metadata@1", "evidence@1", "gaps@1", "policy@1",
  "javascript@2", "java@2", "markdown@2", "json@2", "properties@2", "junit-xml@2",
];

const capabilityByMaterialKind = new Map([
  ["JAVASCRIPT", "javascript"], ["JAVA", "java"], ["MARKDOWN", "markdown"], ["JSON", "json"],
  ["YAML", "yaml"], ["PROPERTIES", "properties"], ["JUNIT_XML", "junit-xml"], ["IMAGE", "image-metadata"],
]);

function capabilityForMaterialKind(materialKind) {
  return capabilityByMaterialKind.get(materialKind) ?? null;
}

function declaredRuleVersions(profile) {
  if (!Object.hasOwn(profile ?? {}, "ruleVersions")) return null;
  requireF002(Array.isArray(profile.ruleVersions) && profile.ruleVersions.every((value) => typeof value === "string" && /^[a-z][a-z0-9-]*@[1-9][0-9]*$/.test(value)),
    "RULE_VERSION_UNAVAILABLE", "能力配置没有可执行的精确规则版本", { status: 409 });
  const versions = new Map();
  for (const rule of profile.ruleVersions) {
    const [capability, version] = rule.split("@");
    requireF002(!versions.has(capability) || versions.get(capability) === version,
      "RULE_VERSION_AMBIGUOUS", "同一能力只能指定一个精确规则版本", { status: 409 });
    versions.set(capability, version);
  }
  return profile.ruleVersions;
}

// A profile is historical data, not executable code. This registry is the
// server-owned proof that each declared rule version still has an implementation.
// `startable` controls only new analysis starts and never removes a retained
// implementation from replay.
export class F002RuleRegistry {
  constructor({ ruleVersions = supported } = {}) {
    requireF002(Array.isArray(ruleVersions) && ruleVersions.every((value) => typeof value === "string" && /^[a-z][a-z0-9-]*@[1-9][0-9]*$/.test(value)),
      "RULE_VERSION_UNAVAILABLE", "规则注册表无效", { status: 503 });
    this.ruleVersions = new Set(ruleVersions);
  }

  assertProfile(profile) {
    const declared = declaredRuleVersions(profile);
    if (declared === null) return;
    for (const ruleVersion of declared) {
      requireF002(this.ruleVersions.has(ruleVersion), "RULE_VERSION_UNAVAILABLE", "历史规则版本不可用于重放", { status: 409 });
    }
  }

  materialRule(profile, materialKind) {
    const capability = capabilityForMaterialKind(materialKind);
    if (!capability) return null;
    const declared = declaredRuleVersions(profile);
    if (declared === null) return { id: `f002-${capability}`, version: profile.version };
    const prefix = `${capability}@`;
    const ruleVersion = declared.find((value) => value.startsWith(prefix));
    if (!ruleVersion) return null;
    requireF002(this.ruleVersions.has(ruleVersion), "RULE_VERSION_UNAVAILABLE", "历史规则版本不可用于重放", { status: 409 });
    return { id: `f002-${capability}`, version: ruleVersion.slice(prefix.length) };
  }
}

export const installedF002Rules = new F002RuleRegistry();
export { capabilityForMaterialKind };
