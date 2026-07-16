import { deepFreeze } from "./canonical-json.js";

function counts(values) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
}

function durationSummary(values) {
  const durations = values.filter(Number.isFinite).map((value) => Math.max(0, value)).sort((a, b) => a - b);
  if (durations.length === 0) return { count: 0, minMs: null, meanMs: null, p95Ms: null, maxMs: null };
  return {
    count: durations.length,
    minMs: durations[0],
    meanMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p95Ms: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)],
    maxMs: durations.at(-1),
  };
}

function ratio(numerator, denominator) {
  return { numerator, denominator, ratio: denominator === 0 ? null : numerator / denominator };
}

function candidates(run) {
  const output = run.mergedOutput;
  return output ? (output.candidateFeatures?.length ?? 0) + (output.candidateClaims?.length ?? 0) +
    (output.candidateTestSpecs?.length ?? 0) + (output.openQuestions?.length ?? 0) : 0;
}

export function createPlatformOperationsMetrics(projectId, observations, clock = () => new Date()) {
  const reverseRuns = observations.reverseRuns ?? [];
  const skillRuns = reverseRuns.flatMap((run) => run.skillRuns ?? []);
  const skillAttempts = skillRuns.flatMap((run) => run.attempts ?? []);
  const queuedStatuses = new Set(["QUEUED", "STARTED", "CANCEL_REQUESTED"]);
  const scanners = observations.factBundles ?? [];
  const byExtractor = new Map();
  for (const bundle of scanners) {
    const key = `${bundle.extractorId}@${bundle.extractorVersion}`;
    const current = byExtractor.get(key) ?? { extractorId: bundle.extractorId, extractorVersion: bundle.extractorVersion, bundleCount: 0, incompleteBundleCount: 0, nodeCount: 0, edgeCount: 0 };
    current.bundleCount += 1;
    current.incompleteBundleCount += Number(!bundle.complete);
    current.nodeCount += bundle.nodeCount;
    current.edgeCount += bundle.edgeCount;
    byExtractor.set(key, current);
  }
  const executions = observations.testExecutions ?? [];
  const histories = new Map();
  for (const execution of executions) {
    const key = `${execution.testSpecId}@${execution.testSpecVersion}`;
    const statuses = histories.get(key) ?? new Set();
    statuses.add(execution.status);
    histories.set(key, statuses);
  }
  const unstableTestSpecCount = [...histories.values()].filter((statuses) => statuses.size > 1).length;
  const evidence = observations.evidence ?? [];
  const lifecycleActions = (observations.evidenceLifecycleEvents ?? []).map((event) => event.action);
  const impacts = observations.changeImpacts ?? [];
  const unavailableSignals = [
    ["RUNNER_HEARTBEAT_AND_RESOURCE_USAGE", "Runner heartbeat, CPU, memory, and capacity telemetry require a connected enterprise Runner control plane."],
    ["MODEL_TOKEN_COST", "Reverse Skill records do not currently receive provider usage and cost attestations."],
    ["EVIDENCE_UPLOAD_AND_REDACTION_DURATION", "Evidence manifests prove redaction and storage identity but do not yet include pipeline stage timings."],
  ].map(([signal, reason]) => ({ signal, status: "UNAVAILABLE", reason }));
  return deepFreeze({
    projectId,
    computedAt: clock().toISOString(),
    reverseRuns: {
      runCount: reverseRuns.length,
      statusCounts: counts(reverseRuns.map((run) => run.status)),
      duration: durationSummary(reverseRuns.map((run) => Date.parse(run.statusHistory?.at(-1)?.occurredAt) - Date.parse(run.statusHistory?.[0]?.occurredAt))),
      skillExecutionCount: skillRuns.length,
      attemptCount: skillAttempts.length,
      retryCount: skillRuns.reduce((sum, run) => sum + Math.max(0, (run.attempts?.length ?? 0) - 1), 0),
      failedAttemptCount: skillAttempts.filter((attempt) => attempt.status === "FAILED").length,
      inputNodeCount: reverseRuns.reduce((sum, run) => sum + (run.inputPackage?.facts?.nodes?.length ?? 0), 0),
      inputEdgeCount: reverseRuns.reduce((sum, run) => sum + (run.inputPackage?.facts?.edges?.length ?? 0), 0),
      outputCandidateCount: reverseRuns.reduce((sum, run) => sum + candidates(run), 0),
      queue: {
        jobCount: (observations.reverseJobs ?? []).length,
        activeCount: (observations.reverseJobs ?? []).filter((job) => queuedStatuses.has(job.status)).length,
        statusCounts: counts((observations.reverseJobs ?? []).map((job) => job.status)),
      },
    },
    scanners: {
      bundleCount: scanners.length,
      incompleteBundleCount: scanners.filter((bundle) => !bundle.complete).length,
      nodeCount: scanners.reduce((sum, bundle) => sum + bundle.nodeCount, 0),
      edgeCount: scanners.reduce((sum, bundle) => sum + bundle.edgeCount, 0),
      byExtractor: [...byExtractor.values()].sort((left, right) => left.extractorId.localeCompare(right.extractorId)),
    },
    tests: {
      executionCount: executions.length,
      statusCounts: counts(executions.map((execution) => execution.status)),
      duration: durationSummary(executions.map((execution) => Date.parse(execution.finishedAt) - Date.parse(execution.startedAt))),
      attemptCount: executions.reduce((sum, execution) => sum + (execution.attempts?.length ?? 0), 0),
      retryCount: executions.reduce((sum, execution) => sum + Math.max(0, (execution.attempts?.length ?? 0) - 1), 0),
      observedTestSpecCount: histories.size,
      unstableTestSpecCount,
      stabilityRate: ratio(histories.size - unstableTestSpecCount, histories.size),
    },
    evidence: {
      evidenceCount: evidence.length,
      integrityCounts: counts(evidence.map((item) => item.integrity)),
      freshnessCounts: counts(evidence.map((item) => item.freshness)),
      typeCounts: counts(evidence.map((item) => item.type)),
      externalObjectCount: evidence.filter((item) => typeof item.storageUri === "string").length,
      lifecycleActionCounts: counts(lifecycleActions),
    },
    impactAnalysis: {
      assessmentCount: impacts.length,
      duration: durationSummary(impacts.map((item) => Date.parse(item.impactCreatedAt) - Date.parse(item.changeSetCreatedAt))),
      changedFactCount: impacts.reduce((sum, item) => sum + item.changedFactCount, 0),
      affectedFeatureCount: impacts.reduce((sum, item) => sum + item.affectedFeatureCount, 0),
      regressionSelectionCount: impacts.reduce((sum, item) => sum + item.regressionSelectionCount, 0),
    },
    unavailableSignals,
  });
}
