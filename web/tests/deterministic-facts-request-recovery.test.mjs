import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("request recovery browser mode explicitly uses actual request faults rather than the run-loss case", () => {
  const runner = readFileSync(new URL("../../test/support/f002-interface-browser.mjs", import.meta.url), "utf8");
  assert.match(runner, /requestRecovery: mode === "--request-recovery"/);
  assert.match(runner, /await verifyRequestRecovery\(/);
});
