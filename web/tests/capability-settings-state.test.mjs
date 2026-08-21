import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDraftValidation,
  buildEffectiveDiff,
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
