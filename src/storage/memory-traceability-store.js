import { canonicalJson, deepFreeze } from "../domain/index.js";
import { TraceabilityStore } from "./traceability-store.js";
import { PersistenceConflictError } from "./errors.js";

function key(projectId, id) {
  return `${projectId}\u0000${id}`;
}

function manifestIdentity(manifest) {
  const { createdAt: _createdAt, ...identity } = manifest;
  return identity;
}

function recordIdentity(record) {
  const { createdAt: _createdAt, ...identity } = record;
  return identity;
}

export class MemoryTraceabilityStore extends TraceabilityStore {
  #manifests = new Map();
  #chains = new Map();
  #features = new Map();
  #scopes = new Map();
  #claims = new Map();
  #decisions = new Map();
  #testSpecs = new Map();
  #executions = new Map();
  #evidence = new Map();
  #evidenceHashes = new Map();

  async appendSnapshotManifest(projectId, manifest) {
    const storageKey = key(projectId, manifest.id);
    const existing = this.#manifests.get(storageKey);
    if (existing && canonicalJson(manifestIdentity(existing)) !== canonicalJson(manifestIdentity(manifest))) {
      throw new PersistenceConflictError(`Snapshot manifest ${manifest.id} conflicts with an existing immutable record`);
    }
    if (!existing) this.#manifests.set(storageKey, deepFreeze(structuredClone(manifest)));
    return manifest.id;
  }

  async appendTraceChainRevision(projectId, chain, options = {}) {
    if (!this.#manifests.has(key(projectId, chain.snapshotManifestId))) {
      throw new PersistenceConflictError(`Snapshot manifest ${chain.snapshotManifestId} does not exist in project ${projectId}`);
    }
    const storageKey = key(projectId, chain.id);
    const revisions = this.#chains.get(storageKey) ?? [];
    const revision = revisions.length + 1;
    revisions.push(
      deepFreeze({
        ...structuredClone(chain),
        revision,
        scopeVersion: options.scopeVersion ?? 1,
      }),
    );
    this.#chains.set(storageKey, revisions);
    return Object.freeze({ chainId: chain.id, revision });
  }

  async getCurrentTraceChain(projectId, chainId) {
    const revisions = this.#chains.get(key(projectId, chainId));
    return revisions?.at(-1) ?? null;
  }

  #appendVersion(collection, storageKey, value, label) {
    const existing = collection.get(storageKey);
    if (existing && canonicalJson(recordIdentity(existing)) !== canonicalJson(recordIdentity(value))) {
      throw new PersistenceConflictError(`${label} conflicts with an existing immutable record`);
    }
    if (!existing) collection.set(storageKey, deepFreeze(structuredClone(value)));
    return value;
  }

  async appendFeatureVersion(projectId, feature) {
    return this.#appendVersion(
      this.#features,
      key(projectId, `${feature.id}\u0000${feature.version}`),
      feature,
      `Feature ${feature.id} version ${feature.version}`,
    );
  }

  async appendClaimScope(projectId, scope) {
    return this.#appendVersion(
      this.#scopes,
      key(projectId, `${scope.id}\u0000${scope.version}`),
      scope,
      `ClaimScope ${scope.id} version ${scope.version}`,
    );
  }

  async appendClaim(projectId, claim) {
    const featureExists = [...this.#features.entries()].some(
      ([storageKey, feature]) => storageKey.startsWith(`${projectId}\u0000`) && feature.id === claim.featureId,
    );
    if (!featureExists) {
      throw new PersistenceConflictError(`Feature ${claim.featureId} does not exist in project ${projectId}`);
    }
    if (!this.#scopes.has(key(projectId, `${claim.scopeId}\u0000${claim.scopeVersion}`))) {
      throw new PersistenceConflictError(`ClaimScope ${claim.scopeId} version ${claim.scopeVersion} does not exist`);
    }
    return this.#appendVersion(
      this.#claims,
      key(projectId, `${claim.id}\u0000${claim.version}`),
      claim,
      `Claim ${claim.id} version ${claim.version}`,
    );
  }

  async appendDecision(projectId, decision) {
    const claimKey = key(projectId, `${decision.claimId}\u0000${decision.claimVersion}`);
    const claim = this.#claims.get(claimKey);
    if (!claim) throw new PersistenceConflictError(`Claim ${decision.claimId} version ${decision.claimVersion} does not exist`);
    if (claim.scopeId !== decision.scopeId || claim.scopeVersion !== decision.scopeVersion) {
      throw new PersistenceConflictError("Decision scope must match the claim version scope");
    }
    return this.#appendVersion(
      this.#decisions,
      key(projectId, decision.id),
      decision,
      `Decision ${decision.id}`,
    );
  }

  async getFeatureBaseline(projectId, featureId) {
    const featureVersions = [...this.#features.entries()]
      .filter(([storageKey]) => storageKey.startsWith(key(projectId, `${featureId}\u0000`)))
      .map(([, value]) => value)
      .sort((left, right) => right.version - left.version);
    if (featureVersions.length === 0) return null;

    const latestClaims = new Map();
    for (const [storageKey, claim] of this.#claims.entries()) {
      if (!storageKey.startsWith(`${projectId}\u0000`) || claim.featureId !== featureId) continue;
      const current = latestClaims.get(claim.id);
      if (!current || claim.version > current.version) latestClaims.set(claim.id, claim);
    }

    const claims = [...latestClaims.values()].map((claim) => {
      const scope = this.#scopes.get(key(projectId, `${claim.scopeId}\u0000${claim.scopeVersion}`));
      const decisionHistory = [...this.#decisions.entries()]
        .filter(
          ([storageKey, decision]) =>
            storageKey.startsWith(`${projectId}\u0000`) &&
            decision.claimId === claim.id &&
            decision.claimVersion === claim.version,
        )
        .map(([, decision]) => decision);
      return { claim, scope, decisionHistory, latestDecision: decisionHistory.at(-1) ?? null };
    });

    const traceChains = [...this.#chains.entries()]
      .filter(([storageKey, revisions]) =>
        storageKey.startsWith(`${projectId}\u0000`) && revisions.at(-1)?.featureId === featureId,
      )
      .map(([, revisions]) => revisions.at(-1));

    const latestTestSpecs = new Map();
    for (const [storageKey, testSpec] of this.#testSpecs.entries()) {
      if (!storageKey.startsWith(`${projectId}\u0000`) || testSpec.featureId !== featureId) continue;
      const current = latestTestSpecs.get(testSpec.id);
      if (!current || testSpec.version > current.version) latestTestSpecs.set(testSpec.id, testSpec);
    }

    const governedTestSpecVersions = new Set(
      [...latestTestSpecs.values()].map((testSpec) => `${testSpec.id}\u0000${testSpec.version}`),
    );
    const latestExecutions = new Map();
    for (const [storageKey, record] of this.#executions.entries()) {
      if (
        !storageKey.startsWith(`${projectId}\u0000`) ||
        !governedTestSpecVersions.has(`${record.execution.testSpecId}\u0000${record.execution.testSpecVersion}`)
      ) {
        continue;
      }
      const current = latestExecutions.get(record.execution.testSpecId);
      if (!current || Date.parse(record.execution.finishedAt) > Date.parse(current.execution.finishedAt)) {
        latestExecutions.set(record.execution.testSpecId, record);
      }
    }
    const testExecutions = [...latestExecutions.values()]
      .filter(
        (record) =>
          governedTestSpecVersions.has(`${record.execution.testSpecId}\u0000${record.execution.testSpecVersion}`),
      )
      .map((record) => ({
        id: record.execution.id,
        testSpecId: record.execution.testSpecId,
        testSpecVersion: record.execution.testSpecVersion,
        snapshotManifestId: record.execution.snapshotManifestId,
        deploymentId: record.execution.deploymentId,
        status: record.execution.status,
        runner: record.execution.runner,
        finishedAt: record.execution.finishedAt,
        evidenceCount: [...this.#evidence.entries()]
          .filter(
            ([storageKey, item]) =>
              storageKey.startsWith(`${projectId}\u0000`) && item.executionId === record.execution.id,
          )
          .length,
      }))
      .sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt));

    return deepFreeze({
      feature: featureVersions[0],
      claims,
      testSpecs: [...latestTestSpecs.values()],
      testExecutions,
      traceChains,
    });
  }

  async appendTestSpec(projectId, testSpec) {
    const featureExists = [...this.#features.entries()].some(
      ([storageKey, feature]) => storageKey.startsWith(`${projectId}\u0000`) && feature.id === testSpec.featureId,
    );
    if (!featureExists) {
      throw new PersistenceConflictError(`Feature ${testSpec.featureId} does not exist in project ${projectId}`);
    }
    for (const claimRef of testSpec.verifiesClaims) {
      const claim = this.#claims.get(key(projectId, `${claimRef.id}\u0000${claimRef.version}`));
      if (!claim || claim.featureId !== testSpec.featureId) {
        throw new PersistenceConflictError(
          `Claim ${claimRef.id} version ${claimRef.version} does not belong to Feature ${testSpec.featureId}`,
        );
      }
    }
    return this.#appendVersion(
      this.#testSpecs,
      key(projectId, `${testSpec.id}\u0000${testSpec.version}`),
      testSpec,
      `TestSpec ${testSpec.id} version ${testSpec.version}`,
    );
  }

  async getTestSpec(projectId, testSpecId, version = null) {
    if (version !== null) {
      return this.#testSpecs.get(key(projectId, `${testSpecId}\u0000${version}`)) ?? null;
    }
    return (
      [...this.#testSpecs.entries()]
        .filter(([storageKey, testSpec]) =>
          storageKey.startsWith(`${projectId}\u0000`) && testSpec.id === testSpecId,
        )
        .map(([, testSpec]) => testSpec)
        .sort((left, right) => right.version - left.version)[0] ?? null
    );
  }

  async appendExecutionEvidenceBundle(projectId, bundle) {
    const { execution, evidence, attestation } = bundle;
    const testSpec = this.#testSpecs.get(
      key(projectId, `${execution.testSpecId}\u0000${execution.testSpecVersion}`),
    );
    if (!testSpec) {
      throw new PersistenceConflictError(
        `TestSpec ${execution.testSpecId} version ${execution.testSpecVersion} does not exist`,
      );
    }
    const manifest = this.#manifests.get(key(projectId, execution.snapshotManifestId));
    if (!manifest) {
      throw new PersistenceConflictError(
        `Snapshot manifest ${execution.snapshotManifestId} does not exist in project ${projectId}`,
      );
    }
    if (manifest.components?.deployment?.id !== execution.deploymentId) {
      throw new PersistenceConflictError("Execution deployment must belong to the referenced snapshot manifest");
    }

    const executionKey = key(projectId, execution.id);
    const executionRecord = deepFreeze({ execution: structuredClone(execution), attestation: structuredClone(attestation) });
    const existingExecution = this.#executions.get(executionKey);
    if (existingExecution && canonicalJson(existingExecution) !== canonicalJson(executionRecord)) {
      throw new PersistenceConflictError(`TestExecution ${execution.id} conflicts with an existing record`);
    }
    for (const item of evidence) {
      const verifiedItem = { ...item, integrity: "VERIFIED" };
      const evidenceKey = key(projectId, item.id);
      const existingEvidence = this.#evidence.get(evidenceKey);
      if (existingEvidence && canonicalJson(existingEvidence) !== canonicalJson(verifiedItem)) {
        throw new PersistenceConflictError(`Evidence ${item.id} conflicts with an existing record`);
      }
      const hashOwner = this.#evidenceHashes.get(key(projectId, item.contentHash));
      if (hashOwner && hashOwner !== item.id) {
        throw new PersistenceConflictError(`Evidence hash ${item.contentHash} already belongs to ${hashOwner}`);
      }
    }

    if (!existingExecution) this.#executions.set(executionKey, executionRecord);
    for (const item of evidence) {
      const evidenceKey = key(projectId, item.id);
      if (!this.#evidence.has(evidenceKey)) {
        this.#evidence.set(evidenceKey, deepFreeze(structuredClone({ ...item, integrity: "VERIFIED" })));
        this.#evidenceHashes.set(key(projectId, item.contentHash), item.id);
      }
    }
    return deepFreeze({ executionId: execution.id, evidenceIds: evidence.map((item) => item.id) });
  }

  async getExecutionEvidence(projectId, executionId) {
    const record = this.#executions.get(key(projectId, executionId));
    if (!record) return null;
    const evidence = [...this.#evidence.entries()]
      .filter(
        ([storageKey, item]) =>
          storageKey.startsWith(`${projectId}\u0000`) && item.executionId === executionId,
      )
      .map(([, item]) => item);
    return deepFreeze({ ...record, evidence });
  }
}
