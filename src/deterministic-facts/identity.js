import { createHash } from "node:crypto";

import { canonicalEncode, decodePathBytes } from "../source-truth/identity.js";

const hexId = /^[a-f0-9]{64}$/;
const scopeKinds = new Map([["COMPONENT", 0], ["DIRECTORY", 1], ["ENTRY", 2]]);
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function requireHexId(value, field) {
  if (typeof value !== "string" || !hexId.test(value)) throw new TypeError(`${field} must be a 64-character lowercase SHA-256 id`);
  return value;
}

function sortedStrings(values, field) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError(`${field} must be an array of non-empty strings`);
  }
  return [...new Set(values)].sort(compareUtf8);
}

function normalRecord(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  // canonicalEncode is also the strict boundary rejecting undefined, invalid Unicode and non-finite numbers.
  return JSON.parse(canonicalEncode(value));
}

function recordShape(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  return value;
}

export function canonicalDigest(domain, payload) {
  requireString(domain, "domain");
  // One strict canonical traversal is sufficient. Encoding, parsing, then
  // re-encoding every nested identity doubles work for each immutable record;
  // the same strict encoder already rejects every non-JSON input here.
  return createHash("sha256").update(canonicalEncode({ domain: `F002.${domain}`, version: 1, payload: recordShape(payload, "payload") }), "utf8").digest("hex");
}

function identity(domain, payload) {
  return canonicalDigest(domain, payload);
}

export function createMaterialId({ workspaceId, bundleId, componentId, pathBytes }) {
  decodePathBytes(pathBytes);
  return identity("MATERIAL", { workspaceId: requireString(workspaceId, "workspaceId"), bundleId: requireHexId(bundleId, "bundleId"), componentId: requireHexId(componentId, "componentId"), pathBytes });
}

export function createObjectId({ materialId, objectKind, anchor }) {
  return identity("OBJECT", { materialId: requireHexId(materialId, "materialId"), objectKind: requireString(objectKind, "objectKind"), anchor: recordShape(anchor, "anchor") });
}

export function createEvidenceId({ materialId, contentDigest, anchor, evidenceKind }) {
  return identity("EVIDENCE", { materialId: requireHexId(materialId, "materialId"), contentDigest: requireHexId(contentDigest, "contentDigest"), anchor: recordShape(anchor, "anchor"), evidenceKind: requireString(evidenceKind, "evidenceKind") });
}

export function createFactId({ subjectId, predicate, typedValue, targetId, basis = "DECLARED", evidenceIds = [], ruleRef = null, premiseFactIds = [] }) {
  if ((typedValue === undefined || typedValue === null) === (targetId === undefined || targetId === null)) {
    throw new TypeError("fact must contain exactly one of typedValue or targetId");
  }
  return identity("FACT", {
    subjectId: requireString(subjectId, "subjectId"), predicate: requireString(predicate, "predicate"),
    ...(typedValue === undefined || typedValue === null ? { targetId: requireString(targetId, "targetId") } : { typedValue: recordShape(typedValue, "typedValue") }),
    basis: requireString(basis, "basis"), evidenceIds: sortedStrings(evidenceIds, "evidenceIds"),
    ruleRef: ruleRef === null ? null : recordShape(ruleRef, "ruleRef"), premiseFactIds: sortedStrings(premiseFactIds, "premiseFactIds"),
  });
}

export function createGapId({ origin, scopeId = null, materialId = null, objectId = null, capability, code, location = null, reason }) {
  return identity("GAP", { origin: requireString(origin, "origin"), scopeId, materialId, objectId, capability: requireString(capability, "capability"), code: requireString(code, "code"), location, reason: recordShape(reason, "reason") });
}

function selector(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("scope selection must be an object");
  const kind = input.kind;
  if (!scopeKinds.has(kind)) throw new TypeError("scope selection kind must be COMPONENT, DIRECTORY, or ENTRY");
  const componentId = requireHexId(input.componentId, "selection.componentId");
  if (kind === "COMPONENT") {
    if (Object.hasOwn(input, "pathBytes")) throw new TypeError("COMPONENT selection must not contain pathBytes");
    return { kind, componentId, pathBytes: null, rawPath: Buffer.alloc(0) };
  }
  if (typeof input.pathBytes !== "string") throw new TypeError(`${kind} selection requires pathBytes`);
  const rawPath = decodePathBytes(input.pathBytes);
  return { kind, componentId, pathBytes: input.pathBytes, rawPath };
}

function covers(cover, selected) {
  if (cover.componentId !== selected.componentId) return false;
  if (cover.kind === "COMPONENT") return true;
  if (cover.kind !== "DIRECTORY" || selected.kind === "COMPONENT") return false;
  return selected.rawPath.equals(cover.rawPath)
    || (selected.rawPath.length > cover.rawPath.length && selected.rawPath.subarray(0, cover.rawPath.length).equals(cover.rawPath)
      && selected.rawPath[cover.rawPath.length] === 47);
}

export function normalizeScope(selections) {
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > 256) throw new TypeError("scope selections must contain 1–256 entries");
  const deduplicated = new Map();
  for (const input of selections) {
    const value = selector(input);
    const key = `${value.kind}\u0000${value.componentId}\u0000${value.pathBytes ?? ""}`;
    deduplicated.set(key, value);
  }
  const values = [...deduplicated.values()].filter((candidate) => ![...deduplicated.values()].some((cover) => cover !== candidate && covers(cover, candidate)));
  values.sort((left, right) => Buffer.compare(Buffer.from(left.componentId, "ascii"), Buffer.from(right.componentId, "ascii"))
    || Buffer.compare(left.rawPath, right.rawPath) || scopeKinds.get(left.kind) - scopeKinds.get(right.kind));
  return values.map(({ kind, componentId, pathBytes }) => pathBytes === null ? { kind, componentId } : { kind, componentId, pathBytes });
}

export function createScopeId({ workspaceId, bundleId, profileId, selections }) {
  return identity("SCOPE", { workspaceId: requireString(workspaceId, "workspaceId"), bundleId: requireHexId(bundleId, "bundleId"), profileId: requireHexId(profileId, "profileId"), selections: normalizeScope(selections) });
}

function profileConfig({ version, schemaVersion, capabilityIds, ruleVersions, canonicalizationVersion, extractionLimits, redactionPolicyRevision }) {
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new TypeError("schemaVersion must be a positive integer");
  return {
    version: requireString(version, "version"), schemaVersion, capabilityIds: sortedStrings(capabilityIds, "capabilityIds"), ruleVersions: sortedStrings(ruleVersions, "ruleVersions"),
    canonicalizationVersion: requireString(canonicalizationVersion, "canonicalizationVersion"), extractionLimits: normalRecord(extractionLimits, "extractionLimits"), redactionPolicyRevision: requireString(redactionPolicyRevision, "redactionPolicyRevision"),
  };
}

export function createProfileConfigDigest(input) {
  return identity("PROFILE_CONFIG", profileConfig(input));
}

export function createProfileId(input) {
  const config = profileConfig(input);
  const configDigest = createProfileConfigDigest(config);
  if (Object.hasOwn(input, "configDigest") && input.configDigest !== configDigest) throw new TypeError("configDigest must match the canonical profile configuration");
  return identity("PROFILE", { ...config, configDigest });
}

export function createGraphVersionId({ workspaceId, bundleId, scopeId, schemaVersion, ruleConfig, records }) {
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new TypeError("schemaVersion must be a positive integer");
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  const normalizedRecords = records.map((record) => ({ kind: requireString(record?.kind, "record.kind"), id: requireString(record?.id, "record.id") }))
    .sort((left, right) => compareUtf8(left.kind, right.kind) || compareUtf8(left.id, right.id));
  if (new Set(normalizedRecords.map((record) => `${record.kind}\u0000${record.id}`)).size !== normalizedRecords.length) throw new TypeError("records must be unique");
  return identity("GRAPH_VERSION", {
    workspaceId: requireString(workspaceId, "workspaceId"), bundleId: requireHexId(bundleId, "bundleId"), scopeId: requireString(scopeId, "scopeId"),
    schemaVersion, ruleConfig: normalRecord(ruleConfig, "ruleConfig"), records: normalizedRecords,
  });
}
