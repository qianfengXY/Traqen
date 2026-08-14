import {
  createClaim,
  createClaimScope,
  createBusinessProcessModel,
  createDecisionReviewCase,
  createDecisionReviewEvent,
  createReverseRunJob,
  createReverseRunJobEvent,
  createEvidenceRetentionPolicy,
  createEvidenceLifecycleEvent,
  createChangeSet,
  createContinuousProtectionAssessment,
  createProductEffectivenessMetrics,
  createPlatformOperationsMetrics,
  createDecision,
  createExecutionEvidenceBundle,
  createFactBundle,
  createImplementationConformance,
  createImplementationContinuity,
  createImplementationMapping,
  createImpactAssessment,
  createProjectFoundation,
  createReverseCandidateReview,
  createReverseInputPackage,
  createReverseSkillManifest,
  createReverseSkillRegistration,
  createFeatureVersion,
  createFeatureAlias,
  createFeatureLineage,
  createFeatureGraphProjection,
  createSnapshotManifest,
  createWorkspaceObservationPackage,
  createSourceSliceRequest,
  createTestSpec,
  generateEndpointTestSpecDraft,
  evaluateTraceChain,
  evaluateDecisionReviewCase,
  projectReverseRunJob,
  evaluateEvidenceLifecycle,
  queryFeatureGraphPath as resolveFeatureGraphPath,
  assertTestSpecSafeToStore,
  validateTestSpec as validateTestSpecProtocol,
  verifyExecutionEvidenceAttestation,
  verifyFactBundleAttestation,
  verifyReverseSkillManifestAttestation,
  assessImplementationConformance,
  listBusinessProcessFactRefs,
  compareFactGraphs,
  CandidateReviewOutcome,
  canonicalJson,
  ConformanceStatus,
  contentId,
  deepFreeze,
  EvidenceSupport,
  FactNodeType,
  FactPredicate,
  assertEnum,
} from "../domain/index.js";
import {
  PersistenceConflictError,
  ReviewAuthenticationError,
  ReviewAuthorizationError,
  RunnerAttestationError,
  ScannerAttestationError,
  SkillAttestationError,
} from "../storage/index.js";
import { WorkspaceProductFoundation } from "./workspace-product-foundation.js";
import {
  SourceSliceWorkerAuthenticationError,
  SourceSliceWorkerAuthorizationError,
} from "./source-slice-worker-credential.js";

function requireId(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function modelIdsFromDraftInput(input) {
  const slots = [input?.mainAgentSlot ?? input?.mainAgent, ...(input?.childAgentSlots ?? input?.childSlots ?? [])];
  return slots.map((slot) => slot?.modelProfileId ?? slot?.model).filter((value) => typeof value === "string" && value.trim() !== "");
}

function replacementChangesIdentity(changes) {
  return changes.map(({ workspaceId, expectedDraftVersion, expectedProfileVersion, draft, profile }) => ({
    workspaceId,
    expectedDraftVersion,
    expectedProfileVersion,
    draftId: draft?.id ?? null,
    profileId: profile?.id ?? null,
  })).sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
}

function graphEvidenceResolver(projectId, revisionId, kind, id, { featureId, rootNodeId, snapshotManifestId }) {
  const query = new URLSearchParams({ featureId, rootNodeId, snapshotManifestId });
  return `/v1/projects/${encodeURIComponent(projectId)}/graph/revisions/${encodeURIComponent(revisionId)}/evidence/${kind}s/${encodeURIComponent(id)}?${query}`;
}

function selectedGraphObject(node, featureId) {
  return deepFreeze({
    id: node.id,
    type: node.type,
    label: node.label,
    authority: node.provenance,
    status: node.status,
    source: node.source,
    details: node.details,
    ownerFeatureId: featureId,
  });
}

function graphArtifactSchemaVersion(artifact) {
  if (Number.isSafeInteger(artifact?.artifactSchemaVersion)) return artifact.artifactSchemaVersion;
  return Array.isArray(artifact?.featureTraceability) ? 2 : 1;
}

function explicitLegacyFeatureOwners(value) {
  return new Set([
    value?.ownerFeatureId,
    value?.featureId,
    value?.details?.ownerFeatureId,
    value?.details?.featureId,
  ].filter((candidate) => typeof candidate === "string" && candidate.trim() !== ""));
}

function legacyArtifactFeatureOwnership(artifact) {
  const nodes = new Map((artifact.nodes ?? []).map((node) => [node.id, node]));
  const featureIds = new Set([...nodes.values()]
    .filter(({ type }) => type === "FEATURE")
    .map(({ id }) => id));
  const adjacency = new Map();
  for (const edge of artifact.edges ?? []) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }
  const structuralOwners = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const featureId of featureIds) {
    const visited = new Set([featureId]);
    const pending = [featureId];
    structuralOwners.get(featureId).add(featureId);
    while (pending.length > 0) {
      const current = pending.shift();
      for (const related of adjacency.get(current) ?? []) {
        if (visited.has(related)) continue;
        const relatedNode = nodes.get(related);
        if (relatedNode?.type === "FEATURE" && related !== featureId) continue;
        visited.add(related);
        structuralOwners.get(related)?.add(featureId);
        pending.push(related);
      }
    }
  }
  const owners = new Map([...nodes].map(([id, node]) => {
    const explicit = explicitLegacyFeatureOwners(node);
    return [id, explicit.size > 0 ? explicit : structuralOwners.get(id) ?? new Set()];
  }));
  return { nodes, featureIds, owners };
}

function legacySelectedObjectOwnership(artifact, featureId, selectedObjectId) {
  const ownership = legacyArtifactFeatureOwnership(artifact);
  if (!ownership.featureIds.has(featureId)) {
    return {
      ...ownership,
      verified: false,
      reasonCode: "REQUESTED_FEATURE_NOT_PRESENT_IN_IMMUTABLE_ARTIFACT",
    };
  }
  if (!ownership.nodes.has(selectedObjectId)) {
    return {
      ...ownership,
      verified: false,
      reasonCode: "SELECTED_OBJECT_NOT_PRESENT_IN_IMMUTABLE_ARTIFACT",
    };
  }
  const selectedOwners = ownership.owners.get(selectedObjectId) ?? new Set();
  if (selectedOwners.size !== 1 || !selectedOwners.has(featureId)) {
    return {
      ...ownership,
      verified: false,
      reasonCode: "SELECTED_OBJECT_FEATURE_OWNERSHIP_NOT_PROVABLE",
    };
  }
  return { ...ownership, verified: true, reasonCode: null };
}

function legacyEdgeOwnedByFeature(edge, featureId, ownership) {
  const explicitOwners = explicitLegacyFeatureOwners(edge);
  if (explicitOwners.size > 0) return explicitOwners.size === 1 && explicitOwners.has(featureId);
  const sourceOwners = ownership.owners.get(edge.source) ?? new Set();
  const targetOwners = ownership.owners.get(edge.target) ?? new Set();
  return sourceOwners.size === 1 && sourceOwners.has(featureId)
    && targetOwners.size === 1 && targetOwners.has(featureId);
}

function historicalTraceabilityAvailability(
  projectId,
  { revision, artifact },
  featureId,
  selectedObjectId,
  recoveryDescriptor,
) {
  const ownership = legacySelectedObjectOwnership(artifact, featureId, selectedObjectId);
  const selectedNode = ownership.verified ? ownership.nodes.get(selectedObjectId) : null;
  const selection = selectedNode ? {
    id: selectedNode.id,
    type: selectedNode.type,
    label: selectedNode.label ?? selectedNode.id,
    authority: selectedNode.authority ?? "UNKNOWN",
    status: "UNAVAILABLE_REQUIRES_REANALYSIS",
    source: selectedNode.source ?? null,
    details: structuredClone(selectedNode),
    ownerFeatureId: featureId,
  } : {
    id: selectedObjectId,
    type: selectedObjectId === featureId ? "FEATURE" : "UNKNOWN",
    label: selectedObjectId,
    authority: "UNKNOWN",
    status: "UNAVAILABLE_REQUIRES_REANALYSIS",
    source: null,
    details: {},
    ownerFeatureId: featureId,
  };
  const reasonCode = ownership.reasonCode ?? "IMMUTABLE_TRACEABILITY_SNAPSHOT_NOT_CAPTURED";
  const messages = {
    IMMUTABLE_TRACEABILITY_SNAPSHOT_NOT_CAPTURED: "This published legacy GraphArtifact predates immutable Feature traceability snapshots. Current governed data was not substituted for missing history.",
    REQUESTED_FEATURE_NOT_PRESENT_IN_IMMUTABLE_ARTIFACT: "The requested Feature is not represented by the selected immutable legacy GraphArtifact. Evidence from another Feature was not substituted.",
    SELECTED_OBJECT_NOT_PRESENT_IN_IMMUTABLE_ARTIFACT: "The selected object is not present in the immutable legacy GraphArtifact. Current or unrelated evidence was not substituted.",
    SELECTED_OBJECT_FEATURE_OWNERSHIP_NOT_PROVABLE: "The selected object's ownership by the requested Feature cannot be proven from immutable legacy content. The evidence scope was denied.",
  };
  const historicalAvailability = {
    status: "UNAVAILABLE_REQUIRES_REANALYSIS",
    reasonCode,
    message: messages[reasonCode],
    artifactSchemaVersion: graphArtifactSchemaVersion(artifact),
    featureId,
    selectedObjectId,
    snapshotManifestId: revision.snapshotManifestId,
    graphRevisionId: revision.id,
    graphArtifactId: revision.graphArtifactId,
    graphArtifactDigest: revision.graphArtifactDigest,
    recovery: recoveryDescriptor.executable ? {
      ...structuredClone(recoveryDescriptor),
      action: "REANALYZE_FROM_REVISION_SNAPSHOT",
      method: "POST",
      endpoint: `/v1/projects/${encodeURIComponent(projectId)}/graph/revisions/${encodeURIComponent(revision.id)}/reanalysis-jobs`,
    } : {
      ...structuredClone(recoveryDescriptor),
      action: "HISTORICAL_REANALYSIS_UNAVAILABLE",
    },
    currentContext: {
      action: "VIEW_CURRENT_PUBLISHED_HEAD",
      method: "GET",
      endpoint: `/v1/projects/${encodeURIComponent(projectId)}/graph/current`,
    },
  };
  return deepFreeze({
    historicalAvailability,
    selection,
    snapshotManifestId: revision.snapshotManifestId,
    graphRevisionId: revision.id,
  });
}

function projectLegacyArtifactGraph(projectId, graphContext, featureId, options, recoveryDescriptor) {
  const { revision, artifact } = graphContext;
  const rootNodeId = options.rootNodeId ?? featureId;
  const depth = options.depth ?? 1;
  const limit = options.limit ?? 30;
  const view = options.view ?? "traceability";
  const viewTypes = {
    traceability: null,
    business: new Set(["FEATURE", "CLAIM", "CLAIM_SCOPE", "DECISION", "ACTOR_ROLE", "BUSINESS_STATE", "STATE_TRANSITION", "DESIGN_ELEMENT", "CONFLICT", "TRACE_GAP"]),
    implementation: new Set(["FEATURE", "CLAIM", "IMPLEMENTATION_CONFORMANCE", "ENDPOINT", "CODE_SYMBOL", "DATA_OBJECT", "CONFIGURATION", "EXTERNAL_DEPENDENCY", "CONFLICT", "TRACE_GAP"]),
    coverage: new Set(["FEATURE", "CLAIM", "TEST_SPEC", "TEST_ASSERTION", "TEST_EXECUTION", "EVIDENCE", "CONFLICT", "TRACE_GAP"]),
  };
  if (!Object.hasOwn(viewTypes, view)) throw new TypeError("view must be one of traceability, business, implementation, coverage");
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 8) throw new RangeError("depth must be an integer between 1 and 8");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("limit must be an integer between 1 and 100");
  const ownership = legacySelectedObjectOwnership(artifact, featureId, rootNodeId);
  const availability = historicalTraceabilityAvailability(
    projectId,
    graphContext,
    featureId,
    rootNodeId,
    recoveryDescriptor,
  );
  if (!ownership.verified) {
    return deepFreeze({
      center: rootNodeId,
      snapshotManifestId: revision.snapshotManifestId,
      view,
      depth,
      nodes: [],
      edges: [],
      truncated: false,
      availableExpansions: [],
      historicalAvailability: availability.historicalAvailability,
    });
  }
  const requestedNodeTypes = new Set(options.nodeTypes ?? []);
  const sourceNodes = new Map([...ownership.nodes].filter(([id, node]) => {
    const owners = ownership.owners.get(id) ?? new Set();
    const owned = owners.size === 1 && owners.has(featureId);
    return owned && (id === rootNodeId || (
      (viewTypes[view] === null || viewTypes[view].has(node.type))
      && (requestedNodeTypes.size === 0 || requestedNodeTypes.has(node.type))
    ));
  }));
  const requestedRelations = new Set(options.relations ?? []);
  const sourceEdges = (artifact.edges ?? []).filter((edge) =>
    sourceNodes.has(edge.source)
    && sourceNodes.has(edge.target)
    && legacyEdgeOwnedByFeature(edge, featureId, ownership)
    && (requestedRelations.size === 0 || requestedRelations.has(edge.type)));
  const adjacency = new Map();
  for (const edge of sourceEdges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }
  const distances = new Map([[rootNodeId, 0]]);
  const pending = [rootNodeId];
  while (pending.length > 0) {
    const current = pending.shift();
    const currentDepth = distances.get(current);
    if (currentDepth >= depth) continue;
    for (const related of adjacency.get(current) ?? []) {
      if (distances.has(related)) continue;
      distances.set(related, currentDepth + 1);
      pending.push(related);
    }
  }
  const orderedIds = [...distances]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
  const selectedIds = new Set(orderedIds.slice(0, limit).map(([id]) => id));
  const nodes = [...selectedIds].map((id) => {
    const node = sourceNodes.get(id);
    return {
      id: node.id,
      type: node.type,
      label: node.label ?? node.id,
      version: node.version ?? null,
      status: node.status ?? (node.authority === "CANDIDATE" ? "PENDING" : node.authority === "GAP" ? "GAP" : "ACTIVE"),
      risk: node.risk ?? null,
      provenance: node.authority ?? "LEGACY_GRAPH_ARTIFACT",
      source: node.source ?? null,
      details: structuredClone(node),
    };
  });
  const edges = sourceEdges.filter(({ source, target }) => selectedIds.has(source) && selectedIds.has(target)).map((edge) => ({
    ...structuredClone(edge),
    provenance: edge.authority ?? "LEGACY_GRAPH_ARTIFACT",
    status: edge.status ?? (edge.authority === "CANDIDATE" ? "PENDING" : "ACTIVE"),
    snapshotManifestId: revision.snapshotManifestId,
  }));
  const expansionCounts = new Map();
  for (const edge of sourceEdges) {
    const sourceVisible = selectedIds.has(edge.source);
    const targetVisible = selectedIds.has(edge.target);
    if (sourceVisible === targetVisible) continue;
    const hidden = sourceNodes.get(sourceVisible ? edge.target : edge.source);
    const key = `${edge.type}\u0000${hidden?.type ?? "UNKNOWN"}`;
    expansionCounts.set(key, (expansionCounts.get(key) ?? 0) + 1);
  }
  const availableExpansions = [...expansionCounts].map(([key, count]) => {
    const [relation, nodeType] = key.split("\u0000");
    return { relation, nodeType, count };
  });
  return deepFreeze({
    center: rootNodeId,
    snapshotManifestId: revision.snapshotManifestId,
    view,
    depth,
    nodes,
    edges,
    truncated: selectedIds.size < sourceNodes.size || orderedIds.length > limit,
    availableExpansions,
    historicalAvailability: availability.historicalAvailability,
  });
}

function traceabilityEvidenceObjects(traceability) {
  const objects = [];
  const add = (objectType, value, executionId = null) => {
    if (value?.id) objects.push({ objectType, value, executionId });
  };
  for (const claimView of traceability.claims ?? []) {
    add("REQUIREMENT", claimView.claim);
    for (const decision of claimView.decisionHistory ?? []) add("DECISION", decision);
    add("DECISION", claimView.latestDecision);
    for (const mapping of claimView.implementationMappings ?? []) add("IMPLEMENTATION_MAPPING", mapping);
    for (const fact of claimView.facts?.nodes ?? []) add(fact.type ?? "IMPLEMENTATION", fact);
    for (const testSpec of claimView.testSpecs ?? []) add("TEST_SPEC", testSpec);
    add("TEST_EXECUTION", claimView.execution);
    for (const attempt of claimView.execution?.attempts ?? []) {
      for (const result of attempt.assertionResults ?? []) add("VERIFICATION_RESULT", result, claimView.execution.id);
    }
    for (const evidence of claimView.evidence ?? []) add("EVIDENCE", evidence, claimView.execution?.id ?? null);
  }
  for (const design of traceability.processModel?.designElements ?? []) add("DESIGN", design);
  for (const factGraph of traceability.processImplementationFacts ?? []) {
    for (const fact of factGraph.nodes ?? []) add(fact.type ?? "IMPLEMENTATION", fact);
  }
  return objects;
}

function validateFeatureUnderstandingHistory(value) {
  if (!value?.feature || typeof value.feature !== "object") {
    throw new TypeError("FeatureUnderstandingHistory.feature is required");
  }
  for (const field of [
    "featureVersions",
    "decisions",
    "implementationMappings",
    "graphRevisions",
    "testSpecs",
    "testExecutions",
  ]) {
    if (!Array.isArray(value[field])) throw new TypeError(`FeatureUnderstandingHistory.${field} must be an array`);
  }
  if (value.featureVersions.length < 1) {
    throw new TypeError("FeatureUnderstandingHistory.featureVersions must contain the current FeatureVersion");
  }
  return deepFreeze(value);
}

function assertOnlyFields(value, allowedFields, fieldName) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.includes(field)) throw new TypeError(`${fieldName}.${field} is not supported`);
  }
}

function introducesFeatureLineageCycle(lineages, predecessorFeatureId, successorFeatureId) {
  const adjacency = new Map();
  for (const lineage of lineages) {
    const successors = adjacency.get(lineage.predecessorFeatureId) ?? [];
    successors.push(lineage.successorFeatureId);
    adjacency.set(lineage.predecessorFeatureId, successors);
  }
  const pending = [successorFeatureId];
  const visited = new Set();
  while (pending.length > 0) {
    const featureId = pending.pop();
    if (featureId === predecessorFeatureId) return true;
    if (visited.has(featureId)) continue;
    visited.add(featureId);
    pending.push(...(adjacency.get(featureId) ?? []));
  }
  return false;
}

function currentReference(value, currentId) {
  return value === undefined || value === "__CURRENT__" ? currentId : value;
}

function authorityFromDecision(decision, now = new Date()) {
  const mapping = {
    CONFIRMED: "CONFIRMED",
    EXCEPTION_RECORDED: "EXCEPTION_RECORDED",
    REJECTED: "REJECTED",
    DEPRECATED: "DEPRECATED",
    INSUFFICIENT_EVIDENCE: "UNREVIEWED",
    DEFERRED: "UNREVIEWED",
  };
  if (decision?.validUntil && Date.parse(decision.validUntil) <= now.getTime()) return "DEPRECATED";
  return decision ? mapping[decision.type] ?? "UNREVIEWED" : "UNREVIEWED";
}

function implementationFromFacts(facts) {
  const mapping = {
    ENDPOINT: "endpoints",
    CODE_SYMBOL: "codeSymbols",
    DATA_OBJECT: "dataObjects",
    CONFIGURATION: "configurations",
    EXTERNAL_DEPENDENCY: "dependencies",
  };
  const result = {
    endpoints: [],
    codeSymbols: [],
    dataObjects: [],
    configurations: [],
    dependencies: [],
  };
  for (const node of facts.nodes) {
    const collection = mapping[node.type];
    if (collection) result[collection].push(node);
  }
  return result;
}

function graphEntityIndexes(graph) {
  const byFactId = new Map();
  const byStableProducer = new Map();
  for (const node of graph.nodes) {
    const stableProducer = canonicalJson({
      entityType: "NODE",
      stableId: node.id,
      extractorId: node.extractor?.id ?? null,
    });
    byFactId.set(node.factId, stableProducer);
    byStableProducer.set(stableProducer, { factId: node.factId, entity: node });
  }
  for (const edge of graph.edges) {
    const stableProducer = canonicalJson({
      entityType: "EDGE",
      subjectId: edge.subjectId,
      predicate: edge.predicate,
      objectId: edge.objectId,
      extractorId: edge.extractor?.id ?? null,
    });
    byFactId.set(edge.id, stableProducer);
    byStableProducer.set(stableProducer, { factId: edge.id, entity: edge });
  }
  return { byFactId, byStableProducer };
}

export class TraceabilityApplication {
  #store;
  #clock;
  #runnerKeyResolver;
  #scannerKeyResolver;
  #publisherKeyResolver;
  #installedSkillResolver;
  #skillPolicyResolver;
  #reverseOrchestrator;
  #reviewerResolver;
  #reviewPolicyResolver;
  #implementationReviewerResolver;
  #implementationPolicyResolver;
  #continuousProtectionPolicyResolver;
  #productMetricsPolicyResolver;
  #analysisAgent;
  #analysisModelRegistry;
  #sourceSliceBroker;
  #legacyUnderstandingRuntime;
  #sourceSliceWorkerCredentialService;
  #workspaceFoundation;
  #reverseJobControllers = new Map();
  #analysisControllers = new Map();

  constructor({
    store,
    clock = () => new Date(),
    runnerKeyResolver = () => null,
    scannerKeyResolver = () => null,
    publisherKeyResolver = () => null,
    installedSkillResolver = () => null,
    skillPolicyResolver = () => ({}),
    reverseOrchestrator = null,
    reviewerResolver = () => null,
    reviewPolicyResolver = () => ({ allowedRoles: [], allowedOutcomes: [] }),
    implementationReviewerResolver = () => null,
    implementationPolicyResolver = () => ({ allowedRoles: [] }),
    continuousProtectionPolicyResolver = () => ({ mode: "ADVISORY" }),
    productMetricsPolicyResolver = () => ({}),
    analysisAgent = null,
    analysisModelRegistry = null,
    sourceSliceBroker = null,
    legacyUnderstandingRuntime = null,
    sourceSliceWorkerCredentialService = null,
    workspaceFoundation = null,
  }) {
    if (!store) throw new TypeError("store is required");
    if (typeof runnerKeyResolver !== "function") throw new TypeError("runnerKeyResolver must be a function");
    if (typeof scannerKeyResolver !== "function") throw new TypeError("scannerKeyResolver must be a function");
    if (typeof publisherKeyResolver !== "function") throw new TypeError("publisherKeyResolver must be a function");
    if (typeof installedSkillResolver !== "function") throw new TypeError("installedSkillResolver must be a function");
    if (typeof skillPolicyResolver !== "function") throw new TypeError("skillPolicyResolver must be a function");
    if (typeof reviewerResolver !== "function") throw new TypeError("reviewerResolver must be a function");
    if (typeof reviewPolicyResolver !== "function") throw new TypeError("reviewPolicyResolver must be a function");
    if (typeof implementationReviewerResolver !== "function") {
      throw new TypeError("implementationReviewerResolver must be a function");
    }
    if (typeof implementationPolicyResolver !== "function") {
      throw new TypeError("implementationPolicyResolver must be a function");
    }
    if (typeof continuousProtectionPolicyResolver !== "function") {
      throw new TypeError("continuousProtectionPolicyResolver must be a function");
    }
    if (typeof productMetricsPolicyResolver !== "function") {
      throw new TypeError("productMetricsPolicyResolver must be a function");
    }
    this.#store = store;
    this.#clock = clock;
    this.#runnerKeyResolver = runnerKeyResolver;
    this.#scannerKeyResolver = scannerKeyResolver;
    this.#publisherKeyResolver = publisherKeyResolver;
    this.#installedSkillResolver = installedSkillResolver;
    this.#skillPolicyResolver = skillPolicyResolver;
    this.#reverseOrchestrator = reverseOrchestrator;
    this.#reviewerResolver = reviewerResolver;
    this.#reviewPolicyResolver = reviewPolicyResolver;
    this.#implementationReviewerResolver = implementationReviewerResolver;
    this.#implementationPolicyResolver = implementationPolicyResolver;
    this.#continuousProtectionPolicyResolver = continuousProtectionPolicyResolver;
    this.#productMetricsPolicyResolver = productMetricsPolicyResolver;
    this.#analysisAgent = analysisAgent;
    this.#analysisModelRegistry = analysisModelRegistry;
    this.#sourceSliceBroker = sourceSliceBroker;
    this.#legacyUnderstandingRuntime = legacyUnderstandingRuntime;
    this.#sourceSliceWorkerCredentialService = sourceSliceWorkerCredentialService;
    this.#workspaceFoundation = workspaceFoundation ?? new WorkspaceProductFoundation({ store, clock });
  }

  async createProject(input) {
    const foundation = createProjectFoundation(input);
    const stored = await this.#store.appendProjectFoundation(foundation);
    await this.#workspaceFoundation.recordWorkspaceCreated(foundation.project.id, input.actorId ?? "SYSTEM");
    return stored;
  }

  async getProject(projectId) {
    requireId(projectId, "projectId");
    return this.#store.getProjectFoundation(projectId);
  }

  async listWorkspaces(userId = null, options = {}) {
    return this.#workspaceFoundation.listWorkspaces(userId, options);
  }

  async getWorkspace(workspaceId, userId = null) {
    requireId(workspaceId, "workspaceId");
    return this.#workspaceFoundation.getWorkspace(workspaceId, userId);
  }

  async renameWorkspace(workspaceId, name, actorId) {
    return this.#workspaceFoundation.transitionWorkspace(workspaceId, "WORKSPACE_RENAMED", actorId, { name });
  }

  async requestWorkspaceDeletion(workspaceId, actorId) {
    return this.#workspaceFoundation.transitionWorkspace(workspaceId, "DELETION_REQUESTED", actorId);
  }

  async cancelWorkspaceDeletion(workspaceId, actorId) {
    return this.#workspaceFoundation.transitionWorkspace(workspaceId, "DELETION_CANCELLED", actorId);
  }

  async completeWorkspaceDeletion(workspaceId, actorId) {
    return this.#workspaceFoundation.transitionWorkspace(workspaceId, "DELETION_COMPLETED", actorId);
  }

  async setWorkspaceVisibility(workspaceId, userId, hidden) {
    return this.#workspaceFoundation.setWorkspaceVisibility(workspaceId, userId, hidden);
  }

  async registerCapabilityTemplate(input) {
    return this.#workspaceFoundation.registerCapabilityTemplate(input);
  }

  async listCapabilityTemplates() {
    return this.#workspaceFoundation.listCapabilityTemplates();
  }

  #globalModelProfiles() {
    if (!this.#analysisModelRegistry) return [];
    return this.#analysisModelRegistry.list().map((profile) => ({
      id: profile.currentRevisionId,
      profileId: profile.id,
      currentRevisionId: profile.currentRevisionId,
      revision: profile.revision,
      displayName: profile.displayName ?? profile.id,
      transport: profile.transport ?? 'API',
      providerAdapter: profile.providerAdapter ?? 'OPENAI_COMPATIBLE',
      endpoint: profile.endpoint,
      model: profile.model,
      cliAdapter: profile.cliAdapter,
      executablePath: profile.executablePath,
      credentialHandleId: profile.credentialHandleId,
      readiness: profile.ready ? 'READY' : 'UNVERIFIED',
      lifecycle: profile.lifecycle ?? 'ACTIVE',
      configuredAt: profile.configuredAt,
      verifiedAt: profile.verifiedAt,
    }));
  }

  listGlobalModelProfiles() {
    return this.#globalModelProfiles();
  }

  getGlobalModelProfile(profileId) {
    requireId(profileId, "profileId");
    return this.#globalModelProfiles().find((profile) => profile.profileId === profileId) ?? null;
  }

  configureGlobalModelProfile(input) {
    const profileId = input.profileId ?? input.id;
    requireId(profileId, "profileId");
    this.configureAnalysisModelProfile({ ...input, id: profileId });
    return this.getGlobalModelProfile(profileId);
  }

  updateGlobalModelProfile(profileId, input) {
    requireId(profileId, "profileId");
    const current = this.getGlobalModelProfile(profileId);
    if (!current) return null;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("global model revision input must be an object");
    assertOnlyFields(input, [
      "id", "profileId", "displayName", "transport", "providerAdapter", "endpoint", "model", "apiKey",
      "cliAdapter", "executablePath", "timeoutMs", "stream", "maximumOutputBytes", "expectedRevision",
    ], "globalModelRevision");
    if (input?.profileId !== undefined && input.profileId !== profileId) throw new TypeError("profileId must match the route modelId");
    if (input?.id !== undefined && input.id !== profileId) throw new TypeError("id must match the route modelId");
    if (!Number.isInteger(input?.expectedRevision) || input.expectedRevision < 1) throw new TypeError("expectedRevision is required");
    if (input.expectedRevision !== current.revision) {
      throw new TypeError(`Global model revision conflict: expected ${input.expectedRevision}, current ${current.revision}`);
    }
    return this.configureGlobalModelProfile({ ...input, id: profileId, profileId });
  }

  verifyGlobalModelProfile(profileId) {
    return this.verifyAnalysisModelProfile(profileId);
  }

  getGlobalModelUsage(profileId) {
    return this.#workspaceFoundation.modelUsage(profileId);
  }

  async createGlobalModelReplacementPlan(profileId, input) {
    if (!this.#analysisModelRegistry) throw new TypeError("Analysis model registry is not configured");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("model replacement plan input must be an object");
    assertOnlyFields(input, ["replacementProfileId"], "modelReplacementPlan");
    const replacementProfileId = requireId(input?.replacementProfileId, "replacementProfileId");
    const usage = await this.getGlobalModelUsage(profileId);
    const changes = await this.#workspaceFoundation.prepareModelReplacement(profileId, replacementProfileId, this.#globalModelProfiles());
    const plan = this.#analysisModelRegistry.createReplacementPlan({
      sourceProfileId: profileId,
      replacementProfileId,
      references: usage.references,
      changes,
    });
    return this.#workspaceFoundation.createModelReplacementPlan(plan);
  }

  async applyGlobalModelReplacementPlan(profileId, planId, input) {
    if (!this.#analysisModelRegistry) throw new TypeError("Analysis model registry is not configured");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("model replacement apply input must be an object");
    assertOnlyFields(input, ["expectedVersion"], "modelReplacementApply");
    const plan = await this.#workspaceFoundation.getModelReplacementPlan(planId);
    if (!plan || plan.sourceProfileId !== profileId) return null;
    const begun = this.#analysisModelRegistry.beginReplacementPlan(plan, input?.expectedVersion);
    if (begun.status === "APPLIED") {
      return this.#workspaceFoundation.applyModelReplacementPlan(planId, input?.expectedVersion);
    }
    try {
      const currentChanges = await this.#workspaceFoundation.prepareModelReplacement(
        profileId,
        plan.replacementProfileId,
        this.#globalModelProfiles(),
      );
      if (canonicalJson(replacementChangesIdentity(currentChanges)) !== canonicalJson(replacementChangesIdentity(plan.changes))) {
        throw new TypeError(`Replacement plan ${plan.id} is stale; refresh the Workspace usage preview`);
      }
      const applied = await this.#workspaceFoundation.applyModelReplacementPlan(planId, input?.expectedVersion);
      this.#analysisModelRegistry.completeReplacementPlan(applied.plan);
      return Object.freeze(applied);
    } catch (error) {
      this.#analysisModelRegistry.abortReplacementPlan(plan);
      throw error;
    }
  }

  async retireGlobalModelProfile(profileId) {
    const usage = await this.getGlobalModelUsage(profileId);
    if (usage.references.some(({ source }) => source !== 'ACTIVE_RUN')) {
      throw new TypeError(`Model ${profileId} still has current Workspace references; replace them before retirement`);
    }
    const current = this.#analysisModelRegistry?.list().find(({ id }) => id === profileId);
    return this.removeAnalysisModelProfile(profileId, { finalize: current?.lifecycle === 'RETIRING' && usage.references.length === 0 });
  }

  async listWorkspaceProjectCapabilities(workspaceId) {
    return this.#workspaceFoundation.listProjectCapabilities(workspaceId);
  }

  async saveWorkspaceProjectCapability(workspaceId, input) {
    return this.#workspaceFoundation.saveProjectCapability(workspaceId, input);
  }

  async deleteWorkspaceProjectCapability(workspaceId, kind, normalizedName, expectedVersion) {
    return this.#workspaceFoundation.deleteProjectCapability(workspaceId, kind, normalizedName, expectedVersion);
  }

  async getWorkspaceEffectiveCapabilities(workspaceId) {
    return this.#workspaceFoundation.effectiveCapabilityCatalog(workspaceId);
  }

  async getWorkspaceCapabilityDraft(workspaceId) {
    return this.#workspaceFoundation.getCapabilityDraft(workspaceId);
  }

  async saveWorkspaceCapabilityDraft(workspaceId, input) {
    this.#analysisModelRegistry?.assertProfilesUnlocked(modelIdsFromDraftInput(input));
    return this.#workspaceFoundation.saveCapabilityDraft(workspaceId, input);
  }

  async validateWorkspaceCapabilityDraft(workspaceId) {
    return this.#workspaceFoundation.validateCapabilityDraft(workspaceId, this.#globalModelProfiles());
  }

  async activateWorkspaceCapabilityDraft(workspaceId) {
    const draft = await this.#workspaceFoundation.getCapabilityDraft(workspaceId);
    if (draft) this.#analysisModelRegistry?.assertProfilesUnlocked(modelIdsFromDraftInput(draft));
    return this.#workspaceFoundation.activateCapabilityDraft(workspaceId, this.#globalModelProfiles());
  }

  async saveWorkspaceCapabilityConfig(workspaceId, input) {
    return this.#workspaceFoundation.saveWorkspaceCapabilityConfig(workspaceId, input);
  }

  async listWorkspaceCapabilityConfigs(workspaceId) {
    return this.#workspaceFoundation.listWorkspaceCapabilityConfigs(workspaceId);
  }

  async resolveWorkspaceExecutionProfile(workspaceId, configId = null) {
    return this.#workspaceFoundation.resolveWorkspaceProfile(workspaceId, configId);
  }

  async listWorkspaceExecutionProfiles(workspaceId) {
    return this.#workspaceFoundation.listWorkspaceProfiles(workspaceId);
  }

  async issueWorkspaceSecretGrants(workspaceId, profileRevisionId, input) {
    const grants = await this.#workspaceFoundation.issueSecretGrants(workspaceId, profileRevisionId, input);
    if (grants) this.#analysisModelRegistry?.registerIssuedSecretGrants(grants);
    return grants;
  }

  async createWorkspaceAnalysisBatch(workspaceId, input) {
    return this.#workspaceFoundation.createBatch(workspaceId, input);
  }

  async commitWorkspaceChildResult(workspaceId, input) {
    return this.#workspaceFoundation.commitChildResult(workspaceId, input);
  }

  async openWorkspaceAnalysisBatchBarrier(workspaceId, batchId) {
    return this.#workspaceFoundation.openBatchBarrier(workspaceId, batchId);
  }

  async getWorkspaceReviewQueue(workspaceId, filters = {}) {
    return this.#workspaceFoundation.getReviewQueue(workspaceId, filters);
  }

  async decideWorkspaceReviewBatch(workspaceId, input, requestContext = {}) {
    const reviewer = await this.#reviewerResolver(workspaceId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError("a trusted reviewer identity is required");
    return this.#workspaceFoundation.decideReviewBatch(workspaceId, {
      ...input,
      reviewerId: reviewer.actorId,
      reviewerRole: reviewer.actorRole,
    });
  }

  async registerSnapshot(projectId, input) {
    requireId(projectId, "projectId");
    const manifest = createSnapshotManifest(input, this.#clock);
    await this.#store.appendSnapshotManifest(projectId, manifest);
    return manifest;
  }

  async listSnapshotManifests(projectId) {
    requireId(projectId, "projectId");
    return this.#store.listSnapshotManifests(projectId);
  }

  prepareEvaluation(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("evaluation input must be an object");
    }

    const prepared = structuredClone(input);
    prepared.snapshotManifest = createSnapshotManifest(prepared.snapshotManifest, this.#clock);

    if (prepared.conformance) {
      prepared.conformance.snapshotManifestId = currentReference(
        prepared.conformance.snapshotManifestId,
        prepared.snapshotManifest.id,
      );
    }
    if (prepared.execution) {
      prepared.execution.snapshotManifestId = currentReference(
        prepared.execution.snapshotManifestId,
        prepared.snapshotManifest.id,
      );
    }
    return prepared;
  }

  evaluate(input) {
    return evaluateTraceChain(this.prepareEvaluation(input), this.#clock);
  }

  async evaluateAndPersist(projectId, input, options = {}) {
    requireId(projectId, "projectId");
    const prepared = this.prepareEvaluation(input);
    const chain = evaluateTraceChain(prepared, this.#clock);
    await this.#store.appendSnapshotManifest(projectId, prepared.snapshotManifest);
    const persisted = await this.#store.appendTraceChainRevision(projectId, chain, options);
    return Object.freeze({ chain, persisted });
  }

  async getCurrentTraceChain(projectId, chainId) {
    requireId(projectId, "projectId");
    requireId(chainId, "chainId");
    return this.#store.getCurrentTraceChain(projectId, chainId);
  }

  async appendFeatureVersion(projectId, input) {
    requireId(projectId, "projectId");
    const feature = createFeatureVersion(input, this.#clock);
    const baseline = await this.#store.getFeatureBaseline(projectId, feature.id);
    if (!baseline && feature.version !== 1) {
      throw new PersistenceConflictError("A new Feature must start at version 1");
    }
    if (baseline && feature.version !== baseline.feature.version && feature.version !== baseline.feature.version + 1) {
      throw new PersistenceConflictError(
        `Feature ${feature.id} must advance from version ${baseline.feature.version} to ${baseline.feature.version + 1}`,
      );
    }
    await this.#store.appendFeatureVersion(projectId, feature);
    return feature;
  }

  async #featureGovernor(projectId, requestContext) {
    const reviewer = await this.#reviewerResolver(projectId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError();
    const actorId = requireId(reviewer.actorId, "reviewer.actorId");
    const actorRole = requireId(reviewer.actorRole, "reviewer.actorRole");
    const policy = await this.#reviewPolicyResolver(projectId);
    const allowedRoles = policy.allowedFeatureGovernanceRoles ?? policy.allowedProcessModelRoles ?? [];
    if (!Array.isArray(allowedRoles) || !allowedRoles.includes(actorRole)) {
      throw new ReviewAuthorizationError(`Role ${actorRole} cannot govern Feature evolution in this project`);
    }
    return { actorId, actorRole };
  }

  async appendFeatureAlias(projectId, featureId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    assertOnlyFields(input, ["featureVersion", "alias", "rationale"], "featureAlias");
    const baseline = await this.#store.getFeatureBaseline(projectId, featureId);
    if (!baseline) throw new PersistenceConflictError(`Feature ${featureId} does not exist`);
    if (input.featureVersion !== baseline.feature.version) {
      throw new PersistenceConflictError("A new alias must bind the current immutable Feature version");
    }
    const actor = await this.#featureGovernor(projectId, requestContext);
    const alias = createFeatureAlias({ ...input, featureId, ...actor }, this.#clock);
    return this.#store.appendFeatureAlias(projectId, alias);
  }

  async listFeatureAliases(projectId, featureId) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    if (!await this.#store.getFeatureBaseline(projectId, featureId)) return null;
    return this.#store.listFeatureAliases(projectId, featureId);
  }

  async appendFeatureLineage(projectId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    assertOnlyFields(input, ["id", "predecessorFeatureId", "successorFeatureId", "relationType", "rationale"], "featureLineage");
    const actor = await this.#featureGovernor(projectId, requestContext);
    const lineage = createFeatureLineage({ ...input, ...actor }, this.#clock);
    const [predecessor, successor, existing] = await Promise.all([
      this.#store.getFeatureBaseline(projectId, lineage.predecessorFeatureId),
      this.#store.getFeatureBaseline(projectId, lineage.successorFeatureId),
      this.#store.listFeatureLineages(projectId),
    ]);
    if (!predecessor || !successor) throw new PersistenceConflictError("Feature lineage endpoints must exist in the project");
    const same = existing.find((item) => item.id === lineage.id);
    if (!same && introducesFeatureLineageCycle(existing, lineage.predecessorFeatureId, lineage.successorFeatureId)) {
      throw new PersistenceConflictError("Feature lineage would create a cycle");
    }
    return this.#store.appendFeatureLineage(projectId, lineage);
  }

  async listFeatureLineages(projectId, featureId = null) {
    requireId(projectId, "projectId");
    if (featureId !== null) requireId(featureId, "featureId");
    return this.#store.listFeatureLineages(projectId, featureId);
  }

  async appendClaimScope(projectId, input) {
    requireId(projectId, "projectId");
    const scope = createClaimScope(input, this.#clock);
    await this.#store.appendClaimScope(projectId, scope);
    return scope;
  }

  async appendClaim(projectId, input) {
    requireId(projectId, "projectId");
    const claim = createClaim(input, this.#clock);
    await this.#store.appendClaim(projectId, claim);
    return claim;
  }

  async appendDecision(projectId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("decision input must be an object");
    }
    for (const serverField of ["actorId", "actorRole", "createdAt"]) {
      if (Object.hasOwn(input, serverField)) throw new TypeError(`decision.${serverField} is assigned by the server`);
    }
    const reviewer = await this.#reviewerResolver(projectId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError();
    const actorId = requireId(reviewer.actorId, "reviewer.actorId");
    const actorRole = requireId(reviewer.actorRole, "reviewer.actorRole");
    const policy = (await this.#reviewPolicyResolver(projectId, { reviewer, decisionInput: input })) ?? {};
    if (policy.requireDecisionReviewCases === true) {
      throw new ReviewAuthorizationError("Direct Decision creation is disabled; use a governed Decision review case");
    }
    if (!Array.isArray(policy.allowedRoles) || !policy.allowedRoles.includes(actorRole)) {
      throw new ReviewAuthorizationError(`Role ${actorRole} cannot decide Claims in this project`);
    }
    if (!Array.isArray(policy.allowedDecisionTypes) || !policy.allowedDecisionTypes.includes(input.type)) {
      throw new ReviewAuthorizationError(`Decision ${input.type} is not allowed by the review policy`);
    }
    const decision = createDecision({ ...input, actorId, actorRole }, this.#clock);
    await this.#store.appendDecision(projectId, decision);
    return decision;
  }

  async appendBusinessProcessModel(projectId, featureId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("process model input must be an object");
    }
    if (Object.hasOwn(input, "featureId") || Object.hasOwn(input, "createdAt")) {
      throw new TypeError("processModel.featureId and processModel.createdAt are assigned by the server or route");
    }
    for (const serverField of ["actorId", "actorRole", "confirmedAt"]) {
      if (Object.hasOwn(input.authority ?? {}, serverField)) {
        throw new TypeError(`processModel.authority.${serverField} is assigned by the server`);
      }
    }
    const reviewer = await this.#reviewerResolver(projectId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError();
    const actorId = requireId(reviewer.actorId, "reviewer.actorId");
    const actorRole = requireId(reviewer.actorRole, "reviewer.actorRole");
    const policy = (await this.#reviewPolicyResolver(projectId, {
      reviewer,
      featureId,
      processModelInput: input,
    })) ?? {};
    if (!Array.isArray(policy.allowedProcessModelRoles) || !policy.allowedProcessModelRoles.includes(actorRole)) {
      throw new ReviewAuthorizationError(`Role ${actorRole} cannot confirm business process models in this project`);
    }
    const processModel = createBusinessProcessModel({
      ...input,
      featureId,
      authority: { ...input.authority, actorId, actorRole },
    }, this.#clock);
    const refsBySnapshot = new Map();
    for (const ref of listBusinessProcessFactRefs(processModel)) {
      const refs = refsBySnapshot.get(ref.snapshotManifestId) ?? [];
      refs.push(ref.factId);
      refsBySnapshot.set(ref.snapshotManifestId, refs);
    }
    for (const [snapshotManifestId, factIds] of refsBySnapshot) {
      if (!await this.#store.getSnapshotManifest(projectId, snapshotManifestId)) {
        throw new PersistenceConflictError(`SnapshotManifest ${snapshotManifestId} does not exist in project ${projectId}`);
      }
      const facts = await this.#store.getFactGraphByReferences(projectId, snapshotManifestId, factIds);
      if (facts.missingFactRefs.length > 0) {
        throw new PersistenceConflictError(
          `Business process implementation references are missing from Snapshot ${snapshotManifestId}: ${facts.missingFactRefs.join(", ")}`,
        );
      }
    }
    await this.#store.appendBusinessProcessModel(projectId, processModel);
    return processModel;
  }

  async getBusinessProcessModel(projectId, featureId) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    return this.#store.getLatestBusinessProcessModel(projectId, featureId);
  }

  async createDecisionReviewCase(projectId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("decision review case input must be an object");
    }
    for (const serverField of ["proposerId", "proposerRole", "createdAt"]) {
      if (Object.hasOwn(input, serverField)) throw new TypeError(`decisionReviewCase.${serverField} is assigned by the server`);
    }
    const reviewer = await this.#reviewerResolver(projectId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError();
    const proposerId = requireId(reviewer.actorId, "reviewer.actorId");
    const proposerRole = requireId(reviewer.actorRole, "reviewer.actorRole");
    const policy = (await this.#reviewPolicyResolver(projectId, {
      reviewer,
      decisionReviewCaseInput: input,
    }))?.decisionGovernance ?? {};
    if (!Array.isArray(policy.proposerRoles) || !policy.proposerRoles.includes(proposerRole)) {
      throw new ReviewAuthorizationError(`Role ${proposerRole} cannot propose governed Decisions in this project`);
    }
    const reviewCase = createDecisionReviewCase({ ...input, proposerId, proposerRole }, this.#clock);
    if (reviewCase.approvalMode === "BREAK_GLASS") {
      const maximumMinutes = policy.maxBreakGlassMinutes ?? 60;
      if (!Number.isInteger(maximumMinutes) || maximumMinutes < 1) {
        throw new TypeError("decision governance policy.maxBreakGlassMinutes must be a positive integer");
      }
      if (Date.parse(reviewCase.proposedDecision.validUntil) - Date.parse(reviewCase.createdAt) > maximumMinutes * 60_000) {
        throw new ReviewAuthorizationError(`Break-glass validity exceeds the ${maximumMinutes}-minute policy maximum`);
      }
    }
    const stored = await this.#store.appendDecisionReviewCase(projectId, reviewCase);
    return this.#decisionReviewView(projectId, stored);
  }

  async getDecisionReviewCase(projectId, caseId) {
    requireId(projectId, "projectId");
    requireId(caseId, "caseId");
    const stored = await this.#store.getDecisionReviewCase(projectId, caseId);
    return stored ? this.#decisionReviewView(projectId, stored) : null;
  }

  async #decisionReviewView(projectId, stored) {
    const policy = (await this.#reviewPolicyResolver(projectId, { reviewCase: stored.reviewCase }))
      ?.decisionGovernance ?? {};
    return deepFreeze({
      ...stored,
      evaluation: evaluateDecisionReviewCase(stored.reviewCase, stored.events, policy, this.#clock),
    });
  }

  async appendDecisionReviewEvent(projectId, caseId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    requireId(caseId, "caseId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("decision review event input must be an object");
    }
    for (const serverField of ["caseId", "actorId", "actorRole", "createdAt"]) {
      if (Object.hasOwn(input, serverField)) throw new TypeError(`decisionReviewEvent.${serverField} is assigned by the server`);
    }
    const reviewer = await this.#reviewerResolver(projectId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError();
    const actorId = requireId(reviewer.actorId, "reviewer.actorId");
    const actorRole = requireId(reviewer.actorRole, "reviewer.actorRole");
    const stored = await this.#store.getDecisionReviewCase(projectId, caseId);
    if (!stored) throw new PersistenceConflictError(`DecisionReviewCase ${caseId} does not exist`);
    const policy = (await this.#reviewPolicyResolver(projectId, {
      reviewer,
      reviewCase: stored.reviewCase,
      decisionReviewEventInput: input,
    }))?.decisionGovernance ?? {};
    const current = evaluateDecisionReviewCase(stored.reviewCase, stored.events, policy, this.#clock);
    const event = createDecisionReviewEvent({ ...input, caseId, actorId, actorRole }, this.#clock);
    const lifecycleRoles = new Set(policy.lifecycleRoles ?? []);
    const approvalRoles = new Set(
      stored.reviewCase.approvalMode === "BUSINESS_COMPLIANCE"
        ? [...(policy.businessRoles ?? []), ...(policy.complianceRoles ?? [])]
        : stored.reviewCase.approvalMode === "BREAK_GLASS"
          ? policy.breakGlassRoles ?? []
          : policy.approvalRoles ?? [],
    );
    if (["APPROVE", "REJECT"].includes(event.action) && !approvalRoles.has(actorRole)) {
      throw new ReviewAuthorizationError(`Role ${actorRole} cannot ${event.action.toLowerCase()} this Decision case`);
    }
    if (["REVOKE", "DISPUTE", "REOPEN", "POST_REVIEW"].includes(event.action) && !lifecycleRoles.has(actorRole)) {
      throw new ReviewAuthorizationError(`Role ${actorRole} cannot perform Decision lifecycle action ${event.action}`);
    }
    if (event.action === "APPROVE") {
      if (actorId === stored.reviewCase.proposerId) {
        throw new ReviewAuthorizationError("The proposer cannot approve their own governed Decision");
      }
      const lastReopenIndex = stored.events.findLastIndex((item) => item.action === "REOPEN");
      if (
        stored.events.slice(lastReopenIndex + 1).some((item) => item.action === "APPROVE" && item.actorId === actorId) &&
        current.status === "PENDING"
      ) {
        throw new PersistenceConflictError(`Actor ${actorId} already approved this active review round`);
      }
      if (current.status !== "PENDING") throw new PersistenceConflictError(`Cannot approve a case in ${current.status}`);
    }
    if (event.action === "REJECT" && current.status !== "PENDING") {
      throw new PersistenceConflictError(`Cannot reject a case in ${current.status}`);
    }
    if (["REVOKE", "DISPUTE"].includes(event.action) && !["APPROVED", "POST_REVIEW_OVERDUE"].includes(current.status)) {
      throw new PersistenceConflictError(`Cannot ${event.action.toLowerCase()} a case in ${current.status}`);
    }
    if (event.action === "REOPEN" && !["REJECTED", "REVOKED", "DISPUTED"].includes(current.status)) {
      throw new PersistenceConflictError(`Cannot reopen a case in ${current.status}`);
    }
    if (
      event.action === "POST_REVIEW" &&
      (stored.reviewCase.approvalMode !== "BREAK_GLASS" || !["APPROVED", "POST_REVIEW_OVERDUE"].includes(current.status))
    ) {
      throw new PersistenceConflictError("POST_REVIEW is only valid for an approved Break-glass case");
    }
    const next = evaluateDecisionReviewCase(stored.reviewCase, [...stored.events, event], policy, this.#clock);
    if (event.action === "APPROVE" && next.ignoredApprovalEventIds.includes(event.id)) {
      throw new ReviewAuthorizationError("This approval does not satisfy the configured role and separation policy");
    }
    let decision = null;
    if (event.action === "APPROVE" && next.mayMaterializeDecision) {
      const lastReopen = [...stored.events].reverse().find((item) => item.action === "REOPEN");
      decision = createDecision({
        ...stored.reviewCase.proposedDecision,
        id: stored.decisions.length === 0
          ? stored.reviewCase.proposedDecision.id
          : `${stored.reviewCase.proposedDecision.id}:REOPEN:${lastReopen?.id ?? event.id}`,
        claimId: stored.reviewCase.claimId,
        claimVersion: stored.reviewCase.claimVersion,
        scopeId: stored.reviewCase.scopeId,
        scopeVersion: stored.reviewCase.scopeVersion,
        actorId,
        actorRole,
      }, this.#clock);
    } else if (["REVOKE", "DISPUTE"].includes(event.action)) {
      decision = createDecision({
        id: `${stored.reviewCase.proposedDecision.id}:${event.action}:${event.id}`,
        claimId: stored.reviewCase.claimId,
        claimVersion: stored.reviewCase.claimVersion,
        scopeId: stored.reviewCase.scopeId,
        scopeVersion: stored.reviewCase.scopeVersion,
        type: event.action === "REVOKE" ? "DEPRECATED" : "DEFERRED",
        content: event.rationale,
        actorId,
        actorRole,
        evidenceRefs: [],
        validUntil: null,
      }, this.#clock);
    }
    const persisted = await this.#store.appendDecisionReviewEvent(projectId, { event, decision });
    return this.#decisionReviewView(projectId, persisted);
  }

  async getFeatureBaseline(projectId, featureId) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    return this.#store.getFeatureBaseline(projectId, featureId);
  }

  async getFeatureConflicts(projectId, featureId, snapshotManifestId) {
    const traceability = await this.getFeatureTraceability(projectId, featureId, snapshotManifestId);
    if (!traceability) return null;
    const conflicts = traceability.claims.flatMap((claimView) =>
      claimView.traceChain.conflicts.map((conflict) => ({
        ...conflict,
        featureId,
        claimId: claimView.claim.id,
        claimVersion: claimView.claim.version,
        traceChainId: claimView.traceChain.id,
      })),
    );
    return deepFreeze({
      feature: traceability.feature,
      snapshotManifest: traceability.snapshotManifest,
      conflicts,
      computedAt: traceability.computedAt,
    });
  }

  async getFeatureTraceChains(projectId, featureId, snapshotManifestId) {
    const traceability = await this.getFeatureTraceability(projectId, featureId, snapshotManifestId);
    if (!traceability) return null;
    return deepFreeze({
      feature: traceability.feature,
      snapshotManifest: traceability.snapshotManifest,
      traceChains: traceability.traceChains,
      gaps: traceability.gaps,
      computedAt: traceability.computedAt,
    });
  }

  async listFeatures(projectId) {
    requireId(projectId, "projectId");
    const featureIds = await this.#store.listFeatureIds(projectId);
    const baselines = await Promise.all(featureIds.map((featureId) => this.#store.getFeatureBaseline(projectId, featureId)));
    return deepFreeze(baselines.filter(Boolean).map((baseline) => ({
      feature: baseline.feature,
      processModel: baseline.processModel,
      claimCount: baseline.claims.length,
      confirmedClaimCount: baseline.claims.filter((item) => ["CONFIRMED", "EXCEPTION_RECORDED"].includes(
        authorityFromDecision(item.latestDecision, this.#clock()),
      )).length,
      testSpecCount: baseline.testSpecs.length,
      latestExecutionAt: baseline.testExecutions.map((item) => item.finishedAt).sort().at(-1) ?? null,
    })));
  }

  validateTestSpec(input) {
    return validateTestSpecProtocol(input, this.#clock);
  }

  async appendTestSpec(projectId, input) {
    requireId(projectId, "projectId");
    const testSpec = assertTestSpecSafeToStore(createTestSpec(input, this.#clock));
    await this.#store.appendTestSpec(projectId, testSpec);
    return testSpec;
  }

  async appendTestSpecDraft(projectId, input) {
    requireId(projectId, "projectId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("TestSpec draft input must be an object");
    }
    for (const serverField of ["createdAt", "approval", "origin"]) {
      if (Object.hasOwn(input, serverField)) {
        throw new TypeError(`testSpec.${serverField} is assigned by a trusted server workflow`);
      }
    }
    if (input.approved !== false) throw new TypeError("Public TestSpec creation only accepts unapproved drafts");
    return this.appendTestSpec(projectId, { ...input, approval: null });
  }

  async generateTestSpecDraft(projectId, featureId, claimId, input) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    requireId(claimId, "claimId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("TestSpec generation input must be an object");
    }
    assertOnlyFields(
      input,
      [
        "id",
        "snapshotManifestId",
        "endpointFactId",
        "target",
        "expectedHttpStatus",
        "name",
        "risk",
        "preconditions",
        "variables",
        "headers",
        "body",
        "cleanup",
        "pathParameters",
        "databaseVerification",
      ],
      "testSpecGeneration",
    );
    const snapshotManifestId = requireId(input.snapshotManifestId, "snapshotManifestId");
    const baseline = await this.#store.getFeatureBaseline(projectId, featureId);
    if (!baseline) throw new PersistenceConflictError(`Feature ${featureId} does not exist`);
    const claimRecord = baseline.claims.find((item) => item.claim.id === claimId);
    if (!claimRecord) throw new PersistenceConflictError(`Claim ${claimId} does not belong to Feature ${featureId}`);
    const decision = claimRecord.latestDecision;
    if (!decision || !["CONFIRMED", "EXCEPTION_RECORDED"].includes(decision.type)) {
      throw new PersistenceConflictError("TestSpec generation requires a currently authorized Claim Decision");
    }
    const mapping = baseline.implementationMappings
      .filter(
        (item) =>
          item.claimId === claimRecord.claim.id &&
          item.claimVersion === claimRecord.claim.version &&
          item.snapshotManifestId === snapshotManifestId &&
          item.status === "ACTIVE",
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .at(-1);
    if (!mapping) {
      throw new PersistenceConflictError(
        "TestSpec generation requires an active implementation mapping for the selected Snapshot Manifest",
      );
    }
    const graph = await this.#store.getFactGraphByReferences(
      projectId,
      snapshotManifestId,
      mapping.factRefs.map((reference) => reference.factId),
    );
    const endpoints = graph.nodes.filter((node) => node.type === "ENDPOINT");
    const endpoint = input.endpointFactId
      ? endpoints.find((node) => node.factId === input.endpointFactId)
      : endpoints.length === 1
        ? endpoints[0]
        : null;
    if (!endpoint) {
      throw new PersistenceConflictError(
        endpoints.length > 1
          ? "Multiple mapped Endpoint Facts exist; endpointFactId must select one explicitly"
          : "No mapped Endpoint Fact can be converted for this Claim",
      );
    }
    const generated = generateEndpointTestSpecDraft({
      ...input,
      projectId,
      claim: claimRecord.claim,
      decision,
      mapping,
      endpoint,
    }, this.#clock);
    const existing = await this.#store.getTestSpec(projectId, generated.draft.id);
    if (existing) {
      if (existing.origin?.requestFingerprint === generated.generation.requestFingerprint) {
        const originalDraft = await this.#store.getTestSpec(
          projectId,
          generated.draft.id,
          generated.draft.version,
        );
        if (!originalDraft || originalDraft.approved) {
          throw new PersistenceConflictError(
            `TestSpec ${generated.draft.id} no longer has its immutable generated draft version`,
          );
        }
        return deepFreeze({
          ...generated,
          draft: originalDraft,
          validation: this.validateTestSpec(originalDraft),
        });
      }
      throw new PersistenceConflictError(
        `TestSpec ${generated.draft.id} already exists with a different immutable origin`,
      );
    }
    await this.#store.appendTestSpec(projectId, assertTestSpecSafeToStore(generated.draft));
    return generated;
  }

  async approveTestSpec(projectId, testSpecId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    requireId(testSpecId, "testSpecId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("TestSpec approval input must be an object");
    }
    assertOnlyFields(input, ["expectedVersion", "rationale"], "testSpecApproval");
    const expectedVersion = input.expectedVersion;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new TypeError("testSpecApproval.expectedVersion must be a positive integer");
    }
    const rationale = requireId(input.rationale, "testSpecApproval.rationale");
    const reviewer = await this.#reviewerResolver(projectId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError();
    const actorId = requireId(reviewer.actorId, "reviewer.actorId");
    const actorRole = requireId(reviewer.actorRole, "reviewer.actorRole");
    const policy = (await this.#reviewPolicyResolver(projectId, {
      reviewer,
      testSpecId,
      approvalInput: input,
    })) ?? {};
    if (
      !Array.isArray(policy.allowedTestSpecApproverRoles) ||
      !policy.allowedTestSpecApproverRoles.includes(actorRole)
    ) {
      throw new ReviewAuthorizationError(`Role ${actorRole} cannot approve TestSpecs in this project`);
    }
    const requestFingerprint = contentId("TEST-SPEC-APPROVAL-REQUEST", {
      projectId,
      testSpecId,
      expectedVersion,
      rationale,
      actorId,
      actorRole,
    });
    const current = await this.#store.getTestSpec(projectId, testSpecId);
    if (!current) throw new PersistenceConflictError(`TestSpec ${testSpecId} does not exist`);
    if (current.approved) {
      if (current.approval?.requestFingerprint === requestFingerprint) return current;
      throw new PersistenceConflictError(`TestSpec ${testSpecId} is already approved by another immutable decision`);
    }
    if (current.version !== expectedVersion) {
      throw new PersistenceConflictError(
        `TestSpec ${testSpecId} expected version ${expectedVersion} but current version is ${current.version}`,
      );
    }
    const now = this.#clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("Application clock must return a valid Date");
    const timestamp = now.toISOString();
    const approved = createTestSpec({
      ...current,
      version: current.version + 1,
      approved: true,
      approval: {
        actorId,
        actorRole,
        approvedAt: timestamp,
        rationale,
        requestFingerprint,
      },
      createdAt: timestamp,
    }, () => now);
    const validation = this.validateTestSpec(approved);
    if (!validation.executable) {
      throw new PersistenceConflictError(
        `TestSpec cannot be approved while blocking gaps remain: ${validation.violations.map((item) => item.code).join(", ")}`,
      );
    }
    await this.#store.appendTestSpec(projectId, approved);
    return approved;
  }

  async getTestSpec(projectId, testSpecId, version = null) {
    requireId(projectId, "projectId");
    requireId(testSpecId, "testSpecId");
    if (version !== null && (!Number.isSafeInteger(version) || version < 1)) {
      throw new TypeError("version must be a positive integer");
    }
    return this.#store.getTestSpec(projectId, testSpecId, version);
  }

  async validateStoredTestSpec(projectId, testSpecId, version = null) {
    const testSpec = await this.getTestSpec(projectId, testSpecId, version);
    if (!testSpec) return null;
    return this.validateTestSpec(testSpec);
  }

  async ingestExecutionEvidence(projectId, input) {
    requireId(projectId, "projectId");
    const normalized = createExecutionEvidenceBundle(input, this.#clock);
    const attestedBundle = { ...normalized, attestation: input?.attestation };
    const runnerSecret = await this.#runnerKeyResolver(normalized.execution.runner.id, projectId);
    if (
      typeof runnerSecret !== "string" ||
      runnerSecret === "" ||
      !verifyExecutionEvidenceAttestation(projectId, attestedBundle, runnerSecret)
    ) {
      throw new RunnerAttestationError("Runner attestation is missing, unknown, or invalid");
    }

    const testSpec = await this.#store.getTestSpec(
      projectId,
      normalized.execution.testSpecId,
      normalized.execution.testSpecVersion,
    );
    if (!testSpec) {
      throw new PersistenceConflictError(
        `TestSpec ${normalized.execution.testSpecId} version ${normalized.execution.testSpecVersion} does not exist`,
      );
    }
    const validation = this.validateTestSpec(testSpec);
    if (!validation.executable) {
      throw new PersistenceConflictError("TestSpec is not eligible for execution under the current policy");
    }

    const snapshotManifest = await this.#store.getSnapshotManifest(
      projectId,
      normalized.execution.snapshotManifestId,
    );
    if (!snapshotManifest) {
      throw new PersistenceConflictError(
        `Snapshot manifest ${normalized.execution.snapshotManifestId} does not exist in project ${projectId}`,
      );
    }
    const expectedComponents = canonicalJson(Object.fromEntries(
      ["source", "build", "deployment", "runtime"].map((componentName) => [
        componentName,
        {
          id: snapshotManifest.components[componentName].id,
          digest: snapshotManifest.components[componentName].digest,
        },
      ]),
    ));
    if (
      normalized.evidence.some(
        (item) => canonicalJson(item.manifest.snapshotComponents) !== expectedComponents,
      )
    ) {
      throw new PersistenceConflictError(
        "Evidence Snapshot components must exactly match the referenced manifest",
      );
    }

    await this.#store.appendExecutionEvidenceBundle(projectId, attestedBundle);
    return this.#store.getExecutionEvidence(projectId, normalized.execution.id);
  }

  async getExecutionEvidence(projectId, executionId) {
    requireId(projectId, "projectId");
    requireId(executionId, "executionId");
    return this.#store.getExecutionEvidence(projectId, executionId);
  }

  async appendEvidenceRetentionPolicy(projectId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("Evidence retention policy input must be an object");
    }
    for (const serverField of ["actorId", "actorRole", "createdAt"]) {
      if (Object.hasOwn(input, serverField)) throw new TypeError(`evidenceRetentionPolicy.${serverField} is assigned by the server`);
    }
    const reviewer = await this.#reviewerResolver(projectId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError();
    const actorId = requireId(reviewer.actorId, "reviewer.actorId");
    const actorRole = requireId(reviewer.actorRole, "reviewer.actorRole");
    const governance = (await this.#reviewPolicyResolver(projectId, {
      reviewer,
      evidenceRetentionPolicyInput: input,
    })) ?? {};
    if (!Array.isArray(governance.allowedEvidenceLifecycleRoles) || !governance.allowedEvidenceLifecycleRoles.includes(actorRole)) {
      throw new ReviewAuthorizationError(`Role ${actorRole} cannot govern Evidence lifecycle`);
    }
    const policy = createEvidenceRetentionPolicy({ ...input, actorId, actorRole }, this.#clock);
    await this.#store.appendEvidenceRetentionPolicy(projectId, policy);
    return policy;
  }

  async getEvidenceLifecycle(projectId, evidenceId, policyId, policyVersion = null) {
    requireId(projectId, "projectId");
    requireId(evidenceId, "evidenceId");
    requireId(policyId, "policyId");
    const [evidence, policy, events] = await Promise.all([
      this.#store.getEvidence(projectId, evidenceId),
      this.#store.getEvidenceRetentionPolicy(projectId, policyId, policyVersion),
      this.#store.listEvidenceLifecycleEvents(projectId, evidenceId),
    ]);
    if (!evidence || !policy) return null;
    const relevantEvents = events.filter((event) => event.policyId === policy.id && event.policyVersion === policy.version);
    return evaluateEvidenceLifecycle(evidence, policy, relevantEvents, this.#clock);
  }

  async appendEvidenceLifecycleEvent(projectId, evidenceId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    requireId(evidenceId, "evidenceId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("Evidence lifecycle event input must be an object");
    }
    for (const serverField of ["evidenceId", "actorId", "actorRole", "occurredAt"]) {
      if (Object.hasOwn(input, serverField)) throw new TypeError(`evidenceLifecycleEvent.${serverField} is assigned by the server`);
    }
    const reviewer = await this.#reviewerResolver(projectId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError();
    const actorId = requireId(reviewer.actorId, "reviewer.actorId");
    const actorRole = requireId(reviewer.actorRole, "reviewer.actorRole");
    const evidence = await this.#store.getEvidence(projectId, evidenceId);
    const policy = await this.#store.getEvidenceRetentionPolicy(projectId, input.policyId, input.policyVersion);
    if (!evidence) throw new PersistenceConflictError(`Evidence ${evidenceId} does not exist`);
    if (!policy) throw new PersistenceConflictError(`Evidence retention policy ${input.policyId}@${input.policyVersion} does not exist`);
    const governance = (await this.#reviewPolicyResolver(projectId, {
      reviewer,
      evidence,
      policy,
      evidenceLifecycleEventInput: input,
    })) ?? {};
    const accessAction = ["ACCESSED", "EXPORTED"].includes(input.action);
    const allowed = accessAction ? policy.allowedAccessRoles : governance.allowedEvidenceLifecycleRoles;
    if (!Array.isArray(allowed) || !allowed.includes(actorRole)) {
      throw new ReviewAuthorizationError(`Role ${actorRole} cannot perform Evidence lifecycle action ${input.action}`);
    }
    const events = (await this.#store.listEvidenceLifecycleEvents(projectId, evidenceId))
      .filter((item) => item.policyId === policy.id && item.policyVersion === policy.version);
    const current = evaluateEvidenceLifecycle(evidence, policy, events, this.#clock);
    if (current.deleted) throw new PersistenceConflictError("Deleted Evidence content cannot receive further lifecycle events");
    if (input.action === "DELETED" && current.legalHold) {
      throw new PersistenceConflictError("Evidence under Legal Hold cannot be deleted");
    }
    if (input.action === "DELETED" && !current.deletionRequested) {
      throw new PersistenceConflictError("Evidence deletion requires a prior DELETION_REQUESTED event");
    }
    const event = createEvidenceLifecycleEvent({ ...input, evidenceId, actorId, actorRole }, this.#clock);
    await this.#store.appendEvidenceLifecycleEvent(projectId, event);
    return this.getEvidenceLifecycle(projectId, evidenceId, policy.id, policy.version);
  }

  async ingestFactBundle(projectId, input) {
    requireId(projectId, "projectId");
    if (input?.projectId !== projectId) {
      throw new TypeError("FactBundle projectId must match the route projectId");
    }
    const normalized = createFactBundle(input);
    const attestedBundle = { ...normalized, attestation: input?.attestation };
    const scannerSecret = await this.#scannerKeyResolver(normalized.extractor.id, projectId);
    if (
      typeof scannerSecret !== "string" ||
      scannerSecret === "" ||
      !verifyFactBundleAttestation(attestedBundle, scannerSecret)
    ) {
      throw new ScannerAttestationError("Scanner attestation is missing, unknown, or invalid");
    }
    const snapshotManifest = await this.#store.getSnapshotManifest(projectId, normalized.snapshotManifestId);
    if (!snapshotManifest) {
      throw new PersistenceConflictError(
        `Snapshot manifest ${normalized.snapshotManifestId} does not exist in project ${projectId}`,
      );
    }
    if (
      snapshotManifest.components?.source?.id !== normalized.sourceComponentId ||
      snapshotManifest.components?.source?.digest !== normalized.sourceDigest
    ) {
      throw new PersistenceConflictError(
        "FactBundle source ID and digest must exactly match the referenced Snapshot component",
      );
    }
    return this.#store.appendFactBundle(projectId, attestedBundle);
  }

  async ingestWorkspaceObservations(projectId, input) {
    requireId(projectId, "projectId");
    if (Object.hasOwn(input ?? {}, "projectId")) {
      throw new TypeError("Workspace observation projectId is assigned by the route");
    }
    const prepared = createWorkspaceObservationPackage({ ...input, projectId }, this.#clock);
    await this.#store.appendSnapshotManifest(projectId, prepared.snapshotManifest);
    await this.#store.appendFactBundle(projectId, prepared.factBundle);
    return prepared.receipt;
  }

  async queryFacts(projectId, filters = {}) {
    requireId(projectId, "projectId");
    const types = [...new Set((filters.types ?? []).map((type) => assertEnum(FactNodeType, type, "type")))];
    const predicates = [
      ...new Set((filters.predicates ?? []).map((predicate) => assertEnum(FactPredicate, predicate, "predicate"))),
    ];
    const limit = filters.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("limit must be an integer between 1 and 500");
    }
    const query = filters.query?.trim() || null;
    if (query && query.length > 256) throw new RangeError("query must not exceed 256 characters");
    const snapshotManifestId = filters.snapshotManifestId ?? null;
    if (snapshotManifestId !== null) requireId(snapshotManifestId, "snapshotManifestId");
    return this.#store.queryFacts(projectId, { snapshotManifestId, types, predicates, query, limit });
  }

  async registerReverseSkill(input) {
    if (Object.hasOwn(input ?? {}, "registeredAt")) {
      throw new TypeError("Skill registration time is assigned by the server");
    }
    const manifest = createReverseSkillManifest(input);
    const publisherSecret = await this.#publisherKeyResolver(manifest.metadata.publisher);
    if (
      typeof publisherSecret !== "string" ||
      publisherSecret === "" ||
      !verifyReverseSkillManifestAttestation(input, publisherSecret)
    ) {
      throw new SkillAttestationError("Skill publisher attestation is missing, unknown, or invalid");
    }
    const installed = await this.#installedSkillResolver(manifest.metadata.id, manifest.metadata.version);
    if (!installed || installed.artifactDigest !== manifest.metadata.artifactDigest) {
      throw new TypeError("Skill manifest does not match an installed adapter artifact");
    }
    const previous = await this.#store.getReverseSkillRegistration(manifest.metadata.id, manifest.metadata.version);
    const observedNow = this.#clock();
    if (!(observedNow instanceof Date) || Number.isNaN(observedNow.getTime())) {
      throw new TypeError("Application clock must return a valid Date");
    }
    const registeredAt = previous && observedNow.getTime() <= Date.parse(previous.registeredAt)
      ? new Date(Date.parse(previous.registeredAt) + 1)
      : observedNow;
    const registration = createReverseSkillRegistration({
      ...manifest,
      status: input.status,
      attestation: input.attestation,
    }, () => registeredAt);
    await this.#store.appendReverseSkillRegistration(registration);
    return registration;
  }

  async listReverseSkills() {
    return this.#store.listReverseSkills();
  }

  async executeReverseRun(input, options = {}) {
    if (!this.#reverseOrchestrator) throw new TypeError("Reverse Skill execution is not configured");
    if (Object.hasOwn(input ?? {}, "createdAt")) {
      throw new TypeError("Reverse input creation time is assigned by the server");
    }
    if (Object.hasOwn(input ?? {}, "policyContext")) {
      throw new TypeError("Reverse Skill policy context is assigned by the server");
    }
    const projectId = requireId(input?.projectId, "projectId");
    const runId = requireId(input?.id, "reverseRun.id");
    const snapshotManifestId = requireId(input?.snapshotManifestId, "reverseRun.snapshotManifestId");
    const sourceComponentId = requireId(input?.sourceComponentId, "reverseRun.sourceComponentId");
    if (!Array.isArray(input?.factBundleIds) || input.factBundleIds.length === 0) {
      throw new TypeError("reverseRun.factBundleIds must be a non-empty array");
    }
    if (!Array.isArray(input?.skills) || input.skills.length === 0) {
      throw new TypeError("reverseRun.skills must be a non-empty array");
    }
    const factBundleIds = input.factBundleIds.map((bundleId, index) =>
      requireId(bundleId, `reverseRun.factBundleIds[${index}]`),
    );
    if (new Set(factBundleIds).size !== factBundleIds.length) {
      throw new TypeError("reverseRun.factBundleIds must not contain duplicates");
    }
    const factBundles = await this.#store.getFactBundles(projectId, factBundleIds);
    if (!factBundles) throw new PersistenceConflictError("One or more Fact Bundles were not found in the project");
    const policy = (await this.#skillPolicyResolver(projectId)) ?? {};
    if (typeof policy !== "object" || Array.isArray(policy)) {
      throw new TypeError("Reverse Skill policy must be an object");
    }
    const policyMaxInputNodes = policy.maxInputNodes ?? 20_000;
    if (!Number.isSafeInteger(policyMaxInputNodes) || policyMaxInputNodes < 1 || policyMaxInputNodes > 100_000) {
      throw new TypeError("Reverse Skill policy.maxInputNodes must be an integer between 1 and 100000");
    }
    if (input.maxInputNodes !== undefined && input.maxInputNodes > policyMaxInputNodes) {
      throw new RangeError("reverseRun.maxInputNodes exceeds the server policy");
    }
    const inputPackage = createReverseInputPackage({
      projectId,
      snapshotManifestId,
      sourceComponentId,
      factBundles,
      taskScope: input.taskScope ?? {},
      policyContext: policy.inputContext ?? {},
      maxInputNodes: input.maxInputNodes ?? policyMaxInputNodes,
    }, this.#clock);
    const registrations = [];
    const selectedSkills = new Set();
    const selectedRegistrationIds = new Set();
    for (const [index, skillRef] of input.skills.entries()) {
      const skillId = requireId(skillRef?.id, `reverseRun.skills[${index}].id`);
      const version = requireId(skillRef?.version, `reverseRun.skills[${index}].version`);
      const selectionKey = `${skillId}\u0000${version}`;
      if (selectedSkills.has(selectionKey)) throw new TypeError("reverseRun.skills must not contain duplicates");
      selectedSkills.add(selectionKey);
      const registration = await this.#store.getReverseSkillRegistration(skillId, version);
      if (!registration) {
        throw new PersistenceConflictError(`ReverseSkill ${skillId}${version ? `@${version}` : ""} is not registered`);
      }
      if (selectedRegistrationIds.has(registration.id)) {
        throw new TypeError("reverseRun.skills must resolve to distinct Skill registrations");
      }
      selectedRegistrationIds.add(registration.id);
      registrations.push(registration);
    }
    const run = await this.#reverseOrchestrator.execute({
      runId,
      inputPackage,
      registrations,
      modelProfile: input.modelProfile ?? null,
      policy,
      signal: options.signal ?? null,
    });
    await this.#store.appendReverseRun(projectId, run);
    return run;
  }

  async getReverseRun(projectId, runId) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    return this.#store.getReverseRun(projectId, runId);
  }

  listAnalysisModelProfiles() {
    if (!this.#analysisModelRegistry) throw new TypeError("Analysis model registry is not configured");
    return this.#analysisModelRegistry.list();
  }

  configureAnalysisModelProfile(input) {
    if (!this.#analysisModelRegistry) throw new TypeError("Analysis model registry is not configured");
    return this.#analysisModelRegistry.configure(input);
  }

  async verifyAnalysisModelProfile(profileId) {
    if (!this.#analysisModelRegistry) throw new TypeError("Analysis model registry is not configured");
    return this.#analysisModelRegistry.verify(requireId(profileId, "analysisModelProfileId"));
  }

  removeAnalysisModelProfile(profileId, options = {}) {
    if (!this.#analysisModelRegistry) throw new TypeError("Analysis model registry is not configured");
    return this.#analysisModelRegistry.remove(requireId(profileId, "analysisModelProfileId"), options);
  }

  async #analysisInputs(input) {
    if (!this.#analysisAgent) throw new TypeError("Analysis Agent is not configured");
    const projectId = requireId(input?.projectId, "analysisRequest.projectId");
    const snapshotManifestId = requireId(input?.snapshotManifestId, "analysisRequest.snapshotManifestId");
    const sourceComponentId = requireId(input?.sourceComponentId, "analysisRequest.sourceComponentId");
    const [manifest, factGraph] = await Promise.all([
      this.#store.getSnapshotManifest(projectId, snapshotManifestId),
      this.#store.getSnapshotFactGraph(projectId, snapshotManifestId, 1_000_000),
    ]);
    if (!manifest) throw new PersistenceConflictError(`SnapshotManifest ${snapshotManifestId} does not exist in project ${projectId}`);
    if (manifest.components?.source?.id !== sourceComponentId) {
      throw new PersistenceConflictError("Analysis source component must belong to the selected Snapshot Manifest");
    }
    if (factGraph.nodes.length === 0) throw new PersistenceConflictError("Analysis requires deterministic Facts for the selected Snapshot");
    const baselineResult = input.baselineRunId
      ? await this.#store.getAnalysisResult(projectId, input.baselineRunId)
      : await this.#store.getLatestAnalysisResult(projectId);
    if (input.baselineRunId && !baselineResult) {
      throw new PersistenceConflictError(`Baseline AnalysisRun ${input.baselineRunId} does not exist`);
    }
    if (baselineResult?.projectId !== undefined && baselineResult.projectId !== projectId) {
      throw new PersistenceConflictError("Analysis baseline must belong to the same project");
    }
    return { projectId, snapshotManifestId, factGraph, baselineResult };
  }

  #withActiveAnalysisModel(input) {
    if (!input?.profile?.model?.enabled || input.profile.model.profileId) return input;
    throw new TypeError("An explicit analysis model profile revision is required");
  }

  async executeAnalysisRun(input, options = {}) {
    const request = this.#withActiveAnalysisModel(input);
    const context = await this.#analysisInputs(request);
    return this.#analysisAgent.execute(request, {
      factGraph: context.factGraph,
      baselineResult: context.baselineResult,
      signal: options.signal ?? null,
      maximumCompletedWorkUnits: options.maximumCompletedWorkUnits ?? Infinity,
    });
  }

  async submitAnalysisRun(input) {
    const request = this.#withActiveAnalysisModel(input);
    const runId = requireId(request?.id, "analysisRequest.id");
    const projectId = requireId(request?.projectId, "analysisRequest.projectId");
    const identity = `${projectId}\u0000${runId}`;
    const existing = await this.#analysisAgent?.getRun(projectId, runId);
    if (existing) return existing;
    const planned = await this.executeAnalysisRun(request, { maximumCompletedWorkUnits: 0 });
    if (planned?.status === "COMPLETED" || planned?.status === "COMPLETED_WITH_GAPS") return planned;
    const controller = new AbortController();
    this.#analysisControllers.set(identity, controller);
    Promise.resolve()
      .then(() => this.executeAnalysisRun(request, { signal: controller.signal }))
      .catch(() => {})
      .finally(() => this.#analysisControllers.delete(identity));
    return planned;
  }

  async getAnalysisRun(projectId, runId) {
    if (!this.#analysisAgent) throw new TypeError("Analysis Agent is not configured");
    return this.#analysisAgent.getRun(requireId(projectId, "projectId"), requireId(runId, "runId"));
  }

  async pauseAnalysisRun(projectId, runId) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    const checkpoint = await this.getAnalysisRun(projectId, runId);
    if (!checkpoint) return null;
    if (["COMPLETED", "COMPLETED_WITH_GAPS", "CANCELLED"].includes(checkpoint.run.status)) {
      throw new PersistenceConflictError(`AnalysisRun ${runId} is already ${checkpoint.run.status}`);
    }
    this.#analysisControllers.get(`${projectId}\u0000${runId}`)?.abort();
    return this.#analysisAgent.pauseRun(projectId, runId);
  }

  async resumeAnalysisRun(projectId, runId) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    const checkpoint = await this.getAnalysisRun(projectId, runId);
    if (!checkpoint) return null;
    if (["COMPLETED", "COMPLETED_WITH_GAPS", "CANCELLED"].includes(checkpoint.run.status)) {
      throw new PersistenceConflictError(`AnalysisRun ${runId} is already ${checkpoint.run.status}`);
    }
    const identity = `${projectId}\u0000${runId}`;
    if (this.#analysisControllers.has(identity)) return checkpoint;
    const controller = new AbortController();
    this.#analysisControllers.set(identity, controller);
    Promise.resolve()
      .then(() => this.executeAnalysisRun(checkpoint.request, { signal: controller.signal }))
      .catch(() => {})
      .finally(() => this.#analysisControllers.delete(identity));
    return checkpoint;
  }

  async getLatestAnalysisResult(projectId) {
    if (!this.#analysisAgent) throw new TypeError("Analysis Agent is not configured");
    return this.#analysisAgent.getLatestResult(requireId(projectId, "projectId"));
  }

  async getAnalysisCandidateHistory(projectId, candidateId) {
    if (!this.#analysisAgent) throw new TypeError("Analysis Agent is not configured");
    return this.#analysisAgent.getCandidateHistory(requireId(projectId, "projectId"), requireId(candidateId, "candidateId"));
  }

  async submitReverseRun(input) {
    const job = createReverseRunJob(input, this.#clock);
    const existing = await this.#store.getReverseRunJob(job.projectId, job.id);
    if (existing) {
      if (canonicalJson(existing.job.request) !== canonicalJson(job.request)) {
        throw new PersistenceConflictError(`ReverseRunJob ${job.id} already exists with a different request`);
      }
      return this.getReverseRunJobProjection(job.projectId, job.id);
    }
    if (await this.#store.getReverseRun(job.projectId, job.id)) {
      throw new PersistenceConflictError(`ReverseRun ${job.id} already exists without an asynchronous job record`);
    }
    const queued = createReverseRunJobEvent({
      id: contentId("REVERSE-RUN-JOB-EVENT", { jobId: job.id, sequence: 1, status: "QUEUED" }),
      jobId: job.id,
      status: "QUEUED",
      details: {},
    }, this.#clock);
    await this.#store.appendReverseRunJob(job.projectId, job, queued);
    const controller = new AbortController();
    this.#reverseJobControllers.set(`${job.projectId}\u0000${job.id}`, controller);
    Promise.resolve()
      .then(() => this.#runReverseJob(job, controller))
      .catch(() => {});
    return this.getReverseRunJobProjection(job.projectId, job.id);
  }

  async #appendReverseJobStatus(projectId, jobId, status, details = {}) {
    const stored = await this.#store.getReverseRunJob(projectId, jobId);
    if (!stored) throw new PersistenceConflictError(`ReverseRunJob ${jobId} does not exist`);
    const sequence = stored.events.length + 1;
    const event = createReverseRunJobEvent({
      id: contentId("REVERSE-RUN-JOB-EVENT", { jobId, sequence, status }),
      jobId,
      status,
      details,
    }, this.#clock);
    return this.#store.appendReverseRunJobEvent(projectId, event);
  }

  async #runReverseJob(job, controller) {
    const identity = `${job.projectId}\u0000${job.id}`;
    try {
      if (controller.signal.aborted) {
        await this.#appendReverseJobStatus(job.projectId, job.id, "CANCELLED", { phase: "BEFORE_START" });
        return;
      }
      await this.#appendReverseJobStatus(job.projectId, job.id, "STARTED", {});
      const run = await this.executeReverseRun(job.request, { signal: controller.signal });
      await this.#appendReverseJobStatus(
        job.projectId,
        job.id,
        run.status === "CANCELLED" ? "CANCELLED" : run.status === "FAILED" ? "FAILED" : "COMPLETED",
        { runStatus: run.status },
      );
    } catch (error) {
      await this.#appendReverseJobStatus(
        job.projectId,
        job.id,
        controller.signal.aborted || error?.name === "AbortError" ? "CANCELLED" : "FAILED",
        { error: { name: error?.name ?? "Error", message: error?.message ?? "Reverse run failed" } },
      );
    } finally {
      this.#reverseJobControllers.delete(identity);
    }
  }

  async getReverseRunJobProjection(projectId, jobId) {
    requireId(projectId, "projectId");
    requireId(jobId, "jobId");
    const stored = await this.#store.getReverseRunJob(projectId, jobId);
    if (!stored) return null;
    const run = await this.#store.getReverseRun(projectId, jobId);
    return projectReverseRunJob(stored.job, stored.events, run);
  }

  async cancelReverseRun(projectId, jobId) {
    requireId(projectId, "projectId");
    requireId(jobId, "jobId");
    const projection = await this.getReverseRunJobProjection(projectId, jobId);
    if (!projection) return null;
    if (projection.terminal) throw new PersistenceConflictError(`ReverseRunJob ${jobId} is already ${projection.status}`);
    if (!projection.cancelRequested) {
      await this.#appendReverseJobStatus(projectId, jobId, "CANCEL_REQUESTED", {});
    }
    const controller = this.#reverseJobControllers.get(`${projectId}\u0000${jobId}`);
    if (controller) controller.abort();
    else await this.#appendReverseJobStatus(projectId, jobId, "CANCELLED", { phase: "RECOVERY" });
    return this.getReverseRunJobProjection(projectId, jobId);
  }

  async resumeReverseRun(projectId, jobId) {
    requireId(projectId, "projectId");
    requireId(jobId, "jobId");
    const projection = await this.getReverseRunJobProjection(projectId, jobId);
    if (!projection) return null;
    if (projection.terminal) throw new PersistenceConflictError(`ReverseRunJob ${jobId} is already ${projection.status}`);
    const identity = `${projectId}\u0000${jobId}`;
    if (this.#reverseJobControllers.has(identity)) return projection;
    if (projection.cancelRequested) {
      await this.#appendReverseJobStatus(projectId, jobId, "CANCELLED", { phase: "RECOVERY" });
      return this.getReverseRunJobProjection(projectId, jobId);
    }
    const stored = await this.#store.getReverseRunJob(projectId, jobId);
    const controller = new AbortController();
    this.#reverseJobControllers.set(identity, controller);
    Promise.resolve()
      .then(() => this.#runReverseJob(stored.job, controller))
      .catch(() => {});
    return this.getReverseRunJobProjection(projectId, jobId);
  }

  async reviewReverseCandidate(projectId, runId, candidateId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    requireId(candidateId, "candidateId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("candidate review input must be an object");
    }
    assertOnlyFields(
      input,
      ["id", "outcome", "rationale", "candidateFeatureId", "acknowledgedConflictIds", "target", "normative"],
      "candidateReview",
    );
    for (const serverField of ["actorId", "actorRole", "reviewedAt", "projectId", "runId", "candidateId"]) {
      if (Object.hasOwn(input, serverField)) throw new TypeError(`${serverField} is assigned by the server or route`);
    }
    const outcome = input.outcome;
    if (!Object.hasOwn(CandidateReviewOutcome, outcome)) {
      throw new TypeError(`candidateReview.outcome must be one of: ${Object.keys(CandidateReviewOutcome).join(", ")}`);
    }

    const reviewer = await this.#reviewerResolver(projectId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError();
    const actorId = requireId(reviewer.actorId, "reviewer.actorId");
    const actorRole = requireId(reviewer.actorRole, "reviewer.actorRole");

    const run = await this.#store.getReverseRun(projectId, runId);
    if (!run) throw new PersistenceConflictError(`ReverseRun ${runId} does not exist in project ${projectId}`);
    if (run.status !== "WAITING_REVIEW" || !run.mergedOutput) {
      throw new PersistenceConflictError("Only a successful ReverseRun waiting for review can be baselined");
    }
    const candidate = run.mergedOutput.candidateClaims.find((item) => item.id === candidateId);
    if (!candidate) throw new PersistenceConflictError(`Candidate Claim ${candidateId} does not exist in ReverseRun ${runId}`);

    const policy = (await this.#reviewPolicyResolver(projectId, { reviewer, run, candidate })) ?? {};
    if (!Array.isArray(policy.allowedRoles) || !policy.allowedRoles.includes(actorRole)) {
      throw new ReviewAuthorizationError(`Role ${actorRole} cannot review reverse candidates in this project`);
    }
    if (!Array.isArray(policy.allowedOutcomes) || !policy.allowedOutcomes.includes(input.outcome)) {
      throw new ReviewAuthorizationError(`Outcome ${input.outcome} is not allowed by the review policy`);
    }

    const acknowledgedConflictIds = input.acknowledgedConflictIds ?? [];
    if (!Array.isArray(acknowledgedConflictIds) || new Set(acknowledgedConflictIds).size !== acknowledgedConflictIds.length) {
      throw new TypeError("acknowledgedConflictIds must be an array without duplicates");
    }
    const relatedConflicts = run.mergedOutput.conflicts.filter((conflict) => conflict.candidateIds.includes(candidateId));
    const relatedConflictIds = new Set(relatedConflicts.map((conflict) => conflict.id));
    if (acknowledgedConflictIds.some((id) => !relatedConflictIds.has(id))) {
      throw new TypeError("acknowledgedConflictIds contains a conflict unrelated to the candidate");
    }
    if (outcome === CandidateReviewOutcome.CONFIRMED && relatedConflicts.length > 0) {
      throw new PersistenceConflictError("A conflicted candidate cannot be confirmed until the conflict is resolved or recorded as an exception");
    }
    if (
      outcome === CandidateReviewOutcome.EXCEPTION_RECORDED &&
      relatedConflicts.some((conflict) => !acknowledgedConflictIds.includes(conflict.id))
    ) {
      throw new TypeError("Every related conflict must be explicitly acknowledged for EXCEPTION_RECORDED");
    }

    const requestFingerprint = contentId("CANDIDATE-REVIEW-REQUEST", {
      projectId,
      runId,
      candidateId,
      actorId,
      actorRole,
      input,
    });
    const existingReview = await this.#store.getReverseCandidateReview(projectId, runId, candidateId);
    if (existingReview) {
      if (
        existingReview.review.id === input.id &&
        existingReview.review.requestFingerprint === requestFingerprint
      ) {
        return existingReview;
      }
      throw new PersistenceConflictError(`Candidate ${candidateId} already has an immutable review`);
    }

    const baselining = [CandidateReviewOutcome.CONFIRMED, CandidateReviewOutcome.EXCEPTION_RECORDED].includes(outcome);
    if (!baselining) {
      if (input.target !== undefined || input.normative !== undefined || input.candidateFeatureId !== undefined) {
        throw new TypeError(`${outcome} review must not create a normative baseline`);
      }
      const review = createReverseCandidateReview({
        id: input.id,
        requestFingerprint,
        runId,
        candidateId,
        outcome,
        rationale: input.rationale,
        actorId,
        actorRole,
        acknowledgedConflictIds,
        baselineRefs: null,
      }, this.#clock);
      return this.#store.appendReverseCandidateReview(projectId, {
        review,
        feature: null,
        scope: null,
        claim: null,
        decision: null,
        implementationMapping: null,
        conformance: null,
      });
    }

    const target = input.target;
    const normative = input.normative;
    if (!target || typeof target !== "object" || Array.isArray(target)) throw new TypeError("target is required");
    if (!normative || typeof normative !== "object" || Array.isArray(normative)) throw new TypeError("normative is required");
    assertOnlyFields(
      target,
      [
        "featureMode", "featureId", "claimId", "scopeId", "decisionId",
        "featureName", "businessDomain", "featureDescription", "associationRationale",
      ],
      "target",
    );
    assertOnlyFields(
      normative,
      [
        "statement", "constraint", "scope", "effectiveFrom", "effectiveTo",
        "authorityEvidenceRefs", "decisionContent", "validUntil",
      ],
      "normative",
    );
    const featureMode = target.featureMode;
    if (!["CREATE", "EXISTING"].includes(featureMode)) throw new TypeError("target.featureMode must be CREATE or EXISTING");
    const featureId = requireId(target.featureId, "target.featureId");
    const existingBaseline = await this.#store.getFeatureBaseline(projectId, featureId);
    let feature = null;
    let selectedFeature;
    if (featureMode === "CREATE") {
      if (existingBaseline) throw new PersistenceConflictError(`Feature ${featureId} already exists`);
      const candidateFeatureId = requireId(input.candidateFeatureId, "candidateFeatureId");
      const candidateFeature = run.mergedOutput.candidateFeatures.find((item) => item.id === candidateFeatureId);
      if (!candidateFeature) throw new PersistenceConflictError(`Candidate Feature ${candidateFeatureId} does not exist in ReverseRun ${runId}`);
      if (candidateFeature.externalKey !== candidate.subjectKey && !target.associationRationale) {
        throw new TypeError("target.associationRationale is required when Feature and Claim candidate keys differ");
      }
      feature = createFeatureVersion({
        id: featureId,
        version: 1,
        name: target.featureName ?? candidateFeature.name,
        businessDomain: target.businessDomain,
        description: target.featureDescription ?? candidateFeature.descriptions[0] ?? null,
      }, this.#clock);
      selectedFeature = feature;
    } else {
      if (!existingBaseline) throw new PersistenceConflictError(`Feature ${featureId} does not exist`);
      if (!target.associationRationale) {
        throw new TypeError(
          "target.associationRationale is required when attaching a reverse candidate to an existing Feature",
        );
      }
      if (input.candidateFeatureId !== undefined) {
        const candidateFeatureId = requireId(input.candidateFeatureId, "candidateFeatureId");
        if (!run.mergedOutput.candidateFeatures.some((item) => item.id === candidateFeatureId)) {
          throw new PersistenceConflictError(`Candidate Feature ${candidateFeatureId} does not exist in ReverseRun ${runId}`);
        }
      }
      selectedFeature = existingBaseline.feature;
    }

    if (!normative.constraint || typeof normative.constraint !== "object" || Array.isArray(normative.constraint)) {
      throw new TypeError("normative.constraint is required for deterministic conformance assessment");
    }
    const scope = createClaimScope({
      id: target.scopeId,
      version: 1,
      scope: normative.scope,
      effectiveFrom: normative.effectiveFrom,
      effectiveTo: normative.effectiveTo,
    }, this.#clock);
    const evidenceSupport = relatedConflicts.length > 0
      ? EvidenceSupport.CONTRADICTED
      : candidate.sources.length > 1
        ? EvidenceSupport.MULTI_SOURCE
        : EvidenceSupport.SINGLE_SOURCE;
    const factIds = [...new Set(candidate.evidence.map((item) => item.factId))];
    const claim = createClaim({
      id: target.claimId,
      version: 1,
      featureId,
      type: "NORMATIVE_REQUIREMENT",
      statement: normative.statement,
      sourceType: "HUMAN",
      evidenceSupport,
      constraint: normative.constraint,
      scopeId: scope.id,
      scopeVersion: scope.version,
      provenance: {
        kind: "REVERSE_CANDIDATE_HUMAN_BASELINE",
        reverseRunId: runId,
        candidateId,
        candidateFeatureId: input.candidateFeatureId ?? null,
        candidateFeatureAssociationRationale: target.associationRationale ?? null,
        candidateStatements: candidate.statements,
        candidateConstraint: candidate.constraint,
        candidateSources: candidate.sources,
        factEvidence: candidate.evidence,
      },
    }, this.#clock);
    const authorityEvidenceRefs = normative.authorityEvidenceRefs ?? [];
    if (!Array.isArray(authorityEvidenceRefs)) throw new TypeError("normative.authorityEvidenceRefs must be an array");
    const decision = createDecision({
      id: target.decisionId,
      claimId: claim.id,
      claimVersion: claim.version,
      scopeId: scope.id,
      scopeVersion: scope.version,
      type: outcome,
      content: normative.decisionContent,
      actorId,
      actorRole,
      evidenceRefs: [...factIds, ...authorityEvidenceRefs],
      validUntil: normative.validUntil,
    }, this.#clock);
    const implementationMapping = createImplementationMapping({
      claimId: claim.id,
      claimVersion: claim.version,
      scopeId: scope.id,
      scopeVersion: scope.version,
      snapshotManifestId: run.snapshotManifestId,
      sourceComponentId: run.sourceComponentId,
      sourceRunId: runId,
      sourceCandidateId: candidateId,
      factRefs: candidate.evidence,
    }, this.#clock);
    const conformanceStatus = relatedConflicts.length > 0
      ? ConformanceStatus.CONFLICTED
      : assessImplementationConformance(claim.constraint, candidate.constraint);
    const conformance = createImplementationConformance({
      claimId: claim.id,
      claimVersion: claim.version,
      scopeId: scope.id,
      scopeVersion: scope.version,
      snapshotManifestId: run.snapshotManifestId,
      mappingId: implementationMapping.id,
      status: conformanceStatus,
      evidenceRefs: factIds,
      analysisMethod: {
        type: "DETERMINISTIC_CONSTRAINT_COMPARISON",
        version: "1.0.0",
        reverseRunId: runId,
        candidateId,
      },
    }, this.#clock);
    const review = createReverseCandidateReview({
      id: input.id,
      requestFingerprint,
      runId,
      candidateId,
      outcome,
      rationale: input.rationale,
      actorId,
      actorRole,
      acknowledgedConflictIds,
      baselineRefs: {
        featureId,
        featureVersion: selectedFeature.version,
        scopeId: scope.id,
        scopeVersion: scope.version,
        claimId: claim.id,
        claimVersion: claim.version,
        decisionId: decision.id,
        implementationMappingId: implementationMapping.id,
        conformanceId: conformance.id,
      },
    }, this.#clock);
    return this.#store.appendReverseCandidateReview(projectId, {
      review,
      feature,
      scope,
      claim,
      decision,
      implementationMapping,
      conformance,
    });
  }

  async listReverseCandidateReviews(projectId, runId) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    return this.#store.listReverseCandidateReviews(projectId, runId);
  }

  async reanalyzeImplementation(projectId, featureId, claimId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    requireId(claimId, "claimId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("implementation reanalysis input must be an object");
    }
    assertOnlyFields(
      input,
      ["id", "sourceRunId", "sourceCandidateId", "rationale", "acknowledgedConflictIds"],
      "implementationReanalysis",
    );
    for (const serverField of ["actorId", "actorRole", "analyzedAt", "projectId", "featureId", "claimId"]) {
      if (Object.hasOwn(input, serverField)) throw new TypeError(`${serverField} is assigned by the server or route`);
    }
    const analysisId = requireId(input.id, "implementationReanalysis.id");
    const sourceRunId = requireId(input.sourceRunId, "implementationReanalysis.sourceRunId");
    const sourceCandidateId = requireId(input.sourceCandidateId, "implementationReanalysis.sourceCandidateId");
    const rationale = requireId(input.rationale, "implementationReanalysis.rationale");
    const acknowledgedConflictIds = input.acknowledgedConflictIds ?? [];
    if (
      !Array.isArray(acknowledgedConflictIds) ||
      acknowledgedConflictIds.some((id) => typeof id !== "string" || id.trim() === "") ||
      new Set(acknowledgedConflictIds).size !== acknowledgedConflictIds.length
    ) {
      throw new TypeError("acknowledgedConflictIds must be an array of unique non-empty strings");
    }

    const reviewer = await this.#implementationReviewerResolver(projectId, requestContext);
    if (!reviewer) throw new ReviewAuthenticationError("A trusted implementation reviewer identity is required");
    const actorId = requireId(reviewer.actorId, "implementationReviewer.actorId");
    const actorRole = requireId(reviewer.actorRole, "implementationReviewer.actorRole");
    const policy = (await this.#implementationPolicyResolver(projectId, { reviewer, featureId, claimId })) ?? {};
    if (!Array.isArray(policy.allowedRoles) || !policy.allowedRoles.includes(actorRole)) {
      throw new ReviewAuthorizationError(`Role ${actorRole} cannot approve implementation reanalysis in this project`);
    }

    const baseline = await this.#store.getFeatureBaseline(projectId, featureId);
    if (!baseline) throw new PersistenceConflictError(`Feature ${featureId} does not exist in project ${projectId}`);
    const governed = baseline.claims.find((item) => item.claim.id === claimId);
    if (!governed) throw new PersistenceConflictError(`Claim ${claimId} does not belong to Feature ${featureId}`);
    if (!["CONFIRMED", "EXCEPTION_RECORDED"].includes(governed.latestDecision?.type)) {
      throw new PersistenceConflictError("Implementation reanalysis requires a currently authorized normative Claim");
    }

    const run = await this.#store.getReverseRun(projectId, sourceRunId);
    if (!run) throw new PersistenceConflictError(`ReverseRun ${sourceRunId} does not exist in project ${projectId}`);
    if (run.status !== "WAITING_REVIEW" || !run.mergedOutput) {
      throw new PersistenceConflictError("Implementation reanalysis requires a successful ReverseRun waiting for review");
    }
    const candidate = run.mergedOutput.candidateClaims.find((item) => item.id === sourceCandidateId);
    if (!candidate) {
      throw new PersistenceConflictError(`Candidate Claim ${sourceCandidateId} does not exist in ReverseRun ${sourceRunId}`);
    }
    const relatedConflicts = run.mergedOutput.conflicts.filter((conflict) =>
      conflict.candidateIds.includes(sourceCandidateId),
    );
    const relatedConflictIds = new Set(relatedConflicts.map((conflict) => conflict.id));
    if (acknowledgedConflictIds.some((id) => !relatedConflictIds.has(id))) {
      throw new TypeError("acknowledgedConflictIds contains a conflict unrelated to the candidate");
    }
    if (relatedConflicts.some((conflict) => !acknowledgedConflictIds.includes(conflict.id))) {
      throw new TypeError("Every related conflict must be explicitly acknowledged for implementation reanalysis");
    }

    const requestFingerprint = contentId("IMPLEMENTATION-REANALYSIS-REQUEST", {
      projectId,
      featureId,
      claimId: governed.claim.id,
      claimVersion: governed.claim.version,
      actorId,
      actorRole,
      input,
    });
    const implementationMapping = createImplementationMapping({
      claimId: governed.claim.id,
      claimVersion: governed.claim.version,
      scopeId: governed.claim.scopeId,
      scopeVersion: governed.claim.scopeVersion,
      snapshotManifestId: run.snapshotManifestId,
      sourceComponentId: run.sourceComponentId,
      sourceRunId,
      sourceCandidateId,
      factRefs: candidate.evidence,
    }, this.#clock);
    const factIds = [...new Set(candidate.evidence.map((item) => item.factId))];
    const conformance = createImplementationConformance({
      claimId: governed.claim.id,
      claimVersion: governed.claim.version,
      scopeId: governed.claim.scopeId,
      scopeVersion: governed.claim.scopeVersion,
      snapshotManifestId: run.snapshotManifestId,
      mappingId: implementationMapping.id,
      status: relatedConflicts.length > 0
        ? ConformanceStatus.CONFLICTED
        : assessImplementationConformance(governed.claim.constraint, candidate.constraint),
      evidenceRefs: factIds,
      analysisMethod: {
        type: "AUTHORIZED_REVERSE_REANALYSIS",
        version: "1.0.0",
        analysisId,
        requestFingerprint,
        sourceRunId,
        sourceCandidateId,
        actorId,
        actorRole,
        rationale,
        acknowledgedConflictIds,
      },
    }, this.#clock);

    const existingMapping = baseline.implementationMappings.find((item) => item.id === implementationMapping.id);
    const existingConformance = baseline.conformances.find((item) => item.id === conformance.id);
    if (existingMapping || existingConformance) {
      if (
        existingMapping &&
        existingConformance &&
        existingConformance.analysisMethod?.analysisId === analysisId &&
        existingConformance.analysisMethod?.requestFingerprint === requestFingerprint
      ) {
        return deepFreeze({ implementationMapping: existingMapping, conformance: existingConformance });
      }
      throw new PersistenceConflictError(
        `Implementation mapping ${implementationMapping.id} already has a different immutable analysis`,
      );
    }
    return this.#store.appendImplementationAnalysis(projectId, { implementationMapping, conformance });
  }

  async getFeatureTraceability(projectId, featureId, snapshotManifestId, {
    persist = false,
    selectedObjectId = featureId,
    graphRevisionId = null,
  } = {}) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    requireId(snapshotManifestId, "snapshotManifestId");
    if (graphRevisionId) {
      if (persist) throw new TypeError("historical GraphRevision traceability cannot be persisted");
      const graphContext = await this.#requireGraphRevisionContext(
        projectId,
        graphRevisionId,
        snapshotManifestId,
      );
      const historical = this.#requireHistoricalFeatureTraceability(graphContext, featureId);
      if (!historical) {
        return historicalTraceabilityAvailability(
          projectId,
          graphContext,
          featureId,
          selectedObjectId,
          await this.#historicalReanalysisRecovery(projectId, graphContext),
        );
      }
      const selectionGraph = createFeatureGraphProjection(historical.traceability, {
        rootNodeId: selectedObjectId,
        depth: 8,
        limit: 100,
      });
      const selectionNode = selectionGraph.nodes.find(({ id }) => id === selectedObjectId);
      if (!selectionNode) throw new TypeError(`selectedObjectId ${selectedObjectId} is not present in Feature ${featureId}`);
      return deepFreeze({
        ...structuredClone(historical.traceability),
        selection: selectedGraphObject(selectionNode, featureId),
        graphRevisionId: graphContext.revision.id,
      });
    }
    const [baseline, snapshotManifest] = await Promise.all([
      this.#store.getFeatureBaseline(projectId, featureId),
      this.#store.getSnapshotManifest(projectId, snapshotManifestId),
    ]);
    if (!baseline) return null;
    if (!snapshotManifest) {
      throw new PersistenceConflictError(`SnapshotManifest ${snapshotManifestId} does not exist in project ${projectId}`);
    }

    const processFactRefsBySnapshot = new Map();
    for (const ref of baseline.processModel ? listBusinessProcessFactRefs(baseline.processModel) : []) {
      const refs = processFactRefsBySnapshot.get(ref.snapshotManifestId) ?? [];
      refs.push(ref.factId);
      processFactRefsBySnapshot.set(ref.snapshotManifestId, refs);
    }
    const processImplementationFacts = await Promise.all(
      [...processFactRefsBySnapshot].map(async ([referencedSnapshotManifestId, factIds]) => ({
        snapshotManifestId: referencedSnapshotManifestId,
        ...(await this.#store.getFactGraphByReferences(
          projectId,
          referencedSnapshotManifestId,
          factIds,
        )),
      })),
    );

    const claimViews = [];
    const persisted = [];
    for (const claimRecord of baseline.claims) {
      const { claim, scope, latestDecision } = claimRecord;
      const mappings = baseline.implementationMappings
        .filter((mapping) => mapping.claimId === claim.id && mapping.claimVersion === claim.version)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const currentMapping = mappings.find(
        (mapping) => mapping.snapshotManifestId === snapshotManifestId && mapping.status === "ACTIVE",
      ) ?? null;
      const displayMapping = currentMapping ?? mappings.at(-1) ?? null;
      const factIds = displayMapping ? displayMapping.factRefs.map((ref) => ref.factId) : [];
      const facts = await this.#store.getFactGraphByReferences(
        projectId,
        displayMapping?.snapshotManifestId ?? snapshotManifestId,
        factIds,
      );
      const implementation = implementationFromFacts(facts);
      const conformances = baseline.conformances
        .filter((item) => item.claimId === claim.id && item.claimVersion === claim.version)
        .sort((left, right) => left.computedAt.localeCompare(right.computedAt));
      const currentConformance = conformances.filter((item) => item.snapshotManifestId === snapshotManifestId).at(-1) ?? null;
      const latestConformance = currentConformance ?? conformances.at(-1) ?? null;
      const testSpecs = baseline.testSpecs
        .filter((testSpec) => testSpec.verifiesClaims.some(
          (reference) => reference.id === claim.id && reference.version === claim.version,
        ))
        .sort((left, right) => Number(right.approved) - Number(left.approved) || right.version - left.version || left.id.localeCompare(right.id));
      const selectedTestSpec = testSpecs[0] ?? null;
      const execution = selectedTestSpec
        ? baseline.testExecutions.find(
            (item) => item.testSpecId === selectedTestSpec.id && item.testSpecVersion === selectedTestSpec.version,
          ) ?? null
        : null;
      const evidenceBundle = execution
        ? await this.#store.getExecutionEvidence(projectId, execution.id)
        : null;
      const relatedReview = baseline.candidateReviews.find(
        (item) => item.review.baselineRefs?.claimId === claim.id && item.review.baselineRefs?.claimVersion === claim.version,
      ) ?? null;
      const conflictIds = new Set(relatedReview?.review.acknowledgedConflictIds ?? []);
      if (latestConformance?.status === ConformanceStatus.CONFLICTED && conflictIds.size === 0) {
        conflictIds.add(contentId("CONFORMANCE-CONFLICT", {
          claimId: claim.id,
          claimVersion: claim.version,
          snapshotManifestId,
        }));
      }
      const conflicts = [...conflictIds].map((id) => ({
        id,
        type: "IMPLEMENTATION_EVIDENCE_CONFLICT",
        status: "OPEN",
        reason: "The implementation evidence or reverse candidates remain conflicted for this scope.",
      }));
      const evaluationInput = {
        feature: baseline.feature,
        claim: {
          ...claim,
          authorityStatus: authorityFromDecision(latestDecision, this.#clock()),
        },
        decision: latestDecision,
        scope,
        snapshotManifest,
        implementation,
        implementationStatus: currentMapping ? "ACTIVE" : mappings.length > 0 ? "STALE" : "UNMAPPED",
        conformance: latestConformance,
        testSpec: selectedTestSpec,
        execution,
        evidence: evidenceBundle?.evidence ?? [],
        conflicts,
      };
      const traceChain = evaluateTraceChain(evaluationInput, this.#clock);
      if (persist) {
        persisted.push(await this.#store.appendTraceChainRevision(projectId, traceChain, {
          scopeVersion: scope.version,
        }));
      }
      claimViews.push({
        claim,
        scope,
        decisionHistory: claimRecord.decisionHistory,
        latestDecision,
        authorityStatus: authorityFromDecision(latestDecision, this.#clock()),
        implementationMappings: mappings,
        selectedImplementationMapping: displayMapping,
        facts,
        conformance: latestConformance,
        testSpecs,
        selectedTestSpec,
        execution,
        evidence: evidenceBundle?.evidence ?? [],
        traceChain,
      });
    }
    const traceChains = claimViews.map((item) => item.traceChain);
    const traceability = {
      feature: baseline.feature,
      processModel: baseline.processModel,
      processImplementationFacts,
      snapshotManifest,
      claims: claimViews,
      dimensions: {
        authority: claimViews.map((item) => ({ claimId: item.claim.id, status: item.traceChain.dimensions.authority })),
        conformance: claimViews.map((item) => ({ claimId: item.claim.id, status: item.traceChain.dimensions.conformance })),
        verification: claimViews.map((item) => ({ claimId: item.claim.id, status: item.traceChain.dimensions.verification })),
        freshness: claimViews.map((item) => ({ claimId: item.claim.id, status: item.traceChain.dimensions.freshness })),
        conflict: claimViews.map((item) => ({ claimId: item.claim.id, status: item.traceChain.dimensions.conflict })),
      },
      traceChains,
      gaps: traceChains.flatMap((chain) => chain.gaps.map((gap) => ({ chainId: chain.id, ...gap }))),
      persisted,
      computedAt: this.#clock().toISOString(),
    };
    const selectionGraph = createFeatureGraphProjection(traceability, {
      rootNodeId: selectedObjectId,
      depth: 8,
      limit: 100,
    });
    const selectionNode = selectionGraph.nodes.find(({ id }) => id === selectedObjectId);
    if (!selectionNode) throw new TypeError(`selectedObjectId ${selectedObjectId} is not present in Feature ${featureId}`);
    return deepFreeze({
      ...traceability,
      selection: selectedGraphObject(selectionNode, featureId),
      graphRevisionId,
    });
  }

  async recomputeFeatureTraceChains(projectId, featureId, snapshotManifestId) {
    return this.getFeatureTraceability(projectId, featureId, snapshotManifestId, { persist: true });
  }

  async getFeatureGraph(projectId, featureId, snapshotManifestId, options = {}) {
    const graphContext = options.graphRevisionId
      ? await this.#requireGraphRevisionContext(projectId, options.graphRevisionId, snapshotManifestId)
      : null;
    const rootNodeId = options.rootNodeId ?? featureId;
    const historical = graphContext
      ? this.#requireHistoricalFeatureTraceability(graphContext, featureId)
      : null;
    const traceability = graphContext && !historical ? null : await this.getFeatureTraceability(
      projectId,
      featureId,
      snapshotManifestId,
      { selectedObjectId: rootNodeId, graphRevisionId: options.graphRevisionId ?? null },
    );
    if (!traceability && !graphContext) return null;
    const projection = graphContext && !historical
      ? projectLegacyArtifactGraph(
          projectId,
          graphContext,
          featureId,
          options,
          await this.#historicalReanalysisRecovery(projectId, graphContext),
        )
      : createFeatureGraphProjection(traceability, options);
    if (!graphContext) return projection;
    const graphRevision = graphContext.revision;
    const resolverContext = { featureId, rootNodeId, snapshotManifestId };
    return deepFreeze({
      ...projection,
      ownerFeatureId: featureId,
      graphRevisionId: graphRevision.id,
      nodes: projection.nodes.map((node) => ({
        ...node,
        evidenceResolver: graphEvidenceResolver(projectId, graphRevision.id, "node", node.id, resolverContext),
      })),
      edges: projection.edges.map((edge) => ({
        ...edge,
        evidenceResolver: graphEvidenceResolver(projectId, graphRevision.id, "edge", edge.id, resolverContext),
      })),
    });
  }

  async queryFeatureGraphPath(projectId, featureId, input) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("graph path query must be an object");
    }
    assertOnlyFields(
      input,
      ["snapshotManifestId", "fromNodeId", "toNodeId", "direction", "maxDepth", "view", "graphRevisionId"],
      "graphPathQuery",
    );
    const snapshotManifestId = requireId(input.snapshotManifestId, "snapshotManifestId");
    const graph = await this.getFeatureGraph(projectId, featureId, snapshotManifestId, {
      view: input.view ?? "traceability",
      depth: 8,
      limit: 100,
      rootNodeId: input.fromNodeId,
      graphRevisionId: input.graphRevisionId,
    });
    if (!graph) return null;
    return deepFreeze({
      center: graph.center,
      snapshotManifestId: graph.snapshotManifestId,
      ...(graph.graphRevisionId ? { graphRevisionId: graph.graphRevisionId } : {}),
      ...(graph.ownerFeatureId ? { ownerFeatureId: graph.ownerFeatureId } : {}),
      ...(graph.historicalAvailability ? { historicalAvailability: graph.historicalAvailability } : {}),
      view: graph.view,
      query: {
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        direction: input.direction ?? "ANY",
        maxDepth: input.maxDepth ?? 8,
      },
      ...resolveFeatureGraphPath(graph, input),
    });
  }

  async #historicalReanalysisRecovery(projectId, { revision }) {
    if (!this.#legacyUnderstandingRuntime) {
      return deepFreeze({
        executable: false,
        reasonCode: "HISTORICAL_REANALYSIS_RUNTIME_NOT_CONFIGURED",
        message: "Historical reanalysis is not configured on this Traqen server.",
        snapshotManifestId: revision.snapshotManifestId,
        graphRevisionId: revision.id,
      });
    }
    return this.#legacyUnderstandingRuntime.describeHistoricalReanalysis(projectId, revision.id);
  }

  async #requireGraphRevisionContext(projectId, graphRevisionId, snapshotManifestId = null) {
    const revision = await this.#store.getUnderstandingRecord(projectId, "GRAPH_REVISION", graphRevisionId);
    if (!revision || revision.status !== "PUBLISHED") {
      throw new PersistenceConflictError(`Published GraphRevision ${graphRevisionId} was not found`);
    }
    if (snapshotManifestId && revision.snapshotManifestId !== snapshotManifestId) {
      throw new PersistenceConflictError(`GraphRevision ${graphRevisionId} does not own SnapshotManifest ${snapshotManifestId}`);
    }
    const artifact = await this.#store.getUnderstandingRecord(projectId, "GRAPH_ARTIFACT", revision.graphArtifactId);
    if (!artifact || artifact.graphArtifactDigest !== revision.graphArtifactDigest) {
      throw new PersistenceConflictError(`GraphRevision ${graphRevisionId} graph artifact is missing or digest-mismatched`);
    }
    return deepFreeze({ revision, artifact });
  }

  #requireHistoricalFeatureTraceability({ revision, artifact }, featureId) {
    const historical = artifact.featureTraceability?.find((item) => item.featureId === featureId);
    if (!historical?.traceability) {
      if (graphArtifactSchemaVersion(artifact) === 1) return null;
      throw new PersistenceConflictError(
        `GraphRevision ${revision.id} has no immutable traceability snapshot for Feature ${featureId}`,
      );
    }
    if (
      historical.traceability.feature?.id !== featureId
      || historical.traceability.snapshotManifest?.id !== revision.snapshotManifestId
    ) {
      throw new PersistenceConflictError(
        `GraphRevision ${revision.id} has an invalid traceability snapshot for Feature ${featureId}`,
      );
    }
    return historical;
  }

  async resolveGraphEvidence(projectId, revisionId, kind, evidenceId, context) {
    requireId(projectId, "projectId");
    requireId(revisionId, "revisionId");
    requireId(evidenceId, "evidenceId");
    if (!["node", "edge", "object"].includes(kind)) throw new TypeError("evidence kind must be node, edge, or object");
    const snapshotManifestId = requireId(context?.snapshotManifestId, "snapshotManifestId");
    const featureId = requireId(context?.featureId, "featureId");
    const rootNodeId = requireId(context?.rootNodeId, "rootNodeId");
    const graphContext = await this.#requireGraphRevisionContext(projectId, revisionId, snapshotManifestId);
    const revision = graphContext.revision;
    const projection = await this.getFeatureGraph(projectId, featureId, snapshotManifestId, {
      rootNodeId,
      graphRevisionId: revisionId,
      depth: 8,
      limit: 100,
      view: "traceability",
    });
    const unavailableResolution = (historicalAvailability) => deepFreeze({
      resolved: false,
      status: "UNAVAILABLE_REQUIRES_REANALYSIS",
      kind,
      id: evidenceId,
      object: null,
      historicalAvailability,
      context: {
        projectId,
        featureId,
        rootNodeId,
        snapshotManifestId,
        graphRevisionId: revision.id,
        graphArtifactId: revision.graphArtifactId,
        graphArtifactDigest: revision.graphArtifactDigest,
        objectType: context?.objectType ?? null,
        executionId: context?.executionId ?? null,
      },
    });
    if (
      kind !== "object"
      && projection.historicalAvailability
      && projection.historicalAvailability.reasonCode !== "IMMUTABLE_TRACEABILITY_SNAPSHOT_NOT_CAPTURED"
    ) {
      return unavailableResolution(projection.historicalAvailability);
    }
    let resolved;
    if (kind === "edge") {
      resolved = projection.edges.find(({ id }) => id === evidenceId);
    } else if (kind === "node") {
      resolved = projection.nodes.find(({ id }) => id === evidenceId);
    } else {
      const traceability = await this.getFeatureTraceability(projectId, featureId, snapshotManifestId, {
        selectedObjectId: rootNodeId,
        graphRevisionId: revisionId,
      });
      if (traceability.historicalAvailability) {
        return unavailableResolution(traceability.historicalAvailability);
      }
      resolved = traceabilityEvidenceObjects(traceability).find((candidate) =>
        candidate.value.id === evidenceId
        && (!context?.objectType || candidate.objectType === context.objectType)
        && (!context?.executionId || candidate.executionId === context.executionId))?.value;
    }
    return deepFreeze({
      resolved: Boolean(resolved),
      status: resolved ? "RESOLVED" : "MISSING",
      kind,
      id: evidenceId,
      object: resolved ?? null,
      context: {
        projectId,
        featureId,
        rootNodeId,
        snapshotManifestId,
        graphRevisionId: revision.id,
        graphArtifactId: revision.graphArtifactId,
        graphArtifactDigest: revision.graphArtifactDigest,
        objectType: context?.objectType ?? null,
        executionId: context?.executionId ?? null,
      },
    });
  }

  async compareAndPersistSnapshots(projectId, input) {
    requireId(projectId, "projectId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("change-set comparison input must be an object");
    }
    assertOnlyFields(input, ["id", "fromSnapshotManifestId", "toSnapshotManifestId"], "changeSet");
    const changeSetId = requireId(input.id, "changeSet.id");
    const fromSnapshotManifestId = requireId(input.fromSnapshotManifestId, "fromSnapshotManifestId");
    const toSnapshotManifestId = requireId(input.toSnapshotManifestId, "toSnapshotManifestId");
    if (fromSnapshotManifestId === toSnapshotManifestId) {
      throw new TypeError("fromSnapshotManifestId and toSnapshotManifestId must differ");
    }
    const existing = await this.#store.getChangeImpact(projectId, changeSetId);
    if (existing) {
      if (
        existing.changeSet.fromSnapshotManifestId === fromSnapshotManifestId &&
        existing.changeSet.toSnapshotManifestId === toSnapshotManifestId
      ) {
        return existing;
      }
      throw new PersistenceConflictError(`ChangeSet ${changeSetId} already compares a different Snapshot pair`);
    }
    const [fromManifest, toManifest, fromGraph, toGraph, mappings] = await Promise.all([
      this.#store.getSnapshotManifest(projectId, fromSnapshotManifestId),
      this.#store.getSnapshotManifest(projectId, toSnapshotManifestId),
      this.#store.getSnapshotFactGraph(projectId, fromSnapshotManifestId),
      this.#store.getSnapshotFactGraph(projectId, toSnapshotManifestId),
      this.#store.listImplementationMappings(projectId),
    ]);
    if (!fromManifest || !toManifest) {
      throw new PersistenceConflictError("Both Snapshot Manifests must exist in the project");
    }
    const changes = compareFactGraphs(fromGraph, toGraph);
    const warnings = [];
    if (!fromGraph.complete) warnings.push("FROM_FACT_GRAPH_INCOMPLETE");
    if (!toGraph.complete) warnings.push("TO_FACT_GRAPH_INCOMPLETE");
    const changeSet = createChangeSet({
      id: changeSetId,
      fromSnapshotManifestId,
      toSnapshotManifestId,
      complete: fromManifest.complete && toManifest.complete && fromGraph.complete && toGraph.complete,
      warnings,
      changes,
    }, this.#clock);

    const artifactByFactRef = new Map([
      ...fromGraph.nodes.map((node) => [node.factId, node.source?.artifact ?? null]),
      ...fromGraph.edges.map((edge) => [edge.id, edge.source?.artifact ?? null]),
    ]);
    const changedBeforeRefs = new Map(
      changes.filter((change) => change.beforeFactId).map((change) => [change.beforeFactId, change]),
    );
    const addedByArtifact = new Map();
    for (const change of changes.filter((item) => item.kind === "ADDED" && item.artifact)) {
      const current = addedByArtifact.get(change.artifact) ?? [];
      current.push(change);
      addedByArtifact.set(change.artifact, current);
    }
    const baselineCache = new Map();
    const affectedMappings = [];
    const continuityPackages = [];
    const fromIndexes = graphEntityIndexes(fromGraph);
    const toIndexes = graphEntityIndexes(toGraph);
    for (const mapping of mappings.filter(
      (item) => item.snapshotManifestId === fromSnapshotManifestId && item.status === "ACTIVE",
    )) {
      const directChanges = mapping.factRefs.map((ref) => changedBeforeRefs.get(ref.factId)).filter(Boolean);
      const mappedArtifacts = new Set(mapping.factRefs.map((ref) => artifactByFactRef.get(ref.factId)).filter(Boolean));
      const conservativeAdditions = [...mappedArtifacts].flatMap((artifact) => addedByArtifact.get(artifact) ?? []);
      const relevant = [...new Map([...directChanges, ...conservativeAdditions].map((change) => [change.id, change])).values()];
      let baseline = baselineCache.get(mapping.featureId);
      if (!baseline) {
        baseline = await this.#store.getFeatureBaseline(projectId, mapping.featureId);
        baselineCache.set(mapping.featureId, baseline);
      }
      const testSpecIds = (baseline?.testSpecs ?? [])
        .filter((testSpec) => testSpec.verifiesClaims.some(
          (claimRef) => claimRef.id === mapping.claimId && claimRef.version === mapping.claimVersion,
        ))
        .map((testSpec) => testSpec.id);
      if (relevant.length > 0) {
        affectedMappings.push({
          ...mapping,
          changeIds: relevant.map((change) => change.id),
          testSpecIds,
        });
        continue;
      }

      const priorConformance = (baseline?.conformances ?? [])
        .filter((item) => item.mappingId === mapping.id && item.snapshotManifestId === fromSnapshotManifestId)
        .sort((left, right) => left.computedAt.localeCompare(right.computedAt))
        .at(-1) ?? null;
      const rebindings = mapping.factRefs.map((ref) => {
        const stableProducer = fromIndexes.byFactId.get(ref.factId);
        const current = stableProducer ? toIndexes.byStableProducer.get(stableProducer) : null;
        return current
          ? { fromFactId: ref.factId, toFactId: current.factId, relation: ref.relation }
          : null;
      });
      if (!priorConformance || rebindings.some((item) => item === null)) continue;
      const implementationMapping = createImplementationMapping({
        claimId: mapping.claimId,
        claimVersion: mapping.claimVersion,
        scopeId: mapping.scopeId,
        scopeVersion: mapping.scopeVersion,
        snapshotManifestId: toSnapshotManifestId,
        sourceComponentId: toManifest.components.source.id,
        sourceRunId: mapping.sourceRunId,
        sourceCandidateId: mapping.sourceCandidateId,
        factRefs: rebindings.map((item) => ({ factId: item.toFactId, relation: item.relation })),
      }, this.#clock);
      const conformance = createImplementationConformance({
        claimId: mapping.claimId,
        claimVersion: mapping.claimVersion,
        scopeId: mapping.scopeId,
        scopeVersion: mapping.scopeVersion,
        snapshotManifestId: toSnapshotManifestId,
        mappingId: implementationMapping.id,
        status: priorConformance.status,
        evidenceRefs: rebindings.map((item) => item.toFactId),
        analysisMethod: {
          type: "SEMANTIC_FACT_CONTINUITY",
          version: "1.0.0",
          changeSetId,
          derivedFromMappingId: mapping.id,
          derivedFromConformanceId: priorConformance.id,
        },
      }, this.#clock);
      const continuity = createImplementationContinuity({
        changeSetId,
        featureId: mapping.featureId,
        claimId: mapping.claimId,
        claimVersion: mapping.claimVersion,
        scopeId: mapping.scopeId,
        scopeVersion: mapping.scopeVersion,
        fromSnapshotManifestId,
        toSnapshotManifestId,
        fromMappingId: mapping.id,
        toMappingId: implementationMapping.id,
        fromConformanceId: priorConformance.id,
        toConformanceId: conformance.id,
        factRefRebindings: rebindings,
      });
      continuityPackages.push({ continuity, implementationMapping, conformance });
    }
    const impact = createImpactAssessment({
      changeSet,
      affectedMappings,
      continuities: continuityPackages.map((item) => item.continuity),
    }, this.#clock);
    return this.#store.appendChangeImpact(projectId, {
      changeSet,
      impact,
      continuities: continuityPackages,
    });
  }

  async getChangeImpact(projectId, changeSetId) {
    requireId(projectId, "projectId");
    requireId(changeSetId, "changeSetId");
    const governed = await this.#store.getChangeImpact(projectId, changeSetId);
    if (governed) return governed;
    for (const artifact of await this.#store.listUnderstandingRecords(projectId, "GRAPH_ARTIFACT")) {
      if (artifact.changeSet?.id === changeSetId) {
        return deepFreeze({
          changeSet: artifact.changeSet,
          impact: artifact.impactAssessment,
          revalidationPlan: artifact.revalidationPlan,
          graphArtifactId: artifact.id,
        });
      }
    }
    return null;
  }

  async getContinuousProtectionAssessment(projectId, changeSetId) {
    requireId(projectId, "projectId");
    requireId(changeSetId, "changeSetId");
    const changeImpact = await this.#store.getChangeImpact(projectId, changeSetId);
    if (!changeImpact) return null;
    const policy = await this.#continuousProtectionPolicyResolver(projectId, { changeImpact });
    const conservative = changeImpact.changeSet.complete !== true || changeImpact.changeSet.warnings.length > 0;
    const requestedTestSpecIds = [...new Set([
      ...changeImpact.impact.affectedTestSpecIds,
      ...(policy?.fixedHighRiskTestSpecIds ?? []),
      ...(conservative ? policy?.conservativeTestSpecIds ?? [] : []),
    ])];
    const testSpecs = (await Promise.all(
      requestedTestSpecIds.map((testSpecId) => this.#store.getTestSpec(projectId, testSpecId)),
    )).filter(Boolean);
    const featureIds = [...new Set([
      ...changeImpact.impact.affectedFeatureIds,
      ...testSpecs.map((testSpec) => testSpec.featureId),
      ...(policy?.highRiskFeatureIds ?? []),
    ])];
    const traceabilities = await Promise.all(featureIds.map((featureId) =>
      this.getFeatureTraceability(projectId, featureId, changeImpact.impact.toSnapshotManifestId)));
    return createContinuousProtectionAssessment({
      projectId,
      changeImpact,
      testSpecs,
      traceabilities,
      policy,
    }, this.#clock);
  }

  async getProductEffectivenessMetrics(projectId, snapshotManifestId) {
    requireId(projectId, "projectId");
    requireId(snapshotManifestId, "snapshotManifestId");
    const manifest = await this.#store.getSnapshotManifest(projectId, snapshotManifestId);
    if (!manifest) return null;
    const featureIds = await this.#store.listFeatureIds(projectId);
    const traceabilities = (await Promise.all(
      featureIds.map((featureId) => this.getFeatureTraceability(projectId, featureId, snapshotManifestId)),
    )).filter(Boolean);
    const policy = await this.#productMetricsPolicyResolver(projectId, { snapshotManifest: manifest, featureIds });
    return createProductEffectivenessMetrics({
      projectId,
      snapshotManifestId,
      traceabilities,
      highValueFeatureIds: policy?.highValueFeatureIds ?? featureIds,
    }, this.#clock);
  }

  async getPlatformOperationsMetrics(projectId) {
    requireId(projectId, "projectId");
    if (!await this.#store.getProjectFoundation(projectId)) return null;
    const observations = await this.#store.getPlatformOperationObservations(projectId);
    return createPlatformOperationsMetrics(projectId, observations, this.#clock);
  }

  async appendUnderstandingRecord(projectId, recordType, record) {
    requireId(projectId, "projectId");
    requireId(recordType, "recordType");
    if (record?.projectId !== undefined && record.projectId !== projectId) {
      throw new TypeError("understanding record projectId must match the route projectId");
    }
    return this.#store.appendUnderstandingRecord(projectId, recordType, record);
  }

  async registerUnderstandingSource(projectId, input) {
    requireId(projectId, "projectId");
    if (!this.#legacyUnderstandingRuntime) throw new TypeError("Legacy understanding runtime is not configured");
    return this.#legacyUnderstandingRuntime.registerSource({ ...input, projectId });
  }

  async getUnderstandingSourceRegistration(projectId, registrationId) {
    requireId(projectId, "projectId");
    requireId(registrationId, "registrationId");
    if (!this.#legacyUnderstandingRuntime) throw new TypeError("Legacy understanding runtime is not configured");
    return this.#legacyUnderstandingRuntime.getSourceRegistration(projectId, registrationId);
  }

  async startWorkspaceUnderstandingJob(projectId, input, options = {}) {
    requireId(projectId, "projectId");
    if (!this.#legacyUnderstandingRuntime) throw new TypeError("Legacy understanding runtime is not configured");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("workspace Analysis Job input must be an object");
    }
    assertOnlyFields(
      input,
      ["sourceRegistrationId", "requestedMode", "purpose", "policyDigest"],
      "workspaceAnalysisJob",
    );
    const activeProfile = await this.#workspaceFoundation.getActiveWorkspaceProfile(projectId);
    if (!activeProfile) {
      throw new TypeError("an active WorkspaceExecutionProfileRevision is required before starting a new Run");
    }
    return this.#legacyUnderstandingRuntime.start({
      ...input,
      projectId,
      workspaceExecutionProfileRevisionId: activeProfile.id,
    }, options);
  }

  async reanalyzeHistoricalGraphRevision(projectId, graphRevisionId, input, options = {}) {
    requireId(projectId, "projectId");
    requireId(graphRevisionId, "graphRevisionId");
    if (!this.#legacyUnderstandingRuntime) throw new TypeError("Legacy understanding runtime is not configured");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("historical reanalysis input must be an object");
    }
    assertOnlyFields(
      input,
      ["policyDigest"],
      "historicalReanalysis",
    );
    const graphContext = await this.#requireGraphRevisionContext(projectId, graphRevisionId);
    if (graphArtifactSchemaVersion(graphContext.artifact) !== 1) {
      throw new TypeError("historical reanalysis is available only for pre-v2 GraphArtifacts");
    }
    const recovery = await this.#historicalReanalysisRecovery(projectId, graphContext);
    if (!recovery.executable) {
      throw new PersistenceConflictError(
        `Historical reanalysis is unavailable [${recovery.reasonCode}]: ${recovery.message}`,
      );
    }
    return this.#legacyUnderstandingRuntime.start({
      projectId,
      sourceRegistrationId: recovery.sourceRegistrationId,
      workspaceExecutionProfileRevisionId: recovery.workspaceExecutionProfileRevisionId,
      snapshotManifestId: graphContext.revision.snapshotManifestId,
      requestedMode: "FULL",
      purpose: "HISTORICAL_REANALYSIS",
      reanalysisOfGraphRevisionId: graphRevisionId,
      ...(input.policyDigest ? { policyDigest: requireId(input.policyDigest, "policyDigest") } : {}),
    }, options);
  }

  async getWorkspaceUnderstandingJob(projectId, jobId) {
    requireId(projectId, "projectId");
    requireId(jobId, "jobId");
    if (!this.#legacyUnderstandingRuntime) throw new TypeError("Legacy understanding runtime is not configured");
    return this.#legacyUnderstandingRuntime.get(projectId, jobId);
  }

  async listWorkspaceUnderstandingJobs(projectId) {
    if (!this.#legacyUnderstandingRuntime) throw new TypeError("Legacy understanding runtime is not configured");
    return this.#legacyUnderstandingRuntime.list(projectId);
  }

  async pauseWorkspaceUnderstandingJob(projectId, jobId) {
    if (!this.#legacyUnderstandingRuntime) throw new TypeError("Legacy understanding runtime is not configured");
    return this.#legacyUnderstandingRuntime.pause(projectId, jobId);
  }

  async resumeWorkspaceUnderstandingJob(projectId, jobId) {
    if (!this.#legacyUnderstandingRuntime) throw new TypeError("Legacy understanding runtime is not configured");
    return this.#legacyUnderstandingRuntime.resume(projectId, jobId);
  }

  async cancelWorkspaceUnderstandingJob(projectId, jobId) {
    if (!this.#legacyUnderstandingRuntime) throw new TypeError("Legacy understanding runtime is not configured");
    return this.#legacyUnderstandingRuntime.cancel(projectId, jobId);
  }

  async requestSourceSlice(projectId, input, requestContext = {}) {
    requireId(projectId, "projectId");
    if (!this.#sourceSliceBroker) throw new TypeError("SourceSlice Broker is not configured");
    if (input.projectId !== projectId) throw new TypeError("SourceSlice projectId must match the route projectId");
    const request = createSourceSliceRequest(input, this.#clock);
    let claims;
    try {
      if (!this.#sourceSliceWorkerCredentialService) {
        throw new SourceSliceWorkerAuthenticationError("SourceSlice worker authentication is not configured");
      }
      claims = this.#sourceSliceWorkerCredentialService.verify(requestContext.workerCredential);
    } catch (error) {
      await this.#auditSourceSliceAuthentication(projectId, request, null, "AUTHENTICATION_FAILED");
      throw error instanceof SourceSliceWorkerAuthenticationError
        ? error
        : new SourceSliceWorkerAuthenticationError("Worker credential is invalid");
    }
    const workUnit = (await this.#store.listUnderstandingRecords(projectId, "WORK_UNIT"))
      .find((record) => record.analysisRunId === request.analysisRunId
        && (record.workUnitId ?? record.id) === request.workUnitId);
    const routeDecision = await this.#store.getUnderstandingRecord(
      projectId,
      "ANALYSIS_ROUTE_DECISION",
      claims.routeDecisionId,
    );
    const job = this.#legacyUnderstandingRuntime
      ? await this.#legacyUnderstandingRuntime.get(projectId, request.analysisRunId)
      : null;
    const scopeMatches = claims.projectId === projectId
      && claims.snapshotManifestId === request.snapshotManifestId
      && claims.analysisRunId === request.analysisRunId
      && claims.workUnitId === request.workUnitId
      && claims.policyDigest === request.policyId
      && workUnit?.analysisRunId === request.analysisRunId
      && workUnit?.snapshotManifestId === request.snapshotManifestId
      && routeDecision?.analysisRunId === request.analysisRunId
      && routeDecision?.workUnitId === request.workUnitId
      && routeDecision?.status !== "NO_ELIGIBLE_PRODUCER"
      && routeDecision?.selected?.some((producer) => canonicalJson(producer) === claims.producerKey)
      && job?.status === "RUNNING"
      && job?.phase === "ANALYSIS"
      && job?.policyDigest === request.policyId;
    if (!scopeMatches) {
      await this.#auditSourceSliceAuthentication(projectId, request, claims, "SCOPE_MISMATCH");
      throw new SourceSliceWorkerAuthorizationError("Worker credential is not authorized for this active route and WorkUnit");
    }
    try {
      await this.#store.consumeSourceSliceWorkerCredential(projectId, {
        credentialId: claims.credentialId,
        analysisRunId: request.analysisRunId,
        workUnitId: request.workUnitId,
        routeDecisionId: claims.routeDecisionId,
        consumedAt: this.#clock().toISOString(),
      });
    } catch {
      await this.#auditSourceSliceAuthentication(projectId, request, claims, "REPLAY_REJECTED");
      throw new SourceSliceWorkerAuthorizationError("Worker credential has already been used");
    }
    await this.#auditSourceSliceAuthentication(projectId, request, claims, "AUTHORIZED");
    return this.#sourceSliceBroker.read(request, {
      serviceIdentity: claims.producerKey,
      projectId,
      analysisRunId: request.analysisRunId,
      workUnitArtifactIds: workUnit.artifactIds,
      workUnitFactIds: workUnit.factIds ?? [],
    });
  }

  async issueSourceSliceWorkerCredential(projectId, input) {
    requireId(projectId, "projectId");
    if (!this.#sourceSliceWorkerCredentialService) {
      throw new SourceSliceWorkerAuthenticationError("SourceSlice worker authentication is not configured");
    }
    const job = this.#legacyUnderstandingRuntime
      ? await this.#legacyUnderstandingRuntime.get(projectId, input.analysisRunId)
      : null;
    const workUnit = (await this.#store.listUnderstandingRecords(projectId, "WORK_UNIT"))
      .find((record) => record.analysisRunId === input.analysisRunId
        && (record.workUnitId ?? record.id) === input.workUnitId);
    const routeDecision = await this.#store.getUnderstandingRecord(
      projectId,
      "ANALYSIS_ROUTE_DECISION",
      input.routeDecisionId,
    );
    const producerKey = canonicalJson(input.producer);
    if (job?.status !== "RUNNING" || job.phase !== "ANALYSIS"
      || workUnit?.analysisRunId !== input.analysisRunId
      || workUnit?.snapshotManifestId !== job.snapshotManifestId
      || routeDecision?.analysisRunId !== input.analysisRunId
      || routeDecision?.workUnitId !== input.workUnitId
      || !routeDecision?.selected?.some((producer) => canonicalJson(producer) === producerKey)) {
      throw new SourceSliceWorkerAuthorizationError("Only the selected producer for an active WorkUnit can receive a credential");
    }
    return this.#sourceSliceWorkerCredentialService.issue({
      projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      workUnitId: input.workUnitId,
      routeDecisionId: input.routeDecisionId,
      producerKey,
      policyDigest: job.policyDigest,
    });
  }

  async #auditSourceSliceAuthentication(projectId, request, claims, outcome) {
    const at = this.#clock().toISOString();
    const record = {
      id: contentId("SOURCE-SLICE-AUTH-AUDIT", {
        projectId,
        analysisRunId: request.analysisRunId,
        workUnitId: request.workUnitId,
        credentialId: claims?.credentialId ?? null,
        outcome,
        at,
      }),
      projectId,
      snapshotManifestId: request.snapshotManifestId,
      analysisRunId: request.analysisRunId,
      workUnitId: request.workUnitId,
      credentialId: claims?.credentialId ?? null,
      routeDecisionId: claims?.routeDecisionId ?? null,
      outcome,
      createdAt: at,
    };
    await this.#store.appendUnderstandingRecord(projectId, "SOURCE_SLICE_AUTH_AUDIT", record).catch(() => undefined);
  }

  async getCurrentUnderstandingGraph(projectId) {
    requireId(projectId, "projectId");
    const head = await this.#store.getCurrentGraphHead(projectId);
    if (!head) return null;
    const revision = await this.#store.getUnderstandingRecord(
      projectId,
      "GRAPH_REVISION",
      head.graphRevisionId,
    );
    if (!revision || revision.status !== "PUBLISHED") {
      throw new PersistenceConflictError("CurrentGraphHead must reference a published GraphRevision");
    }
    const graphArtifact = await this.#store.getUnderstandingRecord(
      projectId,
      "GRAPH_ARTIFACT",
      revision.graphArtifactId,
    );
    if (!graphArtifact || graphArtifact.graphArtifactDigest !== revision.graphArtifactDigest) {
      throw new PersistenceConflictError("CurrentGraphHead graph artifact is missing or digest-mismatched");
    }
    const publication = revision.dataClassification ? {
      dataClassification: revision.dataClassification,
      productionEligible: revision.productionEligible,
      evaluationEvidenceType: revision.evaluationEvidenceType,
    } : {};
    return deepFreeze({ head: { ...head, ...publication }, revision, graphArtifact });
  }

  async listGraphRevisions(projectId) {
    requireId(projectId, "projectId");
    return this.#store.listUnderstandingRecords(projectId, "GRAPH_REVISION");
  }

  async getGraphRevision(projectId, revisionId) {
    requireId(projectId, "projectId");
    requireId(revisionId, "revisionId");
    const revision = await this.#store.getUnderstandingRecord(projectId, "GRAPH_REVISION", revisionId);
    if (!revision) return null;
    const graphArtifact = await this.#store.getUnderstandingRecord(projectId, "GRAPH_ARTIFACT", revision.graphArtifactId);
    return deepFreeze({ revision, graphArtifact });
  }

  async getUnderstandingTraceChain(projectId, traceChainId) {
    const current = await this.getCurrentUnderstandingGraph(projectId);
    return current?.graphArtifact.traceChains.find(({ id }) => id === traceChainId) ?? null;
  }

  async publishGraphRevision(projectId, revisionId, expectedHeadVersion = 0) {
    requireId(projectId, "projectId");
    requireId(revisionId, "revisionId");
    return this.#store.publishGraphRevision(projectId, revisionId, expectedHeadVersion);
  }

  async getFeatureUnderstandingHistory(projectId, featureId, { selectedObjectId = featureId, graphRevisionId = null } = {}) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    if (graphRevisionId) {
      const graphContext = await this.#requireGraphRevisionContext(projectId, graphRevisionId);
      const historical = this.#requireHistoricalFeatureTraceability(graphContext, featureId);
      if (!historical) {
        return historicalTraceabilityAvailability(
          projectId,
          graphContext,
          featureId,
          selectedObjectId,
          await this.#historicalReanalysisRecovery(projectId, graphContext),
        );
      }
      const traceability = historical.traceability;
      const publishedRevisions = (await this.#store.listUnderstandingRecords(projectId, "GRAPH_REVISION"))
        .filter(({ status }) => status === "PUBLISHED")
        .sort((left, right) => (left.publishedAt ?? left.createdAt).localeCompare(right.publishedAt ?? right.createdAt));
      const selectedRevisionIndex = publishedRevisions.findIndex(({ id }) => id === graphRevisionId);
      if (selectedRevisionIndex < 0) {
        throw new PersistenceConflictError(`GraphRevision ${graphRevisionId} was not found in Feature history`);
      }
      const graphRevisions = publishedRevisions.slice(0, selectedRevisionIndex + 1);
      const uniqueByIdentity = (values, identity) => [...new Map(values.map((value) => [identity(value), value])).values()];
      const history = validateFeatureUnderstandingHistory({
        feature: traceability.feature,
        featureVersions: historical.featureVersions ?? [traceability.feature],
        decisions: uniqueByIdentity(
          (traceability.claims ?? []).flatMap(({ decisionHistory = [] }) => decisionHistory),
          ({ id }) => id,
        ),
        implementationMappings: uniqueByIdentity(
          (traceability.claims ?? []).flatMap(({ implementationMappings = [] }) => implementationMappings),
          ({ id }) => id,
        ),
        graphRevisions,
        testSpecs: uniqueByIdentity(
          (traceability.claims ?? []).flatMap(({ testSpecs = [] }) => testSpecs),
          ({ id, version }) => `${id}\u0000${version}`,
        ),
        testExecutions: uniqueByIdentity(
          (traceability.claims ?? []).map(({ execution }) => execution).filter(Boolean),
          ({ id }) => id,
        ),
      });
      if (selectedObjectId === featureId) return deepFreeze({
        ...history,
        selection: {
          id: featureId,
          type: "FEATURE",
          label: traceability.feature.name,
          authority: "GOVERNED_BASELINE",
          ownerFeatureId: featureId,
        },
        selectionHistory: history.featureVersions,
      });

      const selectionHistory = [];
      for (const revision of graphRevisions) {
        const revisionContext = await this.#requireGraphRevisionContext(projectId, revision.id);
        const featureSnapshot = revisionContext.artifact.featureTraceability
          ?.find((item) => item.featureId === featureId);
        if (!featureSnapshot?.traceability) continue;
        const projection = createFeatureGraphProjection(featureSnapshot.traceability, {
          rootNodeId: selectedObjectId,
          depth: 8,
          limit: 100,
        });
        const node = projection.nodes.find(({ id }) => id === selectedObjectId);
        if (node) {
          selectionHistory.push({
            ...node,
            graphRevisionId: revision.id,
            snapshotManifestId: revision.snapshotManifestId,
          });
        }
      }
      const current = selectionHistory.find(({ graphRevisionId: id }) => id === graphRevisionId);
      if (!current) throw new TypeError(`selectedObjectId ${selectedObjectId} has no immutable API history`);
      return deepFreeze({
        ...history,
        selection: { ...current, ownerFeatureId: featureId },
        selectionHistory,
      });
    }
    const baseline = await this.#store.getFeatureBaseline(projectId, featureId);
    if (!baseline) return null;
    const [mappings, revisions] = await Promise.all([
      this.#store.listImplementationMappings(projectId),
      this.#store.listUnderstandingRecords(projectId, "GRAPH_REVISION"),
    ]);
    const history = validateFeatureUnderstandingHistory({
      feature: baseline.feature,
      featureVersions: baseline.featureHistory ?? [baseline.feature],
      decisions: (baseline.claims ?? []).flatMap(({ decisionHistory = [] }) => decisionHistory),
      implementationMappings: mappings.filter((mapping) => mapping.featureId === featureId),
      graphRevisions: revisions.filter((revision) => revision.status === "PUBLISHED"),
      testSpecs: baseline.testSpecs ?? [],
      testExecutions: baseline.testExecutions ?? [],
    });
    if (selectedObjectId === featureId) return deepFreeze({
      ...history,
      selection: { id: featureId, type: "FEATURE", label: baseline.feature.name, authority: "GOVERNED_BASELINE", ownerFeatureId: featureId },
      selectionHistory: history.featureVersions,
    });
    const selectionHistory = [];
    for (const revision of revisions.filter(({ status }) => status === "PUBLISHED")) {
      const artifact = await this.#store.getUnderstandingRecord(projectId, "GRAPH_ARTIFACT", revision.graphArtifactId);
      const node = artifact?.nodes?.find(({ id }) => id === selectedObjectId);
      if (node) selectionHistory.push({ ...node, graphRevisionId: revision.id, snapshotManifestId: revision.snapshotManifestId });
    }
    const current = selectionHistory.find(({ graphRevisionId: id }) => id === graphRevisionId) ?? selectionHistory[0];
    if (!current) throw new TypeError(`selectedObjectId ${selectedObjectId} has no immutable API history`);
    return deepFreeze({
      ...history,
      selection: { ...current, ownerFeatureId: featureId },
      selectionHistory,
    });
  }
}
