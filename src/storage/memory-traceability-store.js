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
  #projects = new Map();
  #manifests = new Map();
  #chains = new Map();
  #features = new Map();
  #scopes = new Map();
  #claims = new Map();
  #decisions = new Map();
  #businessProcessModels = new Map();
  #testSpecs = new Map();
  #executions = new Map();
  #evidence = new Map();
  #evidenceHashes = new Map();
  #factBundles = new Map();
  #reverseSkills = new Map();
  #reverseSkillSequence = new Map();
  #nextReverseSkillSequence = 0;
  #reverseRuns = new Map();
  #candidateReviews = new Map();
  #candidateReviewIds = new Map();
  #implementationMappings = new Map();
  #conformances = new Map();
  #changeImpacts = new Map();

  async appendProjectFoundation(foundation) {
    const existing = this.#projects.get(foundation.project.id);
    if (existing && canonicalJson(existing) !== canonicalJson(foundation)) {
      throw new PersistenceConflictError(`Project ${foundation.project.id} conflicts with an existing record`);
    }
    if (!existing) this.#projects.set(foundation.project.id, deepFreeze(structuredClone(foundation)));
    return this.#projects.get(foundation.project.id);
  }

  async getProjectFoundation(projectId) {
    return this.#projects.get(projectId) ?? null;
  }

  async appendSnapshotManifest(projectId, manifest) {
    const storageKey = key(projectId, manifest.id);
    const existing = this.#manifests.get(storageKey);
    if (existing && canonicalJson(manifestIdentity(existing)) !== canonicalJson(manifestIdentity(manifest))) {
      throw new PersistenceConflictError(`Snapshot manifest ${manifest.id} conflicts with an existing immutable record`);
    }
    if (!existing) this.#manifests.set(storageKey, deepFreeze(structuredClone(manifest)));
    return manifest.id;
  }

  async getSnapshotManifest(projectId, snapshotManifestId) {
    return this.#manifests.get(key(projectId, snapshotManifestId)) ?? null;
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

  async appendBusinessProcessModel(projectId, processModel) {
    if (!this.#features.has(key(projectId, `${processModel.featureId}\u0000${processModel.featureVersion}`))) {
      throw new PersistenceConflictError(
        `Feature ${processModel.featureId} version ${processModel.featureVersion} does not exist`,
      );
    }
    return this.#appendVersion(
      this.#businessProcessModels,
      key(projectId, `${processModel.id}\u0000${processModel.version}`),
      processModel,
      `BusinessProcessModel ${processModel.id} version ${processModel.version}`,
    );
  }

  async getLatestBusinessProcessModel(projectId, featureId) {
    const models = [...this.#businessProcessModels.entries()]
      .filter(([storageKey, model]) => storageKey.startsWith(`${projectId}\u0000`) && model.featureId === featureId)
      .map(([, model]) => model)
      .sort((left, right) => right.version - left.version || right.createdAt.localeCompare(left.createdAt));
    return models[0] ?? null;
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

    const currentClaimKeys = new Set(
      [...latestClaims.values()].map((claim) => `${claim.id}\u0000${claim.version}`),
    );
    const implementationMappings = [...this.#implementationMappings.entries()]
      .filter(
        ([storageKey, mapping]) =>
          storageKey.startsWith(`${projectId}\u0000`) &&
          currentClaimKeys.has(`${mapping.claimId}\u0000${mapping.claimVersion}`),
      )
      .map(([, mapping]) => mapping);
    const conformances = [...this.#conformances.entries()]
      .filter(
        ([storageKey, conformance]) =>
          storageKey.startsWith(`${projectId}\u0000`) &&
          currentClaimKeys.has(`${conformance.claimId}\u0000${conformance.claimVersion}`),
      )
      .map(([, conformance]) => conformance);
    const candidateReviews = [...this.#candidateReviews.entries()]
      .filter(
        ([storageKey, reviewPackage]) =>
          storageKey.startsWith(`${projectId}\u0000`) && reviewPackage.review.baselineRefs?.featureId === featureId,
      )
      .map(([, reviewPackage]) => reviewPackage);

    return deepFreeze({
      feature: featureVersions[0],
      processModel: await this.getLatestBusinessProcessModel(projectId, featureId),
      claims,
      testSpecs: [...latestTestSpecs.values()],
      testExecutions,
      traceChains,
      implementationMappings,
      conformances,
      candidateReviews,
    });
  }

  async listFeatureIds(projectId) {
    return deepFreeze([...new Set(
      [...this.#features.entries()]
        .filter(([storageKey]) => storageKey.startsWith(`${projectId}\u0000`))
        .map(([, feature]) => feature.id),
    )].sort());
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

  async appendFactBundle(projectId, bundle) {
    if (!this.#manifests.has(key(projectId, bundle.snapshotManifestId))) {
      throw new PersistenceConflictError(
        `Snapshot manifest ${bundle.snapshotManifestId} does not exist in project ${projectId}`,
      );
    }
    const manifest = this.#manifests.get(key(projectId, bundle.snapshotManifestId));
    if (
      manifest.components?.source?.id !== bundle.sourceComponentId ||
      manifest.components?.source?.digest !== bundle.sourceDigest
    ) {
      throw new PersistenceConflictError(
        "FactBundle source component ID and digest must match the referenced snapshot manifest",
      );
    }
    const storageKey = key(projectId, bundle.id);
    const existing = this.#factBundles.get(storageKey);
    if (existing && canonicalJson(existing) !== canonicalJson(bundle)) {
      throw new PersistenceConflictError(`FactBundle ${bundle.id} conflicts with an existing immutable record`);
    }
    if (!existing) this.#factBundles.set(storageKey, deepFreeze(structuredClone(bundle)));
    return deepFreeze({
      bundleId: bundle.id,
      snapshotManifestId: bundle.snapshotManifestId,
      sourceComponentId: bundle.sourceComponentId,
      nodeCount: bundle.nodes.length,
      edgeCount: bundle.edges.length,
      complete: bundle.complete,
    });
  }

  async queryFacts(projectId, filters = {}) {
    const observedBundles = [...this.#factBundles.entries()]
      .filter(
        ([storageKey, bundle]) =>
          storageKey.startsWith(`${projectId}\u0000`) &&
          (!filters.snapshotManifestId || bundle.snapshotManifestId === filters.snapshotManifestId),
      )
      .map(([, bundle]) => bundle)
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
    const latestBundles = new Map();
    for (const bundle of observedBundles) {
      const identity = `${bundle.snapshotManifestId}\u0000${bundle.sourceComponentId}\u0000${bundle.extractor.id}`;
      if (!latestBundles.has(identity)) latestBundles.set(identity, bundle);
    }
    const bundles = [...latestBundles.values()];
    const allNodes = bundles.flatMap((bundle) =>
      bundle.nodes.map((node) => ({ ...node, bundleId: bundle.id })),
    );
    const query = filters.query?.toLowerCase() ?? null;
    const matching = allNodes
      .filter((node) => !filters.types?.length || filters.types.includes(node.type))
      .filter(
        (node) =>
          !query ||
          node.name.toLowerCase().includes(query) ||
          node.naturalKey.toLowerCase().includes(query) ||
          node.source.artifact.toLowerCase().includes(query),
      )
      .sort((left, right) => left.naturalKey.localeCompare(right.naturalKey));
    const limit = filters.limit ?? 100;
    const truncated = matching.length > limit;
    const matchedNodes = matching.slice(0, limit);
    const matchedKeys = new Set(matchedNodes.map((node) => `${node.bundleId}\u0000${node.id}`));
    const edgeLimit = Math.min(limit * 8, 4_000);
    const matchingEdges = bundles
      .flatMap((bundle) => bundle.edges.map((edge) => ({ ...edge, bundleId: bundle.id })))
      .filter((edge) => !filters.predicates?.length || filters.predicates.includes(edge.predicate))
      .filter(
        (edge) =>
          matchedKeys.has(`${edge.bundleId}\u0000${edge.subjectId}`) ||
          matchedKeys.has(`${edge.bundleId}\u0000${edge.objectId}`),
      );
    const edges = matchingEdges.slice(0, edgeLimit);
    const graphKeys = new Set(matchedKeys);
    for (const edge of edges) {
      graphKeys.add(`${edge.bundleId}\u0000${edge.subjectId}`);
      graphKeys.add(`${edge.bundleId}\u0000${edge.objectId}`);
    }
    const nodes = allNodes.filter((node) => graphKeys.has(`${node.bundleId}\u0000${node.id}`));

    return deepFreeze({
      bundles: bundles.map((bundle) => ({
        id: bundle.id,
        snapshotManifestId: bundle.snapshotManifestId,
        sourceComponentId: bundle.sourceComponentId,
        sourceDigest: bundle.sourceDigest,
        extractor: bundle.extractor,
        observedAt: bundle.observedAt,
        complete: bundle.complete,
        diagnostics: bundle.diagnostics,
        attestation: bundle.attestation,
      })),
      matchedNodeIds: matchedNodes.map((node) => node.id),
      nodes,
      edges,
      truncated,
      edgesTruncated: matchingEdges.length > edgeLimit,
    });
  }

  async getFactBundles(projectId, bundleIds) {
    const bundles = bundleIds.map((bundleId) => this.#factBundles.get(key(projectId, bundleId)) ?? null);
    if (bundles.some((bundle) => bundle === null)) return null;
    return deepFreeze(structuredClone(bundles));
  }

  async getFactGraphByReferences(projectId, snapshotManifestId, factRefs) {
    const requested = new Set(factRefs);
    const bundles = [...this.#factBundles.entries()]
      .filter(
        ([storageKey, bundle]) =>
          storageKey.startsWith(`${projectId}\u0000`) && bundle.snapshotManifestId === snapshotManifestId,
      )
      .map(([, bundle]) => bundle);
    const selectedNodes = bundles.flatMap((bundle) =>
      bundle.nodes.filter((node) => requested.has(node.factId)).map((node) => ({ ...node, bundleId: bundle.id })),
    );
    const selectedEdges = bundles.flatMap((bundle) =>
      bundle.edges.filter((edge) => requested.has(edge.id)).map((edge) => ({ ...edge, bundleId: bundle.id })),
    );
    const endpointKeys = new Set(
      selectedEdges.flatMap((edge) => [`${edge.bundleId}\u0000${edge.subjectId}`, `${edge.bundleId}\u0000${edge.objectId}`]),
    );
    const endpointNodes = bundles.flatMap((bundle) =>
      bundle.nodes
        .filter((node) => endpointKeys.has(`${bundle.id}\u0000${node.id}`))
        .map((node) => ({ ...node, bundleId: bundle.id })),
    );
    const nodes = [...new Map([...selectedNodes, ...endpointNodes].map((node) => [`${node.bundleId}\u0000${node.id}`, node])).values()];
    const found = new Set([...selectedNodes.map((node) => node.factId), ...selectedEdges.map((edge) => edge.id)]);
    return deepFreeze({
      nodes,
      edges: selectedEdges,
      missingFactRefs: [...requested].filter((factId) => !found.has(factId)),
    });
  }

  async getSnapshotFactGraph(projectId, snapshotManifestId, maxNodes = 100_000) {
    const latest = new Map();
    for (const [storageKey, bundle] of this.#factBundles.entries()) {
      if (!storageKey.startsWith(`${projectId}\u0000`) || bundle.snapshotManifestId !== snapshotManifestId) continue;
      const identity = `${bundle.sourceComponentId}\u0000${bundle.extractor.id}`;
      const current = latest.get(identity);
      if (!current || bundle.observedAt > current.observedAt || (bundle.observedAt === current.observedAt && bundle.id > current.id)) {
        latest.set(identity, bundle);
      }
    }
    const bundles = [...latest.values()];
    const nodes = bundles.flatMap((bundle) => bundle.nodes.map((node) => ({ ...node, bundleId: bundle.id })));
    if (nodes.length > maxNodes) throw new RangeError("Snapshot Fact graph exceeds maxNodes");
    return deepFreeze({
      nodes,
      edges: bundles.flatMap((bundle) => bundle.edges.map((edge) => ({ ...edge, bundleId: bundle.id }))),
      complete: bundles.length > 0 && bundles.every((bundle) => bundle.complete),
      bundleIds: bundles.map((bundle) => bundle.id),
    });
  }

  async listImplementationMappings(projectId) {
    return deepFreeze(
      [...this.#implementationMappings.entries()]
        .filter(([storageKey]) => storageKey.startsWith(`${projectId}\u0000`))
        .map(([, mapping]) => {
          const claim = this.#claims.get(key(projectId, `${mapping.claimId}\u0000${mapping.claimVersion}`));
          return { ...structuredClone(mapping), featureId: claim?.featureId ?? null };
        }),
    );
  }

  async appendImplementationAnalysis(projectId, analysisPackage) {
    const { implementationMapping, conformance } = analysisPackage;
    const mappingKey = key(projectId, implementationMapping.id);
    const conformanceKey = key(projectId, conformance.id);
    const existingMapping = this.#implementationMappings.get(mappingKey);
    const existingConformance = this.#conformances.get(conformanceKey);
    if (existingMapping || existingConformance) {
      if (
        existingMapping &&
        existingConformance &&
        canonicalJson(existingMapping) === canonicalJson(implementationMapping) &&
        canonicalJson(existingConformance) === canonicalJson(conformance)
      ) {
        return deepFreeze({ implementationMapping: existingMapping, conformance: existingConformance });
      }
      throw new PersistenceConflictError(`Implementation analysis ${implementationMapping.id} conflicts with an existing record`);
    }
    const claim = this.#claims.get(
      key(projectId, `${implementationMapping.claimId}\u0000${implementationMapping.claimVersion}`),
    );
    if (
      !claim ||
      claim.scopeId !== implementationMapping.scopeId ||
      claim.scopeVersion !== implementationMapping.scopeVersion
    ) {
      throw new PersistenceConflictError("Implementation analysis must preserve an existing governed Claim and Scope");
    }
    const manifest = this.#manifests.get(key(projectId, implementationMapping.snapshotManifestId));
    if (!manifest) {
      throw new PersistenceConflictError(
        `Snapshot manifest ${implementationMapping.snapshotManifestId} does not exist in project ${projectId}`,
      );
    }
    if (manifest.components?.source?.id !== implementationMapping.sourceComponentId) {
      throw new PersistenceConflictError("Implementation analysis source must belong to the target Snapshot Manifest");
    }
    const run = this.#reverseRuns.get(key(projectId, implementationMapping.sourceRunId));
    if (
      !run ||
      run.snapshotManifestId !== implementationMapping.snapshotManifestId ||
      run.sourceComponentId !== implementationMapping.sourceComponentId ||
      !run.mergedOutput?.candidateClaims.some((item) => item.id === implementationMapping.sourceCandidateId)
    ) {
      throw new PersistenceConflictError("Implementation analysis must reference a candidate from the target Snapshot ReverseRun");
    }
    const targetFactIds = new Set(
      [...this.#factBundles.entries()]
        .filter(
          ([storageKey, bundle]) =>
            storageKey.startsWith(`${projectId}\u0000`) &&
            bundle.snapshotManifestId === implementationMapping.snapshotManifestId,
        )
        .flatMap(([, bundle]) => [
          ...bundle.nodes.map((node) => node.factId),
          ...bundle.edges.map((edge) => edge.id),
        ]),
    );
    if (implementationMapping.factRefs.some((reference) => !targetFactIds.has(reference.factId))) {
      throw new PersistenceConflictError("Implementation analysis Fact references must belong to the target Snapshot Manifest");
    }
    if (
      conformance.mappingId !== implementationMapping.id ||
      conformance.claimId !== implementationMapping.claimId ||
      conformance.claimVersion !== implementationMapping.claimVersion ||
      conformance.scopeId !== implementationMapping.scopeId ||
      conformance.scopeVersion !== implementationMapping.scopeVersion ||
      conformance.snapshotManifestId !== implementationMapping.snapshotManifestId
    ) {
      throw new PersistenceConflictError("Implementation analysis mapping and conformance references are inconsistent");
    }
    this.#implementationMappings.set(mappingKey, deepFreeze(structuredClone(implementationMapping)));
    this.#conformances.set(conformanceKey, deepFreeze(structuredClone(conformance)));
    return deepFreeze({
      implementationMapping: this.#implementationMappings.get(mappingKey),
      conformance: this.#conformances.get(conformanceKey),
    });
  }

  async appendReverseSkillRegistration(registration) {
    const storageKey = registration.id;
    const existing = this.#reverseSkills.get(storageKey);
    if (existing && canonicalJson(existing) !== canonicalJson(registration)) {
      throw new PersistenceConflictError(
        `ReverseSkill ${registration.manifest.metadata.id}@${registration.manifest.metadata.version} conflicts with an existing registration`,
      );
    }
    if (!existing) {
      this.#reverseSkills.set(storageKey, deepFreeze(structuredClone(registration)));
      this.#nextReverseSkillSequence += 1;
      this.#reverseSkillSequence.set(storageKey, this.#nextReverseSkillSequence);
    }
    return registration;
  }

  async listReverseSkills() {
    const latest = new Map();
    for (const registration of [...this.#reverseSkills.values()].sort((left, right) =>
      this.#reverseSkillSequence.get(right.id) - this.#reverseSkillSequence.get(left.id),
    )) {
      const identity = `${registration.manifest.metadata.id}\u0000${registration.manifest.metadata.version}`;
      if (!latest.has(identity)) latest.set(identity, registration);
    }
    return deepFreeze([...latest.values()].map((registration) => structuredClone(registration)));
  }

  async getReverseSkillRegistration(skillId, version = null) {
    return (
      [...this.#reverseSkills.values()]
        .filter(
          (registration) =>
            registration.manifest.metadata.id === skillId &&
            (version === null || registration.manifest.metadata.version === version),
        )
        .sort((left, right) =>
          this.#reverseSkillSequence.get(right.id) - this.#reverseSkillSequence.get(left.id),
        )[0] ?? null
    );
  }

  async appendReverseRun(projectId, run) {
    const storageKey = key(projectId, run.id);
    const existing = this.#reverseRuns.get(storageKey);
    if (existing && canonicalJson(existing) !== canonicalJson(run)) {
      throw new PersistenceConflictError(`ReverseRun ${run.id} conflicts with an existing immutable record`);
    }
    if (!existing) this.#reverseRuns.set(storageKey, deepFreeze(structuredClone(run)));
    return deepFreeze({ runId: run.id, status: run.status });
  }

  async getReverseRun(projectId, runId) {
    return this.#reverseRuns.get(key(projectId, runId)) ?? null;
  }

  async appendReverseCandidateReview(projectId, reviewPackage) {
    const review = reviewPackage.review;
    const reviewKey = key(projectId, `${review.runId}\u0000${review.candidateId}`);
    const reviewIdKey = key(projectId, review.id);
    const existing = this.#candidateReviews.get(reviewKey);
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(reviewPackage)) {
        throw new PersistenceConflictError(`Candidate ${review.candidateId} already has a different immutable review`);
      }
      return existing;
    }
    if (this.#candidateReviewIds.has(reviewIdKey)) {
      throw new PersistenceConflictError(`Candidate review ${review.id} already belongs to another candidate`);
    }
    const run = this.#reverseRuns.get(key(projectId, review.runId));
    if (!run) throw new PersistenceConflictError(`ReverseRun ${review.runId} does not exist in project ${projectId}`);

    const { feature, scope, claim, decision, implementationMapping, conformance } = reviewPackage;
    const baselining = review.baselineRefs !== null;
    if (
      baselining !==
      [feature, scope, claim, decision, implementationMapping, conformance].every((item, index) =>
        index === 0 ? item === null || typeof item === "object" : item !== null && typeof item === "object",
      )
    ) {
      throw new PersistenceConflictError("Candidate review baseline package is incomplete");
    }
    if (baselining) {
      const featureExists = [...this.#features.entries()].some(
        ([storageKey, item]) => storageKey.startsWith(`${projectId}\u0000`) && item.id === claim.featureId,
      );
      if (feature && featureExists) throw new PersistenceConflictError(`Feature ${feature.id} already exists`);
      if (!feature && !featureExists) throw new PersistenceConflictError(`Feature ${claim.featureId} does not exist`);
      const records = [
        [this.#scopes, key(projectId, `${scope.id}\u0000${scope.version}`), scope, `ClaimScope ${scope.id}`],
        [this.#claims, key(projectId, `${claim.id}\u0000${claim.version}`), claim, `Claim ${claim.id}`],
        [this.#decisions, key(projectId, decision.id), decision, `Decision ${decision.id}`],
        [this.#implementationMappings, key(projectId, implementationMapping.id), implementationMapping, `ImplementationMapping ${implementationMapping.id}`],
        [this.#conformances, key(projectId, conformance.id), conformance, `ImplementationConformance ${conformance.id}`],
      ];
      if (feature) {
        records.unshift([
          this.#features,
          key(projectId, `${feature.id}\u0000${feature.version}`),
          feature,
          `Feature ${feature.id}`,
        ]);
      }
      for (const [collection, storageKey, _record, label] of records) {
        if (collection.has(storageKey)) throw new PersistenceConflictError(`${label} already exists`);
      }
      if (claim.scopeId !== scope.id || claim.scopeVersion !== scope.version) {
        throw new PersistenceConflictError("Candidate baseline Claim must bind the new Scope");
      }
      if (
        decision.claimId !== claim.id ||
        decision.claimVersion !== claim.version ||
        decision.scopeId !== scope.id ||
        implementationMapping.claimId !== claim.id ||
        conformance.mappingId !== implementationMapping.id
      ) {
        throw new PersistenceConflictError("Candidate baseline references are inconsistent");
      }
      for (const [collection, storageKey, record] of records) {
        collection.set(storageKey, deepFreeze(structuredClone(record)));
      }
    }
    const stored = deepFreeze(structuredClone(reviewPackage));
    this.#candidateReviews.set(reviewKey, stored);
    this.#candidateReviewIds.set(reviewIdKey, reviewKey);
    return stored;
  }

  async getReverseCandidateReview(projectId, runId, candidateId) {
    return this.#candidateReviews.get(key(projectId, `${runId}\u0000${candidateId}`)) ?? null;
  }

  async listReverseCandidateReviews(projectId, runId) {
    return deepFreeze(
      [...this.#candidateReviews.entries()]
        .filter(
          ([storageKey, reviewPackage]) =>
            storageKey.startsWith(`${projectId}\u0000`) && reviewPackage.review.runId === runId,
        )
        .map(([, reviewPackage]) => structuredClone(reviewPackage))
        .sort((left, right) => left.review.reviewedAt.localeCompare(right.review.reviewedAt)),
    );
  }

  async appendChangeImpact(projectId, changeImpact) {
    const storageKey = key(projectId, changeImpact.changeSet.id);
    const existing = this.#changeImpacts.get(storageKey);
    const existingPair = [...this.#changeImpacts.entries()].find(
      ([candidateKey, item]) =>
        candidateKey.startsWith(`${projectId}\u0000`) &&
        item.changeSet.fromSnapshotManifestId === changeImpact.changeSet.fromSnapshotManifestId &&
        item.changeSet.toSnapshotManifestId === changeImpact.changeSet.toSnapshotManifestId,
    )?.[1];
    if (existingPair && existingPair.changeSet.id !== changeImpact.changeSet.id) {
      throw new PersistenceConflictError(
        `Snapshot pair already belongs to immutable ChangeSet ${existingPair.changeSet.id}`,
      );
    }
    if (existing && canonicalJson(existing) !== canonicalJson(changeImpact)) {
      throw new PersistenceConflictError(`ChangeSet ${changeImpact.changeSet.id} conflicts with an existing immutable record`);
    }
    if (!existing) {
      const continuityRecords = [];
      for (const item of changeImpact.continuities ?? []) {
        const { continuity, implementationMapping, conformance } = item;
        const sourceMapping = this.#implementationMappings.get(key(projectId, continuity.fromMappingId));
        if (!sourceMapping) {
          throw new PersistenceConflictError(`Continuity source mapping ${continuity.fromMappingId} does not exist`);
        }
        const sourceConformance = this.#conformances.get(key(projectId, continuity.fromConformanceId));
        if (!sourceConformance || sourceConformance.mappingId !== sourceMapping.id) {
          throw new PersistenceConflictError(
            `Continuity source conformance ${continuity.fromConformanceId} does not match its mapping`,
          );
        }
        const manifest = this.#manifests.get(key(projectId, implementationMapping.snapshotManifestId));
        if (!manifest) {
          throw new PersistenceConflictError(
            `Snapshot manifest ${implementationMapping.snapshotManifestId} does not exist in project ${projectId}`,
          );
        }
        if (manifest.components?.source?.id !== implementationMapping.sourceComponentId) {
          throw new PersistenceConflictError("Continuity mapping source must belong to the target Snapshot Manifest");
        }
        if (!this.#reverseRuns.has(key(projectId, implementationMapping.sourceRunId))) {
          throw new PersistenceConflictError(`ReverseRun ${implementationMapping.sourceRunId} does not exist`);
        }
        const claim = this.#claims.get(
          key(projectId, `${implementationMapping.claimId}\u0000${implementationMapping.claimVersion}`),
        );
        if (!claim || claim.scopeId !== implementationMapping.scopeId || claim.scopeVersion !== implementationMapping.scopeVersion) {
          throw new PersistenceConflictError("Continuity mapping must preserve the governed Claim and Scope");
        }
        if (
          continuity.featureId !== claim.featureId ||
          continuity.claimId !== implementationMapping.claimId ||
          continuity.claimVersion !== implementationMapping.claimVersion ||
          continuity.scopeId !== implementationMapping.scopeId ||
          continuity.scopeVersion !== implementationMapping.scopeVersion ||
          continuity.toMappingId !== implementationMapping.id ||
          continuity.toConformanceId !== conformance.id ||
          conformance.mappingId !== implementationMapping.id ||
          conformance.snapshotManifestId !== implementationMapping.snapshotManifestId
        ) {
          throw new PersistenceConflictError("Continuity mapping and conformance references are inconsistent");
        }
        const targetFactIds = new Set(
          [...this.#factBundles.entries()]
            .filter(
              ([storageKey, bundle]) =>
                storageKey.startsWith(`${projectId}\u0000`) &&
                bundle.snapshotManifestId === implementationMapping.snapshotManifestId,
            )
            .flatMap(([, bundle]) => [
              ...bundle.nodes.map((node) => node.factId),
              ...bundle.edges.map((edge) => edge.id),
            ]),
        );
        if (implementationMapping.factRefs.some((ref) => !targetFactIds.has(ref.factId))) {
          throw new PersistenceConflictError(
            "Continuity mapping Fact references must belong to the target Snapshot Manifest",
          );
        }
        const mappingKey = key(projectId, implementationMapping.id);
        const conformanceKey = key(projectId, conformance.id);
        if (this.#implementationMappings.has(mappingKey) || this.#conformances.has(conformanceKey)) {
          throw new PersistenceConflictError(`Continuity ${continuity.id} conflicts with an existing record`);
        }
        continuityRecords.push({ mappingKey, conformanceKey, implementationMapping, conformance });
      }
      for (const item of continuityRecords) {
        this.#implementationMappings.set(
          item.mappingKey,
          deepFreeze(structuredClone(item.implementationMapping)),
        );
        this.#conformances.set(item.conformanceKey, deepFreeze(structuredClone(item.conformance)));
      }
      this.#changeImpacts.set(storageKey, deepFreeze(structuredClone(changeImpact)));
    }
    return this.#changeImpacts.get(storageKey);
  }

  async getChangeImpact(projectId, changeSetId) {
    return this.#changeImpacts.get(key(projectId, changeSetId)) ?? null;
  }
}
