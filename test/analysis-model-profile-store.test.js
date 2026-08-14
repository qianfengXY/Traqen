import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AnalysisModelRegistry, EncryptedAnalysisModelProfileStore } from "../src/analysis/index.js";

function verifiedFetch() {
  return async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
}

function scopedModelContext(profile) {
  const context = { workspaceId: "W1", profileId: "EXECUTION-PROFILE-1", analysisRunId: "RUN-1", slotId: "MAIN" };
  return { ...context, grant: { ...context, capabilityKind: "MODEL", capabilityName: profile.currentRevisionId, credentialHandleId: profile.credentialHandleId, expiresAt: "2099-01-01T00:00:00.000Z" } };
}

test("runtime model profiles and an explicit active selection survive restart in an encrypted local store", async (t) => {
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
  assert.equal(verified.active, false, "verification must not create a global fallback selection");
  assert.equal(verified.stream, true);
  registry.select("persistent-model");

  const decrypted = profileStore.load();
  assert.equal(Object.hasOwn(decrypted.profiles[0], "apiKey"), false, "profile metadata must reference a handle instead of owning secret material");
  assert.equal(Object.hasOwn(decrypted.revisions[0], "apiKey"), false);
  assert.equal(decrypted.credentialHandles.length, 1);
  assert.equal(decrypted.credentialHandles[0].secret, "persisted-secret");

  const encrypted = await readFile(filePath, "utf8");
  assert.equal(encrypted.includes("persisted-secret"), false);
  assert.equal(encrypted.includes("source-model"), false);

  const reloaded = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  assert.deepEqual(reloaded.list().map(({ id, ready, active, stream }) => ({ id, ready, active, stream })), [{
    id: "persistent-model",
    ready: true,
    active: true,
    stream: true,
  }]);
  assert.equal(reloaded.resolve(), null, "a credentialed model cannot be resolved without a scoped grant after restart");
  assert.ok(reloaded.resolve(reloaded.list()[0].currentRevisionId, scopedModelContext(reloaded.list()[0])));

  const edited = reloaded.configure({
    id: "persistent-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKey: "",
    stream: true,
  });
  assert.equal(edited.ready, true);
  assert.equal(edited.active, true);
  reloaded.remove("persistent-model");
  const retiredReload = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  assert.equal(retiredReload.list()[0].lifecycle, "RETIRING");
  assert.equal(retiredReload.list()[0].active, false);
  assert.ok(retiredReload.resolve(edited.currentRevisionId, scopedModelContext(edited)), "historical model revisions survive restart for pinned runs");
});

test("a completed all-Workspace replacement plan and retiring lifecycle survive registry restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "traqen-model-replacement-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profileStore = new EncryptedAnalysisModelProfileStore({ filePath: join(directory, "profiles.enc.json") });
  const registry = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  registry.configure({ id: "OLD", endpoint: "https://models.example/v1", model: "old", apiKey: "old-secret" });
  registry.configure({ id: "NEW", endpoint: "https://models.example/v1", model: "new", apiKey: "new-secret" });
  await registry.verify("OLD");
  await registry.verify("NEW");
  const plan = registry.createReplacementPlan({ sourceProfileId: "OLD", replacementProfileId: "NEW", references: [], changes: [] });
  registry.beginReplacementPlan(plan.id, plan.version);
  registry.completeReplacementPlan(plan.id);

  const reloaded = new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() });
  assert.equal(reloaded.getReplacementPlan(plan.id).status, "APPLIED");
  assert.equal(reloaded.list().find(({ id }) => id === "OLD").lifecycle, "RETIRING");
  assert.equal(reloaded.beginReplacementPlan(plan.id, plan.version).status, "APPLIED", "an interrupted response can observe the committed Plan after restart");
});
