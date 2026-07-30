import assert from "node:assert/strict";
import test from "node:test";

import {
  createReverseArtifactBundle,
  createReverseSkillManifest,
  mergeReverseArtifactBundles,
  signReverseSkillManifest,
  verifyReverseSkillManifestAttestation,
} from "../src/domain/index.js";

const fixedClock = () => new Date("2026-07-14T09:00:00.000Z");
const inputDigest = `sha256:${"a".repeat(64)}`;

function manifest(overrides = {}) {
  return {
    apiVersion: "quality.traqen/v1alpha1",
    kind: "ReverseSkill",
    metadata: {
      id: "specone-reference",
      name: "Specone Reference Adapter",
      version: "1.0.0",
      publisher: "TRAQEN",
      artifactDigest: `sha256:${"b".repeat(64)}`,
    },
    capabilities: ["FEATURE_DISCOVERY", "BUSINESS_RULE_MINING"],
    compatibility: { languages: ["javascript"], frameworks: ["express"], factSchema: ">=0.1 <0.2" },
    inputs: { mode: "FACT_DEPENDENT", required: ["PROJECT_SNAPSHOT", "CODE_FACT_BUNDLE"], optional: [] },
    outputs: {
      schema: "reverse-artifact-bundle/v1alpha1",
      types: ["CANDIDATE_FEATURE", "CANDIDATE_CLAIM", "OPEN_QUESTION"],
    },
    permissions: { filesystem: "NONE", database: "NONE", network: "NONE", shell: "NONE", secrets: "NONE" },
    model: { required: false, allowedProfiles: [], contextStrategy: "FACT_PACKAGE_ONLY" },
    execution: { timeoutMinutes: 1, costClass: "LOW", supportsIncremental: true, maxOutputCandidates: 20 },
    ...overrides,
  };
}

function rawClaim({ localId, statement, operator = "EQUALS", value = "DRAFT", scope = { role: "USER" } }) {
  return {
    localId,
    type: "IMPLEMENTATION_BEHAVIOR",
    subjectKey: "endpoint:POST /orders/{id}/submit",
    statement,
    confidence: "MEDIUM",
    constraint: { dimension: "requiredOrderState", operator, value },
    scope,
    evidence: [{ factId: "FACT-001", relation: "SUPPORTS" }],
  };
}

function artifactBundle({
  skillId,
  claim,
  generatedAt = "2026-07-14T09:00:00.000Z",
  maxOutputCandidates = 20,
}) {
  return createReverseArtifactBundle({
    runId: "REVERSE-RUN-001",
    producer: {
      skillId,
      skillVersion: "1.0.0",
      adapterId: `${skillId}-adapter`,
      modelProfile: null,
      promptVersion: "deterministic-v1",
    },
    scope: {
      projectId: "PROJECT-001",
      snapshotManifestId: "SNAPSHOT-001",
      sourceComponentId: "SOURCE-001",
      taskScope: { artifacts: ["src/orders.js"] },
    },
    inputDigest,
    allowedFactIds: new Set(["FACT-001", "FACT-002"]),
    maxOutputCandidates,
    generatedAt,
    rawOutput: {
      candidateFeatures: [{
        localId: "feature-order-submit",
        externalKey: "endpoint:POST /orders/{id}/submit",
        name: "Submit order",
        evidence: [{ factId: "FACT-001", relation: "SUPPORTS" }],
      }],
      candidateClaims: [claim],
      openQuestions: [{
        localId: "question-exception",
        question: "Can an administrator override the state restriction?",
        relatedLocalIds: [claim.localId],
        evidence: [{ factId: "FACT-001", relation: "CONTEXT" }],
      }],
      warnings: [],
    },
  }, fixedClock);
}

test("Skill manifests are versioned, least-privilege, and publisher-attested", () => {
  const normalized = createReverseSkillManifest(manifest());
  const signed = signReverseSkillManifest(normalized, "publisher-shared-secret");

  assert.equal(normalized.metadata.version, "1.0.0");
  assert.equal(verifyReverseSkillManifestAttestation(signed, "publisher-shared-secret"), true);
  const tampered = structuredClone(signed);
  tampered.permissions.shell = "READ_ONLY";
  assert.equal(verifyReverseSkillManifestAttestation(tampered, "publisher-shared-secret"), false);
  assert.throws(
    () => createReverseSkillManifest(manifest({ permissions: { ...manifest().permissions, shell: "READ_ONLY" } })),
    /unsupported privilege/,
  );
});

test("Direct-source Skills require Snapshot input but can operate without a FactBundle", () => {
  const normalized = createReverseSkillManifest(manifest({
    inputs: { mode: "DIRECT_SOURCE", required: ["PROJECT_SNAPSHOT"], optional: ["CODE_FACT_BUNDLE"] },
  }));
  assert.equal(normalized.inputs.mode, "DIRECT_SOURCE");
  assert.deepEqual(normalized.inputs.required, ["PROJECT_SNAPSHOT"]);
  assert.throws(() => createReverseSkillManifest(manifest({
    inputs: { mode: "FACT_DEPENDENT", required: ["PROJECT_SNAPSHOT"], optional: [] },
  })), /must require CODE_FACT_BUNDLE/);
});

test("Skill output must be structured and every conclusion must cite an input fact", () => {
  assert.throws(
    () => createReverseArtifactBundle({
      runId: "REVERSE-RUN-001",
      producer: { skillId: "skill", skillVersion: "1.0.0", adapterId: "adapter" },
      scope: { projectId: "PROJECT-001", snapshotManifestId: "SNAPSHOT-001", sourceComponentId: "SOURCE-001" },
      inputDigest,
      allowedFactIds: new Set(["FACT-001"]),
      rawOutput: { markdown: "unverifiable narrative" },
    }, fixedClock),
    /not supported|structured candidate/,
  );
  assert.throws(
    () => artifactBundle({
      skillId: "specone-reference",
      claim: {
        ...rawClaim({ localId: "claim-1", statement: "Only draft orders can be submitted." }),
        evidence: [{ factId: "FACT-OUTSIDE", relation: "SUPPORTS" }],
      },
    }),
    /outside the input package/,
  );
  assert.throws(
    () => artifactBundle({
      skillId: "specone-reference",
      claim: rawClaim({ localId: "claim-1", statement: "Only draft orders can be submitted." }),
      maxOutputCandidates: 1,
    }),
    /exceeds maxOutputCandidates/,
  );
  assert.throws(
    () => createReverseArtifactBundle({
      runId: "REVERSE-RUN-001",
      producer: { skillId: "skill", skillVersion: "1.0.0", adapterId: "adapter" },
      scope: { projectId: "PROJECT-001", snapshotManifestId: "SNAPSHOT-001", sourceComponentId: "SOURCE-001" },
      inputDigest,
      allowedFactIds: new Set(["FACT-001"]),
      rawOutput: {
        openQuestions: [{ localId: "question", question: "Review this", relatedLocalIds: [], evidence: [] }],
        undeclaredNarrative: "must not be smuggled into retained raw output",
      },
    }, fixedClock),
    /is not supported/,
  );
  assert.throws(
    () => createReverseArtifactBundle({
      runId: "REVERSE-RUN-001",
      producer: { skillId: "skill", skillVersion: "1.0.0", adapterId: "adapter" },
      scope: { projectId: "PROJECT-001", snapshotManifestId: "SNAPSHOT-001", sourceComponentId: "SOURCE-001" },
      inputDigest,
      allowedFactIds: new Set(["FACT-001"]),
      maxRawOutputBytes: 80,
      rawOutput: {
        openQuestions: [{ localId: "question", question: "x".repeat(100), relatedLocalIds: [], evidence: [] }],
      },
    }, fixedClock),
    /exceeds maxRawOutputBytes/,
  );
});

test("exact multi-Skill duplicates merge without losing source text or evidence", () => {
  const first = artifactBundle({
    skillId: "specone-reference",
    claim: rawClaim({ localId: "claim-specone", statement: "Only draft orders can be submitted." }),
  });
  const second = artifactBundle({
    skillId: "gsd-reference",
    claim: rawClaim({ localId: "claim-gsd", statement: "Submitting an order requires DRAFT state." }),
  });
  const merged = mergeReverseArtifactBundles({
    runId: "REVERSE-RUN-001",
    bundles: [first, second],
  }, fixedClock);

  assert.equal(merged.candidateFeatures.length, 1);
  assert.equal(merged.candidateFeatures[0].sources.length, 2);
  assert.equal(merged.candidateClaims.length, 1);
  assert.equal(merged.candidateClaims[0].statements.length, 2);
  assert.equal(merged.candidateClaims[0].sources.length, 2);
  assert.equal(merged.conflicts.length, 0);
});

test("opposing constraints become an explicit conflict instead of a vote or overwrite", () => {
  const draftOnly = artifactBundle({
    skillId: "specone-reference",
    claim: rawClaim({ localId: "claim-draft", statement: "Only draft orders can be submitted." }),
  });
  const approvedOnly = artifactBundle({
    skillId: "gsd-reference",
    claim: rawClaim({ localId: "claim-approved", statement: "Only approved orders can be submitted.", value: "APPROVED" }),
  });
  const merged = mergeReverseArtifactBundles({ runId: "REVERSE-RUN-001", bundles: [draftOnly, approvedOnly] }, fixedClock);

  assert.equal(merged.candidateClaims.length, 2);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].status, "OPEN");
  assert.equal(merged.conflicts[0].candidateIds.length, 2);
});

test("opposing text in disjoint scopes remains a business variant, not a conflict", () => {
  const normalUser = artifactBundle({
    skillId: "specone-reference",
    claim: rawClaim({ localId: "claim-user", statement: "Users require draft state.", scope: { role: "USER" } }),
  });
  const administrator = artifactBundle({
    skillId: "gsd-reference",
    claim: rawClaim({ localId: "claim-admin", statement: "Administrators require approved state.", value: "APPROVED", scope: { role: "ADMIN" } }),
  });
  const merged = mergeReverseArtifactBundles({ runId: "REVERSE-RUN-001", bundles: [normalUser, administrator] }, fixedClock);

  assert.equal(merged.candidateClaims.length, 2);
  assert.equal(merged.conflicts.length, 0);
});
