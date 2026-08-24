import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDraftValidation,
  buildEffectiveDiff,
  buildLocalEffectiveCatalog,
  hasUnsavedCapabilityDraftChanges,
} from "../app/capability-settings-state.ts";

const readyModel = {
  id: "MODEL-REV-1",
  profileId: "MODEL-1",
  readiness: "READY",
  lifecycle: "ACTIVE",
};

const catalog = {
  entries: [{
    id: "SKILL-REVIEW-1",
    kind: "SKILL",
    normalizedName: "review",
    source: "BUILTIN",
    disabled: false,
    effective: true,
    manifest: { signature: "verified" },
    credentialHandleIds: ["HANDLE-REVIEW"],
  }],
  effective: [],
  summary: { builtinCount: 1, projectOverrideCount: 0, projectAdditionCount: 0, disabledCount: 0, effectiveCount: 1 },
};

const security = {
  dataBoundary: "WORKSPACE",
  budgetLimit: "100",
  mcpPermissionMode: "ALLOW_SELECTED_MCP",
  grantedHandleIds: [],
  telemetryPolicy: "METADATA_ONLY",
};

test("F006 invalid Draft exposes field-linked model and Child blockers before activation", () => {
  const summaries = buildDraftValidation({
    models: [readyModel], catalog, mainModel: "", mainRolePolicy: "PRIMARY_ANALYST",
    mainSkillNames: [], mainMcpNames: [], childSlots: [], security,
  });
  assert.deepEqual(summaries.filter(({ blocking }) => blocking).map(({ field }) => field), [
    "mainAgentSlot.modelProfileId",
    "childAgentSlots",
  ]);
});

test("F006 blocks a required scoped Handle and exposes deterministic import/removal diff entries", () => {
  const childSlots = [{ id: "CHILD-1", model: "MODEL-1", skillNames: [], mcpNames: [], rolePolicy: "SPECIALIST", independenceGroup: "GROUP-1" }];
  const summaries = buildDraftValidation({
    models: [readyModel], catalog, mainModel: "MODEL-1", mainRolePolicy: "PRIMARY_ANALYST",
    mainSkillNames: ["review"], mainMcpNames: [], childSlots, security,
  });
  assert.equal(summaries.some(({ title, blocking }) => title === "Secret Grant" && blocking), true);

  const imported = buildEffectiveDiff({ catalog, draft: null, disabledKeys: [], mainModel: "MODEL-1", mainRolePolicy: "PRIMARY_ANALYST", childSlots, security });
  assert.equal(imported.find(({ id }) => id === "SKILL:review").change, "IMPORTED");
  const removed = buildEffectiveDiff({ catalog, draft: null, disabledKeys: [{ kind: "SKILL", normalizedName: "review" }], mainModel: "MODEL-1", mainRolePolicy: "PRIMARY_ANALYST", childSlots, security });
  assert.equal(removed.find(({ id }) => id === "SKILL:review").change, "REMOVED");
});

test("F006 blocks a locally removed selected capability before the Draft is saved", () => {
  const childSlots = [{ id: "CHILD-1", model: "MODEL-1", skillNames: [], mcpNames: [], rolePolicy: "SPECIALIST", independenceGroup: "GROUP-1" }];
  const summaries = buildDraftValidation({
    models: [readyModel], catalog, mainModel: "MODEL-1", mainRolePolicy: "PRIMARY_ANALYST",
    mainSkillNames: ["review"], mainMcpNames: [], childSlots, security,
    disabledKeys: [{ kind: "SKILL", normalizedName: "review" }],
  });
  assert.equal(summaries.some(({ field, blocking }) => field === "agentSlots.grants" && blocking), true);
});

test("F006 blocks a selected template that is locally unimported before the Draft is saved", () => {
  const childSlots = [{ id: "CHILD-1", model: "MODEL-1", skillNames: [], mcpNames: [], rolePolicy: "SPECIALIST", independenceGroup: "GROUP-1" }];
  const savedDraft = {
    importedKeys: [{ kind: "SKILL", normalizedName: "review" }],
    disabledKeys: [],
  };
  const summaries = buildDraftValidation({
    models: [readyModel], catalog, mainModel: "MODEL-1", mainRolePolicy: "PRIMARY_ANALYST",
    mainSkillNames: ["review"], mainMcpNames: [], childSlots, security,
    draft: savedDraft, importedKeys: [], disabledKeys: [],
  });
  assert.equal(summaries.some(({ field, blocking }) => field === "agentSlots.grants" && blocking), true);
});

test("F006 effective Diff records an explicit global-template import before saving", () => {
  const childSlots = [{ id: "CHILD-1", model: "MODEL-1", skillNames: [], mcpNames: [], rolePolicy: "SPECIALIST", independenceGroup: "GROUP-1" }];
  const diff = buildEffectiveDiff({
    catalog,
    globalTemplates: [{
      id: "SKILL-REVIEW-1", kind: "SKILL", logicalName: "review", revision: 1,
      manifest: { signature: "VERIFIED" }, credentialHandleIds: [], createdAt: "2026-08-20T00:00:00.000Z",
    }],
    draft: null,
    importedKeys: [{ kind: "SKILL", normalizedName: "review" }],
    disabledKeys: [], mainModel: "MODEL-1", mainRolePolicy: "PRIMARY_ANALYST", childSlots, security,
  });
  assert.equal(diff.find(({ id }) => id === "SKILL:review").change, "IMPORTED");
});

test("F006 Effective Diff assigns distinct deterministic render keys to a same-named Workspace override", () => {
  const diff = buildEffectiveDiff({
    catalog: {
      ...catalog,
      entries: [{
        id: "SKILL-REVIEW-WORKSPACE-1",
        kind: "SKILL",
        normalizedName: "review",
        source: "PROJECT",
        projectRelation: "OVERRIDE",
        disabled: false,
        effective: true,
        manifest: { signature: "verified" },
        credentialHandleIds: [],
      }],
    },
    globalTemplates: [{
      id: "SKILL-REVIEW-1", kind: "SKILL", logicalName: "review", revision: 1,
      manifest: { signature: "VERIFIED" }, credentialHandleIds: [], createdAt: "2026-08-20T00:00:00.000Z",
    }],
    draft: null,
    importedKeys: [{ kind: "SKILL", normalizedName: "review" }],
    disabledKeys: [],
    mainModel: "MODEL-1",
    mainRolePolicy: "PRIMARY_ANALYST",
    childSlots: [],
    security,
  });
  const reviewEntries = diff.filter(({ id }) => id === "SKILL:review");
  assert.equal(reviewEntries.length, 2);
  assert.equal(new Set(reviewEntries.map(({ renderKey }) => renderKey)).size, 2);
  assert.deepEqual(
    reviewEntries.map(({ renderKey }) => renderKey),
    [
      "GLOBAL_TEMPLATE:IMPORTED:CAPABILITY:SKILL:review",
      "WORKSPACE_OVERRIDE:OVERRIDE:CAPABILITY:SKILL:review",
    ],
  );
});

test("F006 Effective Diff includes dirty dependency, convention, and safe security-note changes", () => {
  const childSlots = [{ id: "CHILD-1", model: "MODEL-1", skillNames: [], mcpNames: [], rolePolicy: "SPECIALIST", independenceGroup: "GROUP-1" }];
  const savedDraft = {
    importedKeys: [], disabledKeys: [],
    mainAgentSlot: { modelProfileId: "MODEL-1", rolePolicy: "PRIMARY_ANALYST", skillGrants: [], mcpGrants: [] },
    childAgentSlots: [],
    securityPolicy: { ...security, notes: "saved security note" },
    dependencies: { notes: "saved dependency note" },
    conventions: { notes: "saved convention note" },
  };
  const diff = buildEffectiveDiff({
    catalog, draft: savedDraft, disabledKeys: [], mainModel: "MODEL-1", mainRolePolicy: "PRIMARY_ANALYST", childSlots, security,
    dependencyNotes: "changed dependency note", conventionNotes: "changed convention note", securityNotes: "changed security note",
  });
  assert.equal(diff.find(({ id }) => id === "dependencies")?.change, "CHANGED");
  assert.equal(diff.find(({ id }) => id === "conventions")?.change, "CHANGED");
  assert.equal(diff.find(({ id }) => id === "security-policy")?.change, "CHANGED");
  assert.doesNotMatch(JSON.stringify(diff), /changed security note/);
});

test("F006 locally imported templates immediately enter the Draft effective catalog", () => {
  const emptyCatalog = {
    entries: [], effective: [],
    summary: { builtinCount: 0, projectOverrideCount: 0, projectAdditionCount: 0, disabledCount: 0, effectiveCount: 0 },
  };
  const localCatalog = buildLocalEffectiveCatalog({
    catalog: emptyCatalog,
    globalTemplates: [
      { id: "SKILL-REVIEW-1", kind: "SKILL", logicalName: "review", revision: 1, manifest: { signature: "VERIFIED" }, credentialHandleIds: ["HANDLE-REVIEW"], createdAt: "2026-08-21T00:00:00.000Z" },
      { id: "MCP-SEARCH-1", kind: "MCP", logicalName: "search", revision: 1, manifest: {}, credentialHandleIds: [], createdAt: "2026-08-21T00:00:00.000Z" },
    ],
    importedKeys: [{ kind: "SKILL", normalizedName: "review" }, { kind: "MCP", normalizedName: "search" }],
    disabledKeys: [],
  });
  assert.deepEqual(localCatalog.effective.map(({ kind, normalizedName }) => `${kind}:${normalizedName}`), ["MCP:search", "SKILL:review"]);
  assert.equal(localCatalog.summary.effectiveCount, 2);
  assert.deepEqual(localCatalog.effective.find(({ normalizedName }) => normalizedName === "review")?.credentialHandleIds, ["HANDLE-REVIEW"]);
});

test("F006 Effective Diff names a Dirty Agent capability-grant change", () => {
  const childSlots = [{ id: "CHILD-1", model: "MODEL-1", skillNames: [], mcpNames: [], rolePolicy: "SPECIALIST", independenceGroup: "GROUP-1" }];
  const draft = {
    importedKeys: [], disabledKeys: [],
    mainAgentSlot: { modelProfileId: "MODEL-1", rolePolicy: "PRIMARY_ANALYST", skillGrants: [], mcpGrants: [] },
    childAgentSlots: [], securityPolicy: security, dependencies: {}, conventions: {},
  };
  const diff = buildEffectiveDiff({
    catalog, draft, disabledKeys: [], mainModel: "MODEL-1", mainRolePolicy: "PRIMARY_ANALYST", mainSkillNames: ["review"], childSlots, security,
  });
  const main = diff.find(({ id }) => id === "main-agent");
  assert.equal(main?.change, "CHANGED");
  assert.match(main?.detail ?? "", /Skills review/);
});

test("F006 prevents activating a saved Draft when the visible Role policy is dirty", () => {
  const savedDraft = {
    revision: 2,
    mainAgentSlot: {
      id: "MAIN", role: "MAIN", displayName: "Main Agent", modelProfileId: "MODEL-1",
      skillGrants: [], mcpGrants: [], rolePolicy: "PRIMARY_ANALYST", independenceGroup: "MAIN", enabled: true,
    },
    childAgentSlots: [{
      id: "CHILD-1", role: "CHILD", displayName: "Child Agent 1", modelProfileId: "MODEL-1",
      skillGrants: [], mcpGrants: [], rolePolicy: "SPECIALIST", independenceGroup: "GROUP-1", enabled: true,
    }],
    projectCapabilityRevisionIds: [],
    importedKeys: [],
    disabledKeys: [],
    dependencies: { notes: "" },
    conventions: { notes: "" },
    securityPolicy: {
      notes: "", dataBoundary: "WORKSPACE", budgetLimit: "100", mcpPermissionMode: "ALLOW_SELECTED_MCP",
      grantedHandleIds: [], telemetryPolicy: "METADATA_ONLY",
    },
  };
  const visibleInput = {
    expectedVersion: 2,
    ...savedDraft,
    mainAgentSlot: { ...savedDraft.mainAgentSlot, rolePolicy: "DIRTY_UNSAVED_ROLE" },
  };
  assert.equal(hasUnsavedCapabilityDraftChanges(savedDraft, visibleInput), true);
  assert.equal(hasUnsavedCapabilityDraftChanges(savedDraft, { ...visibleInput, mainAgentSlot: savedDraft.mainAgentSlot }), false);
});
