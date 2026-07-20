import { canonicalJson, contentId, deepFreeze } from "../domain/index.js";

const runModes = new Set(["FULL", "INCREMENTAL", "AUTO"]);
const engineModes = new Set(["DETERMINISTIC", "HYBRID"]);
const terminalStatuses = new Set(["COMPLETED", "COMPLETED_WITH_GAPS", "CANCELLED"]);

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${fieldName} must be a non-empty string`);
  return value.trim();
}

function positiveInteger(value, fieldName, fallback) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 1) throw new TypeError(`${fieldName} must be a positive integer`);
  return candidate;
}

function clone(value) {
  return structuredClone(value);
}

function requestIdentity(request) {
  const { requestedAt: _requestedAt, ...identity } = request;
  return identity;
}

function semanticNode(node) {
  const {
    factId: _factId,
    snapshotManifestId: _snapshotManifestId,
    observedAt: _observedAt,
    validFrom: _validFrom,
    validTo: _validTo,
    bundleId: _bundleId,
    ...semantic
  } = node;
  return semantic;
}

function semanticEdge(edge) {
  const {
    id: _id,
    snapshotManifestId: _snapshotManifestId,
    observedAt: _observedAt,
    bundleId: _bundleId,
    ...semantic
  } = edge;
  return semantic;
}

function tokenEstimate(value) {
  return Math.max(1, Math.ceil(canonicalJson(value).length / 4));
}

function titleFromSymbol(value) {
  return value
    .replace(/^.*[#.:/]/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizedWords(value) {
  return new Set(String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !["api", "http", "service", "controller", "handler"].includes(word)));
}

function similarity(left, right) {
  const leftWords = normalizedWords(left);
  const rightWords = normalizedWords(right);
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  return intersection / new Set([...leftWords, ...rightWords]).size;
}

function jaccard(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  const intersection = [...leftSet].filter((item) => rightSet.has(item)).length;
  return intersection / new Set([...leftSet, ...rightSet]).size;
}

function nodeScope(node) {
  const artifact = String(node.source?.artifact ?? "root").replace(/\\/g, "/");
  const segments = artifact.split("/").filter(Boolean);
  const sourceIndex = segments.indexOf("src");
  if (sourceIndex > 0) return segments.slice(0, sourceIndex).join("/");
  if (["apps", "packages", "services", "modules"].includes(segments[0]) && segments[1]) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] ?? "root";
}

function graphIndexes(graph) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map();
  for (const edge of graph.edges) {
    const subject = adjacency.get(edge.subjectId) ?? [];
    subject.push({ edge, nodeId: edge.objectId });
    adjacency.set(edge.subjectId, subject);
    const object = adjacency.get(edge.objectId) ?? [];
    object.push({ edge, nodeId: edge.subjectId });
    adjacency.set(edge.objectId, object);
  }
  return { nodesById, adjacency };
}

function boundedNeighborhood(rootId, indexes, maximumTokens, maximumDepth = 5) {
  const queue = [{ id: rootId, depth: 0 }];
  const nodeIds = new Set();
  const edgeIds = new Set();
  let estimatedTokens = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (nodeIds.has(current.id)) continue;
    const node = indexes.nodesById.get(current.id);
    if (!node) continue;
    const addition = tokenEstimate(node);
    if (nodeIds.size > 0 && estimatedTokens + addition > maximumTokens) continue;
    nodeIds.add(current.id);
    estimatedTokens += addition;
    if (current.depth >= maximumDepth) continue;
    for (const relation of indexes.adjacency.get(current.id) ?? []) {
      const edgeCost = tokenEstimate(relation.edge);
      if (estimatedTokens + edgeCost <= maximumTokens) {
        edgeIds.add(relation.edge.id);
        estimatedTokens += edgeCost;
        queue.push({ id: relation.nodeId, depth: current.depth + 1 });
      }
    }
  }
  return { nodeIds: [...nodeIds], edgeIds: [...edgeIds], estimatedTokens };
}

function isBusinessRoot(node, incomingPredicates) {
  if (node.type !== "CODE_SYMBOL") return false;
  const kind = String(node.attributes?.kind ?? "").toLowerCase();
  const natural = `${node.naturalKey} ${node.name} ${node.source?.artifact ?? ""}`;
  if (/(?:repository|mapper|dao|dto|entity|configuration|config|test|fixture|mock)/i.test(`${kind} ${natural}`)) return false;
  if (["condition-branch", "state-transition", "exception-path", "permission-check", "enum"].includes(kind)) return false;
  if (incomingPredicates.has("IMPLEMENTED_BY") && ["handler", "route-handler"].includes(kind)) return false;
  return ["service", "usecase"].includes(kind)
    || /(?:service|usecase|application|domain|handler|facade|manager)/i.test(natural);
}

function planRoots(graph) {
  const incoming = new Map();
  for (const edge of graph.edges) {
    const values = incoming.get(edge.objectId) ?? new Set();
    values.add(edge.predicate);
    incoming.set(edge.objectId, values);
  }
  const endpoints = graph.nodes.filter((node) => node.type === "ENDPOINT");
  const business = graph.nodes.filter((node) => isBusinessRoot(node, incoming.get(node.id) ?? new Set()));
  const roots = [...endpoints, ...business].sort((left, right) => left.id.localeCompare(right.id));
  return roots.length > 0 ? roots : graph.nodes.filter((node) => node.type === "MODULE" || node.type === "ARTIFACT");
}

function factFingerprint(graph) {
  return Object.fromEntries([
    ...graph.nodes.map((node) => [`node:${node.id}`, contentId("SEMANTIC-NODE", semanticNode(node))]),
    ...graph.edges.map((edge) => [
      `edge:${canonicalJson([edge.subjectId, edge.predicate, edge.objectId])}`,
      contentId("SEMANTIC-EDGE", semanticEdge(edge)),
    ]),
  ].sort(([left], [right]) => left.localeCompare(right)));
}

function affectedStableIds(fingerprintKey) {
  if (fingerprintKey.startsWith("node:")) return [fingerprintKey.slice("node:".length)];
  if (!fingerprintKey.startsWith("edge:")) return [fingerprintKey];
  try {
    const [subjectId, _predicate, objectId] = JSON.parse(fingerprintKey.slice("edge:".length));
    return [subjectId, objectId].filter(Boolean);
  } catch {
    return [];
  }
}

function changedStableIds(current, baseline) {
  if (!baseline?.factFingerprint) return new Set(Object.keys(current).flatMap(affectedStableIds));
  const result = new Set();
  for (const key of new Set([...Object.keys(current), ...Object.keys(baseline.factFingerprint)])) {
    if (current[key] === baseline.factFingerprint[key]) continue;
    for (const id of affectedStableIds(key)) result.add(id);
  }
  return result;
}

function planWorkUnits({ request, graph, baselineResult, profile }) {
  const indexes = graphIndexes(graph);
  const currentFingerprint = factFingerprint(graph);
  const changes = changedStableIds(currentFingerprint, baselineResult);
  const effectiveMode = request.mode === "AUTO" ? (baselineResult ? "INCREMENTAL" : "FULL") : request.mode;
  const roots = planRoots(graph);
  const allUnits = roots.map((root) => {
    const neighborhood = boundedNeighborhood(root.id, indexes, profile.model.maxInputTokens);
    return {
      id: contentId("ANALYSIS-WORK-UNIT", { runId: request.id, rootId: root.id }),
      runId: request.id,
      scopeKey: `${nodeScope(root)}:${root.id}`,
      rootNodeId: root.id,
      nodeIds: neighborhood.nodeIds,
      edgeIds: neighborhood.edgeIds,
      estimatedTokens: neighborhood.estimatedTokens,
      inputDigest: contentId("ANALYSIS-INPUT", {
        nodes: neighborhood.nodeIds.map((id) => currentFingerprint[`node:${id}`]),
        edges: graph.edges
          .filter((edge) => neighborhood.edgeIds.includes(edge.id))
          .map((edge) => contentId("SEMANTIC-EDGE", semanticEdge(edge)))
          .sort(),
      }),
      status: "QUEUED",
      attempts: [],
      output: null,
      error: null,
    };
  });
  const selected = effectiveMode === "FULL" || !baselineResult
    ? allUnits
    : allUnits.filter((unit) => unit.nodeIds.some((id) => changes.has(id)) || unit.edgeIds.some((id) => changes.has(id)));
  return {
    effectiveMode,
    changes: [...changes].sort(),
    workUnits: selected,
    unchangedWorkUnitCount: allUnits.length - selected.length,
    factFingerprint: currentFingerprint,
  };
}

function evidenceForUnit(unit, graph) {
  const nodeIds = new Set(unit.nodeIds);
  const edgeIds = new Set(unit.edgeIds);
  return {
    nodes: graph.nodes.filter((node) => nodeIds.has(node.id)),
    edges: graph.edges.filter((edge) => edgeIds.has(edge.id)),
  };
}

function evidenceReferences(evidence) {
  return [...evidence.nodes.map((node) => node.factId), ...evidence.edges.map((edge) => edge.id)].sort();
}

function categorizedEvidence(root, evidence) {
  const implementation = evidence.nodes.filter((node) => node.type === "CODE_SYMBOL").map((node) => ({
    factId: node.factId,
    stableId: node.id,
    name: node.name,
    kind: node.attributes?.kind ?? null,
    source: node.source,
  }));
  return {
    source: root.source,
    endpoint: root.type === "ENDPOINT" ? clone(root.attributes) : null,
    implementation,
    configurations: evidence.nodes.filter((node) => node.type === "CONFIGURATION").map((node) => ({ factId: node.factId, name: node.name, attributes: node.attributes, source: node.source })),
    dataObjects: evidence.nodes.filter((node) => node.type === "DATA_OBJECT").map((node) => ({ factId: node.factId, name: node.name, attributes: node.attributes, source: node.source })),
    tests: evidence.nodes.filter((node) => node.type === "TEST_ASSET").map((node) => ({ factId: node.factId, name: node.name, attributes: node.attributes, source: node.source })),
    dependencies: evidence.nodes.filter((node) => node.type === "EXTERNAL_DEPENDENCY").map((node) => ({ factId: node.factId, name: node.name, attributes: node.attributes, source: node.source })),
    relations: evidence.edges.map((edge) => ({ factId: edge.id, subjectId: edge.subjectId, predicate: edge.predicate, objectId: edge.objectId })),
  };
}

function deterministicCandidate(unit, graph) {
  const root = graph.nodes.find((node) => node.id === unit.rootNodeId);
  if (!root || !["ENDPOINT", "CODE_SYMBOL"].includes(root.type)) return [];
  const evidence = evidenceForUnit(unit, graph);
  const mode = root.type === "ENDPOINT" ? "API" : "BUSINESS";
  const method = root.attributes?.method ?? null;
  const route = root.attributes?.path ?? null;
  const name = mode === "API" ? (root.attributes?.summary ?? root.name) : titleFromSymbol(root.name);
  const candidateKey = mode === "API"
    ? `api:${method ?? "HTTP"}:${route ?? root.naturalKey}`.toLowerCase()
    : `business:${nodeScope(root)}:${titleFromSymbol(root.name)}`.toLowerCase();
  const categorized = categorizedEvidence(root, evidence);
  const refs = evidenceReferences(evidence);
  return [{
    candidateKey,
    mode,
    name,
    description: mode === "API"
      ? `Discovered ${method ?? "HTTP"} ${route ?? root.name}; its design and implementation are linked by bounded deterministic Facts.`
      : `Business capability candidate rooted at ${root.name}; authority remains subject to human confirmation.`,
    confidence: mode === "API" ? "HIGH" : "MEDIUM",
    evidenceFactIds: refs,
    stableEvidenceNodeIds: evidence.nodes.map((node) => node.id).sort(),
    design: categorized,
    provenance: [{ analyzerId: "traqen-deterministic-analysis", analyzerVersion: "1.0.0", modelProfileId: null, skill: null }],
    uncertainties: mode === "API" ? [] : ["Business boundary, actors, permissions, and preconditions require semantic analysis or human confirmation."],
  }];
}

function validateExtensionCandidates(output, allowedFactIds, allowedStableNodeIds, stableNodeIdByFactId, producer) {
  const producerLabel = producer.modelProfileId ? `model:${producer.modelProfileId}` : `skill:${producer.skill.id}@${producer.skill.version}`;
  if (output === null || typeof output !== "object" || Array.isArray(output)) throw new TypeError(`${producerLabel} output must be an object`);
  if (!Array.isArray(output.candidateFeatures ?? [])) throw new TypeError(`${producerLabel}.candidateFeatures must be an array`);
  return (output.candidateFeatures ?? []).map((candidate, index) => {
    const prefix = `${producerLabel}.candidateFeatures[${index}]`;
    const evidenceFactIds = (candidate.evidenceFactIds ?? []).map((factId, factIndex) => requiredString(factId, `${prefix}.evidenceFactIds[${factIndex}]`));
    if (evidenceFactIds.length === 0) throw new TypeError(`${prefix} must cite at least one input Fact`);
    const escaped = evidenceFactIds.filter((factId) => !allowedFactIds.has(factId));
    if (escaped.length > 0) throw new TypeError(`${prefix} cites Facts outside the bounded WorkUnit: ${escaped.join(", ")}`);
    const declaredStableIds = candidate.stableEvidenceNodeIds?.length > 0
      ? candidate.stableEvidenceNodeIds
      : evidenceFactIds.map((factId) => stableNodeIdByFactId.get(factId)).filter(Boolean);
    const stableEvidenceNodeIds = [...new Set(declaredStableIds)]
      .map((stableId, stableIndex) => requiredString(stableId, `${prefix}.stableEvidenceNodeIds[${stableIndex}]`))
      .sort();
    const escapedStableIds = stableEvidenceNodeIds.filter((stableId) => !allowedStableNodeIds.has(stableId));
    if (escapedStableIds.length > 0) throw new TypeError(`${prefix} cites stable nodes outside the bounded WorkUnit: ${escapedStableIds.join(", ")}`);
    if (stableEvidenceNodeIds.length === 0) throw new TypeError(`${prefix} must cite at least one stable Fact node`);
    return {
      candidateKey: requiredString(candidate.candidateKey, `${prefix}.candidateKey`),
      mode: candidate.mode === "API" ? "API" : "BUSINESS",
      name: requiredString(candidate.name, `${prefix}.name`),
      description: requiredString(candidate.description, `${prefix}.description`),
      confidence: ["LOW", "MEDIUM", "HIGH"].includes(candidate.confidence) ? candidate.confidence : "LOW",
      evidenceFactIds: [...new Set(evidenceFactIds)].sort(),
      stableEvidenceNodeIds,
      design: clone(candidate.design ?? {}),
      provenance: [clone(producer)],
      uncertainties: [...new Set(candidate.uncertainties ?? [])],
    };
  });
}

function mergeCandidates(candidates) {
  const merged = new Map();
  for (const candidate of candidates) {
    const current = merged.get(candidate.candidateKey);
    if (!current) {
      merged.set(candidate.candidateKey, clone(candidate));
      continue;
    }
    current.evidenceFactIds = [...new Set([...current.evidenceFactIds, ...candidate.evidenceFactIds])].sort();
    current.stableEvidenceNodeIds = [...new Set([...current.stableEvidenceNodeIds, ...candidate.stableEvidenceNodeIds])].sort();
    current.provenance.push(...candidate.provenance);
    current.uncertainties = [...new Set([...current.uncertainties, ...candidate.uncertainties])];
    if (candidate.confidence === "HIGH" || (candidate.confidence === "MEDIUM" && current.confidence === "LOW")) current.confidence = candidate.confidence;
    if (candidate.provenance.some((item) => item.modelProfileId)) {
      current.name = candidate.name;
      current.description = candidate.description;
      current.design = { ...current.design, ...clone(candidate.design) };
    }
  }
  return [...merged.values()].sort((left, right) => left.mode.localeCompare(right.mode) || left.name.localeCompare(right.name));
}

function candidateDigests(candidate) {
  const implementationStableIds = Array.isArray(candidate.design?.implementation)
    ? candidate.design.implementation.map((item) => item?.stableId).filter(Boolean).sort()
    : candidate.stableEvidenceNodeIds;
  return {
    semantic: contentId("FEATURE-SEMANTIC", { mode: candidate.mode, name: candidate.name, description: candidate.description }),
    implementation: contentId("FEATURE-IMPLEMENTATION", implementationStableIds),
    evidence: contentId("FEATURE-EVIDENCE", candidate.evidenceFactIds),
  };
}

function candidateFromFeature(feature) {
  return {
    candidateKey: feature.candidateKey,
    mode: feature.mode,
    name: feature.name,
    description: feature.description,
    confidence: feature.confidence,
    evidenceFactIds: feature.evidenceFactIds,
    stableEvidenceNodeIds: feature.stableEvidenceNodeIds,
    design: feature.design,
    provenance: feature.provenance,
    uncertainties: feature.uncertainties,
  };
}

function bestBaselineMatch(candidate, available) {
  const exact = available.find((feature) => feature.candidateKey === candidate.candidateKey);
  if (exact) return exact;
  let best = null;
  let bestScore = 0;
  let bestNameScore = 0;
  let bestNameCandidate = null;
  let equallyNamed = 0;
  for (const feature of available) {
    if (feature.mode !== candidate.mode) continue;
    const evidenceScore = jaccard(feature.stableEvidenceNodeIds, candidate.stableEvidenceNodeIds);
    const nameScore = similarity(feature.name, candidate.name);
    const score = evidenceScore * 0.75 + nameScore * 0.25;
    if (nameScore > bestNameScore) {
      bestNameScore = nameScore;
      bestNameCandidate = feature;
      equallyNamed = 1;
    } else if (nameScore === bestNameScore) {
      equallyNamed += 1;
    }
    if (score > bestScore) {
      best = feature;
      bestScore = score;
    }
  }
  if (bestScore >= 0.55) return best;
  // Large refactors can replace every implementation Fact. Preserve identity only
  // when the semantic name is an unambiguous near-exact match in the same mode.
  return bestNameScore >= 0.9 && equallyNamed === 1 ? bestNameCandidate : null;
}

function materializeFeatures({ candidates, baselineResult, run, clock }) {
  const baselineFeatures = [...(baselineResult?.features ?? [])];
  const available = [...baselineFeatures];
  const features = [];
  for (const candidate of candidates) {
    const match = bestBaselineMatch(candidate, available);
    if (match) available.splice(available.indexOf(match), 1);
    const digests = candidateDigests(candidate);
    const changeType = !match
      ? "NEW"
      : match.digests.semantic !== digests.semantic
        ? "BUSINESS_SEMANTICS_CHANGED"
        : match.digests.implementation !== digests.implementation
          ? "IMPLEMENTATION_REMAPPED"
          : match.digests.evidence !== digests.evidence ? "EVIDENCE_REFRESHED" : "UNCHANGED";
    const authority = match?.authority ?? { status: "UNREVIEWED", confirmedAt: null, actorId: null, actorRole: null };
    const inherited = Boolean(match && authority.status !== "UNREVIEWED");
    const review = changeType === "BUSINESS_SEMANTICS_CHANGED" ? "REQUIRED" : changeType === "NEW" ? "REQUIRED" : "NONE";
    features.push({
      id: match?.id ?? contentId("FEATURE", { projectId: run.projectId, candidateKey: candidate.candidateKey }),
      revision: match ? match.revision + (changeType === "UNCHANGED" ? 0 : 1) : 1,
      candidateKey: candidate.candidateKey,
      mode: candidate.mode,
      name: candidate.name,
      description: candidate.description,
      confidence: candidate.confidence,
      authority: { ...clone(authority), inheritance: inherited ? "INHERITED" : "NONE", review },
      change: { type: changeType, previousRunId: match?.analysisRunId ?? null, previousRevision: match?.revision ?? null },
      evidenceFactIds: candidate.evidenceFactIds,
      stableEvidenceNodeIds: candidate.stableEvidenceNodeIds,
      design: candidate.design,
      provenance: candidate.provenance,
      uncertainties: candidate.uncertainties,
      digests,
      analysisRunId: run.id,
      snapshotManifestId: run.snapshotManifestId,
      firstSeenAt: match?.firstSeenAt ?? clock().toISOString(),
      lastSeenAt: clock().toISOString(),
    });
  }
  const retiredFeatures = available.map((feature) => ({
    featureId: feature.id,
    previousRevision: feature.revision,
    previousRunId: feature.analysisRunId,
    name: feature.name,
    authority: feature.authority,
    change: { type: "NO_CURRENT_IMPLEMENTATION", review: feature.authority.status === "UNREVIEWED" ? "RECOMMENDED" : "REQUIRED" },
  }));
  return { features, retiredFeatures };
}

export function createAnalysisProfile(input = {}) {
  const mode = input.mode ?? "DETERMINISTIC";
  if (!engineModes.has(mode)) throw new TypeError("analysisProfile.mode must be DETERMINISTIC or HYBRID");
  const model = input.model ?? { enabled: false };
  const enabled = mode === "HYBRID" && model.enabled === true;
  const contextWindow = positiveInteger(model.contextWindow, "analysisProfile.model.contextWindow", 128_000);
  const maxInputTokens = positiveInteger(model.maxInputTokens, "analysisProfile.model.maxInputTokens", Math.floor(contextWindow * 0.55));
  const maxOutputTokens = positiveInteger(model.maxOutputTokens, "analysisProfile.model.maxOutputTokens", Math.floor(contextWindow * 0.15));
  if (maxInputTokens + maxOutputTokens > contextWindow * 0.8) {
    throw new RangeError("analysis profile must reserve at least 20% of the model context window");
  }
  if (enabled && !model.profileId) throw new TypeError("HYBRID analysis requires model.profileId");
  const skills = (input.skills ?? []).map((skill, index) => ({
    id: requiredString(skill?.id, `analysisProfile.skills[${index}].id`),
    version: requiredString(skill?.version, `analysisProfile.skills[${index}].version`),
  }));
  if (new Set(skills.map((skill) => `${skill.id}\u0000${skill.version}`)).size !== skills.length) {
    throw new TypeError("analysisProfile.skills must not contain duplicates");
  }
  return deepFreeze({
    id: requiredString(input.id ?? "default-deterministic", "analysisProfile.id"),
    mode,
    model: {
      enabled,
      profileId: enabled ? requiredString(model.profileId, "analysisProfile.model.profileId") : null,
      contextWindow,
      maxInputTokens,
      maxOutputTokens,
    },
    skills,
    maxAttemptsPerWorkUnit: positiveInteger(input.maxAttemptsPerWorkUnit, "analysisProfile.maxAttemptsPerWorkUnit", 2),
  });
}

export function createAnalysisRequest(input, clock = () => new Date()) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("analysis request must be an object");
  const mode = input.mode ?? "AUTO";
  if (!runModes.has(mode)) throw new TypeError("analysisRequest.mode must be FULL, INCREMENTAL, or AUTO");
  return deepFreeze({
    id: requiredString(input.id, "analysisRequest.id"),
    projectId: requiredString(input.projectId, "analysisRequest.projectId"),
    snapshotManifestId: requiredString(input.snapshotManifestId, "analysisRequest.snapshotManifestId"),
    sourceComponentId: requiredString(input.sourceComponentId, "analysisRequest.sourceComponentId"),
    baselineRunId: input.baselineRunId ? requiredString(input.baselineRunId, "analysisRequest.baselineRunId") : null,
    mode,
    profile: createAnalysisProfile(input.profile),
    requestedAt: input.requestedAt ?? clock().toISOString(),
  });
}

export class MemoryAnalysisCheckpointRepository {
  #checkpoints = new Map();
  #results = new Map();

  async saveAnalysisCheckpoint(projectId, checkpoint) {
    this.#checkpoints.set(`${projectId}\u0000${checkpoint.run.id}`, deepFreeze(clone(checkpoint)));
  }

  async getAnalysisCheckpoint(projectId, runId) {
    return this.#checkpoints.get(`${projectId}\u0000${runId}`) ?? null;
  }

  async appendAnalysisResult(projectId, result) {
    const key = `${projectId}\u0000${result.id}`;
    const existing = this.#results.get(key);
    if (existing && canonicalJson(existing) !== canonicalJson(result)) throw new Error(`Analysis result ${result.id} conflicts with an existing result`);
    if (!existing) this.#results.set(key, deepFreeze(clone(result)));
    return this.#results.get(key);
  }

  async getAnalysisResult(projectId, runId) {
    return this.#results.get(`${projectId}\u0000${runId}`) ?? null;
  }

  async listAnalysisResults(projectId) {
    return [...this.#results.entries()]
      .filter(([key]) => key.startsWith(`${projectId}\u0000`))
      .map(([, result]) => result)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  }

  async getLatestAnalysisResult(projectId) {
    return (await this.listAnalysisResults(projectId))[0] ?? null;
  }
}

export class AnalysisAgent {
  #repository;
  #modelResolver;
  #skillResolver;
  #clock;

  constructor({ repository, modelResolver = () => null, skillResolver = () => null, clock = () => new Date() }) {
    if (!repository) throw new TypeError("analysis repository is required");
    if (typeof modelResolver !== "function" || typeof skillResolver !== "function") throw new TypeError("analysis resolvers must be functions");
    this.#repository = repository;
    this.#modelResolver = modelResolver;
    this.#skillResolver = skillResolver;
    this.#clock = clock;
  }

  async execute(input, { factGraph, baselineResult = null, signal = null, maximumCompletedWorkUnits = Infinity } = {}) {
    const request = createAnalysisRequest(input, this.#clock);
    if (!factGraph || !Array.isArray(factGraph.nodes) || !Array.isArray(factGraph.edges)) throw new TypeError("factGraph nodes and edges are required");
    if (factGraph.nodes.some((node) => node.projectId !== request.projectId || node.snapshotManifestId !== request.snapshotManifestId)) {
      throw new TypeError("analysis Fact nodes must belong to the requested project and Snapshot");
    }
    const storedCheckpoint = await this.#repository.getAnalysisCheckpoint(request.projectId, request.id);
    let checkpoint = storedCheckpoint ? clone(storedCheckpoint) : null;
    if (checkpoint) {
      if (canonicalJson(requestIdentity(checkpoint.request)) !== canonicalJson(requestIdentity(request))) throw new TypeError(`Analysis run ${request.id} already exists with a different request`);
      if (terminalStatuses.has(checkpoint.run.status)) return checkpoint.result ?? await this.#repository.getAnalysisResult(request.projectId, request.id);
    } else {
      const plan = planWorkUnits({ request, graph: factGraph, baselineResult, profile: request.profile });
      checkpoint = {
        request,
        run: {
          id: request.id,
          projectId: request.projectId,
          snapshotManifestId: request.snapshotManifestId,
          baselineRunId: baselineResult?.id ?? null,
          requestedMode: request.mode,
          effectiveMode: plan.effectiveMode,
          status: "RUNNING",
          profile: request.profile,
          plannedWorkUnitCount: plan.workUnits.length,
          unchangedWorkUnitCount: plan.unchangedWorkUnitCount,
          changedFactCount: plan.changes.length,
          completedWorkUnitCount: 0,
          failedWorkUnitCount: 0,
          startedAt: this.#clock().toISOString(),
          updatedAt: this.#clock().toISOString(),
          completedAt: null,
        },
        factFingerprint: plan.factFingerprint,
        changedStableIds: plan.changes,
        workUnits: plan.workUnits,
        result: null,
      };
      await this.#repository.saveAnalysisCheckpoint(request.projectId, checkpoint);
    }

    const model = request.profile.model.enabled ? await this.#modelResolver(request.profile.model.profileId) : null;
    if (request.profile.model.enabled && !model) throw new TypeError(`Analysis model profile ${request.profile.model.profileId} is not configured`);
    const skills = [];
    for (const reference of request.profile.skills) {
      const skill = await this.#skillResolver(reference.id, reference.version);
      if (!skill) throw new TypeError(`Analysis Skill ${reference.id}@${reference.version} is not configured`);
      skills.push(skill);
    }

    let completedThisInvocation = 0;
    for (const unit of checkpoint.workUnits) {
      if (unit.status === "COMPLETED") continue;
      if (signal?.aborted || completedThisInvocation >= maximumCompletedWorkUnits) {
        checkpoint.run.status = "PAUSED";
        checkpoint.run.updatedAt = this.#clock().toISOString();
        await this.#repository.saveAnalysisCheckpoint(request.projectId, checkpoint);
        return deepFreeze(clone(checkpoint));
      }
      if (unit.attempts.length >= request.profile.maxAttemptsPerWorkUnit && unit.status === "FAILED") continue;
      const attempt = unit.attempts.length + 1;
      const startedAt = this.#clock().toISOString();
      unit.status = "RUNNING";
      unit.error = null;
      checkpoint.run.status = "RUNNING";
      checkpoint.run.updatedAt = startedAt;
      await this.#repository.saveAnalysisCheckpoint(request.projectId, checkpoint);
      try {
        const evidence = evidenceForUnit(unit, factGraph);
        const deterministic = deterministicCandidate(unit, factGraph);
        const allowed = new Set(evidenceReferences(evidence));
        const allowedStableNodeIds = new Set(evidence.nodes.map((node) => node.id));
        const stableNodeIdByFactId = new Map(evidence.nodes.map((node) => [node.factId, node.id]));
        const extensionCandidates = [];
        if (model) {
          const output = await model.analyze({
            request,
            workUnit: clone(unit),
            evidence: clone(evidence),
            deterministicCandidates: clone(deterministic),
            context: request.profile.model,
          }, { signal });
          extensionCandidates.push(...validateExtensionCandidates(output, allowed, allowedStableNodeIds, stableNodeIdByFactId, {
            analyzerId: "traqen-semantic-analysis",
            analyzerVersion: "1.0.0",
            modelProfileId: request.profile.model.profileId,
            skill: null,
          }));
        }
        for (const skill of skills) {
          const output = await skill.analyze({
            request,
            workUnit: clone(unit),
            evidence: clone(evidence),
            deterministicCandidates: clone(deterministic),
          }, { signal });
          extensionCandidates.push(...validateExtensionCandidates(output, allowed, allowedStableNodeIds, stableNodeIdByFactId, {
            analyzerId: "traqen-skill-analysis",
            analyzerVersion: "1.0.0",
            modelProfileId: null,
            skill: { id: skill.id, version: skill.version },
          }));
        }
        unit.output = { candidates: mergeCandidates([...deterministic, ...extensionCandidates]) };
        unit.status = "COMPLETED";
        unit.attempts.push({ attempt, status: "COMPLETED", startedAt, finishedAt: this.#clock().toISOString(), error: null });
        completedThisInvocation += 1;
      } catch (error) {
        unit.status = signal?.aborted || error?.name === "AbortError" ? "QUEUED" : "FAILED";
        unit.error = { name: error?.name ?? "Error", message: error?.message ?? "Analysis WorkUnit failed" };
        unit.attempts.push({ attempt, status: unit.status, startedAt, finishedAt: this.#clock().toISOString(), error: unit.error });
      }
      checkpoint.run.completedWorkUnitCount = checkpoint.workUnits.filter((item) => item.status === "COMPLETED").length;
      checkpoint.run.failedWorkUnitCount = checkpoint.workUnits.filter((item) => item.status === "FAILED").length;
      checkpoint.run.updatedAt = this.#clock().toISOString();
      await this.#repository.saveAnalysisCheckpoint(request.projectId, checkpoint);
    }

    const retryable = checkpoint.workUnits.some((unit) => unit.status === "FAILED" && unit.attempts.length < request.profile.maxAttemptsPerWorkUnit);
    if (retryable) {
      checkpoint.run.status = "PAUSED";
      checkpoint.run.updatedAt = this.#clock().toISOString();
      await this.#repository.saveAnalysisCheckpoint(request.projectId, checkpoint);
      return deepFreeze(clone(checkpoint));
    }

    const analyzedCandidates = mergeCandidates(checkpoint.workUnits.flatMap((unit) => unit.output?.candidates ?? []));
    const analyzedKeys = new Set(analyzedCandidates.map((candidate) => candidate.candidateKey));
    const changedIds = new Set(checkpoint.changedStableIds);
    const inheritedUnchangedCandidates = (baselineResult?.features ?? [])
      .filter((feature) => !analyzedKeys.has(feature.candidateKey))
      .filter((feature) => !feature.stableEvidenceNodeIds.some((id) => changedIds.has(id)))
      .map(candidateFromFeature);
    const candidates = mergeCandidates([...analyzedCandidates, ...inheritedUnchangedCandidates]);
    const materialized = materializeFeatures({ candidates, baselineResult, run: checkpoint.run, clock: this.#clock });
    const completedAt = this.#clock().toISOString();
    const result = deepFreeze({
      id: checkpoint.run.id,
      projectId: checkpoint.run.projectId,
      snapshotManifestId: checkpoint.run.snapshotManifestId,
      baselineRunId: checkpoint.run.baselineRunId,
      mode: checkpoint.run.effectiveMode,
      profile: checkpoint.run.profile,
      status: checkpoint.run.failedWorkUnitCount > 0 ? "COMPLETED_WITH_GAPS" : "COMPLETED",
      coverage: {
        plannedWorkUnits: checkpoint.run.plannedWorkUnitCount,
        completedWorkUnits: checkpoint.run.completedWorkUnitCount,
        failedWorkUnits: checkpoint.run.failedWorkUnitCount,
        unchangedWorkUnits: checkpoint.run.unchangedWorkUnitCount,
        changedFacts: checkpoint.run.changedFactCount,
      },
      factFingerprint: checkpoint.factFingerprint,
      features: materialized.features,
      retiredFeatures: materialized.retiredFeatures,
      completedAt,
    });
    await this.#repository.appendAnalysisResult(request.projectId, result);
    checkpoint.run.status = result.status;
    checkpoint.run.completedAt = completedAt;
    checkpoint.run.updatedAt = completedAt;
    checkpoint.result = result;
    await this.#repository.saveAnalysisCheckpoint(request.projectId, checkpoint);
    return result;
  }

  async getRun(projectId, runId) {
    return this.#repository.getAnalysisCheckpoint(requiredString(projectId, "projectId"), requiredString(runId, "runId"));
  }

  async pauseRun(projectId, runId) {
    const normalizedProjectId = requiredString(projectId, "projectId");
    const normalizedRunId = requiredString(runId, "runId");
    const stored = await this.#repository.getAnalysisCheckpoint(normalizedProjectId, normalizedRunId);
    if (!stored || terminalStatuses.has(stored.run.status)) return stored;
    const checkpoint = clone(stored);
    checkpoint.run.status = "PAUSED";
    checkpoint.run.updatedAt = this.#clock().toISOString();
    await this.#repository.saveAnalysisCheckpoint(normalizedProjectId, checkpoint);
    return deepFreeze(checkpoint);
  }

  async getLatestResult(projectId) {
    return this.#repository.getLatestAnalysisResult(requiredString(projectId, "projectId"));
  }

  async getFeatureHistory(projectId, featureId) {
    const results = await this.#repository.listAnalysisResults(requiredString(projectId, "projectId"));
    const history = [];
    for (const result of [...results].reverse()) {
      const feature = result.features.find((item) => item.id === featureId);
      if (feature) history.push({ runId: result.id, snapshotManifestId: result.snapshotManifestId, completedAt: result.completedAt, feature });
      const retirement = result.retiredFeatures.find((item) => item.featureId === featureId);
      if (retirement) history.push({ runId: result.id, snapshotManifestId: result.snapshotManifestId, completedAt: result.completedAt, retirement });
    }
    return deepFreeze(history);
  }
}
