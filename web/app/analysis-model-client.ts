import {
  localWorkspaceEvidencePolicyVersion,
  localWorkspaceFactId,
  type LocalWorkspaceFileRecord,
  type LocalModelClassification,
} from "./local-workspace-analysis.ts";

export type WorkspaceModelEnrichment = {
  id: string;
  evidenceFactIds: string[];
  displayName: string;
  description: string;
  businessFeature: boolean;
  businessKey: string;
  businessModule: string;
  businessSubmodule: string;
  domain: string;
  group: LocalModelClassification["group"];
  confidence: LocalModelClassification["confidence"];
  rationale: string;
  reconciliationStatus?: LocalModelClassification["reconciliationStatus"];
};

export type WorkspaceAgentReconciliationDecision = {
  candidateId: string;
  outcome: "ADMITTED_BUSINESS" | "ADMITTED_API" | "EXCLUDED_TECHNICAL" | "PENDING_AGENT";
  reason: string;
};

export type WorkspaceSourceModule = {
  name: string;
  fileCount: number;
  sourceBytes: number;
  languages: string[];
};

export type WorkspaceEvidenceAssessment = {
  observations: Array<{
    extractor: string;
    basis: string;
    sourcePath: string;
    startLine: number;
    excerpt: string;
  }>;
  corroborations: string[];
  contradictions: string[];
  diagnostics: string[];
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  confidenceCap: "LOW" | "MEDIUM" | "HIGH";
};

export type WorkspaceModelBatchContext = {
  projectId: string;
  snapshotManifestId: string;
  analysisRunId: string;
};

function evidenceKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sourceLanguage(path: string) {
  const name = path.split("/").at(-1) ?? path;
  if (name.startsWith(".env")) return "env";
  return name.includes(".") ? name.split(".").at(-1)?.toLowerCase() ?? "other" : "other";
}

export function workspaceSourceModule(path: string) {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length <= 1) return "root";
  if (["src", "app", "lib", "packages", "services", "modules"].includes(segments[0]) && segments[1]) return `${segments[0]}/${segments[1]}`;
  return segments[0];
}

export function workspaceSourceManifest(files: Array<{ path: string; size: number }>) {
  const modules = new Map<string, { fileCount: number; sourceBytes: number; languages: Set<string> }>();
  for (const file of files) {
    const name = workspaceSourceModule(file.path);
    const current = modules.get(name) ?? { fileCount: 0, sourceBytes: 0, languages: new Set<string>() };
    current.fileCount += 1;
    current.sourceBytes += Math.max(0, file.size);
    current.languages.add(sourceLanguage(file.path));
    modules.set(name, current);
  }
  return [...modules.entries()].map(([name, summary]) => ({
    name,
    fileCount: summary.fileCount,
    sourceBytes: summary.sourceBytes,
    languages: [...summary.languages].sort(),
  })).sort((left, right) => right.sourceBytes - left.sourceBytes || left.name.localeCompare(right.name));
}

function extractorFor(candidate: LocalWorkspaceFileRecord["candidates"][number]) {
  if (/OpenAPI document/i.test(candidate.description)) return { extractor: "OPENAPI_DOCUMENT", basis: "Declared API contract operation" };
  if (candidate.sourcePath.endsWith("package.json")) return { extractor: "PACKAGE_MANIFEST", basis: "Declared package script" };
  if (candidate.sourcePath.endsWith(".java")) return { extractor: "JAVA_DECLARATION_PATTERN", basis: "Browser-side Java declaration and annotation pattern; not AST-verified" };
  return { extractor: "SOURCE_PATTERN", basis: "Browser-side language-aware source pattern" };
}

type WorkspaceEvidenceIndex = {
  candidatesByKey: Map<string, LocalWorkspaceFileRecord["candidates"]>;
  testsByKey: Map<string, Array<NonNullable<LocalWorkspaceFileRecord["test"]>>>;
};

function workspaceEvidenceIndex(records: LocalWorkspaceFileRecord[]): WorkspaceEvidenceIndex {
  const candidatesByKey = new Map<string, LocalWorkspaceFileRecord["candidates"]>();
  const testsByKey = new Map<string, Array<NonNullable<LocalWorkspaceFileRecord["test"]>>>();
  for (const record of records) {
    for (const candidate of record.candidates) {
      const key = evidenceKey(candidate.name);
      if (key) candidatesByKey.set(key, [...(candidatesByKey.get(key) ?? []), candidate]);
    }
    if (record.test) {
      for (const testKey of record.test.keys) {
        const key = evidenceKey(testKey);
        if (key.length > 2) testsByKey.set(key, [...(testsByKey.get(key) ?? []), record.test]);
      }
    }
  }
  return { candidatesByKey, testsByKey };
}

function candidateEvidenceAssessment(candidate: LocalWorkspaceFileRecord["candidates"][number], index: WorkspaceEvidenceIndex) {
  const key = evidenceKey(candidate.name);
  const matches = key ? (index.candidatesByKey.get(key) ?? []).filter((item) => item.id !== candidate.id).slice(0, 4) : [];
  const relatedTests = key ? (index.testsByKey.get(key) ?? []).slice(0, 4) : [];
  const primary = extractorFor(candidate);
  const observations = [candidate, ...matches].map((item) => {
    const extraction = extractorFor(item);
    return {
      extractor: extraction.extractor,
      basis: extraction.basis,
      sourcePath: item.sourcePath,
      startLine: item.startLine,
      excerpt: item.code.slice(0, item.id === candidate.id ? 600 : 240),
    };
  });
  const corroborations = [
    ...matches.map((item) => `Matching candidate ${item.name} observed by ${extractorFor(item).extractor} at ${item.sourcePath}:${item.startLine}`),
    ...relatedTests.map((test) => `Related test clue ${test.title} at ${test.path}`),
  ];
  const independentExtractors = new Set(observations.map((observation) => observation.extractor)).size;
  const independentEvidenceKinds = independentExtractors + (relatedTests.length > 0 ? 1 : 0);
  const confidenceCap = independentEvidenceKinds >= 3 ? "HIGH" : independentEvidenceKinds >= 2 ? "MEDIUM" : "LOW";
  const diagnostics = primary.extractor.endsWith("PATTERN") || primary.extractor === "SOURCE_PATTERN"
    ? ["This browser-side observation is heuristic and must be corroborated before it can support medium or high confidence."]
    : [];
  return {
    assessment: {
      observations,
      corroborations,
      contradictions: [],
      diagnostics,
      completeness: corroborations.length > 0 ? "PARTIAL" : "UNKNOWN",
      confidenceCap,
    } satisfies WorkspaceEvidenceAssessment,
    matches,
    relatedTests,
  };
}

export function workspaceModelCandidateBatches(
  records: LocalWorkspaceFileRecord[],
  profileId: string,
  context: WorkspaceModelBatchContext,
  batchSize = 10,
) {
  if (!context?.projectId?.trim() || !context.snapshotManifestId?.trim() || !context.analysisRunId?.trim()) {
    throw new TypeError("Workspace model batches require projectId, snapshotManifestId, and analysisRunId");
  }
  const evidenceIndex = workspaceEvidenceIndex(records);
  const candidates = records.flatMap((record) => record.candidates).filter((candidate) => candidate.modelClassification?.profileId !== profileId
    || candidate.modelClassification.evidencePolicyVersion !== localWorkspaceEvidencePolicyVersion
    || candidate.modelClassification.reconciliationStatus === "PROVISIONAL").map((candidate) => {
    const assessed = candidateEvidenceAssessment(candidate, evidenceIndex);
    const rootEvidenceFactId = localWorkspaceFactId(context.snapshotManifestId, candidate.kind, candidate.id);
    const evidenceFactIds = [...new Set([
      rootEvidenceFactId,
      ...assessed.matches.map((match) => localWorkspaceFactId(context.snapshotManifestId, match.kind, match.id)),
      ...assessed.relatedTests.map((test) => localWorkspaceFactId(context.snapshotManifestId, "TEST-ASSET", `${test.path}:${test.title}`)),
    ])].sort();
    return {
      id: candidate.id,
      projectId: context.projectId,
      snapshotManifestId: context.snapshotManifestId,
      analysisRunId: context.analysisRunId,
      name: candidate.name,
      kind: candidate.kind,
      method: candidate.method,
      modulePath: candidate.modulePath,
      sourcePath: candidate.sourcePath,
      description: candidate.description,
      code: candidate.code,
      evidenceFactIds,
      rootEvidenceFactId,
      evidence: assessed.assessment,
    };
  });
  const batches: typeof candidates[] = [];
  let current: typeof candidates = [];
  for (const candidate of candidates) {
    const proposed = [...current, candidate];
    if (current.length > 0 && (proposed.length > batchSize || JSON.stringify(proposed).length > 60_000)) {
      batches.push(current);
      current = [candidate];
    } else current = proposed;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function provisionalEndpointEnrichment(candidate: ReturnType<typeof workspaceModelCandidateBatches>[number][number]): WorkspaceModelEnrichment {
  const endpointIdentity = `${candidate.method ?? "API"} ${candidate.name}`.trim();
  const businessKey = `api.${endpointIdentity.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 140) || "endpoint"}`;
  return {
    id: candidate.id,
    displayName: candidate.name,
    description: candidate.description,
    businessFeature: false,
    businessKey,
    businessModule: "API services",
    businessSubmodule: "Discovered endpoints",
    domain: "API",
    group: "API_SERVICE",
    confidence: "LOW",
    rationale: "Main Agent admitted the deterministic endpoint definition to the API tree provisionally; semantic classification is still pending.",
    evidenceFactIds: candidate.evidenceFactIds,
    reconciliationStatus: "PROVISIONAL",
  };
}

export function reconcileWorkspaceAgentBatch(
  candidates: ReturnType<typeof workspaceModelCandidateBatches>[number],
  childResults: WorkspaceModelEnrichment[],
) {
  const resultsById = new Map(childResults.map((result) => [result.id, result]));
  const enrichments: WorkspaceModelEnrichment[] = [];
  const decisions: WorkspaceAgentReconciliationDecision[] = [];
  for (const candidate of candidates) {
    const childResult = resultsById.get(candidate.id);
    if (childResult) {
      enrichments.push({ ...childResult, reconciliationStatus: "EVIDENCE_VALIDATED" });
      if (childResult.businessFeature && candidate.kind !== "COMMAND") {
        decisions.push({ candidateId: candidate.id, outcome: "ADMITTED_BUSINESS", reason: "Child-Agent business conclusion matches a bounded scanner candidate and passed evidence validation." });
      } else if (candidate.kind === "ENDPOINT") {
        decisions.push({ candidateId: candidate.id, outcome: "ADMITTED_API", reason: "The endpoint classification matches a deterministic API definition and passed evidence validation." });
      } else {
        decisions.push({ candidateId: candidate.id, outcome: "EXCLUDED_TECHNICAL", reason: "The child Agent classified this scanner candidate as technical support rather than a user-recognizable function." });
      }
      continue;
    }
    if (candidate.kind === "ENDPOINT") {
      enrichments.push(provisionalEndpointEnrichment(candidate));
      decisions.push({ candidateId: candidate.id, outcome: "ADMITTED_API", reason: "The child result was unavailable, but a deterministic endpoint definition supports a provisional API Candidate projection." });
    } else {
      decisions.push({ candidateId: candidate.id, outcome: "PENDING_AGENT", reason: "Scanner evidence is retained, but no validated child-Agent semantic conclusion is available." });
    }
  }
  return { enrichments, decisions };
}
