import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AnalysisModelRegistry, EncryptedAnalysisModelProfileStore } from "../src/analysis/index.js";
import { issueScopedSecretGrants } from "../src/domain/index.js";

function verifiedFetch() {
  return async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
}

function scopedModelContext(registry, profile) {
  const context = { workspaceId: "W1", profileId: "EXECUTION-PROFILE-1", analysisRunId: "RUN-1", slotId: "MAIN" };
  const [grant] = issueScopedSecretGrants({
    id: context.profileId,
    workspaceId: context.workspaceId,
    mainAgent: { model: profile.currentRevisionId, skillNames: [], mcpNames: [] },
    childSlots: [],
    entries: [{ kind: "MODEL", logicalName: profile.currentRevisionId, credentialHandleIds: [profile.credentialHandleId] }],
  }, { analysisRunId: context.analysisRunId, expiresAt: "2099-01-01T00:00:00.000Z" });
  registry.registerIssuedSecretGrants([grant]);
  return { ...context, grant };
}

test("runtime model profile metadata survives restart without a global active/default pointer or lifecycle authority", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "traqen-model-profiles-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "profiles.enc.json");
  const profileStore = new EncryptedAnalysisModelProfileStore({ filePath });
  const registry = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });

  registry.configure({
    id: "persistent-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKey: "persisted-secret",
    stream: true,
  });
  const verified = await registry.verify("persistent-model");
  assert.equal(Object.hasOwn(verified, "active"), false, "F006 has no global active/default model pointer");
  assert.equal(verified.stream, true);

  const decrypted = profileStore.load();
  assert.equal(Object.hasOwn(decrypted.profiles[0], "apiKey"), false, "profile metadata must reference a handle instead of owning secret material");
  assert.equal(Object.hasOwn(decrypted.revisions[0], "apiKey"), false);
  assert.equal(decrypted.credentialHandles.length, 1);
  assert.equal(decrypted.credentialHandles[0].secret, "persisted-secret");

  const encrypted = await readFile(filePath, "utf8");
  assert.equal(encrypted.includes("persisted-secret"), false);
  assert.equal(encrypted.includes("source-model"), false);

  const reloaded = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  assert.deepEqual(reloaded.list().map(({ id, ready, stream }) => ({ id, ready, stream })), [{
    id: "persistent-model",
    ready: true,
    stream: true,
  }]);
  assert.equal(reloaded.resolve(), null, "a credentialed model cannot be resolved without a scoped grant after restart");
  assert.ok(reloaded.resolve(reloaded.list()[0].currentRevisionId, scopedModelContext(reloaded, reloaded.list()[0])));

  const edited = reloaded.configure({
    id: "persistent-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKey: "",
    stream: true,
  });
  assert.equal(edited.ready, true);
  assert.equal(Object.hasOwn(edited, "active"), false);
  reloaded.remove("persistent-model");
  const retiredReload = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  assert.equal(Object.hasOwn(profileStore.load().profiles[0], "lifecycle"), false, "lifecycle authority belongs to the traceability store, not encrypted model metadata");
  assert.equal(retiredReload.list()[0].lifecycle, "ACTIVE", "a registry reload must not treat its local cache as lifecycle authority");
  assert.equal(Object.hasOwn(retiredReload.list()[0], "active"), false);
  assert.ok(retiredReload.resolve(edited.currentRevisionId, scopedModelContext(retiredReload, edited)), "historical model revisions survive restart for pinned runs");
});

test("the model Registry owns neither replacement lifecycle nor the durable Plan ledger", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "traqen-model-replacement-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profileStore = new EncryptedAnalysisModelProfileStore({ filePath: join(directory, "profiles.enc.json") });
  const registry = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  registry.configure({ id: "OLD", endpoint: "https://models.example/v1", model: "old", apiKey: "old-secret" });
  registry.configure({ id: "NEW", endpoint: "https://models.example/v1", model: "new", apiKey: "new-secret" });
  await registry.verify("OLD");
  await registry.verify("NEW");
  const plan = registry.createReplacementPlan({ sourceProfileId: "OLD", replacementProfileId: "NEW", references: [], changes: [] });
  registry.beginReplacementPlan(plan, plan.version);
  registry.completeReplacementPlan({ ...plan, status: "APPLIED", version: plan.version + 2 });

  const reloaded = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  assert.equal(Object.hasOwn(profileStore.load(), "replacementPlans"), false);
  assert.equal(Object.hasOwn(profileStore.load().profiles.find(({ id }) => id === "OLD"), "lifecycle"), false);
  assert.equal(reloaded.list().find(({ id }) => id === "OLD").lifecycle, "ACTIVE");
});

test("encrypted CredentialHandle persistence merges independent Registry revisions instead of overwriting another model", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "traqen-model-profile-merge-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profileStore = new EncryptedAnalysisModelProfileStore({ filePath: join(directory, "profiles.enc.json") });
  const primary = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  for (const id of ["MODEL-A", "MODEL-B"]) {
    primary.configure({ id, endpoint: "https://models.example/v1", model: `${id}-v1`, apiKey: `${id}-secret` });
  }
  const first = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  const second = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });

  first.configure({ id: "MODEL-A", endpoint: "https://models.example/v1", model: "model-a-v2", apiKey: "" });
  second.configure({ id: "MODEL-B", endpoint: "https://models.example/v1", model: "model-b-v2", apiKey: "" });

  const reloaded = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  assert.deepEqual(
    reloaded.list().map(({ id, model, revision }) => ({ id, model, revision })),
    [
      { id: "MODEL-A", model: "model-a-v2", revision: 2 },
      { id: "MODEL-B", model: "model-b-v2", revision: 2 },
    ],
  );
});
