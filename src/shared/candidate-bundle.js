export const candidateBundleSchemaVersion = "1.0.0";

export const CandidateKind = Object.freeze({
  FEATURE: "CANDIDATE_FEATURE",
  CLAIM: "CANDIDATE_CLAIM",
});

export const CandidateStatus = Object.freeze({
  PENDING_REVIEW: "PENDING_REVIEW",
});

const confidenceRank = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3 });
const candidateKinds = new Set(Object.values(CandidateKind));
const candidateStatuses = new Set(Object.values(CandidateStatus));
const candidateProposalFields = new Set([
  "candidateKey",
  "mode",
  "name",
  "kind",
  "method",
  "modulePath",
  "sourcePath",
  "description",
  "code",
  "evidence",
  "displayName",
  "businessFeature",
  "businessKey",
  "businessModule",
  "businessSubmodule",
  "domain",
  "group",
  "rationale",
  "stableEvidenceNodeIds",
  "design",
  "analysisProvenance",
  "uncertainties",
  "statement",
  "scope",
  "constraint",
  "openQuestions",
]);
const reservedGovernanceFields = new Set([
  "governedFeatureId",
  "featureId",
  "featureVersionId",
  "claimId",
  "decisionId",
  "identityDecision",
  "authority",
  "authorizedBy",
  "reviewDisposition",
  "retirement",
]);
const proposalStringFields = new Set([
  "candidateKey",
  "name",
  "kind",
  "displayName",
  "businessKey",
  "businessModule",
  "businessSubmodule",
  "domain",
  "rationale",
  "statement",
]);
const proposalPlainStringFields = new Set([
  "modulePath",
  "sourcePath",
  "description",
  "code",
]);
const proposalObjectFields = new Set(["evidence", "design", "scope", "constraint"]);
const proposalStringArrayFields = new Set(["stableEvidenceNodeIds", "uncertainties", "openQuestions"]);
const candidateGroups = new Set([
  "BUSINESS_CAPABILITY",
  "BACKGROUND_INTEGRATION",
  "DATA_INTEGRATION",
  "PROJECT_OPERATION",
  "API_SERVICE",
]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function object(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function string(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function schemaVersion(value, fieldName) {
  const normalized = string(value, fieldName);
  if (normalized !== candidateBundleSchemaVersion) {
    throw new TypeError(`${fieldName} must be ${candidateBundleSchemaVersion}`);
  }
  return normalized;
}

function isoTimestamp(value, fieldName) {
  const normalized = string(value, fieldName);
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${fieldName} must be an ISO-8601 timestamp`);
  return normalized;
}

function uniqueStrings(value, fieldName, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    if (nonEmpty && value === undefined) throw new TypeError(`${fieldName} must contain at least one Fact`);
    throw new TypeError(`${fieldName} must be an array`);
  }
  const normalized = value.map((item, index) => string(item, `${fieldName}[${index}]`));
  if (nonEmpty && normalized.length === 0) throw new TypeError(`${fieldName} must contain at least one Fact`);
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${fieldName} must not contain duplicates`);
  return normalized;
}

function enumValue(values, value, fieldName) {
  const normalized = string(value, fieldName);
  if (!values.has(normalized)) throw new TypeError(`${fieldName} has unsupported value ${normalized}`);
  return normalized;
}

function assertNoGovernanceFields(value, fieldName) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoGovernanceFields(item, `${fieldName}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (reservedGovernanceFields.has(key)) {
      throw new TypeError(`${fieldName} contains reserved governance field ${key}`);
    }
    assertNoGovernanceFields(child, `${fieldName}.${key}`);
  }
}

function proposal(value, fieldName) {
  const normalized = object(value, fieldName);
  const fields = Object.keys(normalized);
  if (fields.length === 0) throw new TypeError(`${fieldName} must contain at least one proposed field`);
  const unsupported = fields.filter((field) => !candidateProposalFields.has(field));
  if (unsupported.length > 0) throw new TypeError(`${fieldName} contains unsupported field ${unsupported[0]}`);
  assertNoGovernanceFields(normalized, fieldName);
  for (const field of fields) {
    const item = normalized[field];
    if (proposalStringFields.has(field)) string(item, `${fieldName}.${field}`);
    else if (proposalPlainStringFields.has(field) && typeof item !== "string") {
      throw new TypeError(`${fieldName}.${field} must be a string`);
    } else if (field === "method" && item !== null && typeof item !== "string") {
      throw new TypeError(`${fieldName}.method must be a string or null`);
    } else if (field === "businessFeature" && typeof item !== "boolean") {
      throw new TypeError(`${fieldName}.businessFeature must be a boolean`);
    } else if (field === "mode") {
      enumValue(new Set(["BUSINESS", "API"]), item, `${fieldName}.mode`);
    } else if (field === "group") {
      enumValue(candidateGroups, item, `${fieldName}.group`);
    } else if (proposalObjectFields.has(field)) {
      object(item, `${fieldName}.${field}`);
    } else if (proposalStringArrayFields.has(field)) {
      uniqueStrings(item, `${fieldName}.${field}`);
    } else if (field === "analysisProvenance") {
      if (!Array.isArray(item)) throw new TypeError(`${fieldName}.analysisProvenance must be an array`);
      item.forEach((entry, index) => object(entry, `${fieldName}.analysisProvenance[${index}]`));
    }
  }
  return structuredClone(normalized);
}

function provenance(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${fieldName} must contain at least one producer`);
  return value.map((item, index) => {
    const producer = object(item, `${fieldName}[${index}]`);
    const producerType = enumValue(
      new Set(["DETERMINISTIC", "MODEL", "SKILL", "HUMAN"]),
      producer.producerType,
      `${fieldName}[${index}].producerType`,
    );
    return {
      producerType,
      producerId: string(producer.producerId, `${fieldName}[${index}].producerId`),
      producerVersion: producer.producerVersion === null || producer.producerVersion === undefined
        ? null
        : string(producer.producerVersion, `${fieldName}[${index}].producerVersion`),
    };
  });
}

export function normalizeWorkUnit(input) {
  const value = object(input, "workUnit");
  const factIds = uniqueStrings(value.factIds, "workUnit.factIds", { nonEmpty: true });
  const rootFactIds = uniqueStrings(value.rootFactIds, "workUnit.rootFactIds", { nonEmpty: true });
  const allowedFactIds = new Set(factIds);
  const escapedRoots = rootFactIds.filter((factId) => !allowedFactIds.has(factId));
  if (escapedRoots.length > 0) {
    throw new TypeError(`workUnit.rootFactIds must be members of factIds: ${escapedRoots.join(", ")}`);
  }
  return deepFreeze({
    schemaVersion: schemaVersion(value.schemaVersion, "workUnit.schemaVersion"),
    id: string(value.id, "workUnit.id"),
    projectId: string(value.projectId, "workUnit.projectId"),
    snapshotManifestId: string(value.snapshotManifestId, "workUnit.snapshotManifestId"),
    analysisRunId: string(value.analysisRunId, "workUnit.analysisRunId"),
    factIds,
    rootFactIds,
  });
}

function assertBundleIdentity(bundle, workUnit, fieldName) {
  const expected = fieldName === "workUnitId" ? workUnit.id : workUnit[fieldName];
  if (bundle[fieldName] !== expected) throw new TypeError(`candidateBundle.${fieldName} must match WorkUnit`);
}

function normalizeCandidate(input, index, allowedFactIds, workUnitId) {
  const fieldName = `candidateBundle.candidates[${index}]`;
  const value = object(input, fieldName);
  const evidenceFactIds = uniqueStrings(value.evidenceFactIds, `${fieldName}.evidenceFactIds`, { nonEmpty: true });
  const escaped = evidenceFactIds.filter((factId) => !allowedFactIds.has(factId));
  if (escaped.length > 0) {
    throw new TypeError(`${fieldName}.evidenceFactIds outside WorkUnit ${workUnitId}: ${escaped.join(", ")}`);
  }
  const confidence = enumValue(new Set(Object.keys(confidenceRank)), value.confidence, `${fieldName}.confidence`);
  const confidenceCap = enumValue(new Set(Object.keys(confidenceRank)), value.confidenceCap, `${fieldName}.confidenceCap`);
  if (confidenceRank[confidence] > confidenceRank[confidenceCap]) {
    throw new TypeError(`${fieldName}.confidence ${confidence} exceeds evidence cap ${confidenceCap}`);
  }
  return {
    id: string(value.id, `${fieldName}.id`),
    kind: enumValue(candidateKinds, value.kind, `${fieldName}.kind`),
    status: enumValue(candidateStatuses, value.status, `${fieldName}.status`),
    confidence,
    confidenceCap,
    evidenceFactIds,
    proposal: proposal(value.proposal, `${fieldName}.proposal`),
    provenance: provenance(value.provenance, `${fieldName}.provenance`),
  };
}

export function normalizeCandidateBundle(input, suppliedWorkUnit) {
  const value = object(input, "candidateBundle");
  const workUnit = normalizeWorkUnit(suppliedWorkUnit);
  const normalizedIdentity = {
    schemaVersion: schemaVersion(value.schemaVersion, "candidateBundle.schemaVersion"),
    id: string(value.id, "candidateBundle.id"),
    projectId: string(value.projectId, "candidateBundle.projectId"),
    snapshotManifestId: string(value.snapshotManifestId, "candidateBundle.snapshotManifestId"),
    analysisRunId: string(value.analysisRunId, "candidateBundle.analysisRunId"),
    workUnitId: string(value.workUnitId, "candidateBundle.workUnitId"),
  };
  for (const fieldName of ["projectId", "snapshotManifestId", "analysisRunId", "workUnitId"]) {
    assertBundleIdentity(normalizedIdentity, workUnit, fieldName);
  }
  if (!Array.isArray(value.candidates)) throw new TypeError("candidateBundle.candidates must be an array");
  const allowedFactIds = new Set(workUnit.factIds);
  const candidates = value.candidates.map((candidate, index) =>
    normalizeCandidate(candidate, index, allowedFactIds, workUnit.id));
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    throw new TypeError("candidateBundle.candidates must have unique ids");
  }
  return deepFreeze({
    ...normalizedIdentity,
    producedAt: isoTimestamp(value.producedAt, "candidateBundle.producedAt"),
    candidates,
  });
}
