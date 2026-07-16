import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import {
  FactNodeType,
  FactPredicate,
  assertEnum,
  requireIsoTimestamp,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";

function requireObject(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return structuredClone(value);
}

function sourceLocation(value, fieldName) {
  const source = requireObject(value, fieldName);
  const startLine = requirePositiveInteger(source.startLine, `${fieldName}.startLine`);
  const endLine = requirePositiveInteger(source.endLine, `${fieldName}.endLine`);
  if (startLine > endLine) throw new RangeError(`${fieldName}.startLine must not exceed endLine`);
  const contentHash = requireNonEmptyString(source.contentHash, `${fieldName}.contentHash`);
  if (!/^sha256:[a-f0-9]{64}$/.test(contentHash)) {
    throw new TypeError(`${fieldName}.contentHash must be a SHA-256 digest`);
  }
  return {
    artifact: requireNonEmptyString(source.artifact, `${fieldName}.artifact`),
    startLine,
    endLine,
    contentHash,
  };
}

function extractor(value) {
  return {
    id: requireNonEmptyString(value?.id, "extractor.id"),
    version: requireNonEmptyString(value?.version, "extractor.version"),
  };
}

export function stableFactNodeId(projectId, type, naturalKey) {
  return contentId("FACT-NODE", {
    projectId: requireNonEmptyString(projectId, "projectId"),
    type: assertEnum(FactNodeType, type, "fact.type"),
    naturalKey: requireNonEmptyString(naturalKey, "fact.naturalKey"),
  });
}

export function createFactNode(input) {
  const projectId = requireNonEmptyString(input?.projectId, "fact.projectId");
  const snapshotManifestId = requireNonEmptyString(input?.snapshotManifestId, "fact.snapshotManifestId");
  const type = assertEnum(FactNodeType, input?.type, "fact.type");
  const naturalKey = requireNonEmptyString(input?.naturalKey, "fact.naturalKey");
  const observedAt = requireNonEmptyString(input?.observedAt, "fact.observedAt");
  requireIsoTimestamp(observedAt, "fact.observedAt");
  const nodeId = stableFactNodeId(projectId, type, naturalKey);
  const name = requireNonEmptyString(input?.name, "fact.name");
  const attributes = requireObject(input?.attributes ?? {}, "fact.attributes");
  const factSource = sourceLocation(input?.source, "fact.source");
  const factExtractor = extractor(input?.extractor);
  const validFrom = input?.validFrom ?? observedAt;
  const validTo = input?.validTo ?? null;
  requireIsoTimestamp(validFrom, "fact.validFrom");
  if (validTo !== null) {
    requireIsoTimestamp(validTo, "fact.validTo");
    if (Date.parse(validFrom) > Date.parse(validTo)) {
      throw new RangeError("fact.validFrom must not exceed validTo");
    }
  }
  const node = {
    id: nodeId,
    factId: contentId("FACT", {
      snapshotManifestId,
      nodeId,
      name,
      attributes,
      source: factSource,
      extractor: factExtractor,
      observedAt,
      validFrom,
      validTo,
    }),
    projectId,
    snapshotManifestId,
    type,
    naturalKey,
    name,
    attributes,
    source: factSource,
    extractor: factExtractor,
    observedAt,
    validFrom,
    validTo,
  };
  return deepFreeze(node);
}

export function createFactEdge(input) {
  const projectId = requireNonEmptyString(input?.projectId, "edge.projectId");
  const snapshotManifestId = requireNonEmptyString(input?.snapshotManifestId, "edge.snapshotManifestId");
  const subjectId = requireNonEmptyString(input?.subjectId, "edge.subjectId");
  const objectId = requireNonEmptyString(input?.objectId, "edge.objectId");
  if (subjectId === objectId) throw new TypeError("edge subject and object must differ");
  const predicate = assertEnum(FactPredicate, input?.predicate, "edge.predicate");
  const observedAt = requireNonEmptyString(input?.observedAt, "edge.observedAt");
  requireIsoTimestamp(observedAt, "edge.observedAt");
  const attributes = requireObject(input?.attributes ?? {}, "edge.attributes");
  const edgeSource = sourceLocation(input?.source, "edge.source");
  const edgeExtractor = extractor(input?.extractor);
  return deepFreeze({
    id: contentId("FACT-EDGE", {
      projectId,
      snapshotManifestId,
      subjectId,
      predicate,
      objectId,
      attributes,
      source: edgeSource,
      extractor: edgeExtractor,
      observedAt,
    }),
    projectId,
    snapshotManifestId,
    subjectId,
    predicate,
    objectId,
    attributes,
    source: edgeSource,
    extractor: edgeExtractor,
    observedAt,
  });
}

export function createFactBundle(input) {
  const projectId = requireNonEmptyString(input?.projectId, "bundle.projectId");
  const snapshotManifestId = requireNonEmptyString(input?.snapshotManifestId, "bundle.snapshotManifestId");
  const sourceComponentId = requireNonEmptyString(input?.sourceComponentId, "bundle.sourceComponentId");
  const bundleExtractor = extractor(input?.extractor);
  const observedAt = requireNonEmptyString(input?.observedAt, "bundle.observedAt");
  requireIsoTimestamp(observedAt, "bundle.observedAt");
  if (!Array.isArray(input?.nodes) || !Array.isArray(input?.edges) || !Array.isArray(input?.diagnostics ?? [])) {
    throw new TypeError("bundle nodes, edges, and diagnostics must be arrays");
  }
  const nodes = input.nodes
    .map((node) => createFactNode({
      ...node,
      projectId,
      snapshotManifestId,
      extractor: node.extractor ?? bundleExtractor,
      observedAt: node.observedAt ?? observedAt,
    }))
    .sort((left, right) => left.factId.localeCompare(right.factId));
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new TypeError("bundle node ids must be unique");
  const edges = input.edges
    .map((edge) => createFactEdge({
      ...edge,
      projectId,
      snapshotManifestId,
      extractor: edge.extractor ?? bundleExtractor,
      observedAt: edge.observedAt ?? observedAt,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) {
    throw new TypeError("bundle edge ids must be unique");
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.subjectId) || !nodeIds.has(edge.objectId)) {
      throw new TypeError(`edge ${edge.id} references a node outside the bundle`);
    }
  }
  const diagnostics = (input.diagnostics ?? []).map((item, index) => {
    const diagnostic = requireObject(item, `bundle.diagnostics[${index}]`);
    if (!["INFO", "WARNING", "ERROR"].includes(diagnostic.severity)) {
      throw new TypeError(`bundle.diagnostics[${index}].severity must be INFO, WARNING, or ERROR`);
    }
    return {
      severity: diagnostic.severity,
      artifact: requireNonEmptyString(diagnostic.artifact, `bundle.diagnostics[${index}].artifact`),
      message: requireNonEmptyString(diagnostic.message, `bundle.diagnostics[${index}].message`),
    };
  });
  const sourceDigest = requireNonEmptyString(input?.sourceDigest, "bundle.sourceDigest");
  if (!/^sha256:[a-f0-9]{64}$/.test(sourceDigest)) {
    throw new TypeError("bundle.sourceDigest must be a SHA-256 digest");
  }
  const complete = input?.complete === true && !diagnostics.some((item) => item.severity === "ERROR");
  return deepFreeze({
    id: contentId("FACT-BUNDLE", {
      projectId,
      snapshotManifestId,
      sourceComponentId,
      sourceDigest,
      extractor: bundleExtractor,
      observedAt,
      nodeFactIds: nodes.map((node) => node.factId).sort(),
      edgeIds: edges.map((edge) => edge.id).sort(),
    }),
    projectId,
    snapshotManifestId,
    sourceComponentId,
    sourceDigest,
    extractor: bundleExtractor,
    observedAt,
    complete,
    diagnostics,
    nodes,
    edges,
  });
}

export function factBundleSigningPayload(bundle) {
  return canonicalJson({ kind: "FACT_BUNDLE", bundle });
}

export function signFactBundle(bundle, secret) {
  requireNonEmptyString(secret, "scanner secret");
  const signature = createHmac("sha256", secret).update(factBundleSigningPayload(bundle)).digest("hex");
  return deepFreeze({
    ...structuredClone(bundle),
    attestation: {
      algorithm: "HMAC-SHA256",
      extractorId: bundle.extractor.id,
      signature,
    },
  });
}

export function verifyFactBundleAttestation(bundle, secret) {
  if (typeof secret !== "string" || secret === "") return false;
  if (bundle?.attestation?.algorithm !== "HMAC-SHA256") return false;
  if (bundle.attestation.extractorId !== bundle.extractor?.id) return false;
  if (typeof bundle.attestation.signature !== "string" || !/^[a-f0-9]{64}$/.test(bundle.attestation.signature)) {
    return false;
  }
  const unsigned = { ...bundle };
  delete unsigned.attestation;
  const expected = createHmac("sha256", secret).update(factBundleSigningPayload(unsigned)).digest();
  const actual = Buffer.from(bundle.attestation.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
