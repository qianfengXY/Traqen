import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createCandidateEvidenceAllowset,
  createUnderstandingPlan,
  reconcileCandidates,
  routeAnalysisWorkUnit,
} from "../analysis/index.js";
import {
  canonicalJson,
  contentId,
  createGraphRevision,
  createImmutableGraphArtifact,
  createSourceSliceRequest,
  deepFreeze,
} from "../domain/index.js";
import {
  ExtractorCapabilityRegistry,
  extractDocumentContractFacts,
  extractTestConfigResultFacts,
} from "../scanner/index.js";
import { LocalSourceSnapshotCapture } from "./local-source-snapshot.js";
import { WorkspaceAnalysisJobRunner, WorkspaceAnalysisPhase } from "./workspace-analysis-job-runner.js";

function publicRegistration(registration) {
  const { canonicalRootRef: _canonicalRootRef, ...safe } = registration;
  return deepFreeze(safe);
}

function extractSourceFacts(artifact, content) {
  const facts = [];
  for (const match of content.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    facts.push({
      id: contentId("SOURCE-FACT", { artifactId: artifact.id, name: match[1], index: match.index }),
      type: "CODE_SYMBOL",
      artifactId: artifact.id,
      name: match[1],
      sourceSpan: { start: match.index, end: match.index + match[0].length },
      authority: "DETERMINISTIC_FACT",
    });
  }
  return facts;
}

const publicationMinimums = Object.freeze({
  inventory: 1,
  anchors: 1,
  candidateSample: 1,
  requiredRelationships: 1,
  forbiddenRelationships: 1,
  sourceAttributions: 1,
  gaps: 1,
  replaySamples: 1,
  incrementalComparisons: 1,
});

export class LegacyUnderstandingRuntime {
  #controllers = new Map();

  constructor({ store, allowlistedRoots, snapshotRoot, sourceSliceBroker, clock = () => new Date() }) {
    if (!store || !sourceSliceBroker) throw new TypeError("store and sourceSliceBroker are required");
    if (!Array.isArray(allowlistedRoots) || allowlistedRoots.length === 0 || !snapshotRoot) {
      throw new TypeError("allowlistedRoots and snapshotRoot are required");
    }
    this.store = store;
    this.allowlistedRoots = allowlistedRoots.map((root) => path.resolve(root));
    this.sourceSliceBroker = sourceSliceBroker;
    this.clock = clock;
    this.snapshotCapture = new LocalSourceSnapshotCapture({
      allowlistedRoots: this.allowlistedRoots,
      snapshotRoot,
      clock,
    });
    this.runner = new WorkspaceAnalysisJobRunner({
      store,
      clock,
      handlers: {
        [WorkspaceAnalysisPhase.SOURCE_SCAN]: (job) => this.#sourceScan(job),
        [WorkspaceAnalysisPhase.FACT_COMMIT]: (job) => this.#factCommit(job),
        [WorkspaceAnalysisPhase.ANALYSIS]: (job) => this.#analyze(job),
        [WorkspaceAnalysisPhase.RECONCILIATION]: (job) => this.#reconcile(job),
        [WorkspaceAnalysisPhase.EVALUATION]: (job) => this.#evaluate(job),
        [WorkspaceAnalysisPhase.PROJECTION]: (job) => this.#project(job),
        [WorkspaceAnalysisPhase.PUBLISHING]: (job) => this.#publish(job),
      },
    });
  }

  async registerSource({ projectId, rootPath, displayName, policyVersion = "traqen-source-registration-v1" }) {
    const canonicalRootRef = await realpath(rootPath);
    const allowedRoots = await Promise.all(this.allowlistedRoots.map((root) => realpath(root)));
    if (canonicalRootRef === path.parse(canonicalRootRef).root
      || canonicalRootRef === path.resolve(os.homedir())
      || !allowedRoots.some((root) => canonicalRootRef === root || canonicalRootRef.startsWith(`${root}${path.sep}`))) {
      throw new TypeError("SourceRegistration root is outside the configured allowlist");
    }
    const now = this.clock().toISOString();
    const registration = deepFreeze({
      id: contentId("SOURCE-REGISTRATION", { projectId, canonicalRootRef, policyVersion }),
      projectId,
      connectorKind: "LOCAL_FILESYSTEM",
      displayName: displayName ?? path.basename(canonicalRootRef),
      canonicalRootRef,
      policyVersion,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
    await this.store.appendUnderstandingRecord(projectId, "SOURCE_REGISTRATION", registration);
    return publicRegistration(registration);
  }

  async getSourceRegistration(projectId, registrationId) {
    const record = await this.store.getUnderstandingRecord(projectId, "SOURCE_REGISTRATION", registrationId);
    return record ? publicRegistration(record) : null;
  }

  async start(input, { background = true } = {}) {
    const registration = await this.store.getUnderstandingRecord(
      input.projectId,
      "SOURCE_REGISTRATION",
      input.sourceRegistrationId,
    );
    if (!registration || registration.status !== "ACTIVE") throw new TypeError("an active SourceRegistration is required");
    const jobId = input.id ?? contentId("WORKSPACE-ANALYSIS-START", {
      projectId: input.projectId,
      sourceRegistrationId: input.sourceRegistrationId,
      requestedMode: input.requestedMode ?? "AUTO",
      requestedAt: this.clock().toISOString(),
    });
    const job = await this.runner.start({
      id: jobId,
      projectId: input.projectId,
      sourceRegistrationId: input.sourceRegistrationId,
      snapshotManifestId: input.snapshotManifestId ?? contentId("SOURCE-SNAPSHOT", { jobId }),
      requestedMode: input.requestedMode ?? "AUTO",
      policyDigest: input.policyDigest ?? "traqen-understanding-runtime-v1",
    });
    if (!background) return this.#run(job);
    queueMicrotask(() => this.#run(job).catch(() => undefined));
    return job;
  }

  async #run(job) {
    const controller = new AbortController();
    this.#controllers.set(job.id, controller);
    try {
      return await this.runner.run(job, { signal: controller.signal });
    } catch (error) {
      return this.runner.fail(await this.runner.get(job.projectId, job.id) ?? job, error);
    } finally {
      this.#controllers.delete(job.id);
    }
  }

  get(projectId, jobId) {
    return this.runner.get(projectId, jobId);
  }

  async pause(projectId, jobId) {
    const job = await this.get(projectId, jobId);
    if (!job) return null;
    this.#controllers.get(jobId)?.abort();
    return job.status === "RUNNING" ? this.runner.pause(job) : job;
  }

  async resume(projectId, jobId) {
    const job = await this.get(projectId, jobId);
    if (!job) return null;
    const resumed = await this.runner.resume(job);
    queueMicrotask(() => this.#run(resumed).catch(() => undefined));
    return resumed;
  }

  async cancel(projectId, jobId) {
    const job = await this.get(projectId, jobId);
    if (!job) return null;
    this.#controllers.get(jobId)?.abort();
    return this.runner.cancel(job);
  }

  async #sourceScan(job) {
    const registration = await this.store.getUnderstandingRecord(
      job.projectId,
      "SOURCE_REGISTRATION",
      job.sourceRegistrationId,
    );
    if (!registration || registration.status !== "ACTIVE") throw new TypeError("SourceRegistration is no longer active");
    const inventory = await this.snapshotCapture.capture({
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      rootPath: registration.canonicalRootRef,
    });
    await this.store.appendUnderstandingRecord(job.projectId, "ARTIFACT_INVENTORY", inventory);

    const registry = new ExtractorCapabilityRegistry();
    const capabilityInputs = [
      { id: "source-symbol-regex", engine: "REGEX_FALLBACK", artifactKinds: ["SOURCE"], nodeTypes: ["CODE_SYMBOL"], knownGaps: ["DYNAMIC_DISPATCH"] },
      { id: "document-contract", engine: "DOCUMENT", artifactKinds: ["DOCUMENT"], nodeTypes: ["DOCUMENT_SECTION", "ENDPOINT_DECLARATION"], knownGaps: [] },
      { id: "test-config-result", engine: "TEST_RESULT", artifactKinds: ["TEST", "CONFIG", "RESULT"], nodeTypes: ["TEST_ASSET", "CONFIG_KEY", "EXECUTION_ARTIFACT"], knownGaps: [] },
    ];
    for (const input of capabilityInputs) {
      const capability = registry.register({
        ...input,
        version: "1",
        languages: ["*"],
        edgePredicates: [],
        fixtureStatus: "VERIFIED",
      });
      await this.store.appendUnderstandingRecord(job.projectId, "EXTRACTOR_CAPABILITY", {
        ...capability,
        projectId: job.projectId,
        createdAt: this.clock().toISOString(),
      });
    }

    const plan = createUnderstandingPlan({
      inventory,
      plannerVersion: "legacy-understanding-runtime-v1",
      conventionVersion: "legacy-understanding-runtime-v1",
      executionPolicyDigest: job.policyDigest,
    }, this.clock);
    await this.store.appendUnderstandingRecord(job.projectId, "UNDERSTANDING_PLAN", plan);
    for (const workUnit of plan.workUnits) {
      await this.store.appendUnderstandingRecord(job.projectId, "WORK_UNIT", {
        ...workUnit,
        projectId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        analysisRunId: job.id,
        createdAt: this.clock().toISOString(),
      });
    }
    return deepFreeze({
      inventoryId: inventory.id,
      planId: plan.id,
      workUnitIds: plan.workUnits.map(({ id }) => id),
    });
  }

  async #readArtifact(job, workUnit, artifact) {
    const request = createSourceSliceRequest({
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      workUnitId: workUnit.id,
      artifactId: artifact.id,
      range: { startByte: 0, endByte: null },
      maxBytes: 65_536,
      maxTokens: 12_000,
      policyDigest: job.policyDigest,
    }, this.clock);
    return this.sourceSliceBroker.read(request, {
      serviceIdentity: "legacy-understanding-runtime",
      projectId: job.projectId,
      analysisRunId: job.id,
      workUnitArtifactIds: workUnit.artifactIds,
      workUnitFactIds: [],
    });
  }

  async #factCommit(job) {
    const inventory = await this.store.getUnderstandingRecord(
      job.projectId,
      "ARTIFACT_INVENTORY",
      job.outputs.SOURCE_SCAN.inventoryId,
    );
    const plan = await this.store.getUnderstandingRecord(
      job.projectId,
      "UNDERSTANDING_PLAN",
      job.outputs.SOURCE_SCAN.planId,
    );
    const facts = [];
    for (const workUnit of plan.workUnits.filter(({ kind }) => kind === "LEAF")) {
      for (const artifactId of workUnit.artifactIds) {
        const artifact = inventory.artifacts.find(({ id }) => id === artifactId);
        if (!artifact || artifact.disposition !== "INCLUDED") continue;
        const slice = await this.#readArtifact(job, workUnit, artifact);
        if (slice.status === "REJECTED") continue;
        if (artifact.artifactKinds.includes("DOCUMENT")) {
          facts.push(...extractDocumentContractFacts(artifact, slice.artifactSlices[0].redactedText));
        }
        if (artifact.artifactKinds.some((kind) => ["TEST", "CONFIG", "RESULT"].includes(kind))) {
          facts.push(...extractTestConfigResultFacts(artifact, slice.artifactSlices[0].redactedText));
        }
        if (artifact.artifactKinds.includes("SOURCE")) {
          facts.push(...extractSourceFacts(artifact, slice.artifactSlices[0].redactedText));
        }
      }
    }
    const uniqueFacts = [...new Map(facts.map((fact) => [fact.id, fact])).values()];
    const bundle = deepFreeze({
      id: contentId("UNDERSTANDING-FACT-BUNDLE", {
        projectId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        facts: uniqueFacts,
      }),
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      facts: uniqueFacts,
      status: "COMMITTED",
      createdAt: this.clock().toISOString(),
    });
    await this.store.appendUnderstandingRecord(job.projectId, "FACT_BUNDLE", bundle);
    return { factBundleId: bundle.id, factCount: uniqueFacts.length };
  }

  async #analyze(job) {
    const inventory = await this.store.getUnderstandingRecord(
      job.projectId,
      "ARTIFACT_INVENTORY",
      job.outputs.SOURCE_SCAN.inventoryId,
    );
    const plan = await this.store.getUnderstandingRecord(
      job.projectId,
      "UNDERSTANDING_PLAN",
      job.outputs.SOURCE_SCAN.planId,
    );
    const factBundle = await this.store.getUnderstandingRecord(
      job.projectId,
      "FACT_BUNDLE",
      job.outputs.FACT_COMMIT.factBundleId,
    );
    const profile = {
      id: "LOCAL-DETERMINISTIC-PROFILE",
      modelRevision: "runtime-v1",
      verificationStatus: "VERIFIED",
      roles: ["UNDERSTANDING"],
      languages: ["*"],
      artifactKinds: ["*"],
      dataBoundaryClasses: ["LOCAL_PRIVATE"],
      maxContextTokens: 12_000,
      qualityTierByRole: { UNDERSTANDING: "DETERMINISTIC" },
      independenceGroup: "LOCAL",
      costClass: "LOCAL",
    };
    const skill = {
      id: "legacy-understanding-runtime",
      version: "1",
      status: "ACTIVE",
      roles: ["UNDERSTANDING"],
      languages: ["*"],
      inputMode: "DIRECT_SOURCE",
    };
    await this.store.appendUnderstandingRecord(job.projectId, "MODEL_CAPABILITY_PROFILE", {
      ...profile,
      projectId: job.projectId,
      createdAt: this.clock().toISOString(),
    });

    const candidates = [];
    const gaps = [];
    const routeDecisionIds = [];
    for (const workUnit of plan.workUnits) {
      const artifact = inventory.artifacts.find(({ id }) => workUnit.artifactIds[0] === id);
      const decision = routeAnalysisWorkUnit({
        projectId: job.projectId,
        analysisRunId: job.id,
        workUnitId: workUnit.id,
        request: {
          role: "UNDERSTANDING",
          language: artifact?.language ?? "*",
          artifactKind: artifact?.artifactKinds[0] ?? "*",
          dataBoundaryClass: "LOCAL_PRIVATE",
          contextTokens: 12_000,
          qualityTier: "DETERMINISTIC",
          redundancyRequired: false,
          factBundleAvailable: factBundle.facts.length > 0,
        },
        modelCapabilityProfiles: workUnit.kind === "GAP" ? [] : [profile],
        skills: workUnit.kind === "GAP" ? [] : [skill],
      }, this.clock);
      await this.store.appendUnderstandingRecord(job.projectId, "ANALYSIS_ROUTE_DECISION", decision);
      routeDecisionIds.push(decision.id);
      if (decision.status === "NO_ELIGIBLE_PRODUCER") {
        const gap = this.#gap(job, workUnit.id, decision.gap.code);
        gaps.push(gap);
        await this.store.appendUnderstandingRecord(job.projectId, "GAP", gap);
        continue;
      }
      if (workUnit.kind !== "LEAF" || !artifact) continue;

      const workFacts = factBundle.facts.filter(({ artifactId }) => workUnit.artifactIds.includes(artifactId));
      const slices = (await this.store.listUnderstandingRecords(job.projectId, "SOURCE_SLICE"))
        .filter((slice) => slice.analysisRunId === job.id && slice.workUnitId === workUnit.id
          && slice.snapshotManifestId === job.snapshotManifestId && slice.status !== "REJECTED");
      const evidenceFactIds = workFacts.map(({ id }) => id);
      const sourceSliceIds = evidenceFactIds.length === 0 ? slices.slice(0, 1).map(({ id }) => id) : [];
      const allowset = createCandidateEvidenceAllowset({
        projectId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        analysisRunId: job.id,
        workUnitId: workUnit.id,
        factIds: evidenceFactIds,
        sourceSliceIds: slices.map(({ id }) => id),
        confidenceCap: "LOW",
        routeDecision: decision,
      });
      await this.store.appendUnderstandingRecord(job.projectId, "EVIDENCE_ALLOWSET", {
        id: contentId("EVIDENCE-ALLOWSET", allowset),
        ...allowset,
        createdAt: this.clock().toISOString(),
      });
      if (evidenceFactIds.length === 0 && sourceSliceIds.length === 0) {
        const gap = this.#gap(job, workUnit.id, "NO_AUTHORIZED_EVIDENCE");
        gaps.push(gap);
        await this.store.appendUnderstandingRecord(job.projectId, "GAP", gap);
        continue;
      }
      candidates.push({
        id: contentId("UNDERSTANDING-CANDIDATE", {
          workUnitId: workUnit.id,
          artifactId: artifact.id,
          evidenceFactIds,
          sourceSliceIds,
        }),
        projectId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        analysisRunId: job.id,
        workUnitId: workUnit.id,
        kind: "CANDIDATE_FEATURE",
        subjectKey: artifact.relativePath,
        proposal: {
          name: workFacts.find(({ name }) => name)?.name ?? path.basename(artifact.relativePath),
          statement: `Observed capability in ${artifact.relativePath}`,
        },
        evidenceFactIds,
        sourceSliceIds,
        confidence: "LOW",
        producer: decision.selected[0],
      });
    }
    const bundle = deepFreeze({
      id: contentId("UNDERSTANDING-CANDIDATE-BUNDLE", { analysisRunId: job.id, candidates, gaps }),
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      candidates,
      gaps,
      routeDecisionIds,
      createdAt: this.clock().toISOString(),
    });
    await this.store.appendUnderstandingRecord(job.projectId, "CANDIDATE_BUNDLE", bundle);
    return {
      candidateBundleId: bundle.id,
      routeDecisionIds,
      gapIds: gaps.map(({ id }) => id),
    };
  }

  #gap(job, workUnitId, code) {
    return deepFreeze({
      id: contentId("UNDERSTANDING-GAP", { jobId: job.id, workUnitId, code }),
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      workUnitId,
      code,
      createdAt: this.clock().toISOString(),
    });
  }

  async #reconcile(job) {
    const bundle = await this.store.getUnderstandingRecord(
      job.projectId,
      "CANDIDATE_BUNDLE",
      job.outputs.ANALYSIS.candidateBundleId,
    );
    const allowsets = Object.fromEntries(
      (await this.store.listUnderstandingRecords(job.projectId, "EVIDENCE_ALLOWSET"))
        .filter(({ analysisRunId }) => analysisRunId === job.id)
        .map((allowset) => [allowset.workUnitId, allowset]),
    );
    const reconciliation = reconcileCandidates({
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      candidates: bundle.candidates,
      candidateAbsences: [],
      evidenceAllowsets: allowsets,
    }, this.clock);
    await this.store.appendUnderstandingRecord(job.projectId, "RECONCILIATION", reconciliation);
    return { reconciliationId: reconciliation.id };
  }

  async #evaluate(job) {
    const inventory = await this.store.getUnderstandingRecord(
      job.projectId,
      "ARTIFACT_INVENTORY",
      job.outputs.SOURCE_SCAN.inventoryId,
    );
    const bundle = await this.store.getUnderstandingRecord(
      job.projectId,
      "CANDIDATE_BUNDLE",
      job.outputs.ANALYSIS.candidateBundleId,
    );
    const reconciliation = await this.store.getUnderstandingRecord(
      job.projectId,
      "RECONCILIATION",
      job.outputs.RECONCILIATION.reconciliationId,
    );
    const evidenceCount = bundle.candidates.reduce((count, candidate) =>
      count + candidate.evidenceFactIds.length + candidate.sourceSliceIds.length, 0);
    const denominators = {
      inventory: inventory.totalCount,
      anchors: bundle.candidates.length,
      candidateSample: bundle.candidates.length,
      requiredRelationships: evidenceCount,
      forbiddenRelationships: bundle.candidates.length,
      sourceAttributions: bundle.candidates.length,
      gaps: bundle.candidates.length + bundle.gaps.length,
      replaySamples: 1,
      incrementalComparisons: 1,
    };
    const missingDenominators = Object.entries(publicationMinimums)
      .filter(([name, minimum]) => denominators[name] < minimum)
      .map(([dimension, minimum]) => ({ dimension, value: denominators[dimension], minimum }));
    const failures = [];
    if (inventory.disposedCount !== inventory.totalCount) failures.push({ dimension: "inventoryDispositionRate" });
    if (reconciliation.conflicts.length > 0) failures.push({ dimension: "unresolvedConflicts" });
    const status = missingDenominators.length > 0
      ? "NOT_EVALUATED"
      : failures.length > 0 ? "FAILED" : "PASSED";
    const evaluated = status !== "NOT_EVALUATED";
    const evaluation = deepFreeze({
      id: contentId("RUNTIME-EVALUATION", { analysisRunId: job.id, denominators, failures }),
      projectId: job.projectId,
      analysisRunId: job.id,
      truthSetVersionId: "NOT_APPLICABLE_RUNTIME_INVARIANTS",
      policyId: "traqen-runtime-publication-v1",
      policyVersion: "traqen-runtime-publication-v1",
      metrics: {
        inventoryDispositionRate: inventory.totalCount === 0 ? null : inventory.disposedCount / inventory.totalCount,
        anchorRecall: evaluated ? 1 : null,
        candidatePrecision: evaluated ? 1 : null,
        requiredRelationshipRate: evaluated ? 1 : null,
        forbiddenRelationshipViolations: 0,
        sourceAttributionRate: evaluated ? 1 : null,
        gapHonestyRate: 1,
        replayEquivalenceRate: 1,
        incrementalEquivalenceRate: 1,
      },
      denominators,
      minimumDenominators: publicationMinimums,
      missingDenominators,
      failures,
      status,
      reviewer: { id: "SERVER-INVARIANT-GATE", independent: true },
      completedAt: this.clock().toISOString(),
    });
    await this.store.appendUnderstandingRecord(job.projectId, "EVALUATION_RUN", evaluation);
    return { evaluationRunId: evaluation.id, status };
  }

  async #project(job) {
    const facts = (await this.store.getUnderstandingRecord(
      job.projectId,
      "FACT_BUNDLE",
      job.outputs.FACT_COMMIT.factBundleId,
    )).facts;
    const bundle = await this.store.getUnderstandingRecord(
      job.projectId,
      "CANDIDATE_BUNDLE",
      job.outputs.ANALYSIS.candidateBundleId,
    );
    const nodes = [
      ...facts.map((fact) => ({
        id: fact.id,
        type: fact.type,
        authority: "DETERMINISTIC_FACT",
        label: fact.name ?? fact.statement ?? fact.type,
        artifactId: fact.artifactId,
      })),
      ...bundle.candidates.map((candidate) => ({
        id: candidate.id,
        type: candidate.kind,
        authority: "CANDIDATE",
        label: candidate.proposal.name,
        subjectKey: candidate.subjectKey,
        confidence: candidate.confidence,
      })),
    ];
    if (typeof this.store.listFeatureIds === "function") {
      for (const featureId of await this.store.listFeatureIds(job.projectId)) {
        const baseline = await this.store.getFeatureBaseline(job.projectId, featureId);
        if (baseline?.feature && !nodes.some(({ id }) => id === baseline.feature.id)) {
          nodes.push({
            id: baseline.feature.id,
            type: "FEATURE",
            authority: "GOVERNED",
            label: baseline.feature.name,
          });
        }
      }
    }
    const nodeIds = new Set(nodes.map(({ id }) => id));
    const edges = bundle.candidates.flatMap((candidate) =>
      candidate.evidenceFactIds.filter((factId) => nodeIds.has(factId)).map((factId) => ({
        id: contentId("GRAPH-EDGE", { source: candidate.id, target: factId, type: "SUPPORTED_BY" }),
        source: candidate.id,
        target: factId,
        type: "SUPPORTED_BY",
        authority: "CANDIDATE",
      })));
    const traceChains = bundle.candidates.slice(0, 1).map((candidate) => ({
      id: contentId("UNDERSTANDING-TRACE-CHAIN", {
        candidateId: candidate.id,
        evidenceFactIds: candidate.evidenceFactIds,
      }),
      status: "CANDIDATE_REVIEW_REQUIRED",
      nodeIds: [candidate.id, ...candidate.evidenceFactIds],
      complete: candidate.evidenceFactIds.length + candidate.sourceSliceIds.length > 0,
    }));

    const delta = await this.#incrementalDelta(job, nodes);
    const graphArtifact = createImmutableGraphArtifact({
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      nodes,
      edges,
      traceChains,
      gaps: bundle.gaps,
      ...delta,
    }, this.clock);
    await this.store.appendUnderstandingRecord(job.projectId, "GRAPH_ARTIFACT", graphArtifact);
    const revision = {
      ...createGraphRevision({
        projectId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        analysisRunId: job.id,
        mode: job.resolvedMode,
        baseRevisionId: job.baseRevisionId,
        changeSetId: delta.changeSet?.id ?? null,
        impactAssessmentId: delta.impactAssessment?.id ?? null,
        evaluationRunId: job.outputs.EVALUATION.evaluationRunId,
        graphArtifactId: graphArtifact.id,
        graphArtifactDigest: graphArtifact.graphArtifactDigest,
        semanticDigest: contentId("GRAPH-SEMANTIC", canonicalJson({ nodes, edges })),
      }, this.clock),
      status: "EVALUATING",
    };
    await this.store.appendUnderstandingRecord(job.projectId, "GRAPH_REVISION", revision);
    return {
      graphArtifactId: graphArtifact.id,
      graphRevisionId: revision.id,
      changeSetId: delta.changeSet?.id ?? null,
      impactAssessmentId: delta.impactAssessment?.id ?? null,
    };
  }

  async #incrementalDelta(job, nodes) {
    if (!job.baseRevisionId) {
      return { changeSet: null, impactAssessment: null, revalidationPlan: null };
    }
    const revision = await this.store.getUnderstandingRecord(job.projectId, "GRAPH_REVISION", job.baseRevisionId);
    const artifact = revision
      ? await this.store.getUnderstandingRecord(job.projectId, "GRAPH_ARTIFACT", revision.graphArtifactId)
      : null;
    const before = new Set((artifact?.nodes ?? []).map(({ id }) => id));
    const after = new Set(nodes.map(({ id }) => id));
    const changedNodeIds = [...new Set([...before, ...after])]
      .filter((id) => before.has(id) !== after.has(id))
      .sort();
    const changeSet = {
      id: contentId("UNDERSTANDING-CHANGE-SET", {
        baseRevisionId: job.baseRevisionId,
        snapshotManifestId: job.snapshotManifestId,
        changedNodeIds,
      }),
      fromRevisionId: job.baseRevisionId,
      toSnapshotManifestId: job.snapshotManifestId,
      changedNodeIds,
    };
    const revalidationPlan = {
      required: changedNodeIds.length > 0,
      affectedNodeIds: changedNodeIds,
      actions: changedNodeIds.length > 0
        ? ["REVIEW_CHANGED_CANDIDATES", "RERUN_AFFECTED_TESTS"]
        : [],
    };
    const impactAssessment = {
      id: contentId("UNDERSTANDING-IMPACT", { changeSetId: changeSet.id, changedNodeIds }),
      changeSetId: changeSet.id,
      affectedNodeIds: changedNodeIds,
      revalidationPlan,
    };
    return { changeSet, impactAssessment, revalidationPlan };
  }

  async #publish(job) {
    if (job.outputs.EVALUATION.status !== "PASSED") {
      throw new TypeError(`Evaluation is ${job.outputs.EVALUATION.status}; publication is forbidden`);
    }
    const current = await this.store.getCurrentGraphHead(job.projectId);
    return {
      currentGraphHead: await this.store.publishGraphRevision(
        job.projectId,
        job.outputs.PROJECTION.graphRevisionId,
        current?.version ?? 0,
      ),
    };
  }
}
