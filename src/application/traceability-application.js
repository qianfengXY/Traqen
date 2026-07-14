import {
  createClaim,
  createClaimScope,
  createDecision,
  createExecutionEvidenceBundle,
  createFeatureVersion,
  createSnapshotManifest,
  createTestSpec,
  evaluateTraceChain,
  assertTestSpecSafeToStore,
  validateTestSpec as validateTestSpecProtocol,
  verifyExecutionEvidenceAttestation,
} from "../domain/index.js";
import { PersistenceConflictError, RunnerAttestationError } from "../storage/index.js";

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

  constructor({ store, clock = () => new Date(), runnerKeyResolver = () => null }) {
    if (!store) throw new TypeError("store is required");
    if (typeof runnerKeyResolver !== "function") throw new TypeError("runnerKeyResolver must be a function");
    this.#store = store;
    this.#clock = clock;
    this.#runnerKeyResolver = runnerKeyResolver;
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
}
