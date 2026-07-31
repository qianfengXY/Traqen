import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createCandidateEvidenceAllowset,
  createUnderstandingPlan,
  reconcileCandidates,
  routeAnalysisWorkUnit,
  validateCandidateAgainstEvidenceAllowset,
} from "../analysis/index.js";
import {
  canonicalJson,
  commitChildBatchResult,
  contentId,
  createAnalysisBatch,
  createGraphRevision,
  createImmutableGraphArtifact,
  createSourceSliceRequest,
  deepFreeze,
  fanOutAnalysisBatch,
  openAnalysisBatchBarrier,
} from "../domain/index.js";
import {
  ExtractorCapabilityRegistry,
  extractDocumentContractFacts,
  extractTestConfigResultFacts,
} from "../scanner/index.js";
import { LocalSourceSnapshotCapture } from "./local-source-snapshot.js";
import { evaluateUnderstanding } from "./understanding-evaluator.js";
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
  for (const match of content.matchAll(/\b(?:import|export)\b[\s\S]{0,240}?\bfrom\s+["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    facts.push({
      id: contentId("SOURCE-REFERENCE-FACT", {
        artifactId: artifact.id,
        targetPath: match[1] ?? match[2],
        index: match.index,
      }),
      type: "SOURCE_REFERENCE",
      artifactId: artifact.id,
      targetPath: match[1] ?? match[2],
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

const traqenSelfPublicationMinimums = Object.freeze({
  inventory: 1,
  anchors: 30,
  candidateSample: 30,
  requiredRelationships: 60,
  forbiddenRelationships: 30,
  sourceAttributions: 30,
  gaps: 1,
  replaySamples: 1,
  incrementalComparisons: 1,
});

export class LegacyUnderstandingRuntime {
  #controllers = new Map();

  constructor({
    store,
    allowlistedRoots,
    snapshotRoot,
    sourceSliceBroker,
    childProducer = null,
    reviewedEvaluationResolver = null,
    clock = () => new Date(),
  }) {
    if (!store || !sourceSliceBroker) throw new TypeError("store and sourceSliceBroker are required");
    if (!Array.isArray(allowlistedRoots) || allowlistedRoots.length === 0 || !snapshotRoot) {
      throw new TypeError("allowlistedRoots and snapshotRoot are required");
    }
    this.store = store;
    this.allowlistedRoots = allowlistedRoots.map((root) => path.resolve(root));
    this.sourceSliceBroker = sourceSliceBroker;
    this.clock = clock;
    this.childProducer = childProducer;
    this.reviewedEvaluationResolver = reviewedEvaluationResolver;
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
    let profileRevisionId = input.workspaceExecutionProfileRevisionId ?? null;
    if (!profileRevisionId) {
      const localProfile = deepFreeze({
        id: "LOCAL-DETERMINISTIC-PROFILE",
        workspaceId: input.projectId,
        configId: "LOCAL-DETERMINISTIC-CONFIG",
        configVersion: 1,
        profileDigest: contentId("PROFILE-DIGEST", {
          workspaceId: input.projectId,
          kind: "LOCAL_DETERMINISTIC",
          version: 1,
        }),
        mainAgent: {
          model: "LOCAL-DETERMINISTIC-PROFILE",
          skillNames: ["legacy-understanding-runtime"],
          mcpNames: [],
        },
        childSlots: [
          { id: "CHILD-1", model: "LOCAL-DETERMINISTIC-PROFILE", skillNames: ["legacy-understanding-runtime"], mcpNames: [], independenceGroup: "LOCAL-1" },
          { id: "CHILD-2", model: "LOCAL-DETERMINISTIC-PROFILE", skillNames: ["legacy-understanding-runtime"], mcpNames: [], independenceGroup: "LOCAL-2" },
        ],
        entries: [
          { logicalName: "LOCAL-DETERMINISTIC-PROFILE", kind: "MODEL", manifest: { provider: "LOCAL_DETERMINISTIC" }, sourceTemplateId: null, credentialHandleIds: [] },
          { logicalName: "legacy-understanding-runtime", kind: "SKILL", manifest: { inputMode: "DIRECT_SOURCE" }, sourceTemplateId: null, credentialHandleIds: [] },
        ],
        dependencies: {},
        conventions: {},
        policies: { dataBoundary: "LOCAL_PRIVATE" },
        createdAt: this.clock().toISOString(),
      });
      const existing = await this.store.getUnderstandingRecord(
        input.projectId,
        "WORKSPACE_EXECUTION_PROFILE",
        localProfile.id,
      );
      if (!existing) {
        await this.store.appendUnderstandingRecord(
          input.projectId,
          "WORKSPACE_EXECUTION_PROFILE",
          localProfile,
        );
      }
      profileRevisionId = localProfile.id;
    }
    const pinnedProfile = await this.store.getUnderstandingRecord(
      input.projectId,
      "WORKSPACE_EXECUTION_PROFILE",
      profileRevisionId,
    );
    if (!pinnedProfile) throw new TypeError("an immutable WorkspaceExecutionProfileRevision is required");
    const job = await this.runner.start({
      id: jobId,
      projectId: input.projectId,
      sourceRegistrationId: input.sourceRegistrationId,
      snapshotManifestId: input.snapshotManifestId ?? contentId("SOURCE-SNAPSHOT", { jobId }),
      requestedMode: input.requestedMode ?? "AUTO",
      policyDigest: input.policyDigest ?? "traqen-understanding-runtime-v1",
      workspaceExecutionProfileRevisionId: profileRevisionId,
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
      { id: "source-symbol-regex", engine: "REGEX_FALLBACK", artifactKinds: ["SOURCE"], nodeTypes: ["CODE_SYMBOL", "SOURCE_REFERENCE"], knownGaps: ["DYNAMIC_DISPATCH"] },
      { id: "document-contract", engine: "DOCUMENT", artifactKinds: ["DOCUMENT"], nodeTypes: ["DOCUMENT_SECTION", "ENDPOINT_DECLARATION", "DOCUMENT_REFERENCE"], knownGaps: [] },
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
    const configuredExecutionProfile = await this.store.getUnderstandingRecord(
      job.projectId,
      "WORKSPACE_EXECUTION_PROFILE",
      job.workspaceExecutionProfileRevisionId,
    );
    if (!configuredExecutionProfile) {
      throw new TypeError("the pinned WorkspaceExecutionProfileRevision is unavailable");
    }
    const executionProfile = configuredExecutionProfile;
    await this.store.appendUnderstandingRecord(job.projectId, "MODEL_CAPABILITY_PROFILE", {
      ...profile,
      projectId: job.projectId,
      createdAt: this.clock().toISOString(),
    });

    const candidates = [];
    const gaps = [];
    const routeDecisionIds = [];
    const analysisBatchIds = [];
    let batchSequence = 0;
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
      const candidate = {
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
      };
      const batch = createAnalysisBatch({
        workspaceId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        analysisRunId: job.id,
        profileRevisionId: executionProfile.id,
        sequence: ++batchSequence,
        sourceScope: { artifactIds: [...workUnit.artifactIds], workUnitId: workUnit.id },
        taskStatement: "Recover evidence-bound capability, API, data, configuration, and test semantics",
        outputSchema: { type: "object", required: ["candidates"], properties: { candidates: { type: "array" } } },
        sourcePolicy: { policyDigest: job.policyDigest, maxBytes: 65_536, maxTokens: 12_000 },
      }, this.clock);
      const assignments = fanOutAnalysisBatch(batch, executionProfile, this.clock);
      await this.store.appendUnderstandingRecord(job.projectId, "ANALYSIS_BATCH", batch);
      analysisBatchIds.push(batch.id);
      const childResults = [];
      for (const assignment of assignments) {
        await this.store.appendUnderstandingRecord(job.projectId, "CHILD_WORK_UNIT", assignment);
        const childRouteDecision = deepFreeze({
          id: contentId("CHILD-ROUTE-DECISION", {
            analysisBatchId: batch.id,
            slotId: assignment.slotId,
            profileRevisionId: executionProfile.id,
          }),
          projectId: job.projectId,
          snapshotManifestId: job.snapshotManifestId,
          analysisRunId: job.id,
          workUnitId: assignment.id,
          analysisBatchId: batch.id,
          status: "SELECTED",
          selected: [assignment.route],
          profileRevisionId: executionProfile.id,
          createdAt: this.clock().toISOString(),
        });
        await this.store.appendUnderstandingRecord(job.projectId, "ANALYSIS_ROUTE_DECISION", childRouteDecision);
        routeDecisionIds.push(childRouteDecision.id);
        let output;
        try {
          output = this.childProducer
            ? await this.childProducer({
                job: deepFreeze(structuredClone(job)),
                batch,
                assignment,
                artifact,
                facts: workFacts,
                sourceSlices: slices,
                candidate: structuredClone(candidate),
              })
            : { candidates: [{ proposal: candidate.proposal, confidence: candidate.confidence }] };
        } catch (error) {
          output = { gap: { code: "CHILD_PRODUCER_FAILED", message: error.message } };
        }
        const childResult = commitChildBatchResult({
          workspaceId: job.projectId,
          analysisRunId: job.id,
          analysisBatchId: batch.id,
          childWorkUnitId: assignment.id,
          slotId: assignment.slotId,
          inputDigest: assignment.inputDigest,
          independenceGroup: assignment.route.independenceGroup,
          status: output.gap ? "GAP" : "COMPLETED",
          output,
          evidenceFactIds,
          sourceSliceIds,
        }, this.clock);
        await this.store.appendUnderstandingRecord(job.projectId, "CHILD_BATCH_RESULT", childResult);
        childResults.push(childResult);
      }
      const barrier = openAnalysisBatchBarrier(batch, assignments, childResults);
      await this.store.appendUnderstandingRecord(job.projectId, "BATCH_BARRIER", {
        id: contentId("BATCH-BARRIER", barrier),
        projectId: job.projectId,
        analysisRunId: job.id,
        ...barrier,
        openedAt: this.clock().toISOString(),
      });
      const validOutputs = childResults.filter(({ status }) => status === "COMPLETED").map(({ output }) => canonicalJson(output));
      if (validOutputs.length !== childResults.length || new Set(validOutputs).size !== 1) {
        const conflict = deepFreeze({
          id: contentId("CONFLICT-LEDGER", { analysisBatchId: batch.id, resultIds: childResults.map(({ id }) => id) }),
          projectId: job.projectId,
          snapshotManifestId: job.snapshotManifestId,
          analysisRunId: job.id,
          analysisBatchId: batch.id,
          status: "UNRESOLVED",
          childResultIds: childResults.map(({ id }) => id),
          createdAt: this.clock().toISOString(),
        });
        await this.store.appendUnderstandingRecord(job.projectId, "CONFLICT_LEDGER", conflict);
        const gap = this.#gap(job, workUnit.id, "CHILD_RESULTS_CONFLICT");
        gaps.push(gap);
        await this.store.appendUnderstandingRecord(job.projectId, "GAP", gap);
        continue;
      }
      const agreedOutput = childResults[0]?.output;
      const semanticCandidate = agreedOutput?.candidates?.[0] ?? agreedOutput?.candidateFeatures?.[0] ?? null;
      candidates.push({
        ...candidate,
        proposal: semanticCandidate
          ? {
              ...candidate.proposal,
              name: semanticCandidate.name ?? semanticCandidate.displayName ?? candidate.proposal.name,
              statement: semanticCandidate.description ?? semanticCandidate.statement ?? candidate.proposal.statement,
            }
          : candidate.proposal,
        confidence: semanticCandidate?.confidence ?? candidate.confidence,
        analysisBatchId: batch.id,
        childResultIds: childResults.map(({ id }) => id),
        independenceGroups: barrier.independenceGroups,
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
      analysisBatchIds,
      createdAt: this.clock().toISOString(),
    });
    await this.store.appendUnderstandingRecord(job.projectId, "CANDIDATE_BUNDLE", bundle);
    return {
      candidateBundleId: bundle.id,
      routeDecisionIds,
      analysisBatchIds,
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
    const validCandidates = [];
    const quarantined = [];
    for (const candidate of bundle.candidates) {
      try {
        const allowset = allowsets[candidate.workUnitId];
        if (!allowset) throw new TypeError("immutable evidence allowset is missing");
        validateCandidateAgainstEvidenceAllowset(candidate, allowset);
        validCandidates.push(candidate);
      } catch (error) {
        const quarantine = deepFreeze({
          id: contentId("QUARANTINED-CANDIDATE", { candidateId: candidate.id, reason: error.message }),
          projectId: job.projectId,
          snapshotManifestId: job.snapshotManifestId,
          analysisRunId: job.id,
          candidate: structuredClone(candidate),
          reasonCode: "EVIDENCE_VALIDATION_FAILED",
          reason: error.message,
          status: "QUARANTINED",
          createdAt: this.clock().toISOString(),
        });
        await this.store.appendUnderstandingRecord(job.projectId, "QUARANTINED_CANDIDATE", quarantine);
        quarantined.push(quarantine);
      }
    }
    const reconciliation = reconcileCandidates({
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      candidates: validCandidates,
      candidateAbsences: [],
      evidenceAllowsets: allowsets,
    }, this.clock);
    await this.store.appendUnderstandingRecord(job.projectId, "RECONCILIATION", reconciliation);
    for (const conflict of reconciliation.conflicts) {
      await this.store.appendUnderstandingRecord(job.projectId, "CONFLICT_LEDGER", {
        ...conflict,
        projectId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        analysisRunId: job.id,
        createdAt: this.clock().toISOString(),
      });
    }
    const inventory = await this.store.getUnderstandingRecord(
      job.projectId,
      "ARTIFACT_INVENTORY",
      job.outputs.SOURCE_SCAN.inventoryId,
    );
    const dispositionCounts = Object.fromEntries(
      [...new Set(inventory.artifacts.map(({ disposition }) => disposition))]
        .map((disposition) => [
          disposition,
          inventory.artifacts.filter((artifact) => artifact.disposition === disposition).length,
        ]),
    );
    const coverage = deepFreeze({
      id: contentId("COVERAGE-LEDGER", {
        analysisRunId: job.id,
        dispositionCounts,
        candidateIds: validCandidates.map(({ id }) => id),
        quarantineIds: quarantined.map(({ id }) => id),
        gapIds: bundle.gaps.map(({ id }) => id),
      }),
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      totalArtifacts: inventory.totalCount,
      disposedArtifacts: inventory.disposedCount,
      dispositionCounts,
      candidateIds: validCandidates.map(({ id }) => id),
      quarantineIds: quarantined.map(({ id }) => id),
      conflictIds: reconciliation.conflicts.map(({ id }) => id),
      gapIds: bundle.gaps.map(({ id }) => id),
      complete: inventory.unassignedCount === 0 && inventory.disposedCount === inventory.totalCount,
      createdAt: this.clock().toISOString(),
    });
    await this.store.appendUnderstandingRecord(job.projectId, "COVERAGE_LEDGER", coverage);
    const reviewSubjects = [
      ...validCandidates.map((candidate) => ({
        subjectId: candidate.id,
        evidenceState: "EVIDENCE_VALIDATED",
        severity: "REVIEW",
        analysisBatchId: candidate.analysisBatchId,
        source: "ANALYSIS_CANDIDATE",
      })),
      ...quarantined.map((record) => ({
        subjectId: record.candidate.id,
        evidenceState: "QUARANTINED",
        severity: "BLOCKING",
        analysisBatchId: record.candidate.analysisBatchId,
        source: "EVIDENCE_VALIDATION",
      })),
      ...reconciliation.conflicts.map((conflict) => ({
        subjectId: conflict.id,
        evidenceState: "CONFLICT",
        severity: "BLOCKING",
        analysisBatchId: null,
        source: "RECONCILIATION",
      })),
    ];
    for (const subject of reviewSubjects) {
      const item = deepFreeze({
        id: contentId("REVIEW-QUEUE-ITEM", {
          workspaceId: job.projectId,
          analysisRunId: job.id,
          subjectId: subject.subjectId,
        }),
        workspaceId: job.projectId,
        analysisRunId: job.id,
        snapshotManifestId: job.snapshotManifestId,
        subjectId: subject.subjectId,
        analysisBatchId: subject.analysisBatchId,
        evidenceState: subject.evidenceState,
        severity: subject.severity,
        source: subject.source,
        status: "PENDING",
        version: 1,
        createdAt: this.clock().toISOString(),
      });
      await this.store.appendUnderstandingRecord(job.projectId, "REVIEW_QUEUE_ITEM", item);
    }
    return {
      reconciliationId: reconciliation.id,
      coverageLedgerId: coverage.id,
      quarantineIds: quarantined.map(({ id }) => id),
      conflictIds: reconciliation.conflicts.map(({ id }) => id),
    };
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
    if (this.reviewedEvaluationResolver) {
      const reviewedInput = await this.reviewedEvaluationResolver({
        job: deepFreeze(structuredClone(job)),
        inventory,
        candidateBundle: bundle,
        reconciliation,
      });
      if (reviewedInput) {
        const evaluation = evaluateUnderstanding({
          ...reviewedInput,
          projectId: job.projectId,
          analysisRunId: job.id,
          inventory: {
            totalCount: inventory.totalCount,
            disposedCount: inventory.disposedCount,
          },
        }, this.clock);
        await this.store.appendUnderstandingRecord(job.projectId, "EVALUATION_RUN", evaluation);
        return { evaluationRunId: evaluation.id, status: evaluation.status };
      }
    }
    if (job.policyDigest === "traqen-self-v1") {
      throw new TypeError("traqen-self-v1 requires an independently reviewed Truth Set evaluator");
    }
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
    const minimumDenominators = job.policyDigest === "traqen-self-v1"
      ? traqenSelfPublicationMinimums
      : publicationMinimums;
    const missingDenominators = Object.entries(minimumDenominators)
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
      minimumDenominators,
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
    const sourceBundle = await this.store.getUnderstandingRecord(
      job.projectId,
      "CANDIDATE_BUNDLE",
      job.outputs.ANALYSIS.candidateBundleId,
    );
    const reconciliation = await this.store.getUnderstandingRecord(
      job.projectId,
      "RECONCILIATION",
      job.outputs.RECONCILIATION.reconciliationId,
    );
    const inventory = await this.store.getUnderstandingRecord(
      job.projectId,
      "ARTIFACT_INVENTORY",
      job.outputs.SOURCE_SCAN.inventoryId,
    );
    const admittedCandidateIds = new Set(reconciliation.candidates.flatMap(({ candidateIds }) => candidateIds));
    const bundle = {
      ...sourceBundle,
      candidates: sourceBundle.candidates.filter(({ id }) => admittedCandidateIds.has(id)),
    };
    const artifactNodeType = (artifact) => {
      const kinds = new Set(artifact.artifactKinds ?? []);
      if (kinds.has("TEST")) return "TEST_ASSET";
      if (kinds.has("RESULT")) return "EXECUTION_RESULT";
      if (kinds.has("CONFIG")) return "CONFIGURATION";
      if (kinds.has("SCHEMA") || kinds.has("MIGRATION")) return "DATA_DESIGN";
      if (kinds.has("SOURCE")) return "IMPLEMENTATION_ARTIFACT";
      if (kinds.has("DOCUMENT") && /(?:requirements?|F\d{3})/i.test(artifact.relativePath)) return "REQUIREMENT_DOCUMENT";
      if (kinds.has("DOCUMENT")) return "DESIGN_DOCUMENT";
      return "SOURCE_ARTIFACT";
    };
    const artifactNodes = inventory.artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifactNodeType(artifact),
      authority: "DETERMINISTIC_FACT",
      label: artifact.relativePath,
      relativePath: artifact.relativePath,
      disposition: artifact.disposition,
    }));
    const childResults = (await this.store.listUnderstandingRecords(job.projectId, "CHILD_BATCH_RESULT"))
      .filter(({ analysisRunId }) => analysisRunId === job.id);
    const evaluation = await this.store.getUnderstandingRecord(
      job.projectId,
      "EVALUATION_RUN",
      job.outputs.EVALUATION.evaluationRunId,
    );
    const nodes = [
      ...artifactNodes,
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
      ...childResults.map((result) => ({
        id: result.id,
        type: "ANALYSIS_EVIDENCE",
        authority: "CANDIDATE",
        label: `${result.slotId} ${result.status}`,
        inputDigest: result.inputDigest,
        outputDigest: result.outputDigest,
      })),
      {
        id: evaluation.id,
        type: "EVALUATION",
        authority: "DETERMINISTIC_FACT",
        label: `${evaluation.policyVersion} ${evaluation.status}`,
      },
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
    const byRelativePath = new Map(inventory.artifacts.map((artifact) => [artifact.relativePath, artifact]));
    const resolveReference = (sourceArtifact, targetPath) => {
      if (!sourceArtifact || typeof targetPath !== "string" || /^(?:[a-z]+:|#)/i.test(targetPath)) return null;
      const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(sourceArtifact.relativePath), targetPath))
        .replace(/^(\.\.\/)+/, "");
      const candidates = [
        normalized,
        ...[".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md"].map((extension) => `${normalized}${extension}`),
        ...["index.js", "index.ts", "index.tsx"].map((name) => `${normalized}/${name}`),
      ];
      return candidates.map((candidatePath) => byRelativePath.get(candidatePath)).find(Boolean) ?? null;
    };
    const factArtifactEdges = facts
      .filter(({ artifactId }) => byRelativePath.size > 0 && artifactNodes.some(({ id }) => id === artifactId))
      .map((fact) => ({
        id: contentId("GRAPH-EDGE", { source: fact.id, target: fact.artifactId, type: "OBSERVED_IN" }),
        source: fact.id,
        target: fact.artifactId,
        type: "OBSERVED_IN",
        authority: "DETERMINISTIC_FACT",
      }));
    const referenceEdges = [...new Map(facts.flatMap((fact) => {
      if (!["DOCUMENT_REFERENCE", "SOURCE_REFERENCE"].includes(fact.type)) return [];
      const sourceArtifact = inventory.artifacts.find(({ id }) => id === fact.artifactId);
      const targetArtifact = resolveReference(sourceArtifact, fact.targetPath);
      if (!targetArtifact) return [];
      return [{
        id: contentId("GRAPH-EDGE", { source: fact.artifactId, target: targetArtifact.id, type: "REFERENCES" }),
        source: fact.artifactId,
        target: targetArtifact.id,
        type: "REFERENCES",
        authority: "DETERMINISTIC_FACT",
      }];
    }).map((edge) => [edge.id, edge])).values()];
    const candidateEvidenceEdges = bundle.candidates.flatMap((candidate) =>
      candidate.evidenceFactIds.filter((factId) => nodeIds.has(factId)).map((factId) => ({
        id: contentId("GRAPH-EDGE", { source: candidate.id, target: factId, type: "SUPPORTED_BY" }),
        source: candidate.id,
        target: factId,
        type: "SUPPORTED_BY",
        authority: "CANDIDATE",
      })));
    const childEvidenceEdges = bundle.candidates.flatMap((candidate) =>
      childResults.filter(({ id }) => candidate.childResultIds.includes(id)).map((result) => ({
        id: contentId("GRAPH-EDGE", { source: candidate.id, target: result.id, type: "ANALYZED_BY" }),
        source: candidate.id,
        target: result.id,
        type: "ANALYZED_BY",
        authority: "CANDIDATE",
      })));
    const evaluationEdges = bundle.candidates.map((candidate) => ({
      id: contentId("GRAPH-EDGE", { source: candidate.id, target: evaluation.id, type: "EVALUATED_BY" }),
      source: candidate.id,
      target: evaluation.id,
      type: "EVALUATED_BY",
      authority: "DETERMINISTIC_FACT",
    }));
    const edges = [...factArtifactEdges, ...referenceEdges, ...candidateEvidenceEdges, ...childEvidenceEdges, ...evaluationEdges];
    const traceChains = bundle.candidates.slice(0, 1).map((candidate) => {
      const candidateFacts = facts.filter(({ id }) => candidate.evidenceFactIds.includes(id));
      const candidateArtifacts = [...new Set(candidateFacts.map(({ artifactId }) => artifactId))];
      const evidenceNodeIds = childResults.filter(({ id }) => candidate.childResultIds.includes(id)).map(({ id }) => id);
      const segments = [
        { type: "REQUIREMENT", nodeIds: candidateArtifacts.filter((id) => nodes.find((node) => node.id === id)?.type === "REQUIREMENT_DOCUMENT") },
        { type: "DESIGN", nodeIds: candidateArtifacts.filter((id) => nodes.find((node) => node.id === id)?.type === "DESIGN_DOCUMENT") },
        { type: "IMPLEMENTATION", nodeIds: [candidate.id, ...candidate.evidenceFactIds, ...candidateArtifacts.filter((id) => nodes.find((node) => node.id === id)?.type === "IMPLEMENTATION_ARTIFACT")] },
        { type: "TEST", nodeIds: candidateArtifacts.filter((id) => nodes.find((node) => node.id === id)?.type === "TEST_ASSET") },
        { type: "EXECUTION", nodeIds: [evaluation.id] },
        { type: "EVIDENCE", nodeIds: evidenceNodeIds },
      ];
      const chainGaps = segments.filter(({ nodeIds: segmentNodeIds }) => segmentNodeIds.length === 0)
        .map(({ type }) => ({ type: `MISSING_${type}`, status: "OPEN" }));
      return {
      id: contentId("UNDERSTANDING-TRACE-CHAIN", {
        candidateId: candidate.id,
        evidenceFactIds: candidate.evidenceFactIds,
      }),
      status: "CANDIDATE_REVIEW_REQUIRED",
      nodeIds: [...new Set(segments.flatMap(({ nodeIds: segmentNodeIds }) => segmentNodeIds))],
      segments,
      gaps: chainGaps,
      complete: chainGaps.length === 0,
      };
    });

    const delta = await this.#incrementalDelta(job, nodes, edges);
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

  async #incrementalDelta(job, nodes, edges) {
    if (!job.baseRevisionId) {
      return { changeSet: null, impactAssessment: null, revalidationPlan: null };
    }
    const revision = await this.store.getUnderstandingRecord(job.projectId, "GRAPH_REVISION", job.baseRevisionId);
    const artifact = revision
      ? await this.store.getUnderstandingRecord(job.projectId, "GRAPH_ARTIFACT", revision.graphArtifactId)
      : null;
    const before = new Map((artifact?.nodes ?? []).map((node) => [node.id, canonicalJson(node)]));
    const after = new Map(nodes.map((node) => [node.id, canonicalJson(node)]));
    const changedNodeIds = [...new Set([...before.keys(), ...after.keys()])]
      .filter((id) => before.get(id) !== after.get(id))
      .sort();
    const allNodes = new Map([...(artifact?.nodes ?? []), ...nodes].map((node) => [node.id, node]));
    const adjacency = new Map();
    for (const edge of [...(artifact?.edges ?? []), ...edges]) {
      adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
      adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
    }
    const affected = new Set(changedNodeIds);
    const pending = [...changedNodeIds];
    while (pending.length > 0) {
      const current = pending.pop();
      for (const related of adjacency.get(current) ?? []) {
        if (affected.has(related)) continue;
        affected.add(related);
        pending.push(related);
      }
    }
    const affectedByType = (types) => [...affected]
      .filter((nodeId) => types.includes(allNodes.get(nodeId)?.type))
      .sort();
    const affectedFeatureIds = affectedByType(["FEATURE", "FEATURE_VERSION"]);
    const affectedClaimIds = affectedByType(["CLAIM", "CANDIDATE_CLAIM"]);
    const affectedTestSpecIds = affectedByType(["TEST_SPEC", "TEST_ASSET"]);
    const affectedDependencyIds = affectedByType(["EXTERNAL_DEPENDENCY", "DATA_OBJECT", "CONFIGURATION"]);
    const changeSet = {
      id: contentId("UNDERSTANDING-CHANGE-SET", {
        baseRevisionId: job.baseRevisionId,
        snapshotManifestId: job.snapshotManifestId,
        changedNodeIds,
      }),
      fromRevisionId: job.baseRevisionId,
      toSnapshotManifestId: job.snapshotManifestId,
      changedNodeIds,
      semanticChanges: changedNodeIds.map((nodeId) => ({
        nodeId,
        beforeDigest: before.has(nodeId) ? contentId("NODE-SEMANTIC", before.get(nodeId)) : null,
        afterDigest: after.has(nodeId) ? contentId("NODE-SEMANTIC", after.get(nodeId)) : null,
        kind: !before.has(nodeId) ? "ADDED" : !after.has(nodeId) ? "REMOVED" : "MODIFIED",
      })),
    };
    const revalidationPlan = {
      required: changedNodeIds.length > 0,
      affectedNodeIds: [...affected].sort(),
      actions: [
        ...(changedNodeIds.length > 0 ? ["REVIEW_CHANGED_CANDIDATES"] : []),
        ...(affectedClaimIds.length > 0 ? ["REVIEW_AFFECTED_CLAIMS"] : []),
        ...(affectedTestSpecIds.length > 0 ? ["RERUN_AFFECTED_TESTS"] : []),
        ...(affectedDependencyIds.length > 0 ? ["REVALIDATE_DEPENDENCIES"] : []),
      ],
    };
    const impactAssessment = {
      id: contentId("UNDERSTANDING-IMPACT", { changeSetId: changeSet.id, affected: [...affected].sort() }),
      changeSetId: changeSet.id,
      affectedNodeIds: [...affected].sort(),
      affectedFeatureIds,
      affectedClaimIds,
      affectedTestSpecIds,
      affectedDependencyIds,
      unresolvedPathNodeIds: changedNodeIds.filter((nodeId) => (adjacency.get(nodeId) ?? []).length === 0),
      confidence: changedNodeIds.length === 0 ? "HIGH" : [...affected].length > changedNodeIds.length ? "MEDIUM" : "LOW",
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
