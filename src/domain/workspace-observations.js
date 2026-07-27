import { createHash } from "node:crypto";

import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import { createFactBundle, factBundleSigningPayload } from "./facts.js";
import { createSnapshotManifest } from "./snapshot-manifest.js";

const requestFields = new Set(["projectId", "workspaceName", "rootName", "observedAt", "records"]);
const recordFields = new Set(["path", "size", "contentFingerprint", "supported", "candidates", "configuration", "test"]);
const candidateFields = new Set([
  "localCandidateId",
  "kind",
  "name",
  "method",
  "modulePath",
  "sourcePath",
  "startLine",
  "description",
]);
const configurationFields = new Set(["path", "key", "value"]);
const testFields = new Set(["path", "title"]);
const candidateKinds = new Set(["ENDPOINT", "CODE_SYMBOL", "COMMAND"]);
const secretPattern = /(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)/i;

function object(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function exactFields(value, allowed, fieldName) {
  const unsupported = Object.keys(value).filter((field) => !allowed.has(field)).sort();
  if (unsupported.length > 0) throw new TypeError(`${fieldName} has unsupported fields: ${unsupported.join(", ")}`);
}

function string(value, fieldName, maximumLength = 1_000) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${fieldName} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > maximumLength) throw new RangeError(`${fieldName} exceeds ${maximumLength} characters`);
  return normalized;
}

function optionalString(value, fieldName, maximumLength = 1_000) {
  if (value === null || value === undefined) return null;
  return string(value, fieldName, maximumLength);
}

function integer(value, fieldName, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${fieldName} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function path(value, fieldName) {
  const normalized = string(value, fieldName, 800).replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${fieldName} must be a relative path without traversal`);
  }
  return normalized;
}

function timestamp(value, fieldName) {
  const normalized = string(value, fieldName, 80);
  if (Number.isNaN(Date.parse(normalized))) throw new TypeError(`${fieldName} must be an ISO timestamp`);
  return normalized;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function source(artifact, startLine, observation) {
  return {
    artifact,
    startLine,
    endLine: startLine,
    contentHash: sha256(canonicalJson(observation)),
  };
}

function normalizedCandidate(value, recordPath, index) {
  const candidate = object(value, `candidate ${index}`);
  exactFields(candidate, candidateFields, "candidate");
  const sourcePath = path(candidate.sourcePath, `candidate ${index}.sourcePath`);
  if (sourcePath !== recordPath) throw new TypeError("candidate sourcePath must equal its record path");
  const kind = string(candidate.kind, `candidate ${index}.kind`, 40);
  if (!candidateKinds.has(kind)) throw new TypeError(`candidate ${index}.kind is not supported`);
  return {
    localCandidateId: string(candidate.localCandidateId, `candidate ${index}.localCandidateId`, 200),
    kind,
    name: string(candidate.name, `candidate ${index}.name`, 300),
    method: optionalString(candidate.method, `candidate ${index}.method`, 20),
    modulePath: string(candidate.modulePath, `candidate ${index}.modulePath`, 300),
    sourcePath,
    startLine: integer(candidate.startLine, `candidate ${index}.startLine`, 1),
    description: string(candidate.description, `candidate ${index}.description`, 1_200),
  };
}

function normalizedConfiguration(value, index) {
  if (value === null || value === undefined) return null;
  const configuration = object(value, `records[${index}].configuration`);
  exactFields(configuration, configurationFields, `records[${index}].configuration`);
  const result = {
    path: path(configuration.path, `records[${index}].configuration.path`),
    key: string(configuration.key, `records[${index}].configuration.key`, 200),
    value: string(configuration.value, `records[${index}].configuration.value`, 500),
  };
  const sensitiveLines = result.value.split(/\r?\n/).filter((line) => secretPattern.test(line));
  if (sensitiveLines.some((line) => !/<redacted>/i.test(line))) {
    throw new TypeError("secret-like configuration values must be redacted");
  }
  return result;
}

function normalizedTest(value, index) {
  if (value === null || value === undefined) return null;
  const test = object(value, `records[${index}].test`);
  exactFields(test, testFields, `records[${index}].test`);
  return {
    path: path(test.path, `records[${index}].test.path`),
    title: string(test.title, `records[${index}].test.title`, 300),
  };
}

function normalizedInput(input) {
  const request = object(input, "workspace observations");
  exactFields(request, requestFields, "workspace observations");
  if (!Array.isArray(request.records) || request.records.length === 0) {
    throw new TypeError("workspace observations.records must be a non-empty array");
  }
  if (request.records.length > 100_000) throw new RangeError("workspace observations.records exceeds 100000 items");
  const records = request.records.map((value, index) => {
    const record = object(value, `records[${index}]`);
    exactFields(record, recordFields, `records[${index}]`);
    const recordPath = path(record.path, `records[${index}].path`);
    if (typeof record.supported !== "boolean") throw new TypeError(`records[${index}].supported must be a boolean`);
    if (!Array.isArray(record.candidates)) throw new TypeError(`records[${index}].candidates must be an array`);
    if (record.candidates.length > 5_000) throw new RangeError(`records[${index}].candidates exceeds 5000 items`);
    return {
      path: recordPath,
      size: integer(record.size, `records[${index}].size`),
      contentFingerprint: string(record.contentFingerprint, `records[${index}].contentFingerprint`, 200),
      supported: record.supported,
      candidates: record.candidates.map((candidate, candidateIndex) =>
        normalizedCandidate(candidate, recordPath, candidateIndex)),
      configuration: normalizedConfiguration(record.configuration, index),
      test: normalizedTest(record.test, index),
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const candidateIds = records.flatMap((record) => record.candidates.map((candidate) => candidate.localCandidateId));
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new TypeError("workspace observations candidate localCandidateId values must be unique");
  }
  return {
    projectId: string(request.projectId, "workspace observations.projectId", 200),
    workspaceName: string(request.workspaceName, "workspace observations.workspaceName", 200),
    rootName: string(request.rootName, "workspace observations.rootName", 300),
    observedAt: timestamp(request.observedAt, "workspace observations.observedAt"),
    records,
  };
}

export function createWorkspaceObservationPackage(input, clock = () => new Date()) {
  const normalized = normalizedInput(input);
  const sourceDigest = sha256(canonicalJson({
    rootName: normalized.rootName,
    records: normalized.records,
  }));
  const sourceComponentId = contentId("SOURCE-COMPONENT", {
    projectId: normalized.projectId,
    rootName: normalized.rootName,
    sourceDigest,
  });
  const snapshotManifest = createSnapshotManifest({
    source: { id: sourceComponentId, digest: sourceDigest },
    failedSources: ["build", "deployment", "runtime"],
    observedFrom: normalized.observedAt,
    observedTo: normalized.observedAt,
  }, clock);
  const nodes = [];
  const pendingEdges = [];
  const candidateIndexes = [];
  for (const record of normalized.records) {
    if (!record.supported) continue;
    const artifactInput = {
      type: "ARTIFACT",
      naturalKey: `artifact:${record.path}`,
      name: record.path,
      attributes: {
        workspaceName: normalized.workspaceName,
        rootName: normalized.rootName,
        size: record.size,
      },
      source: source(record.path, 1, record),
    };
    nodes.push(artifactInput);
    const childInputs = [];
    for (const candidate of record.candidates) {
      const type = candidate.kind === "ENDPOINT" ? "ENDPOINT" : "CODE_SYMBOL";
      const candidateInput = {
        type,
        naturalKey: `${candidate.kind.toLowerCase()}:${candidate.localCandidateId}`,
        name: candidate.name,
        attributes: {
          localCandidateId: candidate.localCandidateId,
          kind: candidate.kind === "COMMAND" ? "command" : candidate.kind.toLowerCase(),
          method: candidate.method,
          path: candidate.kind === "ENDPOINT"
            ? candidate.name.replace(/^[A-Z]+\s+/, "")
            : null,
          modulePath: candidate.modulePath,
          description: candidate.description,
        },
        source: source(candidate.sourcePath, candidate.startLine, candidate),
      };
      nodes.push(candidateInput);
      childInputs.push({ kind: "candidate", localCandidateId: candidate.localCandidateId, input: candidateInput });
    }
    if (record.configuration) {
      const configurationInput = {
        type: "CONFIGURATION",
        naturalKey: `configuration:${record.configuration.path}:${record.configuration.key}`,
        name: record.configuration.key,
        attributes: { value: record.configuration.value },
        source: source(record.configuration.path, 1, record.configuration),
      };
      nodes.push(configurationInput);
      childInputs.push({ kind: "configuration", input: configurationInput });
    }
    if (record.test) {
      const testInput = {
        type: "TEST_ASSET",
        naturalKey: `test:${record.test.path}:${record.test.title}`,
        name: record.test.title,
        attributes: {},
        source: source(record.test.path, 1, record.test),
      };
      nodes.push(testInput);
      childInputs.push({ kind: "test", input: testInput });
    }
    pendingEdges.push({ artifactInput, childInputs });
  }
  const extractor = { id: "browser-workspace-observation", version: "1.0.0" };
  const provisional = createFactBundle({
    projectId: normalized.projectId,
    snapshotManifestId: snapshotManifest.id,
    sourceComponentId,
    sourceDigest,
    extractor,
    observedAt: normalized.observedAt,
    complete: true,
    diagnostics: normalized.records
      .filter((record) => !record.supported)
      .map((record) => ({
        severity: "WARNING",
        artifact: record.path,
        message: "The browser scanner did not support this file.",
      })),
    nodes,
    edges: [],
  });
  const factsByNaturalKey = new Map(provisional.nodes.map((node) => [node.naturalKey, node]));
  const edges = pendingEdges.flatMap(({ artifactInput, childInputs }) => {
    const artifact = factsByNaturalKey.get(artifactInput.naturalKey);
    return childInputs.map((child) => {
      const fact = factsByNaturalKey.get(child.input.naturalKey);
      if (child.kind === "candidate") {
        candidateIndexes.push({
          localCandidateId: child.localCandidateId,
          stableNodeId: fact.id,
          factId: fact.factId,
        });
      }
      return {
        subjectId: artifact.id,
        predicate: "CONTAINS",
        objectId: fact.id,
        attributes: {},
        source: fact.source,
      };
    });
  });
  const unsignedFactBundle = createFactBundle({
    ...provisional,
    nodes: provisional.nodes,
    edges,
  });
  const factBundle = deepFreeze({
    ...unsignedFactBundle,
    attestation: {
      algorithm: "SERVER-NORMALIZED-SHA256",
      extractorId: extractor.id,
      signature: createHash("sha256").update(factBundleSigningPayload(unsignedFactBundle)).digest("hex"),
    },
  });
  const receipt = deepFreeze({
    projectId: normalized.projectId,
    snapshotManifestId: snapshotManifest.id,
    sourceComponentId,
    factBundleId: factBundle.id,
    candidateFacts: candidateIndexes.sort((left, right) => left.localCandidateId.localeCompare(right.localCandidateId)),
  });
  return deepFreeze({ snapshotManifest, factBundle, receipt });
}
