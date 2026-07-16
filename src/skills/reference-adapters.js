import { createHash } from "node:crypto";

import { deepFreeze } from "../domain/index.js";

function artifactDigest(id, version) {
  return `sha256:${createHash("sha256").update(`traqen-builtin:${id}@${version}`).digest("hex")}`;
}

function evidence(node, relation = "SUPPORTS") {
  return [{ factId: node.factId, relation }];
}

function implementationContextEvidence(inputPackage, rootNode) {
  const nodesById = new Map(inputPackage.facts.nodes.map((node) => [node.id, node]));
  const allowedPredicates = new Set(["IMPLEMENTED_BY", "CONTAINS", "CALLS", "READS", "WRITES", "CONTROLLED_BY", "DEPENDS_ON"]);
  const selectedNodeIds = new Set([rootNode.id]);
  const selectedEdges = [];
  let frontier = new Set([rootNode.id]);
  for (let depth = 0; depth < 2 && frontier.size > 0; depth += 1) {
    const next = new Set();
    for (const edge of inputPackage.facts.edges) {
      if (!allowedPredicates.has(edge.predicate) || !frontier.has(edge.subjectId)) continue;
      if (!nodesById.has(edge.objectId)) continue;
      selectedEdges.push(edge);
      selectedNodeIds.add(edge.objectId);
      next.add(edge.objectId);
      if (selectedNodeIds.size + selectedEdges.length >= 50) break;
    }
    frontier = next;
  }
  const artifactIdsByPath = new Map(
    inputPackage.facts.nodes
      .filter((node) => node.type === "ARTIFACT")
      .map((node) => [node.source.artifact, node.id]),
  );
  const relevantArtifactIds = new Set([artifactIdsByPath.get(rootNode.source.artifact)].filter(Boolean));
  for (let depth = 0; depth < 2; depth += 1) {
    for (const edge of inputPackage.facts.edges) {
      if (edge.predicate === "DEPENDS_ON" && relevantArtifactIds.has(edge.subjectId)) {
        relevantArtifactIds.add(edge.objectId);
      }
    }
  }
  const relevantArtifacts = new Set(
    [...artifactIdsByPath].filter(([, id]) => relevantArtifactIds.has(id)).map(([artifact]) => artifact),
  );
  for (const node of inputPackage.facts.nodes) {
    if (
      node.type === "CODE_SYMBOL" &&
      relevantArtifacts.has(node.source.artifact) &&
      ["condition-branch", "permission-check", "state-transition", "exception-path", "enum"].includes(node.attributes.kind)
    ) {
      selectedNodeIds.add(node.id);
    }
    if (selectedNodeIds.size + selectedEdges.length >= 50) break;
  }
  return [
    { factId: rootNode.factId, relation: "SUPPORTS" },
    ...[...selectedNodeIds]
      .filter((id) => id !== rootNode.id)
      .map((id) => ({ factId: nodesById.get(id).factId, relation: "CONTEXT" })),
    ...selectedEdges.map((edge) => ({ factId: edge.id, relation: "CONTEXT" })),
  ];
}

function endpointArtifacts(inputPackage, wording, { includeTestDesign = false } = {}) {
  const endpoints = inputPackage.facts.nodes.filter((node) => node.type === "ENDPOINT").slice(0, 100);
  const candidateFeatures = [];
  const candidateClaims = [];
  const candidateTestSpecs = [];
  const openQuestions = [];
  for (const endpoint of endpoints) {
    const method = endpoint.attributes.method ?? endpoint.name.split(" ")[0];
    const endpointPath = endpoint.attributes.path ?? endpoint.name.slice(method.length + 1);
    const suffix = endpoint.id.toLowerCase();
    const contextualEvidence = implementationContextEvidence(inputPackage, endpoint);
    candidateFeatures.push({
      localId: `feature-${suffix}`,
      externalKey: `endpoint:${method} ${endpointPath}`,
      name: `${method} ${endpointPath}`,
      description: `${wording} feature candidate derived from a deterministic endpoint fact.`,
      evidence: contextualEvidence,
    });
    candidateClaims.push({
      localId: `claim-${suffix}`,
      type: "IMPLEMENTATION_BEHAVIOR",
      subjectKey: `endpoint:${method} ${endpointPath}`,
      statement: wording === "Specone"
        ? `The current implementation exposes ${method} ${endpointPath}.`
        : `${method} ${endpointPath} is present in the observed implementation snapshot.`,
      confidence: "HIGH",
      constraint: { dimension: "endpointExposed", operator: "EQUALS", value: true },
      scope: {},
      evidence: contextualEvidence,
    });
    if (includeTestDesign) {
      candidateTestSpecs.push({
        localId: `test-${suffix}`,
        name: `Verify ${method} ${endpointPath}`,
        featureKey: `endpoint:${method} ${endpointPath}`,
        verifiesCandidateClaimIds: [`claim-${suffix}`],
        specification: {
          intent: `Exercise ${method} ${endpointPath} and verify its business outcome with deterministic assertions.`,
          suggestedOperationLevel: ["GET", "HEAD"].includes(method) ? "SAFE_READ" : "CONTROLLED_WRITE",
          suggestedSteps: [{ executor: "HTTP", method, path: endpointPath }],
          requiredAssertions: ["HTTP_STATUS", "BUSINESS_OUTCOME"],
          requiresHumanReview: true,
        },
        evidence: contextualEvidence,
      });
    }
    openQuestions.push({
      localId: `question-${suffix}`,
      question: `Which authorized business outcome and actors govern ${method} ${endpointPath}?`,
      relatedLocalIds: [`feature-${suffix}`, `claim-${suffix}`],
      evidence: contextualEvidence.map((item) => ({ ...item, relation: "CONTEXT" })),
    });
  }
  return { candidateFeatures, candidateClaims, candidateTestSpecs, openQuestions };
}

function fallbackQuestion(inputPackage, prefix) {
  const firstFact = inputPackage.facts.nodes[0];
  return {
    candidateFeatures: [],
    candidateClaims: [],
    openQuestions: [{
      localId: "question-no-endpoint",
      question: `${prefix} found no statically unambiguous endpoint in the selected scope; should the scope or Scanner capability be expanded?`,
      relatedLocalIds: [],
      evidence: firstFact ? evidence(firstFact, "CONTEXT") : [],
    }],
    warnings: ["No endpoint facts were available in the selected input package."],
  };
}

export function createSpeconeReferenceAdapter() {
  const id = "specone-reference";
  const version = "1.0.0";
  return deepFreeze({
    id,
    version,
    artifactDigest: artifactDigest(id, version),
    promptVersion: "deterministic-v1",
    async execute(inputPackage) {
      const artifacts = endpointArtifacts(inputPackage, "Specone", { includeTestDesign: true });
      if (artifacts.candidateFeatures.length === 0) return fallbackQuestion(inputPackage, "Specone reference adapter");
      return { ...artifacts, warnings: [] };
    },
  });
}

export function createGsdReferenceAdapter() {
  const id = "gsd-reference";
  const version = "1.0.0";
  return deepFreeze({
    id,
    version,
    artifactDigest: artifactDigest(id, version),
    promptVersion: "deterministic-v1",
    async execute(inputPackage) {
      const artifacts = endpointArtifacts(inputPackage, "GSD");
      const nodeById = new Map(inputPackage.facts.nodes.map((node) => [node.id, node]));
      for (const edge of inputPackage.facts.edges.filter((candidate) => candidate.predicate === "WRITES").slice(0, 100)) {
        const subject = nodeById.get(edge.subjectId);
        const object = nodeById.get(edge.objectId);
        if (!subject || !object) continue;
        const suffix = edge.id.toLowerCase();
        artifacts.candidateFeatures.push({
          localId: `feature-write-${suffix}`,
          externalKey: `implementation:${subject.naturalKey}`,
          name: subject.name,
          description: "GSD implementation-slice candidate derived from a deterministic write relation.",
          evidence: evidence(subject),
        });
        artifacts.candidateClaims.push({
          localId: `claim-write-${suffix}`,
          type: "IMPLEMENTATION_BEHAVIOR",
          subjectKey: subject.naturalKey,
          statement: `${subject.name} writes ${object.name} in the observed implementation.`,
          confidence: "HIGH",
          constraint: { dimension: `writes:${object.naturalKey}`, operator: "EQUALS", value: true },
          scope: {},
          evidence: [
            { factId: subject.factId, relation: "SUPPORTS" },
            { factId: object.factId, relation: "SUPPORTS" },
            { factId: edge.id, relation: "SUPPORTS" },
          ],
        });
      }
      if (artifacts.candidateFeatures.length === 0) return fallbackQuestion(inputPackage, "GSD reference adapter");
      return { ...artifacts, warnings: [] };
    },
  });
}

function manifestFor(adapter, name, { testDesign = false } = {}) {
  return {
    apiVersion: "quality.traqen/v1alpha1",
    kind: "ReverseSkill",
    metadata: {
      id: adapter.id,
      name,
      version: adapter.version,
      publisher: "TRAQEN",
      artifactDigest: adapter.artifactDigest,
    },
    capabilities: [
      "ARCHITECTURE_REVERSE",
      "FEATURE_DISCOVERY",
      "BUSINESS_RULE_MINING",
      ...(testDesign ? ["TEST_DESIGN"] : []),
    ],
    compatibility: { languages: ["javascript"], frameworks: ["express", "node-http"], factSchema: ">=0.1 <0.2" },
    inputs: { required: ["PROJECT_SNAPSHOT", "CODE_FACT_BUNDLE"], optional: [] },
    outputs: {
      schema: "reverse-artifact-bundle/v1alpha1",
      types: [
        "CANDIDATE_FEATURE",
        "CANDIDATE_CLAIM",
        ...(testDesign ? ["CANDIDATE_TEST_SPEC"] : []),
        "OPEN_QUESTION",
      ],
    },
    permissions: { filesystem: "NONE", database: "NONE", network: "NONE", shell: "NONE", secrets: "NONE" },
    model: { required: false, allowedProfiles: [], contextStrategy: "FACT_PACKAGE_ONLY" },
    execution: { timeoutMinutes: 1, costClass: "LOW", supportsIncremental: true, maxOutputCandidates: 500 },
  };
}

export function createReferenceSkillSet() {
  const specone = createSpeconeReferenceAdapter();
  const gsd = createGsdReferenceAdapter();
  return deepFreeze([
    { manifest: manifestFor(specone, "Specone Reference Adapter", { testDesign: true }), adapter: specone },
    { manifest: manifestFor(gsd, "GSD Reference Adapter"), adapter: gsd },
  ]);
}
