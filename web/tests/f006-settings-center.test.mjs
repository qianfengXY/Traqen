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
  assert.match(source, /const OAUTH_ADAPTERS = \["CODEX", "CLAUDE"\]/,
    "OAuth is available only for CLIs with a supported read-only status probe");
  assert.match(source, /const accountAdapters = props\.authMethod === "OAUTH" \? OAUTH_ADAPTERS : ADAPTERS/,
    "the account form must hide adapters without a supported OAuth status probe");
  assert.doesNotMatch(source, /accessToken|refreshToken|beginOAuthLogin/, "the UI must not create an OAuth token or login flow");
  assert.match(source, /Apply configuration/);
  assert.match(source, /setTimeout\(\(\) => \{\s*autosaveInFlight\.current = true/);
  assert.match(source, /onAutoSave\(\)\.then\(\(saved\)/);
  assert.match(source, /Retry save/);
  assert.match(source, /Cannot re-enable here/);
  assert.match(source, /actualUnavailable/);
  assert.match(source, /Granted to/);
  assert.match(source, /onOpenAgentSettings/);
  assert.match(source, /f006-settings-nav/);
  assert.match(source, /f006-mobile-agent-back/);
  assert.match(source, /agentDrawerOpen/);
  assert.match(source, /availableSkills\.length \?/);
  assert.match(source, /availableMcps\.length \?/);
});
