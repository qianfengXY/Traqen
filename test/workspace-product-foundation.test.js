import assert from "node:assert/strict";
import test from "node:test";

import {
  commitChildBatchResult,
  createAnalysisBatch,
  createCapabilityTemplateRevision,
  createGlobalModelProfileRevision,
  createProjectCapabilityRevision,
  createProjectFoundation,
  createWorkspaceCapabilityConfig,
  createWorkspaceCapabilityDraftRevision,
  createWorkspacePolicyRevision,
  fanOutAnalysisBatch,
  issueScopedSecretGrants,
  openAnalysisBatchBarrier,
  activateWorkspaceCapabilityDraft,
  resolveWorkspaceCapabilityCatalog,
  resolveWorkspaceExecutionProfile,
} from "../src/domain/index.js";
import { WorkspaceProductFoundation } from "../src/application/workspace-product-foundation.js";
import { MemoryTraceabilityStore, PersistenceConflictError } from "../src/storage/index.js";

const clock = (() => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 31, 0, 0, tick++));
})();

async function foundation() {
  const store = new MemoryTraceabilityStore();
  await store.appendProjectFoundation(createProjectFoundation({
    organization: { id: "O", name: "Org" },
    tenant: { id: "T", name: "Tenant" },
    project: { id: "W1", name: "Workspace One" },
    principals: [],
  }));
  const service = new WorkspaceProductFoundation({ store, clock });
  await service.recordWorkspaceCreated("W1", "USER-1");
  return { store, service };
}

test("Workspace lifecycle is audited while per-user hiding preserves all Workspace data", async () => {
  const { store, service } = await foundation();
  await store.appendUnderstandingRecord("W1", "GAP", { id: "G1", workspaceId: "W1", code: "VISIBLE_AFTER_HIDE" });

  await service.setWorkspaceVisibility("W1", "USER-1", true);
  assert.equal((await service.getWorkspace("W1", "USER-1")).hidden, true);
  assert.equal((await service.getWorkspace("W1", "USER-2")).hidden, false);
  assert.equal((await store.getUnderstandingRecord("W1", "GAP", "G1")).code, "VISIBLE_AFTER_HIDE");

  assert.equal((await service.transitionWorkspace("W1", "WORKSPACE_RENAMED", "USER-1", { name: "Renamed" })).name, "Renamed");
  assert.equal((await service.transitionWorkspace("W1", "DELETION_REQUESTED", "USER-1")).lifecycleState, "DELETION_REQUESTED");
  assert.equal((await service.transitionWorkspace("W1", "DELETION_CANCELLED", "USER-1")).lifecycleState, "ACTIVE");
  await service.transitionWorkspace("W1", "DELETION_REQUESTED", "USER-1");
  assert.equal((await service.transitionWorkspace("W1", "DELETION_COMPLETED", "USER-1")).lifecycleState, "DELETED");
  assert.equal((await service.listWorkspaces("USER-1")).length, 0);
  assert.equal((await service.listWorkspaces("USER-1", { includeDeleted: true })).length, 1);
});

test("Workspace execution profiles deterministically override and remove global templates", () => {
  const templates = [
    createCapabilityTemplateRevision({ kind: "MODEL", logicalName: "main", revision: 1, manifest: { model: "old" } }, clock),
    createCapabilityTemplateRevision({ kind: "MODEL", logicalName: "main", revision: 2, manifest: { model: "new" } }, clock),
    createCapabilityTemplateRevision({ kind: "SKILL", logicalName: "source", revision: 1, manifest: {} }, clock),
    createCapabilityTemplateRevision({ kind: "MCP", logicalName: "global-only", revision: 1, manifest: {} }, clock),
  ];
  const config = createWorkspaceCapabilityConfig({
    workspaceId: "W1",
    version: 1,
    mainAgent: { model: "main", skillNames: ["source"], mcpNames: [] },
    childSlots: [
      { id: "C1", model: "main", skillNames: ["source"], mcpNames: [], independenceGroup: "I1" },
      { id: "C2", model: "main", skillNames: ["source"], mcpNames: [], independenceGroup: "I2" },
    ],
    overrides: [{ kind: "MODEL", logicalName: "main", manifest: { model: "workspace" }, credentialHandleIds: ["HANDLE-1"] }],
    removals: ["global-only"],
  }, clock);
  const left = resolveWorkspaceExecutionProfile({ workspaceId: "W1", templates, config, clock });
  const right = resolveWorkspaceExecutionProfile({ workspaceId: "W1", templates, config, clock });
  assert.equal(left.id, right.id);
  assert.equal(left.entries.find(({ logicalName }) => logicalName === "main").manifest.model, "workspace");
  assert.equal(left.entries.some(({ logicalName }) => logicalName === "global-only"), false);
  assert.equal(JSON.stringify(left).includes("secret"), false);
  assert.throws(() => createCapabilityTemplateRevision({
    kind: "MCP",
    logicalName: "unsafe",
    revision: 1,
    manifest: { connection: { apiKey: "plaintext" } },
  }), /cannot contain credential material/);
});

test("F006 resolves typed capability overlays, disables after overlay, and activates only a complete two-Child roster", () => {
  const builtins = [
    { id: "BS1", kind: "SKILL", normalizedName: "source", revision: 1, manifest: { origin: "builtin" } },
    { id: "BM1", kind: "MCP", normalizedName: "source", revision: 1, manifest: { origin: "builtin-mcp" } },
    { id: "BS2", kind: "SKILL", normalizedName: "review", revision: 1, manifest: {} },
  ];
  const project = [createProjectCapabilityRevision({ workspaceId: "W1", kind: "SKILL", normalizedName: "source", manifest: { origin: "project" } }, clock)];
  const catalog = resolveWorkspaceCapabilityCatalog({
    builtinCatalog: builtins,
    projectCatalog: project,
    disabledKeys: [{ kind: "SKILL", normalizedName: "source" }],
  });
  assert.deepEqual(catalog.summary, { builtinCount: 2, projectOverrideCount: 1, projectAdditionCount: 0, disabledCount: 1, effectiveCount: 2 });
  assert.equal(catalog.entries.find(({ kind, normalizedName }) => kind === "SKILL" && normalizedName === "source").source, "PROJECT");
  assert.equal(catalog.effective.some(({ kind, normalizedName }) => kind === "SKILL" && normalizedName === "source"), false);
  assert.equal(catalog.effective.some(({ kind, normalizedName }) => kind === "MCP" && normalizedName === "source"), true);

  const model = createGlobalModelProfileRevision({ profileId: "MODEL-1", transport: "API", providerAdapter: "OPENAI", endpoint: "https://example.test/v1", model: "m", credentialHandleId: "CRED-1", readiness: "READY" }, clock);
  const draft = createWorkspaceCapabilityDraftRevision({
    workspaceId: "W1",
    mainAgentSlot: { modelProfileId: "MODEL-1", skillGrants: [{ kind: "SKILL", normalizedName: "review" }] },
    childAgentSlots: [
      { id: "C1", modelProfileId: "MODEL-1", independenceGroup: "I1", mcpGrants: [{ kind: "MCP", normalizedName: "source" }] },
      { id: "C2", modelProfileId: "MODEL-1", independenceGroup: "I2" },
    ],
    dependencyPolicyRevisionId: "DEP-1",
    conventionRevisionId: "CON-1",
    securityPolicyRevisionId: "SEC-1",
  }, clock);
  const profile = activateWorkspaceCapabilityDraft({ draft, modelProfiles: [model], catalog, clock });
  assert.equal(profile.childAgentSlots.length, 2);
  assert.equal(profile.mainAgentSlot.modelProfileRevisionId, model.id);
  assert.equal(profile.mainAgent.model, model.id, "runtime compatibility fields also pin the immutable model revision");
  assert.equal(profile.childSlots[0].model, model.id);
  assert.deepEqual(profile.entries.filter(({ kind }) => kind === "MODEL").map(({ logicalName }) => logicalName), [model.id]);
  assert.throws(() => createGlobalModelProfileRevision({ profileId: "CLI-1", transport: "CLI", cliAdapter: "CODEX", executablePath: "/tmp/codex" }, clock), /allowlist/);
  assert.throws(() => activateWorkspaceCapabilityDraft({
    draft: createWorkspaceCapabilityDraftRevision({ ...draft, id: undefined, revision: 2, childAgentSlots: [draft.childAgentSlots[0]] }, clock),
    modelProfiles: [model], catalog, clock,
  }), /MINIMUM_CHILDREN/);
  assert.throws(() => activateWorkspaceCapabilityDraft({
    draft: createWorkspaceCapabilityDraftRevision({ ...draft, id: undefined, revision: 3, mainAgentSlot: { ...draft.mainAgentSlot, enabled: false } }, clock),
    modelProfiles: [model], catalog, clock,
  }), /MAIN_REQUIRED/);
});

test("F006 rejects plaintext Authorization material and keeps secret grants typed", () => {
  assert.throws(() => createProjectCapabilityRevision({
    workspaceId: "W1",
    kind: "MCP",
    normalizedName: "shared",
    manifest: { headers: { Authorization: "Bearer plaintext-secret" } },
  }, clock), /credential material/);

  const profile = {
    id: "PROFILE-1",
    workspaceId: "W1",
    mainAgent: { model: "MODEL-REV-1", skillNames: ["shared"], mcpNames: ["shared"] },
    childSlots: [],
    entries: [
      { kind: "MODEL", logicalName: "MODEL-REV-1", credentialHandleIds: ["MODEL-HANDLE"] },
      { kind: "SKILL", logicalName: "shared", credentialHandleIds: ["SKILL-HANDLE"] },
      { kind: "MCP", logicalName: "shared", credentialHandleIds: ["MCP-HANDLE"] },
    ],
  };
  const grants = issueScopedSecretGrants(profile, { analysisRunId: "RUN-1", expiresAt: "2026-08-14T00:00:00.000Z" });
  assert.deepEqual(grants.map(({ capabilityKind, capabilityName, credentialHandleId }) => ({ capabilityKind, capabilityName, credentialHandleId })), [
    { capabilityKind: "MCP", capabilityName: "shared", credentialHandleId: "MCP-HANDLE" },
    { capabilityKind: "MODEL", capabilityName: "MODEL-REV-1", credentialHandleId: "MODEL-HANDLE" },
    { capabilityKind: "SKILL", capabilityName: "shared", credentialHandleId: "SKILL-HANDLE" },
  ]);
});

test("F006 service persists invalid drafts, enforces CAS, and restores project catalog state", async () => {
  const { store, service } = await foundation();
  await service.registerCapabilityTemplate({ kind: "SKILL", logicalName: "source", revision: 1, manifest: { origin: "builtin" } });
  await service.registerCapabilityTemplate({ kind: "MCP", logicalName: "source", revision: 1, manifest: { origin: "builtin-mcp" } });
  const project = await service.saveProjectCapability("W1", { kind: "SKILL", normalizedName: "source", expectedVersion: 0, manifest: { origin: "project" } });
  const draft = await service.saveCapabilityDraft("W1", {
    expectedVersion: 0,
    mainAgentSlot: { modelProfileId: "MODEL-1" },
    childAgentSlots: [{ id: "C1", modelProfileId: "MODEL-1", independenceGroup: "I1" }],
    projectCapabilityRevisionIds: [project.id],
    disabledKeys: [{ kind: "SKILL", normalizedName: "source" }],
  });
  assert.equal((await service.getCapabilityDraft("W1")).id, draft.id);
  await assert.rejects(
    () => service.saveCapabilityDraft("W1", { expectedVersion: 0 }),
    (error) => error instanceof PersistenceConflictError
      && error.details?.head === "WORKSPACE_CAPABILITY_DRAFT"
      && error.details.expectedVersion === 0
      && error.details.currentVersion === 1,
    "a stale Draft editor needs a typed Workspace Draft head and both revisions",
  );
  const modelProfiles = [{ id: "MODEL-REV-1", profileId: "MODEL-1", readiness: "READY", lifecycle: "ACTIVE" }];
  const validation = await service.validateCapabilityDraft("W1", modelProfiles);
  assert.equal(validation.validation.valid, false);
  assert.equal(validation.validation.errors.some(({ code }) => code === "MINIMUM_CHILDREN"), true);
  assert.equal(validation.catalog.entries.find(({ kind }) => kind === "SKILL").source, "PROJECT");
  assert.equal(validation.catalog.entries.find(({ kind }) => kind === "MCP").effective, true);
  await assert.rejects(() => service.deleteProjectCapability("W1", "SKILL", "source"), /expectedVersion is required/);

  const valid = await service.saveCapabilityDraft("W1", {
    expectedVersion: 1,
    mainAgentSlot: { modelProfileId: "MODEL-1" },
    childAgentSlots: [
      { id: "C1", modelProfileId: "MODEL-1", independenceGroup: "I1" },
      { id: "C2", modelProfileId: "MODEL-1", independenceGroup: "I2" },
    ],
    projectCapabilityRevisionIds: [project.id],
    disabledKeys: [],
  });
  assert.equal(valid.revision, 2);
  const profile = await service.activateCapabilityDraft("W1", modelProfiles);
  assert.equal(profile.draftRevisionId, valid.id);
  assert.equal(profile.childAgentSlots.length, 2);

  const concurrent = await Promise.allSettled([
    service.saveCapabilityDraft("W1", { expectedVersion: 2, mainAgentSlot: {}, childAgentSlots: [] }),
    service.saveCapabilityDraft("W1", { expectedVersion: 2, mainAgentSlot: {}, childAgentSlots: [] }),
  ]);
  assert.deepEqual(concurrent.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
  const policies = await store.listUnderstandingRecords("W1", "WORKSPACE_POLICY_REVISION");
  assert.deepEqual(Object.fromEntries(["DEPENDENCY", "CONVENTION", "SECURITY"].map((kind) => [kind, policies.filter((record) => record.kind === kind).length])), {
    DEPENDENCY: 3,
    CONVENTION: 3,
    SECURITY: 3,
  }, "a losing draft CAS must not leave orphan policy revisions");
});

test("F006 restores policy content, honors pinned project revisions, and permits explicit recreate after tombstone", async () => {
  const { store, service } = await foundation();
  const first = await service.saveProjectCapability("W1", { kind: "SKILL", normalizedName: "source", expectedVersion: 0, manifest: { marker: "REV1" } });
  await service.saveCapabilityDraft("W1", {
    expectedVersion: 0,
    mainAgentSlot: { modelProfileId: "MODEL-1", skillGrants: [{ kind: "SKILL", normalizedName: "source" }] },
    childAgentSlots: [
      { id: "C1", modelProfileId: "MODEL-1", independenceGroup: "I1" },
      { id: "C2", modelProfileId: "MODEL-1", independenceGroup: "I2" },
    ],
    projectCapabilityRevisionIds: [first.id],
    disabledKeys: [],
    dependencies: { notes: "dependency-v1" },
    conventions: { notes: "convention-v1" },
    securityPolicy: { notes: "security-v1" },
  });
  await service.saveProjectCapability("W1", { kind: "SKILL", normalizedName: "source", expectedVersion: 1, manifest: { marker: "REV2" } });
  const added = await service.saveProjectCapability("W1", { kind: "MCP", normalizedName: "new-tool", expectedVersion: 0, manifest: { marker: "NEW" } });
  const restored = await service.getCapabilityDraft("W1");
  assert.equal(restored.dependencies.notes, "dependency-v1");
  assert.equal(restored.conventions.notes, "convention-v1");
  assert.equal(restored.securityPolicy.notes, "security-v1");
  const nonHeadDraft = createWorkspaceCapabilityDraftRevision({
    ...restored,
    id: undefined,
    revision: 99,
    dependencies: undefined,
    conventions: undefined,
    securityPolicy: undefined,
  }, clock);
  await store.appendUnderstandingRecord("W1", "WORKSPACE_CAPABILITY_DRAFT", nonHeadDraft);
  assert.equal((await service.getCapabilityDraft("W1")).id, restored.id,
    "read recovery must follow the authoritative Draft Head, not the highest orphan revision");
  const nonHeadCapability = createProjectCapabilityRevision({
    workspaceId: "W1",
    kind: "SKILL",
    normalizedName: "source",
    revision: 99,
    manifest: { marker: "ORPHAN" },
  }, clock);
  await store.appendUnderstandingRecord("W1", "PROJECT_CAPABILITY_REVISION", nonHeadCapability);
  const nonHeadPolicy = createWorkspacePolicyRevision({
    workspaceId: "W1",
    kind: "DEPENDENCY",
    revision: 99,
    content: { notes: "orphan-dependency" },
  }, clock);
  await store.appendUnderstandingRecord("W1", "WORKSPACE_POLICY_REVISION", nonHeadPolicy);
  const settingsCatalog = await service.effectiveCapabilityCatalog("W1");
  assert.equal(settingsCatalog.entries.find(({ kind, normalizedName }) => kind === "SKILL" && normalizedName === "source").manifest.marker, "REV2");
  assert.equal(settingsCatalog.entries.some(({ id }) => id === added.id), true, "the settings catalog must expose newly added project capabilities");
  const revised = await service.saveCapabilityDraft("W1", {
    expectedVersion: 1,
    mainAgentSlot: restored.mainAgentSlot,
    childAgentSlots: restored.childAgentSlots,
    projectCapabilityRevisionIds: restored.projectCapabilityRevisionIds,
    disabledKeys: restored.disabledKeys,
    dependencies: { notes: "dependency-v2" },
    conventions: { notes: "convention-v2" },
    securityPolicy: { notes: "security-v2" },
  });
  const revisedDependency = await store.getUnderstandingRecord("W1", "WORKSPACE_POLICY_REVISION", revised.dependencyPolicyRevisionId);
  assert.equal(revisedDependency.revision, 2,
    "new Policy revisions must advance from the authoritative Head instead of orphan records");
  const modelProfiles = [{ id: "MODEL-REV-1", profileId: "MODEL-1", readiness: "READY", lifecycle: "ACTIVE", transport: "API", model: "m" }];
  const activated = await service.activateCapabilityDraft("W1", modelProfiles);
  assert.equal(activated.entries.find(({ kind }) => kind === "SKILL").manifest.marker, "REV1");
  assert.deepEqual(activated.policyProvenance.map(({ kind }) => kind).sort(), ["CONVENTION", "DEPENDENCY", "SECURITY"]);
  assert.equal(activated.policyProvenance.every(({ id, contentDigest }) => id && contentDigest), true);

  await service.deleteProjectCapability("W1", "SKILL", "source", 2);
  const recreated = await service.saveProjectCapability("W1", { kind: "SKILL", normalizedName: "source", expectedVersion: 0, manifest: { marker: "RECREATED" } });
  assert.equal(recreated.revision, 4);
  assert.equal(recreated.deleted, undefined);
});

test("F006 model usage reads the latest durable job checkpoint state", async () => {
  const { store, service } = await foundation();
  const modelProfiles = [{ id: "MODEL-REV-1", profileId: "MODEL-1", readiness: "READY", lifecycle: "ACTIVE", transport: "API", model: "m" }];
  await service.saveCapabilityDraft("W1", {
    expectedVersion: 0,
    mainAgentSlot: { modelProfileId: "MODEL-1" },
    childAgentSlots: [
      { id: "C1", modelProfileId: "MODEL-1", independenceGroup: "I1" },
      { id: "C2", modelProfileId: "MODEL-1", independenceGroup: "I2" },
    ],
    projectCapabilityRevisionIds: [], disabledKeys: [],
  });
  const profile = await service.activateCapabilityDraft("W1", modelProfiles);
  await store.appendUnderstandingRecord("W1", "WORKSPACE_ANALYSIS_JOB", {
    id: "CHECKPOINT-1", jobId: "RUN-1", checkpointSequence: 1,
    state: { id: "RUN-1", status: "RUNNING", workspaceExecutionProfileRevisionId: profile.id },
  });
  const usage = await service.modelUsage("MODEL-1");
  assert.equal(usage.references.some(({ source, runId }) => source === "ACTIVE_RUN" && runId === "RUN-1"), true);
});

test("F006 model replacement applies every Workspace atomically and rolls back on stale CAS", async () => {
  const { store, service } = await foundation();
  await store.appendProjectFoundation(createProjectFoundation({
    organization: { id: "O", name: "Org" }, tenant: { id: "T", name: "Tenant" },
    project: { id: "W2", name: "Workspace Two" }, principals: [],
  }));
  await service.recordWorkspaceCreated("W2", "USER-1");
  const models = [
    { id: "MODEL-REV-OLD", profileId: "MODEL-OLD", readiness: "READY", lifecycle: "ACTIVE", transport: "API", model: "old" },
    { id: "MODEL-REV-NEW", profileId: "MODEL-NEW", readiness: "READY", lifecycle: "ACTIVE", transport: "API", model: "new" },
  ];
  for (const workspaceId of ["W1", "W2"]) {
    await service.saveCapabilityDraft(workspaceId, {
      expectedVersion: 0,
      mainAgentSlot: { modelProfileId: "MODEL-OLD" },
      childAgentSlots: [
        { id: "C1", modelProfileId: "MODEL-OLD", independenceGroup: "I1" },
        { id: "C2", modelProfileId: "MODEL-OLD", independenceGroup: "I2" },
      ],
      projectCapabilityRevisionIds: [], disabledKeys: [],
    });
    await service.activateCapabilityDraft(workspaceId, models);
  }

  const stalePlan = await service.prepareModelReplacement("MODEL-OLD", "MODEL-NEW", models);
  await service.saveCapabilityDraft("W2", {
    ...(await service.getCapabilityDraft("W2")),
    expectedVersion: 1,
  });
  await assert.rejects(() => service.applyModelReplacement(stalePlan), /version conflict/);
  assert.equal((await service.getCapabilityDraft("W1")).revision, 1, "stale apply must not mutate an earlier Workspace");

  const freshPlan = await service.prepareModelReplacement("MODEL-OLD", "MODEL-NEW", models);
  const applied = await service.applyModelReplacement(freshPlan);
  assert.equal(applied.length, 2);
  for (const workspaceId of ["W1", "W2"]) {
    assert.equal((await service.getCapabilityDraft(workspaceId)).mainAgentSlot.modelProfileId, "MODEL-NEW");
    assert.equal((await service.listWorkspaceProfiles(workspaceId))[0].mainAgentSlot.modelProfileRevisionId, "MODEL-REV-NEW");
  }
  assert.equal((await service.applyModelReplacement(freshPlan)).length, 2, "retrying a committed all-Workspace transaction is idempotent");
  for (const workspaceId of ["W1", "W2"]) {
    assert.equal((await service.getCapabilityDraft(workspaceId)).revision, freshPlan.find((change) => change.workspaceId === workspaceId).draft.revision);
  }

  assert.deepEqual(await service.applyModelReplacement([]), [], "an active-run-only replacement has no current Workspace mutation to apply");
});

test("Memory model replacement serializes a concurrent Workspace CAS instead of leaving a failed Plan partially applied", async () => {
  const store = new MemoryTraceabilityStore();
  const slots = (modelProfileId) => ({
    mainAgentSlot: { id: "MAIN", modelProfileId },
    childAgentSlots: [{ id: "C1", modelProfileId }, { id: "C2", modelProfileId }],
  });
  await store.appendUnderstandingRecordWithCas("W-MEMORY-ATOMIC", "WORKSPACE_CAPABILITY_DRAFT", {
    id: "DRAFT-OLD", revision: 1, createdAt: "2026-08-14T00:00:00.000Z", ...slots("MODEL-OLD"),
  }, { headKey: "WORKSPACE_CAPABILITY_DRAFT", expectedVersion: 0 });
  await store.appendUnderstandingRecordWithCas("W-MEMORY-ATOMIC", "WORKSPACE_EXECUTION_PROFILE", {
    id: "PROFILE-OLD", createdAt: "2026-08-14T00:00:00.000Z", ...slots("MODEL-OLD"),
  }, { headKey: "WORKSPACE_EXECUTION_PROFILE", expectedVersion: 0 });
  const plan = {
    id: "PLAN-MEMORY-ATOMIC", version: 1, status: "READY", sourceProfileId: "MODEL-OLD", replacementProfileId: "MODEL-NEW",
    createdAt: "2026-08-14T00:00:01.000Z", appliedAt: null,
    changes: [{
      workspaceId: "W-MEMORY-ATOMIC", expectedDraftVersion: 1, expectedProfileVersion: 1,
      priorDraftId: "DRAFT-OLD", priorProfileId: "PROFILE-OLD",
      draft: { id: "DRAFT-NEW", revision: 2, createdAt: "2026-08-14T00:00:02.000Z", ...slots("MODEL-NEW") },
      profile: { id: "PROFILE-NEW", createdAt: "2026-08-14T00:00:02.000Z", ...slots("MODEL-NEW") },
    }],
  };
  await store.createModelReplacementPlan(plan);

  const applying = store.applyModelReplacementPlan(plan.id, plan.version);
  const competingCas = store.appendUnderstandingRecordWithCas("W-MEMORY-ATOMIC", "WORKSPACE_CAPABILITY_DRAFT", {
    id: "DRAFT-CONCURRENT", revision: 3, createdAt: "2026-08-14T00:00:03.000Z", ...slots("MODEL-OLD"),
  }, { headKey: "WORKSPACE_CAPABILITY_DRAFT", expectedVersion: 2 });
  const [applied, competing] = await Promise.allSettled([applying, competingCas]);

  assert.equal(applied.status, "fulfilled", "the concurrent CAS must serialize after a complete replacement instead of making its Plan fail after partial persistence");
  assert.equal(competing.status, "fulfilled");
  assert.equal((await store.getModelReplacementPlan(plan.id)).status, "APPLIED");
  assert.equal((await store.getGlobalModelLifecycle("MODEL-OLD")).lifecycle, "RETIRING");
  assert.equal((await store.getUnderstandingHead("W-MEMORY-ATOMIC", "WORKSPACE_EXECUTION_PROFILE")).recordId, "PROFILE-NEW");
});

test("F006 active execution profile reads follow the CAS head even when timestamps tie", async () => {
  const store = new MemoryTraceabilityStore();
  const tiedClock = () => new Date("2026-08-13T00:00:00.000Z");
  await store.appendProjectFoundation(createProjectFoundation({
    organization: { id: "O", name: "Org" }, tenant: { id: "T", name: "Tenant" },
    project: { id: "W1", name: "Workspace One" }, principals: [],
  }));
  const service = new WorkspaceProductFoundation({ store, clock: tiedClock });
  await service.recordWorkspaceCreated("W1", "USER-1");
  const models = [
    { id: "MODEL-REV-OLD", profileId: "MODEL-OLD", readiness: "READY", lifecycle: "ACTIVE", transport: "API", model: "old" },
    { id: "MODEL-REV-NEW", profileId: "MODEL-NEW", readiness: "READY", lifecycle: "ACTIVE", transport: "API", model: "new" },
  ];
  await service.saveCapabilityDraft("W1", {
    expectedVersion: 0,
    mainAgentSlot: { modelProfileId: "MODEL-OLD" },
    childAgentSlots: [
      { id: "C1", modelProfileId: "MODEL-OLD", independenceGroup: "I1" },
      { id: "C2", modelProfileId: "MODEL-OLD", independenceGroup: "I2" },
    ],
    projectCapabilityRevisionIds: [], disabledKeys: [],
  });
  await service.activateCapabilityDraft("W1", models);
  const plan = await service.prepareModelReplacement("MODEL-OLD", "MODEL-NEW", models);
  await service.applyModelReplacement(plan);
  assert.equal((await service.listWorkspaceProfiles("W1"))[0].mainAgentSlot.modelProfileId, "MODEL-NEW");
  assert.equal((await service.getActiveWorkspaceProfile("W1")).mainAgentSlot.modelProfileId, "MODEL-NEW",
    "new Run resolution must read the CAS Active Head instead of inferring recency from history");
});

test("every configured Child receives the same sealed batch and Main waits for the full terminal set", () => {
  const profile = {
    workspaceId: "W1",
    childSlots: [
      { id: "C1", model: "M1", skillNames: [], mcpNames: [], independenceGroup: "I1" },
      { id: "C2", model: "M2", skillNames: [], mcpNames: [], independenceGroup: "I2" },
    ],
  };
  const batch = createAnalysisBatch({
    workspaceId: "W1",
    snapshotManifestId: "S1",
    analysisRunId: "R1",
    profileRevisionId: "P1",
    sequence: 1,
    sourceScope: { artifactIds: ["A1"] },
    taskStatement: "Recover capability and cite evidence",
    outputSchema: { type: "object" },
    sourcePolicy: { maxBytes: 1000 },
  }, clock);
  const assignments = fanOutAnalysisBatch(batch, profile, clock);
  assert.equal(assignments.length, 2);
  assert.deepEqual(assignments.map(({ inputDigest }) => inputDigest), [batch.inputDigest, batch.inputDigest]);
  assert.deepEqual(assignments[0].sourceScope, assignments[1].sourceScope);

  const result = (assignment) => commitChildBatchResult({
    workspaceId: "W1",
    analysisRunId: "R1",
    analysisBatchId: batch.id,
    childWorkUnitId: assignment.id,
    slotId: assignment.slotId,
    inputDigest: assignment.inputDigest,
    independenceGroup: assignment.route.independenceGroup,
    status: "COMPLETED",
    output: { candidates: [] },
  }, clock);
  assert.throws(() => openAnalysisBatchBarrier(batch, assignments, [result(assignments[0])]), /every required Child/);
  const barrier = openAnalysisBatchBarrier(batch, assignments, assignments.map(result));
  assert.equal(barrier.opened, true);
  assert.deepEqual(barrier.independenceGroups, ["I1", "I2"]);
});

test("Child result retries are idempotent by sealed input digest", async () => {
  const { service } = await foundation();
  await service.registerCapabilityTemplate({
    kind: "MODEL", logicalName: "model", revision: 1, manifest: {},
  });
  const config = await service.saveWorkspaceCapabilityConfig("W1", {
    mainAgent: { model: "model", skillNames: [], mcpNames: [] },
    childSlots: [
      { id: "C1", model: "model", skillNames: [], mcpNames: [], independenceGroup: "I1" },
      { id: "C2", model: "model", skillNames: [], mcpNames: [], independenceGroup: "I2" },
    ],
  });
  const profile = await service.resolveWorkspaceProfile("W1", config.id);
  const { batch, assignments } = await service.createBatch("W1", {
    snapshotManifestId: "S1",
    analysisRunId: "R1",
    profileRevisionId: profile.id,
    sequence: 1,
    sourceScope: { artifactIds: ["A1"] },
    taskStatement: "Recover semantics",
    outputSchema: { type: "object" },
    sourcePolicy: { maxBytes: 1000 },
  });
  const input = {
    analysisRunId: "R1",
    analysisBatchId: batch.id,
    childWorkUnitId: assignments[0].id,
    slotId: assignments[0].slotId,
    inputDigest: assignments[0].inputDigest,
    independenceGroup: "I1",
    status: "COMPLETED",
    output: { candidates: [] },
  };
  const first = await service.commitChildResult("W1", input);
  const retry = await service.commitChildResult("W1", input);
  assert.deepEqual(retry, first);
  await assert.rejects(
    () => service.commitChildResult("W1", { ...input, output: { candidates: [{ id: "different" }] } }),
    /conflicting Child result/,
  );
});

test("batch review projects one auditable decision atomically across selected queue items", async () => {
  const { store, service } = await foundation();
  for (const [id, evidenceState] of [["Q1", "EVIDENCE_VALIDATED"], ["Q2", "CONFLICT"]]) {
    await store.appendUnderstandingRecord("W1", "REVIEW_QUEUE_ITEM", {
      id,
      workspaceId: "W1",
      version: 1,
      status: "PENDING",
      severity: evidenceState === "CONFLICT" ? "BLOCKING" : "REVIEW",
      evidenceState,
      source: "RECONCILIATION",
      analysisBatchId: "B1",
      createdAt: clock().toISOString(),
    });
  }
  const decision = await service.decideReviewBatch("W1", {
    itemIds: ["Q1", "Q2"],
    outcome: "EDITED",
    edits: { Q1: { statement: "Reviewer wording" } },
    reviewerId: "REVIEWER-1",
    rationale: "Evidence checked against the selected Snapshot.",
  });
  assert.deepEqual(decision.versionVector, { Q1: 1, Q2: 1 });
  const reviewed = await service.getReviewQueue("W1", { status: "EDITED" });
  assert.equal(reviewed.length, 2);
  assert.equal(reviewed.find(({ id }) => id === "Q1").edits.statement, "Reviewer wording");
});
