import { canonicalJson, deepFreeze } from "../domain/index.js";

const engines = new Set(["AST", "REGEX_FALLBACK", "DOCUMENT", "CONFIG", "TEST_RESULT"]);

function normalize(capability) {
  if (!engines.has(capability.engine)) throw new TypeError(`Unsupported extractor engine ${capability.engine}`);
  if (!["VERIFIED", "FAILED", "UNVERIFIED"].includes(capability.fixtureStatus)) {
    throw new TypeError("fixtureStatus must be VERIFIED, FAILED, or UNVERIFIED");
  }
  for (const field of ["languages", "artifactKinds", "nodeTypes", "edgePredicates", "knownGaps"]) {
    if (!Array.isArray(capability[field])) throw new TypeError(`${field} must be an array`);
  }
  return deepFreeze({
    id: capability.id,
    version: capability.version,
    engine: capability.engine,
    languages: [...new Set(capability.languages)].sort(),
    artifactKinds: [...new Set(capability.artifactKinds)].sort(),
    nodeTypes: [...new Set(capability.nodeTypes)].sort(),
    edgePredicates: [...new Set(capability.edgePredicates)].sort(),
    knownGaps: [...new Set(capability.knownGaps)].sort(),
    fixtureStatus: capability.fixtureStatus,
  });
}

export class ExtractorCapabilityRegistry {
  #capabilities = new Map();

  register(capability) {
    const normalized = normalize(capability);
    const key = `${normalized.id}\u0000${normalized.version}`;
    const existing = this.#capabilities.get(key);
    if (existing && canonicalJson(existing) !== canonicalJson(normalized)) {
      throw new TypeError(`ExtractorCapability ${normalized.id}@${normalized.version} conflicts`);
    }
    this.#capabilities.set(key, normalized);
    return normalized;
  }

  list({ language = null, artifactKind = null, verifiedOnly = true } = {}) {
    return deepFreeze([...this.#capabilities.values()]
      .filter((capability) => !verifiedOnly || capability.fixtureStatus === "VERIFIED")
      .filter((capability) => !language || capability.languages.includes(language) || capability.languages.includes("*"))
      .filter((capability) => !artifactKind || capability.artifactKinds.includes(artifactKind))
      .sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version)));
  }
}
