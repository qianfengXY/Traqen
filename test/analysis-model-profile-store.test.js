import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AnalysisModelRegistry, EncryptedAnalysisModelProfileStore } from "../src/analysis/index.js";

function verifiedFetch() {
  return async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
}

test("runtime model profiles and the active selection survive restart in an encrypted local store", async (t) => {
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
  assert.equal(verified.active, true);
  assert.equal(verified.stream, true);

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
  assert.deepEqual(new AnalysisModelRegistry({ profileStore, fetchImpl: verifiedFetch() }).list(), []);
});
