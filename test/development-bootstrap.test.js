import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createConfiguredApplication } from "../src/api/application-bootstrap.js";
import { createIsolatedDevelopmentApplication } from "../src/api/development-bootstrap.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";

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
  const job = await application.startWorkspaceUnderstandingJob(workspace.id, {
    sourceRegistrationId: registration.id,
    workspaceExecutionProfileRevisionId: profile.id,
    requestedMode: "AUTO",
  }, { background: false });

  assert.equal(job.status, "COMPLETED", JSON.stringify(job.error));
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
