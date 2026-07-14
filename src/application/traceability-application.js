import {
  createClaim,
  createClaimScope,
  createDecision,
  createExecutionEvidenceBundle,
  createFactBundle,
  createReverseInputPackage,
  createReverseSkillManifest,
  createReverseSkillRegistration,
  createFeatureVersion,
  createSnapshotManifest,
  createTestSpec,
  evaluateTraceChain,
  assertTestSpecSafeToStore,
  validateTestSpec as validateTestSpecProtocol,
  verifyExecutionEvidenceAttestation,
  verifyFactBundleAttestation,
  verifyReverseSkillManifestAttestation,
  FactNodeType,
  FactPredicate,
  assertEnum,
} from "../domain/index.js";
import {
  PersistenceConflictError,
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

function currentReference(value, currentId) {
  return value === undefined || value === "__CURRENT__" ? currentId : value;
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

  constructor({
    store,
    clock = () => new Date(),
    runnerKeyResolver = () => null,
    scannerKeyResolver = () => null,
    publisherKeyResolver = () => null,
    installedSkillResolver = () => null,
    skillPolicyResolver = () => ({}),
    reverseOrchestrator = null,
  }) {
    if (!store) throw new TypeError("store is required");
    if (typeof runnerKeyResolver !== "function") throw new TypeError("runnerKeyResolver must be a function");
    if (typeof scannerKeyResolver !== "function") throw new TypeError("scannerKeyResolver must be a function");
    if (typeof publisherKeyResolver !== "function") throw new TypeError("publisherKeyResolver must be a function");
    if (typeof installedSkillResolver !== "function") throw new TypeError("installedSkillResolver must be a function");
    if (typeof skillPolicyResolver !== "function") throw new TypeError("skillPolicyResolver must be a function");
    this.#store = store;
    this.#clock = clock;
    this.#runnerKeyResolver = runnerKeyResolver;
    this.#scannerKeyResolver = scannerKeyResolver;
    this.#publisherKeyResolver = publisherKeyResolver;
    this.#installedSkillResolver = installedSkillResolver;
    this.#skillPolicyResolver = skillPolicyResolver;
    this.#reverseOrchestrator = reverseOrchestrator;
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

  async appendDecision(projectId, input) {
    requireId(projectId, "projectId");
    const decision = createDecision(input, this.#clock);
    await this.#store.appendDecision(projectId, decision);
    return decision;
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

  async executeReverseRun(input) {
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
    });
    await this.#store.appendReverseRun(projectId, run);
    return run;
  }

  async getReverseRun(projectId, runId) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    return this.#store.getReverseRun(projectId, runId);
  }
}
