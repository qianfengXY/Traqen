import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TraceGapType } from "../src/domain/index.js";

test("trace-chain input contract is valid JSON Schema metadata", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/trace-chain-evaluation-input.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(contract.title, "TraceChainEvaluationInput");
  assert.ok(contract.required.includes("snapshotManifest"));
  assert.ok(contract.required.includes("evidence"));
});

test("trace-chain output contract stays aligned with domain gap types", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/trace-chain.schema.json", import.meta.url), "utf8"),
  );
  const contractGapTypes = contract.properties.gaps.items.properties.type.enum;

  assert.equal(contract.title, "TraceChain");
  assert.deepEqual([...contractGapTypes].sort(), Object.keys(TraceGapType).sort());
});

test("OpenAPI contract exposes the implemented trace-chain routes", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/openapi.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.openapi, "3.1.0");
  assert.equal(contract.paths["/health"].get.operationId, "getHealth");
  assert.equal(
    contract.paths["/v1/trace-chains/evaluate"].post.operationId,
    "evaluateTraceChain",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/trace-chains/{chainId}"].get.operationId,
    "getCurrentTraceChain",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/claims"].post.operationId,
    "appendClaim",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/features/{featureId}/baseline"].get.operationId,
    "getFeatureBaseline",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/test-specs"].post.operationId,
    "appendTestSpec",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/test-specs/{testSpecId}/validate"].post.operationId,
    "validateStoredTestSpec",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/test-executions"].post.operationId,
    "ingestExecutionEvidence",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/test-executions/{executionId}/evidence"].get.operationId,
    "getExecutionEvidence",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/fact-scans"].post.operationId,
    "ingestFactBundle",
  );
  assert.equal(contract.paths["/v1/projects/{projectId}/facts"].get.operationId, "queryFacts");
  assert.equal(contract.paths["/v1/skills"].post.operationId, "registerReverseSkill");
  assert.equal(contract.paths["/v1/skills"].get.operationId, "listReverseSkills");
  assert.equal(contract.paths["/v1/reverse-runs"].post.operationId, "executeReverseRun");
  assert.equal(
    contract.paths["/v1/projects/{projectId}/reverse-runs/{runId}"].get.operationId,
    "getReverseRun",
  );
});

test("FactBundle contract keeps facts locatable, snapshot-bound, and scanner-attested", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/fact-bundle.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "FactBundle");
  assert.ok(contract.required.includes("snapshotManifestId"));
  assert.ok(contract.required.includes("sourceComponentId"));
  assert.ok(contract.required.includes("attestation"));
  assert.deepEqual(contract.$defs.SourceLocation.required, ["artifact", "startLine", "endLine", "contentHash"]);
  assert.ok(contract.$defs.FactNode.properties.type.enum.includes("ENDPOINT"));
  assert.ok(contract.$defs.FactEdge.properties.predicate.enum.includes("IMPLEMENTED_BY"));
});

test("Reverse Skill contracts bind supply-chain permissions, structured output, and audit history", async () => {
  const skill = JSON.parse(
    await readFile(new URL("../contracts/reverse-skill.schema.json", import.meta.url), "utf8"),
  );
  const run = JSON.parse(
    await readFile(new URL("../contracts/reverse-run.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(skill.title, "ReverseSkillRegistration");
  assert.ok(skill.required.includes("attestation"));
  assert.equal(skill.properties.permissions.properties.shell.const, "NONE");
  assert.ok(skill.properties.capabilities.items.$ref);
  assert.equal(run.title, "ReverseRunRequest");
  assert.ok(run.required.includes("factBundleIds"));
  assert.ok(run.$defs.ReverseRun.required.includes("statusHistory"));
  assert.ok(run.$defs.ReverseArtifactBundle.required.includes("rawOutputHash"));
});

test("governance contract defines immutable version fields", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/governance.schema.json", import.meta.url), "utf8"),
  );

  assert.ok(contract.$defs.FeatureVersion.required.includes("version"));
  assert.ok(contract.$defs.Claim.required.includes("scopeVersion"));
  assert.ok(contract.$defs.Decision.required.includes("claimVersion"));
  assert.ok(contract.$defs.FeatureBaseline.required.includes("testSpecs"));
  assert.ok(contract.$defs.FeatureBaseline.required.includes("testExecutions"));
});

test("TestSpec contract exposes traceability and execution-policy boundaries", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/test-spec.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "TestSpec");
  assert.ok(contract.required.includes("verifiesClaims"));
  assert.ok(contract.required.includes("assertions"));
  assert.ok(contract.required.includes("approval"));
  assert.deepEqual(contract.properties.environment.properties.operationLevel.enum, [
    "SAFE_READ",
    "CONTROLLED_WRITE",
    "DESTRUCTIVE",
    "EXTERNAL_SIDE_EFFECT",
  ]);
  assert.ok(contract.$defs.ValidationResult.required.includes("executable"));
});

test("execution Evidence contract binds results to Runner, TestSpec, manifest, and deployment", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/execution-evidence.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "ExecutionEvidenceBundle");
  assert.ok(contract.$defs.TestExecution.required.includes("snapshotManifestId"));
  assert.ok(contract.$defs.TestExecution.required.includes("deploymentId"));
  assert.ok(contract.$defs.TestExecution.required.includes("runner"));
  assert.equal(contract.$defs.RunnerAttestation.properties.algorithm.const, "HMAC-SHA256");
  assert.ok(contract.$defs.StoredExecutionEvidence.allOf[1].properties.evidence.items.allOf[1].required.includes("integrity"));
});

test("Runner task contract requires replay protection, policy binding, and a target Runner", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/runner-task.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.title, "RunnerTask");
  assert.ok(contract.required.includes("nonce"));
  assert.ok(contract.required.includes("policyHash"));
  assert.ok(contract.required.includes("runnerId"));
  assert.ok(contract.required.includes("expiresAt"));
  assert.equal(contract.$defs.TaskAttestation.properties.algorithm.const, "HMAC-SHA256");
});
