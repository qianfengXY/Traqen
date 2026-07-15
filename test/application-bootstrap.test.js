import assert from "node:assert/strict";
import test from "node:test";

import { createConfiguredApplication } from "../src/api/application-bootstrap.js";
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
