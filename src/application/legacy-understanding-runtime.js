import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createCandidateEvidenceAllowset,
  createUnderstandingPlan,
  reconcileCandidates,
  validateCandidateAgainstEvidenceAllowset,
  validateRelationAgainstEvidenceAllowset,
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
import { TraceabilityApplication } from "./traceability-application.js";
import { evaluateUnderstanding } from "./understanding-evaluator.js";
import { WorkspaceAnalysisJobRunner, WorkspaceAnalysisPhase } from "./workspace-analysis-job-runner.js";
import { planIncrementalUnderstanding } from "./incremental-understanding.js";
import {
  createStoredUnderstandingSurface,
  createUnderstandingSemanticSurface,
  measureUnderstandingEquivalence,
} from "./understanding-equivalence.js";

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

const childConfidenceRank = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3 });
const runtimePlannerVersion = "legacy-understanding-runtime-v1";
const runtimeConventionVersion = "legacy-understanding-runtime-v1";

function producerForExecutionSlot(executionProfile, slot) {
  return {
    modelCapabilityProfileId: slot.model,
    modelRevision: executionProfile.id,
    skillId: slot.skillNames.length > 0 ? slot.skillNames.join("+") : "NO_SKILL",
    skillVersion: executionProfile.id,
    mcpNames: [...slot.mcpNames],
    independenceGroup: slot.independenceGroup,
    workspaceExecutionProfileRevisionId: executionProfile.id,
  };
}

function createReuseContract(job, plan, executionProfile) {
  const producerContract = {
    mainAgent: structuredClone(executionProfile.mainAgent),
    childProducers: executionProfile.childSlots.map((slot) => producerForExecutionSlot(executionProfile, slot)),
  };
  const contract = {
    workspaceExecutionProfileRevisionId: executionProfile.id,
    workspaceExecutionProfileDigest: executionProfile.profileDigest ?? null,
    producerContract,
    producerContractDigest: contentId("UNDERSTANDING-PRODUCER-CONTRACT", producerContract),
    executionPolicyDigest: job.policyDigest,
    plannerVersion: plan.plannerVersion,
    conventionVersion: plan.conventionVersion,
  };
  return deepFreeze({
    ...contract,
    digest: contentId("UNDERSTANDING-REUSE-CONTRACT", contract),
  });
}

function compareReuseContracts(previous, current, incremental) {
  if (!incremental) {
    return deepFreeze({ compatible: false, reasons: ["FULL_ANALYSIS"], previous: previous ?? null, current });
  }
  if (!previous) {
    return deepFreeze({
      compatible: false,
      reasons: ["PREVIOUS_REUSE_CONTRACT_UNAVAILABLE"],
      previous: null,
      current,
    });
  }
  const reasons = [];
  if (previous.workspaceExecutionProfileRevisionId !== current.workspaceExecutionProfileRevisionId) {
    reasons.push("WORKSPACE_EXECUTION_PROFILE_REVISION_CHANGED");
  }
  if (previous.workspaceExecutionProfileDigest !== current.workspaceExecutionProfileDigest) {
    reasons.push("WORKSPACE_EXECUTION_PROFILE_DIGEST_CHANGED");
  }
  if (previous.producerContractDigest !== current.producerContractDigest) {
    reasons.push("RESOLVED_PRODUCER_CONTRACT_CHANGED");
  }
  if (previous.executionPolicyDigest !== current.executionPolicyDigest) {
    reasons.push("EXECUTION_POLICY_DIGEST_CHANGED");
  }
  if (previous.plannerVersion !== current.plannerVersion) reasons.push("PLANNER_VERSION_CHANGED");
  if (previous.conventionVersion !== current.conventionVersion) reasons.push("CONVENTION_VERSION_CHANGED");
  return deepFreeze({ compatible: reasons.length === 0, reasons, previous, current });
}

export function validateProjectionSourceSliceReferences({ job, candidates, relations = [], sourceSlices }) {
  const sourceSliceById = new Map(sourceSlices.map((slice) => [slice.id, slice]));
  for (const subject of [...candidates, ...relations]) {
    for (const sourceSliceId of subject.sourceSliceIds ?? []) {
      const slice = sourceSliceById.get(sourceSliceId);
      if (!slice) throw new TypeError(`SourceSlice ${sourceSliceId} is unavailable for graph projection`);
      for (const [field, expected] of [
        ["projectId", job.projectId],
        ["snapshotManifestId", job.snapshotManifestId],
        ["analysisRunId", job.id],
        ["workUnitId", subject.workUnitId],
      ]) {
        if (slice[field] !== expected) {
          throw new TypeError(`SourceSlice ${sourceSliceId} ${field} is outside the graph projection scope`);
        }
      }
      if (slice.status === "REJECTED") {
        throw new TypeError(`SourceSlice ${sourceSliceId} is rejected and cannot be projected`);
      }
    }
  }
  return true;
}

function validateChildProducerOutput(output, evidenceAllowset) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new TypeError("Child producer output must be an object");
  }
  const hasGap = Object.hasOwn(output, "gap");
  const hasCandidates = Object.hasOwn(output, "candidates");
  const hasCandidateFeatures = Object.hasOwn(output, "candidateFeatures");
  if (hasCandidates && hasCandidateFeatures) {
    throw new TypeError("Child producer output cannot contain both candidates and candidateFeatures");
  }
  if (hasGap === (hasCandidates || hasCandidateFeatures)) {
    throw new TypeError("Child producer output must contain exactly one of gap or candidates");
  }
  if (hasGap) {
    if (!output.gap || typeof output.gap !== "object" || Array.isArray(output.gap)) {
      throw new TypeError("Child producer gap must be an object");
    }
    for (const field of ["code", "message"]) {
      if (typeof output.gap[field] !== "string" || output.gap[field].trim() === "") {
        throw new TypeError(`Child producer gap.${field} must be a non-empty string`);
      }
    }
    return output;
  }
  const candidates = hasCandidates ? output.candidates : output.candidateFeatures;
  if (!Array.isArray(candidates)) throw new TypeError("Child producer output must contain candidates");
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TypeError(`Child producer candidates[${index}] must be an object`);
    }
    if (candidate.name === undefined && candidate.displayName === undefined) {
      throw new TypeError(`Child producer candidates[${index}].name is required`);
    }
    for (const field of ["name", "displayName", "statement", "description", "subjectKey"]) {
      if (candidate[field] !== undefined
        && (typeof candidate[field] !== "string" || candidate[field].trim() === "")) {
        throw new TypeError(`Child producer candidates[${index}].${field} must be a non-empty string`);
      }
    }
    if (candidate.confidence !== undefined && !["LOW", "MEDIUM", "HIGH"].includes(candidate.confidence)) {
      throw new TypeError(`Child producer candidates[${index}].confidence is invalid`);
    }
    if (candidate.confidence !== undefined
      && childConfidenceRank[candidate.confidence] > childConfidenceRank[evidenceAllowset.confidenceCap]) {
      throw new TypeError(
        `Child producer candidates[${index}].confidence exceeds evidence cap ${evidenceAllowset.confidenceCap}`,
      );
    }
    let evidenceCount = 0;
    for (const [field, allowedValues] of [
      ["evidenceFactIds", evidenceAllowset.factIds],
      ["sourceSliceIds", evidenceAllowset.sourceSliceIds],
    ]) {
      if (candidate[field] !== undefined && !Array.isArray(candidate[field])) {
        throw new TypeError(`Child producer candidates[${index}].${field} must be an array`);
      }
      const values = candidate[field] ?? [];
      const seen = new Set();
      const allowed = new Set(allowedValues);
      for (const [evidenceIndex, value] of values.entries()) {
        if (typeof value !== "string" || value.trim() === "") {
          throw new TypeError(
            `Child producer candidates[${index}].${field}[${evidenceIndex}] must be a non-empty string`,
          );
        }
        if (seen.has(value)) {
          throw new TypeError(`Child producer candidates[${index}] has duplicate ${field}`);
        }
        if (!allowed.has(value)) {
          throw new TypeError(
            `Child producer candidates[${index}].${field}[${evidenceIndex}] is outside the evidence allowset`,
          );
        }
        seen.add(value);
      }
      evidenceCount += values.length;
    }
    if (evidenceCount === 0) {
      throw new TypeError(
        `Child producer candidates[${index}] requires at least one evidenceFactIds or sourceSliceIds`,
      );
    }
  }
  return output;
}

const mergedProposalFields = new Set(["name", "statement", "subjectKey", "confidence"]);

function validateMergedProposal(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new TypeError("MERGE decisions require one mergedProposal object");
  }
  const unsupported = Object.keys(proposal).filter((field) => !mergedProposalFields.has(field));
  if (unsupported.length > 0) {
    throw new TypeError(`mergedProposal contains unsupported field ${unsupported[0]}`);
  }
  for (const field of ["name", "statement"]) {
    if (typeof proposal[field] !== "string" || proposal[field].trim() === "") {
      throw new TypeError(`mergedProposal.${field} must be a non-empty string`);
    }
  }
  if (proposal.subjectKey !== undefined
    && (typeof proposal.subjectKey !== "string" || proposal.subjectKey.trim() === "")) {
    throw new TypeError("mergedProposal.subjectKey must be a non-empty string");
  }
  if (proposal.confidence !== undefined && !["LOW", "MEDIUM", "HIGH"].includes(proposal.confidence)) {
    throw new TypeError("mergedProposal.confidence must be LOW, MEDIUM, or HIGH");
  }
  return proposal;
}

function validateReconciledCandidateProjection(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError("reconciled Candidate must be an object");
  }
  if (!["CANDIDATE_FEATURE", "CANDIDATE_CLAIM"].includes(candidate.kind)) {
    throw new TypeError("reconciled Candidate kind is invalid");
  }
  if (!candidate.proposal || typeof candidate.proposal !== "object" || Array.isArray(candidate.proposal)
    || typeof candidate.proposal.name !== "string" || candidate.proposal.name.trim() === ""
    || typeof candidate.proposal.statement !== "string" || candidate.proposal.statement.trim() === "") {
    throw new TypeError("reconciled Candidate proposal requires string name and statement");
  }
  if (!["LOW", "MEDIUM", "HIGH"].includes(candidate.confidence)) {
    throw new TypeError("reconciled Candidate confidence is invalid");
  }
  if (typeof candidate.subjectKey !== "string" || candidate.subjectKey.trim() === "") {
    throw new TypeError("reconciled Candidate subjectKey is required");
  }
  if (!Array.isArray(candidate.evidenceFactIds) || !Array.isArray(candidate.sourceSliceIds)
    || candidate.evidenceFactIds.length + candidate.sourceSliceIds.length === 0) {
    throw new TypeError("reconciled Candidate requires original evidence");
  }
  return candidate;
}

function mergeComponentsByRef(decisionsByRef) {
  const adjacency = new Map(
    [...decisionsByRef.values()]
      .filter(({ disposition }) => disposition === "MERGE")
      .map(({ candidateRef }) => [candidateRef, new Set()]),
  );
  for (const decision of decisionsByRef.values()) {
    if (decision.disposition !== "MERGE") continue;
    for (const relatedRef of decision.relatedCandidateRefs ?? []) {
      adjacency.get(decision.candidateRef).add(relatedRef);
      adjacency.get(relatedRef)?.add(decision.candidateRef);
    }
  }
  const componentByRef = new Map();
  for (const candidateRef of adjacency.keys()) {
    if (componentByRef.has(candidateRef)) continue;
    const component = [];
    const pending = [candidateRef];
    while (pending.length > 0) {
      const ref = pending.pop();
      if (component.includes(ref)) continue;
      component.push(ref);
      pending.push(...(adjacency.get(ref) ?? []));
    }
    component.sort();
    for (const ref of component) componentByRef.set(ref, component);
  }
  return componentByRef;
}

function validateMainProducerOutput(output, candidateOptions) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new TypeError("Main producer output must be an object");
  }
  if (!Array.isArray(output.candidateDecisions) || !Array.isArray(output.relations ?? [])
    || !Array.isArray(output.gaps ?? [])) {
    throw new TypeError("Main producer output must contain candidateDecisions, relations, and gaps arrays");
  }
  const optionsByRef = new Map(candidateOptions.map((option) => [option.ref, option]));
  const decided = new Set();
  for (const decision of output.candidateDecisions) {
    if (!optionsByRef.has(decision.candidateRef)) {
      throw new TypeError(`Main producer referenced unknown Child Candidate ${decision.candidateRef}`);
    }
    if (decided.has(decision.candidateRef)) throw new TypeError("Main producer decided one Child Candidate more than once");
    if (!["ACCEPT", "ALTERNATIVE", "CONFLICT", "MERGE", "REJECT"].includes(decision.disposition)) {
      throw new TypeError("Main producer Candidate disposition is invalid");
    }
    if (decision.relatedCandidateRefs !== undefined) {
      if (!Array.isArray(decision.relatedCandidateRefs)
        || decision.relatedCandidateRefs.some((ref) => !optionsByRef.has(ref) || ref === decision.candidateRef)) {
        throw new TypeError("Main producer relatedCandidateRefs must stay inside the sibling Candidate set");
      }
    }
    if (typeof decision.rationale !== "string" || decision.rationale.trim() === "") {
      throw new TypeError("Main producer Candidate rationale is required");
    }
    decided.add(decision.candidateRef);
  }
  if (decided.size !== optionsByRef.size) {
    throw new TypeError("Main producer must decide every schema-valid Child Candidate exactly once");
  }
  const decisionsByRef = new Map(output.candidateDecisions.map((decision) => [decision.candidateRef, decision]));
  for (const decision of output.candidateDecisions) {
    if (decision.disposition !== "MERGE") {
      if (decision.mergedProposal !== undefined) throw new TypeError("mergedProposal is only valid for MERGE decisions");
      continue;
    }
    if (!Array.isArray(decision.relatedCandidateRefs) || decision.relatedCandidateRefs.length === 0) {
      throw new TypeError("MERGE decisions require relatedCandidateRefs");
    }
    validateMergedProposal(decision.mergedProposal);
    if (decision.relatedCandidateRefs.some((ref) => decisionsByRef.get(ref)?.disposition !== "MERGE")) {
      throw new TypeError("MERGE relatedCandidateRefs must also have MERGE decisions");
    }
  }
  const mergeComponents = mergeComponentsByRef(decisionsByRef);
  const validatedComponents = new Set();
  for (const decision of output.candidateDecisions.filter(({ disposition }) => disposition === "MERGE")) {
    const componentRefs = mergeComponents.get(decision.candidateRef);
    const componentKey = componentRefs.join("\u0000");
    if (validatedComponents.has(componentKey)) continue;
    validatedComponents.add(componentKey);
    if (new Set(componentRefs.map((ref) => canonicalJson(decisionsByRef.get(ref).mergedProposal))).size !== 1) {
      throw new TypeError("all decisions in a MERGE component must declare the same mergedProposal");
    }
  }
  for (const gap of output.gaps ?? []) {
    if (typeof gap?.code !== "string" || gap.code.trim() === ""
      || typeof gap?.message !== "string" || gap.message.trim() === "") {
      throw new TypeError("Main producer gaps require code and message");
    }
  }
  return output;
}

export function reviewedCandidateTraceComplete(reviewedChain, chainGaps) {
  return reviewedChain?.complete === true && chainGaps.length === 0;
}

export function requirePassedUnderstandingEvaluation(status) {
  if (status !== "PASSED") throw new TypeError(`Evaluation is ${status}; publication is forbidden`);
  return true;
}

export class LegacyUnderstandingRuntime {
  #controllers = new Map();

  constructor({
    store,
    allowlistedRoots,
    snapshotRoot,
    sourceSliceBroker,
    childProducer = null,
    mainProducer = null,
    reviewedEvaluationResolver = null,
    equivalenceResolver = null,
    implementationAuthorId = "TRAQEN-RUNTIME",
    runnerId = "TRAQEN-LOCAL-RUNNER",
    publicationMetadata = null,
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
    this.mainProducer = mainProducer;
    this.reviewedEvaluationResolver = reviewedEvaluationResolver;
    this.equivalenceResolver = equivalenceResolver;
    this.implementationAuthorId = implementationAuthorId;
    this.runnerId = runnerId;
    this.publicationMetadata = publicationMetadata ? deepFreeze(structuredClone(publicationMetadata)) : null;
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
    const purpose = input.purpose ?? "PUBLICATION";
    const requestedMode = input.requestedMode ?? "AUTO";
    if (purpose === "HISTORICAL_REANALYSIS") {
      const sourceRevision = await this.store.getUnderstandingRecord(
        input.projectId,
        "GRAPH_REVISION",
        input.reanalysisOfGraphRevisionId,
      );
      if (!sourceRevision || sourceRevision.status !== "PUBLISHED") {
        throw new TypeError("historical reanalysis requires a published source GraphRevision");
      }
      if (sourceRevision.snapshotManifestId !== input.snapshotManifestId) {
        throw new TypeError("historical reanalysis Snapshot must match its source GraphRevision");
      }
      const sourceJob = await this.runner.get(input.projectId, sourceRevision.analysisRunId);
      if (!sourceJob || sourceJob.sourceRegistrationId !== input.sourceRegistrationId) {
        throw new TypeError("historical reanalysis must reuse the source Revision's SourceRegistration");
      }
      const [manifest, inventories, sealedInventory] = await Promise.all([
        this.store.getSnapshotManifest(input.projectId, input.snapshotManifestId),
        this.store.listUnderstandingRecords(input.projectId, "ARTIFACT_INVENTORY"),
        this.snapshotCapture.loadExisting({
          projectId: input.projectId,
          snapshotManifestId: input.snapshotManifestId,
        }),
      ]);
      const storedInventory = inventories.find(({ id, snapshotManifestId }) => id === sealedInventory.id
        && snapshotManifestId === input.snapshotManifestId);
      if (!manifest || !storedInventory) {
        throw new TypeError("historical reanalysis requires the persisted immutable Snapshot and sealed Inventory");
      }
    }
    const jobId = input.id ?? contentId("WORKSPACE-ANALYSIS-START", {
      projectId: input.projectId,
      sourceRegistrationId: input.sourceRegistrationId,
      snapshotManifestId: input.snapshotManifestId ?? null,
      requestedMode,
      purpose,
      reanalysisOfGraphRevisionId: input.reanalysisOfGraphRevisionId ?? null,
      requestedAt: this.clock().toISOString(),
    });
    const profileRevisionId = input.workspaceExecutionProfileRevisionId;
    if (typeof profileRevisionId !== "string" || profileRevisionId.trim() === "") {
      throw new TypeError("workspaceExecutionProfileRevisionId is required; implicit runtime profiles are forbidden");
    }
    const pinnedProfile = await this.store.getUnderstandingRecord(
      input.projectId,
      "WORKSPACE_EXECUTION_PROFILE",
      profileRevisionId,
    );
    if (!pinnedProfile || pinnedProfile.workspaceId !== input.projectId) {
      throw new TypeError("an immutable Workspace-scoped WorkspaceExecutionProfileRevision is required");
    }
    const job = await this.runner.start({
      id: jobId,
      projectId: input.projectId,
      sourceRegistrationId: input.sourceRegistrationId,
      snapshotManifestId: input.snapshotManifestId ?? contentId("SOURCE-SNAPSHOT", { jobId }),
      requestedMode,
      policyDigest: input.policyDigest ?? "traqen-understanding-runtime-v1",
      workspaceExecutionProfileRevisionId: profileRevisionId,
      implementationAuthorId: this.implementationAuthorId,
      runnerId: this.runnerId,
      purpose,
      ...(purpose === "HISTORICAL_REANALYSIS"
        ? { reanalysisOfGraphRevisionId: input.reanalysisOfGraphRevisionId }
        : {}),
      ...(this.publicationMetadata ?? {}),
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

  list(projectId) {
    return this.runner.list(projectId, { purposes: ["PUBLICATION", "HISTORICAL_REANALYSIS"] });
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

  async recover(projectIds = null) {
    const scopedProjectIds = projectIds ?? (await this.store.listProjectFoundations())
      .map(({ project }) => project.id);
    const recoveries = [];
    for (const projectId of scopedProjectIds) {
      const checkpoints = await this.store.listUnderstandingRecords(projectId, "WORKSPACE_ANALYSIS_JOB");
      const latestByJob = new Map();
      for (const checkpoint of checkpoints) {
        const current = latestByJob.get(checkpoint.jobId);
        if (!current || checkpoint.checkpointSequence > current.checkpointSequence) {
          latestByJob.set(checkpoint.jobId, checkpoint);
        }
      }
      for (const { state } of latestByJob.values()) {
        if (state.status !== "RUNNING" || state.desiredState !== "RUNNING" || this.#controllers.has(state.id)) continue;
        recoveries.push(this.#run(state));
      }
    }
    return Promise.all(recoveries);
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
    const inventory = job.purpose === "HISTORICAL_REANALYSIS"
      ? await this.snapshotCapture.loadExisting({
          projectId: job.projectId,
          snapshotManifestId: job.snapshotManifestId,
        })
      : await this.snapshotCapture.capture({
          projectId: job.projectId,
          snapshotManifestId: job.snapshotManifestId,
          rootPath: registration.canonicalRootRef,
        });
    await this.store.appendUnderstandingRecord(job.projectId, "ARTIFACT_INVENTORY", inventory);
    if (!await this.store.getSnapshotManifest(job.projectId, job.snapshotManifestId)) {
      await this.store.appendSnapshotManifest(job.projectId, {
        id: job.snapshotManifestId,
        components: {
          source: {
            id: inventory.id,
            digest: inventory.sourceDigest,
            kind: "SEALED_ARTIFACT_INVENTORY",
          },
        },
        failedSources: [],
        observedFrom: inventory.createdAt,
        observedTo: inventory.createdAt,
        complete: false,
        missingComponents: ["build", "deployment", "runtime"],
        createdAt: inventory.createdAt,
      });
    }

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
      plannerVersion: runtimePlannerVersion,
      conventionVersion: runtimeConventionVersion,
      executionPolicyDigest: job.policyDigest,
    }, this.clock);
    await this.store.appendUnderstandingRecord(job.projectId, "UNDERSTANDING_PLAN", plan);
    for (const workUnit of plan.workUnits) {
      await this.store.appendUnderstandingRecord(job.projectId, "WORK_UNIT", {
        ...workUnit,
        id: contentId("WORK-UNIT-INSTANCE", { analysisRunId: job.id, workUnitId: workUnit.id }),
        workUnitId: workUnit.id,
        projectId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        analysisRunId: job.id,
        createdAt: this.clock().toISOString(),
      });
    }
    let previous = null;
    let baseRevision = null;
    let previousBundle = null;
    if (job.baseRevisionId) {
      baseRevision = await this.store.getUnderstandingRecord(job.projectId, "GRAPH_REVISION", job.baseRevisionId);
      const inventories = await this.store.listUnderstandingRecords(job.projectId, "ARTIFACT_INVENTORY");
      const plans = await this.store.listUnderstandingRecords(job.projectId, "UNDERSTANDING_PLAN");
      const previousBundles = await this.store.listUnderstandingRecords(job.projectId, "CANDIDATE_BUNDLE");
      const previousInventory = inventories.find(({ snapshotManifestId }) =>
        snapshotManifestId === baseRevision?.snapshotManifestId);
      const previousPlan = plans.find(({ snapshotManifestId }) =>
        snapshotManifestId === baseRevision?.snapshotManifestId);
      previousBundle = previousBundles.find(({ analysisRunId }) => analysisRunId === baseRevision?.analysisRunId);
      if (!baseRevision || !previousInventory || !previousPlan || !previousBundle) {
        throw new TypeError("incremental analysis requires the published base Inventory, UnderstandingPlan, and CandidateBundle");
      }
      previous = { inventory: previousInventory, plan: previousPlan };
    }
    const executionProfile = await this.store.getUnderstandingRecord(
      job.projectId,
      "WORKSPACE_EXECUTION_PROFILE",
      job.workspaceExecutionProfileRevisionId,
    );
    if (!executionProfile) throw new TypeError("the pinned WorkspaceExecutionProfileRevision is unavailable");
    const currentReuseContract = createReuseContract(job, plan, executionProfile);
    const reuseCompatibility = compareReuseContracts(
      previousBundle?.reuseContract ?? null,
      currentReuseContract,
      Boolean(job.baseRevisionId),
    );
    const currentWorkUnitIds = new Set(plan.workUnits.map(({ id }) => id));
    const sourceSliceRevalidations = new Set();
    if (baseRevision) {
      for (const candidate of previousBundle?.candidates ?? []) {
        if (candidate.sourceSliceIds.length > 0
          && currentWorkUnitIds.has(candidate.workUnitId)) {
          sourceSliceRevalidations.add(candidate.workUnitId);
        }
      }
      for (const relation of previousBundle?.relations ?? []) {
        if ((relation.sourceSliceIds?.length ?? 0) > 0
          && currentWorkUnitIds.has(relation.workUnitId)) {
          sourceSliceRevalidations.add(relation.workUnitId);
        }
      }
    }
    const plannedIncrementalDecision = planIncrementalUnderstanding({
      requestedMode: job.resolvedMode,
      currentGraphHead: job.baseRevisionId ? { graphRevisionId: job.baseRevisionId } : null,
      previous,
      current: { inventory, plan },
      reuseCompatibility,
      revalidationWorkUnitIds: [...sourceSliceRevalidations].sort(),
    });
    const incrementalDecision = {
      ...plannedIncrementalDecision,
      sourceSliceRevalidationWorkUnitIds: [...sourceSliceRevalidations].sort(),
    };
    const workUnitReuseDecisions = plan.workUnits.map((workUnit) => {
      const disposition = incrementalDecision.reusedWorkUnitIds.includes(workUnit.id) ? "REUSE" : "REVALIDATE";
      const previousCandidateIds = (previousBundle?.candidates ?? [])
        .filter(({ workUnitId }) => workUnitId === workUnit.id)
        .map(({ id }) => id)
        .sort();
      const previousRelationIds = (previousBundle?.relations ?? [])
        .filter(({ workUnitId }) => workUnitId === workUnit.id)
        .map(({ id }) => id)
        .sort();
      const reasons = disposition === "REUSE"
        ? ["UNCHANGED_WORK_UNIT_AND_COMPATIBLE_REUSE_CONTRACT"]
        : !reuseCompatibility.compatible
          ? [...reuseCompatibility.reasons]
          : sourceSliceRevalidations.has(workUnit.id)
            ? ["SOURCE_SLICE_REVALIDATION_REQUIRED"]
            : ["WORK_UNIT_AFFECTED"];
      const identity = {
        analysisRunId: job.id,
        workUnitId: workUnit.id,
        disposition,
        previousAnalysisRunId: baseRevision?.analysisRunId ?? null,
        previousCandidateIds,
        previousRelationIds,
        previousProfileRevisionId: reuseCompatibility.previous?.workspaceExecutionProfileRevisionId ?? null,
        currentProfileRevisionId: currentReuseContract.workspaceExecutionProfileRevisionId,
        previousReuseContractDigest: reuseCompatibility.previous?.digest ?? null,
        currentReuseContractDigest: currentReuseContract.digest,
        reasons,
      };
      return deepFreeze({
        id: contentId("ANALYSIS-REUSE-DECISION", identity),
        ...identity,
        reason: reasons[0],
      });
    });
    const incrementalPlan = deepFreeze({
      id: contentId("INCREMENTAL-PLAN", {
        analysisRunId: job.id,
        planDigest: plan.planDigest,
        decision: incrementalDecision,
      }),
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      ...incrementalDecision,
      reuseCompatibility,
      reuseContract: currentReuseContract,
      workUnitReuseDecisions,
      createdAt: this.clock().toISOString(),
    });
    await this.store.appendUnderstandingRecord(job.projectId, "INCREMENTAL_PLAN", incrementalPlan);
    return deepFreeze({
      inventoryId: inventory.id,
      planId: plan.id,
      workUnitIds: plan.workUnits.map(({ id }) => id),
      incrementalPlanId: incrementalPlan.id,
      affectedWorkUnitIds: incrementalPlan.affectedWorkUnitIds,
      reusedWorkUnitIds: incrementalPlan.reusedWorkUnitIds,
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
    const incrementalPlan = await this.store.getUnderstandingRecord(
      job.projectId,
      "INCREMENTAL_PLAN",
      job.outputs.SOURCE_SCAN.incrementalPlanId,
    );
    const affected = new Set(incrementalPlan.affectedWorkUnitIds);
    const reusedArtifactIds = new Set(plan.workUnits
      .filter(({ id }) => incrementalPlan.reusedWorkUnitIds.includes(id))
      .flatMap(({ artifactIds }) => artifactIds));
    let facts = [];
    if (job.baseRevisionId && reusedArtifactIds.size > 0) {
      const baseRevision = await this.store.getUnderstandingRecord(job.projectId, "GRAPH_REVISION", job.baseRevisionId);
      const previousBundles = await this.store.listUnderstandingRecords(job.projectId, "FACT_BUNDLE");
      const previousBundle = previousBundles.find(({ analysisRunId }) => analysisRunId === baseRevision?.analysisRunId);
      facts = (previousBundle?.facts ?? []).filter(({ artifactId }) => reusedArtifactIds.has(artifactId));
    }
    for (const workUnit of plan.workUnits.filter(({ kind, id }) => kind === "LEAF" && affected.has(id))) {
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
        analysisRunId: job.id,
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
    const configuredExecutionProfile = await this.store.getUnderstandingRecord(
      job.projectId,
      "WORKSPACE_EXECUTION_PROFILE",
      job.workspaceExecutionProfileRevisionId,
    );
    if (!configuredExecutionProfile) {
      throw new TypeError("the pinned WorkspaceExecutionProfileRevision is unavailable");
    }
    const executionProfile = configuredExecutionProfile;
    const producerForSlot = (slot) => producerForExecutionSlot(executionProfile, slot);

    const candidates = [];
    const gaps = [];
    const relations = [];
    const mainConflicts = [];
    const mainResultIds = [];
    const routeDecisionIds = [];
    const analysisBatchIds = [];
    const incrementalPlan = await this.store.getUnderstandingRecord(
      job.projectId,
      "INCREMENTAL_PLAN",
      job.outputs.SOURCE_SCAN.incrementalPlanId,
    );
    const eligibleReuse = new Set(incrementalPlan.reusedWorkUnitIds);
    const reuseDecisionByWorkUnit = new Map(
      incrementalPlan.workUnitReuseDecisions.map((decision) => [decision.workUnitId, decision]),
    );
    const authorizedReuseProducers = executionProfile.childSlots.map(producerForSlot);
    const reusedWorkUnitIds = new Set(plan.workUnits
      .filter(({ id, kind }) => eligibleReuse.has(id) && kind !== "LEAF")
      .map(({ id }) => id));
    const reusedCandidateIds = [];
    if (job.baseRevisionId && eligibleReuse.size > 0) {
      const baseRevision = await this.store.getUnderstandingRecord(job.projectId, "GRAPH_REVISION", job.baseRevisionId);
      const previousBundles = await this.store.listUnderstandingRecords(job.projectId, "CANDIDATE_BUNDLE");
      const previousBundle = previousBundles.find(({ analysisRunId }) => analysisRunId === baseRevision?.analysisRunId);
      const reusableEndpointIds = new Set([
        ...inventory.artifacts.map(({ id }) => id),
        ...(previousBundle?.candidates ?? [])
          .filter((candidate) => eligibleReuse.has(candidate.workUnitId) && candidate.sourceSliceIds.length === 0)
          .map(({ id }) => id),
      ]);
      const reusablePreviousRelations = (previousBundle?.relations ?? [])
        .filter((relation) => {
          const reuseDecision = reuseDecisionByWorkUnit.get(relation.workUnitId);
          const selectedForReuse = eligibleReuse.has(relation.workUnitId)
            && reuseDecision?.disposition === "REUSE"
            && reuseDecision.previousRelationIds.includes(relation.id);
          if (selectedForReuse
            && (!reusableEndpointIds.has(relation.sourceId) || !reusableEndpointIds.has(relation.targetId))) {
            throw new TypeError(`Relation ${relation.id} is not bound to fully reusable endpoints`);
          }
          return selectedForReuse;
        });
      const reusedCandidatesByWorkUnit = new Map();
      for (const prior of previousBundle?.candidates ?? []) {
        if (!eligibleReuse.has(prior.workUnitId) || prior.sourceSliceIds.length > 0) continue;
        const reuseDecision = reuseDecisionByWorkUnit.get(prior.workUnitId);
        if (reuseDecision?.disposition !== "REUSE"
          || !reuseDecision.previousCandidateIds.includes(prior.id)
          || reuseDecision.previousProfileRevisionId !== previousBundle.workspaceExecutionProfileRevisionId
          || reuseDecision.currentProfileRevisionId !== executionProfile.id) {
          throw new TypeError(`Candidate ${prior.id} is not bound to an explicit compatible ReuseDecision`);
        }
        if (!authorizedReuseProducers.some((producer) => canonicalJson(producer) === canonicalJson(prior.producer))) {
          throw new TypeError(`Candidate ${prior.id} producer is incompatible with the current execution profile`);
        }
        const candidate = deepFreeze({
          ...structuredClone(prior),
          snapshotManifestId: job.snapshotManifestId,
          analysisRunId: job.id,
          reusedFromAnalysisRunId: prior.analysisRunId,
        });
        const workUnitCandidates = reusedCandidatesByWorkUnit.get(candidate.workUnitId) ?? [];
        workUnitCandidates.push(candidate);
        reusedCandidatesByWorkUnit.set(candidate.workUnitId, workUnitCandidates);
        candidates.push(candidate);
        reusedCandidateIds.push(candidate.id);
        reusedWorkUnitIds.add(candidate.workUnitId);
      }
      const reusableEvidenceWorkUnitIds = new Set([
        ...reusedCandidatesByWorkUnit.keys(),
        ...reusablePreviousRelations.map(({ workUnitId }) => workUnitId),
      ]);
      for (const workUnitId of reusableEvidenceWorkUnitIds) {
        const workUnitCandidates = reusedCandidatesByWorkUnit.get(workUnitId) ?? [];
        const reuseDecision = reuseDecisionByWorkUnit.get(workUnitId);
        const workUnitRelations = reusablePreviousRelations.filter((relation) => relation.workUnitId === workUnitId);
        const allowset = createCandidateEvidenceAllowset({
          projectId: job.projectId,
          snapshotManifestId: job.snapshotManifestId,
          analysisRunId: job.id,
          workUnitId,
          factIds: [
            ...workUnitCandidates.flatMap(({ evidenceFactIds }) => evidenceFactIds),
            ...workUnitRelations.flatMap(({ evidenceFactIds = [] }) => evidenceFactIds),
          ],
          sourceSliceIds: [
            ...workUnitCandidates.flatMap(({ sourceSliceIds }) => sourceSliceIds),
            ...workUnitRelations.flatMap(({ sourceSliceIds = [] }) => sourceSliceIds),
          ],
          confidenceCap: workUnitCandidates.length > 0
            ? workUnitCandidates.map(({ confidence }) => confidence)
                .sort((left, right) => childConfidenceRank[right] - childConfidenceRank[left])[0]
            : "LOW",
          reuseDecision: {
            ...reuseDecision,
            authorizedProducers: authorizedReuseProducers,
          },
        });
        await this.store.appendUnderstandingRecord(job.projectId, "EVIDENCE_ALLOWSET", {
          id: contentId("EVIDENCE-ALLOWSET", allowset),
          ...allowset,
          createdAt: this.clock().toISOString(),
        });
        reusedWorkUnitIds.add(workUnitId);
      }
      for (const previousGap of previousBundle?.gaps ?? []) {
        if (!eligibleReuse.has(previousGap.workUnitId)) continue;
        const gap = this.#gap(job, previousGap.workUnitId, previousGap.code);
        gaps.push(gap);
        await this.store.appendUnderstandingRecord(job.projectId, "GAP", gap);
        reusedWorkUnitIds.add(previousGap.workUnitId);
      }
      for (const relation of reusablePreviousRelations) {
        relations.push(deepFreeze({
          ...structuredClone(relation),
          projectId: job.projectId,
          snapshotManifestId: job.snapshotManifestId,
          analysisRunId: job.id,
          reusedFromAnalysisRunId: relation.analysisRunId,
        }));
      }
    }
    let batchSequence = 0;
    for (const workUnit of plan.workUnits) {
      if (reusedWorkUnitIds.has(workUnit.id)) continue;
      const directArtifact = inventory.artifacts.find(({ id }) => workUnit.artifactIds[0] === id) ?? null;
      const contextCandidates = candidates.filter((candidate) => workUnit.dependencies.includes(candidate.workUnitId));
      const contextFactIds = new Set(contextCandidates.flatMap(({ evidenceFactIds = [] }) => evidenceFactIds));
      const workFacts = workUnit.kind === "LEAF"
        ? factBundle.facts.filter(({ artifactId }) => workUnit.artifactIds.includes(artifactId))
        : factBundle.facts.filter(({ id }) => contextFactIds.has(id));
      const scopedArtifacts = workUnit.kind === "PROJECT_SYNTHESIS"
        ? inventory.artifacts
        : inventory.artifacts.filter((candidateArtifact) =>
            workUnit.artifactIds.includes(candidateArtifact.id)
            || workFacts.some(({ artifactId }) => artifactId === candidateArtifact.id));
      const artifact = directArtifact ?? {
        id: workUnit.id,
        relativePath: `@synthesis/${workUnit.kind}/${workUnit.id}`,
        artifactKinds: ["SYNTHESIS"],
      };
      const selected = workUnit.kind === "GAP" ? [] : executionProfile.childSlots.map(producerForSlot);
      const decision = deepFreeze({
        id: contentId("ANALYSIS-ROUTE-DECISION", {
          projectId: job.projectId,
          analysisRunId: job.id,
          workUnitId: workUnit.id,
          profileRevisionId: executionProfile.id,
          selected,
        }),
        projectId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        analysisRunId: job.id,
        workUnitId: workUnit.id,
        status: selected.length > 0 ? "ROUTED" : "NO_ELIGIBLE_PRODUCER",
        selected,
        profileRevisionId: executionProfile.id,
        gap: selected.length > 0 ? null : { code: "NO_ELIGIBLE_PRODUCER" },
        createdAt: this.clock().toISOString(),
      });
      await this.store.appendUnderstandingRecord(job.projectId, "ANALYSIS_ROUTE_DECISION", decision);
      routeDecisionIds.push(decision.id);
      if (decision.status === "NO_ELIGIBLE_PRODUCER") {
        const gap = this.#gap(job, workUnit.id, decision.gap.code);
        gaps.push(gap);
        await this.store.appendUnderstandingRecord(job.projectId, "GAP", gap);
        continue;
      }
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
        sourceScope: {
          artifactIds: scopedArtifacts.map(({ id }) => id),
          workUnitId: workUnit.id,
          dependencyWorkUnitIds: [...workUnit.dependencies],
          dependencyCandidateIds: contextCandidates.map(({ id }) => id),
        },
        taskStatement: "Recover evidence-bound capability, API, data, configuration, and test semantics",
        outputSchema: { type: "object", required: ["candidates"], properties: { candidates: { type: "array" } } },
        sourcePolicy: { policyDigest: job.policyDigest, maxBytes: 65_536, maxTokens: 12_000 },
      }, this.clock);
      const assignments = fanOutAnalysisBatch(batch, executionProfile, this.clock);
      await this.store.appendUnderstandingRecord(job.projectId, "ANALYSIS_BATCH", batch);
      analysisBatchIds.push(batch.id);
      const childResults = [];
      let invalidChildOutput = false;
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
          output = validateChildProducerOutput(this.childProducer
            ? await this.childProducer({
                job: deepFreeze(structuredClone(job)),
                batch,
                assignment,
                executionProfile: deepFreeze(structuredClone(executionProfile)),
                artifact,
                facts: workFacts,
                sourceSlices: slices,
                candidate: structuredClone(candidate),
                contextCandidates: deepFreeze(structuredClone(contextCandidates)),
                scopedArtifacts: deepFreeze(structuredClone(scopedArtifacts)),
              })
            : {
                gap: {
                  code: "NO_ELIGIBLE_PRODUCER",
                  message: `No executable producer is mounted for Child slot ${assignment.slotId}`,
                },
              }, allowset);
        } catch (error) {
          invalidChildOutput = true;
          output = { gap: { code: "INVALID_OR_FAILED_PRODUCER_OUTPUT", message: error.message } };
        }
        const outputCandidates = output.candidates ?? output.candidateFeatures ?? [];
        const childEvidenceFactIds = [...new Set(
          outputCandidates.flatMap(({ evidenceFactIds: ids = [] }) => ids),
        )].sort();
        const childSourceSliceIds = [...new Set(
          outputCandidates.flatMap(({ sourceSliceIds: ids = [] }) => ids),
        )].sort();
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
          evidenceFactIds: childEvidenceFactIds,
          sourceSliceIds: childSourceSliceIds,
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
      if (invalidChildOutput) {
        throw new TypeError("AnalysisBatch contains invalid Child producer output");
      }
      const candidateOptions = childResults.flatMap((result) => {
        if (result.status !== "COMPLETED") return [];
        const outputCandidates = result.output?.candidates ?? result.output?.candidateFeatures ?? [];
        return outputCandidates.map((proposal, index) => ({
          ref: `${result.id}:${index}`,
          childResultId: result.id,
          childWorkUnitId: result.childWorkUnitId,
          slotId: result.slotId,
          independenceGroup: result.independenceGroup,
          proposal: structuredClone(proposal),
        }));
      });
      if (candidateOptions.length === 0) {
        const gap = this.#gap(job, workUnit.id, "NO_CHILD_CANDIDATE");
        gaps.push(gap);
        await this.store.appendUnderstandingRecord(job.projectId, "GAP", gap);
        continue;
      }
      let mainOutput;
      try {
        mainOutput = validateMainProducerOutput(this.mainProducer
          ? await this.mainProducer({
              job: deepFreeze(structuredClone(job)),
              batch,
              route: deepFreeze(structuredClone(executionProfile.mainAgent)),
              executionProfile: deepFreeze(structuredClone(executionProfile)),
              workUnit: deepFreeze(structuredClone(workUnit)),
              artifact,
              facts: deepFreeze(structuredClone(workFacts)),
              childResults: deepFreeze(structuredClone(childResults)),
              candidateOptions: deepFreeze(structuredClone(candidateOptions)),
              contextCandidates: deepFreeze(structuredClone(contextCandidates)),
              scopedArtifacts: deepFreeze(structuredClone(scopedArtifacts)),
            })
          : null, candidateOptions);
      } catch (error) {
        const gap = this.#gap(job, workUnit.id, "INVALID_OR_FAILED_MAIN_PRODUCER_OUTPUT");
        gaps.push(gap);
        await this.store.appendUnderstandingRecord(job.projectId, "GAP", {
          ...gap,
          details: { message: error.message },
        });
        continue;
      }
      const mainResult = deepFreeze({
        id: contentId("MAIN-BATCH-RESULT", {
          analysisBatchId: batch.id,
          childResultIds: childResults.map(({ id }) => id),
          output: mainOutput,
        }),
        projectId: job.projectId,
        snapshotManifestId: job.snapshotManifestId,
        analysisRunId: job.id,
        analysisBatchId: batch.id,
        route: structuredClone(executionProfile.mainAgent),
        profileRevisionId: executionProfile.id,
        childResultIds: childResults.map(({ id }) => id),
        output: structuredClone(mainOutput),
        outputDigest: contentId("MAIN-BATCH-OUTPUT", mainOutput),
        status: "COMPLETED",
        createdAt: this.clock().toISOString(),
      });
      const batchCandidates = [];
      const batchConflicts = [];
      const batchGaps = [];
      const batchRelations = [];
      try {
        const optionsByRef = new Map(candidateOptions.map((option) => [option.ref, option]));
        const admitted = mainOutput.candidateDecisions.filter(({ disposition }) => disposition !== "REJECT");
        const decisionsByRef = new Map(mainOutput.candidateDecisions.map((decision) => [decision.candidateRef, decision]));
        const mergeComponents = mergeComponentsByRef(decisionsByRef);
        const candidateIdByRef = new Map();
        const processedRefs = new Set();
        for (const decision of admitted) {
          if (processedRefs.has(decision.candidateRef)) continue;
          const admittedRefs = decision.disposition === "MERGE"
            ? mergeComponents.get(decision.candidateRef)
            : [decision.candidateRef];
          admittedRefs.forEach((ref) => processedRefs.add(ref));
          const mergedOptions = admittedRefs.map((ref) => optionsByRef.get(ref));
          const option = mergedOptions[0];
          const semanticCandidate = decision.disposition === "MERGE" ? decision.mergedProposal : option.proposal;
          const reconciledEvidenceFactIds = [...new Set(
            mergedOptions.flatMap(({ proposal }) => proposal.evidenceFactIds ?? []),
          )].sort();
          const reconciledSourceSliceIds = [...new Set(
            mergedOptions.flatMap(({ proposal }) => proposal.sourceSliceIds ?? []),
          )].sort();
          const selectedSlot = executionProfile.childSlots.find(({ id }) => id === option.slotId);
          const childProducer = selectedSlot ? producerForSlot(selectedSlot) : decision.selected?.[0];
          const reconciledCandidate = validateReconciledCandidateProjection({
            ...candidate,
            id: contentId("UNDERSTANDING-CANDIDATE", {
              workUnitId: workUnit.id,
              artifactId: artifact.id,
              evidenceFactIds: reconciledEvidenceFactIds,
              sourceSliceIds: reconciledSourceSliceIds,
              candidateInputs: mergedOptions.map(({ slotId, proposal }) => ({ slotId, proposal }))
                .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
              proposal: semanticCandidate,
            }),
            proposal: {
              ...candidate.proposal,
              name: semanticCandidate.name ?? semanticCandidate.displayName ?? candidate.proposal.name,
              statement: semanticCandidate.statement ?? semanticCandidate.description ?? candidate.proposal.statement,
            },
            subjectKey: scopedArtifacts.some(({ relativePath }) => relativePath === semanticCandidate.subjectKey)
              ? semanticCandidate.subjectKey
              : candidate.subjectKey,
            evidenceFactIds: reconciledEvidenceFactIds,
            sourceSliceIds: reconciledSourceSliceIds,
            confidence: semanticCandidate.confidence ?? candidate.confidence,
            producer: childProducer,
            analysisBatchId: batch.id,
            mainResultId: mainResult.id,
            mainDisposition: decision.disposition,
            mainRationale: decision.rationale,
            mergedFromCandidateRefs: decision.disposition === "MERGE" ? admittedRefs : [],
            childResultIds: [...new Set(mergedOptions.map(({ childResultId }) => childResultId))].sort(),
            independenceGroups: [...new Set(mergedOptions.map(({ independenceGroup }) => independenceGroup))].sort(),
          });
          validateCandidateAgainstEvidenceAllowset(reconciledCandidate, allowset);
          batchCandidates.push(reconciledCandidate);
          for (const ref of admittedRefs) candidateIdByRef.set(ref, reconciledCandidate.id);
        }
        for (const decision of mainOutput.candidateDecisions.filter(({ disposition }) => disposition === "CONFLICT")) {
          const candidateIds = [decision.candidateRef, ...(decision.relatedCandidateRefs ?? [])]
            .map((ref) => candidateIdByRef.get(ref))
            .filter(Boolean)
            .sort();
          batchConflicts.push(deepFreeze({
            id: contentId("MAIN-CANDIDATE-CONFLICT", {
              analysisRunId: job.id,
              analysisBatchId: batch.id,
              candidateIds,
              rationale: decision.rationale,
            }),
            subject: optionsByRef.get(decision.candidateRef)?.proposal?.subjectKey ?? artifact.relativePath,
            type: "MAIN_AGENT_CONFLICT",
            candidateIds,
            status: "UNRESOLVED",
            reason: decision.rationale,
            source: "MAIN_AGENT",
            mainResultId: mainResult.id,
            evidence: candidateIds.map((id) => {
              const candidate = batchCandidates.find((item) => item.id === id);
              return { id, evidenceFactIds: candidate?.evidenceFactIds ?? [], sourceSliceIds: candidate?.sourceSliceIds ?? [] };
            }),
          }));
        }
        for (const mainGap of mainOutput.gaps ?? []) {
          batchGaps.push(deepFreeze({
            ...this.#gap(job, workUnit.id, `MAIN:${mainGap.code}`),
            details: { message: mainGap.message, mainResultId: mainResult.id },
          }));
        }
        const boundedNodeIds = new Set([
          artifact.id,
          ...scopedArtifacts.map(({ id }) => id),
          ...contextCandidates.map(({ id }) => id),
          ...candidateIdByRef.values(),
        ]);
        const siblingEvidenceAllowset = {
          projectId: job.projectId,
          snapshotManifestId: job.snapshotManifestId,
          analysisRunId: job.id,
          workUnitId: workUnit.id,
          factIds: [...new Set(candidateOptions.flatMap(({ proposal }) => proposal.evidenceFactIds ?? []))].sort(),
          sourceSliceIds: [...new Set(candidateOptions.flatMap(({ proposal }) => proposal.sourceSliceIds ?? []))].sort(),
        };
        for (const relation of mainOutput.relations ?? []) {
          const sourceId = relation.sourceArtifactId ?? candidateIdByRef.get(relation.sourceCandidateRef);
          const targetId = relation.targetArtifactId ?? candidateIdByRef.get(relation.targetCandidateRef);
          if (!boundedNodeIds.has(sourceId) || !boundedNodeIds.has(targetId)) {
            throw new TypeError("Main producer relation escapes the bounded AnalysisBatch nodes");
          }
          if (typeof relation.predicate !== "string" || relation.predicate.trim() === "") {
            throw new TypeError("Main producer relation predicate is required");
          }
          const relationEvidenceFactIds = [...(relation.evidenceFactIds ?? [])].sort();
          const relationSourceSliceIds = [...(relation.sourceSliceIds ?? [])].sort();
          const candidateRelation = {
            id: contentId("UNDERSTANDING-CANDIDATE-RELATION", {
              workUnitId: workUnit.id,
              sourceId,
              predicate: relation.predicate,
              targetId,
              evidenceFactIds: relationEvidenceFactIds,
              sourceSliceIds: relationSourceSliceIds,
            }),
            projectId: job.projectId,
            snapshotManifestId: job.snapshotManifestId,
            analysisRunId: job.id,
            workUnitId: workUnit.id,
            sourceId,
            predicate: relation.predicate,
            targetId,
            evidenceFactIds: relationEvidenceFactIds,
            sourceSliceIds: relationSourceSliceIds,
            analysisBatchId: batch.id,
            mainResultId: mainResult.id,
          };
          validateRelationAgainstEvidenceAllowset(candidateRelation, siblingEvidenceAllowset);
          validateRelationAgainstEvidenceAllowset(candidateRelation, allowset);
          batchRelations.push(deepFreeze(candidateRelation));
        }
      } catch (error) {
        const gap = deepFreeze({
          ...this.#gap(job, workUnit.id, "INVALID_OR_FAILED_MAIN_PRODUCER_OUTPUT"),
          details: { message: error.message },
        });
        await this.store.appendUnderstandingRecord(job.projectId, "GAP", gap);
        throw new TypeError("Main producer output failed final batch validation", { cause: error });
      }
      await this.store.appendUnderstandingRecord(job.projectId, "MAIN_BATCH_RESULT", mainResult);
      for (const gap of batchGaps) await this.store.appendUnderstandingRecord(job.projectId, "GAP", gap);
      mainResultIds.push(mainResult.id);
      candidates.push(...batchCandidates);
      mainConflicts.push(...batchConflicts);
      gaps.push(...batchGaps);
      relations.push(...batchRelations);
    }
    const bundle = deepFreeze({
      id: contentId("UNDERSTANDING-CANDIDATE-BUNDLE", { analysisRunId: job.id, candidates, relations, gaps, mainConflicts }),
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      workspaceExecutionProfileRevisionId: executionProfile.id,
      executionPolicyDigest: job.policyDigest,
      reuseContract: incrementalPlan.reuseContract,
      candidates,
      relations,
      mainConflicts,
      gaps,
      routeDecisionIds,
      analysisBatchIds,
      mainResultIds,
      createdAt: this.clock().toISOString(),
    });
    await this.store.appendUnderstandingRecord(job.projectId, "CANDIDATE_BUNDLE", bundle);
    return {
      candidateBundleId: bundle.id,
      routeDecisionIds,
      analysisBatchIds,
      mainResultIds,
      gapIds: gaps.map(({ id }) => id),
      reusedWorkUnitIds: [...reusedWorkUnitIds].sort(),
      revalidatedWorkUnitIds: plan.workUnits.map(({ id }) => id)
        .filter((id) => !reusedWorkUnitIds.has(id)),
      reusedCandidateIds: [...reusedCandidateIds].sort(),
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
      relations: bundle.relations ?? [],
      conflicts: bundle.mainConflicts ?? [],
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
    const factBundle = await this.store.getUnderstandingRecord(
      job.projectId,
      "FACT_BUNDLE",
      job.outputs.FACT_COMMIT.factBundleId,
    );
    const surface = createUnderstandingSemanticSurface({
      inventory,
      factBundle,
      candidateBundle: bundle,
      reconciliation,
    });
    const storedSurface = createStoredUnderstandingSurface({ job, surface }, this.clock);
    await this.store.appendUnderstandingRecord(
      job.projectId,
      "UNDERSTANDING_SEMANTIC_SURFACE",
      storedSurface,
    );
    if (job.purpose === "EQUIVALENCE_VERIFICATION") {
      return {
        status: "VERIFIED",
        semanticSurfaceRecordId: storedSurface.id,
        surfaceDigest: surface.digest,
      };
    }
    const equivalenceReport = await measureUnderstandingEquivalence({
      job,
      surface,
      resolver: this.equivalenceResolver,
      store: this.store,
      clock: this.clock,
    });
    await this.store.appendUnderstandingRecord(job.projectId, "EQUIVALENCE_REPORT", equivalenceReport);
    if (this.reviewedEvaluationResolver) {
      const reviewedInput = await this.reviewedEvaluationResolver({
        job: deepFreeze(structuredClone(job)),
        inventory,
        candidateBundle: bundle,
        reconciliation,
        semanticSurface: surface,
        equivalenceReport,
      });
      if (reviewedInput) {
        const { reviewedMeasurement, ...evaluationInput } = reviewedInput;
        if (!reviewedMeasurement) throw new TypeError("output-bound reviewed measurement record is required");
        const classifiedMeasurement = this.publicationMetadata
          ? { ...reviewedMeasurement, ...this.publicationMetadata, independent: false }
          : reviewedMeasurement;
        await this.store.appendUnderstandingRecord(
          job.projectId,
          "REVIEWED_MEASUREMENT",
          classifiedMeasurement,
        );
        const evaluated = evaluateUnderstanding({
          ...evaluationInput,
          projectId: job.projectId,
          analysisRunId: job.id,
          inventory: {
            totalCount: inventory.totalCount,
            disposedCount: inventory.disposedCount,
          },
        }, this.clock);
        const evaluation = this.publicationMetadata ? deepFreeze({
          ...structuredClone(evaluated),
          ...this.publicationMetadata,
          reviewer: {
            ...structuredClone(evaluated.reviewer),
            independent: false,
            evidenceType: this.publicationMetadata.evaluationEvidenceType,
          },
        }) : evaluated;
        await this.store.appendUnderstandingRecord(job.projectId, "EVALUATION_RUN", evaluation);
        return {
          evaluationRunId: evaluation.id,
          equivalenceReportId: equivalenceReport.id,
          status: evaluation.status,
        };
      }
    }
    throw new TypeError("Publication requires a sealed Truth Set and an independently reviewed evaluation");
  }

  async #project(job) {
    if (job.purpose === "EQUIVALENCE_VERIFICATION") {
      return {
        verificationOnly: true,
        semanticSurfaceRecordId: job.outputs.EVALUATION.semanticSurfaceRecordId,
        surfaceDigest: job.outputs.EVALUATION.surfaceDigest,
      };
    }
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
      relations: reconciliation.relations ?? [],
    };
    const evidenceAllowsets = Object.fromEntries(
      (await this.store.listUnderstandingRecords(job.projectId, "EVIDENCE_ALLOWSET"))
        .filter(({ analysisRunId }) => analysisRunId === job.id)
        .map((allowset) => [allowset.workUnitId, allowset]),
    );
    const currentFactIds = new Set(facts.map(({ id }) => id));
    for (const relation of bundle.relations) {
      const allowset = evidenceAllowsets[relation.workUnitId];
      if (!allowset) throw new TypeError(`Candidate relation ${relation.id} has no projection evidence allowset`);
      validateRelationAgainstEvidenceAllowset(relation, allowset);
      if (relation.evidenceFactIds.some((factId) => !currentFactIds.has(factId))) {
        throw new TypeError(`Candidate relation ${relation.id} cites a Fact outside the projected FactBundle`);
      }
    }
    const referencedSourceSliceIds = new Set([
      ...bundle.candidates.flatMap(({ sourceSliceIds = [] }) => sourceSliceIds),
      ...(bundle.relations ?? []).flatMap(({ sourceSliceIds = [] }) => sourceSliceIds),
    ]);
    const sourceSlices = (await this.store.listUnderstandingRecords(job.projectId, "SOURCE_SLICE"))
      .filter(({ id }) => referencedSourceSliceIds.has(id));
    validateProjectionSourceSliceReferences({
      job,
      candidates: bundle.candidates,
      relations: bundle.relations,
      sourceSlices,
    });
    const inventoryArtifactIds = new Set(inventory.artifacts.map(({ id }) => id));
    for (const slice of sourceSlices) {
      if (slice.artifactSlices.some(({ artifactId }) => !inventoryArtifactIds.has(artifactId))) {
        throw new TypeError(`SourceSlice ${slice.id} cites an Artifact outside the graph Snapshot`);
      }
    }
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
    const sourceSliceNodes = sourceSlices.map((slice) => ({
      id: slice.id,
      type: "SOURCE_SLICE_EVIDENCE",
      authority: "CANDIDATE",
      label: `Authorized source evidence (${slice.status})`,
      workUnitId: slice.workUnitId,
      artifactIds: [...new Set(slice.artifactSlices.map(({ artifactId }) => artifactId))].sort(),
      status: slice.status,
      contentDigest: slice.contentDigest,
      responseDigest: slice.responseDigest,
      policyDecisionId: slice.policyDecisionId,
      redacted: slice.redactions.length > 0,
      truncated: slice.truncated === true,
    }));
    const referencedChildResultIds = new Set(bundle.candidates.flatMap(({ childResultIds = [] }) => childResultIds));
    const childResults = (await this.store.listUnderstandingRecords(job.projectId, "CHILD_BATCH_RESULT"))
      .filter(({ analysisRunId, id }) => analysisRunId === job.id || referencedChildResultIds.has(id));
    const evaluation = await this.store.getUnderstandingRecord(
      job.projectId,
      "EVALUATION_RUN",
      job.outputs.EVALUATION.evaluationRunId,
    );
    const nodes = [
      ...artifactNodes,
      ...sourceSliceNodes,
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
    const featureTraceability = [];
    if (typeof this.store.listFeatureIds === "function") {
      const traceabilityApplication = new TraceabilityApplication({ store: this.store, clock: this.clock });
      for (const featureId of await this.store.listFeatureIds(job.projectId)) {
        const baseline = await this.store.getFeatureBaseline(job.projectId, featureId);
        if (baseline?.feature && !nodes.some(({ id }) => id === baseline.feature.id)) {
          nodes.push({
            id: baseline.feature.id,
            type: "FEATURE",
            authority: "GOVERNED",
            label: baseline.feature.name,
            version: baseline.feature.version,
          });
        }
        const traceability = baseline?.feature
          ? await traceabilityApplication.getFeatureTraceability(
              job.projectId,
              featureId,
              job.snapshotManifestId,
            )
          : null;
        if (traceability) {
          featureTraceability.push({
            featureId,
            featureVersions: baseline.featureHistory ?? [baseline.feature],
            traceability,
          });
        }
      }
    }
    const governedTraceChains = typeof this.store.listCurrentTraceChains === "function"
      ? (await this.store.listCurrentTraceChains(job.projectId))
          .filter(({ snapshotManifestId }) => snapshotManifestId === job.snapshotManifestId)
          .map((chain) => ({ ...structuredClone(chain), subject: { kind: "FEATURE", id: chain.featureId } }))
      : [];
    const governedEdges = [];
    for (const chain of governedTraceChains) {
      for (const segment of chain.segments ?? []) {
        for (const endpoint of [segment.from, segment.to]) {
          if (!nodes.some(({ id }) => id === endpoint.id)) {
            nodes.push({
              id: endpoint.id,
              type: endpoint.type,
              authority: "GOVERNED",
              label: endpoint.id,
              version: endpoint.version,
            });
          }
        }
        governedEdges.push({
          id: segment.id,
          source: segment.from.id,
          target: segment.to.id,
          type: segment.relation,
          authority: segment.provenance.includes("EVIDENCE") || segment.provenance.includes("RUNNER")
            ? "DETERMINISTIC_FACT"
            : "GOVERNED",
          status: segment.status,
        });
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
      [...candidate.evidenceFactIds, ...candidate.sourceSliceIds]
        .filter((evidenceId) => nodeIds.has(evidenceId)).map((evidenceId) => ({
        id: contentId("GRAPH-EDGE", { source: candidate.id, target: evidenceId, type: "SUPPORTED_BY" }),
        source: candidate.id,
        target: evidenceId,
        type: "SUPPORTED_BY",
        authority: "CANDIDATE",
      })));
    const candidateRelationEdges = bundle.relations.map((relation) => {
      if (!nodeIds.has(relation.sourceId) || !nodeIds.has(relation.targetId)) {
        throw new TypeError(`Candidate relation ${relation.id} cannot resolve both endpoints in the canonical graph`);
      }
      return {
        id: relation.id,
        source: relation.sourceId,
        target: relation.targetId,
        type: relation.predicate,
        authority: "CANDIDATE",
        workUnitId: relation.workUnitId,
        analysisBatchId: relation.analysisBatchId,
        mainResultId: relation.mainResultId,
        evidenceFactIds: [...relation.evidenceFactIds],
        sourceSliceIds: [...relation.sourceSliceIds],
      };
    });
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
    const edges = [
      ...factArtifactEdges,
      ...referenceEdges,
      ...candidateEvidenceEdges,
      ...candidateRelationEdges,
      ...childEvidenceEdges,
      ...evaluationEdges,
      ...governedEdges,
    ];
    const traceChains = bundle.candidates.map((candidate) => {
      const candidateFacts = facts.filter(({ id }) => candidate.evidenceFactIds.includes(id));
      const candidateSourceSlices = sourceSlices.filter(({ id }) => candidate.sourceSliceIds.includes(id));
      const candidateArtifacts = [...new Set([
        ...candidateFacts.map(({ artifactId }) => artifactId),
        ...candidateSourceSlices.flatMap(({ artifactSlices }) => artifactSlices.map(({ artifactId }) => artifactId)),
      ])];
      const reviewedChain = governedTraceChains.find((chain) => (chain.segments ?? []).some((segment) =>
        segment.from?.id === candidate.id || segment.to?.id === candidate.id));
      const reviewedNodeIdsByType = new Map();
      for (const segment of reviewedChain?.segments ?? []) {
        for (const endpoint of [segment.from, segment.to]) {
          const ids = reviewedNodeIdsByType.get(endpoint.type) ?? [];
          if (!ids.includes(endpoint.id)) ids.push(endpoint.id);
          reviewedNodeIdsByType.set(endpoint.type, ids);
        }
      }
      const reviewedNodes = (...types) => [...new Set(types.flatMap((type) => reviewedNodeIdsByType.get(type) ?? []))];
      const analysisEvidenceNodeIds = childResults
        .filter(({ id }) => candidate.childResultIds.includes(id))
        .map(({ id }) => id)
        .concat(candidateSourceSlices.map(({ id }) => id));
      const segments = [
        { type: "REQUIREMENT", nodeIds: [...reviewedNodes("REQUIREMENT_DOCUMENT"), ...candidateArtifacts.filter((id) => nodes.find((node) => node.id === id)?.type === "REQUIREMENT_DOCUMENT")] },
        { type: "DESIGN", nodeIds: [...reviewedNodes("DESIGN_DOCUMENT"), ...candidateArtifacts.filter((id) => nodes.find((node) => node.id === id)?.type === "DESIGN_DOCUMENT")] },
        { type: "GOVERNANCE", nodeIds: reviewedNodes("FEATURE", "CLAIM", "DECISION", "CLAIM_SCOPE") },
        { type: "IMPLEMENTATION", nodeIds: [...reviewedNodes("IMPLEMENTATION_CONFORMANCE", "ENDPOINT", "CODE_SYMBOL", "DATA_OBJECT", "CONFIGURATION", "EXTERNAL_DEPENDENCY"), candidate.id, ...candidate.evidenceFactIds, ...candidateArtifacts.filter((id) => nodes.find((node) => node.id === id)?.type === "IMPLEMENTATION_ARTIFACT")] },
        { type: "TEST", nodeIds: [...reviewedNodes("TEST_SPEC", "TEST_ASSERTION"), ...candidateArtifacts.filter((id) => nodes.find((node) => node.id === id)?.type === "TEST_ASSET")] },
        { type: "EXECUTION", nodeIds: reviewedNodes("TEST_EXECUTION") },
        { type: "VERIFICATION", nodeIds: reviewedChain?.dimensions?.verification === "PASS" ? reviewedNodes("TEST_EXECUTION") : [] },
        { type: "EVIDENCE", nodeIds: [...reviewedNodes("EVIDENCE"), ...candidateSourceSlices.map(({ id }) => id)] },
      ];
      const chainGaps = segments.filter(({ nodeIds: segmentNodeIds }) => segmentNodeIds.length === 0)
        .map(({ type }) => ({ type: `MISSING_${type}`, status: "OPEN" }));
      return {
        id: contentId("UNDERSTANDING-TRACE-CHAIN", {
          candidateId: candidate.id,
          evidenceFactIds: candidate.evidenceFactIds,
          sourceSliceIds: candidate.sourceSliceIds,
        }),
        subject: { kind: "CANDIDATE", id: candidate.id },
        status: reviewedCandidateTraceComplete(reviewedChain, chainGaps) ? "REVIEWED_COMPLETE" : "CANDIDATE_REVIEW_REQUIRED",
        nodeIds: [...new Set([
          ...segments.flatMap(({ nodeIds: segmentNodeIds }) => segmentNodeIds),
          ...analysisEvidenceNodeIds,
        ])],
        segments,
        analysisEvidenceNodeIds,
        gaps: chainGaps,
        complete: reviewedCandidateTraceComplete(reviewedChain, chainGaps),
      };
    });
    const candidateRelationById = new Map(bundle.relations.map((relation) => [relation.id, relation]));
    const relationTraceChains = edges.map((edge) => {
      const candidateRelation = candidateRelationById.get(edge.id);
      const evidenceNodeIds = candidateRelation
        ? [...candidateRelation.evidenceFactIds, ...candidateRelation.sourceSliceIds]
        : [];
      if (evidenceNodeIds.some((id) => !nodeIds.has(id))) {
        throw new TypeError(`Candidate relation ${edge.id} evidence cannot resolve in the canonical graph`);
      }
      return {
        id: contentId("UNDERSTANDING-RELATION-TRACE-CHAIN", {
          edgeId: edge.id,
          evidenceNodeIds,
        }),
        subject: { kind: "RELATION", id: edge.id },
        status: "RELATION_REVIEW_REQUIRED",
        nodeIds: [...new Set([edge.source, edge.target, ...evidenceNodeIds])],
        segments: [
          { type: "RELATION", nodeIds: [edge.source, edge.target] },
          ...(candidateRelation ? [{ type: "EVIDENCE", nodeIds: evidenceNodeIds }] : []),
        ],
        analysisEvidenceNodeIds: evidenceNodeIds,
        gaps: [{ type: "MISSING_GOVERNED_LINEAGE", status: "OPEN" }],
        complete: false,
      };
    });

    const delta = await this.#incrementalDelta(job, nodes, edges);
    const graphArtifact = createImmutableGraphArtifact({
      projectId: job.projectId,
      snapshotManifestId: job.snapshotManifestId,
      analysisRunId: job.id,
      nodes,
      edges,
      featureTraceability,
      traceChains: [...traceChains, ...governedTraceChains, ...relationTraceChains],
      gaps: bundle.gaps,
      ...delta,
      ...(this.publicationMetadata ?? {}),
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
        ...(job.reanalysisOfGraphRevisionId
          ? { reanalysisOfGraphRevisionId: job.reanalysisOfGraphRevisionId }
          : {}),
        ...(this.publicationMetadata ?? {}),
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
    if (job.purpose === "EQUIVALENCE_VERIFICATION") {
      return {
        verificationOnly: true,
        published: false,
        semanticSurfaceRecordId: job.outputs.EVALUATION.semanticSurfaceRecordId,
      };
    }
    requirePassedUnderstandingEvaluation(job.outputs.EVALUATION.status);
    if (job.purpose === "HISTORICAL_REANALYSIS") {
      return {
        historicalGraphRevision: await this.store.publishHistoricalGraphRevision(
          job.projectId,
          job.outputs.PROJECTION.graphRevisionId,
          job.reanalysisOfGraphRevisionId,
        ),
        published: true,
        currentGraphHeadChanged: false,
      };
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
