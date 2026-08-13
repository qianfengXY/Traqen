import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AnalysisModelRegistry, EncryptedAnalysisModelProfileStore } from "../src/analysis/index.js";

function verifiedFetch() {
  return async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
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
  assert.ok(reloaded.resolve());

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
  assert.ok(retiredReload.resolve(edited.currentRevisionId), "historical model revisions survive restart for pinned runs");
});
