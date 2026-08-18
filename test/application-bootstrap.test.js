import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createConfiguredApplication } from "../src/api/application-bootstrap.js";
import { EncryptedAnalysisModelProfileStore } from "../src/analysis/index.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";

test("runtime configuration rejects an unknown quality-gate mode at startup", () => {
  assert.throws(
    () => createConfiguredApplication({
      store: new MemoryTraceabilityStore(),
      env: { QUALITY_GATE_MODE: "AUTOMATIC_MAGIC" },
    }),
    /QUALITY_GATE_MODE must be/,
  );
});

test("runtime configuration rejects a malformed multi-reviewer identity directory", () => {
  assert.throws(
    () => createConfiguredApplication({
      store: new MemoryTraceabilityStore(),
      env: { REVIEWER_IDENTITIES_JSON: "not-json" },
    }),
    /REVIEWER_IDENTITIES_JSON must be valid JSON/,
  );
  assert.throws(
    () => createConfiguredApplication({
      store: new MemoryTraceabilityStore(),
      env: { REVIEWER_IDENTITIES_JSON: JSON.stringify([{ actorId: "OWNER-001", actorRole: "business-owner" }]) },
    }),
    /requires token, actorId, and actorRole/,
  );
});

test("server-owned understanding cannot start with partial correctness evidence configuration", () => {
  assert.throws(() => createConfiguredApplication({
    store: new MemoryTraceabilityStore(),
    env: { UNDERSTANDING_TRUTH_SET_PATH: "/tmp/truth.json" },
  }), /must be configured together/);
  assert.throws(() => createConfiguredApplication({
    store: new MemoryTraceabilityStore(),
    env: {
      SOURCE_SNAPSHOT_ROOT: "/tmp/snapshots",
      TRAQEN_ALLOWED_WORKSPACE_ROOTS: "/tmp/source",
    },
  }), /requires Truth Set, reviewed measurement, and equivalence evidence paths/);
});

test("configured production bootstrap hydrates Store-owned model revisions before exposing runtime", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "traqen-bootstrap-model-revisions-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const modelStorePath = join(directory, "profiles.enc.json");
  const store = new MemoryTraceabilityStore();
  const first = createConfiguredApplication({
    store,
    env: { ANALYSIS_MODEL_STORE_PATH: modelStorePath },
  });
  await first.ready;
  await first.application.configureGlobalModelProfile({
    profileId: "MODEL-BOOTSTRAP-RECOVERY",
    displayName: "Bootstrap recovery",
    transport: "API",
    endpoint: "https://models.example/v1",
    model: "bootstrap-recovery",
    apiKey: "bootstrap-secret",
  });
  const encrypted = new EncryptedAnalysisModelProfileStore({ filePath: modelStorePath }).load();
  assert.deepEqual(encrypted.profiles, [], "non-sensitive profile metadata belongs to the shared Store");
  assert.equal(encrypted.credentialHandles.length, 1);

  const restarted = createConfiguredApplication({
    store,
    env: { ANALYSIS_MODEL_STORE_PATH: modelStorePath },
  });
  await restarted.ready;
  assert.equal(
    restarted.application.listAnalysisModelProfiles().find(({ id }) => id === "MODEL-BOOTSTRAP-RECOVERY")?.model,
    "bootstrap-recovery",
  );
});
