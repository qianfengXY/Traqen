import type { LocalCandidate, LocalCandidateTreeNode, LocalWorkspaceAnalysis } from "./local-workspace-analysis";

export type LocalWorkspaceStatistics = {
  candidateCount: number;
  designImplementationCount: number;
  configurationItemCount: number;
  candidatesWithConfigurationCount: number;
  testAssetCount: number;
  candidatesWithTestAssetsCount: number;
  executionEvidenceGapCount: number;
  pendingHumanConfirmationCount: number;
  completeEvidenceChainCount: number;
  incompleteEvidenceChainCount: number;
  blockingGapCount: number;
  warningGapCount: number;
  unreviewedImplementationCount: number;
  conflictCount: number;
  nonconformingCandidateCount: number;
  byKind: Record<LocalCandidate["kind"], number>;
};

export function findLocalWorkspaceTreeNode(root: LocalCandidateTreeNode, nodeId: string): LocalCandidateTreeNode | null {
  if (root.id === nodeId) return root;
  for (const child of root.children) {
    const found = findLocalWorkspaceTreeNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

export function localWorkspaceTreeCandidateIds(node: LocalCandidateTreeNode) {
  const ids = new Set<string>();
  function visit(current: LocalCandidateTreeNode) {
    if (current.candidateId) ids.add(current.candidateId);
    for (const child of current.children) visit(child);
  }
  visit(node);
  return ids;
}

function isExplicitlyNonconforming(candidate: LocalCandidate) {
  const conformance = String(candidate.dimensions.conformance).toUpperCase();
  const verification = String(candidate.dimensions.verification).toUpperCase();
  return ["NON_CONFORMING", "NONCONFORMING", "VIOLATED"].includes(conformance)
    || ["FAIL", "FAILED", "ERROR"].includes(verification)
    || candidate.gaps.some((gap) => /NON.?CONFORM|VIOLATION|EXECUTION_FAILED/.test(gap.type.toUpperCase()));
}

export function calculateLocalWorkspaceStatistics(candidates: LocalCandidate[]): LocalWorkspaceStatistics {
  const configurationItems = new Set<string>();
  const testAssets = new Set<string>();
  let candidatesWithConfigurationCount = 0;
  let candidatesWithTestAssetsCount = 0;
  let executionEvidenceGapCount = 0;
  let pendingHumanConfirmationCount = 0;
  let completeEvidenceChainCount = 0;
  let blockingGapCount = 0;
  let warningGapCount = 0;
  let unreviewedImplementationCount = 0;
  let conflictCount = 0;
  let nonconformingCandidateCount = 0;
  const byKind: LocalWorkspaceStatistics["byKind"] = { ENDPOINT: 0, CODE_SYMBOL: 0, COMMAND: 0 };

  for (const candidate of candidates) {
    byKind[candidate.kind] += 1;
    for (const item of candidate.configurations) configurationItems.add(`${item.path}\u0000${item.key}`);
    for (const item of candidate.testAssets) testAssets.add(`${item.path}\u0000${item.title}`);
    if (candidate.configurations.length > 0) candidatesWithConfigurationCount += 1;
    if (candidate.testAssets.length > 0) candidatesWithTestAssetsCount += 1;
    if (candidate.gaps.some((gap) => gap.type === "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT")) executionEvidenceGapCount += 1;
    if (String(candidate.dimensions.authority).toUpperCase() !== "CONFIRMED") pendingHumanConfirmationCount += 1;
    if (!["CONFORMING", "CONFORMANT", "VERIFIED"].includes(String(candidate.dimensions.conformance).toUpperCase())) unreviewedImplementationCount += 1;
    if (!["NONE", "NO_CONFLICT"].includes(String(candidate.dimensions.conflict).toUpperCase())) conflictCount += 1;
    blockingGapCount += candidate.gaps.filter((gap) => gap.severity === "BLOCKING").length;
    warningGapCount += candidate.gaps.filter((gap) => gap.severity === "WARNING").length;
    if (isExplicitlyNonconforming(candidate)) nonconformingCandidateCount += 1;

    const evidenceComplete = candidate.gaps.length === 0
      && String(candidate.dimensions.authority).toUpperCase() === "CONFIRMED"
      && ["CONFORMING", "CONFORMANT", "VERIFIED"].includes(String(candidate.dimensions.conformance).toUpperCase())
      && ["PASS", "PASSED"].includes(String(candidate.dimensions.verification).toUpperCase())
      && ["CURRENT", "FRESH"].includes(String(candidate.dimensions.freshness).toUpperCase())
      && ["NONE", "NO_CONFLICT"].includes(String(candidate.dimensions.conflict).toUpperCase());
    if (evidenceComplete) completeEvidenceChainCount += 1;
  }

  return {
    candidateCount: candidates.length,
    designImplementationCount: candidates.filter((candidate) => Boolean(candidate.sourcePath && candidate.code.trim())).length,
    configurationItemCount: configurationItems.size,
    candidatesWithConfigurationCount,
    testAssetCount: testAssets.size,
    candidatesWithTestAssetsCount,
    executionEvidenceGapCount,
    pendingHumanConfirmationCount,
    completeEvidenceChainCount,
    incompleteEvidenceChainCount: candidates.length - completeEvidenceChainCount,
    blockingGapCount,
    warningGapCount,
    unreviewedImplementationCount,
    conflictCount,
    nonconformingCandidateCount,
    byKind,
  };
}

export function localWorkspaceStatisticsForNode(analysis: LocalWorkspaceAnalysis, nodeId: string) {
  const node = findLocalWorkspaceTreeNode(analysis.tree, nodeId) ?? analysis.tree;
  const candidateIds = localWorkspaceTreeCandidateIds(node);
  const candidates = analysis.features.filter((candidate) => candidateIds.has(candidate.id));
  return { node, candidates, statistics: calculateLocalWorkspaceStatistics(candidates) };
}
