import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import {
  ClaimType,
  ConstraintOperator,
  FactNodeType,
  ReverseArtifactType,
  ReverseConfidence,
  ReverseSkillCapability,
  ReverseSkillStatus,
  assertEnum,
  requireIsoTimestamp,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";

const inputTypes = new Set([
  "PROJECT_SNAPSHOT",
  "CODE_FACT_BUNDLE",
  "DATABASE_FACT_BUNDLE",
  "EXISTING_TEST_BUNDLE",
  "RUNTIME_FACT_BUNDLE",
]);
const evidenceRelations = new Set(["SUPPORTS", "CONTRADICTS", "CONTEXT"]);
const permissionValues = Object.freeze({
  filesystem: new Set(["NONE", "READ_ONLY"]),
  database: new Set(["NONE", "READ_ONLY"]),
  network: new Set(["NONE", "ALLOWLISTED"]),
  shell: new Set(["NONE"]),
  secrets: new Set(["NONE"]),
});

function requireObject(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function assertOnlyFields(value, allowedFields, fieldName) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.includes(field)) throw new TypeError(`${fieldName}.${field} is not supported`);
  }
}

function jsonValue(value, fieldName) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${fieldName}[${index}]`));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${fieldName}.${key}`)]),
    );
  }
  throw new TypeError(`${fieldName} must contain only JSON values`);
}

function uniqueStrings(value, fieldName, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${fieldName} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const result = value.map((item, index) => requireNonEmptyString(item, `${fieldName}[${index}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${fieldName} must not contain duplicates`);
  return result;
}

function sha256(value, fieldName) {
  requireNonEmptyString(value, fieldName);
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new TypeError(`${fieldName} must be a SHA-256 digest`);
  return value;
}

function semver(value, fieldName) {
  requireNonEmptyString(value, fieldName);
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new TypeError(`${fieldName} must be a semantic version`);
  }
  return value;
}

function stringOrNull(value, fieldName) {
  return value === null || value === undefined ? null : requireNonEmptyString(value, fieldName);
}

function normalizePermission(value, fieldName) {
  const normalized = requireNonEmptyString(value, `permissions.${fieldName}`).toUpperCase();
  if (!permissionValues[fieldName].has(normalized)) {
    throw new TypeError(`permissions.${fieldName} requests an unsupported privilege`);
  }
  return normalized;
}

export function createReverseSkillManifest(input) {
  requireObject(input, "manifest");
  if (input.apiVersion !== "quality.traqen/v1alpha1") {
    throw new TypeError("manifest.apiVersion must be quality.traqen/v1alpha1");
  }
  if (input.kind !== "ReverseSkill") throw new TypeError("manifest.kind must be ReverseSkill");
  const metadata = requireObject(input.metadata, "manifest.metadata");
  const capabilities = uniqueStrings(input.capabilities, "manifest.capabilities").map((capability) =>
    assertEnum(ReverseSkillCapability, capability, "manifest capability"),
  );
  const compatibility = requireObject(input.compatibility, "manifest.compatibility");
  const inputs = requireObject(input.inputs, "manifest.inputs");
  const requiredInputs = uniqueStrings(inputs.required, "manifest.inputs.required");
  const optionalInputs = uniqueStrings(inputs.optional ?? [], "manifest.inputs.optional", { allowEmpty: true });
  for (const inputType of [...requiredInputs, ...optionalInputs]) {
    if (!inputTypes.has(inputType)) throw new TypeError(`Unsupported Skill input type: ${inputType}`);
  }
  if (!requiredInputs.includes("PROJECT_SNAPSHOT") || !requiredInputs.includes("CODE_FACT_BUNDLE")) {
    throw new TypeError("Skill inputs must require PROJECT_SNAPSHOT and CODE_FACT_BUNDLE");
  }
  const outputs = requireObject(input.outputs, "manifest.outputs");
  if (outputs.schema !== "reverse-artifact-bundle/v1alpha1") {
    throw new TypeError("manifest.outputs.schema must be reverse-artifact-bundle/v1alpha1");
  }
  const permissions = requireObject(input.permissions, "manifest.permissions");
  const model = requireObject(input.model, "manifest.model");
  const execution = requireObject(input.execution, "manifest.execution");
  const timeoutMinutes = requirePositiveInteger(execution.timeoutMinutes, "manifest.execution.timeoutMinutes");
  if (timeoutMinutes > 30) throw new RangeError("manifest.execution.timeoutMinutes must not exceed 30");
  const maxOutputCandidates = requirePositiveInteger(
    execution.maxOutputCandidates ?? 500,
    "manifest.execution.maxOutputCandidates",
  );
  if (maxOutputCandidates > 5_000) {
    throw new RangeError("manifest.execution.maxOutputCandidates must not exceed 5000");
  }

  return deepFreeze({
    apiVersion: input.apiVersion,
    kind: input.kind,
    metadata: {
      id: requireNonEmptyString(metadata.id, "manifest.metadata.id"),
      name: requireNonEmptyString(metadata.name, "manifest.metadata.name"),
      version: semver(metadata.version, "manifest.metadata.version"),
      publisher: requireNonEmptyString(metadata.publisher, "manifest.metadata.publisher"),
      artifactDigest: sha256(metadata.artifactDigest, "manifest.metadata.artifactDigest"),
    },
    capabilities,
    compatibility: {
      languages: uniqueStrings(compatibility.languages, "manifest.compatibility.languages", { allowEmpty: true }),
      frameworks: uniqueStrings(compatibility.frameworks, "manifest.compatibility.frameworks", { allowEmpty: true }),
      factSchema: requireNonEmptyString(compatibility.factSchema, "manifest.compatibility.factSchema"),
    },
    inputs: { required: requiredInputs, optional: optionalInputs },
    outputs: {
      schema: outputs.schema,
      types: uniqueStrings(outputs.types, "manifest.outputs.types").map((type) =>
        assertEnum(ReverseArtifactType, type, "manifest output type"),
      ),
    },
    permissions: {
      filesystem: normalizePermission(permissions.filesystem, "filesystem"),
      database: normalizePermission(permissions.database, "database"),
      network: normalizePermission(permissions.network, "network"),
      shell: normalizePermission(permissions.shell, "shell"),
      secrets: normalizePermission(permissions.secrets, "secrets"),
    },
    model: {
      required: model.required === true,
      allowedProfiles: uniqueStrings(model.allowedProfiles ?? [], "manifest.model.allowedProfiles", {
        allowEmpty: model.required !== true,
      }),
      contextStrategy: requireNonEmptyString(model.contextStrategy, "manifest.model.contextStrategy"),
    },
    execution: {
      timeoutMinutes,
      costClass: requireNonEmptyString(execution.costClass, "manifest.execution.costClass").toUpperCase(),
      supportsIncremental: execution.supportsIncremental === true,
      maxOutputCandidates,
    },
  });
}

export function reverseSkillManifestSigningPayload(manifest) {
  return canonicalJson({ kind: "REVERSE_SKILL_MANIFEST", manifest });
}

export function signReverseSkillManifest(manifest, secret) {
  requireNonEmptyString(secret, "publisher secret");
  const normalized = createReverseSkillManifest(manifest);
  return deepFreeze({
    ...structuredClone(normalized),
    attestation: {
      algorithm: "HMAC-SHA256",
      publisher: normalized.metadata.publisher,
      signature: createHmac("sha256", secret).update(reverseSkillManifestSigningPayload(normalized)).digest("hex"),
    },
  });
}

export function verifyReverseSkillManifestAttestation(manifest, secret) {
  if (typeof secret !== "string" || secret === "") return false;
  if (manifest?.attestation?.algorithm !== "HMAC-SHA256") return false;
  if (manifest.attestation.publisher !== manifest.metadata?.publisher) return false;
  if (!/^[a-f0-9]{64}$/.test(manifest.attestation.signature ?? "")) return false;
  let normalized;
  try {
    normalized = createReverseSkillManifest(manifest);
  } catch {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(reverseSkillManifestSigningPayload(normalized))
    .digest();
  const actual = Buffer.from(manifest.attestation.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createReverseSkillRegistration(input, clock = () => new Date()) {
  const manifest = createReverseSkillManifest(input);
  const registeredAt = input.registeredAt ?? clock().toISOString();
  requireIsoTimestamp(registeredAt, "registration.registeredAt");
  return deepFreeze({
    id: contentId("SKILL-REGISTRATION", {
      skillId: manifest.metadata.id,
      version: manifest.metadata.version,
      artifactDigest: manifest.metadata.artifactDigest,
      status: input.status,
      registeredAt,
    }),
    manifest,
    status: assertEnum(ReverseSkillStatus, input.status, "registration.status"),
    attestation: jsonValue(requireObject(input.attestation, "registration.attestation"), "registration.attestation"),
    registeredAt,
  });
}

export function createReverseInputPackage(input, clock = () => new Date()) {
  const projectId = requireNonEmptyString(input?.projectId, "inputPackage.projectId");
  const snapshotManifestId = requireNonEmptyString(
    input?.snapshotManifestId,
    "inputPackage.snapshotManifestId",
  );
  const sourceComponentId = requireNonEmptyString(input?.sourceComponentId, "inputPackage.sourceComponentId");
  if (!Array.isArray(input?.factBundles) || input.factBundles.length === 0) {
    throw new TypeError("inputPackage.factBundles must be a non-empty array");
  }
  for (const bundle of input.factBundles) {
    if (
      bundle.projectId !== projectId ||
      bundle.snapshotManifestId !== snapshotManifestId ||
      bundle.sourceComponentId !== sourceComponentId
    ) {
      throw new TypeError("Every FactBundle must match the reverse input project and snapshot");
    }
  }
  const taskScope = jsonValue(requireObject(input.taskScope ?? {}, "inputPackage.taskScope"), "inputPackage.taskScope");
  const supportedScopeFields = new Set(["artifacts", "nodeIds", "nodeTypes", "modules"]);
  for (const field of Object.keys(taskScope)) {
    if (!supportedScopeFields.has(field)) throw new TypeError(`Unsupported task scope field: ${field}`);
  }
  const artifacts = uniqueStrings(taskScope.artifacts ?? [], "inputPackage.taskScope.artifacts", { allowEmpty: true });
  const nodeIds = uniqueStrings(taskScope.nodeIds ?? [], "inputPackage.taskScope.nodeIds", { allowEmpty: true });
  const modules = uniqueStrings(taskScope.modules ?? [], "inputPackage.taskScope.modules", { allowEmpty: true });
  const nodeTypes = uniqueStrings(taskScope.nodeTypes ?? [], "inputPackage.taskScope.nodeTypes", {
    allowEmpty: true,
  }).map((type) => assertEnum(FactNodeType, type, "inputPackage.taskScope.nodeType"));
  const allNodes = input.factBundles.flatMap((bundle) => bundle.nodes);
  const knownArtifacts = new Set(allNodes.map((node) => node.source.artifact));
  const knownNodeIds = new Set(allNodes.map((node) => node.id));
  const allEdges = input.factBundles.flatMap((bundle) => bundle.edges);
  for (const artifact of artifacts) {
    if (!knownArtifacts.has(artifact)) throw new TypeError(`Task scope artifact is outside the Fact Bundles: ${artifact}`);
  }
  for (const nodeId of nodeIds) {
    if (!knownNodeIds.has(nodeId)) throw new TypeError(`Task scope node is outside the Fact Bundles: ${nodeId}`);
  }
  const moduleNodes = allNodes.filter(
    (node) => node.type === "MODULE" && modules.some((module) => [node.id, node.name, node.naturalKey].includes(module)),
  );
  const matchedModuleRefs = new Set(moduleNodes.flatMap((node) => [node.id, node.name, node.naturalKey]));
  const missingModules = modules.filter((module) => !matchedModuleRefs.has(module));
  if (missingModules.length > 0) {
    throw new TypeError(`Task scope module is outside the Fact Bundles: ${missingModules.join(", ")}`);
  }
  const moduleNodeIds = new Set(moduleNodes.map((node) => node.id));
  const moduleContainedIds = new Set(
    allEdges
      .filter(
        (edge) =>
          ["CONTAINS", "CONTROLLED_BY", "DEPENDS_ON"].includes(edge.predicate) &&
          moduleNodeIds.has(edge.subjectId),
      )
      .map((edge) => edge.objectId),
  );
  const selectedNodes = allNodes.filter(
    (node) =>
      (!artifacts.length || artifacts.includes(node.source.artifact)) &&
      (!nodeIds.length || nodeIds.includes(node.id)) &&
      (!nodeTypes.length || nodeTypes.includes(node.type)) &&
      (!modules.length || moduleNodeIds.has(node.id) || moduleContainedIds.has(node.id)),
  );
  if (selectedNodes.length === 0) throw new TypeError("Task scope selects no facts");
  const maxInputNodes = requirePositiveInteger(input.maxInputNodes ?? 20_000, "inputPackage.maxInputNodes");
  if (maxInputNodes > 100_000) throw new RangeError("inputPackage.maxInputNodes must not exceed 100000");
  if (selectedNodes.length > maxInputNodes) throw new RangeError("Reverse input exceeds maxInputNodes");
  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
  const selectedEdges = allEdges
    .filter((edge) => selectedNodeIds.has(edge.subjectId) && selectedNodeIds.has(edge.objectId));
  const selectedFactIds = [
    ...new Set([...selectedNodes.map((node) => node.factId), ...selectedEdges.map((edge) => edge.id)]),
  ];
  const createdAt = input.createdAt ?? clock().toISOString();
  requireIsoTimestamp(createdAt, "inputPackage.createdAt");
  const content = {
    projectSnapshot: { projectId, snapshotManifestId, sourceComponentId },
    taskScope: { artifacts, nodeIds, nodeTypes, modules },
    policyContext: jsonValue(
      requireObject(input.policyContext ?? {}, "inputPackage.policyContext"),
      "inputPackage.policyContext",
    ),
    factBundles: input.factBundles.map((bundle) => ({
      id: bundle.id,
      extractor: bundle.extractor,
      sourceDigest: bundle.sourceDigest,
      complete: bundle.complete,
      diagnostics: bundle.diagnostics,
    })),
    facts: {
      nodes: selectedNodes,
      edges: selectedEdges,
    },
    allowedFactIds: selectedFactIds,
    contentTrust: "UNTRUSTED_SOURCE_CONTENT",
  };
  return deepFreeze({
    id: contentId("REVERSE-INPUT", content),
    digest: `sha256:${createHash("sha256").update(canonicalJson(content)).digest("hex")}`,
    ...content,
    createdAt,
  });
}

function evidenceRefs(value, fieldName, allowedFactIds) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${fieldName} must be a non-empty array`);
  const result = value.map((item, index) => {
    const evidence = requireObject(item, `${fieldName}[${index}]`);
    assertOnlyFields(evidence, ["factId", "relation"], `${fieldName}[${index}]`);
    const factId = requireNonEmptyString(evidence.factId, `${fieldName}[${index}].factId`);
    if (!allowedFactIds.has(factId)) throw new TypeError(`${fieldName}[${index}] references a fact outside the input package`);
    const relation = requireNonEmptyString(evidence.relation, `${fieldName}[${index}].relation`).toUpperCase();
    if (!evidenceRelations.has(relation)) throw new TypeError(`${fieldName}[${index}].relation is unsupported`);
    return { factId, relation };
  });
  return [...new Map(result.map((item) => [canonicalJson(item), item])).values()];
}

function constraint(value, fieldName) {
  if (value === null || value === undefined) return null;
  const candidate = requireObject(value, fieldName);
  assertOnlyFields(candidate, ["dimension", "operator", "value"], fieldName);
  return {
    dimension: requireNonEmptyString(candidate.dimension, `${fieldName}.dimension`),
    operator: assertEnum(ConstraintOperator, candidate.operator, `${fieldName}.operator`),
    value: jsonValue(candidate.value, `${fieldName}.value`),
  };
}

function producerRef(producer) {
  const value = requireObject(producer, "producer");
  return {
    skillId: requireNonEmptyString(value.skillId, "producer.skillId"),
    skillVersion: semver(value.skillVersion, "producer.skillVersion"),
    adapterId: requireNonEmptyString(value.adapterId, "producer.adapterId"),
    modelProfile: stringOrNull(value.modelProfile, "producer.modelProfile"),
    promptVersion: stringOrNull(value.promptVersion, "producer.promptVersion"),
  };
}

function candidateId(kind, producer, localId) {
  return contentId("CANDIDATE", { kind, producer, localId });
}

export function createReverseArtifactBundle(input, clock = () => new Date()) {
  const producer = producerRef(input.producer);
  const scope = requireObject(input.scope, "scope");
  const projectId = requireNonEmptyString(scope.projectId, "scope.projectId");
  const snapshotManifestId = requireNonEmptyString(scope.snapshotManifestId, "scope.snapshotManifestId");
  const sourceComponentId = requireNonEmptyString(scope.sourceComponentId, "scope.sourceComponentId");
  const inputDigest = sha256(input.inputDigest, "inputDigest");
  const allowedFactIds = input.allowedFactIds instanceof Set
    ? input.allowedFactIds
    : new Set(uniqueStrings(input.allowedFactIds, "allowedFactIds", { allowEmpty: true }));
  const rawOutput = jsonValue(requireObject(input.rawOutput, "rawOutput"), "rawOutput");
  assertOnlyFields(
    rawOutput,
    ["candidateFeatures", "candidateClaims", "candidateTestSpecs", "openQuestions", "warnings"],
    "rawOutput",
  );
  const maxRawOutputBytes = requirePositiveInteger(input.maxRawOutputBytes ?? 10_000_000, "maxRawOutputBytes");
  if (maxRawOutputBytes > 50_000_000) throw new RangeError("maxRawOutputBytes must not exceed 50000000");
  if (Buffer.byteLength(canonicalJson(rawOutput), "utf8") > maxRawOutputBytes) {
    throw new RangeError("Skill raw output exceeds maxRawOutputBytes");
  }
  const generatedAt = input.generatedAt ?? clock().toISOString();
  requireIsoTimestamp(generatedAt, "generatedAt");
  const seenLocalIds = new Set();
  const claimLocalIds = new Set();
  const normalizeLocalId = (value, fieldName) => {
    const localId = requireNonEmptyString(value, fieldName);
    if (seenLocalIds.has(localId)) throw new TypeError(`Skill output localId ${localId} is duplicated`);
    seenLocalIds.add(localId);
    return localId;
  };

  const candidateFeatures = (rawOutput.candidateFeatures ?? []).map((item, index) => {
    const value = requireObject(item, `rawOutput.candidateFeatures[${index}]`);
    assertOnlyFields(value, ["localId", "externalKey", "name", "description", "evidence"], `rawOutput.candidateFeatures[${index}]`);
    const localId = normalizeLocalId(value.localId, `rawOutput.candidateFeatures[${index}].localId`);
    return {
      id: candidateId("FEATURE", producer, localId),
      localId,
      externalKey: requireNonEmptyString(value.externalKey, `rawOutput.candidateFeatures[${index}].externalKey`),
      name: requireNonEmptyString(value.name, `rawOutput.candidateFeatures[${index}].name`),
      description: stringOrNull(value.description, `rawOutput.candidateFeatures[${index}].description`),
      evidence: evidenceRefs(value.evidence, `rawOutput.candidateFeatures[${index}].evidence`, allowedFactIds),
      producer,
    };
  });
  const candidateClaims = (rawOutput.candidateClaims ?? []).map((item, index) => {
    const value = requireObject(item, `rawOutput.candidateClaims[${index}]`);
    assertOnlyFields(
      value,
      ["localId", "type", "subjectKey", "statement", "confidence", "constraint", "scope", "evidence"],
      `rawOutput.candidateClaims[${index}]`,
    );
    const localId = normalizeLocalId(value.localId, `rawOutput.candidateClaims[${index}].localId`);
    claimLocalIds.add(localId);
    return {
      id: candidateId("CLAIM", producer, localId),
      localId,
      type: assertEnum(ClaimType, value.type, `rawOutput.candidateClaims[${index}].type`),
      subjectKey: requireNonEmptyString(value.subjectKey, `rawOutput.candidateClaims[${index}].subjectKey`),
      statement: requireNonEmptyString(value.statement, `rawOutput.candidateClaims[${index}].statement`),
      confidence: assertEnum(ReverseConfidence, value.confidence, `rawOutput.candidateClaims[${index}].confidence`),
      constraint: constraint(value.constraint, `rawOutput.candidateClaims[${index}].constraint`),
      scope: jsonValue(requireObject(value.scope ?? {}, `rawOutput.candidateClaims[${index}].scope`), `rawOutput.candidateClaims[${index}].scope`),
      evidence: evidenceRefs(value.evidence, `rawOutput.candidateClaims[${index}].evidence`, allowedFactIds),
      producer,
    };
  });
  const candidateTestSpecs = (rawOutput.candidateTestSpecs ?? []).map((item, index) => {
    const value = requireObject(item, `rawOutput.candidateTestSpecs[${index}]`);
    assertOnlyFields(
      value,
      ["localId", "name", "featureKey", "verifiesCandidateClaimIds", "specification", "evidence"],
      `rawOutput.candidateTestSpecs[${index}]`,
    );
    const localId = normalizeLocalId(value.localId, `rawOutput.candidateTestSpecs[${index}].localId`);
    return {
      id: candidateId("TEST_SPEC", producer, localId),
      localId,
      name: requireNonEmptyString(value.name, `rawOutput.candidateTestSpecs[${index}].name`),
      featureKey: requireNonEmptyString(value.featureKey, `rawOutput.candidateTestSpecs[${index}].featureKey`),
      verifiesCandidateClaimIds: uniqueStrings(
        value.verifiesCandidateClaimIds,
        `rawOutput.candidateTestSpecs[${index}].verifiesCandidateClaimIds`,
        { allowEmpty: true },
      ),
      specification: jsonValue(requireObject(value.specification, `rawOutput.candidateTestSpecs[${index}].specification`), `rawOutput.candidateTestSpecs[${index}].specification`),
      evidence: evidenceRefs(value.evidence, `rawOutput.candidateTestSpecs[${index}].evidence`, allowedFactIds),
      producer,
    };
  });
  const openQuestions = (rawOutput.openQuestions ?? []).map((item, index) => {
    const value = requireObject(item, `rawOutput.openQuestions[${index}]`);
    assertOnlyFields(value, ["localId", "question", "relatedLocalIds", "evidence"], `rawOutput.openQuestions[${index}]`);
    const localId = normalizeLocalId(value.localId, `rawOutput.openQuestions[${index}].localId`);
    return {
      id: candidateId("OPEN_QUESTION", producer, localId),
      localId,
      question: requireNonEmptyString(value.question, `rawOutput.openQuestions[${index}].question`),
      relatedLocalIds: uniqueStrings(
        value.relatedLocalIds ?? [],
        `rawOutput.openQuestions[${index}].relatedLocalIds`,
        { allowEmpty: true },
      ),
      evidence: value.evidence?.length
        ? evidenceRefs(value.evidence, `rawOutput.openQuestions[${index}].evidence`, allowedFactIds)
        : [],
      producer,
    };
  });
  for (const item of candidateTestSpecs) {
    for (const claimLocalId of item.verifiesCandidateClaimIds) {
      if (!claimLocalIds.has(claimLocalId)) {
        throw new TypeError(`Candidate TestSpec references unknown Claim localId ${claimLocalId}`);
      }
    }
  }
  for (const item of openQuestions) {
    for (const relatedLocalId of item.relatedLocalIds) {
      if (!seenLocalIds.has(relatedLocalId)) {
        throw new TypeError(`Open question references unknown localId ${relatedLocalId}`);
      }
    }
  }
  const candidateCount = candidateFeatures.length + candidateClaims.length + candidateTestSpecs.length + openQuestions.length;
  if (candidateCount === 0) {
    throw new TypeError("Skill output must contain at least one structured candidate or open question");
  }
  const maxOutputCandidates = requirePositiveInteger(input.maxOutputCandidates ?? 500, "maxOutputCandidates");
  if (candidateCount > maxOutputCandidates) throw new RangeError("Skill output exceeds maxOutputCandidates");
  const warnings = uniqueStrings(rawOutput.warnings ?? [], "rawOutput.warnings", { allowEmpty: true });
  const rawOutputHash = `sha256:${createHash("sha256").update(canonicalJson(rawOutput)).digest("hex")}`;

  return deepFreeze({
    id: contentId("REVERSE-ARTIFACT-BUNDLE", {
      runId: input.runId,
      producer,
      inputDigest,
      rawOutputHash,
      generatedAt,
    }),
    apiVersion: "quality.traqen/v1alpha1",
    kind: "ReverseArtifactBundle",
    runId: requireNonEmptyString(input.runId, "runId"),
    producer,
    scope: {
      projectId,
      snapshotManifestId,
      sourceComponentId,
      taskScope: jsonValue(requireObject(scope.taskScope ?? {}, "scope.taskScope"), "scope.taskScope"),
    },
    inputDigest,
    rawOutputHash,
    candidateFeatures,
    candidateClaims,
    candidateTestSpecs,
    openQuestions,
    warnings,
    generatedAt,
  });
}

function scopeOverlaps(left, right) {
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) continue;
    const leftValue = left[key];
    const rightValue = right[key];
    if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
      if (!leftValue.some((value) => rightValue.some((candidate) => canonicalJson(candidate) === canonicalJson(value)))) {
        return false;
      }
    } else if (canonicalJson(leftValue) !== canonicalJson(rightValue)) {
      return false;
    }
  }
  return true;
}

function constraintsConflict(left, right) {
  if (!left || !right || left.dimension !== right.dimension) return false;
  const sameValue = canonicalJson(left.value) === canonicalJson(right.value);
  if (left.operator === "EQUALS" && right.operator === "EQUALS") return !sameValue;
  if (new Set([left.operator, right.operator]).size === 2 &&
      [left.operator, right.operator].every((operator) => ["EQUALS", "NOT_EQUALS"].includes(operator))) {
    return sameValue;
  }
  if ([left.operator, right.operator].every((operator) => ["ALLOWS", "FORBIDS"].includes(operator))) {
    return left.operator !== right.operator && sameValue;
  }
  if (left.operator === "IN" && right.operator === "IN" && Array.isArray(left.value) && Array.isArray(right.value)) {
    return !left.value.some((value) => right.value.some((candidate) => canonicalJson(candidate) === canonicalJson(value)));
  }
  return false;
}

function mergeEvidence(items) {
  return [...new Map(items.flatMap((item) => item.evidence).map((item) => [canonicalJson(item), item])).values()];
}

export function mergeReverseArtifactBundles(input, clock = () => new Date()) {
  const runId = requireNonEmptyString(input?.runId, "runId");
  if (!Array.isArray(input?.bundles) || input.bundles.length < 1) {
    throw new TypeError("bundles must be a non-empty array");
  }
  const [first] = input.bundles;
  for (const bundle of input.bundles) {
    if (bundle.runId !== runId || canonicalJson(bundle.scope) !== canonicalJson(first.scope)) {
      throw new TypeError("All ReverseArtifactBundles must belong to the same run and scope");
    }
  }
  const mergedAt = input.mergedAt ?? clock().toISOString();
  requireIsoTimestamp(mergedAt, "mergedAt");

  const featuresByKey = new Map();
  for (const feature of input.bundles.flatMap((bundle) => bundle.candidateFeatures)) {
    const current = featuresByKey.get(feature.externalKey) ?? [];
    current.push(feature);
    featuresByKey.set(feature.externalKey, current);
  }
  const candidateFeatures = [...featuresByKey.entries()].map(([externalKey, items]) => ({
    id: contentId("MERGED-CANDIDATE-FEATURE", { runId, externalKey }),
    externalKey,
    name: items[0].name,
    descriptions: [...new Set(items.map((item) => item.description).filter(Boolean))],
    evidence: mergeEvidence(items),
    sources: items.map((item) => ({ candidateId: item.id, producer: item.producer })),
  }));

  const claimGroups = new Map();
  const allClaims = input.bundles.flatMap((bundle) => bundle.candidateClaims);
  for (const claim of allClaims) {
    const identity = canonicalJson({
      type: claim.type,
      subjectKey: claim.subjectKey,
      constraint: claim.constraint,
      scope: claim.scope,
      unstructuredStatement: claim.constraint ? null : claim.statement.trim().toLowerCase(),
    });
    const current = claimGroups.get(identity) ?? [];
    current.push(claim);
    claimGroups.set(identity, current);
  }
  const candidateClaims = [...claimGroups.entries()].map(([identity, items]) => ({
    id: contentId("MERGED-CANDIDATE-CLAIM", { runId, identity }),
    type: items[0].type,
    subjectKey: items[0].subjectKey,
    statements: [...new Set(items.map((item) => item.statement))],
    confidence: items.some((item) => item.confidence === "HIGH")
      ? "HIGH"
      : items.some((item) => item.confidence === "MEDIUM")
        ? "MEDIUM"
        : "LOW",
    constraint: items[0].constraint,
    scope: items[0].scope,
    evidence: mergeEvidence(items),
    sources: items.map((item) => ({ candidateId: item.id, producer: item.producer })),
  }));

  const duplicateClaimIds = new Map();
  for (const merged of candidateClaims) {
    for (const source of merged.sources) duplicateClaimIds.set(source.candidateId, merged.id);
  }
  const conflicts = [];
  for (let leftIndex = 0; leftIndex < allClaims.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < allClaims.length; rightIndex += 1) {
      const left = allClaims[leftIndex];
      const right = allClaims[rightIndex];
      if (duplicateClaimIds.get(left.id) === duplicateClaimIds.get(right.id)) continue;
      if (left.subjectKey !== right.subjectKey || left.type !== right.type) continue;
      if (!scopeOverlaps(left.scope, right.scope) || !constraintsConflict(left.constraint, right.constraint)) continue;
      const candidateIds = [duplicateClaimIds.get(left.id), duplicateClaimIds.get(right.id)].sort();
      const conflictId = contentId("CONFLICT", { runId, candidateIds });
      if (conflicts.some((conflict) => conflict.id === conflictId)) continue;
      conflicts.push({
        id: conflictId,
        type: "CLAIM_CONTRADICTION",
        status: "OPEN",
        candidateIds,
        reason: `Conflicting ${left.constraint.dimension} constraints overlap in scope`,
        evidence: mergeEvidence([left, right]),
        detectedAt: mergedAt,
      });
    }
  }

  const questionGroups = new Map();
  for (const question of input.bundles.flatMap((bundle) => bundle.openQuestions)) {
    const identity = question.question.trim().toLowerCase();
    const current = questionGroups.get(identity) ?? [];
    current.push(question);
    questionGroups.set(identity, current);
  }
  const openQuestions = [...questionGroups.entries()].map(([identity, items]) => ({
    id: contentId("OPEN-QUESTION", { runId, identity }),
    question: items[0].question,
    evidence: mergeEvidence(items),
    sources: items.map((item) => ({ candidateId: item.id, producer: item.producer })),
  }));

  return deepFreeze({
    id: contentId("REVERSE-MERGE", {
      runId,
      bundleIds: input.bundles.map((bundle) => bundle.id).sort(),
      mergedAt,
    }),
    runId,
    scope: first.scope,
    candidateFeatures,
    candidateClaims,
    candidateTestSpecs: input.bundles.flatMap((bundle) => bundle.candidateTestSpecs),
    openQuestions,
    conflicts,
    warnings: [...new Set(input.bundles.flatMap((bundle) => bundle.warnings))],
    sourceBundleIds: input.bundles.map((bundle) => bundle.id),
    mergedAt,
  });
}
