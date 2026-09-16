import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createConfiguredApplication } from "../src/api/application-bootstrap.js";
import { createIsolatedDevelopmentApplication } from "../src/api/development-bootstrap.js";
import { AnalysisModelRegistry } from "../src/analysis/index.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";

function fakeCodexSpawn(calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.pid = 99999999;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; };
    queueMicrotask(() => {
      const request = JSON.parse(args.at(-1));
      let result;
      if (request.task === "connection-verification") {
        result = { ready: true, challenge: request.input.challenge };
      } else if (request.task === "analysis") {
        const candidate = request.input.deterministicCandidates[0];
        result = {
          candidateFeatures: [{
            candidateKey: candidate.candidateKey,
            mode: candidate.mode,
            name: candidate.name,
            description: candidate.description,
            confidence: candidate.confidence,
            evidenceFactIds: candidate.evidenceFactIds,
            stableEvidenceNodeIds: candidate.stableEvidenceNodeIds,
          }],
        };
      } else if (request.task === "reconciliation") {
        result = {
          candidateDecisions: request.input.candidateOptions.map(({ ref }) => ({
            candidateRef: ref,
            disposition: "ACCEPT",
            rationale: "The fake CLI preserves each evidence-bounded Child candidate.",
          })),
          relations: [],
          gaps: [],
        };
      } else {
        throw new Error(`unexpected fake CLI task ${request.task}`);
      }
      child.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(result) } })}\n`);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };
}

test("isolated development bootstrap completes source registration and the first FULL job", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-clean-start-"));
  const sourceRoot = path.join(temporary, "source");
  await mkdir(sourceRoot);
  await writeFile(path.join(sourceRoot, "entry.js"), "export function cleanStart() { return true; }\n");
  t.after(() => rm(temporary, { recursive: true, force: true }));

  const store = new MemoryTraceabilityStore();
  const { application, development } = await createIsolatedDevelopmentApplication({ sourceRoot, store });
  const templates = await application.listCapabilityTemplates();
  assert.ok(templates.some(({ kind, logicalName }) => kind === "MODEL" && logicalName === development.modelName));

  await application.createProject({
    organization: { id: "LOCAL-DEVELOPMENT-ORG", name: "Local development" },
    tenant: { id: "LOCAL-DEVELOPMENT", name: "Local development" },
    project: { id: "WORKSPACE-CLEAN-START", name: "Clean start" },
    principals: [],
  });
  const workspace = await application.getWorkspace("WORKSPACE-CLEAN-START");
  const registration = await application.registerUnderstandingSource(workspace.id, { rootPath: sourceRoot });
  const config = await application.saveWorkspaceCapabilityConfig(workspace.id, {
    mainAgent: { model: development.modelName, skillNames: [], mcpNames: [] },
    childSlots: [
      { id: "CHILD-1", model: development.modelName, skillNames: [], mcpNames: [], independenceGroup: "LOCAL-1" },
      { id: "CHILD-2", model: development.modelName, skillNames: [], mcpNames: [], independenceGroup: "LOCAL-2" },
    ],
    overrides: [], removals: [], dependencies: {}, conventions: {},
    policies: { dataBoundary: "LOCAL_DEVELOPMENT", secrets: "NONE" },
  });
  const profile = await application.resolveWorkspaceExecutionProfile(workspace.id, config.id);
  await store.appendUnderstandingRecordWithCas(workspace.id, "WORKSPACE_EXECUTION_PROFILE", profile, {
    headKey: "WORKSPACE_EXECUTION_PROFILE",
    expectedVersion: 0,
  });
  const job = await application.startWorkspaceUnderstandingJob(workspace.id, {
    sourceRegistrationId: registration.id,
    requestedMode: "AUTO",
    expectedWorkspaceExecutionProfileRevisionId: profile.id,
  }, { background: false });

  assert.equal(job.status, "COMPLETED", JSON.stringify(job.error));
  assert.equal(job.workspaceExecutionProfileRevisionId, profile.id);
  assert.equal(job.resolvedMode, "FULL");
  assert.deepEqual(job.completedPhases, ["SOURCE_SCAN", "FACT_COMMIT", "ANALYSIS", "RECONCILIATION", "EVALUATION", "PROJECTION", "PUBLISHING"]);
  const current = await application.getCurrentUnderstandingGraph(workspace.id);
  const evaluation = await store.getUnderstandingRecord(
    workspace.id,
    "EVALUATION_RUN",
    job.outputs.EVALUATION.evaluationRunId,
  );
  const measurements = await store.listUnderstandingRecords(workspace.id, "REVIEWED_MEASUREMENT");
  assert.ok(current.head.version >= 1);
  for (const record of [job, current.head, current.revision, current.graphArtifact, evaluation]) {
    assert.equal(record.dataClassification, "LOCAL_DEVELOPMENT_REFERENCE_ONLY");
    assert.equal(record.productionEligible, false);
    assert.equal(record.evaluationEvidenceType, "LOCAL_REFERENCE_SYNTHETIC");
  }
  assert.equal(evaluation.reviewer.independent, false);
  assert.equal(evaluation.reviewer.evidenceType, "LOCAL_REFERENCE_SYNTHETIC");
  assert.equal(measurements.length, 1);
  assert.equal(measurements[0].independent, false);
  assert.equal(measurements[0].evaluationEvidenceType, "LOCAL_REFERENCE_SYNTHETIC");
  const measurementContract = JSON.parse(await readFile(
    new URL("../contracts/reviewed-understanding-measurement.schema.json", import.meta.url),
    "utf8",
  ));
  const declaredMeasurementFields = new Set(Object.keys(measurementContract.properties));
  assert.deepEqual(
    Object.keys(measurements[0]).filter((field) => !declaredMeasurementFields.has(field)),
    [],
    "the actual persisted reference measurement must satisfy the closed canonical record shape",
  );
  assert.deepEqual(
    measurementContract.required.filter((field) => !Object.hasOwn(measurements[0], field)),
    [],
  );
  const referenceVariant = measurementContract.$defs.LocalReferenceSynthetic;
  assert.equal(referenceVariant.properties.independent.const, false);
  assert.equal(referenceVariant.properties.dataClassification.const, "LOCAL_DEVELOPMENT_REFERENCE_ONLY");
  assert.equal(referenceVariant.properties.productionEligible.const, false);
  assert.equal(referenceVariant.properties.evaluationEvidenceType.const, "LOCAL_REFERENCE_SYNTHETIC");
  assert.ok(referenceVariant.required.every((field) => Object.hasOwn(measurements[0], field)));
});

test("F006 configured CLI producers require an explicitly injected test registry", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f006-cli-bootstrap-"));
  const sourceRoot = path.join(temporary, "source");
  await mkdir(sourceRoot);
  await writeFile(path.join(sourceRoot, "entry.js"), "export const fixture = true;\n");
  t.after(() => rm(temporary, { recursive: true, force: true }));

  await assert.rejects(
    () => createIsolatedDevelopmentApplication({ sourceRoot, useConfiguredModelProducers: true }),
    /require an injected analysis model registry/,
  );
});

test("F006 configured CLI bootstrap runs the mounted global and local Skill route from Child through Main", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f006-configured-route-"));
  const sourceRoot = path.join(temporary, "source");
  const secretEnvironmentName = "TRAQEN_F006_FAKE_CLI_SECRET";
  const priorSecret = process.env[secretEnvironmentName];
  await mkdir(sourceRoot);
  await writeFile(path.join(sourceRoot, "entry.js"), "export function checkout() { return { accepted: true }; }\n");
  process.env[secretEnvironmentName] = "test-only-fake-cli-secret";
  t.after(async () => {
    if (priorSecret === undefined) delete process.env[secretEnvironmentName];
    else process.env[secretEnvironmentName] = priorSecret;
    await rm(temporary, { recursive: true, force: true });
  });

  const calls = [];
  const store = new MemoryTraceabilityStore();
  const { application } = await createIsolatedDevelopmentApplication({
    sourceRoot,
    store,
    analysisModelRegistry: new AnalysisModelRegistry({ cliSpawn: fakeCodexSpawn(calls) }),
    useConfiguredModelProducers: true,
  });
  await application.createProject({
    organization: { id: "F006-ORG", name: "F006 organization" },
    tenant: { id: "F006-TENANT", name: "F006 tenant" },
    project: { id: "F006-CONFIGURED-ROUTE", name: "Configured route" },
    principals: [],
    actorId: "F006-TEST",
  });
  const workspace = await application.getWorkspace("F006-CONFIGURED-ROUTE");
  await application.saveGlobalAccount({
    accountId: "F006-CLI-ACCOUNT",
    displayName: "Fake CLI account",
    authMethod: "API_KEY",
    secretRefId: `env://${secretEnvironmentName}`,
    expectedVersion: 0,
  });
  await application.configureGlobalCliModel({
    profileId: "F006-CLI-MODEL",
    displayName: "Fake Codex model",
    accountId: "F006-CLI-ACCOUNT",
    cliAdapter: "CODEX",
    model: "gpt-5.6-terra",
    reasoningEffort: "high",
  });
  await application.verifyGlobalCliModel("F006-CLI-MODEL");
  const globalSkill = await application.saveGlobalCapability({
    kind: "SKILL",
    normalizedName: "global-reference",
    expectedVersion: 0,
    manifest: { adapterId: "specone-reference", version: "1.0.0" },
  });
  const localSkill = await application.saveWorkspaceProjectCapability(workspace.id, {
    kind: "SKILL",
    normalizedName: "local-reference",
    expectedVersion: 0,
    manifest: { adapterId: "gsd-reference", version: "1.0.0" },
  });
  const draft = await application.saveWorkspaceCapabilityDraft(workspace.id, {
    expectedVersion: 0,
    mainAgentSlot: {
      modelProfileId: "F006-CLI-MODEL",
      skillGrants: [{ kind: "SKILL", normalizedName: globalSkill.logicalName }],
    },
    childAgentSlots: [{
      id: "CHILD-FAKE-CLI",
      modelProfileId: "F006-CLI-MODEL",
      independenceGroup: "FAKE-CLI",
      skillGrants: [{ kind: "SKILL", normalizedName: localSkill.normalizedName }],
    }],
    projectCapabilityRevisionIds: [localSkill.id],
    disabledKeys: [],
    securityPolicy: {
      dataBoundary: "WORKSPACE",
      budgetLimit: "1",
      mcpPermissionMode: "ALLOW_SELECTED_MCP",
      grantedHandleIds: [],
    },
  });
  const activeProfile = await application.activateWorkspaceCapabilityDraft(workspace.id);
  const registration = await application.registerUnderstandingSource(workspace.id, { rootPath: sourceRoot });
  const job = await application.startWorkspaceUnderstandingJob(workspace.id, {
    sourceRegistrationId: registration.id,
    requestedMode: "AUTO",
    expectedWorkspaceExecutionProfileRevisionId: activeProfile.id,
  }, { background: false });

  assert.equal(draft.revision, 1);
  assert.equal(job.status, "COMPLETED", JSON.stringify(job.error));
  const callSummaries = calls.map(({ executable, args, options }) => ({
    executable,
    task: JSON.parse(args.at(-1)).task,
    shell: options.shell,
    model: args[args.indexOf("--model") + 1] ?? null,
  }));
  assert.deepEqual(callSummaries[0], {
    executable: "codex", task: "connection-verification", shell: false, model: "gpt-5.6-terra",
  });
  assert.ok(callSummaries.every(({ executable, shell, model }) => (
    executable === "codex" && shell === false && model === "gpt-5.6-terra"
  )));
  assert.ok(callSummaries.filter(({ task }) => task === "analysis").length > 0);
  assert.equal(
    callSummaries.filter(({ task }) => task === "analysis").length,
    callSummaries.filter(({ task }) => task === "reconciliation").length,
    "every Child-model analysis batch must reach Main reconciliation",
  );
  const requests = calls.map(({ args }) => JSON.parse(args.at(-1)));
  assert.deepEqual(requests.find(({ task }) => task === "analysis")?.outputContract, {
    candidateFeatures: [{
      candidateKey: "stable semantic key",
      mode: "BUSINESS or API",
      name: "readable name",
      description: "evidence-bounded explanation",
      confidence: "LOW, MEDIUM, or HIGH",
      evidenceFactIds: ["Fact ids from this input only"],
      stableEvidenceNodeIds: ["stable node ids from this input only"],
      design: {},
      uncertainties: [],
    }],
  }, "the Child prompt must carry the candidate fields consumed by the runtime");
  assert.deepEqual(requests.find(({ task }) => task === "reconciliation")?.outputContract, {
    candidateDecisions: [{
      candidateRef: "exact supplied ref",
      disposition: "ACCEPT | REJECT | CONFLICT | MERGE | ALTERNATIVE",
      rationale: "evidence-bounded reason",
      relatedCandidateRefs: ["optional supplied refs; only supplied sibling refs; never self"],
      mergedProposal: {
        name: "required for MERGE",
        statement: "one reconciled semantic claim",
        subjectKey: "optional supplied scoped path",
        confidence: "LOW | MEDIUM | HIGH",
      },
    }],
    relations: [{
      sourceCandidateRef: "optional supplied ref",
      sourceArtifactId: "optional supplied Artifact id",
      predicate: "semantic relationship",
      targetCandidateRef: "optional supplied ref",
      targetArtifactId: "optional supplied Artifact id",
      evidenceFactIds: ["supplied Fact ids"],
      sourceSliceIds: ["supplied SourceSlice ids"],
    }],
    gaps: [{ code: "bounded gap code", message: "explanation" }],
    rules: [
      "Return candidateDecisions, relations, and gaps arrays.",
      "Decide every supplied candidateRef exactly once.",
      "MERGE decisions require one or more relatedCandidateRefs; every member must be MERGE and share the same mergedProposal.",
      "mergedProposal is forbidden for non-MERGE decisions.",
    ],
  }, "the Main prompt must carry every rule enforced by reconciliation");
  const childResults = await store.listUnderstandingRecords(workspace.id, "CHILD_BATCH_RESULT");
  const mainResults = await store.listUnderstandingRecords(workspace.id, "MAIN_BATCH_RESULT");
  assert.ok(childResults.some((result) => result.output?.producerOutputs?.some((entry) => (
    entry.kind === "SKILL" && entry.logicalName === localSkill.normalizedName
  ))), "the Child must execute the selected Workspace-local mounted Skill");
  assert.ok(mainResults.some((result) => result.output?.executedCapabilities?.some((entry) => (
    entry.kind === "SKILL" && entry.logicalName === globalSkill.logicalName
  ))), "Main must execute the selected global mounted Skill after Child terminal results");
});

test("environment variables cannot enable local reference publication in the production bootstrap", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-production-isolation-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));

  assert.throws(() => createConfiguredApplication({
    store: new MemoryTraceabilityStore(),
    env: {
      SOURCE_SNAPSHOT_ROOT: temporary,
      TRAQEN_ALLOWED_WORKSPACE_ROOTS: temporary,
      TRAQEN_DEVELOPMENT_REFERENCE_MODE: "true",
    },
  }), /requires Truth Set, reviewed measurement, and equivalence evidence paths/);
});
