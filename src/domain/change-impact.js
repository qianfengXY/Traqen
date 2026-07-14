import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import {
  ChangeType,
  requireIsoTimestamp,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";
import { invalidationFor } from "./invalidation.js";

function semanticNode(node) {
  const {
    factId: _factId,
    snapshotManifestId: _snapshotManifestId,
    observedAt: _observedAt,
    validFrom: _validFrom,
    validTo: _validTo,
    bundleId: _bundleId,
    ...semantic
  } = node;
  return semantic;
}

function semanticEdge(edge) {
  const {
    id: _id,
    snapshotManifestId: _snapshotManifestId,
    observedAt: _observedAt,
    bundleId: _bundleId,
    ...semantic
  } = edge;
  return semantic;
}

function nodeKey(node) {
  return canonicalJson({
    stableId: node.id,
    extractorId: node.extractor?.id ?? null,
  });
}

function edgeKey(edge) {
  return canonicalJson({
    subjectId: edge.subjectId,
    predicate: edge.predicate,
    objectId: edge.objectId,
    extractorId: edge.extractor?.id ?? null,
  });
}

function changeTypeForNode(node) {
  const mappings = {
    ENDPOINT: ChangeType.API_CONTRACT,
    CONFIGURATION: ChangeType.CONFIGURATION,
    EXTERNAL_DEPENDENCY: ChangeType.DEPENDENCY,
    TEST_ASSET: ChangeType.TEST_SPEC,
  };
  if (node.type === "DATA_OBJECT") {
    return ["table", "column", "schema", "constraint", "view"].includes(
      String(node.attributes?.kind ?? "").toLowerCase(),
    )
      ? ChangeType.DATABASE_SCHEMA
      : ChangeType.SQL;
  }
  return mappings[node.type] ?? ChangeType.SOURCE_CODE;
}

function changeTypeForEdge(edge) {
  if (["READS", "WRITES"].includes(edge.predicate)) return ChangeType.SQL;
  if (edge.predicate === "CONTROLLED_BY") return ChangeType.CONFIGURATION;
  if (edge.predicate === "DEPENDS_ON") return ChangeType.DEPENDENCY;
  if (edge.predicate === "EXERCISES") return ChangeType.TEST_SPEC;
  return ChangeType.SOURCE_CODE;
}

function changeRecord({ kind, entityType, stableId, before = null, after = null, changeType }) {
  const artifact = after?.source?.artifact ?? before?.source?.artifact ?? null;
  const identity = { kind, entityType, stableId, beforeFactId: before?.factId ?? before?.id ?? null, afterFactId: after?.factId ?? after?.id ?? null };
  return {
    id: contentId("FACT-CHANGE", identity),
    ...identity,
    changeType,
    artifact,
    nodeType: after?.type ?? before?.type ?? null,
    predicate: after?.predicate ?? before?.predicate ?? null,
  };
}

const recommendedActionByLayer = Object.freeze({
  IMPLEMENTATION_MAPPING: "REMAP_IMPLEMENTATION_FACTS",
  CONFORMANCE: "RECOMPUTE_IMPLEMENTATION_CONFORMANCE",
  TEST_COVERAGE: "REVIEW_TEST_COVERAGE",
  VERIFICATION: "RERUN_AFFECTED_TESTS",
  TRACE_CHAIN: "RECOMPUTE_TRACE_CHAIN",
  CLAIM_SCOPE_MATCH: "REVIEW_CLAIM_SCOPE",
  TEST_APPROVAL: "REAPPROVE_TEST_SPEC",
  EVIDENCE_FRESHNESS: "REFRESH_EXECUTION_EVIDENCE",
  CONFLICT_STATUS: "REVIEW_EVIDENCE_CONFLICT",
});

export function compareFactGraphs(fromGraph, toGraph) {
  const fromNodes = new Map((fromGraph?.nodes ?? []).map((node) => [nodeKey(node), node]));
  const toNodes = new Map((toGraph?.nodes ?? []).map((node) => [nodeKey(node), node]));
  const fromEdges = new Map((fromGraph?.edges ?? []).map((edge) => [edgeKey(edge), edge]));
  const toEdges = new Map((toGraph?.edges ?? []).map((edge) => [edgeKey(edge), edge]));
  const changes = [];

  for (const producerKey of new Set([...fromNodes.keys(), ...toNodes.keys()])) {
    const before = fromNodes.get(producerKey) ?? null;
    const after = toNodes.get(producerKey) ?? null;
    const stableId = after?.id ?? before?.id;
    if (!before) {
      changes.push(changeRecord({ kind: "ADDED", entityType: "NODE", stableId, after, changeType: changeTypeForNode(after) }));
    } else if (!after) {
      changes.push(changeRecord({ kind: "REMOVED", entityType: "NODE", stableId, before, changeType: changeTypeForNode(before) }));
    } else if (canonicalJson(semanticNode(before)) !== canonicalJson(semanticNode(after))) {
      changes.push(changeRecord({ kind: "MODIFIED", entityType: "NODE", stableId, before, after, changeType: changeTypeForNode(after) }));
    }
  }
  for (const stableId of new Set([...fromEdges.keys(), ...toEdges.keys()])) {
    const before = fromEdges.get(stableId) ?? null;
    const after = toEdges.get(stableId) ?? null;
    if (!before) {
      changes.push(changeRecord({ kind: "ADDED", entityType: "EDGE", stableId, after, changeType: changeTypeForEdge(after) }));
    } else if (!after) {
      changes.push(changeRecord({ kind: "REMOVED", entityType: "EDGE", stableId, before, changeType: changeTypeForEdge(before) }));
    } else if (canonicalJson(semanticEdge(before)) !== canonicalJson(semanticEdge(after))) {
      changes.push(changeRecord({ kind: "MODIFIED", entityType: "EDGE", stableId, before, after, changeType: changeTypeForEdge(after) }));
    }
  }
  return deepFreeze(changes.sort((left, right) => left.entityType.localeCompare(right.entityType) || left.stableId.localeCompare(right.stableId)));
}

export function createChangeSet(input, clock = () => new Date()) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("changeSet must be an object");
  }
  const createdAt = input?.createdAt ?? clock().toISOString();
  requireIsoTimestamp(createdAt, "changeSet.createdAt");
  const fromSnapshotManifestId = requireNonEmptyString(
    input.fromSnapshotManifestId,
    "changeSet.fromSnapshotManifestId",
  );
  const toSnapshotManifestId = requireNonEmptyString(
    input.toSnapshotManifestId,
    "changeSet.toSnapshotManifestId",
  );
  if (fromSnapshotManifestId === toSnapshotManifestId) {
    throw new TypeError("changeSet Snapshot Manifest ids must differ");
  }
  if (!Array.isArray(input.warnings ?? [])) throw new TypeError("changeSet.warnings must be an array");
  if (!Array.isArray(input?.changes)) throw new TypeError("changeSet.changes must be an array");
  const warnings = (input.warnings ?? []).map((warning, index) =>
    requireNonEmptyString(warning, `changeSet.warnings[${index}]`));
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "changeSet.id"),
    fromSnapshotManifestId,
    toSnapshotManifestId,
    complete: input?.complete === true,
    warnings: [...new Set(warnings)],
    changes: structuredClone(input.changes),
    createdAt,
  });
}

export function createImpactAssessment(input, clock = () => new Date()) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("impactAssessment must be an object");
  }
  const createdAt = input?.createdAt ?? clock().toISOString();
  requireIsoTimestamp(createdAt, "impactAssessment.createdAt");
  if (input.changeSet === null || typeof input.changeSet !== "object" || Array.isArray(input.changeSet)) {
    throw new TypeError("impactAssessment.changeSet must be an object");
  }
  if (!Array.isArray(input?.affectedMappings)) throw new TypeError("impactAssessment.affectedMappings must be an array");
  if (!Array.isArray(input?.continuities ?? [])) throw new TypeError("impactAssessment.continuities must be an array");
  const invalidations = input.affectedMappings.map((mapping, index) => {
    const prefix = `impactAssessment.affectedMappings[${index}]`;
    const featureId = requireNonEmptyString(mapping?.featureId, `${prefix}.featureId`);
    const claimId = requireNonEmptyString(mapping?.claimId, `${prefix}.claimId`);
    const claimVersion = requirePositiveInteger(mapping?.claimVersion, `${prefix}.claimVersion`);
    const scopeId = requireNonEmptyString(mapping?.scopeId, `${prefix}.scopeId`);
    const scopeVersion = requirePositiveInteger(mapping?.scopeVersion, `${prefix}.scopeVersion`);
    const mappingId = requireNonEmptyString(mapping?.id, `${prefix}.id`);
    if (!Array.isArray(mapping.changeIds) || mapping.changeIds.length === 0) {
      throw new TypeError(`${prefix}.changeIds must be a non-empty array`);
    }
    const changeIds = [...new Set(mapping.changeIds.map((changeId, changeIndex) =>
      requireNonEmptyString(changeId, `${prefix}.changeIds[${changeIndex}]`)))];
    const relevantChanges = input.changeSet.changes.filter((change) => changeIds.includes(change.id));
    if (relevantChanges.length !== changeIds.length) {
      throw new TypeError(`${prefix}.changeIds must reference changes in the ChangeSet`);
    }
    const invalidationRules = relevantChanges.map((change) => invalidationFor({ type: change.changeType }));
    const layers = [...new Set(invalidationRules.flatMap((rule) => rule.invalidates))];
    const preserves = [...new Set(invalidationRules.flatMap((rule) => rule.preserves))];
    const recommendedActions = [...new Set(
      layers.map((layer) => recommendedActionByLayer[layer]).filter(Boolean),
    )];
    const testSpecIds = (mapping.testSpecIds ?? []).map((testSpecId, testSpecIndex) =>
      requireNonEmptyString(testSpecId, `${prefix}.testSpecIds[${testSpecIndex}]`));
    return {
      id: contentId("TRACE-INVALIDATION", {
        changeSetId: input.changeSet.id,
        mappingId,
        claimId,
        claimVersion,
      }),
      featureId,
      claimId,
      claimVersion,
      scopeId,
      scopeVersion,
      mappingId,
      testSpecIds: [...new Set(testSpecIds)],
      changeIds,
      layers,
      preserves,
      reason: "Mapped deterministic implementation facts changed between Snapshot Manifests.",
      recommendedActions,
    };
  });
  return deepFreeze({
    id: contentId("IMPACT-ASSESSMENT", { changeSetId: input.changeSet.id }),
    changeSetId: input.changeSet.id,
    fromSnapshotManifestId: input.changeSet.fromSnapshotManifestId,
    toSnapshotManifestId: input.changeSet.toSnapshotManifestId,
    invalidations,
    continuities: structuredClone(input.continuities ?? []),
    affectedFeatureIds: [...new Set(invalidations.map((item) => item.featureId))],
    affectedClaimRefs: [...new Map(invalidations.map((item) => [
      `${item.claimId}\u0000${item.claimVersion}`,
      { id: item.claimId, version: item.claimVersion },
    ])).values()],
    affectedTestSpecIds: [...new Set(invalidations.flatMap((item) => item.testSpecIds))],
    continuedFeatureIds: [...new Set((input.continuities ?? []).map((item) => item.featureId))],
    createdAt,
  });
}

export function createImplementationContinuity(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("implementationContinuity must be an object");
  }
  const featureId = requireNonEmptyString(input.featureId, "implementationContinuity.featureId");
  const claimId = requireNonEmptyString(input.claimId, "implementationContinuity.claimId");
  const claimVersion = requirePositiveInteger(input.claimVersion, "implementationContinuity.claimVersion");
  const scopeId = requireNonEmptyString(input.scopeId, "implementationContinuity.scopeId");
  const scopeVersion = requirePositiveInteger(input.scopeVersion, "implementationContinuity.scopeVersion");
  const fromMappingId = requireNonEmptyString(input.fromMappingId, "implementationContinuity.fromMappingId");
  const toMappingId = requireNonEmptyString(input.toMappingId, "implementationContinuity.toMappingId");
  const fromConformanceId = requireNonEmptyString(
    input.fromConformanceId,
    "implementationContinuity.fromConformanceId",
  );
  const toConformanceId = requireNonEmptyString(input.toConformanceId, "implementationContinuity.toConformanceId");
  if (!Array.isArray(input.factRefRebindings) || input.factRefRebindings.length === 0) {
    throw new TypeError("implementationContinuity.factRefRebindings must be a non-empty array");
  }
  const factRefRebindings = input.factRefRebindings.map((item, index) => ({
    fromFactId: requireNonEmptyString(
      item?.fromFactId,
      `implementationContinuity.factRefRebindings[${index}].fromFactId`,
    ),
    toFactId: requireNonEmptyString(
      item?.toFactId,
      `implementationContinuity.factRefRebindings[${index}].toFactId`,
    ),
    relation: requireNonEmptyString(
      item?.relation,
      `implementationContinuity.factRefRebindings[${index}].relation`,
    ),
  }));
  const identity = {
    changeSetId: requireNonEmptyString(input.changeSetId, "implementationContinuity.changeSetId"),
    fromMappingId,
    toMappingId,
  };
  return deepFreeze({
    id: contentId("IMPLEMENTATION-CONTINUITY", identity),
    ...identity,
    featureId,
    claimId,
    claimVersion,
    scopeId,
    scopeVersion,
    fromSnapshotManifestId: requireNonEmptyString(
      input.fromSnapshotManifestId,
      "implementationContinuity.fromSnapshotManifestId",
    ),
    toSnapshotManifestId: requireNonEmptyString(
      input.toSnapshotManifestId,
      "implementationContinuity.toSnapshotManifestId",
    ),
    fromConformanceId,
    toConformanceId,
    factRefRebindings,
    reason: "All mapped facts remained semantically identical and were rebound to the new Snapshot Manifest.",
  });
}
