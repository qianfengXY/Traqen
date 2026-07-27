import type { LocalFeatureCandidate, LocalFeatureTreeNode, LocalWorkspaceAnalysis } from "./local-workspace-analysis";

export type LocalWorkspaceStatistics = {
  featureCount: number;
  designImplementationCount: number;
  configurationItemCount: number;
  configuredFeatureCount: number;
  testCaseCount: number;
  testedFeatureCount: number;
  executedFeatureCount: number;
  pendingHumanConfirmationCount: number;
  completeEvidenceChainCount: number;
  incompleteEvidenceChainCount: number;
  blockingGapCount: number;
  warningGapCount: number;
  unreviewedImplementationCount: number;
  conflictCount: number;
  nonconformingFeatureCount: number;
  execution: {
    passed: number;
    failed: number;
    error: number;
    skipped: number;
    notRun: number;
  };
  byKind: Record<LocalFeatureCandidate["kind"], number>;
};

export function findLocalWorkspaceTreeNode(root: LocalFeatureTreeNode, nodeId: string): LocalFeatureTreeNode | null {
  if (root.id === nodeId) return root;
  for (const child of root.children) {
    const found = findLocalWorkspaceTreeNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

export function localWorkspaceTreeCandidateIds(node: LocalFeatureTreeNode) {
  const ids = new Set<string>();
  function visit(current: LocalFeatureTreeNode) {
    if (current.candidateId) ids.add(current.candidateId);
    for (const child of current.children) visit(child);
  }
  visit(node);
  return ids;
}

function isExplicitlyNonconforming(feature: LocalFeatureCandidate) {
  const conformance = String(feature.dimensions.conformance).toUpperCase();
  const verification = String(feature.dimensions.verification).toUpperCase();
  return ["NON_CONFORMING", "NONCONFORMING", "VIOLATED"].includes(conformance)
    || ["FAIL", "FAILED", "ERROR"].includes(verification)
    || feature.gaps.some((gap) => /NON.?CONFORM|VIOLATION|EXECUTION_FAILED/.test(gap.type.toUpperCase()));
}

export function calculateLocalWorkspaceStatistics(features: LocalFeatureCandidate[]): LocalWorkspaceStatistics {
  const configurationItems = new Set<string>();
  const testCases = new Set<string>();
  const execution = { passed: 0, failed: 0, error: 0, skipped: 0, notRun: 0 };
  let configuredFeatureCount = 0;
  let testedFeatureCount = 0;
  let executedFeatureCount = 0;
  let pendingHumanConfirmationCount = 0;
  let completeEvidenceChainCount = 0;
  let blockingGapCount = 0;
  let warningGapCount = 0;
  let unreviewedImplementationCount = 0;
  let conflictCount = 0;
  let nonconformingFeatureCount = 0;
  const byKind: LocalWorkspaceStatistics["byKind"] = { ENDPOINT: 0, CODE_SYMBOL: 0, COMMAND: 0 };

  for (const feature of features) {
    byKind[feature.kind] += 1;
    for (const item of feature.configurations) configurationItems.add(`${item.path}\u0000${item.key}`);
    for (const item of feature.tests) testCases.add(`${item.path}\u0000${item.title}`);
    if (feature.configurations.length > 0) configuredFeatureCount += 1;
    if (feature.tests.length > 0) testedFeatureCount += 1;
    if (String(feature.dimensions.authority).toUpperCase() !== "CONFIRMED") pendingHumanConfirmationCount += 1;
    if (!["CONFORMING", "CONFORMANT", "VERIFIED"].includes(String(feature.dimensions.conformance).toUpperCase())) unreviewedImplementationCount += 1;
    if (!["NONE", "NO_CONFLICT"].includes(String(feature.dimensions.conflict).toUpperCase())) conflictCount += 1;
    blockingGapCount += feature.gaps.filter((gap) => gap.severity === "BLOCKING").length;
    warningGapCount += feature.gaps.filter((gap) => gap.severity === "WARNING").length;
    if (isExplicitlyNonconforming(feature)) nonconformingFeatureCount += 1;

    const verification = String(feature.dimensions.verification).toUpperCase();
    if (["PASS", "PASSED"].includes(verification)) {
      execution.passed += 1;
      executedFeatureCount += 1;
    } else if (["FAIL", "FAILED"].includes(verification)) {
      execution.failed += 1;
      executedFeatureCount += 1;
    } else if (verification === "ERROR") {
      execution.error += 1;
      executedFeatureCount += 1;
    } else if (["SKIP", "SKIPPED", "CANCELLED"].includes(verification)) {
      execution.skipped += 1;
      executedFeatureCount += 1;
    } else {
      execution.notRun += 1;
    }

    const evidenceComplete = feature.gaps.length === 0
      && String(feature.dimensions.authority).toUpperCase() === "CONFIRMED"
      && ["CONFORMING", "CONFORMANT", "VERIFIED"].includes(String(feature.dimensions.conformance).toUpperCase())
      && ["PASS", "PASSED"].includes(verification)
      && ["CURRENT", "FRESH"].includes(String(feature.dimensions.freshness).toUpperCase())
      && ["NONE", "NO_CONFLICT"].includes(String(feature.dimensions.conflict).toUpperCase());
    if (evidenceComplete) completeEvidenceChainCount += 1;
  }

  return {
    featureCount: features.length,
    designImplementationCount: features.filter((feature) => Boolean(feature.sourcePath && feature.code.trim())).length,
    configurationItemCount: configurationItems.size,
    configuredFeatureCount,
    testCaseCount: testCases.size,
    testedFeatureCount,
    executedFeatureCount,
    pendingHumanConfirmationCount,
    completeEvidenceChainCount,
    incompleteEvidenceChainCount: features.length - completeEvidenceChainCount,
    blockingGapCount,
    warningGapCount,
    unreviewedImplementationCount,
    conflictCount,
    nonconformingFeatureCount,
    execution,
    byKind,
  };
}

export function localWorkspaceStatisticsForNode(analysis: LocalWorkspaceAnalysis, nodeId: string) {
  const node = findLocalWorkspaceTreeNode(analysis.tree, nodeId) ?? analysis.tree;
  const candidateIds = localWorkspaceTreeCandidateIds(node);
  const features = analysis.features.filter((feature) => candidateIds.has(feature.id));
  return { node, features, statistics: calculateLocalWorkspaceStatistics(features) };
}
