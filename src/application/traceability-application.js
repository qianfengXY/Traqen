import {
  createClaim,
  createClaimScope,
  createBusinessProcessModel,
  createDecisionReviewCase,
  createDecisionReviewEvent,
  createReverseRunJob,
  createReverseRunJobEvent,
  createChangeSet,
  createContinuousProtectionAssessment,
  createProductEffectivenessMetrics,
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
  createFeatureGraphProjection,
  createSnapshotManifest,
  createTestSpec,
  generateEndpointTestSpecDraft,
  evaluateTraceChain,
  evaluateDecisionReviewCase,
  projectReverseRunJob,
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

function requireId(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function assertOnlyFields(value, allowedFields, fieldName) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.includes(field)) throw new TypeError(`${fieldName}.${field} is not supported`);
  }
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
  #reverseJobControllers = new Map();

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
  }

  async createProject(input) {
    const foundation = createProjectFoundation(input);
    return this.#store.appendProjectFoundation(foundation);
  }

  async getProject(projectId) {
    requireId(projectId, "projectId");
    return this.#store.getProjectFoundation(projectId);
  }

  async registerSnapshot(projectId, input) {
    requireId(projectId, "projectId");
    const manifest = createSnapshotManifest(input, this.#clock);
    await this.#store.appendSnapshotManifest(projectId, manifest);
    return manifest;
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
    await this.#store.appendFeatureVersion(projectId, feature);
    return feature;
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

  async getFeatureTraceability(projectId, featureId, snapshotManifestId, { persist = false } = {}) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    requireId(snapshotManifestId, "snapshotManifestId");
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
    return deepFreeze({
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
    });
  }

  async recomputeFeatureTraceChains(projectId, featureId, snapshotManifestId) {
    return this.getFeatureTraceability(projectId, featureId, snapshotManifestId, { persist: true });
  }

  async getFeatureGraph(projectId, featureId, snapshotManifestId, options = {}) {
    const traceability = await this.getFeatureTraceability(projectId, featureId, snapshotManifestId);
    if (!traceability) return null;
    return createFeatureGraphProjection(traceability, options);
  }

  async queryFeatureGraphPath(projectId, featureId, input) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("graph path query must be an object");
    }
    assertOnlyFields(
      input,
      ["snapshotManifestId", "fromNodeId", "toNodeId", "direction", "maxDepth", "view"],
      "graphPathQuery",
    );
    const snapshotManifestId = requireId(input.snapshotManifestId, "snapshotManifestId");
    const graph = await this.getFeatureGraph(projectId, featureId, snapshotManifestId, {
      view: input.view ?? "traceability",
      depth: 8,
      limit: 100,
    });
    if (!graph) return null;
    return deepFreeze({
      center: graph.center,
      snapshotManifestId: graph.snapshotManifestId,
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
    return this.#store.getChangeImpact(projectId, changeSetId);
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
}
