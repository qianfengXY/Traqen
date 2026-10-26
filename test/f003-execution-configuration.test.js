import assert from "node:assert/strict";
import test from "node:test";
import { F006ExecutionConfiguration } from "../src/business-knowledge/execution-configuration.js";
import { sourceDatabase, owner } from "./support/source-truth-database.js";
import { PostgresTraceabilityStore } from "../src/storage/index.js";
import { createGlobalAccountRevision, createGlobalModelProfileRevision, createWorkspaceCapabilityDraftRevision,
  activateWorkspaceCapabilityDraft } from "../src/domain/index.js";

test("F003 resolves the actual F006 active head and rejects revoked model/account eligibility inside the same transaction", async t => {
  const { db, repository } = await sourceDatabase(t);
  const store = new PostgresTraceabilityStore(db);
  const account = createGlobalAccountRevision({ accountId: "oauth-test", displayName: "Isolated OAuth account", authMethod: "OAUTH",
    cliAdapter: "CODEX", oauthStatus: "AUTHENTICATED", revision: 1 });
  await store.appendGlobalAccountRevision(account);
  const model = createGlobalModelProfileRevision({ profileId: "codex-test", transport: "CLI", cliAdapter: "CODEX", model: "test-only",
    accountId: account.accountId, readiness: "READY" });
  await store.ensureGlobalModelProfileRevision({ id: model.profileId, currentRevisionId: model.id, revision: 1, transport: "CLI", cliAdapter: "CODEX",
    model: "test-only", accountId: account.accountId, ready: true, verifiedAt: new Date().toISOString(), lifecycle: "ACTIVE" });
  const draft = createWorkspaceCapabilityDraftRevision({ workspaceId: "workspace", mainAgentSlot: { modelProfileId: model.profileId },
    childAgentSlots: [{ modelProfileId: model.profileId, independenceGroup: "test-child" }] });
  const active = activateWorkspaceCapabilityDraft({ draft, modelProfiles: [{ ...model, ...model.connection }], catalog: { effective: [] },
    securityPolicy: { dataBoundary: "WORKSPACE", budgetLimit: "5", mcpPermissionMode: "DENY_MCP", grantedHandleIds: [] } });
  await store.appendUnderstandingRecordWithCas("workspace", "WORKSPACE_EXECUTION_PROFILE", active, { headKey: "WORKSPACE_EXECUTION_PROFILE", expectedVersion: 0 });
  const bridge = new F006ExecutionConfiguration();
  const resolved = await repository.withWorkspace(owner, "workspace", false, tx => bridge.resolveActive(owner, "workspace", tx));
  assert.equal(resolved.id, active.id);
  await repository.withWorkspace(owner, "workspace", false, tx => bridge.assertUsable(owner, "workspace", resolved, tx));
  await assert.rejects(repository.withWorkspace(owner, "workspace", false, tx => bridge.assertUsable(owner, "workspace", { ...resolved, entries: [] }, tx)), { code: "F003_PROFILE_UNAVAILABLE" });
  await store.setGlobalModelLifecycle(model.profileId, "RETIRING");
  await assert.rejects(repository.withWorkspace(owner, "workspace", false, tx => bridge.assertUsable(owner, "workspace", resolved, tx)), { code: "F003_MODEL_UNAVAILABLE" });
  await store.setGlobalModelLifecycle(model.profileId, "ACTIVE");
  await store.appendGlobalAccountRevision(createGlobalAccountRevision({ ...account, revision: 2, oauthStatus: "NOT_AUTHENTICATED" }));
  await assert.rejects(repository.withWorkspace(owner, "workspace", false, tx => bridge.assertUsable(owner, "workspace", resolved, tx)), { code: "F003_ACCOUNT_UNAVAILABLE" });
});
