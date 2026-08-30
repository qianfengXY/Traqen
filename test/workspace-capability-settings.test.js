import assert from "node:assert/strict";
import test from "node:test";

import {
  createCapabilityTemplateRevision,
  createGlobalAccountRevision,
  createGlobalModelProfileRevision,
  createWorkspaceCapabilityDraftRevision,
  resolveWorkspaceCapabilityCatalog,
  validateWorkspaceCapabilityDraft,
} from "../src/domain/index.js";
import { WorkspaceProductFoundation } from "../src/application/workspace-product-foundation.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";
import { createProjectFoundation } from "../src/domain/index.js";

test("F006 global capability revisions persist an explicit availability lifecycle", () => {
  const active = createCapabilityTemplateRevision({
    kind: "SKILL", logicalName: "review", revision: 1, lifecycle: "ACTIVE", manifest: { signature: "VERIFIED" },
  });
  const inactive = createCapabilityTemplateRevision({
    kind: "SKILL", logicalName: "review", revision: 2, lifecycle: "INACTIVE", manifest: { signature: "VERIFIED" },
  });

  assert.equal(active.lifecycle, "ACTIVE");
  assert.equal(inactive.lifecycle, "INACTIVE");
  assert.notEqual(active.id, inactive.id);
});

test("F006 accounts retain only a secret reference or CLI-owned OAuth status", () => {
  const apiKey = createGlobalAccountRevision({
    accountId: "account-api", displayName: "OpenAI key", authMethod: "API_KEY", secretRefId: "vault://traqen/openai", revision: 1,
  });
  const oauth = createGlobalAccountRevision({
    accountId: "account-oauth", displayName: "Codex account", authMethod: "OAUTH", cliAdapter: "CODEX", oauthStatus: "NOT_AUTHENTICATED", revision: 1,
  });

  assert.equal(apiKey.secretRefId, "vault://traqen/openai");
  assert.equal(oauth.oauthStatus, "NOT_AUTHENTICATED");
  assert.equal(oauth.cliAdapter, "CODEX");
  assert.throws(() => createGlobalAccountRevision({
    accountId: "leak", displayName: "Leak", authMethod: "API_KEY", apiKey: "plaintext", revision: 1,
  }), /credential material/);
  assert.throws(() => createGlobalAccountRevision({
    accountId: "token", displayName: "Token", authMethod: "OAUTH", accessToken: "plaintext", revision: 1,
  }), /credential material/);
  assert.throws(() => createGlobalAccountRevision({
    accountId: "raw-ref", displayName: "Raw ref", authMethod: "API_KEY", secretRefId: "sk-live-not-a-reference", revision: 1,
  }), /secretRefId must be an approved secret reference/);
});

test("F006 rechecks OAuth through a server-owned probe and persists only its derived status", async () => {
  const store = new MemoryTraceabilityStore();
  const probeCalls = [];
  const service = new WorkspaceProductFoundation({
    store,
    oauthStatusProbe: async (adapter) => {
      probeCalls.push(adapter);
      return { oauthStatus: "AUTHENTICATED" };
    },
  });
  await service.saveGlobalAccount({
    accountId: "codex-oauth", displayName: "Codex OAuth", authMethod: "OAUTH", cliAdapter: "CODEX", oauthStatus: "AUTHENTICATED", expectedVersion: 0,
  });

  const checked = await service.recheckGlobalAccount("codex-oauth");
  assert.deepEqual(probeCalls, ["CODEX"]);
  assert.equal(checked.oauthStatus, "AUTHENTICATED");
  assert.equal(checked.revision, 2);
  assert.equal(Object.hasOwn(checked, "instruction"), false);

  await assert.rejects(
    () => service.saveGlobalAccount({
      accountId: "gemini-oauth", displayName: "Gemini OAuth", authMethod: "OAUTH", cliAdapter: "GEMINI", expectedVersion: 0,
    }),
    /supported read-only status probe/,
  );
});

test("F006 resolves global availability as a Workspace ceiling without implicit grants", () => {
  const catalog = resolveWorkspaceCapabilityCatalog({
    builtinCatalog: [
      { id: "GLOBAL-SKILL-1", kind: "SKILL", normalizedName: "review", revision: 1, lifecycle: "ACTIVE", manifest: { signature: "VERIFIED" } },
      { id: "GLOBAL-MCP-1", kind: "MCP", normalizedName: "search", revision: 1, lifecycle: "INACTIVE", manifest: {} },
    ],
    projectCatalog: [
      { id: "LOCAL-SKILL-1", kind: "SKILL", normalizedName: "workspace-notes", revision: 1, manifest: { signature: "VERIFIED" } },
    ],
    disabledKeys: [{ kind: "SKILL", normalizedName: "review" }],
  });

  assert.deepEqual(catalog.entries.map(({ kind, normalizedName, availability, source }) => ({ kind, normalizedName, availability, source })), [
    { kind: "MCP", normalizedName: "search", availability: "GLOBAL_UNAVAILABLE", source: "GLOBAL" },
    { kind: "SKILL", normalizedName: "review", availability: "WORKSPACE_DISABLED", source: "GLOBAL" },
    { kind: "SKILL", normalizedName: "workspace-notes", availability: "AVAILABLE", source: "WORKSPACE" },
  ]);
  assert.deepEqual(catalog.effective.map(({ kind, normalizedName }) => `${kind}:${normalizedName}`), ["SKILL:workspace-notes"]);
  assert.deepEqual(catalog.summary, {
    globalAvailableCount: 1,
    workspaceDisabledCount: 1,
    workspaceLocalCount: 1,
    globalUnavailableCount: 1,
    effectiveCount: 1,
  });
});

test("F006 rejects local manifest replacement and inactive global grants", () => {
  assert.throws(() => resolveWorkspaceCapabilityCatalog({
    builtinCatalog: [{ id: "GLOBAL-SKILL-1", kind: "SKILL", normalizedName: "review", revision: 1, manifest: { signature: "VERIFIED" } }],
    projectCatalog: [{ id: "LOCAL-SKILL-1", kind: "SKILL", normalizedName: "review", revision: 1, manifest: { signature: "VERIFIED" } }],
  }), /cannot replace a global capability/);

  const inactiveCatalog = resolveWorkspaceCapabilityCatalog({
    builtinCatalog: [{ id: "GLOBAL-SKILL-1", kind: "SKILL", normalizedName: "review", revision: 1, lifecycle: "INACTIVE", manifest: { signature: "VERIFIED" } }],
  });
  const model = createGlobalModelProfileRevision({ profileId: "MODEL-1", transport: "CLI", cliAdapter: "CODEX", readiness: "READY" });
  const draft = createWorkspaceCapabilityDraftRevision({
    workspaceId: "W1",
    mainAgentSlot: { modelProfileId: "MODEL-1", skillGrants: [{ kind: "SKILL", normalizedName: "review" }] },
    childAgentSlots: [{ modelProfileId: "MODEL-1", independenceGroup: "GROUP-1" }],
  });

  const validation = validateWorkspaceCapabilityDraft({
    draft,
    modelProfiles: [model],
    effectiveCatalog: inactiveCatalog.effective,
    securityPolicy: { dataBoundary: "WORKSPACE", budgetLimit: "1", mcpPermissionMode: "ALLOW_SELECTED_MCP", grantedHandleIds: [] },
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some(({ code }) => code === "CAPABILITY_UNAVAILABLE"), true);
});

test("F006 previews active grant impact and requires typed confirmation before global deactivation", async () => {
  const store = new MemoryTraceabilityStore();
  await store.appendProjectFoundation(createProjectFoundation({
    organization: { id: "O", name: "Org" }, tenant: { id: "T", name: "Tenant" }, project: { id: "W1", name: "Workspace One" }, principals: [],
  }));
  const service = new WorkspaceProductFoundation({ store });
  await service.recordWorkspaceCreated("W1");
  const capability = await service.saveGlobalCapability({
    kind: "SKILL", normalizedName: "review", expectedVersion: 0, manifest: { signature: "VERIFIED" },
  });
  await service.saveCapabilityDraft("W1", {
    expectedVersion: 0,
    mainAgentSlot: { modelProfileId: "MODEL-1", skillGrants: [{ kind: "SKILL", normalizedName: "review" }] },
    childAgentSlots: [{ modelProfileId: "MODEL-1", independenceGroup: "GROUP-1" }],
    projectCapabilityRevisionIds: [], disabledKeys: [],
    securityPolicy: { dataBoundary: "WORKSPACE", budgetLimit: "1", mcpPermissionMode: "ALLOW_SELECTED_MCP", grantedHandleIds: [] },
  });
  await service.activateCapabilityDraft("W1", [{ id: "MODEL-REV-1", profileId: "MODEL-1", readiness: "READY", lifecycle: "ACTIVE" }]);

  const preview = await service.previewGlobalCapabilityImpact("SKILL", "review");
  assert.deepEqual(preview.impacts.map(({ workspaceId, grantedSlotIds }) => ({ workspaceId, grantedSlotIds })), [
    { workspaceId: "W1", grantedSlotIds: ["MAIN"] },
  ]);
  await assert.rejects(
    () => service.setGlobalCapabilityLifecycle("SKILL", "review", { expectedVersion: capability.revision, lifecycle: "INACTIVE" }),
    /Type review to confirm impact/,
  );
  const inactive = await service.setGlobalCapabilityLifecycle("SKILL", "review", {
    expectedVersion: capability.revision, lifecycle: "INACTIVE", confirmation: "review",
  });
  assert.equal(inactive.lifecycle, "INACTIVE");
  assert.equal(inactive.revision, 2);
  assert.deepEqual(await service.activeConfigurationIssues("W1"), [{
    workspaceId: "W1",
    activeProfileId: (await service.getActiveWorkspaceProfile("W1")).id,
    kind: "SKILL",
    normalizedName: "review",
    lifecycle: "INACTIVE",
    grantedSlotIds: ["MAIN"],
  }]);
});
