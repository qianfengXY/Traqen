import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("F006 settings center keeps global availability, Workspace grants, and external OAuth separate", async () => {
  const source = await readFile(new URL("../app/f006-settings-center.tsx", import.meta.url), "utf8");
  assert.match(source, /Settings center/);
  assert.match(source, /Global inherited and available/);
  assert.match(source, /Global unavailable \/ needs attention/);
  assert.match(source, /Workspace-local capabilities/);
  assert.match(source, /Workspace availability and Agent grants are separate layers/);
  assert.match(source, /Complete .* OAuth in its own CLI|Sign in in the CLI/);
  assert.doesNotMatch(source, /accessToken|refreshToken|beginOAuthLogin/, "the UI must not create an OAuth token or login flow");
  assert.match(source, /Apply configuration/);
  assert.match(source, /setTimeout\(\(\) => \{\s*props\.onAutoSave\(\)/);
  assert.match(source, /Cannot re-enable here/);
  assert.match(source, /actualUnavailable/);
});
