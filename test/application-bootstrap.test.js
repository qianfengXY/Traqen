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
